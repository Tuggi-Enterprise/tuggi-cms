/**
 * #871 — what `GET /api/admin/clients/[clientId]/contract` tells the client record about where
 * the registration came from, the portal acceptance and the Asaas subscription.
 *
 * The route runs for real; the gate, the service client and the two services that are not the
 * subject (`getLiveContract`, `getClientConference`) are stand-ins. What these tests pin is what
 * LEAVES the server: the CPF only as a mask (BR-B2B-043 item 1), never IP / user agent / session,
 * the acceptance with version, hash and date (BR-B2B-047), the subscription with plan, period,
 * amount, status, next due date and `externalReference` (BR-B2B-046).
 *
 * Run with: npm run test:api
 */

import { before, beforeEach, test, mock } from 'node:test'
import assert from 'node:assert/strict'
import type { NextRequest } from 'next/server'

type Rows = Record<string, unknown[]>
let rows: Rows = {}
let failing: Set<string> = new Set()

function builder(key: string) {
  let single = false
  const self: Record<string, unknown> = {}
  for (const name of ['select', 'eq', 'neq', 'order', 'limit', 'or', 'in']) self[name] = () => self
  const result = () => {
    if (failing.has(key)) return { data: null, error: { code: 'XX000', message: 'boom' } }
    const data = rows[key] ?? []
    return { data: single ? (data[0] ?? null) : data, error: null }
  }
  self.maybeSingle = () => {
    single = true
    return Promise.resolve(result())
  }
  self.then = (resolve: (value: unknown) => unknown) => resolve(result())
  return self
}

const fakeService = {
  schema: (schema: string) => ({ from: (table: string) => builder(`${schema}.${table}`) }),
  from: (table: string) => builder(table),
}

const CLIENT_ID = '00000000-0000-4000-8000-000000000871'
const SUBMISSION_ID = '00000000-0000-4000-8000-0000000008a1'
const ACCEPTANCE_ID = 'acc-871'
const SUBSCRIPTION_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

let GET: (req: NextRequest, ctx: { params: Promise<{ clientId: string }> }) => Promise<Response>

before(async () => {
  mock.module('@/lib/auth-middleware', {
    namedExports: {
      withAuth: (_options: unknown, handler: unknown) => handler,
      withRateLimit: () => (handler: unknown) => handler,
    },
  })
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseService: () => fakeService,
      getSupabase: () => fakeService,
      getSupabaseRouteHandler: () => fakeService,
      getSupabaseClient: () => ({}),
    },
  })
  mock.module('@/lib/services/partner-contract-service', {
    namedExports: {
      getLiveContract: async () => ({ contract: null, acceptance: null }),
      createContract: async () => ({}),
      sendForSignature: async () => ({}),
      supersedeContract: async () => ({}),
      verifyStoredDocument: async () => ({}),
      SIGNING_TTL_DAYS: 7,
    },
  })
  mock.module('@/lib/services/client-conference-service', {
    namedExports: {
      getClientConference: async () => ({ conference: { documentsSeen: [] } }),
    },
  })
  mock.module('@/lib/services/transactional-email', {
    namedExports: { sendTransactionalEmail: async () => ({}) },
  })
  ;({ GET } = (await import('@/app/api/admin/clients/[clientId]/contract/route')) as unknown as {
    GET: typeof GET
  })
})

const CLIENT_ROW = {
  id: CLIENT_ID,
  name: 'Bar do Zé',
  company_name: 'Bar do Zé Ltda',
  email: 'ze@bardoze.com.br',
  billing_email: null,
  monthly_fee_cents: null,
  is_courtesy: false,
  commission_rate: 0.1,
}

const ACCEPTANCE_ROW = {
  id: ACCEPTANCE_ID,
  submission_id: SUBMISSION_ID,
  terms_version: '2026-10',
  terms_sha256: 'abcdef0123456789abcdef0123456789',
  accepted_at: '2026-10-03T11:59:00Z',
  auth_method: 'otp',
  email: 'ze@bardoze.com.br',
  signer_cpf: '52998224725',
  signer_name: 'Zé da Silva',
  signer_role: 'Sócio',
  legal_status_declared: true,
  activation_commitment: { sticker: true },
  marketing_consent: false,
  plan_choice: 'map_and_description',
  billing_period: 3,
  voucher_code: null,
  voucher_discount_cents: null,
  total_cents: 29700,
  // Columns the route must never select — if a future change `select('*')`s them, they leak.
  ip: '203.0.113.9',
  user_agent: 'Mozilla/5.0 (secret)',
  session_id: 'sess-1',
  session_ip: '203.0.113.10',
}

const SUBSCRIPTION_ROW = {
  id: SUBSCRIPTION_ID,
  acceptance_id: ACCEPTANCE_ID,
  status: 'paid',
  paid_at: '2026-10-04T10:00:00Z',
  refunded_at: null,
  payment_method: 'card',
  paid_through: '2027-01-04',
  canceled_at: null,
  renewal_amount_cents: 29700,
  provider_subscription_id: 'sub_123',
  created_at: '2026-10-03T12:00:00Z',
}

function portalRows() {
  rows['core.attractions'] = [{ id: 'attr-1' }]
  rows['partner.place_submissions'] = [
    {
      id: SUBMISSION_ID,
      status: 'approved',
      attraction_id: 'attr-1',
      submitted_at: '2026-10-03T12:00:00Z',
      representative_cpf: '52998224725',
    },
  ]
  rows['partner.place_acceptances'] = [ACCEPTANCE_ROW]
  rows['partner.place_subscriptions'] = [SUBSCRIPTION_ROW]
}

beforeEach(() => {
  rows = { 'partner.clients': [CLIENT_ROW] }
  failing = new Set()
})

async function call() {
  const req = { nextUrl: new URL(`http://localhost/api/admin/clients/${CLIENT_ID}/contract`) } as NextRequest
  const res = await GET(req, { params: Promise.resolve({ clientId: CLIENT_ID }) })
  return { status: res.status, body: (await res.json()) as Record<string, any> }
}

test('#871 BR-B2B-047: a portal client answers origin "portal" with the acceptance (version, hash, date)', async () => {
  portalRows()
  const { status, body } = await call()
  assert.equal(status, 200)
  assert.equal(body.origin, 'portal')
  assert.equal(body.portal.length, 1)
  const acceptance = body.portal[0].acceptance
  assert.equal(acceptance.termsVersion, '2026-10')
  assert.equal(acceptance.termsHash, ACCEPTANCE_ROW.terms_sha256)
  assert.equal(acceptance.acceptedAt, '2026-10-03T11:59:00Z')
  assert.equal(acceptance.signerName, 'Zé da Silva')
  assert.equal(acceptance.signerRole, 'Sócio')
})

test('#871 BR-B2B-043 item 1: the CPF leaves only masked, and no IP / user agent / session leaves at all', async () => {
  portalRows()
  const { body } = await call()
  assert.equal(body.portal[0].acceptance.signerCpfMasked, '•••.•••.247-••')
  const wire = JSON.stringify(body)
  assert.ok(!wire.includes('52998224725'), 'whole CPF digits')
  assert.ok(!wire.includes('529.982.247-25'), 'formatted CPF')
  assert.ok(!wire.includes('203.0.113'), 'IP')
  assert.ok(!wire.includes('Mozilla'), 'user agent')
  assert.ok(!wire.includes('sess-1'), 'session')
  for (const key of ['ip', 'user_agent', 'userAgent', 'session_id', 'sessionId', 'session_ip', 'signer_cpf', 'signerCpf']) {
    assert.ok(!wire.includes(`"${key}":`), `no "${key}" key on the wire`)
  }
})

test('#871 BR-B2B-046: the subscription carries plan, period, amount, status, next due date and externalReference', async () => {
  portalRows()
  const { body } = await call()
  const { acceptance, payment } = body.portal[0]
  assert.equal(acceptance.planChoice, 'map_and_description')
  assert.equal(acceptance.billingPeriod, 3)
  assert.equal(acceptance.totalCents, 29700)
  assert.equal(payment.status, 'paid')
  assert.equal(payment.paidAt, '2026-10-04T10:00:00Z')
  assert.equal(payment.paidThrough, '2027-01-04')
  assert.equal(payment.renewalAmountCents, 29700)
  assert.equal(payment.providerSubscriptionId, 'sub_123')
  assert.equal(payment.externalReference, `com_historia_3m:${SUBSCRIPTION_ID}`)
})

test('#871 BR-B2B-046: a cancelled renewal still shows the paid-through date, with canceledAt', async () => {
  portalRows()
  rows['partner.place_subscriptions'] = [{ ...SUBSCRIPTION_ROW, canceled_at: '2026-11-01T00:00:00Z' }]
  const { body } = await call()
  assert.equal(body.portal[0].payment.canceledAt, '2026-11-01T00:00:00Z')
  assert.equal(body.portal[0].payment.paidThrough, '2027-01-04')
})

test('#871: a draft submission is not shown, and a client with only drafts is not "portal"', async () => {
  portalRows()
  ;(rows['partner.place_submissions'] as { status: string }[])[0].status = 'draft'
  const { body } = await call()
  assert.deepEqual(body.portal, [])
  assert.notEqual(body.origin, 'portal')
})

test('#871: a client that never came through the portal is "direct" with portal [] (the old case)', async () => {
  const { status, body } = await call()
  assert.equal(status, 200)
  assert.equal(body.origin, 'direct')
  assert.deepEqual(body.portal, [])
})

test('#871: a client promoted from a proposal is "proposal"', async () => {
  rows['partner.partner_form_submissions'] = [{ answers: { plan_choice: 'map_only' } }]
  const { body } = await call()
  assert.equal(body.origin, 'proposal')
  assert.deepEqual(body.portal, [])
})

test('#871: a failed portal read answers origin "unknown" and portal null — never "direct"', async () => {
  failing.add('core.attractions')
  const { status, body } = await call()
  assert.equal(status, 200)
  assert.equal(body.origin, 'unknown')
  assert.equal(body.portal, null)
})

test('#871: a failed subscription read also answers "unknown", not a portal client without payment', async () => {
  portalRows()
  failing.add('partner.place_subscriptions')
  const { body } = await call()
  assert.equal(body.origin, 'unknown')
  assert.equal(body.portal, null)
})

test('#871: the route does not select the acceptance columns that carry IP, user agent or session', async () => {
  const { readFileSync } = await import('node:fs')
  const { resolve } = await import('node:path')
  const source = readFileSync(resolve(import.meta.dirname, '../../lib/services/portal-submission-review-service.ts'), 'utf8')
  const columns = source.slice(source.indexOf('const ACCEPTANCE_COLUMNS'), source.indexOf('interface AcceptanceRow'))
  assert.doesNotMatch(columns, /\bip\b|user_agent|session_id|session_ip/)
})

test('#871: an unknown client is 404 and discloses no portal data', async () => {
  rows = {}
  const { status, body } = await call()
  assert.equal(status, 404)
  assert.equal(body.portal, undefined)
})
