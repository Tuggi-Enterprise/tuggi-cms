/**
 * POI boundary (polygon) data access. Single source of truth for the
 * `/api/pois/update-boundary` endpoint, which serves three operations:
 *   - get:    { poi_id, get_only: true }      -> { boundary: LatLng[] | null }
 *   - save:   { attractionId, coordinates }    -> { data: { boundary_area_m2, boundary_centroid } }
 *   - delete: { poi_id, boundary: null }
 *
 * Mirrors the house style of lib/hooks/use-trigger-points-for-poi.ts: plain
 * async functions here, wrapped by react-query in lib/hooks/usePoiBoundary.ts.
 */

export interface BoundaryPoint {
  lat: number
  lng: number
}

export interface BoundarySaveResult {
  boundary_area_m2?: number | null
  boundary_centroid?: unknown
}

const BOUNDARY_ENDPOINT = '/api/pois/update-boundary'

async function postBoundary(body: Record<string, unknown>): Promise<Response> {
  return fetch(BOUNDARY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Fetch the persisted boundary for a POI. Returns null when none exists. */
export async function fetchBoundary(poiId: string): Promise<BoundaryPoint[] | null> {
  const response = await postBoundary({ poi_id: poiId, get_only: true })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `Failed to fetch boundary (${response.status})`)
  }
  const data = await response.json().catch(() => ({}))
  return Array.isArray(data?.boundary) ? (data.boundary as BoundaryPoint[]) : null
}

/** Keep only points that are valid finite lat/lng within range. */
export function sanitizeBoundary(coordinates: BoundaryPoint[]): BoundaryPoint[] {
  return coordinates.filter(
    (c) =>
      typeof c.lat === 'number' &&
      typeof c.lng === 'number' &&
      !Number.isNaN(c.lat) &&
      !Number.isNaN(c.lng) &&
      c.lat >= -90 && c.lat <= 90 &&
      c.lng >= -180 && c.lng <= 180,
  )
}

/** Persist a boundary polygon. Throws with the server message on failure. */
export async function saveBoundary(
  attractionId: string,
  coordinates: BoundaryPoint[],
): Promise<BoundarySaveResult> {
  const response = await postBoundary({ attractionId, coordinates })
  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    let parsed: { error?: string; message?: string } = {}
    try { parsed = JSON.parse(errorText) } catch { parsed = { error: errorText } }
    throw new Error(parsed.error || parsed.message || 'Failed to save boundary')
  }
  const result = await response.json().catch(() => ({}))
  return (result?.data ?? {}) as BoundarySaveResult
}

/** Remove a POI's boundary. */
export async function deleteBoundary(poiId: string): Promise<void> {
  const response = await postBoundary({ poi_id: poiId, boundary: null })
  if (!response.ok) {
    throw new Error('Falha ao remover boundary')
  }
}
