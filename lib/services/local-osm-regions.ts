/**
 * Where the local OpenStreetMap data lives (#833, L1 of docs/arquitetura/cms/pipeline-pais.md).
 *
 * One SQLite file per country or region, `<dir>/<region>.db`, each beside the Geofabrik
 * boundary it was cut with, `<dir>/<region>.poly`. A coordinate picks the region whose polygon
 * contains it. GeoNames (worldwide) is its own file, `<dir>/geonames.db`, so deleting a country
 * is deleting its two files.
 *
 * `<dir>` is `LOCAL_OSM_DIR`, else `<cwd>/data/osm`. The three readers (`LocalOSMFetcher`,
 * `LocalReverseGeocoder`, the importer behind `scripts/manage-osm.ts`) resolve paths here only.
 *
 * A POI outside every region does not generate: `LocalOsmNotCoveredError`, unless
 * `TP_ALLOW_OVERPASS=1` asks for the public Overpass on purpose (slow, 429/406, another engine
 * path — #831 measured it in Vienna).
 */
import fs from 'fs'
import path from 'path'

export const LOCAL_OSM_DIR_ENV = 'LOCAL_OSM_DIR'
export const ALLOW_OVERPASS_ENV = 'TP_ALLOW_OVERPASS'
export const GEONAMES_DB_FILE = 'geonames.db'
const REGION_NAME = /^[a-z0-9][a-z0-9-]*$/

export function localOsmDir(): string {
  const fromEnv = process.env[LOCAL_OSM_DIR_ENV]
  return fromEnv ? path.resolve(fromEnv) : path.join(process.cwd(), 'data', 'osm')
}

export function geonamesDbPath(dir = localOsmDir()): string {
  return path.join(dir, GEONAMES_DB_FILE)
}

export function regionDbPath(region: string, dir = localOsmDir()): string {
  if (!REGION_NAME.test(region)) throw new Error(`Invalid OSM region name "${region}": use lowercase letters, digits and "-" (e.g. "pt", "br")`)
  return path.join(dir, `${region}.db`)
}

/** Lon/lat rings of one polygon file: outer rings and holes (`!` sections). */
export interface RegionPolygon {
  outer: Array<Array<[number, number]>>
  holes: Array<Array<[number, number]>>
}

/** Geofabrik/osmosis `.poly`: a name line, then sections of `lon lat` lines closed by `END`, then `END`. */
export function parsePoly(text: string): RegionPolygon {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l !== '')
  const poly: RegionPolygon = { outer: [], holes: [] }
  let i = 1 // line 0 is the file name
  while (i < lines.length && lines[i] !== 'END') {
    const hole = lines[i].startsWith('!')
    const ring: Array<[number, number]> = []
    i++
    while (i < lines.length && lines[i] !== 'END') {
      const [lon, lat] = lines[i].split(/\s+/).map(Number)
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) throw new Error(`Invalid .poly coordinate line: "${lines[i]}"`)
      ring.push([lon, lat])
      i++
    }
    if (i >= lines.length) throw new Error('Invalid .poly: section without END')
    if (ring.length >= 3) (hole ? poly.holes : poly.outer).push(ring)
    i++ // the section's END
  }
  if (poly.outer.length === 0) throw new Error('Invalid .poly: no outer ring')
  return poly
}

function inRing(ring: Array<[number, number]>, lng: number, lat: number): boolean {
  let inside = false
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
    const [xa, ya] = ring[a]
    const [xb, yb] = ring[b]
    if ((ya > lat) !== (yb > lat) && lng < ((xb - xa) * (lat - ya)) / (yb - ya) + xa) inside = !inside
  }
  return inside
}

export function polygonContains(poly: RegionPolygon, lat: number, lng: number): boolean {
  return poly.outer.some(r => inRing(r, lng, lat)) && !poly.holes.some(r => inRing(r, lng, lat))
}

export interface OsmRegion {
  name: string
  dbPath: string
  covers(lat: number, lng: number): boolean
}

/**
 * Every `<region>.db` of `dir`, in name order (the first match wins where two extracts overlap,
 * e.g. the buffers of neighbouring Geofabrik countries: both carry the data there). A database
 * without its `.poly` is an error, never a region that covers nothing or everything.
 */
export function listOsmRegions(dir = localOsmDir()): OsmRegion[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.db') && f !== GEONAMES_DB_FILE)
    .sort()
    .map(f => {
      const name = f.slice(0, -'.db'.length)
      const polyPath = path.join(dir, `${name}.poly`)
      if (!fs.existsSync(polyPath)) {
        throw new Error(`Local OSM region "${name}" has no boundary: ${polyPath} is missing (Geofabrik publishes it beside the PBF, <region>.poly)`)
      }
      const poly = parsePoly(fs.readFileSync(polyPath, 'utf8'))
      return { name, dbPath: path.join(dir, f), covers: (lat: number, lng: number) => polygonContains(poly, lat, lng) }
    })
}

export function regionAt<R extends Pick<OsmRegion, 'covers'>>(regions: R[], lat: number, lng: number): R | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return regions.find(r => r.covers(lat, lng)) ?? null
}

export function overpassAllowed(): boolean {
  return process.env[ALLOW_OVERPASS_ENV] === '1'
}

/** A POI whose coordinate no local OSM region covers (L1): it fails instead of going to Overpass. */
export class LocalOsmNotCoveredError extends Error {
  constructor(lat: number, lng: number, dir: string, regions: string[]) {
    super(
      `No local OSM region covers (${lat}, ${lng}) in ${dir} ` +
      `(regions: ${regions.length ? regions.join(', ') : 'none'}). ` +
      `Import the country: npx tsx scripts/manage-osm.ts --import-pbf <pbf> --region <name>. ` +
      `Public Overpass only on purpose: ${ALLOW_OVERPASS_ENV}=1.`
    )
    this.name = 'LocalOsmNotCoveredError'
  }
}

/** The gate before a POI generates (`CoreTriggerPointPredictor#predictTriggerPointsComplete`). */
export function requireLocalOsmCoverage(
  lat: number,
  lng: number,
  regions: Array<Pick<OsmRegion, 'name' | 'covers'>>,
  dir = localOsmDir(),
): void {
  if (regionAt(regions, lat, lng) || overpassAllowed()) return
  throw new LocalOsmNotCoveredError(lat, lng, dir, regions.map(r => r.name))
}
