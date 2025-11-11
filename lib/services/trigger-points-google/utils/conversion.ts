/**
 * Conversion utilities for Trigger Points
 * Converts TriggerPoint (new format) to database format
 * SSOT: Single Source of Truth for conversion logic
 */

import { TriggerPoint } from '../types/interfaces'

export interface TriggerPointForDB {
  lat: number
  lng: number
  radius_meters: number
  expected_bearing?: number
  bearing_threshold?: number
  type: 'primary' | 'secondary' | 'fallback' | 'special' | 'testing'
  priority: number
  confidence_score: number
  auto_status: 'approved' | 'review' | 'rejected'
  final_status: 'approved' | 'review' | 'rejected' | 'pending'
  score_factors: any
  generation_method: string
  validation_notes?: string
  name?: string
  description?: string
  direction?: 'front' | 'right' | 'left' | 'back'
  access?: 'walk' | 'car' | 'both'
}

/**
 * Convert TriggerPoint to database format
 * Validates constraints according to schema
 */
export function convertTriggerPointToDB(
  tp: TriggerPoint,
  boundarySource?: string,
  reasoning?: string
): TriggerPointForDB {
  // Validate and convert radius
  const radius_meters = Math.max(1, Math.min(500, Math.round(tp.radius || 30)))
  
  // Validate and convert expected_bearing (0-360)
  const expected_bearing = tp.expectedBearing != null 
    ? Math.max(0, Math.min(359.999, tp.expectedBearing))
    : undefined
  
  // Validate and convert bearing_threshold (1-180, default 30)
  const bearing_threshold = tp.bearingThreshold != null
    ? Math.max(1, Math.min(180, tp.bearingThreshold))
    : 30
  
  // Validate type
  const validTypes = ['primary', 'secondary', 'fallback', 'special', 'testing']
  const type = validTypes.includes(tp.type) ? tp.type : 'primary'
  
  // Validate priority (1-10)
  const priority = Math.max(1, Math.min(10, tp.priority || 1))
  
  // Validate confidence_score (0.0-1.0)
  const confidence_score = Math.max(0.0, Math.min(1.0, tp.confidence || 0))
  
  // Calculate auto_status based on confidence
  let auto_status: 'approved' | 'review' | 'rejected'
  if (confidence_score >= 0.7) {
    auto_status = 'approved'
  } else if (confidence_score >= 0.4) {
    auto_status = 'review'
  } else {
    auto_status = 'rejected'
  }
  
  // Final status defaults to auto_status
  const final_status = auto_status
  
  // Build score_factors from metadata
  const score_factors: any = {
    quality: tp.quality,
    distance: tp.distance,
    street: tp.street ? {
      name: tp.street.name || null,
      confidence: tp.street.confidence
    } : null
  }
  
  // Build generation_method
  const generation_method = boundarySource 
    ? `google_apis_${boundarySource}`
    : 'google_apis'
  
  return {
    lat: tp.location.lat,
    lng: tp.location.lng,
    radius_meters,
    expected_bearing,
    bearing_threshold,
    type,
    priority,
    confidence_score,
    auto_status,
    final_status,
    score_factors,
    generation_method,
    validation_notes: reasoning,
    access: 'both' // Default access
  }
}

/**
 * Convert array of TriggerPoints to database format
 */
export function convertTriggerPointsToDB(
  triggerPoints: TriggerPoint[],
  boundarySource?: string,
  metadata?: any
): TriggerPointForDB[] {
  return triggerPoints.map(tp => {
    const reasoning = metadata?.reasoning || tp.street?.name || undefined
    return convertTriggerPointToDB(tp, boundarySource, reasoning)
  })
}
