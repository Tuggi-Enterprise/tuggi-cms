// ========================================
// MATHEMATICAL CALCULATIONS UTILITIES
// ========================================
// Extracted from monolithic index.ts for better maintainability

/**
 * Calculate distance between two geographic points using Haversine formula
 * @param lat1 Latitude of first point
 * @param lng1 Longitude of first point
 * @param lat2 Latitude of second point
 * @param lng2 Longitude of second point
 * @returns Distance in meters
 */
export function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + 
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculate bearing between two geographic points
 * @param lat1 Latitude of first point
 * @param lng1 Longitude of first point
 * @param lat2 Latitude of second point
 * @param lng2 Longitude of second point
 * @returns Bearing in degrees (0-360)
 */
export function calculateBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const lat1Rad = lat1 * Math.PI / 180;
  const lat2Rad = lat2 * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - 
            Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);
  let bearing = Math.atan2(y, x) * 180 / Math.PI;
  return (bearing + 360) % 360;
}

/**
 * Normalize angle difference to be within -180 to 180 degrees
 * @param angleDiff Angle difference in degrees
 * @returns Normalized angle difference
 */
export function normalizeAngleDifference(angleDiff: number): number {
  while (angleDiff > 180) angleDiff -= 360;
  while (angleDiff < -180) angleDiff += 360;
  return Math.abs(angleDiff);
}

/**
 * Check if a bearing is within a specified range
 * @param bearing Bearing to check (0-360)
 * @param range Range as [min, max] degrees
 * @returns True if bearing is within range
 */
export function isInBearingRange(bearing: number, range: [number, number]): boolean {
  const [min, max] = range;
  if (min <= max) {
    return bearing >= min && bearing <= max;
  } else {
    // Range crosses 0 degrees (e.g., [350, 10])
    return bearing >= min || bearing <= max;
  }
}
