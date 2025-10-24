/**
 * OSM Service - KISS SIMPLIFIED
 * 
 * Single service for all OSM operations:
 * - Parse GeoJSON files
 * - Extract location data
 * - Import POIs to database
 * 
 * @module lib/services/osm-service-simple
 */

import { SimpleOSMPOI, ImportResults } from '../hooks/use-osm-importer-simple'

export class OSMService {
  /**
   * Parse GeoJSON file to POIs
   */
  static async parseGeoJSON(file: File): Promise<SimpleOSMPOI[]> {
    const text = await file.text()
    const geojson = JSON.parse(text)

    if (geojson.type !== 'FeatureCollection') {
      throw new Error('Invalid GeoJSON: must be FeatureCollection')
    }

    return geojson.features.map((feature: any, index: number) => ({
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
    }))
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
    try {
      const response = await fetch('/api/osm-importer/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ pois })
      })

      if (!response.ok) {
        throw new Error(`Import failed: ${response.statusText}`)
      }

      const results = await response.json()
      return {
        success: true,
        imported: results.imported || pois.length,
        errors: results.errors || []
      }
    } catch (error) {
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
