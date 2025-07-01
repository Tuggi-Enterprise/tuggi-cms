'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Wrapper, Status } from '@googlemaps/react-wrapper'

interface GoogleMapComponentProps {
  center?: { lat: number; lng: number }
  zoom?: number
  height?: string
  className?: string
  onPolygonComplete?: (polygon: google.maps.Polygon) => void
  onMarkerClick?: (markerId: string) => void
  markers?: Array<{
    id: string
    position: { lat: number; lng: number }
    title: string
    description?: string
    color?: string
  }>
  polygon?: Array<{ lat: number; lng: number }>
  cityBoundary?: Array<{ lat: number; lng: number }> | null
  cityName?: string
  enableDrawing?: boolean
  showDrawingButton?: boolean
}

interface MapProps extends GoogleMapComponentProps {
  apiKey: string
}

// The actual Google Map component
function Map({
  center = { lat: 40.7128, lng: -74.0060 },
  zoom = 13,
  onPolygonComplete,
  onMarkerClick,
  markers = [],
  polygon,
  cityBoundary,
  cityName,
  enableDrawing = true
}: Omit<GoogleMapComponentProps, 'height' | 'className'>) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<google.maps.Map | null>(null)
  const drawingManagerRef = useRef<google.maps.drawing.DrawingManager | null>(null)
  const currentPolygonRef = useRef<google.maps.Polygon | null>(null)
  const cityBoundaryRef = useRef<google.maps.Polygon | null>(null)
  const markersRef = useRef<google.maps.Marker[]>([])

  const initializeMap = useCallback(() => {
    if (!mapRef.current || mapInstanceRef.current) return

    // Create the map
    const map = new google.maps.Map(mapRef.current, {
      center,
      zoom,
      mapTypeControl: true,
      streetViewControl: false,
      fullscreenControl: false,
    })

    mapInstanceRef.current = map

    // Initialize drawing manager if enabled
    if (enableDrawing) {
      // Wait for the drawing library to be loaded
      if (google.maps.drawing) {
        const drawingManager = new google.maps.drawing.DrawingManager({
          drawingMode: null,
          drawingControl: true,
          drawingControlOptions: {
            position: google.maps.ControlPosition.TOP_LEFT,
            drawingModes: [google.maps.drawing.OverlayType.POLYGON],
          },
          polygonOptions: {
            fillColor: '#00A8E8',
            fillOpacity: 0.3,
            strokeColor: '#00A8E8',
            strokeWeight: 3,
            editable: true,
            draggable: true,
          },
        })

        console.log('Drawing Manager initialized:', drawingManager)

        drawingManager.setMap(map)
        drawingManagerRef.current = drawingManager

        // Add custom drawing control button
        const controlDiv = document.createElement('div')
        controlDiv.style.margin = '10px'
        
        const controlButton = document.createElement('button')
        controlButton.style.backgroundColor = '#00A8E8'
        controlButton.style.color = 'white'
        controlButton.style.border = 'none'
        controlButton.style.borderRadius = '4px'
        controlButton.style.padding = '8px 12px'
        controlButton.style.fontSize = '14px'
        controlButton.style.fontWeight = 'bold'
        controlButton.style.cursor = 'pointer'
        controlButton.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)'
        controlButton.innerHTML = '🔸 Draw Polygon'
        controlButton.title = 'Click to start drawing a polygon'
        
        controlButton.addEventListener('click', () => {
          if (drawingManager.getDrawingMode() === google.maps.drawing.OverlayType.POLYGON) {
            drawingManager.setDrawingMode(null)
            controlButton.innerHTML = '🔸 Draw Polygon'
            controlButton.style.backgroundColor = '#00A8E8'
          } else {
            drawingManager.setDrawingMode(google.maps.drawing.OverlayType.POLYGON)
            controlButton.innerHTML = '⏹️ Stop Drawing'
            controlButton.style.backgroundColor = '#FF6F00'
          }
        })
        
        controlDiv.appendChild(controlButton)
        map.controls[google.maps.ControlPosition.TOP_RIGHT].push(controlDiv)

        // Handle polygon completion
        google.maps.event.addListener(drawingManager, 'polygoncomplete', (polygon: google.maps.Polygon) => {
          // Clear any existing polygon
          if (currentPolygonRef.current) {
            currentPolygonRef.current.setMap(null)
          }

          currentPolygonRef.current = polygon
          drawingManager.setDrawingMode(null)
          
          // Reset button state
          controlButton.innerHTML = '🔸 Draw Polygon'
          controlButton.style.backgroundColor = '#00A8E8'

          if (onPolygonComplete) {
            onPolygonComplete(polygon)
          }
        })
      } else {
        console.error('Google Maps Drawing library not loaded')
      }
    }
  }, [center, zoom, enableDrawing, onPolygonComplete])

  const updateMarkers = useCallback(() => {
    if (!mapInstanceRef.current) return

    // Clear existing markers
    markersRef.current.forEach(marker => marker.setMap(null))
    markersRef.current = []

    // Add new markers
    markers.forEach(markerData => {
      const markerColor = markerData.color || '#FF6F00' // Default to Tuggi orange
      
      const marker = new google.maps.Marker({
        position: markerData.position,
        map: mapInstanceRef.current!,
        title: markerData.title,
        icon: {
          url: 'data:image/svg+xml;base64,' + btoa(`
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="${markerColor}"/>
            </svg>
          `),
          scaledSize: new google.maps.Size(24, 24),
          anchor: new google.maps.Point(12, 24)
        }
      })

      // Add click listener
      if (onMarkerClick) {
        marker.addListener('click', () => onMarkerClick(markerData.id))
      }

      // Add info window
      if (markerData.description) {
        const infoWindow = new google.maps.InfoWindow({
          content: `
            <div>
              <h3 style="margin: 0 0 8px 0; font-weight: 600;">${markerData.title}</h3>
              <p style="margin: 0; font-size: 12px; color: #666;">${markerData.description}</p>
            </div>
          `
        })

        marker.addListener('click', () => {
          infoWindow.open(mapInstanceRef.current!, marker)
        })
      }

      markersRef.current.push(marker)
    })
  }, [markers, onMarkerClick])

  const updateMapView = useCallback(() => {
    if (!mapInstanceRef.current) return
    
    mapInstanceRef.current.setCenter(center)
    mapInstanceRef.current.setZoom(zoom)
  }, [center, zoom])

  const updatePolygon = useCallback(() => {
    if (!mapInstanceRef.current || !polygon || polygon.length === 0) return

    // Clear existing polygon
    if (currentPolygonRef.current) {
      currentPolygonRef.current.setMap(null)
    }

    // Create new polygon
    const polygonShape = new google.maps.Polygon({
      paths: polygon,
      fillColor: '#00A8E8',
      fillOpacity: 0.3,
      strokeColor: '#00A8E8',
      strokeWeight: 2,
      editable: true,
      draggable: true,
    })

    polygonShape.setMap(mapInstanceRef.current)
    currentPolygonRef.current = polygonShape

    // Fit map to polygon bounds
    const bounds = new google.maps.LatLngBounds()
    polygon.forEach(point => bounds.extend(point))
    mapInstanceRef.current.fitBounds(bounds)
  }, [polygon])

  const updateCityBoundary = useCallback(() => {
    if (!mapInstanceRef.current) return

    // Clear existing city boundary
    if (cityBoundaryRef.current) {
      cityBoundaryRef.current.setMap(null)
      cityBoundaryRef.current = null
    }

    // Add new city boundary if provided
    if (cityBoundary && cityBoundary.length > 0) {
      const boundaryShape = new google.maps.Polygon({
        paths: cityBoundary,
        fillColor: '#10B981', // Green color for city boundaries
        fillOpacity: 0.1,
        strokeColor: '#10B981',
        strokeWeight: 2,
        editable: false,
        draggable: false,
        clickable: false,
      })

      boundaryShape.setMap(mapInstanceRef.current)
      cityBoundaryRef.current = boundaryShape

      // Add info window for city name
      if (cityName) {
        const bounds = new google.maps.LatLngBounds()
        cityBoundary.forEach(point => bounds.extend(point))
        const center = bounds.getCenter()

        const infoWindow = new google.maps.InfoWindow({
          content: `
            <div style="padding: 8px;">
              <h3 style="margin: 0; font-size: 14px; font-weight: 600; color: #10B981;">
                🏙️ ${cityName}
              </h3>
              <p style="margin: 4px 0 0 0; font-size: 12px; color: #666;">
                City Boundary
              </p>
            </div>
          `,
          position: center
        })

        // Show info window for 3 seconds
        infoWindow.open(mapInstanceRef.current)
        setTimeout(() => infoWindow.close(), 3000)
      }

      console.log(`Displayed boundary for ${cityName} with ${cityBoundary.length} points`)
    }
  }, [cityBoundary, cityName])

  useEffect(() => {
    if (window.google && window.google.maps && window.google.maps.drawing) {
      initializeMap()
    } else {
      // Wait for the drawing library to load
      const checkLibraries = setInterval(() => {
        if (window.google && window.google.maps && window.google.maps.drawing) {
          clearInterval(checkLibraries)
          initializeMap()
        }
      }, 100)

      // Cleanup interval after 10 seconds to prevent infinite polling
      setTimeout(() => clearInterval(checkLibraries), 10000)
    }
  }, [initializeMap])

  useEffect(() => {
    updateMarkers()
  }, [updateMarkers])

  useEffect(() => {
    updatePolygon()
  }, [updatePolygon])

  useEffect(() => {
    updateMapView()
  }, [updateMapView])

  useEffect(() => {
    updateCityBoundary()
  }, [updateCityBoundary])

  return <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
}



// Main component that wraps everything
export function GoogleMapComponent({
  height = '400px',
  className = '',
  ...mapProps
}: GoogleMapComponentProps) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

  if (!apiKey) {
    return (
      <div 
        className={`bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800 flex items-center justify-center ${className}`}
        style={{ height }}
      >
        <div className="text-center p-4">
          <p className="text-yellow-700 dark:text-yellow-300 font-medium">
            Google Maps API Key Required
          </p>
          <p className="text-yellow-600 dark:text-yellow-400 text-sm mt-1">
            Please add NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to your environment variables
          </p>
        </div>
      </div>
    )
  }

  const renderFunction = (status: Status) => {
    switch (status) {
      case Status.LOADING:
        return (
          <div className="flex items-center justify-center h-full bg-gray-200 dark:bg-gray-700 rounded-lg">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-tuggi-blue mx-auto mb-2"></div>
              <p className="text-gray-500 dark:text-gray-400">Loading Google Maps...</p>
            </div>
          </div>
        )
      case Status.FAILURE:
        return (
          <div className="flex items-center justify-center h-full bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
            <div className="text-center">
              <p className="text-red-600 dark:text-red-400 font-medium">Failed to load Google Maps</p>
              <p className="text-red-500 dark:text-red-500 text-sm mt-1">
                Please check your API key and internet connection
              </p>
            </div>
          </div>
        )
      case Status.SUCCESS:
        return <Map {...mapProps} />
      default:
        return <div>Unknown status</div>
    }
  }

  return (
    <div className={className} style={{ height }}>
      <Wrapper
        apiKey={apiKey}
        render={renderFunction}
        libraries={['drawing', 'places']}
        version="weekly"
      />
    </div>
  )
}

// Helper function to extract coordinates from Google Maps polygon
export function extractPolygonCoordinates(polygon: google.maps.Polygon): Array<{ lat: number; lng: number }> {
  const path = polygon.getPath()
  const coordinates: Array<{ lat: number; lng: number }> = []
  
  for (let i = 0; i < path.getLength(); i++) {
    const latLng = path.getAt(i)
    coordinates.push({
      lat: latLng.lat(),
      lng: latLng.lng()
    })
  }
  
  return coordinates
}

// Helper function to calculate polygon center
export function calculatePolygonCenter(coordinates: Array<{ lat: number; lng: number }>): { lat: number; lng: number } {
  if (coordinates.length === 0) return { lat: 0, lng: 0 }
  
  const totalLat = coordinates.reduce((sum, coord) => sum + coord.lat, 0)
  const totalLng = coordinates.reduce((sum, coord) => sum + coord.lng, 0)
  
  return {
    lat: totalLat / coordinates.length,
    lng: totalLng / coordinates.length
  }
} 