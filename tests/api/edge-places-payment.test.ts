/**
 * #811 — payment of the Com história plan (Asaas), against `docs/contracts/places-pagamento.md`
 * (workspace) and the seven demands of the security review of #811.
 *
 * `_shared/places-payment.ts` and `_shared/asaas.ts` run here under Node with Asaas mocked at the
 * `fetch` level, so the real client builds the real requests. Deno source, loaded through a path
 * built at run time: a static `.ts` import fails the repo's `tsc`.
 *
 * Run with: npm run test:api
 */

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const SHARED = resolve(import.meta.dirname, '../../supabase/functions/_shared')

// `places-payment.ts` imports its siblings with `.ts` (Deno); a `typeof import` of it would pull
// those imports into the repo's `tsc` and fail it (TS5097). Untyped on purpose.
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
const SUBMISSION = '99999999-8888-4777-8666-555555555555'
const REF = `com_historia_3m:${SUB_UUID}`
const TOKEN = 'whk-token-123'

type Call = { method: string; path: string; body: unknown }
type Route = (c: Call) => { status: number; body: unknown } | undefined

/** A fake Asaas: routes answer, every request is recorded (with the headers' auth). */
function fakeAsaas(routes: Route[]) {
  const calls: Call[] = []
  const headers: Record<string, string>[] = []
  const fetch = async (url: string, init: RequestInit) => {
    const u = new URL(url)
    const call = { method: init.method ?? 'GET', path: u.pathname.replace(/^\/v3/, '') + u.search, body: init.body ? JSON.parse(String(init.body)) : undefined }
    calls.push(call)
    headers.push(init.headers as Record<string, string>)
    for (const r of routes) {
      const hit = r(call)
      if (hit) return new Response(JSON.stringify(hit.body), { status: hit.status })
    }
    return new Response(JSON.stringify({ errors: [{ code: 'not_found' }] }), { status: 404 })
  }
  return { client: asaasMod.asaasClient({ baseUrl: 'https://api-sandbox.asaas.com/v3', apiKey: 'k', fetch }), calls, headers }
}

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

function deps(asaas: ReturnType<typeof fakeAsaas>, db: ReturnType<typeof fakeDb>, extra: Record<string, unknown> = {}) {
  const alerts: { what: string; fields: Record<string, unknown> }[] = []
  const d = {
    asaas: asaas.client,
    admin: db.rpc,
    subscriptionIds: async () => null,
    subscriptionById: async () => null,
    alert: async (what: string, fields: Record<string, unknown>) => {
      alerts.push({ what, fields })
    },
    today: () => '2026-10-04',
    now: () => new Date('2026-10-04T12:00:00Z'),
    ...extra,
  }
  return { d, alerts }
}

const at = (method: string, prefix: string, status: number, body: unknown): Route => (c) =>
  c.method === method && c.path.startsWith(prefix) ? { status, body } : undefined

// ─── pure ────────────────────────────────────────────────────────────────────────────────────

test('#811 demand 3: amount in cents is Math.round(value * 100), immune to float error', () => {
  assert.equal(pay.toCents(19.99), 1999)
  assert.equal(pay.toCents(0.1 + 0.2), 30)
  assert.equal(pay.toCents(825), 82500)
})

test('#811: the externalReference gives back our subscription uuid, and nothing else does', () => {
  assert.equal(pay.subscriptionIdFromReference(REF), SUB_UUID)
  assert.equal(pay.subscriptionIdFromReference(`com_historia_1m:${SUB_UUID.toUpperCase()}`), SUB_UUID)
  assert.equal(pay.subscriptionIdFromReference(SUB_UUID), null)
  assert.equal(pay.subscriptionIdFromReference('com_historia_3m:not-a-uuid'), null)
  assert.equal(pay.subscriptionIdFromReference(null), null)
})

test('#811: addMonths clamps to the end of the month', () => {
  assert.equal(pay.addMonths('2026-01-31', 1), '2026-02-28')
  assert.equal(pay.addMonths('2026-10-04', 3), '2027-01-04')
  assert.equal(pay.addMonths('2026-08-31', 6), '2027-02-28')
})

test('#811 demand 1: the database function follows the RE-READ status, not the event type', () => {
  assert.equal(pay.paymentAction('PAYMENT_OVERDUE', 'CONFIRMED'), 'confirm_place_charge')
  assert.equal(pay.paymentAction('PAYMENT_CONFIRMED', 'PENDING'), null)
  assert.equal(pay.paymentAction('PAYMENT_CONFIRMED', 'REFUNDED'), 'settle_place_refund')
  assert.equal(pay.paymentAction('PAYMENT_REFUNDED', 'RECEIVED'), 'confirm_place_charge')
  assert.equal(pay.paymentAction('PAYMENT_CREDIT_CARD_CAPTURE_REFUSED', 'PENDING'), 'fail_place_charge')
  assert.equal(pay.paymentAction('PAYMENT_RECEIVED', 'PENDING'), null)
})

test('#811: checkout input — a bad card names the field, never echoes the value', () => {
  const ok = {
    submission_id: SUBMISSION,
    card: { number: '4111 1111 1111 1111', holder_name: 'Maria Silva', expiry_month: '5', expiry_year: '29', ccv: '123' },
    holder: { cpf_cnpj: '123.456.789-09', postal_code: '28950-000', address_number: '12', phone: '(22) 99999-8888' },
    remote_ip: '203.0.113.9',
  }
  const parsed = pay.parseCheckoutInput(ok, '2026-10-04')
  assert.ok(!('invalid' in parsed))
  if (!('invalid' in parsed)) {
    assert.equal(parsed.card.number, '4111111111111111')
    assert.equal(parsed.card.expiryMonth, '05')
    assert.equal(parsed.card.expiryYear, '2029')
    assert.equal(parsed.holder.cpfCnpj, '12345678909')
  }
  const bad = pay.parseCheckoutInput({ ...ok, card: { ...ok.card, number: '4111 1111 1111 1112' } }, '2026-10-04')
  assert.deepEqual(bad, { invalid: 'card_number' })
  assert.deepEqual(pay.parseCheckoutInput({ ...ok, card: { ...ok.card, expiry_month: '9', expiry_year: '2026' } }, '2026-10-04'), { invalid: 'card_expiry' })
  // CNPJ alfanumérico (2026-07): accepted as the holder document.
  const alnum = pay.parseCheckoutInput({ ...ok, holder: { ...ok.holder, cpf_cnpj: '12.ABC.345/01DE-35' } }, '2026-10-04')
  assert.ok(!('invalid' in alnum))
})

// ─── webhook ─────────────────────────────────────────────────────────────────────────────────

const confirmedPayment = { id: 'pay_1', status: 'CONFIRMED', value: 199.9, netValue: 190.0, subscription: 'sub_1', externalReference: REF, confirmedDate: '2026-10-04' }

test('#811 demand 6: wrong, missing or unset webhook token → 401 before any read', async () => {
  const asaas = fakeAsaas([])
  const db = fakeDb({})
  const { d } = deps(asaas, db)
  const body = { id: 'evt_1', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_1' } }
  assert.equal((await pay.handleAsaasWebhook(d, TOKEN, 'nope', body)).status, 401)
  assert.equal((await pay.handleAsaasWebhook(d, TOKEN, null, body)).status, 401)
  assert.equal((await pay.handleAsaasWebhook(d, '', '', body)).status, 401)
  assert.equal(asaas.calls.length + db.calls.length, 0)
})

test('#811 demands 1–3: confirm with the re-read value and both re-read ids, never the body', async () => {
  const asaas = fakeAsaas([at('GET', '/payments/pay_1', 200, confirmedPayment)])
  const db = fakeDb({ confirm_place_charge: { data: [{ outcome: 'applied' }] } })
  const { d, alerts } = deps(asaas, db)
  // The body lies about value, subscription and reference: none of it may reach the database.
  const body = { id: 'evt_1', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1', value: 1, subscription: 'sub_evil', externalReference: 'com_historia_1m:00000000-0000-4000-8000-000000000000' } }
  const r = await pay.handleAsaasWebhook(d, TOKEN, TOKEN, body)
  assert.deepEqual(r, { status: 200, body: { outcome: 'applied' } })
  assert.equal(asaas.headers[0].access_token, 'k')
  assert.ok(asaas.headers[0]['User-Agent'])
  assert.deepEqual(db.calls, [{
    schema: 'partner',
    fn: 'confirm_place_charge',
    args: {
      p_event_id: 'evt_1', p_event_type: 'PAYMENT_RECEIVED', p_subscription_id: SUB_UUID, p_provider_subscription_id: 'sub_1',
      p_provider_payment_id: 'pay_1', p_amount_cents: 19990, p_paid_on: '2026-10-04',
    },
  }])
  assert.equal(alerts.length, 0)
})

test('#811 demand 1: an event whose re-read status does not match moves nothing', async () => {
  const asaas = fakeAsaas([at('GET', '/payments/pay_1', 200, { ...confirmedPayment, status: 'PENDING' })])
  const db = fakeDb({})
  const { d } = deps(asaas, db)
  const r = await pay.handleAsaasWebhook(d, TOKEN, TOKEN, { id: 'evt_2', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_1' } })
  assert.equal(r.status, 200)
  assert.equal(db.calls.length, 0)
})

test('#811: a REFUNDED re-read settles the refund', async () => {
  const asaas = fakeAsaas([at('GET', '/payments/pay_1', 200, { ...confirmedPayment, status: 'REFUNDED' })])
  const db = fakeDb({ settle_place_refund: { data: [{ outcome: 'applied' }] } })
  const { d } = deps(asaas, db)
  await pay.handleAsaasWebhook(d, TOKEN, TOKEN, { id: 'evt_3', event: 'PAYMENT_REFUNDED', payment: { id: 'pay_1' } })
  assert.equal(db.calls[0].fn, 'settle_place_refund')
  assert.equal(db.calls[0].args.p_amount_cents, undefined)
})

test('#811 demand 7: business outcomes answer 200, and the four that need a human alert', async () => {
  for (const outcome of ['amount_mismatch', 'subscription_mismatch', 'unknown_subscription', 'not_applicable', 'duplicate_event', 'duplicate_charge']) {
    const asaas = fakeAsaas([at('GET', '/payments/pay_1', 200, confirmedPayment)])
    const db = fakeDb({ confirm_place_charge: { data: [{ outcome }] } })
    const { d, alerts } = deps(asaas, db)
    const r = await pay.handleAsaasWebhook(d, TOKEN, TOKEN, { id: 'evt_4', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_1' } })
    assert.equal(r.status, 200, outcome)
    assert.equal(alerts.length, pay.ALERT_OUTCOMES.has(outcome) ? 1 : 0, outcome)
  }
})

test('#811 demand 7: a database exception is a 500, so Asaas resends', async () => {
  const asaas = fakeAsaas([at('GET', '/payments/pay_1', 200, confirmedPayment)])
  const db = fakeDb({ confirm_place_charge: { error: { code: 'TGP22', details: 'p_amount_cents' } } })
  const { d } = deps(asaas, db)
  const r = await pay.handleAsaasWebhook(d, TOKEN, TOKEN, { id: 'evt_5', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_1' } })
  assert.equal(r.status, 500)
})

test('#811: re-read 404 is an answer (200 + alert); re-read 5xx is not (500, resend)', async () => {
  const gone = fakeAsaas([])
  const g = deps(gone, fakeDb({}))
  assert.equal((await pay.handleAsaasWebhook(g.d, TOKEN, TOKEN, { id: 'e', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_x' } })).status, 200)
  assert.equal(g.alerts[0].what, 'reread_not_found')

  const down = fakeAsaas([at('GET', '/payments/', 503, {})])
  const db = fakeDb({})
  const dd = deps(down, db)
  assert.equal((await pay.handleAsaasWebhook(dd.d, TOKEN, TOKEN, { id: 'e', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_x' } })).status, 500)
  assert.equal(db.calls.length, 0)
})

test('#811 demand 1: SUBSCRIPTION_DELETED cancels only if the re-read subscription is not active', async () => {
  const active = fakeAsaas([at('GET', '/subscriptions/sub_1', 200, { id: 'sub_1', status: 'ACTIVE', value: 600, externalReference: REF })])
  const db1 = fakeDb({})
  await pay.handleAsaasWebhook(deps(active, db1).d, TOKEN, TOKEN, { id: 'e1', event: 'SUBSCRIPTION_DELETED', subscription: { id: 'sub_1' } })
  assert.equal(db1.calls.length, 0)

  const deleted = fakeAsaas([at('GET', '/subscriptions/sub_1', 200, { id: 'sub_1', status: 'ACTIVE', deleted: true, value: 600, externalReference: REF })])
  const db2 = fakeDb({ cancel_place_subscription: { data: [{ outcome: 'applied' }] } })
  await pay.handleAsaasWebhook(deps(deleted, db2).d, TOKEN, TOKEN, { id: 'e2', event: 'SUBSCRIPTION_DELETED', subscription: { id: 'sub_1' } })
  assert.deepEqual(db2.calls[0].args, { p_event_id: 'e2', p_event_type: 'SUBSCRIPTION_DELETED', p_subscription_id: SUB_UUID, p_provider_subscription_id: 'sub_1', p_actor_kind: 'provider' })
})

test('#811: chargeback is not handled — 200 and an alert', async () => {
  const { d, alerts } = deps(fakeAsaas([]), fakeDb({}))
  const r = await pay.handleAsaasWebhook(d, TOKEN, TOKEN, { id: 'e', event: 'PAYMENT_CHARGEBACK_REQUESTED', payment: { id: 'pay_1' } })
  assert.equal(r.status, 200)
  assert.equal(alerts[0].what, 'chargeback')
})

// ─── refunds ─────────────────────────────────────────────────────────────────────────────────

const refundRow = (id: string) => ({
  subscription_id: SUB_UUID, submission_id: SUBMISSION, provider_subscription_id: 'sub_1',
  provider_payment_id: id, amount_cents: 19990, paid_on: '2026-10-01', pending_since: '2026-10-04T00:00:00Z',
})

test('#811 BR-B2B-046: a refund already PENDING or DONE in Asaas is never asked twice', async () => {
  const asaas = fakeAsaas([
    at('DELETE', '/subscriptions/sub_1', 200, { deleted: true }),
    at('GET', '/payments/pay_pending', 200, { ...confirmedPayment, id: 'pay_pending', refunds: [{ status: 'PENDING' }] }),
    at('GET', '/payments/pay_cancelled', 200, { ...confirmedPayment, id: 'pay_cancelled', refunds: [{ status: 'CANCELLED' }] }),
    at('GET', '/payments/pay_fresh', 200, { ...confirmedPayment, id: 'pay_fresh' }),
    at('POST', '/payments/', 200, {}),
  ])
  const { d } = deps(asaas, fakeDb({}))
  const out = await pay.processRefunds(d, [refundRow('pay_pending'), refundRow('pay_cancelled'), refundRow('pay_fresh')])
  assert.deepEqual(out, { requested: 2, skipped: 1, failed: 0 })
  const posts = asaas.calls.filter((c) => c.method === 'POST')
  assert.deepEqual(posts.map((c) => c.path), ['/payments/pay_cancelled/refund', '/payments/pay_fresh/refund'])
  assert.equal((posts[0].body as { value: number }).value, 199.9)
  assert.equal(asaas.calls.filter((c) => c.method === 'DELETE').length, 1)
})

test('#811: a refund pending for days (webhook that never came) alerts the operator', async () => {
  const asaas = fakeAsaas([at('GET', '/payments/pay_1', 200, { ...confirmedPayment, refunds: [{ status: 'PENDING' }] })])
  const { d, alerts } = deps(asaas, fakeDb({}))
  await pay.processRefunds(d, [{ ...refundRow('pay_1'), provider_subscription_id: null, pending_since: '2026-09-28T00:00:00Z' }])
  assert.equal(alerts[0].what, 'refund_stale')
})

// ─── checkout ────────────────────────────────────────────────────────────────────────────────

const checkoutBody = {
  action: 'checkout',
  submission_id: SUBMISSION,
  card: { number: '4111111111111111', holder_name: 'Maria Silva', expiry_month: '05', expiry_year: '2029', ccv: '123' },
  holder: { cpf_cnpj: '12345678909', postal_code: '28950000', address_number: '12', phone: '22999998888' },
  remote_ip: '203.0.113.9',
}
const checkoutRow = {
  subscription_id: SUB_UUID, status: 'pending_payment', attachable: true, external_reference: REF, billing_cycle: 'QUARTERLY',
  billing_period: 3, next_amount_cents: 54000, renewal_amount_cents: 60000, next_due_date: '2026-10-04',
  customer_name: 'Bar do Zé LTDA', customer_tax_id: '12.345.678/0001-95', customer_email: 'ze@example.com',
}
function portal(asaas: ReturnType<typeof fakeAsaas>, db: ReturnType<typeof fakeDb>, user: ReturnType<typeof fakeDb>) {
  const sent: string[] = []
  const x = deps(asaas, db, {
    user: user.rpc,
    userEmail: async () => 'ze@example.com',
    sendEmail: async (to: string) => {
      sent.push(to)
      return true
    },
  })
  return { ...x, sent }
}
const owner = fakeDb.bind(null, { portal_get_subscription: { data: [{ submission_id: SUBMISSION, status: 'pending_payment', renews: true }] } })

test('#811 demand 4: checkout of a submission that is not the caller\'s stops at the database', async () => {
  const asaas = fakeAsaas([])
  const db = fakeDb({})
  const { d } = portal(asaas, db, fakeDb({ portal_get_subscription: { error: { code: 'TGP01' } } }))
  const r = await pay.checkout(d as never, checkoutBody)
  assert.equal(r.status, 404)
  assert.equal(asaas.calls.length + db.calls.length, 0)
})

test('#811 §8: first charge with coupon — subscription value is the FIRST charge; attach; next charge held', async () => {
  const asaas = fakeAsaas([
    at('GET', '/subscriptions?', 200, { data: [] }),
    at('GET', '/customers?', 200, { data: [] }),
    at('POST', '/customers', 200, { id: 'cus_1' }),
    at('POST', '/subscriptions', 200, { id: 'sub_new', status: 'ACTIVE', value: 540 }),
    at('GET', '/payments?subscription=sub_new', 200, { data: [{ id: 'pay_1', status: 'CONFIRMED', value: 540, dueDate: '2026-10-04' }, { id: 'pay_2', status: 'PENDING', value: 540, dueDate: '2027-01-04' }] }),
    at('DELETE', '/payments/pay_2', 200, { deleted: true }),
    at('PUT', '/subscriptions/sub_new', 200, {}),
  ])
  const db = fakeDb({ place_payment_checkout: { data: [checkoutRow] }, attach_place_subscription: { data: 'pending_payment' } })
  const { d } = portal(asaas, db, owner())
  const r = await pay.checkout(d as never, checkoutBody)
  assert.deepEqual(r, { status: 200, body: { result: 'paid' } })

  const created = asaas.calls.find((c) => c.method === 'POST' && c.path === '/subscriptions')!.body as Record<string, unknown>
  assert.equal(created.value, 540)
  assert.equal(created.billingType, 'CREDIT_CARD')
  assert.equal(created.externalReference, REF)
  assert.equal(created.nextDueDate, '2026-10-04')
  assert.equal(created.remoteIp, '203.0.113.9')
  assert.equal((created.creditCardHolderInfo as Record<string, unknown>).email, 'ze@example.com')
  const customer = asaas.calls.find((c) => c.method === 'POST' && c.path === '/customers')!.body as Record<string, unknown>
  assert.equal(customer.cpfCnpj, '12345678000195')
  assert.equal(customer.externalReference, SUB_UUID)

  // the ids come from the database (checkout row), never from the request
  assert.deepEqual(db.calls.map((c) => c.fn), ['place_payment_checkout', 'attach_place_subscription'])
  assert.equal(db.calls[1].args.p_subscription_id, SUB_UUID)
  assert.equal(db.calls[1].args.p_provider_subscription_id, 'sub_new')
  // the early second charge (send + 1 period) is removed, the next one pushed past approval
  assert.ok(asaas.calls.some((c) => c.method === 'DELETE' && c.path === '/payments/pay_2'))
  const put = asaas.calls.find((c) => c.method === 'PUT')!.body as Record<string, unknown>
  assert.equal(put.nextDueDate, '2027-04-04')
})

test('#811 demand 5: a live subscription for the same reference that already charged is attached, not charged again', async () => {
  const asaas = fakeAsaas([
    at('GET', '/subscriptions?', 200, { data: [{ id: 'sub_old', status: 'ACTIVE', value: 540, customer: 'cus_1' }] }),
    at('GET', '/payments?subscription=sub_old', 200, { data: [{ id: 'pay_1', status: 'CONFIRMED', value: 540 }] }),
  ])
  const db = fakeDb({ place_payment_checkout: { data: [checkoutRow] }, attach_place_subscription: { data: 'pending_payment' } })
  const { d } = portal(asaas, db, owner())
  const r = await pay.checkout(d as never, checkoutBody)
  assert.deepEqual(r.body, { result: 'paid' })
  assert.ok(!asaas.calls.some((c) => c.method === 'POST' && c.path === '/subscriptions'))
  assert.equal(db.calls[1].args.p_provider_subscription_id, 'sub_old')
})

test('#811 demand 5: a live unpaid subscription for the same reference is deleted before the new one', async () => {
  const asaas = fakeAsaas([
    at('GET', '/subscriptions?', 200, { data: [{ id: 'sub_old', status: 'ACTIVE', value: 540 }] }),
    at('GET', '/payments?subscription=sub_old', 200, { data: [{ id: 'pay_0', status: 'PENDING', value: 540 }] }),
    at('DELETE', '/subscriptions/sub_old', 200, { deleted: true }),
    at('GET', '/customers?', 200, { data: [{ id: 'cus_1' }] }),
    at('POST', '/subscriptions', 200, { id: 'sub_new', status: 'ACTIVE', value: 540 }),
    at('GET', '/payments?subscription=sub_new', 200, { data: [] }),
    at('PUT', '/subscriptions/sub_new', 200, {}),
  ])
  const db = fakeDb({ place_payment_checkout: { data: [checkoutRow] }, attach_place_subscription: { data: 'pending_payment' } })
  const { d } = portal(asaas, db, owner())
  const r = await pay.checkout(d as never, checkoutBody)
  assert.deepEqual(r.body, { result: 'processing' })
  const del = asaas.calls.findIndex((c) => c.method === 'DELETE' && c.path === '/subscriptions/sub_old')
  const post = asaas.calls.findIndex((c) => c.method === 'POST' && c.path === '/subscriptions')
  assert.ok(del >= 0 && del < post)
})

test('#811 §3.1: TGP10 renewing after the new subscription exists → it is refunded and deleted', async () => {
  const asaas = fakeAsaas([
    at('GET', '/subscriptions?', 200, { data: [] }),
    at('GET', '/customers?', 200, { data: [{ id: 'cus_1' }] }),
    at('POST', '/subscriptions', 200, { id: 'sub_new', status: 'ACTIVE', value: 540 }),
    at('GET', '/payments?subscription=sub_new', 200, { data: [{ id: 'pay_1', status: 'CONFIRMED', value: 540 }] }),
    at('POST', '/payments/pay_1/refund', 200, {}),
    at('DELETE', '/subscriptions/sub_new', 200, { deleted: true }),
  ])
  const db = fakeDb({ place_payment_checkout: { data: [checkoutRow] }, attach_place_subscription: { error: { code: 'TGP10', details: 'renewing' } } })
  const { d, alerts } = portal(asaas, db, owner())
  const r = await pay.checkout(d as never, checkoutBody)
  assert.equal(r.status, 409)
  assert.ok(asaas.calls.some((c) => c.path === '/payments/pay_1/refund'))
  assert.ok(asaas.calls.some((c) => c.method === 'DELETE' && c.path === '/subscriptions/sub_new'))
  assert.ok(alerts.length >= 1)
})

test('#811: refused card → 402, nothing attached', async () => {
  const asaas = fakeAsaas([
    at('GET', '/subscriptions?', 200, { data: [] }),
    at('GET', '/customers?', 200, { data: [{ id: 'cus_1' }] }),
    at('POST', '/subscriptions', 400, { errors: [{ code: 'invalid_creditCard', description: 'Transação não autorizada' }] }),
  ])
  const db = fakeDb({ place_payment_checkout: { data: [checkoutRow] } })
  const { d } = portal(asaas, db, owner())
  const r = await pay.checkout(d as never, checkoutBody)
  assert.deepEqual(r, { status: 402, body: { error: 'card_refused' } })
  assert.equal(db.calls.length, 1)
})

test('#811 §3.1: paid and waiting for approval (next_due_date null) creates nothing in Asaas', async () => {
  const asaas = fakeAsaas([])
  const db = fakeDb({ place_payment_checkout: { data: [{ ...checkoutRow, status: 'paid', next_due_date: null }] } })
  const { d } = portal(asaas, db, owner())
  assert.equal((await pay.checkout(d as never, checkoutBody)).status, 409)
  assert.equal(asaas.calls.length, 0)
})

// ─── owner actions ───────────────────────────────────────────────────────────────────────────

test('#811 BR-B2B-055 item 8: cancel renewal — Asaas first, then the database, then the e-mail (term 4.5)', async () => {
  const asaas = fakeAsaas([at('DELETE', '/subscriptions/sub_1', 200, { deleted: true })])
  const db = fakeDb({ cancel_place_subscription: { data: [{ outcome: 'applied', paid_through: '2027-01-06T03:00:00Z' }] } })
  const { d, sent } = portal(asaas, db, owner())
  ;(d as Record<string, unknown>).subscriptionIds = async () => ({ subscription_id: SUB_UUID, provider_subscription_id: 'sub_1', provider_customer_id: 'cus_1', canceled_at: null })
  const r = await pay.cancelRenewal(d as never, SUBMISSION)
  assert.deepEqual(r, { status: 200, body: { result: 'canceled' } })
  assert.deepEqual(db.calls[0].args, { p_event_id: null, p_event_type: null, p_subscription_id: SUB_UUID, p_provider_subscription_id: null, p_actor_kind: 'client' })
  assert.deepEqual(sent, ['ze@example.com'])
  assert.match(pay.CANCEL_EMAIL.text('06/01/2027'), /06\/01\/2027/)
})

test('#811 R1: regret refund goes through core.portal_request_refund with the user JWT, then refunds in Asaas', async () => {
  const asaas = fakeAsaas([
    at('DELETE', '/subscriptions/sub_1', 200, { deleted: true }),
    at('GET', '/payments/pay_1', 200, confirmedPayment),
    at('POST', '/payments/pay_1/refund', 200, {}),
  ])
  const db = fakeDb({ place_pending_refunds: { data: [refundRow('pay_1'), { ...refundRow('pay_other'), submission_id: '00000000-0000-4000-8000-000000000001' }] } })
  const user = fakeDb({ portal_request_refund: { data: 'refund_pending' } })
  const { d } = portal(asaas, db, user)
  const r = await pay.requestRefund(d as never, SUBMISSION)
  assert.deepEqual(r, { status: 200, body: { result: 'refund_pending' } })
  assert.deepEqual(user.calls, [{ schema: 'core', fn: 'portal_request_refund', args: { p_submission_id: SUBMISSION } }])
  assert.ok(!db.calls.some((c) => c.fn === 'request_place_refund'))
  // only this submission's payment is refunded here; the other waits for the sweep
  assert.deepEqual(asaas.calls.filter((c) => c.method === 'POST').map((c) => c.path), ['/payments/pay_1/refund'])
})

test('#811: withdrawal outside the window answers 409 with the database reason', async () => {
  const { d } = portal(fakeAsaas([]), fakeDb({}), fakeDb({ portal_withdraw: { error: { code: 'TGP10', details: 'approved' } } }))
  assert.deepEqual(await pay.withdraw(d as never, SUBMISSION), { status: 409, body: { error: 'not_allowed', reason: 'approved' } })
})

// ─── sweep: renewal alignment ────────────────────────────────────────────────────────────────

const scheduleRow = { subscription_id: SUB_UUID, provider_subscription_id: 'sub_1', renewal_amount_cents: 60000, billing_period: 3, renewal_date: '2027-01-06', notice_date: '2026-12-30' }

test('#811 term 4.1/4.5: a pending charge on the wrong date is removed and the renewal points at the approval + period', async () => {
  const asaas = fakeAsaas([
    at('GET', '/payments?subscription=sub_1', 200, { data: [{ id: 'pay_early', status: 'PENDING', value: 540, dueDate: '2027-01-04' }] }),
    at('DELETE', '/payments/pay_early', 200, { deleted: true }),
    at('GET', '/subscriptions/sub_1', 200, { id: 'sub_1', status: 'ACTIVE', value: 540, nextDueDate: '2027-04-04' }),
    at('PUT', '/subscriptions/sub_1', 200, {}),
  ])
  const { d } = deps(asaas, fakeDb({}))
  assert.equal(await pay.alignRenewal(d, scheduleRow), true)
  const put = asaas.calls.find((c) => c.method === 'PUT')!.body
  assert.deepEqual(put, { nextDueDate: '2027-01-06', value: 600, updatePendingPayments: true })
})

test('#811: an aligned subscription is left alone (the sweep is idempotent)', async () => {
  const asaas = fakeAsaas([
    at('GET', '/payments?subscription=sub_1', 200, { data: [{ id: 'pay_r', status: 'PENDING', value: 600, dueDate: '2027-01-06' }] }),
    at('GET', '/subscriptions/sub_1', 200, { id: 'sub_1', status: 'ACTIVE', value: 600, nextDueDate: '2027-04-06' }),
  ])
  const { d } = deps(asaas, fakeDb({}))
  assert.equal(await pay.alignRenewal(d, scheduleRow), false)
  assert.ok(!asaas.calls.some((c) => c.method !== 'GET'))
})

test('#811: the sweep cancels an expired subscription in Asaas and in the database', async () => {
  const asaas = fakeAsaas([at('DELETE', '/subscriptions/sub_9', 200, { deleted: true })])
  const db = fakeDb({
    place_pending_refunds: { data: [] },
    expire_place_subscriptions: { data: [{ subscription_id: SUB_UUID, provider_subscription_id: 'sub_9', canceled_at: null }, { subscription_id: SUB_UUID, provider_subscription_id: 'sub_8', canceled_at: '2026-10-01' }] },
    cancel_place_subscription: { data: [{ outcome: 'applied' }] },
    place_renewal_schedule: { data: [] },
  })
  const { d } = deps(asaas, db)
  const s = await pay.runSweep(d)
  assert.equal(s.expired, 1)
  assert.deepEqual(asaas.calls.map((c) => `${c.method} ${c.path}`), ['DELETE /subscriptions/sub_9'])
  assert.equal(db.calls.find((c) => c.fn === 'cancel_place_subscription')!.args.p_actor_kind, 'system')
})
