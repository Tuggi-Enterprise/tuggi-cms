/**
 * #863 — `places-portal-draft`, the only caller of `partner.portal_draft_*`, against
 * `docs/contracts/places-portal-rascunho.md` (workspace) and the security review of #863 (option B).
 * Rules: BR-B2B-043 item 1, BR-B2B-047, BR-B2B-049 item 3.
 *
 * `_shared/places-portal-draft.ts` runs here under Node with every side effect injected. Deno
 * source, loaded through a path built at run time: a static `.ts` import fails the repo's `tsc`.
 *
 * Run with: npm run test:api
 */

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const FUNCTIONS = resolve(import.meta.dirname, '../../supabase/functions')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any

before(async () => {
  mod = await import(pathToFileURL(resolve(FUNCTIONS, '_shared/places-portal-draft.ts')).href)
})

const TOKEN = 'a'.repeat(64)
const CLAIM = 'Zm9vYmFyYmF6cXV4cXV1eGZvb2JhcmJhenF1eHF1dXg'
const SID = '11111111-2222-4333-8444-555555555555'
const USER = '99999999-8888-4777-8666-555555555555'
const SESSION = '77777777-6666-4555-8444-333333333333'
const ACCEPT = { terms_version: 'locais-2026-10-v4', terms_sha256: 'b'.repeat(64), activation_commitment: { sticker: true, display: false, social: true }, marketing_consent: false }
const DRAWN = 'RHJhd25CeVRoZUZ1bmN0aW9uLW5vdC10aGUtV29ya2V'
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64')

type Call = { fn: string; args: Record<string, unknown> }

function fake(answers: Partial<Record<string, { data?: unknown; error?: unknown }>> = {}, settled: string | null = null) {
  const calls: Call[] = []
  const log: string[] = []
  const mails: { to: string; subject: string; html: string; text: string; fromName?: string }[] = []
  const deps = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args })
      log.push(`rpc:${fn}`)
      const a = answers[fn] ?? {}
      return { data: a.data ?? null, error: a.error ?? null }
    },
    storage: {
      list: async (prefix: string) => (prefix.endsWith('facade') ? [{ name: '33333333-2222-4333-8444-555555555555.jpg', created_at: 't1' }, { name: 'evil.txt', created_at: 't' }] : []),
      sign: async (paths: string[]) => Object.fromEntries(paths.map((p) => [p, `https://signed/${p}`])),
      upload: async (path: string) => {
        log.push(`upload:${path}`)
        return true
      },
      remove: async () => true,
    },
    auth: {
      ensureUser: async () => {
        log.push('ensureUser')
        return true
      },
      magicLink: async () => {
        log.push('magicLink')
        return { tokenHash: 'c'.repeat(56), type: 'magiclink' }
      },
      claims: async (jwt: string) => (jwt === 'good' ? { sub: USER, sessionId: SESSION } : null),
    },
    sendEmail: async (to: string, subject: string, html: string, text: string, fromName?: string) => {
      log.push('sendEmail')
      mails.push({ to, subject, html, text, fromName })
      return true
    },
    sha256Hex: async (s: string) => `sha(${s})`,
    uuid: () => '44444444-2222-4333-8444-555555555555',
    randomToken: () => DRAWN,
    submissions: {
      settledOwnerless: async (email: string) => {
        log.push(`settledOwnerless:${email}`)
        return settled
      },
    },
    origin: 'https://places.tuggi.app',
  }
  return { deps, calls, log, mails }
}

test('#863: every database call is one of the fixed partner.portal_draft_* functions (security review, option B)', async () => {
  const f = fake({ portal_draft_get: { data: [{ submission_id: SID }] }, portal_draft_photo_allowed: { data: true } })
  const bodies = [
    { action: 'create', token_sha256: TOKEN, email: 'a@b.co', answers: {} },
    { action: 'get', token_sha256: TOKEN },
    { action: 'save', token_sha256: TOKEN, answers: {} },
    { action: 'consume_generation', token_sha256: TOKEN, kind: 'story_preview' },
    { action: 'terms', token_sha256: TOKEN },
    { action: 'quote', token_sha256: TOKEN, billing_period: 3, voucher_code: 'BEMVINDO' },
    { action: 'photo_list', token_sha256: TOKEN },
    { action: 'photo_sign', token_sha256: TOKEN, paths: [`${SID}/facade/33333333-2222-4333-8444-555555555555.jpg`] },
    { action: 'photo_upload', token_sha256: TOKEN, role: 'facade', image_base64: JPEG },
    { action: 'photo_remove', token_sha256: TOKEN, path: `${SID}/facade/33333333-2222-4333-8444-555555555555.jpg` },
    { action: 'request_link', purpose: 'access', email: 'a@b.co', token_sha256: TOKEN, claim_token: CLAIM },
    { action: 'submit', token_sha256: TOKEN, accept: ACCEPT, ip: '203.0.113.9', user_agent: 'UA' },
    { action: 'payment_state', token_sha256: TOKEN },
    { action: 'claim', claim_token: CLAIM },
    { action: 'rpc', fn: 'portal_draft_claim' },
  ]
  for (const b of bodies) await mod.handle(f.deps, b, 'good')
  assert.ok(f.calls.length > 0)
  for (const c of f.calls) assert.ok(mod.DRAFT_RPCS.includes(c.fn), `unexpected rpc ${c.fn}`)
})

test('#863: an unknown action is refused without touching the database', async () => {
  const f = fake()
  const r = await mod.handle(f.deps, { action: 'rpc', fn: 'portal_draft_claim', token_sha256: TOKEN }, 'good')
  assert.equal(r.status, 400)
  assert.equal(f.calls.length, 0)
})

test('#863: a token that is not 64 lowercase hex never reaches the database', async () => {
  const f = fake()
  for (const t of [undefined, 'A'.repeat(64), 'a'.repeat(63), `${'a'.repeat(63)}g`]) {
    const r = await mod.handle(f.deps, { action: 'get', token_sha256: t }, '')
    assert.equal(r.status, 400)
  }
  assert.equal(f.calls.length, 0)
})

test('#863: the claim takes the user and the session from the verified JWT, never from the body', async () => {
  const f = fake({ portal_draft_claim: { data: SID } })
  const r = await mod.handle(f.deps, { action: 'claim', claim_token: CLAIM, user_id: 'x', session_id: 'y', p_user_id: 'z' }, 'good')
  assert.equal(r.status, 200)
  assert.deepEqual(r.body, { submission_id: SID })
  assert.deepEqual(f.calls, [{ fn: 'portal_draft_claim', args: { p_claim_sha256: `sha(${CLAIM})`, p_user_id: USER, p_session_id: SESSION } }])
})

test('#863: a claim without a valid user JWT is relogin, and nothing is called', async () => {
  const f = fake()
  assert.equal((await mod.handle(f.deps, { action: 'claim', claim_token: CLAIM }, '')).status, 401)
  assert.equal((await mod.handle(f.deps, { action: 'claim', claim_token: CLAIM }, 'forged')).status, 401)
  assert.equal(f.calls.length, 0)
})

test('#863 (BR-B2B-047 item 3): submit is the clickwrap acceptance of the cookie — terms, IP and user agent go to portal_draft_submit', async () => {
  const f = fake({ portal_draft_submit: { data: [{ submission_id: SID, status: 'awaiting_payment', acceptance_id: USER, total_cents: 54000 }] } })
  const r = await mod.handle(f.deps, { action: 'submit', token_sha256: TOKEN, accept: ACCEPT, ip: '203.0.113.9', user_agent: 'Mozilla/5.0', submission_id: 'x', email: 'evil@x.co' }, '')
  assert.deepEqual(r, { status: 200, body: { submission_id: SID, status: 'awaiting_payment', acceptance_id: USER, total_cents: 54000 } })
  assert.deepEqual(f.calls, [{
    fn: 'portal_draft_submit',
    args: {
      p_token_sha256: TOKEN, p_terms_version: 'locais-2026-10-v4', p_terms_sha256: 'b'.repeat(64), p_ip: '203.0.113.9', p_user_agent: 'Mozilla/5.0',
      p_activation_commitment: { sticker: true, display: false, social: true }, p_marketing_consent: false,
    },
  }])
  // Paid plan with a total: no link before the payment (operator, #863 issuecomment-6007476946).
  assert.equal(f.mails.length, 0)
})

test('#863 (BR-B2B-049 item 2, BR-B2B-047): a submit that lands in in_review issues the link from the server and e-mails the acceptance address', async () => {
  const f = fake({
    portal_draft_submit: { data: [{ submission_id: SID, status: 'in_review', acceptance_id: USER, total_cents: 0 }] },
    place_issue_claim: { data: [{ email: 'Dono@Bar.com', expires_at: '2026-10-06T13:00:00Z' }] },
  })
  const r = await mod.handle(f.deps, { action: 'submit', token_sha256: TOKEN, accept: ACCEPT, ip: null, user_agent: null }, '')
  assert.equal(r.status, 200)
  assert.equal(r.body.link, 'sent')
  assert.deepEqual(f.log, ['rpc:portal_draft_submit', 'rpc:place_issue_claim', 'ensureUser', 'magicLink', 'sendEmail'])
  // The token is drawn HERE; only its hash goes to the database. The caller never picks the address.
  assert.deepEqual(f.calls[1].args, { p_submission_id: SID, p_claim_sha256: `sha(${DRAWN})` })
  assert.equal(f.mails[0].to, 'dono@bar.com')
  const href = /href="([^"]+)"/.exec(f.mails[0].html)![1].replace(/&amp;/g, '&')
  assert.deepEqual(Object.fromEntries(new URL(href).searchParams), { th: 'c'.repeat(56), tt: 'magiclink', c: DRAWN })
})

test('#863: an e-mail that fails after the acceptance does not undo it — 200 with link "failed"', async () => {
  const f = fake({
    portal_draft_submit: { data: [{ submission_id: SID, status: 'in_review', acceptance_id: USER, total_cents: 0 }] },
    place_issue_claim: { error: { code: 'TGP29', details: 'claim_requests' } },
  })
  const r = await mod.handle(f.deps, { action: 'submit', token_sha256: TOKEN, accept: ACCEPT }, '')
  assert.equal(r.status, 200)
  assert.equal(r.body.link, 'failed')
})

test('#863: submit refusals — terms changed is 409 terms_changed, a bad IP or accept never reaches the database', async () => {
  const f = fake({ portal_draft_submit: { error: { code: 'TGP09', details: 'terms_version', message: 'dono@bar.com' } } })
  assert.deepEqual(await mod.handle(f.deps, { action: 'submit', token_sha256: TOKEN, accept: ACCEPT }, ''), { status: 409, body: { error: 'terms_changed' } })
  const g = fake()
  for (const b of [
    { action: 'submit', token_sha256: TOKEN, accept: ACCEPT, ip: '1.2.3.4"><' },
    { action: 'submit', token_sha256: TOKEN, accept: ACCEPT, user_agent: 'x'.repeat(1025) },
    { action: 'submit', token_sha256: TOKEN, accept: { ...ACCEPT, terms_version: 'v1"><a' } },
    { action: 'submit', token_sha256: TOKEN, accept: { ...ACCEPT, marketing_consent: 'yes' } },
  ]) assert.equal((await mod.handle(g.deps, b, '')).status, 400)
  assert.equal(g.calls.length, 0)
})

test('#863: payment_state answers pay-or-paid and no customer field (name, tax id, e-mail) leaves', async () => {
  const f = fake({ portal_draft_payment_checkout: { data: [{ submission_id: SID, submission_status: 'awaiting_payment', status: 'pending_payment', next_amount_cents: 54000, customer_name: 'Bar LTDA', customer_tax_id: '12345678000195', customer_email: 'dono@bar.com' }] } })
  const r = await mod.handle(f.deps, { action: 'payment_state', token_sha256: TOKEN }, '')
  assert.deepEqual(r, { status: 200, body: { submission_id: SID, submission_status: 'awaiting_payment', payment_status: 'pending_payment', amount_cents: 54000 } })
  const g = fake({ portal_draft_payment_checkout: { error: { code: 'TGP10', details: 'in_review' } } })
  assert.deepEqual(await mod.handle(g.deps, { action: 'payment_state', token_sha256: TOKEN }, ''), { status: 409, body: { error: 'conflict', detail: 'in_review' } })
})

test('#863: "Reenviar o link" (access) records the claim BEFORE the e-mail; the acceptance link is gone', async () => {
  const f = fake({ portal_draft_request_claim: { data: '2026-10-05T13:00:00Z' } }, SID)
  const r = await mod.handle(f.deps, { action: 'request_link', purpose: 'access', email: ' Dono@Bar.COM ', token_sha256: TOKEN, claim_token: CLAIM }, '')
  assert.equal(r.status, 200)
  assert.deepEqual(f.log, ['rpc:portal_draft_request_claim', 'ensureUser', 'magicLink', 'sendEmail'])
  assert.deepEqual(f.calls[0].args, { p_token_sha256: TOKEN, p_claim_sha256: `sha(${CLAIM})`, p_email: 'dono@bar.com' })
  assert.equal(f.mails[0].fromName, 'Tuggi Locais')
  const g = fake()
  assert.equal((await mod.handle(g.deps, { action: 'request_link', purpose: 'accept', email: 'a@b.co', token_sha256: TOKEN, claim_token: CLAIM, accept: ACCEPT }, '')).status, 400)
  assert.equal(g.calls.length, 0)
})

test('#863: a refused claim request (TGP10 before the acceptance settles, TGP29 5 per hour) sends no e-mail', async () => {
  for (const error of [{ code: 'TGP29', details: 'claim_requests' }, { code: 'TGP10', details: 'payment_pending' }]) {
    const f = fake({ portal_draft_request_claim: { error } })
    const r = await mod.handle(f.deps, { action: 'request_link', purpose: 'access', email: 'a@b.co', token_sha256: TOKEN, claim_token: CLAIM }, '')
    assert.ok(r.status === 429 || r.status === 409)
    assert.ok(!f.log.includes('sendEmail'))
  }
})

test('#863: the access e-mail — fixed subject and text with no data of the submission, the real validity, our origin (no href from the body)', async () => {
  // Security review of #863: the e-mail is not confirmed, so a caller-typed trade name in the subject
  // of a DKIM-signed e-mail from our domain is phishing with our brand. Nothing of the draft goes in.
  const f = fake({ portal_draft_request_claim: { data: 'x' } }, SID)
  await mod.handle(f.deps, { action: 'request_link', purpose: 'access', email: 'a@b.co', token_sha256: TOKEN, claim_token: CLAIM, url: 'https://evil.example/' }, '')
  const m = f.mails[0]
  assert.equal(m.subject, 'Seu local está em validação no Tuggi')
  assert.ok(!f.log.some((l) => l.startsWith('settledOwnerless')), 'no read of the submission for the e-mail')
  assert.ok(!m.text.includes('Bar do Zé') && !m.html.includes('Bar do Zé'), 'no trade name in the body')
  assert.ok(!m.html.includes('evil') && !m.text.includes('evil'))
  assert.match(m.text, /O botão vale por 1 hora e funciona uma vez\. Depois disso, entre em places\.tuggi\.app com este e-mail, e mandamos outro\./)
  assert.ok(!/\d{3}\.\d{3}\.\d{3}-\d{2}|CNPJ|R\$/.test(m.text), 'no CPF, CNPJ or amount')
  const href = /href="([^"]+)"/.exec(m.html)![1].replace(/&amp;/g, '&')
  const u = new URL(href)
  assert.equal(u.origin + u.pathname, 'https://places.tuggi.app/entrar')
  assert.deepEqual(Object.fromEntries(u.searchParams), { th: 'c'.repeat(56), tt: 'magiclink', c: CLAIM })
})

test('#863: the login of an e-mail with a settled ownerless submission issues a NEW access link of it (the promise of the access e-mail)', async () => {
  const f = fake({ place_issue_claim: { data: [{ email: 'a@b.co', expires_at: 'x' }] } }, SID)
  const r = await mod.handle(f.deps, { action: 'request_link', purpose: 'login', email: 'A@b.co' }, '')
  assert.deepEqual(r, { status: 200, body: { ok: true } })
  assert.deepEqual(f.calls, [{ fn: 'place_issue_claim', args: { p_submission_id: SID, p_claim_sha256: `sha(${DRAWN})` } }])
  assert.match(f.mails[0].html, /c=RHJhd25CeVRoZUZ1bmN0aW9uLW5vdC10aGUtV29ya2V/)
  // Not settled after all (TGP10): a plain sign-in, no claim in the link.
  const g = fake({ place_issue_claim: { error: { code: 'TGP10', details: 'payment_pending' } } }, SID)
  await mod.handle(g.deps, { action: 'request_link', purpose: 'login', email: 'a@b.co' }, '')
  assert.ok(!g.mails[0].html.includes('c='))
})

test('#863: login with an ownerless submission over its 5 links/h (TGP29) answers 200 ok and sends nothing — same answer as any e-mail', async () => {
  // Security review of #863: a 429 only here would tell anyone that the e-mail registered a place.
  const f = fake({ place_issue_claim: { error: { code: 'TGP29', details: 'claim_requests' } } }, SID)
  const r = await mod.handle(f.deps, { action: 'request_link', purpose: 'login', email: 'a@b.co' }, '')
  assert.deepEqual(r, { status: 200, body: { ok: true } })
  assert.ok(!f.log.includes('sendEmail'))
  const g = fake()
  assert.deepEqual(await mod.handle(g.deps, { action: 'request_link', purpose: 'login', email: 'a@b.co' }, ''), r)
})

test('#863: the login link with no settled submission needs no draft and goes to /entrar with the token hash only', async () => {
  const f = fake()
  const r = await mod.handle(f.deps, { action: 'request_link', purpose: 'login', email: 'a@b.co' }, '')
  assert.equal(r.status, 200)
  assert.equal(f.calls.length, 0)
  assert.match(f.mails[0].text, /^.*\n\nhttps:\/\/places\.tuggi\.app\/entrar\?th=c{56}&tt=magiclink\n/)
})

test('#863: the portal origin only accepts https://host', () => {
  assert.equal(mod.portalOrigin('https://places.tuggi.app/'), 'https://places.tuggi.app')
  assert.equal(mod.portalOrigin('https://staging.places.tuggi.app:8443'), 'https://staging.places.tuggi.app:8443')
  for (const v of [undefined, '', 'http://places.tuggi.app', 'https://x.app/path', 'javascript:alert(1)']) assert.equal(mod.portalOrigin(v), 'https://places.tuggi.app')
})

test('#863: SQLSTATEs map to codes, never to the message', () => {
  assert.deepEqual(mod.rpcFailure({ code: 'TGP01', message: 'dono@bar.com' }), { status: 404, body: { error: 'not_found' } })
  assert.deepEqual(mod.rpcFailure({ code: 'TGP10', details: 'claim_used' }), { status: 409, body: { error: 'conflict', detail: 'claim_used' } })
  assert.deepEqual(mod.rpcFailure({ code: '42501', details: 'email' }), { status: 403, body: { error: 'forbidden', detail: 'email' } })
  assert.deepEqual(mod.rpcFailure({ code: 'PGRST202' }), { status: 503, body: { error: 'unavailable' } })
})

test('#863: the upload path is built here, checked by portal_draft_photo_allowed, and only JPEG goes up', async () => {
  const f = fake({ portal_draft_get: { data: [{ submission_id: SID }] }, portal_draft_photo_allowed: { data: true } })
  const r = await mod.handle(f.deps, { action: 'photo_upload', token_sha256: TOKEN, role: 'gallery', image_base64: JPEG, path: 'other/x.jpg' }, '')
  const path = `${SID}/gallery/44444444-2222-4333-8444-555555555555.jpg`
  assert.deepEqual(r, { status: 200, body: { path, url: `https://signed/${path}` } })
  assert.deepEqual(f.calls[1], { fn: 'portal_draft_photo_allowed', args: { p_token_sha256: TOKEN, p_name: path, p_action: 'insert' } })
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')
  assert.equal((await mod.handle(f.deps, { action: 'photo_upload', token_sha256: TOKEN, role: 'gallery', image_base64: png }, '')).status, 400)
})

test('#863: an upload the database refuses is not sent to Storage', async () => {
  const f = fake({ portal_draft_get: { data: [{ submission_id: SID }] }, portal_draft_photo_allowed: { data: false } })
  const r = await mod.handle(f.deps, { action: 'photo_upload', token_sha256: TOKEN, role: 'facade', image_base64: JPEG }, '')
  assert.equal(r.status, 403)
  assert.ok(!f.log.some((l) => l.startsWith('upload:')))
})

test('#863: the photo list keeps only the paths of this draft', async () => {
  const f = fake({ portal_draft_get: { data: [{ submission_id: SID }] } })
  const r = await mod.handle(f.deps, { action: 'photo_list', token_sha256: TOKEN }, '')
  assert.deepEqual(r.body, { photos: [{ path: `${SID}/facade/33333333-2222-4333-8444-555555555555.jpg`, created_at: 't1' }] })
})

test('#863: the function gates on its own secret, in constant time, and logs no PII', () => {
  const gate = readFileSync(resolve(FUNCTIONS, '_shared/places-draft-secret.ts'), 'utf8')
  assert.match(gate, /constantTimeEqual\(candidate, expected\)/)
  assert.match(gate, /DRAFT_SECRET_ENV/)
  const src = readFileSync(resolve(FUNCTIONS, 'places-portal-draft/index.ts'), 'utf8')
  assert.match(src, /isDraftSecret\(req\.headers\.get\(DRAFT_SECRET_HEADER\)/)
  assert.ok(!src.includes('places-secret.ts') && !/env\.get\('PLACES_CMS_SECRET'\)/.test(src), 'must not reuse the CMS secret')
  for (const line of src.split('\n').filter((l) => /console\.(log|error)/.test(l))) {
    assert.ok(!/email|token|answers|path\b/i.test(line.replace(/'\[places-portal-draft\][^']*'/, '')), `log line leaks: ${line.trim()}`)
  }
})

test('#863 (BR-B2B-045, BR-B2B-055): terms of the anonymous draft carry published_at; no plan_choice yet is an empty 200, not a 404', async () => {
  const row = { terms_version: 'locais-2026-10-v3', body_html: '<p>x</p>', sha256: 'b'.repeat(64), published_at: '2026-10-01T00:00:00Z' }
  const f = fake({ portal_draft_get_terms: { data: [row] } })
  const r = await mod.handle(f.deps, { action: 'terms', token_sha256: TOKEN }, '')
  assert.deepEqual(r, { status: 200, body: row })
  assert.deepEqual(f.calls, [{ fn: 'portal_draft_get_terms', args: { p_token_sha256: TOKEN } }])
  assert.deepEqual(await mod.handle(fake({ portal_draft_get_terms: { data: [] } }).deps, { action: 'terms', token_sha256: TOKEN }, ''), { status: 200, body: {} })
  const bad = await mod.handle(fake({ portal_draft_get_terms: { error: { code: 'TGP22', details: 'plan_choice' } } }).deps, { action: 'terms', token_sha256: TOKEN }, '')
  assert.deepEqual(bad, { status: 422, body: { error: 'invalid', field: 'plan_choice' } })
})

test('#863 (BR-B2B-045): quote of the anonymous draft is portal_draft_quote with the voucher; shape checked before the database', async () => {
  const row = { pricing_version: 'p1', monthly_base_cents: 9900, billing_period: 3, base_total_cents: 29700, period_discount_percent: 10, period_discount_cents: 2970, voucher_status: 'applied', voucher_discount_cents: 1000, total_cents: 25730 }
  const f = fake({ portal_draft_quote: { data: [row] } })
  const r = await mod.handle(f.deps, { action: 'quote', token_sha256: TOKEN, billing_period: 3, voucher_code: 'BEMVINDO' }, '')
  assert.deepEqual(r, { status: 200, body: row })
  assert.deepEqual(f.calls, [{ fn: 'portal_draft_quote', args: { p_token_sha256: TOKEN, p_billing_period: 3, p_voucher_code: 'BEMVINDO' } }])
  await mod.handle(f.deps, { action: 'quote', token_sha256: TOKEN, billing_period: 1 }, '')
  assert.equal(f.calls[1].args.p_voucher_code, null)
  const g = fake()
  for (const b of [{ billing_period: '3' }, { billing_period: 2.5 }, { billing_period: 0 }, { billing_period: 3, voucher_code: 'A B' }, { billing_period: 3, voucher_code: 'x'.repeat(65) }, { billing_period: 3, voucher_code: 7 }]) {
    assert.equal((await mod.handle(g.deps, { action: 'quote', token_sha256: TOKEN, ...b }, '')).status, 400)
  }
  assert.equal((await mod.handle(g.deps, { action: 'quote', billing_period: 3 }, '')).status, 400)
  assert.equal(g.calls.length, 0)
  const gone = await mod.handle(fake({ portal_draft_quote: { error: { code: 'TGP01' } } }).deps, { action: 'quote', token_sha256: TOKEN, billing_period: 3 }, '')
  assert.deepEqual(gone, { status: 404, body: { error: 'not_found' } })
})
