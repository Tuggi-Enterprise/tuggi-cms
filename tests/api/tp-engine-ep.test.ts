import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  cityDemArea,
  fillSeaAndCountHoles,
  prepareCityDem,
  snapGrid,
  type LayerReader,
} from '../../lib/services/dem/dem-prepare'
import { DEM_LATTICE_DEG, DEM_SOURCES_VERSION, GEDTM30, COPERNICUS_GLO30, copernicusTileName, stampGenerationMethod } from '../../lib/services/dem/dem-sources'
import { DemNotPreparedError, DemStore, type DemGrid } from '../../lib/services/dem/dem-store'
import { fakeObstacles } from './helpers/fake-obstacles'

// TP engine, EP — city preparation of the relief (#782). Targets in
// docs/arquitetura/cms/motor-de-tp.md (INV-EPa/b/c, INV-E4, INV-E8). BR-AUDIO-010.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-ep-'))
after(() => fs.rmSync(tmp, { recursive: true, force: true }))

const AREA = { south: -22.9510, west: -43.2110, north: -22.9490, east: -43.2090 }

/** A layer reader that fills the grid from a function of (row, col), with no network. */
function fakeReader(layer: 'surface' | 'ground', value: (r: number, c: number, g: DemGrid) => number, failures: string[] = []): LayerReader {
  return {
    layer,
    source: layer === 'surface' ? COPERNICUS_GLO30.id : GEDTM30.id,
    version: layer === 'surface' ? COPERNICUS_GLO30.version : GEDTM30.version,
    attribution: layer === 'surface' ? COPERNICUS_GLO30.attribution : GEDTM30.attribution,
    async read(grid) {
      const values = new Float32Array(grid.width * grid.height)
      for (let r = 0; r < grid.height; r++) for (let c = 0; c < grid.width; c++) values[r * grid.width + c] = value(r, c, grid)
      return { values, tiles: [{ name: `${layer}-tile`, url: 'fake://', status: 'downloaded' }], failures }
    },
  }
}

describe('INV-EPa / INV-EPb — EP prepares one city, checks it and writes a manifest (#782)', () => {
  it('INV-EPa: the area is the city plus the TP reach, on the 1-arc-second lattice of both sources', () => {
    const area = cityDemArea([{ lat: -22.95, lng: -43.21 }, { lat: -22.90, lng: -43.17 }], 15_000)
    assert.ok(area.south < -22.95 - 0.13 && area.north > -22.90 + 0.13, 'margin in latitude')
    assert.ok(area.west < -43.21 - 0.14 && area.east > -43.17 + 0.14, 'margin in longitude')
    const g = snapGrid(area)
    assert.ok(Math.abs(g.north / DEM_LATTICE_DEG - Math.round(g.north / DEM_LATTICE_DEG)) < 1e-6)
    assert.ok(Math.abs(g.west / DEM_LATTICE_DEG - Math.round(g.west / DEM_LATTICE_DEG)) < 1e-6)
    assert.ok(g.north >= area.north && g.north - (g.height - 1) * g.res <= area.south)
    assert.ok(g.west <= area.west && g.west + (g.width - 1) * g.res >= area.east)
  })

  it('INV-EPa: the Copernicus tile name carries its south-west degree', () => {
    assert.equal(copernicusTileName(-23, -44), 'Copernicus_DSM_COG_10_S23_00_W044_00_DEM')
    assert.equal(copernicusTileName(40, 9), 'Copernicus_DSM_COG_10_N40_00_E009_00_DEM')
  })

  it('INV-EPb: a good city writes both layers and a manifest with source, version, date and tiles', async () => {
    const m = await prepareCityDem({
      city: 'Cidade Ok', area: AREA, marginM: 15_000, dir: tmp, now: () => new Date('2026-09-27T12:00:00Z'),
      readers: [fakeReader('surface', (r, c) => 100 + r + c + 20), fakeReader('ground', (r, c) => 100 + r + c)],
      obstacles: fakeObstacles(),
    })
    assert.equal(m.status, 'ok')
    assert.deepEqual(m.failures, [])
    assert.equal(m.preparedAt, '2026-09-27T12:00:00.000Z')
    const byLayer = Object.fromEntries(m.layers.map(l => [l.layer, l]))
    assert.equal(byLayer.surface.source, 'copernicus-glo30')
    assert.equal(byLayer.ground.version, GEDTM30.version)
    assert.match(byLayer.surface.attribution, /Copernicus WorldDEM-30/)
    assert.equal(byLayer.ground.tiles.length, 1)
    const dir = path.join(tmp, 'cidade-ok')
    assert.ok(fs.existsSync(path.join(dir, 'manifest.json')))
    assert.equal(fs.statSync(path.join(dir, 'surface.f32')).size, m.grid.width * m.grid.height * 4)
  })

  it('INV-EPb: a missing tile fails the city; its POIs are refused, with no fallback to another source', async () => {
    const m = await prepareCityDem({
      city: 'Cidade Sem Tile', area: { south: -10.001, west: -40.001, north: -9.999, east: -39.999 }, marginM: 0, dir: tmp,
      readers: [fakeReader('surface', () => 50, ['Copernicus_DSM_COG_10_S10_00_W040_00_DEM: HTTP 503']), fakeReader('ground', () => 40)],
    })
    assert.equal(m.status, 'failed')
    assert.match(m.failures.join(), /503/)
    assert.equal(fs.existsSync(path.join(tmp, 'cidade-sem-tile', 'surface.f32')), false, 'no layer file for a failed city')
    const store = new DemStore(tmp)
    assert.equal(store.ground(-10, -40), null, 'nothing is read from a failed city')
    const cover = store.coverage(-10, -40, 50)
    assert.equal(cover.ok, false)
    assert.match(cover.ok ? '' : cover.reason, /Cidade Sem Tile: .*503/)
  })

  it('INV-EPa: no-data over land fails the city; sea (both layers at sea level or empty) is filled', () => {
    // open ocean (no surface tile), sea inside a tile, land under a missing tile, land hole, void in both
    const surface = new Float32Array([NaN, 0.5, NaN, 300, NaN])
    const ground = new Float32Array([NaN, NaN, 250, NaN, NaN])
    const checks = fillSeaAndCountHoles(surface, ground, new Uint8Array([1, 0, 1, 0, 0]))
    assert.deepEqual(checks, { seaCells: 2, landHoles: 3 })
    assert.equal(surface[0], 0)
    assert.equal(ground[0], 0)
    assert.equal(ground[1], 0.5)
  })

  it('INV-EPa: a city with a hole over land does not generate', async () => {
    const m = await prepareCityDem({
      city: 'Cidade Com Buraco', area: { south: 10.999, west: 20.999, north: 11.001, east: 21.001 }, marginM: 0, dir: tmp,
      readers: [fakeReader('surface', (r, c) => (r === 2 && c === 2 ? NaN : 80)), fakeReader('ground', (r, c) => (r === 2 && c === 2 ? NaN : 70))],
    })
    assert.equal(m.status, 'failed')
    assert.match(m.failures.join(), /without data over land/)
  })
})

describe('INV-EPc / INV-E4 — E1–E11 read the relief from disk only, bilinear, never rounded', () => {
  it('INV-EPc: reads work with the network cut off', async () => {
    const realFetch = globalThis.fetch
    globalThis.fetch = (() => { throw new Error('network is off in E1–E11') }) as typeof fetch
    try {
      const store = new DemStore(tmp)
      assert.equal(store.coverage(-22.95, -43.21, 10).ok, true)
      assert.notEqual(store.ground(-22.95, -43.21), null)
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it('INV-E4: bilinear between the four pixel centres, with the decimals', () => {
    const store = new DemStore(tmp)
    const m = JSON.parse(fs.readFileSync(path.join(tmp, 'cidade-ok', 'manifest.json'), 'utf8'))
    const g: DemGrid = m.grid
    // ground = 100 + r + c: a quarter cell south-east of pixel (1, 1) reads 102.5
    const lat = g.north - 1.25 * g.res
    const lng = g.west + 1.25 * g.res
    assert.ok(Math.abs(store.ground(lat, lng)! - 102.5) < 1e-3, String(store.ground(lat, lng)))
    assert.ok(Math.abs(store.obstacleHeight(lat, lng)! - 20) < 1e-3, 'surface − ground: what stands on the ground')
  })

  it('INV-EPb: a layer file that no longer matches its manifest is refused, not read', () => {
    const dir = path.join(tmp, 'cidade-adulterada')
    fs.cpSync(path.join(tmp, 'cidade-ok'), dir, { recursive: true })
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
    // move it elsewhere so it does not overlap the good city
    manifest.grid.north += 10
    manifest.city = 'Cidade Adulterada'
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest))
    const buf = fs.readFileSync(path.join(dir, 'ground.f32'))
    buf[0] ^= 0xff
    fs.writeFileSync(path.join(dir, 'ground.f32'), buf)
    const store = new DemStore(tmp)
    const cover = store.coverage(-12.95, -43.21, 10)
    assert.equal(cover.ok, false)
    assert.match(cover.ok ? '' : cover.reason, /sha256/)
    fs.rmSync(dir, { recursive: true })
  })

  it('INV-EPb: the engine refuses a POI whose city relief is not prepared, before E1', async () => {
    const { CoreTriggerPointPredictor } = await import('../../lib/services/trigger-points-google/core/trigger-point-predictor')
    const dem = DemStore.getInstance() as any
    const original = dem.coverage
    dem.coverage = () => ({ ok: false, reason: 'EP: no prepared relief covers the pin' })
    try {
      await assert.rejects(
        new CoreTriggerPointPredictor().predictTriggerPointsComplete({ id: 'x', name: 'x', location: { lat: 1, lng: 1 } } as any),
        (e: unknown) => e instanceof DemNotPreparedError && /no prepared relief/.test((e as Error).message),
      )
    } finally {
      dem.coverage = original
    }
  })

  it('#782: the relief version travels in the generation_method, once', () => {
    assert.match(DEM_SOURCES_VERSION, /copernicus-glo30:.*\+gedtm30:v1\.2\.0/)
    const stamped = stampGenerationMethod('local_osm_osm')
    assert.equal(stamped, `local_osm_osm|dem=${DEM_SOURCES_VERSION}`)
    assert.equal(stampGenerationMethod(stamped), stamped)
  })
})

describe('INV-E8 / INV-E4 / BR-AUDIO-010 — the sight line walks the surface at the grid spacing, from the ground (#782)', () => {
  const PIN = { lat: -22.9519, lng: -43.2105 }
  const at = (n: number, e: number) => ({ lat: PIN.lat + n / 110_540, lng: PIN.lng + e / (111_320 * Math.cos((PIN.lat * Math.PI) / 180)) })

  async function withRelief<T>(ground: (lat: number, lng: number) => number | null, surface: (lat: number, lng: number) => number | null, fn: () => Promise<T>): Promise<T> {
    const dem = DemStore.getInstance() as any
    const original = { ground: dem.ground, surface: dem.surface, cell: dem.cell }
    dem.ground = ground
    dem.surface = surface
    dem.cell = () => null // no measured building or canopy: the surface alone (#783 layers tested in tp-engine-ep-obstacles)
    try {
      return await fn()
    } finally {
      dem.ground = original.ground
      dem.surface = original.surface
      dem.cell = original.cell
    }
  }

  it('INV-E8: curvature minus standard refraction (k = 0.13)', async () => {
    const { curvatureDropM, REFRACTION_K } = await import('../../lib/services/trigger-points-google/analyzers/visibility-map-builder')
    assert.equal(REFRACTION_K, 0.13)
    assert.ok(Math.abs(curvatureDropM(10_000) - (0.87 * 1e8) / (2 * 6_371_000)) < 1e-9)
  })

  it('INV-E8: a block of buildings in the SURFACE hides a low POI; the bare ground alone would not', async () => {
    const { VisibilityMapBuilder } = await import('../../lib/services/trigger-points-google/analyzers/visibility-map-builder')
    const obs = at(-1000, 0)
    const blockLat = at(-500, 0).lat
    const ground = () => 5
    const withBlock = (lat: number) => (Math.abs(lat - blockLat) < 0.0004 ? 35 : 5) // 30 m of buildings, 90 m deep
    await withRelief(ground, withBlock, async () => {
      assert.equal(await VisibilityMapBuilder.checkExactVisibility(PIN, 5 + 10, obs), false)
    })
    await withRelief(ground, ground, async () => {
      assert.equal(await VisibilityMapBuilder.checkExactVisibility(PIN, 5 + 10, obs), true)
    })
  })

  it('INV-E8: a 35 m wide ridge between two 100 m steps still blocks: the walk is at the grid spacing', async () => {
    const { VisibilityMapBuilder } = await import('../../lib/services/trigger-points-google/analyzers/visibility-map-builder')
    const obs = at(-3000, 0)
    // centred on 1,550 m: the old 100 m walk sampled 1,500 and 1,600 and never saw it
    const lo = at(-1567, 0).lat, hi = at(-1532, 0).lat
    const ridge = (lat: number) => (lat >= lo && lat <= hi ? 600 : 5)
    await withRelief(() => 5, ridge, async () => {
      assert.equal(await VisibilityMapBuilder.checkExactVisibility(PIN, 305, obs), false)
      assert.equal(await VisibilityMapBuilder.checkExactVisibility(PIN, 305, obs, { sampleIntervalM: 100 }), true, 'the 100 m walk misses it')
    })
  })

  it("INV-E8: the observer eye stands on the GROUND, not on the canopy or roof of his own cell", async () => {
    const { VisibilityMapBuilder } = await import('../../lib/services/trigger-points-google/analyzers/visibility-map-builder')
    const obs = at(-2000, 0)
    // trees 20 m tall right over the observer (his own cell); open ground elsewhere
    const canopy = (lat: number) => (Math.abs(lat - obs.lat) < 0.0001 ? 25 : 5)
    await withRelief(() => 5, canopy, async () => {
      assert.equal(await VisibilityMapBuilder.checkExactVisibility(PIN, 50, obs), true)
    })
  })

  it('INV-E8: no ground under the candidate — it cannot be judged, so it does not pass', async () => {
    const { VisibilityMapBuilder } = await import('../../lib/services/trigger-points-google/analyzers/visibility-map-builder')
    await withRelief(() => null, () => null, async () => {
      assert.equal(await VisibilityMapBuilder.checkExactVisibility(PIN, 50, at(-2000, 0)), false)
    })
  })

  it('INV-E4: the POI ground is the bare terrain (GEDTM30), not the surface', async () => {
    const { ElevationAnalysisService } = await import('../../lib/services/trigger-points-google/services/elevation-service')
    await withRelief(() => 100, () => 150, async () => {
      const top = await ElevationAnalysisService.groundTop({ pin: PIN })
      assert.equal(top.groundM, 100)
      assert.equal(top.source, 'dem_boundary_max')
    })
  })

  it('INV-E3 / #782: a host building without a tag takes the height the relief measured, never 6 m or 10 m', async () => {
    const { CoreTriggerPointPredictor } = await import('../../lib/services/trigger-points-google/core/trigger-point-predictor')
    const sq = [at(-10, -10), at(-10, 10), at(10, 10), at(10, -10)]
    const boundary: any = { center: PIN, area_m2: 400, height: 0, buildings: [{ geometry: sq, tags: { building: 'yes' } }] }
    const dem = DemStore.getInstance() as any
    const original = { obstacleHeight: dem.obstacleHeight, cell: dem.cell }
    dem.obstacleHeight = () => 17.5
    dem.cell = () => null // no measured height in the buildings layer (#783): surface − ground
    try {
      ;(new CoreTriggerPointPredictor() as any).useContainingBuildingHeight(boundary)
      assert.equal(boundary.height, 17.5)
    } finally {
      dem.obstacleHeight = original.obstacleHeight
      dem.cell = original.cell
    }
  })
})
