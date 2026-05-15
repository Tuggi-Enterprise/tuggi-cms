/**
 * Trigger Point Saving Service
 * 
 * Centralized service for saving trigger points to database
 * Consolidates duplicate saving logic from multiple routes
 */

import { getSupabase, getSupabaseService } from '../core/supabase-client'

// Get appropriate Supabase client based on context
// Use service client on server (bypasses RLS), fallback to server client if service key not available
const getSupabaseClient = () => {
  try {
    // Try to get service client (only works on server with service role key)
    return getSupabaseService()
  } catch (error) {
    // Fallback to server client if service key not available (e.g., on client side)
    // This will be used when called from API routes which have service key
    return getSupabase('server')
  }
}

// Simple in-memory lock to prevent concurrent processing of same POI
const processingLocks = new Map<string, Promise<any>>()

export interface TriggerPointSaveData {
  attraction_id: string
  lat: number
  lng: number
  radius_meters?: number
  expected_bearing?: number
  bearing_threshold?: number
  type: 'primary' | 'secondary' | 'fallback' | 'special' | 'testing' | 'geofence' | 'entry' | 'exit' | 'approach' | 'custom'
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
  access?: 'walk' | 'car' | 'both'
  custom_description_id?: string
  // Issue 2.4 — GeoJSON Polygon para TPs do tipo 'geofence'.
  // Requer migração 20260515_add_geofence_trigger_type.sql aplicada.
  geometry_geojson?: string | null
  created_at?: string
  updated_at?: string
}

export interface SaveResult {
  saved: number
  skipped: number
  errors: string[]
  savedIds?: string[]
}

export class TriggerPointSavingService {
  
  /**
   * Prepare trigger point data for database insertion
   */
  static prepareTriggerPointForDB(tp: TriggerPointSaveData): any {
    return {
      attraction_id: tp.attraction_id,
      location: `SRID=4326;POINT(${tp.lng} ${tp.lat})`,
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
      score_factors: tp.score_factors || null,
      generation_method: tp.generation_method,
      validation_notes: tp.validation_notes,
      access: tp.access || 'both',
      custom_description_id: tp.custom_description_id || null,
      // Issue 2.4: persistir o polígono GeoJSON para TPs do tipo 'geofence'
      ...(tp.geometry_geojson ? { geometry_geojson: tp.geometry_geojson } : {}),
      created_at: tp.created_at || new Date().toISOString(),
      updated_at: tp.updated_at || new Date().toISOString()
      // NOTE: created_by and updated_by are NOT included here because
      // the database trigger_auto_create_training_example has a bug that causes
      // "POI not found" errors when these fields are present.
      // The trigger uses NEW.id (trigger point ID) instead of NEW.attraction_id (POI ID)
      // for validation when these user fields are present.
      // TODO: Fix the trigger to use NEW.attraction_id, then re-enable these fields
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
   * Prepare trigger point data for database UPDATE
   * Similar to prepareTriggerPointForDB but excludes fields that shouldn't be updated
   */
  static prepareTriggerPointForUpdate(tp: Partial<TriggerPointSaveData>): any {
    const updateData: any = {
      updated_at: tp.updated_at || new Date().toISOString()
    }

    // Only include fields that are provided
    if (tp.lat != null && tp.lng != null) {
      updateData.location = `SRID=4326;POINT(${tp.lng} ${tp.lat})`
    }
    if (tp.radius_meters != null) updateData.radius_meters = tp.radius_meters
    if (tp.expected_bearing != null) updateData.expected_bearing = tp.expected_bearing
    if (tp.bearing_threshold != null) updateData.bearing_threshold = tp.bearing_threshold
    if (tp.type) updateData.type = tp.type
    if (tp.priority != null) updateData.priority = tp.priority
    if (tp.is_active !== undefined) updateData.is_active = tp.is_active
    if (tp.confidence != null) updateData.confidence_score = tp.confidence
    if (tp.auto_status != null) updateData.auto_status = tp.auto_status
    if (tp.manual_status != null) updateData.manual_status = tp.manual_status
    if (tp.final_status != null) updateData.final_status = tp.final_status
    if (tp.score_factors !== undefined) updateData.score_factors = tp.score_factors
    if (tp.generation_method) updateData.generation_method = tp.generation_method
    if (tp.validation_notes !== undefined) updateData.validation_notes = tp.validation_notes
    if (tp.access) updateData.access = tp.access
    if (tp.custom_description_id !== undefined) updateData.custom_description_id = tp.custom_description_id
    if (tp.updated_by) updateData.updated_by = tp.updated_by
    // Issue 2.4 — permitir update do polígono GeoJSON
    if (tp.geometry_geojson !== undefined) updateData.geometry_geojson = tp.geometry_geojson

    return updateData
  }

  /**
   * Delete trigger points for an attraction
   * @param attractionId - The attraction ID
   * @param triggerPointIds - Optional array of specific TP IDs to delete. If not provided, deletes ALL TPs for the attraction
   * @returns Number of deleted records
   */
  static async deleteTriggerPoints(
    attractionId: string,
    triggerPointIds?: string[]
  ): Promise<{ deleted: number; error?: string }> {
    try {
      const supabase = getSupabaseClient()
      let query = supabase
        .schema('core')
        .from('attraction_trigger_points')
        .delete()
        .eq('attraction_id', attractionId)

      if (triggerPointIds && triggerPointIds.length > 0) {
        query = query.in('id', triggerPointIds)
      }

      const { data, error } = await query.select('id')

      if (error) {
        console.error('❌ Error deleting trigger points:', error)
        return { deleted: 0, error: error.message }
      }

      const deletedCount = data?.length || 0
      console.log(`✅ Deleted ${deletedCount} trigger point(s) for attraction ${attractionId}`)
      return { deleted: deletedCount }
    } catch (error) {
      console.error('❌ Error in deleteTriggerPoints:', error)
      return {
        deleted: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Unified method to save trigger points
   * Supports multiple modes: replace_all, append, replace_single
   */
  static async saveTriggerPoints(
    attractionId: string,
    triggerPoints: TriggerPointSaveData[],
    options: {
      mode: 'replace_all' | 'append' | 'replace_single'
      triggerPointId?: string // For replace_single mode
      boundarySource?: string
    }
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
      // Validate trigger points before proceeding
      const { validateTriggerPoints } = await import('@/lib/services/trigger-points-google/utils/validation')
      const { convertTriggerPointsToDB } = await import('@/lib/services/trigger-points-google/utils/conversion')

      // Convert to TriggerPointForDB format for validation
      const tpsForDB = triggerPoints.map(tp => {
        // Calculate auto_status from confidence if not provided
        let auto_status: 'approved' | 'review' | 'rejected' = 'rejected'
        if (tp.auto_status) {
          const validStatuses: ('approved' | 'review' | 'rejected')[] = ['approved', 'review', 'rejected']
          auto_status = validStatuses.includes(tp.auto_status as any) 
            ? (tp.auto_status as 'approved' | 'review' | 'rejected')
            : 'rejected'
        } else if (tp.confidence != null) {
          // Calculate from confidence if auto_status not provided
          if (tp.confidence >= 0.7) auto_status = 'approved'
          else if (tp.confidence >= 0.4) auto_status = 'review'
          else auto_status = 'rejected'
        }

        // Calculate final_status
        let final_status: 'approved' | 'review' | 'rejected' | 'pending' = 'pending'
        if (tp.final_status) {
          const validFinalStatuses: ('approved' | 'review' | 'rejected' | 'pending')[] = ['approved', 'review', 'rejected', 'pending']
          final_status = validFinalStatuses.includes(tp.final_status as any)
            ? (tp.final_status as 'approved' | 'review' | 'rejected' | 'pending')
            : auto_status
        } else {
          final_status = auto_status
        }

        return {
          lat: tp.lat,
          lng: tp.lng,
          radius_meters: tp.radius_meters || 20,
          expected_bearing: tp.expected_bearing,
          bearing_threshold: tp.bearing_threshold || 30,
          type: tp.type,
          priority: tp.priority || this.getDefaultPriority(tp.type),
          confidence_score: tp.confidence || 0,
          auto_status,
          final_status,
          score_factors: tp.score_factors || null,
          generation_method: tp.generation_method,
          validation_notes: tp.validation_notes,
          access: tp.access || 'both'
        }
      })

      const validation = validateTriggerPoints(tpsForDB)

      if (validation.validItems.length === 0) {
        console.warn('⚠️ No valid trigger points after validation')
        results.skipped = triggerPoints.length
        results.errors.push(...validation.errors.map(e => `${e.field}: ${e.message}`))
        return results
      }

      // Handle different modes
      if (options.mode === 'replace_all') {
        // DELETE all existing TPs for this attraction
        const deleteResult = await this.deleteTriggerPoints(attractionId)
        if (deleteResult.error) {
          results.errors.push(`Failed to delete existing TPs: ${deleteResult.error}`)
          // Continue anyway - try to insert new ones
        }
      } else if (options.mode === 'replace_single') {
        // DELETE specific TP
        if (options.triggerPointId) {
          const deleteResult = await this.deleteTriggerPoints(attractionId, [options.triggerPointId])
          if (deleteResult.error) {
            results.errors.push(`Failed to delete existing TP: ${deleteResult.error}`)
            // Continue anyway
          }
        }
      }
      // For 'append' mode, don't delete anything

      // Prepare valid TPs for insertion
      const tpsForInsert = validation.validItems.map(tp => {
        const originalTP = triggerPoints.find(
          o => o.lat === tp.lat && o.lng === tp.lng && o.type === tp.type
        ) || triggerPoints[0] // Fallback

        return this.prepareTriggerPointForDB({
          ...originalTP,
          attraction_id: attractionId,
          lat: tp.lat,
          lng: tp.lng,
          radius_meters: tp.radius_meters,
          expected_bearing: tp.expected_bearing,
          bearing_threshold: tp.bearing_threshold,
          type: tp.type,
          priority: tp.priority,
          confidence: tp.confidence_score,
          auto_status: tp.auto_status,
          final_status: tp.final_status,
          score_factors: tp.score_factors,
          generation_method: tp.generation_method || originalTP.generation_method,
          validation_notes: tp.validation_notes,
          access: tp.access
        })
      })

      // Before inserting, verify POI exists and has coordinates (required by some triggers)
      const supabase = getSupabaseClient()
      const { data: poiCheck, error: poiCheckError } = await supabase
        .schema('core')
        .from('attractions')
        .select('id')
        .eq('id', attractionId)
        .maybeSingle()

      if (poiCheckError || !poiCheck) {
        console.error('❌ POI not found:', attractionId)
        results.errors.push(`POI not found: ${attractionId}`)
        return results
      }

      // Check if POI has coordinates (some triggers require this)
      const { data: coordCheck } = await supabase
        .schema('core')
        .from('attraction_coordinate')
        .select('id')
        .eq('attraction_id', attractionId)
        .maybeSingle()

      if (!coordCheck) {
        console.warn(`⚠️ POI ${attractionId} has no coordinates. Some database triggers may fail.`)
      }

      // Insert to database
      const { data, error } = await supabase
        .schema('core')
        .from('attraction_trigger_points')
        .insert(tpsForInsert)
        .select('id')

      if (error) {
        console.error('❌ Error inserting trigger points:', error)
        // If error is about POI not found, provide more context
        if (error.message?.includes('POI not found') || error.code === 'P0001') {
          results.errors.push(`Database trigger error: ${error.message}. POI exists: ${!!poiCheck}, Has coordinates: ${!!coordCheck}`)
        } else {
          results.errors.push(error.message)
        }
        return results
      }

      results.saved = data?.length || 0
      results.skipped = triggerPoints.length - results.saved
      results.savedIds = data?.map((d: any) => d.id) || []

      // Only mark POI as processed if we successfully saved TPs
      if (results.saved > 0 && options.mode === 'replace_all') {
        await this.markPOIAsProcessed(attractionId)
      }

      return results
    } catch (error) {
      console.error('❌ Error in saveTriggerPoints:', error)
      results.errors.push(error instanceof Error ? error.message : 'Unknown error')
      return results
    }
  }

  /**
   * Save multiple trigger points (batch operation)
   * Uses the unified saveTriggerPoints() method with replace_all mode
   * Maintains lock to prevent concurrent processing
   */
  static async saveTriggerPointsBatch(
    attractionId: string,
    triggerPoints: any[],
    boundarySource: string
  ): Promise<SaveResult> {
    // Check for concurrent processing lock
    if (processingLocks.has(attractionId)) {
      console.log(`⚠️ POI ${attractionId} is already being processed - waiting for completion`)
      await processingLocks.get(attractionId)
      
      // After waiting, return empty result as the previous process handled it
      return { saved: 0, skipped: triggerPoints.length, errors: [] }
    }

    // Create lock promise for this POI
    const processPromise = this._saveTriggerPointsBatchInternal(attractionId, triggerPoints, boundarySource)
    processingLocks.set(attractionId, processPromise)

    try {
      const result = await processPromise
      return result
    } finally {
      // Clean up lock
      processingLocks.delete(attractionId)
    }
  }

  /**
   * Internal method for saving trigger points (protected by lock)
   * Uses the unified saveTriggerPoints() method
   */
  private static async _saveTriggerPointsBatchInternal(
    attractionId: string,
    triggerPoints: any[],
    boundarySource: string
  ): Promise<SaveResult> {
    if (!attractionId || !triggerPoints || triggerPoints.length === 0) {
      console.log('⚠️ No trigger points to save')
      return { saved: 0, skipped: 0, errors: [] }
    }

    // Convert trigger points to TriggerPointSaveData format
    const tpsForSaving: TriggerPointSaveData[] = triggerPoints.map(tp => ({
      attraction_id: attractionId,
      lat: tp.lat,
      lng: tp.lng,
      radius_meters: tp.radius_meters,
      expected_bearing: tp.expected_bearing,
      bearing_threshold: tp.bearing_threshold,
      type: tp.type,
      priority: tp.priority,
      confidence: tp.individual_confidence_score || tp.confidence,
      auto_status: tp.auto_status,
      final_status: tp.final_status,
      score_factors: tp.score_factors,
      // Issue 1.3 — preservar o método real (local_osm/overpass_fallback) em vez
      // de sempre rotular como google_apis_*. Mantém compatibilidade com TPs
      // antigos que não traziam generation_method.
      generation_method: tp.generation_method || `local_osm_${boundarySource}`,
      validation_notes: tp.reasoning || tp.validation_notes,
      access: tp.access || 'both',
      // Issue 2.4 — preservar polígono para TPs geofence
      geometry_geojson: tp.geometry_geojson ?? null,
    }))

    // Use unified saveTriggerPoints() with replace_all mode
    // This will DELETE all existing TPs and INSERT new ones
    return await this.saveTriggerPoints(attractionId, tpsForSaving, {
      mode: 'replace_all',
      boundarySource
    })
  }

  /**
   * Save a single trigger point (wrapper for append mode)
   */
  static async saveSingle(
    triggerPointData: TriggerPointSaveData,
    options?: { mode?: 'append' | 'replace_single', triggerPointId?: string }
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const mode = options?.mode || 'append'
      const result = await this.saveTriggerPoints(
        triggerPointData.attraction_id,
        [triggerPointData],
        {
          mode,
          triggerPointId: options?.triggerPointId
        }
      )

      if (result.errors.length > 0) {
        return {
          success: false,
          error: result.errors.join('; ')
        }
      }

      if (result.saved === 0) {
        return {
          success: false,
          error: 'No trigger point was saved'
        }
      }

      // Fetch the saved TP by ID (lat/lng don't exist as columns — coordinates live in `location` geography)
      const savedId = result.savedIds?.[0]
      if (!savedId) {
        console.warn('⚠️ Could not retrieve saved trigger point ID, but it was saved successfully')
        return { success: true }
      }

      const supabase = getSupabaseClient()
      const { data: savedTP, error: fetchError } = await supabase
        .schema('core')
        .from('attraction_trigger_points')
        .select()
        .eq('id', savedId)
        .single()

      if (fetchError || !savedTP) {
        console.warn('⚠️ Could not fetch saved trigger point, but it was saved successfully')
        return { success: true }
      }

      console.log('✅ Single trigger point saved successfully:', savedTP.id)
      return { success: true, data: savedTP }
    } catch (error) {
      console.error('❌ Error in saveSingle:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  /**
   * Update a single trigger point
   */
  static async updateSingle(
    triggerPointId: string,
    triggerPointData: Partial<TriggerPointSaveData>
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const updateData = this.prepareTriggerPointForUpdate(triggerPointData)

      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .schema('core')
        .from('attraction_trigger_points')
        .update(updateData)
        .eq('id', triggerPointId)
        .select()
        .single()

      if (error) {
        console.error('❌ Error updating trigger point:', error)
        return { success: false, error: error.message }
      }

      console.log('✅ Trigger point updated successfully:', data.id)
      return { success: true, data }
    } catch (error) {
      console.error('❌ Error in updateSingle:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  /**
   * @deprecated Use saveSingle() instead
   * Save a single trigger point (for manual creation)
   */
  static async saveSingleTriggerPoint(triggerPointData: TriggerPointSaveData): Promise<{ success: boolean; data?: any; error?: string }> {
    return this.saveSingle(triggerPointData, { mode: 'append' })
  }

  /**
   * Mark POI as processed
   */
  static async markPOIAsProcessed(attractionId: string): Promise<void> {
    try {
      const supabase = getSupabaseClient()
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
