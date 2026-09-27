import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { landmarkCellOf, selectSpacedTriggerPoints } from '@/lib/services/trigger-points-google/utils/tp-selection'
import { sampleFarBySectorAndRing } from '@/lib/services/trigger-points-google/analyzers/point-calculator'
import { CLASS_LIMITS, VisibilityClass } from '@/lib/services/trigger-points-google/config/visibility-class'
import { buildClassification } from '@/lib/services/trigger-points-google/services/poi-classifier.service'

// TP engine (#772) — E10 (selection) of a landmark_high. Source: docs/arquitetura/cms/motor-de-tp.md.

const PIN = { lat: -22.95, lng: -43.21 }
const M_LAT = 110_540
const M_LNG = 111_320 * Math.cos((PIN.lat * Math.PI) / 180)
const polar = (bearingDeg: number, m: number) => {
  const r = (bearingDeg * Math.PI) / 180
  return { lat: PIN.lat + (Math.cos(r) * m) / M_LAT, lng: PIN.lng + (Math.sin(r) * m) / M_LNG }
}
let seq = 0
const tp = (bearingDeg: number, m: number, type: string, quality = 0.6) => ({
  id: `t${seq++}`, location: polar(bearingDeg, m), distance: m, radius: 50, quality,
  expectedBearing: (bearingDeg + 180) % 360, street: { type } as any,
}) as any

const landmark = buildClassification(VisibilityClass.LANDMARK_HIGH, { heightM: 30, prominenceM: 700, areaM2: 8000 })
const cellKey = (t: any) => { const c = landmarkCellOf(t, PIN); return `${c.ring}:${c.sector}` }

describe('INV-E10a, INV-E10c, BR-AUDIO-010 — landmark_high selects by cell coverage', () => {
  it('one TP per cell before any second: 12 forest candidates do not take the slot of Botafogo or Copacabana', () => {
    // forest: 12 candidates at 600–1,700 m in the west sector, better quality (closer)
    const forest = Array.from({ length: 12 }, (_, i) => tp(275 + (i % 3) * 5, 600 + i * 100, 'tertiary', 0.9))
    const botafogo = tp(100, 2_800, 'secondary', 0.4)
    const copacabana = tp(125, 4_000, 'primary', 0.4)
    const out = selectSpacedTriggerPoints([...forest, botafogo, copacabana], landmark, PIN)
    const ids = out.map(t => t.id)
    assert.ok(ids.includes(botafogo.id) && ids.includes(copacabana.id), ids.join(','))
    // every covered cell has 1 TP before any cell has 2
    const perCell = new Map<string, number>()
    for (const t of out) perCell.set(cellKey(t), (perCell.get(cellKey(t)) ?? 0) + 1)
    const covered = new Set([...forest, botafogo, copacabana].map(cellKey))
    assert.equal(perCell.size, covered.size)
  })

  it('inside the cell the street where the tourist circulates wins; track, path and service lose', () => {
    const avoid = ['track', 'service', 'path'].map((t, i) => tp(130, 2_400 + i * 20, t, 0.95))
    const orla = tp(130, 2_700, 'primary', 0.3)
    const why = new Map()
    const out = selectSpacedTriggerPoints([...avoid, orla], { ...landmark, maxFarTriggerPoints: 1 }, PIN, why)
    assert.deepEqual(out.map(t => t.id), [orla.id])
    assert.match(why.get(orla), /cell s2\/r2; tier 0 primary; won pass 1/)
    assert.match(why.get(avoid[0]), /tier 2 track; lost: cap/)
  })

  it('BR-POI-008: the app is used driving — trunk and motorway are tourist streets, not demoted', () => {
    const trunk = tp(130, 2_400, 'trunk', 0.9)
    const motorway = tp(170, 2_400, 'motorway', 0.9)
    const orla = tp(130, 2_700, 'primary', 0.3)
    const why = new Map()
    const out = selectSpacedTriggerPoints([trunk, orla], { ...landmark, maxFarTriggerPoints: 1 }, PIN, why)
    assert.deepEqual(out.map(t => t.id), [trunk.id], 'same tier: quality decides')
    assert.match(why.get(trunk), /tier 0 trunk; won pass 1/)
    selectSpacedTriggerPoints([motorway], landmark, PIN, why)
    assert.match(why.get(motorway), /tier 0 motorway/)
  })

  it('a forest track only gets in when its cell has no other street', () => {
    const track = tp(90, 3_000, 'track', 0.9)
    assert.equal(selectSpacedTriggerPoints([track], landmark, PIN).length, 1)
  })

  it('the horizon ring (beyond the last inner ring) takes a tourist street only, and only after the inner cells', () => {
    const bridge = tp(90, 12_000, 'motorway', 0.9) // the Rio–Niterói bridge seen from the Pão de Açúcar
    const island = tp(170, 12_000, 'footway', 0.9)
    const farSide = tp(60, 8_000, 'primary', 0.9)
    const ipanema = [tp(80, 2_500, 'primary', 0.5), tp(84, 3_500, 'primary', 0.5)] // same inner cell
    const why = new Map()
    const out = selectSpacedTriggerPoints([bridge, island, farSide, ...ipanema], { ...landmark, maxFarTriggerPoints: 2 }, PIN, why)
    assert.deepEqual(out.map(t => t.id).sort(), ipanema.map(t => t.id).sort())
    assert.match(why.get(bridge), /lost: cap/)
    assert.match(why.get(island), /lost: horizon needs a tourist street/)
    assert.match(why.get(farSide), /lost: cap/)
    assert.match(why.get(ipanema[1]), /won pass 2/)
    const roomy = new Map()
    const all = selectSpacedTriggerPoints([bridge, island, farSide, ...ipanema], { ...landmark, maxFarTriggerPoints: 5 }, PIN, roomy)
    assert.ok(all.includes(bridge), 'with room, the bridge comes back in the horizon')
    assert.match(roomy.get(bridge), /won pass 1 \(horizon\)/)
    assert.match(roomy.get(island), /lost: horizon needs a tourist street/)
  })

  it('the cap is the class one, and the minimum spacing still holds (INV-E10b)', () => {
    const pool = Array.from({ length: 8 }, (_, s) =>
      [500, 2_000, 4_500, 9_000].flatMap(m => [tp(s * 45 + 10, m, 'secondary'), tp(s * 45 + 11, m + 5, 'secondary')])).flat()
    const out = selectSpacedTriggerPoints(pool, landmark, PIN)
    const lim = CLASS_LIMITS[VisibilityClass.LANDMARK_HIGH]
    assert.ok(out.length <= lim.maxTPs + lim.maxFarTPs)
    assert.ok(out.length >= 16, `${out.length}`)
    const apart = (a: any, b: any) => Math.hypot((a.location.lat - b.location.lat) * M_LAT, (a.location.lng - b.location.lng) * M_LNG)
    for (const a of out) for (const b of out) if (a !== b) assert.ok(apart(a, b) >= landmark.minDistanceBetweenTPs, `${apart(a, b)}`)
  })

  it('the trace gives the cell and the reason of every candidate', () => {
    const a = tp(10, 1_400, 'secondary'); const b = tp(12, 1_450, 'residential')
    const why = new Map()
    selectSpacedTriggerPoints([a, b], landmark, PIN, why)
    assert.match(why.get(a), /cell s0\/r1; tier 0 secondary; won pass 1/)
    assert.match(why.get(b), /cell s0\/r1; tier 1 residential; lost: spacing/)
  })

  it('INV-E7c: the cell sample keeps the tourist street, not only the forest tracks', () => {
    const cand = (bearing: number, m: number, type: string, quality: number) =>
      ({ location: polar(bearing, m), distance: m, quality, expectedBearing: 0, confidence: 0.85, street: { type } as any })
    const trunks = Array.from({ length: 10 }, (_, i) => cand(100, 2_100 + i * 400, 'track', 0.9))
    const avenue = cand(100, 3_000, 'secondary', 0.5)
    const out = sampleFarBySectorAndRing([...trunks, avenue] as any, PIN)
    assert.ok(out.includes(avenue as any))
  })
})
