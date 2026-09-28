import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isObserverWay } from '@/lib/services/trigger-points-google/analyzers/street-analyzer'
import { sampleFarBySectorAndRing } from '@/lib/services/trigger-points-google/analyzers/point-calculator'
import { selectSpacedTriggerPoints } from '@/lib/services/trigger-points-google/utils/tp-selection'
import { VisibilityClass, landmarkStreetTier, observerPath } from '@/lib/services/trigger-points-google/config/visibility-class'
import { buildClassification } from '@/lib/services/trigger-points-google/services/poi-classifier.service'

// TP engine (#786) — the train and the ferry as observer paths (INV-E7a, 1C) and as tourist
// ways in the landmark cell (INV-E10a). Source: docs/arquitetura/cms/motor-de-tp.md.

const PIN = { lat: -22.9, lng: -43.2 }
const M_LAT = 110_540
const M_LNG = 111_320 * Math.cos((PIN.lat * Math.PI) / 180)
const polar = (bearingDeg: number, m: number) => {
  const r = (bearingDeg * Math.PI) / 180
  return { lat: PIN.lat + (Math.cos(r) * m) / M_LAT, lng: PIN.lng + (Math.sin(r) * m) / M_LNG }
}
let seq = 0
const tp = (bearingDeg: number, m: number, type: string, quality = 0.6) => ({
  id: `t${seq++}`, location: polar(bearingDeg, m), distance: m, radius: 50, quality, confidence: 0.85,
  expectedBearing: (bearingDeg + 180) % 360, street: { type } as any,
}) as any

describe('INV-E7a, BR-AUDIO-010 — the surface train and the ferry are observer paths', () => {
  it('rail, light rail, subway, tram and the ferry route are ways the TP may stand on', () => {
    for (const type of ['railway_rail', 'railway_light_rail', 'railway_subway', 'railway_tram', 'ferry']) {
      assert.equal(isObserverWay({ type, tags: {} }), true, type)
    }
  })

  it('underground is not: tunnel=yes, covered, or a railway with layer<0 and no tunnel tag (Rio metro)', () => {
    assert.equal(isObserverWay({ type: 'railway_subway', tags: { tunnel: 'yes', layer: '-2' } }), false)
    assert.equal(isObserverWay({ type: 'railway_subway', tags: { layer: '-1' } }), false)
    assert.equal(isObserverWay({ type: 'railway_rail', tags: { covered: 'yes' } }), false)
    assert.equal(isObserverWay({ type: 'railway_rail', tags: { layer: '1', bridge: 'yes' } }), true, 'the viaduct is above ground')
    assert.equal(isObserverWay({ type: 'primary', tags: { layer: '-1' } }), true, 'a street keeps its old rule: only the tunnel tag')
  })

  it('a yard or spur track carries no passenger (OSM service=yard|spur): not an observer path; a siding still is (Museu do Amanhã)', () => {
    assert.equal(isObserverWay({ type: 'railway_rail', tags: { service: 'yard' } }), false)
    assert.equal(isObserverWay({ type: 'railway_tram', tags: { service: 'yard' } }), false)
    assert.equal(isObserverWay({ type: 'railway_rail', tags: { service: 'spur' } }), false)
    assert.equal(isObserverWay({ type: 'railway_rail', tags: { service: 'siding' } }), true)
    assert.equal(isObserverWay({ type: 'residential', tags: { service: 'yard' } }), true, 'a street is not a track')
  })

  it('INV-E10a: the train and the ferry are tourist ways (tier 0), not trails', () => {
    for (const type of ['railway_rail', 'railway_subway', 'ferry']) {
      assert.equal(landmarkStreetTier(type), 0, type)
      assert.equal(observerPath(type), 'ride', type)
    }
    assert.equal(observerPath('primary'), 'street')
    assert.equal(landmarkStreetTier('path'), 2)
  })

  it('far sample: a train candidate 150 m from an avenue candidate in the same cell keeps its place (Nilton Santos)', () => {
    const avenue = tp(170, 1_500, 'primary', 0.9)
    const rail = { ...tp(170, 1_500, 'railway_rail', 0.5), location: polar(176, 1_500) }
    const road2 = { ...tp(170, 1_500, 'secondary', 0.5), location: polar(176, 1_500) }
    const out = sampleFarBySectorAndRing([avenue, rail] as any, PIN)
    assert.ok(out.includes(rail), 'the rider is not the driver beside the line')
    const streets = sampleFarBySectorAndRing([avenue, road2] as any, PIN)
    assert.ok(!streets.includes(road2), 'two streets still keep the cell spacing')
  })
})

describe('INV-E10a, BR-AUDIO-010 — a landmark_high takes the ferry across the bay in the horizon', () => {
  const landmark = buildClassification(VisibilityClass.LANDMARK_HIGH, { heightM: 30, prominenceM: 300, areaM2: 8000 })

  it('the ferry cell of the horizon goes with the inner cells: it beats a second TP in an inner cell (Pão de Açúcar)', () => {
    const inner = [tp(200, 1_500, 'primary', 0.9), tp(200, 1_950, 'primary', 0.8)]
    const ferry = tp(20, 4_600, 'ferry', 0.3)
    const why = new Map()
    const out = selectSpacedTriggerPoints([...inner, ferry], { ...landmark, maxFarTriggerPoints: 2 }, PIN, why)
    assert.deepEqual(out.map(t => t.id).sort(), [inner[0].id, ferry.id].sort())
    assert.match(why.get(ferry), /tier 0 ferry; won pass 1/)
  })

  it('a far street of the horizon still waits for every inner cell', () => {
    const inner = [tp(200, 1_500, 'primary', 0.9), tp(200, 1_950, 'primary', 0.8)]
    const farStreet = tp(20, 4_600, 'motorway', 0.9)
    const out = selectSpacedTriggerPoints([...inner, farStreet], { ...landmark, maxFarTriggerPoints: 2 }, PIN)
    assert.ok(!out.includes(farStreet))
  })
})
