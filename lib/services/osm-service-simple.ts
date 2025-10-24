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
   * Parse GeoJSON file and save directly to local database
   */
  static async parseGeoJSONToDB(file: File): Promise<{ success: boolean, imported: number, errors: string[] }> {
    console.log('📄 [SERVICE] Starting GeoJSON parsing to DB:', { name: file.name, size: file.size })
    
    const text = await file.text()
    console.log('📖 [SERVICE] File read, text length:', text.length)
    
    const geojson = JSON.parse(text)
    console.log('🔍 [SERVICE] JSON parsed, type:', geojson.type, 'features count:', geojson.features?.length)

    if (geojson.type !== 'FeatureCollection') {
      console.error('❌ [SERVICE] Invalid GeoJSON type:', geojson.type)
      throw new Error('Invalid GeoJSON: must be FeatureCollection')
    }

    // Debug: Log first feature structure
    if (geojson.features.length > 0) {
      console.log('🔍 [SERVICE] First feature structure:', {
        properties: geojson.features[0].properties,
        geometry: geojson.features[0].geometry,
        hasOsmId: !!geojson.features[0].properties?.osm_id,
        hasOsmType: !!geojson.features[0].properties?.osm_type
      })
    }

    // Debug: Log sample of features to check location data
    console.log('🔍 [SERVICE] Sample features with location data:')
    geojson.features.slice(0, 3).forEach((feature: any, index: number) => {
      const city = feature.properties['addr:city'] || feature.properties['is_in:city'] || feature.properties['addr:suburb']
      const state = feature.properties['addr:state'] || feature.properties['is_in:state'] || feature.properties['addr:province']
      const country = feature.properties['addr:country'] || feature.properties['is_in:country']
      
      if (city || state || country) {
        console.log(`📍 Feature ${index}:`, {
          name: feature.properties.name,
          city,
          state,
          country,
          hasAddrCity: !!feature.properties['addr:city'],
          hasAddrState: !!feature.properties['addr:state'],
          hasIsInCity: !!feature.properties['is_in:city'],
          hasIsInState: !!feature.properties['is_in:state']
        })
      }
    })

    // Process in chunks for large files to avoid memory issues
    const CHUNK_SIZE = 1000 // Process 1000 features at a time
    const totalFeatures = geojson.features.length
    let totalImported = 0
    let allErrors: string[] = []

    console.log(`🔄 [SERVICE] Processing ${totalFeatures} features in chunks of ${CHUNK_SIZE}`)

    for (let i = 0; i < totalFeatures; i += CHUNK_SIZE) {
      const chunk = geojson.features.slice(i, i + CHUNK_SIZE)
      const chunkNumber = Math.floor(i / CHUNK_SIZE) + 1
      const totalChunks = Math.ceil(totalFeatures / CHUNK_SIZE)
      
      console.log(`📦 [SERVICE] Processing chunk ${chunkNumber}/${totalChunks} (${chunk.length} features)`)
      
      const chunkResults = await OSMService.saveToLocalDB(
        chunk.map((feature: any, index: number) => ({
        _id: OSMService.generatePOIId(feature),
        properties: {
          name: feature.properties.name || feature.properties['name:en'] || feature.properties['name:pt'] || 'Unnamed POI',
          city: feature.properties['addr:city'] || feature.properties['is_in:city'] || feature.properties['addr:suburb'] || null,
          state: feature.properties['addr:state'] || feature.properties['is_in:state'] || feature.properties['addr:province'] || null,
          country: feature.properties['addr:country'] || feature.properties['is_in:country'] || null,
          category: OSMService.getPrimaryCategory(feature.properties),
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
      })),
      file.name
    )
    
    // Accumulate results
    if (chunkResults.success) {
      totalImported += chunkResults.imported
      console.log(`✅ [SERVICE] Chunk ${chunkNumber}/${totalChunks} completed: ${chunkResults.imported} imported`)
    } else {
      allErrors.push(...chunkResults.errors)
      console.error(`❌ [SERVICE] Chunk ${chunkNumber}/${totalChunks} failed:`, chunkResults.errors)
    }
    
    // Add small delay between chunks to prevent overwhelming the database
    if (i + CHUNK_SIZE < totalFeatures) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
  
  console.log(`✅ [SERVICE] All chunks processed: ${totalImported} total imported, ${allErrors.length} errors`)
  
  return {
    success: allErrors.length === 0,
    imported: totalImported,
    errors: allErrors
  }
  }

  /**
   * Parse GeoJSON file to POIs (legacy method for compatibility)
   */
  static async parseGeoJSON(file: File): Promise<SimpleOSMPOI[]> {
    console.log('📄 [SERVICE] Starting GeoJSON parsing (legacy):', { name: file.name, size: file.size })
    
    const text = await file.text()
    console.log('📖 [SERVICE] File read, text length:', text.length)
    
    const geojson = JSON.parse(text)
    console.log('🔍 [SERVICE] JSON parsed, type:', geojson.type, 'features count:', geojson.features?.length)

    if (geojson.type !== 'FeatureCollection') {
      console.error('❌ [SERVICE] Invalid GeoJSON type:', geojson.type)
      throw new Error('Invalid GeoJSON: must be FeatureCollection')
    }

    const features = geojson.features.map((feature: any, index: number) => {
      const poi = {
        _id: `osm-${Date.now()}-${index}`,
        properties: {
          name: feature.properties.name || feature.properties['name:en'] || feature.properties['name:pt'] || 'Unnamed POI',
          city: feature.properties['addr:city'] || feature.properties['is_in:city'] || feature.properties['addr:suburb'] || null,
          state: feature.properties['addr:state'] || feature.properties['is_in:state'] || feature.properties['addr:province'] || null,
          country: feature.properties['addr:country'] || feature.properties['is_in:country'] || null,
          category: OSMService.getPrimaryCategory(feature.properties),
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
      }
      
      return poi
    })

    console.log('✅ [SERVICE] Legacy parsing completed:', { featuresCount: features.length })
    return features
  }

  /**
   * Get primary OSM category for a feature
   */
  static getPrimaryCategory(properties: Record<string, any> | undefined): string | null {
    if (!properties) return null
    
    // Handle both direct properties and nested tags structure
    const tags = properties.tags || properties
    
    const priorityTags = ['tourism', 'amenity', 'historic', 'natural', 'leisure', 'shop', 'highway', 'building']
    for (const tag of priorityTags) {
      if (tags[tag]) return `${tag}=${tags[tag]}`
    }
    return null
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
