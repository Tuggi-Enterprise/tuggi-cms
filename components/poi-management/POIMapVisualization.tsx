'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Wrapper, Status } from '@googlemaps/react-wrapper'
import { 
  ZoomIn, ZoomOut
} from 'lucide-react'
import { cn } from '@/lib/utils'

import { GOOGLE_MAPS_LIBRARIES, GOOGLE_MAPS_VERSION } from '@/lib/maps-config'
import { geoJSONToPaths } from '@/lib/maps/geojson-paths'

const LIBRARIES = GOOGLE_MAPS_LIBRARIES


// POI interface to match existing structure
export interface POI {
  id: string
  name: string
  city: string
  country: string
  state: string | null
  category: string
  approved: boolean

  created_at: string
  updated_at: string
  vicinity: string | null
  website: string | null
  formatted_phone_number: string | null
  business_status: string | null
  price_level: number | null
  opening_hours: any | null
  photos_references: string[] | null
  google_place_id: string | null
  user_id: string | null
  coordinates?: {
    latitude: number
    longitude: number
  }
  has_description: boolean
  has_audio: boolean
  // Nível de prioridade (1 Padrão · 2 Complementar · 3 Adicional) — mostrado no pino.
  priority_level?: number | null
  description_count: number
  audio_count: number
  reference_links?: string[]
  // Group status indicators
  group_status?: {
    is_in_group: boolean
    group_id?: string
    group_name?: string
    group_role?: 'main' | 'member'
    group_member_count?: number
  }
  // Additional properties for compatibility
  available_languages: string[]
  trigger_points_count: number
  active_trigger_points_count: number
  // Expanded trigger points for detailed visualization
  trigger_points?: Array<{
    id: string
    is_active: boolean
    type: string
    latitude: number
    longitude: number
    bearing: number | null
  }>
  // Server-side clustering support
  type?: 'cluster' | 'poi'
  count?: number
}

// City Boundary interface
interface CityBoundary {
  osm_id: number
  name: string
  name_en: string | null
  boundary: string | null
  admin_level: number | null
  geojson: any // GeoJSON object
  coordinates?: Array<{lat: number, lng: number}> // Parsed coordinates
  validation_status?: 'validated' | 'unvalidated' | 'fallback' | 'failed'
  validation_message?: string
}

// POI status for color coding
type POIStatus = 'complete' | 'approved' | 'pending' | 'missing_content'

export interface POIMapVisualizationProps {
  // Data props - source of truth
  pois: POI[]
  totalCount?: number
  
  // Filter props (used for city boundaries highlighting)
  searchTerm: string
  statusFilter: 'all' | 'approved' | 'pending'
  countryFilter: string
  stateFilter: string
  cityFilter: string

  contentStatusFilter: string
  groupStatusFilter?: string
  triggerPointsFilter?: string

  // Trigger Points — explicit, on-demand
  // Parent decides which TPs to render (hover-mode, bulk-mode, or both combined).
  // Pass `[]` (or omit) to clear all TPs from the map.
  triggers?: TriggerRenderGroup[]
  drawArrows?: boolean

  // Optional POI boundary polygon to overlay (hover-mode auditing).
  // Pass `null` to clear.
  hoverBoundary?: Array<{ lat: number; lng: number }> | null

  // Callbacks
  onPOIClick: (poi: POI) => void
  onPOIDelete?: (poi: POI) => void
  onPOIGarbage?: (poi: POI) => void
  canGarbage?: boolean
  actionMenuLabels?: PoiActionMenuLabels
  onPoiHoverEnter?: (poi: POI) => void
  onPoiHoverLeave?: (poiId: string) => void
  onFiltersChange?: (bounds: google.maps.LatLngBounds) => void
  onBoundsChanged?: (bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number }, zoom: number) => void
  onPOIUpdated?: (updatedPOI: POI) => void
  onPOIDeleted?: (poiId: string) => void
  
  // Map settings
  height?: string
  className?: string
  initialCenter?: { lat: number; lng: number }
  initialZoom?: number
}

// Get POI status for color coding
function getPOIStatus(poi: POI): POIStatus {
  if (poi.has_description && poi.has_audio) {
    return 'complete'
  }
  if (poi.approved) {
    return 'approved'
  }
  if (!poi.has_description || !poi.has_audio) {
    return 'missing_content'
  }
  return 'pending'
}

// Get status color
function getStatusColor(status: POIStatus): string {
  switch (status) {
    case 'complete':
      return '#10B981' // Green
    case 'approved':
      return '#00A8E8' // Tuggi Blue
    case 'pending':
      return '#FF6F00' // Tuggi Orange
    case 'missing_content':
      return '#EF4444' // Red
    default:
      return '#6B7280' // Gray
  }
}

// Create DOM elements for AdvancedMarkerElement.
// Cor = STATUS de conteúdo; NÚMERO central = prioridade (1/2/3). Sem prioridade → ponto branco.
function createAdvancedMarkerElement(status: POIStatus, isSelected: boolean = false, priorityLevel?: number | null): HTMLElement {
  const color = getStatusColor(status)
  const size = isSelected ? 28 : 24
  const center = priorityLevel
    ? `<text x="12" y="12" text-anchor="middle" dominant-baseline="central" font-size="12" font-weight="900" fill="white" font-family="system-ui, -apple-system, sans-serif">${priorityLevel}</text>`
    : `<circle cx="12" cy="12" r="4" fill="white"/>`

  const div = document.createElement('div')
  div.innerHTML = `
    <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0px 2px 4px rgba(0,0,0,0.3));">
      <circle cx="12" cy="12" r="10" fill="${color}" stroke="white" stroke-width="2"/>
      ${center}
    </svg>
  `
  // Center alignment for AdvancedMarkerElement
  div.style.transform = 'translate(0%, 0%)'
  return div
}

function createAdvancedTriggerMarkerElement(is_active: boolean, bearing: number | null): HTMLElement {
  const color = '#F97316'
  const size = 18
  const opacity = is_active ? 1 : 0.5
  const hasBearing = bearing !== null && bearing !== undefined

  const div = document.createElement('div')
  div.innerHTML = `
    <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="6" fill="${color}" fill-opacity="${opacity}" stroke="white" stroke-width="2"/>
      ${hasBearing ? `
        <g transform="rotate(${bearing}, 12, 12)">
          <path d="M12 2L16 8H8L12 2Z" fill="${color}" fill-opacity="${opacity}" stroke="white" stroke-width="1"/>
        </g>
      ` : ''}
    </svg>
  `
  div.style.transform = 'translate(0%, 0%)'
  // Don't capture mouse events — otherwise TPs near the hovered POI would
  // steal the cursor and trigger mouseleave on the POI marker (flicker loop).
  div.style.pointerEvents = 'none'
  return div
}

// Inline Lucide icons (kept identical to the React components used in
// POIDetailsModal.tsx so the visual identity matches across the app).
const ICON_EDIT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`
const ICON_TRASH2_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>`
const ICON_XCIRCLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" x2="9" y1="9" y2="15"/><line x1="9" x2="15" y1="9" y2="15"/></svg>`

export interface PoiActionMenuLabels {
  edit: string
  delete: string
  garbage: string
  approved: string
  pending: string
  priority?: string
}

function buildPoiActionMenu(
  poi: POI,
  opts: {
    canDelete: boolean
    canGarbage: boolean
    labels: PoiActionMenuLabels
    onEdit: () => void
    onDelete: () => void
    onGarbage: () => void
  }
): HTMLElement {
  const container = document.createElement('div')
  container.style.padding = '8px 4px'
  container.style.minWidth = '220px'

  const statusBg = poi.approved ? '#DCFCE7' : '#FFEDD5'
  const statusColor = poi.approved ? '#166534' : '#9A3412'
  const statusLabel = poi.approved ? opts.labels.approved : opts.labels.pending
  const escape = (s: string) => s.replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!
  ))

  // Badge de prioridade (mesmas cores do card/lista: 1 esmeralda · 2 âmbar · 3 cinza).
  const prioColors: Record<number, { bg: string; fg: string }> = {
    1: { bg: '#D1FAE5', fg: '#047857' },
    2: { bg: '#FEF3C7', fg: '#B45309' },
    3: { bg: '#F3F4F6', fg: '#6B7280' },
  }
  const prio = poi.priority_level ? prioColors[poi.priority_level] : null
  const priorityChip = (poi.priority_level && prio)
    ? `<span style="display:inline-block; margin-left:6px; padding:2px 8px; border-radius:9999px; font-size:11px; font-weight:700; background:${prio.bg}; color:${prio.fg};">${opts.labels.priority ? escape(opts.labels.priority) + ' ' : ''}${poi.priority_level}</span>`
    : ''

  // Visual identity mirrors POIDetailsModal.tsx:3607-3627 (Edit primary, Delete red-50/red-700/red-300, Garbage gray-900/white).
  const btnBase = 'display:inline-flex; align-items:center; justify-content:center; gap:8px; padding:8px 14px; border-radius:6px; font-size:13px; font-weight:500; cursor:pointer; transition:background 0.15s;'
  const btnEdit = `${btnBase} background:#00A8E8; color:white; border:1px solid #00A8E8;`
  const btnDelete = `${btnBase} background:#FEF2F2; color:#B91C1C; border:1px solid #FCA5A5;`
  const btnGarbage = `${btnBase} background:#111827; color:white; border:1px solid #111827;`

  container.innerHTML = `
    <div style="margin-bottom:10px;">
      <h3 style="margin:0 0 4px 0; font-size:14px; font-weight:600; color:#111827;">${escape(poi.name)}</h3>
      <p style="margin:0 0 6px 0; font-size:12px; color:#6B7280;">${escape(poi.city)}${poi.country ? ', ' + escape(poi.country) : ''}</p>
      <span style="display:inline-block; padding:2px 8px; border-radius:9999px; font-size:11px; font-weight:500; background:${statusBg}; color:${statusColor};">${escape(statusLabel)}</span>${priorityChip}
    </div>
    <div style="display:flex; flex-direction:column; gap:6px;">
      <button data-action="edit" style="${btnEdit}">${ICON_EDIT_SVG}<span>${escape(opts.labels.edit)}</span></button>
      ${opts.canDelete ? `<button data-action="delete" style="${btnDelete}">${ICON_TRASH2_SVG}<span>${escape(opts.labels.delete)}</span></button>` : ''}
      ${opts.canGarbage ? `<button data-action="garbage" style="${btnGarbage}">${ICON_XCIRCLE_SVG}<span>${escape(opts.labels.garbage)}</span></button>` : ''}
    </div>
  `

  container.querySelector('[data-action="edit"]')?.addEventListener('click', opts.onEdit)
  if (opts.canDelete) {
    container.querySelector('[data-action="delete"]')?.addEventListener('click', opts.onDelete)
  }
  if (opts.canGarbage) {
    container.querySelector('[data-action="garbage"]')?.addEventListener('click', opts.onGarbage)
  }

  return container
}

function createClusterMarkerElement(count: number): HTMLElement {
  const div = document.createElement('div')
  const displayCount = count > 999 ? Math.floor(count/1000) + 'k' : count.toString()
  div.innerHTML = `
    <svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0px 4px 6px rgba(0,0,0,0.2));">
      <circle cx="20" cy="20" r="18" fill="#3B82F6" stroke="#1E40AF" stroke-width="2"/>
      <text x="20" y="26" text-anchor="middle" fill="white" font-size="12" font-weight="bold">
        ${displayCount}
      </text>
    </svg>
  `
  div.style.transform = 'translate(0%, 0%)'
  return div
}

// ============================================================
// Trigger Point rendering helpers (SSOT)
// Used by both hover-mode and bulk-mode. Apply marker+polyline
// diffing to avoid recreating Google Maps objects on each render.
// ============================================================

export interface MapTriggerPointInput {
  id: string
  latitude: number
  longitude: number
  bearing: number | null
  is_active: boolean
}

export interface TriggerRenderGroup {
  poiId: string
  poiPosition: { lat: number; lng: number }
  tps: MapTriggerPointInput[]
}

/**
 * Build the hover-mode trigger group (the currently-hovered item's TPs) for the map's
 * `triggers` prop. SSOT shared by OptimizedPOIMap (/pois) and EntityMapView (events/places).
 * Returns null when there is nothing to render (no hover / no coords / no TPs).
 */
export function buildHoverTriggerGroup(
  hoveredPoi: { id: string; coordinates?: { latitude: number; longitude: number } | null } | null,
  hoverTps: MapTriggerPointInput[] | undefined | null,
): TriggerRenderGroup | null {
  if (!hoveredPoi || !hoveredPoi.coordinates || !hoverTps || hoverTps.length === 0) return null
  return {
    poiId: hoveredPoi.id,
    poiPosition: { lat: hoveredPoi.coordinates.latitude, lng: hoveredPoi.coordinates.longitude },
    tps: hoverTps.map(tp => ({
      id: tp.id,
      latitude: tp.latitude,
      longitude: tp.longitude,
      bearing: tp.bearing,
      is_active: tp.is_active,
    })),
  }
}

function renderTriggers(
  groups: TriggerRenderGroup[],
  mapInstance: google.maps.Map,
  markersRef: Map<string, google.maps.marker.AdvancedMarkerElement>,
  polylinesRef: Map<string, google.maps.Polyline>,
  drawArrows: boolean
): void {
  const seen = new Set<string>()

  for (const group of groups) {
    const poiPos = new google.maps.LatLng(group.poiPosition.lat, group.poiPosition.lng)

    for (const tp of group.tps) {
      if (tp.latitude == null || tp.longitude == null) continue
      const tpId = `${group.poiId}-${tp.id}`
      seen.add(tpId)
      const tpPos = new google.maps.LatLng(tp.latitude, tp.longitude)

      // ----- Marker upsert -----
      let tpMarker = markersRef.get(tpId) as any
      if (!tpMarker) {
        tpMarker = new google.maps.marker.AdvancedMarkerElement({
          position: tpPos,
          map: mapInstance,
          content: createAdvancedTriggerMarkerElement(tp.is_active, tp.bearing),
          zIndex: 50,
          collisionBehavior: google.maps.CollisionBehavior.OPTIONAL_AND_HIDES_LOWER_PRIORITY
        }) as any
        // Outer <gmp-advanced-marker> wrapper must not capture pointer events,
        // otherwise TPs near a hovered POI steal the cursor (flicker loop).
        ;(tpMarker as unknown as HTMLElement).style.pointerEvents = 'none'
        tpMarker._tuggiState = {
          lat: tpPos.lat(),
          lng: tpPos.lng(),
          isActive: tp.is_active,
          bearing: tp.bearing
        }
        markersRef.set(tpId, tpMarker)
      } else {
        const s = tpMarker._tuggiState
        const pLat = tpPos.lat()
        const pLng = tpPos.lng()
        if (s.lat !== pLat || s.lng !== pLng) {
          tpMarker.position = tpPos
          s.lat = pLat
          s.lng = pLng
        }
        if (s.isActive !== tp.is_active || s.bearing !== tp.bearing) {
          tpMarker.content = createAdvancedTriggerMarkerElement(tp.is_active, tp.bearing)
          s.isActive = tp.is_active
          s.bearing = tp.bearing
        }
      }

      // ----- Polyline upsert -----
      let polyline = polylinesRef.get(tpId) as any
      if (!polyline) {
        polyline = new google.maps.Polyline({
          path: [poiPos, tpPos],
          geodesic: true,
          strokeColor: '#F97316',
          strokeOpacity: 0.6,
          strokeWeight: 2,
          clickable: false,
          ...(drawArrows ? {
            icons: [{
              icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.8, scale: 2 },
              offset: '0',
              repeat: '10px'
            }]
          } : {}),
          map: mapInstance
        }) as any
        polyline._tuggiState = {
          p1Lat: poiPos.lat(),
          p1Lng: poiPos.lng(),
          p2Lat: tpPos.lat(),
          p2Lng: tpPos.lng(),
          drawArrows
        }
        polylinesRef.set(tpId, polyline)
      } else {
        const s = polyline._tuggiState
        const p1Lat = poiPos.lat(), p1Lng = poiPos.lng()
        const p2Lat = tpPos.lat(), p2Lng = tpPos.lng()
        if (s.p1Lat !== p1Lat || s.p1Lng !== p1Lng || s.p2Lat !== p2Lat || s.p2Lng !== p2Lng) {
          polyline.setPath([poiPos, tpPos])
          s.p1Lat = p1Lat; s.p1Lng = p1Lng; s.p2Lat = p2Lat; s.p2Lng = p2Lng
        }
      }
    }
  }

  // Cleanup orphans
  for (const [id, m] of markersRef.entries()) {
    if (!seen.has(id)) {
      m.map = null
      markersRef.delete(id)
    }
  }
  for (const [id, p] of polylinesRef.entries()) {
    if (!seen.has(id)) {
      p.setMap(null)
      polylinesRef.delete(id)
    }
  }
}

function clearTriggers(
  markersRef: Map<string, google.maps.marker.AdvancedMarkerElement>,
  polylinesRef: Map<string, google.maps.Polyline>
): void {
  for (const m of markersRef.values()) m.map = null
  markersRef.clear()
  for (const p of polylinesRef.values()) p.setMap(null)
  polylinesRef.clear()
}


// Inner Component: Contains only map logic, assumes API is loaded
function POIMapInner({
  pois = [], // Default to empty
  totalCount,
  searchTerm,
  statusFilter,
  countryFilter,
  stateFilter,
  cityFilter,
  onPOIClick,
  onPOIDelete,
  onPOIGarbage,
  canGarbage = false,
  actionMenuLabels,
  onPoiHoverEnter,
  onPoiHoverLeave,
  onFiltersChange,
  onBoundsChanged,
  onPOIUpdated,
  onPOIDeleted,
  triggers,
  drawArrows = true,
  hoverBoundary = null,
  height,
  className,
  initialCenter = { lat: 39.8283, lng: -98.5795 }, // Center of USA
  initialZoom = 4
}: POIMapVisualizationProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<google.maps.Map | null>(null)
  const markersRef = useRef<Map<string, google.maps.marker.AdvancedMarkerElement>>(new Map())
  const triggerMarkersRef = useRef<Map<string, google.maps.marker.AdvancedMarkerElement>>(new Map())
  const polylinesRef = useRef<Map<string, google.maps.Polyline>>(new Map())
  const hoverBoundaryPolygonRef = useRef<google.maps.Polygon | null>(null)
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null)
  const boundsChangedTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const updateTaskIdRef = useRef<number>(0)

  // Hover-to-show TPs: debounced enter/leave on POI marker DOM element
  const HOVER_ENTER_MS = 250
  const HOVER_LEAVE_MS = 300
  const hoverCallbacksRef = useRef<{ onEnter?: (poi: POI) => void; onLeave?: (poiId: string) => void }>({})
  hoverCallbacksRef.current = { onEnter: onPoiHoverEnter, onLeave: onPoiHoverLeave }
  const hoverEnterTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const hoverLeaveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const hoveredPoiIdRef = useRef<string | null>(null)

  const attachHoverHandlers = useCallback((element: HTMLElement, poi: POI) => {
    element.style.cursor = 'pointer'
    element.addEventListener('mouseenter', () => {
      if (hoverLeaveTimeoutRef.current) {
        clearTimeout(hoverLeaveTimeoutRef.current)
        hoverLeaveTimeoutRef.current = null
      }
      if (hoverEnterTimeoutRef.current) clearTimeout(hoverEnterTimeoutRef.current)
      hoverEnterTimeoutRef.current = setTimeout(() => {
        const prev = hoveredPoiIdRef.current
        if (prev && prev !== poi.id) hoverCallbacksRef.current.onLeave?.(prev)
        hoveredPoiIdRef.current = poi.id
        hoverCallbacksRef.current.onEnter?.(poi)
      }, HOVER_ENTER_MS)
    })
    element.addEventListener('mouseleave', () => {
      if (hoverEnterTimeoutRef.current) {
        clearTimeout(hoverEnterTimeoutRef.current)
        hoverEnterTimeoutRef.current = null
      }
      if (hoverLeaveTimeoutRef.current) clearTimeout(hoverLeaveTimeoutRef.current)
      hoverLeaveTimeoutRef.current = setTimeout(() => {
        const id = hoveredPoiIdRef.current
        hoveredPoiIdRef.current = null
        if (id) hoverCallbacksRef.current.onLeave?.(id)
      }, HOVER_LEAVE_MS)
    })
  }, [])
  
  // Simple UI State
  const [selectedPOI, setSelectedPOI] = useState<POI | null>(null)
  const [cityBoundaries, setCityBoundaries] = useState<CityBoundary[]>([])
  
  // Map state preservation (keeps map from resetting on re-renders)
  const [mapState, setMapState] = useState<{
    center: { lat: number; lng: number }
    zoom: number
  }>({
    center: initialCenter,
    zoom: initialZoom
  })
  const [zoomLevel, setZoomLevel] = useState(initialZoom)

  // 1. Initialize Map
  const initializeMap = useCallback(() => {
    if (!mapRef.current || mapInstanceRef.current) return

    const map = new google.maps.Map(mapRef.current, {
      center: mapState.center,
      zoom: mapState.zoom,
      mapId: 'TUGGI_POI_MAP_ID', // Required for AdvancedMarkerElement
      mapTypeControl: true,
      streetViewControl: true,
      fullscreenControl: true,
      zoomControl: false, // We use custom controls
      mapTypeId: google.maps.MapTypeId.ROADMAP,
      gestureHandling: 'greedy',
      styles: [
        {
          featureType: 'poi',
          elementType: 'labels',
          stylers: [{ visibility: 'off' }]
        }
      ]
    })

    mapInstanceRef.current = map
    infoWindowRef.current = new google.maps.InfoWindow()

    // Bounds change listener (debounced) - This triggers server fetch
    map.addListener('idle', () => {
      const zoom = map.getZoom() || 4
      setZoomLevel(zoom)

      if (onBoundsChanged) {
        if (boundsChangedTimeoutRef.current) {
          clearTimeout(boundsChangedTimeoutRef.current)
        }
        
        boundsChangedTimeoutRef.current = setTimeout(() => {
          if (!mapInstanceRef.current) return
          
          const bounds = mapInstanceRef.current.getBounds()
          if (bounds) {
            const ne = bounds.getNorthEast()
            const sw = bounds.getSouthWest()
            onBoundsChanged({
              minLat: sw.lat(),
              minLng: sw.lng(),
              maxLat: ne.lat(),
              maxLng: ne.lng()
            }, zoom)
          }
        }, 500) // 500ms debounce
      }
    })

  }, [initialCenter, initialZoom, onBoundsChanged, mapState.center, mapState.zoom])

  // 2. Initialize Effect
  useEffect(() => {
    // Only initialize when both Google Maps is loaded AND the map container is rendered
    if (window.google && window.google.maps && !mapInstanceRef.current && mapRef.current) {
      initializeMap()
    }
  }, [initializeMap])

  // 3. Update Markers Effect (Diffing Algorithm for Performance)
  const updateMarkers = useCallback(() => {
    if (!mapInstanceRef.current || !window.google?.maps?.marker?.AdvancedMarkerElement) return

    // Increment task ID to cancel previous pending batches
    const taskId = ++updateTaskIdRef.current
    
    const CHUNK_SIZE = 250
    let currentIndex = 0
    const currentPoiIds = new Set<string>()

    const processBatch = () => {
      // If a new update started, stop this one
      if (taskId !== updateTaskIdRef.current) return

      const end = Math.min(currentIndex + CHUNK_SIZE, pois.length)
      
      for (let i = currentIndex; i < end; i++) {
        const poi = pois[i]
        if (!poi.coordinates?.latitude || !poi.coordinates?.longitude) continue

        currentPoiIds.add(poi.id)
        const position = new google.maps.LatLng(poi.coordinates.latitude, poi.coordinates.longitude)
        const isSelected = selectedPOI?.id === poi.id

        // === POI MARKER ===
        let marker = markersRef.current.get(poi.id) as any
        
        const poiStatus = getPOIStatus(poi)
        const isCluster = poi.type === 'cluster'
        const count = poi.count || 0
        const isZoomedIn = zoomLevel >= 17

        if (!marker) {
          // Create new AdvancedMarkerElement
          let content: HTMLElement
          if (isCluster) {
            content = createClusterMarkerElement(count)
          } else {
            content = createAdvancedMarkerElement(poiStatus, isSelected, poi.priority_level)

            // Append name label if zoomed in
            if (isZoomedIn) {
              const label = document.createElement('div')
              label.textContent = poi.name
              label.style.position = 'absolute'
              label.style.top = '100%'
              label.style.left = '50%'
              label.style.transform = 'translate(-50%, 0)'
              label.style.fontSize = '10px'
              label.style.fontWeight = '600'
              label.style.color = '#1F2937'
              label.style.whiteSpace = 'nowrap'
              label.style.textShadow = '1px 1px 2px white'
              content.appendChild(label)
            }
          }

          marker = new google.maps.marker.AdvancedMarkerElement({
            position,
            map: mapInstanceRef.current,
            content,
            title: poi.name,
            zIndex: isSelected ? 1000 : (isCluster ? 500 : 1),
            collisionBehavior: isCluster 
              ? google.maps.CollisionBehavior.REQUIRED 
              : google.maps.CollisionBehavior.OPTIONAL_AND_HIDES_LOWER_PRIORITY
          }) as any

          // Store state to avoid future redundant updates
          marker._tuggiState = {
            lat: position.lat(),
            lng: position.lng(),
            isCluster,
            count,
            poiStatus,
            isSelected,
            isZoomedIn,
            priorityLevel: poi.priority_level ?? null
          }

          if (isCluster) {
            marker.addListener('click', () => {
              const map = mapInstanceRef.current
              if (map) {
                map.setCenter(position)
                map.setZoom((map.getZoom() || 0) + 2)
              }
            })
          } else {
            marker.addListener('click', () => {
              setSelectedPOI(poi)
              if (infoWindowRef.current) {
                const labels = actionMenuLabels ?? {
                  edit: 'Edit',
                  delete: 'Delete',
                  garbage: 'Send to Garbage',
                  approved: 'Approved',
                  pending: 'Pending'
                }
                const container = buildPoiActionMenu(poi, {
                  canDelete: !!onPOIDelete,
                  canGarbage,
                  labels,
                  onEdit: () => {
                    infoWindowRef.current?.close()
                    onPOIClick(poi)
                  },
                  onDelete: () => {
                    infoWindowRef.current?.close()
                    onPOIDelete?.(poi)
                  },
                  onGarbage: () => {
                    infoWindowRef.current?.close()
                    onPOIGarbage?.(poi)
                  }
                })
                infoWindowRef.current.setContent(container)
                infoWindowRef.current.open({
                   map: mapInstanceRef.current,
                   anchor: marker
                })
              }
            })
            // Hover handlers for on-demand TP visualization
            attachHoverHandlers(content, poi)
          }
          markersRef.current.set(poi.id, marker)
        } else {
          // Update existing marker ONLY if state changed
          const s = marker._tuggiState
          const posLat = position.lat()
          const posLng = position.lng()

          if (s.lat !== posLat || s.lng !== posLng) {
            marker.position = position
            s.lat = posLat
            s.lng = posLng
          }
          
          if (
            s.isCluster !== isCluster ||
            s.count !== count ||
            s.poiStatus !== poiStatus ||
            s.isSelected !== isSelected ||
            s.isZoomedIn !== isZoomedIn ||
            s.priorityLevel !== (poi.priority_level ?? null)
          ) {
            if (isCluster) {
              marker.content = createClusterMarkerElement(count)
            } else {
              const newContent = createAdvancedMarkerElement(poiStatus, isSelected, poi.priority_level)
              if (isZoomedIn) {
                const label = document.createElement('div')
                label.textContent = poi.name
                label.style.position = 'absolute'
                label.style.top = '100%'
                label.style.left = '50%'
                label.style.transform = 'translate(-50%, 0)'
                label.style.fontSize = '10px'
                label.style.fontWeight = '600'
                label.style.color = '#1F2937'
                label.style.whiteSpace = 'nowrap'
                label.style.textShadow = '1px 1px 2px white'
                newContent.appendChild(label)
              }
              marker.content = newContent
              // Re-attach hover handlers on the new content element
              attachHoverHandlers(newContent, poi)
            }
            marker.zIndex = isSelected ? 1000 : (isCluster ? 500 : 1)
            s.isCluster = isCluster
            s.count = count
            s.poiStatus = poiStatus
            s.isSelected = isSelected
            s.isZoomedIn = isZoomedIn
            s.priorityLevel = poi.priority_level ?? null
          }
        }

      }

      currentIndex = end
      if (currentIndex < pois.length) {
        requestAnimationFrame(processBatch)
      } else {
        // === CLEANUP ORPHAN POI MARKERS (Final step) ===
        // Trigger markers/polylines are managed by a separate effect (see triggers prop).
        for (const [id, marker] of markersRef.current.entries()) {
          if (!currentPoiIds.has(id)) {
            marker.map = null
            markersRef.current.delete(id)
          }
        }
      }
    }

    requestAnimationFrame(processBatch)
  }, [pois, onPOIClick, selectedPOI, zoomLevel])

  useEffect(() => {
    if (mapInstanceRef.current && pois.length > 0) {
      updateMarkers()
    } else if (pois.length === 0 && mapInstanceRef.current) {
       // Cleanup POI markers if list is completely emptied.
       // Trigger markers/polylines are cleaned by the triggers effect.
       for (const marker of markersRef.current.values()) marker.map = null
       markersRef.current.clear()
    }
  }, [updateMarkers, pois.length])

  // === Trigger Points effect ===
  // Renders TPs based on the `triggers` prop (parent controls hover-mode + bulk-mode).
  // Uses the same diffing pattern as POI markers to avoid recreating Google Maps objects.
  useEffect(() => {
    if (!mapInstanceRef.current) return
    if (!triggers || triggers.length === 0) {
      clearTriggers(triggerMarkersRef.current, polylinesRef.current)
      return
    }
    renderTriggers(
      triggers,
      mapInstanceRef.current,
      triggerMarkersRef.current,
      polylinesRef.current,
      drawArrows
    )
  }, [triggers, drawArrows])

  // === Hover boundary effect ===
  // Renders the hovered POI's boundary polygon for visual auditing.
  useEffect(() => {
    if (!mapInstanceRef.current) return
    const existing = hoverBoundaryPolygonRef.current

    if (!hoverBoundary || hoverBoundary.length < 3) {
      if (existing) {
        existing.setMap(null)
        hoverBoundaryPolygonRef.current = null
      }
      return
    }

    const paths = hoverBoundary.map(c => new google.maps.LatLng(c.lat, c.lng))

    if (existing) {
      existing.setPaths(paths)
      existing.setMap(mapInstanceRef.current)
    } else {
      hoverBoundaryPolygonRef.current = new google.maps.Polygon({
        paths,
        fillColor: '#F97316',
        fillOpacity: 0.1,
        strokeColor: '#F97316',
        strokeOpacity: 0.7,
        strokeWeight: 2,
        clickable: false,
        zIndex: 10,
        map: mapInstanceRef.current
      })
    }
  }, [hoverBoundary])

  // 4. City Boundaries Logic (kept as it might be useful, but localized)
  // Fetch city boundaries
  const fetchCityBoundaries = useCallback(async () => {
    if (!cityFilter || !mapInstanceRef.current) {
      setCityBoundaries([])
      return
    }

    try {
      const params = new URLSearchParams()
      params.set('city', cityFilter)
      if (countryFilter) params.set('country', countryFilter)
      if (stateFilter) params.set('state', stateFilter)

      const response = await fetch(`/api/city-boundaries?${params.toString()}`)
      const result = await response.json()
      
      if (result.success) {
        setCityBoundaries(result.data || [])
      }
    } catch (error) {
      console.error('Error loading city boundaries:', error)
      setCityBoundaries([])
    }
  }, [cityFilter, countryFilter, stateFilter])

  // Update boundaries on map
  const boundariesRef = useRef<google.maps.Polygon[]>([])
  const updateCityBoundaries = useCallback(() => {
    if (!mapInstanceRef.current) return

    boundariesRef.current.forEach(boundary => boundary.setMap(null))
    boundariesRef.current = []

    cityBoundaries.forEach((boundary) => {
      // Every ring of the geometry: MultiPolygon was not handled here at all, so those
      // boundaries drew nothing.
      const paths: google.maps.LatLngLiteral[][] = boundary.coordinates
        ? [boundary.coordinates.map(c => ({ lat: c.lat, lng: c.lng }))]
        : geoJSONToPaths(boundary.geojson)

      if (paths.length === 0) return

      const polygon = new google.maps.Polygon({
        paths: paths,
        fillColor: '#3B82F6',
        fillOpacity: 0.05,
        strokeColor: '#3B82F6',
        strokeWeight: 2,
        strokeOpacity: 0.3,
        clickable: true,
        map: mapInstanceRef.current
      })
      boundariesRef.current.push(polygon)

      // Auto-focus on city boundary
      if (paths.length > 0 && mapInstanceRef.current && cityFilter) {
        // paths is now an array of RINGS, so the fit has to walk every point of every ring.
        const bounds = new google.maps.LatLngBounds()
        paths.forEach(ring => ring.forEach(p => bounds.extend(p)))
        mapInstanceRef.current.fitBounds(bounds)
      }
    })
  }, [cityBoundaries, cityFilter])

  useEffect(() => {
    fetchCityBoundaries()
  }, [fetchCityBoundaries])

  useEffect(() => {
    updateCityBoundaries()
  }, [updateCityBoundaries])

  return (
    <div className="w-full h-full relative">
       <div ref={mapRef} className="w-full h-full bg-gray-100 dark:bg-gray-800" />
       
       {/* Map Controls overlay */}
      <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-1 flex flex-col gap-1">
          <button
            onClick={() => {
              const map = mapInstanceRef.current
              if (map) map.setZoom((map.getZoom() || 0) + 1)
            }}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
            title="Zoom In"
          >
            <ZoomIn className="w-4 h-4 text-gray-700 dark:text-gray-300" />
          </button>
          <button
            onClick={() => {
              const map = mapInstanceRef.current
              if (map) map.setZoom((map.getZoom() || 0) - 1)
            }}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
            title="Zoom Out"
          >
            <ZoomOut className="w-4 h-4 text-gray-700 dark:text-gray-300" />
          </button>
        </div>
      </div>

      {/* Stats overlay */}
      <div className="absolute bottom-4 left-4 bg-white rounded-lg shadow-lg px-3 py-2 z-10">
        <span className="text-sm font-medium text-gray-700">
          {totalCount !== undefined ? `${pois.length} visible / ${totalCount} total` : `${pois.length} items`}
        </span>
      </div>
    </div>
  )
}

// Main Component: Handles loading status
export function POIMapVisualization(props: POIMapVisualizationProps) {
  const { className, height } = props
  
  return (
      <div className={cn("relative w-full rounded-lg overflow-hidden border border-gray-200 dark:border-gray-800", className)} style={{ height }}>
        <Wrapper
          apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''}
          libraries={LIBRARIES}
          version={GOOGLE_MAPS_VERSION}
          render={(status) => {
            if (status === Status.LOADING) return <div className="p-4 flex items-center justify-center h-full">Loading Map...</div>
            if (status === Status.FAILURE) return <div className="p-4 flex items-center justify-center h-full text-red-500">Failed to load Google Maps</div>
            if (status === Status.SUCCESS) return <POIMapInner {...props} />
            return <div>Unknown status</div>
          }}
        />
    </div>
  )
}