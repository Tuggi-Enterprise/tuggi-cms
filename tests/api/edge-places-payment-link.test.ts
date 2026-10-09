/**
 * #923 BR-B2B-046 — the link of each charge of a place subscription (where to pay it, its receipt),
 * recorded by the webhook in `partner.record_place_payment_link` so the portal's "Cobranças" section
 * (`core.portal_list_place_charges`) lists the open fee with "Pagar". Contract: `portal-cobrancas.md`
 * §3 (workspace). Database: migration 20261008180000 (db-tuggiApp), mocked here.
 *
 * Deno source, loaded through a path built at run time: a static `.ts` import fails the repo's `tsc`.
 *
 * Mutations that turn this suite red:
 *  · a value taken from the webhook body instead of the re-read payment (amount, due date, URLs);
 *  · PAYMENT_CREATED / UPDATED / DELETED / RESTORED ignored again, or a removal decided by the event
 *    name instead of the re-read `deleted`;
 *  · CONFIRMED / RECEIVED / OVERDUE not recording the link (the receipt never arrives), or a link
 *    database error answered 200 (Asaas would not resend), or the money function run before it;
 *  · a TGP22 (provider data refused) answered 500 — 15 in a row pause the whole Asaas queue;
 *  · a one-off charge (no sub_) sent to the database; the token check skipped;
 *  · the operator's load skipping a live subscription, or stopping on one that fails to list.
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

before(async () => {
  pay = await import(pathToFileURL(resolve(SHARED, 'places-payment.ts')).href)
  asaasMod = await import(pathToFileURL(resolve(SHARED, 'asaas.ts')).href)
})

const TOKEN = 'whk-token-123'
const SUB_ROW = '11111111-2222-4333-8444-555555555555'
const PAY_URL = 'https://www.asaas.com/i/080225913252'
const RECEIPT_URL = 'https://www.asaas.com/comprovantes/1234567890'

type Call = { method: string; path: string }
type Route = (c: Call) => { status: number; body: unknown } | undefined

function fakeAsaas(routes: Route[]) {
  const calls: Call[] = []
  const fetch = async (url: string, init: RequestInit) => {
    const u = new URL(url)
    const call = { method: init.method ?? 'GET', path: u.pathname.replace(/^\/v3/, '') + u.search }
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
  const d = {
    asaas: asaas.client,
    admin: db.rpc,
    subscriptionIds: async () => null,
    subscriptionById: async () => ({ subscription_id: SUB_ROW, provider_subscription_id: 'sub_1' }),
    alert: async (what: string, fields: Record<string, unknown>) => {
      alerts.push({ what, fields })
    },
    today: () => '2026-10-08',
    now: () => new Date('2026-10-08T12:00:00Z'),
    submissionOfSubscription: async () => null,
    accessLink: async () => 'sent' as const,
    invoiceConfig: null,
    invoiceStatusOf: async () => null,
    invoiceTargets: async () => [],
    invoiceOriginOf: async () => 'portal',
    sentPayouts: async () => [],
    legacyOf: async () => null,
    legacyFeesEnded: async () => [],
    sendEmail: async () => true,
    expiredLiveCards: async () => [],
    cancelsToRedo: async () => [],
    ...extra,
  }
  return { d, alerts }
}

/** The payment as Asaas holds it now; the webhook body below always lies about it. */
const reread = (over: Record<string, unknown> = {}) => ({
  id: 'pay_1',
  status: 'PENDING',
  value: 149.9,
  subscription: 'sub_1',
  externalReference: `com_historia_12m:${SUB_ROW}`,
  customer: 'cus_1',
  dueDate: '2026-10-20',
  invoiceUrl: PAY_URL,
  transactionReceiptUrl: null,
  deleted: false,
  ...over,
})
const event = (type: string) => ({
  id: `evt_${type}`,
  event: type,
  payment: { id: 'pay_1', value: 1, dueDate: '2030-01-01', invoiceUrl: 'https://evil.example/x', deleted: false, subscription: 'sub_evil' },
})
const linkCalls = (db: ReturnType<typeof fakeDb>) => db.calls.filter((c) => c.fn === 'record_place_payment_link')
const recorded = { data: [{ outcome: 'recorded', subscription_id: SUB_ROW }] }

for (const type of ['PAYMENT_CREATED', 'PAYMENT_UPDATED']) {
  test(`#923 BR-B2B-046: ${type} records the link with the RE-READ payment, never the body`, async () => {
    const asaas = fakeAsaas([at('GET', '/payments/pay_1', 200, reread())])
    const db = fakeDb({ record_place_payment_link: recorded })
    const { d } = deps(asaas, db)
    const r = await pay.handleAsaasWebhook(d, TOKEN, TOKEN, event(type))
    assert.equal(r.status, 200)
    assert.equal(r.body.outcome, 'recorded')
    assert.deepEqual(asaas.calls, [{ method: 'GET', path: '/payments/pay_1' }])
    assert.deepEqual(db.calls, [
      {
        schema: 'partner',
        fn: 'record_place_payment_link',
        args: {
          p_provider_subscription_id: 'sub_1',
          p_provider_payment_id: 'pay_1',
          p_amount_cents: 14990,
          p_due_date: '2026-10-20',
          p_invoice_url: PAY_URL,
          p_receipt_url: null,
          p_removed: false,
        },
      },
    ])
  })
}

test('#923: PAYMENT_DELETED removes by the re-read `deleted`; PAYMENT_RESTORED puts it back; the event name decides nothing', async () => {
  for (const [type, deleted] of [['PAYMENT_DELETED', true], ['PAYMENT_RESTORED', false], ['PAYMENT_DELETED', false]] as const) {
    const asaas = fakeAsaas([at('GET', '/payments/pay_1', 200, reread({ deleted }))])
    const db = fakeDb({ record_place_payment_link: recorded })
    const r = await pay.handleAsaasWebhook(deps(asaas, db).d, TOKEN, TOKEN, event(type))
    assert.equal(r.status, 200)
    assert.equal(linkCalls(db)[0].args.p_removed, deleted, `${type} re-read deleted=${deleted}`)
  }
})

test('#923 BR-B2B-046: PAYMENT_RECEIVED records the receipt BEFORE confirm_place_charge', async () => {
  const asaas = fakeAsaas([at('GET', '/payments/pay_1', 200, reread({ status: 'RECEIVED', paymentDate: '2026-10-19', transactionReceiptUrl: RECEIPT_URL }))])
  const db = fakeDb({ record_place_payment_link: recorded, confirm_place_charge: { data: [{ outcome: 'duplicate_charge' }] } })
  const r = await pay.handleAsaasWebhook(deps(asaas, db).d, TOKEN, TOKEN, event('PAYMENT_RECEIVED'))
  assert.equal(r.status, 200)
  assert.deepEqual(db.calls.map((c) => c.fn), ['record_place_payment_link', 'confirm_place_charge'])
  assert.equal(db.calls[0].args.p_receipt_url, RECEIPT_URL)
  assert.equal(db.calls[0].args.p_invoice_url, PAY_URL)
})

test('#923: PAYMENT_OVERDUE records the link (to pay it late) and still fails the charge', async () => {
  const asaas = fakeAsaas([at('GET', '/payments/pay_1', 200, reread({ status: 'OVERDUE' }))])
  const db = fakeDb({ record_place_payment_link: recorded, fail_place_charge: { data: [{ outcome: 'applied' }] } })
  const r = await pay.handleAsaasWebhook(deps(asaas, db).d, TOKEN, TOKEN, event('PAYMENT_OVERDUE'))
  assert.equal(r.status, 200)
  assert.deepEqual(db.calls.map((c) => c.fn), ['record_place_payment_link', 'fail_place_charge'])
})

test('#923: a database error on the link answers 500 (Asaas resends) and moves no money', async () => {
  for (const type of ['PAYMENT_CREATED', 'PAYMENT_CONFIRMED']) {
    const asaas = fakeAsaas([at('GET', '/payments/pay_1', 200, reread({ status: type === 'PAYMENT_CONFIRMED' ? 'CONFIRMED' : 'PENDING' }))])
    const db = fakeDb({ record_place_payment_link: { error: { code: '57014' } } })
    const r = await pay.handleAsaasWebhook(deps(asaas, db).d, TOKEN, TOKEN, event(type))
    assert.equal(r.status, 500, type)
    assert.deepEqual(db.calls.map((c) => c.fn), ['record_place_payment_link'], type)
  }
})

test('#923: TGP22 (provider data refused) alerts and answers 200 — a resend carries the same data; the charge still confirms', async () => {
  const asaas = fakeAsaas([at('GET', '/payments/pay_1', 200, reread({ status: 'CONFIRMED' }))])
  const db = fakeDb({ record_place_payment_link: { error: { code: 'TGP22', details: 'p_amount_cents' } }, confirm_place_charge: { data: [{ outcome: 'duplicate_charge' }] } })
  const { d, alerts } = deps(asaas, db)
  const r = await pay.handleAsaasWebhook(d, TOKEN, TOKEN, event('PAYMENT_CONFIRMED'))
  assert.equal(r.status, 200)
  assert.deepEqual(db.calls.map((c) => c.fn), ['record_place_payment_link', 'confirm_place_charge'])
  assert.deepEqual(alerts.filter((a) => a.what === 'payment_link_refused').map((a) => a.fields.field), ['p_amount_cents'])
})

test('#923: a URL outside the Asaas hosts (TGP22 url) records the fee without the URLs and alerts', async () => {
  const asaas = fakeAsaas([at('GET', '/payments/pay_1', 200, reread())])
  let n = 0
  const db = fakeDb({})
  const rpc = db.rpc
  db.rpc = async (schema: string, fn: string, args: Record<string, unknown>) => {
    await rpc(schema, fn, args)
    return n++ === 0 ? { data: null, error: { code: 'TGP22', details: 'url' } } : { data: recorded.data, error: null }
  }
  const { d, alerts } = deps(asaas, db)
  const r = await pay.handleAsaasWebhook(d, TOKEN, TOKEN, event('PAYMENT_CREATED'))
  assert.equal(r.status, 200)
  assert.equal(r.body.outcome, 'recorded')
  assert.deepEqual(db.calls.map((c) => [c.args.p_invoice_url, c.args.p_amount_cents]), [[PAY_URL, 14990], [null, 14990]])
  assert.deepEqual(alerts.map((a) => a.what), ['payment_link_refused'])
})

test('#923: subscription_mismatch on the link alerts; unknown_subscription does not', async () => {
  for (const [outcome, alerted] of [['subscription_mismatch', true], ['unknown_subscription', false]] as const) {
    const asaas = fakeAsaas([at('GET', '/payments/pay_1', 200, reread())])
    const db = fakeDb({ record_place_payment_link: { data: [{ outcome }] } })
    const { d, alerts } = deps(asaas, db)
    const r = await pay.handleAsaasWebhook(d, TOKEN, TOKEN, event('PAYMENT_UPDATED'))
    assert.equal(r.status, 200)
    assert.equal(r.body.outcome, outcome)
    assert.equal(alerts.some((a) => a.what === 'payment_link_mismatch'), alerted, outcome)
  }
})

test('#923: a one-off charge (no sub_, e.g. the early-termination fee) never reaches the database', async () => {
  const asaas = fakeAsaas([at('GET', '/payments/pay_1', 200, reread({ subscription: null }))])
  const db = fakeDb({})
  const r = await pay.handleAsaasWebhook(deps(asaas, db).d, TOKEN, TOKEN, event('PAYMENT_CREATED'))
  assert.equal(r.status, 200)
  assert.equal(r.body.outcome, 'no_subscription')
  assert.equal(db.calls.length, 0)
})

test('#923: a wrong token is refused before any re-read or database call', async () => {
  const asaas = fakeAsaas([at('GET', '/payments/pay_1', 200, reread())])
  const db = fakeDb({})
  const r = await pay.handleAsaasWebhook(deps(asaas, db).d, TOKEN, 'wrong', event('PAYMENT_CREATED'))
  assert.equal(r.status, 401)
  assert.equal(asaas.calls.length + db.calls.length, 0)
})

test('#923 contract portal-cobrancas §3 item 3: the operator load records every issued payment of every live plan; one failing list does not stop it', async () => {
  const asaas = fakeAsaas([
    at('GET', '/payments?subscription=sub_1', 200, { data: [reread(), reread({ id: 'pay_2', dueDate: '2026-11-20' })], hasMore: false }),
    at('GET', '/payments?subscription=sub_2', 500, { errors: [{ code: 'x' }] }),
    at('GET', '/payments?subscription=sub_3', 200, { data: [reread({ id: 'pay_3', subscription: 'sub_3' })], hasMore: false }),
  ])
  const db = fakeDb({ record_place_payment_link: recorded })
  const targets = [
    { subscription_id: 'a', provider_subscription_id: 'sub_1', provider_customer_id: 'cus_1', origin: 'portal' },
    { subscription_id: 'b', provider_subscription_id: 'sub_2', provider_customer_id: 'cus_2', origin: 'cms_contract' },
    { subscription_id: 'c', provider_subscription_id: null, provider_customer_id: 'cus_x', origin: 'portal' },
    { subscription_id: 'd', provider_subscription_id: 'sub_3', provider_customer_id: 'cus_3', origin: 'cms_contract' },
  ]
  const { d } = deps(asaas, db, { invoiceTargets: async () => targets })
  const counts = await pay.backfillPaymentLinks(d)
  assert.deepEqual(counts, { recorded: 3, list_failed: 1 })
  assert.deepEqual(linkCalls(db).map((c) => c.args.p_provider_payment_id), ['pay_1', 'pay_2', 'pay_3'])
  assert.equal(asaas.calls.filter((c) => c.path.includes('sub_x')).length, 0)
})
