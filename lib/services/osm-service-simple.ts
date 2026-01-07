/**
 * OSM Service - KISS SIMPLIFIED
 * 
 * Single service for all OSM operations:
 * - Parse GeoJSON files
 * - Extract location data
 * - Import POIs to database
 * - Local SQLite database support
 * 
 * @module lib/services/osm-service-simple
 */

import { SimpleOSMPOI, ImportResults } from '../types/osm-types'
import { getSupabaseClient } from '@/lib/core/supabase-client'

// Interface for optimized map data (matching MapPOI from poi-map-service)
export interface MapPOI {
  id: string
  type: 'cluster' | 'poi'
  latitude: number
  longitude: number
  count: number
  name?: string
  city?: string
  state?: string
  country?: string
  category?: string
  approved?: boolean
}

// Map filters interface
export interface OSMMapFilters {
  country?: string
  state?: string
  city?: string
  category?: string
  search?: string
}

export class OSMService {
  // Circuit breaker for Nominatim API
  private static nominatimCircuitBreaker = {
    isOpen: false,
    failureCount: 0,
    lastFailureTime: 0,
    failureThreshold: 5,
    timeout: 30000 // 30 seconds
  }

  // Cache for Nominatim requests to avoid duplicates
  private static nominatimCache = new Map<string, any>()

  // Throttling system for Nominatim requests
  private static throttling = {
    isProcessing: false,
    queue: [] as Array<() => Promise<any>>,
    lastRequestTime: 0,
    minDelay: 25, // 1.5 seconds between requests (more conservative)
    maxConcurrent: 1 // Only 1 request at a time
  }

  /**
   * Check if Nominatim circuit breaker is open
   */
  private static isNominatimCircuitOpen(): boolean {
    const now = Date.now()
    
    // Reset circuit breaker if timeout has passed
    if (this.nominatimCircuitBreaker.isOpen && 
        now - this.nominatimCircuitBreaker.lastFailureTime > this.nominatimCircuitBreaker.timeout) {
      console.log('🔄 [CIRCUIT] Nominatim circuit breaker reset - attempting to reconnect')
      this.nominatimCircuitBreaker.isOpen = false
      this.nominatimCircuitBreaker.failureCount = 0
    }
    
    return this.nominatimCircuitBreaker.isOpen
  }

  /**
   * Record Nominatim failure
   */
  private static recordNominatimFailure(): void {
    this.nominatimCircuitBreaker.failureCount++
    this.nominatimCircuitBreaker.lastFailureTime = Date.now()
    
    if (this.nominatimCircuitBreaker.failureCount >= this.nominatimCircuitBreaker.failureThreshold) {
      this.nominatimCircuitBreaker.isOpen = true
      console.log('🚫 [CIRCUIT] Nominatim circuit breaker OPEN - too many failures, skipping enrichment')
    }
  }

  /**
   * Record Nominatim success
   */
  private static recordNominatimSuccess(): void {
    this.nominatimCircuitBreaker.failureCount = 0
    this.nominatimCircuitBreaker.isOpen = false
  }

  /**
   * Build enriched POI from Nominatim data
   * IMPORTANT: Only update fields that are missing - preserve all existing data
   */
  private static buildEnrichedPOI(
    poi: SimpleOSMPOI, 
    data: any,
    fieldsToUpdate: { needsName: boolean, needsCity: boolean, needsState: boolean }
  ): SimpleOSMPOI {
    const isTrackingPOI = (poi.properties.name || '').includes('Lago') || (poi.properties.name || '').includes('Orfeu')
    
    const originalName = poi.properties.name
    const nominatimName = data.name || null
    
    // Only update name if it was missing
    const finalName = fieldsToUpdate.needsName 
      ? (nominatimName || originalName || 'Unnamed POI')
      : originalName
    
    // Extract city from Nominatim with fallbacks (city can be in different fields)
    const nominatimCity = data.address?.city || 
                         data.address?.town || 
                         data.address?.municipality || 
                         data.address?.village || 
                         data.address?.hamlet ||
                         data.address?.county ||
                         null
    
    // Only update city if it was missing
    const finalCity = fieldsToUpdate.needsCity
      ? (nominatimCity || poi.properties.city || null)
      : poi.properties.city
    
    // Extract state from Nominatim with fallbacks (state can be in different fields)
    const nominatimState = data.address?.state || 
                          data.address?.province || 
                          data.address?.region ||
                          null
    
    // Only update state if it was missing
    const finalState = fieldsToUpdate.needsState
      ? (nominatimState || poi.properties.state || null)
      : poi.properties.state
    
    if (isTrackingPOI) {
      console.log('🔨 [BUILD] buildEnrichedPOI (TRACKING):', {
        originalName,
        nominatimName,
        finalName,
        needsName: fieldsToUpdate.needsName,
        needsCity: fieldsToUpdate.needsCity,
        needsState: fieldsToUpdate.needsState,
        nameChanged: originalName !== finalName,
        cityChanged: poi.properties.city !== finalCity,
        stateChanged: poi.properties.state !== finalState
      })
    }
    
    return {
      ...poi,
      properties: {
        ...poi.properties,
        name: finalName,
        city: finalCity,
        state: finalState,
        // Only update country if it was missing (but we have a default)
        country: poi.properties.country || data.address?.country || 'Brazil',
        // Only set category from Nominatim if POI doesn't have one
        category: poi.properties.category || `${data.class}=${data.type}` || 'unknown',
        // Only update formatted_address if it was missing
        formatted_address: poi.properties.formatted_address || data.display_name || null,
        // Only update other fields if they were missing
        importance: poi.properties.importance || data.importance || null,
        place_id: poi.properties.place_id || data.place_id || null,
        osm_type: poi.properties.osm_type || data.osm_type || null,
        osm_id: poi.properties.osm_id || data.osm_id || null
      }
    }
  }

  /**
   * Throttled request to Nominatim API
   */
  private static async throttledNominatimRequest(url: string, options: RequestInit): Promise<Response> {
    return new Promise((resolve, reject) => {
      const requestFunction = async () => {
        try {
          // Ensure minimum delay between requests
          const now = Date.now()
          const timeSinceLastRequest = now - this.throttling.lastRequestTime
          if (timeSinceLastRequest < this.throttling.minDelay) {
            const waitTime = this.throttling.minDelay - timeSinceLastRequest
            console.log(`⏳ [THROTTLE] Waiting ${waitTime}ms before next request...`)
            await new Promise(resolve => setTimeout(resolve, waitTime))
          }

          console.log('🌐 [THROTTLE] Making throttled Nominatim request...')
          this.throttling.lastRequestTime = Date.now()
          
          const response = await fetch(url, options)
          resolve(response)
        } catch (error) {
          reject(error)
        }
      }

      // Add to queue
      this.throttling.queue.push(requestFunction)
      
      // Process queue if not already processing
      if (!this.throttling.isProcessing) {
        this.processThrottleQueue()
      }
    })
  }

  /**
   * Process throttling queue sequentially
   */
  private static async processThrottleQueue(): Promise<void> {
    if (this.throttling.isProcessing || this.throttling.queue.length === 0) {
      return
    }

    this.throttling.isProcessing = true
    console.log(`🔄 [THROTTLE] Processing queue: ${this.throttling.queue.length} requests`)

    while (this.throttling.queue.length > 0) {
      const requestFunction = this.throttling.queue.shift()
      if (requestFunction) {
        try {
          await requestFunction()
        } catch (error) {
          console.error('❌ [THROTTLE] Request failed:', error)
        }
      }
    }

    this.throttling.isProcessing = false
    console.log('✅ [THROTTLE] Queue processing completed')
  }

  /**
   * Emit progress update via Server-Sent Events
   */
  private static async emitProgressUpdate(uploadId: string, data: any): Promise<void> {
    if (!uploadId) return

    try {
      // Make HTTP request to emit progress update
      await fetch('/api/upload-progress/emit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          uploadId,
          data
        })
      })
    } catch (error) {
      console.error('❌ [SERVICE] Error emitting progress update:', error)
    }
  }

  /**
   * Save coordinates for POIs
   */
  private static async saveCoordinatesForPOIs(pois: SimpleOSMPOI[], savedPOIs: any[]): Promise<void> {
    try {
      console.log(`📍 [SERVICE] Saving coordinates for ${pois.length} POIs`)
      
      for (let i = 0; i < pois.length; i++) {
        const poi = pois[i]
        const savedPOI = savedPOIs[i]
        
        console.log(`📍 [SERVICE] Processing POI ${i + 1}:`, {
          poiName: poi.properties?.name,
          savedPOI: savedPOI,
          hasUuid: !!savedPOI?.uuid_id
        })
        
        if (!savedPOI?.uuid_id) {
          console.log(`⚠️ [SERVICE] Skipping coordinates for POI ${i + 1} - no saved POI UUID`)
          continue
        }
        
        // Check if coordinates already exist for this POI
        const existingCoordsResponse = await fetch(`/api/supabase/coordinates?poiUuid=${savedPOI.uuid_id}&limit=1`)
        if (existingCoordsResponse.ok) {
          const existingCoords = await existingCoordsResponse.json()
          if (existingCoords.success && existingCoords.data && existingCoords.data.length > 0) {
            console.log(`⚠️ [SERVICE] Coordinates already exist for POI ${savedPOI.uuid_id}, skipping`)
            continue
          }
        }
        
        const coordinates = this.extractCoordinates(poi.geometry)
        if (!coordinates) continue
        
        const coordinateData = {
          latitude: coordinates.lat,
          longitude: coordinates.lon,
          elevation_m: null,
          boundary_type: 'point',
          boundary_source: 'osm',
          show_in_map: true
        }
        
        const response = await fetch('/api/supabase/coordinates', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            coordinates: coordinateData,
            poiUuidId: savedPOI.uuid_id
          })
        })
        
        if (!response.ok) {
          console.error(`❌ [SERVICE] Error saving coordinates for POI ${savedPOI.uuid_id}:`, response.statusText)
        } else {
          console.log(`✅ [SERVICE] Coordinates saved for POI ${savedPOI.uuid_id}`)
        }
      }
      
      console.log('✅ [SERVICE] Coordinates saved successfully')
    } catch (error) {
      console.error('❌ [SERVICE] Error saving coordinates:', error)
    }
  }

  /**
   * Save POIs to local SQLite database via API
   */
  static async saveToLocalDB(pois: SimpleOSMPOI[], sourceFile: string): Promise<ImportResults> {
    console.log('💾 [SERVICE] Saving to Supabase database via API:', { poisCount: pois.length, sourceFile })
    
    if (pois.length === 0) {
      console.log('⚠️ [SERVICE] No POIs to save, returning empty result')
      return {
        success: true,
        imported: 0,
        errors: []
      }
    }
    
    try {
      const response = await fetch('/api/supabase/pois', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          pois,
          sourceFile
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('❌ [SERVICE] API error response:', errorText)
        throw new Error(`Supabase database save failed: ${response.statusText} - ${errorText}`)
      }

      const results = await response.json()
      console.log('✅ [SERVICE] Supabase database save API success:', results)
      
      // Save coordinates for each POI
      if (results.success && results.data) {
        console.log(`📍 [SERVICE] Saving coordinates for ${pois.length} POIs with data:`, results.data)
        await this.saveCoordinatesForPOIs(pois, results.data)
      } else {
        console.log(`⚠️ [SERVICE] Skipping coordinates save - POI save failed or no data returned`)
      }
      
      return results || {
        success: true,
        imported: pois.length,
        errors: []
      }
    } catch (error) {
      console.error('❌ [SERVICE] Supabase database save failed:', error)
      return {
        success: false,
        imported: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error']
      }
    }
  }

  /**
   * Get local database statistics via API
   */
  static async getLocalStats(): Promise<{ features: number, coordinates: number } | null> {
    try {
      const response = await fetch('/api/local-db/all-data?page=1&limit=1')
      
      if (!response.ok) {
        console.error('❌ [SERVICE] Error getting local stats:', response.statusText)
        return null
      }

      const results = await response.json()
      console.log('✅ [SERVICE] Local database stats retrieved:', results)
      
      return results.success ? results.data.stats : null
    } catch (error) {
      console.error('❌ [SERVICE] Error getting local stats:', error)
      return null
    }
  }

  /**
   * Generate unique POI ID based on available data
   */
  static generatePOIId(feature: any): string {
    // 1. Try OSM ID first (most reliable)
    if (feature.properties.osm_id && feature.properties.osm_type) {
      return `${feature.properties.osm_type}-${feature.properties.osm_id}`
    }
    
    // 2. Fallback: Generate hash from essential data
    const name = feature.properties.name || feature.properties['name:en'] || feature.properties['name:pt'] || 'Unnamed POI'
    const lat = Number(feature.geometry?.coordinates?.[1]) || 0
    const lng = Number(feature.geometry?.coordinates?.[0]) || 0
    const category = OSMService.getPrimaryCategory(feature.properties)
    
    // Create hash from essential data
    const hashInput = `${name}|${lat.toFixed(6)}|${lng.toFixed(6)}|${category}`
    const hash = OSMService.simpleHash(hashInput)
    
    return `poi-${hash}`
  }

  /**
   * Simple hash function for POI identification
   */
  static simpleHash(str: string): string {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36)
  }

  /**
   * Parse file (GeoJSON or PBF) and save directly to local database
   * Unified parsing using UnifiedParserService
   */
  static async parseFileToDB(
    file: File, 
    onProgress?: (current: number, total: number, message: string) => void,
    uploadId?: string
  ): Promise<{ success: boolean, imported: number, errors: string[] }> {
    console.log('📄 [SERVICE] Starting unified file parsing to DB:', { name: file.name, size: file.size })
    
    // Import UnifiedParserService dynamically to avoid circular dependencies
    const { UnifiedParserService } = await import('./unified-parser-service')
    
    // Detect file type and get parser
    const fileType = UnifiedParserService.detectFileType(file)
    console.log('🔍 [SERVICE] Detected file type:', fileType)
    
    // Validate file
    const isValid = await UnifiedParserService.validateFile(file)
    if (!isValid) {
      throw new Error(`Invalid ${fileType} file`)
    }

    // Process file using unified parser
    const CHUNK_SIZE = 1000 // Process 1000 features at a time
    let totalImported = 0
    let allErrors: string[] = []

    console.log(`🔄 [SERVICE] Processing ${fileType} file with unified parser`)

    // Parse file in chunks using unified parser
    const features = await UnifiedParserService.parseFile(file)
    const totalFeatures = features.length
    
    // Sort features by completeness: complete POIs first, incomplete POIs last
    console.log('🔄 [SERVICE] Sorting features by completeness...')
    const sortedFeatures = features.sort((a, b) => {
      const aComplete = OSMService.isComplete(a.properties)
      const bComplete = OSMService.isComplete(b.properties)
      
      // Complete POIs first (-1), incomplete POIs last (1)
      if (aComplete && !bComplete) return -1
      if (!aComplete && bComplete) return 1
      return 0
    })
    
    // Count complete vs incomplete for progress reporting
    const completeCount = sortedFeatures.filter(f => OSMService.isComplete(f.properties)).length
    const incompleteCount = totalFeatures - completeCount
    
    console.log(`📊 [SERVICE] Sorted ${completeCount} complete POIs first, ${incompleteCount} incomplete POIs last`)
    
    // Report initial progress
    if (onProgress) {
      onProgress(0, totalFeatures, `Starting to process ${totalFeatures} features (${completeCount} complete, ${incompleteCount} incomplete)...`)
    }
    
    // Emit start notification
    if (uploadId) {
      await this.emitProgressUpdate(uploadId, {
        type: 'upload-started',
        totalFeatures,
        completeCount,
        incompleteCount,
        message: `Starting to process ${totalFeatures} features`
      })
    }
    
    for (let i = 0; i < sortedFeatures.length; i += CHUNK_SIZE) {
      const chunk = sortedFeatures.slice(i, i + CHUNK_SIZE)
      const chunkNumber = Math.floor(i / CHUNK_SIZE) + 1
      const totalChunks = Math.ceil(totalFeatures / CHUNK_SIZE)
      
      console.log(`📦 [SERVICE] Processing chunk ${chunkNumber}/${totalChunks} (${chunk.length} features)`)
      
      // Report progress with completeness info
      if (onProgress) {
        const processedSoFar = Math.min(i + CHUNK_SIZE, totalFeatures)
        const isProcessingComplete = i < completeCount
        const status = isProcessingComplete ? 'complete' : 'incomplete'
        
        onProgress(processedSoFar, totalFeatures, 
          `Processing ${status} POIs: ${processedSoFar}/${totalFeatures} (chunk ${chunkNumber}/${totalChunks})`)
      }
      
      // Debug: Log first feature structure from first chunk
      if (chunkNumber === 1 && chunk.length > 0) {
        console.log('🔍 [SERVICE] First feature structure:', {
          properties: chunk[0].properties,
          geometry: chunk[0].geometry,
          hasOsmId: !!chunk[0].properties?.osm_id,
          hasOsmType: !!chunk[0].properties?.osm_type
        })
      }
      
      // Process and save POIs individually (immediate database save)
      let chunkImported = 0
      let chunkErrors: string[] = []
      
      for (let j = 0; j < chunk.length; j++) {
        const feature = chunk[j]
        
        try {
          // Process POI
          const processedPOI = await OSMService.processPOI(feature)
          
          if (processedPOI) {
            // Save immediately to database
            const saveResult = await OSMService.saveToLocalDB([processedPOI], file.name)
            
            if (saveResult.success) {
              chunkImported += saveResult.imported
              console.log(`✅ [SERVICE] POI saved: ${processedPOI.properties?.name || 'Unnamed'} (${j + 1}/${chunk.length})`)
              
              // Emit individual POI progress
              if (uploadId) {
                await this.emitProgressUpdate(uploadId, {
                  type: 'poi-saved',
                  poiName: processedPOI.properties?.name || 'Unnamed',
                  chunkNumber,
                  totalChunks,
                  chunkProgress: j + 1,
                  chunkTotal: chunk.length,
                  totalImported: totalImported + chunkImported,
                  message: `POI saved: ${processedPOI.properties?.name || 'Unnamed'} (${j + 1}/${chunk.length})`
                })
              }
            } else {
              chunkErrors.push(`Failed to save POI ${j + 1}: ${saveResult.errors.join(', ')}`)
              console.error(`❌ [SERVICE] Failed to save POI ${j + 1}:`, saveResult.errors)
            }
          } else {
            // Log detailed info about rejected POI
            const poiName = feature.properties?.name || feature.properties?.Name || 'Unnamed'
            const poiCity = feature.properties?.city || feature.properties?.['addr:city'] || 'Unknown'
            const poiCategory = feature.properties?.category || feature.properties?.tourism || feature.properties?.amenity || 'Unknown'
            console.warn(`⚠️ [SERVICE] POI ${j + 1} rejected during processing:`, {
              name: poiName,
              city: poiCity,
              category: poiCategory,
              hasCoordinates: !!feature.geometry?.coordinates,
              propertiesKeys: Object.keys(feature.properties || {}).slice(0, 10)
            })
          }
        } catch (error) {
          const errorMsg = `Error processing POI ${j + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`
          chunkErrors.push(errorMsg)
          console.error(`❌ [SERVICE] ${errorMsg}`)
        }
        
        // Log progress every 100 POIs
        if ((j + 1) % 100 === 0) {
          console.log(`🔄 [SERVICE] Chunk ${chunkNumber} progress: ${j + 1}/${chunk.length} POIs processed, ${chunkImported} saved`)
        }
      }
      
      console.log(`📊 [SERVICE] Chunk ${chunkNumber} completed: ${chunkImported} POIs saved, ${chunkErrors.length} errors`)
      
      // Create chunk results
      const chunkResults = {
        success: chunkErrors.length === 0,
        imported: chunkImported,
        errors: chunkErrors
      }
    
      // Accumulate results
      if (chunkResults.success) {
        totalImported += chunkResults.imported
        console.log(`✅ [SERVICE] Chunk ${chunkNumber} completed: ${chunkResults.imported} imported`)
        
        // Emit progress update for chunk completion
        if (uploadId && chunkResults.imported > 0) {
          await this.emitProgressUpdate(uploadId, {
            type: 'chunk-completed',
            chunkNumber,
            totalChunks,
            newPOIs: chunkResults.imported,
            totalImported,
            message: `Chunk ${chunkNumber}/${totalChunks} completed: ${chunkResults.imported} POIs saved`
          })
        }
      } else {
        allErrors.push(...chunkResults.errors)
        console.error(`❌ [SERVICE] Chunk ${chunkNumber} failed:`, chunkResults.errors)
      }
      
      // Report progress after chunk
      if (onProgress) {
        onProgress(Math.min(i + CHUNK_SIZE, totalFeatures), totalFeatures, 
          `Processed ${Math.min(i + CHUNK_SIZE, totalFeatures)}/${totalFeatures} features`)
      }
      
      // Add small delay between chunks to prevent overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    
    console.log(`✅ [SERVICE] ${fileType} file processing completed: ${totalImported} total imported, ${allErrors.length} errors`)
    
    // Emit completion notification
    if (uploadId) {
      await this.emitProgressUpdate(uploadId, {
        type: 'upload-completed',
        totalImported,
        totalErrors: allErrors.length,
        success: allErrors.length === 0,
        message: `Upload completed: ${totalImported} POIs imported, ${allErrors.length} errors`
      })
    }
    
    return {
      success: allErrors.length === 0,
      imported: totalImported,
      errors: allErrors
    }
  }

  /**
   * Parse GeoJSON file to POIs (legacy method for compatibility)
   * Now uses unified parser for consistency
   */
  static async parseGeoJSON(file: File): Promise<SimpleOSMPOI[]> {
    console.log('📄 [SERVICE] Starting GeoJSON parsing (legacy):', { name: file.name, size: file.size })
    
    // Use unified parser for consistency
    const { UnifiedParserService } = await import('./unified-parser-service')
    const features = await UnifiedParserService.parseFile(file)
    
    return features.map((feature: any, index: number) => ({
      _id: `osm-${Date.now()}-${index}`,
      properties: {
        name: feature.properties.name || feature.properties['name:en'] || feature.properties['name:pt'] || 'Unnamed POI',
        city: feature.properties['addr:city'] || feature.properties['is_in:city'] || feature.properties['addr:suburb'] || null,
        state: feature.properties['addr:state'] || feature.properties['is_in:state'] || feature.properties['addr:province'] || null,
        country: feature.properties['addr:country'] || feature.properties['is_in:country'] || null,
        category: OSMService.getNormalizedCategory(feature.properties) || undefined,
        // Only include OSM properties that are relevant to our schema
        osm_id: feature.properties['@id'] || feature.properties.osm_id,
        osm_type: feature.properties['@type'] || feature.properties.osm_type,
        website: feature.properties.website,
        contact_phone: feature.properties.contact_phone,
        contact_email: feature.properties.contact_email,
        operator_name: feature.properties.operator_name,
        wheelchair_accessible: feature.properties.wheelchair_accessible,
        wheelchair_toilets: feature.properties.wheelchair_toilets,
        accessibility_notes: feature.properties.accessibility_notes,
        height: feature.properties.height,
        building_material: feature.properties.building_material,
        building_colour: feature.properties.building_colour,
        roof_colour: feature.properties.roof_colour,
        architectural_style: feature.properties.architectural_style,
        historic_period: feature.properties.historic_period,
        landmark_type: feature.properties.landmark_type,
        architect: feature.properties.architect,
        construction_status: feature.properties.construction_status,
        start_date: feature.properties.start_date,
        heritage_status: feature.properties.heritage_status,
        unesco_status: feature.properties.unesco_status,
        unesco_inscription_date: feature.properties.unesco_inscription_date,
        unesco_reference: feature.properties.unesco_reference,
        landmark_level: feature.properties.landmark_level,
        importance_level: feature.properties.importance_level,
        museum_type: feature.properties.museum_type,
        museum_collection: feature.properties.museum_collection,
        museum_audience: feature.properties.museum_audience,
        museum_education: feature.properties.museum_education,
        leisure_type: feature.properties.leisure_type,
        natural_type: feature.properties.natural_type,
        natural_water: feature.properties.natural_water,
        sport_facilities: feature.properties.sport_facilities,
        leisure_playground: feature.properties.leisure_playground,
        monument_type: feature.properties.monument_type,
        monument_event: feature.properties.monument_event,
        monument_person: feature.properties.monument_person,
        parking_capacity: feature.properties.parking_capacity,
        public_transport: feature.properties.public_transport,
        access_points: feature.properties.access_points,
        entrance_fee: feature.properties.entrance_fee,
        urban_density: feature.properties.urban_density,
        noise_level: feature.properties.noise_level,
        air_quality: feature.properties.air_quality,
        shade_availability: feature.properties.shade_availability,
        cultural_significance: feature.properties.cultural_significance,
        local_traditions: feature.properties.local_traditions,
        seasonal_attractions: feature.properties.seasonal_attractions
      },
      geometry: feature.geometry
    }))
  }


  /**
   * Get primary OSM category for a feature (raw format)
   */
  static getPrimaryCategory(properties: Record<string, any> | undefined): string | null {
    if (!properties) return null
    
    // Handle both direct properties and nested tags structure
    const tags = properties.tags || properties
    
    const priorityTags = ['tourism', 'amenity', 'historic', 'natural', 'leisure', 'railway', 'public_transport', 'shop', 'highway', 'building']
    
    // First pass: look for specific categories (not *=yes)
    for (const tag of priorityTags) {
      if (tags[tag] && tags[tag] !== 'yes') {
        return `${tag}=${tags[tag]}`
      }
    }
    
    // Second pass: if no specific category found, use *=yes as fallback
    for (const tag of priorityTags) {
      if (tags[tag] === 'yes') {
        return `${tag}=${tags[tag]}`
      }
    }
    
    return null
  }

  /**
   * Get normalized category (just the value, not the type=value format)
   * This matches the local database system behavior
   */
  static getNormalizedCategory(properties: Record<string, any> | undefined): string | null {
    if (!properties) return null
    
    // Handle both direct properties and nested tags structure
    const tags = properties.tags || properties
    
    const priorityTags = ['tourism', 'amenity', 'historic', 'natural', 'leisure', 'railway', 'public_transport', 'shop', 'highway', 'building']
    
    // First pass: look for specific categories (not *=yes)
    for (const tag of priorityTags) {
      if (tags[tag] && tags[tag] !== 'yes') {
        return tags[tag] // Just the value (e.g., "hotel", "park", "restaurant")
      }
    }
    
    // Second pass: if no specific category found, use *=yes as fallback
    for (const tag of priorityTags) {
      if (tags[tag] === 'yes') {
        return tags[tag] // "yes"
      }
    }
    
    return null
  }

  /**
   * Check if a POI needs Nominatim enrichment
   * Returns which fields need to be fetched from Nominatim
   * 
   * Rules:
   * - If missing city OR state → fetch city and state
   * - If missing name → fetch name, city, and state (to validate/update all)
   */
  static needsNominatimEnrichment(poi: { name?: string, city?: string, state?: string }): {
    needsEnrichment: boolean
    needsName: boolean
    needsCity: boolean
    needsState: boolean
  } {
    const hasName = poi.name && poi.name !== 'Unnamed POI' && poi.name.trim() !== ''
    const hasCity = poi.city && poi.city !== null && poi.city.trim() !== ''
    const hasState = poi.state && poi.state !== null && poi.state.trim() !== ''
    
    // Rule 1: If missing name → fetch name, city, and state
    const needsName = !hasName
    if (needsName) {
      // When missing name, fetch everything (name, city, state) to ensure completeness
      return {
        needsEnrichment: true,
        needsName: true,
        needsCity: true,  // Always fetch city when name is missing
        needsState: true  // Always fetch state when name is missing
      }
    }
    
    // Rule 2: If missing city OR state → fetch city and state
    const needsCity = !hasCity
    const needsState = !hasState
    
    if (needsCity || needsState) {
      // When missing city or state, fetch both (even if one exists, refresh both)
      return {
        needsEnrichment: true,
        needsName: false,
        needsCity: true,   // Always fetch city when missing city or state
        needsState: true   // Always fetch state when missing city or state
      }
    }
    
    // No enrichment needed
    return {
      needsEnrichment: false,
      needsName: false,
      needsCity: false,
      needsState: false
    }
  }

  /**
   * Check if a POI is complete (has all required data)
   * Used for sorting: complete POIs are processed first
   */
  static isComplete(properties: any): boolean {
    const hasName = properties.name && properties.name !== 'Unnamed POI'
    const hasCity = properties.city || properties['addr:city'] || properties['is_in:city']
    const hasState = properties.state || properties['addr:state'] || properties['is_in:state']
    
    return hasName && hasCity && hasState
  }

  /**
   * Check if a category is accepted for our project
   * KISS: Simple category validation
   * TEMPORARILY DISABLED: Allow all categories for now
   * 
   * ACCEPTED CATEGORIES (for future reference):
   * tourism=attraction, tourism=museum, tourism=artwork, tourism=viewpoint, tourism=theme_park, tourism=zoo, tourism=aquarium
   * historic=monument, historic=castle, historic=church, historic=memorial, historic=ruins, historic=archaeological_site, historic=fort, historic=tomb, historic=wayside_shrine
   * natural=water, natural=wood, natural=beach, natural=cliff, natural=cave, natural=tree, natural=volcano, natural=waterfall, natural=geyser, natural=hot_spring
   * leisure=park, leisure=stadium
   * railway=station
   * aeroway=aerodrome
   */
  static isAcceptedCategory(category: string | null): boolean {
    // Temporarily allow all categories
    return true
  }

  /**
   * Enrich POI with Nominatim data
   * SSOT: Single source for Nominatim integration
   * Only fetches missing fields - preserves all existing data
   */
  static async enrichWithNominatim(
    poi: SimpleOSMPOI,
    fieldsToUpdate: { needsName: boolean, needsCity: boolean, needsState: boolean }
  ): Promise<SimpleOSMPOI | null> {
    // Check circuit breaker first
    if (this.isNominatimCircuitOpen()) {
      console.log('🚫 [SERVICE] Nominatim circuit breaker is OPEN - skipping enrichment')
      return null
    }

    const { lat, lon } = this.extractCoordinates(poi.geometry)
    
    // Log what we're fetching
    const fieldsBeingFetched = []
    if (fieldsToUpdate.needsName) fieldsBeingFetched.push('name')
    if (fieldsToUpdate.needsCity) fieldsBeingFetched.push('city')
    if (fieldsToUpdate.needsState) fieldsBeingFetched.push('state')
    
    console.log(`🌐 [SERVICE] Fetching from Nominatim (${fieldsBeingFetched.join(', ')}) for POI:`, {
      currentName: poi.properties.name,
      currentCity: poi.properties.city,
      currentState: poi.properties.state,
      lat,
      lon
    })
    
    // Check cache first
    const cacheKey = `${lat.toFixed(6)},${lon.toFixed(6)}`
    const isTrackingPOI = (poi.properties.name || '').includes('Lago') || (poi.properties.name || '').includes('Orfeu')
    
    if (this.nominatimCache.has(cacheKey)) {
      const cachedData = this.nominatimCache.get(cacheKey)
      
      if (isTrackingPOI) {
        console.log('💾 [CACHE] Using cached Nominatim data (TRACKING):', {
          lat,
          lon,
          cacheKey,
          cachedName: cachedData?.name,
          currentPOIName: poi.properties.name,
          fieldsToUpdate
        })
      } else {
        console.log('💾 [SERVICE] Using cached Nominatim data for:', { lat, lon })
      }
      
      return this.buildEnrichedPOI(poi, cachedData, fieldsToUpdate)
    }
      
    // Retry logic with exponential backoff
    const maxRetries = 3
    let lastError: Error | null = null
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🔄 [SERVICE] Nominatim attempt ${attempt}/${maxRetries}`)
        
        const response = await this.throttledNominatimRequest(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1&accept-language=pt-BR`,
        {
          headers: {
              'User-Agent': 'TuggiCMS/1.0 (POI Enrichment) - Contact: leandro@tuggi.com.br'
          }
        }
      )
      
      if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      const data = await response.json()
      
      // Enrich POI with Nominatim data - only updating requested fields
      console.log('✅ [SERVICE] Nominatim enrichment successful')
      this.recordNominatimSuccess() // Record success to reset circuit breaker
      
      // Cache the result for future use
      this.nominatimCache.set(cacheKey, data)
      
      return this.buildEnrichedPOI(poi, data, fieldsToUpdate)
        
      } catch (error) {
        lastError = error as Error
        console.error(`❌ [SERVICE] Nominatim attempt ${attempt} failed:`, error)
        
        // Record failure for circuit breaker
        this.recordNominatimFailure()
        
        // If this is not the last attempt, wait with exponential backoff
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000 // 2s, 4s, 8s
          console.log(`⏳ [SERVICE] Waiting ${delay}ms before retry...`)
          await new Promise(resolve => setTimeout(resolve, delay))
        }
      }
    }
    
    // All retries failed
    console.error('❌ [SERVICE] Nominatim enrichment failed after all retries:', lastError)
    return null
  }

  /**
   * Extract coordinates from geometry
   * KISS: Simple coordinate extraction
   */
  static extractCoordinates(geometry: any): { lat: number, lon: number } {
    if (geometry?.type === 'Point' && geometry.coordinates) {
      return { lon: geometry.coordinates[0], lat: geometry.coordinates[1] }
    }
    
    // For other geometry types, calculate centroid
    if (geometry?.coordinates) {
      let sumLng = 0, sumLat = 0, count = 0
      
      const processCoords = (coords: any) => {
        if (Array.isArray(coords[0])) {
          coords.forEach(processCoords)
        } else {
          sumLng += coords[0]
          sumLat += coords[1]
          count++
        }
      }
      
      processCoords(geometry.coordinates)
      
      if (count > 0) {
        return { lon: sumLng / count, lat: sumLat / count }
      }
    }
    
    return { lat: 0, lon: 0 }
  }

  /**
   * Extract OSM ID from GeoJSON feature.id
   * Example: "n123456" -> 123456, "w789" -> 789, "r999" -> 999
   */
  static extractOSMId(featureId: string | number | undefined): number | null {
    if (!featureId) return null
    
    const idStr = String(featureId)
    // Remove the first character (n, w, or r) and parse as number
    const match = idStr.match(/^[nwr](\d+)$/)
    return match ? parseInt(match[1], 10) : null
  }

  /**
   * Extract OSM type from GeoJSON feature.id
   * Example: "n123456" -> "node", "w789" -> "way", "r999" -> "relation"
   */
  static extractOSMType(featureId: string | number | undefined): string | null {
    if (!featureId) return null
    
    const idStr = String(featureId)
    const typeChar = idStr.charAt(0)
    
    switch (typeChar) {
      case 'n': return 'node'
      case 'w': return 'way'
      case 'r': return 'relation'
      default: return null
    }
  }

  /**
   * Extract height and elevation from OSM properties - KISS approach
   * Returns: { height: number | null, elevation: number | null }
   */
  static extractHeightAndElevation(props: any): { height: number | null, elevation: number | null } {
    // Height: get first valid value found
    const height = this.parseNumericValue(props.height) || 
                   this.parseNumericValue(props['building:height']) || 
                   this.convertLevels(props['building:levels'])
    
    // Elevation: only ele tag
    const elevation = this.parseNumericValue(props.ele)
    
    return { height, elevation }
  }

  /**
   * Parse numeric value from OSM tag - simple and robust
   */
  private static parseNumericValue(value: any): number | null {
    if (!value) return null
    const parsed = parseFloat(String(value).replace(/[^\d.,]/g, '').replace(',', '.'))
    return (parsed > 0 && parsed < 1000) ? parsed : null
  }

  /**
   * Convert building levels to height - simple 3m per floor
   */
  private static convertLevels(levels: any): number | null {
    if (!levels) return null
    const parsed = parseInt(String(levels))
    return (parsed > 0 && parsed <= 100) ? parsed * 3.0 : null
  }

  /**
   * Generate deterministic UUID for POI based on OSM data
   */
  static generateDeterministicUUID(feature: any): string {
    const coords = OSMService.extractCoordinates(feature.geometry)
    const uuidString = `osm:${feature.properties?.osm_id || 0}:${feature.properties?.osm_type || 'unknown'}:${feature.properties?.name || ''}:${coords.lat}:${coords.lon}`
    const deterministicUUID = require('crypto').createHash('sha1').update(uuidString).digest('hex')
    const formattedUUID = [
      deterministicUUID.substring(0, 8),
      deterministicUUID.substring(8, 12),
      '5' + deterministicUUID.substring(13, 16), // Version 5
      ((parseInt(deterministicUUID.substring(16, 17), 16) & 0x3) | 0x8).toString(16) + deterministicUUID.substring(17, 20), // Variant
      deterministicUUID.substring(20, 32)
    ].join('-')
    return formattedUUID
  }

  /**
   * Process POI with conditional enrichment
   * SSOT: Single processing logic
   */
  static async processPOI(feature: any): Promise<SimpleOSMPOI | null> {
    const props = feature.properties || {}
    
    // Debug: Log POIs with "Lago" or "Orfeu" in name to track name changes
    const poiName = props.name || props.Name || 'Unnamed'
    if (poiName.includes('Lago') || poiName.includes('Orfeu')) {
      console.log('🔍 [PROCESS] Starting processPOI for:', {
        name: poiName,
        city: props.city || props['addr:city'],
        state: props.state || props['addr:state'],
        allProps: props
      })
    }
    
    // Extract tourism flags from OSM properties
    const extractTourismFlags = (properties: any) => ({
      is_historic: properties?.historic === 'yes' || !!properties?.historic,
      is_touristic: properties?.tourism === 'yes' || !!properties?.tourism,
      has_train: properties?.train === 'yes' || !!properties?.train,
      has_ferry: properties?.ferry === 'yes' || !!properties?.ferry,
      has_bus: properties?.bus === 'yes' || !!properties?.bus,
      has_wheelchair_access: properties?.wheelchair === 'yes' || !!properties?.wheelchair,
      has_water: properties?.water === 'yes' || !!properties?.water,
      has_fishing: properties?.fishing === 'yes' || !!properties?.fishing,
      has_playground: properties?.playground === 'yes' || !!properties?.playground,
      is_building: properties?.building === 'yes' || !!properties?.building,
      has_ruins: properties?.ruins === 'yes' || !!properties?.ruins
    })
    
    const tourismFlags = extractTourismFlags(props)
    
    // Create basic POI
    const basicPOI: SimpleOSMPOI = {
      _id: OSMService.generatePOIId(feature),
      // uuid_id will be generated by database trigger
      properties: {
        name: props.name || props['name:en'] || props['name:pt'] || 'Unnamed POI',
        city: props['addr:city'] || props.city || props['is_in:city'] || props['addr:suburb'] || null,
        state: props['addr:state'] || props.state || props['is_in:state'] || props['addr:province'] || null,
        country: props['addr:country'] || props.country || props['is_in:country'] || 'Brazil',
        neighborhood: props['addr:suburb'] || props['addr:neighbourhood'] || null,
        street_name: props['addr:street'] || props['addr:road'] || null,
        house_number: props['addr:housenumber'] || null,
        postal_code: props['addr:postcode'] || null,
        description: props.description || props['description:en'] || props['description:pt'] || null,
        formatted_address: null, // Will be filled by Nominatim
        primary_category: OSMService.getNormalizedCategory(props) || 'unknown',
        primary_category_type: 'osm',
        categories: [OSMService.getNormalizedCategory(props)].filter(Boolean),
        category: OSMService.getNormalizedCategory(props) || 'unknown',
        // Extract OSM ID and type from GeoJSON feature.id (e.g., "n123456" -> id=123456, type=node)
        osm_id: OSMService.extractOSMId(feature.id),
        osm_type: OSMService.extractOSMType(feature.id),
        
        // Contact/Operation fields
        website: props.website || props.url || props['contact:website'] || null,
        contact_phone: props.phone || props['contact:phone'] || null,
        contact_email: props.email || props['contact:email'] || null,
        contact_fax: props.fax || props['contact:fax'] || null,
        operator_name: props.operator || props['operator:name'] || null,
        
        // Brand information
        brand: props.brand || null,
        brand_wikidata: props['brand:wikidata'] || null,
        brand_wikipedia: props['brand:wikipedia'] || null,
        
        // Internet access
        internet_access: props['internet_access'] || null,
        internet_access_fee: props['internet_access:fee'] || null,
        
        // Accessibility fields
        wheelchair_accessible: props.wheelchair || null,
        wheelchair_toilets: props['toilets:wheelchair'] || null,
        accessibility_notes: props['accessibility:notes'] || null,
        
        // Physical characteristics - extract height and elevation
        ...OSMService.extractHeightAndElevation(props),
        building_material: props['building:material'] || null,
        building_colour: props['building:colour'] || props['building:color'] || null,
        roof_colour: props['roof:colour'] || props['roof:color'] || null,
        architectural_style: props['architectural_style'] || null,
        
        // Historical/Heritage fields
        historic_period: props['historic:period'] || null,
        landmark_type: props['landmark:type'] || null,
        architect: props.architect || null,
        construction_status: props['construction:status'] || null,
        start_date: props['start_date'] || props['construction:date'] || null,
        heritage_status: props['heritage:status'] || null,
        unesco_status: props['unesco:status'] || null,
        unesco_inscription_date: props['unesco:inscription_date'] || null,
        unesco_reference: props['unesco:reference'] || null,
        landmark_level: props['landmark:level'] ? parseInt(props['landmark:level']) : null,
        importance_level: props['importance:level'] || null,
        
        // Type-specific fields
        museum_type: props['museum:type'] || null,
        museum_collection: props['museum:collection'] || null,
        museum_audience: props['museum:audience'] || null,
        museum_education: props['museum:education'] || null,
        leisure_type: props['leisure:type'] || null,
        natural_water: props['natural:water'] || null,
        sport_facilities: props['sport:facilities'] || null,
        leisure_playground: props['leisure:playground'] || null,
        monument_type: props['monument:type'] || null,
        monument_event: props['monument:event'] || null,
        monument_person: props['monument:person'] || null,
        
        // Infrastructure fields
        parking_capacity: props['parking:capacity'] || null,
        public_transport: props['public_transport'] || null,
        access_points: props['access:points'] || null,
        entrance_fee: props['entrance:fee'] || null,
        
        // Environmental fields
        urban_density: props['urban:density'] || null,
        noise_level: props['noise:level'] || null,
        air_quality: props['air:quality'] || null,
        shade_availability: props['shade:availability'] || null,
        
        // Cultural fields
        cultural_significance: props['cultural:significance'] || null,
        local_traditions: props['local:traditions'] || null,
        seasonal_attractions: props['seasonal:attractions'] || null,
        
        // Critical missing fields
        opening_hours: props['opening_hours'] || null,
        wikidata: props['wikidata'] || null,
        wikipedia: props['wikipedia'] || null,
        amenity: props['amenity'] || null,
        
        // Important missing fields
        building: props['building'] || null,
        artwork_type: props['artwork_type'] || null,
        information: props['information'] || null,
        
        // PBF analysis fields
        source: props['source'] || null,
        natural_type: props['natural'] || null,
        landuse: props['landuse'] || null,
        access: props['access'] || null,
        ref: props['ref'] || null,
        type: props['type'] || null,
        
        // Contact fields
        contact_phone_alt: props['contact:phone'] || null,
        contact_mobile: props['contact:mobile'] || null,
        contact_website_alt: props['contact:website'] || null,
        contact_email_alt: props['contact:email'] || null,
        contact_facebook: props['contact:facebook'] || null,
        contact_instagram: props['contact:instagram'] || null,
        contact_whatsapp: props['contact:whatsapp'] || null,
        contact_twitter: props['contact:twitter'] || null,
        contact_youtube: props['contact:youtube'] || null,
        
        // Payment fields
        fee: props['fee'] || null,
        payment_credit_cards: props['payment:credit_cards'] || null,
        payment_cash: props['payment:cash'] || null,
        payment_visa: props['payment:visa'] || null,
        payment_mastercard: props['payment:mastercard'] || null,
        
        // Capacity fields
        rooms: props['rooms'] ? parseInt(props['rooms']) : null,
        air_conditioning: props['air_conditioning'] || null,
        smoking: props['smoking'] || null,
        capacity: props['capacity'] ? parseInt(props['capacity']) : null,
        pets_allowed: props['pets_allowed'] || null,
        
        // Additional fields
        surface: props['surface'] || null,
        waterway: props['waterway'] || null,
        power: props['power'] || null,
        lanes: props['lanes'] ? parseInt(props['lanes']) : null,
        maxspeed: props['maxspeed'] ? parseInt(props['maxspeed']) : null,
        intermittent: props['intermittent'] || null,
        layer: props['layer'] ? parseInt(props['layer']) : null,
        leisure: props['leisure'] || null,
        lit: props['lit'] || null,
        service: props['service'] || null,
        barrier: props['barrier'] || null,
        alt_name: props['alt_name'] || null,
        tunnel: props['tunnel'] || null,
        bus: props['bus'] || null,
        place: props['place'] || null,
        man_made: props['man_made'] || null,
        source_name: props['source:name'] || null,
        trees: props['trees'] || null,
        bridge: props['bridge'] || null,
        shop: props['shop'] || null,
        
        // Tourism flags
        ...tourismFlags,
        
        // Store all OSM properties for reference
        osm_properties: props
      },
      geometry: feature.geometry
    }

    // Check if POI needs enrichment and which fields need to be fetched
    const enrichmentCheck = OSMService.needsNominatimEnrichment(basicPOI.properties)
    
    // Log for specific POIs to track name changes
    const isTrackingPOI = (basicPOI.properties.name || '').includes('Lago') || (basicPOI.properties.name || '').includes('Orfeu')
    
    if (enrichmentCheck.needsEnrichment) {
      if (isTrackingPOI) {
        console.log('🔍 [ENRICH] POI needs enrichment (TRACKING):', {
          needsName: enrichmentCheck.needsName,
          needsCity: enrichmentCheck.needsCity,
          needsState: enrichmentCheck.needsState,
          currentName: basicPOI.properties.name,
          currentCity: basicPOI.properties.city,
          currentState: basicPOI.properties.state
        })
      }
      
      const enrichedPOI = await OSMService.enrichWithNominatim(basicPOI, {
        needsName: enrichmentCheck.needsName,
        needsCity: enrichmentCheck.needsCity,
        needsState: enrichmentCheck.needsState
      })
      
      if (!enrichedPOI) {
        if (isTrackingPOI) {
          console.log('⚠️ [ENRICH] Nominatim enrichment failed, saving POI without enrichment (TRACKING)')
        }
        // Fallback: save POI without enrichment instead of rejecting
        return basicPOI
      }
      
      if (isTrackingPOI) {
        console.log('✅ [ENRICH] POI enriched with Nominatim (TRACKING):', {
          originalName: basicPOI.properties.name,
          enrichedName: enrichedPOI.properties.name,
          city: enrichedPOI.properties.city,
          state: enrichedPOI.properties.state,
          wasNameUpdated: enrichmentCheck.needsName,
          wasCityUpdated: enrichmentCheck.needsCity,
          wasStateUpdated: enrichmentCheck.needsState
        })
      }
      
      return enrichedPOI
    } else {
      if (isTrackingPOI) {
        console.log('✅ [ENRICH] POI complete, no enrichment needed (TRACKING):', {
          name: basicPOI.properties.name,
          city: basicPOI.properties.city,
          state: basicPOI.properties.state
        })
      }
    }

    // Category validation temporarily disabled
    // if (!OSMService.isAcceptedCategory(basicPOI.properties.category || null)) {
    //   console.log('🚫 [SERVICE] POI rejected - invalid category:', basicPOI.properties.category)
    //   return null
    // }

    console.log('✅ [SERVICE] POI complete, no enrichment needed')
    return basicPOI
  }

  /**
   * Extract location data from POI properties
   */
  static extractLocation(poi: SimpleOSMPOI) {
    return {
      name: poi.properties.name || 'Unnamed POI',
      city: poi.properties.city || 'Unknown',
      state: poi.properties.state || 'Unknown',
      country: poi.properties.country || 'Unknown',
      category: poi.properties.primary_category || poi.properties.category || 'Unknown'
    }
  }


  /**
   * Search POIs for map visualization using optimized server-side clustering
   * Calls homolog.get_coordinates_in_bounds RPC
   */
  static async searchMapPOIs(
    filters: OSMMapFilters,
    bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number },
    zoom: number
  ): Promise<{ data: MapPOI[]; duration: number }> {
    const startTime = performance.now()
    const supabase = getSupabaseClient()

    try {
      console.log('🗺️ [SERVICE] Fetching optimized map POIs:', { filters, bounds, zoom })

      const { data, error } = await supabase.schema('homolog').rpc('get_coordinates_in_bounds', {
        min_lat: bounds.minLat,
        min_lng: bounds.minLng,
        max_lat: bounds.maxLat,
        max_lng: bounds.maxLng,
        zoom_level: zoom,
        limit_count: 5000,
        city_filter: filters.city || null,
        state_filter: filters.state || null,
        category_filter: filters.category || null,
        search_term: filters.search || null
      })

      if (error) {
        console.error('❌ [SERVICE] Map RPC error:', error)
        throw error
      }

      const duration = performance.now() - startTime
      console.log(`✅ [SERVICE] Map POIs fetched in ${duration.toFixed(0)}ms:`, data?.length || 0)

      // Map RPC result to MapPOI interface
      // The RPC returns { id, type, count, latitude, longitude, name, category }
      const mapPOIs: MapPOI[] = (data || []).map((item: any) => ({
        id: item.id || `cluster-${item.latitude}-${item.longitude}`, // Fallback ID for clusters if null
        type: item.type as 'cluster' | 'poi',
        latitude: item.latitude,
        longitude: item.longitude,
        count: item.count,
        name: item.name,
        category: item.category,
        city: filters.city, // Pass context if known
        state: filters.state,
        country: 'Brazil', // Default
        approved: false // Default for homolog
      }))

      return { data: mapPOIs, duration }
    } catch (error) {
      console.error('❌ [SERVICE] Failed to fetch map POIs:', error)
      return { data: [], duration: 0 }
    }
  }
}
