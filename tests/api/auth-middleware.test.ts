/**
 * CARD-CMS-01 — the single gate for `app/api/**​/route.ts`.
 *
 * These tests pin the five states the gate has to tell apart, plus the two that
 * the card names explicitly: the decision must never come from `getSession()`,
 * and a gate that breaks must answer 500 — never the handler's 200.
 *
 * Run with: npm run test:api
 */

import { test, before, mock } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { NextRequest } from 'next/server'

interface CmsRow {
  email: string
  role: string
  is_active: boolean
}

interface Scenario {
  /** Authenticated auth user, or null for an anonymous caller. */
  user: { id: string; email: string } | null
  /** Row found in core.cms_users, or null when the user has no CMS access. */
  cmsUser: CmsRow | null
  /** Simulates the cms_users lookup itself failing. */
  cmsLookupError?: string
  /** Set when the gate consults getSession(), which it must never do. */
  getSessionCalled: boolean
}

let scenario: Scenario

function createFakeClient() {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () =>
      scenario.cmsLookupError
        ? { data: null, error: { message: scenario.cmsLookupError } }
        : { data: scenario.cmsUser, error: null },
  }

  return {
    auth: {
      getUser: async () => ({
        data: { user: scenario.user },
        error: scenario.user ? null : { message: 'Auth session missing!' },
      }),
      getSession: async () => {
        scenario.getSessionCalled = true
        return { data: { session: null }, error: null }
      },
    },
    schema: () => ({ from: () => chain }),
  }
}

let withAuth: typeof import('@/lib/auth-middleware').withAuth
let withPublicRoute: typeof import('@/lib/auth-middleware').withPublicRoute
let withRateLimit: typeof import('@/lib/auth-middleware').withRateLimit

before(async () => {
  mock.module('next/headers', {
    namedExports: { cookies: async () => ({ get: () => undefined, getAll: () => [] }) },
  })

  mock.module('@/lib/core/supabase-client', {
    namedExports: { getSupabaseRouteHandler: () => createFakeClient() },
  })

  const middleware = await import('@/lib/auth-middleware')
  withAuth = middleware.withAuth
  withPublicRoute = middleware.withPublicRoute
  withRateLimit = middleware.withRateLimit
})

const ADMIN = { id: 'auth-user-1', email: 'admin@tuggi.app' }

function setScenario(partial: Partial<Scenario>): void {
  scenario = { user: null, cmsUser: null, getSessionCalled: false, ...partial }
}

function request(): NextRequest {
  return new Request('http://localhost/api/anything') as unknown as NextRequest
}

/** Handler that must not run when the gate refuses. */
function handlerThatMustNotRun() {
  let ran = false
  const handler = async () => {
    ran = true
    return Response.json({ ok: true })
  }
  return { handler, get ran() { return ran } }
}

test('CARD-CMS-01: anonymous caller is refused with 401', async () => {
  setScenario({ user: null })
  const spy = handlerThatMustNotRun()

  const response = await withAuth({ roles: ['admin'] }, spy.handler)(request())

  assert.equal(response.status, 401)
  assert.equal(spy.ran, false, 'the handler must not observe an anonymous caller')
})

test('CARD-CMS-01: authenticated user without a core.cms_users row is refused with 403', async () => {
  setScenario({ user: ADMIN, cmsUser: null })
  const spy = handlerThatMustNotRun()

  const response = await withAuth({ roles: ['admin'] }, spy.handler)(request())

  assert.equal(response.status, 403)
  assert.equal(spy.ran, false, 'a Supabase account is not CMS access')
})

test('CARD-CMS-01: a CMS user whose role is not in the policy is refused with 403', async () => {
  setScenario({
    user: ADMIN,
    cmsUser: { email: ADMIN.email, role: 'viewer', is_active: true },
  })
  const spy = handlerThatMustNotRun()

  const response = await withAuth({ roles: ['admin', 'editor'] }, spy.handler)(request())

  assert.equal(response.status, 403)
  assert.equal(spy.ran, false)
})

test('CARD-CMS-01: an allowed role reaches the handler with the proven identity', async () => {
  setScenario({
    user: ADMIN,
    cmsUser: { email: ADMIN.email, role: 'admin', is_active: true },
  })

  const gated = withAuth({ roles: ['admin'] }, async (_req, _ctx, auth) =>
    Response.json({ userId: auth.user.id, role: auth.cmsUser.role, hasClient: !!auth.supabase })
  )
  const response = await gated(request())
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.userId, ADMIN.id, 'the handler reads the identity the gate proved')
  assert.equal(payload.role, 'admin')
  assert.equal(payload.hasClient, true, 'the handler reuses the gate cookie-bound client')
})

test('CARD-CMS-01: the decision never consults getSession()', async () => {
  setScenario({
    user: ADMIN,
    cmsUser: { email: ADMIN.email, role: 'admin', is_active: true },
  })

  await withAuth({ roles: ['admin'] }, async () => Response.json({ ok: true }))(request())

  assert.equal(
    scenario.getSessionCalled,
    false,
    'getSession() reads unverified cookie storage; a revoked session would still pass'
  )
})

test('CARD-CMS-01: a public route answers without any session', async () => {
  setScenario({ user: null })

  const gated = withPublicRoute(
    { reason: 'Catalogue read with no personal data' },
    async () => Response.json({ ok: true })
  )
  const response = await gated(request())

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true })
})

test('CARD-CMS-01: a gate that fails answers 500, never the handler 200', async () => {
  setScenario({ user: ADMIN, cmsLookupError: 'connection reset' })
  const spy = handlerThatMustNotRun()

  const response = await withAuth({ roles: ['admin'] }, spy.handler)(request())

  assert.equal(response.status, 500, '"we could not tell" is not "you have no access"')
  assert.equal(spy.ran, false)
})

test('CARD-CMS-01: a policy that declares nothing is rejected at module load, not at request time', () => {
  assert.throws(
    () => withAuth({ roles: [] }, async () => Response.json({})),
    /at least one role/
  )
  assert.throws(
    () => withAuth({ roles: ['superuser' as any] }, async () => Response.json({})),
    /core.cms_users does not have/
  )
  assert.throws(
    () => withPublicRoute({ reason: '  ' }, async () => Response.json({})),
    /requires a reason/
  )
})

test('CARD-CMS-01: withRateLimit forwards the route params it wraps', async () => {
  setScenario({
    user: ADMIN,
    cmsUser: { email: ADMIN.email, role: 'admin', is_active: true },
  })

  const limited = withRateLimit(10, 60_000)(
    withAuth<{ id: string }>({ roles: ['admin'] }, async (_req, ctx) =>
      Response.json({ id: (await ctx.params)?.id ?? null })
    )
  )

  const response = await limited(request(), { params: Promise.resolve({ id: 'poi-42' }) })

  // The composition is what the five paid routes will use, and three of them live
  // under a dynamic segment: dropping ctx here would hand them `{}` and lose the id.
  assert.deepEqual(await response.json(), { id: 'poi-42' })
})

// ---------------------------------------------------------------------------
// The static check — `scripts/check-route-policies.ts`.
//
// Phase 2 converts 132 routes, so the script stops being a report and becomes the
// only barrier: a hole in it costs 132 times. Each test below is one hole the
// security review of phase 1 named, exercised through the real script so that the
// exit code — not a re-implementation of the parse — is what is asserted.
// ---------------------------------------------------------------------------

const REPO_ROOT = resolve(import.meta.dirname, '../..')
const CHECK_SCRIPT = resolve(REPO_ROOT, 'scripts/check-route-policies.ts')

interface CheckResult {
  status: number
  output: string
}

/** Runs the real check against a throwaway tree of `route.ts` fixtures. */
function runCheck(routes: Record<string, string>): CheckResult {
  const dir = mkdtempSync(join(tmpdir(), 'route-policies-'))
  try {
    for (const [relativePath, contents] of Object.entries(routes)) {
      const file = join(dir, relativePath)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, contents)
    }

    const run = spawnSync(resolve(REPO_ROOT, 'node_modules/.bin/tsx'), [CHECK_SCRIPT, dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })

    return { status: run.status ?? -1, output: `${run.stdout}${run.stderr}` }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('CARD-CMS-01: a gate imported from a different auth-middleware is not this gate', () => {
  // `supabase/functions/_shared/auth-middleware.ts` exists and is a different module
  // with a different job. Matching the specifier by suffix accepted it.
  const foreign = runCheck({
    'route.ts': `
      import { withAuth } from '@/supabase/functions/_shared/auth-middleware'
      export const GET = withAuth({ roles: ['admin'] }, async () => Response.json({}))
    `,
  })
  assert.equal(foreign.status, 1, 'a homonymous withAuth from another module is not a policy')
  assert.match(foreign.output, /GET/)

  // Same fixture, real module: proves the test above fails for the right reason.
  const real = runCheck({
    'route.ts': `
      import { withAuth } from '@/lib/auth-middleware'
      export const GET = withAuth({ roles: ['admin'] }, async () => Response.json({}))
    `,
  })
  assert.equal(real.status, 0, real.output)
})

test('CARD-CMS-01: only the listed composers may sit between the export and the gate', () => {
  // `wrap` may call the gate, or may drop it on the floor and return its own handler.
  // The script cannot tell, so it must refuse.
  const unknownWrapper = runCheck({
    'route.ts': `
      import { withAuth } from '@/lib/auth-middleware'
      const wrap = (_handler: unknown) => async () => Response.json({ leaked: true })
      export const GET = wrap(withAuth({ roles: ['admin'] }, async () => Response.json({})))
    `,
  })
  assert.equal(unknownWrapper.status, 1, 'containing a gate call is not being produced by one')

  const composed = runCheck({
    'route.ts': `
      import { withAuth, withRateLimit } from '@/lib/auth-middleware'
      export const GET = withRateLimit(10, 60000)(
        withAuth({ roles: ['admin'] }, async () => Response.json({}))
      )
    `,
  })
  assert.equal(composed.status, 0, composed.output)

  // A local `withRateLimit` from anywhere else is not the composer either.
  const foreignComposer = runCheck({
    'route.ts': `
      import { withAuth } from '@/lib/auth-middleware'
      import { withRateLimit } from './local-rate-limit'
      export const GET = withRateLimit(10)(withAuth({ roles: ['admin'] }, async () => Response.json({})))
    `,
  })
  assert.equal(foreignComposer.status, 1, 'the composer must come from the gate module too')
})

test('CARD-CMS-01: withPublicRoute over a file that reaches service_role fails the check', () => {
  // The realistic phase-2 failure: stamp withPublicRoute to turn the check green.
  // service_role ignores RLS, so that pair is an anonymous caller with the database.
  const viaFactory = runCheck({
    'route.ts': `
      import { withPublicRoute } from '@/lib/auth-middleware'
      import { getSupabaseService } from '@/lib/core/supabase-client'
      export const GET = withPublicRoute({ reason: 'catalogue read' }, async () => {
        const supabase = getSupabaseService()
        return Response.json(await supabase.from('attractions').select('*'))
      })
    `,
  })
  assert.equal(viaFactory.status, 1)
  assert.match(viaFactory.output, /service_role/)

  const viaSelector = runCheck({
    'route.ts': `
      import { withPublicRoute } from '@/lib/auth-middleware'
      import { getSupabase } from '@/lib/core/supabase-client'
      const supabase = getSupabase('service')
      export const GET = withPublicRoute({ reason: 'catalogue read' }, async () =>
        Response.json(await supabase.from('attractions').select('*'))
      )
    `,
  })
  assert.equal(viaSelector.status, 1, "getSupabase('service') is the same client by another name")

  const viaEnv = runCheck({
    'route.ts': `
      import { createClient } from '@supabase/supabase-js'
      import { withPublicRoute } from '@/lib/auth-middleware'
      const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)
      export const GET = withPublicRoute({ reason: 'catalogue read' }, async () =>
        Response.json(await supabase.from('attractions').select('*'))
      )
    `,
  })
  assert.equal(viaEnv.status, 1, 'naming the secret key is reaching service_role, however the client is built')

  // The same service client behind withAuth is allowed: the rule is about "public",
  // not about the service client, and the test has to show it does not overreach.
  const authed = runCheck({
    'route.ts': `
      import { withAuth } from '@/lib/auth-middleware'
      import { getSupabaseService } from '@/lib/core/supabase-client'
      export const GET = withAuth({ roles: ['admin'] }, async () =>
        Response.json(await getSupabaseService().from('attractions').select('*'))
      )
    `,
  })
  assert.equal(authed.status, 0, authed.output)

  // And a public route with no service client stays legal.
  const publicOnly = runCheck({
    'route.ts': `
      import { withPublicRoute } from '@/lib/auth-middleware'
      export const GET = withPublicRoute({ reason: 'health check for the Vercel cron' }, async () =>
        Response.json({ ok: true })
      )
    `,
  })
  assert.equal(publicOnly.status, 0, publicOnly.output)
})

test('CARD-CMS-01: the four routes deleted as orphans are gone', () => {
  // They had no caller: the CMS reads the location taxonomy through the cms_get_*
  // RPCs in lib/core/location-service.ts. /api/pois/filters answered 200 in 18.9s
  // with ~75 round trips to Postgres, unauthenticated, on service_role.
  for (const route of [
    'app/api/pois/filters/route.ts',
    'app/api/states/route.ts',
    'app/api/pois/countries/route.ts',
    'app/api/locations/countries-cities/route.ts',
  ]) {
    assert.equal(existsSync(resolve(REPO_ROOT, route)), false, `${route} must not come back`)
  }
})
