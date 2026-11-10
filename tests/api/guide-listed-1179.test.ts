/**
 * #1179: "Aparece no app" and the meeting point in the guide's record. BR-B2B-064 items 6, 10 and
 * 11 as amended on 2026-11-10: approving no longer lists, the curator ticks who appears, the tick
 * needs a meeting point, hiding stays above the tick, and the curator adjusts the point.
 *
 * The database is faked. What runs for real: the route's parsing and dispatch, `setGuideListed`,
 * `setGuideMeetingPoint`, `guideMeetingPointOf`, `guideRpcErrorOf`, the reads of
 * `guide-profile-service.ts`, `guideVisibilityOf` and `derivePipelineState`. That
 * `core.cms_set_guide_listed` refuses without a point (TGP23) is the database's promise, proven by
 * the lab of migration 20261110130000; here, that the refusal reaches the screen as its own reason.
 *
 * Run with: npm run test:api
 */

import { test, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CLIENT = '33333333-3333-4333-8333-333333333333'

interface World {
  rpcCalls: { name: string; args: Record<string, unknown> }[]
  /** What the next operator RPC answers with. */
  rpcError: { code: string; details?: string } | null
  rpcData: unknown
  audits: string[]
  /** The rows `partner.guide_profiles` answers with. */
  rows: Record<string, unknown>[]
}
let w: World

beforeEach(() => {
  w = { rpcCalls: [], rpcError: null, rpcData: null, audits: [], rows: [] }
})

const operator: any = {
  schema: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      w.rpcCalls.push({ name, args })
      return w.rpcError ? { data: null, error: w.rpcError } : { data: w.rpcData, error: null }
    },
  }),
}

function table() {
  const q: any = {
    select: () => q,
    eq: () => q,
    in: () => q,
    maybeSingle: async () => ({ data: w.rows[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => unknown) => resolve({ data: w.rows, error: null }),
  }
  return q
}
const service = { schema: () => ({ from: () => table() }) }

const AUTH = { supabase: operator, user: { id: 'op', email: 'op@tuggi.app' } }
const ctx = { params: Promise.resolve({ clientId: CLIENT }) }
type Handler = (req: Request, c: typeof ctx, auth: typeof AUTH) => Promise<Response>

let guides: typeof import('@/lib/services/guide-profile-service')
let pipeline: typeof import('@/lib/partnerships/pipeline')
let board: typeof import('@/lib/clients/board-transitions')
let POST: Handler
let PATCH: Handler

before(async () => {
  mock.module('@/lib/auth-middleware', {
    namedExports: {
      withAuth: (_options: unknown, handler: unknown) => handler,
      withRateLimit: () => (handler: unknown) => handler,
    },
  })
  mock.module('@/lib/core/supabase-client', { namedExports: { getSupabaseService: () => service } })
  mock.module('@/lib/services/audit-service', {
    namedExports: {
      logAuditEvent: async (input: { action: string }) => {
        w.audits.push(input.action)
      },
    },
  })
  guides = await import('@/lib/services/guide-profile-service')
  pipeline = await import('@/lib/partnerships/pipeline')
  board = await import('@/lib/clients/board-transitions')
  ;({ POST, PATCH } = (await import('@/app/api/admin/clients/[clientId]/guide-profile/route')) as unknown as {
    POST: Handler
    PATCH: Handler
  })
})

function request(method: string, body: unknown): Request {
  return new Request(`http://cms.test/api/admin/clients/${CLIENT}/guide-profile`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const TGP23 = { code: 'TGP23', details: 'meeting_point' }
const POINT = { address: 'Praça Santos Dumont, em frente à igreja', city: 'Búzios', lat: -22.7469, lng: -41.8817 }

// ── "Aparece no app" ──────────────────────────────────────────────────────────────────────────

test('BR-B2B-064 item 11.a: listing without a meeting point comes back as its own reason, meeting_point_required, not a generic error', async () => {
  w.rpcError = TGP23
  const outcome = await guides.setGuideListed(operator, CLIENT, true)
  assert.deepEqual(outcome, { ok: false, httpStatus: 409, error: 'meeting_point_required' })
  assert.deepEqual(w.rpcCalls[0], { name: 'cms_set_guide_listed', args: { p_client_id: CLIENT, p_listed: true } })

  const res = await POST(request('POST', { listed: true }), ctx, AUTH)
  assert.equal(res.status, 409)
  assert.deepEqual(await res.json(), { error: 'meeting_point_required' })
  assert.deepEqual(w.audits, [], 'a refused tick writes no audit line')
  // a bad argument stays a different answer from the missing point
  assert.deepEqual(guides.guideRpcErrorOf('TGP22', 'listed'), { httpStatus: 422, error: 'invalid_listed' })
})

test('BR-B2B-064 item 11.a: with a meeting point, ticking lists (p_listed true) and unticking unlists (p_listed false)', async () => {
  w.rpcData = true
  const on = await POST(request('POST', { listed: true }), ctx, AUTH)
  assert.equal(on.status, 200)
  assert.deepEqual(await on.json(), { listed: true })
  assert.deepEqual(w.rpcCalls[0], { name: 'cms_set_guide_listed', args: { p_client_id: CLIENT, p_listed: true } })

  w.rpcData = false
  const off = await POST(request('POST', { listed: false }), ctx, AUTH)
  assert.equal(off.status, 200)
  assert.deepEqual(await off.json(), { listed: false })
  assert.deepEqual(w.rpcCalls[1], { name: 'cms_set_guide_listed', args: { p_client_id: CLIENT, p_listed: false } })
  assert.deepEqual(w.audits, ['LIST_GUIDE_PROFILE', 'UNLIST_GUIDE_PROFILE'])
})

test('BR-B2B-064 item 11.b: "Ocultar" with a reason still goes to cms_set_guide_hidden, untouched by the tick', async () => {
  w.rpcData = true
  const res = await POST(request('POST', { hidden: true, reason: 'tourist_report' }), ctx, AUTH)
  assert.equal(res.status, 200)
  assert.deepEqual(w.rpcCalls[0], {
    name: 'cms_set_guide_hidden',
    args: { p_client_id: CLIENT, p_hidden: true, p_reason: 'tourist_report' },
  })
  // a body with neither key is still refused before any RPC
  const bad = await POST(request('POST', { listed: 'yes' }), ctx, AUTH)
  assert.equal(bad.status, 400)
  assert.equal(w.rpcCalls.length, 1)
})

// ── The meeting point ─────────────────────────────────────────────────────────────────────────

test('BR-B2B-064 item 11.c: the meeting point needs address (1 to 300), city (1 to 80) and a numeric pin in range', () => {
  assert.deepEqual(guides.guideMeetingPointOf({ ...POINT, address: `  ${POINT.address}  ` }), POINT)
  assert.equal(guides.guideMeetingPointOf(null), null)
  assert.equal(guides.guideMeetingPointOf({ ...POINT, address: '   ' }), null)
  assert.equal(guides.guideMeetingPointOf({ ...POINT, address: 'a'.repeat(301) }), null)
  assert.equal(guides.guideMeetingPointOf({ ...POINT, city: '' }), null)
  assert.equal(guides.guideMeetingPointOf({ ...POINT, city: 'c'.repeat(81) }), null)
  // the pin comes from the map: a typed string never becomes a coordinate
  assert.equal(guides.guideMeetingPointOf({ ...POINT, lat: '-22.7' }), null)
  assert.equal(guides.guideMeetingPointOf({ ...POINT, lat: null }), null)
  assert.equal(guides.guideMeetingPointOf({ ...POINT, lat: 91 }), null)
  assert.equal(guides.guideMeetingPointOf({ ...POINT, lng: -181 }), null)
  assert.equal(guides.guideMeetingPointOf({ ...POINT, lng: Number.NaN }), null)
})

test('BR-B2B-064 item 11.c: saving the point calls cms_set_guide_meeting_point with the four values; invalid stops before the RPC', async () => {
  const bad = await PATCH(request('PATCH', { meetingPoint: { ...POINT, lat: null } }), ctx, AUTH)
  assert.equal(bad.status, 400)
  assert.deepEqual(await bad.json(), { error: 'invalid_meeting_point' })
  assert.equal(w.rpcCalls.length, 0)

  w.rpcData = '2026-11-10T15:04:00+00:00'
  const ok = await PATCH(request('PATCH', { meetingPoint: POINT }), ctx, AUTH)
  assert.equal(ok.status, 200)
  assert.deepEqual(await ok.json(), { updatedAt: '2026-11-10T15:04:00+00:00' })
  assert.deepEqual(w.rpcCalls[0], {
    name: 'cms_set_guide_meeting_point',
    args: { p_client_id: CLIENT, p_address: POINT.address, p_city: POINT.city, p_lat: POINT.lat, p_lng: POINT.lng },
  })
  assert.deepEqual(w.audits, ['UPDATE_GUIDE_MEETING_POINT'])

  w.rpcError = { code: 'TGP22', details: 'meeting_point' }
  const refused = await PATCH(request('PATCH', { meetingPoint: POINT }), ctx, AUTH)
  assert.equal(refused.status, 422)
  assert.deepEqual(await refused.json(), { error: 'invalid_meeting_point' })
})

test('BR-B2B-064 items 6 and 11: the profile read carries the tick and the point, all four columns or none', async () => {
  const base = {
    client_id: CLIENT,
    specialties: ['city_tour'],
    whatsapp: '5522999998888',
    public_contact_consent: true,
    hidden: false,
    hidden_reason: null,
    updated_at: '2026-11-10T12:00:00Z',
  }
  w.rows = [{ ...base, listed_in_app: true, meeting_point_address: POINT.address, meeting_point_city: POINT.city, meeting_point_lat: POINT.lat, meeting_point_lng: POINT.lng }]
  const read = await guides.loadGuideProfile(CLIENT)
  assert.ok(read.ok && read.profile)
  assert.equal(read.profile.listedInApp, true)
  assert.deepEqual(read.profile.meetingPoint, POINT)

  w.rows = [{ ...base, listed_in_app: false, meeting_point_address: null, meeting_point_city: null, meeting_point_lat: null, meeting_point_lng: null }]
  const old = await guides.loadGuideProfile(CLIENT)
  assert.ok(old.ok && old.profile)
  assert.equal(old.profile.listedInApp, false)
  assert.equal(old.profile.meetingPoint, null)

  // No owner behind the record in this fake: the facts say incomplete (#1185, the account has the photo and the bio).
  w.rows = [{ client_id: CLIENT, hidden: false, public_contact_consent: true, listed_in_app: false, meeting_point_lat: POINT.lat, whatsapp: '5522999998888' }]
  const facts = await guides.loadGuideProfileFacts([CLIENT])
  assert.deepEqual(facts.get(CLIENT), { hidden: false, consent: true, listedInApp: false, hasMeetingPoint: true, complete: false })
})

// ── One derivation for the badge and the queue ───────────────────────────────────────────────

const FACTS = { hidden: false, consent: true, listedInApp: true, hasMeetingPoint: true, complete: true }

test('BR-B2B-064 items 5, 6 and 11 · spec §9.1: the badge is derived top down, consent, hidden, point, tick', () => {
  assert.equal(pipeline.guideVisibilityOf(FACTS), 'listed')
  assert.equal(pipeline.guideVisibilityOf({ ...FACTS, listedInApp: false }), 'unlisted')
  assert.equal(pipeline.guideVisibilityOf({ ...FACTS, listedInApp: false, hasMeetingPoint: false }), 'no_meeting_point')
  // hidden is above the tick (11.b) and the missing consent above everything (item 5)
  assert.equal(pipeline.guideVisibilityOf({ ...FACTS, hidden: true }), 'hidden')
  assert.equal(pipeline.guideVisibilityOf({ ...FACTS, hidden: true, consent: false }), 'no_consent')
  assert.equal(pipeline.guideVisibilityOf({ ...FACTS, hasMeetingPoint: false, hidden: true }), 'hidden')
})

function guideState(guideProfile: typeof FACTS | null, portalStatus: 'approved' | 'live' = 'live') {
  return pipeline.derivePipelineState({
    proposalStatus: 'submitted',
    conference: { documentsSeen: [] } as never,
    clientId: CLIENT,
    gateMissing: [],
    placeCount: 0,
    publishedPlaceCount: 0,
    origin: 'portal',
    portalStatus,
    partnerKind: 'guide',
    guideProfile,
  })
}

test('BR-B2B-064 item 10: approving does not list, the published guide without the tick is published_unlisted; with it, published', () => {
  assert.equal(guideState({ ...FACTS, listedInApp: false }), 'published_unlisted')
  assert.equal(guideState({ ...FACTS, listedInApp: false }, 'approved'), 'published_unlisted')
  assert.equal(guideState({ ...FACTS, listedInApp: false, hasMeetingPoint: false }), 'published_unlisted')
  assert.equal(guideState(FACTS), 'published')
  // hidden or without consent stays Oculto do app, whatever the tick
  assert.equal(guideState({ ...FACTS, hidden: true }), 'hidden_from_app')
  assert.equal(guideState({ ...FACTS, consent: false }), 'hidden_from_app')
})

test('BR-B2B-064 item 10 · spec §9.3: published_unlisted is terminal, out of the default filter, counted, labelled and opens the client', () => {
  assert.ok(!pipeline.IN_PROGRESS_STATES.includes('published_unlisted'))
  assert.ok(pipeline.PIPELINE_STATES.includes('published_unlisted'))
  assert.equal(board.columnOf('published_unlisted'), 'published')
  assert.deepEqual(pipeline.portalDetailTarget('published_unlisted', { submissionId: 'sub', clientId: CLIENT }), {
    kind: 'client',
    clientId: CLIENT,
    tab: 'partnership',
  })
  const pt = JSON.parse(readFileSync(join(process.cwd(), 'messages/pt.json'), 'utf8'))
  const key = pipeline.stateMessageKey('published_unlisted', 'guide')
  assert.equal(pt.Partnerships.states[key], 'Publicado, fora do app')
  assert.equal(typeof pt.Partnerships.nextSteps[key], 'string')
})
