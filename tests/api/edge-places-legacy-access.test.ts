/**
 * #916 — the clients from before the portal: the access e-mail and its run
 * (`_shared/places-legacy-access.ts`), and the legacy fee in the payment EF
 * (`_shared/places-payment.ts`: `cancel_legacy`, the migration hook, the sweep and the webhook).
 * Contracts: `docs/contracts/places-portal-rascunho.md` and `places-pagamento.md` (workspace).
 *
 * Deno source, loaded through a path built at run time: a static `.ts` import fails the repo's `tsc`.
 *
 * Run with: npm run test:api
 */

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DUE_DAY_OF_MONTH } from '../../lib/contract/template'

const SHARED = resolve(import.meta.dirname, '../../supabase/functions/_shared')

// Untyped on purpose: a `typeof import` would pull the `.ts` sibling imports into `tsc` (TS5097).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Mod = any
let access: Mod
let pay: Mod
let legacy: Mod
let asaasMod: Mod

before(async () => {
  access = await import(pathToFileURL(resolve(SHARED, 'places-legacy-access.ts')).href)
  pay = await import(pathToFileURL(resolve(SHARED, 'places-payment.ts')).href)
  legacy = await import(pathToFileURL(resolve(SHARED, 'places-legacy-customers.ts')).href)
  asaasMod = await import(pathToFileURL(resolve(SHARED, 'asaas.ts')).href)
})

const CLIENT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const SUBMISSION = '99999999-8888-4777-8666-555555555555'
const LEGACY_REF = `legacy:${CLIENT}`
const PORTAL_REF = 'com_historia_3m:11111111-2222-4333-8444-555555555555'
const TOKEN = 'whk-token-123'
const ORIGIN = 'https://partner.tuggi.app'

// ─── the e-mail ──────────────────────────────────────────────────────────────────────────────

test('#916 spec §1: legacy access e-mail, paying variant: subject, preheader, the place name, no exit fee, the button and the two small lines', () => {
  const m = access.legacyAccessEmail('https://partner.tuggi.app/auth?x=1', ORIGIN, { placeName: 'Bar do Zé', paying: true })
  assert.equal(m.subject, 'Acesse o portal do seu local no Tuggi')
  assert.match(m.html, /Veja o seu plano e mude quando quiser\./)
  assert.match(m.text, /^Olá,\n\no Bar do Zé já está no app do Tuggi, e agora você acompanha a sua conta pelo portal de parceiros\./)
  assert.match(m.text, /Lá você vê o seu plano, o valor e o vencimento, e pode trocar de plano ou cancelar quando quiser, sem taxa de saída\./)
  assert.match(m.text, /Entrar no portal: https:\/\/partner\.tuggi\.app\/auth\?x=1/)
  assert.match(m.text, /O botão vale por 1 hora e funciona uma vez\. Depois disso, entre em partner\.tuggi\.app com este e-mail, e mandamos outro\./)
  assert.match(m.text, /Não reconhece este local\? Escreva para suporte@tuggi\.app\./)
  assert.match(m.text, /Equipe Tuggi$/)
  assert.doesNotMatch(m.text, /história em áudio/)
})

test('#916 spec §1: legacy access e-mail, free variant speaks of the audio story, not of price or cancelling', () => {
  const m = access.legacyAccessEmail('https://x.test/a', ORIGIN, { placeName: 'Pousada Sol', paying: false })
  assert.match(m.text, /Lá você vê o seu plano e, quando quiser adicionar a história em áudio do seu local, é só pedir por lá\./)
  assert.doesNotMatch(m.text, /taxa de saída|cancelar/)
})

test('#916: the place name is escaped in the HTML, flattened to one line, and absent → "o seu local"', () => {
  const m = access.legacyAccessEmail('https://x.test/a', ORIGIN, { placeName: '<b>Bar</b>\n& Cia', paying: true })
  assert.match(m.html, /o &lt;b&gt;Bar&lt;\/b&gt; &amp; Cia já está/)
  assert.doesNotMatch(m.html, /<b>Bar/)
  const none = access.legacyAccessEmail('https://x.test/a', ORIGIN, { placeName: '  ', paying: true })
  assert.match(none.text, /o seu local já está no app/)
})

// ─── the run ─────────────────────────────────────────────────────────────────────────────────

const rows = [
  { id: CLIENT, name: 'Bar do Zé', monthly_fee_cents: 10000, is_courtesy: false },
  { id: 'aaaaaaaa-bbbb-4ccc-8ddd-000000000002', name: 'Cortesia', monthly_fee_cents: 10000, is_courtesy: true },
  { id: 'aaaaaaaa-bbbb-4ccc-8ddd-000000000003', name: 'Grátis', monthly_fee_cents: 0, is_courtesy: false },
]

function runDeps(over: Record<string, unknown> = {}) {
  const seeded: string[] = []
  const mails: { submissionId: string; text: string }[] = []
  const pauses: number[] = []
  const d = {
    seed: async (id: string) => {
      seeded.push(id)
      return { data: `5${id.slice(1)}`, error: null }
    },
    link: async (submissionId: string, build: (url: string, origin: string) => { text: string }) => {
      mails.push({ submissionId, text: build('https://x.test/a', ORIGIN).text })
      return { kind: 'sent' }
    },
    pause: async (ms: number) => {
      pauses.push(ms)
    },
    ...over,
  }
  return { d, seeded, mails, pauses }
}

test('#916: dry run writes nothing and sends nothing; courtesy and no fee are the free variant', async () => {
  const { d, seeded, mails } = runDeps()
  const out = await access.runLegacyAccess(d, rows, true)
  assert.deepEqual(out.map((r: { variant: string; status: string }) => `${r.variant}:${r.status}`), ['paying:would_send', 'free:would_send', 'free:would_send'])
  assert.equal(seeded.length + mails.length, 0)
})

test('#916: real run seeds, then sends the link of THAT submission with the right variant, spaced for Resend (10 req/s)', async () => {
  const { d, seeded, mails, pauses } = runDeps()
  const out = await access.runLegacyAccess(d, rows, false)
  assert.deepEqual(seeded, rows.map((r) => r.id))
  assert.equal(mails[0].submissionId, `5${CLIENT.slice(1)}`)
  assert.match(mails[0].text, /sem taxa de saída/)
  assert.match(mails[1].text, /história em áudio/)
  assert.match(mails[2].text, /história em áudio/)
  assert.deepEqual(out.map((r: { status: string }) => r.status), ['sent', 'sent', 'sent'])
  assert.deepEqual(pauses, [access.SEND_SPACING_MS, access.SEND_SPACING_MS, access.SEND_SPACING_MS])
  assert.ok(access.SEND_SPACING_MS >= 100)
  // ids, variant and codes only: no name, no e-mail in what the EF answers and logs
  assert.doesNotMatch(JSON.stringify(out), /Bar do Zé|@/)
})

test('#916: a database refusal is reported per client and never stops the run; an owned submission sends nothing; a link failure is reported', async () => {
  let n = 0
  const { d, mails } = runDeps({
    seed: async (id: string) => (id === CLIENT ? { data: null, error: { code: 'TGP10', details: 'no_place', message: 'x@y.z' } } : { data: [`5${id.slice(1)}`], error: null }),
    link: async () => (++n === 1 ? { kind: 'owned' } : { kind: 'failed', result: { status: 429, body: { error: 'quota', detail: 'claim_rate' } } }),
  })
  const out = await access.runLegacyAccess(d, rows, false)
  assert.deepEqual(out[0], { client_id: CLIENT, variant: 'paying', status: 'refused', code: 'TGP10', detail: 'no_place' })
  assert.equal(out[1].status, 'owned')
  assert.deepEqual({ status: out[2].status, code: out[2].code, detail: out[2].detail }, { status: 'failed', code: 'quota', detail: 'claim_rate' })
  assert.equal(mails.length, 0)
  assert.doesNotMatch(JSON.stringify(out), /x@y\.z/)
})

test('#916 (SSOT): the legacy due day of the EF is the contract DUE_DAY_OF_MONTH of the CMS', () => {
  assert.equal(legacy.LEGACY_DUE_DAY, DUE_DAY_OF_MONTH)
})

test('#916: the legacy subscription reference is legacy:<client_id>, and the portal reference is not legacy', () => {
  assert.equal(legacy.legacySubscriptionReference(CLIENT.toUpperCase()), LEGACY_REF)
  assert.equal(legacy.isLegacySubscriptionReference(LEGACY_REF), true)
  assert.equal(legacy.isLegacySubscriptionReference(PORTAL_REF), false)
  assert.equal(legacy.isLegacySubscriptionReference(CLIENT), false)
  assert.equal(legacy.isLegacySubscriptionReference(null), false)
})

// ─── payment: harness ────────────────────────────────────────────────────────────────────────

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
function fakeDb(answers: Record<string, { data?: unknown; error?: { code?: string; details?: string } | null }>) {
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
  const mails: { to: string; subject: string; text: string; opts: Record<string, unknown> }[] = []
  const d = {
    asaas: asaas.client,
    admin: db.rpc,
    subscriptionIds: async () => null,
    subscriptionById: async () => null,
    expiredLiveCards: async () => [],
    cancelsToRedo: async () => [],
    alert: async (what: string, fields: Record<string, unknown>) => {
      if (what !== 'invoice_config_missing') alerts.push({ what, fields })
    },
    today: () => '2026-10-08',
    now: () => new Date('2026-10-08T12:00:00Z'),
    submissionOfSubscription: async () => SUBMISSION,
    accessLink: async () => 'owned' as const,
    invoiceConfig: null,
    invoiceStatusOf: async () => null,
    invoiceTargets: async () => [],
    sentPayouts: async () => [],
    legacyOf: async () => ({ client_id: CLIENT, fee_ended_at: null }),
    legacyFeesEnded: async () => [],
    userEmail: async () => 'ze@example.com',
    sendEmail: async (to: string, subject: string, text: string, opts: Record<string, unknown>) => {
      mails.push({ to, subject, text, opts })
      return true
    },
    ...extra,
  }
  return { d, alerts, mails }
}

const legacySub = { id: 'sub_legacy', status: 'ACTIVE', value: 100, externalReference: LEGACY_REF, deleted: false }
const portalSub = { id: 'sub_portal', status: 'ACTIVE', value: 540, externalReference: PORTAL_REF, deleted: false }
const subsByLegacyRef = (data: unknown[]) => at('GET', `/subscriptions?externalReference=${encodeURIComponent(LEGACY_REF)}`, 200, { data })
const payingOwner = () => fakeDb({ portal_get_submission: { data: [{ submission_id: SUBMISSION, legacy_monthly_fee_cents: 10000 }] }, portal_end_legacy_fee: { data: CLIENT } })

// ─── payment: pure ───────────────────────────────────────────────────────────────────────────

test('#916: the legacy plan cancelled with a month paid ends on the next day 20, strictly after today', () => {
  assert.equal(pay.nextLegacyDueDate('2026-10-08'), '2026-10-20')
  assert.equal(pay.nextLegacyDueDate('2026-10-20'), '2026-11-20')
  assert.equal(pay.nextLegacyDueDate('2026-12-25'), '2027-01-20')
  const paid = [{ id: 'p1', status: 'RECEIVED', value: 100, dueDate: '2026-09-20' }]
  assert.equal(pay.legacyEndsOn(paid, '2026-10-08'), '2026-10-20')
  // in cash (marked by hand in Asaas) counts as paid
  assert.equal(pay.legacyEndsOn([{ ...paid[0], status: 'RECEIVED_IN_CASH' }], '2026-10-08'), '2026-10-20')
  // a paid fee older than a month, or only pending/overdue: it ends today
  assert.equal(pay.legacyEndsOn([{ ...paid[0], dueDate: '2026-08-20' }], '2026-10-08'), null)
  assert.equal(pay.legacyEndsOn([{ ...paid[0], status: 'OVERDUE' }], '2026-10-08'), null)
  assert.equal(pay.legacyEndsOn([], '2026-10-08'), null)
})

// ─── payment: cancel_legacy ──────────────────────────────────────────────────────────────────

test('#916 BR-B2B-060: cancel_legacy — the database first with the user JWT, then DELETE of the legacy subscription only (never the portal one), no exit fee, the e-mail with the end date', async () => {
  const asaas = fakeAsaas([
    subsByLegacyRef([legacySub, portalSub, { ...legacySub, id: 'sub_old', deleted: true }]),
    at('GET', '/payments?subscription=sub_legacy', 200, { data: [{ id: 'pay_9', status: 'RECEIVED', value: 100, dueDate: '2026-09-20' }] }),
    at('DELETE', '/subscriptions/sub_legacy', 200, { deleted: true }),
  ])
  const db = fakeDb({})
  const user = payingOwner()
  const { d, alerts, mails } = deps(asaas, db, { user: user.rpc })
  const r = await pay.cancelLegacy(d, SUBMISSION)
  assert.deepEqual(r, { status: 200, body: { result: 'canceled', ends_on: '2026-10-20' } })
  assert.deepEqual(user.calls, [{ schema: 'core', fn: 'portal_end_legacy_fee', args: { p_submission_id: SUBMISSION } }])
  assert.equal(db.calls.length, 0)
  const deletes = asaas.calls.filter((c) => c.method === 'DELETE').map((c) => c.path)
  assert.deepEqual(deletes, ['/subscriptions/sub_legacy'])
  // no fee: nothing is created or edited at Asaas
  assert.ok(!asaas.calls.some((c) => c.method === 'POST' || c.method === 'PUT'))
  assert.equal(alerts.length, 0)
  assert.equal(mails.length, 1)
  assert.equal(mails[0].to, 'ze@example.com')
  assert.equal(mails[0].subject, 'Seu plano mensal no Tuggi foi cancelado')
  assert.match(mails[0].text, /Seu plano termina em 20\/10\/2026, quando acabaria o mês já pago\. Depois disso não há nova cobrança nem taxa de saída\./)
  assert.equal(mails[0].opts.fromName, 'Tuggi Locais')
  assert.equal(mails[0].opts.replyTo, 'suporte@tuggi.app')
  // design ajuste 2: no reason step in the legacy cancel, so the e-mail asks it
  assert.match(mails[0].text, /Pode contar para a gente por que cancelou\? Basta responder este e-mail\. Uma linha já nos ajuda a melhorar\./)
})

test('#916: cancel_legacy with no month paid ends today', async () => {
  const asaas = fakeAsaas([
    subsByLegacyRef([legacySub]),
    at('GET', '/payments?subscription=sub_legacy', 200, { data: [] }),
    at('DELETE', '/subscriptions/sub_legacy', 200, { deleted: true }),
  ])
  const { d, alerts, mails } = deps(asaas, fakeDb({}), { user: payingOwner().rpc })
  const r = await pay.cancelLegacy(d, SUBMISSION)
  assert.deepEqual(r, { status: 200, body: { result: 'canceled', ends_on: null } })
  assert.match(mails[0].text, /Seu plano termina hoje\. Não há cobrança nem taxa de saída\./)
  assert.equal(alerts.length, 0)
})

test('#916 (security): cancel_legacy of a paying client with no live legacy:<id> at Asaas alerts legacy_subscription_not_found, and the flow does not change', async () => {
  const asaas = fakeAsaas([subsByLegacyRef([])])
  const { d, alerts, mails } = deps(asaas, fakeDb({}), { user: payingOwner().rpc })
  const r = await pay.cancelLegacy(d, SUBMISSION)
  assert.deepEqual(r, { status: 200, body: { result: 'canceled', ends_on: null } })
  assert.deepEqual(alerts.map((a) => a.what), ['legacy_subscription_not_found'])
  assert.deepEqual(alerts[0].fields, { submission_id: SUBMISSION, client_id: CLIENT })
  assert.equal(mails.length, 1)
})

test('#916: cancel_legacy refused by the database (not the owner, not a paying legacy) touches nothing at Asaas', async () => {
  for (const [code, status] of [['TGP01', 404], ['TGP10', 409], ['42501', 401]] as const) {
    const asaas = fakeAsaas([])
    const { d, mails } = deps(asaas, fakeDb({}), { user: fakeDb({ portal_end_legacy_fee: { error: { code } } }).rpc })
    const r = await pay.cancelLegacy(d, SUBMISSION)
    assert.equal(r.status, status)
    assert.equal(asaas.calls.length + mails.length, 0)
  }
  const asaas = fakeAsaas([])
  const { d } = deps(asaas, fakeDb({}), { user: payingOwner().rpc })
  assert.equal((await pay.cancelLegacy(d, 'not-a-uuid')).status, 400)
})

test('#916: cancel_legacy with Asaas down — the database is not undone, the operator is alerted (the sweep ends it), the owner still gets 200 and the e-mail', async () => {
  const asaas = fakeAsaas([at('GET', '/subscriptions?', 503, {})])
  const { d, alerts, mails } = deps(asaas, fakeDb({}), { user: payingOwner().rpc })
  const r = await pay.cancelLegacy(d, SUBMISSION)
  assert.deepEqual(r, { status: 200, body: { result: 'canceled', ends_on: null } })
  assert.deepEqual(alerts.map((a) => a.what), ['legacy_subscription_end_failed'])
  assert.equal(alerts[0].fields.client_id, CLIENT)
  assert.equal(mails.length, 1)
})

test('#916: cancel_legacy_quote — owner and paying legacy proved by portal_get_submission with the user JWT; writes nothing', async () => {
  const asaas = fakeAsaas([
    subsByLegacyRef([legacySub]),
    at('GET', '/payments?subscription=sub_legacy', 200, { data: [{ id: 'pay_9', status: 'CONFIRMED', value: 100, dueDate: '2026-10-20' }] }),
  ])
  const user = payingOwner()
  const db = fakeDb({})
  const { d } = deps(asaas, db, { user: user.rpc })
  assert.deepEqual(await pay.legacyCancelQuote(d, SUBMISSION), { status: 200, body: { ends_on: '2026-10-20' } })
  assert.deepEqual(user.calls.map((c) => c.fn), ['portal_get_submission'])
  assert.ok(!asaas.calls.some((c) => c.method !== 'GET'))
  assert.equal(db.calls.length, 0)

  // a portal submission (legacy fee null) or a legacy fee already ended: 409, Asaas never read
  for (const fee of [null, 0]) {
    const a = fakeAsaas([])
    const x = deps(a, fakeDb({}), { user: fakeDb({ portal_get_submission: { data: [{ submission_id: SUBMISSION, legacy_monthly_fee_cents: fee }] } }).rpc })
    assert.deepEqual(await pay.legacyCancelQuote(x.d, SUBMISSION), { status: 409, body: { error: 'not_allowed', reason: 'not_legacy_paid' } })
    assert.equal(a.calls.length, 0)
  }
})

// ─── payment: migration ──────────────────────────────────────────────────────────────────────

const checkoutBody = {
  action: 'checkout',
  submission_id: SUBMISSION,
  card: { number: '4111111111111111', holder_name: 'Maria Silva', expiry_month: '05', expiry_year: '2029', ccv: '123' },
  holder: { cpf_cnpj: '12345678909', postal_code: '28950000', address_number: '12', phone: '22999998888' },
  remote_ip: '203.0.113.9',
}
const checkoutRow = {
  subscription_id: '11111111-2222-4333-8444-555555555555', status: 'pending_payment', attachable: true, external_reference: PORTAL_REF, billing_cycle: 'MONTHLY',
  billing_period: 3, next_amount_cents: 54000, renewal_amount_cents: 60000, next_due_date: '2026-11-07',
  customer_name: 'Bar do Zé LTDA', customer_tax_id: '12.345.678/0001-95', customer_email: 'ze@example.com',
}
const checkoutRoutes = () => [
  at('GET', `/subscriptions?externalReference=${encodeURIComponent(PORTAL_REF)}`, 200, { data: [] }),
  at('GET', '/customers?', 200, { data: [] }),
  at('POST', '/customers', 200, { id: 'cus_1' }),
  at('POST', '/subscriptions', 200, { id: 'sub_new', status: 'ACTIVE', value: 540 }),
]
const owner = () => fakeDb({ portal_get_subscription: { data: [{ submission_id: SUBMISSION, status: 'pending_payment', renews: true }] } })

test('#916: the paying legacy client migrates — AFTER the new plan is attached, place_end_legacy_fee(migrated), then DELETE of the legacy subscription', async () => {
  const asaas = fakeAsaas([...checkoutRoutes(), subsByLegacyRef([legacySub]), at('DELETE', '/subscriptions/sub_legacy', 200, { deleted: true })])
  const db = fakeDb({ place_payment_checkout: { data: [checkoutRow] }, attach_place_subscription: { data: 'pending_payment' }, place_end_legacy_fee: { data: CLIENT } })
  const { d, alerts } = deps(asaas, db, { user: owner().rpc })
  const r = await pay.checkout(d, checkoutBody)
  assert.deepEqual(r, { status: 200, body: { result: 'scheduled', first_charge_on: '2026-11-07' } })
  assert.deepEqual(db.calls.map((c) => c.fn), ['place_payment_checkout', 'attach_place_subscription', 'place_end_legacy_fee'])
  assert.deepEqual(db.calls[2].args, { p_submission_id: SUBMISSION, p_reason: 'migrated' })
  const order = asaas.calls.map((c) => `${c.method} ${c.path.split('?')[0]}`)
  assert.ok(order.indexOf('POST /subscriptions') < order.indexOf('DELETE /subscriptions/sub_legacy'))
  assert.deepEqual(asaas.calls.filter((c) => c.method === 'DELETE').map((c) => c.path), ['/subscriptions/sub_legacy'])
  // security: the mirror stays live, so the operator is told there is a story to validate
  assert.deepEqual(alerts.map((a) => [a.what, a.fields]), [['legacy_migrated', { submission_id: SUBMISSION }]])
})

test('#916 (security): the paying legacy client migrates with no live legacy:<id> at Asaas — legacy_subscription_not_found, then legacy_migrated; the checkout still succeeds', async () => {
  const asaas = fakeAsaas([...checkoutRoutes(), subsByLegacyRef([])])
  const db = fakeDb({ place_payment_checkout: { data: [checkoutRow] }, attach_place_subscription: { data: 'pending_payment' }, place_end_legacy_fee: { data: CLIENT } })
  const { d, alerts } = deps(asaas, db, { user: owner().rpc })
  assert.equal((await pay.checkout(d, checkoutBody)).status, 200)
  assert.deepEqual(alerts.map((a) => a.what), ['legacy_subscription_not_found', 'legacy_migrated'])
  assert.deepEqual(alerts[0].fields, { submission_id: SUBMISSION, client_id: CLIENT })
})

test('#916: refused card — the legacy fee is NOT ended (the client never stays without a plan)', async () => {
  const asaas = fakeAsaas([
    at('GET', '/subscriptions?', 200, { data: [] }),
    at('GET', '/customers?', 200, { data: [] }),
    at('POST', '/customers', 200, { id: 'cus_1' }),
    at('POST', '/subscriptions', 400, { errors: [{ code: 'invalid_creditCard' }] }),
  ])
  const db = fakeDb({ place_payment_checkout: { data: [checkoutRow] } })
  const { d } = deps(asaas, db, { user: owner().rpc })
  assert.equal((await pay.checkout(d, checkoutBody)).status, 402)
  assert.ok(!db.calls.some((c) => c.fn === 'place_end_legacy_fee'))
  assert.ok(!asaas.calls.some((c) => c.method === 'DELETE'))
})

test('#916: a portal submission (not legacy) checks out as before; a legacy fee already ended only re-runs the idempotent DELETE; Asaas failing after the attach alerts and never fails the checkout', async () => {
  {
    const asaas = fakeAsaas(checkoutRoutes())
    const db = fakeDb({ place_payment_checkout: { data: [checkoutRow] }, attach_place_subscription: { data: 'pending_payment' } })
    const { d, alerts } = deps(asaas, db, { user: owner().rpc, legacyOf: async () => null })
    assert.equal((await pay.checkout(d, checkoutBody)).status, 200)
    assert.ok(!alerts.some((a) => a.what.startsWith('legacy')))
    assert.deepEqual(db.calls.map((c) => c.fn), ['place_payment_checkout', 'attach_place_subscription'])
    assert.ok(!asaas.calls.some((c) => c.path.includes('legacy')))
  }
  {
    const asaas = fakeAsaas([...checkoutRoutes(), subsByLegacyRef([])])
    const db = fakeDb({ place_payment_checkout: { data: [checkoutRow] }, attach_place_subscription: { data: 'pending_payment' } })
    const { d, alerts } = deps(asaas, db, { user: owner().rpc, legacyOf: async () => ({ client_id: CLIENT, fee_ended_at: '2026-10-01T00:00:00Z' }) })
    assert.equal((await pay.checkout(d, checkoutBody)).status, 200)
    assert.ok(!db.calls.some((c) => c.fn === 'place_end_legacy_fee'))
    // a fee ended before proves nothing about Asaas: no legacy_subscription_not_found
    assert.deepEqual(alerts.map((a) => a.what), ['legacy_migrated'])
  }
  {
    const asaas = fakeAsaas([...checkoutRoutes(), at('GET', `/subscriptions?externalReference=${encodeURIComponent(LEGACY_REF)}`, 503, {})])
    const db = fakeDb({ place_payment_checkout: { data: [checkoutRow] }, attach_place_subscription: { data: 'pending_payment' }, place_end_legacy_fee: { data: CLIENT } })
    const { d, alerts } = deps(asaas, db, { user: owner().rpc })
    assert.equal((await pay.checkout(d, checkoutBody)).status, 200)
    assert.deepEqual(alerts.map((a) => a.what), ['legacy_migration_end_failed', 'legacy_migrated'])
  }
})

// ─── payment: sweep ──────────────────────────────────────────────────────────────────────────

test('#916: the sweep ends a legacy subscription still live after the database ended the fee, and alerts; none live → nothing', async () => {
  const asaas = fakeAsaas([subsByLegacyRef([legacySub, portalSub]), at('DELETE', '/subscriptions/sub_legacy', 200, { deleted: true })])
  const { d, alerts } = deps(asaas, fakeDb({}), { legacyFeesEnded: async () => [CLIENT] })
  const summary = await pay.runSweep(d)
  assert.equal(summary.legacy_ended, 1)
  assert.deepEqual(asaas.calls.filter((c) => c.method === 'DELETE').map((c) => c.path), ['/subscriptions/sub_legacy'])
  assert.deepEqual(alerts.filter((a) => a.what.startsWith('legacy')).map((a) => a.what), ['legacy_subscription_ended_by_sweep'])

  const quiet = fakeAsaas([subsByLegacyRef([])])
  const x = deps(quiet, fakeDb({}), { legacyFeesEnded: async () => [CLIENT] })
  assert.equal((await pay.runSweep(x.d)).legacy_ended, 0)
  assert.ok(!x.alerts.some((a) => a.what.includes('legacy')))
})

// ─── payment: webhook ────────────────────────────────────────────────────────────────────────

test('#916: a charge of the legacy subscription answers 200 legacy — no database call, no unknown_subscription alert', async () => {
  for (const p of [
    { id: 'pay_l', status: 'RECEIVED', value: 100, subscription: 'sub_legacy', externalReference: LEGACY_REF, customer: 'cus_1' },
    // no reference on the charge: the subscription's says it
    { id: 'pay_l', status: 'OVERDUE', value: 100, subscription: 'sub_legacy', externalReference: null, customer: 'cus_1' },
  ]) {
    const asaas = fakeAsaas([at('GET', '/payments/pay_l', 200, p), at('GET', '/subscriptions/sub_legacy', 200, legacySub)])
    const db = fakeDb({})
    const { d, alerts } = deps(asaas, db)
    const r = await pay.handleAsaasWebhook(d, TOKEN, TOKEN, { id: 'evt_l', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_l' } })
    assert.deepEqual(r, { status: 200, body: { outcome: 'legacy' } })
    assert.equal(db.calls.length, 0)
    assert.equal(alerts.length, 0)
  }
})

test('#916: SUBSCRIPTION_DELETED of the legacy subscription answers 200 legacy, no alert', async () => {
  const asaas = fakeAsaas([at('GET', '/subscriptions/sub_legacy', 200, { ...legacySub, deleted: true })])
  const db = fakeDb({})
  const { d, alerts } = deps(asaas, db)
  const r = await pay.handleAsaasWebhook(d, TOKEN, TOKEN, { id: 'evt_d', event: 'SUBSCRIPTION_DELETED', subscription: { id: 'sub_legacy' } })
  assert.deepEqual(r, { status: 200, body: { outcome: 'legacy' } })
  assert.equal(db.calls.length + alerts.length, 0)
})

test('#916: a portal charge still goes to the database; the legacy check never turns a failed subscription read into a 500', async () => {
  const p = { id: 'pay_p', status: 'CONFIRMED', value: 540, subscription: 'sub_x', externalReference: null, customer: 'cus_9', confirmedDate: '2026-10-08' }
  const asaas = fakeAsaas([
    at('GET', '/payments/pay_p', 200, p),
    at('GET', '/subscriptions/sub_x', 503, {}),
    at('GET', '/customers/cus_9', 200, { id: 'cus_9', externalReference: '11111111-2222-4333-8444-555555555555' }),
  ])
  const db = fakeDb({ confirm_place_charge: { data: [{ outcome: 'applied' }] } })
  const { d } = deps(asaas, db, { subscriptionById: async () => ({ provider_subscription_id: 'sub_x' }) })
  const r = await pay.handleAsaasWebhook(d, TOKEN, TOKEN, { id: 'evt_p', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_p' } })
  assert.equal(r.status, 200)
  assert.deepEqual(db.calls.map((c) => c.fn), ['confirm_place_charge'])
})

// ─── CMS: the mirror submission is no portal registration ───────────────────────────────────

test('#916 BR-B2B-047 item 1: a legacy mirror with no acceptance is no portal registration; once a portal plan is accepted on it, it is', async () => {
  const { isLegacyMirror } = await import('../../lib/services/portal-validation-service')
  assert.equal(isLegacyMirror({ legacy_client_id: CLIENT, place_acceptances: null }), true)
  assert.equal(isLegacyMirror({ legacy_client_id: CLIENT, place_acceptances: [] }), true)
  assert.equal(isLegacyMirror({ legacy_client_id: CLIENT, place_acceptances: { id: 'acc' } }), false)
  assert.equal(isLegacyMirror({ legacy_client_id: null, place_acceptances: null }), false)
  assert.equal(isLegacyMirror({}), false)
})
