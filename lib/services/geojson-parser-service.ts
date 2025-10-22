/**
 * GeoJSON Parser Service
 * 
 * Handles GeoJSON file parsing and metadata extraction:
 * - Parse GeoJSON files (streaming for large files)
 * - Extract unique cities and categories
 * - Generate OSM category statistics
 * 
 * @module lib/services/geojson-parser-service
 */

import { OSMFeature, OSMCategory } from '@/types/osm-importer'

export class GeoJSONParserService {
  /**
   * Parse GeoJSON incrementally (streaming for large files)
   */
  async *parseGeoJSON(file: File): AsyncGenerator<OSMFeature[], void, unknown> {
    const text = await file.text()
    const geojson = JSON.parse(text) // For now, simple parse (optimize later with streaming JSON parser)

    if (geojson.type !== 'FeatureCollection') {
      throw new Error('Invalid GeoJSON: must be FeatureCollection')
    }

    const features = geojson.features as OSMFeature[]
    const chunkSize = 100

    for (let i = 0; i < features.length; i += chunkSize) {
      yield features.slice(i, i + chunkSize)
    }
  }

  /**
   * Parse GeoJSON from text content
   */
  parseGeoJSONFromText(content: string): OSMFeature[] {
    const geojson = JSON.parse(content)

    if (geojson.type !== 'FeatureCollection') {
      throw new Error('Invalid GeoJSON: must be FeatureCollection')
    }

    return geojson.features as OSMFeature[]
  }

  /**
   * Extract unique cities from features
   */
  extractUniqueCities(features: OSMFeature[]): string[] {
    const cities = new Set<string>()
    
    features.forEach(f => {
      // GeoJSON properties are directly in f.properties, not f.properties.tags
      const props = f.properties || {}
      const city = props['addr:city'] || 
                   props['is_in:city'] ||
                   props['addr:suburb'] ||
                   props['city'] ||
                   props['place']
      if (city) cities.add(city)
    })
    
    return Array.from(cities).sort()
  }

  /**
   * Extract OSM categories with counts
   */
  extractOSMCategories(features: OSMFeature[]): OSMCategory[] {
    const categories = new Map<string, number>()
    const priorityKeys = ['tourism', 'amenity', 'historic', 'natural', 'leisure', 'shop', 'craft', 'office', 'highway', 'barrier', 'crossing', 'waterway', 'railway', 'public_transport', 'man_made', 'landuse', 'building']

    features.forEach(f => {
      // GeoJSON properties are directly in f.properties, not f.properties.tags
      const props = f.properties || {}
      for (const key of priorityKeys) {
        const value = props[key]
        if (value) {
          const category = `${key}=${value}`
          categories.set(category, (categories.get(category) || 0) + 1)
        }
      }
    })

    // Convert to OSMCategory array
    return Array.from(categories.entries()).map(([category, count]) => {
      const [key, value] = category.split('=')
      return {
        key,
        value,
        label: category,
        count,
        group: this.getCategoryGroup(key)
      }
    }).sort((a, b) => b.count - a.count)
  }

  /**
   * Get category group for organization
   */
  private getCategoryGroup(key: string): string {
    const groups: Record<string, string> = {
      'tourism': 'Tourism',
      'amenity': 'Amenities',
      'historic': 'Historic',
      'natural': 'Natural',
      'leisure': 'Leisure',
      'shop': 'Shopping',
      'craft': 'Craft',
      'office': 'Office'
    }
    return groups[key] || 'Other'
  }

  /**
   * Extract bounding box from features
   */
  extractBoundingBox(features: OSMFeature[]): { north: number; south: number; east: number; west: number } | null {
    if (features.length === 0) return null

    let north = -90, south = 90, east = -180, west = 180

    features.forEach(f => {
      const coords = this.extractCoordinates(f.geometry)
      if (coords) {
        const [lng, lat] = coords
        north = Math.max(north, lat)
        south = Math.min(south, lat)
        east = Math.max(east, lng)
        west = Math.min(west, lng)
      }
    })

    return { north, south, east, west }
  }

  /**
   * Extract coordinates from geometry
   */
  private extractCoordinates(geometry: OSMFeature['geometry']): [number, number] | null {
    if (geometry.type === 'Point') {
      const coords = geometry.coordinates as number[]
      return [coords[0], coords[1]]
    }
    // For polygons, use centroid (implement if needed)
    return null
  }

  /**
   * Get file statistics
   */
  getFileStats(features: OSMFeature[]): {
    total_features: number
    point_features: number
    polygon_features: number
    line_features: number
    cities_count: number
    categories_count: number
  } {
    const cities = this.extractUniqueCities(features)
    const categories = this.extractOSMCategories(features)
    
    const geometryTypes = features.reduce((acc, f) => {
      acc[f.geometry.type] = (acc[f.geometry.type] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    return {
      total_features: features.length,
      point_features: geometryTypes.Point || 0,
      polygon_features: geometryTypes.Polygon || 0,
      line_features: geometryTypes.LineString || 0,
      cities_count: cities.length,
      categories_count: categories.length
    }
  }

  /**
   * Filter features by criteria
   */
  filterFeatures(
    features: OSMFeature[],
    filters: {
      cities?: string[]
      categories?: string[]
      search_term?: string
      bounding_box?: { north: number; south: number; east: number; west: number }
    }
  ): OSMFeature[] {
    let filtered = features

    // City filter
    if (filters.cities && filters.cities.length > 0) {
      filtered = filtered.filter(f => {
        // GeoJSON properties are directly in f.properties, not f.properties.tags
        const props = f.properties || {}
        const city = props['addr:city'] || 
                     props['is_in:city'] ||
                     props['addr:suburb'] ||
                     props['city'] ||
                     props['place']
        return city && filters.cities!.includes(city)
      })
    }

    // Category filter
    if (filters.categories && filters.categories.length > 0) {
      filtered = filtered.filter(f => {
        // GeoJSON properties are directly in f.properties, not f.properties.tags
        const props = f.properties || {}
        return filters.categories!.some(cat => {
          const [key, value] = cat.split('=')
          return props[key] === value
        })
      })
    }

    // Search term
    if (filters.search_term) {
      const term = filters.search_term.toLowerCase()
      filtered = filtered.filter(f => {
        // GeoJSON properties are directly in f.properties, not f.properties.tags
        const props = f.properties || {}
        return props.name?.toLowerCase().includes(term) ||
               props['name:en']?.toLowerCase().includes(term) ||
               props['name:pt']?.toLowerCase().includes(term) ||
               props['name:de']?.toLowerCase().includes(term) ||
               props['name:fr']?.toLowerCase().includes(term)
      })
    }

    // Bounding box filter
    if (filters.bounding_box) {
      const { north, south, east, west } = filters.bounding_box
      filtered = filtered.filter(f => {
        const coords = this.extractCoordinates(f.geometry)
        if (!coords) return false
        
        const [lng, lat] = coords
        return lat >= south && lat <= north && lng >= west && lng <= east
      })
    }

    return filtered
  }
}
