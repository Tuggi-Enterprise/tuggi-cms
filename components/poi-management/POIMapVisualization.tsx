'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Wrapper, Status } from '@googlemaps/react-wrapper'
import { 
  ZoomIn, ZoomOut
} from 'lucide-react'
import { cn } from '@/lib/utils'

import { GOOGLE_MAPS_LIBRARIES, GOOGLE_MAPS_VERSION } from '@/lib/maps-config'

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
  showTriggers?: boolean
  
  // Callbacks
  onPOIClick: (poi: POI) => void
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

// Create DOM elements for AdvancedMarkerElement
function createAdvancedMarkerElement(status: POIStatus, isSelected: boolean = false): HTMLElement {
  const color = getStatusColor(status)
  const size = isSelected ? 28 : 24
  
  const div = document.createElement('div')
  div.innerHTML = `
    <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0px 2px 4px rgba(0,0,0,0.3));">
      <circle cx="12" cy="12" r="10" fill="${color}" stroke="white" stroke-width="2"/>
      <circle cx="12" cy="12" r="4" fill="white"/>
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
  return div
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
  onFiltersChange,
  onBoundsChanged,
  onPOIUpdated,
  onPOIDeleted,
  showTriggers = false,
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
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null)
  const boundsChangedTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const updateTaskIdRef = useRef<number>(0)
  
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
    const currentTriggerIds = new Set<string>()

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
            content = createAdvancedMarkerElement(poiStatus, isSelected)
            
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
            isZoomedIn
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
              onPOIClick(poi)
              setSelectedPOI(poi)
              
              if (infoWindowRef.current) {
                const infoContent = `
                <div class="p-3 max-w-xs">
                  <div class="flex items-start space-x-3">
                    <div class="flex-1 min-w-0">
                      <h3 class="text-lg font-semibold text-gray-900 mb-1">${poi.name}</h3>
                      <p class="text-sm text-gray-600 mb-2">${poi.city}, ${poi.country}</p>
                      <div class="flex items-center justify-between">
                        <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                          poi.approved ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'
                        }">
                          ${poi.approved ? 'Approved' : 'Pending'}
                        </span>
                        <div class="text-xs text-blue-600 font-medium">✏️ Click to edit</div>
                      </div>
                    </div>
                  </div>
                </div>`
                infoWindowRef.current.setContent(infoContent)
                infoWindowRef.current.open({
                   map: mapInstanceRef.current,
                   anchor: marker
                })
              }
            })
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
            s.isZoomedIn !== isZoomedIn
          ) {
            if (isCluster) {
              marker.content = createClusterMarkerElement(count)
            } else {
              const newContent = createAdvancedMarkerElement(poiStatus, isSelected)
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
            }
            marker.zIndex = isSelected ? 1000 : (isCluster ? 500 : 1)
            s.isCluster = isCluster
            s.count = count
            s.poiStatus = poiStatus
            s.isSelected = isSelected
            s.isZoomedIn = isZoomedIn
          }
        }

        // === TRIGGER MARKERS & POLYLINES ===
        if (showTriggers && poi.trigger_points) {
          poi.trigger_points.forEach(tp => {
            if (!tp.latitude || !tp.longitude) return
            
            const tpId = `${poi.id}-${tp.id}`
            currentTriggerIds.add(tpId)
            const tpPos = new google.maps.LatLng(tp.latitude, tp.longitude)
            
            let tpMarker = triggerMarkersRef.current.get(tpId) as any
            if (!tpMarker) {
              tpMarker = new google.maps.marker.AdvancedMarkerElement({
                position: tpPos,
                map: mapInstanceRef.current,
                content: createAdvancedTriggerMarkerElement(tp.is_active, tp.bearing),
                zIndex: 50,
                collisionBehavior: google.maps.CollisionBehavior.OPTIONAL_AND_HIDES_LOWER_PRIORITY
              }) as any
              tpMarker._tuggiState = {
                lat: tpPos.lat(),
                lng: tpPos.lng(),
                isActive: tp.is_active,
                bearing: tp.bearing
              }
              triggerMarkersRef.current.set(tpId, tpMarker)
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

            let polyline = polylinesRef.current.get(tpId) as any
            if (!polyline) {
              polyline = new google.maps.Polyline({
                path: [position, tpPos],
                geodesic: true,
                strokeColor: '#F97316',
                strokeOpacity: 0.6,
                strokeWeight: 2,
                icons: [{
                  icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.8, scale: 2 },
                  offset: '0',
                  repeat: '10px'
                }],
                map: mapInstanceRef.current!
              }) as any
              polyline._tuggiState = {
                p1Lat: position.lat(), p1Lng: position.lng(),
                p2Lat: tpPos.lat(), p2Lng: tpPos.lng()
              }
              polylinesRef.current.set(tpId, polyline)
            } else {
              const s = polyline._tuggiState
              const p1Lat = position.lat(), p1Lng = position.lng()
              const p2Lat = tpPos.lat(), p2Lng = tpPos.lng()

              if (s.p1Lat !== p1Lat || s.p1Lng !== p1Lng || s.p2Lat !== p2Lat || s.p2Lng !== p2Lng) {
                polyline.setPath([position, tpPos])
                s.p1Lat = p1Lat
                s.p1Lng = p1Lng
                s.p2Lat = p2Lat
                s.p2Lng = p2Lng
              }
            }
          })
        }
      }

      currentIndex = end
      if (currentIndex < pois.length) {
        requestAnimationFrame(processBatch)
      } else {
        // === CLEANUP ORPHANS (Final step) ===
        for (const [id, marker] of markersRef.current.entries()) {
          if (!currentPoiIds.has(id)) {
            marker.map = null
            markersRef.current.delete(id)
          }
        }

        for (const [id, marker] of triggerMarkersRef.current.entries()) {
          if (!currentTriggerIds.has(id)) {
            marker.map = null
            triggerMarkersRef.current.delete(id)
          }
        }

        for (const [id, polyline] of polylinesRef.current.entries()) {
          if (!currentTriggerIds.has(id)) {
            polyline.setMap(null)
            polylinesRef.current.delete(id)
          }
        }
      }
    }

    requestAnimationFrame(processBatch)
  }, [pois, onPOIClick, selectedPOI, zoomLevel, showTriggers])

  useEffect(() => {
    if (mapInstanceRef.current && pois.length > 0) {
      updateMarkers()
    } else if (pois.length === 0 && mapInstanceRef.current) {
       // Cleanup everything if list is completely emptied
       for (const marker of markersRef.current.values()) marker.map = null
       markersRef.current.clear()
       for (const marker of triggerMarkersRef.current.values()) marker.map = null
       triggerMarkersRef.current.clear()
       for (const poly of polylinesRef.current.values()) poly.setMap(null)
       polylinesRef.current.clear()
    }
  }, [updateMarkers, pois.length]) 

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
      let paths: google.maps.LatLng[] = []
      // ... boundary parsing logic simplified ...
      if (boundary.coordinates) {
         paths = boundary.coordinates.map(c => new google.maps.LatLng(c.lat, c.lng))
      } else if (boundary.geojson?.type === 'Polygon') {
         paths = boundary.geojson.coordinates[0].map((c: number[]) => new google.maps.LatLng(c[1], c[0]))
      }

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
        const bounds = new google.maps.LatLngBounds()
        paths.forEach(p => bounds.extend(p))
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