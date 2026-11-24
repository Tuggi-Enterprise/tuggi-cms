/**
 * #1094: the two API doors of the Engagement report. `/api/dashboard/engagement` reads
 * `drive.cms_get_engagement_monthly` on service_role (contract banco-para-cms Parte 25);
 * `/api/dashboard/engagement/ga4` calls the `engagement-ga4` Edge Function with the server's
 * secret key.
 *
 * Pinned here: admin only and nothing read before the gate; the documented argument names and the
 * month ruler as the period; a bad filter is 400 before the database; GA4 is never asked under a
 * filter it does not have; a failure answers the code, not the message.
 *
 * Run with: npm run test:api
 */

import { test, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import type { NextRequest } from 'next/server'

type Call = { kind: 'rpc' | 'invoke'; target: string; args: unknown; headers?: unknown }
let calls: Call[]
let role: string
let signedIn: boolean
let rpcAnswer: { data?: unknown; error?: { code: string; message: string } }
let invokeAnswer: { data?: unknown; error?: { name: string; message: string } }

function client() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = {
    auth: { getUser: async () => (signedIn ? { data: { user: { id: 'op', email: 'admin@tuggi.app' } }, error: null } : { data: { user: null }, error: { message: 'no session' } }) },
    schema: (schema: string) => ({
      from: () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { id: 'cms-1', email: 'admin@tuggi.app', role, is_active: true }, error: null }) }
        return q
      },
      rpc: async (fn: string, args?: unknown) => {
        calls.push({ kind: 'rpc', target: `${schema}.${fn}`, args })
        return { data: rpcAnswer.data ?? null, error: rpcAnswer.error ?? null }
      },
    }),
    functions: {
      invoke: async (fn: string, opts: { body: unknown; headers: unknown }) => {
        calls.push({ kind: 'invoke', target: fn, args: opts.body, headers: opts.headers })
        return { data: invokeAnswer.data ?? null, error: invokeAnswer.error ?? null }
      },
    },
  }
  return c
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let bankRoute: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ga4Route: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let usageRoute: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let activeRoute: any

before(async () => {
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_test'
  mock.module('next/headers', { namedExports: { cookies: async () => ({ get: () => undefined, getAll: () => [] }) } })
  mock.module('@/lib/core/supabase-client', {
    namedExports: { getSupabaseRouteHandler: () => client(), getSupabaseService: () => client(), getSupabase: () => client() },
  })
  bankRoute = await import('@/app/api/dashboard/engagement/route')
  ga4Route = await import('@/app/api/dashboard/engagement/ga4/route')
  usageRoute = await import('@/app/api/dashboard/engagement/usage/route')
  activeRoute = await import('@/app/api/dashboard/engagement/active/route')
})

beforeEach(() => {
  calls = []
  role = 'admin'
  signedIn = true
  rpcAnswer = { data: { data_since: { open: '2026-10-28', trip: '2026-08-01', audio: '2026-08-01' }, months: [] } }
  invokeAnswer = { data: { months: [], clicks: [] } }
})

const get = (path: string) => new Request(`http://localhost${path}`) as unknown as NextRequest
const ctx = { params: Promise.resolve({}) }

test('#1094: only an admin reaches the two engagement doors, and nothing is read before the gate', async () => {
  for (const r of ['editor', 'viewer', 'client']) {
    role = r
    assert.equal((await bankRoute.GET(get('/api/dashboard/engagement'), ctx)).status, 403, r)
    assert.equal((await ga4Route.GET(get('/api/dashboard/engagement/ga4'), ctx)).status, 403, r)
  }
  assert.deepEqual(calls, [])
})

test('#1094 BR-COMUNICACAO-022 item 4: the bank door reads the month ruler with the documented names, and null stays null', async () => {
  rpcAnswer = {
    data: { data_since: { open: '2026-10-28', trip: '2026-08-01', audio: '2026-08-01' }, months: [{ month: '2026-08', active: { open: null, trip: 0, audio: 3 } }] },
  }
  const res = await bankRoute.GET(get('/api/dashboard/engagement?source=none&country=BR&platform=ios&account=anonymous'), ctx)
  assert.equal(res.status, 200)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].target, 'drive.cms_get_engagement_monthly')
  const args = calls[0].args as Record<string, unknown>
  assert.equal(args.p_from, '2026-08-01T00:00:00-03:00')
  assert.match(String(args.p_to), /^\d{4}-\d{2}-01T00:00:00-03:00$/)
  assert.deepEqual({ ...args, p_from: undefined, p_to: undefined }, { p_from: undefined, p_to: undefined, p_source: 'none', p_country: 'BR', p_platform: 'ios', p_account: 'anonymous' })
  const { data } = await res.json()
  assert.deepEqual(data.months[0].active, { open: null, trip: 0, audio: 3 })
})

test('#1094: a bad filter never reaches the database; a refusal answers its SQLSTATE, not its message', async () => {
  for (const q of ['country=Brazil', 'platform=web', 'account=guest']) {
    assert.equal((await bankRoute.GET(get(`/api/dashboard/engagement?${q}`), ctx)).status, 400, q)
  }
  assert.deepEqual(calls, [])
  rpcAnswer = { error: { code: 'PGRST202', message: 'Could not find the function drive.cms_get_engagement_monthly(p_source => BR)' } }
  const res = await bankRoute.GET(get('/api/dashboard/engagement'), ctx)
  assert.equal(res.status, 502)
  const body = await res.json()
  assert.equal(body.code, 'PGRST202')
  assert.doesNotMatch(JSON.stringify(body), /Could not find/)
})

test('#1094: the GA4 door calls engagement-ga4 with the secret key as Bearer, and never under source or account', async () => {
  invokeAnswer = { data: { months: [{ month: '2026-10', activeUsers: 262, engagementSeconds: 1, sessionsPerUser: null }], clicks: [] } }
  const res = await ga4Route.GET(get('/api/dashboard/engagement/ga4?platform=android&country=PT'), ctx)
  assert.equal(res.status, 200)
  assert.deepEqual(calls, [
    { kind: 'invoke', target: 'engagement-ga4', args: { from_month: '2026-08', platform: 'android', country: 'PT' }, headers: { Authorization: 'Bearer sb_secret_test' } },
  ])
  const { data } = await res.json()
  assert.equal(data.months[0].sessionsPerUser, null)

  calls = []
  for (const q of ['source=none', 'account=account']) {
    assert.equal((await ga4Route.GET(get(`/api/dashboard/engagement/ga4?${q}`), ctx)).status, 400, q)
  }
  assert.deepEqual(calls, [])

  invokeAnswer = { error: { name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code' } }
  assert.equal((await ga4Route.GET(get('/api/dashboard/engagement/ga4'), ctx)).status, 502)
  invokeAnswer = { data: { months: 'nope' } }
  assert.equal((await ga4Route.GET(get('/api/dashboard/engagement/ga4'), ctx)).status, 502)
})

test('#1161 BR-COMUNICACAO-022 item 4: the usage door is admin only, reads cms_get_usage_monthly with the filters, keeps null as null, and a function not applied yet (PGRST202) is a 502 with its code', async () => {
  role = 'editor'
  assert.equal((await usageRoute.GET(get('/api/dashboard/engagement/usage'), ctx)).status, 403)
  assert.equal(calls.length, 0)
  role = 'admin'
  rpcAnswer = {
    data: {
      data_since: { open: '2026-10-28T17:27:03Z', trip: '2025-07-31T20:39:39Z', movement: '2026-07-29T15:11:04Z' },
      months: [{ month: '2026-10', first_day: { entered: 119, guide: 32, story: 24, guide_or_story: 37, explore_only: null, nothing: null }, movement: null }],
    },
  }
  const res = await usageRoute.GET(get('/api/dashboard/engagement/usage?platform=ios&account=anonymous'), ctx)
  assert.equal(res.status, 200)
  assert.equal(calls[0].target, 'drive.cms_get_usage_monthly')
  const args = calls[0].args as Record<string, unknown>
  assert.equal(args.p_platform, 'ios')
  assert.equal(args.p_account, 'anonymous')
  assert.equal(args.p_source, null)
  const body = await res.json()
  assert.equal(body.data.data_since.movement, '2026-07-29')
  assert.equal(body.data.months[0].first_day.explore_only, null)
  assert.equal(body.data.months[0].movement, null)
  rpcAnswer = { error: { code: 'PGRST202', message: 'Could not find the function drive.cms_get_usage_monthly(p_from, p_to)' } }
  const failed = await usageRoute.GET(get('/api/dashboard/engagement/usage'), ctx)
  assert.equal(failed.status, 502)
  const failedBody = await failed.json()
  assert.equal(failedBody.code, 'PGRST202')
  assert.doesNotMatch(JSON.stringify(failedBody), /Could not find/)
})

test('#1162 security review of #1160: the active-users door answers 401 without a session and 403 to every non-admin role, and calls nothing before the gate', async () => {
  signedIn = false
  assert.equal((await activeRoute.GET(get('/api/dashboard/engagement/active'), ctx)).status, 401)
  signedIn = true
  for (const r of ['editor', 'viewer', 'client']) {
    role = r
    assert.equal((await activeRoute.GET(get('/api/dashboard/engagement/active'), ctx)).status, 403, r)
  }
  assert.deepEqual(calls, [])
})

test('#1162 BR-COMUNICACAO-022 item 4 DS-COMPONENTE-084 item 1: the active-users door reads cms_get_active_users_monthly with the filters, keeps open_coverage and null, and answers a refusal by its code', async () => {
  rpcAnswer = {
    data: {
      data_since: { open: '2026-10-28T17:27:03Z', use: '2025-07-31T20:39:39Z' },
      months: [
        { month: '2026-10', days: 31, all_sources: { open_coverage: 'partial', dau: 4.3, wau: 16.3, mau: 72, dau_mau: 0.0591 }, trip_or_story: { dau: 3.5, wau: 15.1, mau: 55, dau_mau: 0.0628 } },
        { month: '2026-07', days: null, all_sources: null, trip_or_story: null },
      ],
    },
  }
  const res = await activeRoute.GET(get('/api/dashboard/engagement/active?country=BR&account=account'), ctx)
  assert.equal(res.status, 200)
  assert.equal(calls[0].target, 'drive.cms_get_active_users_monthly')
  const args = calls[0].args as Record<string, unknown>
  assert.equal(args.p_country, 'BR')
  assert.equal(args.p_account, 'account')
  assert.equal(args.p_platform, null)
  assert.equal(args.p_from, '2026-08-01T00:00:00-03:00')
  const { data } = await res.json()
  assert.equal(data.data_since.open, '2026-10-28')
  assert.deepEqual(data.months[0].all_sources, { open_coverage: 'partial', dau: 4.3, wau: 16.3, mau: 72, dau_mau: 0.0591 })
  assert.deepEqual(data.months[1].all_sources, { open_coverage: null, dau: null, wau: null, mau: null, dau_mau: null })
  assert.equal((await activeRoute.GET(get('/api/dashboard/engagement/active?platform=web'), ctx)).status, 400)
  rpcAnswer = { error: { code: '42501', message: 'permission denied for function cms_get_active_users_monthly' } }
  const refused = await activeRoute.GET(get('/api/dashboard/engagement/active'), ctx)
  assert.equal(refused.status, 403)
  assert.doesNotMatch(JSON.stringify(await refused.json()), /permission denied/)
})
