/**
 * Coupon redemptions list — card #787, spec `docs/design/spec-cms-resgates-de-cupom-2026-09.md`.
 *
 * BR-MONETIZACAO-047: a redemption grants minutes OR days, and the totals of the list keep the two
 * units apart. The route is admin-only, passes the URL filter to drive.list_coupon_redemptions,
 * and survives the function not being deployed yet (the migration is not applied everywhere).
 *
 * Run with: npm run test:api
 */

import { test, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'

type DbError = { code: string; message: string } | null

let role: string
let couponRow: { id: string } | null
let rpcRows: unknown[]
let rpcError: DbError
let rpcCalls: { name: string; args: Record<string, unknown> }[]
let couponLookups: string[]
let logged: unknown[][]

const OWNER = '11111111-2222-4333-8444-555555555555'
const COUPON_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

function row(over: Record<string, unknown>) {
  return {
    redemption_id: crypto.randomUUID(),
    coupon_id: COUPON_ID,
    coupon_code: 'FAROL',
    owner_client_id: OWNER,
    owner_name: 'Farol Tur',
    user_id: crypto.randomUUID(),
    nickname: 'turista',
    redeemed_at: '2026-09-20T12:00:00Z',
    minutes_granted: null,
    days_granted: null,
    ...over,
  }
}

function createFakeService() {
  return {
    schema: () => ({
      from: () => {
        const chain: any = {
          select: () => chain,
          eq: (_col: string, value: string) => {
            couponLookups.push(value)
            return chain
          },
          maybeSingle: async () => ({ data: couponRow, error: null }),
        }
        return chain
      },
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpcCalls.push({ name, args })
        return rpcError ? { data: null, error: rpcError } : { data: rpcRows, error: null }
      },
    }),
  }
}

/** Cookie-bound client as `withAuth` uses it: `getUser()` then the `core.cms_users` lookup. */
function createFakeAuthClient() {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: { email: 'operator@tuggi.app', role, is_active: true }, error: null }),
  }
  return {
    auth: {
      getUser: async () => ({
        data: { user: { id: 'operator-1', email: 'operator@tuggi.app' } },
        error: null,
      }),
    },
    schema: () => ({ from: () => chain }),
  }
}

let GET: (request: NextRequest) => Promise<Response>

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
  GET = (await import('@/app/api/admin/coupons/redemptions/route')).GET
})

beforeEach(() => {
  role = 'admin'
  couponRow = { id: COUPON_ID }
  rpcRows = []
  rpcError = null
  rpcCalls = []
  couponLookups = []
  logged = []
  mock.method(console, 'error', (...args: unknown[]) => { logged.push(args) })
})

const get = (qs = '') => GET(new NextRequest(`http://cms.test/api/admin/coupons/redemptions${qs}`))

test('BR-MONETIZACAO-047: a non-admin CMS user gets 403 and the RPC is never called', async () => {
  role = 'editor'
  const res = await get()
  assert.equal(res.status, 403)
  assert.equal(rpcCalls.length, 0)
})

test('BR-MONETIZACAO-047: no filter calls the RPC with both parameters null', async () => {
  const res = await get()
  assert.equal(res.status, 200)
  assert.deepEqual(rpcCalls, [
    { name: 'list_coupon_redemptions', args: { p_coupon_id: null, p_owner_client_id: null } },
  ])
})

test('BR-MONETIZACAO-047: ?coupon is resolved by upper-cased code and ?owner passes as is', async () => {
  const res = await get(`?coupon=farol&owner=${OWNER}`)
  assert.equal(res.status, 200)
  assert.deepEqual(couponLookups, ['FAROL'])
  assert.deepEqual(rpcCalls[0].args, { p_coupon_id: COUPON_ID, p_owner_client_id: OWNER })
})

test('BR-MONETIZACAO-047: an unknown code is an empty list, not every coupon', async () => {
  couponRow = null
  const res = await get('?coupon=NOPE')
  const body = await res.json()
  assert.equal(res.status, 200)
  assert.equal(rpcCalls.length, 0)
  assert.deepEqual(body.redemptions, [])
  assert.equal(body.totals.redemptions, 0)
})

test('BR-MONETIZACAO-047: an owner that is not a uuid is refused with 400', async () => {
  const res = await get('?owner=not-a-uuid')
  assert.equal(res.status, 400)
  assert.equal(rpcCalls.length, 0)
})

test('BR-MONETIZACAO-047: the function not deployed yet (PGRST202) is 503 not_available, not a crash', async () => {
  rpcError = { code: 'PGRST202', message: 'Could not find the function drive.list_coupon_redemptions' }
  const res = await get()
  const body = await res.json()
  assert.equal(res.status, 503)
  assert.equal(body.code, 'not_available')
})

test('BR-MONETIZACAO-047: another RPC error is a generic 500 and the raw message is never logged', async () => {
  rpcError = { code: '22P02', message: 'invalid input: turista@example.com' }
  const res = await get()
  const body = await res.json()
  assert.equal(res.status, 500)
  assert.doesNotMatch(JSON.stringify(body), /turista@example\.com/)
  assert.doesNotMatch(JSON.stringify(logged), /turista@example\.com/)
})

test('BR-MONETIZACAO-047: totals cover every page and keep hours and days apart', async () => {
  rpcRows = [
    ...Array.from({ length: 21 }, () => row({ minutes_granted: 600 })),
    row({ coupon_code: 'OLD7', days_granted: 7 }),
    row({ coupon_code: 'OLD30', days_granted: 30 }),
  ]
  const res = await get('?limit=20&page=2')
  const body = await res.json()
  assert.equal(res.status, 200)
  assert.deepEqual(body.totals, { redemptions: 23, minutes_granted: 12_600, days_granted: 37 })
  assert.equal(body.redemptions.length, 3)
  assert.deepEqual(body.pagination, { page: 2, limit: 20, total: 23, pages: 2 })
  assert.doesNotMatch(JSON.stringify(logged), /turista@example\.com/)
})
