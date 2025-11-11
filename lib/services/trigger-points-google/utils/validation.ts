/**
 * Validation utilities for Trigger Points before saving
 * SSOT: Single Source of Truth for validation logic
 */

import { TriggerPointForDB } from './conversion'

export interface ValidationError {
  field: string
  message: string
  value?: any
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
}

/**
 * Validate a single trigger point before saving
 * Checks all schema constraints
 */
export function validateTriggerPointForDB(tp: TriggerPointForDB): ValidationResult {
  const errors: ValidationError[] = []

  // Validate radius_meters (1-500)
  if (tp.radius_meters <= 0 || tp.radius_meters > 500) {
    errors.push({
      field: 'radius_meters',
      message: `radius_meters must be between 1 and 500, got ${tp.radius_meters}`,
      value: tp.radius_meters
    })
  }

  // Validate expected_bearing (0-360) if provided
  if (tp.expected_bearing != null) {
    if (tp.expected_bearing < 0 || tp.expected_bearing >= 360) {
      errors.push({
        field: 'expected_bearing',
        message: `expected_bearing must be between 0 and 360, got ${tp.expected_bearing}`,
        value: tp.expected_bearing
      })
    }
  }

  // Validate bearing_threshold (1-180) if provided
  if (tp.bearing_threshold != null) {
    if (tp.bearing_threshold <= 0 || tp.bearing_threshold > 180) {
      errors.push({
        field: 'bearing_threshold',
        message: `bearing_threshold must be between 1 and 180, got ${tp.bearing_threshold}`,
        value: tp.bearing_threshold
      })
    }
  }

  // Validate type
  const validTypes = ['primary', 'secondary', 'fallback', 'special', 'testing']
  if (!validTypes.includes(tp.type)) {
    errors.push({
      field: 'type',
      message: `type must be one of ${validTypes.join(', ')}, got ${tp.type}`,
      value: tp.type
    })
  }

  // Validate priority (1-10)
  if (tp.priority < 1 || tp.priority > 10) {
    errors.push({
      field: 'priority',
      message: `priority must be between 1 and 10, got ${tp.priority}`,
      value: tp.priority
    })
  }

  // Validate confidence_score (0.0-1.0)
  if (tp.confidence_score < 0.0 || tp.confidence_score > 1.0) {
    errors.push({
      field: 'confidence_score',
      message: `confidence_score must be between 0.0 and 1.0, got ${tp.confidence_score}`,
      value: tp.confidence_score
    })
  }

  // Validate auto_status
  const validAutoStatuses = ['approved', 'review', 'rejected']
  if (!validAutoStatuses.includes(tp.auto_status)) {
    errors.push({
      field: 'auto_status',
      message: `auto_status must be one of ${validAutoStatuses.join(', ')}, got ${tp.auto_status}`,
      value: tp.auto_status
    })
  }

  // Validate final_status
  const validFinalStatuses = ['approved', 'review', 'rejected', 'pending']
  if (!validFinalStatuses.includes(tp.final_status)) {
    errors.push({
      field: 'final_status',
      message: `final_status must be one of ${validFinalStatuses.join(', ')}, got ${tp.final_status}`,
      value: tp.final_status
    })
  }

  // Validate location (lat/lng)
  if (tp.lat < -90 || tp.lat > 90) {
    errors.push({
      field: 'lat',
      message: `lat must be between -90 and 90, got ${tp.lat}`,
      value: tp.lat
    })
  }

  if (tp.lng < -180 || tp.lng > 180) {
    errors.push({
      field: 'lng',
      message: `lng must be between -180 and 180, got ${tp.lng}`,
      value: tp.lng
    })
  }

  // Validate access if provided
  if (tp.access != null) {
    const validAccess = ['walk', 'car', 'both']
    if (!validAccess.includes(tp.access)) {
      errors.push({
        field: 'access',
        message: `access must be one of ${validAccess.join(', ')}, got ${tp.access}`,
        value: tp.access
      })
    }
  }

  return {
    valid: errors.length === 0,
    errors
  }
}

/**
 * Validate array of trigger points
 * Returns valid points and errors
 */
export function validateTriggerPointsForDB(
  triggerPoints: TriggerPointForDB[]
): {
  valid: TriggerPointForDB[]
  invalid: Array<{ tp: TriggerPointForDB; errors: ValidationError[] }>
} {
  const valid: TriggerPointForDB[] = []
  const invalid: Array<{ tp: TriggerPointForDB; errors: ValidationError[] }> = []

  for (const tp of triggerPoints) {
    const validation = validateTriggerPointForDB(tp)
    if (validation.valid) {
      valid.push(tp)
    } else {
      invalid.push({ tp, errors: validation.errors })
    }
  }

  return { valid, invalid }
}

/**
 * Validate array of trigger points (alias for processing service compatibility)
 * Returns format expected by processing service
 */
export function validateTriggerPoints(
  triggerPoints: TriggerPointForDB[]
): {
  validItems: TriggerPointForDB[]
  errors: ValidationError[]
} {
  const { valid, invalid } = validateTriggerPointsForDB(triggerPoints)
  const allErrors = invalid.flatMap(item => item.errors)
  
  return {
    validItems: valid,
    errors: allErrors
  }
}

