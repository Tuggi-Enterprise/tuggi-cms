'use client'

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Wrapper, Status } from '@googlemaps/react-wrapper'

import { GOOGLE_MAPS_LIBRARIES, GOOGLE_MAPS_VERSION, BOUNDARY_COLOR } from '@/lib/maps-config'
import { createPolygonDrawer, type PolygonDrawer } from '@/lib/maps/polygon-draw'

const LIBRARIES = GOOGLE_MAPS_LIBRARIES

interface GoogleMapComponentProps {
  center?: { lat: number; lng: number }
  zoom?: number
  height?: string
  className?: string
  onPolygonComplete?: (polygon: google.maps.Polygon) => void
  onPolygonChange?: (polygon: google.maps.Polygon) => void
  onMarkerClick?: (markerId: string) => void
  onMapClick?: (lat: number, lng: number) => void
  /**
   * Onde o pino parou depois de arrastado. Só dispara para marcador com `draggable`, e é o
   * ÚNICO jeito de saber a posição nova: o Google move o pino sozinho e não avisa ninguém, então
   * sem este callback o mapa mostraria uma coordenada que a tela não tem.
   */
  onMarkerDragEnd?: (markerId: string, lat: number, lng: number) => void
  markers?: Array<{
    id: string
    position: { lat: number; lng: number }
    title: string
    description?: string
    color?: string
    /** Marca o usuário como ativo agora — pin maior, cor de destaque e animação (pulse). */
    active?: boolean
    /**
     * Deixa o pino ser arrastado. Padrão `false`: quase todo mapa aqui MOSTRA posição, e um pino
     * que se move sob o cursor num mapa de leitura é um dado alterado por acidente.
     */
    draggable?: boolean
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
const MapComponent: React.FC<Omit<GoogleMapComponentProps, 'height' | 'className'>> = ({
  center: centerProp,
  zoom = 13,
  onPolygonComplete,
  onPolygonChange,
  onMarkerClick,
  onMapClick,
  onMarkerDragEnd,
  markers = [],
  polygon,
  savedPolygons = [],
  cityBoundary,
  cityName,
  enableDrawing = true,
  showDrawingButton = true,
  circle,
  circles = [],
  polygonOptions,
  componentId
}) => {
  // Validate and set default center
  const center = centerProp && typeof centerProp === 'object' && 'lat' in centerProp && 'lng' in centerProp
    ? centerProp
    : { lat: 40.7128, lng: -74.0060 }
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<google.maps.Map | null>(null)
  const currentPolygonRef = useRef<google.maps.Polygon | null>(null)

  // Manual polygon drawing (click to add vertices, double-click — or toggling enableDrawing
  // off — to finish). Mechanics live in the shared lib/maps/polygon-draw helper (SSOT);
  // this component owns only the toggle button and the resulting editable polygon.
  const drawerRef = useRef<PolygonDrawer | null>(null)
  // Synced prop refs so map init / listeners read fresh values without re-running effects.
  const enableDrawingRef = useRef(enableDrawing)
  const polygonOptionsRef = useRef(polygonOptions)
  useEffect(() => { enableDrawingRef.current = enableDrawing }, [enableDrawing])
  useEffect(() => { polygonOptionsRef.current = polygonOptions }, [polygonOptions])
  const savedPolygonsRef = useRef<google.maps.Polygon[]>([])
  const cityBoundaryRef = useRef<google.maps.Polygon | null>(null)
  // Marcadores indexados por id — permite reconciliar (reusar/mover/remover) em vez de
  // destruir e recriar tudo a cada render. Sem isto, pins de posições antigas ficavam
  // "fantasmas" no mapa (ex.: usuário ao vivo continuava aparecendo na origem).
  const markersRef = useRef<Map<string, google.maps.Marker>>(new Map())
  // requestAnimationFrame em voo por marcador, para o pin deslizar até a nova posição.
  const markerAnimRef = useRef<Map<string, number>>(new Map())
  // Último center/zoom aplicado — evita reescrever a câmera (e o zoom do operador) a cada poll.
  const lastViewRef = useRef<{ lat: number; lng: number; zoom: number } | null>(null)

  const drawingButtonRef = useRef<HTMLButtonElement | null>(null)
  const circleRef = useRef<google.maps.Circle | null>(null)
  const circlesRef = useRef<google.maps.Circle[]>([])

  // CRITICAL: Initialize ref immediately with current value (not in useEffect)
  // This ensures the callback is available even if event fires before useEffect runs
  const onPolygonCompleteRef = useRef(onPolygonComplete)
  
  // Update ref whenever onPolygonComplete changes
  useEffect(() => {
    onPolygonCompleteRef.current = onPolygonComplete
  }, [onPolygonComplete, componentId])

  // Build the editable polygon once drawing completes, then notify the parent.
  const handleDrawComplete = useCallback((coords: Array<{ lat: number; lng: number }>) => {
    const map = mapInstanceRef.current
    if (!map) return
    const opts = polygonOptionsRef.current
    if (currentPolygonRef.current) currentPolygonRef.current.setMap(null)
    const polygonShape = new google.maps.Polygon({
      paths: coords,
      map,
      fillColor: opts?.fillColor || BOUNDARY_COLOR,
      fillOpacity: opts?.fillOpacity ?? 0.2,
      strokeColor: opts?.strokeColor || BOUNDARY_COLOR,
      strokeWeight: opts?.strokeWeight || 3,
      editable: true,
      draggable: true,
    })
    currentPolygonRef.current = polygonShape

    const cb = onPolygonCompleteRef.current
    if (cb) {
      try { cb(polygonShape) } catch (error) {
        console.error('❌ [GoogleMapComponent] onPolygonComplete callback error:', error)
      }
    }
  }, [])

  const initializeMap = useCallback(() => {
    if (!mapRef.current || mapInstanceRef.current) return

    // Limpa qualquer conteúdo residual de uma instância anterior antes de criar o mapa.
    // Sem isto, remount/Fast Refresh empilha um novo google.maps.Map por cima do antigo no
    // mesmo <div> — camadas sobrepostas, com pin fantasma travado numa delas.
    if (mapRef.current.firstChild) mapRef.current.innerHTML = ''

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

    // Add click listener if onMapClick is provided.
    // While drawing a polygon, clicks add vertices instead — don't fire onMapClick.
    if (onMapClick) {
      map.addListener('click', (e: google.maps.MapMouseEvent) => {
        if (drawerRef.current?.isDrawing()) return
        if (e.latLng) {
          onMapClick(e.latLng.lat(), e.latLng.lng())
        }
      })
    }

    // Shared polygon drawer (SSOT for the draw interaction). Owns vertices/preview/commit;
    // this component only styles the resulting polygon and drives the toggle button.
    drawerRef.current = createPolygonDrawer(map, {
      style: polygonOptionsRef.current,
      onComplete: handleDrawComplete,
      onStateChange: (isDrawing) => {
        const btn = drawingButtonRef.current
        if (btn) {
          btn.innerHTML = isDrawing ? '⏹️ Finish Polygon' : '🔸 Draw Polygon'
          btn.style.backgroundColor = isDrawing ? '#FF6F00' : '#00A8E8'
        }
      },
    })

    // Custom "Draw Polygon" control button (manual drawing — DrawingManager was
    // removed from the Maps JS API in v3.65). Toggles the shared drawer.
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
    if (showDrawingButton === false) {
      controlButton.style.display = 'none'
    }
    controlButton.addEventListener('click', () => {
      const d = drawerRef.current
      if (!d) return
      d.isDrawing() ? d.finish() : d.start()
    })
    drawingButtonRef.current = controlButton
    controlDiv.appendChild(controlButton)
    map.controls[google.maps.ControlPosition.TOP_RIGHT].push(controlDiv)

    // If drawing was already requested (e.g. enableDrawing defaults true), start now.
    if (enableDrawingRef.current) {
      drawerRef.current.start()
    }
  }, [center, zoom, onMapClick, handleDrawComplete])

  const updateMarkers = useCallback(() => {
    if (!mapInstanceRef.current) return
    const map = mapInstanceRef.current
    const store = markersRef.current

    // Ícone (data-URI SVG) para o estado atual do marcador.
    const buildIcon = (isActive: boolean, color?: string): google.maps.Icon => {
      const markerColor = isActive ? '#10B981' : (color || '#FF6F00')
      const activeSvg = `
        <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
          <circle cx="16" cy="16" r="13" fill="${markerColor}" fill-opacity="0.25"/>
          <circle cx="16" cy="16" r="7" fill="${markerColor}" stroke="#ffffff" stroke-width="2.5"/>
        </svg>`
      const baseSvg = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="${markerColor}"/>
        </svg>`
      return isActive
        ? { url: 'data:image/svg+xml;base64,' + btoa(activeSvg), scaledSize: new google.maps.Size(32, 32), anchor: new google.maps.Point(16, 16) }
        : { url: 'data:image/svg+xml;base64,' + btoa(baseSvg), scaledSize: new google.maps.Size(24, 24), anchor: new google.maps.Point(12, 24) }
    }

    // Desliza o pin da posição atual até a nova (ease-out ~700ms). Snap em micro-movimento
    // ou salto grande (> ~1°, ex. troca de usuário) para não "voar" pela tela.
    const glideTo = (id: string, marker: google.maps.Marker, to: { lat: number; lng: number }) => {
      const from = marker.getPosition()
      const running = markerAnimRef.current.get(id)
      if (running) { cancelAnimationFrame(running); markerAnimRef.current.delete(id) }
      if (!from) { marker.setPosition(to); return }
      const fromLat = from.lat(), fromLng = from.lng()
      const dLat = to.lat - fromLat, dLng = to.lng - fromLng
      if ((Math.abs(dLat) < 1e-6 && Math.abs(dLng) < 1e-6) || Math.abs(dLat) > 1 || Math.abs(dLng) > 1) {
        marker.setPosition(to); return
      }
      const start = performance.now()
      const DURATION = 700
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / DURATION)
        const e = 1 - (1 - t) * (1 - t) // easeOutQuad
        marker.setPosition({ lat: fromLat + dLat * e, lng: fromLng + dLng * e })
        if (t < 1) markerAnimRef.current.set(id, requestAnimationFrame(step))
        else markerAnimRef.current.delete(id)
      }
      markerAnimRef.current.set(id, requestAnimationFrame(step))
    }

    // 1) Remove marcadores que sumiram do conjunto atual (mata pins fantasmas).
    const incoming = new Set(markers.map(m => m.id))
    store.forEach((marker, id) => {
      if (!incoming.has(id)) {
        const anim = markerAnimRef.current.get(id)
        if (anim) { cancelAnimationFrame(anim); markerAnimRef.current.delete(id) }
        marker.setMap(null)
        store.delete(id)
      }
    })

    // 2) Cria os novos; reaproveita e move os que já existem.
    markers.forEach(markerData => {
      const isActive = markerData.active === true
      const icon = buildIcon(isActive, markerData.color)
      const existing = store.get(markerData.id)

      if (!existing) {
        const marker = new google.maps.Marker({
          position: markerData.position,
          map,
          title: markerData.title,
          zIndex: isActive ? 1000 : 1,
          animation: isActive ? google.maps.Animation.BOUNCE : undefined,
          draggable: markerData.draggable === true,
          icon,
        })
        if (markerData.draggable === true && onMarkerDragEnd) {
          marker.addListener('dragend', (event: google.maps.MapMouseEvent) => {
            if (event.latLng) {
              onMarkerDragEnd(markerData.id, event.latLng.lat(), event.latLng.lng())
            }
          })
        }
        if (onMarkerClick) {
          marker.addListener('click', () => onMarkerClick(markerData.id))
        }
        if (markerData.description) {
          const infoWindow = new google.maps.InfoWindow({
            content: `
            <div>
              <h3 style="margin: 0 0 8px 0; font-weight: 600;">${markerData.title}</h3>
              <p style="margin: 0; font-size: 12px; color: #666;">${markerData.description}</p>
            </div>
          `
          })
          marker.addListener('click', () => infoWindow.open(map, marker))
        }
        store.set(markerData.id, marker)
      } else {
        // Mesmo id → é o mesmo alvo: desliza até a nova posição e atualiza o visual.
        glideTo(markerData.id, existing, markerData.position)
        existing.setIcon(icon)
        existing.setZIndex(isActive ? 1000 : 1)
        existing.setTitle(markerData.title)
        existing.setAnimation(isActive ? google.maps.Animation.BOUNCE : null)
        // Reaplicado no update: um marcador que virou arrastável depois de montado ficaria
        // preso, e o operador não teria como saber que o pino deveria se mover.
        existing.setDraggable(markerData.draggable === true)
      }
    })
  }, [markers, onMarkerClick, onMarkerDragEnd])

  const updateMapView = useCallback(() => {
    if (!mapInstanceRef.current) return
    // Só reaplica quando o VALOR muda. Sem isto, o polling ao vivo (novo center/zoom a cada
    // render) reescrevia o zoom a cada 30s e desfazia o zoom manual do operador. Assim o
    // centro segue o usuário, mas o zoom do operador é preservado (só muda se o prop mudar).
    const last = lastViewRef.current
    if (!last || last.lat !== center.lat || last.lng !== center.lng) {
      mapInstanceRef.current.setCenter(center)
    }
    if (!last || last.zoom !== zoom) {
      mapInstanceRef.current.setZoom(zoom)
    }
    lastViewRef.current = { lat: center.lat, lng: center.lng, zoom }
  }, [center, zoom])

  const updatePolygon = useCallback(() => {
    if (!mapInstanceRef.current || !polygon || polygon.length === 0) {
      if (currentPolygonRef.current) {
        currentPolygonRef.current.setMap(null)
        currentPolygonRef.current = null
      }
      return
    }

    // If a polygon already exists, check if paths are exactly the same (to avoid dragging interruption)
    if (currentPolygonRef.current) {
      const existingPath = currentPolygonRef.current.getPath()
      if (existingPath && existingPath.getLength() === polygon.length) {
        let isSame = true
        for (let i = 0; i < polygon.length; i++) {
          const latLng = existingPath.getAt(i)
          if (!latLng || Math.abs(latLng.lat() - polygon[i].lat) > 0.000001 || Math.abs(latLng.lng() - polygon[i].lng) > 0.000001) {
            isSame = false
            break
          }
        }
        if (isSame) {
          // Polygon exactly matches what's on screen, nothing to update
          return
        }
      }
      // If we reach here, shape changed externally, so we recreate
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

    // Add event listeners for editing polygon
    if (onPolygonChange) {
      const path = polygonShape.getPath()
      
      const handleChange = () => {
        onPolygonChange(polygonShape)
      }

      google.maps.event.addListener(path, 'set_at', handleChange)
      google.maps.event.addListener(path, 'insert_at', handleChange)
      google.maps.event.addListener(path, 'remove_at', handleChange)
      google.maps.event.addListener(polygonShape, 'dragend', handleChange)
    }

    // Fit map to polygon bounds
    const bounds = new google.maps.LatLngBounds()
    polygon.forEach(point => bounds.extend(point))
    mapInstanceRef.current.fitBounds(bounds)
  }, [polygon, onPolygonChange, polygonOptions])

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
    const drawer = drawerRef.current
    if (!drawer) return

    if (enableDrawing) {
      // Enter drawing mode (no-op if already drawing).
      drawer.start()
    } else if (drawer.isDrawing()) {
      // enableDrawing toggled off while drawing: commit the polygon if it has
      // enough vertices, otherwise discard the preview (drawer.finish handles both).
      drawer.finish()
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
    if (window.google && window.google.maps) {
      initializeMap()
    } else {
      // Wait for the Maps API to load
      const checkLibraries = setInterval(() => {
        if (window.google && window.google.maps) {
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

  // Cleanup drawing listeners/preview when component unmounts
  useEffect(() => {
    return () => {
      drawerRef.current?.dispose()
      drawerRef.current = null
      // Cancela glides em voo e solta os marcadores (evita setPosition em marker destruído).
      markerAnimRef.current.forEach(frame => cancelAnimationFrame(frame))
      markerAnimRef.current.clear()
      markersRef.current.forEach(marker => marker.setMap(null))
      markersRef.current.clear()
      // Solta a instância do mapa — evita empilhar mapas sobrepostos ao remontar (Fast Refresh).
      if (mapInstanceRef.current && typeof google !== 'undefined') {
        google.maps.event.clearInstanceListeners(mapInstanceRef.current)
      }
      mapInstanceRef.current = null
      lastViewRef.current = null
      if (mapRef.current) mapRef.current.innerHTML = ''
    }
  }, [])

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
        {/* O ACENTO É A BORDA E O FUNDO, NUNCA A TINTA. `text-yellow-600` (#CA8A04) mede
            2.84:1 sobre `bg-yellow-50` (#FEFCE8) e reprova SC 1.4.3, que pede 4.5:1 — apanhado
            pelo `axe-core` em `tests/ct/partnerships-a11y.spec.tsx` quando o painel do ponto do
            parceiro passou a montar este mapa. É a mesma correção que o diretório já aplicou ao
            seu badge: a cor vive na moldura, onde 3:1 basta (SC 1.4.11), e a palavra fica
            legível. */}
        <div className="text-center p-4">
          <p className="font-medium text-gray-900 dark:text-yellow-200">
            Google Maps API Key Required
          </p>
          <p className="mt-1 text-sm text-gray-800 dark:text-yellow-300">
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
            <MapComponent {...mapProps} />
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
        libraries={LIBRARIES}
        version={GOOGLE_MAPS_VERSION}
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