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
  | 'geofence' // Issue 2.4 — TP de cobertura por polígono (POIs com boundary)

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
  onMapClick?: (lat: number, lng: number, bearing?: number) => void
  onTriggerPointClick?: (triggerPoint: TriggerPoint) => void
  onTriggerPointDrag?: (triggerPoint: TriggerPoint, newLat: number, newLng: number) => void
  isAddingMode?: boolean
  suggestions?: any[]
  onSuggestionDrag?: (suggestionId: string, newLat: number, newLng: number, newDistance: number, newBearing: number) => void
  onSuggestionAccept?: (suggestion: any) => void
  onSuggestionReject?: (suggestion: any) => void
  onResetMapView?: () => void
  onPOILocationChange?: (newLat: number, newLng: number) => void
  /**
   * Optional geographic boundary polygon rendered as an overlay so the operator can
   * see the POI's boundary while creating/editing trigger points. Read-only by default
   * (non-clickable, so it never intercepts TP interactions); becomes editable/drawable
   * in Boundary mode via the flags below.
   */
  boundaryPolygon?: { lat: number; lng: number }[] | null
  /** Boundary mode: make the overlay editable (drag vertices/edges) and report changes. */
  boundaryEditable?: boolean
  /** Boundary mode: click-to-add-vertex drawing of a new boundary polygon. */
  isDrawingBoundary?: boolean
  /** Fired when the editable boundary overlay is reshaped (drag vertex / edge / whole polygon). */
  onBoundaryChange?: (coords: { lat: number; lng: number }[]) => void
  /** Fired when a freshly drawn boundary polygon is completed (>= 3 vertices). */
  onBoundaryComplete?: (polygon: google.maps.Polygon) => void
  /** Boundary mode: TP markers/POI pin become non-interactive reference only. */
  disableTriggerInteractions?: boolean
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

// Geographic-boundary editing controls, wired from POIModalContext and passed into
// TriggerPointsManager so the unified map workspace can edit the boundary in-place
// (via a mode toggle) instead of a separate tab. Absent when the manager is used
// standalone (e.g. the admin test page) — then only trigger-point editing is shown.
export interface TriggerPointsBoundaryControls {
  existingBoundary: { lat: number; lng: number }[] | null
  boundaryPolygon: { lat: number; lng: number }[] | null
  setBoundaryPolygon: (polygon: { lat: number; lng: number }[] | null) => void
  isDrawingEnabled: boolean
  setIsDrawingEnabled: (value: boolean) => void
  isSavingBoundary: boolean
  handleBoundaryPolygonComplete: (polygon: google.maps.Polygon) => void
  handleSaveBoundary: () => void
  handleDeleteBoundary: () => void
}

// Manager component props
export interface TriggerPointsManagerProps {
  attractionId: string
  attractionName: string
  // Optimistic initial only — the authoritative coordinate is fetched from
  // core.attraction_coordinate inside TriggerPointsManager. May be absent when
  // the opener could not assemble it (e.g. deep-link/map path).
  attractionCoordinates?: { lat: number; lng: number } | null
  attractionTypes?: string[]
  onClose?: () => void
  onUpdate?: () => void
  // When provided, the manager renders a [Trigger Points | Boundary] mode toggle and
  // lets the operator edit the boundary on the same map. Omit for TP-only usage.
  boundary?: TriggerPointsBoundaryControls
  // Geofence POIs use polygon-based triggering, not point TPs: lock to Boundary mode.
  isGeofence?: boolean
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
  { value: 'custom', label: 'Custom', color: '#F59E0B', description: 'Custom trigger point' },
  { value: 'geofence', label: 'Geofence', color: '#06B6D4', description: 'Polygon-based trigger (no bearing check)' }
]

export const DEFAULT_TRIGGER_POINT: TriggerPointFormData = {
  latitude: 0,
  longitude: 0,
  radius_meters: 10,
  expected_bearing: null,
  bearing_threshold: 30,
  type: 'primary',
  priority: 1,
  custom_description_id: null,
  is_active: true,
  direction: null,
  access: 'car'
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