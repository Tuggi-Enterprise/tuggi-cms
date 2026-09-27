/**
 * EP → E1–E11 (#782): the relief the TP engine reads, from disk only (INV-EPc).
 *
 * `dem-prepare` downloads the two layers once per city into `data/dem-cache/<city>/` and
 * writes a manifest. This store only reads what is there: no network, no fallback to another
 * source (INV-EPb). A point outside every prepared city reads `null`, and a POI whose area
 * was not prepared is refused before E1 (`coverage`).
 *
 * Layers (sources and attribution in `dem-sources`):
 *  - `surface` — Copernicus DEM GLO-30: ground + buildings + trees. The obstacle (E8).
 *    produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and
 *    Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all
 *    rights reserved.
 *  - `ground` — GEDTM30 v1.2.0 (OpenGeoHub, doi:10.5281/zenodo.18887460, CC BY 4.0): bare
 *    terrain. The base of the POI, of the TP and of the observer eye (E4).
 *
 * Reads are bilinear between the four pixel centres around the point, never rounded to the
 * metre (the SRTM service rounded, on a 90 m grid).
 */

import * as fs from 'fs'
import * as path from 'path'
import { createHash } from 'crypto'
import type { DemLayer } from './dem-sources'

/** Pixel-centre grid shared by both layers of a city. Row 0 is the northernmost. */
export interface DemGrid {
  /** latitude of the centre of row 0 */
  north: number
  /** longitude of the centre of column 0 */
  west: number
  /** degrees between two pixel centres, in latitude and in longitude */
  res: number
  width: number
  height: number
}

export interface DemTileRecord {
  name: string
  url: string
  /** 'downloaded' | 'ocean' (absent from the source's tile list, and the ground layer says sea) */
  status: 'downloaded' | 'ocean'
  etag?: string | null
  lastModified?: string | null
}

export interface DemLayerRecord {
  layer: DemLayer
  source: string
  version: string
  attribution: string
  /** file name inside the city directory: raw little-endian Float32, row-major, grid.width × grid.height */
  file: string
  sha256: string
  tiles: DemTileRecord[]
}

export interface DemManifest {
  city: string
  preparedAt: string
  /** the requested area (city + margin), before snapping to the lattice */
  area: { south: number; west: number; north: number; east: number }
  marginM: number
  grid: DemGrid
  status: 'ok' | 'failed'
  /** why the city does not generate (missing tile, no-data over land, bad georeference) */
  failures: string[]
  layers: DemLayerRecord[]
  checks: { seaCells: number; landHoles: number }
}

export const DEM_MANIFEST_FILE = 'manifest.json'

/** Metres per degree of latitude (the same constant as `elevation-service#offsetM`). */
const M_PER_DEG_LAT = 110_540

export function defaultDemCacheDir(): string {
  return path.join(process.cwd(), 'data', 'dem-cache')
}

export function gridContains(g: DemGrid, lat: number, lng: number): boolean {
  const south = g.north - (g.height - 1) * g.res
  const east = g.west + (g.width - 1) * g.res
  return lat <= g.north && lat >= south && lng >= g.west && lng <= east
}

/** Bilinear read of a Float32 grid; null outside the grid or on a no-data (NaN) neighbour. */
export function bilinear(g: DemGrid, data: Float32Array, lat: number, lng: number): number | null {
  const fy = (g.north - lat) / g.res
  const fx = (lng - g.west) / g.res
  if (!(fy >= 0 && fx >= 0 && fy <= g.height - 1 && fx <= g.width - 1)) return null
  const r0 = Math.min(Math.floor(fy), g.height - 2)
  const c0 = Math.min(Math.floor(fx), g.width - 2)
  const dy = fy - r0
  const dx = fx - c0
  const i = r0 * g.width + c0
  const a = data[i], b = data[i + 1], c = data[i + g.width], d = data[i + g.width + 1]
  const v = (a * (1 - dx) + b * dx) * (1 - dy) + (c * (1 - dx) + d * dx) * dy
  return Number.isFinite(v) ? v : null
}

interface LoadedCity {
  dir: string
  manifest: DemManifest
  layers: Partial<Record<DemLayer, Float32Array>>
  /** set when a layer file fails its size or sha256 check */
  broken?: string
}

/** A POI whose city relief was not prepared (or failed EP) does not generate (INV-EPb). */
export class DemNotPreparedError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'DemNotPreparedError'
  }
}

export type DemCoverage =
  | { ok: true; city: string; manifest: DemManifest }
  | { ok: false; reason: string }

export class DemStore {
  private static instance: DemStore | null = null
  private cities: LoadedCity[] | null = null

  constructor(private readonly dir: string = defaultDemCacheDir()) {}

  static getInstance(): DemStore {
    if (!DemStore.instance) DemStore.instance = new DemStore()
    return DemStore.instance
  }

  /** Ground spacing of the lattice along a meridian (~30.7 m): the step of every sight line (E8). */
  get stepM(): number {
    const g = this.list().find(c => c.manifest.status === 'ok')?.manifest.grid
    return (g?.res ?? 1 / 3600) * M_PER_DEG_LAT
  }

  /** Bare terrain (GEDTM30), metres above EGM2008. null outside every prepared city. */
  ground(lat: number, lng: number): number | null {
    return this.read('ground', lat, lng)
  }

  /** Surface (Copernicus GLO-30: ground + buildings + trees). null outside every prepared city. */
  surface(lat: number, lng: number): number | null {
    return this.read('surface', lat, lng)
  }

  /**
   * Height of whatever stands on the ground in this cell (surface − ground, never negative):
   * the height of an obstacle without a measured tag (#782; it replaced the 6 m / 10 m guesses).
   */
  obstacleHeight(lat: number, lng: number): number | null {
    const s = this.surface(lat, lng)
    const g = this.ground(lat, lng)
    return s === null || g === null ? null : Math.max(0, s - g)
  }

  /**
   * INV-EPb: is the square of ±marginM around the point inside one prepared city, with both
   * layers intact? When not, the reason names the city that failed, or says none was prepared.
   */
  coverage(lat: number, lng: number, marginM: number): DemCoverage {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: false, reason: 'EP: the POI has no valid pin' }
    const dLat = marginM / M_PER_DEG_LAT
    const dLng = marginM / (111_320 * Math.cos((lat * Math.PI) / 180))
    const corners: Array<[number, number]> = [[lat - dLat, lng - dLng], [lat - dLat, lng + dLng], [lat + dLat, lng - dLng], [lat + dLat, lng + dLng]]
    const inside = (c: LoadedCity) => corners.every(([a, b]) => gridContains(c.manifest.grid, a, b))
    const covering = this.list().filter(inside)
    const good = covering.find(c => c.manifest.status === 'ok' && this.load(c))
    if (good) return { ok: true, city: good.manifest.city, manifest: good.manifest }
    const failed = covering.find(c => c.manifest.status === 'failed' || c.broken)
    if (failed) {
      return { ok: false, reason: `EP ${failed.manifest.city}: ${failed.broken ?? failed.manifest.failures.join('; ')}` }
    }
    return { ok: false, reason: `EP: no prepared relief covers ${lat.toFixed(4)},${lng.toFixed(4)} ± ${marginM} m in ${this.dir} (run scripts/prepare-city-dem.ts)` }
  }

  private read(layer: DemLayer, lat: number, lng: number): number | null {
    for (const c of this.list()) {
      if (c.manifest.status !== 'ok' || !gridContains(c.manifest.grid, lat, lng)) continue
      if (!this.load(c)) continue
      return bilinear(c.manifest.grid, c.layers[layer]!, lat, lng)
    }
    return null
  }

  private list(): LoadedCity[] {
    if (this.cities) return this.cities
    const out: LoadedCity[] = []
    const entries = fs.existsSync(this.dir) ? fs.readdirSync(this.dir, { withFileTypes: true }) : []
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const file = path.join(this.dir, e.name, DEM_MANIFEST_FILE)
      if (!fs.existsSync(file)) continue
      out.push({ dir: path.join(this.dir, e.name), manifest: JSON.parse(fs.readFileSync(file, 'utf8')), layers: {} })
    }
    this.cities = out
    return out
  }

  /** Loads both layers once, checking size and sha256 against the manifest (EP: "íntegro"). */
  private load(c: LoadedCity): boolean {
    if (c.broken) return false
    if (c.layers.surface && c.layers.ground) return true
    const expected = c.manifest.grid.width * c.manifest.grid.height * 4
    for (const rec of c.manifest.layers) {
      const buf = fs.readFileSync(path.join(c.dir, rec.file))
      if (buf.byteLength !== expected) {
        c.broken = `${rec.file} has ${buf.byteLength} bytes, expected ${expected}`
        return false
      }
      if (createHash('sha256').update(buf).digest('hex') !== rec.sha256) {
        c.broken = `${rec.file} does not match the sha256 of the manifest`
        return false
      }
      const aligned = buf.byteOffset % 4 === 0 ? buf : Buffer.from(buf)
      c.layers[rec.layer] = new Float32Array(aligned.buffer, aligned.byteOffset, expected / 4)
    }
    if (!c.layers.surface || !c.layers.ground) {
      c.broken = 'manifest lacks a layer'
      return false
    }
    return true
  }
}
