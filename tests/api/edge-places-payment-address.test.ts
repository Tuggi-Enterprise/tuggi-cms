/**
 * #914 — the Pix loop and the customer without an address, against `docs/contracts/places-pagamento.md`
 * (workspace) §3.1 and BR-B2B-046. Same harness as `edge-places-payment-pix.test.ts`: the real Asaas
 * client, `fetch` mocked, Deno source loaded through a path built at run time (a static `.ts` import
 * fails the repo's `tsc`).
 *
 * Run with: npm run test:api
 */

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const SHARED = resolve(import.meta.dirname, '../../supabase/functions/_shared')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Module = any
let pay: Module
let inv: Module
let asaasMod: Module

before(async () => {
  pay = await import(pathToFileURL(resolve(SHARED, 'places-payment.ts')).href)
  inv = await import(pathToFileURL(resolve(SHARED, 'places-invoice.ts')).href)
  asaasMod = await import(pathToFileURL(resolve(SHARED, 'asaas.ts')).href)
})

const SUB_UUID = '11111111-2222-4333-8444-555555555555'
const SUBMISSION = '99999999-8888-4777-8666-555555555555'
const REF = `com_historia_3m:${SUB_UUID}`
const ADDRESS = { postal_code: '28950-000', address_number: '12' }
const CEP_REFUSED = { errors: [{ code: 'invalid_action', description: 'Endereço do cliente incompleto.; CEP do cliente é inválido.' }] }

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
    if (call.method === 'GET' && call.path.startsWith('/invoices?')) return new Response(JSON.stringify({ data: [], hasMore: false }), { status: 200 })
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
    user: fakeDb({ portal_get_subscription: { data: [{ submission_id: SUBMISSION, status: 'pending_payment', renews: false }] } }).rpc,
    userEmail: async () => 'ze@example.com',
    sendEmail: async () => true,
    accessLink: async (id: string) => (links.push(id), 'sent' as const),
    invoiceConfig: { serviceCode: '1.03', serviceName: 'Processamento de dados', issRate: 2.5 },
    invoiceStatusOf: async () => null,
    invoiceTargets: async () => [],
    sentPayouts: async () => [],
    ...extra,
  }
  return { d, alerts, links }
}

const checkoutRow = {
  subscription_id: SUB_UUID, status: 'pending_payment', attachable: true, external_reference: REF, billing_cycle: 'MONTHLY',
  billing_period: 3, next_amount_cents: 54000, renewal_amount_cents: 60000, next_due_date: '2026-11-03',
  customer_name: 'Bar do Zé LTDA', customer_tax_id: '12.345.678/0001-95', customer_email: 'ze@example.com',
}
const checkoutDb = (over: Record<string, unknown> = {}) =>
  fakeDb({ place_payment_checkout: { data: [{ ...checkoutRow, ...over }] }, attach_place_subscription: { data: 'pending_payment' } })
const pixBody = (address: unknown = ADDRESS) => ({ submission_id: SUBMISSION, address })
const cardBody = {
  submission_id: SUBMISSION,
  card: { number: '4111 1111 1111 1111', holder_name: 'Jose da Silva', expiry_month: '12', expiry_year: '2030', ccv: '123' },
  holder: { cpf_cnpj: '12345678909', postal_code: '05424-150', address_number: '215', phone: '22999998888' },
  remote_ip: '203.0.113.9',
}

// ─── item 2: the customer is born with CEP and number, in every method ─────────────────────────

test('#914 BR-B2B-046: checkout_pix creates the Asaas customer with the CEP and number of the body', async () => {
  const asaas = fakeAsaas([
    at('GET', '/subscriptions?', 200, { data: [] }),
    at('GET', '/customers?', 200, { data: [] }),
    at('POST', '/customers', 200, { id: 'cus_1' }),
    at('PUT', '/customers/cus_1', 200, { id: 'cus_1' }),
    at('POST', '/subscriptions', 200, { id: 'sub_px', status: 'ACTIVE', value: 540 }),
  ])
  const { d, alerts } = deps(asaas, checkoutDb())
  assert.equal((await pay.checkoutPix(d, pixBody())).status, 200)
  const customer = asaas.calls.find((c) => c.method === 'POST' && c.path === '/customers')!.body as Record<string, unknown>
  assert.equal(customer.postalCode, '28950000')
  assert.equal(customer.addressNumber, '12')
  assert.deepEqual(alerts, [])
})

test('#914 BR-B2B-046: the card checkout creates the customer with the holder CEP and number', async () => {
  const asaas = fakeAsaas([
    at('GET', '/subscriptions?', 200, { data: [] }),
    at('GET', '/customers?', 200, { data: [] }),
    at('POST', '/customers', 200, { id: 'cus_1' }),
    at('POST', '/subscriptions', 200, { id: 'sub_c', status: 'ACTIVE', value: 540 }),
  ])
  const { d } = deps(asaas, checkoutDb())
  assert.equal((await pay.checkout(d, cardBody)).status, 200)
  const customer = asaas.calls.find((c) => c.method === 'POST' && c.path === '/customers')!.body as Record<string, unknown>
  assert.equal(customer.postalCode, '05424150')
  assert.equal(customer.addressNumber, '215')
})

test('#914: a customer found without an address is updated (PUT) before the subscription', async () => {
  const asaas = fakeAsaas([
    at('GET', '/subscriptions?', 200, { data: [] }),
    at('GET', '/customers?', 200, { data: [{ id: 'cus_1' }] }),
    at('PUT', '/customers/cus_1', 200, { id: 'cus_1' }),
    at('POST', '/subscriptions', 200, { id: 'sub_px', status: 'ACTIVE', value: 540 }),
  ])
  const { d, alerts } = deps(asaas, checkoutDb())
  assert.equal((await pay.checkoutPix(d, pixBody())).status, 200)
  const order = paths(asaas)
  const addressPut = asaas.calls.findIndex((c) => c.method === 'PUT' && (c.body as Record<string, unknown>).postalCode !== undefined)
  assert.ok(addressPut >= 0, 'the address PUT was sent')
  assert.deepEqual(asaas.calls[addressPut].body, { postalCode: '28950000', addressNumber: '12' })
  assert.ok(addressPut < order.indexOf('POST /subscriptions'))
  assert.deepEqual(alerts, [])
})

test('#914: a customer that already has this CEP and number is not written again', async () => {
  const asaas = fakeAsaas([
    at('GET', '/subscriptions?', 200, { data: [] }),
    at('GET', '/customers?', 200, { data: [{ id: 'cus_1', postalCode: '28950000', addressNumber: '12' }] }),
    at('POST', '/subscriptions', 200, { id: 'sub_c', status: 'ACTIVE', value: 540 }),
  ])
  const { d } = deps(asaas, checkoutDb())
  assert.equal((await pay.checkout(d, { ...cardBody, holder: { ...cardBody.holder, postal_code: '28950000', address_number: '12' } })).status, 200)
  assert.ok(!asaas.calls.some((c) => c.method === 'PUT' && c.path === '/customers/cus_1'))
})

test('#914: checkout_pix without a valid CEP or number is 400 with the field, before the database and Asaas', async () => {
  for (const [address, field] of [[null, 'postal_code'], [{ postal_code: '2895', address_number: '12' }, 'postal_code'], [{ postal_code: '28950000', address_number: ' ' }, 'address_number']] as const) {
    const asaas = fakeAsaas([])
    const db = checkoutDb()
    const { d } = deps(asaas, db)
    assert.deepEqual(await pay.checkoutPix(d, pixBody(address)), { status: 400, body: { error: 'invalid', field } })
    assert.deepEqual(await pay.draftCheckoutPix(d, { address }, 'f'.repeat(64)), { status: 400, body: { error: 'invalid', field } })
    assert.equal(asaas.calls.length, 0)
    assert.equal(db.calls.length, 0)
  }
})

// ─── item 3: the customer's data refused → what to fix, nothing created ────────────────────────

test('#914: Asaas refusing the customer CEP is 422 customer_data + postal_code, and no subscription is created', async () => {
  const asaas = fakeAsaas([
    at('GET', '/subscriptions?', 200, { data: [] }),
    at('GET', '/customers?', 200, { data: [{ id: 'cus_1' }] }),
    at('PUT', '/customers/cus_1', 400, { errors: [{ code: 'invalid_postalCode', description: 'O CEP informado é inválido.' }] }),
  ])
  const db = checkoutDb()
  const { d, alerts } = deps(asaas, db)
  assert.deepEqual(await pay.checkoutPix(d, pixBody()), { status: 422, body: { error: 'customer_data', field: 'postal_code' } })
  assert.ok(!asaas.calls.some((c) => c.method === 'POST' && c.path === '/subscriptions'))
  assert.ok(!db.calls.some((c) => c.fn === 'attach_place_subscription'))
  assert.deepEqual(alerts.map((a) => a.what), ['customer_data_refused'])
})

test('#914: a refusal that names no field the payer can fix is 422 customer_data with field null', async () => {
  const asaas = fakeAsaas([
    at('GET', '/subscriptions?', 200, { data: [] }),
    at('GET', '/customers?', 200, { data: [] }),
    at('POST', '/customers', 400, { errors: [{ code: 'invalid_cpfCnpj', description: 'O CPF/CNPJ informado é inválido.' }] }),
  ])
  const { d } = deps(asaas, checkoutDb())
  assert.deepEqual(await pay.checkout(d, cardBody), { status: 422, body: { error: 'customer_data', field: null } })
})

// ─── item 1: the paid charge activates the plan, the invoice never blocks it ───────────────────

test('#914 BR-B2B-046: paying again after a lost webhook records the charge already PAID at Asaas, so the page leaves "aguardando"', async () => {
  const asaas = fakeAsaas([
    at('GET', '/subscriptions?', 200, { data: [{ id: 'sub_old', status: 'ACTIVE', value: 540, customer: 'cus_1', billingType: 'PIX' }] }),
    at('GET', '/payments?subscription=sub_old', 200, {
      data: [{ id: 'pay_1', status: 'RECEIVED', value: 540, subscription: 'sub_old', externalReference: REF, paymentDate: '2026-10-04' }],
    }),
  ])
  const db = fakeDb({
    place_payment_checkout: { data: [{ ...checkoutRow, next_due_date: '2026-10-04' }] },
    attach_place_subscription: { data: 'pending_payment' },
    confirm_place_charge: { data: [{ outcome: 'applied', subscription_status: 'paid', submission_status: 'in_review' }] },
  })
  const { d, alerts, links } = deps(asaas, db)
  assert.deepEqual(await pay.checkoutPix(d, pixBody()), { status: 200, body: { result: 'paid' } })
  const confirm = db.calls.find((c) => c.fn === 'confirm_place_charge')
  assert.ok(confirm, 'the paid charge is recorded by the checkout, not only by the webhook')
  assert.equal(confirm!.args.p_provider_payment_id, 'pay_1')
  assert.equal(confirm!.args.p_subscription_id, SUB_UUID)
  assert.equal(confirm!.args.p_provider_subscription_id, 'sub_old')
  assert.equal(confirm!.args.p_amount_cents, 54000)
  // no event id: the webhook that arrives later claims its own and finds a duplicate_charge
  assert.equal(confirm!.args.p_event_id, null)
  assert.ok(!asaas.calls.some((c) => c.method === 'POST' && c.path === '/subscriptions'), 'nothing charged again')
  assert.deepEqual(links, [SUBMISSION])
  assert.deepEqual(alerts, [])
})

test('#914: a database refusal of that record alerts and still answers paid (the webhook remains the other way in)', async () => {
  const asaas = fakeAsaas([
    at('GET', '/subscriptions?', 200, { data: [{ id: 'sub_old', status: 'ACTIVE', value: 540, customer: 'cus_1', billingType: 'PIX' }] }),
    at('GET', '/payments?subscription=sub_old', 200, { data: [{ id: 'pay_1', status: 'CONFIRMED', value: 540 }] }),
  ])
  const db = fakeDb({
    place_payment_checkout: { data: [checkoutRow] },
    attach_place_subscription: { data: 'pending_payment' },
    confirm_place_charge: { error: { code: '40001' } },
  })
  const { d, alerts } = deps(asaas, db)
  assert.deepEqual(await pay.checkoutPix(d, pixBody()), { status: 200, body: { result: 'paid' } })
  assert.deepEqual(alerts.map((a) => a.what), ['checkout_confirm_failed'])
})

test('#914 BR-B2B-046: no checkout path calls anything of the invoice: new Pix, card, and the paid subscription the checkout records', async () => {
  const noInvoice = (a: { calls: { path: string }[] }) => assert.ok(!a.calls.some((c) => c.path.toLowerCase().includes('invoice')), a.calls.map((c) => c.path).join(' | '))
  const fresh = () => fakeAsaas([
    at('GET', '/subscriptions?', 200, { data: [] }),
    at('GET', '/customers?', 200, { data: [{ id: 'cus_1', postalCode: '28950000', addressNumber: '12' }] }),
    at('PUT', '/customers/cus_1', 200, { id: 'cus_1' }),
    at('POST', '/subscriptions', 200, { id: 'sub_px', status: 'ACTIVE', value: 540 }),
  ])
  const pix = fresh()
  assert.equal((await pay.checkoutPix(deps(pix, checkoutDb()).d, pixBody())).status, 200)
  noInvoice(pix)
  const card = fresh()
  assert.equal((await pay.checkout(deps(card, checkoutDb()).d, { ...cardBody, holder: { ...cardBody.holder, postal_code: '28950000', address_number: '12' } })).status, 200)
  noInvoice(card)
  const paid = fakeAsaas([
    at('GET', '/subscriptions?', 200, { data: [{ id: 'sub_old', status: 'ACTIVE', value: 540, customer: 'cus_1', billingType: 'PIX' }] }),
    at('GET', '/payments?subscription=sub_old', 200, { data: [{ id: 'pay_1', status: 'RECEIVED', value: 540, subscription: 'sub_old', externalReference: REF, paymentDate: '2026-10-04' }] }),
  ])
  const db = fakeDb({
    place_payment_checkout: { data: [{ ...checkoutRow, next_due_date: '2026-10-04' }] },
    attach_place_subscription: { data: 'pending_payment' },
    confirm_place_charge: { data: [{ outcome: 'applied', subscription_status: 'paid', submission_status: 'in_review' }] },
  })
  assert.deepEqual(await pay.checkoutPix(deps(paid, db).d, pixBody()), { status: 200, body: { result: 'paid' } })
  noInvoice(paid)
})

test('#914: a one-off charge whose invoice lookup is refused is not a 500 (a 500 would be resent until the Asaas queue pauses)', async () => {
  const asaas = fakeAsaas([at('GET', '/invoices?', 400, CEP_REFUSED)])
  const { d, alerts } = deps(asaas, fakeDb({}))
  const r = await inv.ensurePaymentInvoice(d, { id: 'pay_fee', status: 'RECEIVED', value: 120 }, SUB_UUID)
  assert.equal(r, 'failed')
  assert.deepEqual(alerts.map((a) => a.what), ['invoice_not_scheduled'])
  // a transient failure still throws, so the webhook answers 500 and Asaas resends
  const down = fakeAsaas([at('GET', '/invoices?', 503, {})])
  await assert.rejects(inv.ensurePaymentInvoice(deps(down, fakeDb({})).d, { id: 'pay_fee', status: 'RECEIVED', value: 120 }, SUB_UUID))
})

// ─── item 4: the alert says what Asaas said ────────────────────────────────────────────────────

test('#914: AsaasError keeps the description next to the code, with e-mails and digit runs masked', () => {
  const e = new asaasMod.AsaasError(400, ['invalid_email'], [asaasMod.safeDescription('O e-mail ze@example.com do CPF 123.456.789-09 é inválido.')])
  assert.equal(e.message, 'asaas 400 invalid_email: O e-mail [email] do CPF [n] é inválido.')
  assert.equal(new asaasMod.AsaasError(0, []).message, 'asaas 0')
  assert.equal(asaasMod.safeDescription('CEP do cliente é inválido.'), 'CEP do cliente é inválido.')
})
