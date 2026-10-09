/**
 * EP, measured obstacles (#783; INV-EPa, INV-EPb). Runs inside `dem-prepare#prepareCityDem`,
 * after the relief, and writes two layers on the obstacle lattice (`dem-store#obstacleGrid`):
 *
 *  - `buildings` — every footprint of Overture buildings and of 3D-GloBFP, rasterised with the
 *    height its source measured and the tier that says which source it was
 *    (`dem-sources#BUILDING_TIER`). A footprint with no height stays `UNMEASURED`: E3 and E8
 *    read surface − ground there, never a number made up for it.
 *  - `canopy` — Meta/WRI canopy height, 1 m aggregated to the lattice by the 90th percentile.
 *
 * Attribution of each source is in `dem-sources` (OVERTURE_BUILDINGS, GLOBFP_3D, META_CHM) and
 * travels in the manifest: Overture buildings (ODbL; © OpenStreetMap contributors, Microsoft ML
 * Building Footprints, Google Open Buildings CC BY 4.0, Esri Community Maps CC BY 4.0);
 * 3D-GloBFP, Che et al. 2024, CC BY 4.0; High Resolution Canopy Height Maps by WRI and Meta,
 * Tolan et al. 2024, CC BY 4.0.
 *
 * Raw downloads are cached under `<dem-cache>/_sources/<source>/` (outside git) and checked
 * against the size, or the MD5, the publisher gives. A file that cannot be read, a grid cell of
 * 3D-GloBFP over land with no file, or land with no canopy tile fails the city (INV-EPb).
 * Height coverage is sparse by nature and is not a failure: it is counted in the manifest.
 */

import * as fs from 'fs'
import * as path from 'path'
import { createHash, randomBytes } from 'crypto'
import { execFileSync } from 'child_process'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { fromFile } from 'geotiff'
import { asyncBufferFromUrl, parquetMetadataAsync, parquetReadObjects } from 'hyparquet'
import { compressors } from 'hyparquet-compressors'
import {
  BUILDING_DM_MAX,
  BUILDING_TIER,
  CANOPY_PERCENTILE,
  GLOBFP_CAL_MIN_PAIRS,
  GLOBFP_CAL_OVER_SHARE,
  GLOBFP_CAL_TILE_CELLS,
  GLOBFP_3D,
  META_CHM,
  OVERTURE_BUILDINGS,
} from './dem-sources'
import type { DemGrid, DemLayerRecord, DemTileRecord } from './dem-store'
import { withFileLock } from './file-lock'
import { BUILDING_LEVEL_HEIGHT_M } from '../trigger-points-google/config/visibility-class'

export type DemArea = { south: number; west: number; north: number; east: number }
/** [lng, lat] */
export type Ring = Array<[number, number]>
export type BuildingTier = (typeof BUILDING_TIER)[keyof typeof BUILDING_TIER]
/** Receives one footprint (outer ring) with the tier and height its source gave it. */
export type BuildingSink = (ring: Ring, tier: BuildingTier, heightM: number | null) => void
/** true where the ground layer says the place is land (not sea). */
export type LandAt = (lat: number, lng: number) => boolean

export interface ObstacleSourceInfo {
  source: string
  version: string
  attribution: string
}

export interface BuildingReader extends ObstacleSourceInfo {
  read(area: DemArea, sink: BuildingSink, landAt: LandAt): Promise<{ tiles: DemTileRecord[]; failures: string[] }>
}

export interface CanopyReader extends ObstacleSourceInfo {
  /** values: canopy height in metres per cell of `grid`; covered: 1 where a source tile covers the cell */
  read(grid: DemGrid): Promise<{ values: Uint8Array; covered: Uint8Array; tiles: DemTileRecord[]; failures: string[] }>
}

// ── Buildings raster ──────────────────────────────────────────────────────────

export function encodeBuilding(tier: BuildingTier, heightM: number | null): number {
  const dm = heightM && heightM > 0 ? Math.min(BUILDING_DM_MAX, Math.max(1, Math.round(heightM * 10))) : 0
  return (tier << 14) | dm
}

export function decodeBuilding(v: number): { tier: BuildingTier; heightM: number } {
  return { tier: (v >> 14) as BuildingTier, heightM: (v & BUILDING_DM_MAX) / 10 }
}

/**
 * Calls `visit(index)` for every cell of `grid` whose centre is inside the ring (even-odd), and
 * for the cell under the ring's vertex mean when none is: a building narrower than a cell still
 * stands somewhere. Pure.
 */
export function rasterizeRing(grid: DemGrid, ring: Ring, visit: (i: number) => void): void {
  const n = ring.length
  if (n < 3) return
  const xs = new Float64Array(n), ys = new Float64Array(n)
  let minY = Infinity, maxY = -Infinity, sx = 0, sy = 0
  for (let k = 0; k < n; k++) {
    xs[k] = (ring[k][0] - grid.west) / grid.res
    ys[k] = (grid.north - ring[k][1]) / grid.res
    if (ys[k] < minY) minY = ys[k]
    if (ys[k] > maxY) maxY = ys[k]
    sx += xs[k]; sy += ys[k]
  }
  let any = false
  const r0 = Math.max(0, Math.ceil(minY)), r1 = Math.min(grid.height - 1, Math.floor(maxY))
  const cuts: number[] = []
  for (let r = r0; r <= r1; r++) {
    cuts.length = 0
    for (let a = 0, b = n - 1; a < n; b = a++) {
      if ((ys[a] > r) !== (ys[b] > r)) cuts.push(xs[a] + ((r - ys[a]) * (xs[b] - xs[a])) / (ys[b] - ys[a]))
    }
    cuts.sort((p, q) => p - q)
    for (let k = 0; k + 1 < cuts.length; k += 2) {
      const c0 = Math.max(0, Math.ceil(cuts[k])), c1 = Math.min(grid.width - 1, Math.floor(cuts[k + 1]))
      for (let c = c0; c <= c1; c++) { visit(r * grid.width + c); any = true }
    }
  }
  if (!any) {
    const r = Math.round(sy / n), c = Math.round(sx / n)
    if (r >= 0 && c >= 0 && r < grid.height && c < grid.width) visit(r * grid.width + c)
  }
}

/** Footprint area in m² of a [lng, lat] ring (shoelace on the local plane). */
export function ringAreaM2(ring: Ring): number {
  const lat0 = ring[0][1], kx = 111_320 * Math.cos((lat0 * Math.PI) / 180), ky = 110_540
  let a = 0
  for (let k = 0, j = ring.length - 1; k < ring.length; j = k++) a += ring[j][0] * kx * ring[k][1] * ky - ring[k][0] * kx * ring[j][1] * ky
  return Math.abs(a) / 2
}

/** Area on one byte, log scale (1 m² … ~2.6 km²): only compared, never read back as m². */
const areaCode = (m2: number) => Math.min(255, Math.max(1, Math.round(12 * Math.log2(1 + m2))))

/**
 * The buildings layer being built: the higher tier wins a cell, and the taller within a tier.
 * Overture must be read before 3D-GloBFP: a 3D-GloBFP footprint whose centroid falls on an
 * Overture cell with height is a pair for `calibrateGlobfp` (INV-EPa, `GLOBFP_CAL_*`).
 */
export class BuildingRaster {
  readonly cells: Uint16Array
  readonly counts = { overture: 0, globfp: 0, unmeasured: 0 }
  /** area code of the 3D-GloBFP footprint that holds each cell (0: none) */
  private globfpArea: Uint8Array | null = null
  /** per calibration tile: Overture / 3D-GloBFP of its pairs, and the largest paired area code */
  private readonly pairs = new Map<number, { ratios: number[]; maxArea: number }>()

  constructor(readonly grid: DemGrid) {
    this.cells = new Uint16Array(grid.width * grid.height)
  }

  private tileOf(i: number): number {
    const tw = Math.ceil(this.grid.width / GLOBFP_CAL_TILE_CELLS)
    return Math.floor(Math.floor(i / this.grid.width) / GLOBFP_CAL_TILE_CELLS) * tw + Math.floor((i % this.grid.width) / GLOBFP_CAL_TILE_CELLS)
  }

  readonly add: BuildingSink = (ring, tier, heightM) => {
    const v = encodeBuilding(tier, tier === BUILDING_TIER.UNMEASURED ? null : heightM)
    if (tier === BUILDING_TIER.OVERTURE) this.counts.overture++
    else if (tier === BUILDING_TIER.GLOBFP) this.counts.globfp++
    else this.counts.unmeasured++
    let code = 0
    if (tier === BUILDING_TIER.GLOBFP && heightM && ring.length >= 3) {
      code = areaCode(ringAreaM2(ring))
      this.globfpArea ??= new Uint8Array(this.cells.length)
      const n = ring.length
      const r = Math.round((this.grid.north - ring.reduce((s, p) => s + p[1], 0) / n) / this.grid.res)
      const c = Math.round((ring.reduce((s, p) => s + p[0], 0) / n - this.grid.west) / this.grid.res)
      if (r >= 0 && c >= 0 && r < this.grid.height && c < this.grid.width) {
        const at = decodeBuilding(this.cells[r * this.grid.width + c])
        if (at.tier === BUILDING_TIER.OVERTURE && at.heightM > 0) {
          const t = this.tileOf(r * this.grid.width + c)
          const p = this.pairs.get(t) ?? this.pairs.set(t, { ratios: [], maxArea: 0 }).get(t)!
          p.ratios.push(at.heightM / heightM)
          p.maxArea = Math.max(p.maxArea, code)
        }
      }
    }
    rasterizeRing(this.grid, ring, i => {
      if (v > this.cells[i]) {
        this.cells[i] = v
        if (code) this.globfpArea![i] = code
      }
    })
  }

  /**
   * INV-EPa (#772): rescales the 3D-GloBFP cells of each tile where the Overture pairs say the
   * estimate is taller (`GLOBFP_CAL_*`). Call once, after every source was added.
   */
  calibrateGlobfp(): { tiles: number; cells: number } {
    const out = { tiles: 0, cells: 0 }
    const scale = new Map<number, { k: number; maxArea: number }>()
    for (const [t, p] of this.pairs) {
      if (p.ratios.length < GLOBFP_CAL_MIN_PAIRS) continue
      if (p.ratios.filter(x => x < 1).length < GLOBFP_CAL_OVER_SHARE * p.ratios.length) continue
      const sorted = [...p.ratios].sort((a, b) => a - b)
      scale.set(t, { k: sorted[Math.floor(sorted.length / 2)], maxArea: p.maxArea })
    }
    if (!scale.size || !this.globfpArea) return out
    out.tiles = scale.size
    for (let i = 0; i < this.cells.length; i++) {
      if (this.cells[i] >> 14 !== BUILDING_TIER.GLOBFP) continue
      const s = scale.get(this.tileOf(i))
      if (!s || this.globfpArea[i] > s.maxArea) continue
      this.cells[i] = encodeBuilding(BUILDING_TIER.GLOBFP, Math.max(0.1, decodeBuilding(this.cells[i]).heightM * s.k))
      out.cells++
    }
    return out
  }
}

// ── Canopy aggregation ────────────────────────────────────────────────────────

/**
 * Per-cell percentile of Uint8 pixels, one lattice row at a time: pixels are added to the row
 * being filled, and `flush` writes the percentile of each touched cell (max with what is there,
 * for the seam between two source tiles). Memory: 256 counters per column of one row.
 */
export class RowPercentile {
  private hist: Uint16Array
  private count: Uint32Array
  private top: Uint8Array
  private row = -1

  constructor(private readonly width: number, private readonly out: Uint8Array, private readonly p = CANOPY_PERCENTILE) {
    this.hist = new Uint16Array(width * 256)
    this.count = new Uint32Array(width)
    this.top = new Uint8Array(width)
  }

  add(row: number, col: number, v: number): void {
    if (row !== this.row) { this.flush(); this.row = row }
    this.hist[col * 256 + v]++
    this.count[col]++
    if (v > this.top[col]) this.top[col] = v
  }

  flush(): void {
    if (this.row < 0) return
    for (let c = 0; c < this.width; c++) {
      const n = this.count[c]
      if (!n) continue
      const need = Math.ceil(this.p * n)
      let acc = 0, v = 0
      const base = c * 256
      for (; v <= this.top[c]; v++) {
        acc += this.hist[base + v]
        if (acc >= need) break
      }
      const i = this.row * this.width + c
      if (v > this.out[i]) this.out[i] = v
      this.hist.fill(0, base, base + this.top[c] + 1)
      this.count[c] = 0
      this.top[c] = 0
    }
    this.row = -1
  }
}

// ── I/O helpers ───────────────────────────────────────────────────────────────

const WEB_MERCATOR_R = 6_378_137
/** Zenodo answers 403 to a request without a User-Agent. */
const HTTP_HEADERS = { 'user-agent': 'tuggi-cms-ep/1.0 (+https://tuggi.app)' }

async function withRetry<T>(what: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      last = err
      await new Promise(r => setTimeout(r, 1000 * (i + 1)))
    }
  }
  throw new Error(`${what}: ${(last as Error)?.message ?? String(last)}`)
}

async function head(url: string): Promise<{ size: number; etag: string | null; lastModified: string | null }> {
  const res = await fetch(url, { method: 'HEAD', redirect: 'follow', headers: HTTP_HEADERS })
  if (!res.ok) throw new Error(`HEAD ${url} → ${res.status}`)
  return { size: Number(res.headers.get('content-length') ?? NaN), etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified') }
}

async function getJson<T>(url: string): Promise<T> {
  return withRetry(`GET ${url}`, async () => {
    const r = await fetch(url, { headers: HTTP_HEADERS })
    if (!r.ok) throw new Error(`${r.status}`)
    return (await r.json()) as T
  })
}

function md5File(file: string): string {
  const h = createHash('md5')
  const fd = fs.openSync(file, 'r')
  const buf = Buffer.alloc(8 << 20)
  try {
    for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0;) h.update(buf.subarray(0, n))
  } finally {
    fs.closeSync(fd)
  }
  return h.digest('hex')
}

/** The lock of one cached source file: `<dir>/_locks/<name>.lock`. */
const sourceLock = (file: string) => path.join(path.dirname(file), '_locks', `${path.basename(file)}.lock`)

/**
 * Downloads once into the cache; reuses a cached file whose size (and MD5, when given) match.
 * Safe between workers (#831): neighbouring cells share canopy tiles and building zips, so there
 * is one lock per file in `_locks/` beside it, and a part file of this call only, checked before
 * the atomic rename — the final name never holds a half-written or mismatching file.
 */
export async function cachedDownload(url: string, file: string, expect: { size?: number; md5?: string }): Promise<void> {
  const matches = (f: string) =>
    fs.existsSync(f) &&
    (!Number.isFinite(expect.size) || fs.statSync(f).size === expect.size) &&
    (!expect.md5 || md5File(f) === expect.md5)
  if (matches(file)) return
  await withFileLock(sourceLock(file), async () => {
    if (matches(file)) return // another worker finished it while this one waited
    await withRetry(`download ${url}`, async () => {
      const part = `${file}.${process.pid}-${randomBytes(4).toString('hex')}.part`
      try {
        const res = await fetch(url, { redirect: 'follow', headers: HTTP_HEADERS })
        if (!res.ok || !res.body) throw new Error(`${res.status}`)
        await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(part))
        if (!matches(part)) throw new Error('size or MD5 does not match the publisher')
        fs.renameSync(part, file)
      } finally {
        fs.rmSync(part, { force: true })
      }
    })
  })
}

const intersects = (a: DemArea, b: DemArea) => a.west < b.east && a.east > b.west && a.south < b.north && a.north > b.south

/** Some land (per the ground layer) inside the box? Sampled on a ~300 m step. */
function anyLand(box: DemArea, area: DemArea, landAt: LandAt): boolean {
  const s = Math.max(box.south, area.south), n = Math.min(box.north, area.north)
  const w = Math.max(box.west, area.west), e = Math.min(box.east, area.east)
  const step = 0.003
  for (let lat = s; lat <= n; lat += step) for (let lng = w; lng <= e; lng += step) if (landAt(lat, lng)) return true
  return false
}

// ── Overture buildings ────────────────────────────────────────────────────────

type OvertureGeometry = { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] }

/** Overture buildings: STAC item bbox → row-group bbox statistics → rows in the area. */
export function overtureReader(parallel = 4): BuildingReader {
  return {
    source: OVERTURE_BUILDINGS.id,
    version: OVERTURE_BUILDINGS.release,
    attribution: OVERTURE_BUILDINGS.attribution,
    async read(area, sink) {
      const tiles: DemTileRecord[] = []
      const failures: string[] = []
      type Coll = { extent: { spatial: { bbox: number[][] } }; links: Array<{ rel: string; href: string }> }
      let coll: Coll
      try {
        coll = await getJson<Coll>(OVERTURE_BUILDINGS.stacCollectionUrl)
      } catch (err) {
        return { tiles, failures: [`overture: ${(err as Error).message} (release ${OVERTURE_BUILDINGS.release} retired? bump OVERTURE_BUILDINGS.release)`] }
      }
      const items = coll.links.filter(l => l.rel === 'item')
      const boxes = coll.extent.spatial.bbox.slice(1) // [0] is the whole collection
      const hits: Array<{ href: string; bbox: number[] }> = []
      boxes.forEach((b, i) => {
        if (intersects({ west: b[0], south: b[1], east: b[2], north: b[3] }, area)) hits.push({ href: items[i]?.href, bbox: b })
      })
      for (const hit of hits) {
        try {
          type Item = { bbox: number[]; assets: { aws: { href: string; 'file:size': number } } }
          const item = await getJson<Item>(hit.href)
          if (item.bbox.some((v, k) => Math.abs(v - hit.bbox[k]) > 1e-9)) throw new Error(`STAC item ${hit.href} does not match the collection bbox`)
          const url = item.assets.aws.href
          const meta = await withRetry(`HEAD ${url}`, () => head(url))
          const file = await asyncBufferFromUrl({ url, byteLength: item.assets.aws['file:size'] })
          const md = await withRetry(`metadata ${url}`, () => parquetMetadataAsync(file))
          const names = md.row_groups[0].columns.map(c => c.meta_data!.path_in_schema.join('.'))
          const stat = (rg: (typeof md.row_groups)[number], col: string, which: 'min_value' | 'max_value') =>
            Number(rg.columns[names.indexOf(col)].meta_data!.statistics![which])
          const groups: Array<[number, number]> = []
          let start = 0
          for (const rg of md.row_groups) {
            const rows = Number(rg.num_rows)
            const box = { west: stat(rg, 'bbox.xmin', 'min_value'), east: stat(rg, 'bbox.xmax', 'max_value'), south: stat(rg, 'bbox.ymin', 'min_value'), north: stat(rg, 'bbox.ymax', 'max_value') }
            if (intersects(box, area)) groups.push([start, start + rows])
            start += rows
          }
          let next = 0
          const worker = async () => {
            while (next < groups.length) {
              const [rowStart, rowEnd] = groups[next++]
              const rows = (await withRetry(`rows ${rowStart} of ${url}`, () =>
                parquetReadObjects({ file, metadata: md, columns: ['height', 'num_floors', 'is_underground', 'geometry', 'bbox'], rowStart, rowEnd, compressors })
              )) as Array<{ height: number | null; num_floors: number | null; is_underground: boolean | null; geometry: OvertureGeometry; bbox: { xmin: number; xmax: number; ymin: number; ymax: number } }>
              for (const r of rows) {
                if (r.is_underground) continue
                if (!intersects({ west: r.bbox.xmin, east: r.bbox.xmax, south: r.bbox.ymin, north: r.bbox.ymax }, area)) continue
                const h = r.height && r.height > 0 ? r.height : r.num_floors && r.num_floors > 0 ? r.num_floors * BUILDING_LEVEL_HEIGHT_M : null
                const tier = h ? BUILDING_TIER.OVERTURE : BUILDING_TIER.UNMEASURED
                const polys = r.geometry?.type === 'Polygon' ? [r.geometry.coordinates] : r.geometry?.type === 'MultiPolygon' ? r.geometry.coordinates : []
                for (const p of polys) if (p[0]) sink(p[0], tier, h)
              }
            }
          }
          await Promise.all(Array.from({ length: parallel }, worker))
          tiles.push({ name: `${path.basename(url)} (${groups.length}/${md.row_groups.length} row groups)`, url, status: 'downloaded', etag: meta.etag, lastModified: meta.lastModified })
        } catch (err) {
          failures.push(`overture ${hit.href}: ${(err as Error).message}`)
        }
      }
      return { tiles, failures }
    },
  }
}

// ── 3D-GloBFP ─────────────────────────────────────────────────────────────────

/** Minimal dBASE reader: field offsets of a fixed-width table. */
function dbfLayout(header: Buffer): { records: number; headerLen: number; recordLen: number; fields: Map<string, { offset: number; len: number }> } {
  const fields = new Map<string, { offset: number; len: number }>()
  let offset = 1 // deletion flag
  for (let o = 32; header[o] !== 0x0d; o += 32) {
    const name = header.toString('latin1', o, o + 11).replace(/\0.*$/, '')
    const len = header[o + 16]
    fields.set(name, { offset, len })
    offset += len
  }
  return { records: header.readUInt32LE(4), headerLen: header.readUInt16LE(8), recordLen: header.readUInt16LE(10), fields }
}

/** Sequential reader over a big file, in chunks. */
class ChunkReader {
  private fd: number
  private buf = Buffer.alloc(0)
  private bufStart = 0
  constructor(file: string, private readonly chunk = 32 << 20) {
    this.fd = fs.openSync(file, 'r')
  }
  /** bytes [pos, pos + len) — pos never goes backwards by more than the chunk */
  read(pos: number, len: number): Buffer {
    if (pos < this.bufStart || pos + len > this.bufStart + this.buf.length) {
      const size = Math.max(this.chunk, len)
      const b = Buffer.alloc(size)
      const n = fs.readSync(this.fd, b, 0, size, pos)
      this.buf = b.subarray(0, n)
      this.bufStart = pos
    }
    return this.buf.subarray(pos - this.bufStart, pos - this.bufStart + len)
  }
  close() { fs.closeSync(this.fd) }
}

/**
 * Streams the polygons of a shapefile inside the area: outer rings only (clockwise in the
 * shapefile convention), with the numeric `field` of the matching dBASE record.
 */
export function readShapefilePolygons(shpFile: string, dbfFile: string, field: string, area: DemArea, onRing: (ring: Ring, value: number | null) => void): number {
  const shp = new ChunkReader(shpFile)
  const dbf = new ChunkReader(dbfFile, 8 << 20)
  try {
    const layout = dbfLayout(dbf.read(0, 4096))
    const f = layout.fields.get(field)
    if (!f) throw new Error(`${path.basename(dbfFile)} has no field ${field}`)
    const fileLen = shp.read(24, 4).readInt32BE(0) * 2
    let pos = 100, i = 0, kept = 0
    while (pos < fileLen) {
      const len = shp.read(pos + 4, 4).readInt32BE(0) * 2
      const rec = shp.read(pos + 8, len)
      pos += 8 + len
      const idx = i++
      if (rec.readInt32LE(0) !== 5) continue // null shape
      const box = { west: rec.readDoubleLE(4), south: rec.readDoubleLE(12), east: rec.readDoubleLE(20), north: rec.readDoubleLE(28) }
      if (!intersects(box, area)) continue
      const raw = dbf.read(layout.headerLen + idx * layout.recordLen + f.offset, f.len).toString('latin1').trim()
      const value = raw === '' ? null : Number(raw)
      const nParts = rec.readInt32LE(36), nPoints = rec.readInt32LE(40)
      const pts = 44 + 4 * nParts
      for (let p = 0; p < nParts; p++) {
        const a = rec.readInt32LE(44 + 4 * p)
        const b = p + 1 < nParts ? rec.readInt32LE(44 + 4 * (p + 1)) : nPoints
        const ring: Ring = []
        let twiceArea = 0
        for (let k = a; k < b; k++) ring.push([rec.readDoubleLE(pts + 16 * k), rec.readDoubleLE(pts + 16 * k + 8)])
        for (let k = 0, j = ring.length - 1; k < ring.length; j = k++) twiceArea += (ring[k][0] - ring[j][0]) * (ring[k][1] + ring[j][1])
        // Outer ring = clockwise (> 0 here); a single-part shape is its own outer ring whatever the writer did.
        if (nParts === 1 || twiceArea > 0) { onRing(ring, Number.isFinite(value) ? value : null); kept++ }
      }
    }
    return kept
  } finally {
    shp.close()
    dbf.close()
  }
}

/** Grid cells of `world_grid.shp`: id and box. */
function readWorldGrid(dir: string): Array<{ id: number; box: DemArea }> {
  const shp = fs.readFileSync(path.join(dir, 'world_grid.shp'))
  const dbf = fs.readFileSync(path.join(dir, 'world_grid.dbf'))
  const layout = dbfLayout(dbf)
  const f = layout.fields.get('grid_ID')
  if (!f) throw new Error('world_grid.dbf has no grid_ID')
  const out: Array<{ id: number; box: DemArea }> = []
  for (let pos = 100, i = 0; pos < shp.length; i++) {
    const len = shp.readInt32BE(pos + 4) * 2
    const c = pos + 8
    const box = { west: shp.readDoubleLE(c + 4), south: shp.readDoubleLE(c + 12), east: shp.readDoubleLE(c + 20), north: shp.readDoubleLE(c + 28) }
    const id = Number(dbf.toString('latin1', layout.headerLen + i * layout.recordLen + f.offset, layout.headerLen + i * layout.recordLen + f.offset + f.len).trim())
    out.push({ id, box })
    pos = c + len
  }
  return out
}

function unzip(zip: string, dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
  execFileSync('unzip', ['-o', '-q', zip, '-d', dir])
}

/** 3D-GloBFP: world grid → Figshare file of each cell (MD5 checked) → polygons in the area. */
export function globfpReader(cacheDir: string): BuildingReader {
  return {
    source: GLOBFP_3D.id,
    version: GLOBFP_3D.version,
    attribution: GLOBFP_3D.attribution,
    async read(area, sink, landAt) {
      const tiles: DemTileRecord[] = []
      const failures: string[] = []
      const dir = path.join(cacheDir, GLOBFP_3D.id)
      try {
        const gridZip = path.join(dir, 'world_grid.zip')
        await cachedDownload(GLOBFP_3D.worldGridUrl, gridZip, {})
        // unzip -o rewrites the files: no other worker reads them meanwhile
        const cells = (await withFileLock(sourceLock(path.join(dir, 'world_grid')), async () => {
          unzip(gridZip, path.join(dir, 'world_grid'))
          return readWorldGrid(path.join(dir, 'world_grid'))
        })).filter(g => intersects(g.box, area))
        type FigFile = { name: string; size: number; download_url: string; computed_md5: string }
        const listing: FigFile[] = []
        for (const article of GLOBFP_3D.figshareArticles) listing.push(...(await getJson<FigFile[]>(GLOBFP_3D.figshareFilesUrl(article))))
        for (const cell of cells) {
          const files = listing.filter(f => f.name.startsWith(`${cell.id}_`) && f.name.endsWith('.zip'))
          if (!files.length) {
            if (anyLand(cell.box, area, landAt)) failures.push(`3d-globfp: grid ${cell.id} has land in the area and no file on Figshare`)
            continue
          }
          for (const f of files) {
            const zip = path.join(dir, f.name)
            await cachedDownload(f.download_url, zip, { size: f.size, md5: f.computed_md5 })
            const out = path.join(dir, f.name.replace(/\.zip$/, ''))
            unzip(zip, out)
            try {
              const shp = fs.readdirSync(out).find(n => n.endsWith('.shp'))
              if (!shp) throw new Error(`${f.name} has no .shp`)
              readShapefilePolygons(path.join(out, shp), path.join(out, shp.replace(/\.shp$/, '.dbf')), GLOBFP_3D.heightField, area, (ring, h) =>
                sink(ring, h && h > 0 ? BUILDING_TIER.GLOBFP : BUILDING_TIER.UNMEASURED, h)
              )
            } finally {
              fs.rmSync(out, { recursive: true, force: true }) // 1.4 GB unzipped; the zip stays cached
            }
            tiles.push({ name: f.name, url: f.download_url, status: 'downloaded', etag: `md5:${f.computed_md5}`, lastModified: null })
          }
        }
      } catch (err) {
        failures.push(`3d-globfp: ${(err as Error).message}`)
      }
      return { tiles, failures }
    },
  }
}

/**
 * #831: the files in `cacheDir` an area was built from — the 3D-GloBFP zips and the Meta/WRI
 * canopy tiles its manifest lists. The world grid stays: every area reads it.
 */
export function obstacleSourceFiles(cacheDir: string, layers: Array<Pick<DemLayerRecord, 'layer' | 'tiles'>>): string[] {
  const out: string[] = []
  for (const l of layers) {
    for (const t of l.tiles) {
      if (l.layer === 'buildings' && t.url !== GLOBFP_3D.worldGridUrl && t.name.endsWith('.zip')) out.push(path.join(cacheDir, GLOBFP_3D.id, t.name))
      if (l.layer === 'canopy' && /^\d+$/.test(t.name)) out.push(path.join(cacheDir, META_CHM.id, `${t.name}.tif`))
    }
  }
  return out
}

// ── Meta / WRI canopy height ──────────────────────────────────────────────────

/** Web-Mercator box (metres) of a quadkey tile. */
export function quadkeyBox(quadkey: string): { x0: number; y0: number; size: number } {
  let x = 0, y = 0
  for (const ch of quadkey) {
    const d = Number(ch)
    x = x * 2 + (d & 1)
    y = y * 2 + ((d >> 1) & 1)
  }
  const world = 2 * Math.PI * WEB_MERCATOR_R
  const size = world / 2 ** quadkey.length
  return { x0: -world / 2 + x * size, y0: world / 2 - y * size, size }
}

const mercToLat = (y: number) => (Math.atan(Math.sinh(y / WEB_MERCATOR_R)) * 180) / Math.PI
const mercToLng = (x: number) => (x / WEB_MERCATOR_R) * (180 / Math.PI)

export function metaChmReader(cacheDir: string): CanopyReader {
  return {
    source: META_CHM.id,
    version: META_CHM.version,
    attribution: META_CHM.attribution,
    async read(grid) {
      const values = new Uint8Array(grid.width * grid.height)
      const covered = new Uint8Array(grid.width * grid.height)
      const tiles: DemTileRecord[] = []
      const failures: string[] = []
      const south = grid.north - (grid.height - 1) * grid.res, east = grid.west + (grid.width - 1) * grid.res
      const box: DemArea = { south: south - grid.res, north: grid.north + grid.res, west: grid.west - grid.res, east: east + grid.res }
      try {
        type Index = { features: Array<{ properties: { tile: string }; geometry: { coordinates: number[][][] } }> }
        const index = await getJson<Index>(META_CHM.tilesIndexUrl)
        const hits = index.features.filter(f => {
          const xs = f.geometry.coordinates[0].map(p => p[0]), ys = f.geometry.coordinates[0].map(p => p[1])
          return intersects({ west: Math.min(...xs), east: Math.max(...xs), south: Math.min(...ys), north: Math.max(...ys) }, box)
        })
        for (const hit of hits) {
          const qk = hit.properties.tile
          const url = META_CHM.tileUrl(qk)
          try {
            const meta = await withRetry(`HEAD ${qk}`, () => head(url))
            const file = path.join(cacheDir, META_CHM.id, `${qk}.tif`)
            await cachedDownload(url, file, { size: meta.size })
            await aggregateChmTile(file, qk, grid, values, covered)
            tiles.push({ name: qk, url, status: 'downloaded', etag: meta.etag, lastModified: meta.lastModified })
          } catch (err) {
            failures.push(`meta-chm ${qk}: ${(err as Error).message}`)
          }
        }
      } catch (err) {
        failures.push(`meta-chm: ${(err as Error).message}`)
      }
      return { values, covered, tiles, failures }
    },
  }
}

/** Reads one CHM tile in full (every strip) and adds its pixels to the cells of `grid`. */
async function aggregateChmTile(file: string, quadkey: string, grid: DemGrid, values: Uint8Array, covered: Uint8Array): Promise<void> {
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
  let x0 = w, x1 = -1
  for (let x = 0; x < w; x++) {
    const c = Math.round((mercToLng(ox + (x + 0.5) * rx) - grid.west) / grid.res)
    colOf[x] = c >= 0 && c < grid.width ? c : -1
    if (colOf[x] >= 0) { if (x < x0) x0 = x; x1 = x }
  }
  if (x1 < 0) return
  const rowOf = (y: number) => Math.round((grid.north - mercToLat(oy + (y + 0.5) * ry)) / grid.res)
  let y0 = 0, y1 = h - 1
  while (y0 < h && rowOf(y0) < 0) y0++
  while (y1 >= 0 && rowOf(y1) >= grid.height) y1--
  if (y0 > y1) return
  const acc = new RowPercentile(grid.width, values)
  const CHUNK = 256
  for (let ya = y0; ya <= y1; ya += CHUNK) {
    const yb = Math.min(y1 + 1, ya + CHUNK)
    const win = (await image.readRasters({ window: [x0, ya, x1 + 1, yb], samples: [0] })) as unknown as Uint8Array[]
    const data = win[0]
    const ww = x1 + 1 - x0
    if (data.length !== ww * (yb - ya)) throw new Error(`read ${data.length} pixels, expected ${ww * (yb - ya)}`)
    for (let y = ya; y < yb; y++) {
      const r = rowOf(y)
      if (r < 0 || r >= grid.height) continue
      const off = (y - ya) * ww
      for (let x = x0; x <= x1; x++) {
        const c = colOf[x]
        if (c < 0) continue
        acc.add(r, c, data[off + x - x0])
        covered[r * grid.width + c] = 1
      }
    }
  }
  acc.flush()
}
