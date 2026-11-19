import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { writeArrayBuffer } from 'geotiff'
import {
  buildQuadkeyProduct,
  readQuadkeyProduct,
  stampQuadkeyProduct,
  writeQuadkeyProduct,
} from '../../lib/services/dem/chm-quadkey'
import { mercToLat, mercToLng, quadkeyBox } from '../../lib/services/dem/obstacle-prepare'
import { CANOPY_PERCENTILE, DEM_LATTICE_DEG, OBSTACLE_SUBDIV } from '../../lib/services/dem/dem-sources'
import type { DemGrid } from '../../lib/services/dem/dem-store'

// TP engine, EP canopy (#783): the Meta/WRI tile is aggregated once per quadkey on the global
// obstacle lattice, and an area takes the max of the products that touch it. The canopy layer
// must stay byte-identical to the per-area aggregation it replaced, whatever the area's west/north.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-ep-chm-'))
after(() => fs.rmSync(tmp, { recursive: true, force: true }))

const RES = DEM_LATTICE_DEG / OBSTACLE_SUBDIV
const PX = 1024 // a zoom-15 tile is ~1.2 km: 1024 px of ~1.2 m, the size of the real pixels

function quadkeyOf(x: number, y: number, z: number): string {
  let q = ''
  for (let i = z; i > 0; i--) q += String(((x >> (i - 1)) & 1) + 2 * ((y >> (i - 1)) & 1))
  return q
}

/** A strip GeoTIFF in EPSG:3857 georeferenced on the quadkey tile, pixels from a seeded PRNG. */
function fakeChmTile(quadkey: string, seed: number): { file: string; pixels: Uint8Array } {
  const b = quadkeyBox(quadkey)
  const pixels = new Uint8Array(PX * PX)
  let s = seed >>> 0
  for (let i = 0; i < pixels.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    pixels[i] = s % 3 === 0 ? 0 : (s >>> 8) % 41 // a third bare ground, crowns up to 40 m
  }
  const buf = writeArrayBuffer(pixels, {
    width: PX, height: PX,
    ModelPixelScale: [b.size / PX, b.size / PX, 0],
    ModelTiepoint: [0, 0, 0, b.x0, b.y0, 0],
    ProjectedCSTypeGeoKey: 3857, GTModelTypeGeoKey: 1, GTRasterTypeGeoKey: 1,
  } as never)
  const file = path.join(tmp, `${quadkey}.tif`)
  fs.writeFileSync(file, Buffer.from(buf))
  return { file, pixels }
}

/**
 * Oracle: the per-area aggregation the product replaced — each pixel to the cell
 * `round((lng − west) / res)` of THIS grid, the percentile per tile and cell, max across tiles.
 */
function perAreaCanopy(grid: DemGrid, tiles: Array<{ quadkey: string; pixels: Uint8Array }>): { values: Uint8Array; covered: Uint8Array } {
  const values = new Uint8Array(grid.width * grid.height), covered = new Uint8Array(grid.width * grid.height)
  for (const t of tiles) {
    const b = quadkeyBox(t.quadkey), rx = b.size / PX
    const cells = new Map<number, number[]>()
    for (let y = 0; y < PX; y++) {
      const r = Math.round((grid.north - mercToLat(b.y0 - (y + 0.5) * rx)) / grid.res)
      if (r < 0 || r >= grid.height) continue
      for (let x = 0; x < PX; x++) {
        const c = Math.round((mercToLng(b.x0 + (x + 0.5) * rx) - grid.west) / grid.res)
        if (c < 0 || c >= grid.width) continue
        const i = r * grid.width + c
        const list = cells.get(i) ?? cells.set(i, []).get(i)!
        list.push(t.pixels[y * PX + x])
      }
    }
    for (const [i, list] of cells) {
      list.sort((p, q) => p - q)
      const v = list[Math.ceil(CANOPY_PERCENTILE * list.length) - 1]
      if (v > values[i]) values[i] = v
      covered[i] = 1
    }
  }
  return { values, covered }
}

describe('EP canopy aggregated once per quadkey: byte-identical to the per-area aggregation (#783)', () => {
  // two neighbouring zoom-15 tiles over Natal (cell-7s36w), side by side: the seam crosses cells
  const z = 15, tx = Math.floor(((-35.2 + 180) / 360) * 2 ** z), ty = 16900
  const west = { quadkey: quadkeyOf(tx, ty, z) }, east = { quadkey: quadkeyOf(tx + 1, ty, z) }
  const tiles = [{ ...west, ...fakeChmTile(west.quadkey, 7) }, { ...east, ...fakeChmTile(east.quadkey, 11) }]
  const b = quadkeyBox(west.quadkey)
  const tileWest = mercToLng(b.x0), tileNorth = mercToLat(b.y0)

  /** A grid as `snapGrid` + `obstacleGrid` build it: corner on a whole arc-second, offset in ½″ cells. */
  const gridAt = (dCol: number, dRow: number, width: number, height: number): DemGrid => ({
    west: (Math.floor(tileWest * 3600) + dCol) / 3600,
    north: (Math.ceil(tileNorth * 3600) - dRow) / 3600,
    res: RES, width, height,
  })

  it('two areas with different west/north, cutting both tiles and their seam, match the oracle cell by cell', async () => {
    const products = []
    for (const t of tiles) products.push(await buildQuadkeyProduct(t.file, t.quadkey))
    // tile ~80×80 cells: A cuts the west tile and holds the seam; B starts 1″ and 3″ further in,
    // so its edges fall on other pixel rows and columns.
    for (const grid of [gridAt(10, 15, 120, 50), gridAt(11, 18, 97, 71), gridAt(-3, -2, 200, 100)]) {
      const values = new Uint8Array(grid.width * grid.height), covered = new Uint8Array(grid.width * grid.height)
      for (const p of products) stampQuadkeyProduct(grid, p, values, covered)
      const want = perAreaCanopy(grid, tiles)
      assert.deepEqual(Buffer.from(covered), Buffer.from(want.covered), `covered of ${grid.west},${grid.north}`)
      assert.deepEqual(Buffer.from(values), Buffer.from(want.values), `canopy of ${grid.west},${grid.north}`)
      assert.ok(values.some(v => v > 0))
    }
  })

  it('the product survives the cache file unchanged (header, lattice box, cells)', async () => {
    const p = { ...(await buildQuadkeyProduct(tiles[0].file, tiles[0].quadkey)), url: 'fake://t', etag: '"e"', lastModified: null }
    const file = path.join(tmp, 'p90', `${p.quadkey}.bin`)
    writeQuadkeyProduct(file, p)
    assert.deepEqual(readQuadkeyProduct(file), p)
  })

  it('an area off the obstacle lattice is refused, never stamped with shifted cells', async () => {
    const p = await buildQuadkeyProduct(tiles[0].file, tiles[0].quadkey)
    const grid = { ...gridAt(10, 15, 10, 10), west: gridAt(10, 15, 10, 10).west + RES / 3 }
    assert.throws(() => stampQuadkeyProduct(grid, p, new Uint8Array(100), new Uint8Array(100)), /not on the obstacle lattice/)
  })
})
