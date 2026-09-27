/**
 * EP → E1–E11 (#782, #783): the relief and the measured obstacles the TP engine reads, from
 * disk only (INV-EPc).
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
 *  - `buildings` (#783) — Overture Maps buildings (ODbL; © OpenStreetMap contributors,
 *    Microsoft ML Building Footprints, Google Open Buildings CC BY 4.0, Esri Community Maps
 *    CC BY 4.0) and 3D-GloBFP (Che et al. 2024, CC BY 4.0): footprint + measured height, on
 *    the obstacle lattice. The height of the POI (E3), of the host (E2) and the obstacle (E8).
 *  - `canopy` (#783) — High Resolution Canopy Height Maps by WRI and Meta (Tolan et al. 2024,
 *    CC BY 4.0), 90th percentile per cell of the obstacle lattice. The trees on the sight line.
 *
 * Reads are bilinear between the four pixel centres around the point, never rounded to the
 * metre (the SRTM service rounded, on a 90 m grid).
 */

import * as fs from 'fs'
import * as path from 'path'
import { createHash } from 'crypto'
import { BUILDING_DM_MAX, BUILDING_TIER, OBSTACLE_SUBDIV, type DemLayer } from './dem-sources'

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
  /** ETag or Last-Modified of the publisher; `md5:<hex>` when the publisher gives an MD5 */
  etag?: string | null
  lastModified?: string | null
}

export interface DemLayerRecord {
  layer: DemLayer
  source: string
  version: string
  attribution: string
  /**
   * file name inside the city directory, row-major, little-endian: `surface`/`ground` Float32 on
   * `grid`; `buildings` Uint16 (`tier << 14 | dm`) and `canopy` Uint8 (metres) on `obstacleGrid`
   */
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
  /** the obstacle lattice (`obstacleGrid(grid)`), written by #783; absent in a city prepared before it */
  obstacleGrid?: DemGrid
  status: 'ok' | 'failed'
  /** why the city does not generate (missing tile, no-data over land, bad georeference) */
  failures: string[]
  layers: DemLayerRecord[]
  checks: {
    seaCells: number
    landHoles: number
    /** footprints read per tier, and cells of the lattice they cover (#783) */
    buildings?: { overture: number; globfp: number; unmeasured: number; cells: number }
    /** cells with canopy > 0, and land cells no canopy tile covers (a hole fails the city) */
    canopy?: { treeCells: number; landHoles: number }
  }
}

export const DEM_MANIFEST_FILE = 'manifest.json'

/** Metres per degree of latitude (the same constant as `elevation-service#offsetM`). */
const M_PER_DEG_LAT = 110_540

export function defaultDemCacheDir(): string {
  return path.join(process.cwd(), 'data', 'dem-cache')
}

/** The obstacle lattice of a city: the relief lattice split in OBSTACLE_SUBDIV, corner on corner. */
export function obstacleGrid(g: DemGrid): DemGrid {
  const k = OBSTACLE_SUBDIV
  return { north: g.north, west: g.west, res: g.res / k, width: (g.width - 1) * k + 1, height: (g.height - 1) * k + 1 }
}

/** Index of the nearest cell, or -1 outside the grid. */
export function nearestCell(g: DemGrid, lat: number, lng: number): number {
  const r = Math.round((g.north - lat) / g.res)
  const c = Math.round((lng - g.west) / g.res)
  return r >= 0 && c >= 0 && r < g.height && c < g.width ? r * g.width + c : -1
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
  layers: { surface?: Float32Array; ground?: Float32Array; buildings?: Uint16Array; canopy?: Uint8Array }
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

/** Where a building height came from (E3/E2 rastro): a measured tier, or surface − ground. */
export type BuildingHeightSource = 'overture' | '3d-globfp' | 'dem_surface'

/** What the buildings layer measured inside a footprint (E3). */
export interface FootprintBuildings {
  /** cells of the obstacle lattice inside the footprint */
  cells: number
  /** of those, cells with a building footprint (any tier) */
  builtCells: number
  /** tallest building of the best tier present; null when no cell is built */
  heightM: number | null
  source: BuildingHeightSource | null
}

const TIER_SOURCE: Record<number, BuildingHeightSource> = { [BUILDING_TIER.OVERTURE]: 'overture', [BUILDING_TIER.GLOBFP]: '3d-globfp' }
const LAYER_BYTES: Record<DemLayer, number> = { surface: 4, ground: 4, buildings: 2, canopy: 1 }

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

  /**
   * Ground spacing of the relief lattice along a meridian (~30.7 m): the cell of each end of a
   * sight line that is not an obstacle (E8).
   */
  get stepM(): number {
    const g = this.list().find(c => c.manifest.status === 'ok')?.manifest.grid
    return (g?.res ?? 1 / 3600) * M_PER_DEG_LAT
  }

  /** Spacing of the obstacle lattice (~15.4 m): the step at which a sight line is walked (E8, #783). */
  get sampleM(): number {
    return this.stepM / OBSTACLE_SUBDIV
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
   * INV-E8 (#783): the top of whatever stands at this point, in metres above EGM2008.
   *  - a building with a measured height (Overture, 3D-GloBFP): ground + max(building, canopy).
   *    The surface of that cell is not added: it would count the same building twice;
   *  - elsewhere: max(surface, ground + canopy). A footprint with no measured height is in the
   *    surface (surface − ground), and so is anything no layer mapped.
   * null outside every prepared city.
   */
  obstacle(lat: number, lng: number): number | null {
    const s = this.surface(lat, lng)
    const g = this.ground(lat, lng)
    if (s === null || g === null) return s
    const b = this.cell('buildings', lat, lng)
    const canopy = this.cell('canopy', lat, lng) ?? 0
    if (b !== null && b >> 14 >= BUILDING_TIER.GLOBFP) return g + Math.max((b & BUILDING_DM_MAX) / 10, canopy)
    return Math.max(s, g + canopy)
  }

  /**
   * Height of the building standing at this point (E2, the host): the measured tier of the
   * buildings layer, else surface − ground (#783). null outside every prepared city.
   */
  buildingAt(lat: number, lng: number): { heightM: number; source: BuildingHeightSource } | null {
    const b = this.cell('buildings', lat, lng)
    if (b !== null && TIER_SOURCE[b >> 14]) return { heightM: (b & BUILDING_DM_MAX) / 10, source: TIER_SOURCE[b >> 14] }
    const h = this.obstacleHeight(lat, lng)
    return h === null ? null : { heightM: h, source: 'dem_surface' }
  }

  /**
   * INV-E3 (#783): the buildings measured inside a footprint (ring of lat/lng), cell centre in
   * the ring; a footprint smaller than a cell reads the cell under its vertex mean. The height is
   * the tallest building of the best tier present (Overture → 3D-GloBFP → surface − ground over
   * the footprints with no height).
   */
  footprintBuildings(ring: Array<{ lat: number; lng: number }>): FootprintBuildings {
    const none: FootprintBuildings = { cells: 0, builtCells: 0, heightM: null, source: null }
    if (!ring || ring.length < 3) return none
    const city = this.list().find(c => c.manifest.status === 'ok' && c.manifest.obstacleGrid && gridContains(c.manifest.grid, ring[0].lat, ring[0].lng) && this.load(c))
    if (!city) return none
    const g = city.manifest.obstacleGrid!
    const cells = city.layers.buildings!
    const visited: number[] = []
    const xs = ring.map(p => (p.lng - g.west) / g.res), ys = ring.map(p => (g.north - p.lat) / g.res)
    const r0 = Math.max(0, Math.ceil(Math.min(...ys))), r1 = Math.min(g.height - 1, Math.floor(Math.max(...ys)))
    for (let r = r0; r <= r1; r++) {
      const cuts: number[] = []
      for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
        if ((ys[a] > r) !== (ys[b] > r)) cuts.push(xs[a] + ((r - ys[a]) * (xs[b] - xs[a])) / (ys[b] - ys[a]))
      }
      cuts.sort((p, q) => p - q)
      for (let k = 0; k + 1 < cuts.length; k += 2) {
        for (let c = Math.max(0, Math.ceil(cuts[k])); c <= Math.min(g.width - 1, Math.floor(cuts[k + 1])); c++) visited.push(r * g.width + c)
      }
    }
    if (!visited.length) {
      const i = nearestCell(g, ring.reduce((s, p) => s + p.lat, 0) / ring.length, ring.reduce((s, p) => s + p.lng, 0) / ring.length)
      if (i >= 0) visited.push(i)
    }
    let built = 0, bestTier = 0, best = 0
    const unmeasured: number[] = []
    for (const i of visited) {
      const v = cells[i], tier = v >> 14
      if (!tier) continue
      built++
      if (tier === BUILDING_TIER.UNMEASURED) unmeasured.push(i)
      const h = (v & BUILDING_DM_MAX) / 10
      if (tier > bestTier || (tier === bestTier && h > best)) { bestTier = tier; best = h }
    }
    if (!built) return { cells: visited.length, builtCells: 0, heightM: null, source: null }
    if (TIER_SOURCE[bestTier]) return { cells: visited.length, builtCells: built, heightM: best, source: TIER_SOURCE[bestTier] }
    let top = 0
    for (const i of unmeasured) {
      const lat = g.north - Math.floor(i / g.width) * g.res, lng = g.west + (i % g.width) * g.res
      top = Math.max(top, this.obstacleHeight(lat, lng) ?? 0)
    }
    return { cells: visited.length, builtCells: built, heightM: top, source: 'dem_surface' }
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

  /** Nearest cell of an obstacle layer; null outside every prepared city. */
  private cell(layer: 'buildings' | 'canopy', lat: number, lng: number): number | null {
    for (const c of this.list()) {
      if (c.manifest.status !== 'ok' || !c.manifest.obstacleGrid || !gridContains(c.manifest.grid, lat, lng)) continue
      if (!this.load(c)) continue
      const i = nearestCell(c.manifest.obstacleGrid, lat, lng)
      return i < 0 ? null : c.layers[layer]![i]
    }
    return null
  }

  private read(layer: 'surface' | 'ground', lat: number, lng: number): number | null {
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

  /**
   * Loads the four layers once, checking size and sha256 against the manifest (EP: "íntegro").
   * A city prepared before #783 has no obstacle layers and does not generate until prepared again.
   */
  private load(c: LoadedCity): boolean {
    if (c.broken) return false
    if (c.layers.surface && c.layers.ground && c.layers.buildings && c.layers.canopy) return true
    const og = c.manifest.obstacleGrid
    const missing = (['surface', 'ground', 'buildings', 'canopy'] as const).filter(l => !c.manifest.layers.some(r => r.layer === l))
    if (missing.length || !og) {
      c.broken = `manifest lacks the ${missing.join(', ') || 'obstacle grid'} layer — run scripts/prepare-city-dem.ts again (#783)`
      return false
    }
    for (const rec of c.manifest.layers) {
      const g = rec.layer === 'surface' || rec.layer === 'ground' ? c.manifest.grid : og
      const expected = g.width * g.height * LAYER_BYTES[rec.layer]
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
      if (rec.layer === 'buildings') c.layers.buildings = new Uint16Array(aligned.buffer, aligned.byteOffset, expected / 2)
      else if (rec.layer === 'canopy') c.layers.canopy = new Uint8Array(aligned.buffer, aligned.byteOffset, expected)
      else c.layers[rec.layer] = new Float32Array(aligned.buffer, aligned.byteOffset, expected / 4)
    }
    return true
  }
}
