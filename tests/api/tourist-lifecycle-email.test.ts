/**
 * #957, BR-COMUNICACAO-020: who receives which tourist e-mail, and the two functions that send it.
 *
 * - The selection (`_shared/tourist-lifecycle-email.ts`): reengagement at 7, 14 and 30 days and
 *   then nothing; `email_opt_in` NULL, false and true; unsubscribed; using the app; the 7-day
 *   ceiling of the hours-earned e-mail; one e-mail per expiry date.
 * - `tourist-lifecycle-email/index.ts`, whole, under Node: the dry run reserves and sends nothing;
 *   the real run reserves BEFORE it sends and sends only what it reserved.
 * - `send-transactional`, the tourist route: the signed unsubscribe link and the RFC 8058 pair.
 *
 * The two handlers import `_shared/auth-middleware.ts`, which imports esm.sh; the redirect below is
 * the one of `edge-transactional-links.test.ts`. Every request carries the machine key.
 */

import { test, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const FUNCTIONS = resolve(import.meta.dirname, '../../supabase/functions')
const REMOTE_STUB = pathToFileURL(resolve(import.meta.dirname, './marketing-ef-remote-module-stub.mjs')).href

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('https://esm.sh/')) return { url: REMOTE_STUB, shortCircuit: true }
    return nextResolve(specifier, context)
  },
})

const EF_SECRET_KEY = 'sb_secret_TEST_EDGE_FUNCTION_KEY'
const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-10-18T12:00:00Z')
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString()
const ahead = (days: number, hours = 0) => new Date(NOW.getTime() + days * DAY + hours * 3600_000).toISOString()

type Handler = (req: Request) => Promise<Response>
let plan: any
let env: Record<string, string | undefined>
const handlers: Record<string, Handler> = {}
let registering = ''

function installDeno(): void {
  ;(globalThis as { Deno?: unknown }).Deno = {
    env: { get: (name: string) => env[name] },
    serve: (fn: Handler) => {
      handlers[registering] = fn
    },
  }
}

before(async () => {
  env = {}
  installDeno()
  plan = await import(pathToFileURL(resolve(FUNCTIONS, '_shared/tourist-lifecycle-email.ts')).href)
  registering = 'lifecycle'
  await import(pathToFileURL(resolve(FUNCTIONS, 'tourist-lifecycle-email/index.ts')).href)
  registering = 'transactional'
  await import(pathToFileURL(resolve(FUNCTIONS, 'send-transactional/index.ts')).href)
  assert.equal(typeof handlers.lifecycle, 'function')
  assert.equal(typeof handlers.transactional, 'function')
})

/** A tourist who is not using the app, with nothing due, and every gate open. */
function row(over: Record<string, unknown> = {}) {
  return {
    user_id: 'u1',
    email: 'ana@example.com',
    language: 'pt-br',
    timezone: 'America/Sao_Paulo',
    email_opt_in: null,
    unsubscribed: false,
    is_active: false,
    last_used_at: ago(3),
    earned_unseen_minutes: 0,
    earned_unseen_count: 0,
    earned_nickname: null,
    earned_expires_at: null,
    last_hours_earned_email_at: null,
    expiring_minutes: 0,
    expiring_at: null,
    balance_minutes: 0,
    sent_keys: [],
    ...over,
  }
}

const run = (rows: unknown[]) =>
  plan.planTouristLifecycleEmails({ rows, now: NOW, relayDomainVerifiedRaw: undefined })

// ===============================================================================================
// SELECTION
// ===============================================================================================

test('BR-COMUNICACAO-020 item 3: reengagement at 7, 14 and 30 days without use, and then it stops', () => {
  const at = (idle: number) => run([row({ email_opt_in: true, last_used_at: ago(idle) })]).recipients[0]?.type ?? null
  assert.equal(at(6), null)
  assert.equal(at(7), 'tourist_reengagement_7')
  assert.equal(at(13), 'tourist_reengagement_7')
  assert.equal(at(14), 'tourist_reengagement_14')
  assert.equal(at(29), 'tourist_reengagement_14')
  assert.equal(at(30), 'tourist_reengagement_30')
  // "It has been a month" stops being true; a long-dormant account gets nothing.
  assert.equal(at(30 + plan.REENGAGEMENT_LAST_STAGE_GRACE_DAYS), null)
  assert.equal(at(200), null)
})

test('BR-COMUNICACAO-020 item 3: each stage once per absence, and using the app again re-arms it', () => {
  const anchor = ago(8)
  const sentSeven = `reengagement_7:${anchor}`
  assert.equal(run([row({ email_opt_in: true, last_used_at: anchor, sent_keys: [sentSeven] })]).recipients.length, 0)
  // A new absence has a new anchor, so the key of the old one does not hold it back.
  const again = run([row({ email_opt_in: true, last_used_at: ago(7), sent_keys: [sentSeven] })])
  assert.equal(again.recipients[0].type, 'tourist_reengagement_7')
  assert.notEqual(again.recipients[0].dedupe_key, sentSeven)
})

test('BR-COMUNICACAO-020 items 3 and 5: reengagement only with email_opt_in = true (NULL is not yes, false is no)', () => {
  for (const [optIn, expected] of [[null, 0], [false, 0], [true, 1]] as const) {
    const out = run([row({ email_opt_in: optIn, last_used_at: ago(7) })])
    assert.equal(out.recipients.length, expected, `email_opt_in=${optIn}`)
  }
})

test('BR-COMUNICACAO-020 item 2: the service e-mail goes without opt-in (NULL and false alike)', () => {
  for (const optIn of [null, false, true]) {
    const out = run([row({ email_opt_in: optIn, earned_unseen_minutes: 60, earned_unseen_count: 1, earned_nickname: 'Bia' })])
    assert.equal(out.recipients[0]?.type, 'tourist_hours_earned', `email_opt_in=${optIn}`)
    assert.equal(out.recipients[0].data.nickname, 'Bia')
  }
})

test('BR-COMUNICACAO-020 item 4: the unsubscribed address gets nothing, and an unknown answer counts as unsubscribed', () => {
  const due = { email_opt_in: true, last_used_at: ago(7), earned_unseen_minutes: 60, expiring_minutes: 30, expiring_at: ahead(3) }
  for (const unsubscribed of [true, null]) {
    const out = run([row({ ...due, unsubscribed })])
    assert.equal(out.recipients.length, 0)
    assert.equal(out.discarded.unsubscribed, 1)
  }
})

test('BR-COMUNICACAO-019 item 2: whoever is using the app gets none of the three (unknown counts as using)', () => {
  const due = { email_opt_in: true, last_used_at: ago(7), earned_unseen_minutes: 60 }
  for (const isActive of [true, null]) {
    const out = run([row({ ...due, is_active: isActive })])
    assert.equal(out.recipients.length, 0)
    assert.equal(out.discarded.active, 1)
  }
})

test('BR-COMUNICACAO-020 item 2.a: at most one hours-earned e-mail per 7 days; the nickname only for one credit', () => {
  const earned = { earned_unseen_minutes: 120, earned_unseen_count: 2, earned_nickname: 'Bia' }
  assert.equal(run([row({ ...earned, last_hours_earned_email_at: ago(6) })]).recipients.length, 0)
  const out = run([row({ ...earned, last_hours_earned_email_at: ago(7) })])
  assert.equal(out.recipients[0].type, 'tourist_hours_earned')
  assert.equal(out.recipients[0].data.nickname, null)
  assert.equal(out.recipients[0].data.minutes, 120)
})

test('BR-COMUNICACAO-020 item 2.b: hours expiring 3 days before, once per expiry date', () => {
  const exp = ahead(2, 23)
  const first = run([row({ expiring_minutes: 45, expiring_at: exp })])
  assert.equal(first.recipients[0].type, 'tourist_hours_expiring')
  assert.equal(first.recipients[0].dedupe_key, 'hours_expiring:2026-10-21')
  assert.equal(run([row({ expiring_minutes: 45, expiring_at: ahead(4) })]).recipients.length, 0)
  assert.equal(run([row({ expiring_minutes: 45, expiring_at: exp, sent_keys: ['hours_expiring:2026-10-21'] })]).recipients.length, 0)
})

test('one e-mail per address per run, the most perishable first', () => {
  const out = run([
    row({
      email_opt_in: true,
      last_used_at: ago(7),
      earned_unseen_minutes: 60,
      expiring_minutes: 30,
      expiring_at: ahead(3),
    }),
    row({ user_id: 'u2', email: 'ANA@example.com', email_opt_in: true, last_used_at: ago(14) }),
  ])
  assert.equal(out.recipients.length, 1)
  assert.equal(out.recipients[0].type, 'tourist_hours_expiring')
  assert.equal(out.discarded.address_superseded, 1)
})

test('BR-COMUNICACAO-020 item 7: no relay address before the domain is verified', () => {
  const relay = row({ email: 'x@privaterelay.appleid.com', email_opt_in: true, last_used_at: ago(7) })
  const closed = plan.planTouristLifecycleEmails({ rows: [relay], now: NOW, relayDomainVerifiedRaw: 'yes' })
  assert.equal(closed.discarded.apple_relay_domain_unverified, 1)
  const open = plan.planTouristLifecycleEmails({ rows: [relay], now: NOW, relayDomainVerifiedRaw: 'true' })
  assert.equal(open.recipients.length, 1)
})

test('the audit line counts and never names', () => {
  const line = plan.lifecycleAuditLine(run([row({ email_opt_in: true, last_used_at: ago(7) })]), true)
  assert.doesNotMatch(line, /ana@|u1/)
  assert.match(line, /no_cadence_arbiter=1/)
})

// ===============================================================================================
// THE TWO HANDLERS
// ===============================================================================================

let calls: { url: string; body: any }[]
let candidates: unknown[]
let claimAnswer: unknown
/** What `marketing.email_unsubscribes` answers for the address `send-transactional` looks up. */
let unsubscribeAnswer: { status: number; body: unknown }

beforeEach(() => {
  env = {
    RESEND_API_KEY: 'test-key',
    NEWSLETTER_SECRET: 'test-newsletter-secret',
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SECRET_KEYS: JSON.stringify({ ef_secret_key: EF_SECRET_KEY }),
  }
  calls = []
  candidates = [row({ email_opt_in: true, last_used_at: new Date(Date.now() - 8 * DAY).toISOString() })]
  claimAnswer = true
  unsubscribeAnswer = { status: 200, body: [] }
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    const body = init?.body ? JSON.parse(String(init.body)) : null
    calls.push({ url: u, body })
    if (u.endsWith('/rpc/get_tourist_lifecycle_email_candidates')) return new Response(JSON.stringify(candidates))
    if (u.endsWith('/rpc/claim_tourist_lifecycle_email')) return new Response(JSON.stringify(claimAnswer))
    if (u.includes('/rest/v1/email_unsubscribes?')) {
      return new Response(JSON.stringify(unsubscribeAnswer.body), { status: unsubscribeAnswer.status })
    }
    return new Response(JSON.stringify({ id: 'resend-1' }), { status: 200 })
  }) as typeof fetch
})

const post = (fn: 'lifecycle' | 'transactional', path: string, body: unknown, auth = true) =>
  handlers[fn](
    new Request(`http://localhost/${fn === 'lifecycle' ? 'tourist-lifecycle-email' : 'send-transactional'}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${EF_SECRET_KEY}` } : {}) },
      body: JSON.stringify(body),
    })
  )

test('tourist-lifecycle-email refuses a caller without a key', async () => {
  const res = await post('lifecycle', '/run', { dry_run: false }, false)
  assert.equal(res.status, 401)
  assert.equal(calls.length, 0)
})

test('dry run is the default: it lists who would receive, and reserves and sends nothing', async () => {
  const res = await post('lifecycle', '/run', {})
  const out = await res.json()
  assert.equal(out.dry_run, true)
  assert.deepEqual(out.would_send.map((r: any) => r.type), ['tourist_reengagement_7'])
  assert.equal(out.would_send[0].email, undefined, 'the address left in the answer')
  assert.deepEqual(calls.map((c) => c.url.split('/').pop()), ['get_tourist_lifecycle_email_candidates'])
})

test('the real run reserves BEFORE it sends, and sends through send-transactional in the profile language', async () => {
  const out = await (await post('lifecycle', '/run', { dry_run: false })).json()
  assert.equal(out.sent, 1)
  const names = calls.map((c) => c.url.split('/').pop())
  assert.deepEqual(names, ['get_tourist_lifecycle_email_candidates', 'claim_tourist_lifecycle_email', 'send'])
  assert.equal(calls[1].body.p_kind, 'tourist_reengagement_7')
  assert.match(calls[2].url, /\/functions\/v1\/send-transactional\/send$/)
  assert.deepEqual(
    { type: calls[2].body.type, to: calls[2].body.to, lang: calls[2].body.lang },
    { type: 'tourist_reengagement_7', to: 'ana@example.com', lang: 'pt' }
  )
})

test('a slot the database refuses, or cannot prove, sends nothing', async () => {
  for (const answer of [false, null]) {
    calls = []
    claimAnswer = answer
    const out = await (await post('lifecycle', '/run', { dry_run: false })).json()
    assert.equal(out.sent, 0)
    assert.ok(!calls.some((c) => c.url.endsWith('/send')), `claim=${answer} still sent`)
  }
})

test('without the candidates function (migration not applied) the run answers 503 and sends nothing', async () => {
  globalThis.fetch = (async (url: string | URL | Request) => {
    calls.push({ url: String(url), body: null })
    return new Response(JSON.stringify({ code: 'PGRST202' }), { status: 404 })
  }) as typeof fetch
  const res = await post('lifecycle', '/run', { dry_run: false })
  assert.equal(res.status, 503)
  assert.equal((await res.json()).detail, 'get_tourist_lifecycle_email_candidates:PGRST202')
})

test('BR-COMUNICACAO-020 item 4: send-transactional signs the unsubscribe over `to` and sends the RFC 8058 pair', async () => {
  const res = await post('transactional', '/send', {
    type: 'tourist_hours_earned',
    to: 'ana@example.com',
    lang: 'fr',
    data: { minutes: 300, expires_at: '2026-12-17T15:00:00Z', url: 'https://atacante.exemplo' },
  })
  assert.equal(res.status, 200)
  const resend = calls.find((c) => c.url === 'https://api.resend.com/emails')!.body
  assert.equal(resend.subject, 'Tu as gagné 5 h sur Tuggi')
  assert.match(resend.headers['List-Unsubscribe'], /^<https:\/\/project\.supabase\.co\/functions\/v1\/send-newsletter\/unsubscribe\?e=/)
  assert.equal(resend.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click')
  assert.match(resend.html, /https:\/\/www\.tuggi\.app\/en\/unsubscribe\?e=[^&]+&amp;s=[^&]+&amp;lang=fr/)
  assert.match(resend.html, /Ne plus recevoir les avis et nouveautés de Tuggi/)
  assert.match(resend.html, /Tu reçois cet e-mail parce que tu as un compte Tuggi\./)
  assert.doesNotMatch(resend.html, /atacante/)
  assert.match(resend.text, /Ne plus recevoir/)
})

test('send-transactional sends no tourist e-mail it cannot unsubscribe from, nor one missing its facts', async () => {
  env.NEWSLETTER_SECRET = undefined
  const noSecret = await post('transactional', '/send', { type: 'tourist_reengagement_14', to: 'ana@example.com', lang: 'pt' })
  assert.equal(noSecret.status, 422)
  env.NEWSLETTER_SECRET = 'x'
  const noHours = await post('transactional', '/send', { type: 'tourist_hours_earned', to: 'ana@example.com', lang: 'pt', data: {} })
  assert.equal(noHours.status, 422)
  const badTo = await post('transactional', '/send', { type: 'tourist_reengagement_14', to: 'not-an-address', lang: 'pt' })
  assert.equal(badTo.status, 400)
  assert.ok(!calls.some((c) => c.url.startsWith('https://api.resend.com')))
})

test('BR-COMUNICACAO-020 item 4: send-transactional refuses, unsent, a tourist e-mail to an unsubscribed address', async () => {
  // The route is reachable by hand too (an operator testing a template), so the list is applied
  // here and not only in the selection. The lookup lowercases as every writer of the list does.
  unsubscribeAnswer = { status: 200, body: [{ email: 'ana@example.com' }] }
  const res = await post('transactional', '/send', { type: 'tourist_reengagement_14', to: 'Ana@Example.COM', lang: 'pt' })
  assert.equal(res.status, 409)
  assert.equal((await res.json()).error, 'unsubscribed')
  const lookup = calls.find((c) => c.url.includes('/rest/v1/email_unsubscribes?'))!
  assert.match(lookup.url, /email=eq\.ana%40example\.com/)
  assert.ok(!calls.some((c) => c.url.startsWith('https://api.resend.com')), 'an unsubscribed address reached Resend')

  // A list it cannot read counts as unsubscribed: fail closed.
  for (const answer of [{ status: 500, body: { code: '42501' } }, { status: 200, body: { not: 'an array' } }]) {
    calls = []
    unsubscribeAnswer = answer
    const unknown = await post('transactional', '/send', { type: 'tourist_hours_earned', to: 'ana@example.com', lang: 'pt', data: { minutes: 60 } })
    assert.equal(unknown.status, 503)
    assert.ok(!calls.some((c) => c.url.startsWith('https://api.resend.com')), `list ${answer.status} still sent`)
  }
})
