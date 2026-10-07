/**
 * #885 (cdbe65cd) — `placeService.updateDetails` became `upsertDetails`: `place_details` is written
 * with `upsert(..., { onConflict: 'attraction_id' })` and ONLY the columns of the patch, so a POI the
 * catalogue imported without a details row gets the row, and a POI with one loses nothing outside the
 * patch. Before, the UPDATE matched zero rows, raised no error, and the registration's offer, price
 * band, amenities and tags vanished while the operator was told "success".
 *
 * Rule: BR-B2B-033 item 5 (the registration reaches the POI the client is linked to).
 *
 * Real code: `placeService.upsertDetails`, `applyPlacePrefill` (both modes). Faked: the database
 * (`setup/fake-catalogue-place-db.ts`, which models `place_details` as an UPSERT on `attraction_id`)
 * and, for the call shape, a recording client.
 *
 * NOT PROVEN HERE: the `PlaceFormModal` rendering — the CMS has no jsdom. The modal is held by a
 * source ruler (it calls `upsertDetails`, and nothing calls the removed `updateDetails`).
 *
 * Run with: npm run test:api
 */

import { test, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { buildPlacePrefill } from '@/lib/partner-form/place-prefill'
import type { PartnerAnswers } from '@/lib/partner-form/schema'
import { CLIENT, POI, freshWorld, operatorOf, serviceOf, type World } from './setup/fake-catalogue-place-db'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

let w: World
let svc: typeof import('@/lib/services/partner-place-provisioning')
let placeService: typeof import('@/lib/core/place-service').placeService

const answers = (over: PartnerAnswers = {}): PartnerAnswers => ({
  trade_name: 'BAIRES BISTRO',
  category: 'restaurant',
  address: 'Rua das Pedras',
  city: 'Búzios',
  state: 'RJ',
  lat: '-22.75',
  lng: '-41.88',
  amenities: JSON.stringify(['wifi', 'parking']),
  subtypes: JSON.stringify(['bistro']),
  offer_enabled: 'true',
  offer_free: '10% off',
  price_range: '2',
  ...over,
})

const prefill = () => {
  const p = buildPlacePrefill(answers())
  assert.ok(p)
  return p
}

before(async () => {
  mock.module('next/headers', {
    namedExports: { cookies: async () => ({ get: () => undefined, getAll: () => [] }) },
  })
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseRouteHandler: () => operatorOf(w),
      getSupabaseService: () => serviceOf(w),
      getSupabase: () => serviceOf(w),
      getSupabaseClient: () => ({}),
    },
  })
  mock.module('@/lib/services/audit-service', { namedExports: { logAuditEvent: async () => undefined } })
  svc = await import('@/lib/services/partner-place-provisioning')
  placeService = (await import('@/lib/core/place-service')).placeService
})

beforeEach(() => {
  w = freshWorld()
})

const detailsWrite = () => w.writes.find((x) => x.table === 'place_details')

// ── the call shape ──────────────────────────────────────────────────────────────────────────

test('BR-B2B-033 item 5 · upsertDetails sends ONE upsert on core.place_details, onConflict attraction_id, with only the patch keys', async () => {
  const calls: { schema: string; table: string; row: Record<string, unknown>; opts: unknown }[] = []
  const db: any = {
    schema: (schema: string) => ({
      from: (table: string) => ({
        upsert: async (row: Record<string, unknown>, opts: unknown) => {
          calls.push({ schema, table, row, opts })
          return { error: null }
        },
      }),
    }),
  }

  await placeService.upsertDetails(POI, { app_benefit: '10% off', price_range: 2 }, db)

  assert.equal(calls.length, 1)
  assert.equal(calls[0].schema, 'core')
  assert.equal(calls[0].table, 'place_details')
  assert.deepEqual(calls[0].opts, { onConflict: 'attraction_id' })
  assert.deepEqual(Object.keys(calls[0].row).sort(), ['app_benefit', 'attraction_id', 'price_range'])
  assert.equal(calls[0].row.attraction_id, POI)
})

test('BR-B2B-033 item 5 · upsertDetails with an error from the database throws (the operator is not told "success")', async () => {
  const db: any = { schema: () => ({ from: () => ({ upsert: async () => ({ error: { message: 'rls denied' } }) }) }) }
  await assert.rejects(() => placeService.upsertDetails(POI, { price_range: 2 }, db), /rls denied/)
})

test('BR-B2B-033 item 5 · a patch key can never redirect the write: attraction_id is the argument, not the patch', async () => {
  let row: Record<string, unknown> = {}
  const db: any = { schema: () => ({ from: () => ({ upsert: async (r: Record<string, unknown>) => ((row = r), { error: null }) }) }) }
  await placeService.upsertDetails(POI, { attraction_id: 'other', price_range: 2 }, db)
  assert.equal(row.attraction_id, POI)
})

// ── the effect on the POI ───────────────────────────────────────────────────────────────────

for (const mode of ['replace', 'merge'] as const) {
  test(`BR-B2B-033 item 5 · applyPlacePrefill ${mode}: a POI with NO place_details row gets the row with the offer, price band, amenities and tags`, async () => {
    w.details = null

    const out = await svc.applyPlacePrefill(POI, prefill(), CLIENT, operatorOf(w), mode)

    assert.equal(out.status, 'created', 'applyPlacePrefill reports created in both modes; the caller renames it merged')
    const row = w.details as Record<string, unknown> | null
    assert.ok(row, 'the row exists now (an UPDATE would have matched nothing and created none)')
    assert.ok(row.app_benefit, 'the offer landed')
    assert.equal(row.price_range, 2, 'the price band landed')
    assert.equal(row.has_wifi, true, 'the amenities landed')
    assert.ok(Array.isArray(row.tags) && row.tags.length > 0, 'the tags landed')
    assert.equal(detailsWrite()?.op, 'upsert')
  })

  test(`BR-B2B-033 item 5 · applyPlacePrefill ${mode}: a POI WITH a row keeps cuisine and place_type, and the patch never carries them`, async () => {
    w.details = { tags: ['seafood'], cuisine: ['italiana'], place_type: 'restaurant', notes: 'curador' }

    await svc.applyPlacePrefill(POI, prefill(), CLIENT, operatorOf(w), mode)

    const row = w.details as Record<string, unknown>
    assert.deepEqual(row.cuisine, ['italiana'], 'a column outside the patch is not reset')
    assert.equal(row.place_type, 'restaurant')
    assert.equal(row.notes, 'curador')
    assert.ok(row.app_benefit, 'and the patch did land')
    const sent = detailsWrite()!.patch
    assert.equal('cuisine' in sent, false)
    assert.equal('place_type' in sent, false)
  })
}

// ── the callers ─────────────────────────────────────────────────────────────────────────────

test('BR-B2B-033 item 5 · PlaceFormModal saves the details through upsertDetails, and nothing calls the removed updateDetails (source ruler, no jsdom)', () => {
  const modal = read('components/place-management/PlaceFormModal.tsx')
  assert.match(modal, /placeService\.upsertDetails\(/)
  assert.doesNotMatch(modal, /placeService\.updateDetails/)
  assert.match(read('lib/services/partner-place-provisioning.ts'), /placeService\.upsertDetails\(/)
  assert.doesNotMatch(read('lib/core/place-service.ts'), /async updateDetails\(/)
})
