/**
 * Image URL for a POI. Only our stored image_url counts: Google Places photo
 * references are not stored nor served (licence forbids storing Places data).
 */
export function getBestImageUrl(poi: { image_url?: string | null }): string | null {
  return poi.image_url || null
}
