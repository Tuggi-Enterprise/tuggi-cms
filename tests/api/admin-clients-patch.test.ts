/**
 * PATCH /api/admin/clients/[clientId] — partner attribution fields.
 *
 * Regression: the admin allowlist did not contain the columns added by
 * 20260528125114_clients_supports_partners, so editing only "Avatar URL" in the
 * client editor answered 400 "No fields to update" — the CMS claiming there was
 * nothing to save while the operator was looking at the value they had typed.
 *
 * Run with: npm run test:api
 */

import { test, before, mock } from 'node:test'
import assert from 'node:assert/strict'

const CLIENT_ID = '11111111-1111-1111-1111-111111111111'

interface FakeService {
  client: any
  /** Payload handed to .update(), i.e. what would reach core.clients. */
  lastUpdate: Record<string, any> | null
  /** Row state after the update, i.e. what would be persisted. */
  row: Record<string, any>
}

/**
 * Minimal stand-in for the service-role client: enough chaining for
 * select().eq().single() and update().eq().select().single().
 */
function createFakeService(row: Record<string, any>): FakeService {
  const state: FakeService = {
    client: null,
    lastUpdate: null,
    row: { ...row },
  }

  const builder = () => {
    let pendingUpdate: Record<string, any> | null = null
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      update: (payload: Record<string, any>) => {
        pendingUpdate = payload
        state.lastUpdate = payload
        return chain
      },
      single: async () => {
        if (pendingUpdate) {
          state.row = { ...state.row, ...pendingUpdate }
          pendingUpdate = null
        }
        return { data: state.row, error: null }
      },
      maybeSingle: async () => ({ data: state.row, error: null }),
    }
    return chain
  }

  state.client = { schema: () => ({ from: () => builder() }) }
  return state
}

/** Authenticated CMS user with the admin role. */
function createFakeAuthClient() {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    single: async () => ({
      data: { id: 'cms-user-1', role: 'admin', is_active: true },
      error: null,
    }),
  }

  return {
    auth: {
      getSession: async () => ({
        data: { session: { user: { email: 'admin@tuggi.app' } } },
        error: null,
      }),
    },
    schema: () => ({ from: () => chain }),
  }
}

let service: FakeService
let PATCH: (request: any, ctx: { params: Promise<{ clientId: string }> }) => Promise<Response>

before(async () => {
  mock.module('next/headers', {
    namedExports: { cookies: async () => ({ get: () => undefined, getAll: () => [] }) },
  })

  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseRouteHandler: () => createFakeAuthClient(),
      getSupabaseService: () => service.client,
    },
  })

  const route = await import('@/app/api/admin/clients/[clientId]/route')
  PATCH = route.PATCH
})

function patch(body: Record<string, unknown>) {
  service = createFakeService({
    id: CLIENT_ID,
    name: 'Pousada do Farol',
    email: 'contato@pousadadofarol.com',
    client_type: 'business',
    avatar_url: null,
    social_handle: null,
    bio_one_line: null,
  })

  const request = new Request(`http://localhost/api/admin/clients/${CLIENT_ID}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  return PATCH(request, { params: Promise.resolve({ clientId: CLIENT_ID }) })
}

test('persists avatar_url when it is the only field changed', async () => {
  const response = await patch({ avatar_url: 'https://cdn.tuggi.app/partners/farol.png' })
  const payload = await response.json()

  assert.equal(response.status, 200, 'a lone partner field is still a field to update')
  assert.equal(payload.client.avatar_url, 'https://cdn.tuggi.app/partners/farol.png')
  assert.equal(service.lastUpdate?.avatar_url, 'https://cdn.tuggi.app/partners/farol.png')
})

test('persists the remaining partner attribution fields', async () => {
  const response = await patch({
    client_type: 'hotel',
    social_handle: '@pousadadofarol',
    bio_one_line: 'Frente para o mar em Búzios',
  })
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.client.client_type, 'hotel')
  assert.equal(payload.client.social_handle, '@pousadadofarol')
  assert.equal(payload.client.bio_one_line, 'Frente para o mar em Búzios')
})

test('rejects an avatar_url that is not an http(s) URL', async () => {
  for (const value of ['javascript:alert(1)', 'not a url', 'ftp://cdn.tuggi.app/farol.png']) {
    const response = await patch({ avatar_url: value })

    assert.equal(response.status, 400, `${value} must not reach the database`)
    assert.equal(service.lastUpdate, null)
  }
})

test('clears avatar_url when the operator empties the field', async () => {
  const response = await patch({ avatar_url: '' })
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.client.avatar_url, null)
})

test('still answers 400 when no editable field is provided', async () => {
  const response = await patch({ id: 'other-id', created_at: '2026-01-01T00:00:00Z' })

  assert.equal(response.status, 400)
  assert.equal(service.lastUpdate, null)
})

// ── What a 23505 on `core.clients` is allowed to say (#341) ──

test('#341: a unique violation names the constraint the database reported, not e-mail', async () => {
  // `core.clients.email` stops being unique in `20260814160000`: one owner, several places.
  // Four routes answered every 23505 with "Email already exists", which was imprecise before
  // the migration and false after it — the 409 that is left comes from `slug` or from
  // `cms_user_id`, and a message naming the wrong column sends the next person to the wrong
  // field. The mapping is by constraint, so it is true on both sides of the migration.
  const { describeClientUniqueViolation } = await import('@/lib/services/client-unique-conflicts')

  assert.equal(
    describeClientUniqueViolation({
      code: '23505',
      message: 'duplicate key value violates unique constraint "idx_clients_slug"',
    }),
    'Slug already in use'
  )
  assert.equal(
    describeClientUniqueViolation({
      code: '23505',
      message: 'duplicate key value violates unique constraint "clients_cms_user_id_key"',
    }),
    'This CMS user is already linked to a client'
  )
  assert.equal(
    describeClientUniqueViolation({
      code: '23505',
      message: 'duplicate key value violates unique constraint "clients_email_key"',
    }),
    'Email already exists',
    'while the constraint still exists, a collision on it still says e-mail'
  )

  // A constraint nobody told this function about is the case that produced the lie. It says
  // that something is taken; it does not invent a column.
  assert.equal(
    describeClientUniqueViolation({ code: '23505', message: 'duplicate key value violates X' }),
    'A unique field of this client record is already taken'
  )

  // And nothing that is not a unique violation gets turned into a 409.
  assert.equal(describeClientUniqueViolation({ code: '23514', message: 'depth' }), null)
  assert.equal(describeClientUniqueViolation(null), null)
})

test('#341: no route left translating 23505 into an e-mail collision on core.clients', async () => {
  const { readFileSync } = await import('node:fs')
  const { resolve } = await import('node:path')
  const root = resolve(import.meta.dirname, '../..')

  for (const route of [
    'app/api/admin/clients/route.ts',
    'app/api/admin/clients/[clientId]/route.ts',
    'app/api/coordinator/children/route.ts',
    'app/api/coordinator/children/[childId]/route.ts',
  ]) {
    const source = readFileSync(resolve(root, route), 'utf8')
    assert.equal(
      source.includes("'Email already exists'"),
      false,
      `${route} still names e-mail for a constraint it did not check`
    )
    assert.ok(
      source.includes('describeClientUniqueViolation'),
      `${route} does not ask which constraint collided`
    )
  }
})
