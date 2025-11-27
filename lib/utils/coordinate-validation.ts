/**
 * Coordinate Validation Utility
 * 
 * Single Source of Truth for coordinate validation across the entire project
 * 
 * Features:
 * - Validates latitude and longitude ranges
 * - Handles null/undefined values
 * - Returns detailed error messages
 * - Consistent validation logic everywhere
 */

export interface CoordinateValidationResult {
  valid: boolean
  error?: string
}

/**
 * Validate coordinates
 * 
 * @param latitude Latitude (-90 to 90)
 * @param longitude Longitude (-180 to 180)
 * @returns Validation result with error message if invalid
 */
export function validateCoordinates(
  latitude: number | null | undefined,
  longitude: number | null | undefined
): CoordinateValidationResult {
  // Check for null/undefined
  if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) {
    return { valid: false, error: 'Coordinates are required (latitude and longitude must be provided)' }
  }

  // Check if numbers
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return { valid: false, error: 'Coordinates must be numbers' }
  }

  // Check for NaN
  if (isNaN(latitude) || isNaN(longitude)) {
    return { valid: false, error: 'Coordinates cannot be NaN' }
  }

  // Validate latitude range
  if (latitude < -90 || latitude > 90) {
    return { valid: false, error: `Invalid latitude: ${latitude}. Must be between -90 and 90` }
  }

  // Validate longitude range
  if (longitude < -180 || longitude > 180) {
    return { valid: false, error: `Invalid longitude: ${longitude}. Must be between -180 and 180` }
  }

  return { valid: true }
}

/**
 * Validate coordinates (simple boolean version for backward compatibility)
 * 
 * @param lat Latitude
 * @param lng Longitude
 * @returns True if coordinates are valid
 */
export function isValidCoordinates(lat: number, lng: number): boolean {
  return validateCoordinates(lat, lng).valid
}

