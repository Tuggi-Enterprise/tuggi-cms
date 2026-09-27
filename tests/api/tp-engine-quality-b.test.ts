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
