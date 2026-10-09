import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'

// TP engine, EP — Copernicus GLO-30 above 50° (#831). Targets in docs/arquitetura/cms/motor-de-tp.md
// (INV-EPa: "coordenadas batendo"). Between 50 and 60° a tile has 2400 columns (1.5″); between
// 60 and 70°, 1800 (2″). The reader used to refuse any step that was not a whole arc-second, so
// every cell of Czechia, Poland or Benelux failed. No network: the tile is synthetic.

const NORTH_ROWS = 3600

/** Raw value of a synthetic tile: distinct per column and row, so a shifted read cannot pass. */
const raw = (south: number, west: number, col: number, row: number) => Math.fround(100 + south + west * 0.1 + col * 0.25 + row * 0.01)

function fakeImage(south: number, west: number, width: number) {
  return {
    getOrigin: () => [west, south + 1, 0],
    getResolution: () => [1 / width, -1 / NORTH_ROWS, 0],
    getWidth: () => width,
    getHeight: () => NORTH_ROWS,
    async readRasters({ window: [x0, y0, x1, y1] }: { window: number[] }) {
      const out = new Float32Array((x1 - x0) * (y1 - y0))
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) out[(y - y0) * (x1 - x0) + (x - x0)] = raw(south, west, x, y)
      return out
    },
  }
}

let dem: typeof import('../../lib/services/dem/dem-prepare')
let sources: typeof import('../../lib/services/dem/dem-sources')
const realFetch = globalThis.fetch
const openTile = async (url: string) => {
  const m = /_([NS])(\d\d)_00_([EW])(\d{3})_00_DEM/.exec(url)!
  const south = (m[1] === 'S' ? -1 : 1) * Number(m[2]), west = (m[3] === 'W' ? -1 : 1) * Number(m[4])
  return fakeImage(south, west, sources.copernicusTileWidth(south)) as never
}

before(async () => {
  sources = await import('../../lib/services/dem/dem-sources')
  globalThis.fetch = (async (url: string) => {
    if (url === sources.COPERNICUS_GLO30.tileListUrl) {
      const names: string[] = []
      for (let s = 45; s <= 72; s++) for (let w = 10; w <= 20; w++) names.push(sources.copernicusTileName(s, w))
      return new Response(names.join('\n'))
    }
    return new Response(null, { status: 200, headers: { etag: '"fake"' } })
  }) as typeof fetch
  dem = await import('../../lib/services/dem/dem-prepare')
})
after(() => { globalThis.fetch = realFetch })

describe('INV-EPa (#831) — Copernicus GLO-30 is read above 50°, on the tile column step', () => {
  it('INV-EPa: the tile width follows the GLO-30 latitude bands, on both hemispheres', () => {
    assert.equal(sources.copernicusTileWidth(49), 3600)
    assert.equal(sources.copernicusTileWidth(50), 2400)
    assert.equal(sources.copernicusTileWidth(59), 2400)
    assert.equal(sources.copernicusTileWidth(60), 1800)
    assert.equal(sources.copernicusTileWidth(-51), 2400)
    assert.equal(sources.copernicusTileWidth(-50), 3600)
  })

  for (const [lat, lng, k] of [[50.5, 14.5, 1.5], [65.5, 15.5, 2]] as const) {
    it(`INV-EPa: the cell at ${lat}°N reads with no failure, and a point on a tile column has the raw tile value (${k}″)`, async () => {
      const cell = dem.demCellOf(lat, lng)
      const grid = dem.snapGrid(dem.demCellArea(cell, 500))
      const { values, failures, tiles } = await dem.copernicusReader(openTile).read(grid)
      assert.deepEqual(failures, [])
      assert.ok(tiles.some(t => t.name === sources.copernicusTileName(cell.south, cell.west) && t.status === 'downloaded'))

      const nIdx = Math.round(grid.north * 3600), wIdx = Math.round(grid.west * 3600)
      const at = (latIdx: number, lngIdx: number) => values[(nIdx - latIdx) * grid.width + (lngIdx - wIdx)]
      // Same point, same value: lattice point on a tile column (every 3″ at 1.5″, every 2″ at 2″).
      const south = cell.south, west = cell.west
      const latIdx = Math.round(lat * 3600)
      const row = (south + 1) * 3600 - latIdx
      for (const col of [0, 1, 2, 300, 1200, sources.copernicusTileWidth(south) - 1]) {
        const lngIdx = west * 3600 + col * k
        if (!Number.isInteger(lngIdx)) continue
        assert.equal(at(latIdx, lngIdx), raw(south, west, col, row), `column ${col}`)
      }
      // Between two columns: linear along the parallel, never outside its neighbours.
      if (k === 1.5) {
        const lngIdx = west * 3600 + 1201 * 1.5 + 0.5 // 1801.5 + 0.5: a lattice point between columns 1201 and 1202
        const v = at(latIdx, lngIdx)
        const a = raw(south, west, 1201, row), b = raw(south, west, 1202, row)
        assert.ok(Math.abs(v - (a + (b - a) / 3)) < 1e-3, `interpolated ${v} between ${a} and ${b}`)
      }
      assert.equal(values.some(Number.isNaN), false, 'no hole in the cell')
    })
  }
})
