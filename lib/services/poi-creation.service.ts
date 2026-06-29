/**
 * POI Creation Service
 * 
 * Centralized service for creating POIs with coordinates atomically
 * Single Source of Truth for POI creation logic
 * 
 * Features:
 * - Atomic creation of attraction + coordinate
 * - Uses database RPC functions for safety
 * - Prevents race conditions
 * - Consistent error handling
 */

import { getSupabase } from '@/lib/core/supabase-client'
import { validateCoordinates } from '@/lib/utils/coordinate-validation'
import { normalizeLocation } from '@/lib/shared/location-normalize'

// Use service role client to bypass RLS for POI creation
const supabase = getSupabase('service')

export interface CreatePOIData {
  name: string
  city: string
  state?: string | null | undefined
  country: string
  formatted_address?: string | null | undefined
  latitude: number
  longitude: number
  import_source?: string
  source_type?: string
  additionalFields?: Record<string, any>
}

export interface CreatePOIResult {
  success: boolean
  attraction_id?: string
  coordinate_id?: string
  error?: string
  details?: string
}

export class POICreationService {
  /**
   * Create POI with coordinates atomically
   * Uses database RPC function to ensure atomicity and prevent duplicates
   */
  static async createPOIWithCoordinates(data: CreatePOIData): Promise<CreatePOIResult> {
    try {
      // Canonicalise country/state (SSOT) — the upstream reverse-geocode returns
      // raw Nominatim values (local names, "X Province" suffixes).
      const loc = normalizeLocation(data.country, data.state, data.city)

      // Step 1: Create attraction
      const { data: attraction, error: attractionError } = await supabase
        .schema('core')
        .from('attractions')
        .insert({
          name: data.name.trim(),
          city: data.city,
          state: loc.state,
          country: loc.country ?? data.country,
          formatted_address: data.formatted_address || null,
          import_source: data.import_source || 'manual',
          source_type: data.source_type || 'manual',
          approved: false,
          processing_status: 'pending',
          ...data.additionalFields
        })
        .select('id')
        .single()

      if (attractionError || !attraction) {
        console.error('❌ Error creating attraction:', attractionError)
        return {
          success: false,
          error: 'Failed to create attraction',
          details: attractionError?.message || 'Unknown error'
        }
      }

      const attractionId = attraction.id
      console.log(`✅ Attraction created with ID: ${attractionId}`)

      // Step 2: Create coordinate using safe RPC function (prevents duplicates, atomic)
      // For manual creation, always show in map
      const { data: coordinateId, error: coordinateError } = await supabase
        .schema('core')
        .rpc('insert_coordinate_safe', {
          p_attraction_id: attractionId,
          p_latitude: data.latitude,
          p_longitude: data.longitude,
          p_show_in_map: true
        })

      if (coordinateError) {
        console.error('❌ Error creating coordinate:', coordinateError)
        // Cleanup attraction if coordinate creation fails
        await supabase
          .schema('core')
          .from('attractions')
          .delete()
          .eq('id', attractionId)
        
        return {
          success: false,
          error: 'Failed to create coordinate',
          details: coordinateError.message
        }
      }

      console.log(`✅ Coordinate created/updated for attraction: ${attractionId}`)

      return {
        success: true,
        attraction_id: attractionId,
        coordinate_id: coordinateId as string
      }

    } catch (error) {
      console.error('❌ Error in POI creation service:', error)
      return {
        success: false,
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Validate POI creation data
   * Uses centralized coordinate validation utility
   */
  static validateCreateData(data: CreatePOIData): { valid: boolean; error?: string } {
    if (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0) {
      return { valid: false, error: 'Name is required and must be a non-empty string' }
    }

    if (!data.city || typeof data.city !== 'string' || data.city.trim().length === 0) {
      return { valid: false, error: 'City is required and must be a non-empty string' }
    }

    if (!data.country || typeof data.country !== 'string' || data.country.trim().length === 0) {
      return { valid: false, error: 'Country is required and must be a non-empty string' }
    }

    // Use centralized coordinate validation
    const coordValidation = validateCoordinates(data.latitude, data.longitude)
    if (!coordValidation.valid) {
      return { valid: false, error: coordValidation.error }
    }

    return { valid: true }
  }
}

