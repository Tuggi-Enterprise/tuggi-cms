/**
 * #1231, BR-COMUNICACAO-019 3.h.2 and BR-MONETIZACAO-086 6.b: the eve of a short concession's
 * expiry, by e-mail and by push, from the rows of `marketing.get_tourist_lifecycle_email_candidates`
 * that carry `short_expiring_on`.
 *
 * - The plan (`planEveNotices`): using the app or not, the e-mail gates of BR-COMUNICACAO-020, one
 *   e-mail per date, the quiet hours of the push.
 * - The run (`runEveNotices`): claim before send, nothing given back, the per-run ceiling.
 * - `tourist-lifecycle-email/index.ts`, `/eve`, whole, under Node, with `fetch` stubbed.
 * - The copy of the push (`_shared/hours-expiring-push.ts`) and of the e-mail (`tourist-email.ts`).
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
const USER_A = '6f1c2d3e-4b5a-4c6d-8e7f-90a1b2c3d4e4' // last digit even: variant a
const USER_B = '6f1c2d3e-4b5a-4c6d-8e7f-90a1b2c3d4e5' // last digit odd: variant b

type Handler = (req: Request) => Promise<Response>
let plan: any
let push: any
let email: any
let env: Record<string, string | undefined>
let handler: Handler

before(async () => {
  env = {}
  ;(globalThis as { Deno?: unknown }).Deno = {
    env: { get: (name: string) => env[name] },
    serve: (fn: Handler) => {
      handler = fn
    },
  }
  plan = await import(pathToFileURL(resolve(FUNCTIONS, '_shared/tourist-lifecycle-email.ts')).href)
  push = await import(pathToFileURL(resolve(FUNCTIONS, '_shared/hours-expiring-push.ts')).href)
  email = await import(pathToFileURL(resolve(FUNCTIONS, '_shared/tourist-email.ts')).href)
  await import(pathToFileURL(resolve(FUNCTIONS, 'tourist-lifecycle-email/index.ts')).href)
  assert.equal(typeof handler, 'function')
})

/** A zone where it is now between 10:00 and 20:00, so the push is outside the quiet hours. */
function daytimeZone(now = new Date()): string {
  const zones = ['America/Sao_Paulo', 'Europe/London', 'Asia/Tokyo', 'Pacific/Honolulu', 'Asia/Kolkata', 'America/Los_Angeles']
  for (const zone of zones) {
    const h = plan.localHour(now, zone)
    if (h >= 10 && h < 20) return zone
  }
  throw new Error('no daytime zone in the list')
}

/** An eve row: due now, 30 minutes left, every e-mail gate open, using the app. */
function row(over: Record<string, unknown> = {}) {
  return {
    user_id: USER_A,
    email: 'ana@example.com',
    language: 'pt-br',
    timezone: daytimeZone(),
    email_opt_in: null,
    unsubscribed: false,
    is_active: true,
    last_used_at: new Date().toISOString(),
    earned_unseen_minutes: 0,
    earned_unseen_count: 0,
    earned_nickname: null,
    earned_expires_at: null,
    last_hours_earned_email_at: null,
    expiring_minutes: 0,
    expiring_at: null,
    balance_minutes: 30,
    sent_keys: [],
    short_expiring_on: '2026-11-25',
    short_expiring_minutes: 30,
    ...over,
  }
}

const planOf = (rows: unknown[], now = new Date()) =>
  plan.planEveNotices({ rows, now, relayDomainVerifiedRaw: undefined })

// ===============================================================================================
// THE PLAN
// ===============================================================================================

test('BR-COMUNICACAO-019 3.h.2.b: the eve notice reaches whoever is using the app, by e-mail and push', () => {
  const out = planOf([row({ is_active: true }), row({ user_id: USER_B, email: 'bia@example.com', is_active: false })])
  assert.equal(out.notices.length, 2)
  for (const n of out.notices) {
    assert.equal(n.push, true)
    assert.ok(n.email)
    assert.equal(n.dedupe_key, 'hours_expiring:2026-11-25')
    assert.equal(n.minutes, 30)
  }
})

test('BR-COMUNICACAO-019 3.h.2: a row without the eve date or without minutes is not a notice', () => {
  const out = planOf([row({ short_expiring_on: null }), row({ short_expiring_minutes: 0 }), row({ short_expiring_on: 'x' })])
  assert.equal(out.notices.length, 0)
  assert.equal(out.candidates, 3)
})

test('BR-COMUNICACAO-020 items 4 and 7 on the eve: the e-mail obeys the unsubscribe and the relay domain; the push still goes', () => {
  const out = planOf([
    row({ unsubscribed: true }),
    row({ user_id: USER_B, unsubscribed: null }),
    row({ user_id: 'c3', email: 'x@privaterelay.appleid.com' }),
    row({ user_id: 'c4', email: '' }),
  ])
  assert.deepEqual(
    out.notices.map((n: any) => [n.email, n.email_skip, n.push]),
    [
      [null, 'unsubscribed', true],
      [null, 'unsubscribed', true],
      [null, 'apple_relay_domain_unverified', true],
      [null, 'no_address', true],
    ]
  )
})

test('BR-COMUNICACAO-019 3.h.2.d: one expiry e-mail per date, the same key as the e-mail of 3 days before', () => {
  const out = planOf([
    row({ sent_keys: ['hours_expiring:2026-11-25'] }),
    row({ user_id: USER_B, email: 'ANA@example.com' }),
  ])
  assert.equal(out.notices[0].email_skip, 'already_sent')
  // Another account on an address already planned this run: one e-mail per address.
  assert.equal(out.notices[1].email_skip, null)
  const two = planOf([row(), row({ user_id: USER_B, email: 'ANA@example.com' })])
  assert.equal(two.notices[1].email_skip, 'address_superseded')
})

test('BR-COMUNICACAO-019 item 5 and 3.h.2.e: inside the quiet hours of the person the push does not go; the e-mail does', () => {
  const at = new Date('2026-11-24T02:30:00Z') // 23:30 in Sao Paulo, 11:30 in Tokyo
  const out = planOf([row({ timezone: 'America/Sao_Paulo' }), row({ user_id: USER_B, timezone: 'Asia/Tokyo' })], at)
  assert.deepEqual(out.notices.map((n: any) => n.push), [false, true])
  assert.equal(out.quiet_hours, 1)
  assert.ok(out.notices[0].email)
  // No zone on the account reads America/Sao_Paulo (item 5).
  assert.equal(planOf([row({ timezone: null })], at).notices[0].push, false)
  assert.equal(planOf([row({ timezone: 'Not/AZone' })], at).notices[0].push, false)
})

// ===============================================================================================
// THE RUN
// ===============================================================================================

function deps(over: Record<string, unknown> = {}) {
  const trail: string[] = []
  let clock = 0
  const d = {
    trail,
    claimEmail: async (n: any) => (trail.push(`claimEmail:${n.user_id}`), 'reserved'),
    claimPush: async (n: any) => (trail.push(`claimPush:${n.user_id}`), 'reserved'),
    sendEmail: async (n: any) => (trail.push(`sendEmail:${n.user_id}`), true),
    sendPush: async (n: any) => (trail.push(`sendPush:${n.user_id}`), 'sent'),
    sleep: async (ms: number) => {
      trail.push(`sleep:${ms}`)
      clock += ms
    },
    now: () => clock,
    ...over,
  }
  return d
}

test('BR-COMUNICACAO-019 3.h.2.d: the run claims each channel BEFORE it sends, and sends only what it claimed', async () => {
  const d: any = deps()
  d.claimEmail = async (n: any) => (d.trail.push(`claimEmail:${n.user_id}`), 'already_claimed')
  const report = await plan.runEveNotices(planOf([row()]), d)
  assert.deepEqual(d.trail, [`claimPush:${USER_A}`, `claimEmail:${USER_A}`, `sendPush:${USER_A}`])
  assert.equal(report.push.sent, 1)
  assert.equal(report.email.already_claimed, 1)
  assert.equal(report.email.sent, 0)
})

test('BR-COMUNICACAO-019 3.h.2.d: a claim that fails or throws sends nothing on that channel, and a failed send is not retried', async () => {
  const d: any = deps({
    claimPush: async () => {
      throw new Error('network')
    },
  })
  d.sendEmail = async (n: any) => (d.trail.push(`sendEmail:${n.user_id}`), false)
  const report = await plan.runEveNotices(planOf([row()]), d)
  assert.equal(report.push.claim_failed, 1)
  assert.equal(report.push.sent, 0)
  assert.equal(report.email.failed, 1)
  assert.equal(d.trail.filter((t: string) => t.startsWith('sendEmail')).length, 1)
})

test('the run paces the people it sends to and leaves the rest, unclaimed, for the next hour', async () => {
  const rows = [row(), row({ user_id: USER_B, email: 'b@example.com' }), row({ user_id: 'c3', email: 'c@example.com' })]
  const d = deps()
  const report = await plan.runEveNotices(planOf(rows), d, { maxSending: 2, minIntervalMs: 4200 })
  assert.equal(report.deferred, 1)
  assert.equal(d.trail.some((t: string) => t.includes(':c3')), false, 'the third was claimed')
  assert.deepEqual(d.trail.filter((t: string) => t.startsWith('sleep')), ['sleep:4200'])
  // Default: at most 30 calls to other functions per 60 s (two per person).
  assert.ok((60_000 / plan.EVE_LIMITS.minIntervalMs) * 2 <= 30)
})

test('a notice already claimed on both channels costs no pause and no slot', async () => {
  const d = deps({ claimEmail: async () => 'already_claimed', claimPush: async () => 'already_claimed' })
  const report = await plan.runEveNotices(planOf([row(), row({ user_id: USER_B, email: 'b@example.com' })]), d, {
    maxSending: 1,
    minIntervalMs: 4200,
  })
  assert.equal(report.deferred, 0)
  assert.equal(d.trail.some((t: string) => t.startsWith('sleep') || t.startsWith('send')), false)
})

// ===============================================================================================
// THE HANDLER
// ===============================================================================================

let calls: { url: string; body: any }[]
let candidates: unknown[]
let pushClaim: unknown
let emailClaim: unknown

beforeEach(() => {
  env = {
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SECRET_KEYS: JSON.stringify({ ef_secret_key: EF_SECRET_KEY }),
  }
  calls = []
  candidates = [row()]
  pushClaim = true
  emailClaim = true
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    const body = init?.body ? JSON.parse(String(init.body)) : null
    calls.push({ url: u, body })
    if (u.endsWith('/rpc/get_tourist_lifecycle_email_candidates')) return new Response(JSON.stringify(candidates))
    if (u.endsWith('/rpc/claim_hours_expiring_push')) return new Response(JSON.stringify(pushClaim))
    if (u.endsWith('/rpc/claim_tourist_lifecycle_email')) return new Response(JSON.stringify(emailClaim))
    if (u.endsWith('/firebase-push-notification/send')) return new Response(JSON.stringify({ gate: { sent: 1 } }))
    return new Response(JSON.stringify({ id: 'resend-1' }), { status: 200 })
  }) as typeof fetch
})

const post = (path: string, body: unknown) =>
  handler(
    new Request(`http://localhost/tourist-lifecycle-email${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${EF_SECRET_KEY}` },
      body: JSON.stringify(body),
    })
  )

test('/eve dry run is the default: it lists the notices and claims and sends nothing', async () => {
  const out = await (await post('/eve', {})).json()
  assert.equal(out.dry_run, true)
  assert.deepEqual(out.would_notify, [{ user_id: USER_A, expires_on: '2026-11-25', email: true, push: true }])
  assert.deepEqual(calls.map((c) => c.url.split('/').pop()), ['get_tourist_lifecycle_email_candidates'])
})

test('BR-COMUNICACAO-019 3.h.2 and BR-COMUNICACAO-016: /eve claims both channels, then sends the e-mail and the `hours_expiring` push', async () => {
  const out = await (await post('/eve', { dry_run: false })).json()
  assert.deepEqual(
    calls.map((c) => c.url.replace('https://project.supabase.co', '')),
    [
      '/rest/v1/rpc/get_tourist_lifecycle_email_candidates',
      '/rest/v1/rpc/claim_hours_expiring_push',
      '/rest/v1/rpc/claim_tourist_lifecycle_email',
      '/functions/v1/send-transactional/send',
      '/functions/v1/firebase-push-notification/send',
    ]
  )
  assert.deepEqual(calls[1].body, { p_user_id: USER_A, p_expires_on: '2026-11-25' })
  assert.deepEqual(calls[2].body, {
    p_user_id: USER_A,
    p_kind: 'tourist_hours_expiring',
    p_dedupe_key: 'hours_expiring:2026-11-25',
  })
  const mail = calls[3].body
  assert.deepEqual(
    { type: mail.type, to: mail.to, lang: mail.lang, eve: mail.data.eve, minutes: mail.data.minutes },
    { type: 'tourist_hours_expiring', to: 'ana@example.com', lang: 'pt', eve: true, minutes: 30 }
  )
  const p = calls[4].body
  assert.equal(p.push_kind, 'hours_expiring')
  assert.deepEqual(p.userIds, [USER_A])
  assert.deepEqual(p.notification.data, { type: 'hours_expiring', deeplink: 'tuggi://map', variant: 'a' })
  assert.equal(p.notification.title, 'Suas horas grátis vencem amanhã')
  assert.match(p.notification.body, /Você tem 30 min de guia grátis\./)
  assert.equal(out.email.sent, 1)
  assert.equal(out.push.sent, 1)
})

test('/eve: a push already claimed is not sent again, and the PostgREST call goes to the drive schema', async () => {
  pushClaim = false
  emailClaim = false
  const out = await (await post('/eve', { dry_run: false })).json()
  assert.equal(calls.some((c) => c.url.includes('/functions/v1/')), false)
  const claimPush = calls.find((c) => c.url.endsWith('/claim_hours_expiring_push'))
  assert.ok(claimPush)
  assert.equal(out.push.already_claimed, 1)
  assert.equal(out.email.already_claimed, 1)
})

test('/eve: the address and the user id stay out of the log line', async () => {
  const lines: string[] = []
  const original = console.log
  console.log = (line: string) => lines.push(String(line))
  try {
    await post('/eve', { dry_run: false })
  } finally {
    console.log = original
  }
  assert.ok(lines.length > 0)
  for (const line of lines) {
    assert.doesNotMatch(line, /ana@example\.com|6f1c2d3e/)
  }
})

// ===============================================================================================
// THE COPY
// ===============================================================================================

const PUSH_LANGS = ['pt', 'en', 'es', 'fr', 'it', 'de']

test('BR-COMUNICACAO-019 3.h.2.f and item 11: the eve push exists in the six languages, both variants, inside 40 and 110', () => {
  for (const variant of ['a', 'b']) {
    for (const lang of PUSH_LANGS) {
      const out = push.hoursExpiringPush(lang, 90, variant)
      assert.ok(out, `${variant}/${lang}`)
      assert.ok(out.title.length <= 40, `${variant}/${lang} title ${out.title.length}`)
      assert.ok(out.body.length <= 110, `${variant}/${lang} body ${out.body.length}`)
      assert.match(`${out.title} ${out.body}`, /1 h 30 min/)
      assert.doesNotMatch(`${out.title} ${out.body}`, /[?!]|\{\{|R\$|€|\$|%|plano|plan\b|teste|trial|última|last chance|compr|buy/iu)
    }
  }
  assert.equal(push.hoursExpiringPush('pt', 0, 'a'), null, 'an hours push without hours')
  // Outside the six reads English (item 11).
  assert.equal(push.hoursExpiringPush('ja', 30, 'a').title, 'Your free hours expire tomorrow')
})

test('the variant is drawn once per person, from the id, and travels in data.variant', () => {
  assert.equal(push.eveVariant(USER_A), 'a')
  assert.equal(push.eveVariant(USER_B), 'b')
  assert.equal(push.eveVariant(USER_B), push.eveVariant(USER_B))
  const body = push.hoursExpiringSendBody(USER_B, 'en', 45)
  assert.equal(body.notification.data.variant, 'b')
  assert.equal(body.notification.title, '45 min of free guide time to use')
  assert.equal(push.hoursExpiringSendBody(USER_B, 'en', 0), null)
})

test('BR-COMUNICACAO-019 3.h.2.f: the eve e-mail says how much and that it expires tomorrow, with the local date', () => {
  const data = { minutes: 30, expires_at: '2026-11-25T12:00:00.000Z', timezone: 'UTC', eve: true }
  const pt = email.renderTouristEmail('tourist_hours_expiring', 'pt', data)
  assert.equal(pt.content.subject, 'Suas horas grátis vencem amanhã')
  assert.ok(pt.content.paragraphs.some((p: string) => p.includes('30 min') && p.includes('25 de novembro')))
  for (const lang of ['pt', 'en', 'es', 'fr', 'it']) {
    const out = email.renderTouristEmail('tourist_hours_expiring', lang, data)
    assert.ok(out, lang)
    assert.doesNotMatch(out.content.subject, /\{\{|\d/u, `${lang}: the eve subject counts days`)
  }
  assert.equal(email.renderTouristEmail('tourist_hours_expiring', 'pt', { ...data, minutes: 0 }), null)
})
