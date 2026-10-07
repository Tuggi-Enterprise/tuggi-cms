/**
 * #812 security review — the portal approval is retry-safe and runs once at a time
 * (BR-B2B-049 item 7, BR-B2B-047 item 1).
 *
 * The database, the POI writes and the client writes are faked; what runs for real is the order
 * of `approvePortalSubmission`: claim → POI → attraction_id → client → link/details/coordinate →
 * transition, and what a retry does when a step in the middle failed.
 *
 * Run with: npm run test:api
 */

import { test, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'

const SUB = '11111111-1111-4111-8111-111111111111'
const POI = '22222222-2222-4222-8222-222222222222'
const CLIENT = '33333333-3333-4333-8333-333333333333'
const NOW = new Date('2026-10-04T12:00:00.000Z')
const CMS_OP = '44444444-4444-4444-8444-444444444444'

const ANSWERS = {
  trade_name: 'Bar do Zé',
  category: 'bar_cafe',
  city: 'Búzios',
  state: 'RJ',
  district: 'Centro',
  address_street: 'Rua das Pedras',
  offer_free: '10% de desconto',
}

interface World {
  submission: Record<string, unknown>
  claimRows: number
  claimError: boolean
  poiClient: string | null
  createFails: boolean
  applyFails: false | 'details_failed' | 'coordinate_failed'
  calls: string[]
  updates: Record<string, unknown>[]
  acceptanceEmail: string | null
  clientInsert: Record<string, unknown> | null
  /** `ClientService.approveClient` throwing (#872). */
  approveFails: boolean
  approvedWith: unknown[] | null
}
let w: World

function reset(over: Partial<World> = {}) {
  w = {
    submission: { id: SUB, status: 'in_review', answers: ANSWERS, attraction_id: null },
    claimRows: 1,
    claimError: false,
    poiClient: null,
    createFails: false,
    applyFails: false,
    calls: [],
    updates: [],
    acceptanceEmail: 'dono@bardoze.com.br',
    clientInsert: null,
    approveFails: false,
    approvedWith: null,
    ...over,
  }
}

function submissionsTable() {
  let update: Record<string, unknown> | null = null
  const q: any = {
    select: () => q,
    eq: () => q,
    or: (filter: string) => (w.calls.push(`or:${filter}`), q),
    update: (values: Record<string, unknown>) => {
      update = values
      w.updates.push(values)
      if ('approval_claimed_at' in values) w.calls.push(values.approval_claimed_at ? 'claim' : 'release')
      if ('attraction_id' in values) {
        w.calls.push('write_attraction_id')
        w.submission.attraction_id = values.attraction_id
      }
      return q
    },
    maybeSingle: async () => ({ data: w.submission, error: null }),
    then: (resolve: (v: unknown) => unknown) => {
      if (update && 'approval_claimed_at' in update && update.approval_claimed_at) {
        return resolve(
          w.claimError
            ? { data: null, error: { code: '42703' } }
            : { data: Array.from({ length: w.claimRows }, () => ({ id: SUB })), error: null }
        )
      }
      return resolve({ data: null, error: null })
    },
  }
  return q
}

function clientsTable() {
  const q: any = {
    select: () => q,
    eq: () => q,
    maybeSingle: async () => ({ data: { email: 'dono@bardoze.com.br', name: 'Bar do Zé' }, error: null }),
  }
  return q
}

function acceptancesTable() {
  const q: any = {
    select: () => q,
    eq: () => q,
    maybeSingle: async () => ({ data: w.acceptanceEmail ? { email: w.acceptanceEmail } : null, error: null }),
  }
  return q
}

const service = {
  schema: () => ({
    from: (table: string) =>
      table === 'place_acceptances' ? acceptancesTable() : table === 'clients' ? clientsTable() : submissionsTable(),
    rpc: async (_name: string, args: Record<string, unknown>) => {
      w.calls.push(`transition:${args.p_to}`)
      return { data: args.p_to, error: null }
    },
  }),
}

const operator: any = {
  schema: () => ({
    from: () => {
      const q: any = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: { partner_client_id: w.poiClient }, error: null }),
      }
      return q
    },
  }),
}

let mod: typeof import('@/lib/services/portal-validation-service')

before(async () => {
  mock.module('@/lib/core/supabase-client', { namedExports: { getSupabaseService: () => service } })
  mock.module('@/lib/services/partner-place-provisioning', {
    namedExports: {
      createPrefilledPlace: async () => {
        w.calls.push('create_poi')
        return w.createFails
          ? { status: 'failed', reason: 'create_failed', attractionId: null }
          : { status: 'created', attractionId: POI }
      },
      applyPlacePrefill: async (id: string, _p: unknown, clientId: string) => {
        w.calls.push(`apply:${id}:${clientId}`)
        w.poiClient = clientId // the link is the first write of applyPlacePrefill
        if (w.applyFails) return { status: 'failed', reason: w.applyFails, attractionId: id }
        return { status: 'created', attractionId: id }
      },
    },
  })
  mock.module('@/lib/services/partner-proposal-admin-service', {
    namedExports: {
      findClientByTaxId: async () => {
        w.calls.push('find_client_by_tax_id')
        return null
      },
      createPromotedClient: async (updates: Record<string, unknown>) => {
        w.calls.push('create_client')
        w.clientInsert = updates
        return { ok: true, clientId: CLIENT, created: true }
      },
    },
  })
  mock.module('@/lib/services/client-service', {
    namedExports: {
      ClientService: {
        approveClient: async (...args: unknown[]) => {
          w.calls.push('approve_client')
          if (w.approveFails) throw new Error('cms user insert failed')
          w.approvedWith = args
          return { id: args[0], status: 'approved' }
        },
      },
    },
  })
  mod = await import('@/lib/services/portal-validation-service')
})

beforeEach(() => reset())

test('BR-B2B-049 item 7: claim → POI → attraction_id → client → link/details/coordinate → approved', async () => {
  const out = await mod.approvePortalSubmission(SUB, operator, 'op', CMS_OP, NOW)
  assert.deepEqual(out, { ok: true, status: 'approved', attractionId: POI, clientId: CLIENT })
  assert.deepEqual(w.calls, [
    'claim',
    'or:approval_claimed_at.is.null,approval_claimed_at.lt.2026-10-04T11:59:00.000Z',
    'create_poi',
    'write_attraction_id',
    'create_client',
    `apply:${POI}:${CLIENT}`,
    'approve_client',
    'transition:approved',
  ])
})

test('#872 · BR-MONETIZACAO-027: the approval approves the client with the record\'s own function — status and CMS user, before the transition', async () => {
  await mod.approvePortalSubmission(SUB, operator, 'op', CMS_OP, NOW)
  assert.deepEqual(w.approvedWith, [CLIENT, CMS_OP, 'dono@bardoze.com.br', 'Bar do Zé'])
  assert.ok(w.calls.indexOf('approve_client') < w.calls.indexOf('transition:approved'))
})

test('#872: the client approval failing → 503, claim released, NOT approved; the retry converges', async () => {
  reset({ approveFails: true })
  const out = await mod.approvePortalSubmission(SUB, operator, 'op', CMS_OP, NOW)
  assert.deepEqual(out, { ok: false, httpStatus: 503, error: 'client_approval_failed', attractionId: POI })
  assert.ok(!w.calls.includes('transition:approved'))
  assert.equal(w.calls[w.calls.length - 1], 'release')

  w.approveFails = false
  w.calls = []
  const retry = await mod.approvePortalSubmission(SUB, operator, 'op', CMS_OP, NOW)
  assert.equal(retry.ok, true)
  assert.ok(!w.calls.includes('create_poi') && !w.calls.includes('create_client'))
  assert.deepEqual(w.calls.slice(-2), ['approve_client', 'transition:approved'])
})

test('#812 security: a submission without tax_id does not look a client up by CNPJ, and gets one client', async () => {
  await mod.approvePortalSubmission(SUB, operator, 'op', CMS_OP, NOW)
  assert.ok(!w.calls.includes('find_client_by_tax_id'))
  assert.equal(w.calls.filter((c) => c === 'create_client').length, 1)
})

test('#812 security: a second concurrent approval finds the claim taken — 409, nothing created', async () => {
  reset({ claimRows: 0 })
  const out = await mod.approvePortalSubmission(SUB, operator, 'op', CMS_OP, NOW)
  assert.deepEqual(out, { ok: false, httpStatus: 409, error: 'approval_in_progress' })
  assert.deepEqual(w.calls.filter((c) => !c.startsWith('or:')), ['claim'])
})

test('#812 security: a claim that cannot be written fails closed — 503, nothing created', async () => {
  reset({ claimError: true })
  const out = await mod.approvePortalSubmission(SUB, operator, 'op', CMS_OP, NOW)
  assert.deepEqual(out, { ok: false, httpStatus: 503, error: 'claim_failed' })
  assert.ok(!w.calls.includes('create_poi'))
})

test('BR-B2B-049 item 7: details failing after attraction_id is written → 503, claim released, NOT approved', async () => {
  reset({ applyFails: 'details_failed' })
  const out = await mod.approvePortalSubmission(SUB, operator, 'op', CMS_OP, NOW)
  assert.deepEqual(out, { ok: false, httpStatus: 503, error: 'details_failed', attractionId: POI })
  assert.ok(!w.calls.includes('transition:approved'))
  assert.equal(w.calls[w.calls.length - 1], 'release')
})

test('BR-B2B-049 item 7: the retry re-applies details and coordinate on the existing POI — no second POI, no second client', async () => {
  // first attempt: POI + client linked, coordinate failed
  reset({ applyFails: 'coordinate_failed' })
  await mod.approvePortalSubmission(SUB, operator, 'op', CMS_OP, NOW)
  w.applyFails = false
  w.calls = []

  const out = await mod.approvePortalSubmission(SUB, operator, 'op', CMS_OP, NOW)
  assert.deepEqual(out, { ok: true, status: 'approved', attractionId: POI, clientId: CLIENT })
  assert.ok(!w.calls.includes('create_poi'), 'second POI created')
  assert.ok(!w.calls.includes('create_client'), 'second client created')
  assert.ok(w.calls.includes(`apply:${POI}:${CLIENT}`), 'details/coordinate not re-applied')
})

test('BR-B2B-049 item 7: a retry after the POI row but before the client resolves the client, then applies', async () => {
  reset({ submission: { id: SUB, status: 'in_review', answers: ANSWERS, attraction_id: POI } })
  const out = await mod.approvePortalSubmission(SUB, operator, 'op', CMS_OP, NOW)
  assert.equal(out.ok, true)
  assert.deepEqual(w.calls.filter((c) => !c.startsWith('or:')), [
    'claim',
    'create_client',
    `apply:${POI}:${CLIENT}`,
    'approve_client',
    'transition:approved',
  ])
})

test('#812: the POI row failing → 503, nothing linked, claim released', async () => {
  reset({ createFails: true })
  const out = await mod.approvePortalSubmission(SUB, operator, 'op', CMS_OP, NOW)
  assert.deepEqual(out, { ok: false, httpStatus: 503, error: 'create_failed', attractionId: null })
  assert.ok(!w.calls.includes('write_attraction_id'))
  assert.equal(w.calls[w.calls.length - 1], 'release')
})

test('#812: not in_review → 409 before any claim', async () => {
  reset({ submission: { id: SUB, status: 'approved', answers: ANSWERS, attraction_id: POI } })
  const out = await mod.approvePortalSubmission(SUB, operator, 'op', CMS_OP, NOW)
  assert.deepEqual(out, { ok: false, httpStatus: 409, error: 'status_conflict' })
  assert.deepEqual(w.calls, [])
})

test('#812: the approval claim expires in 60 s, so a request that died does not lock the submission', () => {
  assert.equal(mod.PORTAL_APPROVAL_CLAIM_TTL_MS, 60_000)
  assert.equal(mod.approvalClaimFilter(NOW), 'approval_claimed_at.is.null,approval_claimed_at.lt.2026-10-04T11:59:00.000Z')
})

test('BR-B2B-049 item 7: the new client carries the acceptance e-mail — the portal never asks representative_email, and partner.clients.email is NOT NULL', async () => {
  const out = await mod.approvePortalSubmission(SUB, operator, 'op', CMS_OP, NOW)
  assert.equal(out.ok, true)
  assert.equal(w.clientInsert?.email, 'dono@bardoze.com.br')
})

test('BR-B2B-049 item 7: no acceptance e-mail → 503 with the POI, no client created, NOT approved', async () => {
  reset({ acceptanceEmail: null })
  const out = await mod.approvePortalSubmission(SUB, operator, 'op', CMS_OP, NOW)
  assert.deepEqual(out, { ok: false, httpStatus: 503, error: 'lookup_failed', attractionId: POI })
  assert.ok(!w.calls.includes('create_client'))
  assert.ok(!w.calls.includes('transition:approved'))
})
