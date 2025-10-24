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
      const response = await fetch('/api/local-db/stats')
      
      if (!response.ok) {
        console.error('❌ [SERVICE] Error getting local stats:', response.statusText)
        return null
      }

      const results = await response.json()
      console.log('✅ [SERVICE] Local database stats retrieved:', results)
      
      return results.stats || null
    } catch (error) {
      console.error('❌ [SERVICE] Error getting local stats:', error)
      return null
    }
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

    // Save directly to local database
    const results = await this.saveToLocalDB(
      geojson.features.map((feature: any, index: number) => ({
        _id: `osm-${Date.now()}-${index}`,
        properties: {
          name: feature.properties.name || feature.properties['name:en'] || feature.properties['name:pt'] || 'Unnamed POI',
          city: feature.properties['addr:city'] || feature.properties['is_in:city'] || feature.properties['addr:suburb'] || null,
          state: feature.properties['addr:state'] || feature.properties['is_in:state'] || feature.properties['addr:province'] || null,
          country: feature.properties['addr:country'] || feature.properties['is_in:country'] || null,
          category: this.getPrimaryCategory(feature.properties),
          ...feature.properties
        },
        geometry: feature.geometry
      })),
      file.name
    )
    
    console.log('✅ [SERVICE] Parsing and saving completed:', results)
    return results
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
          category: this.getPrimaryCategory(feature.properties),
          ...feature.properties
        },
        geometry: feature.geometry
      }
      
      // Log first few POIs for debugging
      if (index < 3) {
        console.log(`📍 [SERVICE] POI ${index}:`, {
          id: poi._id,
          name: poi.properties.name,
          city: poi.properties.city,
          category: poi.properties.category,
          hasGeometry: !!poi.geometry
        })
      }
      
      return poi
    })
    
    console.log('✅ [SERVICE] Parsing completed:', { totalFeatures: features.length })
    return features
  }

  /**
   * Extract primary category from OSM tags
   */
  private static getPrimaryCategory(properties: Record<string, any>): string | null {
    if (!properties) return null

    const priorityTags = ['tourism', 'amenity', 'historic', 'natural', 'leisure', 'shop', 'highway', 'building']
    for (const tag of priorityTags) {
      if (properties[tag]) return `${tag}=${properties[tag]}`
    }
    return null
  }

  /**
   * Import POIs to database
   */
  static async importPOIs(pois: SimpleOSMPOI[]): Promise<ImportResults> {
    console.log('📤 [SERVICE] Starting import to database:', { poisCount: pois.length })
    
    try {
      // Convert SimpleOSMPOI to EditableOSMPOI format expected by API
      const editablePOIs = pois.map(poi => ({
        ...poi,
        _selected: false,
        _edited: false,
        _editedFields: {}
      }))
      
      console.log('🔄 [SERVICE] Converted to EditableOSMPOI format')
      console.log('🌐 [SERVICE] Making API call to /api/osm-importer/import')
      
      const response = await fetch('/api/osm-importer/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          pois: editablePOIs,
          sourceFile: 'uploaded-file.geojson' // Default source file name
        })
      })

      console.log('📡 [SERVICE] API response received:', { 
        status: response.status, 
        statusText: response.statusText,
        ok: response.ok 
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('❌ [SERVICE] API error response:', errorText)
        throw new Error(`Import failed: ${response.statusText} - ${errorText}`)
      }

      const results = await response.json()
      console.log('✅ [SERVICE] Import API success:', results)
      
      return {
        success: true,
        imported: results.imported || pois.length,
        errors: results.errors || []
      }
    } catch (error) {
      console.error('❌ [SERVICE] Import failed:', error)
      return {
        success: false,
        imported: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error']
      }
    }
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
