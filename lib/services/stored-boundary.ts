/**
 * The one way to remove a POI's stored border from `core.attraction_coordinate`: every
 * `boundary_*` column back to null, the pin (`latitude`/`longitude`) kept. There is no delete
 * RPC, so it is a plain UPDATE. Callers: the CMS "delete border" route
 * (`app/api/pois/update-boundary`), the migration pipeline after a municipal POI's TPs are
 * saved (BR-POI-010), and the one-off cleanup of the municipal borders already stored.
 */

/** Every column the border owns. A new `boundary_*` column joins here, not at the callers. */
export const CLEARED_BOUNDARY_COLUMNS = {
  boundary_geometry: null,
  boundary_type: null,
  boundary_source: null,
  boundary_confidence: null,
  boundary_area_m2: null,
  boundary_centroid_lat: null,
  boundary_centroid_lng: null,
} as const

/** Minimal client shape, so tests and scripts pass their own Supabase client. */
interface CoreClient {
  schema(name: 'core'): {
    from(table: 'attraction_coordinate'): {
      update(patch: typeof CLEARED_BOUNDARY_COLUMNS): {
        eq(column: 'attraction_id', value: string): PromiseLike<{ error: { message: string } | null }>
      }
    }
  }
}

export async function clearStoredBoundary(client: CoreClient, attractionId: string): Promise<{ error: string | null }> {
  const { error } = await client
    .schema('core')
    .from('attraction_coordinate')
    .update(CLEARED_BOUNDARY_COLUMNS)
    .eq('attraction_id', attractionId)
  return { error: error?.message ?? null }
}
