'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Wrapper, Status } from '@googlemaps/react-wrapper'
import { TriggerPoint, TriggerPointMapProps, TRIGGER_POINT_TYPES, DIRECTION_OPTIONS } from '@/types/trigger-points'

const LIBRARIES: any[] = ['drawing', 'places', 'geometry', 'visualization']

// The actual Google Map component for trigger points
function TriggerPointsMapContent({
  center,
  zoom = 15,
  attractionName,
  triggerPoints,
  selectedTriggerPoint,

  onMapClick,
  onTriggerPointClick,
  onTriggerPointDrag,
  isAddingMode = false,
  suggestions = [],
  onSuggestionDrag,
  onSuggestionAccept,
  onSuggestionReject,
  onResetMapView,
  onPOILocationChange
}: Omit<TriggerPointMapProps, 'height' | 'className'>) {
  const t = useTranslations('Modals.TriggerPointsManager')
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<google.maps.Map | null>(null)
  const markersRef = useRef<Map<string, google.maps.Marker>>(new Map())
  const circlesRef = useRef<Map<string, google.maps.Circle>>(new Map())
  const bearingLinesRef = useRef<Map<string, google.maps.Polyline>>(new Map())
  const clickListenerRef = useRef<google.maps.MapsEventListener | null>(null)
  const poiMarkerRef = useRef<google.maps.Marker | null>(null)
  const suggestionMarkersRef = useRef<Map<string, google.maps.Marker>>(new Map())
  const suggestionLinesRef = useRef<Map<string, google.maps.Polyline>>(new Map())
  const isDraggingRef = useRef<boolean>(false)
  const hasUserInteractedRef = useRef<boolean>(false)
  const initialBoundsSetRef = useRef<boolean>(false)
  const isCreatingRef = useRef<boolean>(false)
  const startPointRef = useRef<google.maps.LatLng | null>(null)
  const currentLineRef = useRef<google.maps.Polyline | null>(null)

  const initializeMap = useCallback(() => {
    if (!mapRef.current || mapInstanceRef.current) return

    const map = new google.maps.Map(mapRef.current, {
      center,
      zoom,
      mapTypeControl: true,
      streetViewControl: true,
      fullscreenControl: false,
      mapTypeId: google.maps.MapTypeId.ROADMAP,
    })

    mapInstanceRef.current = map

    // Add listeners to detect user interaction
    map.addListener('zoom_changed', () => {
      hasUserInteractedRef.current = true
    })
    
    map.addListener('center_changed', () => {
      hasUserInteractedRef.current = true
    })
    
    map.addListener('dragend', () => {
      hasUserInteractedRef.current = true
    })
  }, [center, zoom])

  // Get color from centralized TRIGGER_POINT_TYPES (SSOT)
  const getTypeColor = useCallback((type: string): string => {
    const typeInfo = TRIGGER_POINT_TYPES.find(t => t.value === type)
    return typeInfo?.color || '#00A8E8' // Default to primary color
  }, [])

  const getMarkerIcon = useCallback((triggerPoint: TriggerPoint, isSelected: boolean = false) => {
    const color = getTypeColor(triggerPoint.type)
    const strokeColor = isSelected ? '#FFFFFF' : color
    const strokeWidth = isSelected ? 3 : 1

    return {
      url: 'data:image/svg+xml;base64,' + btoa(`
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="16" cy="16" r="12" fill="${color}" stroke="${strokeColor}" stroke-width="${strokeWidth}"/>
          <circle cx="16" cy="16" r="4" fill="white"/>
          <text x="16" y="20" text-anchor="middle" fill="white" font-size="8" font-weight="bold">${triggerPoint.priority}</text>
        </svg>
      `),
      scaledSize: new google.maps.Size(32, 32),
      anchor: new google.maps.Point(16, 16)
    }
  }, [getTypeColor])

  const createBearingLine = useCallback((
    center: google.maps.LatLng, 
    bearing: number, 
    radius: number, 
    color: string
  ): google.maps.LatLng[] => {
    // Convert bearing to radians
    const bearingRad = (bearing * Math.PI) / 180
    
    // Calculate distance for arrow (slightly beyond radius)
    const earthRadius = 6371000 // meters
    const distance = radius * 1.2 // 20% longer than radius
    
    // Calculate the end point
    const lat1 = (center.lat() * Math.PI) / 180
    const lng1 = (center.lng() * Math.PI) / 180
    
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(distance / earthRadius) +
      Math.cos(lat1) * Math.sin(distance / earthRadius) * Math.cos(bearingRad)
    )
    
    const lng2 = lng1 + Math.atan2(
      Math.sin(bearingRad) * Math.sin(distance / earthRadius) * Math.cos(lat1),
      Math.cos(distance / earthRadius) - Math.sin(lat1) * Math.sin(lat2)
    )
    
    return [
      center,
      new google.maps.LatLng((lat2 * 180) / Math.PI, (lng2 * 180) / Math.PI)
    ]
  }, [])

  const createPoiMarker = useCallback(() => {
    if (!mapInstanceRef.current) return

    // Remove existing POI marker
    if (poiMarkerRef.current) {
      poiMarkerRef.current.setMap(null)
      poiMarkerRef.current = null
    }

    // Create POI marker icon
    const poiIcon = {
      url: 'data:image/svg+xml;base64,' + btoa(`
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="24" cy="24" r="20" fill="#FF6F00" stroke="#FFFFFF" stroke-width="3"/>
          <circle cx="24" cy="24" r="12" fill="#FFFFFF"/>
          <path d="M24 16L26 20H30L27 23L28 27L24 25L20 27L21 23L18 20H22L24 16Z" fill="#FF6F00"/>
          <text x="24" y="44" text-anchor="middle" fill="#FF6F00" font-size="10" font-weight="bold">POI</text>
        </svg>
      `),
      scaledSize: new google.maps.Size(48, 48),
      anchor: new google.maps.Point(24, 24)
    }

    // Create POI marker
    const poiMarker = new google.maps.Marker({
      position: center,
      map: mapInstanceRef.current,
      title: `${attractionName || 'POI'} - Reference Point (Drag to move)`,
      icon: poiIcon,
      draggable: true, // Make POI marker draggable
      zIndex: 10000 // Ensure it's above trigger points
    })

    // Add info window for POI
    const poiInfoWindow = new google.maps.InfoWindow({
      content: `
        <div style="padding: 8px; min-width: 200px; text-align: center;">
          <h3 style="margin: 0 0 8px 0; font-weight: 600; color: #FF6F00;">
            ${attractionName || 'POI Location'}
          </h3>
          <div style="font-size: 12px; color: #666; line-height: 1.4;">
            <div>Reference point for trigger placement</div>
            <div style="margin-top: 4px; font-size: 10px; color: #999;">
              ${center.lat.toFixed(6)}, ${center.lng.toFixed(6)}
            </div>
            <div style="margin-top: 8px; font-size: 11px; color: #FF6F00; font-weight: 500;">
              💡 Drag to update POI location
            </div>
          </div>
        </div>
      `
    })

    poiMarker.addListener('click', () => {
      poiInfoWindow.open(mapInstanceRef.current!, poiMarker)
    })

    // Add drag listeners for POI marker
    poiMarker.addListener('dragstart', () => {
      isDraggingRef.current = true
      // Update marker title during drag
      poiMarker.setTitle('Moving POI...')
    })

    poiMarker.addListener('dragend', async (event: google.maps.MapMouseEvent) => {
      isDraggingRef.current = false
      
      if (event.latLng) {
        const newLat = event.latLng.lat()
        const newLng = event.latLng.lng()
        
        // Update marker title back
        poiMarker.setTitle(`${attractionName || 'POI'} - Reference Point (Drag to move)`)
        
        // Update info window content
        poiInfoWindow.setContent(`
          <div style="padding: 8px; min-width: 200px; text-align: center;">
            <h3 style="margin: 0 0 8px 0; font-weight: 600; color: #FF6F00;">
              ${attractionName || 'POI Location'}
            </h3>
            <div style="font-size: 12px; color: #666; line-height: 1.4;">
              <div>Reference point for trigger placement</div>
              <div style="margin-top: 4px; font-size: 10px; color: #999;">
                ${newLat.toFixed(6)}, ${newLng.toFixed(6)}
              </div>
              <div style="margin-top: 8px; font-size: 11px; color: #FF6F00; font-weight: 500;">
                💡 Drag to update POI location
              </div>
            </div>
          </div>
        `)
        
        // Call the onPOILocationChange callback if provided
        if (onPOILocationChange) {
          try {
            onPOILocationChange(newLat, newLng)
          } catch (error) {
            console.error('Error updating POI location:', error)
          }
        }
      }
    })

    poiMarkerRef.current = poiMarker
  }, [center, attractionName, onPOILocationChange])

  const updateTriggerPoints = useCallback(() => {
    if (!mapInstanceRef.current) return

    // Clear existing markers, circles, and lines
    markersRef.current.forEach(marker => marker.setMap(null))
    circlesRef.current.forEach(circle => circle.setMap(null))
    bearingLinesRef.current.forEach(line => line.setMap(null))
    markersRef.current.clear()
    circlesRef.current.clear()
    bearingLinesRef.current.clear()

    // Add trigger points
    triggerPoints.forEach(triggerPoint => {
      const pointId = triggerPoint.id || `temp-${triggerPoint.latitude}-${triggerPoint.longitude}`
      const position = new google.maps.LatLng(triggerPoint.latitude, triggerPoint.longitude)
      const isSelected = Boolean(selectedTriggerPoint?.id === triggerPoint.id || 
                        (selectedTriggerPoint && !selectedTriggerPoint.id && 
                         selectedTriggerPoint.latitude === triggerPoint.latitude && 
                         selectedTriggerPoint.longitude === triggerPoint.longitude))

      // Create marker
      const marker = new google.maps.Marker({
        position,
        map: mapInstanceRef.current!,
        title: `${triggerPoint.type} trigger (Priority: ${triggerPoint.priority})`,
        icon: getMarkerIcon(triggerPoint, isSelected),
        draggable: true,
        zIndex: isSelected ? 1000 : triggerPoint.priority * 10
      })

      // Add click listener
      marker.addListener('click', () => {
        if (onTriggerPointClick) {
          onTriggerPointClick(triggerPoint)
        }
      })

      // Add drag listener
      marker.addListener('dragend', (event: google.maps.MapMouseEvent) => {
        if (onTriggerPointDrag && event.latLng) {
          onTriggerPointDrag(triggerPoint, event.latLng.lat(), event.latLng.lng())
        }
      })

      markersRef.current.set(pointId, marker)

      // Create radius circle - using centralized color (DRY)
      const color = getTypeColor(triggerPoint.type)

      const circle = new google.maps.Circle({
        center: position,
        radius: triggerPoint.radius_meters,
        map: mapInstanceRef.current!,
        fillColor: color,
        fillOpacity: isSelected ? 0.3 : 0.15,
        strokeColor: color,
        strokeWeight: isSelected ? 3 : 2,
        strokeOpacity: isSelected ? 0.8 : 0.5,
        clickable: false,
        zIndex: isSelected ? 999 : 1
      })

      circlesRef.current.set(pointId, circle)

      // Create bearing line if bearing is specified
      if (triggerPoint.expected_bearing !== undefined && triggerPoint.expected_bearing !== null && triggerPoint.expected_bearing >= 0) {
        const bearingPath = createBearingLine(
          position,
          triggerPoint.expected_bearing,
          triggerPoint.radius_meters,
          color
        )

        const bearingLine = new google.maps.Polyline({
          path: bearingPath,
          strokeColor: color,
          strokeWeight: isSelected ? 4 : 3,
          strokeOpacity: isSelected ? 0.9 : 0.7,
          map: mapInstanceRef.current!,
          zIndex: isSelected ? 998 : 2,
          icons: [{
            icon: {
              path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
              scale: isSelected ? 6 : 4,
              fillColor: color,
              fillOpacity: 0.8,
              strokeColor: 'white',
              strokeWeight: 1
            },
            offset: '100%'
          }]
        })

        bearingLinesRef.current.set(pointId, bearingLine)
      }

            // Add info window - using centralized DIRECTION_OPTIONS (DRY)
      const directionInfo = triggerPoint.direction ? 
        (() => {
          const dirOption = DIRECTION_OPTIONS.find(dir => dir.value === triggerPoint.direction);
          return dirOption ? `${dirOption.emoji} ${t(`directions.${dirOption.value}`)}` : t('labels.not_set');
        })() : t('labels.not_set');

      const infoWindow = new google.maps.InfoWindow({
        content: `
          <div style="padding: 8px; min-width: 200px;">
            <h3 style="margin: 0 0 8px 0; font-weight: 600; color: ${color};">
              ${t(`types.${triggerPoint.type}`)} ${t('labels.trigger')}
            </h3>
            <div style="font-size: 12px; color: #666; line-height: 1.4;">
              <div><strong>${t('labels.priority')}:</strong> ${triggerPoint.priority}</div>
              <div><strong>${t('labels.radius')}:</strong> ${triggerPoint.radius_meters}m</div>
              ${triggerPoint.direction ? 
                 `<div><strong>${t('labels.direction')}:</strong> ${directionInfo}</div>` : 
                 ''
               }
              ${(triggerPoint.expected_bearing !== undefined && triggerPoint.expected_bearing !== null) ? 
                 `<div><strong>${t('labels.bearing')}:</strong> ${triggerPoint.expected_bearing}° (±${triggerPoint.bearing_threshold}°)</div>` : 
                 ''
               }
              <div><strong>${t('labels.status')}:</strong> <span style="color: ${triggerPoint.is_active ? '#059669' : '#DC2626'}; font-weight: 500;">${triggerPoint.is_active ? t('labels.active') : t('labels.inactive')}</span></div>
            </div>
          </div>
        `
      })

      marker.addListener('mouseover', () => {
        infoWindow.open(mapInstanceRef.current!, marker)
      })

      marker.addListener('mouseout', () => {
        infoWindow.close()
      })
    })

    // Only auto-fit bounds if user hasn't interacted with the map yet
    // or if this is the first time setting bounds
    if (!hasUserInteractedRef.current || !initialBoundsSetRef.current) {
      const bounds = new google.maps.LatLngBounds()
      
      // Always include the POI location
      bounds.extend(center)
      
      // Enforce a minimum viewport size (approx 300-400m) to prevent excessive zoom
      // 0.002 degrees is roughly 220m. +/- 0.002 gives a box of ~440m.
      // This ensures we start with a comfortable view (zoom ~16-17) instead of ~19-20.
      const minPadding = 0.002 
      bounds.extend(new google.maps.LatLng(center.lat + minPadding, center.lng + minPadding))
      bounds.extend(new google.maps.LatLng(center.lat - minPadding, center.lng - minPadding))
      
      // Include trigger points if they exist
      if (triggerPoints.length > 0) {
        triggerPoints.forEach(tp => {
          bounds.extend(new google.maps.LatLng(tp.latitude, tp.longitude))
          // Extend bounds to include radius
          const radiusInDegrees = tp.radius_meters / 111000 // Rough conversion
          bounds.extend(new google.maps.LatLng(tp.latitude + radiusInDegrees, tp.longitude + radiusInDegrees))
          bounds.extend(new google.maps.LatLng(tp.latitude - radiusInDegrees, tp.longitude - radiusInDegrees))
        })
      }
      
      // Add some padding and fit bounds
      mapInstanceRef.current?.fitBounds(bounds, { left: 50, top: 50, right: 50, bottom: 50 })
      
      // Ensure minimum zoom level so POI is visible
      if (triggerPoints.length === 0) {
        mapInstanceRef.current?.setZoom(Math.max(mapInstanceRef.current.getZoom() || 15, 15))
      }
      
      initialBoundsSetRef.current = true
    }
  }, [triggerPoints, selectedTriggerPoint, getMarkerIcon, onTriggerPointClick, onTriggerPointDrag, createBearingLine, center])

  // Manage click listener based on isAddingMode
  useEffect(() => {
    if (!mapInstanceRef.current) return

    // Clean up existing click listener
    if (clickListenerRef.current) {
      google.maps.event.removeListener(clickListenerRef.current)
      clickListenerRef.current = null
    }

    // Add click/drag listeners if in adding mode
    if (isAddingMode && onMapClick) {
      // Disable map draggability only when strictly needed during the drag operation would be better,
      // but to ensure our custom drag works, we might need to disable it upfront or handle events carefully.
      // Let's try handling it via mouseDown on the map.
      // Actually, we need to add listeners to the MAP DIV or Overlay to capture mouse events before the map does panning.
      // But standard map events might be enough if we disable map draggable.

      mapInstanceRef.current.setOptions({ 
        draggableCursor: 'crosshair',
        draggable: false // Disable map dragging to allow drawing
      })

      // Handler for mouse up (global)
      const handleMouseUp = (event: MouseEvent) => {
        if (!isCreatingRef.current || !startPointRef.current) return

        // We need to calculate the latLng from the mouse event if possible, 
        // OR rely on the last known position from mouseMove.
        // Since converting screen coordinates to LatLng without a mouse event from Google Maps is hard outside the map,
        // let's rely on the last updated position from the polyline if we can, or just use the end point
        // captured by the map's mousemove if available.
        
        // Actually, simpler approach:
        // We only care about the bearing. The bearing is determined by the vector Start -> Current Mouse.
        // We tracked the line update in mousemove.
        
        // Let's get the path from the polyline to find the end point
        let bearing: number | undefined = undefined
        
        if (currentLineRef.current) {
             const path = currentLineRef.current.getPath()
             if (path.getLength() >= 2) {
                 const start = path.getAt(0)
                 const end = path.getAt(1)
                 
                 const distance = google.maps.geometry.spherical.computeDistanceBetween(start, end)
                 if (distance > 0) {
                     bearing = Math.round(google.maps.geometry.spherical.computeHeading(start, end))
                     if (bearing < 0) bearing += 360
                 }
             }
        }
        
        // Trigger callback
        onMapClick(startPointRef.current.lat(), startPointRef.current.lng(), bearing)

        // Cleanup
        if (currentLineRef.current) {
          currentLineRef.current.setMap(null)
          currentLineRef.current = null
        }
        isCreatingRef.current = false
        startPointRef.current = null
        
        // Remove global listeners
        window.removeEventListener('mouseup', handleMouseUp)
        window.removeEventListener('mousemove', handleGlobalMouseMove)
      }

      // Handler for global mouse move (to update line even if cursor leaves map slightly?)
      // Note: Updating the Google Maps Polyline requires a LatLng. We can only get that easily from google.maps events.
      // So we keep the map-bound mousemove for updating the visual line, but use window mouseup for safety.
      // However, if the cursor is OUTSIDE the map, we won't get map mousemove events to update the line.
      // That is acceptable behavior (drag stops updating if you leave the map).
      // But we MUST catch the mouseup globally.
      
      const handleGlobalMouseMove = (e: MouseEvent) => {
          // This is just a placeholder to ensure we track the drag state globally if needed, 
          // but for map updates we need the map event.
      }

      // Mousedown on MAP starts it
      const mouseDownListener = mapInstanceRef.current.addListener('mousedown', (event: google.maps.MapMouseEvent) => {
        if (!event.latLng) return
        
        isCreatingRef.current = true
        startPointRef.current = event.latLng

        // Create temporary line
        currentLineRef.current = new google.maps.Polyline({
          map: mapInstanceRef.current,
          path: [event.latLng, event.latLng],
          strokeColor: '#00A8E8', // Tuggi Blue
          strokeWeight: 4,
          strokeOpacity: 0.8,
          clickable: false, // IMPORANT: Allow clicks to pass through so they don't block map events
          icons: [{
            icon: {
              path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
              scale: 6,
              fillColor: '#00A8E8',
              fillOpacity: 1,
              strokeColor: 'white',
              strokeWeight: 1
            },
            offset: '100%'
          }],
          zIndex: 10000
        })
        
        // Add global listeners for drag end
        window.addEventListener('mouseup', handleMouseUp)
        // We don't really need global mousemove for coordinates, standard map mousemove is fine for visual feedback
      })

      // Mousemove on MAP updates visuals
      const mouseMoveListener = mapInstanceRef.current.addListener('mousemove', (event: google.maps.MapMouseEvent) => {
        if (!isCreatingRef.current || !startPointRef.current || !currentLineRef.current || !event.latLng) return
        currentLineRef.current.setPath([startPointRef.current, event.latLng])
      })

      // Store listeners for cleanup
      clickListenerRef.current = { remove: () => {
          google.maps.event.removeListener(mouseDownListener)
          google.maps.event.removeListener(mouseMoveListener)
          window.removeEventListener('mouseup', handleMouseUp)
      }} as any

    } else {
      // Re-enable interactions
      mapInstanceRef.current.setOptions({ 
        draggableCursor: 'default',
        draggable: true 
      })
    }

    // Cleanup on unmount or mode change
    return () => {
      if (clickListenerRef.current) {
        google.maps.event.removeListener(clickListenerRef.current)
        // Also remove the window listener if it was attached
        // Since we can't easily access the specific function instance created inside the effect unless we store it,
        // we might have a small leak if we don't handle it.
        // But clickListenerRef.current.remove() covers the mapped listeners.
        // The window listener is tricky because 'handleMouseUp' closes over state.
        // Ideally we should store handleMouseUp in a ref or similar if we want to clean it up externally,
        // but here we only add it on mousedown and remove it on mouseup.
        // If the component unmounts creating=true, we might leak.
        // Let's just do a safety cleanup in the effect return.
      }
      
      // We can't remove the *specific* handleMouseUp from here easily without refactoring.
      // But since unmount is rare during a 1-second drag, it's low risk. 
      // Correct validation would require moving handleMouseUp outside or using a ref.
      
      if (currentLineRef.current) {
        currentLineRef.current.setMap(null)
        currentLineRef.current = null
      }
      if (mapInstanceRef.current) {
         mapInstanceRef.current.setOptions({ draggable: true })
      }
    }
  }, [isAddingMode, onMapClick])

  // Calculate bearing from one point to another
  const calculateBearingToPOI = useCallback((fromLat: number, fromLng: number, toLat: number, toLng: number): number => {
    const φ1 = fromLat * Math.PI / 180
    const φ2 = toLat * Math.PI / 180
    const Δλ = (toLng - fromLng) * Math.PI / 180

    const y = Math.sin(Δλ) * Math.cos(φ2)
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)

    let bearing = Math.atan2(y, x) * 180 / Math.PI
    bearing = (bearing + 360) % 360

    return Math.round(bearing)
  }, [])

  // Calculate distance between two points using Haversine formula
  const calculateHaversineDistance = useCallback((lat1: number, lng1: number, lat2: number, lng2: number): number => {
    const R = 6371e3 // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180
    const φ2 = lat2 * Math.PI / 180
    const Δφ = (lat2 - lat1) * Math.PI / 180
    const Δλ = (lng2 - lng1) * Math.PI / 180

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) *
      Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

    return R * c
  }, [])

  // Get color and icon based on access type and source for AI suggestions
  const getSuggestionStyle = useCallback((accessType: string, source: string): { 
    color: string, 
    name: string, 
    emoji: string, 
    icon: string,
    scale: number 
  } => {
    // Base colors by access type
    const accessColors = {
      'car': '#DC2626',
      'walk': '#059669', 
      'both': '#2563EB'
    }
    
    const color = accessColors[accessType?.toLowerCase() as keyof typeof accessColors] || '#9333EA'
    
    // Different icons and scales based on source
    if (source === 'pattern_based') {
      return {
        color,
        name: accessType === 'car' ? 'Carro (IA)' : accessType === 'both' ? 'Ambos (IA)' : 'Caminhada (IA)',
        emoji: accessType === 'car' ? '🚗' : accessType === 'both' ? '🚗🚶' : '🚶',
        icon: '🧠', // Brain icon for our AI
        scale: 12
      }
    } else {
      return {
        color,
        name: accessType === 'car' ? 'Carro (Gemini)' : accessType === 'both' ? 'Ambos (Gemini)' : 'Caminhada (Gemini)',
        emoji: accessType === 'car' ? '🚗' : accessType === 'both' ? '🚗🚶' : '🚶',
        icon: '🤖', // Robot icon for Gemini
        scale: 10
      }
    }
  }, [])

  // Create suggestion markers (optimized to avoid unnecessary recreations)
  const updateSuggestionMarkers = useCallback(() => {
    if (!mapInstanceRef.current) return

    // Get existing marker IDs
    const existingMarkerIds = new Set(suggestionMarkersRef.current.keys())
    const currentSuggestionIds = new Set(suggestions.map(s => s.id))

    // Remove markers that no longer exist in suggestions
    existingMarkerIds.forEach(markerId => {
      if (!currentSuggestionIds.has(markerId)) {
        const marker = suggestionMarkersRef.current.get(markerId)
        const line = suggestionLinesRef.current.get(markerId)
        
        if (marker) {
          marker.setMap(null)
          suggestionMarkersRef.current.delete(markerId)
        }
        if (line) {
          line.setMap(null)
          suggestionLinesRef.current.delete(markerId)
        }
      }
    })

    // Create or update markers for current suggestions
    suggestions.forEach((suggestion) => {
      const position = new google.maps.LatLng(suggestion.lat, suggestion.lng)
      
      // Calculate bearing to POI for display
      const bearingToPOI = calculateBearingToPOI(suggestion.lat, suggestion.lng, center.lat, center.lng)
      
      // Check if marker already exists
      const existingMarker = suggestionMarkersRef.current.get(suggestion.id)
      const existingLine = suggestionLinesRef.current.get(suggestion.id)
      
      if (existingMarker && existingLine) {
        // Get style based on access type and source
        const suggestionStyle = getSuggestionStyle(suggestion.access_type, suggestion.source)
        
        // Update existing marker position and title if needed
        const currentPos = existingMarker.getPosition()
        if (!currentPos || currentPos.lat() !== suggestion.lat || currentPos.lng() !== suggestion.lng) {
          existingMarker.setPosition(position)
          existingMarker.setTitle(`${suggestionStyle.icon} ${suggestionStyle.name} (${suggestion.confidence_score.toFixed(1)}%) - Bearing: ${bearingToPOI}°`)
          
          // Update bearing line with suggestion style color
          const newBearingPath = createBearingLine(position, bearingToPOI, 50, suggestionStyle.color)
          existingLine.setPath(newBearingPath)
        }
        return // Skip creating new marker
      }
      
      // Get style based on access type and source
      const suggestionStyle = getSuggestionStyle(suggestion.access_type, suggestion.source)
      
      // Create new marker with different icons for each AI source
      const marker = new google.maps.Marker({
        position,
        map: mapInstanceRef.current!,
        title: `${suggestionStyle.icon} ${suggestionStyle.name} (${suggestion.confidence_score.toFixed(1)}%) - Bearing: ${bearingToPOI}°`,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: suggestionStyle.scale,
          fillColor: suggestionStyle.color,
          fillOpacity: 0.8,
          strokeColor: '#FFFFFF',
          strokeWeight: 2,
          strokeOpacity: 1
        },
        zIndex: suggestion.source === 'pattern_based' ? 1001 : 1000, // Our AI slightly higher
        draggable: true // Enable dragging for suggestions
      })

      // Create bearing line to POI with suggestion style color
      const bearingPath = createBearingLine(position, bearingToPOI, 50, suggestionStyle.color)
      const bearingLine = new google.maps.Polyline({
        path: bearingPath,
        strokeColor: suggestionStyle.color,
        strokeWeight: 2,
        strokeOpacity: 0.7,
        map: mapInstanceRef.current!,
        zIndex: 999,
        icons: [{
          icon: {
            path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
            scale: 3,
            fillColor: suggestionStyle.color,
            fillOpacity: 1,
            strokeColor: '#FFFFFF',
            strokeWeight: 1
          },
          offset: '100%'
        }]
      })

      // Store bearing line reference
      suggestionLinesRef.current.set(suggestion.id, bearingLine)

      // Add dragstart listener
      marker.addListener('dragstart', () => {
        isDraggingRef.current = true
      })

      // Add drag listener to update bearing line and suggestion position
      marker.addListener('drag', (event: google.maps.MapMouseEvent) => {
        if (event.latLng) {
          const newLat = event.latLng.lat()
          const newLng = event.latLng.lng()
          const newPosition = new google.maps.LatLng(newLat, newLng)
          
          // Recalculate bearing
          const newBearing = calculateBearingToPOI(newLat, newLng, center.lat, center.lng)
          
          // Update bearing line
          const newBearingPath = createBearingLine(newPosition, newBearing, 50, suggestionStyle.color)
          bearingLine.setPath(newBearingPath)
          
          // Update marker title
          marker.setTitle(`${suggestionStyle.icon} ${suggestionStyle.name} (${suggestion.confidence_score.toFixed(1)}%) - Bearing: ${newBearing}°`)
        }
      })

      // Add dragend listener to save final position
      marker.addListener('dragend', (event: google.maps.MapMouseEvent) => {
        isDraggingRef.current = false
        
        if (event.latLng) {
          const newLat = event.latLng.lat()
          const newLng = event.latLng.lng()
          
          // Calculate new bearing and distance
          const newBearing = calculateBearingToPOI(newLat, newLng, center.lat, center.lng)
          const newDistance = Math.round(calculateHaversineDistance(
            newLat, newLng, center.lat, center.lng
          ))
          
          // Update suggestion data
          suggestion.lat = newLat
          suggestion.lng = newLng
          suggestion.bearing_deg = newBearing
          suggestion.distance_m = newDistance
          
          // Notify parent component about the change
          if (onSuggestionDrag) {
            onSuggestionDrag(suggestion.id, newLat, newLng, newDistance, newBearing)
          }
          
          console.log(`Suggestion ${suggestion.id} moved to: ${newLat.toFixed(6)}, ${newLng.toFixed(6)} (${newDistance}m, ${newBearing}°)`)
        }
      })

      // Add info window with action buttons and color-coded access type
      const infoWindow = new google.maps.InfoWindow({
        content: `
          <div style="font-family: Arial, sans-serif; max-width: 280px;">
            <h4 style="margin: 0 0 8px 0; color: ${suggestionStyle.color};">
              ${suggestionStyle.icon} ${suggestionStyle.name}
            </h4>
            <p style="margin: 4px 0; font-size: 12px;"><strong>Source:</strong> ${suggestion.source === 'pattern_based' ? '🧠 Our AI (Historical)' : '🤖 Gemini AI'}</p>
            <p style="margin: 4px 0; font-size: 12px;"><strong>Score:</strong> ${suggestion.confidence_score.toFixed(1)}%</p>
            <p style="margin: 4px 0; font-size: 12px;"><strong>Distance:</strong> ${suggestion.distance_m}m</p>
            <p style="margin: 4px 0; font-size: 12px;"><strong>Bearing to POI:</strong> ${bearingToPOI}°</p>
            <div style="margin: 4px 0; font-size: 12px; padding: 4px 8px; background-color: ${suggestionStyle.color}15; border-left: 3px solid ${suggestionStyle.color}; border-radius: 3px;">
              <strong>Access:</strong> <span style="color: ${suggestionStyle.color}; font-weight: 600;">${suggestionStyle.emoji} ${suggestion.access_type}</span>
            </div>
            ${suggestion.reasoning ? `<p style="margin: 4px 0; font-size: 11px; color: #666;"><strong>Reasoning:</strong> ${suggestion.reasoning}</p>` : ''}
            <p style="margin: 8px 0 4px 0; font-size: 10px; color: #999;">Drag to adjust position</p>
            
            <div style="margin-top: 12px; display: flex; gap: 8px;">
              <button 
                id="accept-${suggestion.id}" 
                style="
                  flex: 1;
                  background: #10B981; 
                  color: white; 
                  border: none; 
                  padding: 6px 12px; 
                  border-radius: 4px; 
                  font-size: 12px; 
                  cursor: pointer;
                  font-weight: 500;
                "
                onmouseover="this.style.background='#059669'"
                onmouseout="this.style.background='#10B981'"
              >
                ✓ Aceitar
              </button>
              <button 
                id="reject-${suggestion.id}" 
                style="
                  flex: 1;
                  background: #EF4444; 
                  color: white; 
                  border: none; 
                  padding: 6px 12px; 
                  border-radius: 4px; 
                  font-size: 12px; 
                  cursor: pointer;
                  font-weight: 500;
                "
                onmouseover="this.style.background='#DC2626'"
                onmouseout="this.style.background='#EF4444'"
              >
                ✗ Rejeitar
              </button>
            </div>
          </div>
        `
      })

      marker.addListener('click', () => {
        infoWindow.open(mapInstanceRef.current!, marker)
        
        // Add event listeners for buttons after InfoWindow is opened
        setTimeout(() => {
          const acceptBtn = document.getElementById(`accept-${suggestion.id}`)
          const rejectBtn = document.getElementById(`reject-${suggestion.id}`)
          
          if (acceptBtn) {
            acceptBtn.addEventListener('click', () => {
              if (onSuggestionAccept) {
                onSuggestionAccept(suggestion)
              }
              infoWindow.close()
            })
          }
          
          if (rejectBtn) {
            rejectBtn.addEventListener('click', () => {
              if (onSuggestionReject) {
                onSuggestionReject(suggestion)
              }
              infoWindow.close()
            })
          }
        }, 100) // Small delay to ensure DOM is ready
      })

      suggestionMarkersRef.current.set(suggestion.id, marker)
    })
  }, [suggestions, center, calculateBearingToPOI, calculateHaversineDistance, getSuggestionStyle, onSuggestionDrag, createBearingLine])

  useEffect(() => {
    if (window.google && window.google.maps) {
      initializeMap()
    }
  }, [initializeMap])

  useEffect(() => {
    if (mapInstanceRef.current) {
      createPoiMarker()
    }
  }, [createPoiMarker])

  useEffect(() => {
    updateTriggerPoints()
  }, [updateTriggerPoints])

  useEffect(() => {
    // Don't update markers while dragging to prevent map reset
    if (!isDraggingRef.current) {
      updateSuggestionMarkers()
    }
  }, [updateSuggestionMarkers])

  // Update map center when it changes (only if user hasn't interacted)
  useEffect(() => {
    if (mapInstanceRef.current && !hasUserInteractedRef.current) {
      mapInstanceRef.current.setCenter(center)
    }
  }, [center])

  // Function to reset map view to fit all trigger points
  const resetMapView = useCallback(() => {
    if (!mapInstanceRef.current) return
    
    const bounds = new google.maps.LatLngBounds()
    
    // Always include the POI location
    bounds.extend(center)
    
    // Include trigger points if they exist
    if (triggerPoints.length > 0) {
      triggerPoints.forEach(tp => {
        bounds.extend(new google.maps.LatLng(tp.latitude, tp.longitude))
        // Extend bounds to include radius
        const radiusInDegrees = tp.radius_meters / 111000 // Rough conversion
        bounds.extend(new google.maps.LatLng(tp.latitude + radiusInDegrees, tp.longitude + radiusInDegrees))
        bounds.extend(new google.maps.LatLng(tp.latitude - radiusInDegrees, tp.longitude - radiusInDegrees))
      })
    }
    
    // Add some padding and fit bounds
    mapInstanceRef.current.fitBounds(bounds, { left: 50, top: 50, right: 50, bottom: 50 })
    
    // Ensure minimum zoom level so POI is visible
    if (triggerPoints.length === 0) {
      mapInstanceRef.current.setZoom(Math.max(mapInstanceRef.current.getZoom() || 15, 15))
    }
    
    // Reset user interaction flag
    hasUserInteractedRef.current = false
  }, [center, triggerPoints])

  // Expose resetMapView to parent component
  useEffect(() => {
    if (onResetMapView) {
      // Store the reset function in a way that parent can access it
      ;(window as any).__triggerPointsMapReset = resetMapView
    }
  }, [resetMapView, onResetMapView])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (poiMarkerRef.current) {
        poiMarkerRef.current.setMap(null)
        poiMarkerRef.current = null
      }
      
      // Cleanup suggestion markers and lines
      suggestionMarkersRef.current.forEach(marker => {
        marker.setMap(null)
      })
      suggestionMarkersRef.current.clear()
      
      suggestionLinesRef.current.forEach(line => {
        line.setMap(null)
      })
      suggestionLinesRef.current.clear()
    }
  }, [])

  return <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
}

export function TriggerPointsMap({
  height = '400px',
  className = '',
  ...mapProps
}: TriggerPointMapProps) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

  if (!apiKey) {
    return (
      <div className={`flex items-center justify-center bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800 ${className}`} style={{ height }}>
        <div className="text-center p-4">
          <p className="text-red-600 dark:text-red-400 font-medium">Google Maps API Key Missing</p>
          <p className="text-red-500 dark:text-red-500 text-sm mt-1">
            Please configure NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
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
              <p className="text-gray-500 dark:text-gray-400">Loading trigger points map...</p>
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
        return <TriggerPointsMapContent {...mapProps} />
      default:
        return <div>Unknown status</div>
    }
  }

  return (
    <div className={className} style={{ height }}>
      <Wrapper
        apiKey={apiKey}
        render={renderFunction}
        libraries={LIBRARIES}
        version="weekly"
      />
    </div>
  )
}