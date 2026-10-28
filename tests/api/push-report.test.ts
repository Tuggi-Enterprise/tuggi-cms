/**
 * #1051: the CMS push report (BR-COMUNICACAO-019 3.m.9). Three API doors over the drive functions
 * of db-tuggiApp 20261028160000 (contract notificacoes.md §13): `/api/dashboard/push`,
 * `/api/dashboard/push/people` and `/api/admin/weekly-push/engagement`.
 *
 * Pinned here: admin only and no RPC before the gate; the documented argument names on
 * service_role; a bad argument is 400 before the database and 22023 from it is 400 too; the
 * people list carries id, nickname and the three times only (BR-USUARIO-042); broadcast has no
 * list; `inactive_tokens_changed` never leaves the route; and the sums keep NULL apart from zero
 * (DS-COMPONENTE-084), with broadcast out of the open rate.
 *
 * Run with: npm run test:api
 */

import { test, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import type { NextRequest } from 'next/server'

const OPERATOR_UID = 'cccccccc-2222-4333-8444-555555555555'
const PERSON_UID = 'aaaaaaaa-1111-4222-8333-444444444444'

type RpcCall = { schema: string; fn: string; args: unknown }
let calls: RpcCall[]
let role: string
let answers: Record<string, { data?: unknown; error?: { code: string; message: string } }>

function client() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = {
    auth: { getUser: async () => ({ data: { user: { id: OPERATOR_UID, email: 'admin@tuggi.app' } }, error: null }) },
    schema: (schema: string) => ({
      from: () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { id: 'cms-1', email: 'admin@tuggi.app', role, is_active: true }, error: null }) }
        return q
      },
      rpc: async (fn: string, args?: unknown) => {
        calls.push({ schema, fn, args })
        const a = answers[fn]
        return { data: a?.data ?? null, error: a?.error ?? null }
      },
    }),
  }
  return c
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let reportRoute: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let peopleRoute: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let engagementRoute: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let lib: any

before(async () => {
  mock.module('next/headers', { namedExports: { cookies: async () => ({ get: () => undefined, getAll: () => [] }) } })
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseRouteHandler: () => client(),
      getSupabaseService: () => client(),
      getSupabase: () => client(),
    },
  })
  reportRoute = await import('@/app/api/dashboard/push/route')
  peopleRoute = await import('@/app/api/dashboard/push/people/route')
  engagementRoute = await import('@/app/api/admin/weekly-push/engagement/route')
  lib = await import('@/lib/notifications/push-report')
})

beforeEach(() => {
  calls = []
  role = 'admin'
  answers = {}
})

const get = (path: string) => new Request(`http://localhost${path}`) as unknown as NextRequest
const ctx = { params: Promise.resolve({}) }

const REVENUE = { opened_pushes: 0, opened_buyers: 0, opened_revenue_usd: 0, not_opened_pushes: 0, not_opened_buyers: 0, not_opened_revenue_usd: 0 }
const send = (over: Record<string, unknown>) => ({
  send_key: 'direct:hours_credited:2026-10-20', channel: 'direct', type: 'hours_credited', piece: null, day: '2026-10-20',
  title: 'x', distinct_titles: 1, first_sent_at: '2026-10-20T12:00:00Z', last_sent_at: '2026-10-20T12:00:00Z',
  sent: 10, delivered: 6, opened: 3, not_delivered: null, open_rate: 0.3, influenced_opens: null,
  action_pushes: null, action_opened_pushes: null, revenue: REVENUE, base_cost: { push_off: null, uninstalled: null }, variants: null,
  ...over,
})
const REPORT = {
  period: { from: '2026-10-01T03:00:00Z', to: '2026-10-29T03:00:00Z', type: null, time_zone: 'America/Sao_Paulo' },
  windows: { action_hours: 24, revenue_days: 7, base_cost_hours: 48 },
  devices: { active_tokens: 120, people_with_active_token: 110, uninstalls: null, inactive_tokens_changed: 37 },
  by_type: [],
  sends: [send({})],
}

test('#1051 BR-COMUNICACAO-019 3.m.9: only an admin reaches the three push report doors, and no RPC runs before the gate', async () => {
  for (const r of ['editor', 'viewer', 'client']) {
    role = r
    assert.equal((await reportRoute.GET(get('/api/dashboard/push?from=2026-10-01&to=2026-10-28'), ctx)).status, 403, r)
    assert.equal((await peopleRoute.GET(get(`/api/dashboard/push/people?send_key=direct:hours_credited:2026-10-20&opened=true`), ctx)).status, 403, r)
    assert.equal((await engagementRoute.GET(get('/api/admin/weekly-push/engagement'), ctx)).status, 403, r)
  }
  assert.deepEqual(calls, [])
})

test('#1051 BR-COMUNICACAO-019 3.m.9: the report reads the period in Sao Paulo days, half open, and drops inactive_tokens_changed', async () => {
  answers.cms_get_push_report = { data: REPORT }
  const res = await reportRoute.GET(get('/api/dashboard/push?from=2026-10-01&to=2026-10-28'), ctx)
  assert.equal(res.status, 200)
  assert.deepEqual(calls, [
    { schema: 'drive', fn: 'cms_get_push_report', args: { p_from: '2026-10-01T00:00:00-03:00', p_to: '2026-10-29T00:00:00-03:00' } },
  ])
  const { data } = await res.json()
  assert.deepEqual(data.devices, { active_tokens: 120, people_with_active_token: 110, uninstalls: null })
  assert.equal(data.sends.length, 1)
  assert.doesNotMatch(JSON.stringify(data), /inactive_tokens_changed/)
})

test('#1051: a bad period never reaches the database, and 22023 from the function is 400 too', async () => {
  const bad = [
    '',
    '?from=2026-10-01',
    '?from=2026-10-28&to=2026-10-01',
    '?from=2026-02-30&to=2026-03-01',
    '?from=2025-01-01&to=2026-10-28',
    "?from=2026-10-01'&to=2026-10-28",
  ]
  for (const q of bad) assert.equal((await reportRoute.GET(get(`/api/dashboard/push${q}`), ctx)).status, 400, q)
  assert.deepEqual(calls, [])

  answers.cms_get_push_report = { error: { code: '22023', message: 'cms_get_push_report: from before to' } }
  const res = await reportRoute.GET(get('/api/dashboard/push?from=2026-10-01&to=2026-10-28'), ctx)
  assert.equal(res.status, 400)
  assert.equal((await res.json()).code, '22023')
  answers.cms_get_push_report = { error: { code: 'XX000', message: 'boom' } }
  assert.equal((await reportRoute.GET(get('/api/dashboard/push?from=2026-10-01&to=2026-10-28'), ctx)).status, 502)
})

test('#1051 BR-USUARIO-042: the people of a send carry id, nickname and the three times, and nothing else', async () => {
  answers.cms_get_push_send_people = {
    data: [
      { user_id: PERSON_UID, nickname: 'Ana', sent_at: '2026-10-20T12:00:00Z', delivered_at: '2026-10-20T12:00:05Z', read_at: '2026-10-20T13:00:00Z', total_count: 51, email: 'ana@example.com' },
    ],
  }
  const res = await peopleRoute.GET(get('/api/dashboard/push/people?send_key=weekly:thursday_local:2026-10-23&opened=false&page=1'), ctx)
  assert.equal(res.status, 200)
  assert.deepEqual(calls, [
    { schema: 'drive', fn: 'cms_get_push_send_people', args: { p_send_key: 'weekly:thursday_local:2026-10-23', p_opened: false, p_limit: 50, p_offset: 50 } },
  ])
  const { data } = await res.json()
  assert.equal(data.total, 51)
  assert.deepEqual(Object.keys(data.people[0]).sort(), ['delivered_at', 'nickname', 'read_at', 'sent_at', 'user_id'])
  assert.doesNotMatch(JSON.stringify(data), /@/)
})

test('#1051: the people door refuses broadcast and a malformed key or page before the database', async () => {
  const bad = [
    'send_key=broadcast:generic:2026-10-20&opened=true',
    'send_key=direct:hours_credited:2026-13-01&opened=true',
    'send_key=email:x:2026-10-20&opened=true',
    'send_key=direct:hours_credited:2026-10-20&opened=yes',
    'send_key=direct:hours_credited:2026-10-20&opened=true&page=-1',
    'opened=true',
  ]
  for (const q of bad) assert.equal((await peopleRoute.GET(get(`/api/dashboard/push/people?${q}`), ctx)).status, 400, q)
  assert.deepEqual(calls, [])

  answers.cms_get_push_send_people = { error: { code: '22023', message: 'bad' } }
  assert.equal((await peopleRoute.GET(get('/api/dashboard/push/people?send_key=direct:x:2026-10-20&opened=true'), ctx)).status, 400)
})

test('#1051 BR-COMUNICACAO-019 3.m.9: the weekly engagement asks for the 12 weeks of the results table', async () => {
  const body = { summary: { weeks: 4, from_local_date: '2026-10-05', sent: 9, delivered: null, opened: 2, open_rate: 0.2222 }, sends: [] }
  answers.cms_get_weekly_push_engagement = { data: body }
  const res = await engagementRoute.GET(get('/api/admin/weekly-push/engagement'), ctx)
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), body)
  assert.deepEqual(calls, [{ schema: 'drive', fn: 'cms_get_weekly_push_engagement', args: { p_weeks: 12 } }])
  answers.cms_get_weekly_push_engagement = { error: { code: '22023', message: 'weeks' } }
  assert.equal((await engagementRoute.GET(get('/api/admin/weekly-push/engagement'), ctx)).status, 400)
})

test('#1051 DS-COMPONENTE-084: NULL stays "no source" through the sums, and broadcast is out of the open rate', () => {
  assert.equal(lib.sumMeasured([null, undefined]), null)
  assert.equal(lib.sumMeasured([null, 0]), 0)
  assert.equal(lib.sumMeasured([2, null, 3]), 5)

  const funnel = lib.pushFunnel([
    send({ sent: 10, delivered: 6, opened: 3 }),
    send({ send_key: 'broadcast:generic:2026-10-20', channel: 'broadcast', type: 'generic', sent: 1000, delivered: null, opened: 400 }),
  ])
  assert.equal(funnel.sent, 1010)
  assert.equal(funnel.delivered, 6)
  assert.equal(funnel.opened, 3)
  assert.equal(funnel.measured_sent, 10)
  assert.equal(funnel.open_rate, 0.3)
  assert.equal(funnel.not_delivered, null)

  const onlyBroadcast = lib.pushFunnel([send({ channel: 'broadcast', delivered: null })])
  assert.equal(onlyBroadcast.open_rate, null)
  assert.equal(onlyBroadcast.delivered, null)
  assert.equal(onlyBroadcast.opened, null)

  const empty = lib.pushFunnel([])
  assert.equal(empty.sent, 0)
  assert.equal(empty.open_rate, null)
})

test('#1051: the type chips count sends per type, by volume, and only types with sends', () => {
  const chips = lib.pushTypeCounts([
    send({ type: 'hours_credited' }),
    send({ type: 'weekly_thursday_local', channel: 'weekly' }),
    send({ type: 'weekly_thursday_local', channel: 'weekly' }),
  ])
  assert.deepEqual(chips, [
    { type: 'weekly_thursday_local', sends: 2 },
    { type: 'hours_credited', sends: 1 },
  ])
  assert.deepEqual(lib.presetRange('7d', new Date(2026, 9, 28, 15)), { from: '2026-10-22', to: '2026-10-28' })
})
