import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  dedupeSamePoiTriggerPoints,
  dropGeneratedDuplicates,
  isReplaceSurvivor,
  type SamePoiTp,
} from '@/lib/services/trigger-points-google/utils/same-poi-dedupe'

// Same-POI duplicate TPs (BR-POI-009, operator 2026-10-07): a centre inside the other's radius is
// the same spot; one rule decides which stays — human-approved, then larger radius, then newer, then id.

const PIN = { lat: 38.7, lng: -9.14 }
const M_LAT = 110_540
const M_LNG = 111_320 * Math.cos((PIN.lat * Math.PI) / 180)
const east = (m: number) => ({ lat: PIN.lat, lng: PIN.lng + m / M_LNG })
const north = (m: number) => ({ lat: PIN.lat + m / M_LAT, lng: PIN.lng })

const tp = (id: string, location: { lat: number; lng: number }, radius: number, extra: Partial<SamePoiTp> = {}): SamePoiTp =>
  ({ id, poiId: 'poi-a', location, radius, humanApproved: false, recency: 0, ...extra })
const ids = (xs: SamePoiTp[]) => xs.map(x => x.id).sort()

describe('dedupeSamePoiTriggerPoints (BR-POI-009)', () => {
  it('BR-POI-009: concentric pair with different radii keeps the larger one', () => {
    const r = dedupeSamePoiTriggerPoints([tp('small', PIN, 20), tp('large', PIN, 50)])
    assert.deepEqual(ids(r.kept), ['large'])
    assert.equal(r.dropped[0].tp.id, 'small')
    assert.equal(r.dropped[0].duplicateOf.id, 'large')
  })

  it('BR-POI-009: a human-approved TP beats a larger radius', () => {
    const r = dedupeSamePoiTriggerPoints([tp('engine', east(10), 50), tp('curator', PIN, 15, { humanApproved: true })])
    assert.deepEqual(ids(r.kept), ['curator'])
  })

  it('BR-POI-009: the larger radius counts — the small circle need not contain the other centre', () => {
    // 30 m apart: outside the 10 m circle, inside the 40 m one
    const r = dedupeSamePoiTriggerPoints([tp('r10', PIN, 10), tp('r40', east(30), 40)])
    assert.deepEqual(ids(r.kept), ['r40'])
  })

  it('BR-POI-009: same radius → the newer stays; same age → the lower id (deterministic)', () => {
    assert.deepEqual(ids(dedupeSamePoiTriggerPoints([tp('old', PIN, 30, { recency: 1 }), tp('new', east(5), 30, { recency: 2 })]).kept), ['new'])
    assert.deepEqual(ids(dedupeSamePoiTriggerPoints([tp('b', PIN, 30), tp('a', east(5), 30)]).kept), ['a'])
  })

  it('BR-POI-009: a chain of three resolves greedily — the third is kept once its only neighbour is gone', () => {
    // A(50) at 0 · B(30) at 40 m · C(30) at 80 m. A drops B; C is 80 m from A (> 50) and B is gone.
    const r = dedupeSamePoiTriggerPoints([tp('C', east(80), 30), tp('B', east(40), 30), tp('A', PIN, 50)])
    assert.deepEqual(ids(r.kept), ['A', 'C'])
    assert.deepEqual(r.dropped.map(d => [d.tp.id, d.duplicateOf.id]), [['B', 'A']])
  })

  it('BR-POI-009: TPs of different POIs never compare', () => {
    const r = dedupeSamePoiTriggerPoints([tp('a', PIN, 50), tp('b', PIN, 50, { poiId: 'poi-b' })])
    assert.equal(r.kept.length, 2)
  })

  it('BR-POI-009: TPs farther apart than the larger radius all stay', () => {
    const r = dedupeSamePoiTriggerPoints([tp('a', PIN, 30), tp('b', east(31), 30), tp('c', north(60), 25)])
    assert.equal(r.kept.length, 3)
    assert.equal(r.dropped.length, 0)
  })
})

describe('dropGeneratedDuplicates — the save side (BR-POI-009)', () => {
  it('BR-POI-009: a generated TP on a curator survivor is not written; a free one is', () => {
    const survivor = tp('curator', PIN, 20, { humanApproved: true })
    const r = dropGeneratedDuplicates([tp('g1', east(5), 50, { recency: 9 }), tp('g2', east(200), 30, { recency: 9 })], [survivor])
    assert.deepEqual(ids(r.kept), ['g2'])
    assert.deepEqual(r.dropped.map(d => d.reason), ['duplicate_of:curator'])
    assert.equal(r.outrankedSurvivors.length, 0)
  })

  it('BR-POI-009: a generated TP that outranks an unapproved survivor is written; the survivor is reported, not removed', () => {
    const survivor = tp('google', PIN, 20, { recency: 1 })
    const r = dropGeneratedDuplicates([tp('g1', east(5), 50, { recency: 9 })], [survivor])
    assert.deepEqual(ids(r.kept), ['g1'])
    assert.deepEqual(ids(r.outrankedSurvivors), ['google'])
  })

  it('BR-POI-009: two generated TPs on the same spot leave one', () => {
    const r = dropGeneratedDuplicates([tp('g1', PIN, 30, { recency: 9 }), tp('g2', east(10), 50, { recency: 9 })], [])
    assert.deepEqual(ids(r.kept), ['g2'])
    assert.deepEqual(r.dropped.map(d => d.reason), ['duplicate_of:g2'])
  })
})

describe('isReplaceSurvivor — the replace_trigger_points_atomic predicate (#776)', () => {
  it('keeps manual and CMS-edited rows, replaces every other engine row', () => {
    assert.equal(isReplaceSurvivor({ generation_method: 'manual', updated_by: null }), true)
    assert.equal(isReplaceSurvivor({ generation_method: 'google_apis', updated_by: 'u1' }), true)
    assert.equal(isReplaceSurvivor({ generation_method: 'google_apis', updated_by: null }), false)
    assert.equal(isReplaceSurvivor({ generation_method: 'local_osm|dem=x', updated_by: null }), false)
    assert.equal(isReplaceSurvivor({ generation_method: null, updated_by: null }), false)
  })
})
