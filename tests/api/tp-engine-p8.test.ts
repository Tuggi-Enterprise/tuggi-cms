import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  BUILDING_LEVEL_HEIGHT_M,
  LANDMARK_MIN_PROMINENCE_M,
  VisibilityClass,
  heightFromTags,
  landPercentile,
  prominenceOverCityM,
  resolveHeightM,
  visibilityClassRule,
} from '../../lib/services/trigger-points-google/config/visibility-class'

// TP engine, premise 8 (#772): height (E3), elevation (E4), class (E5), sight line (E8).
// Targets in docs/arquitetura/cms/motor-de-tp.md. BR-AUDIO-010: the TP fires where the POI is seen.

const PIN = { lat: -22.9519, lng: -43.2105 }
const at = (n: number, e: number) => ({
  lat: PIN.lat + n / 110_540,
  lng: PIN.lng + e / (111_320 * Math.cos((PIN.lat * Math.PI) / 180)),
})
const square = (r: number) => [at(-r, -r), at(-r, r), at(r, r), at(r, -r)]

/** Fake DEM, and no surveyed summit (the real Corcovado node sits next to PIN). */
async function withDem<T>(read: (lat: number, lng: number) => number | null, fn: () => Promise<T>): Promise<T> {
  const { DemStore } = await import('../../lib/services/dem/dem-store')
  const { LocalOSMFetcher } = await import('../../lib/services/trigger-points-google/services/local-osm-fetcher')
  const dem = DemStore.getInstance() as any
  const osm = LocalOSMFetcher.getInstance() as any
  const original = { ground: dem.ground, surface: dem.surface }
  const originalSummits = osm.fetchSummits
  // bare ground and surface alike: a terrain without buildings or trees
  dem.ground = (lat: number, lng: number) => read(lat, lng)
  dem.surface = (lat: number, lng: number) => read(lat, lng)
  osm.fetchSummits = () => []
  try {
    return await fn()
  } finally {
    dem.ground = original.ground
    dem.surface = original.surface
    osm.fetchSummits = originalSummits
  }
}

describe('INV-E3 / BR-AUDIO-010 — one height, one floor ruler, source recorded', () => {
  it('height → building:height → levels × the one floor ruler', () => {
    assert.deepEqual(heightFromTags({ height: '41 m', 'building:levels': '3' }), { heightM: 41, source: 'height' })
    assert.deepEqual(heightFromTags({ 'building:height': '18' }), { heightM: 18, source: 'building:height' })
    assert.deepEqual(heightFromTags({ 'building:levels': '10' }), { heightM: 10 * BUILDING_LEVEL_HEIGHT_M, source: 'levels' })
    assert.equal(heightFromTags({ building: 'yes' }), null)
  })

  it('every building-height reader of the engine uses the same ruler', async () => {
    const { extractBuildingHeight } = await import('../../lib/services/trigger-points-google/utils/calculations')
    const { VisibilityMapBuilder } = await import('../../lib/services/trigger-points-google/analyzers/visibility-map-builder')
    const tags = { building: 'yes', 'building:levels': '7' }
    assert.equal(extractBuildingHeight(tags), 7 * BUILDING_LEVEL_HEIGHT_M)
    assert.equal((VisibilityMapBuilder as any).measuredBuildingHeight({ tags }), 7 * BUILDING_LEVEL_HEIGHT_M)
    // #782: a building without a measured height is not guessed (6 m / 10 m): the surface has it
    assert.equal((VisibilityMapBuilder as any).measuredBuildingHeight({ tags: { building: 'house' } }), null)
  })

  it('Cristo (man_made=monument, no height): no height by type; only one measured on its footprint', () => {
    const cristo = { man_made: 'monument', landmark: '1', tourism: 'attraction' }
    assert.deepEqual(resolveHeightM(cristo), { heightM: 0, source: 'none' })
    assert.deepEqual(resolveHeightM({ amenity: 'library' }, 21), { heightM: 21, source: 'known' })
    assert.deepEqual(resolveHeightM({ amenity: 'library' }), { heightM: 0, source: 'none' })
  })
})

describe('INV-E4a/b/c / BR-AUDIO-010 — ground at the top of the boundary, one city base, no silent 0', () => {
  it('INV-E4a: the highest boundary point wins over the pin and the centroid', async () => {
    const { ElevationAnalysisService } = await import('../../lib/services/trigger-points-google/services/elevation-service')
    const north = at(40, 0)
    const read = async (lat: number) => (lat >= north.lat - 1e-7 ? 600 : 520)
    const top = await ElevationAnalysisService.groundTop({ pin: PIN, boundary: square(40) }, read)
    assert.equal(top.groundM, 600)
    assert.equal(top.source, 'dem_boundary_max')
  })

  it('INV-E4a: a surveyed summit on the boundary beats the smoothed DEM; one 2 km away does not', async () => {
    const { ElevationAnalysisService } = await import('../../lib/services/trigger-points-google/services/elevation-service')
    const read = async () => 568
    const summit = { ...at(10, 5), tags: { natural: 'peak', ele: '710' } }
    const farPeak = { ...at(2000, 0), tags: { natural: 'peak', ele: '1021' } }
    const top = await ElevationAnalysisService.groundTop({ pin: PIN, boundary: square(40), peaks: [summit, farPeak] }, read)
    assert.equal(top.groundM, 710)
    assert.equal(top.source, 'summit_ele')
  })

  it('INV-E4c: DEM failure gives groundM null and prominence null — never 0', async () => {
    const { ElevationAnalysisService } = await import('../../lib/services/trigger-points-google/services/elevation-service')
    const top = await ElevationAnalysisService.groundTop({ pin: PIN, boundary: square(20) }, async () => null)
    assert.equal(top.groundM, null)
    assert.equal(top.source, 'none')
    assert.equal(prominenceOverCityM(null, 12, 10), null)
    assert.equal(prominenceOverCityM(700, 12, null), null)
    assert.equal(landPercentile([0, 0, null]), null)
  })

  it('INV-E4b: prominence = ground top + height − city base; sea samples do not lower the base', () => {
    assert.equal(prominenceOverCityM(710, 12, 8), 714)
    assert.equal(landPercentile([0, 0, 0, 0, 4, 8, 12, 300]), 4)
  })

  it('INV-E4b: the classifier and the fan read the SAME measured numbers (boundary.physical)', async () => {
    const { measureAndClassify } = await import('../../lib/services/trigger-points-google/services/poi-classifier.service')
    const { ElevationAnalysisService } = await import('../../lib/services/trigger-points-google/services/elevation-service')
    const { VisibilityMapBuilder } = await import('../../lib/services/trigger-points-google/analyzers/visibility-map-builder')
    ElevationAnalysisService.clearCache()
    const poi = { id: 'c', name: 'x', location: PIN, city: 'Rio de Janeiro', country: 'Brazil' } as any
    const { classification, physical } = await withDem(
      // a peak (~110 m across): the RELIEF_TOP_RING_M ring around its top comes down to 10 m
      (lat, lng) => (Math.abs(lat - PIN.lat) < 0.0005 && Math.abs(lng - PIN.lng) < 0.0005 ? 700 : 10),
      () => measureAndClassify({ poiData: poi, boundary: square(20), areaM2: 1600, tags: { man_made: 'monument', height: '12' } })
    )
    ElevationAnalysisService.clearCache()
    assert.equal(physical.heightM, 12)
    assert.equal(physical.groundTopM, 700)
    assert.equal(physical.cityBaseM, 10)
    assert.equal(physical.prominenceM, 702)
    assert.equal(classification.group, VisibilityClass.LANDMARK_HIGH)
    assert.equal(physical.classRule, 'landmark_prominence')
    assert.deepEqual(VisibilityMapBuilder.poiSightTarget({ physical }), { groundM: 700, heightM: 12, topM: 712 })
    // a host building raised afterwards (E2) is what the sight line sees; the class keeps its own
    assert.equal(VisibilityMapBuilder.poiSightTarget({ physical, height: 30 }).topM, 730)
  })

  it('BR-POI-009: a small POI on the slope of a mountain is not landmark_high — it stands on the hill, it is not the hill (Fonte da Peninha, 2026-10-05)', async () => {
    const { measureAndClassify } = await import('../../lib/services/trigger-points-google/services/poi-classifier.service')
    const { ElevationAnalysisService } = await import('../../lib/services/trigger-points-google/services/elevation-service')
    ElevationAnalysisService.clearCache()
    const poi = { id: 's', name: 'x', location: PIN, city: 'Rio de Janeiro', country: 'Brazil' } as any
    // a cone whose summit (450 m) is 150 m north of the pin: the pin is ~300 m up its slope,
    // prominent over the city and over its 2 km ring, and the ground keeps rising uphill of it
    const summit = at(150, 0)
    const cone = (lat: number, lng: number) => {
      const n = (lat - summit.lat) * 110_540, e = (lng - summit.lng) * 111_320 * Math.cos((PIN.lat * Math.PI) / 180)
      return Math.max(10, 450 - Math.hypot(n, e))
    }
    const { classification, physical } = await withDem(
      cone,
      () => measureAndClassify({ poiData: poi, boundary: square(4), areaM2: 16, tags: { amenity: 'fountain' } })
    )
    ElevationAnalysisService.clearCache()
    assert.ok((physical.prominenceM ?? 0) >= 100, `prominent over the city (${physical.prominenceM})`)
    assert.notEqual(classification.group, VisibilityClass.LANDMARK_HIGH)
  })
})

describe('INV-E5a/b/c / BR-AUDIO-010 — class from the physical, rule recorded', () => {
  const flat = { heightM: 0, prominenceM: 0, areaM2: 0 }

  it('INV-E5b: a prominent peak/hill is landmark; a hill above the prominence threshold is landmark', () => {
    const prominent = { prominenceM: LANDMARK_MIN_PROMINENCE_M, localProminenceM: LANDMARK_MIN_PROMINENCE_M }
    assert.deepEqual(visibilityClassRule({ ...flat, ...prominent }),
      { cls: VisibilityClass.LANDMARK_HIGH, rule: 'landmark_prominence' })
    assert.deepEqual(visibilityClassRule({ ...flat, prominenceM: LANDMARK_MIN_PROMINENCE_M, localProminenceM: LANDMARK_MIN_PROMINENCE_M }),
      { cls: VisibilityClass.LANDMARK_HIGH, rule: 'landmark_prominence' })
  })

  it('BR-AUDIO-010: relief without both prominences is not landmark_high — it takes the class of its edge (Morro do Patronato, #772)', () => {
    // Patronato: 91 m over the city, 77 m over its ring, polygon of 261,549 m²
    assert.deepEqual(visibilityClassRule({ heightM: 0, prominenceM: 91, localProminenceM: 77, areaM2: 261_549 }),
      { cls: VisibilityClass.AREA, rule: 'area_size' })
    assert.deepEqual(visibilityClassRule({ heightM: 0, prominenceM: 262, localProminenceM: null, areaM2: 0 }),
      { cls: VisibilityClass.POINT_LOW, rule: 'point_low' }, 'unknown local prominence does not make a relief a landmark')
  })

  it('INV-E5c: unknown prominence is explicit and does not make a landmark', () => {
    assert.deepEqual(visibilityClassRule({ heightM: 25, prominenceM: null, areaM2: 0 }),
      { cls: VisibilityClass.STRUCTURE, rule: 'structure_height' })
  })
})

describe('INV-E8 / BR-AUDIO-010 — sight line from the observer eye to the POI top', () => {
  it('a valley observer sees the summit; one behind an intervening ridge does not', async () => {
    const { VisibilityMapBuilder } = await import('../../lib/services/trigger-points-google/analyzers/visibility-map-builder')
    const ridgeLat = at(-1500, 0).lat
    // terrain: 5 m everywhere, except a 400 m ridge band 1.5 km south of the POI
    const terrain = (lat: number) => (Math.abs(lat - ridgeLat) < 0.0015 ? 400 : 5)
    const top = 700 + 12
    await withDem(terrain, async () => {
      assert.equal(await VisibilityMapBuilder.checkExactVisibility(PIN, top, at(0, 3000)), true)
      assert.equal(await VisibilityMapBuilder.checkExactVisibility(PIN, top, at(-3000, 0)), false)
    })
  })

  it('the observer terrain counts: the same ridge does not hide the POI from an observer on top of a higher hill', async () => {
    const { VisibilityMapBuilder } = await import('../../lib/services/trigger-points-google/analyzers/visibility-map-builder')
    const ridgeLat = at(-1500, 0).lat
    const obs = at(-3000, 0)
    const terrain = (lat: number) =>
      Math.abs(lat - obs.lat) < 0.0005 ? 900 : Math.abs(lat - ridgeLat) < 0.0015 ? 400 : 5
    await withDem(terrain, async () => {
      assert.equal(await VisibilityMapBuilder.checkExactVisibility(PIN, 712, obs), true)
    })
  })

  it('a building blocks only where the ray crosses its footprint: beside the observer it does not (profile #772)', async () => {
    const { VisibilityMapBuilder } = await import('../../lib/services/trigger-points-google/analyzers/visibility-map-builder')
    const obs = at(-3000, 0)
    const box = (n0: number, n1: number, e0: number, e1: number) => [at(n0, e0), at(n0, e1), at(n1, e1), at(n1, e0)]
    const tops = (polygon: ReturnType<typeof box>) => {
      const c = { lat: polygon.reduce((a, p) => a + p.lat, 0) / 4, lng: polygon.reduce((a, p) => a + p.lng, 0) / 4 }
      return [{ centroid: c, topAltitudeM: 5 + 50, polygon }]
    }
    await withDem(() => 5, async () => {
      // a 50 m block 15–35 m beside the avenue, next to the observer, with the peak straight along it
      const beside = box(-2960, -2900, 15, 35)
      assert.equal(await VisibilityMapBuilder.checkExactVisibility(PIN, 712, obs, { buildingTops: tops(beside) }), true)
      // the same block across the ray
      const across = box(-2960, -2900, -20, 20)
      assert.equal(await VisibilityMapBuilder.checkExactVisibility(PIN, 712, obs, { buildingTops: tops(across) }), false)
      // behind the observer
      const behind = box(-3060, -3020, -20, 20)
      assert.equal(await VisibilityMapBuilder.checkExactVisibility(PIN, 712, obs, { buildingTops: tops(behind) }), true)
    })
  })
})
