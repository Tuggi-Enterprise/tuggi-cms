/**
 * The CMS doors of #945 (epic #942): what the editor writes about a route's publication, how the
 * admin moderates it, and the per-user switch that lets an app user publish.
 *
 * Pinned here because none of it is visible from the screen: which RPC parameters travel (and
 * which do not before the migration), that removal is a status and never a DELETE, and that the
 * switch is admin only and goes both ways.
 *
 * Run with: npm run test:api
 */

import { test, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import type { NextRequest } from 'next/server'

const ROUTE_ID = '11111111-2222-4333-8444-555555555555'
const USER_ID = '99999999-8888-4777-8666-555555555555'

interface Call {
  client: 'operator' | 'service'
  schema: string
  target: string
  op: string
  args?: unknown
}

interface Scenario {
  role: string
  calls: Call[]
  route: Record<string, unknown> | null
  upsertError: { code: string; message: string } | null
  profile: { data: unknown; error: { code: string; message: string } | null }
  audit: string[]
}

let scenario: Scenario

const USER_ROUTE = {
  id: ROUTE_ID, name: 'Rota da praia', description: null, client_id: null, is_active: true,
  waypoints: [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }], metadata: { source: 'user_trip' }, geometry: null,
  status: 'pending_review', visibility: 'link_only', slug: 'rota-da-praia-3f9a1c', owner_user_id: USER_ID,
  valid_from: null, valid_until: '2026-10-25T00:00:00.000Z', moderation_reviewed_at: null,
}

function fresh(): Scenario {
  return {
    role: 'admin',
    calls: [],
    route: { ...USER_ROUTE },
    upsertError: null,
    profile: { data: { can_publish_routes: true }, error: null },
    audit: [],
  }
}

/** A chainable PostgREST stand-in: records every terminal call, answers by table. */
function query(client: Call['client'], schema: string, table: string) {
  let op = 'select'
  let payload: unknown
  const resolve = () => {
    scenario.calls.push({ client, schema, target: table, op, args: payload })
    if (table === 'cms_users') return { data: { id: 'cms-1', email: 'admin@tuggi.app', role: scenario.role, is_active: true }, error: null }
    if (table === 'profiles') {
      if (scenario.profile.error) return { data: null, error: scenario.profile.error }
      if (op === 'update') return { data: { can_publish_routes: (payload as { can_publish_routes: boolean }).can_publish_routes }, error: null }
      return scenario.profile
    }
    if (table === 'custom_routes' && op === 'select') return { data: { metadata: scenario.route?.metadata ?? {} }, error: null }
    return { data: null, error: null }
  }
  const q: any = {
    select: () => q, eq: () => q, in: () => q, is: () => q, or: () => q, order: () => q, limit: () => q,
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
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'auth-1', email: 'admin@tuggi.app' } }, error: null }) },
    schema: (schema: string) => ({
      from: (table: string) => query(kind, schema, table),
      rpc: async (fn: string, args: Record<string, unknown>) => {
        scenario.calls.push({ client: kind, schema, target: fn, op: 'rpc', args })
        if (fn === 'get_custom_route') return { data: scenario.route, error: null }
        if (fn === 'upsert_custom_route') {
          if (scenario.upsertError) return { data: null, error: scenario.upsertError }
          return { data: { ...scenario.route, status: args.p_status ?? scenario.route?.status }, error: null }
        }
        return { data: null, error: null }
      },
    }),
  }
}

let routeById: typeof import('@/app/api/routes/[id]/route')
let moderation: typeof import('@/app/api/routes/[id]/moderation/route')
let publishing: typeof import('@/app/api/admin/users/[userId]/route-publishing/route')

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
  mock.module('@/lib/services/audit-service', {
    namedExports: {
      logAuditEvent: async (input: { action: string }) => { scenario.audit.push(input.action); return true },
    },
  })
  routeById = await import('@/app/api/routes/[id]/route')
  moderation = await import('@/app/api/routes/[id]/moderation/route')
  publishing = await import('@/app/api/admin/users/[userId]/route-publishing/route')
})

beforeEach(() => { scenario = fresh() })

function request(method: string, body?: unknown): NextRequest {
  return new Request('http://localhost/api/x', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest
}

const routeCtx = { params: Promise.resolve({ id: ROUTE_ID }) }
const userCtx = { params: Promise.resolve({ userId: USER_ID }) }

function upsertArgs(): Record<string, unknown> | undefined {
  return scenario.calls.find((c) => c.target === 'upsert_custom_route')?.args as Record<string, unknown> | undefined
}

// ---------------------------------------------------------------------------
// PUT /api/routes/[id]: visibility, validity, slug
// ---------------------------------------------------------------------------

test('BR-ROTA-003/004: the editor writes visibility and validity by named parameter', async () => {
  const res = await routeById.PUT(request('PUT', {
    name: 'Rota da praia', visibility: 'public',
    valid_from: '2026-10-20T03:00:00.000Z', valid_until: '2026-11-20T02:59:59.999Z',
  }), routeCtx)
  assert.equal(res.status, 200)
  const args = upsertArgs()!
  assert.equal(args.p_visibility, 'public')
  assert.equal(args.p_set_validity, true)
  assert.equal(args.p_valid_from, '2026-10-20T03:00:00.000Z')
  assert.equal(args.p_valid_until, '2026-11-20T02:59:59.999Z')
  assert.ok(!('p_slug' in args), 'an untouched slug is not sent')
})

test('BR-ROTA-004: clearing the validity sends p_set_validity with NULLs (the route stops expiring)', async () => {
  await routeById.PUT(request('PUT', { valid_from: null, valid_until: null }), routeCtx)
  const args = upsertArgs()!
  assert.equal(args.p_set_validity, true)
  assert.equal(args.p_valid_from, null)
  assert.equal(args.p_valid_until, null)
})

test('#945: without publication keys the RPC call is the one of before the migration', async () => {
  await routeById.PUT(request('PUT', { name: 'Só o nome' }), routeCtx)
  const args = upsertArgs()!
  for (const key of ['p_visibility', 'p_slug', 'p_set_validity', 'p_valid_from', 'p_valid_until', 'p_status']) {
    assert.ok(!(key in args), `${key} must not travel: the legacy RPC has no such parameter`)
  }
})

test('BR-ROTA-004: an end before the start is refused before any write', async () => {
  const res = await routeById.PUT(request('PUT', {
    valid_from: '2026-11-20T00:00:00.000Z', valid_until: '2026-11-01T00:00:00.000Z',
  }), routeCtx)
  assert.equal(res.status, 400)
  assert.equal((await res.json()).code, 'validity_invalid')
  assert.equal(upsertArgs(), undefined)
})

test('BR-ROTA-005: a slug out of format is refused; one another route owns comes back as slug_taken', async () => {
  const bad = await routeById.PUT(request('PUT', { slug: 'Rota Da Praia' }), routeCtx)
  assert.equal(bad.status, 400)
  assert.equal((await bad.json()).code, 'slug_invalid')

  scenario.upsertError = { code: 'TGW09', message: 'Route slug rota-velha already belongs to another route' }
  const taken = await routeById.PUT(request('PUT', { slug: 'rota-velha' }), routeCtx)
  assert.equal(taken.status, 400)
  assert.equal((await taken.json()).code, 'slug_taken')

  scenario.upsertError = { code: '23505', message: 'duplicate key value violates unique constraint "custom_routes_slug_key"' }
  const dup = await routeById.PUT(request('PUT', { slug: 'outra-rota' }), routeCtx)
  assert.equal((await dup.json()).code, 'slug_taken')
})

// ---------------------------------------------------------------------------
// POST /api/routes/[id]/moderation
// ---------------------------------------------------------------------------

test('BR-ROTA-006/002: remove marks removed_by_moderation through the RPC and never DELETEs', async () => {
  const res = await moderation.POST(request('POST', { action: 'remove' }), routeCtx)
  assert.equal(res.status, 200)
  assert.equal(upsertArgs()!.p_status, 'removed_by_moderation')
  assert.ok(!scenario.calls.some((c) => c.op === 'delete'), 'no DELETE on any table')
  assert.ok(!scenario.calls.some((c) => c.target === 'delete_custom_route'), 'not the delete RPC either')
})

test('BR-ROTA-006: approving from the queue writes active', async () => {
  const res = await moderation.POST(request('POST', { action: 'approve' }), routeCtx)
  assert.equal(res.status, 200)
  assert.equal(upsertArgs()!.p_status, 'active')
  assert.equal((await res.json()).route.status, 'active')
})

test('BR-ROTA-006: restore brings a moderation removal back to active', async () => {
  scenario.route = { ...USER_ROUTE, status: 'removed_by_moderation' }
  await moderation.POST(request('POST', { action: 'restore' }), routeCtx)
  assert.equal(upsertArgs()!.p_status, 'active')
})

test('BR-ROTA-007: a route its author removed is not restored (TGW10 -> 409)', async () => {
  scenario.upsertError = { code: 'TGW10', message: 'A route its author removed stays removed' }
  const res = await moderation.POST(request('POST', { action: 'restore' }), routeCtx)
  assert.equal(res.status, 409)
})

test('BR-ROTA-006: moderation is admin only, and an unknown action is refused', async () => {
  scenario.role = 'client'
  const forbidden = await moderation.POST(request('POST', { action: 'remove' }), routeCtx)
  assert.equal(forbidden.status, 403)
  assert.equal(upsertArgs(), undefined)

  scenario.role = 'admin'
  const bad = await moderation.POST(request('POST', { action: 'delete' }), routeCtx)
  assert.equal(bad.status, 400)
})

// ---------------------------------------------------------------------------
// /api/admin/users/[userId]/route-publishing
// ---------------------------------------------------------------------------

test('BR-ROTA-006: the publishing switch turns on and off, with service_role, and is audited', async () => {
  const on = await publishing.PATCH(request('PATCH', { enabled: true }), userCtx)
  assert.equal(on.status, 200)
  assert.equal((await on.json()).can_publish_routes, true)

  const off = await publishing.PATCH(request('PATCH', { enabled: false }), userCtx)
  assert.equal(off.status, 200)
  assert.equal((await off.json()).can_publish_routes, false)

  const writes = scenario.calls.filter((c) => c.target === 'profiles' && c.op === 'update')
  assert.deepEqual(writes.map((w) => w.args), [{ can_publish_routes: true }, { can_publish_routes: false }])
  assert.ok(writes.every((w) => w.client === 'service' && w.schema === 'drive'))
  assert.deepEqual(scenario.audit, ['SET_ROUTE_PUBLISHING', 'SET_ROUTE_PUBLISHING'])
})

test('BR-ROTA-006: only an admin reaches the switch', async () => {
  scenario.role = 'client'
  const res = await publishing.PATCH(request('PATCH', { enabled: true }), userCtx)
  assert.equal(res.status, 403)
  assert.ok(!scenario.calls.some((c) => c.target === 'profiles'))
})

test('#945: enabled must be a boolean', async () => {
  const res = await publishing.PATCH(request('PATCH', { enabled: 'yes' }), userCtx)
  assert.equal(res.status, 400)
})

test('#945: before the migration the column is absent and the switch is hidden, not an error', async () => {
  scenario.profile = { data: null, error: { code: '42703', message: 'column profiles.can_publish_routes does not exist' } }
  const res = await publishing.GET(request('GET'), userCtx)
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { available: false, can_publish_routes: false })
})
