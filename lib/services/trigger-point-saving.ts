/**
 * Trigger Point Saving Service
 * 
 * Centralized service for saving trigger points to database
 * Consolidates duplicate saving logic from multiple routes
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { autoRefreshToken: false, persistSession: false }
  }
)

export interface TriggerPointSaveData {
  attraction_id: string
  lat: number
  lng: number
  radius_meters?: number
  expected_bearing?: number
  bearing_threshold?: number
  type: 'primary' | 'secondary' | 'fallback'
  priority?: number
  is_active?: boolean
  confidence?: number
  auto_status?: string
  manual_status?: string
  final_status?: string
  score_factors?: any
  generation_method: string
  validation_notes?: string
  created_by?: string
  updated_by?: string
}

export interface SaveResult {
  saved: number
  skipped: number
  errors: string[]
}

export class TriggerPointSavingService {
  
  /**
   * Prepare trigger point data for database insertion
   */
  static prepareTriggerPointForDB(tp: TriggerPointSaveData): any {
    return {
      attraction_id: tp.attraction_id,
      location: `POINT(${tp.lng} ${tp.lat})`,
      radius_meters: tp.radius_meters || 20,
      expected_bearing: tp.expected_bearing,
      bearing_threshold: tp.bearing_threshold || 30,
      type: tp.type,
      priority: tp.priority || this.getDefaultPriority(tp.type),
      is_active: tp.is_active !== undefined ? tp.is_active : true,
      confidence_score: tp.confidence,
      auto_status: tp.auto_status,
      manual_status: tp.manual_status || 'pending',
      final_status: tp.final_status || this.calculateFinalStatus(tp.auto_status, tp.manual_status),
      score_factors: tp.score_factors,
      generation_method: tp.generation_method,
      validation_notes: tp.validation_notes,
      created_by: tp.created_by,
      updated_by: tp.updated_by,
      created_at: new Date().toISOString()
    }
  }

  /**
   * Get default priority based on type
   */
  static getDefaultPriority(type: string): number {
    switch (type) {
      case 'primary': return 1
      case 'secondary': return 2
      case 'fallback': return 3
      default: return 2
    }
  }

  /**
   * Calculate final status from auto and manual status
   */
  static calculateFinalStatus(autoStatus?: string, manualStatus?: string): string {
    // Manual override takes precedence
    if (manualStatus && manualStatus !== 'pending') {
      return manualStatus
    }
    // Use auto status or default to pending
    return autoStatus || 'pending'
  }

  /**
   * Save multiple trigger points with duplicate validation
   */
  static async saveTriggerPointsBatch(
    attractionId: string,
    triggerPoints: any[],
    boundarySource: string
  ): Promise<SaveResult> {
    const results: SaveResult = {
      saved: 0,
      skipped: 0,
      errors: []
    }

    if (!attractionId || !triggerPoints || triggerPoints.length === 0) {
      console.log('⚠️ No trigger points to save')
      return results
    }

    try {
      // Filter eligible TPs (confidence threshold)
      const minConfidence = 0.3
      const eligibleTPs = triggerPoints.filter(tp => {
        const hasMinConfidence = (tp.individual_confidence_score || tp.confidence || 0) >= minConfidence
        
        if (!hasMinConfidence) {
          console.log(`⚠️ Skipping ${tp.type} TP: confidence ${tp.individual_confidence_score || tp.confidence} < ${minConfidence}`)
          results.skipped++
        }
        
        return hasMinConfidence
      })

      if (eligibleTPs.length === 0) {
        console.log('⚠️ No eligible trigger points after confidence filtering')
        return results
      }

      console.log(`🔍 Validating ${eligibleTPs.length} trigger points for duplicates (${results.skipped} skipped for low confidence)`)

      // Prepare TPs for validation
      const tpsForValidation = eligibleTPs.map(tp => ({
        lat: tp.lat,
        lng: tp.lng,
        type: tp.type,
        confidence: tp.individual_confidence_score || tp.confidence,
        auto_status: tp.auto_status,
        reasoning: tp.reasoning || tp.validation_notes,
        radius_meters: tp.radius_meters || 20,
        expected_bearing: tp.expected_bearing,
        score_factors: tp.score_factors,
        generation_method: tp.generation_method || `auto_${boundarySource}`,
        final_status: tp.final_status || tp.auto_status
      }))

      // Validate for duplicates using Supabase RPC
      const { data: validatedTPs, error: validationError } = await supabase
        .schema('core')
        .rpc('validate_trigger_points_batch', {
          p_attraction_id: attractionId,
          p_trigger_points: tpsForValidation,
          p_distance_threshold: 20.0
        })

      if (validationError) {
        throw new Error(`Validation failed: ${validationError.message}`)
      }

      const validatedTPsArray = Array.isArray(validatedTPs) ? validatedTPs : []
      const duplicatesSkipped = eligibleTPs.length - validatedTPsArray.length

      if (validatedTPsArray.length === 0) {
        console.log(`⚠️ All ${eligibleTPs.length} trigger points were duplicates - skipping insert`)
        
        // Mark POI as processed even though no new TPs were created
        await this.markPOIAsProcessed(attractionId)
        
        results.skipped += duplicatesSkipped
        return results
      }

      console.log(`✅ Saving ${validatedTPsArray.length} validated trigger points (${duplicatesSkipped} duplicates skipped)`)

      // Prepare validated TPs for database insertion
      const tpsForDB = validatedTPsArray.map(tp => this.prepareTriggerPointForDB({
        attraction_id: attractionId,
        lat: tp.lat,
        lng: tp.lng,
        radius_meters: tp.radius_meters,
        expected_bearing: tp.expected_bearing,
        type: tp.type,
        confidence: tp.confidence,
        auto_status: tp.auto_status,
        final_status: tp.final_status,
        score_factors: tp.score_factors,
        generation_method: tp.generation_method,
        validation_notes: tp.reasoning
      }))

      // Insert to database
      const { data, error } = await supabase
        .schema('core')
        .from('attraction_trigger_points')
        .insert(tpsForDB)
        .select('id')

      if (error) {
        console.error('❌ Error saving trigger points:', error)
        results.errors.push(error.message)
        return results
      }

      results.saved = data?.length || 0
      results.skipped += duplicatesSkipped

      // Mark POI as processed after successful TP creation
      await this.markPOIAsProcessed(attractionId)

      return results

    } catch (error) {
      console.error('❌ Error in saveTriggerPointsBatch:', error)
      results.errors.push(error instanceof Error ? error.message : 'Unknown error')
      return results
    }
  }

  /**
   * Save a single trigger point (for manual creation)
   */
  static async saveSingleTriggerPoint(triggerPointData: TriggerPointSaveData): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const tpForDB = this.prepareTriggerPointForDB(triggerPointData)

      const { data, error } = await supabase
        .schema('core')
        .from('attraction_trigger_points')
        .insert(tpForDB)
        .select()
        .single()

      if (error) {
        console.error('❌ Error saving single trigger point:', error)
        return { success: false, error: error.message }
      }

      console.log('✅ Single trigger point saved successfully:', data.id)
      return { success: true, data }

    } catch (error) {
      console.error('❌ Error in saveSingleTriggerPoint:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  /**
   * Mark POI as processed
   */
  static async markPOIAsProcessed(attractionId: string): Promise<void> {
    try {
      await supabase
        .schema('core')
        .from('attractions')
        .update({ last_processed_at: new Date().toISOString() })
        .eq('id', attractionId)
      
      console.log(`✅ POI marked as processed: ${attractionId}`)
    } catch (error) {
      console.error('❌ Error marking POI as processed:', error)
    }
  }
}
