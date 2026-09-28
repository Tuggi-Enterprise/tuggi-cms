import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isPublicWay } from '../../lib/services/trigger-points-google/config/visibility-class'

// TP engine calibration, 2026-09-27, round F (#772). Spec: docs/arquitetura/cms/motor-de-tp.md.

describe('BR-AUDIO-010, INV-E7a — no TP on a way closed to the public', () => {
  it('access=private|no|military and military=* close the way; a mode tag reopens it', () => {
    assert.equal(isPublicWay({ highway: 'service', access: 'private' }), false) // Doca 11 de Junho (Ilha Fiscal)
    assert.equal(isPublicWay({ highway: 'service', access: 'no' }), false)
    assert.equal(isPublicWay({ highway: 'service', access: 'military' }), false)
    assert.equal(isPublicWay({ highway: 'service', military: 'naval_base' }), false)
    assert.equal(isPublicWay({ highway: 'pedestrian', access: 'no', foot: 'yes' }), true)
    assert.equal(isPublicWay({ highway: 'residential', access: 'destination' }), true)
    assert.equal(isPublicWay({ highway: 'primary' }), true)
    assert.equal(isPublicWay(undefined), true)
  })
})

describe('INV-E3 — the engine never reads a registered height', () => {
  it('buildEngineInput carries no estimated_height_m', async () => {
    const { PoiMigrationPipeline } = await import('../../lib/services/poi-migration-pipeline')
    const input = PoiMigrationPipeline.buildEngineInput(
      { id: 'x', name: 'X', estimated_height_m: 120, osm_tags: { height: '12' } },
      { latitude: -22.9, longitude: -43.2 },
    ) as Record<string, unknown>
    assert.equal('height' in input, false)
    assert.deepEqual(input.tags, { height: '12' }) // a measured OSM tag still reaches the engine
  })
})

describe('BR-AUDIO-010, INV-E10d — an area gets one TP per perimeter sector with a street in reach, above the class cap', () => {
  // 1 km × 1 km square: 4,000 m of edge, 16 sectors of PERIMETER_SECTOR_M
  const O = { lat: -22.9, lng: -43.2 }
  const kx = 111_320 * Math.cos((O.lat * Math.PI) / 180)
  const at = (e: number, n: number) => ({ lat: O.lat + n / 110_540, lng: O.lng + e / kx })
  const ring = [at(0, 0), at(1000, 0), at(1000, 1000), at(0, 1000), at(0, 0)]
  const tp = (e: number, n: number, bearing: number, type = 'residential') => ({
    location: at(e, n), distance: 30, radius: 20, quality: 0.8, expectedBearing: bearing, street: { type },
  }) as any

  it('perimeterSectors cuts the edge into equal sectors of PERIMETER_SECTOR_M', async () => {
    const { perimeterSectors } = await import('../../lib/services/trigger-points-google/utils/tp-selection')
    const { count, sectorOf } = perimeterSectors(ring)
    assert.equal(count, 16)
    assert.equal(sectorOf(at(100, -30)), 0)
    assert.equal(sectorOf(at(1030, 100)), 4)
  })

  it('20 candidates, one every 200 m along the south and east sides: every sector they reach wins, cap 4 notwithstanding', async () => {
    const { selectSpacedTriggerPoints, perimeterSectors } = await import('../../lib/services/trigger-points-google/utils/tp-selection')
    const { VisibilityClass } = await import('../../lib/services/trigger-points-google/config/visibility-class')
    const cands = [
      ...[100, 300, 500, 700, 900].map(e => tp(e, -30, 0)),
      ...[100, 300, 500, 700, 900].map(n => tp(1030, n, 270)),
    ]
    const cls = { group: VisibilityClass.AREA, maxTriggerPoints: 4, maxFarTriggerPoints: 0, minDistanceBetweenTPs: 100 }
    const out = selectSpacedTriggerPoints(cands, cls, at(500, 500), undefined, ring)
    const { sectorOf } = perimeterSectors(ring)
    const reached = new Set(cands.map(c => sectorOf(c.location)))
    assert.deepEqual(new Set(out.map(t => sectorOf(t.location))), reached)
  })

  it('inside a sector a car street wins over a footway', async () => {
    const { selectSpacedTriggerPoints } = await import('../../lib/services/trigger-points-google/utils/tp-selection')
    const { VisibilityClass } = await import('../../lib/services/trigger-points-google/config/visibility-class')
    const foot = tp(125, -5, 0, 'footway')
    const avenue = tp(125, -55, 0, 'trunk')
    const out = selectSpacedTriggerPoints([foot, avenue], { group: VisibilityClass.AREA, maxTriggerPoints: 16, minDistanceBetweenTPs: 100 }, at(500, 500), undefined, ring)
    assert.deepEqual(out, [avenue])
  })
})

describe('BR-AUDIO-010, E1 — a hill with no mapped footprint takes the slope measured on the DEM', () => {
  const PIN = { lat: -22.8355, lng: -43.0736 }
  const kx = 111_320 * Math.cos((PIN.lat * Math.PI) / 180)
  const distM = (lat: number, lng: number) => Math.hypot((lat - PIN.lat) * 110_540, (lng - PIN.lng) * kx)

  it('a cone 100 m over a 10 m base, 300 m of slope: the foot (1/3 of the relief) is ~200 m out', async () => {
    const { ElevationAnalysisService } = await import('../../lib/services/trigger-points-google/services/elevation-service')
    const cone = async (lat: number, lng: number) => Math.max(10, 100 - (90 * distM(lat, lng)) / 300)
    const ring = await ElevationAnalysisService.reliefFootprint(PIN, 10, cone)
    assert.ok(ring)
    for (const p of ring!) assert.ok(Math.abs(distM(p.lat, p.lng) - 200) < 5, `foot at ${distM(p.lat, p.lng)} m`)
    assert.deepEqual(ring![0], ring![ring!.length - 1])
  })

  it('flat ground (urban SRTM noise under RELIEF_MIN_M) has no relief footprint', async () => {
    const { ElevationAnalysisService } = await import('../../lib/services/trigger-points-google/services/elevation-service')
    assert.equal(await ElevationAnalysisService.reliefFootprint(PIN, 10, async () => 25), null)
  })
})
