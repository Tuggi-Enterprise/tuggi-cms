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
let rpcAnswer: { data?: unknown; error?: { code: string; message: string } }
let invokeAnswer: { data?: unknown; error?: { name: string; message: string } }

function client() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = {
    auth: { getUser: async () => ({ data: { user: { id: 'op', email: 'admin@tuggi.app' } }, error: null }) },
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

before(async () => {
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_test'
  mock.module('next/headers', { namedExports: { cookies: async () => ({ get: () => undefined, getAll: () => [] }) } })
  mock.module('@/lib/core/supabase-client', {
    namedExports: { getSupabaseRouteHandler: () => client(), getSupabaseService: () => client(), getSupabase: () => client() },
  })
  bankRoute = await import('@/app/api/dashboard/engagement/route')
  ga4Route = await import('@/app/api/dashboard/engagement/ga4/route')
})

beforeEach(() => {
  calls = []
  role = 'admin'
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
