/**
 * #918 — the CMS contract subscription (`legacy:<client_id>`, #917) lives in `place_subscriptions`
 * (origin `cms_contract`): the webhook registers it before the charge function, and the `mirror`
 * action of places-legacy-customers recovers the events that passed. Contract: `places-pagamento.md`
 * §3.8 (workspace). Database: migration 20261008140000 (db-tuggiApp), mocked here.
 *
 * Deno source, loaded through a path built at run time: a static `.ts` import fails the repo's `tsc`.
 *
 * Mutations that turn this suite red:
 *  · the charge function called before `register_contract_place_subscription` (its event id would be
 *    consumed as `unknown_subscription`, and the resend would be a `duplicate_event`);
 *  · the charge function called with the client id, or without the `sub_`;
 *  · a refused registration (mismatch, no mirror) still calling the charge function, or not alerting;
 *  · a database error of the registration answered 200 (Asaas would not resend);
 *  · the access link or the fee sync run on a CMS contract charge;
 *  · the NFS-e of a CMS contract charge skipped, or saying "Com história" (operator 2026-10-08: same
 *    flow as any client, text "Tuggi: mensalidade do local no app"), on the invoice or on its e-mail;
 *  · the dry run calling the database, or a rerun recording a charge twice;
 *  · the mirror not writing `contract_ends_on` on each registered row, writing it on a dry run, or
 *    taking a date that is not a calendar date.
 *
 * Run with: npm run test:api
 */

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const SHARED = resolve(import.meta.dirname, '../../supabase/functions/_shared')

// Untyped on purpose: a `typeof import` would pull the `.ts` sibling imports into `tsc` (TS5097).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Mod = any
let pay: Mod
let asaasMod: Mod
let inv: Mod

before(async () => {
  pay = await import(pathToFileURL(resolve(SHARED, 'places-payment.ts')).href)
  inv = await import(pathToFileURL(resolve(SHARED, 'places-invoice.ts')).href)
  asaasMod = await import(pathToFileURL(resolve(SHARED, 'asaas.ts')).href)
})

const CLIENT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const CLIENT_2 = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000002'
const ROW_ID = '77777777-6666-4555-8444-333333333333'
const MIRROR = '99999999-8888-4777-8666-555555555555'
const LEGACY_REF = `legacy:${CLIENT}`
const TOKEN = 'whk-token-123'

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
function fakeDb(answers: Record<string, Answer | ((args: Record<string, unknown>) => Answer)>) {
  const calls: RpcCall[] = []
  const rpc = async (schema: string, fn: string, args: Record<string, unknown>) => {
    // #923: the payment link has its own suite (edge-places-payment-link.test.ts), kept out of these call lists.
    if (fn === 'record_place_payment_link') return { data: [{ outcome: 'recorded' }], error: null }
    calls.push({ schema, fn, args })
    const raw = answers[fn] ?? { data: null }
    const a = typeof raw === 'function' ? raw(args) : raw
    return { data: a.data ?? null, error: a.error ?? null }
  }
  return { rpc, calls }
}

function deps(asaas: ReturnType<typeof fakeAsaas>, db: ReturnType<typeof fakeDb>, extra: Record<string, unknown> = {}) {
  const alerts: { what: string; fields: Record<string, unknown> }[] = []
  const side: string[] = []
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
    today: () => '2026-10-08',
    now: () => new Date('2026-10-08T12:00:00Z'),
    submissionOfSubscription: async () => {
      side.push('submissionOfSubscription')
      return MIRROR
    },
    accessLink: async () => {
      side.push('accessLink')
      return 'sent' as const
    },
    // configured on purpose: the NFS-e step would run (and call Asaas) if the contract charge reached it
    invoiceConfig: { serviceCode: '01.01', serviceName: 'x', issRate: 2 },
    invoiceStatusOf: async () => null,
    invoiceTargets: async () => [],
    sentPayouts: async () => [],
    legacyOf: async () => null,
    legacyFeesEnded: async () => [],
    sendEmail: async () => true,
    invoiceOriginOf: async () => 'cms_contract',
    ...extra,
  }
  return { d, alerts, side }
}

const legacySub = { id: 'sub_legacy', status: 'ACTIVE', value: 100, customer: 'cus_1', externalReference: LEGACY_REF, deleted: false }
const registered = (outcome = 'unchanged') => ({ data: [{ outcome, subscription_id: ROW_ID, submission_id: MIRROR }] })
const paidCharge = { id: 'pay_l', status: 'RECEIVED', value: 100, subscription: 'sub_legacy', externalReference: LEGACY_REF, customer: 'cus_1', dueDate: '2026-10-20', paymentDate: '2026-10-19' }

// ─── webhook ─────────────────────────────────────────────────────────────────────────────────

const CONTRACT_SERVICE = 'Tuggi: mensalidade do local no app'
/** The NFS-e routes of a subscription with no invoiceSettings and a payment with no invoice yet. */
const invoiceRoutes: Route[] = [
  at('GET', '/subscriptions/sub_legacy/invoiceSettings', 404, { errors: [{ code: 'not_found' }] }),
  at('GET', '/invoices?', 200, { data: [], hasMore: false }),
  at('POST', '/invoices', 200, { id: 'inv_1', status: 'SCHEDULED', payment: 'pay_l' }),
  at('POST', '/subscriptions/sub_legacy/invoiceSettings', 200, {}),
]

test('#918 §3.8: a paid CMS contract charge registers the subscription from the re-read, THEN confirms it with the row uuid and the sub_', async () => {
  const asaas = fakeAsaas([at('GET', '/payments/pay_l', 200, paidCharge), at('GET', '/subscriptions/sub_legacy/invoiceSettings', 404, {}), at('GET', '/subscriptions/sub_legacy', 200, legacySub), ...invoiceRoutes])
  const db = fakeDb({ register_contract_place_subscription: registered('inserted'), confirm_place_charge: { data: [{ outcome: 'applied', submission_status: 'live' }] } })
  const { d, alerts, side } = deps(asaas, db)

  const r = await pay.handleAsaasWebhook(d, TOKEN, TOKEN, { id: 'evt_1', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_l' } })

  assert.deepEqual(r, { status: 200, body: { outcome: 'applied' } })
  // the order is the contract: the charge function records the event id even on unknown_subscription
  // (then the NFS-e step records the scheduled invoice)
  assert.deepEqual(db.calls.map((c) => c.fn), ['register_contract_place_subscription', 'confirm_place_charge', 'record_place_invoice'])
  assert.deepEqual(db.calls[0].args, { p_client_id: CLIENT, p_provider_customer_id: 'cus_1', p_provider_subscription_id: 'sub_legacy', p_amount_cents: 10000 })
  const confirm = db.calls[1].args
  assert.equal(confirm.p_subscription_id, ROW_ID)
  assert.equal(confirm.p_provider_subscription_id, 'sub_legacy')
  assert.equal(confirm.p_provider_payment_id, 'pay_l')
  assert.equal(confirm.p_amount_cents, 10000)
  assert.equal(confirm.p_paid_on, '2026-10-19')
  assert.equal(alerts.length, 0)
  // no portal owner, no voucher: no access link, no fee sync
  assert.deepEqual(side, [])
})

test('#918 BR-B2B-046: a paid CMS contract charge gets its NFS-e by the same flow as any client, with the contract text, never "Com história"', async () => {
  const asaas = fakeAsaas([at('GET', '/payments/pay_l', 200, paidCharge), ...invoiceRoutes, at('GET', '/subscriptions/sub_legacy', 200, legacySub)])
  const db = fakeDb({ register_contract_place_subscription: registered(), confirm_place_charge: { data: [{ outcome: 'applied', submission_status: 'live' }] } })
  const { d, alerts } = deps(asaas, db)

  const r = await pay.handleAsaasWebhook(d, TOKEN, TOKEN, { id: 'evt_n', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_l' } })

  assert.equal(r.status, 200)
  assert.equal(alerts.length, 0)
  const writes = asaas.calls.filter((c) => c.method === 'POST')
  assert.deepEqual(writes.map((c) => c.path), ['/invoices', '/subscriptions/sub_legacy/invoiceSettings'])
  const scheduled = writes[0].body as Record<string, unknown>
  assert.equal(scheduled.payment, 'pay_l')
  assert.equal(scheduled.serviceDescription, CONTRACT_SERVICE)
  assert.equal(scheduled.observations, CONTRACT_SERVICE)
  assert.equal(scheduled.externalReference, ROW_ID)
  assert.equal((writes[1].body as Record<string, unknown>).observations, CONTRACT_SERVICE)
  assert.equal((writes[1].body as Record<string, unknown>).effectiveDatePeriod, 'ON_PAYMENT_CONFIRMATION')
  assert.doesNotMatch(JSON.stringify(writes.map((c) => c.body)), /Com hist/)
})

test('#918: the daily sweep reconciles a CMS contract like any plan, with the contract text', async () => {
  const asaas = fakeAsaas([
    at('GET', '/subscriptions/sub_legacy/invoiceSettings', 404, {}),
    at('GET', '/payments?subscription=sub_legacy', 200, { data: [paidCharge], hasMore: false }),
    ...invoiceRoutes,
  ])
  const { d } = deps(asaas, fakeDb({}))
  const out = await inv.reconcileInvoices(d, [{ subscription_id: ROW_ID, provider_subscription_id: 'sub_legacy', provider_customer_id: 'cus_1', origin: 'cms_contract' }])
  assert.equal(out.configured, 1)
  const scheduled = asaas.calls.find((c) => c.method === 'POST' && c.path === '/invoices')
  assert.equal((scheduled?.body as Record<string, unknown>).serviceDescription, CONTRACT_SERVICE)
})

test('#918: the authorized NFS-e e-mail of a CMS contract names the contract service, never "Com história"; a portal one keeps its text', async () => {
  const authorized = { id: 'inv_1', status: 'AUTHORIZED', payment: 'pay_l', customer: 'cus_1', pdfUrl: 'https://x/pdf', number: '42', value: 100, externalReference: ROW_ID }
  const send = async (origin: string) => {
    const emails: { subject: string; text: string }[] = []
    const asaas = fakeAsaas([at('GET', '/customers/cus_1', 200, { id: 'cus_1', email: 'a@b.c' })])
    const db = fakeDb({ record_place_invoice: { data: [{ outcome: 'inserted' }] } })
    const { d, alerts } = deps(asaas, db, {
      invoiceOriginOf: async (pay: string) => (assert.equal(pay, 'pay_l'), origin),
      sendEmail: async (_to: string, subject: string, text: string) => (emails.push({ subject, text }), true),
    })
    assert.equal(await inv.recordInvoice(d, authorized), 'inserted')
    assert.equal(alerts.length, 0)
    return emails[0]
  }
  const contract = await send('cms_contract')
  assert.equal(contract.subject, 'Nota fiscal da sua mensalidade Tuggi')
  assert.match(contract.text, new RegExp(CONTRACT_SERVICE))
  assert.doesNotMatch(contract.subject + contract.text, /Com hist/)
  const portal = await send('portal')
  assert.equal(portal.subject, 'Nota fiscal da sua mensalidade Com história')
})

test('#918: a boleto marked paid in cash in the Asaas panel is a paid charge too', async () => {
  const asaas = fakeAsaas([at('GET', '/payments/pay_l', 200, { ...paidCharge, status: 'RECEIVED_IN_CASH' }), at('GET', '/subscriptions/sub_legacy', 200, legacySub)])
  const db = fakeDb({ register_contract_place_subscription: registered(), confirm_place_charge: { data: [{ outcome: 'applied' }] } })
  const { d } = deps(asaas, db)
  await pay.handleAsaasWebhook(d, TOKEN, TOKEN, { id: 'evt_c', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_l' } })
  assert.deepEqual(db.calls.map((c) => c.fn), ['register_contract_place_subscription', 'confirm_place_charge'])
})

test('#918: an overdue CMS contract charge registers, then fail_place_charge; a PENDING one registers and is stale', async () => {
  {
    const asaas = fakeAsaas([at('GET', '/payments/pay_l', 200, { ...paidCharge, status: 'OVERDUE' }), at('GET', '/subscriptions/sub_legacy', 200, legacySub)])
    const db = fakeDb({ register_contract_place_subscription: registered(), fail_place_charge: { data: [{ outcome: 'applied' }] } })
    const { d } = deps(asaas, db)
    await pay.handleAsaasWebhook(d, TOKEN, TOKEN, { id: 'evt_o', event: 'PAYMENT_OVERDUE', payment: { id: 'pay_l' } })
    assert.deepEqual(db.calls.map((c) => c.fn), ['register_contract_place_subscription', 'fail_place_charge'])
    assert.equal(db.calls[1].args.p_subscription_id, ROW_ID)
  }
  {
    const asaas = fakeAsaas([at('GET', '/payments/pay_l', 200, { ...paidCharge, status: 'PENDING' }), at('GET', '/subscriptions/sub_legacy', 200, legacySub)])
    const db = fakeDb({ register_contract_place_subscription: registered('inserted') })
    const { d } = deps(asaas, db)
    const r = await pay.handleAsaasWebhook(d, TOKEN, TOKEN, { id: 'evt_p', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_l' } })
    assert.deepEqual(r, { status: 200, body: { outcome: 'stale' } })
    assert.deepEqual(db.calls.map((c) => c.fn), ['register_contract_place_subscription'])
  }
})

test('#918 §3.8: a registration that writes nothing alerts, never calls the charge function, and answers 200', async () => {
  for (const [answer, outcome, alert] of [
    [{ data: [{ outcome: 'amount_mismatch', subscription_id: null, submission_id: MIRROR }] }, 'amount_mismatch', 'amount_mismatch'],
    [{ data: [{ outcome: 'subscription_mismatch', subscription_id: ROW_ID, submission_id: MIRROR }] }, 'subscription_mismatch', 'subscription_mismatch'],
    [{ error: { code: 'TGP01' } }, 'no_mirror', 'legacy_no_mirror'],
    [{ error: { code: 'TGP10', details: 'not_paying' } }, 'not_paying', 'legacy_not_paying'],
  ] as const) {
    const asaas = fakeAsaas([at('GET', '/payments/pay_l', 200, paidCharge), at('GET', '/subscriptions/sub_legacy', 200, legacySub)])
    const db = fakeDb({ register_contract_place_subscription: answer })
    const { d, alerts } = deps(asaas, db)
    const r = await pay.handleAsaasWebhook(d, TOKEN, TOKEN, { id: 'evt_m', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_l' } })
    assert.deepEqual(r, { status: 200, body: { outcome } }, outcome)
    assert.deepEqual(db.calls.map((c) => c.fn), ['register_contract_place_subscription'], outcome)
    assert.deepEqual(alerts.map((a) => a.what), [alert], outcome)
    assert.equal(alerts[0].fields.provider_payment_id, 'pay_l')
  }
})

test('#918: a database error of the registration is a 500 (nothing claimed: the resend reprocesses it); TGP22 also alerts', async () => {
  for (const code of ['57014', 'TGP22']) {
    const asaas = fakeAsaas([at('GET', '/payments/pay_l', 200, paidCharge), at('GET', '/subscriptions/sub_legacy', 200, legacySub)])
    const db = fakeDb({ register_contract_place_subscription: { error: { code } } })
    const { d, alerts } = deps(asaas, db)
    const r = await pay.handleAsaasWebhook(d, TOKEN, TOKEN, { id: 'evt_e', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_l' } })
    assert.equal(r.status, 500, code)
    assert.deepEqual(db.calls.map((c) => c.fn), ['register_contract_place_subscription'])
    assert.deepEqual(alerts.map((a) => a.what), code === 'TGP22' ? ['webhook_tgp22'] : [])
  }
})

test('#918: a charge that says legacy: and whose subscription cannot be read in transit is a 500, never the portal path', async () => {
  const asaas = fakeAsaas([at('GET', '/payments/pay_l', 200, paidCharge), at('GET', '/subscriptions/sub_legacy', 503, {})])
  const db = fakeDb({})
  const { d } = deps(asaas, db)
  const r = await pay.handleAsaasWebhook(d, TOKEN, TOKEN, { id: 'evt_t', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_l' } })
  assert.equal(r.status, 500)
  assert.equal(db.calls.length, 0)
})

test('#918 §3.8: SUBSCRIPTION_DELETED of a CMS contract registers it, then cancel_place_subscription by the provider with the row uuid', async () => {
  const asaas = fakeAsaas([at('GET', '/subscriptions/sub_legacy', 200, { ...legacySub, deleted: true })])
  const db = fakeDb({ register_contract_place_subscription: registered(), cancel_place_subscription: { data: [{ outcome: 'applied' }] } })
  const { d, alerts } = deps(asaas, db)
  const r = await pay.handleAsaasWebhook(d, TOKEN, TOKEN, { id: 'evt_d', event: 'SUBSCRIPTION_DELETED', subscription: { id: 'sub_legacy' } })
  assert.deepEqual(r, { status: 200, body: { outcome: 'applied' } })
  assert.deepEqual(db.calls.map((c) => c.fn), ['register_contract_place_subscription', 'cancel_place_subscription'])
  assert.deepEqual(db.calls[1].args, { p_event_id: 'evt_d', p_event_type: 'SUBSCRIPTION_DELETED', p_subscription_id: ROW_ID, p_provider_subscription_id: 'sub_legacy', p_actor_kind: 'provider' })
  assert.equal(alerts.length, 0)
})

// ─── action `mirror` ─────────────────────────────────────────────────────────────────────────

const byRef = (client: string, data: unknown[]) => at('GET', `/subscriptions?externalReference=${encodeURIComponent(`legacy:${client}`)}`, 200, { data })
const mirrorRoutes = () => [
  byRef(CLIENT, [legacySub]),
  byRef(CLIENT_2, []),
  at('GET', '/payments?subscription=sub_legacy', 200, {
    data: [
      { id: 'pay_nov', status: 'PENDING', value: 100, subscription: 'sub_legacy', dueDate: '2026-11-20' },
      { id: 'pay_oct', status: 'RECEIVED', value: 100, subscription: 'sub_legacy', dueDate: '2026-10-20', paymentDate: '2026-10-19' },
      { id: 'pay_sep', status: 'OVERDUE', value: 100, subscription: 'sub_legacy', dueDate: '2026-09-20' },
    ],
  }),
]

test('#918: mirror dry run reads Asaas only (GETs), never the database, and says what each charge would become', async () => {
  const asaas = fakeAsaas(mirrorRoutes())
  const db = fakeDb({})
  const pauses: number[] = []
  const out = await pay.mirrorContractSubscriptions({ asaas: asaas.client, admin: db.rpc, today: () => '2026-10-08' }, [CLIENT, CLIENT_2], true, {
    sleep: async (ms: number) => void pauses.push(ms),
  })
  assert.equal(db.calls.length, 0)
  assert.ok(asaas.calls.every((c) => c.method === 'GET'))
  assert.deepEqual(out, [
    { client_id: CLIENT, status: 'would_register', subscription_id: 'sub_legacy', charges: { fail_place_charge: 1, confirm_place_charge: 1, none: 1 } },
    { client_id: CLIENT_2, status: 'no_subscription' },
  ])
  // 1 s between two Asaas calls (the rate limit is per account): 3 calls, 2 pauses
  assert.equal(asaas.calls.length, 3)
  assert.deepEqual(pauses, [1000, 1000])
})

test('#918: mirror real run registers, then records the charges oldest first with the row uuid; a rerun records nothing twice', async () => {
  const recorded = new Set<string>()
  const answer = (fn: string) => (args: Record<string, unknown>) => {
    const id = String(args.p_event_id)
    const outcome = recorded.has(id) ? 'duplicate_event' : 'applied'
    recorded.add(id)
    return { data: [{ outcome, fn }] }
  }
  const db = fakeDb({
    register_contract_place_subscription: (args) => ({ data: [{ outcome: recorded.has('sub') ? 'unchanged' : (recorded.add('sub'), 'inserted'), subscription_id: ROW_ID, submission_id: MIRROR, args }] }),
    confirm_place_charge: answer('confirm_place_charge'),
    fail_place_charge: answer('fail_place_charge'),
  })
  const run = () =>
    pay.mirrorContractSubscriptions({ asaas: fakeAsaas(mirrorRoutes()).client, admin: db.rpc, today: () => '2026-10-08' }, [CLIENT, CLIENT_2], false, { sleep: async () => {} })

  const first = await run()
  assert.deepEqual(first[0], {
    client_id: CLIENT,
    status: 'registered',
    subscription_id: 'sub_legacy',
    register: 'inserted',
    charges: { 'fail_place_charge:applied': 1, 'confirm_place_charge:applied': 1, pending: 1 },
  })
  assert.deepEqual(first[1], { client_id: CLIENT_2, status: 'no_subscription' })
  // registration first, then September before October
  assert.deepEqual(db.calls.map((c) => c.fn), ['register_contract_place_subscription', 'fail_place_charge', 'confirm_place_charge'])
  assert.deepEqual(db.calls[0].args, { p_client_id: CLIENT, p_provider_customer_id: 'cus_1', p_provider_subscription_id: 'sub_legacy', p_amount_cents: 10000 })
  for (const c of db.calls.slice(1)) {
    assert.equal(c.args.p_subscription_id, ROW_ID)
    assert.equal(c.args.p_provider_subscription_id, 'sub_legacy')
    assert.match(String(c.args.p_event_id), /^mirror:pay_(sep|oct):(OVERDUE|RECEIVED)$/)
  }

  const second = await run()
  assert.deepEqual(second[0].register, 'unchanged')
  assert.deepEqual(second[0].charges, { 'fail_place_charge:duplicate_event': 1, 'confirm_place_charge:duplicate_event': 1, pending: 1 })
  // no PII in what the EF answers and logs
  assert.doesNotMatch(JSON.stringify([...first, ...second]), /@|cpf|name/i)
})

test('#918: mirror reports a refused registration and a failed Asaas read per client, and goes on', async () => {
  const asaas = fakeAsaas([byRef(CLIENT, [legacySub]), at('GET', `/subscriptions?externalReference=${encodeURIComponent(`legacy:${CLIENT_2}`)}`, 503, {}), at('GET', '/payments?subscription=sub_legacy', 200, { data: [] })])
  const db = fakeDb({ register_contract_place_subscription: { data: [{ outcome: 'amount_mismatch', subscription_id: null, submission_id: MIRROR }] } })
  const out = await pay.mirrorContractSubscriptions({ asaas: asaas.client, admin: db.rpc, today: () => '2026-10-08' }, [CLIENT, CLIENT_2], false, { sleep: async () => {} })
  assert.deepEqual(out[0], { client_id: CLIENT, status: 'refused', subscription_id: 'sub_legacy', register: 'amount_mismatch', code: undefined })
  assert.deepEqual(out[1], { client_id: CLIENT_2, status: 'failed', code: 'http 503' })
  assert.deepEqual(db.calls.map((c) => c.fn), ['register_contract_place_subscription'])
})

test('#918: mirror with contract_ends_on writes the review date on each registered row after registering; the dry run only says it', async () => {
  const dry = await pay.mirrorContractSubscriptions({ asaas: fakeAsaas(mirrorRoutes()).client, admin: fakeDb({}).rpc, today: () => '2026-10-08' }, [CLIENT], true, {
    sleep: async () => {},
    contractEndsOn: '2027-09-20',
  })
  assert.equal(dry[0].status, 'would_register')
  assert.equal(dry[0].contract_ends_on, '2027-09-20')

  const db = fakeDb({
    register_contract_place_subscription: registered('inserted'),
    set_contract_place_subscription_end: { data: 'updated' },
    confirm_place_charge: { data: [{ outcome: 'applied' }] },
    fail_place_charge: { data: [{ outcome: 'applied' }] },
  })
  const real = await pay.mirrorContractSubscriptions({ asaas: fakeAsaas(mirrorRoutes()).client, admin: db.rpc, today: () => '2026-10-08' }, [CLIENT], false, {
    sleep: async () => {},
    contractEndsOn: '2027-09-20',
  })
  assert.equal(real[0].contract_ends_on, '2027-09-20')
  assert.equal(real[0].contract_ends_on_outcome, 'updated')
  assert.deepEqual(db.calls.slice(0, 2).map((c) => c.fn), ['register_contract_place_subscription', 'set_contract_place_subscription_end'])
  assert.deepEqual(db.calls[1].args, { p_subscription_id: ROW_ID, p_ends_on: '2027-09-20' })

  // without the field, the RPC is never called
  const plain = fakeDb({ register_contract_place_subscription: registered(), confirm_place_charge: { data: [{ outcome: 'applied' }] }, fail_place_charge: { data: [{ outcome: 'applied' }] } })
  await pay.mirrorContractSubscriptions({ asaas: fakeAsaas(mirrorRoutes()).client, admin: plain.rpc, today: () => '2026-10-08' }, [CLIENT], false, { sleep: async () => {} })
  assert.ok(!plain.calls.some((c) => c.fn === 'set_contract_place_subscription_end'))
})

test('#918: contract_ends_on accepts only a calendar YYYY-MM-DD', () => {
  assert.equal(pay.calendarDate('2027-09-20'), '2027-09-20')
  for (const bad of ['2027-02-30', '20/09/2027', '2027-9-20', '2027-09-20T00:00:00Z', '', null, 20270920]) {
    assert.equal(pay.calendarDate(bad), null, String(bad))
  }
})
