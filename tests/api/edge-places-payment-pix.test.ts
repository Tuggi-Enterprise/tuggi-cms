/**
 * #811 — Pix Automático (journey 3) of the Com história plan, against `docs/contracts/places-pagamento.md`
 * (workspace) §3.1–§3.3 and the term `locais-2026-10-v2` 4.1/4.6. Same harness as
 * `edge-places-payment.test.ts`: the real Asaas client, `fetch` mocked, Deno source loaded through a
 * path built at run time (a static `.ts` import fails the repo's `tsc`).
 *
 * Run with: npm run test:api
 */

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const SHARED = resolve(import.meta.dirname, '../../supabase/functions/_shared')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Payment = any
type Asaas = typeof import('../../supabase/functions/_shared/asaas')
let pay: Payment
let asaasMod: Asaas

before(async () => {
  pay = await import(pathToFileURL(resolve(SHARED, 'places-payment.ts')).href)
  asaasMod = await import(pathToFileURL(resolve(SHARED, 'asaas.ts')).href)
})

const SUB_UUID = '11111111-2222-4333-8444-555555555555'
const CONTRACT = '11111111222243338444555555555555'
const SUBMISSION = '99999999-8888-4777-8666-555555555555'
const REF = `com_historia_3m:${SUB_UUID}`
const TOKEN = 'whk-token-123'
const AUTH = 'a33047b1-fb19-4b68-9373-a7ba8a8162aa'

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
const paths = (a: { calls: Call[] }) => a.calls.map((c) => `${c.method} ${c.path}`)

type RpcCall = { schema: string; fn: string; args: Record<string, unknown> }
function fakeDb(answers: Record<string, { data?: unknown; error?: { code?: string; details?: string } | null }>) {
  const calls: RpcCall[] = []
  const rpc = async (schema: 'partner' | 'core', fn: string, args: Record<string, unknown>) => {
    calls.push({ schema, fn, args })
    const a = answers[fn] ?? { data: null }
    return { data: a.data ?? null, error: a.error ?? null }
  }
  return { rpc, calls }
}

type Row = Record<string, unknown> | null
const row = (over: Record<string, unknown> = {}): Row => ({
  subscription_id: SUB_UUID, status: 'pending_payment', payment_method: null, provider_subscription_id: null,
  provider_customer_id: 'cus_1', provider_authorization_id: null, canceled_at: null, ...over,
})

function deps(asaas: ReturnType<typeof fakeAsaas>, db: ReturnType<typeof fakeDb>, sub: Row = null, extra: Record<string, unknown> = {}) {
  const alerts: { what: string; fields: Record<string, unknown> }[] = []
  const d = {
    asaas: asaas.client,
    admin: db.rpc,
    subscriptionIds: async () => sub,
    subscriptionById: async (id: string) => (sub && id === SUB_UUID ? sub : null),
    expiredLiveCards: async () => [],
    cancelsToRedo: async () => [],
    alert: async (what: string, fields: Record<string, unknown>) => {
      alerts.push({ what, fields })
    },
    today: () => '2026-10-04',
    now: () => new Date('2026-10-04T12:00:00Z'),
    user: fakeDb({ portal_get_subscription: { data: [{ submission_id: SUBMISSION, status: 'pending_payment', renews: false }] } }).rpc,
    userEmail: async () => 'ze@example.com',
    sendEmail: async () => true,
    accessLink: async () => 'owned' as const,
    ...extra,
  }
  return { d, alerts }
}

const checkoutRow = {
  subscription_id: SUB_UUID, status: 'pending_payment', attachable: true, external_reference: REF, billing_cycle: 'MONTHLY',
  billing_period: 3, next_amount_cents: 54000, renewal_amount_cents: 60000, next_due_date: '2026-10-04',
  customer_name: 'Bar do Zé LTDA', customer_tax_id: '12.345.678/0001-95', customer_email: 'ze@example.com',
}

// ─── pure ────────────────────────────────────────────────────────────────────────────────────

test('#811 Pix: contractId is the plan uuid without hyphens (≤ 35 chars) and maps back, nothing else does', () => {
  assert.equal(pay.contractIdOf(SUB_UUID), CONTRACT)
  assert.ok(CONTRACT.length <= 35)
  assert.equal(pay.subscriptionIdFromContractId(CONTRACT), SUB_UUID)
  assert.equal(pay.subscriptionIdFromContractId(CONTRACT.toUpperCase()), SUB_UUID)
  assert.equal(pay.subscriptionIdFromContractId(SUB_UUID), null)
  assert.equal(pay.subscriptionIdFromContractId('XXXYYYY1234'), null)
  assert.equal(pay.subscriptionIdFromContractId(null), null)
})

// ─── checkout (#898: Pix subscription, free first month) ──────────────────────────────────────

test('#898 BR-B2B-045 BR-B2B-046: checkout_pix creates a Pix subscription (not Pix Automático) whose first fee is due in 30 days, charges nothing now, attaches it with that date and sends the access link', async () => {
  const asaas = fakeAsaas([
    at('GET', '/subscriptions?', 200, { data: [] }),
    at('GET', '/customers?', 200, { data: [{ id: 'cus_1' }] }),
    at('PUT', '/customers/cus_1', 200, { id: 'cus_1' }),
    at('POST', '/subscriptions', 200, { id: 'sub_px', status: 'ACTIVE', value: 540 }),
  ])
  const db = fakeDb({ place_payment_checkout: { data: [checkoutRow] }, attach_place_subscription: { data: 'pending_payment' } })
  const links: string[] = []
  const { d } = deps(asaas, db, null, { accessLink: async (id: string) => (links.push(id), 'sent') })
  const r = await pay.checkoutPix(d, { submission_id: SUBMISSION })
  assert.deepEqual(r, { status: 200, body: { result: 'scheduled', first_charge_on: '2026-11-03' } })

  const body = asaas.calls.find((c) => c.method === 'POST' && c.path === '/subscriptions')!.body as Record<string, unknown>
  assert.equal(body.billingType, 'PIX')
  assert.equal(body.customer, 'cus_1')
  assert.equal(body.nextDueDate, '2026-11-03')
  assert.equal(body.cycle, 'MONTHLY')
  assert.equal(body.value, 540)
  assert.equal(body.externalReference, REF)
  // the payer pays each fee by hand: Asaas notifications on, so the QR reaches them
  assert.deepEqual(asaas.calls.find((c) => c.method === 'PUT' && c.path === '/customers/cus_1')!.body, { notificationDisabled: false })
  assert.ok(!paths(asaas).some((p) => p.includes('/pix/automatic') || p.startsWith('POST /payments')))

  assert.deepEqual(db.calls.map((c) => c.fn), ['place_payment_checkout', 'attach_place_subscription'])
  assert.deepEqual(db.calls[1].args, {
    p_subscription_id: SUB_UUID, p_payment_method: 'pix', p_provider_customer_id: 'cus_1',
    p_provider_subscription_id: 'sub_px', p_provider_authorization_id: null, p_first_charge_on: '2026-11-03',
  })
  assert.deepEqual(links, [SUBMISSION])
})

test('#811 Pix demand 4: checkout_pix of a submission that is not the caller\'s stops at the database', async () => {
  const asaas = fakeAsaas([])
  const db = fakeDb({})
  const { d } = deps(asaas, db, null, { user: fakeDb({ portal_get_subscription: { error: { code: 'TGP01' } } }).rpc })
  assert.equal((await pay.checkoutPix(d, { submission_id: SUBMISSION })).status, 404)
  assert.equal((await pay.checkoutPix(d, { submission_id: 'nope' })).status, 400)
  assert.equal(asaas.calls.length + db.calls.length, 0)
})

test('#898: an attach that fails deletes the subscription just created (it would charge in a month) and alerts', async () => {
  const asaas = fakeAsaas([
    at('GET', '/subscriptions?', 200, { data: [] }),
    at('GET', '/customers?', 200, { data: [{ id: 'cus_1' }] }),
    at('PUT', '/customers/cus_1', 200, { id: 'cus_1' }),
    at('POST', '/subscriptions', 200, { id: 'sub_px', status: 'ACTIVE', value: 540 }),
    at('GET', '/payments?subscription=sub_px', 200, { data: [{ id: 'pay_1', status: 'PENDING', value: 540, dueDate: '2026-11-03' }] }),
    at('DELETE', '/subscriptions/sub_px', 200, { deleted: true }),
  ])
  const db = fakeDb({ place_payment_checkout: { data: [checkoutRow] }, attach_place_subscription: { error: { code: 'PGRST202' } } })
  const { d, alerts } = deps(asaas, db)
  const r = await pay.checkoutPix(d, { submission_id: SUBMISSION })
  assert.equal(r.status, 502)
  assert.ok(paths(asaas).includes('DELETE /subscriptions/sub_px'))
  assert.ok(!paths(asaas).some((p) => p.includes('/refund')))
  assert.deepEqual(alerts.map((a) => a.what), ['subscription_discarded:attach_failed', 'attach_failed'])
})

test('#811 switching card → Pix: the unpaid live card subscription is deleted and cancelled before the Pix one is created', async () => {
  const asaas = fakeAsaas([
    at('GET', '/subscriptions?', 200, { data: [{ id: 'sub_card', status: 'ACTIVE' }] }),
    at('GET', '/payments?subscription=sub_card', 200, { data: [{ id: 'pay_c', status: 'PENDING', value: 540 }] }),
    at('DELETE', '/subscriptions/sub_card', 200, { deleted: true }),
    at('GET', '/customers?', 200, { data: [{ id: 'cus_1' }] }),
    at('PUT', '/customers/cus_1', 200, { id: 'cus_1' }),
    at('POST', '/subscriptions', 200, { id: 'sub_px', status: 'ACTIVE', value: 540 }),
  ])
  const db = fakeDb({ place_payment_checkout: { data: [checkoutRow] }, cancel_place_subscription: { data: [{ outcome: 'applied' }] }, attach_place_subscription: { data: 'pending_payment' } })
  const { d } = deps(asaas, db, row({ payment_method: 'credit_card', provider_subscription_id: 'sub_card' }))
  const r = await pay.checkoutPix(d, { submission_id: SUBMISSION })
  assert.equal(r.status, 200)
  const p = paths(asaas)
  assert.ok(p.indexOf('DELETE /subscriptions/sub_card') < p.indexOf('POST /subscriptions'))
  assert.deepEqual(db.calls.map((c) => c.fn), ['place_payment_checkout', 'cancel_place_subscription', 'attach_place_subscription'])
  assert.equal(db.calls[1].args.p_actor_kind, 'client')
})

// ─── webhook ─────────────────────────────────────────────────────────────────────────────────

const hook = (d: unknown, body: unknown) => pay.handleAsaasWebhook(d, TOKEN, TOKEN, body)
const pixFirst = { id: 'pay_px1', status: 'RECEIVED', value: 540, customer: 'cus_1', subscription: null, externalReference: null, billingType: 'PIX', paymentDate: '2026-10-04' }

test('#811 Pix: the first charge (no reference, nothing attached) is confirmed through the customer\'s reference', async () => {
  const asaas = fakeAsaas([
    at('GET', '/payments/pay_px1', 200, pixFirst),
    at('GET', '/customers/cus_1', 200, { id: 'cus_1', externalReference: SUB_UUID }),
  ])
  const db = fakeDb({ confirm_place_charge: { data: [{ outcome: 'applied' }] } })
  const { d } = deps(asaas, db, row())
  const r = await hook(d, { id: 'evt_p1', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_px1', externalReference: 'com_historia_1m:00000000-0000-4000-8000-000000000000' } })
  assert.deepEqual(r, { status: 200, body: { outcome: 'applied' } })
  assert.deepEqual(db.calls[0].args, {
    p_event_id: 'evt_p1', p_event_type: 'PAYMENT_RECEIVED', p_subscription_id: SUB_UUID, p_provider_subscription_id: null,
    p_provider_payment_id: 'pay_px1', p_amount_cents: 54000, p_paid_on: '2026-10-04',
  })
})

test('#811 Pix: the first charge carrying a not-yet-attached sub_… still confirms (no false subscription_mismatch)', async () => {
  const asaas = fakeAsaas([
    at('GET', '/payments/pay_px1', 200, { ...pixFirst, subscription: 'sub_px' }),
    at('GET', '/customers/cus_1', 200, { id: 'cus_1', externalReference: SUB_UUID }),
  ])
  const db = fakeDb({ confirm_place_charge: { data: [{ outcome: 'applied' }] } })
  const { d } = deps(asaas, db, row())
  await hook(d, { id: 'evt_p1', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_px1' } })
  assert.equal(db.calls[0].args.p_provider_subscription_id, null)
})

test('#811 Pix: a renewal charge of an attached plan keeps its sub_… (mismatch check stays on)', async () => {
  const asaas = fakeAsaas([
    at('GET', '/payments/pay_px2', 200, { ...pixFirst, id: 'pay_px2', value: 600, subscription: 'sub_px' }),
    at('GET', '/customers/cus_1', 200, { id: 'cus_1', externalReference: SUB_UUID }),
  ])
  const db = fakeDb({ confirm_place_charge: { data: [{ outcome: 'applied' }] } })
  const { d } = deps(asaas, db, row({ status: 'paid', payment_method: 'pix_automatic', provider_subscription_id: 'sub_px', provider_authorization_id: AUTH }))
  await hook(d, { id: 'evt_p2', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_px2' } })
  assert.equal(db.calls[0].args.p_subscription_id, SUB_UUID)
  assert.equal(db.calls[0].args.p_provider_subscription_id, 'sub_px')
})

test('#811 Pix §3.2: a refused recurring instruction with the charge still PENDING → fail_place_charge', async () => {
  const asaas = fakeAsaas([
    at('GET', '/payments/pay_px2', 200, { ...pixFirst, id: 'pay_px2', status: 'PENDING', value: 600, subscription: 'sub_px', dueDate: '2027-01-10' }),
    at('GET', '/customers/cus_1', 200, { id: 'cus_1', externalReference: SUB_UUID }),
  ])
  const db = fakeDb({ fail_place_charge: { data: [{ outcome: 'applied' }] } })
  const { d } = deps(asaas, db, row({ status: 'paid', provider_subscription_id: 'sub_px', provider_authorization_id: AUTH }))
  const r = await hook(d, { id: 'evt_r', event: 'PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_REFUSED', paymentInstruction: { id: 'pi_1', paymentId: 'pay_px2' } })
  assert.deepEqual(r, { status: 200, body: { outcome: 'applied' } })
  assert.equal(db.calls[0].fn, 'fail_place_charge')
  assert.equal(db.calls[0].args.p_due_date, '2027-01-10')
})

const activated = { id: AUTH, status: 'ACTIVE', contractId: CONTRACT, customerId: 'cus_1', subscriptionId: 'sub_px', frequency: 'MONTHLY' }

test('#811 Pix: ACTIVATED attaches the RE-READ ids (body ignored); BR-B2B-046: no PUT nextDueDate, the recurrence keeps its startDate', async () => {
  const asaas = fakeAsaas([
    at('GET', `/pix/automatic/authorizations/${AUTH}`, 200, activated),
  ])
  const db = fakeDb({ attach_place_subscription: { data: 'paid' } })
  const { d } = deps(asaas, db, row({ status: 'paid' }))
  const r = await hook(d, { id: 'evt_a', event: 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED', authorization: { id: AUTH, subscriptionId: 'sub_evil', contractId: 'evil', customerId: 'cus_evil' } })
  assert.deepEqual(r, { status: 200, body: { outcome: 'applied' } })
  assert.deepEqual(db.calls[0], { schema: 'partner', fn: 'attach_place_subscription', args: {
    p_subscription_id: SUB_UUID, p_payment_method: 'pix_automatic', p_provider_customer_id: 'cus_1', p_provider_subscription_id: 'sub_px', p_provider_authorization_id: AUTH,
  } })
  assert.deepEqual(paths(asaas), [`GET /pix/automatic/authorizations/${AUTH}`])
})

test('#811 Pix: a resent ACTIVATED of the attached authorization touches nothing', async () => {
  const asaas = fakeAsaas([at('GET', `/pix/automatic/authorizations/${AUTH}`, 200, activated)])
  const db = fakeDb({})
  const { d } = deps(asaas, db, row({ status: 'paid', payment_method: 'pix_automatic', provider_subscription_id: 'sub_px', provider_authorization_id: AUTH }))
  const r = await hook(d, { id: 'evt_a2', event: 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED', authorization: { id: AUTH } })
  assert.deepEqual(r, { status: 200, body: { outcome: 'duplicate_event' } })
  assert.equal(db.calls.length, 0)
  assert.equal(asaas.calls.length, 1)
})

test('#811 Pix R2: ACTIVATED when another subscription is live (TGP10) ends this one in Asaas and alerts', async () => {
  const asaas = fakeAsaas([
    at('GET', `/pix/automatic/authorizations/${AUTH}`, 200, activated),
    at('DELETE', '/subscriptions/sub_px', 200, { deleted: true }),
    at('DELETE', `/pix/automatic/authorizations/${AUTH}`, 200, {}),
  ])
  const db = fakeDb({ attach_place_subscription: { error: { code: 'TGP10', details: 'renewing' } } })
  const { d, alerts } = deps(asaas, db, row({ status: 'paid', payment_method: 'credit_card', provider_subscription_id: 'sub_card' }))
  const r = await hook(d, { id: 'evt_a3', event: 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED', authorization: { id: AUTH } })
  assert.deepEqual(r, { status: 200, body: { outcome: 'discarded' } })
  assert.ok(paths(asaas).includes('DELETE /subscriptions/sub_px'))
  assert.ok(paths(asaas).includes(`DELETE /pix/automatic/authorizations/${AUTH}`))
  assert.equal(alerts[0].what, 'pix_authorization_discarded')
})

test('#811 Pix: ACTIVATED whose re-read is not ACTIVE is stale; without the sub_… yet it is a 500 (Asaas resends)', async () => {
  const notActive = fakeAsaas([at('GET', `/pix/automatic/authorizations/${AUTH}`, 200, { ...activated, status: 'CANCELLED' })])
  const db = fakeDb({})
  const r1 = await hook(deps(notActive, db, row()).d, { id: 'e', event: 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED', authorization: { id: AUTH } })
  assert.deepEqual(r1, { status: 200, body: { outcome: 'stale' } })
  const noSub = fakeAsaas([at('GET', `/pix/automatic/authorizations/${AUTH}`, 200, { ...activated, subscriptionId: null })])
  const r2 = await hook(deps(noSub, db, row()).d, { id: 'e', event: 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED', authorization: { id: AUTH } })
  assert.equal(r2.status, 500)
  assert.equal(db.calls.length, 0)
})

test('#811 Pix: REFUSED after the QR paid the period (nothing attached) turns the renewal off', async () => {
  const asaas = fakeAsaas([at('GET', `/pix/automatic/authorizations/${AUTH}`, 200, { ...activated, status: 'REFUSED', subscriptionId: null })])
  const db = fakeDb({ cancel_place_subscription: { data: [{ outcome: 'applied' }] } })
  const { d } = deps(asaas, db, row({ status: 'paid' }))
  const r = await hook(d, { id: 'evt_x', event: 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_REFUSED', authorization: { id: AUTH } })
  assert.deepEqual(r, { status: 200, body: { outcome: 'applied' } })
  assert.deepEqual(db.calls[0].args, { p_event_id: 'evt_x', p_event_type: 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_REFUSED', p_subscription_id: SUB_UUID, p_provider_subscription_id: null, p_actor_kind: 'provider' })
})

test('#811 Pix: an expired QR nobody paid, or an old authorization after another was attached, changes nothing', async () => {
  const expired = fakeAsaas([at('GET', `/pix/automatic/authorizations/${AUTH}`, 200, { ...activated, status: 'REFUSED', subscriptionId: null })])
  const db = fakeDb({})
  const r1 = await hook(deps(expired, db, row()).d, { id: 'e1', event: 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_REFUSED', authorization: { id: AUTH } })
  assert.deepEqual(r1, { status: 200, body: { outcome: 'stale' } })
  const old = fakeAsaas([at('GET', `/pix/automatic/authorizations/${AUTH}`, 200, { ...activated, status: 'CANCELLED' })])
  const attachedOther = row({ status: 'paid', payment_method: 'pix_automatic', provider_subscription_id: 'sub_new', provider_authorization_id: 'auth_new' })
  const r2 = await hook(deps(old, db, attachedOther).d, { id: 'e2', event: 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CANCELLED', authorization: { id: AUTH } })
  assert.deepEqual(r2, { status: 200, body: { outcome: 'stale' } })
  assert.equal(db.calls.length, 0)
})

test('#811 Pix: CANCELLED by the payer of the attached authorization deletes the Asaas subscription and cancels with both ids', async () => {
  const asaas = fakeAsaas([
    at('GET', `/pix/automatic/authorizations/${AUTH}`, 200, { ...activated, status: 'CANCELLED' }),
    at('DELETE', '/subscriptions/sub_px', 200, { deleted: true }),
  ])
  const db = fakeDb({ cancel_place_subscription: { data: [{ outcome: 'applied' }] } })
  const { d } = deps(asaas, db, row({ status: 'paid', payment_method: 'pix_automatic', provider_subscription_id: 'sub_px', provider_authorization_id: AUTH }))
  const r = await hook(d, { id: 'evt_c', event: 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CANCELLED', authorization: { id: AUTH } })
  assert.deepEqual(r, { status: 200, body: { outcome: 'applied' } })
  assert.ok(paths(asaas).includes('DELETE /subscriptions/sub_px'))
  assert.equal(db.calls[0].args.p_provider_subscription_id, 'sub_px')
})

test('#811 Pix: the other authorization and instruction events are answered 200 and ignored', async () => {
  const asaas = fakeAsaas([])
  const db = fakeDb({})
  const { d } = deps(asaas, db)
  for (const event of ['PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CREATED', 'PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_SCHEDULED', 'PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_CREATED']) {
    assert.deepEqual(await hook(d, { id: 'e', event, authorization: { id: AUTH } }), { status: 200, body: { outcome: 'ignored' } })
  }
  assert.equal(asaas.calls.length + db.calls.length, 0)
})

// ─── owner actions and sweep ─────────────────────────────────────────────────────────────────

const pixCancel = (fee: number) => fakeDb({
  portal_cancel_renewal: { data: [{ outcome: 'applied', renews: false, commitment_ends_at: '2027-01-06T15:00:00Z', paid_through: '2027-01-06T15:00:00Z', early_termination_fee_cents: fee }] },
}).rpc
const pixLive = row({ status: 'paid', payment_method: 'pix_automatic', provider_subscription_id: 'sub_px', provider_authorization_id: AUTH })

test('#863 #898 Pix §8.4 BR-B2B-046: cancel with fee 0 — endDate moves to the eve of paid_through and the fee Asaas already generated for paid_through is deleted; nothing else is charged', async () => {
  const asaas = fakeAsaas([
    at('PUT', '/subscriptions/sub_px', 200, {}),
    at('GET', '/payments?subscription=sub_px&status=PENDING', 200, { data: [{ id: 'pay_next', status: 'PENDING', value: 600, dueDate: '2027-01-06' }] }),
    at('DELETE', '/payments/pay_next', 200, { deleted: true }),
  ])
  const db = fakeDb({})
  const { d } = deps(asaas, db, pixLive, { user: pixCancel(0) })
  assert.deepEqual(await pay.cancelRenewal(d, SUBMISSION), { status: 200, body: { result: 'canceled' } })
  assert.deepEqual(paths(asaas), ['PUT /subscriptions/sub_px', 'GET /payments?subscription=sub_px&status=PENDING', 'DELETE /payments/pay_next'])
  assert.deepEqual(asaas.calls[0].body, { endDate: '2027-01-05' })
  assert.deepEqual(db.calls, [])
})

test('#863 Pix §8.4 BR-B2B-046: cancel with fee — the authorized value is fixed (Asaas FAQ Pix Automático q.6), so the fee is a one-off Pix due on paid_through, and the recurrence ends now (subscription + authorization); the QR page goes in the e-mail', async () => {
  const asaas = fakeAsaas([
    at('POST', '/payments', 200, { id: 'pay_fee', status: 'PENDING', value: 135, invoiceUrl: 'https://sandbox.asaas.com/i/abc' }),
    at('DELETE', '/subscriptions/sub_px', 200, { deleted: true }),
    at('DELETE', `/pix/automatic/authorizations/${AUTH}`, 200, {}),
  ])
  const db = fakeDb({})
  let mail = ''
  const { d, alerts } = deps(asaas, db, row({ ...pixLive, provider_customer_id: 'cus_px' }), {
    user: pixCancel(13500),
    sendEmail: async (_to: string, _s: string, text: string) => { mail = text; return true },
  })
  assert.deepEqual(await pay.cancelRenewal(d, SUBMISSION), { status: 200, body: { result: 'canceled' } })
  assert.deepEqual(paths(asaas), ['POST /payments', 'DELETE /subscriptions/sub_px', `DELETE /pix/automatic/authorizations/${AUTH}`])
  const body = asaas.calls[0].body as Record<string, unknown>
  assert.equal(body.customer, 'cus_px')
  assert.equal(body.billingType, 'PIX')
  assert.equal(body.value, 135)
  assert.equal(body.dueDate, '2027-01-06')
  // no externalReference: the webhook maps it through the customer, like the first Pix charge
  assert.equal(body.externalReference, undefined)
  assert.deepEqual(db.calls, [])
  assert.deepEqual(alerts, [])
  assert.match(mail, /uma única vez R\$ 135,00, a diferença do desconto dos meses usados, por Pix, com vencimento em 06\/01\/2027/)
  assert.match(mail, /https:\/\/sandbox\.asaas\.com\/i\/abc/)
})

test('#863 Pix §8.4: the one-off fee charge fails — the recurrence still ends (it would charge a full monthly), the operator is alerted', async () => {
  const asaas = fakeAsaas([
    at('POST', '/payments', 500, {}),
    at('DELETE', '/subscriptions/sub_px', 200, { deleted: true }),
    at('DELETE', `/pix/automatic/authorizations/${AUTH}`, 200, {}),
  ])
  const { d, alerts } = deps(asaas, fakeDb({}), pixLive, { user: pixCancel(13500) })
  assert.deepEqual(await pay.cancelRenewal(d, SUBMISSION), { status: 200, body: { result: 'canceled' } })
  assert.deepEqual(paths(asaas), ['POST /payments', 'DELETE /subscriptions/sub_px', `DELETE /pix/automatic/authorizations/${AUTH}`])
  assert.ok(alerts.some((a) => a.what === 'cancel_fee_not_scheduled' && a.fields.reason === 'pix_charge'))
})

test('#863 Pix BR-B2B-046 item 7: commitment ending without renewal — the sweep ends the subscription AND the authorization', async () => {
  const asaas = fakeAsaas([
    at('DELETE', '/subscriptions/sub_px', 200, { deleted: true }),
    at('DELETE', `/pix/automatic/authorizations/${AUTH}`, 200, {}),
  ])
  const db = fakeDb({
    place_pending_refunds: { data: [] },
    expire_place_subscriptions: { data: [] },
    place_commitments_ending: { data: [{ subscription_id: SUB_UUID, payment_method: 'pix_automatic', provider_subscription_id: 'sub_px' }] },
    cancel_place_subscription: { data: [{ outcome: 'applied' }] },
    place_renewal_schedule: { data: [] },
  })
  const { d } = deps(asaas, db, row({ status: 'paid', payment_method: 'pix_automatic', provider_subscription_id: 'sub_px', provider_authorization_id: AUTH }))
  const s = await pay.runSweep(d)
  assert.equal(s.ended, 1)
  assert.deepEqual(paths(asaas), ['DELETE /subscriptions/sub_px', `DELETE /pix/automatic/authorizations/${AUTH}`])
})

test('#811 Pix: the sweep ends the authorization of an expired Pix plan', async () => {
  const asaas = fakeAsaas([
    at('DELETE', '/subscriptions/sub_px', 200, { deleted: true }),
    at('DELETE', `/pix/automatic/authorizations/${AUTH}`, 200, {}),
  ])
  const db = fakeDb({
    place_pending_refunds: { data: [] },
    expire_place_subscriptions: { data: [{ subscription_id: SUB_UUID, payment_method: 'pix_automatic', provider_subscription_id: 'sub_px', canceled_at: null }] },
    cancel_place_subscription: { data: [{ outcome: 'applied' }] },
    place_renewal_schedule: { data: [] },
  })
  const { d } = deps(asaas, db, row({ status: 'expired', payment_method: 'pix_automatic', provider_subscription_id: 'sub_px', provider_authorization_id: AUTH }))
  const s = await pay.runSweep(d)
  assert.equal(s.expired, 1)
  assert.deepEqual(paths(asaas), ['DELETE /subscriptions/sub_px', `DELETE /pix/automatic/authorizations/${AUTH}`])
})
