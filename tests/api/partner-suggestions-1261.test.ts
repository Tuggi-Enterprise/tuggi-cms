/**
 * #1261 (epic #1249): the CMS answers a partner's place suggestion, and the route review shows when
 * the author is a partner. Contract `docs/contracts/tuggi-do-parceiro.md` §10.3.
 *
 * Pinned here: admin only, and nothing touches the database before the gate; the queue reads the
 * pending suggestions with the POIs around each pin; `link` and `refuse` call
 * `partner.cms_decide_partner_pick_suggestion` with the session's user as `p_actor`; `created` makes
 * the POI by the common path at the partner's pin first and then marks the suggestion with it; a
 * refusal without a reason, or above 1,000 characters, never reaches the database; TGB86, TGB80 and
 * TGB81 come back as precise answers; the route review marks the author who publishes for a partner;
 * the CMS ties a route partner to the Tuggi partner it is (`custom_route_partners.client_id`, §10.4).
 * Nothing here calls production: every database call is a fake.
 *
 * Run with: npx tsx --import ./tests/api/setup/console-to-stderr.mjs --experimental-test-module-mocks --test tests/api/partner-suggestions-1261.test.ts
 */

import { test, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { NextRequest } from 'next/server'

const SUGGESTION = 'aaaaaaaa-1111-4222-8333-444444444444'
const CLIENT_ID = 'cccccccc-1111-4222-8333-444444444444'
const OTHER_CLIENT = 'dddddddd-1111-4222-8333-444444444444'
const POI = 'eeeeeeee-1111-4222-8333-444444444444'
const NEW_POI = 'ffffffff-1111-4222-8333-444444444444'
const SESSION_UID = 'uid-1'
const CMS_USER = 'cms-1'

interface Op {
  schema: string
  table?: string
  rpc?: string
  op: 'select' | 'insert' | 'update' | 'delete' | 'rpc'
  payload?: unknown
  filters: [string, string, unknown][]
}

interface Answer {
  data?: unknown
  error?: { code: string; message: string } | null
}

let role: string | null
let ops: Op[]
let respond: (op: Op) => Answer

const ROW = {
  id: SUGGESTION,
  client_id: CLIENT_ID,
  partner_handle: 'hotel-mar-azul',
  partner_name: 'Hotel Mar Azul',
  client_type: 'hotel',
  name: 'Quiosque do Tonho',
  latitude: -22.8806,
  longitude: -42.0187,
  note: 'Barraca de praia com peixe frito.',
  status: 'pending',
  attraction_id: null,
  refusal_reason: null,
  created_at: '2026-11-22T13:14:00Z',
  decided_at: null,
  decided_by: null,
  picks_count: 3,
  pending_count: 2,
}

function defaultAnswer(op: Op): Answer {
  if (op.rpc === 'cms_list_partner_pick_suggestions') {
    return { data: [ROW, { ...ROW, id: '99999999-1111-4222-8333-444444444444', client_id: OTHER_CLIENT, name: 'Bar da Laje' }] }
  }
  if (op.rpc === 'cms_decide_partner_pick_suggestion') {
    const p = op.payload as Record<string, unknown>
    return { data: { id: p.p_suggestion_id, status: p.p_decision === 'refuse' ? 'refused' : p.p_decision === 'link' ? 'linked' : 'created', pick_added: p.p_decision !== 'refuse' } }
  }
  if (op.table === 'attraction_coordinate') {
    return {
      data: [
        { attraction_id: POI, latitude: -22.8808, longitude: -42.0189, attractions: { id: POI, name: 'Praia do Forte', city: 'Cabo Frio', country: 'Brazil', primary_category: 'beach', approved: true } },
      ],
    }
  }
  if (op.table === 'attractions' && op.op === 'insert') return { data: { id: NEW_POI } }
  if (op.rpc === 'insert_coordinate_safe') return { data: 'coord-1' }
  if (op.rpc === 'list_pending_route_revisions') {
    return {
      data: [
        { revision_id: 'r1', route_id: 'x1', revision_no: 1, submitted_at: '2026-11-23T10:00:00Z', route_status: 'pending_review', slug: null, author_user_id: 'owner-1', author_nickname: 'hotel-mar-azul', name: 'Cabo Frio em um dia', live_revision_id: null, live_revision_no: null, filter_flag_reason: null, report_count: 0 },
        { revision_id: 'r2', route_id: 'x2', revision_no: 2, submitted_at: '2026-11-23T11:00:00Z', route_status: 'active', slug: 'praias', author_user_id: 'place-acc', author_nickname: 'ana.viaja', name: 'Praias de Arraial', live_revision_id: 'l2', live_revision_no: 1, filter_flag_reason: null, report_count: 0 },
        { revision_id: 'r3', route_id: 'x3', revision_no: 1, submitted_at: '2026-11-22T11:00:00Z', route_status: 'pending_review', slug: null, author_user_id: 'tourist', author_nickname: 'bruno_trilhas', name: 'Trilha do Pai Vitório', live_revision_id: null, live_revision_no: null, filter_flag_reason: null, report_count: 0 },
      ],
    }
  }
  if (op.table === 'custom_route_partners' && op.op === 'update') {
    return { data: { id: 'rp-1', name: 'Hotel Mar Azul', short_description: null, logo_url: null, ...(op.payload as object) } }
  }
  if (op.table === 'profiles') return { data: [{ id: 'place-acc', client_id: OTHER_CLIENT }] }
  if (op.table === 'clients') {
    return {
      data: [
        { id: CLIENT_ID, name: 'Hotel Mar Azul', slug: null, owner_user_id: 'owner-1' },
        { id: OTHER_CLIENT, name: 'Pousada Canto do Mar', slug: 'canto-do-mar', owner_user_id: null },
      ],
    }
  }
  return { data: null }
}

function query(schema: string, table: string) {
  const op: Op = { schema, table, op: 'select', filters: [] }
  let recorded = false
  const finish = () => {
    if (table === 'cms_users') {
      return { data: role ? { id: CMS_USER, email: 'admin@tuggi.app', role, is_active: true } : null, error: null }
    }
    if (!recorded && table !== 'audit_logs') {
      ops.push(op)
      recorded = true
    }
    const a = respond(op)
    return { data: a.data ?? null, error: a.error ?? null }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: any = {
    select: () => q,
    insert: (payload: unknown) => ((op.op = 'insert'), (op.payload = payload), q),
    update: (payload: unknown) => ((op.op = 'update'), (op.payload = payload), q),
    delete: () => ((op.op = 'delete'), q),
    eq: (c: string, v: unknown) => (op.filters.push(['eq', c, v]), q),
    in: (c: string, v: unknown) => (op.filters.push(['in', c, v]), q),
    not: (c: string, o: string, v: unknown) => (op.filters.push(['not', c, `${o}.${v}`]), q),
    or: (v: string) => (op.filters.push(['or', '', v]), q),
    is: () => q,
    gte: () => q,
    lte: () => q,
    order: () => q,
    limit: () => q,
    single: async () => finish(),
    maybeSingle: async () => finish(),
    then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(finish()).then(ok, ko),
  }
  return q
}

function client() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = {
    auth: {
      getUser: async () =>
        role === null
          ? { data: { user: null }, error: { message: 'no session' } }
          : { data: { user: { id: SESSION_UID, email: 'admin@tuggi.app' } }, error: null },
    },
    schema: (schema: string) => ({
      from: (table: string) => query(schema, table),
      rpc: async (name: string, args?: unknown) => {
        const op: Op = { schema, rpc: name, op: 'rpc', payload: args, filters: [] }
        ops.push(op)
        const a = respond(op)
        return { data: a.data ?? null, error: a.error ?? null }
      },
    }),
  }
  return c
}

/* eslint-disable @typescript-eslint/no-explicit-any */
let route: any
let queueRoute: any
let routePartners: any
let lib: any
/* eslint-enable @typescript-eslint/no-explicit-any */

const root = resolve(import.meta.dirname, '../..')
const messages = Object.fromEntries(['pt', 'en', 'es'].map((l) => [l, JSON.parse(readFileSync(resolve(root, `messages/${l}.json`), 'utf8'))]))

before(async () => {
  mock.module('next/headers', { namedExports: { cookies: async () => ({ get: () => undefined, getAll: () => [] }) } })
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseRouteHandler: () => client(),
      getSupabaseService: () => client(),
      getSupabase: () => client(),
    },
  })
  route = await import('@/app/api/admin/partner-brand/suggestions/route')
  queueRoute = await import('@/app/api/route-revisions/route')
  routePartners = await import('@/app/api/routes/partners/route')
  lib = await import('@/lib/partner-brand/suggestions')
})

beforeEach(() => {
  role = 'admin'
  ops = []
  respond = defaultAnswer
})

const req = (method: string, body?: unknown, url = 'http://localhost/api/admin/partner-brand/suggestions') =>
  new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }) as unknown as NextRequest
const noCtx = { params: Promise.resolve({}) }
const decide = (body: Record<string, unknown>) => route.POST(req('POST', { suggestion_id: SUGGESTION, ...body }), noCtx)
const decisionCalls = () => ops.filter((o) => o.rpc === 'cms_decide_partner_pick_suggestion')

// ─── Gate ────────────────────────────────────────────────────────────────────────────────────

test('#1261: without a CMS admin session the suggestion doors refuse, and nothing touches the database', async () => {
  for (const r of ['editor', 'viewer', 'client']) {
    role = r
    assert.equal((await route.GET(req('GET'), noCtx)).status, 403, r)
    assert.equal((await decide({ decision: 'link', attraction_id: POI })).status, 403, r)
  }
  role = null
  assert.equal((await route.GET(req('GET'), noCtx)).status, 401)
  assert.equal((await decide({ decision: 'refuse', reason: 'x' })).status, 401)
  assert.deepEqual(ops, [])
})

// ─── Queue ───────────────────────────────────────────────────────────────────────────────────

test('#1261 BR-B2B-073 item 3.b: the queue reads the pending suggestions, each with the POIs around its pin', async () => {
  const res = await route.GET(req('GET'), noCtx)
  assert.equal(res.status, 200)
  const list = ops.find((o) => o.rpc === 'cms_list_partner_pick_suggestions')!
  assert.equal(list.schema, 'partner')
  assert.deepEqual(list.payload, { p_status: 'pending', p_limit: 500, p_offset: 0 })
  const { suggestions } = await res.json()
  assert.equal(suggestions.length, 2)
  assert.deepEqual(suggestions[0].nearby.map((p: { id: string; category: string; approved: boolean }) => [p.id, p.category, p.approved]), [[POI, 'beach', true]])
  assert.ok(suggestions[0].nearby[0].distance_m <= 300)
})

test('#1261: the Marca tab reads only the suggestions of its partner, and a bad client id is refused', async () => {
  const res = await route.GET(req('GET', undefined, `http://localhost/api/admin/partner-brand/suggestions?client_id=${OTHER_CLIENT}`), noCtx)
  const { suggestions } = await res.json()
  assert.deepEqual(suggestions.map((s: { client_id: string }) => s.client_id), [OTHER_CLIENT])
  ops = []
  const bad = await route.GET(req('GET', undefined, 'http://localhost/api/admin/partner-brand/suggestions?client_id=x'), noCtx)
  assert.equal(bad.status, 400)
  assert.deepEqual(ops, [])
})

// ─── The three answers ───────────────────────────────────────────────────────────────────────

test('#1261 BR-B2B-073 item 3.b: link calls the decision with the POI and the session user as p_actor, never the body actor', async () => {
  const res = await decide({ decision: 'link', attraction_id: POI, p_actor: 'ffffffff-0000-4000-8000-000000000000' })
  assert.equal(res.status, 200)
  const [call] = decisionCalls()
  assert.equal(call.schema, 'partner')
  assert.deepEqual(call.payload, { p_suggestion_id: SUGGESTION, p_decision: 'link', p_attraction_id: POI, p_reason: null, p_actor: SESSION_UID })
  assert.equal((await res.json()).decision.status, 'linked')
})

test('#1261 BR-B2B-073 item 3.b: created makes the POI by the common path at the partner pin, then marks the suggestion with it', async () => {
  const res = await decide({
    decision: 'created',
    poi: { name: ' Quiosque do Tonho ', description: 'Barraca de praia.', city: 'Cabo Frio', state: 'RJ', country: 'Brazil' },
  })
  assert.equal(res.status, 200)
  const insert = ops.find((o) => o.table === 'attractions' && o.op === 'insert')!
  const row = insert.payload as Record<string, unknown>
  assert.equal(row.name, 'Quiosque do Tonho')
  assert.equal(row.description, 'Barraca de praia.')
  assert.equal(row.approved, false, 'born not approved: the usual review follows')
  assert.equal(row.created_by, CMS_USER)
  // item 3.c: the POI is the curation's, never the partner's
  assert.equal('partner_client_id' in row, false)
  const coord = ops.find((o) => o.rpc === 'insert_coordinate_safe')!
  assert.deepEqual(coord.payload, { p_attraction_id: NEW_POI, p_latitude: ROW.latitude, p_longitude: ROW.longitude, p_show_in_map: true })
  const [call] = decisionCalls()
  assert.deepEqual(call.payload, { p_suggestion_id: SUGGESTION, p_decision: 'created', p_attraction_id: NEW_POI, p_reason: null, p_actor: SESSION_UID })
  assert.equal(ops.indexOf(insert) < ops.indexOf(call), true)
  assert.equal((await res.json()).attraction_id, NEW_POI)
})

test('#1261 BR-B2B-073 item 3.b: created for a suggestion no longer pending creates no POI', async () => {
  respond = (op) => (op.rpc === 'cms_list_partner_pick_suggestions' ? { data: [] } : defaultAnswer(op))
  const res = await decide({ decision: 'created', poi: { name: 'A', description: 'B', city: 'C', country: 'D' } })
  assert.equal(res.status, 409)
  assert.deepEqual((await res.json()).error, { code: 'suggestion_not_pending' })
  assert.equal(ops.some((o) => o.table === 'attractions'), false)
  assert.deepEqual(decisionCalls(), [])
})

test('#1261: a decision that fails after the POI was created says so and carries the POI id', async () => {
  respond = (op) => (op.rpc === 'cms_decide_partner_pick_suggestion' ? { error: { code: 'TGB86', message: 'not pending' } } : defaultAnswer(op))
  const res = await decide({ decision: 'created', poi: { name: 'A', description: 'B', city: 'C', country: 'D' } })
  assert.equal(res.status, 409)
  const body = await res.json()
  assert.deepEqual(body.error, { code: 'suggestion_not_pending' })
  assert.equal(body.attraction_id, NEW_POI)
})

test('#1261 BR-B2B-073 item 3.b: refuse sends the reason as written, up to 1,000 characters', async () => {
  const res = await decide({ decision: 'refuse', reason: 'Fechado desde outubro.' })
  assert.equal(res.status, 200)
  assert.deepEqual(decisionCalls()[0].payload, { p_suggestion_id: SUGGESTION, p_decision: 'refuse', p_attraction_id: null, p_reason: 'Fechado desde outubro.', p_actor: SESSION_UID })

  ops = []
  assert.equal((await decide({ decision: 'refuse', reason: 'x'.repeat(1000) })).status, 200)
  assert.equal((decisionCalls()[0].payload as { p_reason: string }).p_reason.length, 1000)
})

test('#1261 BR-B2B-073 item 3.b: a refusal without a reason, or above 1,000 characters, never reaches the database', async () => {
  for (const reason of [undefined, null, '', '   \n ']) {
    const res = await decide({ decision: 'refuse', reason })
    assert.equal(res.status, 400, String(reason))
    assert.deepEqual((await res.json()).error, { code: 'reason_required' })
  }
  const long = await decide({ decision: 'refuse', reason: 'x'.repeat(1001) })
  assert.equal(long.status, 400)
  assert.deepEqual((await long.json()).error, { code: 'suggestion_reason_too_long' })
  assert.deepEqual(ops, [])
})

test('#1261: a bad suggestion, decision, POI id or POI field never reaches the database', async () => {
  const bad: Record<string, unknown>[] = [
    { suggestion_id: 'x', decision: 'link', attraction_id: POI },
    { suggestion_id: SUGGESTION, decision: 'approve' },
    { suggestion_id: SUGGESTION, decision: 'link', attraction_id: 'not-a-uuid' },
    { suggestion_id: SUGGESTION, decision: 'created', poi: { name: 'A', description: '', city: 'C', country: 'D' } },
    { suggestion_id: SUGGESTION, decision: 'created' },
  ]
  for (const body of bad) assert.equal((await route.POST(req('POST', body), noCtx)).status, 400, JSON.stringify(body))
  assert.deepEqual(ops, [])
})

test('#1261: TGB86, TGB80 and TGB81 come back as precise answers, with a sentence in the three CMS languages', async () => {
  const cases: [string, number, string][] = [
    ['TGB86', 409, 'suggestion_not_pending'],
    ['TGB80', 404, 'poi_not_found'],
    ['TGB81', 409, 'own_poi'],
  ]
  for (const [sqlstate, status, code] of cases) {
    respond = (op) => (op.rpc === 'cms_decide_partner_pick_suggestion' ? { error: { code: sqlstate, message: 'x' } } : defaultAnswer(op))
    const res = await decide({ decision: 'link', attraction_id: POI })
    assert.equal(res.status, status, sqlstate)
    assert.deepEqual((await res.json()).error, { code })
    for (const l of ['pt', 'en', 'es']) assert.ok(messages[l].PartnerBrand.errors[code], `${l} ${code}`)
  }
})

test('#1261 BR-B2B-073 item 3.d: no text of the suggestions promises a time to answer', () => {
  const pt = JSON.stringify(messages.pt.PartnerBrand.suggestions).toLowerCase()
  for (const word of ['em breve', 'prazo', 'horas', 'dias úteis']) assert.equal(pt.includes(word), false, word)
  for (const l of ['en', 'es']) {
    assert.deepEqual(Object.keys(messages[l].PartnerBrand.suggestions).sort(), Object.keys(messages.pt.PartnerBrand.suggestions).sort(), l)
    assert.deepEqual(Object.keys(messages[l].Pages.RouteReview.partner).sort(), Object.keys(messages.pt.Pages.RouteReview.partner).sort(), l)
  }
})

test('#1261: the parser is the one of BR-ROTA-006 item 3 (the same 1,000)', async () => {
  const { REJECT_REASON_MAX } = await import('@/lib/routes/route-revisions')
  assert.equal(REJECT_REASON_MAX, 1000)
  assert.equal(lib.parseSuggestionDecision({ suggestion_id: SUGGESTION, decision: 'refuse', reason: 'x'.repeat(REJECT_REASON_MAX) }).ok, true)
})

// ─── Route review ────────────────────────────────────────────────────────────────────────────

test('#1261 BR-B2B-073 item 7.b: the route queue marks the author who owns a partner record or is linked to a place, and no one else', async () => {
  const res = await queueRoute.GET(req('GET', undefined, 'http://localhost/api/route-revisions'), noCtx)
  assert.equal(res.status, 200)
  const { items } = await res.json()
  const byId = Object.fromEntries(items.map((i: { revision_id: string; author_partner: unknown }) => [i.revision_id, i.author_partner]))
  // owner of the record: the handle falls back to the owner's @ when the record has no slug
  assert.deepEqual(byId.r1, { client_id: CLIENT_ID, name: 'Hotel Mar Azul', handle: 'hotel-mar-azul' })
  // account linked to a place: the slug of the record
  assert.deepEqual(byId.r2, { client_id: OTHER_CLIENT, name: 'Pousada Canto do Mar', handle: 'canto-do-mar' })
  assert.equal(byId.r3, null)
  const profiles = ops.find((o) => o.table === 'profiles')!
  assert.equal(profiles.schema, 'drive')
  assert.deepEqual(profiles.filters.find((f) => f[0] === 'in')?.[2], ['owner-1', 'place-acc', 'tourist'])
})

test('#1261: a failed partner read leaves the route queue without the badge, never without the queue', async () => {
  respond = (op) => (op.table === 'clients' ? { error: { code: '42501', message: 'denied' } } : defaultAnswer(op))
  const res = await queueRoute.GET(req('GET', undefined, 'http://localhost/api/route-revisions'), noCtx)
  assert.equal(res.status, 200)
  const { items } = await res.json()
  assert.equal(items.length, 3)
  assert.ok(items.every((i: { author_partner: unknown }) => i.author_partner === null))
})

// ─── Route partner of the curation (§10.4) ───────────────────────────────────────────────────

const RP = '12121212-1111-4222-8333-444444444444'
const patchRp = (body: unknown) => routePartners.PATCH(req('PATCH', body, 'http://localhost/api/routes/partners'), noCtx)

test('#1261 BR-B2B-073 item 6: the CMS ties a route partner to the Tuggi partner, and unties it with null', async () => {
  const res = await patchRp({ id: RP, client_id: CLIENT_ID })
  assert.equal(res.status, 200)
  const [write] = ops
  assert.equal(write.schema, 'core')
  assert.equal(write.table, 'custom_route_partners')
  assert.equal(write.op, 'update')
  assert.deepEqual(write.payload, { client_id: CLIENT_ID })
  assert.deepEqual(write.filters, [['eq', 'id', RP]])
  assert.equal((await res.json()).partner.client_id, CLIENT_ID)

  ops = []
  assert.equal((await patchRp({ id: RP, client_id: null })).status, 200)
  assert.deepEqual(ops[0].payload, { client_id: null })
})

test('#1261: only an admin ties a route partner, a bad body never reaches the database, and the effect is the proof', async () => {
  role = 'client'
  assert.equal((await patchRp({ id: RP, client_id: CLIENT_ID })).status, 403)
  role = 'admin'
  for (const body of [{ id: 'x', client_id: CLIENT_ID }, { id: RP }, { id: RP, client_id: 'x' }, null]) {
    assert.equal((await patchRp(body)).status, 400, JSON.stringify(body))
  }
  assert.deepEqual(ops, [])

  respond = (op) => (op.table === 'custom_route_partners' ? { data: null } : defaultAnswer(op))
  const missing = await patchRp({ id: RP, client_id: CLIENT_ID })
  assert.equal(missing.status, 404)
  assert.equal((await missing.json()).error, 'route_partner_not_found')

  respond = (op) => (op.table === 'custom_route_partners' ? { error: { code: '23503', message: 'fk' } } : defaultAnswer(op))
  const fk = await patchRp({ id: RP, client_id: CLIENT_ID })
  assert.equal(fk.status, 404)
  assert.equal((await fk.json()).error, 'client_not_found')
})
