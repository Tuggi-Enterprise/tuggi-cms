import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  VisibilityClass,
  classifyVisibility,
} from '../../lib/services/trigger-points-google/config/visibility-class'
import { buildClassification } from '../../lib/services/trigger-points-google/services/poi-classifier.service'

const PIN = { lat: -22.9519, lng: -43.2105 }
const M_PER_DEG_LAT = 110_540
const mPerDegLng = 111_320 * Math.cos((PIN.lat * Math.PI) / 180)
const offset = (m: { n?: number; e?: number }) => ({ lat: PIN.lat + (m.n ?? 0) / M_PER_DEG_LAT, lng: PIN.lng + (m.e ?? 0) / mPerDegLng })
const flatSrtm = { getElevation: async () => 0 }

// TP engine audit, 2026-09-27, slice C (#779). Visual check on 11 Rio POIs.

describe('BR-AUDIO-010 — a synthetic boundary (node circle) never decides the class', () => {
  it('a neighbourhood node is AREA, in OSM or Nominatim tag shape', () => {
    const synthetic = { heightM: 0, prominenceM: 0, areaM2: 0 }
    assert.equal(classifyVisibility({ ...synthetic, tags: { place: 'suburb' } }), VisibilityClass.AREA)
    assert.equal(classifyVisibility({ ...synthetic, tags: { class: 'place', type: 'suburb' } }), VisibilityClass.AREA)
  })

  it('a bust node with no footprint stays POINT_LOW; a prominent node is a landmark, whatever the circle', () => {
    assert.equal(classifyVisibility({ heightM: 2.5, prominenceM: 0, areaM2: 0, tags: { memorial: 'bust' } }), VisibilityClass.POINT_LOW)
    assert.equal(classifyVisibility({ heightM: 0, prominenceM: 331, areaM2: 0 }), VisibilityClass.LANDMARK_HIGH)
  })
})

describe('BR-AUDIO-010 — a landmark gets far TPs where it is seen, on every side', () => {
  it('the fan is the OUTER reach: blocked close to the POI, visible from far away', async () => {
    const { VisibilityMapBuilder } = await import('../../lib/services/trigger-points-google/analyzers/visibility-map-builder')
    const V = VisibilityMapBuilder as any
    // 480 m obstacle 200 m north of a 500 m top: hides it up to ~5 km, not beyond
    const b = offset({ n: 200 })
    const obstacle = { centroid: b, topAltitudeM: 480, polygon: [b] }
    const reach = await V.computeMaxVisibleDistance(PIN, 500, 0, [obstacle], flatSrtm, 7000, 100, 1.7, 30)
    assert.ok(reach >= 6000, `reach ${reach}`)
  })

  it("the POI's own buildings (inside its boundary + 50 m) never block the fan", async () => {
    const { VisibilityMapBuilder } = await import('../../lib/services/trigger-points-google/analyzers/visibility-map-builder')
    const V = VisibilityMapBuilder as any
    const b = offset({ n: 60 })
    const own = { centroid: b, topAltitudeM: 600, polygon: [b] }
    assert.equal(await V.computeMaxVisibleDistance(PIN, 546, 0, [own], flatSrtm, 3000, 100, 1.7, 30), 30, 'counted, it blocks')
    assert.equal(await V.computeMaxVisibleDistance(PIN, 546, 0, [own], flatSrtm, 3000, 100, 1.7, 30, 100), 3000, 'skipped with a 50 m boundary')
  })

  it('far TPs spread by bearing instead of piling up in the closest neighbourhood', async () => {
    const { selectSpacedTriggerPoints } = await import('../../lib/services/trigger-points-google/utils/tp-selection')
    const landmark = buildClassification(VisibilityClass.LANDMARK_HIGH, { heightM: 30, prominenceM: 461, areaM2: 8000 })
    const tp = (bearingFromPoi: number, distM: number, i: number) => {
      const r = (bearingFromPoi * Math.PI) / 180
      return { id: `t${i}`, location: offset({ n: Math.cos(r) * distM, e: Math.sin(r) * distM }), distance: distM, radius: 50,
        quality: 0.8, expectedBearing: (bearingFromPoi + 180) % 360, type: 'secondary' } as any
    }
    // 20 candidates south-east (1-3 km), 1 north (5 km), 1 east (4 km)
    const se = Array.from({ length: 20 }, (_, i) => tp(140 + (i % 5) * 4, 1000 + i * 100, i))
    const out = selectSpacedTriggerPoints([...se, tp(0, 5000, 90), tp(90, 4000, 91)], landmark)
    const ids = out.map(t => t.id)
    assert.ok(ids.includes('t90') && ids.includes('t91'), ids.join(','))
  })
})

describe('BR-AUDIO-010 — a peak or hill is a landmark, and its prominence is measured around it', () => {
  it('natural=peak/hill is LANDMARK_HIGH, even with tourism=viewpoint and in Nominatim shape', () => {
    const flat = { heightM: 0, prominenceM: 0, areaM2: 0 }
    assert.equal(classifyVisibility({ ...flat, tags: { natural: 'peak', tourism: 'viewpoint' } }), VisibilityClass.LANDMARK_HIGH)
    assert.equal(classifyVisibility({ ...flat, tags: { class: 'natural', type: 'hill' } }), VisibilityClass.LANDMARK_HIGH)
    assert.equal(classifyVisibility({ ...flat, tags: { tourism: 'viewpoint' } }), VisibilityClass.VIEWPOINT)
  })

  it('the regional base is sampled around each POI, not cached per city', async () => {
    const { ElevationAnalysisService } = await import('../../lib/services/trigger-points-google/services/elevation-service')
    const { SRTMLocalService } = await import('../../lib/services/srtm-local-service')
    const srtm = SRTMLocalService.getInstance() as any
    const original = srtm.getElevation
    srtm.getElevation = async (lat: number) => (lat > -22.5 ? 500 : 0)
    try {
      ElevationAnalysisService.clearCache()
      const poi = { city: 'São Gonçalo', country: 'Brazil' } as any
      assert.equal(await ElevationAnalysisService.estimateRegionalBaseElevation({ lat: -22.83, lng: -43.07 }, undefined, poi), 0)
      assert.equal(await ElevationAnalysisService.estimateRegionalBaseElevation({ lat: -22.2, lng: -43.07 }, undefined, poi), 500)
    } finally {
      srtm.getElevation = original
      ElevationAnalysisService.clearCache()
    }
  })
})

describe('BR-AUDIO-010 — a long beach keeps its polygon and its class', () => {
  // 2.6 km × 60 m strip, pin 30 m north of it (on the promenade)
  const strip = [offset({ e: -1300, n: -60 }), offset({ e: 1300, n: -60 }), offset({ e: 1300 }), offset({ e: -1300 }), offset({ e: -1300, n: -60 })]
  const pin = offset({ e: 1250, n: 30 })

  it('pin on the promenade, centroid 1.3 km away: the curated polygon is plausible', async () => {
    const { isCuratedBoundaryImplausible } = await import('../../lib/services/trigger-points-google/utils/osm-validation')
    assert.equal(isCuratedBoundaryImplausible(pin, strip), false)
  })

  it('a boundary from the DB fallback leaves the detector classified, never null', async () => {
    const { BoundaryDetector } = await import('../../lib/services/trigger-points-google/core/boundary-detector')
    const det = new BoundaryDetector() as any
    det.elevationService = { getElevation: async () => ({ confidence: 0 }) }
    const out = await det.withClassification(
      { type: 'polygon', coordinates: strip, center: offset({ n: -30 }), area_m2: 156_000, perimeter_m: 0, confidence: 0.8, source: 'manual' },
      { id: 'x', name: 'Praia', location: pin, type: 'beach', country: 'Brazil', city: 'Rio de Janeiro' }
    )
    assert.equal(out.classification?.group, VisibilityClass.LINEAR)
  })
})

describe('BR-AUDIO-010 — post-condition: no TP inside the POI boundary, except where the tourist is inside', () => {
  const square = [offset({ n: -50, e: -50 }), offset({ n: -50, e: 50 }), offset({ n: 50, e: 50 }), offset({ n: 50, e: -50 })]
  const inside = { id: 'in', location: offset({ n: 10 }) }
  const outside = { id: 'out', location: offset({ n: 80 }) }

  it('a building or a bust drops the TP inside it', async () => {
    const { dropInsidePoi } = await import('../../lib/services/trigger-points-google/utils/tp-selection')
    const out = dropInsidePoi([inside, outside], { coordinates: square, classification: { group: VisibilityClass.STRUCTURE } })
    assert.deepEqual(out.map(t => t.id), ['out'])
  })

  it('AREA, beach and park keep it', async () => {
    const { dropInsidePoi } = await import('../../lib/services/trigger-points-google/utils/tp-selection')
    assert.equal(dropInsidePoi([inside], { coordinates: square, classification: { group: VisibilityClass.AREA } }).length, 1)
    assert.equal(dropInsidePoi([inside], { coordinates: square, classification: { group: VisibilityClass.LINEAR }, osmTags: { natural: 'beach' } }).length, 1)
    assert.equal(dropInsidePoi([inside], { coordinates: square, classification: { group: VisibilityClass.POINT_LOW }, osmTags: { leisure: 'park' } }).length, 1)
  })
})

describe('BR-AUDIO-010 — a room inside a host building: no TP inside the host', () => {
  it('drops the TP inside the building that contains the POI, keeps the one on the street', async () => {
    const { dropInsidePoi } = await import('../../lib/services/trigger-points-google/utils/tp-selection')
    const host = [offset({ n: -80, e: -80 }), offset({ n: -80, e: 80 }), offset({ n: 80, e: 80 }), offset({ n: 80, e: -80 })]
    const room = [offset({ n: -5, e: -5 }), offset({ n: -5, e: 5 }), offset({ n: 5, e: 5 }), offset({ n: 5, e: -5 })]
    const out = dropInsidePoi([{ id: 'hall', location: offset({ n: 40 }) }, { id: 'street', location: offset({ n: 120 }) }], {
      coordinates: room, center: PIN, classification: { group: VisibilityClass.POINT_LOW }, buildings: [{ geometry: host }],
    })
    assert.deepEqual(out.map(t => t.id), ['street'])
  })
})
