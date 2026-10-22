/**
 * #996 — "Ver como o lojista": the CMS half (`docs/contracts/places-cms.md` §11).
 *
 * `GET /api/admin/partnerships/portal-view/{id}` (admin mints the access) and `POST /api/portal/view`
 * (the portal Worker opens it and reads through it) run for real, with the real gate and the real
 * HMAC; the database is a stand-in. `core.audit_logs` keeps the primary key, because single use IS
 * that key. What these tests pin: only an admin gets an access, and only with its audit row; an
 * access opens once, within 5 minutes, unaltered and as an access; a session reads only the closed
 * list, only for its own submission, and never anything that writes.
 *
 * Run with: npm run test:api
 */

import { before, beforeEach, test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'

const VIEW_SECRET = 'view-secret-996-'.repeat(3)
const WORKER_SECRET = 'places-secret-996'
const SUBMISSION = '99699699-0996-4996-8996-996996996996'
const OTHER = '99699699-0996-4996-8996-000000000001'
const ADMIN_ID = 'a0a0a0a0-0996-4996-8996-a0a0a0a0a0a0'

interface Scenario {
  caller: { role: string; is_active: boolean } | null
  submission: { id: string; status: string } | null
  auditDown: boolean
  audits: Record<string, unknown>[]
  rpcCalls: { fn: string; args: Record<string, unknown> }[]
  rpcAnswer: { data: unknown; error: { code: string } | null }
}
let scenario: Scenario

function gateClient() {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({
      data: scenario.caller && scenario.caller.is_active ? { id: 'cms-1', email: 'admin@tuggi.app', ...scenario.caller } : null,
      error: null,
    }),
  }
  return {
    auth: { getUser: async () => ({ data: { user: { id: ADMIN_ID, email: 'admin@tuggi.app' } }, error: null }) },
    schema: () => ({ from: () => chain }),
  }
}

function serviceClient() {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: scenario.submission, error: null }),
  }
  return {
    schema: () => ({
      from: () => chain,
      rpc: async (fn: string, args: Record<string, unknown>) => {
        scenario.rpcCalls.push({ fn, args })
        return scenario.rpcAnswer
      },
    }),
  }
}

/** `core.audit_logs` with its primary key: a second row with the same `id` is `23505`. */
function auditClient() {
  return {
    schema: () => ({
      from: () => ({
        insert: async (row: Record<string, unknown>) => {
          if (scenario.auditDown) return { error: { code: '08006' } }
          if (row.id && scenario.audits.some((a) => a.id === row.id)) return { error: { code: '23505' } }
          scenario.audits.push(row)
          return { error: null }
        },
      }),
    }),
  }
}

let ISSUE: (req: NextRequest, ctx?: unknown) => Promise<Response>
let VIEW: (req: NextRequest) => Promise<Response>
let token: typeof import('@/lib/partnerships/portal-view-token')

before(async () => {
  process.env.PORTAL_VIEW_SECRET = VIEW_SECRET
  process.env.PLACES_CMS_SECRET = WORKER_SECRET
  process.env.PLACES_PORTAL_ORIGIN = 'https://partner.tuggi.app'
  mock.module('next/headers', {
    namedExports: { cookies: async () => ({ get: () => undefined, getAll: () => [] }) },
  })
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseRouteHandler: () => gateClient(),
      getSupabaseService: () => serviceClient(),
      getSupabase: () => auditClient(),
    },
  })
  ISSUE = (await import('@/app/api/admin/partnerships/portal-view/[submissionId]/route')).GET as typeof ISSUE
  VIEW = (await import('@/app/api/portal/view/route')).POST as typeof VIEW
  token = await import('@/lib/partnerships/portal-view-token')
})

beforeEach(() => {
  process.env.PORTAL_VIEW_SECRET = VIEW_SECRET
  scenario = {
    caller: { role: 'admin', is_active: true },
    submission: { id: SUBMISSION, status: 'live' },
    auditDown: false,
    audits: [],
    rpcCalls: [],
    rpcAnswer: { data: [{ submission_id: SUBMISSION }], error: null },
  }
})

let ip = 0
function issue(id = SUBMISSION) {
  const req = new NextRequest(`http://localhost/api/admin/partnerships/portal-view/${id}`, {
    headers: { 'x-forwarded-for': `10.0.0.${++ip % 250}` },
  })
  return ISSUE(req, { params: Promise.resolve({ submissionId: id }) })
}

function view(body: unknown, secret: string | null = WORKER_SECRET) {
  return VIEW(
    new NextRequest('http://localhost/api/portal/view', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.1.0.${++ip % 250}`, ...(secret ? { 'x-places-secret': secret } : {}) },
      body: JSON.stringify(body),
    })
  )
}

async function issuedAccess(): Promise<string> {
  const res = await issue()
  assert.equal(res.status, 303)
  const location = new URL(res.headers.get('location') ?? '')
  return location.searchParams.get('t') ?? ''
}

async function openedSession(): Promise<string> {
  const res = await view({ action: 'open', access: await issuedAccess() })
  assert.equal(res.status, 200)
  return ((await res.json()) as { session: string }).session
}

const now = () => Math.floor(Date.now() / 1000)

// ── Issuing ─────────────────────────────────────────────────────────────────────────────

test('#996: an admin gets a 303 to the portal with the access, and the audit row says who, which submission and when', async () => {
  const res = await issue()
  assert.equal(res.status, 303)
  const location = new URL(res.headers.get('location') ?? '')
  assert.equal(location.origin, 'https://partner.tuggi.app')
  assert.equal(location.pathname, '/api/portal/view')
  assert.ok(location.searchParams.get('t'), 'the access rides in the Location header only')
  assert.equal(res.headers.get('cache-control'), 'no-store')

  assert.equal(scenario.audits.length, 1)
  const row = scenario.audits[0]
  assert.equal(row.action, 'ISSUE_PORTAL_VIEW_ACCESS')
  assert.equal(row.user_id, ADMIN_ID)
  assert.equal(row.entity_id, SUBMISSION)
  assert.match(String(row.description), /valid until/)
})

test('#996: someone who is not an admin gets 403, and no access and no row exist', async () => {
  for (const caller of [{ role: 'editor', is_active: true }, { role: 'viewer', is_active: true }, { role: 'client', is_active: true }, { role: 'admin', is_active: false }, null]) {
    scenario.caller = caller
    const res = await issue()
    assert.equal(res.status, 403, `caller ${JSON.stringify(caller)} must be refused`)
    assert.equal(res.headers.get('location'), null)
  }
  assert.equal(scenario.audits.length, 0)
})

test('#996: no audit row, no access (fails closed)', async () => {
  scenario.auditDown = true
  const res = await issue()
  assert.equal(res.status, 503)
  assert.equal(res.headers.get('location'), null)
})

test('#996: a draft or a missing submission has no /status to show', async () => {
  scenario.submission = { id: SUBMISSION, status: 'draft' }
  assert.equal((await issue()).status, 404)
  scenario.submission = null
  assert.equal((await issue()).status, 404)
  assert.equal((await issue('not-a-uuid')).status, 400)
  assert.equal(scenario.audits.length, 0)
})

test('#996: without PORTAL_VIEW_SECRET (or with a short one) the feature is off, never unsigned', async () => {
  process.env.PORTAL_VIEW_SECRET = ''
  assert.equal((await issue()).status, 503)
  process.env.PORTAL_VIEW_SECRET = 'short'
  assert.equal((await issue()).status, 503)
  assert.equal(scenario.audits.length, 0)
})

// ── Opening: once, within 5 minutes, unaltered ─────────────────────────────────────────

test('#996: the access opens a 30-minute session once, and its opening row carries the access jti as id', async () => {
  const access = await issuedAccess()
  const first = await view({ action: 'open', access })
  assert.equal(first.status, 200)
  const body = (await first.json()) as { session: string; expires_at: number; submission_id: string }
  assert.equal(body.submission_id, SUBMISSION)
  assert.ok(body.expires_at - now() <= 30 * 60 && body.expires_at - now() > 29 * 60)

  const opening = scenario.audits.find((a) => a.action === 'OPEN_PORTAL_VIEW')
  assert.ok(opening)
  assert.equal(opening.user_id, ADMIN_ID, 'the opening is attributed to the admin who asked')

  const again = await view({ action: 'open', access })
  assert.equal(again.status, 401, 'a reused access is refused')
  assert.deepEqual(await again.json(), { error: 'access_invalid' })
  assert.equal(scenario.audits.filter((a) => a.action === 'OPEN_PORTAL_VIEW').length, 1)
})

test('#996: an expired access is refused', async () => {
  const stale = token.signPortalView(VIEW_SECRET, { kind: 'access', submissionId: SUBMISSION, adminId: ADMIN_ID, nowSeconds: now() - 5 * 60 - 1 })
  const res = await view({ action: 'open', access: stale.token })
  assert.equal(res.status, 401)
  assert.equal(scenario.audits.length, 0, 'nothing is spent for a refused access')
})

test('#996: an access with a swapped submission, a forged signature or another secret is refused', async () => {
  const access = await issuedAccess()
  const [payload, signature] = access.split('.')
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  const swapped = Buffer.from(JSON.stringify({ ...claims, s: OTHER })).toString('base64url')
  const longer = Buffer.from(JSON.stringify({ ...claims, e: claims.e + 3600 })).toString('base64url')
  const foreign = token.signPortalView('another-secret-of-32-characters!!', { kind: 'access', submissionId: SUBMISSION, adminId: ADMIN_ID, nowSeconds: now() })
  for (const forged of [`${swapped}.${signature}`, `${longer}.${signature}`, `${payload}.${signature.slice(0, -2)}AA`, foreign.token, `${payload}`, '', 42]) {
    const res = await view({ action: 'open', access: forged })
    assert.equal(res.status, 401, `forged access ${String(forged).slice(0, 20)} must be refused`)
  }
  assert.equal(scenario.audits.filter((a) => a.action === 'OPEN_PORTAL_VIEW').length, 0)
})

test('#996: a session cannot be opened as an access, and an access cannot read', async () => {
  const session = await openedSession()
  assert.equal((await view({ action: 'open', access: session })).status, 401)
  const access = await issuedAccess()
  assert.equal((await view({ action: 'read', session: access, fn: 'portal_get_submission', args: { p_submission_id: SUBMISSION } })).status, 401)
  assert.equal(scenario.rpcCalls.length, 0)
})

test('#996: without the Worker secret nothing opens and nothing reads', async () => {
  const access = await issuedAccess()
  assert.equal((await view({ action: 'open', access }, null)).status, 401)
  assert.equal((await view({ action: 'open', access }, 'wrong')).status, 401)
  assert.equal(scenario.audits.filter((a) => a.action === 'OPEN_PORTAL_VIEW').length, 0)
})

test('#996: the opening fails closed when its row cannot be written', async () => {
  const access = await issuedAccess()
  scenario.auditDown = true
  assert.equal((await view({ action: 'open', access })).status, 401)
})

// ── Reading: the closed list, this submission only ─────────────────────────────────────

test('#996: a session reads the /status of its own submission through partner.portal_view_call', async () => {
  const session = await openedSession()
  scenario.rpcAnswer = { data: [{ submission_id: SUBMISSION, status: 'live' }], error: null }
  const res = await view({ action: 'read', session, fn: 'portal_get_submission', args: { p_submission_id: SUBMISSION } })
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { data: [{ submission_id: SUBMISSION, status: 'live' }] })
  assert.deepEqual(scenario.rpcCalls, [
    { fn: 'portal_view_call', args: { p_submission_id: SUBMISSION, p_fn: 'portal_get_submission', p_args: { p_submission_id: SUBMISSION } } },
  ])
})

test('#996: the owner list shows only the viewed submission', async () => {
  const session = await openedSession()
  scenario.rpcAnswer = { data: [{ submission_id: OTHER }, { submission_id: SUBMISSION }], error: null }
  const res = await view({ action: 'read', session, fn: 'portal_list_submissions' })
  assert.deepEqual(await res.json(), { data: [{ submission_id: SUBMISSION }] })
})

test('#996: every write, and every read of another submission, is 403 and never reaches the database', async () => {
  const session = await openedSession()
  const refused: [string, Record<string, unknown>][] = [
    ['portal_save_draft', { p_submission_id: SUBMISSION, p_answers: {} }],
    ['portal_submit', { p_submission_id: SUBMISSION }],
    ['portal_update_place_profile', { p_submission_id: SUBMISSION, p_changes: {} }],
    ['portal_update_guide_profile', { p_submission_id: SUBMISSION, p_changes: {} }],
    ['portal_propose_place_change', { p_submission_id: SUBMISSION }],
    ['portal_withdraw_place_change', { p_submission_id: SUBMISSION }],
    ['portal_answer_changes_request', { p_submission_id: SUBMISSION }],
    ['portal_accept_legacy_plan', { p_submission_id: SUBMISSION }],
    ['portal_consume_generation', { p_submission_id: SUBMISSION }],
    ['portal_create_draft', {}],
    ['portal_get_guide_profile', { p_submission_id: SUBMISSION }],
    ['portal_get_submission', { p_submission_id: OTHER }],
    ['portal_get_submission', {}],
    ['portal_list_place_charges', { p_submission_id: SUBMISSION, p_extra: 1 }],
    ['portal_quote', { p_billing_period: 3, p_voucher_code: "x'; drop" }],
  ]
  for (const [fn, args] of refused) {
    const res = await view({ action: 'read', session, fn, args })
    assert.equal(res.status, 403, `${fn} ${JSON.stringify(args)} must be refused`)
    assert.deepEqual(await res.json(), { error: 'read_only' })
  }
  assert.equal(scenario.rpcCalls.length, 0)
})

test('#996: an expired session reads nothing', async () => {
  const stale = token.signPortalView(VIEW_SECRET, { kind: 'session', submissionId: SUBMISSION, adminId: ADMIN_ID, nowSeconds: now() - 30 * 60 - 1 })
  const res = await view({ action: 'read', session: stale.token, fn: 'portal_get_submission', args: { p_submission_id: SUBMISSION } })
  assert.equal(res.status, 401)
  assert.deepEqual(await res.json(), { error: 'view_ended' })
  assert.equal(scenario.rpcCalls.length, 0)
})

test('#996: until partner.portal_view_call exists the read answers unavailable, not a login prompt', async () => {
  const session = await openedSession()
  scenario.rpcAnswer = { data: null, error: { code: 'PGRST202' } }
  const res = await view({ action: 'read', session, fn: 'portal_get_submission', args: { p_submission_id: SUBMISSION } })
  assert.equal(res.status, 502)
  assert.deepEqual(await res.json(), { error: 'unavailable' })
})
