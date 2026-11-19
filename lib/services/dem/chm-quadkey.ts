/**
 * Meta / WRI canopy (`META_CHM`) aggregated ONCE per quadkey tile, then reused by every area.
 *
 * A 1 m tile (~390 MB, strip-organised, no overview) is downloaded, reduced to the 90th percentile
 * (`CANOPY_PERCENTILE`, `RowPercentile`) of each cell of the GLOBAL obstacle lattice (½″,
 * `OBSTACLE_SUBDIV`), and that product (~25 MB raw, deflated on disk) replaces it in the cache:
 * the tile is removed right after. An area builds its `canopy` layer as the max of the products
 * of the quadkeys that touch it — the same max the seam between two tiles always was.
 *
 * Parity with the per-area aggregation: a pixel goes to the cell `Math.round(lng / res)`,
 * `Math.round(-lat / res)` of the global lattice, and an area grid starts at the global index of
 * its `west`/`north` (whole lattice steps by `snapGrid`), so the cell of a pixel never depends on
 * which area asked for it. Products sit in `<sources>/meta-wri-chm-p90/`, one lock per quadkey
 * (two workers may need the same tile).
 */

import * as fs from 'fs'
import * as path from 'path'
import { randomBytes } from 'crypto'
import { deflateSync, inflateSync } from 'zlib'
import { fromFile } from 'geotiff'
import { CANOPY_PERCENTILE, DEM_LATTICE_DEG, META_CHM, OBSTACLE_SUBDIV } from './dem-sources'
import type { DemGrid, DemTileRecord } from './dem-store'
import { withFileLock } from './file-lock'
import {
  RowPercentile,
  cachedDownload,
  getJson,
  head,
  intersects,
  markQuadkeyCells,
  mercToLat,
  mercToLng,
  quadkeyBox,
  withRetry,
  type CanopyReader,
  type DemArea,
} from './obstacle-prepare'

/** Cell size of the global obstacle lattice; the same expression as `obstacleGrid(snapGrid(..)).res`. */
const OBSTACLE_RES = DEM_LATTICE_DEG / OBSTACLE_SUBDIV
/** Tiles downloaded at once by one area. Aggregation stays one at a time (memory). */
export const META_CHM_PARALLEL = 3
const PRODUCT_DIR = `${META_CHM.id}-p90`
const PRODUCT_MAGIC = 'CHMP'
/** Bump when the aggregation changes: a product of another format is rebuilt. */
const PRODUCT_FORMAT = 1

/** The p90 of one quadkey tile on the global lattice: cell (row0 + r, col0 + c) at values[r * width + c]. */
export interface QuadkeyProduct {
  quadkey: string
  /** global column (`round(lng / res)`) and row (`round(-lat / res)`) of values[0] */
  col0: number
  row0: number
  width: number
  height: number
  values: Uint8Array
  url: string
  etag: string | null
  lastModified: string | null
}

type ProductHeader = Omit<QuadkeyProduct, 'values'> & { format: number; percentile: number; subdiv: number }

/** Reads one CHM tile in full and returns the p90 of each global lattice cell its pixels fall in. */
export async function buildQuadkeyProduct(file: string, quadkey: string): Promise<Omit<QuadkeyProduct, 'url' | 'etag' | 'lastModified'>> {
  const image = await (await fromFile(file)).getImage()
  const [ox, oy] = image.getOrigin()
  const [rx, ry] = image.getResolution()
  const w = image.getWidth(), h = image.getHeight()
  const qb = quadkeyBox(quadkey)
  // The georeference must be the quadkey tile (EP: "coordenadas batendo").
  if (Math.abs(ox - qb.x0) > 1 || Math.abs(oy - qb.y0) > 1 || Math.abs(w * rx - qb.size) > 1 || Math.abs(-h * ry - qb.size) > 1) {
    throw new Error(`georeference ${ox},${oy} ${w}×${h}@${rx} is not tile ${quadkey}`)
  }
  const colOf = new Int32Array(w)
  for (let x = 0; x < w; x++) colOf[x] = Math.round(mercToLng(ox + (x + 0.5) * rx) / OBSTACLE_RES)
  const rowOf = new Int32Array(h)
  for (let y = 0; y < h; y++) rowOf[y] = Math.round(-mercToLat(oy + (y + 0.5) * ry) / OBSTACLE_RES)
  // Pixels (~1 m) are much smaller than cells (~15 m): every cell of the box gets pixels, so the
  // box is exactly what the tile covers. Checked, since `covered` is derived from it.
  for (let x = 1; x < w; x++) if (colOf[x] - colOf[x - 1] > 1 || colOf[x] < colOf[x - 1]) throw new Error(`${quadkey}: pixel columns skip a lattice column`)
  for (let y = 1; y < h; y++) if (rowOf[y] - rowOf[y - 1] > 1 || rowOf[y] < rowOf[y - 1]) throw new Error(`${quadkey}: pixel rows skip a lattice row`)
  const col0 = colOf[0], row0 = rowOf[0]
  const width = colOf[w - 1] - col0 + 1, height = rowOf[h - 1] - row0 + 1
  const values = new Uint8Array(width * height)
  const acc = new RowPercentile(width, values, CANOPY_PERCENTILE)
  const local = new Int32Array(w)
  for (let x = 0; x < w; x++) local[x] = colOf[x] - col0
  for await (const { y, row } of stripRows(file, image, w, h)) acc.addRow(rowOf[y] - row0, local, row, 0)
  acc.flush()
  return { quadkey, col0, row0, width, height, values }
}

type TiffImage = Awaited<ReturnType<Awaited<ReturnType<typeof fromFile>>['getImage']>>

/**
 * Every row of a strip TIFF of one Uint8 band, top to bottom, read sequentially in big chunks and
 * inflated by Node's zlib. geotiff's `readRasters` fetches the offset and byte count of each strip
 * with its own small read and inflates with `pako`: on the 1 m tiles (65,536 strips) that was 240
 * of ~320 s per tile (measured 2026-11-19). The bytes are the same: deflate is lossless and the
 * predictor is TIFF's horizontal differencing, as geotiff applies it.
 */
async function* stripRows(file: string, image: TiffImage, w: number, h: number): AsyncGenerator<{ y: number; row: Uint8Array }> {
  const fd = image.fileDirectory
  const compression = Number(await fd.loadValue('Compression'))
  const predictor = fd.hasTag('Predictor') ? Number(await fd.loadValue('Predictor')) : 1
  const bits = (await fd.loadValue('BitsPerSample')) as ArrayLike<number>
  const samples = fd.hasTag('SamplesPerPixel') ? Number(await fd.loadValue('SamplesPerPixel')) : 1
  const rowsPerStrip = fd.hasTag('RowsPerStrip') ? Number(await fd.loadValue('RowsPerStrip')) : h
  if (image.isTiled || ![1, 8, 32946].includes(compression) || ![1, 2].includes(predictor) || bits[0] !== 8 || samples !== 1) {
    throw new Error(`${path.basename(file)}: expected strips of one Uint8 band, raw or deflate (compression ${compression}, predictor ${predictor}, ${bits[0]} bits, ${samples} samples)`)
  }
  const offsets = (await fd.loadValue('StripOffsets')) as ArrayLike<number | bigint>
  const counts = (await fd.loadValue('StripByteCounts')) as ArrayLike<number | bigint>
  const CHUNK = 64 << 20
  const fh = fs.openSync(file, 'r')
  try {
    let buf = Buffer.alloc(0), bufStart = 0
    for (let s = 0, y = 0; y < h; s++) {
      const off = Number(offsets[s]), n = Number(counts[s])
      if (off < bufStart || off + n > bufStart + buf.length) {
        buf = Buffer.alloc(Math.max(CHUNK, n))
        buf = buf.subarray(0, fs.readSync(fh, buf, 0, buf.length, off))
        bufStart = off
        if (buf.length < n) throw new Error(`${path.basename(file)}: strip ${s} is cut short`)
      }
      const raw = buf.subarray(off - bufStart, off - bufStart + n)
      const strip = compression === 1 ? raw : inflateSync(raw)
      const rows = Math.min(rowsPerStrip, h - y)
      if (strip.length < rows * w) throw new Error(`${path.basename(file)}: strip ${s} has ${strip.length} bytes, expected ${rows * w}`)
      for (let k = 0; k < rows; k++, y++) {
        const row = strip.subarray(k * w, (k + 1) * w)
        if (predictor === 2) for (let x = 1; x < w; x++) row[x] += row[x - 1]
        yield { y, row }
      }
    }
  } finally {
    fs.closeSync(fh)
  }
}

/** Max of the product into the area grid, and `covered` where the product has cells. */
export function stampQuadkeyProduct(grid: DemGrid, p: Pick<QuadkeyProduct, 'col0' | 'row0' | 'width' | 'height' | 'values'>, values: Uint8Array, covered: Uint8Array): void {
  const gc = gridOrigin(grid)
  const c0 = Math.max(p.col0, gc.col0), c1 = Math.min(p.col0 + p.width, gc.col0 + grid.width) - 1
  const r0 = Math.max(p.row0, gc.row0), r1 = Math.min(p.row0 + p.height, gc.row0 + grid.height) - 1
  for (let r = r0; r <= r1; r++) {
    const src = (r - p.row0) * p.width - p.col0
    const dst = (r - gc.row0) * grid.width - gc.col0
    for (let c = c0; c <= c1; c++) {
      const v = p.values[src + c]
      if (v > values[dst + c]) values[dst + c] = v
      covered[dst + c] = 1
    }
  }
}

/** Global lattice index of the grid's first cell. The grid must sit on the obstacle lattice. */
function gridOrigin(grid: DemGrid): { col0: number; row0: number } {
  const col0 = Math.round(grid.west / OBSTACLE_RES), row0 = Math.round(-grid.north / OBSTACLE_RES)
  if (grid.res !== OBSTACLE_RES || Math.abs(col0 * OBSTACLE_RES - grid.west) > 1e-9 || Math.abs(-row0 * OBSTACLE_RES - grid.north) > 1e-9) {
    throw new Error(`grid ${grid.north},${grid.west}@${grid.res} is not on the obstacle lattice`)
  }
  return { col0, row0 }
}

export function writeQuadkeyProduct(file: string, p: QuadkeyProduct): void {
  const { values, ...rest } = p
  const header: ProductHeader = { ...rest, format: PRODUCT_FORMAT, percentile: CANOPY_PERCENTILE, subdiv: OBSTACLE_SUBDIV }
  const json = Buffer.from(JSON.stringify(header))
  const len = Buffer.alloc(4)
  len.writeUInt32LE(json.length)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const part = `${file}.${process.pid}-${randomBytes(4).toString('hex')}.part`
  try {
    fs.writeFileSync(part, Buffer.concat([Buffer.from(PRODUCT_MAGIC), len, json, deflateSync(values)]))
    fs.renameSync(part, file)
  } finally {
    fs.rmSync(part, { force: true })
  }
}

/** The product, or null when absent or of another format / percentile / lattice (rebuilt then). */
export function readQuadkeyProduct(file: string): QuadkeyProduct | null {
  if (!fs.existsSync(file)) return null
  const buf = fs.readFileSync(file)
  if (buf.toString('latin1', 0, 4) !== PRODUCT_MAGIC) return null
  const len = buf.readUInt32LE(4)
  const header = JSON.parse(buf.toString('utf8', 8, 8 + len)) as ProductHeader
  if (header.format !== PRODUCT_FORMAT || header.percentile !== CANOPY_PERCENTILE || header.subdiv !== OBSTACLE_SUBDIV) return null
  const values = new Uint8Array(inflateSync(buf.subarray(8 + len)))
  if (values.length !== header.width * header.height) throw new Error(`${file}: ${values.length} cells, header says ${header.width}×${header.height}`)
  const { format: _f, percentile: _p, subdiv: _s, ...rest } = header
  return { ...rest, values }
}

/** One tile aggregated at a time in this process: 3 at once would triple the decode buffers. */
let aggregating: Promise<unknown> = Promise.resolve()
function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  const run = aggregating.then(fn, fn)
  aggregating = run.catch(() => undefined)
  return run
}

/** The product of a quadkey from the cache, or downloaded, aggregated and cached now. */
export async function ensureQuadkeyProduct(cacheDir: string, quadkey: string): Promise<QuadkeyProduct> {
  const file = path.join(cacheDir, PRODUCT_DIR, `${quadkey}.bin`)
  const cached = readQuadkeyProduct(file)
  if (cached) return cached
  return withFileLock(path.join(cacheDir, PRODUCT_DIR, '_locks', `${quadkey}.lock`), async () => {
    const again = readQuadkeyProduct(file) // another worker built it while this one waited
    if (again) return again
    const url = META_CHM.tileUrl(quadkey)
    const meta = await withRetry(`HEAD ${quadkey}`, () => head(url))
    const tif = path.join(cacheDir, META_CHM.id, `${quadkey}.tif`)
    await cachedDownload(url, tif, { size: meta.size })
    const built = await oneAtATime(() => buildQuadkeyProduct(tif, quadkey))
    const product: QuadkeyProduct = { ...built, url, etag: meta.etag, lastModified: meta.lastModified }
    writeQuadkeyProduct(file, product)
    fs.rmSync(tif, { force: true }) // the product replaces it; a reader of the old engine keeps its handle
    return product
  })
}

export function metaChmReader(cacheDir: string): CanopyReader {
  return {
    source: META_CHM.id,
    version: META_CHM.version,
    attribution: META_CHM.attribution,
    async read(grid) {
      const values = new Uint8Array(grid.width * grid.height)
      const covered = new Uint8Array(grid.width * grid.height)
      const indexed = new Uint8Array(grid.width * grid.height)
      const failures: string[] = []
      const south = grid.north - (grid.height - 1) * grid.res, east = grid.west + (grid.width - 1) * grid.res
      const box: DemArea = { south: south - grid.res, north: grid.north + grid.res, west: grid.west - grid.res, east: east + grid.res }
      let results: Array<{ tile?: DemTileRecord; failure?: string }> = []
      try {
        gridOrigin(grid)
        type Index = { features: Array<{ properties: { tile: string }; geometry: { coordinates: number[][][] } }> }
        const index = await getJson<Index>(META_CHM.tilesIndexUrl)
        const hits = index.features.filter(f => {
          const xs = f.geometry.coordinates[0].map(p => p[0]), ys = f.geometry.coordinates[0].map(p => p[1])
          return intersects({ west: Math.min(...xs), east: Math.max(...xs), south: Math.min(...ys), north: Math.max(...ys) }, box)
        }).map(f => f.properties.tile)
        for (const qk of hits) markQuadkeyCells(grid, qk, indexed) // before the download: a failed tile stays a hole
        results = new Array(hits.length)
        let next = 0
        const worker = async () => {
          while (next < hits.length) {
            const k = next++
            const qk = hits[k]
            try {
              const p = await ensureQuadkeyProduct(cacheDir, qk)
              stampQuadkeyProduct(grid, p, values, covered)
              results[k] = { tile: { name: qk, url: p.url, status: 'downloaded', etag: p.etag, lastModified: p.lastModified } }
            } catch (err) {
              results[k] = { failure: `meta-chm ${qk}: ${(err as Error).message}` }
            }
          }
        }
        await Promise.all(Array.from({ length: META_CHM_PARALLEL }, worker))
      } catch (err) {
        failures.push(`meta-chm: ${(err as Error).message}`)
      }
      const tiles = results.flatMap(r => (r.tile ? [r.tile] : []))
      failures.unshift(...results.flatMap(r => (r.failure ? [r.failure] : [])))
      return { values, covered, indexed, tiles, failures }
    },
  }
}
