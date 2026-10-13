/**
 * EP — city preparation (#782; INV-EPa, INV-EPb). Runs once per city or batch, BEFORE E1,
 * and is the only place that touches the network for relief. E1–E11 read the result from
 * disk through `dem-store` (INV-EPc).
 *
 *  1. area = the city (its POI pins and the city-base circle) + `SANITY_MAX_TP_DISTANCE_M`,
 *     because a TP may sit outside the city limit;
 *  2. both layers are read for that area on one 1-arc-second lattice (`dem-sources`);
 *  3. every tile is checked: its georeference matches its name and the lattice, it read in
 *     full, and there is no no-data over land;
 *  4. the measured obstacles (#783, `obstacle-prepare`): building footprints with height
 *     (Overture, 3D-GloBFP) and canopy height (Meta/WRI), on the obstacle lattice;
 *  5. a manifest records layer, source version, date and tiles.
 *
 * A missing tile or a hole over land fails the city: the manifest says `failed`, the store
 * refuses its POIs, and nothing falls back to SRTM or anything else (INV-EPb).
 */

import * as fs from 'fs'
import * as path from 'path'
import { createHash } from 'crypto'
import { fromUrl, type GeoTIFFImage } from 'geotiff'
import {
  COPERNICUS_GLO30,
  DEM_LATTICE_DEG,
  GEDTM30,
  copernicusTileName,
  copernicusTileUrl,
  copernicusTileWidth,
  type DemLayer,
} from './dem-sources'
import {
  BuildingRaster,
  globfpReader,
  metaChmReader,
  obstacleSourceFiles,
  overtureReader,
  type BuildingReader,
  type CanopyReader,
  type DemArea,
} from './obstacle-prepare'
import {
  DEM_MANIFEST_FILE,
  DemNotPreparedError,
  DemStore,
  defaultDemCacheDir,
  nearestCell,
  obstacleGrid,
  type DemGrid,
  type DemLayerRecord,
  type DemManifest,
  type DemTileRecord,
} from './dem-store'
import { LOCK_POLL_MS, tryLock } from './file-lock'

type LatLng = { lat: number; lng: number }
export type { DemArea }

/**
 * A cell is sea when both layers agree it is at sea level. Copernicus reads ~0 m over the
 * sea inside a land tile and has no tile over open ocean; GEDTM30 has no-data over the sea.
 * Anything higher with a layer missing is a hole over land.
 */
export const DEM_SEA_MAX_M = 2

export interface LayerRead {
  /** row-major over the grid; NaN where the source has no value */
  values: Float32Array
  /** 1 where the source has no tile because it says the place is open sea (Copernicus) */
  seaAssumed?: Uint8Array
  tiles: DemTileRecord[]
  failures: string[]
}

export interface LayerReader {
  layer: DemLayer
  source: string
  version: string
  attribution: string
  read(grid: DemGrid): Promise<LayerRead>
}

const M_PER_DEG_LAT = 110_540

/** Area of a city: the box around its pins and centre-circle, grown by `marginM` on every side. */
export function cityDemArea(points: LatLng[], marginM: number): DemArea {
  if (points.length === 0) throw new Error('EP: a city area needs at least one point')
  const lats = points.map(p => p.lat)
  const lngs = points.map(p => p.lng)
  const south = Math.min(...lats), north = Math.max(...lats)
  const maxAbsLat = Math.max(Math.abs(south), Math.abs(north))
  const dLat = marginM / M_PER_DEG_LAT
  const dLng = marginM / (111_320 * Math.cos((Math.min(maxAbsLat, 89) * Math.PI) / 180))
  return { south: south - dLat, north: north + dLat, west: Math.min(...lngs) - dLng, east: Math.max(...lngs) + dLng }
}

/** The lattice grid (pixel centres on whole degrees + k/3600) that covers the area. */
export function snapGrid(area: DemArea): DemGrid {
  const n = Math.ceil(area.north / DEM_LATTICE_DEG)
  const s = Math.floor(area.south / DEM_LATTICE_DEG)
  const w = Math.floor(area.west / DEM_LATTICE_DEG)
  const e = Math.ceil(area.east / DEM_LATTICE_DEG)
  return { north: n * DEM_LATTICE_DEG, west: w * DEM_LATTICE_DEG, res: DEM_LATTICE_DEG, width: e - w + 1, height: n - s + 1 }
}

/** Integer arc-second index of a lattice coordinate (the grid is built on it, so this is exact). */
const idx = (deg: number) => Math.round(deg / DEM_LATTICE_DEG)

async function withRetry<T>(what: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      last = err
      await new Promise(r => setTimeout(r, 500 * (i + 1)))
    }
  }
  throw new Error(`${what}: ${(last as Error)?.message ?? String(last)}`)
}

async function head(url: string): Promise<{ etag: string | null; lastModified: string | null }> {
  const res = await fetch(url, { method: 'HEAD' })
  if (!res.ok) throw new Error(`HEAD ${url} → ${res.status}`)
  return { etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified') }
}

/** The image of one tile COG, read by window over HTTP ranges. A test hands a synthetic one. */
type OpenTile = (url: string) => Promise<Pick<GeoTIFFImage, 'getOrigin' | 'getResolution' | 'getWidth' | 'getHeight' | 'readRasters'>>

/** Copernicus GLO-30 (surface), one COG per 1°×1° tile on AWS Open Data. */
export function copernicusReader(openTile: OpenTile = async url => (await fromUrl(url)).getImage()): LayerReader {
  let tileList: Set<string> | null = null
  return {
    layer: 'surface',
    source: COPERNICUS_GLO30.id,
    version: COPERNICUS_GLO30.version,
    attribution: COPERNICUS_GLO30.attribution,
    async read(grid) {
      if (!tileList) {
        const txt = await withRetry('tileList', async () => {
          const r = await fetch(COPERNICUS_GLO30.tileListUrl)
          if (!r.ok) throw new Error(`tileList → ${r.status}`)
          return r.text()
        })
        tileList = new Set(txt.split(/\s+/).filter(Boolean))
      }
      const values = new Float32Array(grid.width * grid.height).fill(NaN)
      const seaAssumed = new Uint8Array(grid.width * grid.height)
      const tiles: DemTileRecord[] = []
      const failures: string[] = []
      const nIdx = idx(grid.north), wIdx = idx(grid.west)
      const sIdx = nIdx - (grid.height - 1), eIdx = wIdx + (grid.width - 1)
      // A tile S…/W… holds rows with lat in (south, south+1] and columns with lng in [west, west+1).
      for (let south = Math.ceil(sIdx / 3600) - 1; south * 3600 < nIdx; south++) {
        for (let west = Math.floor(wIdx / 3600); west * 3600 <= eIdx; west++) {
          const name = copernicusTileName(south, west)
          const url = copernicusTileUrl(name)
          if (!tileList.has(name)) {
            // Open ocean, or a tile not released to the public: the ground layer tells them apart.
            for (let r = 0; r < grid.height; r++) {
              const latIdx = nIdx - r
              if (latIdx <= south * 3600 || latIdx > (south + 1) * 3600) continue
              for (let c = 0; c < grid.width; c++) {
                const lngIdx = wIdx + c
                if (lngIdx >= west * 3600 && lngIdx < (west + 1) * 3600) seaAssumed[r * grid.width + c] = 1
              }
            }
            tiles.push({ name, url, status: 'ocean' })
            continue
          }
          try {
            const meta = await withRetry(`HEAD ${name}`, () => head(url))
            const image = await withRetry(`open ${name}`, () => openTile(url))
            const [ox, oy] = image.getOrigin()
            const [rx, ry] = image.getResolution()
            const tw = image.getWidth(), th = image.getHeight()
            // The georeference must match the name and the lattice (EP: "coordenadas batendo").
            // Above 50° a column is 1.5″, 2″… wide (`copernicusTileWidth`): read on that step, not refused.
            if (Math.abs(ox - west) > 1e-9 || Math.abs(oy - (south + 1)) > 1e-9 || Math.abs(ry + DEM_LATTICE_DEG) > 1e-12
              || th !== 3600 || tw !== copernicusTileWidth(south) || Math.abs(tw * rx - 1) > 1e-9) {
              failures.push(`${name}: georeference ${ox},${oy} res ${rx},${ry} size ${tw}×${th} does not match the tile`)
              continue
            }
            const k = 3600 / tw
            // Grid rows/cols inside this tile.
            const rowLo = Math.max(0, nIdx - (south + 1) * 3600)
            const rowHi = Math.min(grid.height - 1, nIdx - (south * 3600 + 1))
            const colLo = Math.max(0, west * 3600 - wIdx)
            const colHi = Math.min(grid.width - 1, (west + 1) * 3600 - 1 - wIdx)
            if (rowLo > rowHi || colLo > colHi) continue
            const tRow0 = (south + 1) * 3600 - (nIdx - rowLo)
            const tRow1 = (south + 1) * 3600 - (nIdx - rowHi)
            const tCol0 = Math.floor((wIdx + colLo - west * 3600) / k)
            const tCol1 = Math.min(tw - 1, Math.ceil((wIdx + colHi - west * 3600) / k))
            const win = (await withRetry(`read ${name}`, () =>
              image.readRasters({ window: [tCol0, tRow0, tCol1 + 1, tRow1 + 1], samples: [0], interleave: true })
            )) as unknown as Float32Array
            const ww = tCol1 - tCol0 + 1
            if (win.length !== ww * (tRow1 - tRow0 + 1)) {
              failures.push(`${name}: read ${win.length} values, expected ${ww * (tRow1 - tRow0 + 1)}`)
              continue
            }
            for (let r = rowLo; r <= rowHi; r++) {
              const tr = (south + 1) * 3600 - (nIdx - r) - tRow0
              for (let c = colLo; c <= colHi; c++) {
                // Above 50° the tile has 1 column every k arc-seconds: linear along the parallel.
                const fx = (wIdx + c - west * 3600) / k - tCol0
                const x0 = Math.min(Math.floor(fx), ww - 1)
                const x1 = Math.min(x0 + 1, ww - 1)
                const t = fx - x0
                const a = win[tr * ww + x0], b = win[tr * ww + x1]
                const v = a * (1 - t) + b * t
                values[r * grid.width + c] = v > COPERNICUS_GLO30.voidBelowM ? v : NaN
              }
            }
            tiles.push({ name, url, status: 'downloaded', etag: meta.etag, lastModified: meta.lastModified })
          } catch (err) {
            failures.push(`${name}: ${(err as Error).message}`)
          }
        }
      }
      return { values, seaAssumed, tiles, failures }
    },
  }
}

/** GEDTM30 v1.2.0 (ground), one global COG read by window. */
export function gedtm30Reader(): LayerReader {
  return {
    layer: 'ground',
    source: GEDTM30.id,
    version: GEDTM30.version,
    attribution: GEDTM30.attribution,
    async read(grid) {
      const values = new Float32Array(grid.width * grid.height).fill(NaN)
      const failures: string[] = []
      const tiles: DemTileRecord[] = []
      try {
        const meta = await withRetry('HEAD gedtm30', () => head(GEDTM30.url))
        const image = await withRetry('open gedtm30', async () => (await fromUrl(GEDTM30.url)).getImage())
        const [ox, oy] = image.getOrigin()
        const [rx, ry] = image.getResolution()
        // PixelIsArea: centre of column i is ox + (i + 0.5)·rx. It must land on the lattice.
        const col0 = (grid.west - ox) / rx - 0.5
        const row0 = (grid.north - oy) / ry - 0.5
        if (Math.abs(rx - DEM_LATTICE_DEG) > 1e-9 || Math.abs(ry + DEM_LATTICE_DEG) > 1e-9
          || Math.abs(col0 - Math.round(col0)) > 1e-3 || Math.abs(row0 - Math.round(row0)) > 1e-3) {
          failures.push(`gedtm30: georeference ${ox},${oy} res ${rx},${ry} is off the lattice (col ${col0}, row ${row0})`)
          return { values, tiles, failures }
        }
        const c0 = Math.round(col0), r0 = Math.round(row0)
        if (c0 < 0 || r0 < 0 || c0 + grid.width > image.getWidth() || r0 + grid.height > image.getHeight()) {
          failures.push(`gedtm30: the area is outside the dataset (it covers ${image.getBoundingBox().join(',')})`)
          return { values, tiles, failures }
        }
        const win = (await withRetry('read gedtm30', () =>
          image.readRasters({ window: [c0, r0, c0 + grid.width, r0 + grid.height], samples: [0], interleave: true })
        )) as unknown as Float32Array
        if (win.length !== values.length) {
          failures.push(`gedtm30: read ${win.length} values, expected ${values.length}`)
          return { values, tiles, failures }
        }
        for (let i = 0; i < win.length; i++) values[i] = win[i] < GEDTM30.noDataAboveM ? win[i] : NaN
        tiles.push({
          name: `window c${c0} r${r0} ${grid.width}×${grid.height}`,
          url: GEDTM30.url,
          status: 'downloaded',
          etag: meta.etag,
          lastModified: meta.lastModified,
        })
      } catch (err) {
        failures.push(`gedtm30: ${(err as Error).message}`)
      }
      return { values, tiles, failures }
    },
  }
}

/**
 * Sea is filled (surface = ground = sea level); a hole over land is counted. A cell is sea when
 * the layer that has a value there reads sea level, or when the surface source has no tile
 * (open ocean) and the ground has no value either. Both layers empty inside a surface tile is a
 * void, not the sea. Pure: mutates the two arrays and returns the counts.
 */
export function fillSeaAndCountHoles(surface: Float32Array, ground: Float32Array, seaAssumed?: Uint8Array): { seaCells: number; landHoles: number } {
  let seaCells = 0, landHoles = 0
  for (let i = 0; i < surface.length; i++) {
    const s = surface[i], g = ground[i]
    const sOk = Number.isFinite(s), gOk = Number.isFinite(g)
    if (sOk && gOk) continue
    const known = sOk ? s : gOk ? g : seaAssumed?.[i] ? 0 : Infinity
    if (known <= DEM_SEA_MAX_M) {
      const sea = Math.max(known, 0)
      if (!sOk) surface[i] = sea
      if (!gOk) ground[i] = Math.min(sea, surface[i])
      seaCells++
    } else {
      landHoles++
    }
  }
  return { seaCells, landHoles }
}

export function slugCity(city: string): string {
  return city.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function writeAtomic(file: string, data: Buffer | string): void {
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, file)
}

export interface PrepareCityDemInput {
  city: string
  area: DemArea
  marginM: number
  dir?: string
  readers?: LayerReader[]
  /** measured obstacles (#783); default: Overture + 3D-GloBFP, and Meta/WRI canopy */
  obstacles?: { buildings: BuildingReader[]; canopy: CanopyReader }
  now?: () => Date
}

/** EP for one city. Always writes the manifest; `status` says whether the city may generate. */
export async function prepareCityDem(input: PrepareCityDemInput): Promise<DemManifest> {
  const readers = input.readers ?? [copernicusReader(), gedtm30Reader()]
  const sourcesDir = path.join(input.dir ?? defaultDemCacheDir(), '_sources')
  const obstacles = input.obstacles ?? { buildings: [overtureReader(), globfpReader(sourcesDir)], canopy: metaChmReader(sourcesDir) }
  const cityDir = path.join(input.dir ?? defaultDemCacheDir(), slugCity(input.city))
  fs.mkdirSync(cityDir, { recursive: true })
  const grid = snapGrid(input.area)
  const failures: string[] = []
  const reads = new Map<DemLayer, { reader: LayerReader; read: LayerRead }>()
  for (const reader of readers) {
    const read = await reader.read(grid)
    failures.push(...read.failures)
    reads.set(reader.layer, { reader, read })
  }
  const surface = reads.get('surface'), ground = reads.get('ground')
  if (!surface || !ground) failures.push('EP needs both a surface and a ground layer')
  let checks = { seaCells: 0, landHoles: 0 }
  if (surface && ground && failures.length === 0) {
    checks = fillSeaAndCountHoles(surface.read.values, ground.read.values, surface.read.seaAssumed)
    if (checks.landHoles > 0) failures.push(`${checks.landHoles} cells without data over land`)
  }
  // The obstacles only after the relief is good: they cost gigabytes, and they need the ground
  // to tell land from sea.
  const og = obstacleGrid(grid)
  const extra: Array<{ record: Omit<DemLayerRecord, 'sha256'>; data: Uint8Array | Uint16Array }> = []
  let obstacleChecks: Pick<DemManifest['checks'], 'buildings' | 'canopy'> = {}
  if (failures.length === 0 && ground) {
    const g = ground.read.values
    const landAt = (lat: number, lng: number) => {
      const i = nearestCell(grid, lat, lng)
      return i >= 0 && g[i] > DEM_SEA_MAX_M
    }
    const raster = new BuildingRaster(og)
    const tiles = []
    for (const reader of obstacles.buildings) {
      const t0 = Date.now()
      const r = await reader.read(input.area, raster.add, landAt)
      console.error(`EP ${input.city}: ${reader.source} ${Math.round((Date.now() - t0) / 1000)} s, ${r.failures.length} failures`)
      failures.push(...r.failures)
      tiles.push(...r.tiles)
    }
    const calibrated = raster.calibrateGlobfp()
    console.error(`EP ${input.city}: 3D-GloBFP calibrated on ${calibrated.tiles} tiles, ${calibrated.cells} cells`)
    let builtCells = 0
    for (let i = 0; i < raster.cells.length; i++) if (raster.cells[i]) builtCells++
    extra.push({
      record: {
        layer: 'buildings',
        source: obstacles.buildings.map(b => b.source).join('+'),
        version: obstacles.buildings.map(b => `${b.source}:${b.version}`).join('+'),
        attribution: obstacles.buildings.map(b => b.attribution).join(' · '),
        file: 'buildings.u16',
        tiles,
      },
      data: raster.cells,
    })
    const t0 = Date.now()
    const canopy = await obstacles.canopy.read(og)
    console.error(`EP ${input.city}: ${obstacles.canopy.source} ${Math.round((Date.now() - t0) / 1000)} s, ${canopy.failures.length} failures`)
    failures.push(...canopy.failures)
    let treeCells = 0, holes = 0
    for (let i = 0; i < canopy.values.length; i++) {
      if (canopy.values[i] > 0) treeCells++
      if (!canopy.covered[i] && landAt(og.north - Math.floor(i / og.width) * og.res, og.west + (i % og.width) * og.res)) holes++
    }
    if (holes > 0) failures.push(`${holes} land cells without a canopy tile`)
    extra.push({
      record: { layer: 'canopy', source: obstacles.canopy.source, version: obstacles.canopy.version, attribution: obstacles.canopy.attribution, file: 'canopy.u8', tiles: canopy.tiles },
      data: canopy.values,
    })
    obstacleChecks = { buildings: { ...raster.counts, cells: builtCells, globfpCalibrated: calibrated }, canopy: { treeCells, landHoles: holes } }
  }
  const layers: DemLayerRecord[] = []
  const write = (file: string, data: Float32Array | Uint16Array | Uint8Array) => {
    const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
    if (failures.length === 0) writeAtomic(path.join(cityDir, file), buf)
    return createHash('sha256').update(buf).digest('hex')
  }
  for (const [layer, { reader, read }] of reads) {
    const file = `${layer}.f32`
    layers.push({ layer, source: reader.source, version: reader.version, attribution: reader.attribution, file, sha256: write(file, read.values), tiles: read.tiles })
  }
  for (const { record, data } of extra) layers.push({ ...record, sha256: write(record.file, data) })
  const manifest: DemManifest = {
    city: input.city,
    preparedAt: (input.now?.() ?? new Date()).toISOString(),
    area: input.area,
    marginM: input.marginM,
    grid,
    obstacleGrid: og,
    status: failures.length === 0 ? 'ok' : 'failed',
    failures,
    layers,
    checks: { ...checks, ...obstacleChecks },
  }
  writeAtomic(path.join(cityDir, DEM_MANIFEST_FILE), JSON.stringify(manifest, null, 2))
  return manifest
}

// ── #831: the relief by 1° cell, prepared by the generation itself ─────────────

/** The 1°×1° cell of a point, named by its south-west corner (the Copernicus tile of the same name). */
export interface DemCell {
  south: number
  west: number
}

export function demCellOf(lat: number, lng: number): DemCell {
  return { south: Math.floor(lat), west: Math.floor(lng) }
}

/** Stable directory name of a cell: S23/W047 → `cell-23s47w`, N48/E16 → `cell-48n16e`. */
export function demCellId(cell: DemCell): string {
  return `cell-${Math.abs(cell.south)}${cell.south < 0 ? 's' : 'n'}${Math.abs(cell.west)}${cell.west < 0 ? 'w' : 'e'}`
}

/** The whole cell grown by `marginM`: any POI inside it has its TP reach inside the area. */
export function demCellArea(cell: DemCell, marginM: number): DemArea {
  return cityDemArea([{ lat: cell.south, lng: cell.west }, { lat: cell.south + 1, lng: cell.west + 1 }], marginM)
}

/**
 * Free-disk floor of an automatic preparation, `DEM_MIN_FREE_GB` (default 10). One cell downloads
 * ~0.4 GB in Brazil and up to several GB of canopy tiles and building zips before cleaning them up.
 */
export function demMinFreeBytes(): number {
  const gb = Number(process.env.DEM_MIN_FREE_GB)
  return (Number.isFinite(gb) && gb >= 0 ? gb : 10) * 1024 ** 3
}

/** A failed cell is not prepared again before this, so a queue of its POIs does not download it once per POI. */
export const DEM_CELL_RETRY_AFTER_MS = 30 * 60_000

const LOCKS_DIR = '_locks'

function readCellManifest(dir: string, id: string): DemManifest | null {
  const file = path.join(dir, id, DEM_MANIFEST_FILE)
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as DemManifest) : null
}

export interface EnsureDemCellInput {
  lat: number
  lng: number
  marginM: number
  dir?: string
  /** the preparation of the cell's area; `prepareCityDem` with the real sources by default */
  prepare?: (input: { city: string; area: DemArea; marginM: number; dir: string }) => Promise<DemManifest>
  now?: () => Date
}

/**
 * #831: makes sure the relief covers the point ± `marginM`, preparing its 1° cell when no
 * prepared area does (the areas prepared by city or bbox before #831 still count). Only the first
 * POI of a cell waits; a second worker on the same cell waits for the lock and reads the result.
 * Returns whether this call prepared the cell. Throws `DemNotPreparedError` when the cell cannot
 * be made ready (disk floor, failed download, a failure younger than `DEM_CELL_RETRY_AFTER_MS`).
 */
export async function ensureDemCell(input: EnsureDemCellInput): Promise<boolean> {
  const dir = input.dir ?? defaultDemCacheDir()
  const now = () => (input.now?.() ?? new Date()).getTime()
  const cell = demCellOf(input.lat, input.lng)
  const id = demCellId(cell)
  const lockFile = path.join(dir, LOCKS_DIR, `${id}.lock`)
  const failedRecently = () => {
    const m = readCellManifest(dir, id)
    return m?.status === 'failed' && now() - Date.parse(m.preparedAt) < DEM_CELL_RETRY_AFTER_MS ? m : null
  }
  for (;;) {
    if (new DemStore(dir).preparedFor(input.lat, input.lng, input.marginM)) return false
    const failed = failedRecently()
    if (failed) throw new DemNotPreparedError(`EP ${id}: ${failed.failures.join('; ')} (prepared at ${failed.preparedAt}; retried after ${DEM_CELL_RETRY_AFTER_MS / 60_000} min)`)
    if (process.env.VERCEL) throw new DemNotPreparedError(`EP ${id}: the relief is prepared on the generation machine, not in a Function`)
    if (tryLock(lockFile)) {
      try {
        // another worker may have finished between the check and the lock
        if (new DemStore(dir).preparedFor(input.lat, input.lng, input.marginM)) return false
        const free = fs.statfsSync(dir)
        const freeBytes = free.bavail * free.bsize
        if (freeBytes < demMinFreeBytes()) {
          throw new DemNotPreparedError(`EP ${id}: ${(freeBytes / 1024 ** 3).toFixed(1)} GB free in ${dir}, below the floor of ${(demMinFreeBytes() / 1024 ** 3).toFixed(1)} GB (DEM_MIN_FREE_GB)`)
        }
        const area = demCellArea(cell, input.marginM)
        const t0 = Date.now()
        console.error(`EP ${id}: preparing the cell for ${input.lat.toFixed(4)},${input.lng.toFixed(4)}`)
        const prepare = input.prepare ?? (args => prepareCityDem(args))
        const manifest = await prepare({ city: id, area, marginM: input.marginM, dir })
        if (manifest.status !== 'ok') throw new DemNotPreparedError(`EP ${id}: ${manifest.failures.join('; ')}`)
        // checked (size and sha256 of every layer) before the sources it was built from go
        const cover = new DemStore(dir).coverage(input.lat, input.lng, input.marginM)
        if (!cover.ok) throw new DemNotPreparedError(cover.reason)
        cleanSources(dir, manifest, lockFile)
        console.error(`EP ${id}: ready in ${Math.round((Date.now() - t0) / 1000)} s`)
        return true
      } finally {
        fs.rmSync(lockFile, { force: true })
      }
    }
    await new Promise(r => setTimeout(r, LOCK_POLL_MS))
  }
}

/**
 * The downloaded files a prepared area was built from are not read at runtime (`DemStore` reads
 * the area directory only): they go once the area is checked. Skipped while another cell is being
 * prepared, because neighbouring cells share canopy tiles and building zips.
 */
function cleanSources(dir: string, manifest: DemManifest, ownLock: string): void {
  const others = fs.readdirSync(path.dirname(ownLock)).filter(f => f.endsWith('.lock') && path.join(path.dirname(ownLock), f) !== ownLock)
  if (others.length) {
    console.error(`EP ${manifest.city}: sources kept, ${others.length} other cell(s) in preparation`)
    return
  }
  let bytes = 0
  for (const file of obstacleSourceFiles(path.join(dir, '_sources'), manifest.layers)) {
    if (!fs.existsSync(file)) continue
    bytes += fs.statSync(file).size
    fs.rmSync(file, { force: true })
  }
  console.error(`EP ${manifest.city}: ${(bytes / 1024 ** 3).toFixed(2)} GB of sources removed`)
}
