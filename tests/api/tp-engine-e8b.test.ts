import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DemStore } from '@/lib/services/dem/dem-store'
import { VisibilityMapBuilder, EDGE_AIM_COUNT } from '@/lib/services/trigger-points-google/analyzers/visibility-map-builder'
import { MIN_APPARENT_ANGLE_DEG, VisibilityClass } from '@/lib/services/trigger-points-google/config/visibility-class'
import { sightTraceValue } from '@/lib/services/trigger-points-google/utils/engine-trace'
import { selectSpacedTriggerPoints } from '@/lib/services/trigger-points-google/utils/tp-selection'
import { buildClassification } from '@/lib/services/trigger-points-google/services/poi-classifier.service'

// TP engine (#784) — E8 aims at many points of the POI, only its footprint is not an obstacle,
// and the result is graded by the apparent angle. docs/arquitetura/cms/motor-de-tp.md
// (INV-E8, INV-E8b, INV-E10a). BR-AUDIO-010: the TP fires where the POI is seen.

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
  })
})

describe('INV-E10a, INV-E8b — inside one cell and one street tier, the larger apparent angle wins', () => {
  const landmark = buildClassification(VisibilityClass.LANDMARK_HIGH, { heightM: 30, prominenceM: 700, areaM2: 8000 })
  const polar = (bearingDeg: number, m: number) => {
    const r = (bearingDeg * Math.PI) / 180
    return at(Math.cos(r) * m, Math.sin(r) * m)
  }
  let seq = 0
  const tp = (bearingDeg: number, m: number, type: string, quality: number, apparentAngleDeg?: number) => ({
    id: `t${seq++}`, location: polar(bearingDeg, m), distance: m, radius: 50, quality, apparentAngleDeg,
    expectedBearing: (bearingDeg + 180) % 360, street: { type } as any,
  }) as any

  it('INV-E8b: same tier, the larger angle beats the better quality; a better tier still beats a larger angle', () => {
    const small = tp(130, 2_400, 'primary', 0.9, 0.3)
    const big = tp(130, 2_700, 'primary', 0.3, 0.9)
    const track = tp(130, 2_500, 'track', 0.9, 3)
    const out = selectSpacedTriggerPoints([small, big, track], { ...landmark, maxFarTriggerPoints: 1 }, PIN)
    assert.deepEqual(out.map(t => t.id), [big.id])
  })

  it('INV-E10a: coverage is unchanged — a huge angle in one cell does not take a second slot before another cell', () => {
    const a1 = tp(130, 2_400, 'primary', 0.5, 5)
    const a2 = tp(130, 2_900, 'primary', 0.5, 4)
    const b = tp(250, 2_600, 'primary', 0.5, 0.1)
    const out = selectSpacedTriggerPoints([a1, a2, b], { ...landmark, maxFarTriggerPoints: 2 }, PIN)
    assert.deepEqual(out.map(t => t.id).sort(), [a1.id, b.id].sort())
  })
})
