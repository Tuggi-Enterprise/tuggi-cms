/**
 * #906 — the publish route is the one act behind the board's `Publicado` for a portal
 * submission (BR-B2B-049 item 8). A POI already in the app (Reserve ON, POI `88eb7d4f`) is the
 * same destination: no second write, no plan refusal, and the submission still goes `live` with
 * its "no ar" e-mail.
 *
 * Run with: npm run test:api
 */

import { before, beforeEach, test, mock } from 'node:test'
import assert from 'node:assert/strict'
import type { NextRequest } from 'next/server'

const CLIENT_ID = '00000000-0000-4000-8000-000000000906'
const POI = '88eb7d4f-0000-4000-8000-000000000906'
const SUB = '5009da91-382f-49f0-9dc1-db2026c7959d'
const OPERATOR = 'bbbbbbbb-2222-4333-8444-555555555555'

let placeApproved = true
let offersAct = false
let writes: boolean[] = []
let lived: string[] = []
let notified: string[] = []

const auth = {
  user: { id: OPERATOR, email: 'op@tuggi.app' },
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) } },
}

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>
let POST: Handler

before(async () => {
  mock.module('@/lib/auth-middleware', {
    namedExports: {
      withAuth: (_options: unknown, handler: (req: unknown, ctx: unknown, a: unknown) => unknown) =>
        (req: unknown, ctx: unknown) => handler(req, ctx, auth),
      withRateLimit: () => (handler: unknown) => handler,
    },
  })
  mock.module('@/lib/services/audit-service', { namedExports: { logAuditEvent: async () => {} } })
  mock.module('@/lib/core/place-service', {
    namedExports: {
      placeService: {
        setApproved: async (_id: string, approved: boolean) => {
          writes.push(approved)
        },
      },
    },
  })
  mock.module('@/lib/services/partnership-service', {
    namedExports: {
      loadPartnerPlace: async () => ({
        readiness: { place: { approved: placeApproved } },
        plan: { offersAct, variant: 'undeclared', startsBilling: false },
        publishedBy: null,
        refusal: null,
      }),
    },
  })
  mock.module('@/lib/services/acceptance-gate-service', {
    namedExports: { checkAcceptanceGate: async () => ({ ok: true }), gateRefusalBody: () => ({}) },
  })
  mock.module('@/lib/services/portal-validation-service', {
    namedExports: {
      markPortalSubmissionLive: async (attractionId: string) => {
        lived.push(attractionId)
        return [SUB]
      },
    },
  })
  mock.module('@/lib/services/portal-transition-email', {
    namedExports: {
      notifyPortalLive: async (_token: string | undefined, submissionId: string) => {
        notified.push(submissionId)
        return true
      },
    },
  })
  ;({ POST } = (await import(
    '@/app/api/admin/partnerships/clients/[clientId]/places/[attractionId]/publish/route'
  )) as unknown as { POST: Handler })
})

beforeEach(() => {
  placeApproved = true
  offersAct = false
  writes = []
  lived = []
  notified = []
})

function publish() {
  const req = new Request('http://cms/x', {
    method: 'POST',
    body: JSON.stringify({ approved: true }),
  }) as unknown as NextRequest
  return POST(req, { params: Promise.resolve({ clientId: CLIENT_ID, attractionId: POI }) })
}

test('BR-B2B-049 item 8 (#906): publishing a POI already in the app takes the submission live and sends the e-mail', async () => {
  const response = await publish()
  assert.equal(response.status, 200)
  // Idempotent: the real publication's stamp is kept, and the plan is not asked again.
  assert.deepEqual(writes, [])
  assert.deepEqual(lived, [POI])
  assert.deepEqual(notified, [SUB])
})

test('BR-B2B-049 item 8 (#906): a POI not yet published still needs the plan to offer the act', async () => {
  placeApproved = false
  const response = await publish()
  assert.equal(response.status, 409)
  assert.deepEqual(writes, [])
  assert.deepEqual(lived, [])
  assert.deepEqual(notified, [])

  offersAct = true
  assert.equal((await publish()).status, 200)
  assert.deepEqual(writes, [true])
  assert.deepEqual(lived, [POI])
  assert.deepEqual(notified, [SUB])
})
