/**
 * Migration Service - Migrate POIs from homolog to core
 * 
 * Handles migration of POIs and coordinates from homolog.pois/homolog.coordinates
 * to core.attractions/core.attraction_coordinate
 */

import { getSupabase } from '@/lib/core/supabase-client'
import { classify, importanceScore, isNotable, priorityLevel } from '@/lib/shared/poi-taxonomy'

const supabase = getSupabase('service')

export interface MigrationResult {
  success: boolean
  attraction_id?: string
  error?: string
  warnings?: string[]
  migrated_fields?: string[]
}

export interface DuplicateCheckResult {
  is_duplicate: boolean
  duplicate_type?: 'uuid' | 'osm' | 'coordinates'
  existing_id?: string
  message?: string
}

export class MigrationService {
  /**
   * Validate coordinates
   * @deprecated Use validateCoordinates from lib/utils/coordinate-validation instead
   * Kept for backward compatibility
   */
  static validateCoordinates(latitude: number, longitude: number): { valid: boolean; error?: string } {
    const { validateCoordinates } = require('../utils/coordinate-validation')
    return validateCoordinates(latitude, longitude)
  }

  /**
   * Load POI with coordinates from core (SSOT)
   */
  static async loadPOIWithCoordinates(attraction_id: string): Promise<{
    success: boolean
    data?: { poi: any; coordinate: { latitude: number; longitude: number } }
    error?: string
  }> {
    try {
      // Load POI
      const { data: poi, error: poiError } = await supabase
        .schema('core')
        .from('attractions')
        .select('id, name, city, state, country, category, osm_id, osm_type, estimated_height_m, osm_tags')
        .eq('id', attraction_id)
        .maybeSingle()

      if (poiError || !poi) {
        return {
          success: false,
          error: poiError?.message || 'POI not found'
        }
      }

      // Load coordinates
      const { data: coordinate, error: coordError } = await supabase
        .schema('core')
        .from('attraction_coordinate')
        .select('latitude, longitude')
        .eq('attraction_id', attraction_id)
        .maybeSingle()

      if (coordError || !coordinate) {
        return {
          success: false,
          error: coordError?.message || 'Coordinates not found'
        }
      }

      // Validate coordinates
      const coordValidation = this.validateCoordinates(coordinate.latitude, coordinate.longitude)
      if (!coordValidation.valid) {
        return {
          success: false,
          error: coordValidation.error
        }
      }

      return {
        success: true,
        data: { poi, coordinate }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error loading POI'
      }
    }
  }

  /**
   * Check for duplicates before migration
   * Single round-trip: combines UUID + (osm_id, osm_type) checks into one OR query.
   */
  static async checkDuplicates(
    uuid_id: string,
    osm_id: bigint | null,
    osm_type: string | null,
    latitude: number,
    longitude: number
  ): Promise<DuplicateCheckResult> {
    try {
      let query = supabase
        .schema('core')
        .from('attractions')
        .select('id, osm_id, osm_type')

      if (osm_id && osm_type) {
        query = query.or(`id.eq.${uuid_id},and(osm_id.eq.${osm_id.toString()},osm_type.eq.${osm_type})`)
      } else {
        query = query.eq('id', uuid_id)
      }

      const { data: matches } = await query.limit(2)

      if (matches && matches.length > 0) {
        // Priority: UUID match first (original behavior).
        const byUuid = matches.find(m => m.id === uuid_id)
        if (byUuid) {
          return {
            is_duplicate: true,
            duplicate_type: 'uuid',
            existing_id: byUuid.id,
            message: `POI with UUID ${uuid_id} already exists in core.attractions`
          }
        }
        const byOsm = matches[0]
        return {
          is_duplicate: true,
          duplicate_type: 'osm',
          existing_id: byOsm.id,
          message: `POI with OSM ID ${osm_id} (${osm_type}) already exists in core.attractions`
        }
      }

      // Coordinate-duplicate check was intentionally removed: similar coords are allowed
      // because the cleanup step at the end of the pipeline handles them after approval.

      return {
        is_duplicate: false
      }
    } catch (error) {
      console.error('Error checking duplicates:', error)
      // Don't fail on duplicate check errors, just log
      return {
        is_duplicate: false
      }
    }
  }

  /**
   * Convert field types from homolog to core format
   */
  static convertFieldValue(field: string, value: any): any {
    if (value === null || value === undefined) {
      return null
    }

    // TEXT → TEXT[] conversions
    const textArrayFields = ['local_traditions', 'seasonal_attractions', 'public_transport', 'access_points']
    if (textArrayFields.includes(field)) {
      if (typeof value === 'string') {
        // Try to parse as JSON array first
        try {
          const parsed = JSON.parse(value)
          if (Array.isArray(parsed)) {
            return parsed
          }
        } catch {
          // Not JSON, split by comma or semicolon
          return value.split(/[,;]/).map((s: string) => s.trim()).filter((s: string) => s.length > 0)
        }
      }
      return Array.isArray(value) ? value : [value]
    }

    // TEXT → JSONB (opening_hours)
    if (field === 'opening_hours') {
      if (typeof value === 'string') {
        try {
          return JSON.parse(value)
        } catch {
          // If not valid JSON, return as is (will be stored as text in JSONB)
          return value
        }
      }
      return value
    }

    // JSONB → TEXT[] (categories → google_types)
    if (field === 'google_types' && value) {
      if (typeof value === 'object') {
        if (Array.isArray(value)) {
          return value.map((v: any) => String(v))
        }
        // If it's an object, extract values
        return Object.values(value).map((v: any) => String(v))
      }
      return [String(value)]
    }

    // TEXT → BOOLEAN conversions
    const booleanFields = ['wheelchair_accessible', 'wheelchair_toilets']
    if (booleanFields.includes(field)) {
      if (typeof value === 'boolean') {
        return value
      }
      if (typeof value === 'string') {
        const lower = value.toLowerCase()
        return lower === 'yes' || lower === 'true' || lower === '1'
      }
      return Boolean(value)
    }

    // TEXT → DATE (unesco_inscription_date)
    if (field === 'unesco_inscription_date' && typeof value === 'string') {
      // Try to parse as date
      const date = new Date(value)
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0] // Return as YYYY-MM-DD
      }
      return value // Return as text if not parseable
    }

    // NUMERIC → DOUBLE PRECISION (already compatible, just return)
    return value
  }

  /**
   * Convert TEXT to BOOLEAN for specific fields
   */
  static convertTextToBoolean(value: any): boolean | null {
    if (value === null || value === undefined) {
      return null
    }
    if (typeof value === 'boolean') {
      return value
    }
    if (typeof value === 'string') {
      const lower = value.toLowerCase().trim()
      return lower === 'yes' || lower === 'true' || lower === '1' || lower === 'sim'
    }
    return Boolean(value)
  }

  /**
   * Map POI data from homolog to core format
   */
  static mapHomologToCore(poi: any, coord: any): any {
    const mapped: any = {
      // Use same UUID from homolog
      id: poi.uuid_id,
      
      // Basic fields (direct mapping)
      name: poi.name,
      city: poi.city,
      state: poi.state,
      country: poi.country || 'Brazil',
      formatted_address: poi.formatted_address,
      website: poi.website,
      approved: false, // Start as not approved
      
      // OSM fields - Convert BIGINT to TEXT
      osm_id: poi.osm_id?.toString() || null,
      osm_type: poi.osm_type,
      place_id: poi.place_id,
      importance: poi.importance,
      osm_category: poi.category || poi.primary_category,
      osm_tags: poi.osm_properties, // JSONB to JSONB
      
      // Processing metadata
      source_file: poi.source_file,
      source_type: poi.source_type || 'osm',
      is_complete: poi.is_complete || false,
      has_nominatim_data: poi.has_nominatim_data || false,
      processing_status: 'migrated',
      
      // Address fields
      description: poi.description,
      neighborhood: poi.neighborhood,
      street_name: poi.street_name,
      house_number: poi.house_number,
      postal_code: poi.postal_code,
      
      // Category fields
      primary_category: poi.primary_category,
      primary_category_type: poi.primary_category_type,
      
      // Contact fields
      contact_phone: poi.contact_phone,
      contact_email: poi.contact_email,
      operator_name: poi.operator_name,
      
      // Brand fields
      brand: poi.brand,
      brand_wikidata: poi.brand_wikidata,
      brand_wikipedia: poi.brand_wikipedia,
      
      // Internet fields
      internet_access: poi.internet_access,
      internet_access_fee: poi.internet_access_fee,
      
      // Accessibility
      accessibility_notes: poi.accessibility_notes,
      
      // Dates
      start_date: poi.start_date,
      
      // Museum fields - Map to core field names
      collection_focus: poi.museum_collection,
      target_audience: poi.museum_audience,
      educational_programs: this.convertTextToBoolean(poi.museum_education),
      
      // Park/Natural fields - Convert TEXT to BOOLEAN
      water_features: this.convertTextToBoolean(poi.natural_water),
      entrance_fee: poi.entrance_fee,
      
      // Height - Convert NUMERIC(8,2) to NUMERIC(6,2) with validation
      estimated_height_m: poi.height && parseFloat(String(poi.height)) <= 9999.99 
        ? parseFloat(String(poi.height)) 
        : null,
      
      // Architectural and heritage fields
      architectural_style: poi.architectural_style,
      historical_period: poi.historic_period,
      landmark_type: poi.landmark_type,
      architect: poi.architect,
      construction_status: poi.construction_status,
      heritage_status: poi.heritage_status,
      unesco_status: poi.unesco_status,
      unesco_inscription_date: poi.unesco_inscription_date,
      unesco_reference: poi.unesco_reference,
      landmark_level: poi.landmark_level,
      importance_level: poi.importance_level,
      
      // Boolean flags
      is_historic: poi.is_historic || false,
      is_touristic: poi.is_touristic || false,
      has_train: poi.has_train || false,
      has_ferry: poi.has_ferry || false,
      has_bus: poi.has_bus || false,
      has_fishing: poi.has_fishing || false,
      is_building: poi.is_building || false,
      has_ruins: poi.has_ruins || false,
      
      // Wikidata/Wikipedia
      wikidata: poi.wikidata,
      wikipedia: poi.wikipedia,
      
      // OSM raw fields (all the tags)
      amenity: poi.amenity,
      building: poi.building,
      artwork_type: poi.artwork_type,
      information: poi.information,
      source: poi.source,
      landuse: poi.landuse,
      access: poi.access,
      ref: poi.ref,
      type: poi.type,
      contact_phone_alt: poi.contact_phone_alt,
      contact_mobile: poi.contact_mobile,
      contact_website_alt: poi.contact_website_alt,
      contact_email_alt: poi.contact_email_alt,
      contact_facebook: poi.contact_facebook,
      contact_instagram: poi.contact_instagram,
      contact_whatsapp: poi.contact_whatsapp,
      contact_twitter: poi.contact_twitter,
      contact_youtube: poi.contact_youtube,
      fee: poi.fee,
      payment_credit_cards: poi.payment_credit_cards,
      payment_cash: poi.payment_cash,
      payment_visa: poi.payment_visa,
      payment_mastercard: poi.payment_mastercard,
      rooms: poi.rooms,
      air_conditioning: poi.air_conditioning,
      smoking: poi.smoking,
      capacity: poi.capacity,
      pets_allowed: poi.pets_allowed,
      surface: poi.surface,
      waterway: poi.waterway,
      power: poi.power,
      lanes: poi.lanes,
      maxspeed: poi.maxspeed,
      intermittent: poi.intermittent,
      layer: poi.layer,
      leisure: poi.leisure,
      lit: poi.lit,
      service: poi.service,
      barrier: poi.barrier,
      alt_name: poi.alt_name,
      tunnel: poi.tunnel,
      bus: poi.bus,
      place: poi.place,
      man_made: poi.man_made,
      source_name: poi.source_name,
      trees: poi.trees,
      shop: poi.shop,
    }

    // Convert fields that need type conversion
    const fieldsToConvert = [
      'local_traditions', 'seasonal_attractions', 'public_transport', 'access_points',
      'opening_hours', 'google_types', 'wheelchair_accessible', 'wheelchair_toilets',
      'unesco_inscription_date'
    ]

    for (const field of fieldsToConvert) {
      if (poi[field] !== undefined && poi[field] !== null) {
        mapped[field] = this.convertFieldValue(field, poi[field])
      }
    }

    // Handle categories → google_types conversion
    if (poi.categories) {
      mapped.google_types = this.convertFieldValue('google_types', poi.categories)
    }

    // Canonical taxonomy (SSOT) — derive primary_category + macro group + importance.
    // Keeps new imports clean so they never reproduce the bare-key / null-category problem.
    const taxIn = {
      osm_category: poi.category ?? poi.primary_category ?? null,
      amenity: poi.amenity, leisure: poi.leisure, natural_water: poi.natural_water,
      waterway: poi.waterway, man_made: poi.man_made, building: poi.building,
      place: poi.place, landuse: poi.landuse, shop: poi.shop,
      park_type: poi.park_type, monument_type: poi.monument_type, artwork_type: poi.artwork_type,
      information: poi.information, type: poi.type,
      osm_tags: poi.osm_properties,
      name: poi.name,
      is_historic: poi.is_historic, is_touristic: poi.is_touristic,
      wikidata: poi.wikidata, wikipedia: poi.wikipedia,
      heritage_status: poi.heritage_status, unesco_status: poi.unesco_status,
      importance_level: poi.importance_level, landmark_level: poi.landmark_level,
    }
    // New taxonomy goes to primary_category/category_group only. We do NOT set
    // the legacy `category` column — the app reads it and keys business rules on
    // specific values (e.g. 'geofence'); keep it decoupled from the taxonomy.
    const cls = classify(taxIn)
    mapped.importance_score = importanceScore(taxIn)
    mapped.is_notable = isNotable(taxIn)
    mapped.category_confidence = cls.confidence   // 'high' | 'low' — same SSOT as the backfill
    // Nível 1/2/3 (filtro app + prioridade de disparo) — novos imports já nascem com o nível.
    mapped.priority_level = priorityLevel(cls.primary_category, taxIn)
    if (cls.excluded) {
      mapped.primary_category = '_excluded_street'
      mapped.category_group = null
    } else if (cls.primary_category) {
      mapped.primary_category = cls.primary_category
      mapped.category_group = cls.category_group
    }

    return mapped
  }

  /**
   * Migrate a single POI from homolog to core
   */
  static async migratePOI(uuid_id: string): Promise<MigrationResult> {
    const warnings: string[] = []
    const migrated_fields: string[] = []
    let finalPOI: { id: string } | null = null
    let wasCreated = false

    try {
      // 1. Fetch POI from homolog
      const { data: poi, error: poiError } = await supabase
        .schema('homolog')
        .from('pois')
        .select('*')
        .eq('uuid_id', uuid_id)
        .single()

      if (poiError || !poi) {
        return {
          success: false,
          error: `POI not found in homolog: ${poiError?.message || 'Unknown error'}`
        }
      }

      // 2. Fetch coordinates from homolog
      const { data: coord, error: coordError } = await supabase
        .schema('homolog')
        .from('coordinates')
        .select('*')
        .eq('poi_uuid_id', uuid_id)
        .single()

      if (coordError || !coord) {
        return {
          success: false,
          error: `Coordinates not found for POI: ${coordError?.message || 'Unknown error'}`
        }
      }

      // 3. Validate required fields
      if (!poi.name || poi.name.trim() === '') {
        return {
          success: false,
          error: 'POI name is required and cannot be empty'
        }
      }

      if (!poi.city || poi.city.trim() === '') {
        return {
          success: false,
          error: 'POI city is required and cannot be empty'
        }
      }

      if (!coord.latitude || !coord.longitude) {
        return {
          success: false,
          error: 'POI coordinates are required'
        }
      }

      // Validate coordinate ranges (using centralized function)
      const coordValidation = this.validateCoordinates(coord.latitude, coord.longitude)
      if (!coordValidation.valid) {
        return {
          success: false,
          error: coordValidation.error || 'Invalid coordinates'
        }
      }

      // 4. Check for duplicates (only by UUID and OSM ID - coordinates are allowed to be similar)
      const duplicateCheck = await this.checkDuplicates(
        uuid_id,
        poi.osm_id,
        poi.osm_type,
        coord.latitude,
        coord.longitude
      )

      // Only block if UUID or OSM ID duplicate (same POI)
      // Coordinate duplicates are allowed - we'll remove the existing POI
      if (duplicateCheck.is_duplicate && duplicateCheck.duplicate_type !== 'coordinates') {
        // Self-healing: If exact duplicate exists in core, verify it matches our ID/OSM ID and clean up homolog
        console.log(`♻️ Self-healing: POI ${uuid_id} already exists in core (${duplicateCheck.duplicate_type}). Removing from homolog...`)
        
        // Skip archiving for deduplication
        await supabase.schema('core').rpc('set_session_setting', { p_name: 'tuggi.skip_archive', p_value: 'true' })

        // Delete from homolog (coordinates first, then POI) to resolve the "ghost" duplicate
        await supabase.schema('homolog').from('coordinates').delete().eq('poi_uuid_id', uuid_id)
        await supabase.schema('homolog').from('pois').delete().eq('uuid_id', uuid_id)

        // Reset skip archiving
        await supabase.schema('core').rpc('set_session_setting', { p_name: 'tuggi.skip_archive', p_value: 'false' })

        return {
          success: true,
          attraction_id: duplicateCheck.existing_id,
          migrated_fields: ['(Self-healed duplicate)'],
          warnings: [`Duplicate resolved: POI already existed in core and was removed from homolog (Type: ${duplicateCheck.duplicate_type})`]
        }
      }

      // NOTE: We don't remove duplicate POIs during migration
      // This will be done at the end of the pipeline after approval
      // to ensure we only remove duplicates if the new POI is successfully processed

      // 4.5. Try to acquire lock atomically (prevents race conditions)
      // Use INSERT ... ON CONFLICT to handle both creation and lock acquisition atomically
      const lockUserId = 'migration-service'
      const lockTimestamp = new Date().toISOString()
      
      // 5. Map homolog data to core format
      const mappedPOI = this.mapHomologToCore(poi, coord)
      migrated_fields.push(...Object.keys(mappedPOI).filter(k => mappedPOI[k] !== null && mappedPOI[k] !== undefined))
      
      // Set lock fields
      mappedPOI.processing_lock_by = lockUserId
      mappedPOI.processing_lock_at = lockTimestamp

      // 6. Try to create POI atomically with lock
      // If POI already exists, check if we can acquire lock
      const { data: existingPOI } = await supabase
        .schema('core')
        .from('attractions')
        .select('id, processing_lock_by, processing_lock_at')
        .eq('id', uuid_id)
        .maybeSingle()

      // finalPOI defined at top scope


      if (existingPOI) {
        // POI already exists - check lock
        if (existingPOI.processing_lock_by && existingPOI.processing_lock_at) {
          const lockTime = new Date(existingPOI.processing_lock_at)
          const now = new Date()
          const lockAge = now.getTime() - lockTime.getTime()
          const lockTimeout = 10 * 60 * 1000 // 10 minutes

          // If lock is still valid, skip
          if (lockAge < lockTimeout) {
            return {
              success: false,
              error: `POI is currently being processed by another process (locked at ${existingPOI.processing_lock_at})`
            }
          }
          // Lock expired - try to acquire lock atomically
          const { data: lockAcquired, error: lockError } = await supabase
            .schema('core')
            .from('attractions')
            .update({
              processing_lock_by: lockUserId,
              processing_lock_at: lockTimestamp
            })
            .eq('id', uuid_id)
            .eq('processing_lock_by', existingPOI.processing_lock_by) // Only update if lock hasn't changed
            .select('id')
            .maybeSingle()

          if (lockError || !lockAcquired) {
            // Another process acquired the lock, or error occurred
            return {
              success: false,
              error: `Failed to acquire lock: POI may be locked by another process`
            }
          }
        } else {
          // POI exists but no lock - this is a duplicate (already migrated)
          return {
            success: false,
            error: `POI with UUID ${uuid_id} already exists in core.attractions`
          }
        }
      } else {
        // POI doesn't exist - create with lock atomically
        // This INSERT is atomic and will fail if another process creates it first
        const { data: createdPOI, error: createError } = await supabase
          .schema('core')
          .from('attractions')
          .insert(mappedPOI)
          .select('id')
          .single()

        if (createError) {
          // If it's a duplicate key error, it means UUID already exists (race condition)
          if (createError.code === '23505') {
            return {
              success: false,
              error: `POI with UUID ${uuid_id} already exists in core.attractions (created by another process)`
            }
          }
          return {
            success: false,
            error: `Failed to create POI in core: ${createError.message}`
          }
        }

        if (!createdPOI) {
          return {
            success: false,
            error: 'Failed to create POI: No data returned'
          }
        }

        // Use createdPOI for rest of the function
        finalPOI = createdPOI
        wasCreated = true
      }

      // If we got here and existingPOI exists, we acquired the lock
      // If existingPOI doesn't exist, we created finalPOI above
      if (!finalPOI && existingPOI) {
        finalPOI = { id: existingPOI.id }
      }

      if (!finalPOI) {
        return {
          success: false,
          error: 'Failed to create or acquire lock for POI'
        }
      }

      // 8. Create coordinate in core.attraction_coordinate
      // First check if coordinate already exists (UNIQUE constraint on attraction_id)
      const { data: existingCoord } = await supabase
        .schema('core')
        .from('attraction_coordinate')
        .select('id')
        .eq('attraction_id', finalPOI.id)
        .maybeSingle()

      const mappedCoord: any = {
        attraction_id: finalPOI.id,
        latitude: coord.latitude,
        longitude: coord.longitude,
        elevation_m: coord.elevation_m,
        boundary_type: coord.boundary_type,
        boundary_source: coord.boundary_source,
        boundary_confidence: coord.boundary_confidence,
        boundary_area_m2: coord.boundary_area_m2,
        boundary_centroid_lat: coord.boundary_centroid_lat,
        boundary_centroid_lng: coord.boundary_centroid_lng,
        boundary_geometry: coord.boundary_geometry,
        show_in_map: coord.show_in_map !== false, // Default to true
        created_at: coord.created_at || new Date().toISOString(),
        updated_at: coord.updated_at || new Date().toISOString()
      }

      let createdCoord
      let coordCreateError

      if (existingCoord) {
        // Update existing coordinate
        const { data: updatedCoord, error: updateError } = await supabase
          .schema('core')
          .from('attraction_coordinate')
          .update(mappedCoord)
          .eq('id', existingCoord.id)
          .select('id')
          .single()

        createdCoord = updatedCoord
        coordCreateError = updateError
      } else {
        // Insert new coordinate
        const { data: insertedCoord, error: insertError } = await supabase
          .schema('core')
          .from('attraction_coordinate')
          .insert(mappedCoord)
          .select('id')
          .single()

        createdCoord = insertedCoord
        coordCreateError = insertError
      }

      if (coordCreateError) {
        // Rollback: delete the POI we just created
        // Skip archiving for rollback
        await supabase.schema('core').rpc('set_session_setting', { p_name: 'tuggi.skip_archive', p_value: 'true' })

        await supabase
          .schema('core')
          .from('attractions')
          .delete()
          .eq('id', finalPOI.id)

        // Reset skip archiving
        await supabase.schema('core').rpc('set_session_setting', { p_name: 'tuggi.skip_archive', p_value: 'false' })

        return {
          success: false,
          error: `Failed to create/update coordinate: ${coordCreateError.message}`
        }
      }

      // 9. Delete from homolog after successful migration
      // Skip archiving for successful migration (it now lives in core)
      await supabase.schema('core').rpc('set_session_setting', { p_name: 'tuggi.skip_archive', p_value: 'true' })

      // First delete coordinates (to avoid FK issues if cascade is missing)
      await supabase
        .schema('homolog')
        .from('coordinates')
        .delete()
        .eq('poi_uuid_id', uuid_id)

      // Then delete the POI itself
      await supabase
        .schema('homolog')
        .from('pois')
        .delete()
        .eq('uuid_id', uuid_id)

      // Reset skip archiving
      await supabase.schema('core').rpc('set_session_setting', { p_name: 'tuggi.skip_archive', p_value: 'false' })

      // 9. Release lock
      await supabase
        .schema('core')
        .from('attractions')
        .update({
          processing_lock_by: null,
          processing_lock_at: null
        })
        .eq('id', finalPOI.id)

      return {
        success: true,
        attraction_id: finalPOI.id,
        warnings: warnings.length > 0 ? warnings : undefined,
        migrated_fields
      }
    } catch (error) {
      console.error('Migration error:', error)
      
      // Release lock OR Rollback on error
      try {
        if (wasCreated) {
           console.log(`⚠️ Rolling back: Deleting created POI ${uuid_id} from core due to error`)
           await this.rollbackMigration(uuid_id)
        } else {
           await supabase
            .schema('core')
            .from('attractions')
            .update({
              processing_lock_by: null,
              processing_lock_at: null
            })
            .eq('id', uuid_id)
        }
      } catch (lockError) {
        console.error('Failed to release lock on error:', lockError)
      }
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during migration'
      }
    }
  }

  /**
   * Rollback migration: Remove POI from core in case of error
   * This deletes the attraction, which cascades to:
   * - attraction_coordinate
   * - attraction_descriptions
   * - attraction_trigger_points
   * - attraction_images
   * - etc.
   */
  static async rollbackMigration(attraction_id: string): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`🔄 Rolling back migration for attraction: ${attraction_id}`)
      
      // Skip archiving for rollback
      await supabase.schema('core').rpc('set_session_setting', { p_name: 'tuggi.skip_archive', p_value: 'true' })

      const { error } = await supabase
        .schema('core')
        .from('attractions')
        .delete()
        .eq('id', attraction_id)
      
      // Reset skip archiving
      await supabase.schema('core').rpc('set_session_setting', { p_name: 'tuggi.skip_archive', p_value: 'false' })

      if (error) {
        console.error('❌ Rollback error:', error)
        return {
          success: false,
          error: `Failed to rollback migration: ${error.message}`
        }
      }

      console.log(`✅ Rollback successful for attraction: ${attraction_id}`)
      return { success: true }
    } catch (error) {
      console.error('❌ Rollback exception:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during rollback'
      }
    }
  }

  /**
   * Safely delete POI from homolog (only after successful approval)
   * Does NOT add to blacklist - POIs migrated successfully don't need blacklist
   */
  static async safeDeleteFromHomolog(uuid_id: string): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`🗑️  Safely deleting POI from homolog: ${uuid_id}`)
      
      // Verify POI is approved in core before deleting from homolog
      const { data: corePOI } = await supabase
        .schema('core')
        .from('attractions')
        .select('id, approved')
        .eq('id', uuid_id)
        .single()

      if (!corePOI) {
        return {
          success: false,
          error: `POI ${uuid_id} not found in core.attractions`
        }
      }

      /* 
      // Comentado para permitir self-healing de migrações interrompidas
      if (!corePOI.approved) {
        return {
          success: false,
          error: `POI ${uuid_id} is not approved in core. Cannot delete from homolog.`
        }
      }
      */

      // Delete from homolog.coordinates (cascade will handle it, but we can be explicit)
      // Actually, coordinates has foreign key with CASCADE, so deleting pois will delete coordinates
      // But let's delete coordinates first to be safe
      
      // Skip archiving for safe delete
      await supabase.schema('core').rpc('set_session_setting', { p_name: 'tuggi.skip_archive', p_value: 'true' })

      const { error: coordError } = await supabase
        .schema('homolog')
        .from('coordinates')
        .delete()
        .eq('poi_uuid_id', uuid_id)

      if (coordError) {
        console.warn('⚠️  Error deleting coordinates (may not exist):', coordError.message)
        // Continue anyway - coordinates might not exist
      }

      // Delete from homolog.pois
      const { error: poiError } = await supabase
        .schema('homolog')
        .from('pois')
        .delete()
        .eq('uuid_id', uuid_id)

      // Reset skip archiving
      await supabase.schema('core').rpc('set_session_setting', { p_name: 'tuggi.skip_archive', p_value: 'false' })

      if (poiError) {
        return {
          success: false,
          error: `Failed to delete POI from homolog: ${poiError.message}`
        }
      }

      console.log(`✅ Successfully deleted POI from homolog: ${uuid_id}`)
      return { success: true }
    } catch (error) {
      console.error('❌ Error deleting from homolog:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error deleting from homolog'
      }
    }
  }

  /**
   * Check if POI should be processed
   * Returns true if POI should be processed, false if it should be skipped
   */
  static async shouldProcessPOI(uuid_id: string): Promise<{ should_process: boolean; reason?: string }> {
    try {
      // 1. Check if UUID already exists in core (already migrated)
      const { data: existingInCore } = await supabase
        .schema('core')
        .from('attractions')
        .select('id, approved')
        .eq('id', uuid_id)
        .maybeSingle()
      if (existingInCore) {
        if (existingInCore.approved) {
          // Self-healing: Se já está aprovado no core, limpa do homolog e pula
          console.log(`♻️  Self-healing: POI ${uuid_id} already approved in core. Cleaning up homolog...`)
          await this.safeDeleteFromHomolog(uuid_id)
          
          return {
            should_process: false,
            reason: 'POI already exists and is approved in core.attractions'
          }
        }

        // Se existe no core mas NÃO está aprovado, permite retomar o processamento
        // Isso garante que trigger points e outras etapas sejam finalizadas
        console.log(`🔄 Partial migration found for ${uuid_id}: resuming pipeline...`)
        return {
          should_process: true,
          reason: 'Partial migration found: exists in core but not approved. Resuming pipeline.'
        }
      }

      // 2. Check processing status in homolog
      const { data: poi } = await supabase
        .schema('homolog')
        .from('pois')
        .select('processing_status, migration_attempts, last_migration_attempt_at')
        .eq('uuid_id', uuid_id)
        .maybeSingle()

      if (!poi) {
        return {
          should_process: false,
          reason: 'POI not found in homolog.pois'
        }
      }

      // 3. Check if already migrated
      if (poi.processing_status === 'migrated') {
        return {
          should_process: false,
          reason: 'POI marked as migrated in homolog'
        }
      }

      // 4. Check if skipped
      if (poi.processing_status === 'skipped') {
        return {
          should_process: false,
          reason: 'POI marked as skipped'
        }
      }

      // 5. Check if failed with too many attempts
      if (poi.processing_status === 'failed' && (poi.migration_attempts || 0) >= 3) {
        return {
          should_process: false,
          reason: 'POI failed migration 3+ times (permanent failure)'
        }
      }

      // 6. Check if processing (locked)
      if (poi.processing_status === 'processing') {
        const lockTime = poi.last_migration_attempt_at ? new Date(poi.last_migration_attempt_at) : null
        if (lockTime) {
          const now = new Date()
          const lockAge = now.getTime() - lockTime.getTime()
          const lockTimeout = 10 * 60 * 1000 // 10 minutes

          // If lock is still valid (less than 10 minutes old), skip
          if (lockAge < lockTimeout) {
            return {
              should_process: false,
              reason: `POI is currently being processed (locked at ${poi.last_migration_attempt_at})`
            }
          }
          // Lock expired, can reprocess
        }
      }

      // 7. Should process (pending or processing with expired lock)
      return {
        should_process: true
      }
    } catch (error) {
      console.error('Error checking if should process POI:', error)
      // On error, allow processing (fail open)
      return {
        should_process: true,
        reason: 'Error checking status, allowing processing'
      }
    }
  }

  /**
   * BATCH version de `shouldProcessPOI` — 2 queries totais em vez de 2×N.
   * Mesma lógica funcional; pula side-effect de self-healing (delete from
   * homolog) pra manter idempotência da chamada batch. Self-healing acontece
   * naturalmente quando o POI for processado individualmente depois.
   *
   * Returns: Map<uuid_id, ShouldProcessResult> com mesma semântica de shouldProcessPOI.
   */
  static async shouldProcessPOIBatch(
    uuid_ids: string[]
  ): Promise<Map<string, { should_process: boolean; reason?: string }>> {
    const results = new Map<string, { should_process: boolean; reason?: string }>();
    if (uuid_ids.length === 0) return results;

    try {
      // 1. Batch check core.attractions
      const { data: coreRows } = await supabase
        .schema('core')
        .from('attractions')
        .select('id, approved')
        .in('id', uuid_ids);
      const coreById = new Map(
        (coreRows || []).map(r => [r.id, r as { id: string; approved: boolean }])
      );

      // 2. Batch check homolog.pois (apenas pros uuids NÃO em core, mas
      // queremos status pra todos pra completude do retorno)
      const { data: homologRows } = await supabase
        .schema('homolog')
        .from('pois')
        .select('uuid_id, processing_status, migration_attempts, last_migration_attempt_at')
        .in('uuid_id', uuid_ids);
      const homologById = new Map(
        (homologRows || []).map(r => [r.uuid_id, r as any])
      );

      const now = Date.now();
      const lockTimeout = 10 * 60 * 1000; // 10 minutes — mesma constante da função single

      for (const uuid_id of uuid_ids) {
        const inCore = coreById.get(uuid_id);
        if (inCore) {
          if (inCore.approved) {
            // Self-healing NÃO é feito aqui (side-effect omitido no batch).
            // O caller pode invocar shouldProcessPOI single pra disparar cleanup.
            results.set(uuid_id, {
              should_process: false,
              reason: 'POI already exists and is approved in core.attractions'
            });
          } else {
            results.set(uuid_id, {
              should_process: true,
              reason: 'Partial migration found: exists in core but not approved. Resuming pipeline.'
            });
          }
          continue;
        }

        const poi = homologById.get(uuid_id);
        if (!poi) {
          results.set(uuid_id, {
            should_process: false,
            reason: 'POI not found in homolog.pois'
          });
          continue;
        }

        if (poi.processing_status === 'migrated') {
          results.set(uuid_id, { should_process: false, reason: 'POI marked as migrated in homolog' });
          continue;
        }
        if (poi.processing_status === 'skipped') {
          results.set(uuid_id, { should_process: false, reason: 'POI marked as skipped' });
          continue;
        }
        if (poi.processing_status === 'failed' && (poi.migration_attempts || 0) >= 3) {
          results.set(uuid_id, {
            should_process: false,
            reason: 'POI failed migration 3+ times (permanent failure)'
          });
          continue;
        }
        if (poi.processing_status === 'processing') {
          const lockTime = poi.last_migration_attempt_at
            ? new Date(poi.last_migration_attempt_at).getTime()
            : 0;
          if (lockTime && now - lockTime < lockTimeout) {
            results.set(uuid_id, {
              should_process: false,
              reason: `POI is currently being processed (locked at ${poi.last_migration_attempt_at})`
            });
            continue;
          }
          // Lock expired: cai pro should_process=true abaixo
        }

        results.set(uuid_id, { should_process: true });
      }

      return results;
    } catch (error) {
      console.error('Error in shouldProcessPOIBatch:', error);
      // Fail-open: marca todos como should_process=true (mesma semântica que single)
      for (const uuid_id of uuid_ids) {
        if (!results.has(uuid_id)) {
          results.set(uuid_id, {
            should_process: true,
            reason: 'Error checking status, allowing processing'
          });
        }
      }
      return results;
    }
  }

  /**
   * Update processing status in homolog
   */
  static async updateProcessingStatus(
    uuid_id: string,
    status: 'pending' | 'processing' | 'migrated' | 'failed' | 'skipped',
    error?: string
  ): Promise<void> {
    try {
      const updateData: any = {
        processing_status: status,
        last_migration_attempt_at: new Date().toISOString()
      }

      if (error) {
        updateData.migration_error = error
      }

      if (status === 'failed') {
        // Increment attempts
        const { data: poi } = await supabase
          .schema('homolog')
          .from('pois')
          .select('migration_attempts')
          .eq('uuid_id', uuid_id)
          .single()

        updateData.migration_attempts = (poi?.migration_attempts || 0) + 1
      }

      if (status === 'processing') {
        updateData.last_migration_attempt_at = new Date().toISOString()
      }

      await supabase
        .schema('homolog')
        .from('pois')
        .update(updateData)
        .eq('uuid_id', uuid_id)
    } catch (error) {
      console.error('Error updating processing status:', error)
      // Don't throw - status update is not critical
    }
  }

  /**
   * Atomically claim a POI for processing.
   * Uses UPDATE...WHERE to ensure only one worker can claim a POI.
   * If the POI is already being processed by another worker, this returns false.
   * This eliminates the race condition between checking status and updating it.
   */
  static async claimForProcessing(uuid_id: string): Promise<{ claimed: boolean; reason?: string }> {
    try {
      // Atomic UPDATE: only claim if status is 'pending', 'new', 'failed', or null
      // First attempt: try known statuses
      const { data, error } = await supabase
        .schema('homolog')
        .from('pois')
        .update({
          processing_status: 'processing',
          last_migration_attempt_at: new Date().toISOString()
        })
        .eq('uuid_id', uuid_id)
        .in('processing_status', ['pending', 'failed', 'new'])
        .select('uuid_id')

      if (error) {
        console.warn(`⚠️ claimForProcessing error for ${uuid_id}:`, error.message)
        return { claimed: false, reason: `DB error: ${error.message}` }
      }

      if (data && data.length > 0) {
        console.log(`🔒 Claimed POI ${uuid_id} for processing`)
        return { claimed: true }
      }

      // Second attempt: try null status (POIs imported before field existed)
      const { data: data2, error: error2 } = await supabase
        .schema('homolog')
        .from('pois')
        .update({
          processing_status: 'processing',
          last_migration_attempt_at: new Date().toISOString()
        })
        .eq('uuid_id', uuid_id)
        .is('processing_status', null)
        .select('uuid_id')

      if (error2) {
        console.warn(`⚠️ claimForProcessing (null attempt) error for ${uuid_id}:`, error2.message)
        return { claimed: false, reason: `DB error: ${error2.message}` }
      }

      if (data2 && data2.length > 0) {
        console.log(`🔒 Claimed POI ${uuid_id} for processing (was null status)`)
        return { claimed: true }
      }

      // No rows updated = another worker claimed it, or status isn't claimable
      return { claimed: false, reason: 'Already claimed by another worker or status not claimable' }
    } catch (error) {
      console.error('Error claiming POI for processing:', error)
      return { claimed: false, reason: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  /**
   * Find and remove duplicate POIs by coordinates (within ~50m radius)
   * This is called after successful approval to clean up old duplicates
   */
  static async removeDuplicatePOIsByCoordinates(
    attraction_id: string,
    latitude: number,
    longitude: number
  ): Promise<{ removed_count: number; removed_ids: string[]; errors: string[] }> {
    const removed_ids: string[] = []
    const errors: string[] = []

    try {
      console.log(`🔍 Searching for duplicate POIs near (${latitude}, ${longitude})...`)

      // Get the coordinate for the new POI
      const { data: newCoord } = await supabase
        .schema('core')
        .from('attraction_coordinate')
        .select('latitude, longitude')
        .eq('attraction_id', attraction_id)
        .maybeSingle()

      if (!newCoord) {
        console.warn(`⚠️  Could not find coordinates for attraction ${attraction_id}`)
        return { removed_count: 0, removed_ids: [], errors: ['Could not find coordinates'] }
      }

      // Find POIs with similar coordinates (within ~50m tolerance)
      const tolerance = 0.0005 // ~50m at equator
      const { data: nearbyCoords, error: coordError } = await supabase
        .schema('core')
        .from('attraction_coordinate')
        .select('attraction_id, latitude, longitude')
        .gte('latitude', newCoord.latitude - tolerance)
        .lte('latitude', newCoord.latitude + tolerance)
        .gte('longitude', newCoord.longitude - tolerance)
        .lte('longitude', newCoord.longitude + tolerance)

      if (coordError) {
        console.error(`❌ Error finding nearby coordinates: ${coordError.message}`)
        return { removed_count: 0, removed_ids: [], errors: [coordError.message] }
      }

      if (!nearbyCoords || nearbyCoords.length === 0) {
        console.log(`✅ No duplicate POIs found near (${newCoord.latitude}, ${newCoord.longitude})`)
        return { removed_count: 0, removed_ids: [], errors: [] }
      }

      // Filter out the current POI and remove duplicates
      const duplicateIds = nearbyCoords
        .filter(coord => coord.attraction_id !== attraction_id)
        .map(coord => coord.attraction_id)

      if (duplicateIds.length === 0) {
        console.log(`✅ No duplicate POIs to remove (only current POI found)`)
        return { removed_count: 0, removed_ids: [], errors: [] }
      }

      // Skip archiving for duplicate removal in core
      await supabase.schema('core').rpc('set_session_setting', { p_name: 'tuggi.skip_archive', p_value: 'true' })

      // Remove each duplicate POI
      for (const duplicateId of duplicateIds) {
        try {
          const { error: deleteError } = await supabase
            .schema('core')
            .from('attractions')
            .delete()
            .eq('id', duplicateId)

          if (deleteError) {
            const errorMsg = `Failed to remove duplicate POI ${duplicateId}: ${deleteError.message}`
            console.error(`❌ ${errorMsg}`)
            errors.push(errorMsg)
          } else {
            console.log(`✅ Removed duplicate POI: ${duplicateId}`)
            removed_ids.push(duplicateId)
          }
        } catch (error) {
          const errorMsg = `Exception removing duplicate POI ${duplicateId}: ${error instanceof Error ? error.message : 'Unknown error'}`
          console.error(`❌ ${errorMsg}`)
          errors.push(errorMsg)
        }
      }

      // Reset skip archiving
      await supabase.schema('core').rpc('set_session_setting', { p_name: 'tuggi.skip_archive', p_value: 'false' })

      console.log(`✅ Removed ${removed_ids.length} duplicate POI(s), ${errors.length} error(s)`)
      return {
        removed_count: removed_ids.length,
        removed_ids,
        errors
      }
    } catch (error) {
      const errorMsg = `Exception in removeDuplicatePOIsByCoordinates: ${error instanceof Error ? error.message : 'Unknown error'}`
      console.error(`❌ ${errorMsg}`)
      return {
        removed_count: removed_ids.length,
        removed_ids,
        errors: [...errors, errorMsg]
      }
    }
  }
}

