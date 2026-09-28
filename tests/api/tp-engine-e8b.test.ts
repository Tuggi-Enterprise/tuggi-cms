import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DemStore } from '@/lib/services/dem/dem-store'
import { VisibilityMapBuilder, EDGE_AIM_COUNT } from '@/lib/services/trigger-points-google/analyzers/visibility-map-builder'
import { MIN_APPARENT_ANGLE_DEG } from '@/lib/services/trigger-points-google/config/visibility-class'
import { sightTraceValue } from '@/lib/services/trigger-points-google/utils/engine-trace'

// TP engine (#784) — E8 aims at many points of the POI, only its footprint is not an obstacle,
// and the result is graded by the apparent angle. docs/arquitetura/cms/motor-de-tp.md
// (INV-E8, INV-E8b). BR-AUDIO-010: the TP fires where the POI is seen.

const PIN = { lat: -22.9519, lng: -43.2105 }
const at = (n: number, e: number) => ({
  lat: PIN.lat + n / 110_540,
  lng: PIN.lng + e / (111_320 * Math.cos((PIN.lat * Math.PI) / 180)),
})
const box = (n0: number, n1: number, e0: number, e1: number) => [at(n0, e0), at(n0, e1), at(n1, e1), at(n1, e0)]
const northOf = (p: { lat: number }) => (p.lat - PIN.lat) * 110_540
const eastOf = (p: { lng: number }) => (p.lng - PIN.lng) * 111_320 * Math.cos((PIN.lat * Math.PI) / 180)
const GROUND = 5

/** A square POI of side 2·half, `h` tall, on flat ground. */
const poi = (half: number, h: number) => ({
  coordinates: box(-half, half, -half, half),
  center: PIN,
  physical: { groundTopM: GROUND, heightM: h, topPoint: PIN },
})

async function withRelief<T>(
  obstacle: (n: number, e: number) => number | null,
  fn: () => Promise<T>,
): Promise<T> {
  const dem = DemStore.getInstance() as any
  const original = { ground: dem.ground, obstacle: dem.obstacle }
  dem.ground = () => GROUND
  dem.obstacle = (lat: number, lng: number) => obstacle(northOf({ lat }), eastOf({ lng }))
  try {
    return await fn()
  } finally {
    dem.ground = original.ground
    dem.obstacle = original.obstacle
  }
}

const sight = async (p: ReturnType<typeof poi>, observer: { lat: number; lng: number }) =>
  VisibilityMapBuilder.measureSight(VisibilityMapBuilder.sightAims(p), observer, { footprint: p.coordinates })

describe('INV-E8b, BR-AUDIO-010 — the sight line aims at many points of the POI', () => {
  it('INV-E8b: top and mid-height over the top point, and the edge points from the ground to the POI height', async () => {
    await withRelief(() => GROUND, async () => {
      const aims = VisibilityMapBuilder.sightAims(poi(10, 12))
      assert.equal(aims.length, 2 + EDGE_AIM_COUNT * 3)
      assert.deepEqual(aims.slice(0, 2).map(a => [a.kind, a.altM]), [['top', 17], ['mid', 11]])
      const edge = aims.filter(a => a.kind === 'edge')
      assert.deepEqual([...new Set(edge.map(a => a.altM))].sort((a, b) => a - b), [5, 11, 17])
      for (const a of edge) assert.ok(Math.max(Math.abs(northOf(a.at)), Math.abs(eastOf(a.at))) > 9.9, 'edge aims sit on the boundary')
    })
  })

  it('INV-E8b: a synthetic circle is not a footprint — its edge aims stand on the POI ground, not on the DEM under it', async () => {
    await withRelief(() => GROUND, async () => {
      const aims = VisibilityMapBuilder.sightAims({ ...poi(10, 2), synthetic: true, physical: { groundTopM: 710, heightM: 2, topPoint: PIN } })
      assert.equal(Math.min(...aims.map(a => a.altM)), 710, 'the DEM reads 5 m under a 710 m summit')
    })
  })

  it('INV-E8b: a relief landmark aims at the upper half of its relief, and stops where it ends', async () => {
    const dem = DemStore.getInstance() as any
    const original = { ground: dem.ground, obstacle: dem.obstacle }
    // a cone: 400 m at the top, down 1 m per metre; local prominence 600 → upper half above 100 m
    const cone = (lat: number, lng: number) => Math.max(0, 400 - Math.hypot(northOf({ lat }), eastOf({ lng })))
    dem.ground = cone
    dem.obstacle = (lat: number, lng: number) => cone(lat, lng) + 10
    try {
      const peak = { ...poi(10, 0), synthetic: true, physical: { groundTopM: 400, heightM: 0, topPoint: PIN, classRule: 'landmark_prominence', localProminenceM: 600 } }
      const relief = VisibilityMapBuilder.sightAims(peak).filter(a => a.kind === 'relief')
      assert.equal(relief.length, 8 * 3, '50, 100 and 200 m on 8 bearings; 400 m is below the upper half')
      assert.ok(relief.every(a => Math.abs(a.altM - (cone(a.at.lat, a.at.lng) + 10)) < 1e-6), 'the aim is the top of what stands there')
      const plain = VisibilityMapBuilder.sightAims({ ...peak, physical: { ...peak.physical, classRule: 'point_low' } })
      assert.equal(plain.filter(a => a.kind === 'relief').length, 0)
    } finally {
      dem.ground = original.ground
      dem.obstacle = original.obstacle
    }
  })

  it('INV-E8b: a relief landmark is seen by its summit — the upper half alone does not pass a candidate (#784)', async () => {
    // a wall hides the summit from an observer 1 km east; two relief aims 200 m out stay in view,
    // like a forest road under the Mirante Vista para a Cidade seeing the slope above it
    const wall = (n: number, e: number) => (Math.abs(n) <= 5 && e >= 140 && e <= 160 ? 390 : GROUND)
    const observer = at(0, 1_000)
    const top = { at: PIN, altM: 400, kind: 'top' as const }
    const slope = [
      { at: at(0, 200), altM: 300, kind: 'relief' as const, ringM: 200 },
      { at: at(141, 141), altM: 300, kind: 'relief' as const, ringM: 200 },
    ]
    const summitRing = { at: at(35, 35), altM: 380, kind: 'relief' as const, ringM: 50 }
    await withRelief(wall, async () => {
      const hidden = await VisibilityMapBuilder.measureSight([top, ...slope], observer)
      assert.equal(hidden.visible, 2, 'the two slope aims are seen, the summit is not')
      assert.ok(hidden.angleDeg >= MIN_APPARENT_ANGLE_DEG, `${hidden.angleDeg}`)
      assert.equal(hidden.passes, false)
      const seen = await VisibilityMapBuilder.measureSight([top, ...slope, summitRing], observer)
      assert.equal(seen.passes, true, 'an aim 50 m from the top is the summit')
    })
  })

  it('INV-E8b: a trail on the relief landmark\'s own slope is not where it is heard — the city, the road and the summit are (#784, BR-AUDIO-010)', () => {
    // a cone: 1000 m at the top, down 1 m per metre, local base 100 m — the Mirante Vista para a
    // Cidade has its trails 0.5–0.9 km out on the massif, above its 395 m local base
    const cone = { ground: (lat: number, lng: number) => Math.max(0, 1_000 - Math.hypot(northOf({ lat }), eastOf({ lng }))) }
    const peak = { center: PIN, physical: { classRule: 'landmark_prominence', localBaseM: 100, topPoint: PIN } }
    const tp = (e: number, type: string) => ({ location: at(0, e), distance: e, street: { type } })
    assert.equal(VisibilityMapBuilder.onOwnSlope(peak, tp(500, 'path'), cone), true, 'a trail halfway up')
    assert.equal(VisibilityMapBuilder.onOwnSlope(peak, tp(500, 'tertiary'), cone), false, 'a road on the mountain stays')
    assert.equal(VisibilityMapBuilder.onOwnSlope(peak, tp(60, 'path'), cone), false, 'the trail at the summit is the POI (EDGE_BAND_M)')
    assert.equal(VisibilityMapBuilder.onOwnSlope(peak, tp(950, 'path'), cone), false, 'below the local base: the city around it')
    const valley = { ground: (lat: number, lng: number) => (Math.abs(eastOf({ lng }) - 400) < 50 ? 50 : cone.ground(lat, lng)) }
    assert.equal(VisibilityMapBuilder.onOwnSlope(peak, tp(500, 'path'), valley), false, 'a valley between: another hill')
    assert.equal(VisibilityMapBuilder.onOwnSlope({ ...peak, physical: { ...peak.physical, classRule: 'point_low' } }, tp(500, 'path'), cone), false)
  })

  it('INV-E8b: next to a long POI, the edge point facing the observer is an aim (the sampled ones are far)', async () => {
    const bridge = { coordinates: box(-5, 5, -5000, 5000), center: PIN, physical: { groundTopM: GROUND, heightM: 0, topPoint: PIN } }
    const observer = at(-40, 3000)
    await withRelief(() => GROUND, async () => {
      const facing = VisibilityMapBuilder.facingAims(bridge, observer)
      assert.equal(facing.length, 3)
      assert.ok(Math.abs(eastOf(facing[0].at) - 3000) < 1 && Math.abs(northOf(facing[0].at) + 5) < 1)
      const s = await VisibilityMapBuilder.measureSight([...VisibilityMapBuilder.sightAims(bridge), ...facing], observer, { footprint: bridge.coordinates })
      assert.equal(s.passes, true, `${s.angleDeg}`)
    })
  })

  it('INV-E8b: a building between the street and a low POI hides it — where the 50 m exclusion used to see through', async () => {
    const p = poi(10, 6)
    const observer = at(-110, 0) // 100 m from the edge
    const block = (n: number, e: number) => (n < -30 && n > -55 && Math.abs(e) < 60 ? GROUND + 20 : GROUND)
    await withRelief(block, async () => {
      const s = await sight(p, observer)
      assert.equal(s.passes, false)
      assert.equal(s.visible, 0, 'nothing of a 6 m POI shows over a 20 m building 20–45 m in front of it')
    })
    await withRelief(() => GROUND, async () => {
      const s = await sight(p, observer)
      assert.equal(s.passes, true)
      assert.equal(s.fraction, 1)
    })
  })

  it('INV-E8b: the POI footprint is not an obstacle to its own aims — not a radius around it', async () => {
    const p = poi(10, 30)
    // the POI is a 30 m building; a 20 m one stands 40–60 m north, behind it for this observer
    const relief = (n: number, e: number) =>
      Math.abs(n) <= 10 && Math.abs(e) <= 10 ? GROUND + 30 : n > 40 && n < 60 ? GROUND + 20 : GROUND
    await withRelief(relief, async () => {
      const s = await sight(p, at(-200, 0))
      assert.equal(s.fraction, 1, `${s.visible}/${s.total}`)
      assert.equal(s.passes, true)
    })
  })

  it('INV-E8b: a wall that hides the lower part leaves a partial fraction, and the angle of the part above it', async () => {
    const p = poi(10, 20)
    const wall = (n: number) => (n < -40 && n > -50 ? GROUND + 8 : GROUND) // 8 m wall 30–40 m before the edge
    await withRelief(wall, async () => {
      const s = await sight(p, at(-150, 0))
      assert.ok(s.fraction > 0 && s.fraction < 1, `${s.visible}/${s.total}`)
      assert.equal(s.passes, s.angleDeg >= MIN_APPARENT_ANGLE_DEG)
    })
  })

  it('INV-E8b: apparent size — the same POI passes near and fails far, by MIN_APPARENT_ANGLE_DEG', async () => {
    const p = poi(2, 3) // a 4 m bust: diagonal 5.7 m
    const rad = (MIN_APPARENT_ANGLE_DEG * Math.PI) / 180
    await withRelief(() => null, async () => {
      const far = await sight(p, at(-(2 * 5.7) / rad, 0))
      assert.ok(far.angleDeg < MIN_APPARENT_ANGLE_DEG, `${far.angleDeg}`)
      assert.equal(far.passes, false)
      assert.equal(far.fraction, 1, 'every aim is seen: it is the size that fails, not the line')
      const near = await sight(p, at(-2 / rad, 0))
      assert.ok(near.angleDeg >= MIN_APPARENT_ANGLE_DEG, `${near.angleDeg}`)
      assert.equal(near.passes, true)
    })
  })

  it('INV-E8b: one visible point spans no angle — it does not pass', () => {
    assert.equal(VisibilityMapBuilder.apparentAngleDeg([{ at: PIN, altM: 50, kind: 'top' }], at(-500, 0)), 0)
  })
})

describe('INV-E8 — the E8 trace row of every candidate carries the fraction and the angle', () => {
  it('INV-E8: sight value', () => {
    assert.equal(sightTraceValue({ visible: 19, total: 38, fraction: 0.5, angleDeg: 1.234 }), 'sight 19/38 aims (50%), 1.23°')
    assert.equal(sightTraceValue(undefined), 'sight not measured')
    assert.equal(sightTraceValue({ visible: 5, total: 74, fraction: 5 / 74, angleDeg: 66.5, ownSlope: true }), 'sight 5/74 aims (7%), 66.50°; own slope')
  })
})
