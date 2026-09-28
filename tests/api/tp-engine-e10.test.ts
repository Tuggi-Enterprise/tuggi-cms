import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { landmarkCellOf, selectSpacedTriggerPoints } from '@/lib/services/trigger-points-google/utils/tp-selection'
import { sampleFarBySectorAndRing } from '@/lib/services/trigger-points-google/analyzers/point-calculator'
import { CLASS_LIMITS, FAR_FINE_SECTOR_DEG, FAR_SECTOR_DEG, VisibilityClass, landmarkSectorOf } from '@/lib/services/trigger-points-google/config/visibility-class'
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
    // beyond 2 km the sector is FAR_FINE_SECTOR_DEG (22.5°): bearing 130 is s5
    assert.match(why.get(orla), /cell s5\/r2; tier 0 primary; won pass 1/)
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

  it('a cell with only a trail comes after the horizon: the path on the slope does not take the cap from a motorway 7 km out (#784)', () => {
    const path = tp(200, 1_500, 'path', 0.9) // the Mirante Vista para a Cidade: a trail under the forest
    const motorway = tp(0, 7_000, 'motorway', 0.4) // Méier, 7 km north
    const why = new Map()
    const out = selectSpacedTriggerPoints([path, motorway], { ...landmark, maxFarTriggerPoints: 1 }, PIN, why)
    assert.deepEqual(out.map(t => t.id), [motorway.id])
    assert.match(why.get(motorway), /won pass 1 \(horizon\)/)
    assert.match(why.get(path), /tier 2 path; lost: cap/)
    assert.equal(selectSpacedTriggerPoints([path, motorway], landmark, PIN).length, 2, 'with room, the trail gets in')
  })

  it('from pass 2 on, the outer ring gets its second TP before the slope next to the POI', () => {
    const slope = [tp(80, 500, 'primary', 0.9), tp(84, 800, 'primary', 0.9)] // same ring-0 cell
    const ipanema = [tp(80, 2_300, 'primary', 0.5), tp(84, 3_300, 'primary', 0.5)] // same ring-2 cell
    const why = new Map()
    const out = selectSpacedTriggerPoints([...slope, ...ipanema], { ...landmark, maxFarTriggerPoints: 3 }, PIN, why)
    assert.ok(out.includes(ipanema[1]), [...why.values()].join(' | '))
    assert.match(why.get(slope[1]), /lost: cap/)
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

  it('INV-E7c: inside the inner rings a cell keeps its tourist streets by length, not 6 per cell', () => {
    const cand = (bearing: number, m: number, type: string, quality: number) =>
      ({ location: polar(bearing, m), distance: m, quality, expectedBearing: 0, confidence: 0.85, street: { type } as any })
    // a promenade crossing the 2–4 km ring of one sector (22.5° beyond 2 km), one walked point every ~100 m
    const orla = Array.from({ length: 20 }, (_, i) => cand(91 + i * 1.0, 2_100 + i * 95, 'primary', 0.5))
    const residential = Array.from({ length: 10 }, (_, i) => cand(100, 2_100 + i * 190, 'residential', 0.9))
    const out = sampleFarBySectorAndRing([...orla, ...residential] as any, PIN)
    const keptOrla = out.filter(c => orla.includes(c as any)).length
    assert.ok(keptOrla > 6, `${keptOrla} of the promenade`)
    // tourist streets are not capped; the others only fill up to FAR_CANDIDATES_PER_CELL
    assert.equal(out.filter(c => residential.includes(c as any)).length, 0)
  })

  it('INV-E7c: the horizon keeps tourist streets only, FAR_CANDIDATES_PER_CELL per cell', () => {
    const cand = (bearing: number, m: number, type: string) =>
      ({ location: polar(bearing, m), distance: m, quality: 0.5, expectedBearing: 0, confidence: 0.85, street: { type } as any })
    const avenue = Array.from({ length: 12 }, (_, i) => cand(100, 4_500 + i * 300, 'secondary'))
    const lane = cand(110, 5_000, 'residential')
    const out = sampleFarBySectorAndRing([...avenue, lane] as any, PIN)
    assert.ok(!out.includes(lane as any))
    assert.ok(out.length <= 6 * 2, `${out.length}`) // two E7 rings (4–8 km, 8+ km) in this sector
  })
})

describe('INV-E10a, BR-AUDIO-010 — far cells are finer (provisional #775)', () => {
  it('up to 2 km the sector is 45°; beyond, 22.5°: Lagoa and Ipanema east of the Irmão Menor fall in different cells', () => {
    assert.equal(FAR_SECTOR_DEG, 45)
    assert.equal(FAR_FINE_SECTOR_DEG, 22.5)
    assert.equal(landmarkSectorOf(100, 2_000), landmarkSectorOf(125, 2_000))
    assert.notEqual(landmarkSectorOf(100, 2_500), landmarkSectorOf(125, 2_500))
    assert.equal(landmarkSectorOf(-10, 3_000), landmarkSectorOf(350, 3_000))
  })

  it('INV-E10, INV-E6, BR-AUDIO-010: no count cap in any class, near or far — one source, CLASS_LIMITS; spacing is the only cut (#772)', () => {
    for (const cls of Object.values(VisibilityClass)) {
      assert.equal(CLASS_LIMITS[cls].maxTPs, Infinity, cls)
      assert.equal(CLASS_LIMITS[cls].maxFarTPs, Infinity, cls)
    }
  })
})
