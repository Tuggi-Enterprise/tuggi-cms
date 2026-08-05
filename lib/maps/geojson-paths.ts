/**
 * GeoJSON boundary -> Google Maps paths.
 *
 * One owner for a conversion that was copy-pasted across the map components, and wrong in
 * every copy: each one read `coordinates[0]` for a Polygon and `coordinates[0][0]` for a
 * MultiPolygon, so a MultiPolygon rendered only its FIRST part. The Muralla de Segovia has
 * 39 parts along ~2 km of wall — the map drew one of them. Base-wide that is 74,242 POIs
 * whose stored, correct boundary shows up empty or truncated.
 *
 * google.maps.Polygon takes `paths` as an ARRAY of rings, so a single Polygon object renders
 * every part of a MultiPolygon. Nested rings become holes by the even-odd rule, which is the
 * behaviour we want for a boundary with courtyards.
 */

export interface LatLngLiteral { lat: number; lng: number }

/** A GeoJSON position is [lng, lat] -- the opposite order of Google Maps. */
type Position = [number, number]
type Ring = Position[]

export interface GeoJSONPolygon { type: 'Polygon'; coordinates: Ring[] }
export interface GeoJSONMultiPolygon { type: 'MultiPolygon'; coordinates: Ring[][] }
export type GeoJSONAreal = GeoJSONPolygon | GeoJSONMultiPolygon

/**
 * Every ring of the geometry, as arrays of {lat, lng}.
 *
 * Returns [] for anything unusable rather than throwing: a map that silently skips one broken
 * boundary is better than a map that fails to render.
 */
export function geoJSONToPaths(geometry: unknown): LatLngLiteral[][] {
  const g = geometry as GeoJSONAreal | null | undefined
  if (!g || !Array.isArray((g as any).coordinates)) return []

  const ringToPath = (ring: unknown): LatLngLiteral[] => {
    if (!Array.isArray(ring)) return []
    return (ring as Ring)
      .filter(p => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
      .map(p => ({ lat: p[1], lng: p[0] }))
  }

  const rings: LatLngLiteral[][] =
    g.type === 'MultiPolygon'
      ? (g.coordinates as Ring[][]).flatMap(polygon => (Array.isArray(polygon) ? polygon.map(ringToPath) : []))
      : g.type === 'Polygon'
        ? (g.coordinates as Ring[]).map(ringToPath)
        : []

  // A ring needs three distinct points to enclose anything.
  return rings.filter(r => r.length >= 3)
}

/** Flat list of every vertex, for fitBounds and similar. */
export function geoJSONToPoints(geometry: unknown): LatLngLiteral[] {
  return geoJSONToPaths(geometry).flat()
}

/** How many parts the geometry has -- useful to tell the curator a boundary is multi-part. */
export function geoJSONPartCount(geometry: unknown): number {
  const g = geometry as GeoJSONAreal | null | undefined
  if (!g || !Array.isArray((g as any).coordinates)) return 0
  return g.type === 'MultiPolygon' ? g.coordinates.length : g.type === 'Polygon' ? 1 : 0
}
