'use client'

import { useEffect, useMemo, useRef, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Wrapper } from '@googlemaps/react-wrapper'
import { GOOGLE_MAPS_LIBRARIES, GOOGLE_MAPS_VERSION } from '@/lib/maps-config'
import { TripExploration, POIExp } from '@/lib/core/passport-service'
import { Info, Navigation } from 'lucide-react'

interface TripExplorationMapProps {
  exploration: TripExploration | null
  bufferMeters: number
  onBufferChange: (meters: number) => void
  isLoading?: boolean
  /** False while no trip is selected: the map then asks for one instead of drawing nothing. */
  hasSelection?: boolean
}

interface MarkerLabels {
  heard: string
  missed: string
}

/**
 * The info window is built from DOM nodes and `textContent`, not an HTML string: a POI name is
 * curated text, and a string template would render any markup in it.
 */
function markerContent(poi: POIExp, isHeard: boolean, labels: MarkerLabels): HTMLElement {
  const root = document.createElement('div')
  root.style.cssText = 'padding: 12px; min-width: 200px; font-family: sans-serif;'
  const name = document.createElement('p')
  name.style.cssText = 'font-weight: bold; margin-bottom: 4px; color: #111;'
  name.textContent = poi.name
  const city = document.createElement('p')
  city.style.cssText = 'font-size: 11px; color: #666; margin-bottom: 8px;'
  city.textContent = poi.city
  const badge = document.createElement('div')
  badge.style.cssText = `font-size: 10px; padding: 4px 8px; border-radius: 4px; font-weight: bold; background: ${isHeard ? '#FFF7ED' : '#F3F4F6'}; color: ${isHeard ? '#C2410C' : '#4B5563'}; border: 1px solid ${isHeard ? '#FFEDD5' : '#E5E7EB'};`
  badge.textContent = isHeard ? labels.heard : labels.missed
  root.append(name, city, badge)
  return root
}

function TripMapContent({ exploration, labels }: { exploration: TripExploration | null; labels: MarkerLabels }) {
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

    const bounds = new google.maps.LatLngBounds()

    // 1. Draw Route Trail
    if (exploration.trail && exploration.trail.coordinates) {
      const path: google.maps.LatLngLiteral[] = exploration.trail.coordinates.map((coord: [number, number]) => ({
        lat: coord[1],
        lng: coord[0]
      }))

      polylineRef.current = new google.maps.Polyline({
        path,
        geodesic: true,
        strokeColor: '#00A8E8',
        strokeOpacity: 0.8,
        strokeWeight: 4,
        map
      })

      path.forEach((point) => bounds.extend(point))
    }
    
    // 2. Markers
    const createMarker = (poi: POIExp, isHeard: boolean) => {
      const marker = new google.maps.Marker({
        position: { lat: poi.latitude, lng: poi.longitude },
        map,
        title: poi.name,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 6,
          fillColor: isHeard ? '#FF6F00' : '#E5E7EB', // Vivid Orange vs Light Gray
          fillOpacity: 1,
          strokeWeight: 1,
          strokeColor: '#FFFFFF'
        },
        zIndex: isHeard ? 100 : 50
      })

      marker.addListener('click', () => {
        infoWindowRef.current?.setContent(markerContent(poi, isHeard, labels))
        infoWindowRef.current?.open(map, marker)
      })

      markersRef.current.push(marker)
      bounds.extend(marker.getPosition()!)
    }

    exploration.heard_pois.forEach(p => createMarker(p, true))
    exploration.missed_pois.forEach(p => createMarker(p, false))

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { top: 50, bottom: 50, left: 50, right: 50 })
    }
  }, [exploration, labels])

  // Absolute, because the box around it has a minimum height and no fixed one: `h-full` there
  // resolves to zero and the map paints nothing.
  return <div ref={mapRef} className="absolute inset-0" />
}

export function TripExplorationMap({ exploration, bufferMeters, onBufferChange, isLoading, hasSelection = true }: TripExplorationMapProps) {
  const t = useTranslations('Pages.AppUsers.passport')
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  const heardLabel = t('heard')
  const missedLabel = t('missed')
  const labels = useMemo(() => ({ heard: heardLabel, missed: missedLabel }), [heardLabel, missedLabel])

  return (
    <div className="bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl rounded-[40px] border border-gray-200 dark:border-gray-800 shadow-3xl shadow-black/10 flex flex-col h-full animate-in fade-in duration-700">
      {/* Header with buffer controls - Compacted */}
      <div className="py-4 px-6 border-b border-gray-100 dark:border-gray-800">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-tuggi-blue/10 rounded-xl">
              <Navigation className="h-5 w-5 text-tuggi-blue" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white leading-tight tracking-tight">{t('exploration_title')}</h3>
              <p className="text-xs text-gray-500 mt-0.5">{t('exploration_hint')}</p>
            </div>
          </div>

          <div className="flex items-center gap-4 min-w-[220px] bg-gray-50/50 dark:bg-gray-800/50 py-2 px-4 rounded-2xl border border-gray-100 dark:border-gray-700">
            <div className="flex flex-col flex-1">
              <div className="flex justify-between items-center px-1 mb-1">
                <span className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">{t('buffer')}</span>
                <span className="text-[11px] font-black text-tuggi-blue">{(bufferMeters / 1000).toFixed(1)} km</span>
              </div>
              <input
                type="range"
                min="100"
                max="5000"
                step="100"
                value={bufferMeters}
                aria-label={t('buffer')}
                onChange={(e) => onBufferChange(parseInt(e.target.value, 10))}
                className="w-full h-1.5 accent-tuggi-blue"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-[500px] relative">
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-50/10 backdrop-blur-sm z-10">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-tuggi-blue mx-auto mb-4" />
              <p className="text-gray-600 text-sm">{t('exploration_loading')}</p>
            </div>
          </div>
        ) : !hasSelection ? (
          <div className="absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-gray-500">{t('select_trip')}</div>
        ) : !apiKey ? (
          <div className="p-8 text-center text-red-600">{t('map_key_missing')}</div>
        ) : (
          <Wrapper apiKey={apiKey} libraries={GOOGLE_MAPS_LIBRARIES} version={GOOGLE_MAPS_VERSION}>
            <TripMapContent exploration={exploration} labels={labels} />
          </Wrapper>
        )}
        {/* The legend sits on the map it explains (#977), bottom left and above Google's own
            logo, which the terms of use say must stay visible. */}
        {exploration && !isLoading && hasSelection && (
          <div className="absolute left-3 bottom-8 z-10 flex items-center gap-4 rounded-xl bg-white/95 dark:bg-gray-900/95 px-3 py-2 shadow-md border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-orange-600" />
              <span className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">{t('heard')}</span>
              <span className="text-[11px] font-black text-orange-600">{exploration.heard_count || 0}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-gray-400" />
              <span className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">{t('missed')}</span>
              <span className="text-[11px] font-black text-gray-500">{exploration.missed_count || 0}</span>
            </div>
          </div>
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
              {t('exploration_summary', {
                heard: exploration.heard_count,
                radius: (exploration.buffer_meters / 1000).toFixed(1),
                total: exploration.heard_count + exploration.missed_count,
              })}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
