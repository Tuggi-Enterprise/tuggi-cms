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
    // #901: an empty invoice list unless a route says otherwise
    if (call.method === 'GET' && call.path.startsWith('/invoices?')) return new Response(JSON.stringify({ data: [], hasMore: false }), { status: 200 })
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
  const links: string[] = []
  const d = {
    asaas: asaas.client,
    admin: db.rpc,
    subscriptionIds: async () => null,
    subscriptionById: async () => null,
    expiredLiveCards: async () => [],
    cancelsToRedo: async () => [],
    alert: async (what: string, fields: Record<string, unknown>) => {
      alerts.push({ what, fields })
    },
    today: () => '2026-10-04',
    now: () => new Date('2026-10-04T12:00:00Z'),
    submissionOfSubscription: async () => SUBMISSION,
    accessLink: async (id: string) => {
      links.push(id)
      return 'sent' as const
    },
    // #901: no invoice secrets and no live plan by default (the invoice tests set their own)
    invoiceConfig: null,
    invoiceStatusOf: async () => null,
    invoiceTargets: async () => [],
    // #903: no payout in `sent` by default
    sentPayouts: async () => [],
    ...extra,
  }
  return { d, alerts, links }
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

test('#863 BR-B2B-045 items 4–5, contract §8.2: after an applied fee, Asaas value follows next_amount_cents (PUT with updatePendingPayments); equal → nothing written', async () => {
  for (const [next, puts] of [[15000, 1], [19990, 0]] as const) {
    const asaas = fakeAsaas([
      at('GET', '/payments/pay_1', 200, confirmedPayment),
      at('GET', '/subscriptions/sub_1', 200, { id: 'sub_1', status: 'ACTIVE', value: 199.9, cycle: 'MONTHLY' }),
      at('PUT', '/subscriptions/sub_1', 200, {}),
    ])
    const db = fakeDb({ confirm_place_charge: { data: [{ outcome: 'applied' }] }, place_payment_checkout: { data: [{ next_amount_cents: next }] } })
    const { d, alerts } = deps(asaas, db, { subscriptionIds: async () => ({ subscription_id: SUB_UUID, provider_subscription_id: 'sub_1', canceled_at: null }) })
    const r = await pay.handleAsaasWebhook(d, TOKEN, TOKEN, { id: 'evt_1', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_1' } })
    assert.deepEqual(r, { status: 200, body: { outcome: 'applied' } })
    const put = asaas.calls.filter((c) => c.method === 'PUT')
    assert.equal(put.length, puts)
    if (puts) assert.deepEqual(put[0].body, { value: 150, updatePendingPayments: true })
    assert.equal(alerts.length, 0)
  }
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
  subscription_id: SUB_UUID, status: 'pending_payment', attachable: true, external_reference: REF, billing_cycle: 'MONTHLY',
  // the database's D+30 (place_payment_checkout → place_trial_ends_at, #898): the EF does no date arithmetic
  billing_period: 3, next_amount_cents: 54000, renewal_amount_cents: 60000, next_due_date: '2026-11-03',
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

test('#898 BR-B2B-045 BR-B2B-046: card — MONTHLY subscription whose first fee (coupon included) is due on the database next_due_date; nothing charged now; access link sent', async () => {
  const asaas = fakeAsaas([
    at('GET', '/subscriptions?', 200, { data: [] }),
    at('GET', '/customers?', 200, { data: [] }),
    at('POST', '/customers', 200, { id: 'cus_1' }),
    at('POST', '/subscriptions', 200, { id: 'sub_new', status: 'ACTIVE', value: 540 }),
  ])
  const db = fakeDb({ place_payment_checkout: { data: [checkoutRow] }, attach_place_subscription: { data: 'pending_payment' } })
  const { d, links } = portal(asaas, db, owner())
  const r = await pay.checkout(d as never, checkoutBody)
  assert.deepEqual(r, { status: 200, body: { result: 'scheduled', first_charge_on: '2026-11-03' } })

  const created = asaas.calls.find((c) => c.method === 'POST' && c.path === '/subscriptions')!.body as Record<string, unknown>
  assert.equal(created.value, 540)
  assert.equal(created.cycle, 'MONTHLY')
  assert.equal(created.billingType, 'CREDIT_CARD')
  assert.equal(created.externalReference, REF)
  // Asaas charges on nextDueDate unless it is today (docs.asaas.com, criando-assinatura-com-cartao-de-credito)
  assert.equal(created.nextDueDate, '2026-11-03')
  assert.equal(created.remoteIp, '203.0.113.9')
  assert.equal((created.creditCardHolderInfo as Record<string, unknown>).email, 'ze@example.com')
  const customer = asaas.calls.find((c) => c.method === 'POST' && c.path === '/customers')!.body as Record<string, unknown>
  assert.equal(customer.cpfCnpj, '12345678000195')
  assert.equal(customer.externalReference, SUB_UUID)
  assert.equal(customer.notificationDisabled, true)

  // the ids come from the database (checkout row), never from the request
  assert.deepEqual(db.calls.map((c) => c.fn), ['place_payment_checkout', 'attach_place_subscription'])
  assert.equal(db.calls[1].args.p_subscription_id, SUB_UUID)
  assert.equal(db.calls[1].args.p_payment_method, 'credit_card')
  assert.equal(db.calls[1].args.p_provider_subscription_id, 'sub_new')
  // 20261007120000: attach has no date parameter (PostgREST rejects an unknown one)
  assert.deepEqual(Object.keys(db.calls[1].args).sort(), ['p_payment_method', 'p_provider_authorization_id', 'p_provider_customer_id', 'p_provider_subscription_id', 'p_subscription_id'])
  assert.deepEqual(links, [SUBMISSION])
  // nothing is charged, refunded, moved or read back
  assert.ok(!asaas.calls.some((c) => c.method === 'PUT' || c.method === 'DELETE' || c.path.startsWith('/payments')))
})

test('#898 BR-B2B-046 (SSOT): the first fee date is the database next_due_date as is — the EF keeps no "30 days"', async () => {
  assert.equal((pay as Record<string, unknown>).FREE_MONTH_DAYS, undefined)
  assert.equal((pay as Record<string, unknown>).firstChargeOn, undefined)
  const asaas = fakeAsaas([
    at('GET', '/subscriptions?', 200, { data: [] }),
    at('GET', '/customers?', 200, { data: [{ id: 'cus_1' }] }),
    at('POST', '/subscriptions', 200, { id: 'sub_new', status: 'ACTIVE', value: 540 }),
  ])
  const db = fakeDb({ place_payment_checkout: { data: [{ ...checkoutRow, next_due_date: '2026-11-17' }] }, attach_place_subscription: { data: 'pending_payment' } })
  const { d } = portal(asaas, db, owner())
  assert.deepEqual(await pay.checkout(d as never, checkoutBody), { status: 200, body: { result: 'scheduled', first_charge_on: '2026-11-17' } })
  assert.equal((asaas.calls.find((c) => c.method === 'POST' && c.path === '/subscriptions')!.body as Record<string, unknown>).nextDueDate, '2026-11-17')
})

test('#898 BR-B2B-047: an acceptance with no trial (next_due_date = today) is charged at once, as before — processing, no access link from the checkout', async () => {
  const asaas = fakeAsaas([
    at('GET', '/subscriptions?', 200, { data: [] }),
    at('GET', '/customers?', 200, { data: [{ id: 'cus_1' }] }),
    at('POST', '/subscriptions', 200, { id: 'sub_new', status: 'ACTIVE', value: 540 }),
    at('GET', '/payments?subscription=sub_new', 200, { data: [{ id: 'pay_1', status: 'PENDING', value: 540 }] }),
  ])
  const db = fakeDb({ place_payment_checkout: { data: [{ ...checkoutRow, next_due_date: '2026-10-04' }] }, attach_place_subscription: { data: 'pending_payment' } })
  const { d, links } = portal(asaas, db, owner())
  assert.deepEqual(await pay.checkout(d as never, checkoutBody), { status: 200, body: { result: 'processing' } })
  assert.equal((asaas.calls.find((c) => c.method === 'POST' && c.path === '/subscriptions')!.body as Record<string, unknown>).nextDueDate, '2026-10-04')
  assert.deepEqual(links, [])
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
  assert.deepEqual(r.body, { result: 'scheduled', first_charge_on: '2026-11-03' })
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

// §8.4 (operator 2026-10-06): cancelling ends the commitment at paid_through; the database prices the fee.
const cancelRow = (fee: number) => ({
  portal_cancel_renewal: { data: [{ outcome: 'applied', renews: false, commitment_ends_at: '2027-01-06T15:00:00Z', paid_through: '2027-01-06T15:00:00Z', early_termination_fee_cents: fee }] },
})
const cardIds = { subscription_id: SUB_UUID, payment_method: 'credit_card', provider_subscription_id: 'sub_1', provider_customer_id: 'cus_1', canceled_at: null }

function cancelPortal(asaas: ReturnType<typeof fakeAsaas>, db: ReturnType<typeof fakeDb>, user: ReturnType<typeof fakeDb>) {
  const x = portal(asaas, db, user)
  const mail = { subject: '', text: '', replyTo: undefined as string | undefined }
  ;(x.d as Record<string, unknown>).sendEmail = async (to: string, subject: string, text: string, replyTo?: string) => { x.sent.push(to); mail.subject = subject; mail.text = text; mail.replyTo = replyTo; return true }
  ;(x.d as Record<string, unknown>).subscriptionIds = async () => cardIds
  return { ...x, mail }
}

test('#863 §8.4 BR-B2B-055, BR-B2B-046: cancel quote — core.portal_cancel_quote with the user JWT, read-only, the five columns back', async () => {
  const asaas = fakeAsaas([])
  const db = fakeDb({})
  const user = fakeDb({ portal_cancel_quote: { data: [{ fee_cents: 13500, months_paid: 2, months_remaining: 4, service_ends_at: '2027-01-06T15:00:00Z', charge_on: '2027-01-06' }] } })
  const { d } = portal(asaas, db, user)
  const r = await pay.cancelQuote(d as never, SUBMISSION)
  assert.deepEqual(r, { status: 200, body: { quote: { fee_cents: 13500, months_paid: 2, months_remaining: 4, service_ends_at: '2027-01-06T15:00:00Z', charge_on: '2027-01-06' } } })
  assert.deepEqual(user.calls, [{ schema: 'core', fn: 'portal_cancel_quote', args: { p_submission_id: SUBMISSION } }])
  assert.equal(asaas.calls.length + db.calls.length, 0)
})

test('#863 §8.4: cancel quote — not the caller\'s (TGP01) 404, non-uuid 400 before the database, malformed row 502', async () => {
  const user = fakeDb({ portal_cancel_quote: { error: { code: 'TGP01' } } })
  const { d } = portal(fakeAsaas([]), fakeDb({}), user)
  assert.equal((await pay.cancelQuote(d as never, SUBMISSION)).status, 404)
  assert.equal((await pay.cancelQuote(d as never, 'x')).status, 400)
  assert.equal(user.calls.length, 1)
  const bad = portal(fakeAsaas([]), fakeDb({}), fakeDb({ portal_cancel_quote: { data: [{ fee_cents: -1 }] } }))
  assert.equal((await pay.cancelQuote(bad.d as never, SUBMISSION)).status, 502)
  const noDate = portal(fakeAsaas([]), fakeDb({}), fakeDb({ portal_cancel_quote: { data: [{ fee_cents: 13500, months_paid: 2, months_remaining: 4, service_ends_at: '2027-01-06T15:00:00Z', charge_on: null }] } }))
  assert.equal((await pay.cancelQuote(noDate.d as never, SUBMISSION)).status, 502)
})

test('#863 §8.4 BR-B2B-046 item 6: fee 0 (regret window, one-month plan) — charge_on null; no paid plan — the row of zeros goes back as is (the portal offers no confirm)', async () => {
  const free = portal(fakeAsaas([]), fakeDb({}), fakeDb({ portal_cancel_quote: { data: [{ fee_cents: 0, months_paid: 1, months_remaining: 5, service_ends_at: '2026-11-06T15:00:00Z', charge_on: null }] } }))
  assert.deepEqual((await pay.cancelQuote(free.d as never, SUBMISSION)).body, { quote: { fee_cents: 0, months_paid: 1, months_remaining: 5, service_ends_at: '2026-11-06T15:00:00Z', charge_on: null } })
  const none = portal(fakeAsaas([]), fakeDb({}), fakeDb({ portal_cancel_quote: { data: [{ fee_cents: 0, months_paid: 0, months_remaining: 0, service_ends_at: null, charge_on: null }] } }))
  assert.deepEqual(await pay.cancelQuote(none.d as never, SUBMISSION), { status: 200, body: { quote: { fee_cents: 0, months_paid: 0, months_remaining: 0, service_ends_at: null, charge_on: null } } })
})

test('#863 §8.4 BR-B2B-055, BR-B2B-046: cancel with fee 0 — endDate = eve of paid_through, no new fee; e-mail says when the story leaves and that nothing else is charged (term 4.5)', async () => {
  const asaas = fakeAsaas([at('PUT', '/subscriptions/sub_1', 200, {}), at('GET', '/payments?subscription=sub_1&status=PENDING', 200, { data: [] })])
  const db = fakeDb({})
  const user = fakeDb(cancelRow(0))
  const { d, sent, mail } = cancelPortal(asaas, db, user)
  const r = await pay.cancelRenewal(d as never, SUBMISSION)
  assert.deepEqual(r, { status: 200, body: { result: 'canceled' } })
  assert.deepEqual(user.calls, [{ schema: 'core', fn: 'portal_cancel_renewal', args: { p_submission_id: SUBMISSION } }])
  // the owner never reaches cancel_place_subscription(…'client') (§8.4)
  assert.deepEqual(db.calls, [])
  assert.deepEqual(asaas.calls.map((c) => `${c.method} ${c.path}`), ['PUT /subscriptions/sub_1', 'GET /payments?subscription=sub_1&status=PENDING'])
  assert.deepEqual(asaas.calls[0].body, { endDate: '2027-01-05' })
  assert.deepEqual(sent, ['ze@example.com'])
  assert.equal(mail.subject, 'Seu plano Com história foi cancelado')
  assert.equal(mail.replyTo, 'suporte@tuggi.app')
  assert.match(mail.text, /no ar até 06\/01\/2027/)
  assert.match(mail.text, /Você não terá mais nenhuma cobrança\./)
  assert.doesNotMatch(mail.text, /R\$/)
})

test('#863 §8.4 BR-B2B-046: card cancel with fee — the charge already generated for paid_through becomes the fee (value + updatePendingPayments) and the last (endDate = paid_through); a later pending one is deleted; e-mail says amount and date', async () => {
  const asaas = fakeAsaas([
    at('PUT', '/subscriptions/sub_1', 200, {}),
    at('GET', '/payments?subscription=sub_1&status=PENDING', 200, { data: [{ id: 'pay_a', status: 'PENDING', value: 82.5, dueDate: '2027-01-06' }, { id: 'pay_b', status: 'PENDING', value: 82.5, dueDate: '2027-02-06' }] }),
    at('DELETE', '/payments/pay_b', 200, { deleted: true }),
  ])
  const { d, alerts, mail } = cancelPortal(asaas, fakeDb({}), fakeDb(cancelRow(13500)))
  assert.deepEqual(await pay.cancelRenewal(d as never, SUBMISSION), { status: 200, body: { result: 'canceled' } })
  assert.deepEqual(asaas.calls.map((c) => `${c.method} ${c.path}`), [
    'PUT /subscriptions/sub_1',
    'GET /payments?subscription=sub_1&status=PENDING',
    'DELETE /payments/pay_b',
  ])
  assert.deepEqual(asaas.calls[0].body, { value: 135, endDate: '2027-01-06', updatePendingPayments: true })
  assert.deepEqual(alerts, [])
  assert.match(mail.text, /no ar até 06\/01\/2027/)
  assert.match(mail.text, /há uma última cobrança de R\$ 135,00, a diferença do desconto dos meses usados, no seu cartão em 06\/01\/2027/)
  assert.equal(mail.replyTo, 'suporte@tuggi.app')
})

test('#863 §8.4: Asaas down on cancel — the database is not undone, the operator is alerted, the owner still gets 200 and the e-mail still states the fee', async () => {
  const asaas = fakeAsaas([at('PUT', '/subscriptions/sub_1', 500, {})])
  const { d, alerts, mail } = cancelPortal(asaas, fakeDb({}), fakeDb(cancelRow(13500)))
  assert.deepEqual(await pay.cancelRenewal(d as never, SUBMISSION), { status: 200, body: { result: 'canceled' } })
  assert.ok(alerts.some((a) => a.what === 'cancel_fee_not_scheduled' && a.fields.reason === 'card_update' && a.fields.fee_cents === 13500))
  assert.match(mail.text, /R\$ 135,00/)
  const free = cancelPortal(fakeAsaas([at('PUT', '/subscriptions/sub_1', 500, {})]), fakeDb({}), fakeDb(cancelRow(0)))
  assert.deepEqual(await pay.cancelRenewal(free.d as never, SUBMISSION), { status: 200, body: { result: 'canceled' } })
  assert.ok(free.alerts.some((a) => a.what === 'cancel_end_date_failed'))
})

test('#863 §8.4: the cancel e-mail formats the fee like the portal (thousands, cents)', () => {
  assert.equal(pay.formatBrl(13500), 'R$ 135,00')
  assert.equal(pay.formatBrl(123456), 'R$ 1.234,56')
  assert.equal(pay.CANCEL_EMAIL.subject, 'Seu plano Com história foi cancelado')
})

const D = 'Se quiser voltar, o seu local continua cadastrado. É só entrar em https://partner.tuggi.app e contratar o plano Com história de novo.\n\nPode contar para a gente por que cancelou? Basta responder este e-mail. Uma linha já nos ajuda a melhorar.\n\nEquipe Tuggi'
const A = 'Olá,\n\nConfirmamos o cancelamento do seu plano Com história. Obrigado por ter mostrado o seu local aos turistas que usam o Tuggi, vamos sentir falta da sua história no app.'
const B_UNTIL = 'A história do seu local continua no ar até 06/01/2027. Depois disso, o local segue no mapa do app no plano No mapa, sem custo.'
const B_NONE = 'O local segue no mapa do app no plano No mapa, sem custo.'
const LAST = 'As mensalidades param aqui. Como o cancelamento veio antes do fim da fidelidade, há uma última cobrança de R$ 135,00, a diferença do desconto dos meses usados,'
const fee = (method: string, invoiceUrl: string | null = null) => ({ cents: 13500, chargeOn: '2027-01-06', method, invoiceUrl }) as never

test('#863 §8.4 BR-B2B-046: cancel e-mail (text approved 2026-10-08) — blocks A, B, C, D, E word for word, one per variant of C', () => {
  const t = (until: string | null, f: unknown) => pay.CANCEL_EMAIL.text(until, f as never)
  assert.equal(pay.CANCEL_EMAIL.subject, 'Seu plano Com história foi cancelado')
  assert.equal(pay.CANCEL_EMAIL.replyTo, 'suporte@tuggi.app')
  assert.equal(t('06/01/2027', null), [A, B_UNTIL, 'Você não terá mais nenhuma cobrança.', D].join('\n\n'))
  assert.equal(t(null, null), [A, B_NONE, 'Você não terá mais nenhuma cobrança.', D].join('\n\n'))
  assert.equal(
    t('06/01/2027', fee('credit_card')),
    [A, B_UNTIL, `${LAST} no seu cartão em 06/01/2027. Depois dela, nada mais é cobrado.`, D].join('\n\n'),
  )
  assert.equal(
    t('06/01/2027', fee('pix')),
    [A, B_UNTIL, `${LAST} por Pix, com vencimento em 06/01/2027. O código Pix chega por e-mail antes dessa data. Depois desse pagamento, nada mais é cobrado.`, D].join('\n\n'),
  )
  const auto = `${LAST} por Pix, com vencimento em 06/01/2027. O Pix Automático já foi encerrado, então esse valor não sai sozinho da sua conta.`
  assert.equal(
    t('06/01/2027', fee('pix_automatic', 'https://sandbox.asaas.com/i/abc')),
    [A, B_UNTIL, `${auto} Para pagar, abra https://sandbox.asaas.com/i/abc\nDepois desse pagamento, nada mais é cobrado.`, D].join('\n\n'),
  )
  assert.equal(
    t('06/01/2027', fee('pix_automatic')),
    [A, B_UNTIL, `${auto} O código Pix chega por e-mail antes dessa data.\nDepois desse pagamento, nada mais é cobrado.`, D].join('\n\n'),
  )
  // the old text said "nenhuma cobrança" twice; each variant now says the charge part once, and nothing old is left
  for (const text of [t(null, null), t('06/01/2027', fee('credit_card')), t('06/01/2027', fee('pix')), t('06/01/2027', fee('pix_automatic'))]) {
    assert.ok((text.match(/cobrança/g) ?? []).length <= 1, text)
    assert.doesNotMatch(text, /Cancelamos o seu|Nenhuma (outra|mensalidade)|cobramos uma única vez|Mandamos o código|Se mudar de ideia|pelo portal/)
  }
})

const freeMonthIds = { ...cardIds, status: 'pending_payment' }

test('#898 BR-B2B-046 item 9: cancel inside the free month (nothing paid, no paid_through) — the Asaas subscription and its pending first fee are deleted; the row is NOT cancelled (the story stays up to the end of the free month; the sweep ends it)', async () => {
  const asaas = fakeAsaas([at('DELETE', '/subscriptions/sub_1', 200, { deleted: true })])
  const db = fakeDb({})
  const user = fakeDb({ portal_cancel_renewal: { data: [{ outcome: 'applied', renews: false, commitment_ends_at: null, paid_through: null, early_termination_fee_cents: 0 }] } })
  const { d, mail, alerts } = cancelPortal(asaas, db, user)
  ;(d as Record<string, unknown>).subscriptionIds = async () => freeMonthIds
  assert.deepEqual(await pay.cancelRenewal(d as never, SUBMISSION), { status: 200, body: { result: 'canceled' } })
  assert.deepEqual(asaas.calls.map((c) => `${c.method} ${c.path}`), ['DELETE /subscriptions/sub_1'])
  assert.deepEqual(db.calls, [])
  assert.deepEqual(alerts, [])
  assert.match(mail.text, /Você não terá mais nenhuma cobrança\./)
  assert.doesNotMatch(mail.text, /R\$/)
})

test('#898: cancel inside the free month with Asaas down — the operator is alerted (the first fee would be charged on its date)', async () => {
  const asaas = fakeAsaas([at('DELETE', '/subscriptions/sub_1', 503, {})])
  const user = fakeDb({ portal_cancel_renewal: { data: [{ outcome: 'applied', renews: false, commitment_ends_at: null, paid_through: null, early_termination_fee_cents: 0 }] } })
  const { d, alerts } = cancelPortal(asaas, fakeDb({}), user)
  ;(d as Record<string, unknown>).subscriptionIds = async () => freeMonthIds
  assert.equal((await pay.cancelRenewal(d as never, SUBMISSION)).status, 200)
  assert.deepEqual(alerts.map((a) => a.what), ['cancel_free_month_failed'])
})

test('#898: cancel again inside the free month — the Asaas DELETE is redone (idempotent), no e-mail', async () => {
  const asaas = fakeAsaas([at('DELETE', '/subscriptions/sub_1', 404, {})])
  const user = fakeDb({ portal_cancel_renewal: { data: [{ outcome: 'not_applicable', renews: false, commitment_ends_at: null, paid_through: null }] } })
  const { d, alerts, mail } = cancelPortal(asaas, fakeDb({}), user)
  ;(d as Record<string, unknown>).subscriptionIds = async () => freeMonthIds
  assert.deepEqual(await pay.cancelRenewal(d as never, SUBMISSION), { status: 200, body: { result: 'not_renewing' } })
  assert.deepEqual(asaas.calls.map((c) => `${c.method} ${c.path}`), ['DELETE /subscriptions/sub_1'])
  assert.deepEqual(alerts, [])
  assert.equal(mail.text, '')
})

test('#898: a paid row with no paid_through yet is never deleted by a cancel (only a never-paid one is)', async () => {
  const asaas = fakeAsaas([])
  const user = fakeDb({ portal_cancel_renewal: { data: [{ outcome: 'applied', renews: false, commitment_ends_at: null, paid_through: null, early_termination_fee_cents: 0 }] } })
  const { d } = cancelPortal(asaas, fakeDb({}), user)
  ;(d as Record<string, unknown>).subscriptionIds = async () => ({ ...cardIds, status: 'paid' })
  assert.equal((await pay.cancelRenewal(d as never, SUBMISSION)).status, 200)
  assert.equal(asaas.calls.length, 0)
})

test('#898: the cancel e-mail of a Pix subscription says the Pix code arrives by e-mail, not that Pix Automático ended', () => {
  const text = pay.CANCEL_EMAIL.text('06/01/2027', { cents: 13500, chargeOn: '2027-01-06', method: 'pix', invoiceUrl: null })
  assert.match(text, /R\$ 135,00/)
  assert.match(text, /código Pix chega por e-mail/)
  assert.doesNotMatch(text, /Pix Automático/)
})

test('#863: cancel twice — not_applicable answers not_renewing and writes nothing at Asaas', async () => {
  const asaas = fakeAsaas([])
  const { d } = portal(asaas, fakeDb({}), fakeDb({ portal_cancel_renewal: { data: [{ outcome: 'not_applicable', renews: false, commitment_ends_at: null, paid_through: null }] } }))
  assert.deepEqual(await pay.cancelRenewal(d as never, SUBMISSION), { status: 200, body: { result: 'not_renewing' } })
  assert.equal(asaas.calls.length, 0)
})

// security-reviewer #863: the database took the cancel but the Asaas half did not land (failed, or the EF died).
const repeated = (fee: number) => ({
  portal_cancel_renewal: { data: [{ outcome: 'not_applicable', renews: false, commitment_ends_at: '2027-01-06T15:00:00Z', paid_through: '2027-01-06T15:00:00Z', early_termination_fee_cents: fee }] },
})
const cancelled = (fee: number | null, extra: Record<string, unknown> = {}) => ({ ...cardIds, early_termination_fee_cents: fee, early_termination_paid_at: null, ...extra })

test('#863 BR-B2B-046: cancel again on card with the fee unpaid — redoes the idempotent Asaas half (value = fee, updatePendingPayments, endDate = paid_through), no second e-mail', async () => {
  const asaas = fakeAsaas([
    at('PUT', '/subscriptions/sub_1', 200, {}),
    at('GET', '/payments?subscription=sub_1&status=PENDING', 200, { data: [{ id: 'pay_a', status: 'PENDING', value: 82.5, dueDate: '2027-01-06' }] }),
  ])
  const { d, sent, alerts } = cancelPortal(asaas, fakeDb({}), fakeDb(repeated(13500)))
  ;(d as Record<string, unknown>).subscriptionIds = async () => cancelled(13500)
  assert.deepEqual(await pay.cancelRenewal(d as never, SUBMISSION), { status: 200, body: { result: 'not_renewing' } })
  assert.deepEqual(asaas.calls.map((c) => `${c.method} ${c.path}`), ['PUT /subscriptions/sub_1', 'GET /payments?subscription=sub_1&status=PENDING'])
  assert.deepEqual(asaas.calls[0].body, { value: 135, endDate: '2027-01-06', updatePendingPayments: true })
  assert.deepEqual(sent, [])
  assert.deepEqual(alerts, [])
})

test('#863: cancel again with fee 0 — redoes endDate = eve of paid_through', async () => {
  const asaas = fakeAsaas([at('PUT', '/subscriptions/sub_1', 200, {}), at('GET', '/payments?subscription=sub_1&status=PENDING', 200, { data: [] })])
  const { d } = cancelPortal(asaas, fakeDb({}), fakeDb(repeated(0)))
  ;(d as Record<string, unknown>).subscriptionIds = async () => cancelled(0)
  assert.deepEqual(await pay.cancelRenewal(d as never, SUBMISSION), { status: 200, body: { result: 'not_renewing' } })
  assert.deepEqual(asaas.calls.map((c) => `${c.method} ${c.path} ${JSON.stringify(c.body)}`), ['PUT /subscriptions/sub_1 {"endDate":"2027-01-05"}', 'GET /payments?subscription=sub_1&status=PENDING undefined'])
})

test('#863: cancel again on Pix with the fee unpaid — ends the recurrence again (subscription + authorization), never a second one-off Pix', async () => {
  const asaas = fakeAsaas([at('DELETE', '/subscriptions/sub_1', 404, { errors: [] }), at('DELETE', '/pix/automatic/authorizations/aut_1', 400, { errors: [] })])
  const { d, alerts } = cancelPortal(asaas, fakeDb({}), fakeDb(repeated(13500)))
  ;(d as Record<string, unknown>).subscriptionIds = async () => cancelled(13500, { payment_method: 'pix_automatic', provider_authorization_id: 'aut_1' })
  assert.deepEqual(await pay.cancelRenewal(d as never, SUBMISSION), { status: 200, body: { result: 'not_renewing' } })
  assert.deepEqual(asaas.calls.map((c) => `${c.method} ${c.path}`), ['DELETE /subscriptions/sub_1', 'DELETE /pix/automatic/authorizations/aut_1'])
  assert.deepEqual(alerts, [])
})

test('#863: cancel again redoes nothing when the fee is paid, on Pix with fee paid, before 170000 (fee column null), with the subscription ended, or after paid_through', async () => {
  const cases: [string, number, Record<string, unknown>, string?][] = [
    ['fee paid', 13500, { early_termination_paid_at: '2027-01-06T12:00:00Z', early_termination_payment_id: 'pay_a' }],
    ['pix paid', 13500, { payment_method: 'pix_automatic', early_termination_paid_at: '2027-01-06T12:00:00Z' }],
    ['pre-170000', 0, { early_termination_fee_cents: null }],
    ['ended', 13500, { canceled_at: '2027-01-07T03:00:00Z' }],
    ['past paid_through', 13500, {}, '2027-01-07'],
  ]
  for (const [why, fee, extra, today] of cases) {
    const asaas = fakeAsaas([])
    const { d } = cancelPortal(asaas, fakeDb({}), fakeDb(repeated(fee)))
    ;(d as Record<string, unknown>).subscriptionIds = async () => cancelled(fee, extra)
    if (today) (d as Record<string, unknown>).today = () => today
    assert.deepEqual(await pay.cancelRenewal(d as never, SUBMISSION), { status: 200, body: { result: 'not_renewing' } }, why)
    assert.equal(asaas.calls.length, 0, why)
  }
})

test('#863 (20261006190000): the confirm sends the quoted fee as p_expected_fee_cents; TGP11 (fee moved) → 409 quote_changed, nothing at Asaas; absent → not sent; malformed → 400 before the database', async () => {
  const user = fakeDb(cancelRow(0))
  const asaas = fakeAsaas([at('PUT', '/subscriptions/sub_1', 200, {})])
  const { d } = cancelPortal(asaas, fakeDb({}), user)
  await pay.cancelRenewal(d as never, SUBMISSION, 0)
  assert.deepEqual(user.calls[0].args, { p_submission_id: SUBMISSION, p_expected_fee_cents: 0 })

  const moved = fakeDb({ portal_cancel_renewal: { error: { code: 'TGP11' } } })
  const m2 = cancelPortal(fakeAsaas([]), fakeDb({}), moved)
  assert.deepEqual(await pay.cancelRenewal(m2.d as never, SUBMISSION, 13500), { status: 409, body: { error: 'quote_changed' } })
  assert.deepEqual(moved.calls[0].args, { p_submission_id: SUBMISSION, p_expected_fee_cents: 13500 })
  assert.deepEqual(m2.sent, [])
  assert.deepEqual(m2.alerts, [])

  const plain = fakeDb(cancelRow(0))
  await pay.cancelRenewal(cancelPortal(fakeAsaas([at('PUT', '/subscriptions/sub_1', 200, {})]), fakeDb({}), plain).d as never, SUBMISSION, null)
  assert.deepEqual(plain.calls[0].args, { p_submission_id: SUBMISSION })

  const bad = fakeDb(cancelRow(0))
  const b = cancelPortal(fakeAsaas([]), fakeDb({}), bad)
  for (const v of [-1, 1.5, '135', true]) {
    assert.deepEqual(await pay.cancelRenewal(b.d as never, SUBMISSION, v), { status: 400, body: { error: 'invalid', field: 'expected_fee_cents' } })
  }
  assert.equal(bad.calls.length, 0)
})

test('#863: cancel of a submission that is not the caller\'s (TGP01) is a 404; a non-uuid is a 400 before the database', async () => {
  const user = fakeDb({ portal_cancel_renewal: { error: { code: 'TGP01' } } })
  const { d } = portal(fakeAsaas([]), fakeDb({}), user)
  assert.equal((await pay.cancelRenewal(d as never, SUBMISSION)).status, 404)
  assert.equal((await pay.cancelRenewal(d as never, 'x')).status, 400)
  assert.equal(user.calls.length, 1)
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

// ─── sweep: next fee amount ────────────────────────────────────────────────────────────────

// §8.5: renewal_amount_cents = the next fee's amount (voucher diluted in the 1st commitment)
const scheduleRow = { subscription_id: SUB_UUID, provider_subscription_id: 'sub_1', renewal_amount_cents: 12000 }

test('#863 §8.2, BR-B2B-046: the sweep moves value to the next fee and never touches nextDueDate', async () => {
  const asaas = fakeAsaas([
    at('GET', '/subscriptions/sub_1', 200, { id: 'sub_1', status: 'ACTIVE', value: 108, cycle: 'MONTHLY', nextDueDate: '2027-02-04' }),
    at('PUT', '/subscriptions/sub_1', 200, {}),
  ])
  const { d } = deps(asaas, fakeDb({}))
  assert.equal(await pay.alignRenewal(d, scheduleRow), true)
  assert.deepEqual(asaas.calls.find((c) => c.method === 'PUT')!.body, { value: 120, updatePendingPayments: true })
})

test('#811: a subscription with the right value is left alone (the sweep is idempotent)', async () => {
  const asaas = fakeAsaas([
    at('GET', '/subscriptions/sub_1', 200, { id: 'sub_1', status: 'ACTIVE', value: 120, cycle: 'MONTHLY', nextDueDate: '2027-02-06' }),
  ])
  const { d } = deps(asaas, fakeDb({}))
  assert.equal(await pay.alignRenewal(d, scheduleRow), false)
  assert.ok(!asaas.calls.some((c) => c.method !== 'GET'))
})

test('#863 BR-B2B-046 item 7, BR-B2B-055: commitment ending without renewal — the sweep DELETEs the Asaas subscription, then cancel_place_subscription(…system)', async () => {
  const asaas = fakeAsaas([at('DELETE', '/subscriptions/sub_7', 200, { deleted: true })])
  const db = fakeDb({
    place_pending_refunds: { data: [] },
    expire_place_subscriptions: { data: [] },
    place_commitments_ending: { data: [{ subscription_id: SUB_UUID, submission_id: SUBMISSION, payment_method: 'credit_card', provider_subscription_id: 'sub_7', commitment_ends_at: '2027-03-06T15:00:00Z', paid_through: '2027-03-06T15:00:00Z' }] },
    cancel_place_subscription: { data: [{ outcome: 'applied' }] },
    place_renewal_schedule: { data: [] },
  })
  const { d } = deps(asaas, db)
  const s = await pay.runSweep(d)
  assert.equal(s.ended, 1)
  assert.deepEqual(asaas.calls.map((c) => `${c.method} ${c.path}`), ['DELETE /subscriptions/sub_7'])
  const cancel = db.calls.find((c) => c.fn === 'cancel_place_subscription')!.args
  assert.deepEqual(cancel, { p_event_id: null, p_event_type: null, p_subscription_id: SUB_UUID, p_provider_subscription_id: null, p_actor_kind: 'system' })
  assert.deepEqual(db.calls.map((c) => c.fn), ['place_pending_refunds', 'expire_place_subscriptions', 'place_commitments_ending', 'cancel_place_subscription', 'place_renewal_schedule'])
})

test('#811: the sweep cancels an expired subscription in Asaas and in the database', async () => {
  const asaas = fakeAsaas([at('DELETE', '/subscriptions/sub_9', 200, { deleted: true })])
  const db = fakeDb({
    place_pending_refunds: { data: [] },
    expire_place_subscriptions: { data: [{ subscription_id: SUB_UUID, provider_subscription_id: 'sub_9', canceled_at: null }, { subscription_id: SUB_UUID, provider_subscription_id: 'sub_8', canceled_at: '2026-10-01' }] },
    cancel_place_subscription: { data: [{ outcome: 'applied' }] },
    place_commitments_ending: { data: [] },
    place_renewal_schedule: { data: [] },
  })
  const { d } = deps(asaas, db)
  const s = await pay.runSweep(d)
  assert.equal(s.expired, 1)
  assert.deepEqual(asaas.calls.map((c) => `${c.method} ${c.path}`), ['DELETE /subscriptions/sub_9'])
  assert.equal(db.calls.find((c) => c.fn === 'cancel_place_subscription')!.args.p_actor_kind, 'system')
})

test('#863 places-pagamento §3.3 BR-B2B-046 item 7 (20261006170000 D6): an expired CARD row with an unpaid fee keeps its Asaas subscription until the day after charge_on; then, or once paid, the DELETE runs', async () => {
  const card = (over: Record<string, unknown>) => ({ subscription_id: SUB_UUID, provider_subscription_id: 'sub_c', paid_through: '2026-10-04T15:00:00Z', early_termination_fee_cents: 13500, early_termination_paid_at: null, ...over })
  const sweep = async (today: string, rows: unknown[], expired: unknown[] = []) => {
    const asaas = fakeAsaas([at('DELETE', '/subscriptions/', 200, { deleted: true })])
    const db = fakeDb({
      place_pending_refunds: { data: [] },
      expire_place_subscriptions: { data: expired },
      cancel_place_subscription: { data: [{ outcome: 'applied' }] },
      place_commitments_ending: { data: [] },
      place_renewal_schedule: { data: [] },
    })
    const { d, alerts } = deps(asaas, db, { today: () => today, expiredLiveCards: async () => rows })
    return { s: await pay.runSweep(d), deletes: asaas.calls.filter((c) => c.method === 'DELETE').map((c) => c.path), db, alerts }
  }
  // the day it expires (= charge_on): the expire RPC hands the card row back, and it is held
  const day = await sweep('2026-10-04', [card({})], [{ subscription_id: SUB_UUID, payment_method: 'credit_card', provider_subscription_id: 'sub_c', canceled_at: null }])
  assert.deepEqual(day.deletes, [])
  assert.equal(day.s.fee_held, 1)
  assert.ok(!day.db.calls.some((c) => c.fn === 'cancel_place_subscription'))
  // the day after: unpaid is forgiven — DELETE, then cancel_place_subscription(…system)
  const after = await sweep('2026-10-05', [card({})])
  assert.deepEqual(after.deletes, ['/subscriptions/sub_c'])
  assert.equal(after.s.expired_card, 1)
  assert.equal(after.db.calls.find((c) => c.fn === 'cancel_place_subscription')!.args.p_actor_kind, 'system')
  // paid on the day, or no fee: nothing to hold
  assert.deepEqual((await sweep('2026-10-04', [card({ early_termination_paid_at: '2026-10-04T12:00:00Z' })])).deletes, ['/subscriptions/sub_c'])
  assert.deepEqual((await sweep('2026-10-04', [card({ early_termination_fee_cents: 0 })])).deletes, ['/subscriptions/sub_c'])
  // a read error leaves them for tomorrow, alerted; Pix rows of the expire RPC still end there
  const broken = await sweep('2026-10-04', [], [{ subscription_id: SUB_UUID, payment_method: 'pix_automatic', provider_subscription_id: 'sub_p', canceled_at: null }])
  assert.deepEqual(broken.deletes, ['/subscriptions/sub_p'])
})

test('#863 (20261006170000 D6): earlyTerminationFeeHeld compares São Paulo dates — paid_through 01:00Z is still the previous day there', () => {
  const r = { subscription_id: SUB_UUID, provider_subscription_id: 'sub_c', paid_through: '2026-10-05T01:00:00Z', early_termination_fee_cents: 13500, early_termination_paid_at: null }
  assert.equal(pay.earlyTerminationFeeHeld(r, '2026-10-04'), true)
  assert.equal(pay.earlyTerminationFeeHeld(r, '2026-10-05'), false)
  assert.equal(pay.earlyTerminationFeeHeld({ ...r, early_termination_fee_cents: null }, '2026-10-04'), false)
})

test('#863 (20261006170000 D6): the expired-cards read failing alerts and DELETEs nothing on card', async () => {
  const asaas = fakeAsaas([at('DELETE', '/subscriptions/', 200, { deleted: true })])
  const db = fakeDb({ place_pending_refunds: { data: [] }, expire_place_subscriptions: { data: [{ subscription_id: SUB_UUID, payment_method: 'credit_card', provider_subscription_id: 'sub_c', canceled_at: null }] }, place_commitments_ending: { data: [] }, place_renewal_schedule: { data: [] } })
  const { d, alerts } = deps(asaas, db, { expiredLiveCards: async () => { throw new Error('expired cards read 500') } })
  const s = await pay.runSweep(d)
  assert.equal(s.expired_card, 'db_error')
  assert.equal(asaas.calls.length, 0)
  assert.ok(alerts.some((a) => a.what === 'sweep_expired_cards_failed'))
})

// security-reviewer #863: the panel drops the button once the database cancelled, so the sweep redoes the Asaas half.
const sweepDb = () => fakeDb({ place_pending_refunds: { data: [] }, expire_place_subscriptions: { data: [] }, place_commitments_ending: { data: [] }, place_renewal_schedule: { data: [] } })
const redoRow = (over: Record<string, unknown> = {}) => ({
  ...cancelled(13500), status: 'active', provider_authorization_id: null, paid_through: '2027-01-06T15:00:00Z', ...over,
})

test('#863 places-portal-rascunho §8.4 BR-B2B-046: the sweep redoes a card cancel whose Asaas half did not land — value = fee, endDate = paid_through, later pendings deleted; the same every day', async () => {
  for (const day of ['2026-10-04', '2026-10-05', '2027-01-06']) {
    const asaas = fakeAsaas([
      at('PUT', '/subscriptions/sub_1', 200, {}),
      at('GET', '/payments?subscription=sub_1&status=PENDING', 200, { data: [{ id: 'pay_a', status: 'PENDING', dueDate: '2027-01-06' }, { id: 'pay_b', status: 'PENDING', dueDate: '2027-02-06' }] }),
      at('DELETE', '/payments/pay_b', 200, { deleted: true }),
    ])
    const { d, alerts } = deps(asaas, sweepDb(), { today: () => day, cancelsToRedo: async () => [redoRow()] })
    const s = await pay.runSweep(d)
    assert.equal(s.cancel_redone, 1, day)
    assert.deepEqual(asaas.calls.map((c) => `${c.method} ${c.path}`), ['PUT /subscriptions/sub_1', 'GET /payments?subscription=sub_1&status=PENDING', 'DELETE /payments/pay_b'], day)
    assert.deepEqual(asaas.calls[0].body, { value: 135, endDate: '2027-01-06', updatePendingPayments: true }, day)
    assert.ok(!asaas.calls.some((c) => c.method === 'POST'), day)
    assert.deepEqual(alerts, [], day)
  }
  // fee 0: endDate = eve of paid_through
  const zero = fakeAsaas([at('PUT', '/subscriptions/sub_1', 200, {}), at('GET', '/payments?subscription=sub_1&status=PENDING', 200, { data: [] })])
  await pay.runSweep(deps(zero, sweepDb(), { cancelsToRedo: async () => [redoRow({ early_termination_fee_cents: 0 })] }).d)
  assert.deepEqual(zero.calls.map((c) => `${c.method} ${c.path} ${JSON.stringify(c.body)}`), ['PUT /subscriptions/sub_1 {"endDate":"2027-01-05"}', 'GET /payments?subscription=sub_1&status=PENDING undefined'])
})

test('#863 §8.4: the sweep redoes nothing for a paid fee, an ended subscription, a pre-170000 row (fee null) or past paid_through', async () => {
  const cases: [string, Record<string, unknown>, string?][] = [
    ['paid', { early_termination_paid_at: '2027-01-06T12:00:00Z' }],
    ['ended', { canceled_at: '2027-01-07T03:00:00Z' }],
    ['pre-170000', { early_termination_fee_cents: null }],
    ['past paid_through', {}, '2027-01-07'],
  ]
  for (const [why, over, today] of cases) {
    const asaas = fakeAsaas([])
    const { d } = deps(asaas, sweepDb(), { cancelsToRedo: async () => [redoRow(over)], ...(today ? { today: () => today } : {}) })
    await pay.runSweep(d)
    assert.equal(asaas.calls.length, 0, why)
  }
})

test('#863 §8.4: on Pix the sweep only ends the recurrence again (404/400 = already gone) — never a one-off Pix', async () => {
  const asaas = fakeAsaas([at('DELETE', '/subscriptions/sub_1', 404, { errors: [] }), at('DELETE', '/pix/automatic/authorizations/aut_1', 400, { errors: [] })])
  const { d, alerts } = deps(asaas, sweepDb(), { cancelsToRedo: async () => [redoRow({ payment_method: 'pix_automatic', provider_authorization_id: 'aut_1' })] })
  const s = await pay.runSweep(d)
  assert.equal(s.cancel_redone, 1)
  assert.deepEqual(asaas.calls.map((c) => `${c.method} ${c.path}`), ['DELETE /subscriptions/sub_1', 'DELETE /pix/automatic/authorizations/aut_1'])
  assert.deepEqual(alerts, [])
})

test('#863 §8.4: the cancels-to-redo read failing alerts and the rest of the sweep still runs', async () => {
  const asaas = fakeAsaas([at('DELETE', '/subscriptions/', 200, { deleted: true })])
  const db = fakeDb({ place_pending_refunds: { data: [] }, expire_place_subscriptions: { data: [{ subscription_id: SUB_UUID, payment_method: 'pix_automatic', provider_subscription_id: 'sub_p', canceled_at: null }] }, cancel_place_subscription: { data: [{ outcome: 'applied' }] }, place_commitments_ending: { data: [] }, place_renewal_schedule: { data: [] } })
  const { d, alerts } = deps(asaas, db, { cancelsToRedo: async () => { throw new Error('cancels to redo read 500') } })
  const s = await pay.runSweep(d)
  assert.equal(s.cancel_redone, 'db_error')
  assert.equal(s.expired, 1)
  assert.ok(alerts.some((a) => a.what === 'sweep_cancel_redo_failed'))
})

// ─── #863: the cookie's checkout and the access link after the first charge ─────────────────────

const COOKIE = 'f'.repeat(64)
const draftRow = { submission_id: SUBMISSION, submission_status: 'awaiting_payment', ...checkoutRow }
const chargeRoutes = () => [
  at('GET', '/subscriptions?', 200, { data: [] }),
  at('GET', '/customers?', 200, { data: [] }),
  at('POST', '/customers', 200, { id: 'cus_1' }),
  at('POST', '/subscriptions', 200, { id: 'sub_new', status: 'ACTIVE', value: 540 }),
  at('GET', '/payments?subscription=sub_new', 200, { data: [{ id: 'pay_1', status: 'CONFIRMED', value: 540, dueDate: '2026-10-04' }] }),
  at('PUT', '/subscriptions/sub_new', 200, {}),
]

test('#863 (BR-B2B-043, BR-B2B-047): the cookie checkout takes the submission and every id from portal_draft_payment_checkout, never from the body', async () => {
  const asaas = fakeAsaas(chargeRoutes())
  const db = fakeDb({ portal_draft_payment_checkout: { data: [draftRow] }, attach_place_subscription: { data: 'pending_payment' } })
  const { d } = deps(asaas, db)
  const r = await pay.draftCheckout(d, { ...checkoutBody, submission_id: '00000000-0000-4000-8000-000000000000' }, COOKIE)
  assert.deepEqual(r, { status: 200, body: { result: 'scheduled', first_charge_on: '2026-11-03' } })
  assert.deepEqual(db.calls.map((c) => c.fn), ['portal_draft_payment_checkout', 'attach_place_subscription'])
  assert.deepEqual(db.calls[0].args, { p_token_sha256: COOKIE })
  assert.equal(db.calls[1].args.p_subscription_id, SUB_UUID)
  const created = asaas.calls.find((c) => c.method === 'POST' && c.path === '/subscriptions')!.body as Record<string, unknown>
  // Holder data still comes from the card form; the e-mail is the acceptance's, from the database.
  assert.equal((created.creditCardHolderInfo as Record<string, unknown>).phone, '22999998888')
  assert.equal((created.creditCardHolderInfo as Record<string, unknown>).email, 'ze@example.com')
})

test('#863: the cookie checkout of a draft not yet accepted, or of a plan with nothing to pay, is 409 not_payable and touches no Asaas', async () => {
  for (const [details, reason] of [['not_accepted', 'not_accepted'], ['in_review', 'in_review']]) {
    const asaas = fakeAsaas([])
    const { d } = deps(asaas, fakeDb({ portal_draft_payment_checkout: { error: { code: 'TGP10', details } } }))
    assert.deepEqual(await pay.draftCheckout(d, checkoutBody, COOKIE), { status: 409, body: { error: 'not_payable', reason } })
    assert.deepEqual(await pay.draftCheckoutPix(d, COOKIE), { status: 409, body: { error: 'not_payable', reason } })
    assert.equal(asaas.calls.length, 0)
  }
  const paid = deps(fakeAsaas([]), fakeDb({ portal_draft_payment_checkout: { data: [{ ...draftRow, status: 'paid', next_due_date: null }] } }))
  assert.deepEqual(await pay.draftCheckout(paid.d, checkoutBody, COOKIE), { status: 409, body: { error: 'not_payable', reason: 'paid' } })
  const gone = deps(fakeAsaas([]), fakeDb({ portal_draft_payment_checkout: { error: { code: 'TGP01' } } }))
  assert.equal((await pay.draftCheckoutPix(gone.d, COOKIE)).status, 404)
})

test('#863: a cookie hash out of shape, or a bad card, never reaches the database', async () => {
  const db = fakeDb({})
  const { d } = deps(fakeAsaas([]), db)
  assert.deepEqual(await pay.draftCheckoutPix(d, 'A'.repeat(64)), { status: 400, body: { error: 'invalid', field: 'token_sha256' } })
  assert.deepEqual(await pay.draftCheckout(d, { ...checkoutBody, card: { ...checkoutBody.card, number: '4111111111111112' } }, COOKIE), { status: 400, body: { error: 'invalid', field: 'card_number' } })
  assert.equal(db.calls.length, 0)
})

test('#863 (BR-B2B-047): the first charge that moves an ownerless submission to in_review sends the access link, once', async () => {
  const asaas = fakeAsaas([at('GET', '/payments/pay_1', 200, confirmedPayment)])
  const db = fakeDb({ confirm_place_charge: { data: [{ outcome: 'applied', submission_status: 'in_review' }] } })
  const seen: unknown[] = []
  const { d, links } = deps(asaas, db, {
    submissionOfSubscription: async (id: string | null, sub: string | null) => {
      seen.push([id, sub])
      return SUBMISSION
    },
  })
  const r = await pay.handleAsaasWebhook(d, TOKEN, TOKEN, { id: 'evt_1', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_1' } })
  assert.deepEqual(r, { status: 200, body: { outcome: 'applied' } })
  assert.deepEqual(seen, [[SUB_UUID, 'sub_1']])
  assert.deepEqual(links, [SUBMISSION])

  // The RECEIVED after the CONFIRMED of the same charge, a resend, a renewal: no second e-mail.
  for (const row of [{ outcome: 'duplicate_charge', submission_status: 'in_review' }, { outcome: 'duplicate_event' }, { outcome: 'applied', submission_status: 'approved' }]) {
    const x = deps(fakeAsaas([at('GET', '/payments/pay_1', 200, confirmedPayment)]), fakeDb({ confirm_place_charge: { data: [row] } }))
    await pay.handleAsaasWebhook(x.d, TOKEN, TOKEN, { id: 'evt_2', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1' } })
    assert.deepEqual(x.links, [], JSON.stringify(row))
  }
})

test('#863: an access link that fails after the charge is recorded is a 200 and an alert (a 500 would only resend a duplicate_event)', async () => {
  const asaas = fakeAsaas([at('GET', '/payments/pay_1', 200, confirmedPayment)])
  const db = fakeDb({ confirm_place_charge: { data: [{ outcome: 'applied', submission_status: 'in_review' }] } })
  const { d, alerts } = deps(asaas, db, { accessLink: async () => 'failed' })
  const r = await pay.handleAsaasWebhook(d, TOKEN, TOKEN, { id: 'evt_1', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_1' } })
  assert.equal(r.status, 200)
  assert.deepEqual(alerts.map((a) => a.what), ['access_link_failed'])
  assert.ok(!JSON.stringify(alerts).includes('@'))
  // Already owned (paid signed in): nothing to send, nothing to alert.
  const owned = deps(fakeAsaas([at('GET', '/payments/pay_1', 200, confirmedPayment)]), fakeDb({ confirm_place_charge: { data: [{ outcome: 'applied', submission_status: 'in_review' }] } }), { accessLink: async () => 'owned' })
  await pay.handleAsaasWebhook(owned.d, TOKEN, TOKEN, { id: 'evt_1', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_1' } })
  assert.equal(owned.alerts.length, 0)
})

test('parseCardInput aceita o cartão de aprovação do sandbox do Asaas, que não passa no Luhn (#811)', async () => {
  const { parseCardInput } = pay;
  const body = { card: { number: '4444 4444 4444 4444', holder_name: 'Teste', expiry_month: '12', expiry_year: '2034', ccv: '123' }, holder: { tax_id: '52998224725', postal_code: '05424150', address_number: '215', phone: '11994718890' }, remote_ip: '1.1.1.1' };
  const ok = parseCardInput(body, '2026-10-06') as Record<string, unknown>;
  assert.notEqual(ok.invalid, 'card_number');
  const bad = parseCardInput({ ...body, card: { ...body.card, number: '4444 4444 4444 4445' } }, '2026-10-06') as Record<string, unknown>;
  assert.equal(bad.invalid, 'card_number');
});

test('#898 BR-B2B-046 BR-B2B-019: the free month that was never paid (paid_at and paid_through null) expires like a card row — the Asaas subscription is ended (404 = already deleted by a cancel), the row cancelled by the system, no e-mail', async () => {
  const asaas = fakeAsaas([at('DELETE', '/subscriptions/sub_t', 404, {})])
  const trial = { subscription_id: SUB_UUID, payment_method: 'pix', provider_subscription_id: 'sub_t', canceled_at: null, paid_through: null }
  const db = fakeDb({
    place_pending_refunds: { data: [] },
    expire_place_subscriptions: { data: [trial] },
    cancel_place_subscription: { data: [{ outcome: 'applied' }] },
    place_commitments_ending: { data: [] },
    place_renewal_schedule: { data: [] },
  })
  const sent: string[] = []
  const { d, alerts } = deps(asaas, db, {
    expiredLiveCards: async () => [{ ...trial, early_termination_fee_cents: null, early_termination_paid_at: null }],
    sendEmail: async (to: string) => { sent.push(to); return true },
  })
  const s = await pay.runSweep(d as never)
  assert.equal(s.expired, 0)   // charged by the subscription: left to expiredLiveCards
  assert.equal(s.expired_card, 1)
  assert.deepEqual(asaas.calls.map((c) => `${c.method} ${c.path}`), ['DELETE /subscriptions/sub_t'])
  assert.deepEqual(db.calls.filter((c) => c.fn === 'cancel_place_subscription').map((c) => c.args.p_actor_kind), ['system'])
  assert.deepEqual(alerts, [])
  assert.deepEqual(sent, [])
})

// ─── #904: payout Pix key ──────────────────────────────────────────────────────────────────────

test('#904 BR-B2B-044: confirm_pix_key writes through the owner RPC and sends the anti-fraud e-mail every time', async () => {
  const asaas = fakeAsaas([])
  const user = fakeDb({
    portal_confirm_payout_pix_key: { data: '12345678000195' },
    portal_get_submission: { data: [{ answers: { representative_name: 'José da Silva', trade_name: 'Bar do Zé' } }] },
  })
  const x = portal(asaas, fakeDb({}), user)
  const mail = { subject: '', text: '', args: 0 }
  ;(x.d as Record<string, unknown>).sendEmail = async (to: string, subject: string, text: string, ...rest: unknown[]) => { x.sent.push(to); mail.subject = subject; mail.text = text; mail.args = 3 + rest.length; return true }
  const r = await pay.confirmPixKey(x.d as never, SUBMISSION)
  assert.equal(r.status, 200)
  assert.deepEqual(r.body, { result: 'confirmed', pix_key: '12345678000195' })
  // reply_to is only the cancel e-mail's: this one is sent with the three arguments
  assert.equal(mail.args, 3)
  assert.deepEqual(user.calls[0], { schema: 'core', fn: 'portal_confirm_payout_pix_key', args: { p_submission_id: SUBMISSION } })
  assert.deepEqual(x.sent, ['ze@example.com'])
  assert.equal(mail.subject, 'Chave Pix confirmada no portal Tuggi')
  // 2026-10-04T12:00Z = 09:00 in São Paulo
  assert.match(mail.text, /^Olá, José\.\n/)
  assert.match(mail.text, /A chave Pix CNPJ 12\.345\.678\/0001-95 foi confirmada no portal do Bar do Zé em 04\/10\/2026, às 09:00\./)
  assert.equal(asaas.calls.length, 0)
})

test('#904: confirm_pix_key maps TGP01 → 404 and TGP10 → 409 without e-mail', async () => {
  for (const [code, status] of [['TGP01', 404], ['TGP10', 409]] as const) {
    const x = portal(fakeAsaas([]), fakeDb({}), fakeDb({ portal_confirm_payout_pix_key: { error: { code, details: 'not_paid_plan' } } }))
    const r = await pay.confirmPixKey(x.d as never, SUBMISSION)
    assert.equal(r.status, status)
    assert.equal(x.sent.length, 0)
  }
})
