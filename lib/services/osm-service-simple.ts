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

import { SimpleOSMPOI, ImportResults } from '../hooks/use-osm-importer-simple'

export class OSMService {

  /**
   * Save POIs to local SQLite database via API
   */
  static async saveToLocalDB(pois: SimpleOSMPOI[], sourceFile: string): Promise<ImportResults> {
    console.log('💾 [SERVICE] Saving to local SQLite database via API:', { poisCount: pois.length, sourceFile })
    
    try {
      const response = await fetch('/api/local-db/save', {
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
        throw new Error(`Local database save failed: ${response.statusText} - ${errorText}`)
      }

      const results = await response.json()
      console.log('✅ [SERVICE] Local database save API success:', results)
      
      return results.results || {
        success: true,
        imported: pois.length,
        errors: []
      }
    } catch (error) {
      console.error('❌ [SERVICE] Local database save failed:', error)
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
  static async parseFileToDB(file: File): Promise<{ success: boolean, imported: number, errors: string[] }> {
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
    let totalFeatures = 0

    console.log(`🔄 [SERVICE] Processing ${fileType} file with unified parser`)

    // Parse file in chunks using unified parser
    const features = await UnifiedParserService.parseFile(file)
    
    for (let i = 0; i < features.length; i += CHUNK_SIZE) {
      const chunk = features.slice(i, i + CHUNK_SIZE)
      totalFeatures += chunk.length
      const chunkNumber = Math.floor(totalFeatures / CHUNK_SIZE)
      
      console.log(`📦 [SERVICE] Processing chunk ${chunkNumber} (${chunk.length} features)`)
      
      // Debug: Log first feature structure from first chunk
      if (chunkNumber === 0 && chunk.length > 0) {
        console.log('🔍 [SERVICE] First feature structure:', {
          properties: chunk[0].properties,
          geometry: chunk[0].geometry,
          hasOsmId: !!chunk[0].properties?.osm_id,
          hasOsmType: !!chunk[0].properties?.osm_type
        })
      }
      
      // Process POIs with conditional enrichment
      const processedPOIs = await Promise.all(
        chunk.map(async (feature: any) => {
          const processedPOI = await OSMService.processPOI(feature)
          
          // Add delay to respect Nominatim rate limit (1 req/second)
          if (processedPOI && OSMService.needsNominatimEnrichment({
            name: feature.properties.name,
            city: feature.properties['addr:city'] || feature.properties['is_in:city'],
            state: feature.properties['addr:state'] || feature.properties['is_in:state']
          })) {
            await new Promise(resolve => setTimeout(resolve, 1000)) // 1 second delay
          }
          
          return processedPOI
        })
      )
      
      // Filter out rejected POIs
      const validPOIs = processedPOIs.filter(poi => poi !== null)
      
      console.log(`📊 [SERVICE] Chunk processed: ${chunk.length} features, ${validPOIs.length} valid POIs`)
      
      const chunkResults = await OSMService.saveToLocalDB(validPOIs, file.name)
    
      // Accumulate results
      if (chunkResults.success) {
        totalImported += chunkResults.imported
        console.log(`✅ [SERVICE] Chunk ${chunkNumber} completed: ${chunkResults.imported} imported`)
      } else {
        allErrors.push(...chunkResults.errors)
        console.error(`❌ [SERVICE] Chunk ${chunkNumber} failed:`, chunkResults.errors)
      }
      
      // Add small delay between chunks to prevent overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    
    console.log(`✅ [SERVICE] ${fileType} file processing completed: ${totalImported} total imported, ${allErrors.length} errors`)
    
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
          category: OSMService.getPrimaryCategory(feature.properties) || undefined,
        // Only include OSM properties that are relevant to our schema
        osm_id: feature.properties.osm_id,
        osm_type: feature.properties.osm_type,
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
   * Get primary OSM category for a feature
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
   * Check if a POI needs Nominatim enrichment
   * KISS: Simple validation logic
   */
  static needsNominatimEnrichment(poi: { name?: string, city?: string, state?: string }): boolean {
    return (
      !poi.name || poi.name === 'Unnamed POI' ||
      !poi.city || poi.city === null ||
      !poi.state || poi.state === null
    )
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
   */
  static async enrichWithNominatim(poi: SimpleOSMPOI): Promise<SimpleOSMPOI | null> {
    try {
      const { lat, lon } = this.extractCoordinates(poi.geometry)
      
      console.log('🌐 [SERVICE] Enriching POI with Nominatim:', { lat, lon })
      
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1&accept-language=pt-BR`,
        {
          headers: {
            'User-Agent': 'TuggiCMS/1.0 (POI Enrichment)'
          }
        }
      )
      
      if (!response.ok) {
        console.error('❌ [SERVICE] Nominatim request failed:', response.statusText)
        return null
      }
      
      const data = await response.json()
      
      // Category validation temporarily disabled
      // if (!this.isAcceptedCategory(`${data.class}=${data.type}`)) {
      //   console.log('🚫 [SERVICE] POI rejected - invalid category:', { class: data.class, type: data.type })
      //   return null
      // }
      
      // Enrich POI with Nominatim data
      return {
        ...poi,
        properties: {
          ...poi.properties,
          name: data.name || poi.properties.name || 'Unnamed POI',
          city: data.address?.city || poi.properties.city,
          state: data.address?.state || poi.properties.state,
          country: data.address?.country || poi.properties.country,
          category: `${data.class}=${data.type}`,
          formatted_address: data.display_name,
          importance: data.importance,
          place_id: data.place_id,
          osm_type: data.osm_type,
          osm_id: data.osm_id
        }
      }
      
    } catch (error) {
      console.error('❌ [SERVICE] Nominatim enrichment failed:', error)
      return null
    }
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
   * Process POI with conditional enrichment
   * SSOT: Single processing logic
   */
  static async processPOI(feature: any): Promise<SimpleOSMPOI | null> {
    // Create basic POI
    const basicPOI: SimpleOSMPOI = {
      _id: OSMService.generatePOIId(feature),
      properties: {
        name: feature.properties.name || feature.properties['name:en'] || feature.properties['name:pt'] || 'Unnamed POI',
        city: feature.properties['addr:city'] || feature.properties['is_in:city'] || feature.properties['addr:suburb'] || null,
        state: feature.properties['addr:state'] || feature.properties['is_in:state'] || feature.properties['addr:province'] || null,
        country: feature.properties['addr:country'] || feature.properties['is_in:country'] || null,
          category: OSMService.getPrimaryCategory(feature.properties) || undefined,
        osm_id: feature.properties.osm_id,
        osm_type: feature.properties.osm_type,
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
    }

    // Check if POI needs enrichment
    if (OSMService.needsNominatimEnrichment(basicPOI.properties)) {
      console.log('🔍 [SERVICE] POI needs enrichment, calling Nominatim')
      const enrichedPOI = await OSMService.enrichWithNominatim(basicPOI)
      
      if (!enrichedPOI) {
        console.log('🚫 [SERVICE] POI rejected after enrichment')
        return null
      }
      
      return enrichedPOI
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
      category: poi.properties.category || 'Unknown'
    }
  }
}
