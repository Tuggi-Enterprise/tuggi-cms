/**
 * SEC-37 — the CMS stopped talking to PostgREST as `anon` from the browser.
 *
 * Three things are pinned here, and each one is a way the card could regress:
 *
 * 1. every new `app/api/dashboard/*` route refuses an anonymous caller with 401
 *    and a CMS user whose role is not `admin` with 403 — and in both cases the RPC
 *    is never issued. The measurement that opened the card was 269 anonymous calls
 *    to seven RPCs, three of which return identifiers and locations of people;
 * 2. the numbers that reach those RPCs are bounded, because a route is the only
 *    barrier left in front of the database;
 * 3. the anon-without-session client does not come back. That one is static: it is
 *    the shape of the defect, not one of its instances, and it had four names
 *    (`getSupabase('server')`, `getSupabaseServer`, `getSupabaseEdge`, and the
 *    `supabase` re-export of `lib/supabase.ts`).
 *
 * Run with: npm run test:api
 */

import { test, before, mock } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dirname, '../..')

interface RpcCall {
  fn: string
  args: unknown
}

interface Scenario {
  user: { id: string; email: string } | null
  cmsUser: { email: string; role: string; is_active: boolean } | null
  /** Every RPC the handler managed to issue. Must stay empty when the gate refuses. */
  rpcCalls: RpcCall[]
  /** Rows the fake RPC answers with. */
  rpcData: unknown
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
      resetPasswordForEmail: async () => ({ data: {}, error: null }),
    },
    schema: () => ({
      from: () => cmsUsersChain,
      rpc: async (fn: string, args?: unknown) => {
        scenario.rpcCalls.push({ fn, args: args ?? null })
        return { data: scenario.rpcData, error: null }
      },
    }),
  }
}

const ADMIN = { id: 'auth-user-1', email: 'admin@tuggi.app' }

function setScenario(partial: Partial<Scenario>): void {
  scenario = { user: null, cmsUser: null, rpcCalls: [], rpcData: [], ...partial }
}

function asAdmin(): void {
  setScenario({ user: ADMIN, cmsUser: { email: ADMIN.email, role: 'admin', is_active: true } })
}

function request(url: string): any {
  return new Request(url)
}

type Handler = (req: any, ctx?: any) => Promise<Response>

interface DashboardRoute {
  /** Path of the route module, from the repo root. */
  module: string
  /** A URL the route accepts. */
  url: string
  /** RPCs the handler issues when it is allowed to run. */
  rpcs: string[]
}

/**
 * The seven RPCs the card names, and where each one is served from. `overview`
 * carries four of them because they are one `Promise.all` on one screen; splitting
 * it would have cost the Overview four extra round trips to prove nothing.
 */
const ROUTES: DashboardRoute[] = [
  {
    module: 'app/api/dashboard/overview/route.ts',
    url: 'http://localhost/api/dashboard/overview',
    rpcs: [
      'dashboard_user_analytics_global',
      'dashboard_city_stats',
      'dashboard_most_visited_cities',
      'dashboard_top_visited_pois',
      'dashboard_recent_visited_pois',
      'dashboard_inventory_funnel',
      'dashboard_content_quality',
      'dashboard_visits_by_language',
      'dashboard_recent_app_users',
      'dashboard_country_stats_global',
      'dashboard_migration_metrics',
      'dashboard_top_generators',
    ],
  },
  {
    module: 'app/api/dashboard/realtime-activity/route.ts',
    url: 'http://localhost/api/dashboard/realtime-activity?windowSeconds=600',
    rpcs: ['dashboard_realtime_activity'],
  },
  {
    module: 'app/api/dashboard/waitlist/stats/route.ts',
    url: 'http://localhost/api/dashboard/waitlist/stats',
    rpcs: ['dashboard_waitlist_stats'],
  },
  {
    module: 'app/api/dashboard/waitlist/pins/route.ts',
    url: 'http://localhost/api/dashboard/waitlist/pins?limit=100&onlyPending=false',
    rpcs: ['dashboard_waitlist_pins'],
  },
  {
    module: 'app/api/dashboard/content-quality/route.ts',
    url: 'http://localhost/api/dashboard/content-quality',
    rpcs: ['dashboard_content_quality'],
  },
  {
    module: 'app/api/dashboard/inventory-funnel/route.ts',
    url: 'http://localhost/api/dashboard/inventory-funnel',
    rpcs: ['dashboard_inventory_funnel'],
  },
  {
    module: 'app/api/dashboard/top-generators/route.ts',
    url: 'http://localhost/api/dashboard/top-generators?limit=5',
    rpcs: ['dashboard_top_generators'],
  },
  {
    // #656. The paid-access read: the aggregate plus the people who hold a balance. The
    // list returns `full_name` and `email`, so it is a read about people like the seven
    // the card named — the gate is the same, and this sweep is where that is stated.
    module: 'app/api/dashboard/entitlement/route.ts',
    url: 'http://localhost/api/dashboard/entitlement?limit=20&maxBalanceMinutes=299',
    rpcs: ['dashboard_entitlement_overview', 'dashboard_metered_users'],
  },
]

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
    const mod = await import(resolve(REPO_ROOT, route.module))
    handlers.set(route.module, mod.GET as Handler)
  }
})

for (const route of ROUTES) {
  test(`SEC-37: ${route.module} refuses an anonymous caller with 401`, async () => {
    setScenario({ user: null })

    const response = await handlers.get(route.module)!(request(route.url))

    assert.equal(response.status, 401)
    assert.deepEqual(
      scenario.rpcCalls,
      [],
      'no RPC may leave the server for a caller with no session'
    )
  })

  test(`SEC-37: ${route.module} refuses a non-admin CMS user with 403`, async () => {
    // `editor` signs into the CMS and is refused by `proxy.ts` at /dashboard. The
    // route says the same thing where a caller cannot navigate around it.
    setScenario({ user: ADMIN, cmsUser: { email: ADMIN.email, role: 'editor', is_active: true } })

    const response = await handlers.get(route.module)!(request(route.url))

    assert.equal(response.status, 403)
    assert.deepEqual(scenario.rpcCalls, [], 'the handler must not run for an insufficient role')
  })

  test(`SEC-37: ${route.module} serves an admin with the operator session`, async () => {
    asAdmin()

    const response = await handlers.get(route.module)!(request(route.url))

    assert.equal(response.status, 200)
    assert.deepEqual(
      scenario.rpcCalls.map((call) => call.fn).sort(),
      [...route.rpcs].sort(),
      'the route must issue exactly the RPCs it exists to serve'
    )
  })
}

test('SEC-37: a caller cannot widen a dashboard read past its ceiling', async () => {
  // The route is the only barrier in front of PostgREST: `?limit=1e9` would be a
  // full table read of personal data dressed as a dashboard request.
  asAdmin()
  await handlers.get('app/api/dashboard/waitlist/pins/route.ts')!(
    request('http://localhost/api/dashboard/waitlist/pins?limit=1000000000')
  )
  assert.equal((scenario.rpcCalls[0].args as any).p_limit, 20_000)

  asAdmin()
  await handlers.get('app/api/dashboard/top-generators/route.ts')!(
    request('http://localhost/api/dashboard/top-generators?limit=99999')
  )
  assert.equal((scenario.rpcCalls[0].args as any).limit_count, 100)

  // Empty is not zero: `Number('')` is 0, which would turn a missing limit into
  // "return nothing" and read as an empty dashboard instead of a bad request.
  asAdmin()
  await handlers.get('app/api/dashboard/realtime-activity/route.ts')!(
    request('http://localhost/api/dashboard/realtime-activity?windowSeconds=')
  )
  assert.equal((scenario.rpcCalls[0].args as any).window_seconds, 120)
})

test('SEC-37: onlyPending is decided by the literal, never by truthiness', async () => {
  asAdmin()
  await handlers.get('app/api/dashboard/waitlist/pins/route.ts')!(
    request('http://localhost/api/dashboard/waitlist/pins?onlyPending=false')
  )
  assert.equal((scenario.rpcCalls[0].args as any).p_only_pending, false)

  asAdmin()
  await handlers.get('app/api/dashboard/waitlist/pins/route.ts')!(
    request('http://localhost/api/dashboard/waitlist/pins?onlyPending=maybe')
  )
  assert.equal(
    (scenario.rpcCalls[0].args as any).p_only_pending,
    true,
    'an unrecognised value must fall back, not read as true because it is a non-empty string'
  )
})

// ---------------------------------------------------------------------------
// Static: the shape of the defect, not one of its instances.
// ---------------------------------------------------------------------------

/** `grep -rl`, scoped, with no dependency on the shell finding `rg`. */
function grepFiles(pattern: string, paths: string[]): string[] {
  try {
    const out = execFileSync('grep', ['-rl', '--include=*.ts', '--include=*.tsx', pattern, ...paths], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
    return out.split('\n').filter(Boolean)
  } catch {
    // grep exits 1 when it matches nothing, which is the passing case here.
    return []
  }
}

const SOURCE_PATHS = ['app', 'lib', 'components', 'scripts', 'proxy.ts']

/** Source with comments removed, so a name explained in prose is not read as code. */
function codeOf(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
}

test('SEC-37: the anon-without-session client has no way back', () => {
  const client = codeOf('lib/core/supabase-client.ts')

  // `getSupabaseServerComponent` is cookie-bound and stays — hence the boundary.
  for (const gone of [/\bgetServerClient\b/, /\bgetSupabaseServer\b/, /\bgetSupabaseEdge\b/, /\bgetEdgeClient\b/]) {
    assert.equal(
      gone.test(client),
      false,
      `${gone.source} built a client with the publishable key and no cookie — every query it made was anon`
    )
  }

  // The type is the guard: `getSupabase('server')` must not type-check either.
  assert.match(client, /export type SupabaseClientType = 'client' \| 'service'/)

  // Files, then code: several of them name the old call in a comment that explains
  // why it went. Filtering by filename instead would have hidden a real caller in
  // exactly the files most likely to grow one back.
  const callers = grepFiles("getSupabase('server')", SOURCE_PATHS)
    .filter((file) => codeOf(file).includes("getSupabase('server')"))
  assert.deepEqual(callers, [], 'these files still ask for the anon-without-session client')
})

test('SEC-37: the legacy publishable-key variable is not read anywhere', () => {
  // `NEXT_PUBLIC_SUPABASE_ANON_KEY` is the old name of the browser key. Reading it
  // as a fallback is how a key that should be retired stays in service — and the
  // two verification components read *only* the legacy name, so with just the
  // current one defined they were built with an empty key.
  const readers = grepFiles('NEXT_PUBLIC_SUPABASE_ANON_KEY', SOURCE_PATHS)
    .filter((file) => codeOf(file).includes('NEXT_PUBLIC_SUPABASE_ANON_KEY'))

  assert.deepEqual(readers, [])
})

test('SEC-37: the two components that wrote curation as anon are gone', () => {
  // Both created their own `createClient` with the publishable key and no cookie.
  // `VerificationDrawer` used it to set `verification_status` on
  // `core.attraction_descriptions`, so approving content required no session at
  // all. Neither had a caller, and the feature they belong to was replaced by
  // Google grounding — see docs/cleanup-verification-feature-removal.md.
  for (const component of [
    'components/verification/VerificationDrawer.tsx',
    'components/verification/BatchProgressBar.tsx',
  ]) {
    assert.equal(existsSync(resolve(REPO_ROOT, component)), false, `${component} must not come back`)
  }

  const rawClients = grepFiles("from '@supabase/supabase-js'", ['components'])
  assert.deepEqual(rawClients, [], 'a component that builds its own client bypasses the cookie')
})
