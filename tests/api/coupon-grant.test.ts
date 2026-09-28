/**
 * Coupon in hours — card #787.
 *
 * BR-MONETIZACAO-047: a coupon grants `until` (days) or `minutes` (hours balance), and the row
 * carries exactly one amount. BR-MONETIZACAO-063 item 7: the cap of a typed `minutes` grant is
 * checked where the coupon is created or edited — by the database trigger, whose `TGM63` the
 * routes turn into a 400 that names the cap. The cap is read back, never declared in this repo.
 *
 * Run with: npm run test:api
 */

import { test, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'

interface Write {
  op: 'insert' | 'update'
  payload: Record<string, unknown>
}

/** What the database answers to the write. `null` = the row comes back. */
let dbError: { code: string; message: string } | null
let writes: Write[]

function createFakeService() {
  const answer = async () =>
    dbError ? { data: null, error: dbError } : { data: { id: 'c-1', code: 'FAROL' }, error: null }
  const tail: any = { select: () => tail, eq: () => tail, single: answer }
  return {
    schema: () => ({
      from: () => ({
        insert: (rows: Record<string, unknown>[]) => {
          writes.push({ op: 'insert', payload: rows[0] })
          return tail
        },
        update: (payload: Record<string, unknown>) => {
          writes.push({ op: 'update', payload })
          return tail
        },
      }),
    }),
  }
}

function createFakeAuthClient() {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    single: async () => ({ data: { id: 'cms-1', role: 'admin', is_active: true }, error: null }),
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

let POST: (request: any) => Promise<Response>
let PATCH: (request: any, ctx: { params: Promise<{ id: string }> }) => Promise<Response>
let grant: typeof import('@/lib/coupons/grant')

before(async () => {
  mock.module('next/headers', {
    namedExports: { cookies: async () => ({ get: () => undefined, getAll: () => [] }) },
  })
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseRouteHandler: () => createFakeAuthClient(),
      getSupabaseService: () => createFakeService(),
    },
  })
  POST = (await import('@/app/api/admin/coupons/route')).POST
  PATCH = (await import('@/app/api/admin/coupons/[id]/route')).PATCH
  grant = await import('@/lib/coupons/grant')
})

beforeEach(() => {
  dbError = null
  writes = []
})

const BASE = {
  code: 'FAROL',
  eligibility: 'any',
  stack_with_active: true,
  max_redemptions: null,
  max_redemptions_per_user: 1,
}

function post(body: Record<string, unknown>) {
  return POST(
    new Request('http://localhost/api/admin/coupons', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...BASE, ...body }),
    })
  )
}

function patch(body: Record<string, unknown>) {
  return PATCH(
    new Request('http://localhost/api/admin/coupons/c-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'c-1' }) }
  )
}

/** The text `drive.tg_coupons_manual_grant_cap` raises, with the cap the database owns. */
const TGM63 = {
  code: 'TGM63',
  message: 'cupom FAROL: 2760 minutos passa do teto de 2700 minutos por ato (BR-MONETIZACAO-063).',
}

test('BR-MONETIZACAO-047: POST minutes coupon writes grant_minutes and NULL duration_days', async () => {
  const res = await post({ grant_kind: 'minutes', grant_minutes: 600 })
  assert.equal(res.status, 201)
  assert.equal(writes.length, 1)
  assert.equal(writes[0].payload.grant_kind, 'minutes')
  assert.equal(writes[0].payload.grant_minutes, 600)
  assert.equal(writes[0].payload.duration_days, null)
})

test('BR-MONETIZACAO-047: POST without grant_kind stays a days coupon (column default)', async () => {
  const res = await post({ duration_days: 7 })
  assert.equal(res.status, 201)
  assert.deepEqual(
    [writes[0].payload.grant_kind, writes[0].payload.duration_days, writes[0].payload.grant_minutes],
    ['until', 7, null]
  )
})

test('BR-MONETIZACAO-047: invalid combinations are refused before the database', async () => {
  const cases: Record<string, unknown>[] = [
    { grant_kind: 'minutes', grant_minutes: 600, duration_days: 7 },
    { grant_kind: 'until', duration_days: 7, grant_minutes: 600 },
    { grant_kind: 'minutes' },
    { grant_kind: 'until' },
    { grant_kind: 'hours', grant_minutes: 600 },
  ]
  for (const body of cases) {
    const res = await post(body)
    assert.equal(res.status, 400, JSON.stringify(body))
  }
  assert.equal(writes.length, 0)
})

test('BR-MONETIZACAO-063 item 2: zero, negative and fractional minutes are refused', async () => {
  for (const grant_minutes of [0, -60, 90.5, '600']) {
    const res = await post({ grant_kind: 'minutes', grant_minutes })
    assert.equal(res.status, 400, String(grant_minutes))
  }
  assert.equal(writes.length, 0)
})

test('BR-MONETIZACAO-063 item 7: above the cap, the TGM63 of the trigger becomes a 400 naming the cap', async () => {
  dbError = TGM63
  const res = await post({ grant_kind: 'minutes', grant_minutes: 2760 })
  const body = await res.json()
  assert.equal(res.status, 400)
  assert.equal(body.code, 'above_cap')
  assert.equal(body.cap_minutes, 2700)
  assert.doesNotMatch(body.error, /FAROL|BR-MONETIZACAO/, 'the database text does not cross')
})

test('BR-MONETIZACAO-063 item 7: PATCH above the cap answers the same 400', async () => {
  dbError = TGM63
  const res = await patch({ grant_kind: 'minutes', grant_minutes: 2760, duration_days: null })
  assert.equal(res.status, 400)
  assert.equal((await res.json()).cap_minutes, 2700)
})

test('BR-MONETIZACAO-047: PATCH switching to hours rewrites all three grant fields', async () => {
  const res = await patch({ grant_kind: 'minutes', grant_minutes: 2700, duration_days: null })
  assert.equal(res.status, 200)
  assert.deepEqual(
    [writes[0].payload.grant_kind, writes[0].payload.grant_minutes, writes[0].payload.duration_days],
    ['minutes', 2700, null]
  )
})

test('BR-MONETIZACAO-047: PATCH touching the grant without grant_kind is refused', async () => {
  const res = await patch({ duration_days: 7 })
  assert.equal(res.status, 400)
  assert.equal(writes.length, 0)
})

test('PATCH that does not touch the grant leaves the grant columns out', async () => {
  const res = await patch({ is_active: false })
  assert.equal(res.status, 200)
  assert.deepEqual(Object.keys(writes[0].payload), ['is_active'])
})

test('BR-MONETIZACAO-047: the list prints an hours coupon as "N h" and a days coupon in days', () => {
  assert.equal(
    grant.formatCouponGrant({ grant_kind: 'minutes', grant_minutes: 600, duration_days: null }, 'dias'),
    '10 h'
  )
  assert.equal(
    grant.formatCouponGrant({ grant_kind: 'until', grant_minutes: null, duration_days: 7 }, 'dias'),
    '7 dias'
  )
})

test('the owners page reads a missing minutes_granted_total as unknown, not zero', async () => {
  const { optionalMinutes, formatDurationOrDash } = await import('@/lib/format/duration')
  assert.equal(formatDurationOrDash(optionalMinutes(undefined)), '—')
  assert.equal(formatDurationOrDash(optionalMinutes('1200')), '20 h')
})
