/**
 * Municipal borders of a local OSM region (BR-POI-010): the polygon of every municipality, kept
 * whole (MultiPolygon with its holes) in `<region>.db`, table `admin_boundaries`, plus the
 * region's country in `region_metadata`. The other local tables flatten geometry to a list of
 * points, which is useless as a border.
 *
 * Written by `scripts/manage-osm.ts` (`--import-pbf`, or `--import-admin` alone); read by
 * `LocalOSMFetcher#municipalityAt`, which turns a POI named after its municipality into the
 * municipal border mode (`utils/admin-border-tps`).
 */
import type Database from 'better-sqlite3'
import { polygonContains, type RegionPolygon } from './local-osm-regions'

/**
 * SSOT — OSM `admin_level` of the municipality (the local unit a city/town/municipality/concelho/
 * Gemeinde/commune is: LAU in Europe), by ISO 3166-1 alpha-2 country code. A country not listed
 * takes `DEFAULT_MUNICIPALITY_ADMIN_LEVEL` (8, the most common value).
 *
 * Source: the per-country table of the OSM wiki, `Template:Admin level` (rendered in
 * `Tag:boundary=administrative`), raw wikitext read on 2026-10-06. Listed: every country whose
 * municipal level is NOT 8, plus the ones checked by hand against that source (at 8). A country
 * whose row names no municipal unit (or only "fixme") is left to the default; the import's seat
 * check (`seatLevelWarning`) flags a level whose units have no seat. Portugal was also measured: 308 relations at
 * level 7 = the 308 concelhos (level 8 is the freguesia).
 */
export const DEFAULT_MUNICIPALITY_ADMIN_LEVEL = 8
export const MUNICIPALITY_ADMIN_LEVEL_BY_COUNTRY: Readonly<Record<string, number>> = {
  // Checked by hand against the source, 2026-10-06 (US: city/town/village; the county is 6).
  AT: 8, BE: 8, BR: 8, DE: 8, ES: 8, FI: 8, FR: 8, IT: 8, LU: 8, NL: 8, US: 8,
  PT: 7,
  // Municipal level other than 8, per the source.
  AD: 7, AL: 7, AM: 5, AO: 6, AR: 7, AU: 6, BA: 7, BF: 6, BG: 5, BH: 6, BI: 6, BJ: 6, CD: 7, CF: 7,
  CN: 6, CO: 6, CR: 6, CU: 6, CV: 6, CY: 6, DK: 7, DO: 6, EC: 6, EE: 7, GE: 6, GR: 7, GT: 6, HN: 6,
  HR: 7, ID: 5, IR: 7, IS: 6, JP: 7, KH: 6, KR: 6, LB: 7, LT: 5, LV: 5, ME: 6, MK: 7, MR: 9, MX: 6,
  NG: 6, NI: 6, NO: 7, NP: 7, NZ: 6, PA: 6, PH: 6, PL: 7, SE: 7, SV: 6, TG: 7, TR: 6, VE: 6, VN: 6,
  XK: 6,
}

export function municipalityAdminLevel(country: string): number {
  return MUNICIPALITY_ADMIN_LEVEL_BY_COUNTRY[country.toUpperCase()] ?? DEFAULT_MUNICIPALITY_ADMIN_LEVEL
}

export const ADMIN_BOUNDARIES_TABLE = 'admin_boundaries'
export const REGION_METADATA_TABLE = 'region_metadata'

function createAdminTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${ADMIN_BOUNDARIES_TABLE} (
      osm_id INTEGER PRIMARY KEY,
      admin_level INTEGER NOT NULL,
      name TEXT NOT NULL,
      name_norm TEXT NOT NULL,
      geometry_geojson TEXT NOT NULL,
      min_lat REAL, max_lat REAL, min_lng REAL, max_lng REAL
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_${ADMIN_BOUNDARIES_TABLE}_name ON ${ADMIN_BOUNDARIES_TABLE}(name_norm)`)
  db.exec(`CREATE TABLE IF NOT EXISTS ${REGION_METADATA_TABLE} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
}

/** ISO 3166-1 alpha-2 of the region, as detected by the import; null before BR-POI-010 or when none was found. */
export function regionCountry(db: Database.Database): string | null {
  const hasTable = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(REGION_METADATA_TABLE)
  if (!hasTable) return null
  const row = db.prepare(`SELECT value FROM ${REGION_METADATA_TABLE} WHERE key = 'country'`).get() as { value: string } | undefined
  return row?.value ?? null
}

/**
 * Name of a municipality for matching: no accent, no case, no punctuation, and without the
 * "Município de" / "Concelho de" (da/do/das/dos) a POI carries and the OSM relation does not.
 * "Câmara Municipal de X" is NOT stripped: in Portugal it names the town hall, a building with
 * its own footprint, not the municipality.
 */
export function normalizeMunicipalityName(name: string | null | undefined): string {
  return (name ?? '')
    .normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/^(municipio|concelho) (de|da|do|das|dos) /, '')
}

type Ring = Array<[number, number]>
type Polygons = Ring[][]
type Geometry = { type?: string; coordinates?: unknown }
type Bbox = { minLat: number; maxLat: number; minLng: number; maxLng: number }

/** Polygons of a GeoJSON Polygon/MultiPolygon, each `[outer, ...holes]` in `[lng, lat]`. */
function polygonsOf(geometry: Geometry): Polygons {
  if (geometry?.type === 'Polygon') return [geometry.coordinates as Ring[]]
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates as Polygons
  return []
}

/** Bounding box of the outer rings; null for an empty geometry. */
function bboxOf(geometry: Geometry): Bbox | null {
  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180
  for (const polygon of polygonsOf(geometry)) {
    for (const [lng, lat] of polygon[0] ?? []) {
      minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat)
      minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng)
    }
  }
  return minLat > maxLat ? null : { minLat, maxLat, minLng, maxLng }
}

const inBbox = (b: Bbox, lat: number, lng: number) => lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng

/** Pin inside the border: inside an outer ring and outside that polygon's holes (an enclave is another municipality). */
export function adminGeometryContains(geometry: Geometry, lat: number, lng: number): boolean {
  return polygonsOf(geometry).some(([outer, ...holes]) => outer && polygonContains({ outer: [outer], holes }, lat, lng))
}

const SEAT_PLACES = new Set(['city', 'town', 'village'])

/**
 * Independent check of the municipal level: the ids of the `boundary=administrative` relations
 * that have a seat — `place=city|town|village` on the relation itself, or an `admin_centre`/`label`
 * member node with that `place`. Reads `osmium cat -f opl,add_metadata=false` over the filtered
 * extract (nodes come before relations in OPL, so a member's tags are known when its relation is read).
 */
export async function scanMunicipalSeats(lines: AsyncIterable<string>): Promise<Set<number>> {
  const placeNodes = new Set<number>()
  const seated = new Set<number>()
  for await (const raw of lines) {
    const line = raw.trim()
    const kind = line[0]
    if (kind !== 'n' && kind !== 'r') continue
    const fields = line.split(' ')
    const id = Number(fields[0].slice(1))
    const tags = fields.find(f => f.startsWith('T'))?.slice(1) ?? ''
    const place = /(?:^|,)place=([^,]*)/.exec(tags)?.[1]
    const isSeatPlace = place !== undefined && SEAT_PLACES.has(place)
    if (kind === 'n') {
      if (isSeatPlace) placeNodes.add(id)
      continue
    }
    const members = fields.find(f => f.startsWith('M'))?.slice(1) ?? ''
    if (isSeatPlace || members.split(',').some(m => {
      const match = /^n(\d+)@(admin_centre|label)$/.exec(m)
      return match !== null && placeNodes.has(Number(match[1]))
    })) seated.add(id)
  }
  return seated
}

export interface AdminBoundaryImport {
  /** ISO 3166-1 alpha-2 found in the extract; null = municipal mode off for the region. */
  country: string | null
  /** How it was found: the country relation holding the region, or the ISO 3166-2 prefix of its subdivisions. */
  countrySource: 'admin_level=2' | 'ISO3166-2' | null
  /** `municipalityAdminLevel(country)`; null without a country. */
  level: number | null
  /** Relations centred inside the region's `.poly`, by `admin_level` — for the human to check the level. */
  byLevel: Record<string, number>
  /** Of those, the ones with a seat (`scanMunicipalSeats`), by `admin_level`. */
  seatsByLevel: Record<string, number>
  /** Kept: at the municipal level, centre inside the region's `.poly`. */
  kept: number
  /** At the municipal level but centred outside the `.poly` (a neighbour leaking into the extract's buffer). */
  outsideRegion: number
}

/** At most this many relation centres vote for the country: enough to outvote a border sliver, cheap against a country polygon. */
const COUNTRY_VOTE_SAMPLES = 256
const ISO_ALPHA2 = /^[A-Z]{2}$/

/**
 * Replaces the table with the municipalities of one region, from the lines of
 * `osmium export -f geojsonseq --geometry-types=polygon --attributes type,id` over the
 * `boundary=administrative` relations, and records the region's country.
 *
 * The country is read from the extract itself, never configured: the `admin_level=2` relation
 * with `ISO3166-1:alpha2`/`ISO3166-1` whose polygon holds most of the region's relations (an
 * extract carries its neighbours too). A sub-national extract (a US state, a Brazilian
 * macro-region) does not carry its country relation, so the fallback is the majority `ISO3166-2`
 * prefix ("US-RI" → US) of the relations centred inside the region. Only relations at the
 * country's municipal level whose bounding-box centre lies inside `region` are kept.
 */
export async function importAdminBoundaries(
  db: Database.Database,
  lines: AsyncIterable<string>,
  opts: { region: RegionPolygon; seats?: ReadonlySet<number> },
): Promise<AdminBoundaryImport> {
  createAdminTables(db)
  const insert = db.prepare(`
    INSERT OR REPLACE INTO ${ADMIN_BOUNDARIES_TABLE}
      (osm_id, admin_level, name, name_norm, geometry_geojson, min_lat, max_lat, min_lng, max_lng)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const byLevel: Record<string, number> = {}
  const seatsByLevel: Record<string, number> = {}
  const outsideByLevel: Record<string, number> = {}
  const countries: Array<{ code: string; geometry: Geometry; bbox: Bbox }> = []
  const samples: Array<{ lat: number; lng: number }> = []
  const subdivisionPrefixes: Record<string, number> = {}
  const count = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1 }
  db.exec('BEGIN')
  try {
    // A rebuild of a table derived from the PBF: a relation gone from OSM must not linger.
    db.exec(`DELETE FROM ${ADMIN_BOUNDARIES_TABLE}`)
    for await (const raw of lines) {
      const line = raw.trim().replace(/^\x1e/, '')
      if (!line) continue
      const feature = JSON.parse(line)
      const p = feature.properties ?? {}
      // Closed member ways are exported as polygons too; the boundary is the relation.
      if (p['@type'] !== 'relation') continue
      const bbox = bboxOf(feature.geometry)
      if (!bbox) continue
      const level = String(p.admin_level ?? '?')
      if (level === '2') {
        const code = String(p['ISO3166-1:alpha2'] ?? p['ISO3166-1'] ?? '').toUpperCase()
        if (ISO_ALPHA2.test(code)) countries.push({ code, geometry: feature.geometry, bbox })
        continue
      }
      const centre = { lat: (bbox.minLat + bbox.maxLat) / 2, lng: (bbox.minLng + bbox.maxLng) / 2 }
      if (!polygonContains(opts.region, centre.lat, centre.lng)) {
        count(outsideByLevel, level)
        continue
      }
      count(byLevel, level)
      const osmId = Number(p['@id'])
      if (opts.seats?.has(osmId)) count(seatsByLevel, level)
      const prefix = /^([A-Z]{2})-/.exec(String(p['ISO3166-2'] ?? ''))?.[1]
      if (prefix) count(subdivisionPrefixes, prefix)
      if (samples.length < COUNTRY_VOTE_SAMPLES) samples.push(centre)
      // Every level goes in: the country, and so the municipal level, is only known at the end.
      if (p.name && /^\d+$/.test(level)) {
        insert.run(osmId, Number(level), p.name, normalizeMunicipalityName(p.name),
          JSON.stringify(feature.geometry), bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng)
      }
    }

    let country: string | null = null
    let countrySource: AdminBoundaryImport['countrySource'] = null
    let bestVotes = 0
    for (const c of countries) {
      const votes = samples.filter(s => inBbox(c.bbox, s.lat, s.lng) && adminGeometryContains(c.geometry, s.lat, s.lng)).length
      if (votes > bestVotes) { bestVotes = votes; country = c.code; countrySource = 'admin_level=2' }
    }
    if (!country) {
      const [prefix] = Object.entries(subdivisionPrefixes).sort(([, a], [, b]) => b - a)[0] ?? []
      if (prefix) { country = prefix; countrySource = 'ISO3166-2' }
    }

    const level = country ? municipalityAdminLevel(country) : null
    db.prepare(`DELETE FROM ${ADMIN_BOUNDARIES_TABLE} WHERE admin_level IS NOT ?`).run(level)
    if (country) db.prepare(`INSERT OR REPLACE INTO ${REGION_METADATA_TABLE} (key, value) VALUES ('country', ?)`).run(country)
    else db.exec(`DELETE FROM ${REGION_METADATA_TABLE} WHERE key = 'country'`)
    const kept = (db.prepare(`SELECT COUNT(*) AS n FROM ${ADMIN_BOUNDARIES_TABLE}`).get() as { n: number }).n
    db.exec('COMMIT')
    return {
      country, countrySource, level, byLevel, seatsByLevel, kept,
      outsideRegion: level === null ? 0 : outsideByLevel[String(level)] ?? 0,
    }
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

/** The `admin_level` most relations with a seat sit at (ties: the lower level); null when no seat was found. */
export function seatLevel(seatsByLevel: Record<string, number>): number | null {
  let best: number | null = null
  for (const [level, n] of Object.entries(seatsByLevel)) {
    const l = Number(level)
    const bestN = best === null ? -1 : seatsByLevel[String(best)]
    if (n > bestN || (n === bestN && l < best!)) best = l
  }
  return best
}

/**
 * A municipality has a seat, so at least half of the relations at the municipal level must have
 * one. Below that, the table probably points at a level of statistical or grouping units.
 */
const MIN_SEAT_SHARE = 0.5

/**
 * The warning for the human when the seats disagree with the table: fewer than `MIN_SEAT_SHARE`
 * of the relations at the table's level have a seat, and another level has more seated relations.
 * The raw "level with the most seats" is not enough on its own — measured 2026-10-06, freguesias
 * (PT, level 8: 3174 seated) and villages (LU, level 9) outnumber the municipalities that
 * own them, both with a seat almost every time. It cannot tell a municipality from a seated
 * sub-municipal unit; it catches a level whose units have no seat. The level is never switched
 * automatically: a table entry is a decision with a source, a seat count is a hint.
 */
export function seatLevelWarning(r: Pick<AdminBoundaryImport, 'country' | 'level' | 'byLevel' | 'seatsByLevel'>): string | null {
  const s = seatLevel(r.seatsByLevel)
  if (r.level === null || s === null || s === r.level) return null
  const atLevel = r.byLevel[String(r.level)] ?? 0
  const seatedAtLevel = r.seatsByLevel[String(r.level)] ?? 0
  if (atLevel > 0 && seatedAtLevel / atLevel >= MIN_SEAT_SHARE) return null
  return `admin_level ${r.level} from the table for ${r.country}, but only ${seatedAtLevel} of its ${atLevel} relations have a `
    + `city/town/village seat, and the seats are mostly at level ${s} (${r.seatsByLevel[String(s)]} relations): `
    + `check admin-boundaries#MUNICIPALITY_ADMIN_LEVEL_BY_COUNTRY against the OSM wiki.`
}

export interface Municipality {
  osmId: number
  name: string
  /** GeoJSON Polygon/MultiPolygon, `[lng, lat]`, holes kept. */
  geometry: { type: string; coordinates: unknown }
}

/**
 * The municipality a POI stands for: same normalized name, the municipal level of the region's
 * country, AND the pin inside its polygon. A POI not named after its municipality (a church, a
 * freguesia) matches nothing. null also when the database has no country (imported before
 * BR-POI-010, or none found in the extract).
 */
export function findMunicipality(db: Database.Database, pin: { lat: number; lng: number }, poiName: string | null | undefined): Municipality | null {
  const name = normalizeMunicipalityName(poiName)
  if (!name || !Number.isFinite(pin?.lat) || !Number.isFinite(pin?.lng)) return null
  const country = regionCountry(db)
  if (!country) return null
  const rows = db.prepare(`
    SELECT osm_id, name, geometry_geojson FROM ${ADMIN_BOUNDARIES_TABLE}
    WHERE name_norm = ? AND admin_level = ? AND min_lat <= ? AND max_lat >= ? AND min_lng <= ? AND max_lng >= ?
  `).all(name, municipalityAdminLevel(country), pin.lat, pin.lat, pin.lng, pin.lng) as Array<{ osm_id: number; name: string; geometry_geojson: string }>
  for (const row of rows) {
    const geometry = JSON.parse(row.geometry_geojson)
    if (adminGeometryContains(geometry, pin.lat, pin.lng)) return { osmId: row.osm_id, name: row.name, geometry }
  }
  return null
}
