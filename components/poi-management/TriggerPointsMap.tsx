'use client'

import { useEffect, useRef, useCallback } from 'react'
import { Wrapper, Status } from '@googlemaps/react-wrapper'
import { TriggerPoint, TriggerPointMapProps } from '@/types/trigger-points'

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

  const getMarkerIcon = useCallback((triggerPoint: TriggerPoint, isSelected: boolean = false) => {
    const colors = {
      primary: '#00A8E8',    // Tuggi Blue
      fallback: '#FF6F00',   // Tuggi Orange
      entry: '#10B981',      // Green
      exit: '#EF4444',       // Red
      approach: '#8B5CF6',   // Purple
      custom: '#F59E0B'      // Amber
    }

    const color = colors[triggerPoint.type as keyof typeof colors] || colors.primary
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
  }, [])

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

      // Create radius circle
      const colors = {
        primary: '#00A8E8',
        fallback: '#FF6F00',
        entry: '#10B981',
        exit: '#EF4444',
        approach: '#8B5CF6',
        custom: '#F59E0B'
      }
      const color = colors[triggerPoint.type as keyof typeof colors] || colors.primary

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

            // Add info window
      const directionInfo = triggerPoint.direction ? 
        (() => {
          const directionOptions = [
            { value: 'front', label: 'Front', emoji: '⬆️' },
            { value: 'right', label: 'Right', emoji: '➡️' },
            { value: 'left', label: 'Left', emoji: '⬅️' },
            { value: 'back', label: 'Back', emoji: '⬇️' }
          ];
          const dirOption = directionOptions.find(dir => dir.value === triggerPoint.direction);
          return dirOption ? `${dirOption.emoji} ${dirOption.label}` : 'Not set';
        })() : 'Not set';

      const infoWindow = new google.maps.InfoWindow({
        content: `
          <div style="padding: 8px; min-width: 200px;">
            <h3 style="margin: 0 0 8px 0; font-weight: 600; color: ${color};">
              ${triggerPoint.type.charAt(0).toUpperCase() + triggerPoint.type.slice(1)} Trigger
            </h3>
            <div style="font-size: 12px; color: #666; line-height: 1.4;">
              <div><strong>Priority:</strong> ${triggerPoint.priority}</div>
              <div><strong>Radius:</strong> ${triggerPoint.radius_meters}m</div>
              ${triggerPoint.direction ? 
                 `<div><strong>Direction:</strong> ${directionInfo}</div>` : 
                 ''
               }
              ${(triggerPoint.expected_bearing !== undefined && triggerPoint.expected_bearing !== null) ? 
                 `<div><strong>Bearing:</strong> ${triggerPoint.expected_bearing}° (±${triggerPoint.bearing_threshold}°)</div>` : 
                 ''
               }
              <div><strong>Status:</strong> <span style="color: ${triggerPoint.is_active ? '#059669' : '#DC2626'}; font-weight: 500;">${triggerPoint.is_active ? 'Active' : 'Inactive'}</span></div>
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

    // Add new click listener if in adding mode
    if (isAddingMode && onMapClick) {
      clickListenerRef.current = mapInstanceRef.current.addListener('click', (event: google.maps.MapMouseEvent) => {
        if (event.latLng) {
          onMapClick(event.latLng.lat(), event.latLng.lng())
        }
      })
      // Change cursor to indicate clickable map
      mapInstanceRef.current.setOptions({ draggableCursor: 'crosshair' })
    } else {
      // Reset cursor to default
      mapInstanceRef.current.setOptions({ draggableCursor: 'default' })
    }

    // Cleanup on unmount
    return () => {
      if (clickListenerRef.current) {
        google.maps.event.removeListener(clickListenerRef.current)
        clickListenerRef.current = null
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
        // Update existing marker position and title if needed
        const currentPos = existingMarker.getPosition()
        if (!currentPos || currentPos.lat() !== suggestion.lat || currentPos.lng() !== suggestion.lng) {
          existingMarker.setPosition(position)
          existingMarker.setTitle(`AI Suggestion (${suggestion.confidence_score.toFixed(1)}%) - Bearing: ${bearingToPOI}°`)
          
          // Update bearing line
          const newBearingPath = createBearingLine(position, bearingToPOI, 50, '#9333EA')
          existingLine.setPath(newBearingPath)
        }
        return // Skip creating new marker
      }
      
      // Create new marker with different color for suggestions
      const marker = new google.maps.Marker({
        position,
        map: mapInstanceRef.current!,
        title: `AI Suggestion (${suggestion.confidence_score.toFixed(1)}%) - Bearing: ${bearingToPOI}°`,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: '#9333EA', // Purple for AI suggestions
          fillOpacity: 0.8,
          strokeColor: '#FFFFFF',
          strokeWeight: 2,
          strokeOpacity: 1
        },
        zIndex: 1000,
        draggable: true // Enable dragging for suggestions
      })

      // Create bearing line to POI
      const bearingPath = createBearingLine(position, bearingToPOI, 50, '#9333EA')
      const bearingLine = new google.maps.Polyline({
        path: bearingPath,
        strokeColor: '#9333EA',
        strokeWeight: 2,
        strokeOpacity: 0.7,
        map: mapInstanceRef.current!,
        zIndex: 999,
        icons: [{
          icon: {
            path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
            scale: 3,
            fillColor: '#9333EA',
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
          const newBearingPath = createBearingLine(newPosition, newBearing, 50, '#9333EA')
          bearingLine.setPath(newBearingPath)
          
          // Update marker title
          marker.setTitle(`AI Suggestion (${suggestion.confidence_score.toFixed(1)}%) - Bearing: ${newBearing}°`)
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

      // Add info window with action buttons
      const infoWindow = new google.maps.InfoWindow({
        content: `
          <div style="font-family: Arial, sans-serif; max-width: 250px;">
            <h4 style="margin: 0 0 8px 0; color: #9333EA;">AI Suggestion</h4>
            <p style="margin: 4px 0; font-size: 12px;"><strong>Score:</strong> ${suggestion.confidence_score.toFixed(1)}%</p>
            <p style="margin: 4px 0; font-size: 12px;"><strong>Distance:</strong> ${suggestion.distance_m}m</p>
            <p style="margin: 4px 0; font-size: 12px;"><strong>Bearing to POI:</strong> ${bearingToPOI}°</p>
            <p style="margin: 4px 0; font-size: 12px;"><strong>Access:</strong> ${suggestion.access_type}</p>
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
  }, [suggestions, center, calculateBearingToPOI, calculateHaversineDistance, onSuggestionDrag])

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
        libraries={['drawing', 'places', 'geometry']}
        version="weekly"
      />
    </div>
  )
}