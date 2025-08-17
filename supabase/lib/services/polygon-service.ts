import { SupabaseClient } from '@supabase/supabase-js'
import { SavedPolygon, PolygonStats } from '@/types/poi-importer'
import { extractLocationFromAddressComponents, getCountryName } from '@/lib/utils'

export class PolygonService {
  constructor(private supabase: SupabaseClient) {}

  async fetchSavedPolygons(): Promise<SavedPolygon[]> {
    try {
      const { data, error } = await this.supabase
        .schema('core')
        .from('saved_polygons')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error

      const polygons = data
        .filter(item => item.paths && item.paths !== 'undefined')
        .map(item => {
          try {
            const geom = typeof item.paths === 'string' ? JSON.parse(item.paths) : item.paths
            
            // Validate geometry structure
            if (!geom || !geom.coordinates || !Array.isArray(geom.coordinates)) {
              console.error(`Invalid geometry for polygon ${item.id}: missing coordinates array`)
              return null
            }
            
            if (geom.coordinates.length === 0 || !Array.isArray(geom.coordinates[0])) {
              console.error(`Invalid geometry for polygon ${item.id}: empty or invalid coordinates[0]`)
              return null
            }
            
            return {
              id: item.id,
              name: item.name,
              paths: geom.coordinates[0].map((coord: number[]) => ({
                lat: coord[1],
                lng: coord[0]
              })),
              user_id: item.user_id,
              created_at: item.created_at,
              country_name: item.country_name
            }
          } catch (parseError) {
            console.error(`Error parsing polygon ${item.id}:`, parseError)
            return null
          }
        })
        .filter(polygon => polygon !== null)

      return polygons
    } catch (error) {
      console.error('Error fetching saved polygons:', error)
      throw error
    }
  }

  calculatePolygonArea(coords: Array<{ lat: number; lng: number }>): number {
    if (coords.length < 3) return 0
    
    let area = 0
    for (let i = 0; i < coords.length; i++) {
      const j = (i + 1) % coords.length
      area += coords[i].lat * coords[j].lng
      area -= coords[j].lat * coords[i].lng
    }
    return Math.abs(area / 2)
  }

  calculatePolygonStats(coords: Array<{ lat: number; lng: number }>): PolygonStats {
    return {
      vertices: coords.length,
      area: this.calculatePolygonArea(coords)
    }
  }

  async generatePolygonName(coordinates: Array<{ lat: number; lng: number }>): Promise<string> {
    if (coordinates.length === 0) return 'Custom Area'

    try {
      const center = this.calculatePolygonCenter(coordinates)
      const geocoder = new google.maps.Geocoder()
      
      const result = await new Promise<google.maps.GeocoderResult[]>((resolve, reject) => {
        geocoder.geocode({ location: center }, (results, status) => {
          if (status === 'OK' && results) {
            resolve(results)
          } else {
            reject(new Error(`Geocoding failed: ${status}`))
          }
        })
      })

      if (result && result.length > 0) {
        const addressComponents = result[0].address_components
        const locationInfo = extractLocationFromAddressComponents(addressComponents)
        
        const parts = []
        if (locationInfo.city) parts.push(locationInfo.city)
        if (locationInfo.country) parts.push(locationInfo.country)
        
        return parts.length > 0 ? parts.join(', ') : 'Custom Area'
      }

      return 'Custom Area'
    } catch (error) {
      console.error('Error generating polygon name:', error)
      return 'Custom Area'
    }
  }

  private calculatePolygonCenter(coordinates: Array<{ lat: number; lng: number }>): { lat: number; lng: number } {
    const latSum = coordinates.reduce((sum, coord) => sum + coord.lat, 0)
    const lngSum = coordinates.reduce((sum, coord) => sum + coord.lng, 0)
    
    return {
      lat: latSum / coordinates.length,
      lng: lngSum / coordinates.length
    }
  }

  private async getCountryFromCoordinates(lat: number, lng: number): Promise<string> {
    try {
      const geocoder = new google.maps.Geocoder()
      
      const result = await new Promise<google.maps.GeocoderResult[]>((resolve, reject) => {
        geocoder.geocode({ location: { lat, lng } }, (results, status) => {
          if (status === 'OK' && results) {
            resolve(results)
          } else {
            reject(new Error(`Geocoding failed: ${status}`))
          }
        })
      })

      if (result && result.length > 0) {
        const addressComponents = result[0].address_components
        const locationInfo = extractLocationFromAddressComponents(addressComponents)
        return locationInfo.country || 'Unknown'
      }

      return 'Unknown'
    } catch (error) {
      console.error('Error getting country from coordinates:', error)
      return 'Unknown'
    }
  }

  async savePolygon(
    name: string, 
    coordinates: Array<{ lat: number; lng: number }>, 
    country?: string
  ): Promise<SavedPolygon> {
    try {
      const polygonGeometry = {
        type: 'Polygon',
        coordinates: [coordinates.map(coord => [coord.lng, coord.lat])]
      }

      let countryName = country
      if (!countryName) {
        const center = this.calculatePolygonCenter(coordinates)
        countryName = await this.getCountryFromCoordinates(center.lat, center.lng)
      }

      const { data, error } = await this.supabase
        .schema('core')
        .from('saved_polygons')
        .insert([{
          name,
          paths: polygonGeometry,
          country_name: countryName
        }])
        .select()
        .single()

      if (error) throw error

      return {
        id: data.id,
        name: data.name,
        paths: coordinates,
        user_id: data.user_id,
        created_at: data.created_at,
        country_name: data.country_name
      }
    } catch (error) {
      console.error('Error saving polygon:', error)
      throw error
    }
  }

  calculateMapBounds(polygons: SavedPolygon[]): { 
    center: { lat: number; lng: number }, 
    zoom: number 
  } | null {
    if (polygons.length === 0) return null

    let bounds = {
      north: -90,
      south: 90,
      east: -180,
      west: 180
    }

    polygons.forEach(polygon => {
      polygon.paths.forEach(point => {
        bounds.north = Math.max(bounds.north, point.lat)
        bounds.south = Math.min(bounds.south, point.lat)
        bounds.east = Math.max(bounds.east, point.lng)
        bounds.west = Math.min(bounds.west, point.lng)
      })
    })

    const centerLat = (bounds.north + bounds.south) / 2
    const centerLng = (bounds.east + bounds.west) / 2
    
    // Calculate appropriate zoom level based on bounds
    const latDiff = bounds.north - bounds.south
    const lngDiff = bounds.east - bounds.west
    const maxDiff = Math.max(latDiff, lngDiff)
    
    let zoom = 10
    if (maxDiff < 0.01) zoom = 15
    else if (maxDiff < 0.05) zoom = 13
    else if (maxDiff < 0.1) zoom = 12
    else if (maxDiff < 0.5) zoom = 10
    else if (maxDiff < 1) zoom = 9
    else zoom = 8

    return {
      center: { lat: centerLat, lng: centerLng },
      zoom
    }
  }
} 