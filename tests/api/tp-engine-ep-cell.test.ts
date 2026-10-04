import { after, afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  DEM_CELL_RETRY_AFTER_MS,
  cityDemArea,
  demCellArea,
  demCellId,
  demCellOf,
  ensureDemCell,
  prepareCityDem,
  type DemArea,
  type LayerReader,
} from '../../lib/services/dem/dem-prepare'
import { obstacleSourceFiles } from '../../lib/services/dem/obstacle-prepare'
import { COPERNICUS_GLO30, GEDTM30, GLOBFP_3D } from '../../lib/services/dem/dem-sources'
import { DemNotPreparedError, DemStore, type DemManifest } from '../../lib/services/dem/dem-store'
import { fakeObstacles } from './helpers/fake-obstacles'

// TP engine, EP by 1° cell (#831): the generation prepares the relief of a cell with no prepared
// area, once, and a country with nothing on disk generates without a manual step. The relief is
// what BR-POI-009 (edge by relief) and BR-AUDIO-010 (the sight line) read. Targets in
// docs/arquitetura/cms/motor-de-tp.md (INV-EPa/b/c).

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-ep-cell-'))
after(() => fs.rmSync(root, { recursive: true, force: true }))
let n = 0
const freshDir = () => path.join(root, `cache-${n++}`)
afterEach(() => { delete process.env.DEM_MIN_FREE_GB })

const MARGIN_M = 50

function flatReader(layer: 'surface' | 'ground', value: number): LayerReader {
  const src = layer === 'surface' ? COPERNICUS_GLO30 : GEDTM30
  return {
    layer, source: src.id, version: src.version, attribution: src.attribution,
    async read(grid) {
      return { values: new Float32Array(grid.width * grid.height).fill(value), tiles: [{ name: `${layer}-tile`, url: 'fake://', status: 'downloaded' }], failures: [] }
    },
  }
}

type PrepareArgs = { city: string; area: DemArea; marginM: number; dir: string }

/**
 * The real `prepareCityDem` with sources that need no network. A whole cell is ~4,000² relief
 * cells, so the fake prepares only the box of the pin ± the margin; `areas` keeps what the
 * generation asked for, which is the whole cell.
 */
function fakePrepare(pin: { lat: number; lng: number }, opts: { delayMs?: number; fail?: string; extraTiles?: DemManifest['layers'][number]['tiles'] } = {}) {
  const areas: DemArea[] = []
  const prepare = async (a: PrepareArgs): Promise<DemManifest> => {
    areas.push(a.area)
    if (opts.delayMs) await new Promise(r => setTimeout(r, opts.delayMs))
    const m = await prepareCityDem({
      city: a.city, area: cityDemArea([pin], a.marginM + 100), marginM: a.marginM, dir: a.dir,
      readers: [flatReader('surface', 120), opts.fail ? { ...flatReader('ground', 100), read: async g => ({ values: new Float32Array(g.width * g.height), tiles: [], failures: [opts.fail!] }) } : flatReader('ground', 100)],
      obstacles: fakeObstacles(),
    })
    if (opts.extraTiles) m.layers.find(l => l.layer === 'buildings')!.tiles.push(...opts.extraTiles)
    return m
  }
  return { prepare, areas }
}

describe('#831 — the relief is prepared by 1° cell, by the generation itself (INV-EPb)', () => {
  it('the cell is named by its south-west degree, and its area is the whole cell plus the TP reach', () => {
    assert.equal(demCellId(demCellOf(-22.5, -46.3)), 'cell-23s47w')
    assert.equal(demCellId(demCellOf(48.2085, 16.3731)), 'cell-48n16e')
    assert.equal(demCellId(demCellOf(-0.5, 0.5)), 'cell-1s0e')
    const a = demCellArea({ south: 48, west: 16 }, 15_000)
    assert.ok(a.south < 48 - 0.13 && a.north > 49 + 0.13, 'margin in latitude')
    assert.ok(a.west < 16 - 0.2 && a.east > 17 + 0.2, 'margin in longitude, wider at 48°')
  })

  it('a POI in a cell with no relief generates without a manual step: the cell is prepared and read', async () => {
    const dir = freshDir()
    const pin = { lat: 47.8095, lng: 13.055 } // Salzburg: nothing on disk
    const fake = fakePrepare(pin)
    assert.equal(new DemStore(dir).coverage(pin.lat, pin.lng, MARGIN_M).ok, false)
    assert.equal(await ensureDemCell({ ...pin, marginM: MARGIN_M, dir, prepare: fake.prepare }), true)
    assert.deepEqual(fake.areas, [demCellArea({ south: 47, west: 13 }, MARGIN_M)], 'the whole cell, not the box of the pins')
    const cover = new DemStore(dir).coverage(pin.lat, pin.lng, MARGIN_M)
    assert.equal(cover.ok, true)
    assert.equal(cover.ok && cover.city, 'cell-47n13e')
    assert.ok(fs.existsSync(path.join(dir, 'cell-47n13e', 'manifest.json')))
    assert.deepEqual(fs.readdirSync(path.join(dir, '_locks')), [], 'the lock is released')
  })

  it('the second POI of the same cell does not prepare it again', async () => {
    const dir = freshDir()
    const pin = { lat: 47.8095, lng: 13.055 }
    const fake = fakePrepare(pin)
    assert.equal(await ensureDemCell({ ...pin, marginM: MARGIN_M, dir, prepare: fake.prepare }), true)
    assert.equal(await ensureDemCell({ lat: pin.lat + 0.0001, lng: pin.lng, marginM: MARGIN_M, dir, prepare: fake.prepare }), false)
    assert.equal(fake.areas.length, 1)
  })

  it('two workers on the same cell prepare it once; the second waits and reads the result', async () => {
    const dir = freshDir()
    const pin = { lat: 47.8095, lng: 13.055 }
    const fake = fakePrepare(pin, { delayMs: 3_000 })
    const [a, b] = await Promise.all([
      ensureDemCell({ ...pin, marginM: MARGIN_M, dir, prepare: fake.prepare }),
      new Promise(r => setTimeout(r, 200)).then(() => ensureDemCell({ ...pin, marginM: MARGIN_M, dir, prepare: fake.prepare })),
    ])
    assert.deepEqual([a, b].sort(), [false, true])
    assert.equal(fake.areas.length, 1)
  })

  it('a lock left by a worker that died is taken over', async () => {
    const dir = freshDir()
    const pin = { lat: 47.8095, lng: 13.055 }
    const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']).stdout.toString()
    fs.mkdirSync(path.join(dir, '_locks'), { recursive: true })
    fs.writeFileSync(path.join(dir, '_locks', 'cell-47n13e.lock'), JSON.stringify({ pid: Number(dead), host: os.hostname() }))
    const fake = fakePrepare(pin)
    assert.equal(await ensureDemCell({ ...pin, marginM: MARGIN_M, dir, prepare: fake.prepare }), true)
  })

  it('an area prepared before #831 (by city or bbox) still covers its POIs: nothing is prepared again', async () => {
    const dir = freshDir()
    const pin = { lat: -23.55, lng: -46.63 }
    await prepareCityDem({ city: 'sao-paulo', area: cityDemArea([pin], 500), marginM: 500, dir, readers: [flatReader('surface', 800), flatReader('ground', 790)], obstacles: fakeObstacles() })
    const fake = fakePrepare(pin)
    assert.equal(await ensureDemCell({ ...pin, marginM: MARGIN_M, dir, prepare: fake.prepare }), false)
    assert.equal(fake.areas.length, 0)
    assert.equal(new DemStore(dir).coverage(pin.lat, pin.lng, MARGIN_M).ok, true)
  })

  it('below the free-disk floor the preparation refuses, with the floor in the message', async () => {
    const dir = freshDir()
    const pin = { lat: 47.8095, lng: 13.055 }
    process.env.DEM_MIN_FREE_GB = '1000000'
    const fake = fakePrepare(pin)
    await assert.rejects(ensureDemCell({ ...pin, marginM: MARGIN_M, dir, prepare: fake.prepare }), (e: unknown) => e instanceof DemNotPreparedError && /below the floor of .* GB \(DEM_MIN_FREE_GB\)/.test((e as Error).message))
    assert.equal(fake.areas.length, 0)
    assert.deepEqual(fs.readdirSync(path.join(dir, '_locks')), [])
  })

  it('a failed download fails the POI, and the cell is not downloaded again for every POI of the queue', async () => {
    const dir = freshDir()
    const pin = { lat: 47.8095, lng: 13.055 }
    const failing = fakePrepare(pin, { fail: 'gedtm30: HTTP 503' })
    const t = new Date()
    await assert.rejects(ensureDemCell({ ...pin, marginM: MARGIN_M, dir, prepare: failing.prepare, now: () => t }), /HTTP 503/)
    await assert.rejects(ensureDemCell({ ...pin, marginM: MARGIN_M, dir, prepare: failing.prepare, now: () => t }), /HTTP 503.*retried after/)
    assert.equal(failing.areas.length, 1)
    const ok = fakePrepare(pin)
    const later = () => new Date(t.getTime() + DEM_CELL_RETRY_AFTER_MS + 1)
    assert.equal(await ensureDemCell({ ...pin, marginM: MARGIN_M, dir, prepare: ok.prepare, now: later }), true)
  })

  it('the downloaded sources of a checked cell are removed; the world grid stays', async () => {
    const dir = freshDir()
    const pin = { lat: 47.8095, lng: 13.055 }
    const zip = '437_12.5_47.5_15.0_50.0_AT.zip'
    const extra = [{ name: zip, url: 'fake://zip', status: 'downloaded' as const }]
    const src = path.join(dir, '_sources', GLOBFP_3D.id)
    fs.mkdirSync(src, { recursive: true })
    fs.writeFileSync(path.join(src, zip), 'x')
    fs.writeFileSync(path.join(src, 'world_grid.zip'), 'x')
    await ensureDemCell({ ...pin, marginM: MARGIN_M, dir, prepare: fakePrepare(pin, { extraTiles: extra }).prepare })
    assert.equal(fs.existsSync(path.join(src, zip)), false)
    assert.equal(fs.existsSync(path.join(src, 'world_grid.zip')), true)
  })

  it('the source files of an area are its 3D-GloBFP zips and its canopy tiles, nothing read at runtime', () => {
    const files = obstacleSourceFiles('/c', [
      { layer: 'surface', tiles: [{ name: 'Copernicus_DSM_COG_10_N47_00_E013_00_DEM', url: 'https://x', status: 'downloaded' }] },
      { layer: 'buildings', tiles: [{ name: 'part-0001.parquet (3/9 row groups)', url: 'https://o', status: 'downloaded' }, { name: '437_x_AT.zip', url: 'https://f', status: 'downloaded' }] },
      { layer: 'canopy', tiles: [{ name: '120202013', url: 'https://m', status: 'downloaded' }] },
    ])
    assert.deepEqual(files, [path.join('/c', '3d-globfp', '437_x_AT.zip'), path.join('/c', 'meta-wri-chm', '120202013.tif')])
  })
})
