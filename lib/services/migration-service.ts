/**
 * Migration Service - Migrate POIs from homolog to core
 * 
 * Handles migration of POIs and coordinates from homolog.pois/homolog.coordinates
 * to core.attractions/core.attraction_coordinate
 */

import { getSupabase } from '@/lib/core/supabase-client'

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
   * Check for duplicates before migration
   */
  static async checkDuplicates(
    uuid_id: string,
    osm_id: bigint | null,
    osm_type: string | null,
    latitude: number,
    longitude: number
  ): Promise<DuplicateCheckResult> {
    try {
      // Check by UUID (same UUID already exists in core)
      const { data: existingByUuid } = await supabase
        .schema('core')
        .from('attractions')
        .select('id')
        .eq('id', uuid_id)
        .single()

      if (existingByUuid) {
        return {
          is_duplicate: true,
          duplicate_type: 'uuid',
          existing_id: existingByUuid.id,
          message: `POI with UUID ${uuid_id} already exists in core.attractions`
        }
      }

      // Check by OSM ID + Type (same OSM POI)
      if (osm_id && osm_type) {
        const { data: existingByOsm } = await supabase
          .schema('core')
          .from('attractions')
          .select('id')
          .eq('osm_id', osm_id.toString())
          .eq('osm_type', osm_type)
          .single()

        if (existingByOsm) {
          return {
            is_duplicate: true,
            duplicate_type: 'osm',
            existing_id: existingByOsm.id,
            message: `POI with OSM ID ${osm_id} (${osm_type}) already exists in core.attractions`
          }
        }
      }

      // Check by coordinates (within ~50m radius)
      // Using PostGIS ST_DWithin for geographic distance
      const { data: existingByCoords } = await supabase
        .schema('core')
        .from('attraction_coordinate')
        .select('attraction_id')
        .limit(1)

      if (existingByCoords && existingByCoords.length > 0) {
        // Check distance using PostGIS (if available)
        // For now, we'll do a simple lat/lng check with tolerance
        const { data: nearbyCoords } = await supabase
          .rpc('check_nearby_coordinates', {
            p_lat: latitude,
            p_lng: longitude,
            p_radius_m: 50
          })
          .single()

        // If RPC doesn't exist, do manual check with tolerance
        if (!nearbyCoords) {
          const tolerance = 0.0005 // ~50m at equator
          const { data: nearby } = await supabase
            .schema('core')
            .from('attraction_coordinate')
            .select('attraction_id')
            .gte('latitude', latitude - tolerance)
            .lte('latitude', latitude + tolerance)
            .gte('longitude', longitude - tolerance)
            .lte('longitude', longitude + tolerance)
            .limit(1)
            .maybeSingle()

          if (nearby && nearby.attraction_id) {
            return {
              is_duplicate: true,
              duplicate_type: 'coordinates',
              existing_id: nearby.attraction_id,
              message: `POI with similar coordinates (${latitude}, ${longitude}) already exists`
            }
          }
        } else if (nearbyCoords && typeof nearbyCoords === 'object' && 'attraction_id' in nearbyCoords && nearbyCoords.attraction_id) {
          return {
            is_duplicate: true,
            duplicate_type: 'coordinates',
            existing_id: (nearbyCoords as { attraction_id: string }).attraction_id,
            message: `POI with similar coordinates (${latitude}, ${longitude}) already exists`
          }
        }
      }

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

    return mapped
  }

  /**
   * Migrate a single POI from homolog to core
   */
  static async migratePOI(uuid_id: string): Promise<MigrationResult> {
    const warnings: string[] = []
    const migrated_fields: string[] = []

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

      // Validate coordinate ranges
      if (coord.latitude < -90 || coord.latitude > 90) {
        return {
          success: false,
          error: `Invalid latitude: ${coord.latitude}`
        }
      }

      if (coord.longitude < -180 || coord.longitude > 180) {
        return {
          success: false,
          error: `Invalid longitude: ${coord.longitude}`
        }
      }

      // 4. Check for duplicates
      const duplicateCheck = await this.checkDuplicates(
        uuid_id,
        poi.osm_id,
        poi.osm_type,
        coord.latitude,
        coord.longitude
      )

      if (duplicateCheck.is_duplicate) {
        return {
          success: false,
          error: duplicateCheck.message || 'Duplicate POI detected',
          warnings: [duplicateCheck.message || 'Duplicate detected']
        }
      }

      // 4.5. Check if POI already exists in core (for duplicate and lock check)
      const { data: existingPOI } = await supabase
        .schema('core')
        .from('attractions')
        .select('id, processing_lock_by, processing_lock_at')
        .eq('id', uuid_id)
        .maybeSingle()

      if (existingPOI) {
        // POI already exists - check lock if processing
        if (existingPOI.processing_lock_by && existingPOI.processing_lock_at) {
          const lockTime = new Date(existingPOI.processing_lock_at)
          const now = new Date()
          const lockAge = now.getTime() - lockTime.getTime()
          const lockTimeout = 10 * 60 * 1000 // 10 minutes

          // If lock is still valid (less than 10 minutes old), skip
          if (lockAge < lockTimeout) {
            return {
              success: false,
              error: `POI is currently being processed by another process (locked at ${existingPOI.processing_lock_at})`
            }
          }
          // Lock expired, we can proceed
        }
        
        // POI exists but no lock or lock expired - this is a duplicate
        // Return error (skip_if_exists is handled at pipeline level)
        return {
          success: false,
          error: `POI with UUID ${uuid_id} already exists in core.attractions`
        }
      }

      // 5. Map homolog data to core format
      const mappedPOI = this.mapHomologToCore(poi, coord)
      migrated_fields.push(...Object.keys(mappedPOI).filter(k => mappedPOI[k] !== null && mappedPOI[k] !== undefined))

      // 6. Set lock before creating POI (if POI already exists, update lock)
      const lockUserId = 'migration-service'
      if (existingPOI) {
        // Update lock on existing POI
        const { error: lockError } = await supabase
          .schema('core')
          .from('attractions')
          .update({
            processing_lock_by: lockUserId,
            processing_lock_at: new Date().toISOString()
          })
          .eq('id', uuid_id)

        if (lockError) {
          console.warn('Failed to set processing lock:', lockError)
        }
      }

      // 7. Create POI in core.attractions (with lock set)
      mappedPOI.processing_lock_by = lockUserId
      mappedPOI.processing_lock_at = new Date().toISOString()

      const { data: createdPOI, error: createError } = await supabase
        .schema('core')
        .from('attractions')
        .insert(mappedPOI)
        .select('id')
        .single()

      if (createError) {
        // If it's a duplicate key error, it means UUID already exists
        if (createError.code === '23505') {
          return {
            success: false,
            error: `POI with UUID ${uuid_id} already exists in core.attractions`
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

      // 8. Create coordinate in core.attraction_coordinate
      // First check if coordinate already exists (UNIQUE constraint on attraction_id)
      const { data: existingCoord } = await supabase
        .schema('core')
        .from('attraction_coordinate')
        .select('id')
        .eq('attraction_id', createdPOI.id)
        .maybeSingle()

      const mappedCoord: any = {
        attraction_id: createdPOI.id,
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
        await supabase
          .schema('core')
          .from('attractions')
          .delete()
          .eq('id', createdPOI.id)

        return {
          success: false,
          error: `Failed to create/update coordinate: ${coordCreateError.message}`
        }
      }

      // 9. Update processing_status in homolog (optional, for tracking)
      await supabase
        .schema('homolog')
        .from('pois')
        .update({ processing_status: 'migrated' })
        .eq('uuid_id', uuid_id)

      // 9. Release lock
      await supabase
        .schema('core')
        .from('attractions')
        .update({
          processing_lock_by: null,
          processing_lock_at: null
        })
        .eq('id', createdPOI.id)

      return {
        success: true,
        attraction_id: createdPOI.id,
        warnings: warnings.length > 0 ? warnings : undefined,
        migrated_fields
      }
    } catch (error) {
      console.error('Migration error:', error)
      
      // Release lock on error
      try {
        await supabase
          .schema('core')
          .from('attractions')
          .update({
            processing_lock_by: null,
            processing_lock_at: null
          })
          .eq('id', uuid_id)
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
      
      const { error } = await supabase
        .schema('core')
        .from('attractions')
        .delete()
        .eq('id', attraction_id)

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

      if (!corePOI.approved) {
        return {
          success: false,
          error: `POI ${uuid_id} is not approved in core. Cannot delete from homolog.`
        }
      }

      // Delete from homolog.coordinates (cascade will handle it, but we can be explicit)
      // Actually, coordinates has foreign key with CASCADE, so deleting pois will delete coordinates
      // But let's delete coordinates first to be safe
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
        .select('id')
        .eq('id', uuid_id)
        .maybeSingle()

      if (existingInCore) {
        return {
          should_process: false,
          reason: 'POI already exists in core.attractions (already migrated)'
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
}

