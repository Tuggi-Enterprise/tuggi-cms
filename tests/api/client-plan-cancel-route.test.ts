/**
 * #1054 — the CMS route of "Cancelar plano" (BR-B2B-060, support edge case):
 * `app/api/admin/clients/[clientId]/plan-cancel`. Admin only (403 for everyone else, before any
 * call); it forwards the admin's own access token and `CMS_JOB_SECRET` to `places-payment`, never
 * an operator id of its own; the function's answer passes through. Plus the pure `placePlanOf`
 * that decides when the Locais tab offers the button.
 *
 * Run with: npm run test:api
 */

import { test, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import type { NextRequest } from 'next/server'

const CLIENT = 'aaaaaaaa-2222-4333-8444-555555555555'
const PLACE = 'bbbbbbbb-2222-4333-8444-555555555555'
const OPERATOR_UID = 'cccccccc-2222-4333-8444-555555555555'

let role: string
let session: { access_token: string } | null
let fetched: { url: string; init: RequestInit }[]
let answer: { status: number; body: unknown }
let audits: Record<string, unknown>[]

function client() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = {
    auth: {
      getUser: async () => ({ data: { user: { id: OPERATOR_UID, email: 'admin@tuggi.app' } }, error: null }),
      getSession: async () => ({ data: { session }, error: null }),
    },
    schema: () => ({
      from: () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { id: 'cms-1', email: 'admin@tuggi.app', role, is_active: true }, error: null }) }
        return q
      },
    }),
  }
  return c
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let route: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let plan: any

before(async () => {
  mock.module('next/headers', { namedExports: { cookies: async () => ({ get: () => undefined, getAll: () => [] }) } })
  mock.module('@/lib/core/supabase-client', {
    namedExports: { getSupabaseRouteHandler: () => client(), getSupabaseService: () => client(), getSupabase: () => client() },
  })
  mock.module('@/lib/services/audit-service', {
    namedExports: {
      logAuditEvent: async (e: Record<string, unknown>) => {
        audits.push(e)
        return true
      },
    },
  })
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co'
  process.env.CMS_JOB_SECRET = 'job-secret'
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    fetched.push({ url, init })
    return new Response(JSON.stringify(answer.body), { status: answer.status })
  }) as typeof fetch
  route = await import('@/app/api/admin/clients/[clientId]/plan-cancel/route')
  plan = await import('@/lib/partnerships/place-plan')
})

beforeEach(() => {
  role = 'admin'
  session = { access_token: 'operator-jwt' }
  fetched = []
  audits = []
  answer = { status: 200, body: { plans: [], fee_cents: 0 } }
})

const ctx = (clientId = CLIENT) => ({ params: Promise.resolve({ clientId }) })
const get = (attractionId = PLACE) => {
  const url = `http://localhost/api/admin/clients/${CLIENT}/plan-cancel?attractionId=${attractionId}`
  const req = new Request(url) as unknown as NextRequest & { nextUrl: URL }
  Object.defineProperty(req, 'nextUrl', { value: new URL(url) })
  return req
}
const post = (body: unknown) =>
  new Request(`http://localhost/api/admin/clients/${CLIENT}/plan-cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 250)}` },
    body: JSON.stringify(body),
  }) as unknown as NextRequest

test('#1054 BR-B2B-060: only an admin reaches the quote and the cancel (403), and nothing is called before the gate', async () => {
  for (const r of ['editor', 'viewer', 'client']) {
    role = r
    assert.equal((await route.GET(get(), ctx())).status, 403, r)
    assert.equal((await route.POST(post({ attractionId: PLACE, expectedFeeCents: 0 }), ctx())).status, 403, r)
  }
  assert.equal(fetched.length, 0)
})

test('#1054: the quote goes to places-payment with the CMS secret and the admin token; the answer passes through', async () => {
  answer = { status: 200, body: { plans: [{ plan: 'experience', state: 'active', ends_on: '2026-11-20', fee_cents: 0, charge_on: null }], fee_cents: 0 } }
  const r = await route.GET(get(), ctx())
  assert.equal(r.status, 200)
  assert.deepEqual(await r.json(), answer.body)
  assert.equal(fetched[0].url, 'https://project.supabase.co/functions/v1/places-payment')
  const h = fetched[0].init.headers as Record<string, string>
  assert.equal(h['x-cms-job-secret'], 'job-secret')
  assert.equal(h.Authorization, 'Bearer operator-jwt')
  assert.deepEqual(JSON.parse(String(fetched[0].init.body)), { action: 'support_cancel_quote', client_id: CLIENT, attraction_id: PLACE })
})

test('#1054: the cancel sends the fee shown and never an operator id; a 200 is audited; a refusal passes through without audit', async () => {
  answer = { status: 200, body: { result: 'canceled', plans: [], provider: 'ok' } }
  const r = await route.POST(post({ attractionId: PLACE, expectedFeeCents: 4500, operatorId: 'someone-else' }), ctx())
  assert.equal(r.status, 200)
  assert.deepEqual(JSON.parse(String(fetched[0].init.body)), { action: 'support_cancel', client_id: CLIENT, attraction_id: PLACE, expected_fee_cents: 4500 })
  assert.equal(audits.length, 1)
  assert.equal(audits[0].action, 'SUPPORT_CANCEL_PLACE_PLAN')
  assert.equal(audits[0].userId, OPERATOR_UID)

  answer = { status: 409, body: { error: 'quote_changed' } }
  const refused = await route.POST(post({ attractionId: PLACE, expectedFeeCents: 0 }), ctx())
  assert.equal(refused.status, 409)
  assert.deepEqual(await refused.json(), { error: 'quote_changed' })
  assert.equal(audits.length, 1)
})

test('#1054: bad input is 400 before the function; no session token is 401', async () => {
  assert.equal((await route.GET(get('x'), ctx())).status, 400)
  assert.equal((await route.GET(get(), ctx('1; drop'))).status, 400)
  assert.equal((await route.POST(post({ attractionId: PLACE }), ctx())).status, 400)
  assert.equal((await route.POST(post({ attractionId: PLACE, expectedFeeCents: -1 }), ctx())).status, 400)
  assert.equal((await route.POST(post({ attractionId: 'x', expectedFeeCents: 0 }), ctx())).status, 400)
  session = null
  assert.equal((await route.GET(get(), ctx())).status, 401)
  assert.equal(fetched.length, 0)
})

// ─── placePlanOf: when the tab offers the button ───────────────────────────────────────────

const record = (payment: Record<string, unknown> | null, planChoice = 'map_and_description', attractionId = PLACE) => ({
  submissionId: 's1',
  status: 'live',
  attractionId,
  submittedAt: null,
  acceptance: { planChoice },
  payment: payment && { status: 'paid', paidAt: '2026-09-01', canceledAt: null, paidThrough: '2026-11-20T15:00:00Z', renewalAmountCents: 9900, providerSubscriptionId: 'sub_1', ...payment },
})
const NOW = new Date('2026-10-29T12:00:00Z')

test('#1054 spec §9.2: Experiência active offers the button; cancelled shows the date; Presença and a free place show nothing', () => {
  const p = plan.placePlanOf
  assert.deepEqual(p(PLACE, null, [record({})], NOW), { plan: 'experience', state: 'active', monthlyCents: 9900 })
  assert.deepEqual(p(PLACE, null, [record({ status: 'past_due' })], NOW), { plan: 'experience', state: 'active', monthlyCents: 9900 })
  assert.deepEqual(p(PLACE, null, [record({ canceledAt: '2026-10-29' })], NOW), { plan: 'experience', state: 'canceled', storyUntil: '2026-11-20T15:00:00Z' })
  assert.equal(p(PLACE, null, [record({}, 'map_only')], NOW), null)
  assert.equal(p(PLACE, null, [record({}, 'map_and_description', 'other')], NOW), null)
  assert.equal(p(PLACE, null, [record({ status: 'expired' })], NOW), null)
  assert.equal(p(PLACE, { monthly_fee_cents: 0, is_courtesy: false, legacy_plans: [] }, [], NOW), null)
})

test('#1054 BR-B2B-044: the pre-portal plan — paying with no mirror or a running one offers it; courtesy never; ended shows the date while the story is up, then nothing', () => {
  const p = plan.placePlanOf
  assert.deepEqual(p(PLACE, { monthly_fee_cents: 10000, is_courtesy: false, legacy_plans: [] }, [], NOW), { plan: 'legacy', state: 'active', monthlyCents: 10000 })
  assert.deepEqual(
    p(PLACE, { monthly_fee_cents: 10000, is_courtesy: false, legacy_plans: [{ attraction_id: PLACE, fee_ended_at: null, story_until: null }] }, [], NOW),
    { plan: 'legacy', state: 'active', monthlyCents: 10000 }
  )
  assert.equal(p(PLACE, { monthly_fee_cents: 10000, is_courtesy: true, legacy_plans: [] }, [], NOW), null)
  const ended = { attraction_id: PLACE, fee_ended_at: '2026-10-29T10:00:00Z', story_until: '2026-11-20T03:00:00Z' }
  assert.deepEqual(p(PLACE, { monthly_fee_cents: 0, is_courtesy: false, legacy_plans: [ended] }, [], NOW), { plan: 'legacy', state: 'canceled', storyUntil: ended.story_until })
  assert.equal(p(PLACE, { monthly_fee_cents: 0, is_courtesy: false, legacy_plans: [{ ...ended, story_until: '2026-10-01T03:00:00Z' }] }, [], NOW), null)
  assert.equal(plan.formatCalendarDay('2026-11-20'), '20/11/2026')
})
