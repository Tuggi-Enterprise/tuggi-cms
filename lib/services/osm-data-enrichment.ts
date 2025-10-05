import { getSupabase } from '../core/supabase-client'

// Use service role for database operations (has full access)
const supabase = getSupabase('service')

export interface OSMEnrichmentData {
  // Basic OSM data
  osm_category?: string
  osm_tags?: any
  osm_data_quality_score?: number
  osm_geometry?: string // WKT format for PostGIS
  osm_area_m2?: number
  
  // Elevation and height data
  elevation_m?: number
  estimated_height_m?: number
  
  // Enhanced data from OSM tags
  heritage_status?: string
  architectural_style?: string
  historical_period?: string
  landmark_type?: string
  architect?: string
  construction_status?: string
  completion_estimated_year?: number
  
  // UNESCO data
  unesco_status?: string
  unesco_inscription_date?: string
  unesco_reference?: string
  
  // Accessibility data
  wheelchair_accessible?: boolean
  wheelchair_toilets?: boolean
  
  // Transportation data
  parking_capacity?: string
  public_transport?: string[]
  access_points?: string[]
  
  // Museum-specific data
  museum_type?: string
  collection_focus?: string
  target_audience?: string
  educational_programs?: boolean
  
  // Park-specific data
  park_type?: string
  vegetation_type?: string
  water_features?: boolean
  sports_facilities?: boolean
  playground?: boolean
  
  // Monument-specific data
  monument_type?: string
  commemorated_event?: string
  commemorated_person?: string
  
  // Building data
  building_colour?: string
  roof_colour?: string
  building_material?: string
  
  // Wikidata integration
  osm_wikidata_id?: string
  osm_wikipedia_url?: string
  
  // Contact and operator info
  contact_phone?: string
  contact_email?: string
  operator_name?: string
  
  // Data sources tracking
  data_sources?: string[]
  osm_import_date?: string
}

export class OSMDataEnrichmentService {
  /**
   * Extract enrichment data from OSM Nominatim result
   * Integrates with existing /api/pois/enrich-osm functionality
   */
  static extractFromNominatim(osmResult: any): OSMEnrichmentData {
    const enrichmentData: OSMEnrichmentData = {}
    
    // Basic OSM data
    if (osmResult.category) enrichmentData.osm_category = osmResult.category
    if (osmResult.type) enrichmentData.landmark_type = osmResult.type
    
    // Extract tags from extratags if available
    const tags = osmResult.extratags || {}
    if (Object.keys(tags).length > 0) {
      enrichmentData.osm_tags = {
        ...tags,
        name: osmResult.name,
        display_name: osmResult.display_name,
        type: osmResult.type,
        class: osmResult.category,
        importance: osmResult.importance
      }
      
      // Heritage and historical data
      if (tags.heritage) enrichmentData.heritage_status = this.mapHeritageStatus(tags.heritage)
      if (tags['heritage:operator']) enrichmentData.heritage_status = this.mapHeritageStatus(tags['heritage:operator'])
      if (tags.historic) enrichmentData.landmark_type = tags.historic
      if (tags.architect) enrichmentData.architect = tags.architect
      if (tags['start_date']) enrichmentData.completion_estimated_year = this.extractYear(tags['start_date'])
      if (tags['construction_date']) enrichmentData.completion_estimated_year = this.extractYear(tags['construction_date'])
      if (tags.architectural_style) enrichmentData.architectural_style = tags.architectural_style
      
      // UNESCO data
      if (tags.wikidata && tags.wikidata.includes('Q')) enrichmentData.osm_wikidata_id = tags.wikidata
      if (tags.wikipedia) enrichmentData.osm_wikipedia_url = `https://en.wikipedia.org/wiki/${tags.wikipedia.replace('en:', '')}`
      if (tags['heritage:website']) enrichmentData.unesco_reference = tags['heritage:website']
      
      // Accessibility
      if (tags.wheelchair) enrichmentData.wheelchair_accessible = tags.wheelchair === 'yes'
      if (tags['toilets:wheelchair']) enrichmentData.wheelchair_toilets = tags['toilets:wheelchair'] === 'yes'
      
      // Transportation
      if (tags.parking) enrichmentData.parking_capacity = this.mapParkingCapacity(tags.parking)
      if (tags['public_transport']) {
        enrichmentData.public_transport = [tags['public_transport']]
      }
      
      // Museum data
      if (tags.museum) enrichmentData.museum_type = tags.museum
      if (tags['museum:type']) enrichmentData.museum_type = tags['museum:type']
      if (tags.subject) enrichmentData.collection_focus = tags.subject
      if (tags.target_audience) enrichmentData.target_audience = this.mapTargetAudience(tags.target_audience)
      if (tags.educational_programs) enrichmentData.educational_programs = tags.educational_programs === 'yes'
      
      // Park data
      if (tags.leisure === 'park') enrichmentData.park_type = 'public_park'
      if (tags.park_type) enrichmentData.park_type = tags.park_type
      if (tags.natural) enrichmentData.vegetation_type = tags.natural
      if (tags.water) enrichmentData.water_features = tags.water === 'yes'
      if (tags.sport) enrichmentData.sports_facilities = true
      if (tags.playground) enrichmentData.playground = tags.playground === 'yes'
      
      // Monument data
      if (tags.memorial) enrichmentData.monument_type = tags.memorial
      if (tags.subject) enrichmentData.commemorated_person = tags.subject
      if (tags.historic === 'memorial') enrichmentData.monument_type = 'memorial'
      
      // Building data
      if (tags.building_colour || tags['building:colour']) {
        enrichmentData.building_colour = tags.building_colour || tags['building:colour']
      }
      if (tags.roof_colour || tags['roof:colour']) {
        enrichmentData.roof_colour = tags.roof_colour || tags['roof:colour']
      }
      if (tags.building_material || tags['building:material']) {
        enrichmentData.building_material = tags.building_material || tags['building:material']
      }
      
      // Contact info
      if (tags.phone) enrichmentData.contact_phone = tags.phone
      if (tags.email) enrichmentData.contact_email = tags.email
      if (tags.operator) enrichmentData.operator_name = tags.operator
      
      // Elevation data
      if (tags.ele) enrichmentData.elevation_m = parseInt(tags.ele)
      if (tags.height) enrichmentData.estimated_height_m = parseFloat(tags.height)
      if (tags['building:height']) enrichmentData.estimated_height_m = parseFloat(tags['building:height'])
    }
    
    // Calculate data quality score
    enrichmentData.osm_data_quality_score = this.calculateDataQualityScore(osmResult, tags)
    
    // Set data sources
    enrichmentData.data_sources = ['osm_nominatim']
    enrichmentData.osm_import_date = new Date().toISOString()
    
    return enrichmentData
  }
  
  /**
   * Extract enrichment data using the comprehensive logic from /api/pois/enrich-osm
   * This reuses the existing detailed extraction functions
   */
  static async extractFromExistingAPI(
    attractionId: string,
    osmResult: any
  ): Promise<OSMEnrichmentData> {
    try {
      // Use the existing comprehensive API
      const response = await fetch('/api/pois/enrich-osm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          poi_id: attractionId,
          name: osmResult.display_name?.split(',')[0] || '',
          city: osmResult.address?.city || osmResult.address?.town || '',
          country: osmResult.address?.country || '',
        }),
      })
      
      if (response.ok) {
        const result = await response.json()
        if (result.success) {
          console.log(`✅ Successfully enriched using existing API: ${result.fields_updated?.length || 0} fields updated`)
          return {
            data_sources: ['existing_osm_api'],
            osm_data_quality_score: result.data_quality_score
          }
        }
      }
      
      console.log('⚠️ Existing API enrichment failed, falling back to basic extraction')
      return {}
      
    } catch (error) {
      console.error('❌ Error using existing API for enrichment:', error)
      return {}
    }
  }
  
  /**
   * Extract enrichment data from boundary geometry
   */
  static extractFromBoundary(boundary: any, boundarySource: string): OSMEnrichmentData {
    const enrichmentData: OSMEnrichmentData = {}
    
    if (boundary.area_m2) {
      enrichmentData.osm_area_m2 = Math.round(boundary.area_m2)
    }
    
    if (boundary.coordinates && boundary.coordinates.length > 0) {
      // Convert coordinates to WKT format for PostGIS
      const coords = boundary.coordinates
      const wktCoordinates = coords
        .map((coord: any) => `${coord.lng} ${coord.lat}`)
        .join(', ')
      
      // Ensure polygon is closed (first point = last point)
      const firstPoint = coords[0]
      const lastPoint = coords[coords.length - 1]
      let closedWktCoordinates = wktCoordinates
      
      if (firstPoint.lng !== lastPoint.lng || firstPoint.lat !== lastPoint.lat) {
        closedWktCoordinates += `, ${firstPoint.lng} ${firstPoint.lat}`
      }
      
      enrichmentData.osm_geometry = `POLYGON((${closedWktCoordinates}))`
    }
    
    // Add boundary source to data sources
    enrichmentData.data_sources = [boundarySource]
    
    return enrichmentData
  }
  
  /**
   * Save enrichment data to attractions table
   */
  static async saveEnrichmentData(attractionId: string, enrichmentData: OSMEnrichmentData): Promise<boolean> {
    try {
      console.log(`💾 Saving OSM enrichment data for attraction ${attractionId}`)
      console.log(`📊 Data fields: ${Object.keys(enrichmentData).join(', ')}`)
      
      // Handle geometry separately from other fields
      const updateData: any = { ...enrichmentData }
      delete updateData.osm_geometry // Remove geometry from regular update
      
      // Update non-geometry fields first
      const { error: updateError } = await supabase
        .schema('core')
        .from('attractions')
        .update({
          ...updateData,
          updated_at: new Date().toISOString()
        })
        .eq('id', attractionId)
      
      if (updateError) {
        console.error('❌ Error updating attraction data:', updateError)
        return false
      }
      
      // Handle geometry using RPC call in core schema
      let geometryError = null
      if (enrichmentData.osm_geometry) {
        try {
          console.log(`🔄 Updating geometry with WKT: ${enrichmentData.osm_geometry.substring(0, 100)}...`)
          
          // Use RPC to update geometry with PostGIS function in core schema
          const { error: geomError } = await supabase
            .schema('core')
            .rpc('update_attraction_osm_geometry', {
              p_attraction_id: attractionId,
              p_wkt_geometry: enrichmentData.osm_geometry
            })
          
          if (geomError) {
            console.error('❌ RPC geometry update failed:', geomError)
            geometryError = geomError
          } else {
            console.log('✅ Geometry updated successfully via RPC')
          }
        } catch (geomError) {
          console.error('❌ Error updating geometry:', geomError)
          geometryError = geomError
        }
      }
      
      const error = geometryError
      
      if (error) {
        console.error('❌ Error saving OSM enrichment data:', error)
        return false
      }
      
      console.log(`✅ OSM enrichment data saved successfully for attraction ${attractionId}`)
      return true
      
    } catch (error) {
      console.error('❌ Error in saveEnrichmentData:', error)
      return false
    }
  }
  
  /**
   * Map heritage status from OSM tags to our enum values
   */
  private static mapHeritageStatus(heritage: string): string {
    const heritageLower = heritage.toLowerCase()
    if (heritageLower.includes('unesco') || heritageLower.includes('world')) return 'unesco_world_heritage'
    if (heritageLower.includes('national')) return 'national_heritage'
    if (heritageLower.includes('regional')) return 'regional_heritage'
    if (heritageLower.includes('municipal') || heritageLower.includes('local')) return 'municipal_heritage'
    return 'local_heritage'
  }
  
  /**
   * Extract year from date string
   */
  private static extractYear(dateStr: string): number | undefined {
    const match = dateStr.match(/(\d{4})/)
    return match ? parseInt(match[1]) : undefined
  }
  
  /**
   * Map parking capacity from OSM tags
   */
  private static mapParkingCapacity(parking: string): string {
    const parkingLower = parking.toLowerCase()
    if (parkingLower.includes('no') || parkingLower.includes('none')) return 'none'
    if (parkingLower.includes('large') || parkingLower.includes('many')) return 'large'
    if (parkingLower.includes('medium')) return 'medium'
    if (parkingLower.includes('small') || parkingLower.includes('few')) return 'small'
    return 'medium' // default
  }
  
  /**
   * Map target audience from OSM tags
   */
  private static mapTargetAudience(audience: string): string {
    const audienceLower = audience.toLowerCase()
    if (audienceLower.includes('international')) return 'international'
    if (audienceLower.includes('national')) return 'national'
    if (audienceLower.includes('regional')) return 'regional'
    if (audienceLower.includes('academic')) return 'academic'
    return 'local_community'
  }
  
  /**
   * Calculate data quality score based on available information
   */
  private static calculateDataQualityScore(osmResult: any, tags: any): number {
    let score = 0
    
    // Base score for having basic data
    if (osmResult.display_name) score += 10
    if (osmResult.category) score += 10
    if (osmResult.type) score += 10
    
    // Bonus for having geometry
    if (osmResult.geojson) score += 15
    
    // Bonus for having tags
    const tagCount = Object.keys(tags).length
    if (tagCount > 0) score += Math.min(tagCount * 2, 20) // Max 20 points for tags
    
    // Bonus for specific valuable tags
    if (tags.wikidata) score += 5
    if (tags.wikipedia) score += 5
    if (tags.heritage) score += 5
    if (tags.architect) score += 3
    if (tags.start_date || tags.construction_date) score += 3
    if (tags.wheelchair) score += 2
    if (tags.phone || tags.email) score += 2
    if (tags.operator) score += 2
    if (tags.ele || tags.height) score += 3
    
    // Bonus for having address details
    if (osmResult.address) score += 5
    
    return Math.min(score, 100) // Cap at 100
  }
}
