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
    assert.equal(classifyVisibility({ heightM: 0, prominenceM: 331, localProminenceM: 331, areaM2: 0 }), VisibilityClass.LANDMARK_HIGH)
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
    // 20 candidates south-east (1-3 km), 1 north (3.5 km), 1 east (4 km) — inside the inner rings
    // of INV-E10a; the horizon beyond them waits for the inner cells (tp-engine-e10.test.ts)
    const se = Array.from({ length: 20 }, (_, i) => tp(140 + (i % 5) * 4, 1000 + i * 100, i))
    const out = selectSpacedTriggerPoints([...se, tp(0, 3500, 90), tp(90, 4000, 91)], landmark)
    const ids = out.map(t => t.id)
    assert.ok(ids.includes('t90') && ids.includes('t91'), ids.join(','))
  })
})

describe('BR-AUDIO-010 — a peak or hill is a landmark, and its prominence is measured around it', () => {
  it('a prominent natural=peak/hill is LANDMARK_HIGH, even with tourism=viewpoint and in Nominatim shape', () => {
    // relief needs both prominences (#772: Morro do Patronato, 91/77 m, is not a landmark)
    const flat = { heightM: 0, prominenceM: 100, localProminenceM: 100, areaM2: 0 }
    assert.equal(classifyVisibility({ ...flat, tags: { natural: 'peak', tourism: 'viewpoint' } }), VisibilityClass.LANDMARK_HIGH)
    assert.equal(classifyVisibility({ ...flat, tags: { class: 'natural', type: 'hill' } }), VisibilityClass.LANDMARK_HIGH)
    assert.equal(classifyVisibility({ ...flat, tags: { tourism: 'viewpoint' } }), VisibilityClass.VIEWPOINT)
  })

  it('INV-E4b (P8): one base per city, from the city centre — not from the POI that asked first', async () => {
    const { ElevationAnalysisService } = await import('../../lib/services/trigger-points-google/services/elevation-service')
    // lower quartile of land samples around the city centre; the hill does not lift the base
    const read = async (lat: number) => (lat > -22.83 ? 300 : 8)
    ElevationAnalysisService.clearCache()
    try {
      const onHill = await ElevationAnalysisService.cityBaseElevation({ lat: -22.80, lng: -43.05 }, 'São Gonçalo', read)
      const onPlain = await ElevationAnalysisService.cityBaseElevation({ lat: -22.86, lng: -43.05 }, 'São Gonçalo', read)
      assert.equal(onHill.source, onPlain.source)
      assert.equal(onHill.baseM, onPlain.baseM)
      assert.equal(onHill.baseM, 8)
    } finally {
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
    const { SRTMLocalService } = await import('../../lib/services/srtm-local-service')
    const { LocalOSMFetcher } = await import('../../lib/services/trigger-points-google/services/local-osm-fetcher')
    const srtm = SRTMLocalService.getInstance() as any
    const osm = LocalOSMFetcher.getInstance() as any
    const original = srtm.getElevation
    const originalSummits = osm.fetchSummits
    // a beach: flat ground, no summit (the fixture sits on Corcovado coordinates)
    srtm.getElevation = async () => 2
    osm.fetchSummits = () => []
    try {
      const det = new BoundaryDetector() as any
      const out = await det.withClassification(
        { type: 'polygon', coordinates: strip, center: offset({ n: -30 }), area_m2: 156_000, perimeter_m: 0, confidence: 0.8, source: 'manual' },
        { id: 'x', name: 'Praia', location: pin, type: 'beach', country: 'Brazil', city: 'Rio de Janeiro' }
      )
      assert.equal(out.classification?.group, VisibilityClass.LINEAR)
    } finally {
      srtm.getElevation = original
      osm.fetchSummits = originalSummits
    }
  })
})

describe('BR-AUDIO-010, INV-E11 — post-condition: no TP inside the POI boundary, in any class', () => {
  const square = [offset({ n: -50, e: -50 }), offset({ n: -50, e: 50 }), offset({ n: 50, e: 50 }), offset({ n: 50, e: -50 })]
  const inside = { id: 'in', location: offset({ n: 10 }) }
  const outside = { id: 'out', location: offset({ n: 80 }) }

  it('a building or a bust drops the TP inside it', async () => {
    const { dropInsidePoi } = await import('../../lib/services/trigger-points-google/utils/tp-selection')
    const out = dropInsidePoi([inside, outside], { coordinates: square, classification: { group: VisibilityClass.STRUCTURE } })
    assert.deepEqual(out.map(t => t.id), ['out'])
  })

  it('AREA and LINEAR drop it too: whoever is inside hears the POI through the boundary (BR-AUDIO-009/013)', async () => {
    const { dropInsidePoi } = await import('../../lib/services/trigger-points-google/utils/tp-selection')
    assert.equal(dropInsidePoi([inside], { coordinates: square, classification: { group: VisibilityClass.AREA } }).length, 0)
    assert.equal(dropInsidePoi([inside], { coordinates: square, classification: { group: VisibilityClass.LINEAR } }).length, 0)
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

describe('BR-AUDIO-010 — the class spacing floor holds even when TP radii are small', () => {
  it('LINEAR: 16 candidates of 15 m radius along 200 m keep ≥ 100 m between each other', async () => {
    const { selectSpacedTriggerPoints } = await import('../../lib/services/trigger-points-google/utils/tp-selection')
    const { calculateDistance } = await import('../../lib/services/trigger-points-google/utils/calculations')
    const linear = buildClassification(VisibilityClass.LINEAR, { heightM: 15, prominenceM: 0, areaM2: 11_000 })
    const row = Array.from({ length: 16 }, (_, i) => ({ id: `t${i}`, location: offset({ e: i * 13, n: 20 }), distance: 20, radius: 15,
      quality: 0.8, expectedBearing: 180, type: 'secondary' }) as any)
    const out = selectSpacedTriggerPoints(row, linear)
    assert.ok(out.length <= 3, `${out.length} TPs`)
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
      assert.ok(calculateDistance(out[i].location, out[j].location) >= linear.minDistanceBetweenTPs)
    }
  })
})

describe('BR-AUDIO-010 — the engine never emits a TP the save gate would drop', () => {
  it('a TP beyond the class reach is cut in the final selection, the closer one stays', async () => {
    const { CoreTriggerPointPredictor } = await import('../../lib/services/trigger-points-google/core/trigger-point-predictor')
    const area = buildClassification(VisibilityClass.AREA, { heightM: 0, prominenceM: 0, areaM2: 0 })
    const circle = Array.from({ length: 16 }, (_, i) => offset({ n: 10 * Math.cos((i * Math.PI) / 8), e: 10 * Math.sin((i * Math.PI) / 8) }))
    const mk = (id: string, n: number) => ({ id, location: offset({ n }), distance: n - 10, radius: 30, quality: 0.8, expectedBearing: 180, type: 'secondary' }) as any
    const out = (new CoreTriggerPointPredictor() as any).applyOptions([mk('near', 40), mk('far', 160)], {}, { coordinates: circle, center: PIN, classification: area }, PIN)
    assert.deepEqual(out.map((t: any) => t.id), ['near'])
  })
})

describe('BR-AUDIO-010 — a drawn circle stored in the DB is synthetic, not a footprint', () => {
  const circle = (r: number, n = 16) => Array.from({ length: n + 1 }, (_, i) => offset({ n: r * Math.cos((i * 2 * Math.PI) / n), e: r * Math.sin((i * 2 * Math.PI) / n) }))

  it('a 16-vertex 50 m circle is drawn; a real rectangle is not', async () => {
    const { isDrawnCircle } = await import('../../lib/services/trigger-points-google/utils/calculations')
    assert.equal(isDrawnCircle(circle(50)), true)
    assert.equal(isDrawnCircle([offset({ n: -20, e: -60 }), offset({ n: -20, e: 60 }), offset({ n: 20, e: 60 }), offset({ n: 20, e: -60 })]), false)
  })

  it('a TP 30 m from a memorial inside a synthetic 50 m circle is kept', async () => {
    const { dropInsidePoi } = await import('../../lib/services/trigger-points-google/utils/tp-selection')
    const out = dropInsidePoi([{ id: 'front', location: offset({ n: 30 }) }], { coordinates: circle(50), synthetic: true, center: PIN, classification: { group: VisibilityClass.POINT_LOW } })
    assert.equal(out.length, 1)
  })
})
