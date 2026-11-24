/**
 * #1054 — the support cancels a place's paid plan from the CMS (BR-B2B-060, support edge case;
 * BR-B2B-019; BR-B2B-044). `support_cancel_quote` and `support_cancel` of `places-payment`, with the
 * database and Asaas faked: the gate (secret, JWT, admin), the quote the screen shows, both plans
 * (Experiência as `cancelRenewal`, the pre-portal plan as `cancelLegacy`), the second click, the
 * fee that moved, and an Asaas failure that alerts and keeps the cancel.
 *
 * Deno source loaded through a path built at run time (a static `.ts` import fails the repo's `tsc`).
 *
 * Run with: npm run test:api
 */

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const SHARED = resolve(import.meta.dirname, '../../supabase/functions/_shared')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Mod = any
let pay: Mod
let asaasMod: Mod

before(async () => {
  pay = await import(pathToFileURL(resolve(SHARED, 'places-payment.ts')).href)
  asaasMod = await import(pathToFileURL(resolve(SHARED, 'asaas.ts')).href)
})

const CLIENT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const PLACE = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'
const OPERATOR = 'cccccccc-dddd-4eee-8fff-000000000000'
const SUBMISSION = '99999999-8888-4777-8666-555555555555'
const SUB_UUID = '11111111-2222-4333-8444-555555555555'
const LEGACY_REF = `legacy:${CLIENT}`

// ─── harness ────────────────────────────────────────────────────────────────────────────────

type Call = { method: string; path: string; body: unknown }
type Route = (c: Call) => { status: number; body: unknown } | undefined

function fakeAsaas(routes: Route[]) {
  const calls: Call[] = []
  const fetch = async (url: string, init: RequestInit) => {
    const u = new URL(url)
    const call = { method: init.method ?? 'GET', path: u.pathname.replace(/^\/v3/, '') + u.search, body: init.body ? JSON.parse(String(init.body)) : undefined }
    calls.push(call)
    for (const r of routes) {
      const hit = r(call)
      if (hit) return new Response(JSON.stringify(hit.body), { status: hit.status })
    }
    return new Response(JSON.stringify({ errors: [{ code: 'not_found' }] }), { status: 404 })
  }
  return { client: asaasMod.asaasClient({ baseUrl: 'https://api-sandbox.asaas.com/v3', apiKey: 'k', fetch }), calls }
}
const at = (method: string, prefix: string, status: number, body: unknown): Route => (c) =>
  c.method === method && c.path.startsWith(prefix) ? { status, body } : undefined

type RpcCall = { schema: string; fn: string; args: Record<string, unknown> }
type Answer = { data?: unknown; error?: { code?: string; details?: string } | null }

function fakeDb(answers: Record<string, Answer>) {
  const calls: RpcCall[] = []
  const rpc = async (schema: string, fn: string, args: Record<string, unknown>) => {
    calls.push({ schema, fn, args })
    const a = answers[fn] ?? { data: null }
    return { data: a.data ?? null, error: a.error ?? null }
  }
  return { rpc, calls }
}

function deps(asaas: ReturnType<typeof fakeAsaas>, db: ReturnType<typeof fakeDb>, extra: Record<string, unknown> = {}) {
  const alerts: { what: string; fields: Record<string, unknown> }[] = []
  const mails: { to: string; subject: string; text: string }[] = []
  const d = {
    asaas: asaas.client,
    admin: db.rpc,
    operatorId: OPERATOR,
    ownerEmail: async () => 'ze@example.com',
    subscriptionIds: async () => ({
      subscription_id: SUB_UUID,
      status: 'paid',
      payment_method: 'credit_card',
      provider_subscription_id: 'sub_1',
      provider_customer_id: 'cus_1',
      provider_authorization_id: null,
      canceled_at: null,
      early_termination_fee_cents: 0,
      early_termination_paid_at: null,
    }),
    alert: async (what: string, fields: Record<string, unknown>) => {
      alerts.push({ what, fields })
    },
    today: () => '2026-10-29',
    now: () => new Date('2026-10-29T12:00:00Z'),
    sendEmail: async (to: string, subject: string, text: string) => {
      mails.push({ to, subject, text })
      return true
    },
    ...extra,
  }
  return { d, alerts, mails }
}

const PAID_THROUGH = '2026-11-20T15:00:00Z'
const experienceActive = { plan: 'experience', state: 'active', submission_id: SUBMISSION, subscription_id: SUB_UUID, story_until: PAID_THROUGH, early_termination_fee_cents: 0 }
const legacyActive = { plan: 'legacy', state: 'active', submission_id: SUBMISSION, subscription_id: null, story_until: PAID_THROUGH, early_termination_fee_cents: 0 }
const applied = (r: Record<string, unknown>, outcome = 'applied') => {
  const { state: _state, ...rest } = r
  void _state
  return { ...rest, outcome, feedback_id: outcome === 'applied' ? 'f1' : null }
}
const body = (extra: Record<string, unknown> = {}) => ({ client_id: CLIENT, attraction_id: PLACE, expected_fee_cents: 0, ...extra })

// Card subscription ended at the commitment: PUT endDate, then the pending charges after it.
const cardRoutes = () => [at('PUT', '/subscriptions/sub_1', 200, {}), at('GET', '/payments?subscription=sub_1', 200, { data: [] }), at('GET', '/subscriptions/sub_1/payments', 200, { data: [] })]
const legacyRoutes = () => [
  at('GET', `/subscriptions?externalReference=${encodeURIComponent(LEGACY_REF)}`, 200, { data: [{ id: 'sub_legacy', status: 'ACTIVE', value: 100, externalReference: LEGACY_REF, deleted: false }] }),
  at('DELETE', '/subscriptions/sub_legacy', 200, { deleted: true }),
]

// ─── the gate ───────────────────────────────────────────────────────────────────────────────

test('#1054: the gate — no CMS secret 401, bad token 401, a non admin (editor, viewer, client, machine key) 403, an admin passes with the token id', () => {
  const g = pay.supportOperator
  assert.deepEqual(g(false, { valid: true, userId: OPERATOR, role: 'admin' }), { status: 401, body: { error: 'unauthorized' } })
  assert.deepEqual(g(true, { valid: false }), { status: 401, body: { error: 'relogin' } })
  for (const role of ['editor', 'viewer', 'client', undefined, 'service_role', 'super_admin']) {
    assert.deepEqual(g(true, { valid: true, userId: OPERATOR, role }), { status: 403, body: { error: 'forbidden' } }, String(role))
  }
  assert.deepEqual(g(true, { valid: true, userId: '00000000-0000-0000-0000-000000000000x', role: 'admin' }), { status: 403, body: { error: 'forbidden' } })
  assert.equal(g(true, { valid: true, userId: OPERATOR, role: 'admin' }), OPERATOR)
})

// ─── the quote ──────────────────────────────────────────────────────────────────────────────

test('#1054 BR-B2B-046 item 8: support_cancel_quote reads partner.support_place_plans and writes nothing', async () => {
  const db = fakeDb({ support_place_plans: { data: [{ ...experienceActive, early_termination_fee_cents: 4500 }] } })
  const asaas = fakeAsaas([])
  const { d } = deps(asaas, db)
  const r = await pay.supportCancelQuote(d, body())
  assert.deepEqual(r, {
    status: 200,
    body: { plans: [{ plan: 'experience', state: 'active', ends_on: '2026-11-20', fee_cents: 4500, charge_on: '2026-11-20' }], fee_cents: 4500 },
  })
  assert.deepEqual(db.calls, [{ schema: 'partner', fn: 'support_place_plans', args: { p_client_id: CLIENT, p_attraction_id: PLACE } }])
  assert.equal(asaas.calls.length, 0)
})

test('#1054: the quote of a legacy plan with no month left leaves today (ends_on null); no plan = empty list; bad ids 400; not the client\'s place 404', async () => {
  const today = fakeDb({ support_place_plans: { data: [{ ...legacyActive, story_until: '2026-10-29T12:00:00Z' }] } })
  assert.deepEqual((await pay.supportCancelQuote(deps(fakeAsaas([]), today).d, body())).body.plans, [
    { plan: 'legacy', state: 'active', ends_on: null, fee_cents: 0, charge_on: null },
  ])
  assert.deepEqual((await pay.supportCancelQuote(deps(fakeAsaas([]), fakeDb({ support_place_plans: { data: [] } })).d, body())).body, { plans: [], fee_cents: 0 })
  assert.equal((await pay.supportCancelQuote(deps(fakeAsaas([]), fakeDb({})).d, body({ client_id: 'x' }))).status, 400)
  const notHis = fakeDb({ support_place_plans: { error: { code: 'TGP01' } } })
  assert.equal((await pay.supportCancelQuote(deps(fakeAsaas([]), notHis).d, body())).status, 404)
})

// ─── the cancel ─────────────────────────────────────────────────────────────────────────────

test('#1054 BR-B2B-060 (support): Experiência — the database with the token operator, then Asaas as cancelRenewal (endDate at the commitment), the confirmation e-mail with the date', async () => {
  const db = fakeDb({ support_place_plans: { data: [experienceActive] }, support_cancel_place_plan: { data: [applied(experienceActive)] } })
  const asaas = fakeAsaas(cardRoutes())
  const { d, alerts, mails } = deps(asaas, db)
  const r = await pay.supportCancel(d, body({ operator_id: '00000000-0000-4000-8000-000000000000' }))
  assert.deepEqual(r, {
    status: 200,
    body: { result: 'canceled', plans: [{ plan: 'experience', ends_on: '2026-11-20', fee_cents: 0, charge_on: null, outcome: 'applied' }], provider: 'ok' },
  })
  // the operator is the token's, never the body's
  assert.deepEqual(db.calls[1], { schema: 'partner', fn: 'support_cancel_place_plan', args: { p_client_id: CLIENT, p_attraction_id: PLACE, p_operator_id: OPERATOR } })
  const put = asaas.calls.find((c) => c.method === 'PUT')
  assert.deepEqual(put?.body, { endDate: '2026-11-19' })
  assert.equal(alerts.length, 0)
  assert.equal(mails.length, 1)
  assert.equal(mails[0].to, 'ze@example.com')
  assert.equal(mails[0].subject, 'Seu plano Experiência foi cancelado')
  assert.match(mails[0].text, /continuam no ar até 20\/11\/2026/)
  // no survey here: nothing goes to record_place_cancellation_feedback (the database recorded origin support)
  assert.equal(db.calls.some((c) => c.fn === 'record_place_cancellation_feedback'), false)
})

test('#1054 BR-B2B-044: the pre-portal plan — DELETE of legacy:<client> at Asaas, the e-mail with the database date (story_until), not the one Asaas would suggest', async () => {
  const db = fakeDb({ support_place_plans: { data: [legacyActive] }, support_cancel_place_plan: { data: [applied(legacyActive)] } })
  const asaas = fakeAsaas(legacyRoutes())
  const { d, alerts, mails } = deps(asaas, db)
  const r = await pay.supportCancel(d, body())
  assert.equal(r.status, 200)
  assert.equal(r.body.result, 'canceled')
  assert.equal(r.body.provider, 'ok')
  assert.deepEqual(asaas.calls.filter((c) => c.method === 'DELETE').map((c) => c.path), ['/subscriptions/sub_legacy'])
  // the payments of the legacy subscription are never read: the date is the database's
  assert.equal(asaas.calls.some((c) => c.path.startsWith('/payments')), false)
  assert.equal(alerts.length, 0)
  assert.equal(mails[0].subject, 'Seu plano mensal no Tuggi foi cancelado')
  assert.match(mails[0].text, /Seu plano termina em 20\/11\/2026/)
})

test('#1054: second click — already_canceled, the idempotent Asaas half again, no e-mail, no alert', async () => {
  const db = fakeDb({
    support_place_plans: { data: [{ ...experienceActive, state: 'canceled' }, { ...legacyActive, state: 'canceled' }] },
    support_cancel_place_plan: { data: [applied(experienceActive, 'already_canceled'), applied(legacyActive, 'already_canceled')] },
  })
  const asaas = fakeAsaas([...cardRoutes(), at('GET', `/subscriptions?externalReference=${encodeURIComponent(LEGACY_REF)}`, 200, { data: [] })])
  const sub = { subscription_id: SUB_UUID, status: 'paid', payment_method: 'credit_card', provider_subscription_id: 'sub_1', canceled_at: null, early_termination_fee_cents: 0, early_termination_paid_at: null }
  const { d, alerts, mails } = deps(asaas, db, { subscriptionIds: async () => sub })
  const r = await pay.supportCancel(d, body())
  assert.equal(r.status, 200)
  assert.equal(r.body.result, 'already_canceled')
  assert.deepEqual(r.body.plans.map((p: { outcome: string }) => p.outcome), ['already_canceled', 'already_canceled'])
  assert.equal(mails.length, 0)
  // no live legacy subscription on a repeat is not an alert (nothing proves a paying client now)
  assert.equal(alerts.length, 0)
})

test('#1054: a fee different from the one shown is refused with 409 quote_changed, before anything is written', async () => {
  const db = fakeDb({ support_place_plans: { data: [{ ...experienceActive, early_termination_fee_cents: 4500 }] } })
  const asaas = fakeAsaas([])
  const { d, mails } = deps(asaas, db)
  assert.deepEqual(await pay.supportCancel(d, body({ expected_fee_cents: 0 })), { status: 409, body: { error: 'quote_changed' } })
  assert.deepEqual(db.calls.map((c) => c.fn), ['support_place_plans'])
  assert.equal(asaas.calls.length + mails.length, 0)
  // and the fee is required: the screen always sends the one it showed
  assert.deepEqual(await pay.supportCancel(d, { client_id: CLIENT, attraction_id: PLACE }), { status: 400, body: { error: 'invalid', field: 'expected_fee_cents' } })
})

test('#1054: Asaas fails — the cancel stands (no undo), the operator is alerted, the answer says provider failed', async () => {
  for (const [rows, routes] of [
    [[experienceActive], [at('PUT', '/subscriptions/sub_1', 503, {})]],
    [[legacyActive], [at('GET', `/subscriptions?externalReference=${encodeURIComponent(LEGACY_REF)}`, 503, {})]],
  ] as const) {
    const db = fakeDb({ support_place_plans: { data: rows }, support_cancel_place_plan: { data: rows.map((x) => applied(x)) } })
    const { d, alerts, mails } = deps(fakeAsaas([...routes]), db)
    const r = await pay.supportCancel(d, body())
    assert.equal(r.status, 200)
    assert.equal(r.body.result, 'canceled')
    assert.equal(r.body.provider, 'failed')
    assert.ok(alerts.some((a) => ['cancel_end_date_failed', 'legacy_subscription_end_failed'].includes(a.what)), JSON.stringify(alerts))
    assert.deepEqual(db.calls.map((c) => c.fn), ['support_place_plans', 'support_cancel_place_plan'], 'nothing undone')
    assert.equal(mails.length, 1, 'the partner still gets the confirmation')
  }
})

test('#1054: database refusals map as the portal ones (operator not admin 422, no paid plan 409, not the client\'s place 404) and touch nothing at Asaas', async () => {
  for (const [error, status] of [
    [{ code: 'TGP22', details: 'p_operator_id' }, 422],
    [{ code: 'TGP10', details: 'no_paid_plan' }, 409],
    [{ code: 'TGP01' }, 404],
  ] as const) {
    const db = fakeDb({ support_place_plans: { data: [experienceActive] }, support_cancel_place_plan: { error } })
    const asaas = fakeAsaas([])
    const { d, mails } = deps(asaas, db)
    const r = await pay.supportCancel(d, body())
    assert.equal(r.status, status)
    assert.equal(asaas.calls.length + mails.length, 0)
  }
})

test('#1054: an unexpected database error alerts and answers 502', async () => {
  const db = fakeDb({ support_place_plans: { data: [experienceActive] }, support_cancel_place_plan: { error: { code: '57014' } } })
  const { d, alerts } = deps(fakeAsaas([]), db)
  assert.deepEqual(await pay.supportCancel(d, body()), { status: 502, body: { error: 'unavailable' } })
  assert.deepEqual(alerts.map((a) => a.what), ['support_cancel_failed'])
})

test('#1054: a free-month cancel by the support ends the Asaas subscription as the portal does (DELETE), with the date of the end of the free month', async () => {
  const freeMonth = { ...experienceActive, story_until: '2026-11-15T03:00:00Z' }
  const db = fakeDb({ support_place_plans: { data: [freeMonth] }, support_cancel_place_plan: { data: [applied(freeMonth)] } })
  const asaas = fakeAsaas([at('DELETE', '/subscriptions/sub_1', 200, { deleted: true })])
  const pending = { subscription_id: SUB_UUID, status: 'pending_payment', payment_method: 'credit_card', provider_subscription_id: 'sub_1', canceled_at: null, early_termination_fee_cents: null, early_termination_paid_at: null }
  const { d, alerts, mails } = deps(asaas, db, { subscriptionIds: async () => pending })
  const r = await pay.supportCancel(d, body())
  assert.equal(r.body.provider, 'ok')
  assert.deepEqual(asaas.calls.map((c) => `${c.method} ${c.path}`), ['DELETE /subscriptions/sub_1'])
  assert.equal(alerts.length, 0)
  assert.match(mails[0].text, /continuam no ar até 15\/11\/2026/)
})

test('#1054: no e-mail for the owner alerts the operator and the cancel still answers', async () => {
  const db = fakeDb({ support_place_plans: { data: [experienceActive] }, support_cancel_place_plan: { data: [applied(experienceActive)] } })
  const { d, alerts, mails } = deps(fakeAsaas(cardRoutes()), db, { ownerEmail: async () => null })
  const r = await pay.supportCancel(d, body())
  assert.equal(r.body.result, 'canceled')
  assert.equal(mails.length, 0)
  assert.deepEqual(alerts.map((a) => a.what), ['support_cancel_no_email'])
})
