/**
 * `/api/dashboard/entitlement` — the paid-access read of #656.
 *
 * The 401/403 gate is proved for every dashboard route in `dashboard-routes.test.ts`,
 * where this route is listed too. What is pinned here is what only this one does:
 *
 * 1. the two RPCs are called BY NAME, with bounded arguments — the route is the only
 *    barrier in front of PostgREST, and `?limit=1e9` on a list that carries names and
 *    e-mails is a full read of personal data dressed up as a dashboard request;
 * 2. `maxBalanceMinutes` absent means "no ceiling" and must reach the RPC as `null`. As
 *    a number it would mean "balance at most zero", which is nobody;
 * 3. **a missing RPC does not take the dashboard down.** The migration behind both RPCs
 *    belongs to `data` and may not be applied when this ships: the route answers 200 with
 *    the error per key, and the service turns that into an empty state.
 *
 * Run with: npm run test:api
 */

import { test, before, mock } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dirname, '../..')

interface RpcCall {
  fn: string
  args: unknown
}

interface Scenario {
  user: { id: string; email: string } | null
  cmsUser: { email: string; role: string; is_active: boolean } | null
  rpcCalls: RpcCall[]
  /** Rows each RPC answers with, by function name. */
  rpcData: Record<string, unknown>
  /** Failures each RPC answers with, by function name. */
  rpcError: Record<string, string>
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
        const message = scenario.rpcError[fn]
        if (message) return { data: null, error: { message } }
        return { data: scenario.rpcData[fn] ?? [], error: null }
      },
    }),
  }
}

const ADMIN = { id: 'auth-user-1', email: 'admin@tuggi.app' }
const ROUTE = 'app/api/dashboard/entitlement/route.ts'

function asAdmin(partial: Partial<Scenario> = {}): void {
  scenario = {
    user: ADMIN,
    cmsUser: { email: ADMIN.email, role: 'admin', is_active: true },
    rpcCalls: [],
    rpcData: {},
    rpcError: {},
    ...partial,
  }
}

let GET: (req: any, ctx?: any) => Promise<Response>

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

  const mod = await import(resolve(REPO_ROOT, ROUTE))
  GET = mod.GET
})

function argsOf(fn: string): any {
  const call = scenario.rpcCalls.find((c) => c.fn === fn)
  assert.ok(call, `${fn} was never called`)
  return call.args
}

test('#656: the route serves both reads of the paid-access screen, by name', async () => {
  asAdmin()

  const response = await GET(new Request('http://localhost/api/dashboard/entitlement'))
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.deepEqual(
    scenario.rpcCalls.map((c) => c.fn).sort(),
    ['dashboard_entitlement_overview', 'dashboard_metered_users']
  )
  assert.ok('overview' in body.data && 'meteredUsers' in body.data)
})

test('#656: an absent balance ceiling reaches the RPC as null, not as zero', async () => {
  asAdmin()

  await GET(new Request('http://localhost/api/dashboard/entitlement'))

  assert.equal(argsOf('dashboard_metered_users').max_balance_minutes, null)
  assert.equal(argsOf('dashboard_metered_users').limit_count, 100)

  // Empty is not zero either: `Number('')` is 0, which would read as "nobody has balance".
  asAdmin()
  await GET(new Request('http://localhost/api/dashboard/entitlement?limit=&maxBalanceMinutes='))
  assert.equal(argsOf('dashboard_metered_users').limit_count, 100)
  assert.equal(argsOf('dashboard_metered_users').max_balance_minutes, null)
})

test('#656: a caller cannot widen the list past its ceiling', async () => {
  // The rows carry `full_name` and `email`: an unbounded limit here is a dump of people.
  asAdmin()
  await GET(new Request('http://localhost/api/dashboard/entitlement?limit=1000000000'))
  assert.equal(argsOf('dashboard_metered_users').limit_count, 1000)

  asAdmin()
  await GET(new Request('http://localhost/api/dashboard/entitlement?limit=0'))
  assert.equal(argsOf('dashboard_metered_users').limit_count, 1)

  asAdmin()
  await GET(new Request('http://localhost/api/dashboard/entitlement?maxBalanceMinutes=299'))
  assert.equal(argsOf('dashboard_metered_users').max_balance_minutes, 299)

  asAdmin()
  await GET(new Request('http://localhost/api/dashboard/entitlement?maxBalanceMinutes=999999'))
  assert.equal(argsOf('dashboard_metered_users').max_balance_minutes, 24 * 60)

  // Not a number is not a ceiling of zero — it is no ceiling.
  asAdmin()
  await GET(new Request('http://localhost/api/dashboard/entitlement?maxBalanceMinutes=soon'))
  assert.equal(argsOf('dashboard_metered_users').max_balance_minutes, null)
})

test('#656: an RPC that does not exist yet answers 200, not a broken dashboard', async () => {
  // Exactly what the operator gets between this merge and the migration by `data`.
  asAdmin({
    rpcError: {
      dashboard_entitlement_overview: 'function core.dashboard_entitlement_overview() does not exist',
      dashboard_metered_users: 'function core.dashboard_metered_users(integer, integer) does not exist',
    },
  })

  const response = await GET(new Request('http://localhost/api/dashboard/entitlement'))
  const body = await response.json()

  assert.equal(response.status, 200, 'a 5xx here would take the whole Overview down with it')
  assert.equal(body.data.overview.data, null)
  assert.match(body.data.overview.error.message, /does not exist/)
  assert.match(body.data.meteredUsers.error.message, /does not exist/)
})

test('#656: one failing read does not silence the other', async () => {
  asAdmin({
    rpcData: { dashboard_metered_users: [{ user_id: 'u-1', balance_minutes: 42 }] },
    rpcError: { dashboard_entitlement_overview: 'permission denied for function' },
  })

  const body = await (await GET(new Request('http://localhost/api/dashboard/entitlement'))).json()

  assert.equal(body.data.overview.data, null)
  assert.equal(body.data.overview.error.message, 'permission denied for function')
  assert.equal(body.data.meteredUsers.error, null)
  assert.equal(body.data.meteredUsers.data.length, 1)
})
