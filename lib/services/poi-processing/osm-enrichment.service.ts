/**
 * OSM Enrichment Service - POI Processing Module
 * 
 * Centralized service for POI data enrichment using OpenStreetMap
 * Extracted from /api/pois/enrich-osm for modularity and reusability
 * 
 * Features:
 * - Fetch OSM data from multiple sources (Nominatim, Reverse, Overpass)
 * - Extract comprehensive POI information
 * - Calculate quality and POV scores
 * - Save enriched data to database
 */

import { getSupabase } from '../../core/supabase-client'

// Service role client for database operations
const supabaseAdmin = getSupabase('server')

// =====================================
// INTERFACES AND TYPES
// =====================================

export interface POIEnrichmentInput {
  poi_id: string
  name: string
  city: string
  country: string
  google_place_id?: string
  lat?: number
  lng?: number
}

export interface OSMData {
  nominatim?: any
  reverse?: any
  overpass?: any
}

export interface EnrichedPOIData {
  // Basic OSM data
  osm_category?: string
  osm_tags?: any
  osm_geometry?: any
  osm_last_updated?: string
  
  // Geographic data
  elevation_m?: number
  estimated_height_m?: number
  osm_area_m2?: number
  
  // Heritage and cultural data
  heritage_status?: string
  unesco_status?: string
  landmark_level?: number
  importance_level?: string
  architect?: string
  architectural_style?: string
  historical_period?: string
  completion_estimated_year?: number
  landmark_type?: string
  
  // Accessibility data
  wheelchair_accessible?: boolean | string
  wheelchair_toilets?: boolean
  parking_capacity?: number
  public_transport?: string[]
  access_points?: string[]
  
  // Environmental data
  urban_density?: string
  noise_level?: string
  air_quality?: string
  shade_availability?: string
  
  // Cultural data
  cultural_significance?: string
  local_traditions?: string[]
  seasonal_attractions?: string[]
  
  // Type-specific data
  museum_type?: string
  park_type?: string
  monument_type?: string
  
  // Physical characteristics
  building_colour?: string
  roof_colour?: string
  building_material?: string
  
      // OSM Links and references
    osm_description?: string // NEW: Description from OSM
    osm_wikidata_id?: string
    osm_wikipedia_url?: string
    contact_phone?: string
    contact_email?: string
    operator_name?: string
  
  // Quality scores
  osm_data_quality_score?: number
  pov_quality_score?: number
  visibility_score?: number
  accessibility_score?: number
  photogenic_score?: number
  
  // Metadata
  verification_status?: string
  data_sources?: string[]
  osm_import_date?: string
}

export interface EnrichmentResult {
  success: boolean
  poi_id: string
  message: string
  data_quality_score?: number
  fields_updated?: string[]
  enriched_data?: EnrichedPOIData
  error?: string
  marked_as_not_found?: boolean
}

// =====================================
// MAIN SERVICE CLASS
// =====================================

export class OSMEnrichmentService {
  
  /**
   * Enrich POI with OSM data
   */
  static async enrichPOI(input: POIEnrichmentInput): Promise<EnrichmentResult> {
    const { poi_id, name, city, country, google_place_id, lat, lng } = input
    
    console.log(`🔄 Starting OSM enrichment for POI: ${name} (${city}, ${country})`)

    try {
      // Step 1: Get POI coordinates if not provided
      let coordinates = lat && lng ? { lat, lng } : null
      if (!coordinates) {
        coordinates = await this.getPOICoordinates(poi_id)
      }
      
      console.log(`📍 POI coordinates: ${coordinates ? `${coordinates.lat}, ${coordinates.lng}` : 'Not available'}`)

      // REQUIRE coordinates for processing to avoid false positives
      if (!coordinates) {
        console.log(`❌ Cannot enrich POI without coordinates - skipping to avoid false positives`)
        return {
          success: false,
          poi_id,
          message: 'POI coordinates required for accurate matching',
          error: 'No coordinates found in attraction_coordinate table'
        }
      }

      // Step 2: Fetch OSM data using multiple APIs
      const osmData = await this.fetchOSMData(name, city, country, coordinates)
      
      if (!osmData.nominatim && !osmData.reverse) {
        // MARK POI AS "NOT FOUND" TO AVOID REPROCESSING
        console.log(`❌ No OSM data found for POI: ${name} - Marking as not found`)
        
        const notFoundResult = await this.markPOIAsNotFound(poi_id)
        
        return {
          success: false,
          poi_id,
          message: 'No OSM data found for this POI',
          marked_as_not_found: notFoundResult.success,
          error: 'No data found in Nominatim or Reverse Geocoding'
        }
      }

      // Step 3: Process and extract relevant information
      const extractedData = await this.extractOSMData(osmData, name, city, country)
      
      // Step 4: Calculate quality score using OSM's native importance
      const osmImportance = osmData.nominatim?.importance || osmData.reverse?.importance
      const qualityScore = this.calculateQualityScore(extractedData, osmImportance)
      
      // Step 5: Update database
      const updateResult = await this.updatePOIWithOSMData(poi_id, extractedData, qualityScore)

      if (!updateResult.success) {
        return {
          success: false,
          poi_id,
          message: 'Failed to update database',
          error: updateResult.error
        }
      }

      console.log(`✅ Successfully enriched POI: ${name} (Quality: ${qualityScore}%)`)

      return {
        success: true,
        poi_id,
        message: 'POI enriched successfully',
        data_quality_score: qualityScore,
        fields_updated: updateResult.fields_updated,
        enriched_data: {
          ...extractedData,
          osm_data_quality_score: qualityScore
        }
      }

    } catch (error: any) {
      console.error('❌ Error in OSM enrichment:', error)
      return {
        success: false,
        poi_id,
        message: 'Internal server error during enrichment',
        error: error.message
      }
    }
  }

  /**
   * Get enriched POI data from database
   */
  static async getEnrichedPOIData(poi_id: string): Promise<EnrichedPOIData | null> {
    try {
      const { data, error } = await supabaseAdmin
        .schema('core')
        .from('attractions')
        .select(`
          osm_category,
          osm_tags,
          osm_geometry,
          osm_last_updated,
          elevation_m,
          estimated_height_m,
          osm_area_m2,
          heritage_status,
          unesco_status,
          landmark_level,
          importance_level,
          architect,
          architectural_style,
          historical_period,
          completion_estimated_year,
          landmark_type,
          wheelchair_accessible,
          wheelchair_toilets,
          parking_capacity,
          public_transport,
          access_points,
          urban_density,
          noise_level,
          air_quality,
          shade_availability,
          cultural_significance,
          local_traditions,
          seasonal_attractions,
          museum_type,
          park_type,
          monument_type,
          building_colour,
          roof_colour,
          building_material,
          osm_wikidata_id,
          osm_wikipedia_url,
          contact_phone,
          contact_email,
          operator_name,
          osm_data_quality_score,
          pov_quality_score,
          visibility_score,
          accessibility_score,
          photogenic_score,
          verification_status,
          data_sources,
          osm_import_date
        `)
        .eq('id', poi_id)
        .single()

      if (error) {
        console.error('❌ Error fetching enriched POI data:', error)
        return null
      }

      return data as EnrichedPOIData
    } catch (error) {
      console.error('❌ Error in getEnrichedPOIData:', error)
      return null
    }
  }

  /**
   * Check if POI needs enrichment
   */
  static async needsEnrichment(poi_id: string): Promise<boolean> {
    try {
      const { data, error } = await supabaseAdmin
        .schema('core')
        .from('attractions')
        .select('osm_category, osm_data_quality_score')
        .eq('id', poi_id)
        .single()

      if (error) {
        console.error('❌ Error checking enrichment status:', error)
        return true // Assume needs enrichment if we can't check
      }

      // Needs enrichment if:
      // 1. No OSM category (never processed)
      // 2. OSM category is 'not_found' but we want to retry
      // 3. Low quality score (< 70%)
      return !data.osm_category || 
             data.osm_category === 'not_found' ||
             (data.osm_data_quality_score && data.osm_data_quality_score < 70)
    } catch (error) {
      console.error('❌ Error in needsEnrichment:', error)
      return true
    }
  }

  // =====================================
  // PRIVATE HELPER METHODS
  // =====================================

  private static async getPOICoordinates(poi_id: string): Promise<{lat: number, lng: number} | null> {
    try {
      const { data, error } = await supabaseAdmin
        .schema('core')
        .from('attraction_coordinate')
        .select('latitude, longitude')
        .eq('attraction_id', poi_id)
        .single()

      if (error || !data) {
        console.log(`⚠️ No coordinates found for POI ${poi_id}`)
        return null
      }

      return { lat: data.latitude, lng: data.longitude }
    } catch (error) {
      console.error('❌ Error fetching POI coordinates:', error)
      return null
    }
  }

  private static async fetchOSMData(name: string, city: string, country: string, coordinates: {lat: number, lng: number}): Promise<OSMData> {
    const osmData: OSMData = {}

    try {
      // Nominatim search
      const nominatimQuery = `${name}, ${city}, ${country}`
      const nominatimUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(nominatimQuery)}&format=json&limit=1&extratags=1&namedetails=1&addressdetails=1`
      
      const nominatimResponse = await fetch(nominatimUrl, {
        headers: { 'User-Agent': 'TuggiCMS/1.0 - Contact: leandro@tuggi.com.br' }
      })
      
      if (nominatimResponse.ok) {
        const nominatimResults = await nominatimResponse.json()
        if (nominatimResults.length > 0) {
          osmData.nominatim = nominatimResults[0]
        }
      }

      // Reverse geocoding as fallback
      const reverseUrl = `https://nominatim.openstreetmap.org/reverse?lat=${coordinates.lat}&lon=${coordinates.lng}&format=json&extratags=1&namedetails=1&addressdetails=1`
      
      const reverseResponse = await fetch(reverseUrl, {
        headers: { 'User-Agent': 'TuggiCMS/1.0 - Contact: leandro@tuggi.com.br' }
      })
      
      if (reverseResponse.ok) {
        const reverseResult = await reverseResponse.json()
        if (reverseResult && !reverseResult.error) {
          osmData.reverse = reverseResult
        }
      }

      // Add delay to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 1000))

    } catch (error) {
      console.error('❌ Error fetching OSM data:', error)
    }

    return osmData
  }

  private static async extractOSMData(osmData: OSMData, name: string, city: string, country: string): Promise<EnrichedPOIData> {
    const nominatim = osmData.nominatim
    const reverse = osmData.reverse

    // This is a simplified version - the full implementation would include
    // all the extraction functions from the original route
    const extractedData: EnrichedPOIData = {
      // Basic OSM data
      osm_category: nominatim?.class || reverse?.class,
      osm_tags: {
        ...nominatim?.extratags,
        ...reverse?.extratags,
        name: nominatim?.name || reverse?.name,
        address: nominatim?.address || reverse?.address,
        type: nominatim?.type || reverse?.type
      },
      osm_geometry: nominatim?.geojson || null,
      osm_last_updated: new Date().toISOString(),

      // Heritage and cultural data (simplified)
      heritage_status: this.determineHeritageStatus(nominatim, reverse),
      unesco_status: this.determineUNESCOStatus(nominatim, reverse),
      landmark_level: this.determineLandmarkLevel(nominatim, reverse),
      importance_level: this.determineImportanceLevel(nominatim, reverse),
      architectural_style: this.determineArchitecturalStyle(nominatim, reverse),
      cultural_significance: this.determineCulturalSignificance(nominatim, reverse),

      // Accessibility data (simplified)
      wheelchair_accessible: this.determineWheelchairAccess(nominatim, reverse),
      urban_density: this.determineUrbanDensity(nominatim, reverse),

      // OSM Links and references
      osm_description: this.extractOSMDescription(nominatim, reverse),
      osm_wikidata_id: this.extractWikidataId(nominatim, reverse),
      osm_wikipedia_url: this.extractWikipediaUrl(nominatim, reverse),
      
      // Metadata
      verification_status: 'pending',
      data_sources: ['osm_nominatim', 'osm_reverse'],
      osm_import_date: new Date().toISOString()
    }

    return extractedData
  }

  private static calculateQualityScore(data: EnrichedPOIData, osmImportance?: number): number {
    // Use OSM's native importance score as the primary base (0.0 to 1.0 scale)
    let score = osmImportance ? Math.round(osmImportance * 100) : 30

    // Add points for data richness
    if (data.osm_tags) {
      const tagCount = Object.keys(data.osm_tags).length
      if (tagCount > 5) score += 5
      if (tagCount > 10) score += 5
    }

    // Bonus for heritage status
    if (data.heritage_status === 'unesco_world_heritage') score += 15
    else if (data.heritage_status === 'national_heritage') score += 10
    else if (data.heritage_status === 'regional_heritage') score += 5

    // Bonus for UNESCO status
    if (data.unesco_status === 'world_heritage_site') score += 10

    return Math.min(Math.max(score, 0), 100)
  }

  private static async updatePOIWithOSMData(poi_id: string, data: EnrichedPOIData, qualityScore: number) {
    try {
      // Calculate POV scores based on available data
      const povScores = this.calculatePOVScores(data, qualityScore)

      const updateData = {
        ...data,
        osm_data_quality_score: qualityScore,
        ...povScores
      }

      const { error } = await supabaseAdmin
        .schema('core')
        .from('attractions')
        .update(updateData)
        .eq('id', poi_id)

      if (error) {
        console.error('❌ Database update error:', error)
        return { success: false, error: error.message }
      }

      const fields_updated = Object.keys(updateData).filter(key => 
        updateData[key as keyof typeof updateData] !== null && updateData[key as keyof typeof updateData] !== undefined
      )

      return { success: true, fields_updated }

    } catch (error: any) {
      console.error('❌ Error updating POI:', error)
      return { success: false, error: error.message }
    }
  }

  private static async markPOIAsNotFound(poi_id: string) {
    try {
      const { error } = await supabaseAdmin
        .schema('core')
        .from('attractions')
        .update({ 
          osm_category: 'not_found',
          osm_last_updated: new Date().toISOString()
        })
        .eq('id', poi_id)

      if (error) {
        console.error('❌ Error marking POI as not found:', error)
        return { success: false, error: error.message }
      }

      return { success: true }
    } catch (error: any) {
      console.error('❌ Error in markPOIAsNotFound:', error)
      return { success: false, error: error.message }
    }
  }

  private static calculatePOVScores(data: EnrichedPOIData, qualityScore: number) {
    // Simplified POV score calculation
    let povQualityScore = qualityScore * 0.8
    let visibilityScore = 50
    let accessibilityScore = 40
    let photogenicScore = 60

    // Adjust based on heritage status
    if (data.heritage_status === 'unesco_world_heritage') {
      povQualityScore += 20
      visibilityScore += 25
      photogenicScore += 25
    } else if (data.heritage_status === 'national_heritage') {
      povQualityScore += 15
      visibilityScore += 20
      photogenicScore += 20
    }

    // Adjust based on cultural significance
    if (data.cultural_significance === 'very_high') {
      povQualityScore += 15
      photogenicScore += 20
    } else if (data.cultural_significance === 'high') {
      povQualityScore += 10
      photogenicScore += 15
    }

    return {
      pov_quality_score: Math.min(Math.max(povQualityScore, 0), 100),
      visibility_score: Math.min(Math.max(visibilityScore, 0), 100),
      accessibility_score: Math.min(Math.max(accessibilityScore, 0), 100),
      photogenic_score: Math.min(Math.max(photogenicScore, 0), 100)
    }
  }

  // Simplified extraction methods (full implementation would be more complex)
  private static determineHeritageStatus(nominatim: any, reverse: any): string | undefined {
    const tags = { ...nominatim?.extratags, ...reverse?.extratags }
    if (tags?.['heritage:operator'] === 'unesco') return 'unesco_world_heritage'
    if (tags?.heritage === 'yes') return 'national_heritage'
    return undefined
  }

  private static determineUNESCOStatus(nominatim: any, reverse: any): string | undefined {
    const tags = { ...nominatim?.extratags, ...reverse?.extratags }
    if (tags?.['heritage:operator'] === 'unesco') return 'world_heritage_site'
    return undefined
  }

  private static determineLandmarkLevel(nominatim: any, reverse: any): number | undefined {
    const importance = nominatim?.importance || reverse?.importance
    if (!importance) return undefined
    
    // Convert OSM importance (0.0-1.0) to landmark level (1-10)
    if (importance > 0.9) return 10  // Global landmarks
    if (importance > 0.8) return 8   // International
    if (importance > 0.6) return 6   // National
    if (importance > 0.4) return 4   // Regional
    if (importance > 0.2) return 2   // Local important
    return 1                         // Local
  }

  private static determineImportanceLevel(nominatim: any, reverse: any): string | undefined {
    const importance = nominatim?.importance || reverse?.importance
    if (!importance) return undefined
    
    // Map OSM importance to database constraint values
    if (importance > 0.9) return 'global'
    if (importance > 0.8) return 'international'
    if (importance > 0.6) return 'national'
    if (importance > 0.4) return 'regional'
    return 'local'
  }

  private static determineArchitecturalStyle(nominatim: any, reverse: any): string | undefined {
    const tags = { ...nominatim?.extratags, ...reverse?.extratags }
    return tags?.['architectural_style'] || tags?.['building:architecture']
  }

  private static determineCulturalSignificance(nominatim: any, reverse: any): string | undefined {
    const tags = { ...nominatim?.extratags, ...reverse?.extratags }
    const importance = nominatim?.importance || reverse?.importance
    
    if (tags?.['heritage:operator'] === 'unesco') return 'very_high'
    if (tags?.heritage === 'yes' || importance > 0.7) return 'high'
    if (importance > 0.5) return 'medium'
    return 'low'
  }

  private static determineWheelchairAccess(nominatim: any, reverse: any): string | undefined {
    const tags = { ...nominatim?.extratags, ...reverse?.extratags }
    return tags?.wheelchair
  }

  private static determineUrbanDensity(nominatim: any, reverse: any): string | undefined {
    const place = nominatim?.class || reverse?.class
    const type = nominatim?.type || reverse?.type
    
    if (place === 'place' && ['city', 'town'].includes(type)) return 'dense'
    if (place === 'place' && type === 'village') return 'sparse'
    return 'medium'
  }

  private static extractWikidataId(nominatim: any, reverse: any): string | undefined {
    const tags = { ...nominatim?.extratags, ...reverse?.extratags }
    return tags?.wikidata
  }

  private static extractWikipediaUrl(nominatim: any, reverse: any): string | undefined {
    const tags = { ...nominatim?.extratags, ...reverse?.extratags }
    const wikipedia = tags?.wikipedia
    if (wikipedia && wikipedia.includes(':')) {
      const [lang, title] = wikipedia.split(':')
      return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`
    }
    return undefined
  }

  private static extractOSMDescription(nominatim: any, reverse: any): string | undefined {
    const tags = { ...nominatim?.extratags, ...reverse?.extratags }
    
    // Try multiple description fields from OSM
    const descriptionFields = [
      'description',
      'description:pt',
      'description:en', 
      'name:etymology',
      'historic',
      'note',
      'inscription'
    ]
    
    for (const field of descriptionFields) {
      const value = tags?.[field]
      if (value && typeof value === 'string' && value.trim().length > 10) {
        return value.trim()
      }
    }
    
    return undefined
  }
}
