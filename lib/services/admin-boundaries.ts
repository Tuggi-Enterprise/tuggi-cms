/**
 * Municipal borders of a local OSM region (BR-POI-010): the polygon of every municipality, kept
 * whole (MultiPolygon with its holes) in `<region>.db`, table `admin_boundaries`, plus the
 * region's country in `region_metadata`. The other local tables flatten geometry to a list of
 * points, which is useless as a border.
 *
 * Each municipality's seat (its `admin_centre` member, else its `label` member) goes to
 * `admin_boundary_seats`: the POI whose OSM element IS that seat stands for the municipality.
 *
 * Written by `scripts/manage-osm.ts` (`--import-pbf`, or `--import-admin` alone); read by
 * `LocalOSMFetcher#municipalityAt`, which turns the seat POI into the municipal border mode
 * (`utils/admin-border-tps`). No name takes part: names change by language and country.
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
export const ADMIN_BOUNDARY_SEATS_TABLE = 'admin_boundary_seats'
export const REGION_METADATA_TABLE = 'region_metadata'

function createAdminTables(db: Database.Database): void {
  // Derived from the PBF and rebuilt whole by every import: a table from before the seats (it
  // carried a normalized name, `name_norm`) is replaced, not migrated.
  const columns = db.prepare(`PRAGMA table_info(${ADMIN_BOUNDARIES_TABLE})`).all() as Array<{ name: string }>
  if (columns.some(c => c.name === 'name_norm')) db.exec(`DROP TABLE ${ADMIN_BOUNDARIES_TABLE}`)
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${ADMIN_BOUNDARIES_TABLE} (
      osm_id INTEGER PRIMARY KEY,
      admin_level INTEGER NOT NULL,
      name TEXT NOT NULL,
      geometry_geojson TEXT NOT NULL,
      min_lat REAL, max_lat REAL, min_lng REAL, max_lng REAL
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${ADMIN_BOUNDARY_SEATS_TABLE} (
      relation_id INTEGER NOT NULL,
      seat_type TEXT NOT NULL,
      seat_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      PRIMARY KEY (seat_type, seat_id, relation_id)
    )
  `)
  db.exec(`CREATE TABLE IF NOT EXISTS ${REGION_METADATA_TABLE} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
}

/** ISO 3166-1 alpha-2 of the region, as detected by the import; null before BR-POI-010 or when none was found. */
export function regionCountry(db: Database.Database): string | null {
  const hasTable = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(REGION_METADATA_TABLE)
  if (!hasTable) return null
  const row = db.prepare(`SELECT value FROM ${REGION_METADATA_TABLE} WHERE key = 'country'`).get() as { value: string } | undefined
  return row?.value ?? null
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
const OPL_MEMBER_TYPE = { n: 'node', w: 'way', r: 'relation' } as const

/** The OSM element a municipality is seated at, in the vocabulary of `core.attractions.osm_type`. */
export interface Seat {
  type: 'node' | 'way' | 'relation'
  id: number
  role: 'admin_centre' | 'label'
}

export interface MunicipalSeatScan {
  /** Relations with a city/town/village seat — the independent check of the level (`seatLevelWarning`). */
  seated: Set<number>
  /** Every relation's seat members: its `admin_centre` members, or its `label` members when it has no `admin_centre`. */
  seats: Map<number, Seat[]>
}

/**
 * The seats of the `boundary=administrative` relations, from `osmium cat -f opl,add_metadata=false`
 * over the filtered extract (nodes come before relations in OPL, so a member's tags are known when
 * its relation is read). Two answers: `seats`, the members the POI matching reads (BR-POI-010),
 * whatever their tags; and `seated`, the relations with `place=city|town|village` on the relation
 * itself or on an `admin_centre`/`label` member node, for the level check.
 */
export async function scanMunicipalSeats(lines: AsyncIterable<string>): Promise<MunicipalSeatScan> {
  const placeNodes = new Set<number>()
  const seated = new Set<number>()
  const seats = new Map<number, Seat[]>()
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
    const members: Seat[] = []
    for (const m of (fields.find(f => f.startsWith('M'))?.slice(1) ?? '').split(',')) {
      const match = /^([nwr])(\d+)@(admin_centre|label)$/.exec(m)
      if (match) members.push({ type: OPL_MEMBER_TYPE[match[1] as 'n' | 'w' | 'r'], id: Number(match[2]), role: match[3] as Seat['role'] })
    }
    if (isSeatPlace || members.some(m => m.type === 'node' && placeNodes.has(m.id))) seated.add(id)
    const centres = members.filter(m => m.role === 'admin_centre')
    const chosen = centres.length > 0 ? centres : members
    if (chosen.length > 0) seats.set(id, chosen)
  }
  return { seated, seats }
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
  /** Of the kept, the ones with a seat stored in `admin_boundary_seats` (BR-POI-010 matching). */
  keptWithSeat: number
  /** Of those, the ones seated by `label` because they have no `admin_centre`. */
  keptSeatedByLabel: number
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
  opts: { region: RegionPolygon; seatScan?: MunicipalSeatScan },
): Promise<AdminBoundaryImport> {
  const byLevel: Record<string, number> = {}
  const seatsByLevel: Record<string, number> = {}
  const outsideByLevel: Record<string, number> = {}
  const countries: Array<{ code: string; geometry: Geometry; bbox: Bbox }> = []
  const samples: Array<{ lat: number; lng: number }> = []
  const subdivisionPrefixes: Record<string, number> = {}
  const count = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1 }
  db.exec('BEGIN')
  try {
    createAdminTables(db)
    const insert = db.prepare(`
      INSERT OR REPLACE INTO ${ADMIN_BOUNDARIES_TABLE}
        (osm_id, admin_level, name, geometry_geojson, min_lat, max_lat, min_lng, max_lng)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insertSeat = db.prepare(`
      INSERT OR REPLACE INTO ${ADMIN_BOUNDARY_SEATS_TABLE} (relation_id, seat_type, seat_id, role) VALUES (?, ?, ?, ?)
    `)
    // A rebuild of tables derived from the PBF: a relation gone from OSM must not linger.
    db.exec(`DELETE FROM ${ADMIN_BOUNDARIES_TABLE}`)
    db.exec(`DELETE FROM ${ADMIN_BOUNDARY_SEATS_TABLE}`)
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
      if (opts.seatScan?.seated.has(osmId)) count(seatsByLevel, level)
      const prefix = /^([A-Z]{2})-/.exec(String(p['ISO3166-2'] ?? ''))?.[1]
      if (prefix) count(subdivisionPrefixes, prefix)
      if (samples.length < COUNTRY_VOTE_SAMPLES) samples.push(centre)
      // Every level goes in: the country, and so the municipal level, is only known at the end.
      if (p.name && /^\d+$/.test(level)) {
        insert.run(osmId, Number(level), p.name,
          JSON.stringify(feature.geometry), bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng)
        for (const seat of opts.seatScan?.seats.get(osmId) ?? []) insertSeat.run(osmId, seat.type, seat.id, seat.role)
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
    db.exec(`DELETE FROM ${ADMIN_BOUNDARY_SEATS_TABLE} WHERE relation_id NOT IN (SELECT osm_id FROM ${ADMIN_BOUNDARIES_TABLE})`)
    if (country) db.prepare(`INSERT OR REPLACE INTO ${REGION_METADATA_TABLE} (key, value) VALUES ('country', ?)`).run(country)
    else db.exec(`DELETE FROM ${REGION_METADATA_TABLE} WHERE key = 'country'`)
    const kept = (db.prepare(`SELECT COUNT(*) AS n FROM ${ADMIN_BOUNDARIES_TABLE}`).get() as { n: number }).n
    const seatCounts = db.prepare(`
      SELECT COUNT(DISTINCT relation_id) AS withSeat, COUNT(DISTINCT CASE WHEN role = 'label' THEN relation_id END) AS byLabel
      FROM ${ADMIN_BOUNDARY_SEATS_TABLE}
    `).get() as { withSeat: number; byLabel: number }
    db.exec('COMMIT')
    return {
      country, countrySource, level, byLevel, seatsByLevel, kept,
      keptWithSeat: seatCounts.withSeat, keptSeatedByLabel: seatCounts.byLabel,
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

/** The OSM element of a POI, as `core.attractions` carries it (`osm_type`, `osm_id`). */
export interface PoiOsmElement {
  osm_type?: string | null
  osm_id?: string | number | null
}

/**
 * The municipality a POI stands for: its OSM element IS the seat of a relation at the municipal
 * level of the region's country (`admin_boundary_seats`), AND the pin lies inside that polygon
 * (sanity guard). No name takes part: a POI named after the town but standing on another element
 * (a cable-car station, a peak) matches nothing, nor does a POI without `osm_id`. null also when
 * the database has no country or no seats (imported before the seat matching of BR-POI-010).
 */
export function findMunicipality(db: Database.Database, pin: { lat: number; lng: number }, element: PoiOsmElement): Municipality | null {
  const seatType = element.osm_type
  const seatId = element.osm_id == null || element.osm_id === '' ? NaN : Number(element.osm_id)
  if (!seatType || !Number.isSafeInteger(seatId) || !Number.isFinite(pin?.lat) || !Number.isFinite(pin?.lng)) return null
  const country = regionCountry(db)
  if (!country) return null
  const hasSeats = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(ADMIN_BOUNDARY_SEATS_TABLE)
  if (!hasSeats) return null
  const rows = db.prepare(`
    SELECT b.osm_id, b.name, b.geometry_geojson
    FROM ${ADMIN_BOUNDARY_SEATS_TABLE} s JOIN ${ADMIN_BOUNDARIES_TABLE} b ON b.osm_id = s.relation_id
    WHERE s.seat_type = ? AND s.seat_id = ? AND b.admin_level = ?
      AND b.min_lat <= ? AND b.max_lat >= ? AND b.min_lng <= ? AND b.max_lng >= ?
  `).all(seatType, seatId, municipalityAdminLevel(country), pin.lat, pin.lat, pin.lng, pin.lng) as Array<{ osm_id: number; name: string; geometry_geojson: string }>
  for (const row of rows) {
    const geometry = JSON.parse(row.geometry_geojson)
    if (adminGeometryContains(geometry, pin.lat, pin.lng)) return { osmId: row.osm_id, name: row.name, geometry }
  }
  return null
}
