/**
 * Utilities for updating attractions table with trigger points metadata
 * SSOT: Single Source of Truth for attraction updates
 */

import { getSupabaseClient } from '@/lib/core/supabase-client'

const supabase = getSupabaseClient()

export interface AttractionUpdateData {
  last_tp_generation_at?: string
  boundary_source?: string
  boundary_confidence?: number
  boundary_area_m2?: number
  generation_strategy?: string
  generation_range?: number
  tp_generation_metadata?: {
    classification?: {
      group?: string
      strategy?: string
      reasoning?: string
    }
    elevationAnalysis?: {
      poiElevation?: number
      baseElevation?: number
      elevationDiff?: number
      isHighVisibility?: boolean
    }
    processingPoints?: {
      optimalPointsFound?: number
      streetValidatedCandidates?: number
      validatedPoints?: number
      finalPoints?: number
    }
    boundaryClassification?: {
      group?: string
      strategy?: string
      reasoning?: string
    }
    searchRadius?: number
    streetCount?: number
  }
}

// ✅ DRY: calculateBoundaryArea removido - usar calculatePolygonAreaInM2 de utils/calculations.ts
import { calculatePolygonAreaInM2 } from './calculations'

/**
 * Update attraction with trigger points generation metadata
 */
export async function updateAttractionWithTPMetadata(
  attractionId: string,
  metadata: any,
  boundary?: {
    coordinates: Array<{lat: number, lng: number}>
    classification?: {
      group?: string
      strategy?: string
      reasoning?: string
    }
  } | null
): Promise<{ success: boolean; error?: string }> {
  try {
    const updateData: AttractionUpdateData = {
      last_tp_generation_at: new Date().toISOString()
    }

    // Update boundary_source if available
    if (metadata?.boundarySource) {
      updateData.boundary_source = metadata.boundarySource
    }

    // Update boundary_confidence if available
    if (metadata?.boundaryConfidence != null) {
      updateData.boundary_confidence = metadata.boundaryConfidence
    }

    // Calculate and update boundary_area_m2 if boundary coordinates are available
    if (boundary?.coordinates && boundary.coordinates.length >= 3) {
      updateData.boundary_area_m2 = calculatePolygonAreaInM2(boundary.coordinates) // ✅ DRY: usar função SSOT
    }

    // Update generation_strategy from classification
    if (boundary?.classification?.strategy) {
      updateData.generation_strategy = boundary.classification.strategy
    }

    // Update generation_range from searchRadius
    if (metadata?.searchRadius != null) {
      updateData.generation_range = metadata.searchRadius
    }

    // Build tp_generation_metadata JSONB
    const tp_generation_metadata: any = {}

    // Add classification
    if (boundary?.classification) {
      tp_generation_metadata.classification = boundary.classification
      tp_generation_metadata.boundaryClassification = boundary.classification
    }

    // Add elevation analysis
    if (metadata?.elevationAnalysis) {
      tp_generation_metadata.elevationAnalysis = metadata.elevationAnalysis
    }

    // Add processing points
    if (metadata?.optimalPointsFound !== undefined || 
        metadata?.streetValidatedCandidates !== undefined ||
        metadata?.validatedPoints !== undefined ||
        metadata?.finalPoints !== undefined) {
      tp_generation_metadata.processingPoints = {
        optimalPointsFound: metadata.optimalPointsFound,
        streetValidatedCandidates: metadata.streetValidatedCandidates,
        validatedPoints: metadata.validatedPoints,
        finalPoints: metadata.finalPoints
      }
    }

    // Add other metadata
    if (metadata?.searchRadius != null) {
      tp_generation_metadata.searchRadius = metadata.searchRadius
    }

    if (metadata?.streetCount != null) {
      tp_generation_metadata.streetCount = metadata.streetCount
    }

    if (Object.keys(tp_generation_metadata).length > 0) {
      updateData.tp_generation_metadata = tp_generation_metadata
    }

    // Update attraction
    const { error } = await supabase
      .schema('core')
      .from('attractions')
      .update(updateData)
      .eq('id', attractionId)

    if (error) {
      console.error('Error updating attraction:', error)
      return { success: false, error: error.message }
    }

    console.log(`✅ Updated attraction ${attractionId} with TP metadata`)
    return { success: true }

  } catch (error) {
    console.error('Error in updateAttractionWithTPMetadata:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}
