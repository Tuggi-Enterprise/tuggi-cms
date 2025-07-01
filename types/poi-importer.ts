export interface SavedPolygon {
  id: string
  name: string
  paths: Array<{lat: number, lng: number}>
  user_id: string
  created_at: string
  country_name?: string
}

export interface PolygonStats {
  vertices: number
  area: number
}

export interface EnhancedPlaceResult {
  place_id: string
  name: string
  formatted_address: string
  geometry: {
    location: {
      lat: number
      lng: number
    }
  }
  rating?: number
  user_ratings_total?: number
  price_level?: number
  photos?: Array<{
    photo_reference: string
    width: number
    height: number
  }>
  opening_hours?: {
    open_now?: boolean
    weekday_text?: string[]
  }
  types: string[]
  thumbnail?: string
  isSelected: boolean
  alreadyExists: boolean
}

export interface POICategory {
  value: string
  label: string
  icon: any
  color: string
}

export interface Country {
  value: string
  label: string
}

export interface MapState {
  center: { lat: number; lng: number }
  zoom: number
  isLoading: boolean
  loadingMessage: string
}

export interface ImportBatch {
  id: string
  name: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  total_places: number
  processed_places: number
  created_at: string
} 