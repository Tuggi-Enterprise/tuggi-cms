import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { prepareCityDem, snapGrid, type LayerReader } from '../../lib/services/dem/dem-prepare'
import {
  BuildingRaster,
  RowPercentile,
  decodeBuilding,
  quadkeyBox,
  rasterizeRing,
  readShapefilePolygons,
  type Ring,
} from '../../lib/services/dem/obstacle-prepare'
import { BUILDING_TIER, COPERNICUS_GLO30, DEM_SOURCES_VERSION, GEDTM30 } from '../../lib/services/dem/dem-sources'
import { DemStore, obstacleGrid, type DemGrid } from '../../lib/services/dem/dem-store'
import {
  STRUCTURE_BUILT_SHARE_MIN,
  footprintStructureHeight,
  resolveHeightM,
} from '../../lib/services/trigger-points-google/config/visibility-class'
import { fakeBuildings, fakeCanopy, fakeObstacles } from './helpers/fake-obstacles'

// TP engine, EP measured obstacles (#783): building height (Overture, 3D-GloBFP) and canopy
// (Meta/WRI) as layers of the city preparation, read by E3 (POI height), E2 (host) and E8
// (sight line). Targets in docs/arquitetura/cms/motor-de-tp.md (INV-EPa/b, INV-E3, INV-E8). BR-AUDIO-010.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-ep-obs-'))
after(() => fs.rmSync(tmp, { recursive: true, force: true }))

const AREA = { south: -10.5020, west: -40.5020, north: -10.4980, east: -40.4980 }
const GRID = snapGrid(AREA)
const OG = obstacleGrid(GRID)
/** Ring around obstacle cells rows r0..r1 × cols c0..c1 (cell centres inside, edges half a cell out). */
const cellsRing = (r0: number, r1: number, c0: number, c1: number): Ring => {
  const lng = (c: number) => OG.west + c * OG.res, lat = (r: number) => OG.north - r * OG.res
  return [[lng(c0 - 0.5), lat(r0 - 0.5)], [lng(c1 + 0.5), lat(r0 - 0.5)], [lng(c1 + 0.5), lat(r1 + 0.5)], [lng(c0 - 0.5), lat(r1 + 0.5)], [lng(c0 - 0.5), lat(r0 - 0.5)]]
}
const cellCentre = (r: number, c: number) => ({ lat: OG.north - r * OG.res, lng: OG.west + c * OG.res })

function flat(layer: 'surface' | 'ground', v: number): LayerReader {
  return {
    layer,
    source: layer === 'surface' ? COPERNICUS_GLO30.id : GEDTM30.id,
    version: 'test',
    attribution: 'test',
    async read(grid: DemGrid) {
      return { values: new Float32Array(grid.width * grid.height).fill(v), tiles: [], failures: [] }
    },
  }
}

// ground 100, surface 130 everywhere (the GLO-30 smear of a dense block)
const RELIEF = () => [flat('surface', 130), flat('ground', 100)]
const STADIUM = cellsRing(4, 9, 4, 9) // 36 cells
const TOWER = cellsRing(6, 6, 6, 6)
const SHED = cellsRing(12, 13, 12, 13) // no height anywhere
const TREES = (r: number, c: number) => (r >= 16 && r <= 18 && c >= 2 && c <= 4 ? 45 : 0)

describe('INV-EPa / INV-EPb — the measured obstacles are layers of the city preparation (#783)', () => {
  it('INV-EPa: a footprint marks the cells whose centre it covers; one narrower than a cell still marks its own', () => {
    const hits: number[] = []
    rasterizeRing(OG, cellsRing(2, 3, 5, 5), i => hits.push(i))
    assert.deepEqual(hits.sort((a, b) => a - b), [2 * OG.width + 5, 3 * OG.width + 5])
    const tiny: number[] = []
    const c = cellCentre(8, 8), d = OG.res / 10
    rasterizeRing(OG, [[c.lng - d, c.lat - d], [c.lng + d, c.lat - d], [c.lng + d, c.lat + d], [c.lng - d, c.lat - d]], i => tiny.push(i))
    assert.deepEqual(tiny, [8 * OG.width + 8])
  })

  it('INV-EPa: in one cell the measured source wins over the unmeasured one, Overture over 3D-GloBFP, and the taller within a tier', () => {
    const r = new BuildingRaster(OG)
    const i = 6 * OG.width + 6
    r.add(TOWER, BUILDING_TIER.UNMEASURED, null)
    assert.deepEqual(decodeBuilding(r.cells[i]), { tier: BUILDING_TIER.UNMEASURED, heightM: 0 })
    r.add(TOWER, BUILDING_TIER.GLOBFP, 80)
    r.add(TOWER, BUILDING_TIER.GLOBFP, 22.4)
    assert.deepEqual(decodeBuilding(r.cells[i]), { tier: BUILDING_TIER.GLOBFP, heightM: 80 })
    r.add(TOWER, BUILDING_TIER.OVERTURE, 61.3)
    assert.deepEqual(decodeBuilding(r.cells[i]), { tier: BUILDING_TIER.OVERTURE, heightM: 61.3 })
    r.add(TOWER, BUILDING_TIER.UNMEASURED, null)
    assert.deepEqual(decodeBuilding(r.cells[i]), { tier: BUILDING_TIER.OVERTURE, heightM: 61.3 }, 'no height never erases a measured one')
  })

  it('INV-EPa: canopy is the 90th percentile of the 1 m pixels of a cell — a crown over a tenth of it stands, a lone pixel does not', () => {
    const out = new Uint8Array(2)
    const p = new RowPercentile(2, out)
    for (let k = 0; k < 100; k++) p.add(0, 0, k < 85 ? 0 : 20) // 15 % under crown
    for (let k = 0; k < 100; k++) p.add(0, 1, k < 97 ? 0 : 40) // 3 % — a spike
    p.flush()
    assert.deepEqual([...out], [20, 0])
  })

  it('INV-EPa: the canopy tile georeference is its quadkey tile (211200012, over Rio)', () => {
    const b = quadkeyBox('211200012')
    assert.ok(Math.abs(b.x0 - -4852834.05176927) < 0.01)
    assert.ok(Math.abs(b.y0 - -2582960.059812676) < 0.01)
    assert.ok(Math.abs(b.size - 65536 * 1.1943285669558747) < 0.01)
  })

  it('INV-EPa: the 3D-GloBFP shapefile is read inside the area only, with the Height of its record', () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'shp-'))
    const polys: Array<{ ring: Ring; h: number }> = [
      { ring: [[-40.5, -10.5], [-40.5, -10.499], [-40.499, -10.499], [-40.499, -10.5], [-40.5, -10.5]], h: 12.5 }, // clockwise
      { ring: [[10, 10], [10, 10.001], [10.001, 10.001], [10.001, 10], [10, 10]], h: 99 }, // outside
    ]
    writeShapefile(path.join(dir, 't'), polys)
    const got: Array<[number, number | null]> = []
    const n = readShapefilePolygons(path.join(dir, 't.shp'), path.join(dir, 't.dbf'), 'Height', AREA, (ring, h) => got.push([ring.length, h]))
    assert.equal(n, 1)
    assert.deepEqual(got, [[5, 12.5]])
  })

  it('INV-EPb: a good city writes the buildings and canopy layers on the obstacle lattice, with source and tiles in the manifest', async () => {
    const m = await prepareCityDem({
      city: 'Cidade Obstaculos', area: AREA, marginM: 0, dir: tmp, readers: RELIEF(),
      obstacles: fakeObstacles(
        [
          fakeBuildings('overture', [{ ring: TOWER, heightM: 61.3 }, { ring: SHED, heightM: null }]),
          fakeBuildings('3d-globfp', [{ ring: STADIUM, heightM: 38 }]),
        ],
        fakeCanopy(TREES)
      ),
    })
    assert.equal(m.status, 'ok', m.failures.join())
    assert.deepEqual(m.obstacleGrid, OG)
    const byLayer = Object.fromEntries(m.layers.map(l => [l.layer, l]))
    assert.deepEqual(Object.keys(byLayer).sort(), ['buildings', 'canopy', 'ground', 'surface'])
    assert.match(byLayer.buildings.attribution, /Overture/)
    assert.match(byLayer.buildings.attribution, /3D-GloBFP/)
    assert.match(byLayer.canopy.attribution, /WRI and Meta/)
    assert.equal(byLayer.buildings.tiles.length, 2)
    assert.deepEqual(m.checks.buildings, { overture: 1, globfp: 1, unmeasured: 1, cells: 36 + 4, globfpCalibrated: { tiles: 0, cells: 0 } })
    assert.equal(m.checks.canopy?.treeCells, 9)
    const dir = path.join(tmp, 'cidade-obstaculos')
    assert.equal(fs.statSync(path.join(dir, 'buildings.u16')).size, OG.width * OG.height * 2)
    assert.equal(fs.statSync(path.join(dir, 'canopy.u8')).size, OG.width * OG.height)
    assert.match(DEM_SOURCES_VERSION, /overture-buildings:.*\+3d-globfp:v2\+meta-wri-chm:v1/)
  })

  it('INV-EPb: a building source that cannot be read fails the city — no fallback, no layer file', async () => {
    const m = await prepareCityDem({
      city: 'Cidade Sem Overture', area: { south: -11.502, west: -41.502, north: -11.498, east: -41.498 }, marginM: 0, dir: tmp, readers: RELIEF(),
      obstacles: fakeObstacles([fakeBuildings('overture', [], ['overture part-00079: HTTP 503']), fakeBuildings('3d-globfp')]),
    })
    assert.equal(m.status, 'failed')
    assert.match(m.failures.join(), /503/)
    assert.equal(fs.existsSync(path.join(tmp, 'cidade-sem-overture', 'buildings.u16')), false)
  })

  it('INV-EPb: land with no canopy tile fails the city (a hole over land)', async () => {
    const m = await prepareCityDem({
      city: 'Cidade Sem Copa', area: { south: -12.502, west: -42.502, north: -12.498, east: -42.498 }, marginM: 0, dir: tmp, readers: RELIEF(),
      obstacles: fakeObstacles(undefined, fakeCanopy(() => 0, (r, c) => !(r === 3 && c === 3))),
    })
    assert.equal(m.status, 'failed')
    assert.match(m.failures.join(), /1 land cells without a canopy tile/)
  })

  it('INV-EPb: a city prepared before #783 (relief only) is refused until prepared again', () => {
    const dir = path.join(tmp, 'cidade-antiga')
    fs.cpSync(path.join(tmp, 'cidade-obstaculos'), dir, { recursive: true })
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
    manifest.city = 'Cidade Antiga'
    manifest.grid.north += 20
    delete manifest.obstacleGrid
    manifest.layers = manifest.layers.filter((l: { layer: string }) => l.layer === 'surface' || l.layer === 'ground')
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest))
    const cover = new DemStore(tmp).coverage(-10.5 + 20, -40.5, 10)
    assert.equal(cover.ok, false)
    assert.match(cover.ok ? '' : cover.reason, /lacks the buildings, canopy layer — run scripts\/prepare-city-dem\.ts again/)
    fs.rmSync(dir, { recursive: true })
  })
})

describe('INV-EPa / INV-E8 — 3D-GloBFP is rescaled where Overture measured it lower, tile by tile (#772)', () => {
  /** 30 one-cell buildings, Overture then 3D-GloBFP on the same cell: 30 pairs in the only tile. */
  const paired = (r: BuildingRaster, ov: (k: number) => number, gf: number) => {
    let k = 0
    for (let row = 14; row <= 19; row++) for (let col = 14; col <= 18; col++, k++) r.add(cellsRing(row, row, col, col), BUILDING_TIER.OVERTURE, ov(k))
    for (let row = 14; row <= 19; row++) for (let col = 14; col <= 18; col++) r.add(cellsRing(row, row, col, col), BUILDING_TIER.GLOBFP, gf)
  }
  const at = (r: BuildingRaster, row: number, col: number) => decodeBuilding(r.cells[row * OG.width + col])

  it('INV-EPa / INV-E8: houses measured at 5 m that 3D-GloBFP puts at 15 m pull the unpaired 3D-GloBFP houses of the tile to a third (Engenho de Dentro)', () => {
    const r = new BuildingRaster(OG)
    paired(r, () => 5, 15)
    r.add(cellsRing(22, 22, 22, 22), BUILDING_TIER.GLOBFP, 18)
    r.add(STADIUM, BUILDING_TIER.GLOBFP, 38.6)
    assert.deepEqual(r.calibrateGlobfp(), { tiles: 1, cells: 1 })
    assert.deepEqual(at(r, 22, 22), { tier: BUILDING_TIER.GLOBFP, heightM: 6 }, '18 m × 5/15')
    assert.deepEqual(at(r, 16, 16), { tier: BUILDING_TIER.OVERTURE, heightM: 5 }, 'Overture is never touched')
    assert.deepEqual(at(r, 6, 6), { tier: BUILDING_TIER.GLOBFP, heightM: 38.6 }, 'a footprint larger than every paired one has no evidence: it keeps its estimate')
  })

  it('INV-EPa: where the pairs split — half above, half below, like the towers of Copacabana — nothing moves; and never up', () => {
    const split = new BuildingRaster(OG)
    paired(split, k => (k % 2 ? 5 : 30), 15)
    split.add(cellsRing(22, 22, 22, 22), BUILDING_TIER.GLOBFP, 18)
    assert.deepEqual(split.calibrateGlobfp(), { tiles: 0, cells: 0 })
    assert.equal(at(split, 22, 22).heightM, 18)
    const low = new BuildingRaster(OG)
    paired(low, () => 30, 15)
    low.add(cellsRing(22, 22, 22, 22), BUILDING_TIER.GLOBFP, 18)
    assert.deepEqual(low.calibrateGlobfp(), { tiles: 0, cells: 0 })
    assert.equal(at(low, 22, 22).heightM, 18, '3D-GloBFP lower than Overture is not raised')
  })

  it('INV-EPa: fewer than GLOBFP_CAL_MIN_PAIRS pairs is no evidence', () => {
    const r = new BuildingRaster(OG)
    for (let col = 14; col <= 18; col++) {
      r.add(cellsRing(14, 14, col, col), BUILDING_TIER.OVERTURE, 5)
      r.add(cellsRing(14, 14, col, col), BUILDING_TIER.GLOBFP, 15)
    }
    r.add(cellsRing(22, 22, 22, 22), BUILDING_TIER.GLOBFP, 18)
    assert.deepEqual(r.calibrateGlobfp(), { tiles: 0, cells: 0 })
  })
})

describe('INV-E3 — the POI height comes from the buildings measured on its footprint, never from its type (#783)', () => {
  it('INV-E3: order — OSM height tag → OSM building inside → buildings layer → 0', () => {
    const fp = { heightM: 38, source: '3d-globfp' as const }
    assert.deepEqual(resolveHeightM({ height: '12' }, 20, fp), { heightM: 12, source: 'height' })
    assert.deepEqual(resolveHeightM({}, 20, fp), { heightM: 20, source: 'known' })
    assert.deepEqual(resolveHeightM({}, undefined, fp), { heightM: 38, source: '3d-globfp' })
    assert.deepEqual(resolveHeightM({}, undefined, null), { heightM: 0, source: 'none' })
  })

  it('INV-E3: a footprint that is a building lends its height; the park is not its kiosk, the neighbourhood not its tower', () => {
    const stadium = { cells: 299, builtCells: 299, heightM: 68.7, source: '3d-globfp' as const } // Nilton Santos
    const neighbourhood = { cells: 7608, builtCells: 3884, heightM: 86, source: 'overture' as const } // Maracanã (bairro), 51 %
    const park = { cells: 100, builtCells: 1, heightM: 9, source: 'overture' as const } // Lagoa, 1 %
    assert.ok(STRUCTURE_BUILT_SHARE_MIN > 0.51 && STRUCTURE_BUILT_SHARE_MIN <= 0.83)
    assert.deepEqual(footprintStructureHeight(stadium), { heightM: 68.7, source: '3d-globfp' })
    assert.equal(footprintStructureHeight(neighbourhood), null)
    assert.equal(footprintStructureHeight(park), null)
  })

  it('INV-E3 / INV-E1b: a synthetic circle is not a footprint — the building under the pin does not lend its height', async () => {
    const { measureAndClassify } = await import('../../lib/services/trigger-points-google/services/poi-classifier.service')
    const dem = DemStore.getInstance() as any
    const original = dem.footprintBuildings
    dem.footprintBuildings = () => ({ cells: 2, builtCells: 2, heightM: 27.5, source: '3d-globfp' })
    const pin = { lat: -22.9519, lng: -43.2105 }
    const d = 10 / 110_540
    const circle = [{ lat: pin.lat - d, lng: pin.lng - d }, { lat: pin.lat - d, lng: pin.lng + d }, { lat: pin.lat + d, lng: pin.lng + d }, { lat: pin.lat + d, lng: pin.lng - d }]
    const poiData = { id: 'x', name: 'x', city: 'Rio de Janeiro', location: pin } as any
    try {
      const synthetic = await measureAndClassify({ poiData, boundary: circle, synthetic: true, areaM2: 314 })
      assert.deepEqual([synthetic.physical.heightM, synthetic.physical.heightSource], [0, 'none'])
      const real = await measureAndClassify({ poiData, boundary: circle, synthetic: false, areaM2: 400 })
      assert.deepEqual([real.physical.heightM, real.physical.heightSource], [27.5, '3d-globfp'])
    } finally {
      dem.footprintBuildings = original
    }
  })

  it('INV-E3: on the footprint, Overture beats 3D-GloBFP; with no measured height it is surface − ground, marked', () => {
    const store = new DemStore(tmp)
    const toLatLng = (ring: Ring) => ring.map(([lng, lat]) => ({ lat, lng }))
    const stadium = store.footprintBuildings(toLatLng(STADIUM))
    assert.equal(stadium.cells, 36)
    assert.equal(stadium.builtCells, 36)
    assert.deepEqual([stadium.heightM, stadium.source], [61.3, 'overture'], 'the tower (Overture) inside the stadium footprint')
    const shed = store.footprintBuildings(toLatLng(SHED))
    assert.deepEqual([shed.builtCells, shed.source], [4, 'dem_surface'])
    assert.ok(Math.abs(shed.heightM! - 30) < 1e-3, 'surface 130 − ground 100, never a made-up number')
    const open = store.footprintBuildings(toLatLng(cellsRing(1, 2, 14, 15)))
    assert.deepEqual([open.builtCells, open.heightM, open.source], [0, null, null])
  })

  it('INV-E3: a 3D-GloBFP estimate is the building that covers the footprint, not its tallest sub-footprint', async () => {
    const area = { south: -13.502, west: -43.502, north: -13.498, east: -43.498 }
    const og = obstacleGrid(snapGrid(area))
    const lng = (c: number) => og.west + c * og.res, lat = (r: number) => og.north - r * og.res
    const ring = (r0: number, r1: number, c0: number, c1: number): Ring =>
      [[lng(c0 - 0.5), lat(r0 - 0.5)], [lng(c1 + 0.5), lat(r0 - 0.5)], [lng(c1 + 0.5), lat(r1 + 0.5)], [lng(c0 - 0.5), lat(r1 + 0.5)], [lng(c0 - 0.5), lat(r0 - 0.5)]]
    const museum = ring(4, 9, 4, 9)
    const m = await prepareCityDem({
      city: 'Cidade Estimada', area, marginM: 0, dir: tmp, readers: RELIEF(),
      obstacles: fakeObstacles([fakeBuildings('overture'), fakeBuildings('3d-globfp', [{ ring: museum, heightM: 10.2 }, { ring: ring(6, 7, 6, 7), heightM: 70.7 }])]),
    })
    assert.equal(m.status, 'ok')
    const fp = new DemStore(tmp).footprintBuildings(museum.map(([x, y]) => ({ lat: y, lng: x })))
    assert.deepEqual([fp.heightM, fp.source], [10.2, '3d-globfp'])
  })

  it('INV-E3 (E2): a host building takes the measured tier of the layer before surface − ground', () => {
    const store = new DemStore(tmp)
    const s = cellCentre(5, 5)
    assert.deepEqual(store.buildingAt(s.lat, s.lng), { heightM: 38, source: '3d-globfp' })
    const shed = cellCentre(12, 12)
    const b = store.buildingAt(shed.lat, shed.lng)!
    assert.equal(b.source, 'dem_surface')
    assert.ok(Math.abs(b.heightM - 30) < 1e-3)
  })
})

describe('INV-E8 — measured buildings and trees are obstacles over the ground, without the surface counted twice (#783)', () => {
  it('INV-E8: a measured building is ground + its height, not the surface of its cell', () => {
    const store = new DemStore(tmp)
    const stands = cellCentre(5, 5)
    assert.ok(Math.abs(store.obstacle(stands.lat, stands.lng)! - (100 + 38)) < 1e-3)
    const tower = cellCentre(6, 6)
    assert.ok(Math.abs(store.obstacle(tower.lat, tower.lng)! - (100 + 61.3)) < 1e-3)
  })

  it('INV-E8: a footprint with no height, and open ground, stay on the surface; trees above it stand', () => {
    const store = new DemStore(tmp)
    const shed = cellCentre(12, 12)
    assert.ok(Math.abs(store.obstacle(shed.lat, shed.lng)! - 130) < 1e-3)
    const open = cellCentre(1, 14)
    assert.ok(Math.abs(store.obstacle(open.lat, open.lng)! - 130) < 1e-3)
    const trees = cellCentre(17, 3)
    assert.ok(Math.abs(store.obstacle(trees.lat, trees.lng)! - 145) < 1e-3, 'ground 100 + canopy 45 over a surface of 130')
  })

  it('INV-E8: the sight line walks the obstacle lattice (~15 m): a 10 m deep obstacle between two relief cells blocks', async () => {
    const { VisibilityMapBuilder } = await import('../../lib/services/trigger-points-google/analyzers/visibility-map-builder')
    const dem = DemStore.getInstance() as any
    const PIN = { lat: -22.9519, lng: -43.2105 }
    const at = (n: number) => ({ lat: PIN.lat + n / 110_540, lng: PIN.lng })
    const obs = at(-400)
    const cell = dem.stepM as number
    // a wall 10 m deep, centred 2.5 relief cells from the POI: the 30 m walk steps over it
    const lo = at(-(2.5 * cell + 5)).lat, hi = at(-(2.5 * cell - 5)).lat
    const original = { ground: dem.ground, obstacle: dem.obstacle }
    dem.ground = () => 5
    dem.obstacle = (lat: number) => (lat >= lo && lat <= hi ? 80 : 5)
    try {
      assert.ok(Math.abs(dem.sampleM - cell / 2) < 1e-9)
      assert.equal(await VisibilityMapBuilder.checkExactVisibility(PIN, 15, obs), false)
      assert.equal(await VisibilityMapBuilder.checkExactVisibility(PIN, 15, obs, { sampleIntervalM: cell }), true, 'the relief-cell walk misses it')
    } finally {
      dem.ground = original.ground
      dem.obstacle = original.obstacle
    }
  })
})

/** Writes a polygon shapefile (.shp + .dbf with a numeric Height) — the 3D-GloBFP layout. */
function writeShapefile(base: string, polys: Array<{ ring: Ring; h: number }>): void {
  const recs = polys.map(({ ring }) => {
    const len = 44 + 4 + 16 * ring.length
    const b = Buffer.alloc(len)
    const xs = ring.map(p => p[0]), ys = ring.map(p => p[1])
    b.writeInt32LE(5, 0)
    b.writeDoubleLE(Math.min(...xs), 4); b.writeDoubleLE(Math.min(...ys), 12)
    b.writeDoubleLE(Math.max(...xs), 20); b.writeDoubleLE(Math.max(...ys), 28)
    b.writeInt32LE(1, 36); b.writeInt32LE(ring.length, 40); b.writeInt32LE(0, 44)
    ring.forEach((p, k) => { b.writeDoubleLE(p[0], 48 + 16 * k); b.writeDoubleLE(p[1], 56 + 16 * k) })
    return b
  })
  const body = Buffer.concat(recs.map((r, i) => {
    const h = Buffer.alloc(8)
    h.writeInt32BE(i + 1, 0); h.writeInt32BE(r.length / 2, 4)
    return Buffer.concat([h, r])
  }))
  const head = Buffer.alloc(100)
  head.writeInt32BE(9994, 0); head.writeInt32BE((100 + body.length) / 2, 24); head.writeInt32LE(1000, 28); head.writeInt32LE(5, 32)
  fs.writeFileSync(`${base}.shp`, Buffer.concat([head, body]))
  const fields = [['BFID', 'C', 10], ['Height', 'N', 24]] as const
  const recLen = 1 + fields.reduce((s, f) => s + f[2], 0)
  const hdrLen = 32 + 32 * fields.length + 1
  const dbf = Buffer.alloc(hdrLen + recLen * polys.length + 1, 0x20)
  dbf.fill(0, 0, hdrLen)
  dbf[0] = 3; dbf.writeUInt32LE(polys.length, 4); dbf.writeUInt16LE(hdrLen, 8); dbf.writeUInt16LE(recLen, 10)
  fields.forEach((f, k) => { dbf.write(f[0], 32 + 32 * k, 'latin1'); dbf.write(f[1], 32 + 32 * k + 11, 'latin1'); dbf[32 + 32 * k + 16] = f[2] })
  dbf[hdrLen - 1] = 0x0d
  polys.forEach((p, i) => {
    const o = hdrLen + i * recLen
    dbf.write(' ', o, 'latin1')
    dbf.write(String(i).padEnd(10), o + 1, 'latin1')
    dbf.write(p.h.toFixed(15).padStart(24), o + 11, 'latin1')
  })
  dbf[dbf.length - 1] = 0x1a
  fs.writeFileSync(`${base}.dbf`, dbf)
}
