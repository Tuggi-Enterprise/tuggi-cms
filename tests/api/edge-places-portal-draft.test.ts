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
const ACCEPT = { terms_version: 'locais-2026-10-v3', terms_sha256: 'b'.repeat(64), activation_commitment: { sticker: true, display: false, social: true }, marketing_consent: false }
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64')

type Call = { fn: string; args: Record<string, unknown> }

function fake(answers: Partial<Record<string, { data?: unknown; error?: unknown }>> = {}) {
  const calls: Call[] = []
  const log: string[] = []
  const mails: { to: string; subject: string; html: string; text: string }[] = []
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
    sendEmail: async (to: string, subject: string, html: string, text: string) => {
      log.push('sendEmail')
      mails.push({ to, subject, html, text })
      return true
    },
    sha256Hex: async (s: string) => `sha(${s})`,
    uuid: () => '44444444-2222-4333-8444-555555555555',
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
    { action: 'photo_list', token_sha256: TOKEN },
    { action: 'photo_sign', token_sha256: TOKEN, paths: [`${SID}/facade/33333333-2222-4333-8444-555555555555.jpg`] },
    { action: 'photo_upload', token_sha256: TOKEN, role: 'facade', image_base64: JPEG },
    { action: 'photo_remove', token_sha256: TOKEN, path: `${SID}/facade/33333333-2222-4333-8444-555555555555.jpg` },
    { action: 'request_link', purpose: 'accept', email: 'a@b.co', token_sha256: TOKEN, claim_token: CLAIM, accept: ACCEPT },
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

test('#863: the accept link records the claim (hash only) BEFORE the e-mail, then sends it', async () => {
  const f = fake({ portal_draft_request_claim: { data: '2026-10-05T13:00:00Z' } })
  const r = await mod.handle(f.deps, { action: 'request_link', purpose: 'accept', email: ' Dono@Bar.COM ', token_sha256: TOKEN, claim_token: CLAIM, accept: ACCEPT }, '')
  assert.equal(r.status, 200)
  assert.deepEqual(f.log, ['rpc:portal_draft_request_claim', 'ensureUser', 'magicLink', 'sendEmail'])
  assert.deepEqual(f.calls[0].args, { p_token_sha256: TOKEN, p_claim_sha256: `sha(${CLAIM})`, p_email: 'dono@bar.com' })
  assert.equal(f.mails[0].to, 'dono@bar.com')
})

test('#863: a refused claim request (TGP29, 5 per hour) sends no e-mail', async () => {
  const f = fake({ portal_draft_request_claim: { error: { code: 'TGP29', details: 'claim_requests' } } })
  const r = await mod.handle(f.deps, { action: 'request_link', purpose: 'accept', email: 'a@b.co', token_sha256: TOKEN, claim_token: CLAIM, accept: ACCEPT }, '')
  assert.deepEqual(r, { status: 429, body: { error: 'quota', detail: 'claim_requests' } })
  assert.ok(!f.log.includes('sendEmail'))
})

test('#863: the link is built on our origin from checked values only (no href from the body)', async () => {
  const f = fake({ portal_draft_request_claim: { data: 'x' } })
  await mod.handle(f.deps, { action: 'request_link', purpose: 'accept', email: 'a@b.co', token_sha256: TOKEN, claim_token: CLAIM, accept: ACCEPT, url: 'https://evil.example/' }, '')
  const href = /href="([^"]+)"/.exec(f.mails[0].html)![1].replace(/&amp;/g, '&')
  const u = new URL(href)
  assert.equal(u.origin + u.pathname, 'https://places.tuggi.app/entrar')
  assert.deepEqual(Object.fromEntries(u.searchParams), { th: 'c'.repeat(56), tt: 'magiclink', c: CLAIM, tv: 'locais-2026-10-v3', ts: 'b'.repeat(64), ac: '101', mk: '0' })
  assert.ok(!f.mails[0].html.includes('evil'))
})

test('#863: a malformed claim token, terms version or hash is refused before the database', async () => {
  const f = fake()
  const base = { action: 'request_link', purpose: 'accept', email: 'a@b.co', token_sha256: TOKEN, claim_token: CLAIM, accept: ACCEPT }
  for (const b of [
    { ...base, claim_token: '../../x' },
    { ...base, accept: { ...ACCEPT, terms_version: 'v1"><a' } },
    { ...base, accept: { ...ACCEPT, terms_sha256: 'z'.repeat(64) } },
    { ...base, accept: { ...ACCEPT, marketing_consent: 'yes' } },
  ]) {
    assert.equal((await mod.handle(f.deps, b, '')).status, 400)
  }
  assert.equal(f.calls.length, 0)
})

test('#863: the login link needs no draft and goes to /entrar with the token hash only', async () => {
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
  const src = readFileSync(resolve(FUNCTIONS, 'places-portal-draft/index.ts'), 'utf8')
  assert.match(src, /constantTimeEqual\(candidate, expected\)/)
  assert.match(src, /DRAFT_SECRET_ENV/)
  assert.ok(!src.includes('places-secret.ts') && !/env\.get\('PLACES_CMS_SECRET'\)/.test(src), 'must not reuse the CMS secret')
  for (const line of src.split('\n').filter((l) => /console\.(log|error)/.test(l))) {
    assert.ok(!/email|token|answers|path\b/i.test(line.replace(/'\[places-portal-draft\][^']*'/, '')), `log line leaks: ${line.trim()}`)
  }
})
