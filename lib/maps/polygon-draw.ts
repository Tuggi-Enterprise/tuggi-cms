import { BOUNDARY_COLOR } from '@/lib/maps-config'

/**
 * Shared manual polygon-drawing primitive for Google Maps.
 *
 * SSOT for the "click to add a vertex, double-click to finish" interaction that both
 * GoogleMapComponent and TriggerPointsMap need — it replaces the deprecated
 * google.maps.drawing.DrawingManager (removed from the Maps JS API in v3.65). Framework
 * agnostic: it manipulates a google.maps.Map and reports the finished shape as plain
 * lat/lng coordinates, leaving it to the caller to decide what to render/persist.
 */

export interface LatLng {
  lat: number
  lng: number
}

export interface PolygonDrawStyle {
  strokeColor?: string
  strokeWeight?: number
  fillColor?: string
  fillOpacity?: number
}

export interface PolygonDrawerOptions {
  /** Preview styling (vertex dots + live outline). Defaults to the Tuggi boundary orange. */
  style?: PolygonDrawStyle
  /** Fired with the drawn vertices once the polygon is completed (>= 3 vertices). */
  onComplete: (coords: LatLng[]) => void
  /** Fired whenever drawing starts/stops — e.g. to update a toggle button's label. */
  onStateChange?: (isDrawing: boolean) => void
}

export interface PolygonDrawer {
  /** Enter drawing mode (no-op if already drawing). */
  start: () => void
  /** Commit the polygon if it has >= 3 vertices, otherwise discard; then leave drawing mode. */
  finish: () => void
  /** Leave drawing mode discarding any preview (no commit). */
  stop: () => void
  isDrawing: () => boolean
  /** Tear everything down (call on unmount). */
  dispose: () => void
}

/** Create a polygon drawer bound to a Google map. */
export function createPolygonDrawer(
  map: google.maps.Map,
  options: PolygonDrawerOptions,
): PolygonDrawer {
  const strokeColor = options.style?.strokeColor ?? BOUNDARY_COLOR
  const fillColor = options.style?.fillColor ?? BOUNDARY_COLOR
  const fillOpacity = options.style?.fillOpacity ?? 0.2
  const strokeWeight = options.style?.strokeWeight ?? 3

  let drawing = false
  let vertices: google.maps.LatLng[] = []
  let preview: google.maps.Polygon | null = null
  let vertexMarkers: google.maps.Marker[] = []
  let listeners: google.maps.MapsEventListener[] = []

  const clearPreview = () => {
    vertexMarkers.forEach((m) => m.setMap(null))
    vertexMarkers = []
    if (preview) {
      preview.setMap(null)
      preview = null
    }
    vertices = []
  }

  const renderPreview = () => {
    vertexMarkers.forEach((m) => m.setMap(null))
    vertexMarkers = vertices.map(
      (v) =>
        new google.maps.Marker({
          position: v,
          map,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 5,
            fillColor: strokeColor,
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2,
          },
          zIndex: 10000,
        }),
    )
    if (!preview) {
      preview = new google.maps.Polygon({
        map,
        fillColor,
        fillOpacity,
        strokeColor,
        strokeWeight,
        clickable: false,
        zIndex: 9999,
      })
    }
    preview.setPath(vertices)
  }

  const stop = () => {
    if (!drawing) return
    drawing = false
    listeners.forEach((l) => l.remove())
    listeners = []
    map.setOptions({ draggableCursor: null, disableDoubleClickZoom: false })
    clearPreview()
    options.onStateChange?.(false)
  }

  const finish = () => {
    if (!drawing) return
    let verts = vertices.slice()
    // A double-click adds the same point twice — drop the trailing duplicate.
    if (verts.length >= 2) {
      const a = verts[verts.length - 1]
      const b = verts[verts.length - 2]
      if (Math.abs(a.lat() - b.lat()) < 1e-9 && Math.abs(a.lng() - b.lng()) < 1e-9) {
        verts = verts.slice(0, -1)
      }
    }
    const coords = verts.map((v) => ({ lat: v.lat(), lng: v.lng() }))
    stop()
    if (coords.length >= 3) options.onComplete(coords)
  }

  const start = () => {
    if (drawing) return
    drawing = true
    clearPreview()
    map.setOptions({ draggableCursor: 'crosshair', disableDoubleClickZoom: true })
    const clickL = map.addListener('click', (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return
      vertices.push(e.latLng)
      renderPreview()
    })
    const dblL = map.addListener('dblclick', () => finish())
    listeners = [clickL, dblL]
    options.onStateChange?.(true)
  }

  const dispose = () => {
    stop()
  }

  return { start, finish, stop, isDrawing: () => drawing, dispose }
}
