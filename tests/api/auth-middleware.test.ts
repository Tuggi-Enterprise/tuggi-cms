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
