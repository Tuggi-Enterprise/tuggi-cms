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
  photos?: Array<{
    photo_reference: string
    height: number
    width: number
  }>
}

interface PlaceDetailsResult extends PlaceSearchResult {
  international_phone_number?: string
  url?: string
  vicinity?: string
  plus_code?: {
    global_code: string
    compound_code: string
  }
  business_status?: string
  editorial_summary?: {
    overview: string
  }
}

interface POIEnrichmentData {
  place_id: string
  name: string
  types: string[]
  formatted_address: string
  vicinity?: string
  rating?: number
  user_ratings_total?: number
  price_level?: number
  business_status?: string
  editorial_summary?: string
  plus_code?: string
  website?: string
  photos_count: number
  reviews_count: number
  is_tourist_attraction: boolean
  is_natural_feature: boolean
  is_large_area: boolean
  estimated_size: 'small' | 'medium' | 'large' | 'massive'
  estimated_height: 'ground' | 'low' | 'medium' | 'high' | 'very_high'
  estimated_visibility: 'close_only' | 'medium_range' | 'long_range' | 'very_long_range'
}

// Country to language mapping for localized place names
const COUNTRY_LANGUAGE_MAP: Record<string, string> = {
  'BR': 'pt-br', // Brazil -> Portuguese
  'ES': 'es',    // Spain -> Spanish
  'FR': 'fr',    // France -> French
  'DE': 'de',    // Germany -> German
  'IT': 'it',    // Italy -> Italian
  'JP': 'ja',    // Japan -> Japanese
  'KR': 'ko',    // Korea -> Korean
  'CN': 'zh',    // China -> Chinese
  'RU': 'ru',    // Russia -> Russian
  'AR': 'es',    // Argentina -> Spanish
  'MX': 'es',    // Mexico -> Spanish
  'PT': 'pt',    // Portugal -> Portuguese
  'US': 'en',    // United States -> English
  'GB': 'en',    // United Kingdom -> English
  'CA': 'en',    // Canada -> English (could be 'fr' for Quebec)
  'AU': 'en',    // Australia -> English
  // Add more as needed
}

class GooglePlacesService {
  private language: string = 'en' // Default language

  constructor(countryCode?: string) {
    // Set language based on country code
    if (countryCode && COUNTRY_LANGUAGE_MAP[countryCode]) {
      this.language = COUNTRY_LANGUAGE_MAP[countryCode]
    }
  }

  /**
   * Set the language for API calls
   */
  setLanguage(countryCode: string) {
    this.language = COUNTRY_LANGUAGE_MAP[countryCode] || 'en'
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

    let allResults: PlaceSearchResult[] = []

    if (type === 'all') {
      // Search for multiple types when 'all' is selected
      const typesToSearch = [
        'tourist_attraction', 'museum', 'park', 'beach', 'church', 'stadium', 
        'library', 'aquarium', 'zoo', 'amusement_park', 'art_gallery',
        'shopping_mall', 'restaurant', 'lodging', 'hospital', 'university'
      ]
      
      console.log(`Searching for all categories in polygon (${typesToSearch.length} types)`)
      
      // Search for each type and combine results
      for (const searchType of typesToSearch) {
        try {
          const typeResults = await this.nearbySearch(center, radius, searchType, keyword)
          allResults = [...allResults, ...typeResults]
          
          // Add small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100))
        } catch (error) {
          console.warn(`Error searching for type ${searchType}:`, error)
        }
      }
      
      // Remove duplicates based on place_id
      const uniqueResults = allResults.filter((place, index, self) => 
        index === self.findIndex(p => p.place_id === place.place_id)
      )
      
      console.log(`Found ${uniqueResults.length} unique places across all categories`)
      allResults = uniqueResults
    } else if (type === 'beach') {
      // For beaches, search multiple related types since famous beaches 
      // are often classified as tourist attractions or natural features
      const beachTypes = ['beach', 'tourist_attraction', 'natural_feature', 'park']
      console.log(`Searching for beaches using multiple types: ${beachTypes.join(', ')}`)
      
      for (const searchType of beachTypes) {
        try {
          const typeResults = await this.nearbySearch(center, radius, searchType, keyword)
          allResults = [...allResults, ...typeResults]
          
          // Add small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100))
        } catch (error) {
          console.warn(`Error searching for beach type ${searchType}:`, error)
        }
      }
      
      // Remove duplicates and filter to beach-related results
      const uniqueResults = allResults.filter((place, index, self) => 
        index === self.findIndex(p => p.place_id === place.place_id)
      )
      
      // Filter to only include places that are likely beaches
      const beachResults = uniqueResults.filter(place => {
        const name = place.name.toLowerCase()
        const types = place.types || []
        
        // Include if it's explicitly a beach type
        if (types.includes('beach')) return true
        
        // Include if the name contains beach-related keywords
        const beachKeywords = ['beach', 'praia', 'playa', 'strand', 'plage', 'spiaggia', 'пляж']
        if (beachKeywords.some(keyword => name.includes(keyword))) return true
        
        // Include famous beach locations (like Ipanema, Copacabana, etc.)
        const famousBeaches = ['ipanema', 'copacabana', 'leblon', 'barra', 'flamengo', 'botafogo']
        if (famousBeaches.some(beach => name.includes(beach))) return true
        
        return false
      })
      
      console.log(`Found ${uniqueResults.length} total results, ${beachResults.length} beach-related`)
      allResults = beachResults
    } else {
      // Perform nearby search for specific type
      allResults = await this.nearbySearch(center, radius, type, keyword)
    }
    
    // Filter results to only include places actually within the polygon
    const filteredResults = allResults.filter(place => 
      this.isPointInPolygon(place.geometry.location, polygon)
    )

    console.log(`Search completed: ${allResults.length} found, ${filteredResults.length} within polygon`)
    console.log('All results before filtering:', allResults.map(p => `${p.name} (${p.types?.join(', ')})`))
    console.log('Filtered results:', filteredResults.map(p => `${p.name} (${p.types?.join(', ')})`))
    return filteredResults
  }

  /**
   * Perform a Google Places Nearby Search via our API route
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
      language: this.language, // Add language parameter
    })

    if (keyword) {
      params.append('keyword', keyword)
    }

    const url = `/api/places/nearby?${params}`
    
    try {
      const response = await fetch(url)
      const data = await response.json()

      if (data.status === 'OK' || data.status === 'ZERO_RESULTS') {
        return data.results || []
      } else {
        console.error('Places API error:', data.status, data.error)
        return []
      }
    } catch (error) {
      console.error('Error fetching places:', error)
      return []
    }
  }

  /**
   * Get detailed information about a specific place via our API route
   */
  async getPlaceDetails(placeId: string): Promise<PlaceDetailsResult | null> {
    const params = new URLSearchParams({
      place_id: placeId,
      fields: 'place_id,name,formatted_address,geometry,types,photos,international_phone_number,url,vicinity,business_status,address_components',
      language: this.language, // Add language parameter
    })

    const url = `/api/places/details?${params}`

    try {
      const response = await fetch(url)
      const data = await response.json()

      if (data.status === 'OK' && data.result) {
        return data.result
      } else if (data.status === 'ZERO_RESULTS' || data.status === 'NOT_FOUND') {
        // Valid responses that just mean no data found
        return null
      } else {
        console.error('Places Details API error:', data.status, data.error)
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
        types: [type, 'point_of_interest']
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
        types: [type, 'point_of_interest']
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
      types: ['tourist_attraction']
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
export function createGooglePlacesService(apiKey?: string, countryCode?: string): GooglePlacesService | MockGooglePlacesService {
  if (apiKey && apiKey.trim() !== '') {
    return new GooglePlacesService(countryCode)
  } else {
    console.warn('No Google Maps API key provided, using mock service')
    return new MockGooglePlacesService()
  }
}

// Função para enriquecer dados do POI usando google_place_id (para testes)
export async function enrichPOIData(googlePlaceId: string): Promise<POIEnrichmentData | null> {
  if (!googlePlaceId) {
    console.log('❌ No google_place_id provided')
    return null
  }

  try {
    console.log(`🔍 Enriching POI data for place_id: ${googlePlaceId}`)
    
    // Campos específicos que queremos para análise de POV
    const fields = [
      'place_id',
      'name', 
      'types',
      'formatted_address',
      'vicinity',
      'geometry',
      'business_status',
      'editorial_summary',
      'plus_code',
      'photos'
    ].join(',')

    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
    if (!apiKey) {
      throw new Error('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY not found in environment variables')
    }

    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${googlePlaceId}&fields=${fields}&key=${apiKey}`
    
    console.log(`📡 Calling Google Places API...`)
    const response = await fetch(url)
    
    if (!response.ok) {
      throw new Error(`Google Places API error: ${response.status} ${response.statusText}`)
    }
    
    const data = await response.json()
    
    if (data.status !== 'OK') {
      throw new Error(`Google Places API returned status: ${data.status}`)
    }
    
    const details = data.result
    
    if (!details) {
      console.log('❌ No details found for place_id')
      return null
    }

    // Analisar e classificar o POI
    const enrichedData = analyzeAndClassifyPOI(details)
    
    console.log(`✅ POI enriched:`, {
      name: enrichedData.name,
      types: enrichedData.types,
      is_large_area: enrichedData.is_large_area,
      estimated_size: enrichedData.estimated_size,
      estimated_height: enrichedData.estimated_height,
      estimated_visibility: enrichedData.estimated_visibility
    })

    return enrichedData

  } catch (error) {
    console.error('❌ Error enriching POI data:', error)
    return null
  }
}

// Função para analisar e classificar POI baseado nos dados do Google Places
function analyzeAndClassifyPOI(details: PlaceDetailsResult): POIEnrichmentData {
  const types = details.types || []
  const name = details.name.toLowerCase()
  
  // Classificação de área grande
  const largeAreaTypes = [
    'park', 'amusement_park', 'aquarium', 'zoo', 'stadium', 'airport',
    'shopping_mall', 'university', 'hospital', 'cemetery', 'golf_course',
    'beach', 'lake', 'natural_feature'
  ]
  const isLargeArea = types.some(type => largeAreaTypes.includes(type)) ||
                     name.includes('lago') || name.includes('parque') || 
                     name.includes('praia') || name.includes('estádio')

  // Classificação de atração turística
  const isTouristAttraction = types.includes('tourist_attraction') ||
                             types.includes('point_of_interest')

  // Classificação de característica natural
  const isNaturalFeature = types.some(type => 
    ['natural_feature', 'park', 'beach', 'mountain', 'lake'].includes(type)
  ) || name.includes('pico') || name.includes('morro') || name.includes('serra')

  // Estimativa de tamanho baseada nos tipos e dados
  let estimatedSize: 'small' | 'medium' | 'large' | 'massive' = 'medium'
  if (types.includes('airport') || types.includes('university')) {
    estimatedSize = 'massive'
  } else if (types.includes('stadium') || types.includes('shopping_mall') || types.includes('amusement_park')) {
    estimatedSize = 'large'
  } else if (isLargeArea) {
    estimatedSize = 'medium'
  } else {
    estimatedSize = 'small'
  }

  // Estimativa de altura
  let estimatedHeight: 'ground' | 'low' | 'medium' | 'high' | 'very_high' = 'medium'
  if (types.includes('mountain') || name.includes('pico') || name.includes('morro')) {
    estimatedHeight = 'very_high'
  } else if (types.includes('building') || name.includes('torre') || name.includes('edifício')) {
    estimatedHeight = 'high'
  } else if (types.includes('bridge') || name.includes('ponte')) {
    estimatedHeight = 'medium'
  } else if (isLargeArea) {
    estimatedHeight = 'ground'
  }

  // Estimativa de visibilidade baseada na altura e tamanho
  let estimatedVisibility: 'close_only' | 'medium_range' | 'long_range' | 'very_long_range' = 'medium_range'
  if (estimatedHeight === 'very_high') {
    estimatedVisibility = 'very_long_range'
  } else if (estimatedHeight === 'high' || estimatedSize === 'massive') {
    estimatedVisibility = 'long_range'
  } else if (estimatedSize === 'small') {
    estimatedVisibility = 'close_only'
  }

  return {
    place_id: details.place_id,
    name: details.name,
    types: details.types || [],
    formatted_address: details.formatted_address,
    vicinity: details.vicinity,
    rating: undefined,
    user_ratings_total: undefined,
    price_level: undefined,
    business_status: details.business_status,
    editorial_summary: details.editorial_summary?.overview,
    plus_code: details.plus_code?.global_code,
    website: undefined,
    photos_count: details.photos?.length || 0,
    reviews_count: 0,
    is_tourist_attraction: Boolean(isTouristAttraction),
    is_natural_feature: isNaturalFeature,
    is_large_area: isLargeArea,
    estimated_size: estimatedSize,
    estimated_height: estimatedHeight,
    estimated_visibility: estimatedVisibility
  }
}

export type { PlaceSearchResult, PlaceDetailsResult, POIEnrichmentData }