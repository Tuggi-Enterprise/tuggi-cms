/**
 * #1204: the two usage reads of the dashboard Overview, and the mapping from their payloads to the
 * charts (contract banco-para-cms Parte 30, spec-cms-dashboard-uso-2026-11 §2 to §5).
 *
 * Routes: admin only with the operator's own JWT, the number that reaches the RPC is clamped to the
 * function's own bounds, and a failed RPC is a 502, never an empty payload (24 hours of zero or
 * twelve empty months would claim that nobody used the app).
 *
 * Mapping: 24 hours always, first month and returning stacked, the running month drawn partial, the
 * first measured month as one floor bar, and a month before it with no bar (DS-COMPONENTE-084,
 * DS-COMPONENTE-100).
 *
 * Run with: npm run test:api
 */

import { test, before, mock } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
// Pure modules only at the top: nothing here talks to Supabase.
import {
  MONTHLY_KEYS,
  MONTHLY_SERIES,
  compactGrowth,
  dailyPoints,
  firstMonthShown,
  hourlyHasData,
  lastClosedPoint,
  monthlyHasData,
  monthlyPoints,
  monthlyRows,
  parseMonthlyReturningUsers,
  parseUsageByHour,
  peakHour,
  usageMonths,
} from '@/lib/dashboard/usage'
import { CHART_COLORS, CHART_NEUTRAL } from '@/lib/constants/chart-colors'

const REPO_ROOT = resolve(import.meta.dirname, '../..')

interface Scenario {
  user: { id: string; email: string } | null
  cmsUser: { email: string; role: string; is_active: boolean } | null
  rpcCalls: Array<{ fn: string; args: unknown }>
  rpcData: unknown
  rpcError: { message: string; code?: string } | null
}

let scenario: Scenario

function createFakeClient() {
  const cmsUsersChain: any = {
    select: () => cmsUsersChain,
    eq: () => cmsUsersChain,
    maybeSingle: async () => ({ data: scenario.cmsUser, error: null }),
  }
  return {
    auth: {
      getUser: async () => ({
        data: { user: scenario.user },
        error: scenario.user ? null : { message: 'Auth session missing!' },
      }),
    },
    schema: () => ({
      from: () => cmsUsersChain,
      rpc: async (fn: string, args?: unknown) => {
        scenario.rpcCalls.push({ fn, args: args ?? null })
        return scenario.rpcError ? { data: null, error: scenario.rpcError } : { data: scenario.rpcData, error: null }
      },
    }),
  }
}

const ADMIN = { id: 'auth-user-1', email: 'admin@tuggi.app' }

function setScenario(partial: Partial<Scenario>): void {
  scenario = { user: null, cmsUser: null, rpcCalls: [], rpcData: { ok: true }, rpcError: null, ...partial }
}

function asAdmin(partial: Partial<Scenario> = {}): void {
  setScenario({ user: ADMIN, cmsUser: { email: ADMIN.email, role: 'admin', is_active: true }, ...partial })
}

type Handler = (req: any, ctx?: any) => Promise<Response>

const ROUTES = [
  { file: 'app/api/dashboard/usage-by-hour/route.ts', base: 'http://localhost/api/dashboard/usage-by-hour', rpc: 'dashboard_usage_by_hour', param: 'days', fallback: 7, max: 31 },
  { file: 'app/api/dashboard/returning-users/route.ts', base: 'http://localhost/api/dashboard/returning-users', rpc: 'dashboard_monthly_returning_users', param: 'months', fallback: 12, max: 24 },
] as const

const handlers = new Map<string, Handler>()

before(async () => {
  mock.module('next/headers', {
    namedExports: { cookies: async () => ({ get: () => undefined, getAll: () => [] }) },
  })
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseRouteHandler: () => createFakeClient(),
      getSupabaseService: () => createFakeClient(),
      getSupabaseClient: () => createFakeClient(),
    },
  })
  for (const route of ROUTES) {
    const mod = await import(resolve(REPO_ROOT, route.file))
    handlers.set(route.file, mod.GET as Handler)
  }
})

for (const route of ROUTES) {
  test(`#1204: ${route.file} serves an admin with the RPC's payload`, async () => {
    asAdmin({ rpcData: { marker: route.rpc } })
    const response = await handlers.get(route.file)!(new Request(route.base))
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { data: { marker: route.rpc } })
    assert.deepEqual(scenario.rpcCalls, [{ fn: route.rpc, args: { [route.param]: route.fallback } }])
  })

  test(`#1204: ${route.file} refuses a non-admin CMS user with 403 and issues no RPC`, async () => {
    setScenario({ user: ADMIN, cmsUser: { email: ADMIN.email, role: 'editor', is_active: true } })
    const response = await handlers.get(route.file)!(new Request(`${route.base}?${route.param}=3`))
    assert.equal(response.status, 403)
    assert.deepEqual(scenario.rpcCalls, [])
  })

  test(`#1204: ${route.file} refuses an anonymous caller with 401`, async () => {
    setScenario({ user: null })
    const response = await handlers.get(route.file)!(new Request(route.base))
    assert.equal(response.status, 401)
    assert.deepEqual(scenario.rpcCalls, [])
  })

  test(`#1204: ${route.file} clamps ${route.param} to 1..${route.max}`, async () => {
    const cases: Array<[string, number]> = [
      ['999', route.max],
      ['0', 1],
      ['-5', 1],
      ['', route.fallback],
      ['abc', route.fallback],
      ['30', Math.min(30, route.max)],
    ]
    for (const [raw, expected] of cases) {
      asAdmin()
      await handlers.get(route.file)!(new Request(`${route.base}?${route.param}=${raw}`))
      assert.equal((scenario.rpcCalls[0].args as Record<string, number>)[route.param], expected, `${route.param}=${raw}`)
    }
  })

  test(`#1204: ${route.file} answers a failed RPC with 502, never an empty payload`, async () => {
    asAdmin({ rpcError: { message: 'forbidden: platform admin required', code: '42501' } })
    const original = console.error
    console.error = () => {}
    try {
      const response = await handlers.get(route.file)!(new Request(route.base))
      assert.equal(response.status, 502)
      const body = await response.json()
      assert.equal(body.data, undefined, 'no data key on failure')
      assert.equal(body.error, 'forbidden: platform admin required')
      assert.equal(body.code, '42501')
    } finally {
      console.error = original
    }
  })
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

/** 2026-11-19 15:00 in Brasília: the current month is 2026-11. */
const NOW = new Date('2026-11-19T18:00:00Z')

test('#1204: the twelve months end at the current month in Sao Paulo, even when UTC has turned the month', () => {
  const months = usageMonths(NOW)
  assert.equal(months.length, 12)
  assert.equal(months[0], '2025-12')
  assert.equal(months[11], '2026-11')
  // 2026-12-01 01:00 UTC is still November 30th in Brasília.
  assert.equal(usageMonths(new Date('2026-12-01T01:00:00Z'))[11], '2026-11')
})

const MONTHLY = parseMonthlyReturningUsers({
  first_ping_at: '2026-03-10T09:00:00-03:00',
  months: [
    { month: '2026-03', active_users: 37, new_users: 37, returning_users: 0 },
    { month: '2026-04', active_users: 72, new_users: 52, returning_users: 20 },
    { month: '2026-05', active_users: 0, new_users: 0, returning_users: 0 },
    { month: '2026-10', active_users: 200, new_users: 120, returning_users: 80 },
    { month: '2026-11', active_users: 120, new_users: 62, returning_users: 58 },
  ],
})!

test('#1204 DS-COMPONENTE-084: a month before the first ping draws no bar and says why, never zero', () => {
  const points = monthlyPoints(MONTHLY, usageMonths(NOW), NOW)
  const rows = monthlyRows(points, { label: (m) => m, short: (m) => m, unmeasured: 'before the first measurement' })
  const feb = rows.find((r) => r.month === '2026-02')!
  assert.deepEqual(feb.values, {})
  assert.equal(feb.reason, 'before the first measurement')
  // A month after the first ping that the function did not return is also "no data", not zero.
  const jun = rows.find((r) => r.month === '2026-06')!
  assert.deepEqual(jun.values, {})
  assert.ok(jun.reason)
})

test('#1204 DS-COMPONENTE-084: the first measured month is one floor bar with the total, not split', () => {
  const points = monthlyPoints(MONTHLY, usageMonths(NOW), NOW)
  const mar = points.find((p) => p.month === '2026-03')!
  assert.equal(mar.state, 'first')
  const row = monthlyRows(points, { label: (m) => m, short: (m) => m, unmeasured: '' }).find((r) => r.month === '2026-03')!
  assert.deepEqual(row.values, { [MONTHLY_KEYS.unsplit]: 37 })
  assert.equal(row.reason, null)
  assert.equal(firstMonthShown(points), true)
  // Outside the window, the first month is not on screen and every measured month splits.
  const old = monthlyPoints({ ...MONTHLY, first_ping_at: '2024-01-01T00:00:00-03:00' }, usageMonths(NOW), NOW)
  assert.equal(firstMonthShown(old), false)
  assert.equal(old.find((p) => p.month === '2026-03')!.state, 'split')
})

test('#1204: first month and returning stack, returning at the bottom, with a whole percent', () => {
  const points = monthlyPoints(MONTHLY, usageMonths(NOW), NOW)
  const rows = monthlyRows(points, { label: (m) => m, short: (m) => m, unmeasured: '' })
  const oct = rows.find((r) => r.month === '2026-10')!
  assert.deepEqual(oct.values, { returning_users: 80, new_users: 120 })
  // MonthBars stacks in series order: returning blue at the bottom, first month orange, the grey floor.
  assert.deepEqual(
    MONTHLY_SERIES.map((s) => [s.key, s.color]),
    [
      [MONTHLY_KEYS.returning, CHART_COLORS.blue],
      [MONTHLY_KEYS.first, CHART_COLORS.orange],
      [MONTHLY_KEYS.unsplit, CHART_NEUTRAL],
    ]
  )
  assert.equal(points.find((p) => p.month === '2026-10')!.sharePct, 40)
  // 20 of 72 is 27.8 %: whole percent.
  assert.equal(points.find((p) => p.month === '2026-04')!.sharePct, 28)
})

test('#1204: a measured month with nobody has no percent (the screen prints the unknown mark)', () => {
  const may = monthlyPoints(MONTHLY, usageMonths(NOW), NOW).find((p) => p.month === '2026-05')!
  assert.equal(may.state, 'split')
  assert.equal(may.active, 0)
  assert.equal(may.sharePct, null)
})

test('#1204 DS-COMPONENTE-100: only the running month is partial, and the summary reads the last closed one', () => {
  const points = monthlyPoints(MONTHLY, usageMonths(NOW), NOW)
  const rows = monthlyRows(points, { label: (m) => m, short: (m) => m, unmeasured: '' })
  assert.deepEqual(
    rows.filter((r) => r.partial).map((r) => r.month),
    ['2026-11']
  )
  assert.equal(lastClosedPoint(points)!.month, '2026-10')
})

test('#1204: an empty table is the empty state, not twelve zeros', () => {
  const empty = parseMonthlyReturningUsers({ first_ping_at: null, months: [] })!
  assert.equal(monthlyHasData(monthlyPoints(empty, usageMonths(NOW), NOW)), false)
  assert.equal(parseMonthlyReturningUsers(null), null)
  assert.equal(parseMonthlyReturningUsers({ months: 'x' }), null)
})

test('#1204: the compact base repeats the total over a month with no sign-up and is zero before the first', () => {
  const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05']
  const out = compactGrowth(
    [
      { month: '2026-04', count: 150 },
      { month: '2026-02', count: 100 },
    ],
    months
  )
  assert.deepEqual(
    out.map((r) => r.count),
    [0, 100, 100, 150, 150]
  )
  // Months before the window still carry: the base is cumulative.
  assert.deepEqual(
    compactGrowth([{ month: '2025-06', count: 40 }], ['2026-01']).map((r) => r.count),
    [40]
  )
})

const HOURLY_RAW = {
  timezone: 'America/Sao_Paulo',
  window_seconds: 120,
  days: 7,
  by_hour: [
    { hour: 9, peak_concurrent: 8, avg_unique_users: 9.4 },
    { hour: 11, peak_concurrent: 11, avg_unique_users: 13.1 },
    { hour: 16, peak_concurrent: 11, avg_unique_users: 12.6 },
  ],
  by_day: [
    { day: '2026-11-19', unique_users: 29, peak_concurrent: 6, peak_at: '2026-11-19T13:04:00-03:00' },
    { day: '2026-11-13', unique_users: 41, peak_concurrent: 9, peak_at: '2026-11-13T11:02:00-03:00' },
    { day: '2026-11-14', unique_users: 0, peak_concurrent: 0, peak_at: null },
  ],
}

test('#1204: the hourly chart always has the 24 hours, a missing hour as zero', () => {
  const parsed = parseUsageByHour(HOURLY_RAW)!
  assert.equal(parsed.by_hour.length, 24)
  assert.deepEqual(
    parsed.by_hour.map((h) => h.hour),
    Array.from({ length: 24 }, (_, i) => i)
  )
  assert.deepEqual(parsed.by_hour[0], { hour: 0, peak_concurrent: 0, avg_unique_users: 0 })
  assert.equal(parsed.by_hour[11].avg_unique_users, 13.1)
  assert.equal(hourlyHasData(parsed), true)
})

test('#1204: the peak value is carried once, by the first hour of a tie', () => {
  const parsed = parseUsageByHour(HOURLY_RAW)!
  assert.equal(peakHour(parsed.by_hour)!.hour, 11)
  assert.equal(peakHour(parseUsageByHour({ ...HOURLY_RAW, by_hour: [] })!.by_hour), null)
})

test('#1204: 24 hours of zero is the empty state', () => {
  const parsed = parseUsageByHour({ ...HOURLY_RAW, by_hour: Array.from({ length: 24 }, (_, hour) => ({ hour, peak_concurrent: 0, avg_unique_users: 0 })) })!
  assert.equal(hourlyHasData(parsed), false)
  assert.equal(parseUsageByHour({ by_hour: [] }), null)
})

test('#1204: days come in order, today is marked, a day with no use keeps peak_at null', () => {
  const days = dailyPoints(parseUsageByHour(HOURLY_RAW)!, NOW)
  assert.deepEqual(
    days.map((d) => d.day),
    ['2026-11-13', '2026-11-14', '2026-11-19']
  )
  assert.deepEqual(
    days.filter((d) => d.today).map((d) => d.day),
    ['2026-11-19']
  )
  assert.equal(days[1].peak_at, null)
})
