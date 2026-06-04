/**
 * SSOT for extracting POI coordinates from the many payload shapes the CMS
 * receives (RPC rows, PostgREST embeds, legacy objects).
 *
 * Coordinates are NOT physical columns on `core.attraction` — they live in
 * `core.attraction_coordinate`. Any code that builds a POI's coordinates must
 * go through here so a single, correct rule applies everywhere. Reading from a
 * source that lacks the join is exactly what produced the 0,0 (ocean) bug.
 */

export interface Coordinates {
  latitude: number
  longitude: number
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Returns a valid coordinate pair, or `undefined` when none can be derived.
 * The exact pair (0, 0) is treated as "no coordinate" — it is the historical
 * sentinel for a missing record and never a real POI location in this dataset.
 */
function buildCoordinates(lat: unknown, lng: unknown): Coordinates | undefined {
  const latitude = toFiniteNumber(lat)
  const longitude = toFiniteNumber(lng)
  if (latitude === null || longitude === null) return undefined
  if (latitude === 0 && longitude === 0) return undefined
  return { latitude, longitude }
}

/**
 * Extract coordinates from any known row shape:
 *  - flat columns: `row.latitude` / `row.longitude` (RPC results, attraction_coordinate row)
 *  - embedded PostgREST relation: `row.attraction_coordinate` (object or array)
 *  - legacy `row.coordinates` (array `[{latitude,longitude}]` or object)
 */
export function extractCoordinates(row: any): Coordinates | undefined {
  if (!row || typeof row !== 'object') return undefined

  // 1. Flat columns (cms_list_pois, cms_search_pois_map, attraction_coordinate)
  const flat = buildCoordinates(row.latitude, row.longitude)
  if (flat) return flat

  // 2. Embedded attraction_coordinate relation (PostgREST embed)
  const ac = row.attraction_coordinate
  if (Array.isArray(ac) && ac[0]) {
    const fromArray = buildCoordinates(ac[0].latitude, ac[0].longitude)
    if (fromArray) return fromArray
  } else if (ac && typeof ac === 'object') {
    const fromObject = buildCoordinates(ac.latitude, ac.longitude)
    if (fromObject) return fromObject
  }

  // 3. Legacy `coordinates` field (array or object)
  const c = row.coordinates
  if (Array.isArray(c) && c[0]) {
    const fromArray = buildCoordinates(c[0].latitude, c[0].longitude)
    if (fromArray) return fromArray
  } else if (c && typeof c === 'object') {
    const fromObject = buildCoordinates(c.latitude, c.longitude)
    if (fromObject) return fromObject
  }

  return undefined
}
