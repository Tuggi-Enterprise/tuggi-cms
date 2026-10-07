/**
 * #888 end to end through the portal's approval: `approvePortalSubmission` → REAL
 * `applyPrefillDescription` → REAL `applyPartnerPlaceDescription` → a stateful fake of
 * `core.attraction_descriptions` (`setup/fake-description-db.ts`). What is faked: the database, and
 * the POI/client writes that have their own specs (`portal-approval-retry.test.ts`). Nothing here
 * touches a real database.
 *
 * Rules: BR-B2B-016 (tier → description), BR-B2B-018 (born text-only, unapproved, no audio),
 * BR-B2B-025 (the establishment's own story, not rewritten).
 *
 * Run with: npm run test:api
 */

import { test, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { createDescriptionOperator, freshDescWorld, type DescWorld } from './setup/fake-description-db'

const SUB = '11111111-1111-4111-8111-111111111111'
const POI = '22222222-2222-4222-8222-222222222222'
const CLIENT = '33333333-3333-4333-8333-333333333333'
const CMS_OP = '44444444-4444-4444-8444-444444444444'
const NOW = new Date('2026-10-06T12:00:00.000Z')
const STORY = 'Meu avô Aurélio abriu o bar em 1962, no galpão do antigo mercado de peixe.'

const ANSWERS = {
  trade_name: 'Bar do Zé',
  category: 'bar_cafe',
  city: 'Búzios',
  state: 'RJ',
  district: 'Centro',
  address_street: 'Rua das Pedras',
  offer_free: '10% de desconto',
  story_script: `  ${STORY}  `,
}

let d: DescWorld
let planChoice: string | null
let released: boolean
let transitioned: string[]
let operator: any

function reset(over: { story?: string | null; plan?: string | null; desc?: Partial<DescWorld> } = {}) {
  d = freshDescWorld({ partnerClientId: null, ...over.desc })
  planChoice = over.plan === undefined ? 'map_and_description' : over.plan
  released = false
  transitioned = []
  answers = { ...ANSWERS }
  if (over.story === null) delete (answers as any).story_script
  else if (over.story !== undefined) (answers as any).story_script = over.story
  operator = createDescriptionOperator(d, () => {
    const q: any = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => ({ data: { partner_client_id: d.partnerClientId }, error: null }),
    }
    return q
  })
}
let answers: Record<string, unknown> = ANSWERS

function submissionsTable() {
  let update: Record<string, unknown> | null = null
  const q: any = {
    select: () => q,
    eq: () => q,
    or: () => q,
    update: (values: Record<string, unknown>) => {
      update = values
      if ('approval_claimed_at' in values && !values.approval_claimed_at) released = true
      return q
    },
    maybeSingle: async () => ({ data: { id: SUB, status: 'in_review', answers, attraction_id: POI }, error: null }),
    then: (resolve: (v: unknown) => unknown) =>
      resolve(
        update && 'approval_claimed_at' in update && update.approval_claimed_at
          ? { data: [{ id: SUB }], error: null }
          : { data: null, error: null }
      ),
  }
  return q
}

const service = {
  schema: () => ({
    from: (table: string) => {
      if (table === 'place_acceptances') {
        const q: any = {
          select: () => q,
          eq: () => q,
          maybeSingle: async () => ({ data: { email: 'dono@bardoze.com.br', plan_choice: planChoice }, error: null }),
        }
        return q
      }
      if (table === 'clients') {
        const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { email: 'x', name: 'Bar do Zé' }, error: null }) }
        return q
      }
      return submissionsTable()
    },
    rpc: async (_n: string, args: Record<string, unknown>) => {
      transitioned.push(String(args.p_to))
      return { data: args.p_to, error: null }
    },
  }),
}

let mod: typeof import('@/lib/services/portal-validation-service')

before(async () => {
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseService: () => ({ ...service, auth: { admin: { getUserById: async () => ({ data: null, error: null }) } } }),
    },
  })
  // The REAL description step; only the POI create/link writes are faked.
  const real = await import('@/lib/services/partner-place-provisioning')
  mock.module('@/lib/services/partner-place-provisioning', {
    namedExports: {
      createPrefilledPlace: async () => ({ status: 'created', attractionId: POI }),
      applyPlacePrefill: async (id: string, _p: unknown, clientId: string) => {
        d.partnerClientId = clientId // the link is what lets the policy see a partner
        return { status: 'created', attractionId: id }
      },
      applyPrefillDescription: real.applyPrefillDescription,
    },
  })
  mock.module('@/lib/services/partner-proposal-admin-service', {
    namedExports: {
      findClientByTaxId: async () => null,
      createPromotedClient: async () => ({ ok: true, clientId: CLIENT, created: true }),
    },
  })
  mock.module('@/lib/services/client-service', {
    namedExports: { ClientService: { approveClient: async (...a: unknown[]) => ({ id: a[0], status: 'approved' }) } },
  })
  mod = await import('@/lib/services/portal-validation-service')
})

beforeEach(() => reset())

const approve = () => mod.approvePortalSubmission(SUB, operator, 'op', CMS_OP, NOW)

test('BR-B2B-016 item 1 · BR-B2B-025 · BR-B2B-018 · the portal-paid approval leaves the trimmed story as the pt-br description, no audio', async () => {
  const out = await approve()
  assert.deepEqual(out, { ok: true, status: 'approved', attractionId: POI, clientId: CLIENT })
  assert.equal(d.row?.description, STORY)
  assert.deepEqual(d.row?.generation_meta, { kind: 'partner_story_script' })
  assert.equal(d.row?.audio_url, null)
  assert.equal(d.row?.language, 'pt-br')
  assert.equal(d.row?.gender, 'male')
})

test('BR-B2B-016 item 9 · BR-B2B-018 · the free approval (map_only) leaves the name, kind partner_name_only', async () => {
  reset({ plan: 'map_only' })
  const out = await approve()
  assert.equal(out.ok, true)
  assert.equal(d.row?.description, 'Bar do Zé')
  assert.deepEqual(d.row?.generation_meta, { kind: 'partner_name_only' })
  assert.equal(d.rpcs.filter((r) => r.name === 'cms_apply_name_only_description').length, 1)
})

test('BR-B2B-016 item 1 · approving a paid acceptance with no story_script writes nothing and still approves (the studio produces it)', async () => {
  reset({ story: null })
  const out = await approve()
  assert.equal(out.ok, true)
  assert.equal(d.row, null)
  assert.equal(d.writes.length, 0)
})

test('BR-B2B-016 5th edge case · approving twice (retry) leaves ONE description and no duplicate write', async () => {
  await approve()
  const writes = d.writes.length
  const row = JSON.stringify(d.row)
  const out = await approve()
  assert.equal(out.ok, true)
  assert.equal(JSON.stringify(d.row), row)
  assert.equal(d.writes.length, writes)
})

test("BR-B2B-016 5th edge case · the operator's edit between the two approvals survives the retry, and the retry still approves", async () => {
  await approve()
  d.row = { description: 'Texto do curador.', audio_url: null, generation_meta: { kind: 'operator_edit' } }
  const out = await approve()
  assert.equal(out.ok, true, 'blocked is not a failure')
  assert.equal(d.row?.description, 'Texto do curador.')
})

test('BR-B2B-016 · the RPC erroring on the free tier → 503 description_failed with the POI, claim released, NOT approved', async () => {
  reset({ plan: 'map_only', desc: { failAt: 'name_only' } })
  const out = await approve()
  assert.deepEqual(out, { ok: false, httpStatus: 503, error: 'description_failed', attractionId: POI })
  assert.equal(released, true)
  assert.ok(!transitioned.includes('approved'))
})

test('BR-B2B-016 · the insert erroring on the paid tier → 503 description_failed, claim released, NOT approved; the retry then converges', async () => {
  reset({ desc: { failAt: 'upsert' } })
  const out = await approve()
  assert.deepEqual(out, { ok: false, httpStatus: 503, error: 'description_failed', attractionId: POI })
  assert.equal(released, true)
  assert.ok(!transitioned.includes('approved'))
  d.failAt = null
  const retry = await approve()
  assert.equal(retry.ok, true)
  assert.equal(d.row?.description, STORY)
})
