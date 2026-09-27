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
async function withSrtm<T>(read: (lat: number, lng: number) => number | null, fn: () => Promise<T>): Promise<T> {
  const { SRTMLocalService } = await import('../../lib/services/srtm-local-service')
  const { LocalOSMFetcher } = await import('../../lib/services/trigger-points-google/services/local-osm-fetcher')
  const srtm = SRTMLocalService.getInstance() as any
  const osm = LocalOSMFetcher.getInstance() as any
  const original = srtm.getElevation
  const originalSummits = osm.fetchSummits
  srtm.getElevation = async (lat: number, lng: number) => read(lat, lng)
  osm.fetchSummits = () => []
  try {
    return await fn()
  } finally {
    srtm.getElevation = original
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
    assert.equal((VisibilityMapBuilder as any).resolveBuildingHeight({ tags }), 7 * BUILDING_LEVEL_HEIGHT_M)
  })

  it('Cristo (man_made=monument, no height) leaves with the table height, not 0 and not a neighbour', () => {
    const cristo = { man_made: 'monument', landmark: '1', tourism: 'attraction' }
    assert.deepEqual(resolveHeightM(cristo, 24.33), { heightM: 12, source: 'tag_default' })
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
    assert.equal(top.source, 'srtm_boundary_max')
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
    const { classification, physical } = await withSrtm(
      (lat, lng) => (Math.abs(lat - PIN.lat) < 0.001 && Math.abs(lng - PIN.lng) < 0.001 ? 700 : 10),
      () => measureAndClassify({ poiData: poi, boundary: square(20), areaM2: 1600, tags: { man_made: 'monument' } })
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
})

describe('INV-E5a/b/c / BR-AUDIO-010 — class from the physical, rule recorded', () => {
  const flat = { heightM: 0, prominenceM: 0, areaM2: 0 }

  it('INV-E5b: peak/hill is landmark; a hill above the prominence threshold is landmark', () => {
    assert.deepEqual(visibilityClassRule({ ...flat, tags: { natural: 'hill', tourism: 'viewpoint' } }),
      { cls: VisibilityClass.LANDMARK_HIGH, rule: 'natural_relief' })
    assert.deepEqual(visibilityClassRule({ ...flat, prominenceM: LANDMARK_MIN_PROMINENCE_M }),
      { cls: VisibilityClass.LANDMARK_HIGH, rule: 'landmark_prominence' })
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
    await withSrtm(terrain, async () => {
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
    await withSrtm(terrain, async () => {
      assert.equal(await VisibilityMapBuilder.checkExactVisibility(PIN, 712, obs), true)
    })
  })
})
