interface PlaceSearchResult {
  place_id: string
  name: string
  formatted_address: string
  geometry: {
    location: {
      lat: number
      lng: number
    }
  }
  types: string[]
  rating?: number
  user_ratings_total?: number
  photos?: Array<{
    photo_reference: string
    height: number
    width: number
  }>
  website?: string
  opening_hours?: {
    open_now: boolean
    weekday_text: string[]
  }
  price_level?: number
}

interface PlaceDetailsResult extends PlaceSearchResult {
  formatted_phone_number?: string
  international_phone_number?: string
  url?: string
  vicinity?: string
  business_status?: string
}

class GooglePlacesService {
  private apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  /**
   * Search for places within a polygon area
   */
  async searchPlacesInPolygon(
    polygon: Array<{lat: number, lng: number}>,
    type: string,
    keyword?: string
  ): Promise<PlaceSearchResult[]> {
    // Calculate the center and radius of the polygon for initial search
    const bounds = this.calculatePolygonBounds(polygon)
    const center = this.calculatePolygonCenter(polygon)
    const radius = this.calculatePolygonRadius(polygon, center)

    // Perform nearby search
    const nearbyResults = await this.nearbySearch(center, radius, type, keyword)
    
    // Filter results to only include places actually within the polygon
    const filteredResults = nearbyResults.filter(place => 
      this.isPointInPolygon(place.geometry.location, polygon)
    )

    return filteredResults
  }

  /**
   * Perform a Google Places Nearby Search
   */
  private async nearbySearch(
    center: {lat: number, lng: number},
    radius: number,
    type: string,
    keyword?: string
  ): Promise<PlaceSearchResult[]> {
    const params = new URLSearchParams({
      location: `${center.lat},${center.lng}`,
      radius: Math.min(radius, 50000).toString(), // Max 50km radius
      type: type,
      key: this.apiKey,
    })

    if (keyword) {
      params.append('keyword', keyword)
    }

    const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params}`
    
    try {
      const response = await fetch(url)
      const data = await response.json()

      if (data.status === 'OK') {
        return data.results || []
      } else {
        console.error('Google Places API error:', data.status, data.error_message)
        return []
      }
    } catch (error) {
      console.error('Error fetching places:', error)
      return []
    }
  }

  /**
   * Get detailed information about a specific place
   */
  async getPlaceDetails(placeId: string): Promise<PlaceDetailsResult | null> {
    const params = new URLSearchParams({
      place_id: placeId,
      fields: 'place_id,name,formatted_address,geometry,types,rating,user_ratings_total,photos,website,opening_hours,formatted_phone_number,international_phone_number,url,vicinity,business_status,price_level',
      key: this.apiKey,
    })

    const url = `https://maps.googleapis.com/maps/api/place/details/json?${params}`

    try {
      const response = await fetch(url)
      const data = await response.json()

      if (data.status === 'OK' && data.result) {
        return data.result
      } else {
        console.error('Google Places Details API error:', data.status, data.error_message)
        return null
      }
    } catch (error) {
      console.error('Error fetching place details:', error)
      return null
    }
  }

  /**
   * Calculate the bounding box of a polygon
   */
  private calculatePolygonBounds(polygon: Array<{lat: number, lng: number}>) {
    let minLat = Infinity, maxLat = -Infinity
    let minLng = Infinity, maxLng = -Infinity

    polygon.forEach(point => {
      minLat = Math.min(minLat, point.lat)
      maxLat = Math.max(maxLat, point.lat)
      minLng = Math.min(minLng, point.lng)
      maxLng = Math.max(maxLng, point.lng)
    })

    return { minLat, maxLat, minLng, maxLng }
  }

  /**
   * Calculate the center point of a polygon
   */
  private calculatePolygonCenter(polygon: Array<{lat: number, lng: number}>): {lat: number, lng: number} {
    let totalLat = 0, totalLng = 0
    
    polygon.forEach(point => {
      totalLat += point.lat
      totalLng += point.lng
    })

    return {
      lat: totalLat / polygon.length,
      lng: totalLng / polygon.length
    }
  }

  /**
   * Calculate approximate radius of polygon from center
   */
  private calculatePolygonRadius(polygon: Array<{lat: number, lng: number}>, center: {lat: number, lng: number}): number {
    let maxDistance = 0

    polygon.forEach(point => {
      const distance = this.haversineDistance(center, point)
      maxDistance = Math.max(maxDistance, distance)
    })

    return maxDistance * 1000 // Convert to meters
  }

  /**
   * Calculate distance between two points using Haversine formula
   */
  private haversineDistance(point1: {lat: number, lng: number}, point2: {lat: number, lng: number}): number {
    const R = 6371 // Earth's radius in kilometers
    const dLat = this.toRadians(point2.lat - point1.lat)
    const dLng = this.toRadians(point2.lng - point1.lng)
    
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(this.toRadians(point1.lat)) * Math.cos(this.toRadians(point2.lat)) *
              Math.sin(dLng/2) * Math.sin(dLng/2)
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
    return R * c
  }

  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180)
  }

  /**
   * Check if a point is inside a polygon using ray casting algorithm
   */
  private isPointInPolygon(point: {lat: number, lng: number}, polygon: Array<{lat: number, lng: number}>): boolean {
    const x = point.lng
    const y = point.lat
    let inside = false

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].lng
      const yi = polygon[i].lat
      const xj = polygon[j].lng
      const yj = polygon[j].lat

      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside
      }
    }

    return inside
  }
}

// Mock service for development when API key is not available
export class MockGooglePlacesService {
  async searchPlacesInPolygon(
    polygon: Array<{lat: number, lng: number}>,
    type: string,
    keyword?: string
  ): Promise<PlaceSearchResult[]> {
    // Calculate center for mock data positioning
    const center = this.calculateCenter(polygon)
    
    // Return mock data
    return [
      {
        place_id: `mock_${type}_1`,
        name: this.getMockName(type, 1),
        formatted_address: `123 Main St, City, Country`,
        geometry: {
          location: {
            lat: center.lat + (Math.random() - 0.5) * 0.01,
            lng: center.lng + (Math.random() - 0.5) * 0.01
          }
        },
        types: [type, 'point_of_interest'],
        rating: Number((Math.random() * 2 + 3).toFixed(1)), // 3.0 - 5.0
        user_ratings_total: Math.floor(Math.random() * 500) + 50,
        photos: [{
          photo_reference: `mock_photo_${type}_1`,
          height: 400,
          width: 600
        }]
      },
      {
        place_id: `mock_${type}_2`,
        name: this.getMockName(type, 2),
        formatted_address: `456 Culture Ave, City, Country`,
        geometry: {
          location: {
            lat: center.lat + (Math.random() - 0.5) * 0.01,
            lng: center.lng + (Math.random() - 0.5) * 0.01
          }
        },
        types: [type, 'point_of_interest'],
        rating: Number((Math.random() * 2 + 3).toFixed(1)),
        user_ratings_total: Math.floor(Math.random() * 300) + 30
      },
      {
        place_id: `mock_${type}_3`,
        name: this.getMockName(type, 3),
        formatted_address: `789 Heritage Blvd, City, Country`,
        geometry: {
          location: {
            lat: center.lat + (Math.random() - 0.5) * 0.01,
            lng: center.lng + (Math.random() - 0.5) * 0.01
          }
        },
        types: [type, 'point_of_interest'],
        rating: Number((Math.random() * 2 + 3).toFixed(1)),
        user_ratings_total: Math.floor(Math.random() * 200) + 10
      }
    ]
  }

  async getPlaceDetails(placeId: string): Promise<PlaceDetailsResult | null> {
    // Return mock details
    return {
      place_id: placeId,
      name: 'Mock Place Details',
      formatted_address: '123 Mock Street, Mock City, Mock Country',
      geometry: {
        location: { lat: 40.7128, lng: -74.0060 }
      },
      types: ['tourist_attraction'],
      rating: 4.2,
      user_ratings_total: 150,
      website: 'https://example.com',
      formatted_phone_number: '+1 (555) 123-4567'
    }
  }

  private calculateCenter(polygon: Array<{lat: number, lng: number}>): {lat: number, lng: number} {
    let totalLat = 0, totalLng = 0
    
    polygon.forEach(point => {
      totalLat += point.lat
      totalLng += point.lng
    })

    return {
      lat: totalLat / polygon.length,
      lng: totalLng / polygon.length
    }
  }

  private getMockName(type: string, index: number): string {
    const mockNames: Record<string, string[]> = {
      'tourist_attraction': ['Historic Landmark', 'Cultural Center', 'Memorial Plaza'],
      'museum': ['Art Museum', 'History Museum', 'Science Center'],
      'church': ['Cathedral', 'Historic Chapel', 'Community Church'],
      'park': ['Central Park', 'Riverside Park', 'Memorial Garden'],
      'restaurant': ['Fine Dining', 'Local Bistro', 'Cultural Cuisine'],
      'shopping_mall': ['Shopping Center', 'Retail Plaza', 'Market Square']
    }

    const names = mockNames[type] || ['Point of Interest', 'Local Attraction', 'Notable Location']
    return names[index - 1] || `${type.replace('_', ' ')} ${index}`
  }
}

// Export factory function
export function createGooglePlacesService(apiKey?: string): GooglePlacesService | MockGooglePlacesService {
  if (apiKey && apiKey.trim() !== '') {
    return new GooglePlacesService(apiKey)
  } else {
    console.warn('No Google Maps API key provided, using mock service')
    return new MockGooglePlacesService()
  }
}

export type { PlaceSearchResult, PlaceDetailsResult } 