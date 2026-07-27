export const GOOGLE_MAPS_LIBRARIES: any[] = ['geometry', 'places', 'visualization', 'marker']
export const GOOGLE_MAPS_VERSION = 'weekly'

/**
 * SSOT for the POI geographic-boundary polygon style ("laranja Tuggi").
 * Used by the boundary overlay, the boundary editor, and the polygon drawer so the
 * boundary looks identical everywhere it's shown or edited.
 */
export const BOUNDARY_COLOR = '#FF6B35'

export const BOUNDARY_POLYGON_OPTIONS = {
  strokeColor: BOUNDARY_COLOR,
  strokeOpacity: 0.8,
  strokeWeight: 3,
  fillColor: BOUNDARY_COLOR,
  fillOpacity: 0.2,
} as const
