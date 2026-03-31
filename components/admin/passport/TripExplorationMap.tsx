'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Wrapper, Status } from '@googlemaps/react-wrapper'
import { GOOGLE_MAPS_LIBRARIES, GOOGLE_MAPS_VERSION } from '@/lib/maps-config'
import { TripExploration, POIExp } from '@/lib/core/passport-service'
import { Info, Map as MapIcon, Sliders, Navigation } from 'lucide-react'

interface TripExplorationMapProps {
  exploration: TripExploration | null
  bufferMeters: number
  onBufferChange: (meters: number) => void
  isLoading?: boolean
}

function TripMapContent({ exploration, bufferMeters }: { exploration: TripExploration | null, bufferMeters: number }) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<google.maps.Map | null>(null)
  const polylineRef = useRef<google.maps.Polyline | null>(null)
  const markersRef = useRef<google.maps.Marker[]>([])
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null)

  const initializeMap = useCallback(() => {
    if (!mapRef.current || mapInstanceRef.current) return

    const map = new google.maps.Map(mapRef.current, {
      center: { lat: -23.5505, lng: -46.6333 },
      zoom: 13,
      styles: [
        { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] }
      ]
    })

    mapInstanceRef.current = map
    infoWindowRef.current = new google.maps.InfoWindow()
  }, [])

  useEffect(() => { initializeMap() }, [initializeMap])

  useEffect(() => {
    if (!mapInstanceRef.current || !exploration) return
    const map = mapInstanceRef.current

    // Clear existing
    if (polylineRef.current) polylineRef.current.setMap(null)
    markersRef.current.forEach(m => m.setMap(null))
    markersRef.current = []

    // 1. Draw Route
    // Note: In a real scenario, we'd fetch the actual trail points. 
    // For exploration view, we use the points from heard/missed as bounds for now unless we have the full trail.
    // Assuming exploration doesn't contain the full trail, we'll center on markers.
    
    // 2. Markers
    const bounds = new google.maps.LatLngBounds()

    const createMarker = (poi: POIExp, isHeard: boolean) => {
      const marker = new google.maps.Marker({
        position: { lat: poi.latitude, lng: poi.longitude },
        map,
        title: poi.name,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: isHeard ? '#FF6F00' : '#9CA3AF', // Orange vs Gray
          fillOpacity: 0.9,
          strokeWeight: 2,
          strokeColor: '#FFFFFF'
        }
      })

      marker.addListener('click', () => {
        infoWindowRef.current?.setContent(`
          <div style="padding: 10px; min-width: 200px;">
            <p style="font-weight: bold; margin-bottom: 4px;">${poi.name}</p>
            <p style="font-size: 11px; color: #666;">${poi.city}</p>
            <p style="font-size: 10px; color: ${isHeard ? '#FF6F00' : '#4B5563'}; font-weight: bold; margin-top: 8px; text-transform: uppercase;">
              ${isHeard ? '✓ Heard during trip' : '✗ Missed / Hidden'}
            </p>
            <p style="font-size: 10px; margin-top: 4px;">Category: ${poi.osm_category || poi.category || 'N/A'}</p>
          </div>
        `)
        infoWindowRef.current?.open(map, marker)
      })

      markersRef.current.push(marker)
      bounds.extend(marker.getPosition()!)
    }

    exploration.heard_pois.forEach(p => createMarker(p, true))
    exploration.missed_pois.forEach(p => createMarker(p, false))

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds)
    }
  }, [exploration])

  return <div ref={mapRef} className="w-full h-full rounded-b-3xl" />
}

export function TripExplorationMap({ exploration, bufferMeters, onBufferChange, isLoading }: TripExplorationMapProps) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

  return (
    <div className="bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl rounded-[40px] border border-gray-200 dark:border-gray-800 shadow-3xl shadow-black/10 flex flex-col h-full animate-in fade-in duration-700">
      {/* Header with buffer controls */}
      <div className="p-8 border-b border-gray-100 dark:border-gray-800">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-tuggi-blue/10 rounded-2xl">
              <Navigation className="h-6 w-6 text-tuggi-blue" />
            </div>
            <div>
              <h3 className="text-2xl font-bold text-gray-900 dark:text-white leading-tight tracking-tight">Trip Exploration</h3>
              <p className="text-xs text-gray-400 font-bold uppercase tracking-widest leading-none mt-1">FOMO Analysis & Radius Tracking</p>
            </div>
          </div>

          <div className="flex items-center gap-8 bg-gray-50/50 dark:bg-gray-800/50 p-4 rounded-3xl border border-gray-200 dark:border-gray-700">
            <div className="flex flex-col gap-2 min-w-[200px]">
              <div className="flex justify-between items-center px-1">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Buffer Radius</span>
                <span className="text-xs font-bold text-tuggi-blue">{(bufferMeters / 1000).toFixed(1)} km</span>
              </div>
              <input
                type="range"
                min="100"
                max="5000"
                step="100"
                value={bufferMeters}
                onChange={(e) => onBufferChange(parseInt(e.target.value))}
                className="w-full accent-tuggi-blue"
              />
            </div>
            
            <div className="h-10 w-px bg-gray-200 dark:bg-gray-700" />
            
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-orange-600 shadow-lg shadow-orange-500/20" />
                <span className="text-[10px] font-bold text-gray-900 dark:text-white uppercase tracking-widest">Heard</span>
                <span className="text-xs font-bold text-orange-600 ml-1">{exploration?.heard_count || 0}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-gray-400 shadow-lg shadow-gray-400/20" />
                <span className="text-[10px] font-bold text-gray-900 dark:text-white uppercase tracking-widest">Missed</span>
                <span className="text-xs font-bold text-gray-400 ml-1">{exploration?.missed_count || 0}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-[500px] relative">
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-50/10 backdrop-blur-sm z-10">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-tuggi-blue mx-auto mb-4" />
              <p className="text-gray-600 font-bold uppercase tracking-widest text-xs">Analyzing spatial data...</p>
            </div>
          </div>
        ) : !apiKey ? (
           <div className="p-8 text-center text-red-500">Google Maps API key missing.</div>
        ) : (
          <Wrapper apiKey={apiKey} libraries={GOOGLE_MAPS_LIBRARIES} version={GOOGLE_MAPS_VERSION}>
            <TripMapContent exploration={exploration} bufferMeters={bufferMeters} />
          </Wrapper>
        )}
      </div>

      {/* FOMO Message */}
      {exploration && !isLoading && (
        <div className="p-6 bg-tuggi-blue/5 border-t border-tuggi-blue/10 rounded-b-3xl">
          <div className="flex items-center gap-4">
            <div className="p-2 bg-tuggi-blue/10 rounded-xl">
              <Info className="h-5 w-5 text-tuggi-blue" />
            </div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
               Legal! O usuário ouviu <span className="font-bold text-orange-600">{exploration.heard_count} pontos</span> hoje, mas ele poderia ter ouvido <span className="font-bold text-gray-900 dark:text-white">{exploration.heard_count + exploration.missed_count} pontos</span> se tivesse desviado um pouco da rota (Raio de {(exploration.buffer_meters / 1000).toFixed(1)}km).
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
