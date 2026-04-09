'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { Wrapper, Status } from '@googlemaps/react-wrapper'
import { 
  ZoomIn, ZoomOut, Map as MapIcon, Layers, Info
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { GOOGLE_MAPS_LIBRARIES, GOOGLE_MAPS_VERSION } from '@/lib/maps-config'

const LIBRARIES = GOOGLE_MAPS_LIBRARIES

// Extended POI interface with trigger points coordinates
export interface POIWithTriggers {
  id: string
  name: string
  city: string
  country: string
  state: string | null
  approved: boolean
  coordinates?: {
    latitude: number
    longitude: number
  }
  trigger_points: Array<{
    id: string
    is_active: boolean
    type: string
    latitude: number
    longitude: number
    bearing: number | null
  }>
}

interface CityBoundary {
  name: string
  geojson: any
  coordinates?: Array<{lat: number, lng: number}>
}

export interface POITriggerMapProps {
  pois: POIWithTriggers[]
  cityFilter: string
  countryFilter: string
  stateFilter: string
  onPOIClick?: (poi: any) => void
  height?: string
  className?: string
}

const TRIGGER_POINT_COLOR = '#F97316' // Vibrant Orange

const TRIGGER_POINT_TYPE_COLORS: Record<string, string> = {
  primary: '#F97316',
  fallback: '#94A3B8', // Keeping some differentiation in legend but map will use orange for visibility
  entry: '#10B981',
  exit: '#EF4444',
  approach: '#F59E0B',
  custom: '#8B5CF6'
}

function getStatusColor(approved: boolean): string {
  return approved ? '#10B981' : '#F59E0B'
}

function createPOIMarkerIcon(approved: boolean, isSelected: boolean = false): google.maps.Icon {
  const color = getStatusColor(approved)
  const size = isSelected ? 32 : 26
  
  return {
    url: 'data:image/svg+xml;base64,' + btoa(`
      <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10" fill="${color}" stroke="white" stroke-width="2"/>
        <circle cx="12" cy="12" r="4" fill="white"/>
      </svg>
    `),
    scaledSize: new google.maps.Size(size, size),
    anchor: new google.maps.Point(size / 2, size / 2),
    labelOrigin: new google.maps.Point(size / 2, size + 10)
  }
}

function createTriggerMarkerIcon(type: string, is_active: boolean, bearing: number | null): google.maps.Icon {
  const color = TRIGGER_POINT_COLOR
  const size = 20
  const opacity = is_active ? 1 : 0.5
  const hasBearing = bearing !== null && bearing !== undefined
  
  // Create an SVG with a dot and an arrow pointing up
  // The arrow will be rotated by the icon's rotation property
  const svg = `
    <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="6" fill="${color}" fill-opacity="${opacity}" stroke="white" stroke-width="2"/>
      ${hasBearing ? `
        <g transform="rotate(${bearing}, 12, 12)">
          <path d="M12 2L16 8H8L12 2Z" fill="${color}" fill-opacity="${opacity}" stroke="white" stroke-width="1"/>
        </g>
      ` : ''}
    </svg>
  `
  
  return {
    url: 'data:image/svg+xml;base64,' + btoa(svg),
    scaledSize: new google.maps.Size(size, size),
    anchor: new google.maps.Point(size / 2, size / 2)
  }
}

function POITriggerMapInner({
  pois = [],
  cityFilter,
  countryFilter,
  stateFilter,
  onPOIClick,
  height = '600px',
  className
}: POITriggerMapProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<google.maps.Map | null>(null)
  const markersRef = useRef<google.maps.Marker[]>([])
  const triggerMarkersRef = useRef<google.maps.Marker[]>([])
  const polylinesRef = useRef<google.maps.Polyline[]>([])
  const boundariesRef = useRef<google.maps.Polygon[]>([])
  
  const [cityBoundaries, setCityBoundaries] = useState<CityBoundary[]>([])
  const [showLines, setShowLines] = useState(true)
  const [showTriggers, setShowTriggers] = useState(true)
  const [zoomLevel, setZoomLevel] = useState(12)

  // Initialize Map
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return

    const map = new google.maps.Map(mapRef.current, {
      center: { lat: -23.5505, lng: -46.6333 }, // Default Sao Paulo
      zoom: 12,
      mapTypeControl: true,
      streetViewControl: true,
      fullscreenControl: true,
      zoomControl: false,
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

    map.addListener('zoom_changed', () => {
      setZoomLevel(map.getZoom() || 12)
    })

    mapInstanceRef.current = map
  }, [])

  // Fetch City Boundaries
  useEffect(() => {
    const fetchBoundaries = async () => {
      if (!cityFilter) {
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
        
        if (result.success && result.data) {
          setCityBoundaries(result.data)
          
          // Auto-center on boundary
          if (result.data.length > 0 && mapInstanceRef.current) {
            const boundary = result.data[0]
            const bounds = new google.maps.LatLngBounds()
            
            let coords = []
            if (boundary.coordinates) {
              coords = boundary.coordinates
            } else if (boundary.geojson?.type === 'Polygon') {
              coords = boundary.geojson.coordinates[0].map((c: any) => ({ lat: c[1], lng: c[0] }))
            } else if (boundary.geojson?.type === 'MultiPolygon') {
              // Simplification: use the first polygon of multipolygon
              coords = boundary.geojson.coordinates[0][0].map((c: any) => ({ lat: c[1], lng: c[0] }))
            }

            coords.forEach((c: any) => bounds.extend(new google.maps.LatLng(c.lat, c.lng)))
            mapInstanceRef.current.fitBounds(bounds)
          }
        }
      } catch (error) {
        console.error('Error loading boundaries:', error)
      }
    }

    fetchBoundaries()
  }, [cityFilter, countryFilter, stateFilter])

  // Update Boundaries on Map
  useEffect(() => {
    if (!mapInstanceRef.current) return

    boundariesRef.current.forEach(b => b.setMap(null))
    boundariesRef.current = []

    cityBoundaries.forEach(boundary => {
      let paths: google.maps.LatLng[] = []
      
      if (boundary.coordinates) {
        paths = boundary.coordinates.map(c => new google.maps.LatLng(c.lat, c.lng))
      } else if (boundary.geojson?.type === 'Polygon') {
        paths = boundary.geojson.coordinates[0].map((c: any) => new google.maps.LatLng(c[1], c[0]))
      } else if (boundary.geojson?.type === 'MultiPolygon') {
        paths = boundary.geojson.coordinates[0][0].map((c: any) => new google.maps.LatLng(c[1], c[0]))
      }

      if (paths.length === 0) return

      const polygon = new google.maps.Polygon({
        paths,
        fillColor: '#3B82F6',
        fillOpacity: 0.05,
        strokeColor: '#3B82F6',
        strokeWeight: 2,
        strokeOpacity: 0.3,
        map: mapInstanceRef.current
      })
      boundariesRef.current.push(polygon)
    })
  }, [cityBoundaries])

  // Update Markers & Lines
  useEffect(() => {
    if (!mapInstanceRef.current) return

    // Clear existing
    markersRef.current.forEach(m => m.setMap(null))
    triggerMarkersRef.current.forEach(m => m.setMap(null))
    polylinesRef.current.forEach(p => p.setMap(null))
    
    markersRef.current = []
    triggerMarkersRef.current = []
    polylinesRef.current = []

    pois.forEach(poi => {
      if (!poi.coordinates?.latitude || !poi.coordinates?.longitude) return

      const poiPos = new google.maps.LatLng(poi.coordinates.latitude, poi.coordinates.longitude)
      
      // POI Marker
      const poiMarker = new google.maps.Marker({
        position: poiPos,
        title: poi.name,
        icon: createPOIMarkerIcon(poi.approved),
        label: zoomLevel >= 16 ? {
          text: poi.name,
          color: '#1F2937',
          fontSize: '11px',
          fontWeight: '700',
          className: 'poi-map-label'
        } : null,
        map: mapInstanceRef.current!,
        zIndex: 100
      })
      
      poiMarker.addListener('click', () => onPOIClick?.(poi))
      markersRef.current.push(poiMarker)

      // Trigger Points
      if (showTriggers && poi.trigger_points) {
        poi.trigger_points.forEach(tp => {
          if (!tp.latitude || !tp.longitude) return
          
          const tpPos = new google.maps.LatLng(tp.latitude, tp.longitude)
          
          // Trigger Marker
          const tpMarker = new google.maps.Marker({
            position: tpPos,
            title: `Trigger: ${tp.type} (${tp.is_active ? 'Active' : 'Inactive'}) ${tp.bearing ? `- Bearing: ${tp.bearing}°` : ''}`,
            icon: createTriggerMarkerIcon(tp.type, tp.is_active, tp.bearing),
            map: mapInstanceRef.current!,
            zIndex: 50
          })
          triggerMarkersRef.current.push(tpMarker)

          // Line
          if (showLines) {
            const polyline = new google.maps.Polyline({
              path: [poiPos, tpPos],
              geodesic: true,
              strokeColor: TRIGGER_POINT_COLOR,
              strokeOpacity: 0.6,
              strokeWeight: 2,
              icons: [{
                icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.8, scale: 2 },
                offset: '0',
                repeat: '10px'
              }],
              map: mapInstanceRef.current!
            })
            polylinesRef.current.push(polyline)
          }
        })
      }
    })
  }, [pois, showLines, showTriggers, onPOIClick, zoomLevel])

  return (
    <div className="w-full h-full relative group">
      <div ref={mapRef} className="w-full h-full bg-gray-100 dark:bg-gray-900" />
      
      {/* Controls */}
      <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
        <div className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-md rounded-xl shadow-xl border border-gray-200/50 dark:border-gray-700/50 p-1.5 flex flex-col gap-1">
          <button
            onClick={() => mapInstanceRef.current?.setZoom((mapInstanceRef.current.getZoom() || 0) + 1)}
            className="p-2.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-all active:scale-95"
            title="Zoom In"
          >
            <ZoomIn className="w-5 h-5 text-gray-700 dark:text-gray-300" />
          </button>
          <button
            onClick={() => mapInstanceRef.current?.setZoom((mapInstanceRef.current.getZoom() || 0) - 1)}
            className="p-2.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-all active:scale-95"
            title="Zoom Out"
          >
            <ZoomOut className="w-5 h-5 text-gray-700 dark:text-gray-300" />
          </button>
        </div>

        <div className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-md rounded-xl shadow-xl border border-gray-200/50 dark:border-gray-700/50 p-1.5 flex flex-col gap-1">
          <button
            onClick={() => setShowLines(!showLines)}
            className={cn(
              "p-2.5 rounded-lg transition-all active:scale-95",
              showLines ? "bg-blue-500 text-white shadow-lg shadow-blue-500/20" : "hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
            )}
            title="Toggle Connection Lines"
          >
            <Layers className="w-5 h-5" />
          </button>
          <button
            onClick={() => setShowTriggers(!showTriggers)}
            className={cn(
              "p-2.5 rounded-lg transition-all active:scale-95",
              showTriggers ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/20" : "hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
            )}
            title="Toggle Trigger Points"
          >
            <MapIcon className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="absolute bottom-6 right-6 z-10">
        <div className="bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-gray-200/50 dark:border-gray-800/50 p-4 min-w-[200px]">
          <div className="flex items-center gap-2 mb-3">
            <Info className="w-4 h-4 text-tuggi-blue" />
            <h4 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider">Legend</h4>
          </div>
          <div className="space-y-2.5">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-[#10B981]" />
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Approved POI</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-[#F59E0B]" />
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Pending POI</span>
            </div>
            <div className="my-2 border-t border-gray-100 dark:border-gray-800" />
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-[#F97316]" />
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Trigger Point</span>
            </div>
            <div className="my-2 border-t border-gray-100 dark:border-gray-800" />
            <div className="space-y-1.5 opacity-60">
              <p className="text-[10px] uppercase font-bold text-gray-400 tracking-tighter mb-1">Trigger Types</p>
              {Object.entries(TRIGGER_POINT_TYPE_COLORS).map(([type, color]) => (
                <div key={type} className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
                  <span className="text-[10px] text-gray-500 capitalize">{type}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Visible count */}
      <div className="absolute bottom-6 left-6 z-10">
        <div className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-md rounded-full shadow-lg border border-gray-200/50 dark:border-gray-700/50 px-5 py-2">
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">
            {pois.length} POIs visible
          </span>
        </div>
      </div>
    </div>
  )
}

export function POITriggerMap(props: POITriggerMapProps) {
  const { className, height = '600px' } = props
  
  return (
    <div className={cn("relative w-full rounded-3xl overflow-hidden border border-gray-200 dark:border-gray-800 shadow-2xl shadow-black/5", className)} style={{ height }}>
      <Wrapper
        apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''}
        libraries={LIBRARIES}
        version={GOOGLE_MAPS_VERSION}
        render={(status) => {
          if (status === Status.LOADING) {
            return (
              <div className="flex flex-col items-center justify-center h-full bg-gray-50 dark:bg-gray-900">
                <div className="w-12 h-12 border-4 border-tuggi-blue border-t-transparent rounded-full animate-spin mb-4" />
                <p className="text-sm font-medium text-gray-500">Loading map experience...</p>
              </div>
            )
          }
          if (status === Status.FAILURE) {
            return (
              <div className="p-8 flex flex-col items-center justify-center h-full bg-gray-50 dark:bg-gray-900 text-center">
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
                  <MapIcon className="w-8 h-8 text-red-500" />
                </div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Map Load Failed</h3>
                <p className="text-sm text-gray-500 max-w-xs">Failed to load Google Maps. Please check your API key and network connection.</p>
              </div>
            )
          }
          if (status === Status.SUCCESS) return <POITriggerMapInner {...props} />
          return <></>
        }}
      />
    </div>
  )
}
