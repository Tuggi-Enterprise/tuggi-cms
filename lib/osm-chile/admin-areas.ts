/**
 * #1203: the región and the comuna of a point in Chile, read from the OSM administrative
 * boundaries. admin_level=4 (región) goes to core.attractions.state, admin_level=8 (comuna)
 * goes to core.attractions.city.
 *
 * Comuna in the city field is the operator's choice by benchmark: Google and OSM file a point in
 * Providencia under Providencia, not under Santiago.
 *
 * The state goes through normalizeState, the CMS canonical for the 16 Chilean regions. It is the
 * same normalisation POICreationService applies on every insert, so the fix script and the
 * create script write one spelling per región; the raw OSM name ("Región de Valparaíso") next
 * to the canonical one ("Valparaíso") would split the state filter of the CMS in two.
 *
 * resolveAdminArea is the one place that decides the pair. The fix script and the create script
 * both call it: there is no second implementation.
 */
import { calculateDistance, isPointInPolygon } from '../services/trigger-points-google/utils/calculations'
import { normalizeState } from '../shared/location-normalize'

export interface LatLng { lat: number; lng: number }

/** GeoJSON position, [lng, lat]. */
export type Position = [number, number]

export type AreaGeometry =
  | { type: 'Polygon'; coordinates: Position[][] }
  | { type: 'MultiPolygon'; coordinates: Position[][][] }

/** What the cache file keeps per boundary: the OSM relation, its level, its name and its shape. */
export interface RawAdminArea {
  osmId: number
  level: 4 | 8
  name: string
  geometry: AreaGeometry
}

export interface AdminArea {
  osmId: number
  level: 4 | 8
  name: string
  /** polygons[k][0] is the outer ring, polygons[k][1..] are its holes. */
  polygons: LatLng[][][]
  bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number }
}

export interface AdminAreas {
  regions: AdminArea[]
  comunas: AdminArea[]
}

export function toAdminArea(raw: RawAdminArea): AdminArea {
  const polys: Position[][][] = raw.geometry.type === 'Polygon' ? [raw.geometry.coordinates] : raw.geometry.coordinates
  const polygons = polys.map(rings => rings.map(ring => ring.map(([lng, lat]) => ({ lat, lng }))))
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity
  for (const poly of polygons) {
    for (const p of poly[0] ?? []) {
      if (p.lat < minLat) minLat = p.lat
      if (p.lat > maxLat) maxLat = p.lat
      if (p.lng < minLng) minLng = p.lng
      if (p.lng > maxLng) maxLng = p.lng
    }
  }
  return { osmId: raw.osmId, level: raw.level, name: raw.name, polygons, bbox: { minLat, maxLat, minLng, maxLng } }
}

export function buildAdminAreas(raws: RawAdminArea[]): AdminAreas {
  const areas = raws.map(toAdminArea)
  return { regions: areas.filter(a => a.level === 4), comunas: areas.filter(a => a.level === 8) }
}

/** Inside the outer ring of some polygon and outside every hole of that polygon. */
export function pointInArea(p: LatLng, area: AdminArea): boolean {
  const b = area.bbox
  if (p.lat < b.minLat || p.lat > b.maxLat || p.lng < b.minLng || p.lng > b.maxLng) return false
  for (const poly of area.polygons) {
    if (!poly[0] || !isPointInPolygon(p, poly[0])) continue
    let inHole = false
    for (let i = 1; i < poly.length; i++) {
      if (isPointInPolygon(p, poly[i])) { inHole = true; break }
    }
    if (!inHole) return true
  }
  return false
}

export interface ResolvedAdminArea {
  region: AdminArea | null
  comuna: AdminArea | null
  /** Canonical state for core.attractions.state, or null when the point is in no región. */
  state: string | null
  /** OSM comuna name for core.attractions.city, or null when the point is in no comuna. */
  city: string | null
}

export function resolveAdminArea(p: LatLng, areas: AdminAreas): ResolvedAdminArea {
  const region = areas.regions.find(a => pointInArea(p, a)) ?? null
  const comuna = areas.comunas.find(a => pointInArea(p, a)) ?? null
  return {
    region,
    comuna,
    state: region ? normalizeState('Chile', region.name) : null,
    city: comuna ? comuna.name : null,
  }
}

export type AdminFixPlan =
  | { status: 'outside' }
  | { status: 'unchanged' }
  | { status: 'change'; changes: { state?: string; city?: string } }

/**
 * Both fields or neither: a point that falls in a comuna but in no región (or the reverse) sits
 * on a simplified border, and half a fix there is a guess. It is listed, not written.
 */
export function planAdminFix(current: { state: string | null; city: string | null }, resolved: ResolvedAdminArea): AdminFixPlan {
  if (!resolved.state || !resolved.city) return { status: 'outside' }
  const changes: { state?: string; city?: string } = {}
  if (current.state !== resolved.state) changes.state = resolved.state
  if (current.city !== resolved.city) changes.city = resolved.city
  return Object.keys(changes).length ? { status: 'change', changes } : { status: 'unchanged' }
}

/**
 * "Two hours by car from Santiago", read as a 150 km circle around Plaza de Armas. It reaches
 * Valparaíso and Viña del Mar (about 120 km), Isla Negra, the Embalse El Yeso and Valle Nevado.
 * The scripts also require the point to fall in a Chilean región, so the Argentine side of the
 * Andes inside the circle stays out.
 */
export const SANTIAGO_CENTER: LatLng = { lat: -33.4489, lng: -70.6693 }
export const SANTIAGO_RADIUS_KM = 150

export function isInSantiagoArea(p: LatLng): boolean {
  return calculateDistance(p, SANTIAGO_CENTER) <= SANTIAGO_RADIUS_KM * 1000
}

export interface BBox { minLat: number; maxLat: number; minLng: number; maxLng: number }

/** The box around the 150 km circle, for the coordinate scan of the database. */
export function santiagoAreaBBox(): BBox {
  const dLat = SANTIAGO_RADIUS_KM / 111.32
  const dLng = SANTIAGO_RADIUS_KM / (111.32 * Math.cos((SANTIAGO_CENTER.lat * Math.PI) / 180))
  return {
    minLat: SANTIAGO_CENTER.lat - dLat,
    maxLat: SANTIAGO_CENTER.lat + dLat,
    minLng: SANTIAGO_CENTER.lng - dLng,
    maxLng: SANTIAGO_CENTER.lng + dLng,
  }
}

/**
 * Boxes that hold all of Chile: the mainland strip plus the Pacific islands (Rapa Nui, Juan
 * Fernández, Desventuradas). They overlap Argentina, Bolivia and Peru; pointInArea against the
 * regions is what decides.
 */
export const CHILE_BBOXES: BBox[] = [
  { minLat: -56.0, maxLat: -17.4, minLng: -76.0, maxLng: -66.3 },
  { minLat: -27.3, maxLat: -27.0, minLng: -109.5, maxLng: -109.2 },
  { minLat: -34.0, maxLat: -33.5, minLng: -81.0, maxLng: -78.7 },
  { minLat: -26.5, maxLat: -26.2, minLng: -80.2, maxLng: -79.8 },
]

/** country values that mean Chile: the canonical one, the ISO code and anything that spells it. */
export function isChileCountry(country: string | null | undefined): boolean {
  const c = (country ?? '').trim().toLowerCase()
  return c === 'cl' || c.includes('chile')
}
