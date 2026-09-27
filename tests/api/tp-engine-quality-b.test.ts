import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  VisibilityClass,
  classifyVisibility,
  resolveHeightM,
  CLASS_LIMITS,
} from '../../lib/services/trigger-points-google/config/visibility-class'
import { POIClassifierService } from '../../lib/services/trigger-points-google/services/poi-classifier.service'
import type { GeographicContext, POIData } from '../../lib/services/trigger-points-google/types/interfaces'

// Auditoria do motor de TP, 2026-09-27, fatia B (#774). Fixture: Rio de Janeiro.
const PIN = { lat: -22.9030, lng: -43.1740 }
const context = { urbanDensity: { level: 'dense' } } as unknown as GeographicContext
const M_PER_DEG_LAT = 110_540
const mPerDegLng = 111_320 * Math.cos((PIN.lat * Math.PI) / 180)

/** Retângulo de w × h metros centrado no pino. */
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

describe('BR-AUDIO-010 — classe de visibilidade sai de atributo físico, não de nome', () => {
  it('altura padrão por tag só quando falta a real', () => {
    assert.equal(resolveHeightM({ memorial: 'bust' }).heightM, 2.5)
    assert.equal(resolveHeightM({ building: 'church' }).heightM, 25)
    assert.equal(resolveHeightM({ building: 'church', height: '41' }).heightM, 41)
    assert.equal(resolveHeightM({ building: 'yes', 'building:levels': '10' }).heightM, 40)
  })

  it('busto é POINT_LOW, estátua e igreja são STRUCTURE, torre é LANDMARK_HIGH', () => {
    assert.equal(classOf({ historic: 'memorial', memorial: 'bust' }), VisibilityClass.POINT_LOW)
    assert.equal(classOf({ memorial: 'statue' }), VisibilityClass.STRUCTURE)
    assert.equal(classOf({ building: 'church' }), VisibilityClass.STRUCTURE)
    assert.equal(classOf({ man_made: 'tower' }), VisibilityClass.LANDMARK_HIGH)
  })

  it('proeminência alta sobre o terreno faz LANDMARK_HIGH mesmo sem altura', () => {
    assert.equal(classOf({}, { prominenceM: 700 }), VisibilityClass.LANDMARK_HIGH)
    assert.equal(classOf({}, { prominenceM: 40 }), VisibilityClass.POINT_LOW)
  })

  it('área grande e baixa é AREA; boundary alongado é LINEAR', () => {
    assert.equal(classOf({ leisure: 'park' }, { wM: 200, hM: 200 }), VisibilityClass.AREA)
    assert.equal(classOf({ leisure: 'park' }, { wM: 1500, hM: 60 }), VisibilityClass.LINEAR)
  })

  it('mirante é VIEWPOINT, e nenhuma classe além dele tem teto de borda >100 m exceto o marco alto', () => {
    assert.equal(classOf({ tourism: 'viewpoint' }), VisibilityClass.VIEWPOINT)
    for (const [cls, lim] of Object.entries(CLASS_LIMITS)) {
      if (cls !== VisibilityClass.LANDMARK_HIGH) assert.ok(lim.maxEdgeDistanceM <= 100, cls)
    }
  })

  it('nome com "Cristo"/"Peak" sem altura nem proeminência não vira marco alto', async () => {
    const poi = { id: 'x', name: 'Cristo Peak Stadium', location: PIN } as unknown as POIData
    const c = await new POIClassifierService().classifyPOI(poi, undefined, undefined, 16, context, {}, rect(4, 4))
    assert.equal(c.group, VisibilityClass.POINT_LOW)
    assert.equal(c.maxEdgeDistanceM, CLASS_LIMITS[VisibilityClass.POINT_LOW].maxEdgeDistanceM)
    assert.equal(c.minDistanceBetweenTPs, 2 * c.maxTPRadiusM)
  })
})
