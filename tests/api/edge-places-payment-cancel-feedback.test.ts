/**
 * #913: the cancellation survey of the Portal Locais (BR-B2B-060), on the EF side: `cancel_renewal`
 * takes an optional `feedback`, sanitizes it, records it after the cancel, and the cancel e-mail
 * thanks instead of asking when a reason or a comment came.
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
let pay: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let asaasMod: any

before(async () => {
  pay = await import(pathToFileURL(resolve(SHARED, 'places-payment.ts')).href)
  asaasMod = await import(pathToFileURL(resolve(SHARED, 'asaas.ts')).href)
})

const SUB_UUID = '11111111-2222-4333-8444-555555555555'
const SUBMISSION = '99999999-8888-4777-8666-555555555555'
const CONSENT = 'Aceito que a equipe Tuggi fale comigo sobre o cancelamento, pelo e-mail ou telefone do cadastro.'
const ASK = 'Pode contar para a gente por que cancelou? Basta responder este e-mail. Uma linha já nos ajuda a melhorar.'
const THANKS = 'Obrigado por contar o motivo no portal. Se quiser dizer mais alguma coisa, é só responder este e-mail.'

type RpcCall = { schema: string; fn: string; args: Record<string, unknown> }

/** fee 0, commitment served: the simplest cancel that takes effect (endDate at Asaas, e-mail). */
function scenario(opts: { recordError?: { code: string } | null; recordThrows?: boolean; ids?: unknown } = {}) {
  const admin: RpcCall[] = []
  const user: RpcCall[] = []
  const mail = { text: '', html: '' }
  const fetch = async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname
    if (init.method === 'PUT' && path.endsWith('/subscriptions/sub_1')) return new Response('{}', { status: 200 })
    if ((init.method ?? 'GET') === 'GET' && path.endsWith('/payments')) return new Response(JSON.stringify({ data: [] }), { status: 200 })
    return new Response(JSON.stringify({ errors: [{ code: 'not_found' }] }), { status: 404 })
  }
  const d = {
    asaas: asaasMod.asaasClient({ baseUrl: 'https://api-sandbox.asaas.com/v3', apiKey: 'k', fetch }),
    admin: async (schema: string, fn: string, args: Record<string, unknown>) => {
      admin.push({ schema, fn, args })
      if (fn === 'record_place_cancellation_feedback') {
        if (opts.recordThrows) throw new Error('network down')
        return { data: opts.recordError ? null : 'feedback-id', error: opts.recordError ?? null }
      }
      return { data: null, error: null }
    },
    user: async (schema: string, fn: string, args: Record<string, unknown>) => {
      user.push({ schema, fn, args })
      return {
        data: [{ outcome: 'applied', renews: false, commitment_ends_at: '2027-01-06T15:00:00Z', paid_through: '2027-01-06T15:00:00Z', early_termination_fee_cents: 0 }],
        error: null,
      }
    },
    subscriptionIds: async () =>
      'ids' in opts ? opts.ids : { subscription_id: SUB_UUID, payment_method: 'credit_card', provider_subscription_id: 'sub_1', provider_customer_id: 'cus_1', canceled_at: null },
    userEmail: async () => 'ze@example.com',
    sendEmail: async (_to: string, _subject: string, text: string, m?: { html?: string }) => {
      Object.assign(mail, { text, html: m?.html ?? '' })
      return true
    },
    alert: async () => {},
    today: () => '2026-10-08',
    now: () => new Date('2026-10-08T12:00:00Z'),
  }
  const record = () => admin.filter((c) => c.fn === 'record_place_cancellation_feedback')
  return { d, admin, user, mail, record }
}

test('#913 BR-B2B-060 items 3, 4, 5 and 6: sanitizeCancelFeedback keeps what is valid and drops the rest, field by field', () => {
  const s = pay.sanitizeCancelFeedback
  assert.deepEqual(s(undefined), { reason: null, comment: null, contactConsent: false, contactConsentText: null })
  assert.deepEqual(s('too_expensive'), { reason: null, comment: null, contactConsent: false, contactConsentText: null })
  assert.deepEqual(s([]), { reason: null, comment: null, contactConsent: false, contactConsentText: null })
  for (const code of ['too_expensive', 'no_results', 'few_tourists', 'closing_business', 'portal_or_payment_issue', 'other']) {
    assert.equal(s({ reason: code }).reason, code)
  }
  assert.equal(s({ reason: 'TOO_EXPENSIVE' }).reason, null)
  assert.equal(s({ reason: 'cheaper_elsewhere' }).reason, null)
  assert.equal(s({ reason: 1 }).reason, null)
  // comment: trimmed; empty or over 1000 after the trim → null; the reason survives a bad comment
  assert.equal(s({ comment: '  caro demais  ' }).comment, 'caro demais')
  assert.equal(s({ comment: '   ' }).comment, null)
  assert.equal(s({ comment: 'a'.repeat(1000) }).comment, 'a'.repeat(1000))
  assert.equal(s({ comment: ` ${'a'.repeat(1000)} ` }).comment, 'a'.repeat(1000))
  assert.deepEqual(s({ reason: 'other', comment: 'a'.repeat(1001) }), { reason: 'other', comment: null, contactConsent: false, contactConsentText: null })
  // consent: only `true` with its text; text without consent is not kept
  assert.deepEqual(s({ contact_consent: true, contact_consent_text: CONSENT }), { reason: null, comment: null, contactConsent: true, contactConsentText: CONSENT })
  assert.equal(s({ contact_consent: true }).contactConsent, false)
  assert.equal(s({ contact_consent: true, contact_consent_text: '  ' }).contactConsent, false)
  assert.equal(s({ contact_consent: 'true', contact_consent_text: CONSENT }).contactConsent, false)
  assert.deepEqual(s({ contact_consent: false, contact_consent_text: CONSENT }), { reason: null, comment: null, contactConsent: false, contactConsentText: null })
  assert.equal(s({ contact_consent: true, contact_consent_text: 'x'.repeat(501) }).contactConsent, false)
})

test('#913 BR-B2B-060 items 5 and 7: with feedback, the record goes with the owner\'s subscription (from the submission), after the cancel, sanitized', async () => {
  const x = scenario()
  const r = await pay.cancelRenewal(x.d, SUBMISSION, undefined, {
    reason: 'few_tourists',
    comment: '  Pouca gente  ',
    contact_consent: true,
    contact_consent_text: CONSENT,
  })
  assert.deepEqual(r, { status: 200, body: { result: 'canceled' } })
  assert.deepEqual(x.user.map((c) => c.fn), ['portal_cancel_renewal'])
  assert.deepEqual(x.record(), [
    {
      schema: 'partner',
      fn: 'record_place_cancellation_feedback',
      args: { p_subscription_id: SUB_UUID, p_reason: 'few_tourists', p_comment: 'Pouca gente', p_contact_consent: true, p_contact_consent_text: CONSENT },
    },
  ])
})

test('#913 BR-B2B-060 item 7: without feedback the cancel still records, all empty (the CMS counts the answer rate over every cancel)', async () => {
  const x = scenario()
  assert.deepEqual(await pay.cancelRenewal(x.d, SUBMISSION), { status: 200, body: { result: 'canceled' } })
  assert.deepEqual(x.record().map((c) => c.args), [
    { p_subscription_id: SUB_UUID, p_reason: null, p_comment: null, p_contact_consent: false, p_contact_consent_text: null },
  ])
})

test('#913 BR-B2B-060 item 6: an invalid answer is dropped, the cancel goes through the same', async () => {
  const x = scenario()
  const r = await pay.cancelRenewal(x.d, SUBMISSION, undefined, { reason: 'drop table', comment: 'a'.repeat(5000), contact_consent: true })
  assert.deepEqual(r, { status: 200, body: { result: 'canceled' } })
  assert.deepEqual(x.record()[0].args, { p_subscription_id: SUB_UUID, p_reason: null, p_comment: null, p_contact_consent: false, p_contact_consent_text: null })
})

test('#913 BR-B2B-060 item 6: a failed record (error, exception, or no subscription row) never fails nor undoes the cancel', async () => {
  for (const opts of [{ recordError: { code: '23514' } }, { recordThrows: true }, { ids: null }]) {
    const x = scenario(opts)
    const r = await pay.cancelRenewal(x.d, SUBMISSION, undefined, { reason: 'too_expensive' })
    assert.deepEqual(r, { status: 200, body: { result: 'canceled' } }, JSON.stringify(opts))
    assert.ok(x.mail.text.length > 0, 'the e-mail still goes')
  }
})

test('#913: a repeated cancel (not_applicable) is not a new cancel and records nothing', async () => {
  const x = scenario()
  ;(x.d as Record<string, unknown>).user = async () => ({ data: [{ outcome: 'not_applicable', renews: false, commitment_ends_at: null, paid_through: null, early_termination_fee_cents: 0 }], error: null })
  assert.deepEqual(await pay.cancelRenewal(x.d, SUBMISSION, undefined, { reason: 'other' }), { status: 200, body: { result: 'not_renewing' } })
  assert.deepEqual(x.record(), [])
})

test('#913 BR-B2B-060 item 9: the e-mail thanks when a reason or a comment was kept, and asks otherwise', async () => {
  const cases: [unknown, string][] = [
    [undefined, ASK],
    [{ contact_consent: true, contact_consent_text: CONSENT }, ASK],
    [{ reason: 'not_a_code' }, ASK],
    [{ reason: 'too_expensive' }, THANKS],
    [{ comment: 'Mudei de cidade' }, THANKS],
  ]
  for (const [feedback, closing] of cases) {
    const x = scenario()
    await pay.cancelRenewal(x.d, SUBMISSION, undefined, feedback)
    assert.ok(x.mail.text.includes(closing), JSON.stringify(feedback))
    assert.ok(x.mail.html.includes(closing), JSON.stringify(feedback))
    assert.ok(!x.mail.text.includes(closing === ASK ? THANKS : ASK))
    assert.doesNotMatch(x.mail.text, /consentimento|falar com você/i, 'the e-mail never mentions the contact consent')
  }
})

test('#913 BR-B2B-060 item 9: CANCEL_EMAIL.build keeps the question by default (callers without the survey)', () => {
  assert.ok(pay.CANCEL_EMAIL.build('06/01/2027', null).text.includes(ASK))
  assert.ok(pay.CANCEL_EMAIL.build('06/01/2027', null, true).text.includes(THANKS))
})
