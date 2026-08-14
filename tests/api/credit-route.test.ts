/**
 * The CMS door to the hour-credit ledger — card #310, phase 3 of epic #283.
 *
 * These tests pin the things a reader of the handler cannot verify by reading it: which
 * client each RPC runs on, which arguments the server refuses to take from the body, the
 * order of the two calls of a period grant, and what a refusal is allowed to say.
 *
 * Run with: npm run test:api
 */

import { test, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import type { NextRequest } from 'next/server'

interface RpcCall {
  client: 'operator' | 'service'
  schema: string
  fn: string
  args: Record<string, unknown>
}

interface Scenario {
  calls: RpcCall[]
  /** Keyed by RPC name: what that call answers. */
  responses: Record<string, { data?: unknown; error?: { code: string; message: string } }>
  /** What `drive.subscription_tiers` answers for the licence of a period grant. */
  tier: { data?: unknown; error?: { code: string; message: string } }
  /** Tables read through PostgREST, so a lookup that vanishes is visible. */
  reads: string[]
  auditActions: string[]
  auditDescriptions: string[]
}

const USER_ID = '11111111-2222-4333-8444-555555555555'
const TIER_ID = '99999999-8888-4777-8666-555555555555'

/** The licence a period grant may be written on: active, and not `free`. */
const PAID_TIER = { id: TIER_ID, name: 'premium', is_active: true }

function freshScenario(): Scenario {
  return {
    calls: [],
    responses: {},
    tier: { data: PAID_TIER },
    reads: [],
    auditActions: [],
    auditDescriptions: [],
  }
}

let scenario: Scenario

function createClient(kind: 'operator' | 'service') {
  const client: any = {
    auth: {
      getUser: async () => ({
        data: { user: { id: 'auth-operator-1', email: 'admin@tuggi.app' } },
        error: null,
      }),
    },
    schema: (schema: string) => ({
      from: (table: string) => {
        scenario.reads.push(`${schema}.${table}`)
        const query: any = {
          select: () => query,
          eq: () => query,
          maybeSingle: async () =>
            table === 'subscription_tiers'
              ? { data: scenario.tier.data ?? null, error: scenario.tier.error ?? null }
              : {
                  data: { email: 'admin@tuggi.app', role: 'admin', is_active: true },
                  error: null,
                },
        }
        return query
      },
      rpc: async (fn: string, args: Record<string, unknown>) => {
        scenario.calls.push({ client: kind, schema, fn, args })
        const configured = scenario.responses[fn]
        if (configured?.error) return { data: null, error: configured.error }
        return { data: configured?.data ?? { ok: true }, error: null }
      },
    }),
  }
  // `withAuth` looks up core.cms_users through the cookie-bound client only.
  return client
}

let route: typeof import('@/app/api/admin/users/[userId]/credit/route')
let revokeRoute: typeof import('@/app/api/admin/users/[userId]/credit/revoke/route')

before(async () => {
  mock.module('next/headers', {
    namedExports: { cookies: async () => ({ get: () => undefined, getAll: () => [] }) },
  })
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseRouteHandler: () => createClient('operator'),
      getSupabaseService: () => createClient('service'),
      getSupabase: () => createClient('service'),
    },
  })
  mock.module('@/lib/services/audit-service', {
    namedExports: {
      logAuditEvent: async (input: { action: string; description: string }) => {
        scenario.auditActions.push(input.action)
        scenario.auditDescriptions.push(input.description)
      },
    },
  })

  route = await import('@/app/api/admin/users/[userId]/credit/route')
  revokeRoute = await import('@/app/api/admin/users/[userId]/credit/revoke/route')
})

beforeEach(() => {
  scenario = freshScenario()
})

function post(body: unknown): NextRequest {
  return new Request(`http://localhost/api/admin/users/${USER_ID}/credit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

function context() {
  return { params: Promise.resolve({ userId: USER_ID }) }
}

function grantCall(): RpcCall | undefined {
  return scenario.calls.find((call) => call.fn === 'grant_time_credit')
}

// ---------------------------------------------------------------------------
// BR-MONETIZACAO-064 — `source` is attribution, not authorization
// ---------------------------------------------------------------------------

test('BR-MONETIZACAO-064: the handler fixes source=cms and ignores the one in the body', async () => {
  const response = await route.POST(post({ grant_type: 'minutes', minutes: 300, source: 'purchase' }), context())

  assert.equal(response.status, 200)
  assert.equal(grantCall()?.args.p_source, 'cms')
})

test('BR-MONETIZACAO-064: no value of source in the body reaches the RPC', async () => {
  for (const attempted of ['partner', 'welcome', 'transfer', 'coupon', 'purchase']) {
    scenario = freshScenario()
    await route.POST(post({ grant_type: 'minutes', minutes: 300, source: attempted }), context())
    assert.equal(grantCall()?.args.p_source, 'cms', `source=${attempted} leaked to the RPC`)
  }
})

// ---------------------------------------------------------------------------
// BR-MONETIZACAO-047 — one door, and the operator has to be its author
// ---------------------------------------------------------------------------

test('BR-MONETIZACAO-047: the grant runs on the operator client, never on service_role', async () => {
  await route.POST(post({ grant_type: 'minutes', minutes: 300 }), context())

  assert.equal(grantCall()?.client, 'operator')
  assert.equal(
    scenario.calls.filter((call) => call.client === 'service').length,
    0,
    'service_role would write granted_by = NULL into an immutable ledger'
  )
})

test('BR-MONETIZACAO-047: a minutes grant writes nothing but the ledger RPC', async () => {
  await route.POST(post({ grant_type: 'minutes', minutes: 300 }), context())

  assert.deepEqual(
    scenario.calls.map((call) => call.fn),
    ['grant_time_credit']
  )
  assert.deepEqual(scenario.auditActions, ['GRANT_TIME_CREDIT'])
})

// ---------------------------------------------------------------------------
// BR-MONETIZACAO-017 — one year cap, no past date, no open-ended grant
// ---------------------------------------------------------------------------

test('BR-MONETIZACAO-017: an absent end date is refused and writes nothing', async () => {
  const response = await route.POST(post({ grant_type: 'until', tier_id: TIER_ID }), context())

  assert.equal(response.status, 400)
  assert.equal((await response.json()).error.code, 'until_required')
  assert.deepEqual(scenario.calls, [], 'an open-ended grant must not reach the database')
})

test('BR-MONETIZACAO-017: a date in the past is refused and writes nothing', async () => {
  const past = new Date(Date.now() - 86_400_000).toISOString()
  const response = await route.POST(
    post({ grant_type: 'until', tier_id: TIER_ID, ends_at: past }),
    context()
  )

  assert.equal(response.status, 400)
  assert.equal((await response.json()).error.code, 'until_past')
  assert.deepEqual(scenario.calls, [])
})

test('BR-MONETIZACAO-017: more than one year ahead is refused and writes nothing', async () => {
  const tooFar = new Date()
  tooFar.setFullYear(tooFar.getFullYear() + 1)
  tooFar.setDate(tooFar.getDate() + 2)

  const response = await route.POST(
    post({ grant_type: 'until', tier_id: TIER_ID, ends_at: tooFar.toISOString() }),
    context()
  )

  assert.equal(response.status, 400)
  assert.equal((await response.json()).error.code, 'until_too_far')
  assert.deepEqual(scenario.calls, [])
})

test('BR-MONETIZACAO-017: exactly one year minus a day is accepted', async () => {
  const within = new Date()
  within.setFullYear(within.getFullYear() + 1)
  within.setDate(within.getDate() - 1)
  scenario.responses.apply_non_renewing_pass = {
    data: { applied: true, new_end_date: within.toISOString() },
  }

  const response = await route.POST(
    post({ grant_type: 'until', tier_id: TIER_ID, ends_at: within.toISOString() }),
    context()
  )

  assert.equal(response.status, 200)
})

// ---------------------------------------------------------------------------
// The two calls of a period grant, and their order
// ---------------------------------------------------------------------------

test('a period grant applies the vigência first and records the date that writer produced', async () => {
  const requested = new Date()
  requested.setMonth(requested.getMonth() + 1)
  const effective = new Date(requested.getTime() + 30 * 86_400_000).toISOString()
  scenario.responses.apply_non_renewing_pass = {
    data: { applied: true, new_end_date: effective },
  }

  const response = await route.POST(
    post({ grant_type: 'until', tier_id: TIER_ID, ends_at: requested.toISOString() }),
    context()
  )

  assert.equal(response.status, 200)
  assert.deepEqual(
    scenario.calls.map((call) => `${call.client}:${call.fn}`),
    ['service:apply_non_renewing_pass', 'operator:grant_time_credit'],
    'inverted, drive.record_time_credit_grant raises 22023 on purpose'
  )
  // The stacked date, not the requested one: the ledger row must never claim a right
  // that drive.profiles does not hold.
  assert.equal(grantCall()?.args.p_ends_at, effective)
})

test('a period grant asks for a fresh event id every time — a CMS grant is not idempotent', async () => {
  const target = new Date()
  target.setMonth(target.getMonth() + 1)
  scenario.responses.apply_non_renewing_pass = {
    data: { applied: true, new_end_date: target.toISOString() },
  }

  const ids: unknown[] = []
  for (let attempt = 0; attempt < 2; attempt += 1) {
    scenario.calls = []
    await route.POST(
      post({ grant_type: 'until', tier_id: TIER_ID, ends_at: target.toISOString() }),
      context()
    )
    ids.push(scenario.calls[0]?.args.p_provider_event_id)
  }

  assert.notEqual(ids[0], ids[1])
})

// ---------------------------------------------------------------------------
// BR-MONETIZACAO-046 — the licence a period may be written on
//
// The published app resolves the right as `tierName !== 'free' && notExpired`
// (docs/contracts/entitlement.md), so a period granted on Free writes a paid end date, makes
// the CMS panel say Ilimitado, records the ledger row — and gives the tourist nothing.
// ---------------------------------------------------------------------------

function untilBody(extra: Record<string, unknown> = {}) {
  const target = new Date()
  target.setMonth(target.getMonth() + 1)
  return { grant_type: 'until', tier_id: TIER_ID, ends_at: target.toISOString(), ...extra }
}

test('BR-MONETIZACAO-046: a period on the free licence is refused, and nothing is written', async () => {
  scenario.tier = { data: { id: TIER_ID, name: 'free', is_active: true } }

  const response = await route.POST(post(untilBody()), context())

  assert.equal(response.status, 400)
  assert.equal((await response.json()).error.code, 'invalid_tier')
  assert.deepEqual(
    scenario.calls,
    [],
    'the period would be applied and the app in the field would still deny access'
  )
  assert.deepEqual(scenario.auditActions, [])
})

test('a licence that is unknown or no longer active is refused before any write', async () => {
  for (const tier of [
    { data: null },
    { data: { id: TIER_ID, name: 'premium', is_active: false } },
    { data: { id: TIER_ID, name: null, is_active: true } },
  ]) {
    scenario = freshScenario()
    scenario.tier = tier

    const response = await route.POST(post(untilBody()), context())

    assert.equal(response.status, 400, JSON.stringify(tier))
    assert.equal((await response.json()).error.code, 'invalid_tier')
    assert.deepEqual(scenario.calls, [])
  }
})

test('a licence that could not be read fails closed, and does not blame the operator', async () => {
  scenario.tier = { error: { code: '42501', message: 'permission denied for table' } }

  const response = await route.POST(post(untilBody()), context())
  const body = await response.json()

  assert.equal(response.status, 500)
  assert.equal(body.error.code, 'unknown')
  assert.deepEqual(scenario.calls, [])
  assert.equal(JSON.stringify(body).includes('permission denied'), false)
})

test('the licence is checked against the database, not against the uuid in the body', async () => {
  scenario.responses.apply_non_renewing_pass = {
    data: { applied: true, new_end_date: new Date(Date.now() + 86_400_000).toISOString() },
  }

  await route.POST(post(untilBody()), context())

  assert.ok(
    scenario.reads.includes('drive.subscription_tiers'),
    'without this read the handler only knows the shape of the tier id'
  )
})

// ---------------------------------------------------------------------------
// F1 of the #310 review — the period is applied and the ledger row is not
// ---------------------------------------------------------------------------

test('BR-MONETIZACAO-065: a period applied without its ledger row is its own refusal', async () => {
  const effective = new Date(Date.now() + 40 * 86_400_000).toISOString()
  scenario.responses.apply_non_renewing_pass = { data: { applied: true, new_end_date: effective } }
  scenario.responses.grant_time_credit = {
    error: { code: '22023', message: 'record_time_credit_grant: perfil 1111-2222 sem vigência' },
  }

  const response = await route.POST(post(untilBody()), context())
  const body = await response.json()

  // NOT the old "apply the period first" message: the period is exactly what is already
  // applied, and repeating it stacks it. That key was removed with this classification.
  assert.equal(body.error.code, 'period_applied_no_record')
  assert.equal(response.status, 500)
  assert.equal(JSON.stringify(body).includes('perfil'), false)
})

test('every failure of the second call says the same thing, whatever SQLSTATE it carries', async () => {
  // The operator's next move does not depend on which exception the record raised: the
  // tourist holds the right either way.
  for (const sqlstate of ['22023', '42501', 'TGM49', '57014']) {
    scenario = freshScenario()
    scenario.responses.apply_non_renewing_pass = {
      data: { applied: true, new_end_date: new Date(Date.now() + 86_400_000).toISOString() },
    }
    scenario.responses.grant_time_credit = { error: { code: sqlstate, message: 'x' } }

    const response = await route.POST(post(untilBody()), context())

    assert.equal((await response.json()).error.code, 'period_applied_no_record', sqlstate)
  }
})

test('the right that lost its ledger row still gets an author, in the audit log', async () => {
  const effective = new Date(Date.now() + 40 * 86_400_000).toISOString()
  scenario.responses.apply_non_renewing_pass = { data: { applied: true, new_end_date: effective } }
  scenario.responses.grant_time_credit = { error: { code: '22023', message: 'x' } }

  await route.POST(post(untilBody()), context())

  // `granted_by` lives in the ledger row, and the ledger row is what is missing. Without
  // this line nobody knows who applied the period, or that it must not be applied again.
  assert.deepEqual(scenario.auditActions, ['GRANT_TIME_CREDIT_UNRECORDED'])
  assert.ok(scenario.auditDescriptions[0].includes(effective))
  assert.ok(scenario.auditDescriptions[0].includes('NOT be granted again'))
})

// ---------------------------------------------------------------------------
// Refusals: by SQLSTATE, and without a word of SQLERRM
// ---------------------------------------------------------------------------

const REFUSALS: Array<[string, string, string, number]> = [
  ['42501', 'forbidden: granting requires a platform operator', 'forbidden', 403],
  ['P0002', 'grant_time_credit: perfil inexistente.', 'no_profile', 404],
  ['TGM49', 'a quantidade tem de ser múltiplo de 5 minutos. Recebido: 118.', 'not_multiple', 400],
]

for (const [sqlstate, message, expected, status] of REFUSALS) {
  test(`SQLSTATE ${sqlstate} becomes "${expected}", and no database text crosses`, async () => {
    scenario.responses.grant_time_credit = { error: { code: sqlstate, message } }

    const response = await route.POST(post({ grant_type: 'minutes', minutes: 300 }), context())
    const body = await response.json()

    assert.equal(response.status, status)
    assert.equal(body.error.code, expected)
    assert.equal(JSON.stringify(body).includes('perfil'), false)
    assert.equal(JSON.stringify(body).includes('múltiplo'), false)
  })
}

test('BR-MONETIZACAO-063: TGM63 carries the cap read back from the exception, never a constant', async () => {
  scenario.responses.grant_time_credit = {
    error: {
      code: 'TGM63',
      message:
        'record_time_credit_grant: concessão de 3000 minutos (origem `cms`) passa do teto de 2700 minutos por ato (BR-MONETIZACAO-063).',
    },
  }

  const response = await route.POST(post({ grant_type: 'minutes', minutes: 3000 }), context())
  const body = await response.json()

  assert.equal(response.status, 400)
  assert.equal(body.error.code, 'above_cap')
  assert.equal(body.error.capMinutes, 2700)
  assert.equal(JSON.stringify(body).includes('record_time_credit_grant'), false)
})

test('a refused grant is not written to the audit log', async () => {
  scenario.responses.grant_time_credit = { error: { code: 'TGM49', message: 'x' } }

  await route.POST(post({ grant_type: 'minutes', minutes: 118 }), context())

  assert.deepEqual(scenario.auditActions, [])
})

// ---------------------------------------------------------------------------
// Shape refusals that never reach the database
// ---------------------------------------------------------------------------

test('a non-integer amount is refused before any RPC', async () => {
  for (const minutes of [0, -5, 12.5, '300', null]) {
    scenario = freshScenario()
    const response = await route.POST(post({ grant_type: 'minutes', minutes }), context())
    assert.equal(response.status, 400, `minutes=${String(minutes)} was accepted`)
    assert.deepEqual(scenario.calls, [])
  }
})

test('the handler does not restate the block size nor the cap', async () => {
  // 118 is not a multiple of 5 and 3000 is over the cap. Both have exactly one owner —
  // drive.record_time_credit_grant — so both have to reach it.
  for (const minutes of [118, 3000]) {
    scenario = freshScenario()
    await route.POST(post({ grant_type: 'minutes', minutes }), context())
    assert.equal(grantCall()?.args.p_minutes, minutes)
  }
})

// ---------------------------------------------------------------------------
// BR-MONETIZACAO-053 — revoking
// ---------------------------------------------------------------------------

const GRANT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

function revokePost(body: unknown): NextRequest {
  return new Request(`http://localhost/api/admin/users/${USER_ID}/credit/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

test('BR-MONETIZACAO-053: revoking without a reason is refused before any RPC', async () => {
  for (const reason of [undefined, '', '   ']) {
    scenario = freshScenario()
    const response = await revokeRoute.POST(revokePost({ grant_id: GRANT_ID, reason }), context())
    assert.equal(response.status, 400)
    assert.equal((await response.json()).error.code, 'reason_required')
    assert.deepEqual(scenario.calls, [])
  }
})

test('BR-MONETIZACAO-053: revoking runs on the operator client and never edits a row', async () => {
  scenario.responses.revoke_time_credit = { data: { ok: true, balance_minutes: 400 } }

  const response = await revokeRoute.POST(
    revokePost({ grant_id: GRANT_ID, reason: 'chamado 4821' }),
    context()
  )

  assert.equal(response.status, 200)
  assert.deepEqual(
    scenario.calls.map((call) => `${call.client}:${call.fn}`),
    ['operator:revoke_time_credit']
  )
  assert.deepEqual(scenario.auditActions, ['REVOKE_TIME_CREDIT'])
})

test('an already-revoked grant arrives as an envelope, not an exception', async () => {
  scenario.responses.revoke_time_credit = { data: { ok: false, reason: 'already_revoked' } }

  const response = await revokeRoute.POST(
    revokePost({ grant_id: GRANT_ID, reason: 'duplicado' }),
    context()
  )

  assert.equal(response.status, 409)
  assert.equal((await response.json()).error.code, 'already_revoked')
})

test('the revoke reason is not copied into the audit description', async () => {
  // `invalidation_reason` already lives in the ledger, with its own retention. A second
  // copy of free text the operator was told not to fill with personal data is a second
  // thing to erase, and the audit row is not where the reason is looked up.
  scenario.responses.revoke_time_credit = { data: { ok: true } }

  await revokeRoute.POST(
    revokePost({ grant_id: GRANT_ID, reason: 'estorno pedido por telefone' }),
    context()
  )

  assert.deepEqual(scenario.auditActions, ['REVOKE_TIME_CREDIT'])
  assert.equal(scenario.auditDescriptions[0].includes('telefone'), false)
  assert.equal(scenario.auditDescriptions[0].includes(GRANT_ID), true)
})

// ---------------------------------------------------------------------------
// The read door
// ---------------------------------------------------------------------------

test('the ledger read goes through the RPC, on the operator client', async () => {
  scenario.responses.get_time_credit_ledger = { data: { ok: true, state: 'free' } }

  const request = new Request(
    `http://localhost/api/admin/users/${USER_ID}/credit?session_limit=10&session_offset=20`
  ) as unknown as NextRequest
  const response = await route.GET(request, context())

  assert.equal(response.status, 200)
  assert.deepEqual(
    scenario.calls.map((call) => `${call.client}:${call.schema}.${call.fn}`),
    ['operator:drive.get_time_credit_ledger']
  )
  assert.equal(scenario.calls[0].args.p_session_limit, 10)
  assert.equal(scenario.calls[0].args.p_session_offset, 20)
})

test('a malformed user id never reaches the database', async () => {
  const request = new Request('http://localhost/api/admin/users/not-a-uuid/credit') as unknown as NextRequest
  const response = await route.GET(request, { params: Promise.resolve({ userId: 'not-a-uuid' }) })

  assert.equal(response.status, 400)
  assert.deepEqual(scenario.calls, [])
})
