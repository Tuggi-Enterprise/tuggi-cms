'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Wrapper, Status } from '@googlemaps/react-wrapper'
import { GoogleMapComponent } from '@/components/ui/GoogleMapComponent'

const LIBRARIES: any[] = ['drawing', 'places', 'geometry', 'visualization']

export interface TrailPoint {
  id: string
  user_id: string
  trip_session_id: string
  latitude: number
  longitude: number
  timestamp: string
  sequence_order: number
}

export interface Trail {
  unified_trip_id: string
  user_id: string
  session_ids: string[]
  points: TrailPoint[]
  start_time: string
  end_time: string
  duration_minutes: number
}

export interface HeatMapPoint {
  lat: number
  lng: number
  weight: number
}

interface TrailMapProps {
  center?: { lat: number; lng: number }
  zoom?: number
  height?: string
  className?: string
  trails?: Trail[]
  heatMapData?: HeatMapPoint[]
  showTrails?: boolean
  showHeatMap?: boolean
  selectedUserIds?: string[]
  onBoundsChange?: (bounds: { north: number; south: number; east: number; west: number }) => void
  isLoading?: boolean
}

// Color generator for different users
const getUserColor = (userId: string, index: number): string => {
  const colors = [
    '#00A8E8', // Tuggi blue
    '#FF6F00', // Orange
    '#10B981', // Green
    '#8B5CF6', // Purple
    '#F59E0B', // Amber
    '#EF4444', // Red
    '#06B6D4', // Cyan
    '#EC4899'  // Pink
  ]
  // Use hash of user_id to get consistent color
  const hash = userId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  return colors[hash % colors.length]
}

// The actual map component
function TrailMapContent({
  center = { lat: -23.5505, lng: -46.6333 }, // Default to São Paulo
  zoom = 13,
  trails = [],
  heatMapData = [],
  showTrails = true,
  showHeatMap = false,
  selectedUserIds = [],
  onBoundsChange,
  isLoading = false
}: Omit<TrailMapProps, 'height' | 'className'>) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<google.maps.Map | null>(null)
  const polylinesRef = useRef<Map<string, google.maps.Polyline>>(new Map())
  const heatmapLayerRef = useRef<google.maps.visualization.HeatmapLayer | null>(null)
  const boundsListenerRef = useRef<google.maps.MapsEventListener | null>(null)

  const initializeMap = useCallback(() => {
    if (!mapRef.current || mapInstanceRef.current) return

    const map = new google.maps.Map(mapRef.current, {
      center,
      zoom,
      mapTypeControl: true,
      streetViewControl: true,
      fullscreenControl: true,
      zoomControl: true
    })

    mapInstanceRef.current = map

    // Listen to bounds changes
    if (onBoundsChange) {
      const updateBounds = () => {
        const bounds = map.getBounds()
        if (bounds) {
          const ne = bounds.getNorthEast()
          const sw = bounds.getSouthWest()
          onBoundsChange({
            north: ne.lat(),
            south: sw.lat(),
            east: ne.lng(),
            west: sw.lng()
          })
        }
      }

      // Initial bounds
      updateBounds()

      // Listen to bounds changes
      boundsListenerRef.current = map.addListener('bounds_changed', () => {
        // Debounce bounds updates
        setTimeout(updateBounds, 500)
      })

      // Also listen to drag and zoom
      map.addListener('dragend', updateBounds)
      map.addListener('zoom_changed', updateBounds)
    }
  }, [center, zoom, onBoundsChange])

  useEffect(() => {
    initializeMap()
  }, [initializeMap])

  // Render trails as polylines
  useEffect(() => {
    if (!mapInstanceRef.current || !showTrails) {
      // Clear all polylines if not showing trails
      polylinesRef.current.forEach(polyline => polyline.setMap(null))
      polylinesRef.current.clear()
      return
    }

    const map = mapInstanceRef.current

    // Clear existing polylines
    polylinesRef.current.forEach(polyline => polyline.setMap(null))
    polylinesRef.current.clear()

    // Filter trails by selected users
    const filteredTrails = selectedUserIds.length > 0
      ? trails.filter(trail => selectedUserIds.includes(trail.user_id))
      : trails

    // Create polylines for each trail
    filteredTrails.forEach((trail, index) => {
      if (trail.points.length < 2) return // Need at least 2 points for a line

      // Points are already sorted by timestamp/sequence in unified trail
      // But ensure they're in correct order for rendering
      const path = trail.points
        .sort((a, b) => {
          // Sort by timestamp first, then sequence_order
          const timeA = new Date(a.timestamp).getTime()
          const timeB = new Date(b.timestamp).getTime()
          if (timeA !== timeB) {
            return timeA - timeB
          }
          return a.sequence_order - b.sequence_order
        })
        .map(point => ({
          lat: point.latitude,
          lng: point.longitude
        }))

      const polyline = new google.maps.Polyline({
        path,
        geodesic: true,
        strokeColor: getUserColor(trail.user_id, index),
        strokeOpacity: 0.7,
        strokeWeight: 3
      })

      polyline.setMap(map)
      // Use unified_trip_id as key (fallback to first session_id for compatibility)
      const trailKey = (trail as any).unified_trip_id || (trail as any).session_ids?.[0] || (trail as any).trip_session_id || `trail_${index}`
      polylinesRef.current.set(trailKey, polyline)
    })

    // Note: Removed automatic fitBounds to give users full control over zoom
  }, [trails, showTrails, selectedUserIds])

  // Render heat map
  useEffect(() => {
    if (!mapInstanceRef.current || !showHeatMap) {
      if (heatmapLayerRef.current) {
        heatmapLayerRef.current.setMap(null)
        heatmapLayerRef.current = null
      }
      return
    }

    const map = mapInstanceRef.current

    // Load visualization library if not already loaded
    // The library is loaded via the Wrapper component's libraries prop
    if (typeof google === 'undefined' || !google.maps || !google.maps.visualization) {
      console.error('Google Maps Visualization library not loaded')
      return
    }

    // Clear existing heatmap
    if (heatmapLayerRef.current) {
      heatmapLayerRef.current.setMap(null)
    }

    if (heatMapData.length === 0) {
      return
    }

    // Convert heat map data to Google Maps format
    const heatmapData = heatMapData.map(point => ({
      location: new google.maps.LatLng(point.lat, point.lng),
      weight: point.weight
    }))

    // Create heatmap layer
    const heatmap = new google.maps.visualization.HeatmapLayer({
      data: heatmapData,
      map: map,
      radius: 50,
      opacity: 0.6,
      gradient: [
        'rgba(0, 255, 255, 0)',
        'rgba(0, 255, 255, 1)',
        'rgba(0, 191, 255, 1)',
        'rgba(0, 127, 255, 1)',
        'rgba(0, 63, 255, 1)',
        'rgba(0, 0, 255, 1)',
        'rgba(0, 0, 223, 1)',
        'rgba(0, 0, 191, 1)',
        'rgba(0, 0, 159, 1)',
        'rgba(0, 0, 127, 1)',
        'rgba(63, 0, 91, 1)',
        'rgba(127, 0, 63, 1)',
        'rgba(191, 0, 31, 1)',
        'rgba(255, 0, 0, 1)'
      ]
    })

    heatmapLayerRef.current = heatmap
  }, [heatMapData, showHeatMap])

  // Cleanup
  useEffect(() => {
    return () => {
      if (boundsListenerRef.current) {
        google.maps.event.removeListener(boundsListenerRef.current)
      }
      polylinesRef.current.forEach(polyline => polyline.setMap(null))
      if (heatmapLayerRef.current) {
        heatmapLayerRef.current.setMap(null)
      }
    }
  }, [])

  return (
    <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
  )
}

// Main component with Google Maps wrapper
export function TrailMap(props: TrailMapProps) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

  if (!apiKey) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-100 dark:bg-gray-800 rounded-lg">
        <div className="text-center p-6">
          <p className="text-red-500 dark:text-red-400">
            Google Maps API key is not configured
          </p>
        </div>
      </div>
    )
  }

  const renderFunction = (status: Status) => {
    switch (status) {
      case Status.LOADING:
        return (
          <div className="flex items-center justify-center h-full bg-gray-100 dark:bg-gray-800 rounded-lg">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-tuggi-blue mx-auto mb-4"></div>
              <p className="text-gray-600 dark:text-gray-400">Loading Google Maps...</p>
            </div>
          </div>
        )
      case Status.FAILURE:
        return (
          <div className="flex items-center justify-center h-full bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
            <div className="text-center p-6">
              <p className="text-red-500 dark:text-red-500">
                Failed to load Google Maps. Please check your API key.
              </p>
            </div>
          </div>
        )
      case Status.SUCCESS:
        return <TrailMapContent {...props} />
      default:
        return <div>Unknown status</div>
    }
  }

  return (
    <div className={props.className} style={{ height: props.height || '600px' }}>
      <Wrapper
        apiKey={apiKey}
        render={renderFunction}
        libraries={LIBRARIES}
        version="weekly"
      />
    </div>
  )
}

