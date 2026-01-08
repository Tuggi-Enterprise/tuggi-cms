'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Wrapper } from '@googlemaps/react-wrapper'
import { 
  ZoomIn, ZoomOut, Eye, EyeOff, Maximize2
} from 'lucide-react'
import { cn } from '@/lib/utils'


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

// Create marker icon based on status
function createMarkerIcon(status: POIStatus, isSelected: boolean = false): google.maps.Icon {
  const color = getStatusColor(status)
  const size = isSelected ? 28 : 24
  
  return {
    url: 'data:image/svg+xml;base64,' + btoa(`
      <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10" fill="${color}" stroke="white" stroke-width="2"/>
        <circle cx="12" cy="12" r="4" fill="white"/>
      </svg>
    `),
    scaledSize: new google.maps.Size(size, size),
    anchor: new google.maps.Point(size / 2, size / 2)
  }
}

// Main Component
function POIMapContent({
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
  height,
  className,
  initialCenter = { lat: 39.8283, lng: -98.5795 }, // Center of USA
  initialZoom = 4
}: POIMapVisualizationProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<google.maps.Map | null>(null)
  const markersRef = useRef<Map<string, google.maps.Marker>>(new Map())
  const boundariesRef = useRef<google.maps.Polygon[]>([])
  const boundsChangedTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  
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

  // 1. Initialize Map
  const initializeMap = useCallback(() => {
    if (!mapRef.current || mapInstanceRef.current) return

    const map = new google.maps.Map(mapRef.current, {
      center: mapState.center,
      zoom: mapState.zoom,
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

    // State preservation listeners
    map.addListener('center_changed', () => {
      const center = map.getCenter()!
      setMapState(prev => ({
        ...prev,
        center: { lat: center.lat(), lng: center.lng() }
      }))
    })

    map.addListener('zoom_changed', () => {
      const zoom = map.getZoom()!
      setMapState(prev => ({
        ...prev,
        zoom: zoom
      }))
    })

    // Bounds change listener (debounced) - This triggers server fetch
    map.addListener('idle', () => {
      if (onBoundsChanged) {
        if (boundsChangedTimeoutRef.current) {
          clearTimeout(boundsChangedTimeoutRef.current)
        }
        
        boundsChangedTimeoutRef.current = setTimeout(() => {
          if (!mapInstanceRef.current) return
          
          const bounds = mapInstanceRef.current.getBounds()
          const zoom = mapInstanceRef.current.getZoom()
          
          if (bounds && zoom) {
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
    if (window.google && window.google.maps && !mapInstanceRef.current) {
      initializeMap()
    }
  }, [initializeMap])

  // 3. Update Markers Effect
  // This reacts ONLY to `pois` prop changes. No internal fetching.
  const updateMarkers = useCallback(() => {
    if (!mapInstanceRef.current) return

    // Clear existing
    markersRef.current.forEach(marker => marker.setMap(null))
    markersRef.current.clear()

    console.log(`🗺️ [POIMapVisualization] Rendering ${pois.length} items`)

    pois.forEach((poi) => {
      if (!poi.coordinates?.latitude || !poi.coordinates?.longitude) return

      const position = new google.maps.LatLng(poi.coordinates.latitude, poi.coordinates.longitude)
      const isSelected = selectedPOI?.id === poi.id

      let marker: google.maps.Marker

      if (poi.type === 'cluster') {
        const count = poi.count || 0
        marker = new google.maps.Marker({
          position,
          icon: {
            url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
              <svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
                <circle cx="20" cy="20" r="18" fill="#3B82F6" stroke="#1E40AF" stroke-width="2"/>
                <text x="20" y="26" text-anchor="middle" fill="white" font-size="12" font-weight="bold">
                  ${count > 999 ? Math.floor(count/1000) + 'k' : count}
                </text>
              </svg>
            `),
            scaledSize: new google.maps.Size(40, 40),
            anchor: new google.maps.Point(20, 20)
          },
          label: {
            text: count.toString(),
            color: 'white',
            fontSize: '12px',
            fontWeight: 'bold'
          },
          zIndex: 1000,
          map: mapInstanceRef.current!,
          cursor: 'pointer'
        })
        
        marker.addListener('click', () => {
           const map = mapInstanceRef.current
           if (map) {
             map.setCenter(position)
             map.setZoom((map.getZoom() || 0) + 2)
           }
        })
      } else {
        // Individual POI
        const status = getPOIStatus(poi)
        marker = new google.maps.Marker({
          position,
          title: `${poi.name}`,
          icon: createMarkerIcon(status, isSelected),
          map: mapInstanceRef.current!,
          cursor: 'pointer'
        })

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
        </div>
        `

        const infoWindow = new google.maps.InfoWindow({ content: infoContent })

        marker.addListener('click', () => {
          markersRef.current.forEach((otherMarker, otherId) => {
            if (otherId !== poi.id && (otherMarker as any).infoWindow) {
              ;(otherMarker as any).infoWindow.close()
            }
          })
          onPOIClick(poi)
          setSelectedPOI(poi)
          marker.setIcon(createMarkerIcon(status, true))
          infoWindow.open(mapInstanceRef.current!, marker)
        })

        ;(marker as any).infoWindow = infoWindow
      }

      markersRef.current.set(poi.id, marker)
    })
  }, [pois, onPOIClick, selectedPOI])

  useEffect(() => {
    if (mapInstanceRef.current && pois.length > 0) {
      updateMarkers()
    }
  }, [updateMarkers]) // updateMarkers depends on pois, stable

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
        fillOpacity: 0.1,
        strokeColor: '#1E40AF',
        strokeWeight: 2,
        clickable: true,
        map: mapInstanceRef.current
      })
      boundariesRef.current.push(polygon)
    })
  }, [cityBoundaries])

  useEffect(() => {
    fetchCityBoundaries()
  }, [fetchCityBoundaries])

  useEffect(() => {
    updateCityBoundaries()
  }, [updateCityBoundaries])

  return (
    <div className={cn("relative w-full rounded-lg overflow-hidden border border-gray-200 dark:border-gray-800", className)} style={{ height }}>
      <Wrapper 
        apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''} 
        render={(status) => {
          if (status === 'LOADING') return <div className="p-4">Loading Map...</div>
          return <div ref={mapRef} className="w-full h-full bg-gray-100 dark:bg-gray-800" />
        }}
        libraries={['drawing', 'places', 'geometry']}
        version="weekly"
      />

      {/* Map Controls */}
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

      {/* Stats */}
      <div className="absolute bottom-4 left-4 bg-white rounded-lg shadow-lg px-3 py-2 z-10">
        <span className="text-sm font-medium text-gray-700">
          {totalCount !== undefined ? `${pois.length} visible / ${totalCount} total` : `${pois.length} items`}
        </span>
      </div>
    </div>
  )
}

export const POIMapVisualization = POIMapContent