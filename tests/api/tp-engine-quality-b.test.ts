import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  VisibilityClass,
  classifyVisibility,
  resolveHeightM,
  CLASS_LIMITS,
  fanHorizonM,
  SANITY_MAX_TP_DISTANCE_M,
} from '../../lib/services/trigger-points-google/config/visibility-class'
import { tpReachCapM, partitionByPoiReach } from '../../lib/services/trigger-points-google/utils/validation'
import { POIClassifierService, buildClassification } from '../../lib/services/trigger-points-google/services/poi-classifier.service'
import type { GeographicContext, POIData } from '../../lib/services/trigger-points-google/types/interfaces'

// TP engine audit, 2026-09-27, slice B (#774). Fixture: Rio de Janeiro.
const PIN = { lat: -22.9030, lng: -43.1740 }
const context = { urbanDensity: { level: 'dense' } } as unknown as GeographicContext
const M_PER_DEG_LAT = 110_540
const mPerDegLng = 111_320 * Math.cos((PIN.lat * Math.PI) / 180)

/** w × h meter rectangle centred on the pin. */
function rect(wM: number, hM: number, at = PIN) {
  const dx = wM / 2 / mPerDegLng
  const dy = hM / 2 / M_PER_DEG_LAT
  return [
    { lat: at.lat - dy, lng: at.lng - dx },
    { lat: at.lat - dy, lng: at.lng + dx },
    { lat: at.lat + dy, lng: at.lng + dx },
    { lat: at.lat + dy, lng: at.lng - dx },
    { lat: at.lat - dy, lng: at.lng - dx },
  ]
}

function classOf(tags: Record<string, string>, extra: { prominenceM?: number; wM?: number; hM?: number } = {}) {
  const w = extra.wM ?? 4
  const h = extra.hM ?? 4
  return classifyVisibility({
    heightM: resolveHeightM(tags).heightM,
    prominenceM: extra.prominenceM ?? 0,
    areaM2: w * h,
    boundary: rect(w, h),
    tags,
  })
}

describe('BR-AUDIO-010 — visibility class comes from physical attributes, not from the name', () => {
  it('default height by tag only when the real one is missing', () => {
    assert.equal(resolveHeightM({ memorial: 'bust' }).heightM, 2.5)
    assert.equal(resolveHeightM({ building: 'church' }).heightM, 25)
    assert.equal(resolveHeightM({ building: 'church', height: '41' }).heightM, 41)
    assert.equal(resolveHeightM({ building: 'yes', 'building:levels': '10' }).heightM, 40)
  })

  it('bust is POINT_LOW, statue and church are STRUCTURE, tower is LANDMARK_HIGH', () => {
    assert.equal(classOf({ historic: 'memorial', memorial: 'bust' }), VisibilityClass.POINT_LOW)
    assert.equal(classOf({ memorial: 'statue' }), VisibilityClass.STRUCTURE)
    assert.equal(classOf({ building: 'church' }), VisibilityClass.STRUCTURE)
    assert.equal(classOf({ man_made: 'tower' }), VisibilityClass.LANDMARK_HIGH)
  })

  it('high prominence over the terrain makes LANDMARK_HIGH even without height', () => {
    assert.equal(classOf({}, { prominenceM: 700 }), VisibilityClass.LANDMARK_HIGH)
    assert.equal(classOf({}, { prominenceM: 40 }), VisibilityClass.POINT_LOW)
  })

  it('large low area is AREA; elongated boundary is LINEAR', () => {
    assert.equal(classOf({ leisure: 'park' }, { wM: 200, hM: 200 }), VisibilityClass.AREA)
    assert.equal(classOf({ leisure: 'park' }, { wM: 1500, hM: 60 }), VisibilityClass.LINEAR)
  })

  it('viewpoint tag is VIEWPOINT; only the tall landmark has an edge cap above 100 m', () => {
    assert.equal(classOf({ tourism: 'viewpoint' }), VisibilityClass.VIEWPOINT)
    for (const [cls, lim] of Object.entries(CLASS_LIMITS)) {
      if (cls !== VisibilityClass.LANDMARK_HIGH) assert.ok(lim.maxEdgeDistanceM <= 100, cls)
    }
  })

  it('a "Cristo"/"Peak" name without height or prominence is not a landmark', async () => {
    const poi = { id: 'x', name: 'Cristo Peak Stadium', location: PIN } as unknown as POIData
    const c = await new POIClassifierService().classifyPOI(poi, undefined, undefined, 16, context, {}, rect(4, 4))
    assert.equal(c.group, VisibilityClass.POINT_LOW)
    assert.equal(c.maxEdgeDistanceM, CLASS_LIMITS[VisibilityClass.POINT_LOW].maxEdgeDistanceM)
    assert.equal(c.minDistanceBetweenTPs, 2 * c.maxTPRadiusM)
  })
})

describe('BR-AUDIO-010 — per-class cap replaces the 300 m floor and the single cap', () => {
  it('a low POI fan stays at the class cap, not at 300 m', () => {
    assert.equal(fanHorizonM({ cls: VisibilityClass.POINT_LOW, effectiveHeightM: 1.7, prominenceM: 0 }), 60)
    assert.equal(fanHorizonM({ cls: VisibilityClass.AREA, effectiveHeightM: 1.7, prominenceM: 0 }), 60)
  })

  it('a tall landmark reaches 2 km on flat terrain, and beyond only when prominent', () => {
    assert.equal(fanHorizonM({ cls: VisibilityClass.LANDMARK_HIGH, effectiveHeightM: 300, prominenceM: 0 }), 2000)
    const cristo = fanHorizonM({ cls: VisibilityClass.LANDMARK_HIGH, effectiveHeightM: 740, prominenceM: 700 })
    assert.ok(cristo > 2000 && cristo <= SANITY_MAX_TP_DISTANCE_M, String(cristo))
  })

  it('save cap is the class one; unclassified 300 m; never above sanity', () => {
    const low = buildClassification(VisibilityClass.POINT_LOW, { heightM: 2, prominenceM: 0, areaM2: 4 })
    const peak = buildClassification(VisibilityClass.LANDMARK_HIGH, { heightM: 38, prominenceM: 700, areaM2: 400 })
    assert.equal(tpReachCapM(low), 60)
    assert.equal(tpReachCapM(peak), SANITY_MAX_TP_DISTANCE_M)
    assert.equal(tpReachCapM(undefined), 300)
    const at = (m: number) => ({ lat: PIN.lat + m / 111_000, lng: PIN.lng })
    // a landmark visible at 5 km is no longer cut by the single 300 m cap
    assert.equal(partitionByPoiReach([at(5000)], p => p, PIN, undefined, tpReachCapM(peak)).kept.length, 1)
    assert.equal(partitionByPoiReach([at(80)], p => p, PIN, undefined, tpReachCapM(low)).kept.length, 0)
  })
})

describe('BR-AUDIO-010 — whole street, not a vertex: the TP sits in front of the POI edge', () => {
  const offset = (m: { n?: number; e?: number }) => ({ lat: PIN.lat + (m.n ?? 0) / M_PER_DEG_LAT, lng: PIN.lng + (m.e ?? 0) / mPerDegLng })
  const smallPoi = rect(10, 10)
  // Straight street 25 m south of the POI center, vertices 400 m away on each side.
  const street = { id: 'way/1', type: 'residential', accessibility: 'public', confidence: 0.8,
    coordinates: [offset({ n: -25, e: -400 }), offset({ n: -25, e: 400 })] } as any
  const lowClass = buildClassification(VisibilityClass.POINT_LOW, { heightM: 2, prominenceM: 0, areaM2: 100 })

  it('foot of the perpendicular on a diagonal segment is the true closest point (metric projection)', async () => {
    const { closestPointOnSegment } = await import('../../lib/services/trigger-points-google/utils/calculations')
    const { calculateDistance } = await import('../../lib/services/trigger-points-google/utils/calculations')
    const a = offset({ n: -300, e: -300 })
    const b = offset({ n: 300, e: 100 })
    const p = offset({ n: 50, e: 200 })
    let brute = Infinity
    for (let i = 0; i <= 20000; i++) {
      const t = i / 20000
      brute = Math.min(brute, calculateDistance(p, { lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng) }))
    }
    const d = calculateDistance(p, closestPointOnSegment(p, a, b).point)
    assert.ok(Math.abs(d - brute) < 0.5, `projection ${d.toFixed(2)} m vs true ${brute.toFixed(2)} m`)
  })

  it('street analysis keeps the whole polyline and measures to the edge', async () => {
    const { StreetAnalyzer } = await import('../../lib/services/trigger-points-google/analyzers/street-analyzer')
    const s = (new StreetAnalyzer() as any).withEdgeDistance(street, { center: PIN, coordinates: smallPoi })
    assert.equal(s.coordinates.length, 2)
    assert.ok(s.distance > 15 && s.distance < 25, String(s.distance))
  })

  it('fan-walk walks the segment: candidates in front of the POI, none beyond the class cap', async () => {
    const { OptimalPointCalculator } = await import('../../lib/services/trigger-points-google/analyzers/point-calculator')
    const boundary = { center: PIN, coordinates: smallPoi, visibilityFan: { polygons: [[PIN]], maxDistanceM: 300 }, classification: lowClass } as any
    const calc = new OptimalPointCalculator() as any
    const streets = calc.filterStreetsByRadius([street], boundary, 60)
    assert.equal(streets.length, 1, 'street passing 20 m from the edge must survive the radius filter')
    const cands = await calc.calculateFanWalkStrategy(streets, { id: 'x', name: 'x', location: PIN }, boundary, context, lowClass)
    assert.ok(cands.length >= 1)
    const nearest = Math.min(...cands.map((c: any) => c.distance))
    assert.ok(nearest < 25, `closest candidate ${nearest.toFixed(0)} m from edge`)
    for (const c of cands) assert.ok(c.distance <= lowClass.maxEdgeDistanceM, `candidate ${c.distance.toFixed(0)} m from edge`)
  })

  it('a candidate interpolated between far vertices is on the street', async () => {
    const { CoreTriggerPointPredictor } = await import('../../lib/services/trigger-points-google/core/trigger-point-predictor')
    const p = new CoreTriggerPointPredictor() as any
    assert.equal(p.isCandidateOnStreet({ location: offset({ n: -25, e: 0 }) }, [street]), true)
  })
})

describe('BR-AUDIO-010 — distance to the EDGE everywhere, not to the center', () => {
  const offset = (m: { n?: number; e?: number }) => ({ lat: PIN.lat + (m.n ?? 0) / M_PER_DEG_LAT, lng: PIN.lng + (m.e ?? 0) / mPerDegLng })
  /** Fan with 72 rays of `reachM` from every boundary vertex. */
  function fan(samples: Array<{ lat: number; lng: number }>, reachM: number) {
    const polygons = samples.map(s => {
      const ring = Array.from({ length: 72 }, (_, i) => {
        const b = (i * 5 * Math.PI) / 180
        return { lat: s.lat + (Math.cos(b) * reachM) / M_PER_DEG_LAT, lng: s.lng + (Math.sin(b) * reachM) / mPerDegLng }
      })
      return [...ring, ring[0]]
    })
    return { polygons, samplePoints: samples, maxDistanceM: reachM }
  }
  const cand = (at: { lat: number; lng: number }, distance: number) =>
    ({ location: at, distance, quality: 0.8, confidence: 0.85, street: { type: 'residential' }, expectedBearing: 0 })

  it('a large park keeps the TP on its own waterfront (500 m from center, 30 m from edge)', async () => {
    const { TriggerPointValidator } = await import('../../lib/services/trigger-points-google/analyzers/validator')
    const park = rect(1000, 1000)
    const areaClass = buildClassification(VisibilityClass.AREA, { heightM: 0, prominenceM: 0, areaM2: 1e6 })
    const boundary = { center: PIN, coordinates: park, visibilityFan: fan(park, 60), classification: areaClass }
    const v = new TriggerPointValidator(undefined as any) as any
    const ok = await v.isValidCandidate(cand(offset({ n: -530 }), 30), { location: PIN }, context, boundary, 0)
    assert.equal(ok, true)
  })

  it('the class cap rejects a TP beyond the class edge distance', async () => {
    const { TriggerPointValidator } = await import('../../lib/services/trigger-points-google/analyzers/validator')
    const small = rect(10, 10)
    const low = buildClassification(VisibilityClass.POINT_LOW, { heightM: 2, prominenceM: 0, areaM2: 100 })
    const boundary = { center: PIN, coordinates: small, visibilityFan: fan(small, 300), classification: low }
    const v = new TriggerPointValidator(undefined as any) as any
    assert.equal(await v.isValidCandidate(cand(offset({ n: -85 }), 80), { location: PIN }, context, boundary, 0), false)
    assert.equal(await v.isValidCandidate(cand(offset({ n: -45 }), 40), { location: PIN }, context, boundary, 0), true)
  })
})

describe('BR-AUDIO-010 — proximity before road type; one spacing rule for every TP', () => {
  const offset = (m: { n?: number; e?: number }) => ({ lat: PIN.lat + (m.n ?? 0) / M_PER_DEG_LAT, lng: PIN.lng + (m.e ?? 0) / mPerDegLng })
  const tp = (at: { lat: number; lng: number }, distance: number, extra: Record<string, unknown> = {}) =>
    ({ id: `${at.lat},${at.lng}`, location: at, distance, radius: 30, quality: 0.8, expectedBearing: 0, type: 'primary', ...extra }) as any

  it('a residential street in front outranks a primary 150 m away', async () => {
    const { proximityRankScore } = await import('../../lib/services/trigger-points-google/config/visibility-class')
    assert.ok(proximityRankScore(20, 'residential') > proximityRankScore(150, 'motorway'))
    assert.ok(proximityRankScore(20, 'primary') > proximityRankScore(20, 'residential'), 'road type still breaks ties')
  })

  it('primary/secondary follows proximity, not road class', async () => {
    const { TriggerPointValidator } = await import('../../lib/services/trigger-points-google/analyzers/validator')
    const v = new TriggerPointValidator(undefined as any) as any
    const near = { location: offset({ n: -20 }), street: { id: 'a', type: 'residential' } } as any
    const far = { location: offset({ n: -300 }), street: { id: 'b', type: 'primary' } } as any
    v.classifyCandidatesByPrimaryScore([near, far], { coordinates: rect(10, 10), center: PIN })
    assert.equal(near.predictedType, 'primary')
    assert.equal(far.predictedType, 'secondary')
  })

  it('POINT_LOW: no 16-direction fill, ≤4 TPs, every pair ≥2r apart', async () => {
    const { selectSpacedTriggerPoints } = await import('../../lib/services/trigger-points-google/utils/tp-selection')
    const { calculateDistance } = await import('../../lib/services/trigger-points-google/utils/calculations')
    const low = buildClassification(VisibilityClass.POINT_LOW, { heightM: 2, prominenceM: 0, areaM2: 100 })
    const ring = Array.from({ length: 16 }, (_, i) => {
      const b = (i * 22.5 * Math.PI) / 180
      return tp(offset({ n: Math.cos(b) * 40, e: Math.sin(b) * 40 }), 35, { expectedBearing: (i * 22.5 + 180) % 360 })
    })
    const out = selectSpacedTriggerPoints(ring, low)
    assert.ok(out.length <= low.maxTriggerPoints, `${out.length} TPs`)
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
      assert.ok(calculateDistance(out[i].location, out[j].location) >= 2 * out[i].radius)
    }
  })

  it('a frontal TP 10 m from a validated TP counts in the same spacing', async () => {
    const { selectSpacedTriggerPoints } = await import('../../lib/services/trigger-points-google/utils/tp-selection')
    const frontal = tp(offset({ n: -20 }), 15, { quality: 0.95 })
    const validated = tp(offset({ n: -20, e: 10 }), 15)
    const out = selectSpacedTriggerPoints([frontal, validated], buildClassification(VisibilityClass.STRUCTURE, { heightM: 10, prominenceM: 0, areaM2: 100 }))
    assert.deepEqual(out, [frontal])
  })
})
