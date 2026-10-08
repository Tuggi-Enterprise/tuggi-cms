/**
 * #901 — NFS-e of the Com história plan (`_shared/places-invoice.ts`), against
 * `docs/contracts/places-pagamento.md` §3.5 (workspace). Minimal: the status mapping into
 * `partner.record_place_invoice`. Full coverage is the qa's.
 *
 * Deno source, loaded through a path built at run time: a static `.ts` import fails the repo's `tsc`.
 */

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let inv: any

before(async () => {
  inv = await import(pathToFileURL(resolve(import.meta.dirname, '../../supabase/functions/_shared/places-invoice.ts')).href)
})

const SUB_UUID = '11111111-2222-4333-8444-555555555555'

test('#901 BR-B2B-046: every Asaas invoice status maps 1:1 to the mirror; an unknown one is null, never a guess', () => {
  for (const s of ['SCHEDULED', 'SYNCHRONIZED', 'AUTHORIZED', 'PROCESSING_CANCELLATION', 'CANCELED', 'CANCELLATION_DENIED', 'ERROR']) {
    assert.equal(inv.invoiceStatus(s), s)
  }
  assert.equal(inv.invoiceStatus(' authorized '), 'AUTHORIZED')
  assert.equal(inv.invoiceStatus('CANCELLED'), null)
  assert.equal(inv.invoiceStatus('PENDING'), null)
  assert.equal(inv.invoiceStatus(undefined), null)
})

test('#901 BR-B2B-046: record_place_invoice args come from the re-read invoice; no payment → nothing to record', () => {
  const a = inv.invoiceRecordArgs(
    { id: 'inv_1', status: 'AUTHORIZED', payment: 'pay_1', externalReference: SUB_UUID, value: 99.9, effectiveDate: '2026-10-31', number: '42', pdfUrl: 'https://x/pdf', xmlUrl: null, statusDescription: '' },
    'AUTHORIZED',
  )
  assert.deepEqual(a, {
    p_provider_invoice_id: 'inv_1',
    p_provider_payment_id: 'pay_1',
    p_subscription_id: SUB_UUID,
    p_status: 'AUTHORIZED',
    p_number: '42',
    p_pdf_url: 'https://x/pdf',
    p_xml_url: null,
    p_effective_date: '2026-10-31',
    p_status_description: null,
    p_amount_cents: 9990,
  })
  assert.equal(inv.invoiceRecordArgs({ id: 'inv_2', status: 'SCHEDULED', payment: null }, 'SCHEDULED'), null)
})

test('#901: the invoice secrets are all-or-nothing, and the ISS rate stays within 0–5 %', () => {
  const env = (o: Record<string, string>) => (n: string) => o[n]
  const full = { ASAAS_INVOICE_SERVICE_CODE: '1.03', ASAAS_INVOICE_SERVICE_NAME: 'Processamento de dados', ASAAS_INVOICE_ISS_RATE: '2,5' }
  assert.deepEqual(inv.parseInvoiceConfig(env(full)), { serviceCode: '1.03', serviceName: 'Processamento de dados', issRate: 2.5 })
  assert.equal(inv.parseInvoiceConfig(env({ ...full, ASAAS_INVOICE_ISS_RATE: '' })), null)
  assert.equal(inv.parseInvoiceConfig(env({ ...full, ASAAS_INVOICE_ISS_RATE: '25' })), null)
  assert.equal(inv.parseInvoiceConfig(env({ ...full, ASAAS_INVOICE_SERVICE_CODE: ' ' })), null)
})

// ─── harness (same as edge-places-payment-pix.test.ts: the real Asaas client over a mocked fetch) ───────────

const SHARED = resolve(import.meta.dirname, '../../supabase/functions/_shared')
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pay: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let asaasMod: any

before(async () => {
  pay = await import(pathToFileURL(resolve(SHARED, 'places-payment.ts')).href)
  asaasMod = await import(pathToFileURL(resolve(SHARED, 'asaas.ts')).href)
})

const SUBMISSION = '99999999-8888-4777-8666-555555555555'
// #914: the payer's CEP and number, sent by every Pix checkout (the card sends them in `holder`)
const ADDRESS = { postal_code: '28950-000', address_number: '12' }
const REF = `com_historia_3m:${SUB_UUID}`
const TOKEN = 'whk-token-123'
const CFG = { serviceCode: '1.03', serviceName: 'Processamento de dados', issRate: 2.5 }

type Call = { method: string; path: string; body: unknown }
type Route = (c: Call) => { status: number; body: unknown } | undefined

function fakeAsaas(routes: Route[], log: string[] = []) {
  const calls: Call[] = []
  const fetch = async (url: string, init: RequestInit) => {
    const u = new URL(url)
    const call = { method: init.method ?? 'GET', path: decodeURIComponent(u.pathname.replace(/^\/v3/, '') + u.search), body: init.body ? JSON.parse(String(init.body)) : undefined }
    calls.push(call)
    log.push(`asaas ${call.method} ${call.path}`)
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
/** GET /invoices?...<needle>... (the client puts limit first, so a prefix does not match). */
const invList = (needle: string, status: number, body: unknown): Route => (c) =>
  c.method === 'GET' && c.path.startsWith('/invoices?') && c.path.includes(needle) ? { status, body } : undefined
const posts = (a: { calls: Call[] }, prefix: string) => a.calls.filter((c) => c.method === 'POST' && c.path.startsWith(prefix))

type RpcCall = { schema: string; fn: string; args: Record<string, unknown> }
function fakeDb(answers: Record<string, { data?: unknown; error?: { code?: string; details?: string } | null }>, log: string[] = []) {
  const calls: RpcCall[] = []
  const rpc = async (schema: string, fn: string, args: Record<string, unknown>) => {
    calls.push({ schema, fn, args })
    log.push(`db ${fn}`)
    const a = answers[fn] ?? { data: null }
    return { data: a.data ?? null, error: a.error ?? null }
  }
  return { rpc, calls }
}

function deps(asaas: ReturnType<typeof fakeAsaas>, db: ReturnType<typeof fakeDb>, extra: Record<string, unknown> = {}) {
  const alerts: { what: string; fields: Record<string, unknown> }[] = []
  const emails: { to: string; subject: string; text: string }[] = []
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
    sendEmail: async (to: string, subject: string, text: string) => (emails.push({ to, subject, text }), true),
    accessLink: async () => 'owned' as const,
    submissionOfSubscription: async () => SUBMISSION,
    invoiceConfig: CFG,
    invoiceStatusOf: async () => null,
    invoiceTargets: async () => [],
    // #903: no payout in `sent` by default
    sentPayouts: async () => [],
    // #916: no legacy submission by default
    legacyOf: async () => null,
    legacyFeesEnded: async () => [],
    ...extra,
  }
  return { d, alerts, emails }
}

const checkoutRow = {
  subscription_id: SUB_UUID, status: 'pending_payment', attachable: true, external_reference: REF, billing_cycle: 'MONTHLY',
  billing_period: 3, next_amount_cents: 54000, renewal_amount_cents: 60000, next_due_date: '2026-11-03',
  customer_name: 'Bar do Zé LTDA', customer_tax_id: '12.345.678/0001-95', customer_email: 'ze@example.com',
}
const subRow = {
  subscription_id: SUB_UUID, status: 'pending_payment', payment_method: null, provider_subscription_id: null,
  provider_customer_id: 'cus_1', provider_authorization_id: null, canceled_at: null,
}

const hook = (d: unknown, body: unknown) => pay.handleAsaasWebhook(d, TOKEN, TOKEN, body)

// ─── 1. checkout ────────────────────────────────────────────────────────────────────────────────

function checkoutRoutes(extra: Route[] = []): Route[] {
  return [
    ...extra,
    at('GET', '/subscriptions?', 200, { data: [] }),
    at('GET', '/customers?', 200, { data: [{ id: 'cus_1', postalCode: '28950000', addressNumber: '12' }] }),
    at('PUT', '/customers/cus_1', 200, { id: 'cus_1' }),
    at('POST', '/subscriptions', 200, { id: 'sub_px', status: 'ACTIVE', value: 540 }),
  ]
}
const checkoutDb = () => fakeDb({ place_payment_checkout: { data: [checkoutRow] }, attach_place_subscription: { data: 'pending_payment' } })

test('#914 BR-B2B-046: the checkout touches no invoice endpoint, with or without the secrets, and raises no invoice alert', async () => {
  for (const invoiceConfig of [CFG, null]) {
    const asaas = fakeAsaas(checkoutRoutes())
    const db = checkoutDb()
    const { d, alerts } = deps(asaas, db, { invoiceConfig })
    assert.deepEqual(await pay.checkoutPix(d, { submission_id: SUBMISSION, address: ADDRESS }), { status: 200, body: { result: 'scheduled', first_charge_on: '2026-11-03' } })
    assert.equal(posts(asaas, '/subscriptions').length, 1)
    assert.deepEqual(db.calls.map((c) => c.fn), ['place_payment_checkout', 'attach_place_subscription'])
    assert.ok(!asaas.calls.some((c) => c.path.toLowerCase().includes('invoice')), asaas.calls.map((c) => c.path).join(' | '))
    assert.deepEqual(alerts, [])
  }
})

// ─── 1b. the subscription's first paid fee (#914: the invoice is a step after the payment) ──────

const subFee = { id: 'pay_s', status: 'RECEIVED', value: 540, customer: 'cus_1', subscription: 'sub_1', externalReference: REF, billingType: 'PIX', paymentDate: '2026-10-04' }
const subFeeEvent = { id: 'evt_s', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_s' } }
const subFeeRoutes = (extra: Route[] = []): Route[] => [
  ...extra,
  at('GET', '/payments/pay_s', 200, subFee),
  at('GET', '/subscriptions/sub_1/invoiceSettings', 404, { errors: [{ code: 'not_found' }] }),
  at('POST', '/subscriptions/sub_1/invoiceSettings', 200, { id: 'cfg' }),
  at('POST', '/invoices', 200, { id: 'inv_s', status: 'SCHEDULED', payment: 'pay_s', externalReference: SUB_UUID, value: 540, effectiveDate: '2026-10-04' }),
]

test('#914 BR-B2B-046: the first paid fee of a subscription without settings gets ITS invoice, then the settings, both after the charge is recorded', async () => {
  const log: string[] = []
  const asaas = fakeAsaas(subFeeRoutes(), log)
  const db = fakeDb({ confirm_place_charge: { data: [{ outcome: 'applied' }] }, record_place_invoice: { data: [{ outcome: 'inserted' }] } }, log)
  const { d, alerts } = deps(asaas, db)
  assert.deepEqual(await hook(d, subFeeEvent), { status: 200, body: { outcome: 'applied' } })
  const confirmed = log.indexOf('db confirm_place_charge')
  const invoice = log.indexOf('asaas POST /invoices')
  const settings = log.indexOf('asaas POST /subscriptions/sub_1/invoiceSettings')
  assert.ok(confirmed >= 0 && confirmed < invoice && invoice < settings, log.join(' | '))
  assert.equal((posts(asaas, '/invoices')[0].body as Record<string, unknown>).payment, 'pay_s')
  assert.equal((posts(asaas, '/subscriptions/sub_1/invoiceSettings')[0].body as Record<string, unknown>).effectiveDatePeriod, 'ON_PAYMENT_CONFIRMATION')
  assert.deepEqual(alerts, [])
})

test('#914 BR-B2B-046: a subscription that already has settings is left to Asaas (no second invoice), and a resend does not schedule again', async () => {
  const asaas = fakeAsaas(subFeeRoutes([at('GET', '/subscriptions/sub_1/invoiceSettings', 200, { effectiveDatePeriod: 'ON_PAYMENT_CONFIRMATION' })]))
  const { d } = deps(asaas, fakeDb({ confirm_place_charge: { data: [{ outcome: 'duplicate_event' }] } }))
  assert.equal((await hook(d, subFeeEvent)).status, 200)
  assert.equal(posts(asaas, '/invoices').length, 0)
  assert.equal(posts(asaas, '/subscriptions/').length, 0)
})

test('#914 BR-B2B-046: settings refused for the customer address in the webhook alert with the Asaas description and leave the recorded charge alone (200)', async () => {
  const refused = { errors: [{ code: 'invalid_action', description: 'Endereço do cliente incompleto.; CEP do cliente é inválido.' }] }
  const asaas = fakeAsaas(subFeeRoutes([at('POST', '/subscriptions/sub_1/invoiceSettings', 400, refused)]))
  const db = fakeDb({ confirm_place_charge: { data: [{ outcome: 'applied' }] }, record_place_invoice: { data: [{ outcome: 'inserted' }] } })
  const { d, alerts } = deps(asaas, db)
  assert.deepEqual(await hook(d, subFeeEvent), { status: 200, body: { outcome: 'applied' } })
  assert.equal(db.calls.filter((c) => c.fn === 'confirm_place_charge').length, 1)
  assert.ok(!db.calls.some((c) => c.fn !== 'confirm_place_charge' && c.fn !== 'record_place_invoice'), 'nothing undoes or rewrites the charge')
  assert.deepEqual(alerts.map((a) => a.what), ['invoice_settings_failed'])
  assert.match(String(alerts[0].fields.error), /CEP do cliente é inválido/)
})

test('#914 BR-B2B-046: a paid fee with the secrets missing records the charge and alerts invoice_config_missing, touching no invoice endpoint', async () => {
  const asaas = fakeAsaas(subFeeRoutes())
  const { d, alerts } = deps(asaas, fakeDb({ confirm_place_charge: { data: [{ outcome: 'applied' }] } }), { invoiceConfig: null })
  assert.equal((await hook(d, subFeeEvent)).status, 200)
  assert.ok(!asaas.calls.some((c) => c.path.toLowerCase().includes('invoice')))
  assert.deepEqual(alerts.map((a) => a.what), ['invoice_config_missing'])
})

// ─── 2. one-off charge ──────────────────────────────────────────────────────────────────────────

const oneOff = { id: 'pay_fee', status: 'RECEIVED', value: 135, customer: 'cus_1', subscription: null, externalReference: null, billingType: 'PIX', paymentDate: '2026-10-04' }
const oneOffRoutes = (): Route[] => [
  at('GET', '/payments/pay_fee', 200, oneOff),
  at('GET', '/customers/cus_1', 200, { id: 'cus_1', externalReference: SUB_UUID, email: 'ze@example.com' }),
  at('POST', '/invoices', 200, { id: 'inv_fee', status: 'SCHEDULED', payment: 'pay_fee', externalReference: SUB_UUID, value: 135, effectiveDate: '2026-10-04' }),
]
const feeEvent = (id = 'evt_f1', event = 'PAYMENT_RECEIVED') => ({ id, event, payment: { id: 'pay_fee' } })

test('#901 BR-B2B-046: a one-off charge (cancellation fee) is scheduled for today only AFTER the database confirmed it', async () => {
  const log: string[] = []
  const asaas = fakeAsaas(oneOffRoutes(), log)
  const db = fakeDb({ confirm_place_charge: { data: [{ outcome: 'applied' }] }, record_place_invoice: { data: [{ outcome: 'inserted' }] } }, log)
  const { d } = deps(asaas, db)
  assert.equal((await hook(d, feeEvent())).status, 200)
  assert.ok(log.indexOf('db confirm_place_charge') >= 0)
  assert.ok(log.indexOf('asaas POST /invoices') > log.indexOf('db confirm_place_charge'), log.join(' | '))
  const [inv] = posts(asaas, '/invoices')
  assert.deepEqual(inv.body, {
    payment: 'pay_fee', serviceDescription: 'Tuggi Com história', observations: 'Tuggi · Com história', externalReference: SUB_UUID,
    value: 135, deductions: 0, effectiveDate: '2026-10-04', municipalServiceCode: '1.03', municipalServiceName: 'Processamento de dados',
    taxes: { retainIss: false, iss: 2.5, pis: 0, cofins: 0, csll: 0, inss: 0, ir: 0 },
  })
  assert.equal(db.calls[db.calls.length - 1].fn, 'record_place_invoice')
})

test('#901 BR-B2B-046: the creation of the one-off charge (cancelRenewal) schedules no invoice; a charge the database refused (mismatch) or a failed one neither', async () => {
  // refused by the database
  const a1 = fakeAsaas(oneOffRoutes())
  const r1 = deps(a1, fakeDb({ confirm_place_charge: { data: [{ outcome: 'subscription_mismatch' }] } }))
  await hook(r1.d, feeEvent())
  assert.equal(posts(a1, '/invoices').length, 0)
  // overdue → fail_place_charge, not a confirmation
  const a2 = fakeAsaas([at('GET', '/payments/pay_fee', 200, { ...oneOff, status: 'OVERDUE' }), at('GET', '/customers/cus_1', 200, { id: 'cus_1', externalReference: SUB_UUID })])
  const r2 = deps(a2, fakeDb({ fail_place_charge: { data: [{ outcome: 'applied' }] } }))
  await hook(r2.d, feeEvent('evt_o', 'PAYMENT_OVERDUE'))
  assert.equal(posts(a2, '/invoices').length, 0)
  // a subscription fee whose subscription carries invoiceSettings: no per-payment invoice
  const a3 = fakeAsaas([at('GET', '/payments/pay_s', 200, { ...oneOff, id: 'pay_s', subscription: 'sub_1', externalReference: REF }), at('GET', '/customers/cus_1', 200, { id: 'cus_1', externalReference: SUB_UUID }), at('GET', '/subscriptions/sub_1/invoiceSettings', 200, { effectiveDatePeriod: 'ON_PAYMENT_CONFIRMATION' })])
  const r3 = deps(a3, fakeDb({ confirm_place_charge: { data: [{ outcome: 'applied' }] } }), { subscriptionById: async () => subRow, subscriptionIds: async () => ({ ...subRow, provider_subscription_id: 'sub_1' }) })
  await hook(r3.d, { id: 'evt_s', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_s' } })
  assert.equal(posts(a3, '/invoices').length, 0)
})

test('#901 BR-B2B-046: the second event of the same charge (CONFIRMED after RECEIVED) does not schedule a second invoice', async () => {
  let live: unknown[] = []
  const asaas = fakeAsaas([
    ...oneOffRoutes().slice(0, 2),
    (c) => (c.method === 'GET' && c.path.startsWith('/invoices?') ? { status: 200, body: { data: live, hasMore: false } } : undefined),
    (c) => {
      if (c.method === 'POST' && c.path === '/invoices') {
        live = [{ id: 'inv_fee', status: 'SCHEDULED', payment: 'pay_fee' }]
        return { status: 200, body: { id: 'inv_fee', status: 'SCHEDULED', payment: 'pay_fee', externalReference: SUB_UUID } }
      }
    },
  ])
  const db = fakeDb({ confirm_place_charge: { data: [{ outcome: 'applied' }] }, record_place_invoice: { data: [{ outcome: 'inserted' }] } })
  const { d } = deps(asaas, db)
  await hook(d, feeEvent('evt_a', 'PAYMENT_CONFIRMED'))
  await hook(d, feeEvent('evt_b', 'PAYMENT_RECEIVED'))
  assert.equal(posts(asaas, '/invoices').length, 1)
})

test('#901 BR-B2B-046: a transient Asaas failure while scheduling answers 500 (Asaas resends); a definitive one alerts and answers 200', async () => {
  const routes = (status: number) => [...oneOffRoutes().slice(0, 2), at('POST', '/invoices', status, { errors: [{ code: 'invalid_action' }] })]
  const db = () => fakeDb({ confirm_place_charge: { data: [{ outcome: 'applied' }] } })
  const t = deps(fakeAsaas(routes(500)), db())
  assert.deepEqual(await hook(t.d, feeEvent()), { status: 500, body: { error: 'invoice_schedule_failed' } })
  const f = deps(fakeAsaas(routes(400)), db())
  assert.equal((await hook(f.d, feeEvent())).status, 200)
  assert.deepEqual(f.alerts.map((a) => a.what), ['invoice_not_scheduled'])
})

// ─── 3. INVOICE_* webhook ───────────────────────────────────────────────────────────────────────

const invoiceBody = (status: string, over: Record<string, unknown> = {}) => ({
  id: 'inv_1', status, customer: 'cus_1', payment: 'pay_1', externalReference: SUB_UUID, value: 99.9,
  effectiveDate: '2026-10-04', number: status === 'AUTHORIZED' ? '42' : null, pdfUrl: status === 'AUTHORIZED' ? 'https://x/pdf' : null, xmlUrl: null, ...over,
})
const invEvent = (id: string, event: string) => ({ id, event, invoice: { id: 'inv_1' } })

/** Mirror emulating `partner.record_place_invoice`: upsert by inv_, outcome inserted / updated / unchanged. */
function mirror(serverStatus: { current: string }, over: Record<string, unknown> = {}) {
  const rows = new Map<string, Record<string, unknown>>()
  const asaas = fakeAsaas([
    (c) => (c.method === 'GET' && c.path === '/invoices/inv_1' ? { status: 200, body: invoiceBody(serverStatus.current, over) } : undefined),
    at('GET', '/customers/cus_1', 200, { id: 'cus_1', email: 'ze@example.com' }),
  ])
  const rpc = async (_s: string, fn: string, args: Record<string, unknown>) => {
    assert.equal(fn, 'record_place_invoice')
    const key = String(args.p_provider_invoice_id)
    const prev = rows.get(key)
    const same = prev && JSON.stringify(prev) === JSON.stringify(args)
    rows.set(key, args)
    return { data: [{ outcome: !prev ? 'inserted' : same ? 'unchanged' : 'updated' }], error: null }
  }
  const { d, alerts, emails } = deps(asaas, { rpc, calls: [] }, { invoiceStatusOf: async (id: string) => (rows.get(id)?.p_status as string) ?? null })
  return { d, alerts, emails, rows, asaas }
}

test('#901 BR-B2B-046: a repeated INVOICE_* event and an out-of-order one converge on the same mirror state, and the e-mail goes out once', async () => {
  const server = { current: 'SCHEDULED' }
  const m = mirror(server)
  assert.equal((await hook(m.d, invEvent('e1', 'INVOICE_CREATED'))).status, 200)
  assert.equal(m.rows.get('inv_1')!.p_status, 'SCHEDULED')
  assert.equal(m.emails.length, 0)

  server.current = 'AUTHORIZED'
  assert.deepEqual(await hook(m.d, invEvent('e2', 'INVOICE_AUTHORIZED')), { status: 200, body: { outcome: 'updated' } })
  assert.equal(m.emails.length, 1)
  assert.equal(m.emails[0].to, 'ze@example.com')
  assert.match(m.emails[0].text, /https:\/\/x\/pdf/)
  const settled = JSON.stringify([...m.rows])

  // the same event resent, and an older one (SYNCHRONIZED) that arrives late: both re-read AUTHORIZED
  assert.deepEqual(await hook(m.d, invEvent('e2', 'INVOICE_AUTHORIZED')), { status: 200, body: { outcome: 'unchanged' } })
  assert.deepEqual(await hook(m.d, invEvent('e3', 'INVOICE_SYNCHRONIZED')), { status: 200, body: { outcome: 'unchanged' } })
  assert.equal(JSON.stringify([...m.rows]), settled)
  assert.equal(m.emails.length, 1)
  assert.equal(m.alerts.length, 0)
})

test('#901 BR-B2B-046: the same events in the reverse order end in the same state (the body of the event is never trusted)', async () => {
  const forward = mirror({ current: 'AUTHORIZED' })
  await hook(forward.d, invEvent('e1', 'INVOICE_CREATED'))
  await hook(forward.d, invEvent('e2', 'INVOICE_AUTHORIZED'))
  const reverse = mirror({ current: 'AUTHORIZED' })
  await hook(reverse.d, invEvent('e2', 'INVOICE_AUTHORIZED'))
  await hook(reverse.d, invEvent('e1', 'INVOICE_CREATED'))
  assert.deepEqual([...forward.rows], [...reverse.rows])
  assert.equal(forward.rows.get('inv_1')!.p_status, 'AUTHORIZED')
  assert.equal(forward.emails.length, 1)
  assert.equal(reverse.emails.length, 1)
})

for (const outcome of ['subscription_mismatch', 'payment_mismatch'] as const) {
  test(`#901 BR-B2B-046: ${outcome} writes nothing: alert, 200, and no e-mail even for an AUTHORIZED invoice`, async () => {
    const asaas = fakeAsaas([
      at('GET', '/invoices/inv_1', 200, invoiceBody('AUTHORIZED')),
      at('GET', '/customers/cus_1', 200, { id: 'cus_1', email: 'ze@example.com' }),
    ])
    const db = fakeDb({ record_place_invoice: { data: [{ outcome }] } })
    const { d, alerts, emails } = deps(asaas, db)
    assert.deepEqual(await hook(d, invEvent('e1', 'INVOICE_AUTHORIZED')), { status: 200, body: { outcome } })
    assert.deepEqual(alerts.map((a) => a.what), [`invoice_${outcome}`])
    assert.equal(emails.length, 0)
    assert.deepEqual(db.calls.map((c) => c.fn), ['record_place_invoice'])
  })
}

test('#901 BR-B2B-046: webhook edges — database error → 500 (resend), unknown status → alert and nothing recorded, no body id → 400, 404 re-read → alert', async () => {
  const dbErr = deps(fakeAsaas([at('GET', '/invoices/inv_1', 200, invoiceBody('AUTHORIZED'))]), fakeDb({ record_place_invoice: { error: { code: 'XX000' } } }))
  assert.deepEqual(await hook(dbErr.d, invEvent('e1', 'INVOICE_AUTHORIZED')), { status: 500, body: { error: 'db_error' } })
  assert.equal(dbErr.emails.length, 0)

  const unk = fakeDb({})
  const u = deps(fakeAsaas([at('GET', '/invoices/inv_1', 200, invoiceBody('PENDING'))]), unk)
  assert.equal((await hook(u.d, invEvent('e2', 'INVOICE_CREATED'))).status, 200)
  assert.deepEqual(u.alerts.map((a) => a.what), ['invoice_unknown_status'])
  assert.equal(unk.calls.length, 0)

  const nb = deps(fakeAsaas([]), fakeDb({}))
  assert.equal((await hook(nb.d, { id: 'e3', event: 'INVOICE_CREATED' })).status, 400)

  const nf = deps(fakeAsaas([]), fakeDb({}))
  assert.equal((await hook(nf.d, invEvent('e4', 'INVOICE_CREATED'))).status, 200)
  assert.deepEqual(nf.alerts.map((a) => a.what), ['reread_not_found'])
})

test('#901 BR-B2B-046: the invoice e-mail failing (no PDF link yet / no customer e-mail) alerts and never fails the webhook', async () => {
  const m = mirror({ current: 'AUTHORIZED' }, { pdfUrl: null })
  assert.equal((await hook(m.d, invEvent('e1', 'INVOICE_AUTHORIZED'))).status, 200)
  assert.equal(m.emails.length, 0)
  assert.deepEqual(m.alerts.map((a) => a.what), ['invoice_email_failed'])
})

// ─── 4. refund ──────────────────────────────────────────────────────────────────────────────────

const refundRow = (id: string) => ({
  subscription_id: SUB_UUID, submission_id: SUBMISSION, provider_subscription_id: null,
  provider_payment_id: id, amount_cents: 19990, paid_on: '2026-10-01', pending_since: '2026-10-04T00:00:00Z',
})
const paid = { id: 'pay_1', status: 'CONFIRMED', value: 199.9, subscription: 'sub_1', externalReference: REF }
const invOf = (status: string) => ({ id: 'inv_1', status, payment: 'pay_1', externalReference: SUB_UUID, value: 199.9, effectiveDate: '2026-10-01' })

test('#901 BR-B2B-046: a refund cancels the invoice of the payment at Asaas (city hall included), mirrors the answer, and refunds once', async () => {
  const asaas = fakeAsaas([
    invList('payment=pay_1', 200, { data: [invOf('AUTHORIZED')], hasMore: false }),
    at('POST', '/invoices/inv_1/cancel', 200, invOf('PROCESSING_CANCELLATION')),
    at('GET', '/payments/pay_1', 200, paid),
    at('POST', '/payments/pay_1/refund', 200, {}),
  ])
  const db = fakeDb({ record_place_invoice: { data: [{ outcome: 'updated' }] } })
  const { d, alerts } = deps(asaas, db)
  assert.deepEqual(await pay.processRefunds(d, [refundRow('pay_1')]), { requested: 1, skipped: 0, failed: 0 })
  assert.deepEqual(posts(asaas, '/invoices/inv_1/cancel')[0].body, { cancelOnlyOnAsaas: false })
  assert.equal(db.calls[0].args.p_status, 'PROCESSING_CANCELLATION')
  assert.equal(posts(asaas, '/payments/pay_1/refund').length, 1)
  assert.deepEqual(alerts, [])
})

test('#901 BR-B2B-046: when the invoice cancellation fails the refund proceeds anyway, and a second pass does not refund again', async () => {
  let refunds: unknown[] = []
  const asaas = fakeAsaas([
    invList('payment=pay_1', 200, { data: [invOf('AUTHORIZED')], hasMore: false }),
    at('POST', '/invoices/inv_1/cancel', 500, {}),
    (c) => (c.method === 'GET' && c.path === '/payments/pay_1' ? { status: 200, body: { ...paid, refunds } } : undefined),
    (c) => {
      if (c.method === 'POST' && c.path === '/payments/pay_1/refund') {
        refunds = [{ status: 'PENDING' }]
        return { status: 200, body: {} }
      }
    },
  ])
  const { d, alerts } = deps(asaas, fakeDb({}))
  assert.deepEqual(await pay.processRefunds(d, [refundRow('pay_1')]), { requested: 1, skipped: 0, failed: 0 })
  assert.deepEqual(alerts.map((a) => a.what), ['invoice_cancel_failed'])
  assert.deepEqual(await pay.processRefunds(d, [refundRow('pay_1')]), { requested: 0, skipped: 1, failed: 0 })
  assert.equal(posts(asaas, '/payments/pay_1/refund').length, 1)
})

test('#901 BR-B2B-046: an invoice already CANCELED / past the city deadline is not cancelled again; CANCELLATION_DENIED is only recorded', async () => {
  const asaas = fakeAsaas([
    invList('payment=pay_1', 200, { data: [invOf('CANCELED'), { ...invOf('CANCELLATION_DENIED'), id: 'inv_2' }], hasMore: false }),
    at('GET', '/payments/pay_1', 200, paid),
    at('POST', '/payments/pay_1/refund', 200, {}),
  ])
  const db = fakeDb({ record_place_invoice: { data: [{ outcome: 'updated' }] } })
  const { d } = deps(asaas, db)
  assert.equal((await pay.processRefunds(d, [refundRow('pay_1')])).requested, 1)
  assert.equal(posts(asaas, '/invoices/').length, 0)
  assert.deepEqual(db.calls.map((c) => c.args.p_status), ['CANCELED', 'CANCELLATION_DENIED'])
})

test('#901 BR-B2B-046: a failure LISTING the invoices of the refunded payment does not stop the refund either', async () => {
  const asaas = fakeAsaas([
    invList('payment=pay_1', 500, {}),
    at('GET', '/payments/pay_1', 200, paid),
    at('POST', '/payments/pay_1/refund', 200, {}),
  ])
  const { d, alerts } = deps(asaas, fakeDb({}))
  assert.equal((await pay.processRefunds(d, [refundRow('pay_1')])).requested, 1)
  assert.deepEqual(alerts.map((a) => a.what), ['invoice_cancel_failed'])
})

// ─── 5. sweep ───────────────────────────────────────────────────────────────────────────────────

const SUB2 = '22222222-2222-4333-8444-555555555555'
const targets = [
  { subscription_id: SUB_UUID, provider_subscription_id: 'sub_new', provider_customer_id: 'cus_1' },
  { subscription_id: SUB2, provider_subscription_id: 'sub_done', provider_customer_id: 'cus_2' },
]

test('#914 BR-B2B-046: the sweep configures only a subscription without settings AND with a paid charge (its invoice first), and never rewrites one', async () => {
  const SUB3 = 'cccccccc-3333-4333-8333-333333333333'
  const asaas = fakeAsaas([
    at('GET', '/subscriptions/sub_new/invoiceSettings', 404, {}),
    at('GET', '/subscriptions/sub_done/invoiceSettings', 200, { effectiveDatePeriod: 'ON_PAYMENT_CONFIRMATION' }),
    at('GET', '/subscriptions/sub_unpaid/invoiceSettings', 404, {}),
    at('GET', '/payments?subscription=sub_new', 200, { data: [{ id: 'pay_n', status: 'RECEIVED', value: 540, subscription: 'sub_new' }, { id: 'pay_p', status: 'PENDING', value: 540, subscription: 'sub_new' }] }),
    at('GET', '/payments?subscription=sub_unpaid', 200, { data: [{ id: 'pay_u', status: 'PENDING', value: 540, subscription: 'sub_unpaid' }] }),
    at('POST', '/invoices', 200, { id: 'inv_n', status: 'SCHEDULED', payment: 'pay_n', externalReference: SUB_UUID, value: 540 }),
    at('POST', '/subscriptions/sub_new/invoiceSettings', 200, {}),
  ])
  const all = [...targets, { subscription_id: SUB3, provider_subscription_id: 'sub_unpaid', provider_customer_id: 'cus_3' }]
  const { d } = deps(asaas, fakeDb({ record_place_invoice: { data: [{ outcome: 'inserted' }] } }), { invoiceTargets: async () => all })
  const s = await pay.runSweep(d)
  assert.equal(s.invoices.configured, 1)
  assert.deepEqual(posts(asaas, '/subscriptions/').map((c) => c.path), ['/subscriptions/sub_new/invoiceSettings'])
  assert.deepEqual(posts(asaas, '/invoices').map((c) => (c.body as Record<string, unknown>).payment), ['pay_n'])
  assert.equal(s.invoices.settings_failed, 0)
})

test('#901 BR-B2B-046: the sweep skips the backfill in silence while the secrets are missing (the alert is the webhook\'s), and an ended plan has no subscription to configure', async () => {
  const none = fakeAsaas([])
  const a = deps(none, fakeDb({}), { invoiceConfig: null, invoiceTargets: async () => targets })
  await pay.runSweep(a.d)
  assert.ok(!none.calls.some((c) => c.path.includes('invoiceSettings')))
  assert.deepEqual(a.alerts, [])

  const ended = fakeAsaas([])
  const b = deps(ended, fakeDb({}), { invoiceTargets: async () => [{ ...targets[0], provider_subscription_id: null }] })
  await pay.runSweep(b.d)
  assert.ok(!ended.calls.some((c) => c.path.includes('invoiceSettings')))
})

test('#901 BR-B2B-046: the sweep re-reads the invoices of each customer since the 1st of last month and fixes the mirror from them', async () => {
  const asaas = fakeAsaas([
    at('GET', '/subscriptions/', 200, { effectiveDatePeriod: 'ON_PAYMENT_CONFIRMATION' }),
    invList('customer=cus_1', 200, { data: [invOf('AUTHORIZED')], hasMore: false }),
    invList('customer=cus_2', 200, { data: [{ ...invOf('SCHEDULED'), id: 'inv_9', payment: 'pay_9', externalReference: SUB2 }], hasMore: false }),
    at('GET', '/customers/cus_1', 200, { id: 'cus_1', email: 'ze@example.com' }),
  ])
  const db = fakeDb({ record_place_invoice: { data: [{ outcome: 'updated' }] } })
  const { d } = deps(asaas, db, { invoiceTargets: async () => targets })
  const s = await pay.runSweep(d)
  const lists = asaas.calls.filter((c) => (c.path.startsWith('/invoices?') && c.path.includes('customer=')))
  assert.equal(lists.length, 2)
  for (const l of lists) assert.match(l.path, /effectiveDate\[ge\]=2026-09-01/)
  assert.deepEqual(db.calls.filter((c) => c.fn === 'record_place_invoice').map((c) => [c.args.p_provider_invoice_id, c.args.p_status]), [['inv_1', 'AUTHORIZED'], ['inv_9', 'SCHEDULED']])
  assert.equal(s.invoices.recorded, 2)
})

test('#901 BR-B2B-046: a sweep list failure or a target-read failure never aborts the sweep', async () => {
  const asaas = fakeAsaas([invList('customer=cus_1', 500, {})])
  const a = deps(asaas, fakeDb({}), { invoiceConfig: null, invoiceTargets: async () => [targets[0]] })
  const s = await pay.runSweep(a.d)
  assert.equal(s.invoices.mirror_failed, 1)

  const b = deps(fakeAsaas([]), fakeDb({}), { invoiceTargets: async () => { throw new Error('x') } })
  const s2 = await pay.runSweep(b.d)
  assert.equal(s2.invoices, 'db_error')
  assert.deepEqual(b.alerts.map((x) => x.what), ['sweep_invoices_failed'])
})

test('#901 BR-B2B-046: an AUTHORIZED invoice whose data changes (new PDF link) is `updated` but is not e-mailed a second time', async () => {
  const m = mirror({ current: 'AUTHORIZED' })
  await hook(m.d, invEvent('e1', 'INVOICE_AUTHORIZED'))
  assert.equal(m.emails.length, 1)
  m.rows.set('inv_1', { ...m.rows.get('inv_1')!, p_pdf_url: 'https://x/old' })
  assert.deepEqual(await hook(m.d, invEvent('e2', 'INVOICE_UPDATED')), { status: 200, body: { outcome: 'updated' } })
  assert.equal(m.emails.length, 1)
})

// ─── 6. security review (M1, B2) and the design's e-mail ─────────────────────────────────────────

for (const code of ['PGRST202', '42883', '42P01', 'PGRST205', 'TGP22']) {
  test(`#901 BR-B2B-046 M1: a permanent database error (${code}) recording the invoice answers 200 and alerts — 500 would pause the Asaas queue`, async () => {
    const db = fakeDb({ record_place_invoice: { error: { code, details: 'p_status' } } })
    const { d, alerts, emails } = deps(fakeAsaas([at('GET', '/invoices/inv_1', 200, invoiceBody('AUTHORIZED'))]), db)
    assert.deepEqual(await hook(d, invEvent('e1', 'INVOICE_AUTHORIZED')), { status: 200, body: { outcome: 'db_rejected' } })
    assert.deepEqual(alerts.map((a) => a.what), [code === 'TGP22' ? 'invoice_tgp22' : 'invoice_db_rejected'])
    assert.equal(emails.length, 0)
  })

  test(`#901 BR-B2B-046 M1: a permanent database error (${code}) reading the mirror status (invoiceStatusOf) answers 200 and alerts`, async () => {
    const db = fakeDb({ record_place_invoice: { data: [{ outcome: 'inserted' }] } })
    const { d, alerts, emails } = deps(fakeAsaas([at('GET', '/invoices/inv_1', 200, invoiceBody('AUTHORIZED'))]), db, {
      invoiceStatusOf: async () => { throw new inv.MirrorReadError(code) },
    })
    assert.deepEqual(await hook(d, invEvent('e1', 'INVOICE_AUTHORIZED')), { status: 200, body: { outcome: 'db_rejected' } })
    assert.deepEqual(alerts.map((a) => [a.what, a.fields.code, a.fields.step]), [['invoice_db_rejected', code, 'invoice_status_read']])
    assert.equal(db.calls.length, 0)
    assert.equal(emails.length, 0)
  })
}

test('#901 BR-B2B-046 M1: a transient database error reading the mirror status answers 500 (Asaas resends) and alerts nothing', async () => {
  for (const thrown of [new Error('boom'), null]) {
    const db = fakeDb({ record_place_invoice: { data: [{ outcome: 'inserted' }] } })
    const { d, alerts } = deps(fakeAsaas([at('GET', '/invoices/inv_1', 200, invoiceBody('AUTHORIZED'))]), db, {
      invoiceStatusOf: async () => { throw thrown ?? new inv.MirrorReadError('57014') },
    })
    assert.deepEqual(await hook(d, invEvent('e1', 'INVOICE_AUTHORIZED')), { status: 500, body: { error: 'db_error' } })
    assert.deepEqual(alerts, [])
  }
})

for (const [label, payment, amount, alertWhat] of [
  ['refund_unexpected_status', { ...paid, status: 'PENDING' }, 19990, 'refund_unexpected_status'],
  ['refund_amount_above_charge', paid, 99999, 'refund_amount_above_charge'],
] as const) {
  test(`#901 BR-B2B-046 B2: a refund skipped (${label}) does not cancel the invoice of the payment`, async () => {
    const asaas = fakeAsaas([
      invList('payment=pay_1', 200, { data: [invOf('AUTHORIZED')], hasMore: false }),
      at('GET', '/payments/pay_1', 200, payment),
    ])
    const { d, alerts } = deps(asaas, fakeDb({}))
    assert.deepEqual(await pay.processRefunds(d, [{ ...refundRow('pay_1'), amount_cents: amount }]), { requested: 0, skipped: 1, failed: 0 })
    assert.deepEqual(alerts.map((a) => a.what), [alertWhat])
    assert.equal(asaas.calls.filter((c) => c.path.startsWith('/invoices')).length, 0)
  })
}

test('#901 BR-B2B-046 B2: a refund that Asaas refuses does not cancel the invoice either', async () => {
  const asaas = fakeAsaas([
    invList('payment=pay_1', 200, { data: [invOf('AUTHORIZED')], hasMore: false }),
    at('GET', '/payments/pay_1', 200, paid),
    at('POST', '/payments/pay_1/refund', 400, { errors: [{ code: 'invalid_action' }] }),
  ])
  const { d } = deps(asaas, fakeDb({}))
  assert.deepEqual(await pay.processRefunds(d, [refundRow('pay_1')]), { requested: 0, skipped: 0, failed: 1 })
  assert.equal(asaas.calls.filter((c) => c.path.startsWith('/invoices')).length, 0)
})

test('#901: the invoice e-mail carries the design subject, the number and the value; a null number or value drops its line', async () => {
  const m = mirror({ current: 'AUTHORIZED' })
  await hook(m.d, invEvent('e1', 'INVOICE_AUTHORIZED'))
  assert.equal(m.emails[0].subject, 'Nota fiscal da sua mensalidade Com história')
  assert.equal(
    m.emails[0].text,
    'Olá,\n\nA nota fiscal da sua mensalidade do plano Com história foi emitida.\n\nNúmero: 42\nValor: R$ 99,90\n\nPara baixar o PDF, abra: https://x/pdf\n\nEquipe Tuggi',
  )
  const bare = inv.INVOICE_EMAIL.text('https://x/pdf', null, null)
  assert.doesNotMatch(bare, /Número:|Valor:/)
  assert.doesNotMatch(bare, /\n\n\n/)
})
