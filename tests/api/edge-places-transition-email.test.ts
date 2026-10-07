/**
 * #813 — the client's e-mails at the portal's transitions (BR-B2B-049 item 10, BR-B2B-050 items 1
 * and 3): approval (kit ready), "no ar", and the single kit reminder. Trigger, recipient (the
 * acceptance e-mail), and that none of them goes twice.
 *
 * `_shared/places-transition-email.ts` runs here under Node with every side effect injected; Deno
 * source loaded through a path built at run time (a static `.ts` import fails the repo's `tsc`).
 *
 * Run with: npm run test:api
 */

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(import.meta.dirname, '../..')
const FUNCTIONS = resolve(ROOT, 'supabase/functions')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let notify: any

before(async () => {
  mod = await import(pathToFileURL(resolve(FUNCTIONS, '_shared/places-transition-email.ts')).href)
  notify = await import(pathToFileURL(resolve(ROOT, 'lib/services/portal-transition-email.ts')).href)
})

const SID = '11111111-2222-4333-8444-555555555555'
const SID2 = '22222222-2222-4333-8444-555555555555'
const ORIGIN = 'https://places.tuggi.app'
const NOW = new Date('2026-10-10T12:00:00Z')
const DAY = 24 * 3600 * 1000
const DRAWN = 'RHJhd25CeVRoZUZ1bmN0aW9uLW5vdC10aGUtV29ya2V'

type Mail = { to: string; subject: string; html: string; text: string; fromName?: string }
type Row = { submissionId: string; email: string | null; plan: string | null; published: boolean; approvedAt: string | null }

function fake(o: {
  target?: unknown
  claim?: { data?: unknown; error?: unknown }
  rows?: Row[]
  goLive?: (id: string) => unknown
  record?: (id: string, kind: string) => { data: unknown; error: unknown }
  sendOk?: boolean
} = {}) {
  const mails: Mail[] = []
  const alerts: string[] = []
  const live: string[] = []
  const records: string[] = []
  const deps = {
    auth: { ensureUser: async () => true, magicLink: async () => ({ tokenHash: 'c'.repeat(56), type: 'magiclink' }) },
    sendEmail: async (to: string, subject: string, html: string, text: string, fromName?: string) => {
      mails.push({ to, subject, html, text, fromName })
      return o.sendOk ?? true
    },
    sha256Hex: async (s: string) => `sha(${s})`,
    randomToken: () => DRAWN,
    origin: ORIGIN,
    issueClaim: async () => o.claim ?? { data: null, error: { code: 'TGP10', details: 'draft_claimed' } },
    target: async () => (o.target === undefined ? { submissionId: SID, status: 'approved', email: 'dono@local.com', plan: 'map_only' } : o.target),
    approvedRows: async () => o.rows ?? [],
    goLive: async (id: string) => {
      live.push(id)
      return o.goLive ? o.goLive(id) : null
    },
    recordNotice: async (id: string, kind: string) => {
      records.push(`${id}:${kind}`)
      return o.record ? o.record(id, kind) : { data: true, error: null }
    },
    alert: async (what: string) => {
      alerts.push(what)
    },
    now: () => NOW,
  }
  return { deps, mails, alerts, live, records }
}

// ─── approval ──────────────────────────────────────────────────────────────────────────────────

test('BR-B2B-049 item 10: approval of an owned submission mails the acceptance e-mail with the plain /status link', async () => {
  const f = fake()
  assert.equal(await mod.notifyApproved(f.deps, SID), 'sent')
  assert.equal(f.mails.length, 1)
  assert.equal(f.mails[0].to, 'dono@local.com')
  assert.equal(f.mails[0].subject, 'Seu local foi aprovado no Tuggi')
  assert.equal(f.mails[0].fromName, 'Tuggi Locais')
  assert.match(f.mails[0].text, /Baixar o kit: https:\/\/places\.tuggi\.app\/status/)
  assert.match(f.mails[0].text, /kit de ativação já está liberado/)
})

test('#813: approval of an ownerless submission (cookie flow) carries the claim link, so that session reaches /status', async () => {
  const f = fake({ claim: { data: [{ email: 'dono@local.com', expires_at: 'x' }], error: null } })
  assert.equal(await mod.notifyApproved(f.deps, SID), 'sent')
  assert.equal(f.mails.length, 1, 'one e-mail, not the access one plus the approval one')
  assert.equal(f.mails[0].subject, 'Seu local foi aprovado no Tuggi')
  assert.match(f.mails[0].text, new RegExp(`/entrar\\?th=c+&tt=magiclink&c=${DRAWN}`))
  assert.match(f.mails[0].text, /vale por 1 hora/)
})

test('#813: a claim that cannot be issued (quota) still sends the approval, with the plain link', async () => {
  const f = fake({ claim: { data: null, error: { code: 'TGP29' } } })
  assert.equal(await mod.notifyApproved(f.deps, SID), 'sent')
  assert.equal(f.mails.length, 1)
  assert.match(f.mails[0].text, /\/status/)
})

test('#813: nothing is sent for a submission that is not approved, or does not exist', async () => {
  const notApproved = fake({ target: { submissionId: SID, status: 'in_review', email: 'a@b.co', plan: null } })
  assert.equal(await mod.notifyApproved(notApproved.deps, SID), 'not_approved')
  const missing = fake({ target: null })
  assert.equal(await mod.notifyApproved(missing.deps, SID), 'not_found')
  assert.equal(notApproved.mails.length + missing.mails.length, 0)
})

test('BR-B2B-050 item 3: the free plan never promises a story; the paid says the story comes next', async () => {
  const free = mod.approvedEmail('map_only', false)(`${ORIGIN}/status`, ORIGIN)
  const paid = mod.approvedEmail('map_and_description', false)(`${ORIGIN}/status`, ORIGIN)
  assert.doesNotMatch(free.text, /história/i)
  assert.match(paid.text, /história do seu local/)
})

test('#813: no transition e-mail carries data of the submission, nor "sem multa"/"sem custo" (BR-B2B-045 item 10)', () => {
  const all = [
    mod.approvedEmail('map_and_description', true)('u', ORIGIN),
    mod.liveEmail('map_and_description')('u', ORIGIN),
    mod.liveEmail('map_only')('u', ORIGIN),
    mod.kitReminderEmail()('u', ORIGIN),
  ]
  for (const m of all) {
    assert.doesNotMatch(m.text, /sem multa|sem custo|cancele/i)
    assert.doesNotMatch(m.text, /CPF|CNPJ|R\$/)
  }
})

test('parseNotify accepts only {event: approved | live, submission_id: uuid}', () => {
  assert.deepEqual(mod.parseNotify({ event: 'approved', submission_id: SID }), { event: 'approved', submissionId: SID })
  assert.deepEqual(mod.parseNotify({ event: 'live', submission_id: SID }), { event: 'live', submissionId: SID })
  assert.equal(mod.parseNotify({ event: 'rejected', submission_id: SID }), null)
  assert.equal(mod.parseNotify({ event: 'approved', submission_id: 'x' }), null)
  assert.equal(mod.parseNotify(null), null)
})

// ─── no ar ─────────────────────────────────────────────────────────────────────────────────────

test('BR-B2B-049 item 8: a published POI moves the submission to live (system) and THEN mails "no ar" with both stores', async () => {
  const f = fake({ rows: [{ submissionId: SID, email: 'dono@local.com', plan: 'map_and_description', published: true, approvedAt: NOW.toISOString() }] })
  const out = await mod.runTransitionEmails(f.deps)
  assert.equal(out.live, 1)
  assert.deepEqual(f.live, [SID])
  assert.equal(f.mails.length, 1)
  assert.equal(f.mails[0].to, 'dono@local.com')
  assert.equal(f.mails[0].subject, 'A história do seu local está no ar no Tuggi')
  assert.ok(f.mails[0].text.includes(mod.APP_STORE_URL))
  assert.ok(f.mails[0].text.includes(mod.PLAY_STORE_URL))
  assert.match(f.mails[0].text, /kit/)
})

test('#813: "no ar" never goes twice — a second sweep finds the transition refused (TGP10) and sends nothing, without alert', async () => {
  const row = { submissionId: SID, email: 'dono@local.com', plan: 'map_only', published: true, approvedAt: NOW.toISOString() }
  const f = fake({ rows: [row], goLive: () => ({ code: 'TGP10' }) })
  const out = await mod.runTransitionEmails(f.deps)
  assert.equal(out.live, 0)
  assert.equal(f.mails.length, 0)
  assert.deepEqual(f.alerts, [])
})

test('#813: an unpublished approved place is not moved to live', async () => {
  const f = fake({ rows: [{ submissionId: SID, email: 'a@b.co', plan: 'map_only', published: false, approvedAt: NOW.toISOString() }] })
  await mod.runTransitionEmails(f.deps)
  assert.deepEqual(f.live, [])
})

test('BR-B2B-049 item 8 (#906): the sweep reconciles a place published long ago and leaves an unpublished one approved', async () => {
  const old = new Date(NOW.getTime() - 20 * DAY).toISOString()
  const f = fake({
    rows: [
      { submissionId: SID, email: 'antigo@local.com', plan: 'map_only', published: true, approvedAt: old },
      { submissionId: SID2, email: 'sem-contorno@local.com', plan: 'map_and_description', published: false, approvedAt: old },
    ],
  })
  const out = await mod.runTransitionEmails(f.deps)
  assert.deepEqual(f.live, [SID])
  assert.equal(out.live, 1)
  assert.deepEqual(f.mails.filter((m) => m.to === 'antigo@local.com').map((m) => m.subject), ['Seu local está no mapa do Tuggi'])
  // the unpublished one only gets the kit reminder, never "no ar"
  assert.deepEqual(f.mails.filter((m) => m.to === 'sem-contorno@local.com').map((m) => m.subject), ['Já imprimiu o kit do seu local?'])
})

test('BR-B2B-049 item 10 (#906): "no ar" at the act goes only to a submission already in live', async () => {
  const isLive = fake({ target: { submissionId: SID, status: 'live', email: 'dono@local.com', plan: 'map_only' } })
  assert.equal(await mod.notifyLive(isLive.deps, SID), 'sent')
  assert.equal(isLive.mails.length, 1)
  assert.equal(isLive.mails[0].to, 'dono@local.com')
  assert.ok(isLive.mails[0].text.includes(mod.APP_STORE_URL))
  assert.deepEqual(isLive.live, [], 'notifyLive never moves the submission itself')

  const stillApproved = fake()
  assert.equal(await mod.notifyLive(stillApproved.deps, SID), 'not_live')
  assert.equal(await mod.notifyLive(fake({ target: null }).deps, SID), 'not_found')
  assert.equal(stillApproved.mails.length, 0)
})

// ─── kit reminder ──────────────────────────────────────────────────────────────────────────────

test('#813: the kit reminder goes 3 days after the approval, recorded before it is sent', async () => {
  const f = fake({
    rows: [
      { submissionId: SID, email: 'dono@local.com', plan: 'map_only', published: false, approvedAt: new Date(NOW.getTime() - 3 * DAY - 1000).toISOString() },
      { submissionId: SID2, email: 'outro@local.com', plan: 'map_only', published: false, approvedAt: new Date(NOW.getTime() - 2 * DAY).toISOString() },
    ],
  })
  const out = await mod.runTransitionEmails(f.deps)
  assert.equal(out.kit_reminder, 1)
  assert.deepEqual(f.records, [`${SID}:kit_reminder`])
  assert.equal(f.mails.length, 1)
  assert.equal(f.mails[0].to, 'dono@local.com')
  assert.equal(f.mails[0].subject, 'Já imprimiu o kit do seu local?')
})

test('#813: the kit reminder never goes twice — an already recorded notice sends nothing', async () => {
  const f = fake({
    rows: [{ submissionId: SID, email: 'dono@local.com', plan: 'map_only', published: false, approvedAt: new Date(NOW.getTime() - 5 * DAY).toISOString() }],
    record: () => ({ data: false, error: null }),
  })
  const out = await mod.runTransitionEmails(f.deps)
  assert.equal(out.kit_reminder, 0)
  assert.equal(f.mails.length, 0)
})

test('#813: a place that went live gets the "no ar" e-mail and no kit reminder', async () => {
  const f = fake({ rows: [{ submissionId: SID, email: 'dono@local.com', plan: 'map_only', published: true, approvedAt: new Date(NOW.getTime() - 5 * DAY).toISOString() }] })
  await mod.runTransitionEmails(f.deps)
  assert.deepEqual(f.records, [])
  assert.deepEqual(f.mails.map((m) => m.subject), ['Seu local está no mapa do Tuggi'])
})

test('#813: before the notice function exists (PGRST202) nothing is sent and nothing alerts', async () => {
  const f = fake({
    rows: [{ submissionId: SID, email: 'dono@local.com', plan: 'map_only', published: false, approvedAt: new Date(NOW.getTime() - 5 * DAY).toISOString() }],
    record: () => ({ data: null, error: { code: 'PGRST202' } }),
  })
  const out = await mod.runTransitionEmails(f.deps)
  assert.equal(out.kit_reminder, 'not_migrated')
  assert.equal(f.mails.length, 0)
  assert.deepEqual(f.alerts, [])
})

// ─── CMS side ──────────────────────────────────────────────────────────────────────────────────

test('#813: notifyPortalApproval calls places-portal-notify with the operator token and the submission', async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co'
  const seen: { url: string; init: RequestInit }[] = []
  const ok = await notify.notifyPortalApproval('jwt-1', SID, (async (url: string, init: RequestInit) => {
    seen.push({ url, init })
    return new Response('{}', { status: 200 })
  }) as unknown as typeof fetch)
  assert.equal(ok, true)
  assert.equal(seen[0].url, 'https://proj.supabase.co/functions/v1/places-portal-notify')
  assert.equal((seen[0].init.headers as Record<string, string>).Authorization, 'Bearer jwt-1')
  assert.deepEqual(JSON.parse(String(seen[0].init.body)), { event: 'approved', submission_id: SID })
  assert.equal(await notify.notifyPortalApproval(null, SID), false)
})

test('#906: notifyPortalLive calls places-portal-notify with event live', async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co'
  const seen: { url: string; init: RequestInit }[] = []
  const ok = await notify.notifyPortalLive('jwt-2', SID, (async (url: string, init: RequestInit) => {
    seen.push({ url, init })
    return new Response('{}', { status: 200 })
  }) as unknown as typeof fetch)
  assert.equal(ok, true)
  assert.equal(seen[0].url, 'https://proj.supabase.co/functions/v1/places-portal-notify')
  assert.deepEqual(JSON.parse(String(seen[0].init.body)), { event: 'live', submission_id: SID })
})

test('#906: places-portal-notify routes event live to notifyLive', () => {
  const src = readFileSync(resolve(FUNCTIONS, 'places-portal-notify/index.ts'), 'utf8')
  assert.match(src, /parsed\.event === 'live'\s*\? await notifyLive\(deps, parsed\.submissionId\)/)
})

test('#813: the decision route asks for the e-mail only on approve, after the transition', () => {
  const src = readFileSync(resolve(ROOT, 'app/api/admin/partnerships/validation/[submissionId]/route.ts'), 'utf8')
  const call = src.indexOf('notifyPortalApproval(data.session')
  assert.ok(call > 0)
  assert.ok(src.indexOf('await approvePortalSubmission(') < call)
  assert.match(src.slice(call - 200, call), /decision\.action === 'approve'/)
})

test('#813: the daily sweep runs the transition e-mails', () => {
  const src = readFileSync(resolve(FUNCTIONS, 'places-payment-sweep/index.ts'), 'utf8')
  assert.match(src, /runTransitionEmails\(transitionDeps\(\)\)/)
})
