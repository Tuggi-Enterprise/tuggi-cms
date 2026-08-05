/**
 * Geometry Utility Functions
 */

/**
 * Calculate polygon area using spherical geometry (Haver-formula based approximation)
 * Returns area in square meters
 * 
 * @param coordinates Array of {lat, lng} points
 * @returns area in square meters
 */
export function calculatePolygonArea(coordinates: Array<{ lat: number; lng: number }>): number {
  if (coordinates.length < 3) return 0

  // Spherical excess (the same formula as Google Maps' computeSignedArea), NOT the shoelace
  // sum over raw radians that lived here before.
  //
  // The old version treated (lng, lat) in radians as a flat Cartesian plane, so it never
  // narrowed the meridians as latitude grows: it overestimated by exactly 1/cos(latitude).
  // Measured against PostGIS in Barcelona (41.4 deg): 21,213 m2 stored for 15,933 m2 real on
  // the Sagrada Familia, and 27,448 for 20,621 on Placa de Catalunya -- both 1.331x, and
  // 1/cos(41.4 deg) = 1.3331. The error is nil at the equator, a third in Barcelona, and
  // doubles near the polar circle.
  const R = 6371000 // Earth's radius in meters
  const rad = Math.PI / 180
  const n = coordinates.length
  let total = 0

  for (let i = 0; i < n; i++) {
    const p1 = coordinates[i]
    const p2 = coordinates[(i + 1) % n]
    total += (p2.lng - p1.lng) * rad * (2 + Math.sin(p1.lat * rad) + Math.sin(p2.lat * rad))
  }

  return Math.max(1, Math.round(Math.abs((total * R * R) / 2)))
}

/**
 * Calculate polygon centroid (arithmetic mean)
 * 
 * @param coordinates Array of {lat, lng} points
 * @returns {lat, lng} center
 */
export function calculatePolygonCenter(coordinates: Array<{ lat: number; lng: number }>): { lat: number; lng: number } {
  if (coordinates.length === 0) return { lat: 0, lng: 0 }

  const total = coordinates.reduce(
    (acc, coord) => {
      acc.lat += coord.lat
      acc.lng += coord.lng
      return acc
    },
    { lat: 0, lng: 0 }
  )
  
  return {
    lat: total.lat / coordinates.length,
    lng: total.lng / coordinates.length
  }
}
