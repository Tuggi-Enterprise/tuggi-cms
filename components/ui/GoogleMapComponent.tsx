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
  onMapClick?: (lat: number, lng: number) => void
  markers?: Array<{
    id: string
    position: { lat: number; lng: number }
    title: string
    description?: string
    color?: string
  }>
  polygon?: Array<{ lat: number; lng: number }>
  savedPolygons?: Array<{
    id: string
    name: string
    paths: Array<{ lat: number; lng: number }>
    country_name?: string
  }>
  cityBoundary?: Array<{ lat: number; lng: number }> | null
  cityName?: string
  enableDrawing?: boolean
  showDrawingButton?: boolean
  isLoading?: boolean
  loadingMessage?: string
  circle?: {
    center: { lat: number; lng: number }
    radius: number // in meters
  }
  circles?: Array<{
    id: string
    center: { lat: number; lng: number }
    radius: number // in meters
    strokeColor?: string
    strokeOpacity?: number
    strokeWeight?: number
    fillColor?: string
    fillOpacity?: number
  }>
  polygonOptions?: {
    strokeColor?: string
    strokeOpacity?: number
    strokeWeight?: number
    fillColor?: string
    fillOpacity?: number
  }
  componentId?: string // For debugging - identify which component instance

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
  onMapClick,
  markers = [],
  polygon,
  savedPolygons = [],
  cityBoundary,
  cityName,
  enableDrawing = true,
  circle,
  circles = [],
  polygonOptions,
  componentId
}: Omit<GoogleMapComponentProps, 'height' | 'className'>) {
  console.log(`🗺️ [GoogleMapComponent${componentId ? `:${componentId}` : ''}] Map component rendered with onPolygonComplete:`, {
    componentId,
    hasOnPolygonComplete: !!onPolygonComplete,
    type: typeof onPolygonComplete,
    isFunction: typeof onPolygonComplete === 'function',
    enableDrawing
  })
  
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<google.maps.Map | null>(null)
  const drawingManagerRef = useRef<google.maps.drawing.DrawingManager | null>(null)
  const currentPolygonRef = useRef<google.maps.Polygon | null>(null)
  const savedPolygonsRef = useRef<google.maps.Polygon[]>([])
  const cityBoundaryRef = useRef<google.maps.Polygon | null>(null)
  const markersRef = useRef<google.maps.Marker[]>([])

  const drawingButtonRef = useRef<HTMLButtonElement | null>(null)
  const circleRef = useRef<google.maps.Circle | null>(null)
  const circlesRef = useRef<google.maps.Circle[]>([])

  // Store onPolygonComplete in a ref so it's always current
  const onPolygonCompleteRef = useRef(onPolygonComplete)
  useEffect(() => {
    console.log('🔄 [GoogleMapComponent] Updating onPolygonCompleteRef:', {
      old: !!onPolygonCompleteRef.current,
      new: !!onPolygonComplete,
      type: typeof onPolygonComplete
    })
    onPolygonCompleteRef.current = onPolygonComplete
  }, [onPolygonComplete])
  
  // Also initialize ref with current value
  useEffect(() => {
    console.log('🔄 [GoogleMapComponent] Initial onPolygonComplete prop:', {
      hasOnPolygonComplete: !!onPolygonComplete,
      type: typeof onPolygonComplete
    })
    onPolygonCompleteRef.current = onPolygonComplete
  }, [])

  const initializeMap = useCallback(() => {
    if (!mapRef.current || mapInstanceRef.current) return

    // Create the map
    const map = new google.maps.Map(mapRef.current, {
      center,
      zoom,
      mapTypeControl: true,
      streetViewControl: true,
      fullscreenControl: true,
      zoomControl: true,
    })

    mapInstanceRef.current = map

    // Add click listener if onMapClick is provided
    if (onMapClick) {
      map.addListener('click', (e: google.maps.MapMouseEvent) => {
        if (e.latLng) {
          onMapClick(e.latLng.lat(), e.latLng.lng())
        }
      })
    }

    // Initialize drawing manager (always, but control visibility)
    if (google.maps.drawing) {
      const drawingManager = new google.maps.drawing.DrawingManager({
        drawingMode: null,
        drawingControl: false, // We'll use our custom button
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
      
      // Store reference to button
      drawingButtonRef.current = controlButton
      
      controlButton.addEventListener('click', () => {
        // Toggle drawing mode
        const isCurrentlyDrawing = drawingManager.getDrawingMode() === google.maps.drawing.OverlayType.POLYGON
        
        if (isCurrentlyDrawing) {
          drawingManager.setDrawingMode(null)
          controlButton.innerHTML = '🔸 Draw Polygon'
          controlButton.style.backgroundColor = '#00A8E8'
        } else {
          // CRITICAL: Disable drawing on ALL other drawing managers before enabling this one
          // This prevents multiple drawing managers from interfering with each other
          const allDrawingManagers = document.querySelectorAll('[data-drawing-manager]')
          allDrawingManagers.forEach((dm: any) => {
            if (dm !== drawingManager && dm.setDrawingMode) {
              dm.setDrawingMode(null)
            }
          })
          
          drawingManager.setDrawingMode(google.maps.drawing.OverlayType.POLYGON)
          controlButton.innerHTML = '⏹️ Stop Drawing'
          controlButton.style.backgroundColor = '#FF6F00'
        }
        
        console.log(`Drawing mode toggled via button${componentId ? `:${componentId}` : ''}:`, !isCurrentlyDrawing)
      })
      
      // Store reference to drawing manager for cleanup
      ;(drawingManager as any).__componentId = componentId
      ;(drawingManager as any).__mapInstance = map
      
      controlDiv.appendChild(controlButton)
      map.controls[google.maps.ControlPosition.TOP_RIGHT].push(controlDiv)

      // Handle polygon completion - use ref to always get current callback
      // CRITICAL: Only handle the event if this component has onPolygonComplete
      google.maps.event.addListener(drawingManager, 'polygoncomplete', (polygon: google.maps.Polygon) => {
        const currentCallback = onPolygonCompleteRef.current
        const drawingManagerMap = drawingManager.getMap()
        const isCorrectMap = drawingManagerMap === map
        
        console.log(`🗺️ [GoogleMapComponent${componentId ? `:${componentId}` : ''}] polygoncomplete event fired!`, {
          componentId,
          hasPolygon: !!polygon,
          hasOnPolygonComplete: !!currentCallback,
          polygonType: typeof polygon,
          polygonPath: polygon?.getPath ? 'has getPath' : 'no getPath',
          enableDrawing,
          drawingManagerMap: isCorrectMap ? 'same map' : 'different map',
          drawingManagerComponentId: (drawingManager as any).__componentId,
          mapInstanceMatch: isCorrectMap
        })
        
        // CRITICAL FIX: Only process if this component has the callback AND it's the correct map
        // This prevents other components from interfering
        if (!currentCallback) {
          console.log(`⚠️ [GoogleMapComponent${componentId ? `:${componentId}` : ''}] Ignoring polygoncomplete - no callback for this component`)
          return
        }
        
        // Verify this is the correct map instance
        if (!isCorrectMap) {
          console.log(`⚠️ [GoogleMapComponent${componentId ? `:${componentId}` : ''}] Ignoring polygoncomplete - different map instance (drawingManager map !== this map)`)
          return
        }
        
        // Verify the drawing manager is currently in drawing mode (this is the one that created the polygon)
        const currentDrawingMode = drawingManager.getDrawingMode()
        if (currentDrawingMode !== google.maps.drawing.OverlayType.POLYGON) {
          console.log(`⚠️ [GoogleMapComponent${componentId ? `:${componentId}` : ''}] Ignoring polygoncomplete - drawing manager not in POLYGON mode (mode: ${currentDrawingMode})`)
          return
        }
        
        console.log(`✅ [GoogleMapComponent${componentId ? `:${componentId}` : ''}] Processing polygoncomplete for this component`)
        
        // Clear any existing polygon
        if (currentPolygonRef.current) {
          currentPolygonRef.current.setMap(null)
        }

        currentPolygonRef.current = polygon
        drawingManager.setDrawingMode(null)
        
        // Reset button state
        controlButton.innerHTML = '🔸 Draw Polygon'
        controlButton.style.backgroundColor = '#00A8E8'

        console.log(`🗺️ [GoogleMapComponent${componentId ? `:${componentId}` : ''}] Calling onPolygonComplete callback`)
        try {
          currentCallback(polygon)
          console.log(`✅ [GoogleMapComponent${componentId ? `:${componentId}` : ''}] onPolygonComplete callback executed successfully`)
        } catch (error) {
          console.error(`❌ [GoogleMapComponent${componentId ? `:${componentId}` : ''}] Error in onPolygonComplete callback:`, error)
        }
      })
    } else {
      console.error('Google Maps Drawing library not loaded')
    }
  }, [center, zoom, onMapClick])

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

    // Create new polygon with custom options
    const polygonShape = new google.maps.Polygon({
      paths: polygon,
      fillColor: polygonOptions?.fillColor || '#00A8E8',
      fillOpacity: polygonOptions?.fillOpacity || 0.3,
      strokeColor: polygonOptions?.strokeColor || '#00A8E8',
      strokeWeight: polygonOptions?.strokeWeight || 2,
      strokeOpacity: polygonOptions?.strokeOpacity || 1.0,
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

  const updateSavedPolygons = useCallback(() => {
    if (!mapInstanceRef.current) return

    // Clear existing saved polygons
    savedPolygonsRef.current.forEach(polygon => polygon.setMap(null))
    savedPolygonsRef.current = []

    // Add new saved polygons
    savedPolygons.forEach((savedPolygon, index) => {
      if (!savedPolygon.paths || savedPolygon.paths.length === 0) return

      // Use different colors for different polygons
      const colors = ['#8B5CF6', '#F59E0B', '#EF4444', '#10B981', '#3B82F6', '#F97316']
      const color = colors[index % colors.length]

      const polygonShape = new google.maps.Polygon({
        paths: savedPolygon.paths,
        fillColor: color,
        fillOpacity: 0.15,
        strokeColor: color,
        strokeWeight: 2,
        editable: false,
        draggable: false,
      })

      polygonShape.setMap(mapInstanceRef.current!)
      savedPolygonsRef.current.push(polygonShape)

      // Add info window for polygon name
      const bounds = new google.maps.LatLngBounds()
      savedPolygon.paths.forEach(point => bounds.extend(point))
      const center = bounds.getCenter()

      const infoWindow = new google.maps.InfoWindow({
        content: `
          <div style="padding: 8px;">
            <h3 style="margin: 0; font-size: 14px; font-weight: 600; color: ${color};">
              📍 ${savedPolygon.name}
            </h3>
            ${savedPolygon.country_name ? `
              <p style="margin: 4px 0 0 0; font-size: 12px; color: #666;">
                ${savedPolygon.country_name}
              </p>
            ` : ''}
          </div>
        `,
        position: center
      })

      // Add click listener to show info window
      polygonShape.addListener('click', () => {
        infoWindow.open(mapInstanceRef.current!)
      })
    })

    console.log(`Displayed ${savedPolygons.length} saved polygons`)
  }, [savedPolygons])

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

  const updateDrawingMode = useCallback(() => {
    if (!drawingManagerRef.current || !drawingButtonRef.current) return

    console.log('Drawing mode updated:', enableDrawing ? 'ENABLED' : 'DISABLED')

    if (enableDrawing) {
      // Enable drawing mode
      drawingManagerRef.current.setDrawingMode(google.maps.drawing.OverlayType.POLYGON)
      drawingButtonRef.current.innerHTML = '⏹️ Stop Drawing'
      drawingButtonRef.current.style.backgroundColor = '#FF6F00'
    } else {
      // Disable drawing mode
      drawingManagerRef.current.setDrawingMode(null)
      drawingButtonRef.current.innerHTML = '🔸 Draw Polygon'
      drawingButtonRef.current.style.backgroundColor = '#00A8E8'
    }
  }, [enableDrawing])

  const updateCircle = useCallback(() => {
    if (!mapInstanceRef.current) return
    // Remove existing circle
    if (circleRef.current) {
      circleRef.current.setMap(null)
      circleRef.current = null
    }
    if (circle && circle.center && circle.radius > 0) {
      const circleOverlay = new google.maps.Circle({
        center: circle.center,
        radius: circle.radius,
        fillColor: '#00A8E8',
        fillOpacity: 0.2,
        strokeColor: '#00A8E8',
        strokeOpacity: 0.7,
        strokeWeight: 2,
        clickable: false,
      })
      circleOverlay.setMap(mapInstanceRef.current)
      circleRef.current = circleOverlay
    }
  }, [circle])

  // Effect for multiple circles
  useEffect(() => {
    if (!mapInstanceRef.current) return

    // Clear existing circles
    circlesRef.current.forEach(circle => {
      circle.setMap(null)
    })
    circlesRef.current = []

    // Add new circles
    circles.forEach(circleData => {
      if (circleData.center && circleData.radius > 0) {
        const circleOverlay = new google.maps.Circle({
          center: circleData.center,
          radius: circleData.radius,
          fillColor: circleData.fillColor || '#FF6B6B',
          fillOpacity: circleData.fillOpacity || 0.2,
          strokeColor: circleData.strokeColor || '#FF6B6B',
          strokeOpacity: circleData.strokeOpacity || 0.7,
          strokeWeight: circleData.strokeWeight || 2,
          clickable: false,
        })
        circleOverlay.setMap(mapInstanceRef.current)
        circlesRef.current.push(circleOverlay)
      }
    })
  }, [circles])

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
    updateSavedPolygons()
  }, [updateSavedPolygons])

  useEffect(() => {
    updateMapView()
  }, [updateMapView])

  useEffect(() => {
    updateCityBoundary()
  }, [updateCityBoundary])

  useEffect(() => {
    updateDrawingMode()
  }, [updateDrawingMode])

  useEffect(() => {
    updateCircle()
  }, [updateCircle])

  return <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
}



// Main component that wraps everything
export function GoogleMapComponent({
  height = '400px',
  className = '',
  isLoading = false,
  loadingMessage = 'Loading...',
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
        return (
          <div className="relative w-full h-full">
            <Map {...mapProps} />
            {isLoading && (
              <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center z-50">
                <div className="bg-white rounded-lg shadow-lg p-6 flex items-center space-x-4 border border-gray-200">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                  <div>
                    <p className="text-gray-900 font-medium">{loadingMessage}</p>
                    <p className="text-gray-500 text-sm">This may take a moment...</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      default:
        return <div>Unknown status</div>
    }
  }

  return (
    <div className={className} style={{ height }}>
      <Wrapper
        apiKey={apiKey}
        render={renderFunction}
        libraries={['drawing', 'places', 'geometry']}
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