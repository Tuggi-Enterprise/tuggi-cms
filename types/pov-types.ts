export interface POIInput {
  name: string
  lat: number
  lng: number
  city: string
  country: string
  formatted_address?: string
  vicinity?: string
  google_types?: string[]
}

export interface POVItem {
  name: string
  lat: number
  lng: number
  azimuth_deg: number
  distance_m: number
  access: 'walk' | 'car' | 'both'
  vantage: 'street' | 'square' | 'park' | 'beach' | 'bridge' | 'highway' | 'overlook' | 'trail' | 'building_top' | 'island' | 'other'
  visibility_quality: 'excellent' | 'good' | 'moderate' | 'limited'
}

export interface GeminiPOVResponse {
  poi: POIInput
  items: POVItem[]
}

export interface TriggerPointFromPOV {
  attraction_id: string
  latitude: number
  longitude: number
  expected_bearing: number
  radius_meters: number
  type: 'primary' | 'secondary' | 'fallback'
  priority: number
  name: string
  description: string
  access: 'walk' | 'car' | 'both'
  is_active: boolean
}

export interface POVGenerationMetrics {
  attractionId: string
  povsGenerated: number
  generationTime: number
  modelUsed: string
  success: boolean
  errors?: string[]
  userId?: string
}
