/**
 * Attraction-group data access (POI grouping by polygon).
 * Single source of truth for the `/api/attraction-groups/*` endpoints:
 *   - nearby:  POST /api/attraction-groups/nearby   { polygon, poiId } -> nearby POIs in polygon
 *   - of-poi:  GET  /api/attraction-groups/of-poi?poiId=...           -> { group, members }
 *   - group:   POST /api/attraction-groups/group     { groupId, name, poiIds }
 *
 * Plain async functions (house style: lib/hooks/use-trigger-points-for-poi.ts).
 * UI side-effects (state, feedback) stay in the caller.
 */

export interface PoiGroup {
  id: string
  name?: string
  [key: string]: unknown
}

export interface GroupOfPoiResult {
  group: PoiGroup | null
  members: string[]
}

export interface SaveGroupInput {
  groupId?: string
  name: string
  poiIds: string[]
}

/** Find POIs inside a polygon, excluding the current POI by id/attraction_id. */
export async function fetchNearbyInPolygon(
  polygon: Array<{ lat: number; lng: number }>,
  poiId: string | undefined,
): Promise<any[]> {
  const res = await fetch('/api/attraction-groups/nearby', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ polygon, poiId }),
  })
  if (!res.ok) {
    const errorText = await res.text().catch(() => '')
    throw new Error(`API error ${res.status}: ${errorText}`)
  }
  const data = await res.json().catch(() => ({}))
  const target = String(poiId || '').toLowerCase()
  return (data.nearby || []).filter((p: any) => {
    const pId = String(p.id || '').toLowerCase()
    const pAttractionId = String(p.attraction_id || '').toLowerCase()
    return pId !== target && pAttractionId !== target
  })
}

/** Get the group a POI belongs to (if any) plus member ids. */
export async function fetchGroupOfPoi(poiId: string): Promise<GroupOfPoiResult> {
  const res = await fetch(`/api/attraction-groups/of-poi?poiId=${poiId}`)
  const data = await res.json().catch(() => ({}))
  return { group: data.group ?? null, members: data.members ?? [] }
}

/** Create or update a group with the given POIs. */
export async function saveGroup(input: SaveGroupInput): Promise<void> {
  const res = await fetch('/api/attraction-groups/group', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const errorText = await res.text().catch(() => '')
    throw new Error(`Failed to save group: ${errorText}`)
  }
}
