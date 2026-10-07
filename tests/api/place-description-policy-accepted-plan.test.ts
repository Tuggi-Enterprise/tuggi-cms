/**
 * #889 — `loadPlaceDescriptionPolicy` reads `accepted_plan_choice` from the facts RPC
 * (migration 20261006250000, optional: column absent = null) — BR-B2B-019 items 5-6 (what the
 * partner accepted is what the place carries) over BR-B2B-016 (free tier = the name).
 *
 * The real service runs; only the RPC answer is faked. No database is reached.
 *
 * Run with: npm run test:api
 */

import { test, before, mock } from 'node:test'
import assert from 'node:assert/strict'

let svc: typeof import('@/lib/services/place-description-policy-service')

before(async () => {
  mock.module('@/lib/core/supabase-client', {
    namedExports: { getSupabaseService: () => ({ auth: { admin: { getUserById: async () => ({ data: null, error: null }) } } }) },
  })
  svc = await import('@/lib/services/place-description-policy-service')
})

const POI = '22222222-2222-4222-8222-222222222222'

function db(extra: Record<string, unknown>) {
  const row = {
    attraction_id: POI,
    name: 'Bar do Zé',
    city: 'Gramado',
    entity_kind: 'restaurant',
    partner_client_id: 'c1',
    base_description: null,
    base_has_audio: null,
    base_generation_kind: null,
    proposal_answers: null,
    ...extra,
  }
  return { schema: () => ({ rpc: async () => ({ data: [row], error: null }) }) } as never
}

test('BR-B2B-019 · column absent (migration not applied): reads as no acceptance, not as a failure', async () => {
  const v = await svc.loadPlaceDescriptionPolicy(POI, db({}))
  assert.ok(v)
  assert.equal(v.decision.policy, 'name_only')
})

test('BR-B2B-019 · accepted_plan_choice = map_and_description: policy partner_story (paid_tier)', async () => {
  const v = await svc.loadPlaceDescriptionPolicy(POI, db({ accepted_plan_choice: 'map_and_description' }))
  assert.equal(v?.decision.policy, 'partner_story')
  assert.equal(v?.decision.reason, 'paid_tier')
})

test('BR-B2B-019 · accepted_plan_choice = map_only / null / unknown value: null, stays name_only', async () => {
  for (const val of ['map_only', null, 'platinum', '', 'MAP_AND_DESCRIPTION']) {
    const v = await svc.loadPlaceDescriptionPolicy(POI, db({ accepted_plan_choice: val }))
    assert.equal(v?.decision.policy, 'name_only', JSON.stringify(val))
  }
})

test('BR-B2B-019 · explicit argument wins over the column', async () => {
  const viaArgOverFree = await svc.loadPlaceDescriptionPolicy(POI, db({ accepted_plan_choice: 'map_only' }), 'map_and_description')
  assert.equal(viaArgOverFree?.decision.policy, 'partner_story')
  const argOverColumn = await svc.loadPlaceDescriptionPolicy(POI, db({ accepted_plan_choice: 'map_and_description' }), 'map_only')
  assert.equal(argOverColumn?.decision.policy, 'name_only', 'the explicit free choice is not overridden by the column')
  // The column is only the fallback when the argument is null.
  const colWhenArgNull = await svc.loadPlaceDescriptionPolicy(POI, db({ accepted_plan_choice: 'map_and_description' }), null)
  assert.equal(colWhenArgNull?.decision.policy, 'partner_story')
})
