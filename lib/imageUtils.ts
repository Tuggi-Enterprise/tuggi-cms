/**
 * Utility functions for optimizing image loading from Google Places API
 */

/**
 * Generates an optimized Google Places photo URL
 * @param photoReference - The photo reference from Google Places API
 * @param maxWidth - Maximum width for the image (default: 400 for thumbnails)
 * @param apiKey - Google Maps API key
 * @returns Optimized image URL or null if no photo reference
 */
export function getOptimizedGooglePlacesImageUrl(
  photoReference: string | null | undefined,
  maxWidth: number = 400,
  apiKey?: string
): string | null {
  if (!photoReference) {
    return null
  }

  const googleApiKey = apiKey || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  if (!googleApiKey) {
    console.warn('Google Maps API key not available for image optimization')
    return null
  }

  return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxWidth}&photo_reference=${photoReference}&key=${googleApiKey}`
}

/**
 * Gets the best available image URL for a POI
 * Prioritizes Google Places optimized URLs over stored image_url
 * @param poi - POI object with image_url and photos_references
 * @param maxWidth - Maximum width for Google Places images
 * @returns Best available image URL or null
 */
export function getBestImageUrl(
  poi: {
    image_url?: string | null
    photos_references?: string[] | null
  },
  maxWidth: number = 400
): string | null {
  // First try to use Google Places optimized URL if photo reference is available
  if (poi.photos_references && poi.photos_references.length > 0) {
    const optimizedUrl = getOptimizedGooglePlacesImageUrl(poi.photos_references[0], maxWidth)
    if (optimizedUrl) {
      return optimizedUrl
    }
  }

  // Fallback to stored image_url
  return poi.image_url || null
}

/**
 * Generates a thumbnail URL with smaller dimensions for list views
 * @param poi - POI object with image_url and photos_references
 * @returns Thumbnail URL optimized for list views
 */
export function getThumbnailUrl(
  poi: {
    image_url?: string | null
    photos_references?: string[] | null
  }
): string | null {
  return getBestImageUrl(poi, 300) // Smaller size for thumbnails
}

/**
 * Generates a full-size image URL for detail views
 * @param poi - POI object with image_url and photos_references
 * @returns Full-size image URL
 */
export function getFullSizeImageUrl(
  poi: {
    image_url?: string | null
    photos_references?: string[] | null
  }
): string | null {
  return getBestImageUrl(poi, 800) // Larger size for detail views
}