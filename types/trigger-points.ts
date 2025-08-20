// Trigger Points Types
// These types define the structure for POI trigger points used in the Tuggi Drive app

export type Direction = 'front' | 'right' | 'left' | 'back'
export type AccessType = 'walk' | 'car' | 'both'

export interface TriggerPoint {
  id?: string
  attraction_id: string
  latitude: number
  longitude: number
  radius_meters: number
  expected_bearing?: number | null
  bearing_threshold: number
  type: TriggerPointType
  priority: number
  custom_description_id?: string | null
  is_active: boolean
  direction?: Direction | null
  access?: AccessType // ✅ NOVO CAMPO
  name?: string // ✅ NOVO CAMPO
  description?: string // ✅ NOVO CAMPO
  created_at?: string
  updated_at?: string
  created_by?: string | null
  
  // Joined fields from the view
  attraction_name?: string
  custom_description?: string
}

export type TriggerPointType = 
  | 'primary'
  | 'fallback'
  | 'entry'
  | 'exit'
  | 'approach'
  | 'custom'

export interface TriggerPointTypeInfo {
  value: TriggerPointType
  label: string
  color: string
  description: string
}

export interface AttractionDescription {
  id: string
  attraction_id: string
  description: string
  type: string
  created_at: string
  updated_at: string
}

export interface TriggerPointFormData {
  latitude: number
  longitude: number
  radius_meters: number
  expected_bearing?: number | null
  bearing_threshold: number
  type: TriggerPointType
  priority: number
  custom_description_id?: string | null
  is_active: boolean
  direction?: Direction | null
  access?: AccessType // ✅ NOVO CAMPO
  name?: string // ✅ NOVO CAMPO
  description?: string // ✅ NOVO CAMPO
}

export interface TriggerPointValidation {
  isValid: boolean
  errors: string[]
}

export interface TriggerPointsStats {
  total: number
  active: number
  inactive: number
  byType: Record<TriggerPointType, number>
  byPriority: Record<number, number>
}

// Map-related types
export interface TriggerPointMapProps {
  center: { lat: number; lng: number }
  zoom?: number
  height?: string
  className?: string
  attractionName?: string
  triggerPoints: TriggerPoint[]
  selectedTriggerPoint?: TriggerPoint | null
  onMapClick?: (lat: number, lng: number) => void
  onTriggerPointClick?: (triggerPoint: TriggerPoint) => void
  onTriggerPointDrag?: (triggerPoint: TriggerPoint, newLat: number, newLng: number) => void
  isAddingMode?: boolean
  suggestions?: any[]
  onSuggestionDrag?: (suggestionId: string, newLat: number, newLng: number, newDistance: number, newBearing: number) => void
  onSuggestionAccept?: (suggestion: any) => void
  onSuggestionReject?: (suggestion: any) => void
}

// Database types
export interface TriggerPointRow {
  id: string
  attraction_id: string
  location: string // PostGIS geography type
  radius_meters: number
  expected_bearing?: number | null
  bearing_threshold: number
  type: TriggerPointType
  priority: number
  custom_description_id?: string | null
  is_active: boolean
  direction?: Direction | null
  created_at: string
  updated_at: string
  created_by?: string | null
}

export interface TriggerPointWithCoordsRow extends TriggerPointRow {
  latitude: number
  longitude: number
  attraction_name: string
  custom_description?: string
}

// API response types
export interface TriggerPointsResponse {
  data: TriggerPoint[]
  count: number
  error?: string
}

export interface TriggerPointCRUDResponse {
  data?: TriggerPoint
  error?: string
}

// Manager component props
export interface TriggerPointsManagerProps {
  attractionId: string
  attractionName: string
  attractionCoordinates: { lat: number; lng: number }
  attractionTypes?: string[]
  onClose?: () => void
}

// Helper function types
export type TriggerPointValidator = (data: TriggerPointFormData) => TriggerPointValidation
export type TriggerPointTransformer = (row: TriggerPointWithCoordsRow) => TriggerPoint
export type CoordinateConverter = (lat: number, lng: number) => string

// Constants
export const TRIGGER_POINT_TYPES: TriggerPointTypeInfo[] = [
  { value: 'primary', label: 'Primary', color: '#00A8E8', description: 'Main trigger point' },
  { value: 'fallback', label: 'Fallback', color: '#FF6F00', description: 'Backup trigger point' },
  { value: 'entry', label: 'Entry', color: '#10B981', description: 'Entry point trigger' },
  { value: 'exit', label: 'Exit', color: '#EF4444', description: 'Exit point trigger' },
  { value: 'approach', label: 'Approach', color: '#8B5CF6', description: 'Approach trigger' },
  { value: 'custom', label: 'Custom', color: '#F59E0B', description: 'Custom trigger point' }
]

export const DEFAULT_TRIGGER_POINT: TriggerPointFormData = {
  latitude: 0,
  longitude: 0,
  radius_meters: 30,
  expected_bearing: null,
  bearing_threshold: 30,
  type: 'primary',
  priority: 1,
  custom_description_id: null,
  is_active: true,
  direction: null
}

export const TRIGGER_POINT_CONSTRAINTS = {
  radius: { min: 5, max: 1000, default: 30 },
  bearing: { min: 0, max: 360 },
  bearingThreshold: { min: 0, max: 180, default: 30 },
  priority: { min: 1, max: 100, default: 1 }
} as const

// Direction options for the UI
export const DIRECTION_OPTIONS = [
  { value: 'front', label: 'Front', emoji: '⬆️', description: 'In front of you' },
  { value: 'right', label: 'Right', emoji: '➡️', description: 'To your right' },
  { value: 'left', label: 'Left', emoji: '⬅️', description: 'To your left' },
  { value: 'back', label: 'Back', emoji: '⬇️', description: 'Behind you' }
] as const

// Access options for the UI
export const ACCESS_OPTIONS = [
  { value: 'walk', label: 'Pedestre', icon: '🚶' },
  { value: 'car', label: 'Carro', icon: '🚗' },
  { value: 'both', label: 'Ambos', icon: '🚶🚗' }
] as const 