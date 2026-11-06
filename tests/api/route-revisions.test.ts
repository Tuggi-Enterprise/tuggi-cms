/**
 * The approval queue of user route versions (#1106, epic #1102): the CMS doors, the diff between the
 * version on the air and the pending one, the line split, the refusal and the promotion to POI.
 *
 * BR-ROTA-006 item 3: a person approves every version, through `core.approve_route_revision` only,
 * and a refusal needs the reason the author reads. BR-ROTA-008 item 7: the uncovered stretches are
 * the server's. BR-ROTA-009: the annotation becomes a POI with the author's text.
 *
 * Run with: npm run test:api
 */

import { test, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import type { NextRequest } from 'next/server'
import ptMessages from '../../messages/pt.json'
import {
  diffRevisions,
  needsTranslationAfterApproval,
  parsePromotion,
  parseRejectReason,
  promotedPhotoPath,
  splitLineAtGaps,
  classifyRevisionError,
  type RevisionStop,
} from '@/lib/routes/route-revisions'

const REVISION_ID = '11111111-2222-4333-8444-555555555555'
const ROUTE_ID = '22222222-3333-4444-8555-666666666666'
const LIVE_ID = '33333333-4444-4555-8666-777777777777'
const ANNOTATION = '44444444-5555-4666-8777-888888888888'
const PHOTO = `aaaaaaaa-0000-4000-8000-000000000000/bbbbbbbb-0000-4000-8000-000000000000/cccccccc-0000-4000-8000-000000000000.jpg`

const stop = (over: Partial<RevisionStop>): RevisionStop => ({
  kind: 'annotation', ref: 'a', title: null, description: null, lat: 1, lng: 1, at: null, photo_keys: [], ...over,
})

// ─── Pure rules ───────────────────────────────────────────────────────────────

test('BR-ROTA-006 item 3: the reason is required, at most 1,000 characters, and travels as written', () => {
  assert.deepEqual(parseRejectReason(''), { ok: false, error: 'reason_required' })
  assert.deepEqual(parseRejectReason('   \n '), { ok: false, error: 'reason_required' })
  assert.deepEqual(parseRejectReason(undefined), { ok: false, error: 'reason_required' })
  assert.deepEqual(parseRejectReason('x'.repeat(1001)), { ok: false, error: 'reason_too_long' })
  assert.deepEqual(parseRejectReason('x'.repeat(1000)), { ok: true, reason: 'x'.repeat(1000) })
  assert.deepEqual(parseRejectReason('  Tire o telefone da anotação 3. '), { ok: true, reason: '  Tire o telefone da anotação 3. ' })
})

test('BR-ROTA-006 item 10: the diff shows the fields and stops that changed from the version on the air', () => {
  const live = {
    name: 'Rota da orla', description: 'Antes.', visibility: 'public', cover_photo_key: 'k1', linestring: 'AA',
    stops: [stop({ ref: 'a', title: 'Mirante' }), stop({ kind: 'poi', ref: 'p', title: 'Forte' }), stop({ ref: 'b', title: 'Bar' }), stop({ ref: 'c', title: 'Saiu' })],
  }
  const pending = {
    name: 'Rota da orla', description: 'Depois.', visibility: 'link_only', cover_photo_key: 'k1', linestring: 'BB',
    stops: [stop({ kind: 'poi', ref: 'p', title: 'Forte' }), stop({ ref: 'a', title: 'Mirante' }), stop({ ref: 'b', title: 'Bar novo' }), stop({ ref: 'n', title: 'Nova' })],
  }
  const diff = diffRevisions(live, pending)
  assert.equal(diff.first, false)
  assert.deepEqual(diff.fields, [
    { field: 'description', before: 'Antes.', after: 'Depois.' },
    { field: 'visibility', before: 'public', after: 'link_only' },
  ])
  assert.deepEqual(diff.stops.map((s) => `${s.ref}:${s.change}`), ['p:moved', 'a:moved', 'b:edited', 'n:added', 'c:removed'])
  assert.equal(diff.lineChanged, true)
})

test('BR-ROTA-006 item 10: a photo swapped in an annotation is an edit; a first submission has nothing to compare', () => {
  const live = { name: 'x', description: null, visibility: 'public', cover_photo_key: null, stops: [stop({ ref: 'a', photo_keys: ['k1'] })] }
  const pending = { ...live, stops: [stop({ ref: 'a', photo_keys: ['k2'] })] }
  assert.equal(diffRevisions(live, pending).stops[0].change, 'edited')
  const first = diffRevisions(null, pending)
  assert.equal(first.first, true)
  assert.deepEqual(first.fields, [])
})

test('BR-ROTA-008 item 7: the line splits at the uncovered stretches the server stored, with no threshold of its own', () => {
  const line = [0, 1, 2, 3, 4, 5].map((i) => ({ lat: i, lng: i }))
  const out = splitLineAtGaps(line, [{ from_index: 2, to_index: 3, meters: 5400 }])
  assert.deepEqual(out.recorded, [line.slice(0, 3), line.slice(3)])
  assert.deepEqual(out.uncovered, [[line[2], line[3]]])
  assert.deepEqual(splitLineAtGaps(line, [{ from_index: 4, to_index: 9, meters: 1 }]).uncovered, [], 'an index out of the line is ignored')
  assert.deepEqual(splitLineAtGaps(line, []).recorded, [line])
})

test('contract item 4: after an approval the CMS asks for the translation when the text changed, none is ready, or annotations have text', () => {
  assert.equal(needsTranslationAfterApproval({ textChanged: true, routeTranslationReady: true, annotationTexts: 0 }), true)
  assert.equal(needsTranslationAfterApproval({ textChanged: false, routeTranslationReady: false, annotationTexts: 0 }), true)
  assert.equal(needsTranslationAfterApproval({ textChanged: false, routeTranslationReady: true, annotationTexts: 2 }), true)
  assert.equal(needsTranslationAfterApproval({ textChanged: false, routeTranslationReady: true, annotationTexts: 0 }), false)
})

test('#1106: the RPC codes of the contract become precise answers', () => {
  assert.deepEqual(classifyRevisionError('TGW18'), { status: 409, error: 'already_decided' })
  assert.deepEqual(classifyRevisionError('TGW09'), { status: 409, error: 'route_removed' })
  assert.deepEqual(classifyRevisionError('42501'), { status: 403, error: 'not_admin' })
  assert.deepEqual(classifyRevisionError('PGRST202'), { status: 503, error: 'not_available' })
  assert.deepEqual(classifyRevisionError('XX000'), { status: 500, error: 'revision_action_failed' })
})

test('BR-ROTA-009: the promotion needs name, text, city and country; the photo goes to the POI bucket by photo id', () => {
  const ok = parsePromotion({ annotationId: ANNOTATION, name: ' Mirante ', description: 'Vista.', city: 'Búzios', country: 'Brasil' })
  assert.ok(ok.ok)
  assert.equal(ok.ok && ok.input.name, 'Mirante')
  assert.deepEqual(parsePromotion({ annotationId: ANNOTATION, name: 'x', description: ' ', city: 'c', country: 'p' }), { ok: false, error: 'description_required' })
  assert.deepEqual(parsePromotion({ annotationId: 'nope', name: 'x', description: 'y', city: 'c', country: 'p' }), { ok: false, error: 'invalid_annotation' })
  assert.equal(promotedPhotoPath('poi-1', PHOTO), 'user-annotations/poi-1/cccccccc-0000-4000-8000-000000000000.jpg')
  assert.equal(promotedPhotoPath('poi-1', PHOTO.replace('.jpg', '.heic')), null)
})

// ─── The refusal form ─────────────────────────────────────────────────────────

let RejectForm: typeof import('@/components/admin/route-review/RejectForm').RejectForm

function renderReject(initialReason: string): string {
  // eslint-disable-next-line react/no-children-prop -- the provider type requires `children` in the props
  return renderToStaticMarkup(createElement(NextIntlClientProvider, {
    locale: 'pt',
    messages: { Pages: { RouteReview: ptMessages.Pages.RouteReview } },
    timeZone: 'America/Sao_Paulo',
    children: createElement(RejectForm, { busy: false, onReject: () => {}, initialReason }),
  }))
}

test('BR-ROTA-006 item 3: the refusal button is disabled while the reason is blank, and enabled with one', () => {
  for (const blank of ['', '   ']) {
    const html = renderReject(blank)
    assert.match(html, /<button[^>]*type="submit"[^>]*disabled=""/, `blank reason ${JSON.stringify(blank)}`)
  }
  const html = renderReject('Tire o telefone da anotação 3.')
  assert.doesNotMatch(html, /<button[^>]*type="submit"[^>]*disabled=""/)
  assert.match(html, /Recusar com motivo/)
  assert.match(html, /maxLength="1000"/)
})

// ─── The API doors ────────────────────────────────────────────────────────────

interface Call { client: 'operator' | 'service'; target: string; op: string; args?: unknown }

interface Scenario {
  role: string
  calls: Call[]
  revisions: Record<string, Record<string, unknown>>
  approve: { data: unknown; error: { code: string } | null }
  reject: { data: unknown; error: { code: string } | null }
  translationReady: boolean
  efStatus: number
  efCalls: Array<{ url: string; body: unknown }>
  route: Record<string, unknown>
}

let scenario: Scenario

function fresh(): Scenario {
  return {
    role: 'admin',
    calls: [],
    revisions: {
      [REVISION_ID]: {
        id: REVISION_ID, route_id: ROUTE_ID, revision_no: 2, state: 'pending', name: 'Rota da orla', description: 'Nova.',
        visibility: 'public', cover_photo_key: null, linestring: null, uncovered_segments: [], filter_flag_reason: null,
        submitted_at: '2026-11-06T12:00:00Z',
        stops: [{ kind: 'annotation', ref: ANNOTATION, title: 'Mirante', description: 'Vista.', lat: -22.7, lng: -41.9, photo_keys: [PHOTO] }],
      },
      [LIVE_ID]: {
        id: LIVE_ID, route_id: ROUTE_ID, revision_no: 1, state: 'approved', name: 'Rota da orla', description: 'Antiga.',
        visibility: 'public', cover_photo_key: null, linestring: null, uncovered_segments: [], filter_flag_reason: null,
        submitted_at: '2026-11-01T12:00:00Z', stops: [],
      },
    },
    approve: { data: [{ route_id: ROUTE_ID, revision_no: 2, status: 'active', valid_from: null, valid_until: null, text_changed: true }], error: null },
    reject: { data: [{ route_id: ROUTE_ID, revision_no: 2, revision_state: 'rejected', status: 'active' }], error: null },
    translationReady: true,
    efStatus: 200,
    efCalls: [],
    route: { id: ROUTE_ID, slug: 'rota-da-orla', status: 'active', live_revision_id: LIVE_ID },
  }
}

function query(client: Call['client'], table: string) {
  let op = 'select'
  let payload: unknown
  const filters: Record<string, unknown> = {}
  const resolve = () => {
    scenario.calls.push({ client, target: table, op, args: op === 'select' ? filters : payload })
    if (table === 'cms_users') return { data: { id: 'cms-1', email: 'admin@tuggi.app', role: scenario.role, is_active: true }, error: null }
    if (table === 'custom_route_revisions') return { data: scenario.revisions[String(filters.id)] ?? null, error: null }
    if (table === 'custom_routes') return { data: scenario.route, error: null }
    if (table === 'custom_route_descriptions') return { data: scenario.translationReady ? [{ id: 'd1' }] : [], error: null }
    return { data: op === 'select' ? [] : null, error: null }
  }
  const q: any = {
    select: () => q, in: () => q, is: () => q, or: () => q, order: () => q, limit: () => q,
    gte: () => q, lte: () => q,
    eq: (col: string, value: unknown) => { filters[col] = value; return q },
    update: (values: unknown) => { op = 'update'; payload = values; return q },
    insert: (values: unknown) => { op = 'insert'; payload = values; return q },
    delete: () => { op = 'delete'; return q },
    maybeSingle: async () => resolve(),
    single: async () => resolve(),
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(resolve()).then(ok, ko),
  }
  return q
}

function client(kind: Call['client']) {
  const bucket = (name: string) => ({
    createSignedUrls: async (keys: string[]) => ({ data: keys.map((k) => ({ path: k, signedUrl: `https://signed.test/${k}` })), error: null }),
    download: async (key: string) => { scenario.calls.push({ client: kind, target: `storage:${name}`, op: 'download', args: key }); return { data: new Blob(['jpg']), error: null } },
    upload: async (path: string) => { scenario.calls.push({ client: kind, target: `storage:${name}`, op: 'upload', args: path }); return { data: { path }, error: null } },
    getPublicUrl: (path: string) => ({ data: { publicUrl: `https://public.test/${name}/${path}` } }),
  })
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: 'auth-1', email: 'admin@tuggi.app' } }, error: null }),
      getSession: async () => ({ data: { session: { access_token: 'curator-jwt' } }, error: null }),
    },
    storage: { from: bucket },
    schema: () => ({
      from: (table: string) => query(kind, table),
      rpc: async (fn: string, args: Record<string, unknown>) => {
        scenario.calls.push({ client: kind, target: fn, op: 'rpc', args })
        if (fn === 'approve_route_revision') return scenario.approve
        if (fn === 'reject_route_revision') return scenario.reject
        if (fn === 'promote_annotation_to_poi') return { data: [{ attraction_id: 'poi-1', created: true }], error: null }
        if (fn === 'get_custom_route') return { data: { id: ROUTE_ID, status: 'pending_review', metadata: {} }, error: null }
        return { data: null, error: null }
      },
    }),
  }
}

let approve: typeof import('@/app/api/route-revisions/[revisionId]/approve/route')
let reject: typeof import('@/app/api/route-revisions/[revisionId]/reject/route')
let promote: typeof import('@/app/api/route-revisions/[revisionId]/promote/route')
let detail: typeof import('@/app/api/route-revisions/[revisionId]/route')
let moderation: typeof import('@/app/api/routes/[id]/moderation/route')

before(async () => {
  mock.module('next/headers', {
    namedExports: { cookies: async () => ({ get: () => undefined, getAll: () => [] }) },
  })
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseRouteHandler: () => client('operator'),
      getSupabaseService: () => client('service'),
      getSupabase: () => client('service'),
    },
  })
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.test'
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    scenario.efCalls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null })
    return new Response('{}', { status: scenario.efStatus })
  }) as typeof fetch
  RejectForm = (await import('@/components/admin/route-review/RejectForm')).RejectForm
  approve = await import('@/app/api/route-revisions/[revisionId]/approve/route')
  reject = await import('@/app/api/route-revisions/[revisionId]/reject/route')
  promote = await import('@/app/api/route-revisions/[revisionId]/promote/route')
  detail = await import('@/app/api/route-revisions/[revisionId]/route')
  moderation = await import('@/app/api/routes/[id]/moderation/route')
})

beforeEach(() => { scenario = fresh() })

let seq = 0
function request(body?: unknown): NextRequest {
  seq += 1
  return new Request('http://localhost/api/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.7.${Math.floor(seq / 250)}.${seq % 250}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest
}

const ctx = { params: Promise.resolve({ revisionId: REVISION_ID }) }
const rpcCalls = () => scenario.calls.filter((c) => c.op === 'rpc').map((c) => c.target)

test('BR-ROTA-006 item 3: a refusal without a reason is 400 and calls nothing', async () => {
  for (const body of [{}, { reason: '' }, { reason: '   ' }, { reason: 42 }]) {
    const res = await reject.POST(request(body), ctx)
    assert.equal(res.status, 400, JSON.stringify(body))
    assert.equal((await res.json()).error, 'reason_required')
  }
  assert.deepEqual(rpcCalls(), [])
})

test('BR-ROTA-006 item 3: a refusal with a reason calls reject_route_revision with the text as written, on the curator session', async () => {
  const res = await reject.POST(request({ reason: 'Tire o telefone da anotação 3.' }), ctx)
  assert.equal(res.status, 200)
  const call = scenario.calls.find((c) => c.target === 'reject_route_revision')!
  assert.deepEqual(call.args, { p_revision_id: REVISION_ID, p_reason: 'Tire o telefone da anotação 3.' })
  assert.equal(call.client, 'operator')
})

test('BR-ROTA-006 item 3: approving calls only approve_route_revision, never upsert_custom_route', async () => {
  const res = await approve.POST(request(), ctx)
  assert.equal(res.status, 200)
  assert.deepEqual(rpcCalls(), ['approve_route_revision'])
  const call = scenario.calls.find((c) => c.target === 'approve_route_revision')!
  assert.deepEqual(call.args, { p_revision_id: REVISION_ID })
  assert.equal(call.client, 'operator', 'is_caller_platform_admin reads the curator JWT')
  assert.ok(!scenario.calls.some((c) => c.target === 'custom_routes' && c.op === 'update'), 'no write on the route row')
})

test('contract item 4: after the approval the CMS asks generate-translated-audio for en-us with the curator session', async () => {
  const res = await approve.POST(request(), ctx)
  const out = await res.json()
  assert.equal(out.translation, 'requested')
  assert.equal(scenario.efCalls.length, 1)
  assert.equal(scenario.efCalls[0].url, 'https://project.test/functions/v1/generate-translated-audio')
  assert.deepEqual(scenario.efCalls[0].body, { routeId: ROUTE_ID, targetLanguage: 'en-us', voiceGender: 'male', generateAudio: true })
})

test('contract item 4: nothing changed, translation ready and no annotation text, no call; a failed call keeps the approval', async () => {
  scenario.approve.data = [{ route_id: ROUTE_ID, revision_no: 2, status: 'active', text_changed: false }]
  scenario.revisions[REVISION_ID].stops = []
  const quiet = await (await approve.POST(request(), ctx)).json()
  assert.equal(quiet.translation, 'not_needed')
  assert.equal(scenario.efCalls.length, 0)

  scenario = fresh()
  scenario.efStatus = 429
  const res = await approve.POST(request(), ctx)
  assert.equal(res.status, 200, 'the version is on the air even when the translation fails')
  const out = await res.json()
  assert.equal(out.translation, 'failed')
  assert.equal(out.translation_status, 429)
})

test('#1106: an already decided version is 409, and a non-admin is 403 before any RPC', async () => {
  scenario.approve = { data: null, error: { code: 'TGW18' } }
  const decided = await approve.POST(request(), ctx)
  assert.equal(decided.status, 409)
  assert.equal((await decided.json()).error, 'already_decided')

  scenario = fresh()
  scenario.role = 'client'
  const forbidden = await approve.POST(request(), ctx)
  assert.equal(forbidden.status, 403)
  assert.deepEqual(rpcCalls(), [])
})

test('BR-ROTA-006 item 10: the detail carries the diff from the version on the air and signed photo URLs', async () => {
  const res = await detail.GET(request() as NextRequest, ctx)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.live.id, LIVE_ID)
  assert.deepEqual(body.diff.fields, [{ field: 'description', before: 'Antiga.', after: 'Nova.' }])
  assert.equal(body.photoUrls[PHOTO], `https://signed.test/${PHOTO}`)
  assert.ok(ANNOTATION in body.nearby, 'the POIs around each annotation')
})

test('BR-ROTA-009: promoting calls promote_annotation_to_poi and copies the chosen photo to the POI bucket', async () => {
  const res = await promote.POST(request({ annotationId: ANNOTATION, name: 'Mirante', description: 'Vista.', city: 'Búzios', country: 'Brasil', photoKey: PHOTO }), ctx)
  assert.equal(res.status, 200)
  const out = await res.json()
  assert.deepEqual(out, { attraction_id: 'poi-1', created: true, photo: 'copied' })
  const rpc = scenario.calls.find((c) => c.target === 'promote_annotation_to_poi')!
  assert.equal((rpc.args as Record<string, unknown>).p_annotation_id, ANNOTATION)
  assert.equal(rpc.client, 'operator')
  const upload = scenario.calls.find((c) => c.op === 'upload')!
  assert.equal(upload.target, 'storage:travel-app-images')
  assert.equal(upload.args, 'user-annotations/poi-1/cccccccc-0000-4000-8000-000000000000.jpg')
  const set = scenario.calls.find((c) => c.target === 'attractions' && c.op === 'update')!
  assert.match(String((set.args as { image_url: string }).image_url), /travel-app-images\/user-annotations\/poi-1\//)
})

test('BR-ROTA-009: a photo that is not of that annotation is refused before the RPC', async () => {
  const res = await promote.POST(request({ annotationId: ANNOTATION, name: 'Mirante', description: 'Vista.', city: 'Búzios', country: 'Brasil', photoKey: 'other/user/photo.jpg' }), ctx)
  assert.equal(res.status, 400)
  assert.ok(!rpcCalls().includes('promote_annotation_to_poi'))
})

test('BR-ROTA-006 item 3 (#1106): the old moderation door no longer approves a route in review', async () => {
  const res = await moderation.POST(request({ action: 'approve' }), { params: Promise.resolve({ id: ROUTE_ID }) })
  assert.equal(res.status, 409)
  assert.equal((await res.json()).error, 'use_revision_queue')
  assert.ok(!rpcCalls().includes('upsert_custom_route'))
})
