'use client'

/**
 * RouteEditorModal
 *
 * Drawer lateral direito (85vw) com tabs verticais à esquerda —
 * padrão idêntico ao POIDetailsModal.
 *
 * Tabs:
 *   Rota        — mapa + waypoints + info básica (split view)
 *   Experiência — perfil cênico, drivability, acessibilidade
 *   Config      — status, snap-to-roads, país/região
 *   Idiomas     — RouteTranslationsPanel (só em modo edição)
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Wrapper, Status } from '@googlemaps/react-wrapper'
import {
  X, Save, Trash2, Navigation, Map as MapIcon, Activity, Clock, AlertCircle,
  Plus, RefreshCw, Route, PenTool, CheckCircle, XCircle, Edit, Link2,
  ExternalLink, Accessibility, Car, Mountain, Sun, Moon, Sunrise,
  Camera, Trees, Building2, Wheat, ParkingCircle, ChevronDown, MapPin, Globe,
  FileText, Languages, AlertTriangle,
} from 'lucide-react'
import { useTranslations, useLocale } from 'next-intl'
import { cn } from '@/lib/utils'
import { GOOGLE_MAPS_LIBRARIES, GOOGLE_MAPS_VERSION } from '@/lib/maps-config'
import { useCmsUser } from '@/lib/hooks/useCmsUser'
import { RouteTranslationsPanel } from './RouteTranslationsPanel'

// ─── Content language catalogue ───────────────────────────────────────────────

const CONTENT_LANGUAGES = [
  { code: 'pt-br', label: 'Português (Brasil)',  flag: '🇧🇷' },
  { code: 'pt-pt', label: 'Português (Portugal)', flag: '🇵🇹' },
  { code: 'en-us', label: 'English (US)',         flag: '🇺🇸' },
  { code: 'en-gb', label: 'English (UK)',         flag: '🇬🇧' },
  { code: 'es-es', label: 'Español',              flag: '🇪🇸' },
  { code: 'fr-fr', label: 'Français',             flag: '🇫🇷' },
  { code: 'de-de', label: 'Deutsch',              flag: '🇩🇪' },
  { code: 'it-it', label: 'Italiano',             flag: '🇮🇹' },
  { code: 'ja-jp', label: '日本語',               flag: '🇯🇵' },
]

/** Map next-intl locale → our lang code (fallback: prepend -xx) */
function localeToLangCode(locale: string): string {
  const map: Record<string, string> = {
    pt: 'pt-br', 'pt-BR': 'pt-br', 'pt-PT': 'pt-pt',
    en: 'en-us', 'en-US': 'en-us', 'en-GB': 'en-gb',
    es: 'es-es', fr: 'fr-fr', de: 'de-de', it: 'it-it', ja: 'ja-jp',
  }
  return map[locale] ?? locale.toLowerCase().replace('_', '-')
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface LatLng { lat: number; lng: number }

interface WaypointMetadata {
  name?: string
  attraction_id?: string | null
  is_generic?: boolean
  wheelchair_access?: 'yes' | 'partial' | 'no' | 'unknown'
  parking?: 'yes' | 'no' | 'unknown'
  restrooms?: 'yes' | 'no' | 'unknown'
  rest_areas?: 'yes' | 'no' | 'unknown'
  photogenic_rating?: 'low' | 'medium' | 'high' | 'unknown'
}

interface Waypoint extends LatLng {
  id: string
  metadata?: WaypointMetadata
}

interface PoiSearchResult {
  id: string
  name: string
  city?: string
  country?: string
  coordinates?: { latitude: number; longitude: number }
}

export interface RouteEditorModalProps {
  routeId?: string          // undefined = criar nova rota
  isOpen: boolean
  onClose: () => void
  onSaved: (routeId: string) => void
  onDeleted?: (routeId: string) => void
}

type RouteTab = 'route' | 'experience' | 'content' | 'languages'

// ─── Inner component (mounted after Google Maps loads) ──────────────────────

function RouteEditorModalInner({
  routeId, onClose, onSaved, onDeleted,
}: Omit<RouteEditorModalProps, 'isOpen'>) {
  const t       = useTranslations('CustomRoutes.editor')
  const commonT = useTranslations('Common')
  const { canEdit, isViewer } = useCmsUser()
  const locale    = useLocale()
  const isEditing = Boolean(routeId)

  // ── Tab state ──────────────────────────────────────────────────────────────
  // Sempre começa na Rota — o mapa é o ponto de partida
  const [activeTab, setActiveTab] = useState<RouteTab>('route')

  // ── Content language (for name + description fields) ───────────────────────
  // Default = CMS locale. Persisted in route metadata.content_language.
  const [contentLanguage, setContentLanguage] = useState<string>(() => localeToLangCode(locale))

  // ── Route data state ───────────────────────────────────────────────────────
  const [initialData, setInitialData] = useState<any>(null)
  const [isLoadingRoute, setIsLoadingRoute] = useState(false)

  // ── Form state ─────────────────────────────────────────────────────────────
  const [name,        setName]        = useState('')
  const [description, setDescription] = useState('')
  const [clientId,    setClientId]    = useState('')
  const [country,     setCountry]     = useState('')
  const [region,      setRegion]      = useState('')
  const [isSaving,    setIsSaving]    = useState(false)

  // ── Route geometry state ───────────────────────────────────────────────────
  const [waypoints,      setWaypoints]      = useState<Waypoint[]>([])
  const [snapToRoads,    setSnapToRoads]    = useState(true)
  const [routeGeometry,  setRouteGeometry]  = useState<LatLng[]>([])
  const [distance,       setDistance]       = useState<number | null>(null)
  const [duration,       setDuration]       = useState<number | null>(null)
  const [isGenerating,   setIsGenerating]   = useState(false)
  const [isActive,       setIsActive]       = useState(true)

  // ── Characteristics state ──────────────────────────────────────────────────
  const [accessibility,   setAccessibility]   = useState('unknown')
  const [drivability,     setDrivability]     = useState('unknown')
  const [scenicProfile,   setScenicProfile]   = useState<string[]>([])
  const [bestTime,        setBestTime]        = useState<string[]>([])
  const [roadConditions,  setRoadConditions]  = useState<string[]>([])
  const [photogenicRating, setPhotogenicRating] = useState('unknown')

  // ── Waypoint UI state ──────────────────────────────────────────────────────
  const [expandedWaypointId, setExpandedWaypointId] = useState<string | null>(null)

  // ── POI search state ───────────────────────────────────────────────────────
  const [poiSearchQuery,   setPoiSearchQuery]   = useState('')
  const [poiSearchResults, setPoiSearchResults] = useState<PoiSearchResult[]>([])
  const [isSearchingPoi,   setIsSearchingPoi]   = useState(false)
  const [showPoiSearch,    setShowPoiSearch]    = useState(false)
  const poiSearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Tuggi POI layer state ──────────────────────────────────────────────────
  const [tuggiPOIs,      setTuggiPOIs]      = useState<any[]>([])
  const [showTuggiPOIs,  setShowTuggiPOIs]  = useState(true)
  const [isLoadingPOIs,  setIsLoadingPOIs]  = useState(false)
  const tuggiMarkersRef      = useRef<google.maps.Marker[]>([])
  const tuggiClustererRef    = useRef<any | null>(null)
  const viewportFetchTimer   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fetchViewportPOIsRef = useRef<() => void>(() => {})

  // ── Linked POI coords ──────────────────────────────────────────────────────
  const [linkedPOICoords, setLinkedPOICoords] = useState<Record<string, { lat: number; lng: number; name: string; country?: string | null; city?: string | null }>>({})
  const linkedPOIMarkersRef = useRef<google.maps.Marker[]>([])

  // ── Map refs ───────────────────────────────────────────────────────────────
  const mapRef         = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<google.maps.Map | null>(null)
  const polylineRef    = useRef<google.maps.Polyline | null>(null)
  const markersRef     = useRef<google.maps.Marker[]>([])

  // ── Animation state ────────────────────────────────────────────────────────
  const [animateClosing, setAnimateClosing] = useState(false)

  const stopsCount = waypoints.length

  // ── Load route data ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!routeId) return
    setIsLoadingRoute(true)
    fetch(`/api/routes/${routeId}`)
      .then(r => r.json())
      .then(data => {
        const route = data.route
        if (!route) return
        setInitialData(route)
        setName(route.name || '')
        setDescription(route.description || '')
        setClientId(route.client_id || '')
        setCountry(route.country || '')
        setRegion(route.region || '')
        setContentLanguage(route.metadata?.content_language || localeToLangCode(locale))
        setWaypoints(route.waypoints || [])
        setSnapToRoads(route.metadata?.source === 'osrm' || true)
        setRouteGeometry(route.geometry_coords || [])
        setDistance(route.metadata?.distance || null)
        setDuration(route.metadata?.duration || null)
        setIsActive(route.is_active ?? true)
        setAccessibility(route.accessibility || 'unknown')
        setDrivability(route.drivability || 'unknown')
        setScenicProfile(route.scenic_profile || [])
        setBestTime(route.best_time || [])
        setRoadConditions(route.road_conditions || [])
        setPhotogenicRating(route.photogenic_rating || 'unknown')
      })
      .catch(err => console.error('Error loading route:', err))
      .finally(() => setIsLoadingRoute(false))
  }, [routeId])

  // ── Close with animation ───────────────────────────────────────────────────
  const handleClose = () => {
    setAnimateClosing(true)
    setTimeout(onClose, 200)
  }

  // ── Initialize Map ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (activeTab !== 'route') return
    if (mapRef.current && !mapInstanceRef.current && window.google) {
      let savedCenter = { lat: -23.5505, lng: -46.6333 }
      try {
        const stored = localStorage.getItem('tuggi:last-map-center')
        if (stored) savedCenter = JSON.parse(stored)
      } catch { /* ignore */ }

      const initialCenter = waypoints.length > 0
        ? { lat: waypoints[0].lat, lng: waypoints[0].lng }
        : savedCenter

      const map = new google.maps.Map(mapRef.current, {
        center: initialCenter,
        zoom: waypoints.length > 0 ? 12 : 10,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_CENTER },
        styles: [
          { featureType: 'poi', stylers: [{ visibility: 'off' }] },
          { featureType: 'poi.park', elementType: 'geometry', stylers: [{ visibility: 'on' }] },
          { featureType: 'transit.station', elementType: 'labels', stylers: [{ visibility: 'off' }] },
        ],
      })

      map.addListener('click', (e: google.maps.MapMouseEvent) => {
        if (e.latLng) {
          setWaypoints(prev => [...prev, {
            id: Math.random().toString(36).substr(2, 9),
            lat: e.latLng!.lat(),
            lng: e.latLng!.lng(),
            metadata: { wheelchair_access: 'unknown', parking: 'unknown', restrooms: 'unknown', rest_areas: 'unknown', photogenic_rating: 'unknown' },
          }])
        }
      })

      map.addListener('idle', () => {
        if (viewportFetchTimer.current) clearTimeout(viewportFetchTimer.current)
        viewportFetchTimer.current = setTimeout(() => {
          fetchViewportPOIsRef.current()
        }, 700)
      })

      mapInstanceRef.current = map
    }
  }, [activeTab, waypoints])

  // ── Generate route geometry ────────────────────────────────────────────────
  useEffect(() => {
    async function generate() {
      if (waypoints.length < 2) {
        setRouteGeometry([])
        setDistance(null)
        setDuration(null)
        return
      }
      try {
        setIsGenerating(true)
        const res = await fetch('/api/routes/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ waypoints, mode: snapToRoads ? 'route' : 'manual' }),
        })
        if (res.ok) {
          const data = await res.json()
          setRouteGeometry(data.coordinates)
          setDistance(data.distance)
          setDuration(data.duration)
        } else {
          setRouteGeometry(waypoints.map(w => ({ lat: w.lat, lng: w.lng })))
        }
      } catch { /* ignore */ } finally {
        setIsGenerating(false)
      }
    }
    const t = setTimeout(generate, 500)
    return () => clearTimeout(t)
  }, [waypoints, snapToRoads])

  // ── Update map markers & polyline ──────────────────────────────────────────
  useEffect(() => {
    if (!mapInstanceRef.current) return

    markersRef.current.forEach(m => m.setMap(null))
    markersRef.current = []

    waypoints.forEach((wp, index) => {
      const marker = new google.maps.Marker({
        position: wp,
        map: mapInstanceRef.current,
        label: { text: (index + 1).toString(), color: 'white', fontSize: '12px', fontWeight: 'bold' },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          fillColor: index === 0 ? '#10B981' : (index === waypoints.length - 1 ? '#EF4444' : '#3B82F6'),
          fillOpacity: 1,
          strokeColor: 'white',
          strokeWeight: 2,
          scale: 14,
        },
        draggable: true,
      })
      marker.addListener('dragend', (e: google.maps.MapMouseEvent) => {
        if (e.latLng) {
          setWaypoints(prev => {
            const next = [...prev]
            next[index] = { ...next[index], lat: e.latLng!.lat(), lng: e.latLng!.lng() }
            return next
          })
        }
      })
      markersRef.current.push(marker)
    })

    if (polylineRef.current) polylineRef.current.setMap(null)

    if (routeGeometry.length > 0) {
      polylineRef.current = new google.maps.Polyline({
        path: routeGeometry,
        geodesic: true,
        strokeColor: '#6366F1',
        strokeOpacity: 0,
        strokeWeight: 3,
        icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.7, scale: 3 }, offset: '0', repeat: '12px' }],
        map: mapInstanceRef.current,
      })
    } else if (waypoints.length > 1 && !isGenerating) {
      polylineRef.current = new google.maps.Polyline({
        path: waypoints,
        geodesic: true,
        strokeColor: '#9CA3AF',
        strokeOpacity: 0.4,
        strokeWeight: 2,
        map: mapInstanceRef.current,
      })
    }
  }, [waypoints, routeGeometry, isGenerating])

  // ── Tuggi POI marker helpers ───────────────────────────────────────────────
  const clearTuggiMarkers = useCallback(() => {
    if (tuggiClustererRef.current) {
      tuggiClustererRef.current.clearMarkers?.()
      tuggiClustererRef.current.setMap?.(null)
      tuggiClustererRef.current = null
    }
    tuggiMarkersRef.current.forEach(m => m.setMap(null))
    tuggiMarkersRef.current = []
  }, [])

  const createTuggiPOIIcon = useCallback((name: string) => {
    const truncated = name.length > 24 ? name.slice(0, 24) + '…' : name
    const textWidth = Math.round(truncated.length * 5.5)
    const pillW = textWidth + 14
    const totalW = 14 + pillW
    const H = 20
    const safe = truncated.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${H}">
      <circle cx="7" cy="10" r="5" fill="#FF6B35" stroke="white" stroke-width="1.5"/>
      <rect x="14" y="3" width="${pillW}" height="13" rx="6" fill="rgba(255,255,255,0.93)" stroke="#e5e7eb" stroke-width="0.5"/>
      <text x="21" y="13" font-family="-apple-system,system-ui,Arial,sans-serif" font-size="9" font-weight="500" fill="#111827">${safe}</text>
    </svg>`
    return {
      url: `data:image/svg+xml,${encodeURIComponent(svg)}`,
      scaledSize: new google.maps.Size(totalW, H),
      anchor: new google.maps.Point(7, 10),
    }
  }, [])

  const renderTuggiMarkers = useCallback(async (pois: any[], visible: boolean) => {
    clearTuggiMarkers()
    if (!mapInstanceRef.current || !visible || pois.length === 0) return

    const getLat = (p: any): number | null => p.latitude ?? p.coordinates?.latitude ?? null
    const getLng = (p: any): number | null => p.longitude ?? p.coordinates?.longitude ?? null
    const validPOIs = pois.filter(p => getLat(p) !== null && getLng(p) !== null)
    const markers: google.maps.Marker[] = validPOIs.map(poi =>
      new google.maps.Marker({
        position: { lat: getLat(poi)!, lng: getLng(poi)! },
        title: poi.name,
        icon: createTuggiPOIIcon(poi.name ?? ''),
        zIndex: 5,
      })
    )
    tuggiMarkersRef.current = markers

    try {
      const { MarkerClusterer } = await import('@googlemaps/markerclusterer')
      const renderer = {
        render: ({ count, position }: { count: number; position: google.maps.LatLng }) =>
          new google.maps.Marker({
            position,
            label: { text: String(count), color: '#FFFFFF', fontSize: '11px', fontWeight: 'bold' },
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 12 + Math.min(count * 0.5, 8),
              fillColor: '#FF6B35',
              fillOpacity: 0.9,
              strokeColor: '#FFFFFF',
              strokeWeight: 2,
            },
            zIndex: Number(google.maps.Marker.MAX_ZINDEX) + count,
          }),
      }
      tuggiClustererRef.current = new MarkerClusterer({ map: mapInstanceRef.current, markers, renderer })
    } catch {
      markers.forEach(m => m.setMap(mapInstanceRef.current))
    }
  }, [clearTuggiMarkers, createTuggiPOIIcon])

  const fetchTuggiPOIsForViewport = useCallback(async () => {
    if (!mapInstanceRef.current) return
    const zoom = mapInstanceRef.current.getZoom() ?? 10
    if (zoom < 12) { clearTuggiMarkers(); setTuggiPOIs([]); return }

    const bounds = mapInstanceRef.current.getBounds()
    if (!bounds) return
    const ne = bounds.getNorthEast(), sw = bounds.getSouthWest()
    const dLat = ne.lat() - sw.lat(), dLng = ne.lng() - sw.lng()
    const M = 0.10
    const params = new URLSearchParams({
      min_lat: (sw.lat() + dLat * M).toFixed(6),
      min_lng: (sw.lng() + dLng * M).toFixed(6),
      max_lat: (ne.lat() - dLat * M).toFixed(6),
      max_lng: (ne.lng() - dLng * M).toFixed(6),
    })

    setIsLoadingPOIs(true)
    try {
      const res = await fetch(`/api/pois/map-bbox?${params}`)
      if (!res.ok) return
      const data = await res.json()
      const pois = data.pois ?? []
      setTuggiPOIs(pois)
      await renderTuggiMarkers(pois, showTuggiPOIs)
    } catch { /* silently fail */ } finally {
      setIsLoadingPOIs(false)
    }
  }, [showTuggiPOIs, renderTuggiMarkers, clearTuggiMarkers])

  useEffect(() => { fetchViewportPOIsRef.current = fetchTuggiPOIsForViewport }, [fetchTuggiPOIsForViewport])

  // ── Linked POI markers — busca coordenadas + country dos POIs vinculados ────
  useEffect(() => {
    const ids = waypoints.map(w => w.metadata?.attraction_id).filter(Boolean) as string[]
    if (ids.length === 0) { setLinkedPOICoords({}); return }

    fetch(`/api/attractions/coordinates?ids=${ids.join(',')}`)
      .then(r => r.json())
      .then(data => {
        const map: Record<string, { lat: number; lng: number; name: string; country?: string | null; city?: string | null }> = {}
        ;(data.coords ?? []).forEach((c: any) => {
          map[c.id] = { lat: c.latitude, lng: c.longitude, name: c.name, country: c.country, city: c.city }
        })
        setLinkedPOICoords(map)

        // Auto-popular país da rota a partir do primeiro POI vinculado que tenha country
        // Só preenche se o campo ainda estiver vazio (não sobrescreve o que o admin setou)
        setCountry(prev => {
          if (prev) return prev // já tem — não sobrescreve
          const firstWithCountry = (data.coords ?? []).find((c: any) => c.country)
          return firstWithCountry?.country ?? prev
        })

        // Auto-popular região a partir da city do primeiro POI (se não tiver região ainda)
        setRegion(prev => {
          if (prev) return prev
          const firstWithCity = (data.coords ?? []).find((c: any) => c.city)
          return firstWithCity?.city ?? prev
        })
      })
      .catch(() => {})
  }, [waypoints])

  useEffect(() => {
    linkedPOIMarkersRef.current.forEach(m => m.setMap(null))
    linkedPOIMarkersRef.current = []
    if (!mapInstanceRef.current || Object.keys(linkedPOICoords).length === 0) return
    linkedPOIMarkersRef.current = Object.entries(linkedPOICoords).map(([, poi]) =>
      new google.maps.Marker({
        position: { lat: poi.lat, lng: poi.lng },
        map: mapInstanceRef.current,
        title: poi.name,
        icon: createTuggiPOIIcon(poi.name),
        zIndex: 25,
      })
    )
  }, [linkedPOICoords, createTuggiPOIIcon])

  // Cleanup on unmount
  useEffect(() => () => { linkedPOIMarkersRef.current.forEach(m => m.setMap(null)) }, [])
  useEffect(() => () => {
    clearTuggiMarkers()
    if (viewportFetchTimer.current) clearTimeout(viewportFetchTimer.current)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleTuggiPOIs = useCallback(async () => {
    const next = !showTuggiPOIs
    setShowTuggiPOIs(next)
    if (next) await fetchTuggiPOIsForViewport()
    else clearTuggiMarkers()
  }, [showTuggiPOIs, fetchTuggiPOIsForViewport, clearTuggiMarkers])

  // ── POI search ─────────────────────────────────────────────────────────────
  const handlePoiSearch = (query: string) => {
    setPoiSearchQuery(query)
    if (poiSearchTimeoutRef.current) clearTimeout(poiSearchTimeoutRef.current)
    if (!query.trim() || query.length < 2) { setPoiSearchResults([]); return }
    poiSearchTimeoutRef.current = setTimeout(async () => {
      setIsSearchingPoi(true)
      try {
        const res = await fetch(`/api/pois/search?${new URLSearchParams({ search: query, limit: '8' })}`)
        if (!res.ok) throw new Error('Search failed')
        const data = await res.json()
        setPoiSearchResults(data.pois || data.data || [])
      } catch { setPoiSearchResults([]) } finally { setIsSearchingPoi(false) }
    }, 300)
  }

  const addWaypointFromPoi = (poi: PoiSearchResult) => {
    if (!poi.coordinates) return
    setWaypoints(prev => [...prev, {
      id: Math.random().toString(36).substring(2, 9),
      lat: poi.coordinates!.latitude,
      lng: poi.coordinates!.longitude,
      metadata: { name: poi.name, attraction_id: poi.id, is_generic: false, wheelchair_access: 'unknown', parking: 'unknown', restrooms: 'unknown', rest_areas: 'unknown', photogenic_rating: 'unknown' },
    }])
    if (mapInstanceRef.current) {
      mapInstanceRef.current.panTo({ lat: poi.coordinates!.latitude, lng: poi.coordinates!.longitude })
      mapInstanceRef.current.setZoom(15)
    }
    try { localStorage.setItem('tuggi:last-map-center', JSON.stringify({ lat: poi.coordinates.latitude, lng: poi.coordinates.longitude })) } catch { /* ignore */ }
    setPoiSearchQuery('')
    setPoiSearchResults([])
    setShowPoiSearch(false)
  }

  const updateWaypointName = (id: string, name: string) => {
    setWaypoints(prev => prev.map(w => w.id === id ? { ...w, metadata: { ...w.metadata, name } } : w))
  }

  const removeWaypoint = (id: string) => {
    setWaypoints(prev => prev.filter(w => w.id !== id))
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!name.trim() || !country.trim() || !region.trim() || waypoints.length < 2) {
      // Navegue para a aba que tem o campo faltando
      if (!name.trim() || !country.trim() || !region.trim()) setActiveTab('content')
      else setActiveTab('route')
      return
    }
    try {
      setIsSaving(true)
      const url    = isEditing ? `/api/routes/${routeId}` : '/api/routes'
      const method = isEditing ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, description, client_id: clientId,
          waypoints, snap_to_roads: snapToRoads, is_active: isActive,
          accessibility, drivability, scenic_profile: scenicProfile,
          best_time: bestTime, road_conditions: roadConditions, photogenic_rating: photogenicRating,
          stops_count: stopsCount || waypoints.length,
          country: country || null, region: region || null,
          content_language: contentLanguage,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        onSaved(data.route?.id || routeId || '')
      } else {
        const err = await res.json()
        alert(`${t('save_error')}: ${err.error}`)
      }
    } catch { alert(t('save_error')) } finally { setIsSaving(false) }
  }

  // ── Format helpers ─────────────────────────────────────────────────────────
  const fmt = {
    distance: (m: number | null) => m === null ? '--' : m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(0)} m`,
    duration: (s: number | null) => {
      if (s === null) return '--'
      const mins = Math.round(s / 60)
      return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`
    },
  }

  // ── Tab definitions ─────────────────────────────────────────────────────────
  // Ordem segue a jornada: Criar rota → Descrever experiência → Nomear/descrever → Traduzir
  const contentLangMeta = CONTENT_LANGUAGES.find(l => l.code === contentLanguage)
  const tabs: { id: RouteTab; icon: any; label: string; badge?: string }[] = [
    { id: 'route',      icon: Navigation, label: 'Rota'        },
    { id: 'experience', icon: Camera,     label: 'Experiência' },
    { id: 'content',    icon: FileText,   label: 'Conteúdo',   badge: contentLangMeta?.flag },
    ...(isEditing ? [{ id: 'languages' as RouteTab, icon: Globe, label: 'Idiomas' }] : []),
  ]

  // ── Save validation ──────────────────────────────────────────────────────────
  // Campos obrigatórios para salvar: nome + país + região/cidade + ≥2 waypoints
  const missingFields: string[] = []
  if (!name.trim())    missingFields.push('Título')
  if (!country.trim()) missingFields.push('País')
  if (!region.trim())  missingFields.push('Região / Cidade')
  if (waypoints.length < 2) missingFields.push('Mínimo 2 pontos no mapa')
  const canSave = missingFields.length === 0 && !isSaving && !isGenerating && canEdit && !isViewer

  // ── Loading state ──────────────────────────────────────────────────────────
  if (isLoadingRoute) {
    return (
      <div className="fixed inset-0 z-[100] flex justify-end bg-black/50 backdrop-blur-sm">
        <div className="w-[85vw] bg-white dark:bg-gray-900 h-full flex items-center justify-center shadow-2xl">
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-4 border-tuggi-blue/20 border-t-tuggi-blue rounded-full animate-spin" />
            <p className="text-gray-400 font-bold animate-pulse">Carregando rota...</p>
          </div>
        </div>
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div
      className={cn(
        'fixed inset-0 z-[100] flex justify-end bg-black/50 backdrop-blur-sm transition-opacity duration-300',
        animateClosing ? 'opacity-0' : 'opacity-100'
      )}
      onClick={handleClose}
    >
      <div
        className={cn(
          'w-[85vw] bg-white dark:bg-gray-900 h-full flex flex-col shadow-2xl',
          animateClosing
            ? 'animate-out slide-out-to-right ease-in duration-200'
            : 'animate-in slide-in-from-right duration-300'
        )}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="h-16 flex items-center justify-between px-6 border-b border-gray-100 dark:border-gray-800 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-tuggi-blue/10 rounded-xl shrink-0">
              {isEditing
                ? <Edit className="h-5 w-5 text-tuggi-blue" />
                : <Plus className="h-5 w-5 text-tuggi-blue" />
              }
            </div>
            <div className="min-w-0">
              <h2 className="font-bold text-gray-900 dark:text-white truncate text-base leading-tight">
                {name || (isEditing ? t('edit_title') : t('create_title'))}
              </h2>
              {(stopsCount > 0 || distance) && (
                <p className="text-[10px] text-gray-400 font-medium truncate">
                  {stopsCount} parada{stopsCount !== 1 ? 's' : ''}
                  {distance ? ` · ${fmt.distance(distance)}` : ''}
                  {duration ? ` · ${fmt.duration(duration)}` : ''}
                  {country ? ` · ${region || country}` : ''}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {/* Status toggle — igual ao POI management */}
            <button
              onClick={() => setIsActive(v => !v)}
              disabled={!canEdit || isViewer}
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border',
                isActive
                  ? 'bg-green-50 border-green-200 text-green-700 dark:bg-green-900/30 dark:border-green-800 dark:text-green-400 hover:bg-green-100'
                  : 'bg-gray-50 border-gray-200 text-gray-500 dark:bg-gray-800 dark:border-gray-700 hover:bg-gray-100'
              )}
            >
              <div className={cn(
                'w-7 h-4 rounded-full relative transition-all duration-300',
                isActive ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
              )}>
                <div className={cn(
                  'absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-all duration-300 shadow-sm',
                  isActive ? 'translate-x-3' : 'translate-x-0'
                )} />
              </div>
              {isActive ? 'Ativa' : 'Inativa'}
            </button>
            <button
              onClick={handleClose}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-all text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* ── Main flex row ────────────────────────────────────────────────── */}
        <div className="flex-1 flex overflow-hidden">

          {/* ── Left tab nav sidebar ───────────────────────────────────────── */}
          <aside className="w-72 bg-white dark:bg-gray-900 border-r border-gray-100/50 dark:border-gray-800 p-6 flex flex-col gap-2 z-20 shrink-0">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-3 mb-2">
              Configuração
            </p>

            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-3 px-4 py-3 rounded-2xl font-bold text-sm transition-all duration-300 text-left w-full',
                  activeTab === tab.id
                    ? 'bg-tuggi-blue text-white'
                    : 'text-gray-500 dark:text-gray-400 hover:text-tuggi-blue hover:bg-tuggi-blue/5'
                )}
              >
                <tab.icon className={cn('h-5 w-5 shrink-0', activeTab === tab.id && 'animate-pulse')} />
                <span className="flex-1">{tab.label}</span>
                {tab.badge && (
                  <span className="text-base leading-none">{tab.badge}</span>
                )}
              </button>
            ))}

            {/* Divider */}
            <div className="my-2 border-t border-gray-100 dark:border-gray-800" />

            {/* Stats + Save — bottom of sidebar */}
            <div className="mt-auto space-y-3">
              {/* Stats */}
              {(stopsCount > 0 || distance || isGenerating) && (
                <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-2xl space-y-2">
                  {stopsCount > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-400 flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5" /> Paradas
                      </span>
                      <span className="font-bold text-gray-700 dark:text-gray-300">{stopsCount}</span>
                    </div>
                  )}
                  {(distance || isGenerating) && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-400 flex items-center gap-1.5">
                        <Activity className="h-3.5 w-3.5" /> Distância
                      </span>
                      <span className="font-bold text-gray-700 dark:text-gray-300 font-mono">
                        {isGenerating ? <RefreshCw className="h-3.5 w-3.5 animate-spin inline" /> : fmt.distance(distance)}
                      </span>
                    </div>
                  )}
                  {(duration || isGenerating) && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-400 flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5" /> Duração
                      </span>
                      <span className="font-bold text-gray-700 dark:text-gray-300 font-mono">
                        {isGenerating ? '…' : fmt.duration(duration)}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Missing fields warning */}
              {missingFields.length > 0 && (
                <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800/30">
                  <p className="text-[10px] text-amber-700 dark:text-amber-400 font-semibold mb-1">Para salvar, preencha:</p>
                  <ul className="space-y-0.5">
                    {missingFields.map(f => (
                      <li key={f} className="text-[10px] text-amber-600 dark:text-amber-500 flex items-center gap-1">
                        <span className="w-1 h-1 bg-amber-400 rounded-full shrink-0" /> {f}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Save button */}
              <button
                onClick={handleSave}
                disabled={!canSave}
                className="w-full py-3.5 bg-tuggi-blue text-white font-bold rounded-2xl hover:bg-tuggi-blue/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-xl shadow-tuggi-blue/20 active:scale-[0.98] flex items-center justify-center gap-2 text-sm"
              >
                {isSaving ? <RefreshCw className="h-4.5 w-4.5 animate-spin" /> : <Save className="h-4 w-4" />}
                {commonT('actions.save')}
              </button>
            </div>
          </aside>

          {/* ── Right content area ─────────────────────────────────────────── */}
          <main className="flex-1 bg-white dark:bg-gray-900 overflow-hidden flex flex-col">

            {/* ══ TAB: ROTA — split view (form + map) ══ */}
            {activeTab === 'route' && (
              <div className="flex h-full overflow-hidden">

                {/* Form panel */}
                <div className="w-[420px] flex flex-col border-r border-gray-100 dark:border-gray-800 shrink-0">
                  <div className="flex-1 overflow-y-auto custom-scrollbar">
                    <div className="p-6 space-y-6">

                      {/* Concept banner */}
                      <div className="flex items-start gap-3 p-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800/30 rounded-2xl">
                        <MapPin className="h-4 w-4 text-indigo-500 shrink-0 mt-0.5" />
                        <p className="text-[11px] text-indigo-700 dark:text-indigo-300 leading-relaxed font-medium">
                          Defina os <strong>pontos de interesse</strong>. O traçado é uma <strong>prévia</strong> — o app usa Google Maps ou Apple Maps.
                        </p>
                      </div>

                      {/* Snap to roads — toggle compacto */}
                      <div
                        className={cn(
                          'flex items-center justify-between px-4 py-3 rounded-xl cursor-pointer select-none transition-all border',
                          snapToRoads
                            ? 'bg-blue-50/60 dark:bg-blue-900/10 border-blue-100 dark:border-blue-900/30'
                            : 'bg-gray-50 dark:bg-gray-800 border-transparent hover:border-gray-200'
                        )}
                        onClick={() => setSnapToRoads(v => !v)}
                      >
                        <div className="flex items-center gap-2.5">
                          {snapToRoads
                            ? <Route className="h-4 w-4 text-tuggi-blue" />
                            : <PenTool className="h-4 w-4 text-gray-400" />
                          }
                          <div>
                            <p className="text-xs font-bold text-gray-800 dark:text-white">{t('snap_to_roads')}</p>
                            <p className="text-[10px] text-gray-400">{snapToRoads ? 'Seguir vias' : 'Linhas retas'}</p>
                          </div>
                        </div>
                        <div className={cn('w-9 h-5 rounded-full relative transition-all duration-300', snapToRoads ? 'bg-tuggi-blue' : 'bg-gray-300 dark:bg-gray-600')}>
                          <div className={cn('absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-all duration-300 shadow-sm', snapToRoads ? 'translate-x-4' : 'translate-x-0')} />
                        </div>
                      </div>

                      {/* Waypoints */}
                      <section className="space-y-4 pt-2 border-t border-gray-100 dark:border-gray-800">
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                            <Navigation className="h-4 w-4" />
                            Pontos de Passagem
                          </h3>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold px-2 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-500 rounded-full">
                              {waypoints.length}
                            </span>
                            <button
                              type="button"
                              onClick={() => setShowPoiSearch(v => !v)}
                              className={cn(
                                'p-1.5 rounded-lg transition-all text-xs font-semibold flex items-center gap-1',
                                showPoiSearch ? 'bg-tuggi-blue text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'
                              )}
                            >
                              <Plus className="h-3.5 w-3.5" /> Buscar POI
                            </button>
                          </div>
                        </div>

                        {/* POI search */}
                        {showPoiSearch && (
                          <div className="relative">
                            <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl">
                              <MapPin className="h-4 w-4 text-gray-400 shrink-0" />
                              <input
                                type="text"
                                autoFocus
                                value={poiSearchQuery}
                                onChange={e => handlePoiSearch(e.target.value)}
                                placeholder="Buscar local no banco..."
                                className="flex-1 text-xs bg-transparent outline-none text-gray-700 dark:text-gray-300 placeholder:text-gray-400"
                              />
                              {isSearchingPoi && <RefreshCw className="h-3.5 w-3.5 text-gray-400 animate-spin shrink-0" />}
                              {poiSearchQuery && !isSearchingPoi && (
                                <button onClick={() => { setPoiSearchQuery(''); setPoiSearchResults([]) }}>
                                  <X className="h-3.5 w-3.5 text-gray-400" />
                                </button>
                              )}
                            </div>
                            {poiSearchResults.length > 0 && (
                              <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg overflow-hidden">
                                {poiSearchResults.map(poi => (
                                  <button
                                    key={poi.id}
                                    type="button"
                                    onClick={() => addWaypointFromPoi(poi)}
                                    disabled={!poi.coordinates}
                                    className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all text-left disabled:opacity-40"
                                  >
                                    <MapPin className="h-3.5 w-3.5 text-tuggi-blue shrink-0" />
                                    <div className="flex-1 min-w-0">
                                      <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">{poi.name}</p>
                                      {(poi.city || poi.country) && (
                                        <p className="text-[10px] text-gray-400 truncate">{[poi.city, poi.country].filter(Boolean).join(', ')}</p>
                                      )}
                                    </div>
                                    {!poi.coordinates && <span className="text-[10px] text-orange-400 shrink-0">sem coords</span>}
                                  </button>
                                ))}
                              </div>
                            )}
                            {poiSearchQuery.length >= 2 && !isSearchingPoi && poiSearchResults.length === 0 && (
                              <p className="text-[10px] text-gray-400 text-center mt-2">
                                Nenhum POI encontrado. Clique no mapa para adicionar manualmente.
                              </p>
                            )}
                          </div>
                        )}

                        {/* Waypoint list */}
                        <div className="space-y-2 max-h-72 overflow-y-auto pr-1 custom-scrollbar">
                          {waypoints.map((wp, index) => {
                            const isExpanded = expandedWaypointId === wp.id
                            const isStartOrEnd = index === 0 || index === waypoints.length - 1
                            const pointLabel = index === 0 ? 'Início' : (index === waypoints.length - 1 ? 'Fim' : `Ponto ${index}`)
                            return (
                              <div key={wp.id} className="group">
                                <div
                                  className={cn(
                                    'flex items-center gap-3 p-3 rounded-xl transition-all border cursor-pointer',
                                    isExpanded
                                      ? 'bg-tuggi-blue/5 border-tuggi-blue/30'
                                      : 'bg-gray-50 dark:bg-gray-800 border-transparent hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:border-gray-200'
                                  )}
                                  onClick={() => setExpandedWaypointId(isExpanded ? null : wp.id)}
                                >
                                  <div className={cn(
                                    'w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0',
                                    index === 0 ? 'bg-green-500' : (index === waypoints.length - 1 ? 'bg-red-500' : 'bg-blue-500')
                                  )}>{index + 1}</div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      {wp.metadata?.attraction_id
                                        ? <Link2 className="h-3 w-3 text-green-500 shrink-0" />
                                        : <span className="h-3 w-3 shrink-0" />
                                      }
                                      <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
                                        {wp.metadata?.name || pointLabel}
                                      </p>
                                    </div>
                                    <p className="text-[10px] text-gray-400 truncate pl-4">
                                      {pointLabel}
                                      {!wp.metadata?.name && (
                                        <span className="font-mono ml-1 opacity-60">{wp.lat.toFixed(4)}, {wp.lng.toFixed(4)}</span>
                                      )}
                                    </p>
                                  </div>
                                  {!isStartOrEnd && (
                                    <button
                                      onClick={e => { e.stopPropagation(); removeWaypoint(wp.id) }}
                                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                                    >
                                      <X className="h-4 w-4" />
                                    </button>
                                  )}
                                  <ChevronDown className={cn('h-4 w-4 text-gray-400 transition-transform', isExpanded && 'rotate-180')} />
                                </div>

                                {/* Expanded metadata */}
                                {isExpanded && (
                                  <div className="mt-2 ml-9 p-4 bg-white dark:bg-gray-800/80 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm space-y-4">
                                    <div>
                                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] mb-1.5">Nome do Local</label>
                                      <input
                                        type="text"
                                        value={wp.metadata?.name || ''}
                                        onChange={e => updateWaypointName(wp.id, e.target.value)}
                                        onClick={e => e.stopPropagation()}
                                        placeholder="Ex: Castelo de São Jorge"
                                        className="w-full px-3 py-2 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-1 focus:ring-tuggi-blue outline-none transition-all placeholder:text-gray-400"
                                      />
                                      {wp.metadata?.attraction_id ? (
                                        <div className="mt-2 flex items-start justify-between gap-2 p-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/30 rounded-xl">
                                          <div className="flex items-start gap-1.5 min-w-0">
                                            <Link2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" />
                                            <div className="min-w-0">
                                              <p className="text-[10px] font-bold text-green-700 dark:text-green-400">POI vinculado</p>
                                              {linkedPOICoords[wp.metadata.attraction_id] && (
                                                <p className="text-[10px] text-green-600 dark:text-green-500 truncate">{linkedPOICoords[wp.metadata.attraction_id].name}</p>
                                              )}
                                              <p className="text-[10px] text-green-500/70 font-mono mt-0.5">{wp.metadata.attraction_id.slice(0, 8)}…</p>
                                            </div>
                                          </div>
                                          <a href={`/pois?poiId=${wp.metadata.attraction_id}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="p-1 rounded-lg hover:bg-green-100 dark:hover:bg-green-800/30 transition-colors shrink-0">
                                            <ExternalLink className="h-3 w-3 text-green-500" />
                                          </a>
                                        </div>
                                      ) : (
                                        <p className="text-[10px] text-gray-400 mt-1 flex items-center gap-1">
                                          <span className="w-3 h-3 rounded-full bg-gray-300 inline-block shrink-0" />
                                          Ponto genérico — não vinculado a POI
                                        </p>
                                      )}
                                    </div>

                                    {/* Waypoint resources (compact) */}
                                    {[
                                      { key: 'wheelchair_access', label: 'Cadeirante', icon: Accessibility, opts: ['yes', 'partial', 'no', 'unknown'], labels: ['Sim', 'Parcial', 'Não', 'N/I'] },
                                      { key: 'parking',           label: 'Estacionamento', icon: ParkingCircle, opts: ['yes', 'no', 'unknown'], labels: ['Sim', 'Não', 'N/I'] },
                                      { key: 'restrooms',         label: 'Banheiros',      icon: Building2,     opts: ['yes', 'no', 'unknown'], labels: ['Sim', 'Não', 'N/I'] },
                                      { key: 'rest_areas',        label: 'Descanso',       icon: Trees,         opts: ['yes', 'no', 'unknown'], labels: ['Sim', 'Não', 'N/I'] },
                                      { key: 'photogenic_rating', label: 'Fotogênica',     icon: Camera,        opts: ['low', 'medium', 'high', 'unknown'], labels: ['Baixa', 'Média', 'Alta', 'N/I'] },
                                    ].map(({ key, label, icon: Icon, opts, labels }) => (
                                      <div key={key} className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                          <Icon className="h-4 w-4 text-tuggi-blue" />
                                          <span className="text-xs font-bold text-gray-700 dark:text-gray-300">{label}</span>
                                        </div>
                                        <div className="flex gap-1 p-1 bg-gray-50 dark:bg-gray-900 rounded-xl">
                                          {opts.map((val, i) => (
                                            <button
                                              key={val}
                                              type="button"
                                              onClick={e => {
                                                e.stopPropagation()
                                                setWaypoints(prev => prev.map(w =>
                                                  w.id === wp.id ? { ...w, metadata: { ...w.metadata, [key]: val } } : w
                                                ))
                                              }}
                                              className={cn(
                                                'px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all',
                                                (wp.metadata as any)?.[key] === val
                                                  ? 'bg-white dark:bg-gray-800 text-tuggi-blue shadow-sm ring-1 ring-black/5'
                                                  : 'text-gray-400 hover:text-gray-600'
                                              )}
                                            >
                                              {labels[i]}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                          {waypoints.length === 0 && (
                            <div className="text-center py-8 border-2 border-dashed border-gray-100 dark:border-gray-800 rounded-2xl">
                              <p className="text-xs text-gray-400 px-4">Clique no mapa para adicionar pontos</p>
                            </div>
                          )}
                        </div>

                        <button
                          onClick={() => setWaypoints([])}
                          disabled={waypoints.length === 0}
                          className="w-full py-2 text-xs font-semibold text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10 rounded-xl transition-all disabled:opacity-30 flex items-center justify-center gap-2"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> {t('clear_points')}
                        </button>
                      </section>
                    </div>
                  </div>

                  {/* (stats + save moved to sidebar) */}
                </div>

                {/* Map panel */}
                <div className="flex-1 relative bg-gray-100 dark:bg-gray-950">
                  <div ref={mapRef} className="w-full h-full" />

                  {waypoints.length === 0 && (
                    <div className="absolute top-8 left-1/2 -translate-x-1/2 px-8 py-4 bg-white/90 dark:bg-gray-900/90 backdrop-blur-md rounded-3xl shadow-2xl border border-white dark:border-gray-800 flex items-center gap-4 animate-bounce pointer-events-none">
                      <div className="w-10 h-10 bg-tuggi-blue rounded-full flex items-center justify-center text-white shadow-lg">
                        <Plus className="h-6 w-6" />
                      </div>
                      <div>
                        <p className="font-bold text-gray-900 dark:text-white uppercase tracking-tighter">Comece aqui</p>
                        <p className="text-xs text-gray-500 font-medium">Clique no mapa para definir o ponto de partida</p>
                      </div>
                    </div>
                  )}

                  {/* Toggle Tuggi POIs */}
                  <div className="absolute bottom-6 left-6 z-10">
                    <button
                      onClick={toggleTuggiPOIs}
                      className={cn(
                        'flex items-center gap-2 px-3 py-2 rounded-2xl shadow-lg text-xs font-semibold transition-all border',
                        showTuggiPOIs
                          ? 'bg-orange-500 text-white border-orange-400 hover:bg-orange-600'
                          : 'bg-white dark:bg-gray-900 text-gray-600 border-gray-200 dark:border-gray-700 hover:border-gray-300'
                      )}
                    >
                      <MapPin className="h-3.5 w-3.5" />
                      {isLoadingPOIs
                        ? <><RefreshCw className="h-3 w-3 animate-spin" /> Buscando...</>
                        : showTuggiPOIs && tuggiPOIs.length > 0
                          ? `${tuggiPOIs.length} POIs Tuggi`
                          : 'POIs Tuggi'
                      }
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ══ TAB: CONTEÚDO — título, descrição e idioma base ══ */}
            {activeTab === 'content' && (
              <div className="overflow-y-auto custom-scrollbar h-full">
                <div className="p-8 max-w-2xl mx-auto space-y-8">

                  {/* Language selector — must choose before writing */}
                  <section className="space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-tuggi-blue/10 rounded-xl">
                        <Languages className="h-5 w-5 text-tuggi-blue" />
                      </div>
                      <div>
                        <h3 className="font-bold text-gray-900 dark:text-white text-sm">Idioma do conteúdo</h3>
                        <p className="text-[11px] text-gray-400">Em qual idioma você está escrevendo o título e a descrição?</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      {CONTENT_LANGUAGES.map(lang => (
                        <button
                          key={lang.code}
                          type="button"
                          onClick={() => setContentLanguage(lang.code)}
                          className={cn(
                            'flex items-center gap-2.5 px-3 py-2.5 rounded-xl border-2 transition-all text-left',
                            contentLanguage === lang.code
                              ? 'bg-tuggi-blue/5 border-tuggi-blue text-gray-900 dark:text-white'
                              : 'bg-gray-50 dark:bg-gray-800 border-transparent hover:border-gray-200 dark:hover:border-gray-700 text-gray-600 dark:text-gray-400'
                          )}
                        >
                          <span className="text-lg leading-none">{lang.flag}</span>
                          <span className="text-xs font-semibold leading-tight">{lang.label}</span>
                          {contentLanguage === lang.code && (
                            <CheckCircle className="h-3.5 w-3.5 text-tuggi-blue ml-auto shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>

                    {/* Info: this is the "base" language — translations go in Idiomas tab */}
                    <div className="flex items-start gap-2.5 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/30 rounded-xl">
                      <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                      <p className="text-[11px] text-amber-700 dark:text-amber-400 leading-relaxed">
                        Este é o <strong>conteúdo base</strong> da rota. Para gerar versões em outros idiomas, use a aba <strong>Idiomas</strong> (disponível após salvar).
                      </p>
                    </div>
                  </section>

                  {/* Title and description — unlocked after language is confirmed */}
                  <section className="space-y-5">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                        <FileText className="h-4 w-4" /> Texto da Rota
                      </h3>
                      <span className="flex items-center gap-1 text-[10px] font-bold text-tuggi-blue bg-tuggi-blue/10 px-2.5 py-1 rounded-full">
                        {CONTENT_LANGUAGES.find(l => l.code === contentLanguage)?.flag}{' '}
                        {CONTENT_LANGUAGES.find(l => l.code === contentLanguage)?.label}
                      </span>
                    </div>

                    <div className="space-y-5">
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                          {t('name')} <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={name}
                          onChange={e => setName(e.target.value)}
                          className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border-none rounded-xl focus:ring-2 focus:ring-tuggi-blue transition-all text-sm font-medium"
                          placeholder="Ex: Grand Tour de Lisboa — De Oriente a Belém"
                        />
                        {!name && (
                          <p className="text-[10px] text-red-500 mt-1">O título é obrigatório para salvar a rota.</p>
                        )}
                      </div>

                      <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                          {t('description')}
                          <span className="text-gray-400 font-normal ml-1 text-xs">(opcional)</span>
                        </label>
                        <textarea
                          value={description}
                          onChange={e => setDescription(e.target.value)}
                          className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border-none rounded-xl focus:ring-2 focus:ring-tuggi-blue transition-all resize-none text-sm"
                          rows={5}
                          placeholder="Descreva a experiência da rota: pontos de destaque, duração estimada, melhor época para fazer..."
                        />
                        <p className="text-[10px] text-gray-400 mt-1">
                          {description.length} caracteres{description.length > 0 && description.length < 80 && ' · Recomendamos pelo menos 80 caracteres para uma boa descrição.'}
                        </p>
                      </div>
                    </div>
                  </section>

                  {/* Localização — obrigatório para filtros no app */}
                  <section className="space-y-4 pt-2 border-t border-gray-100 dark:border-gray-800">
                    <div>
                      <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2 mb-1">
                        <Globe className="h-4 w-4" /> Localização <span className="text-red-500">*</span>
                      </h3>
                      <p className="text-[11px] text-gray-400">Obrigatório para que a rota apareça nos filtros do app.</p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">
                          País <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={country}
                          onChange={e => setCountry(e.target.value)}
                          placeholder="Ex: Portugal"
                          className={cn(
                            'w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border rounded-xl focus:ring-2 focus:ring-tuggi-blue transition-all text-sm',
                            !country.trim() ? 'border-amber-300 dark:border-amber-700' : 'border-transparent'
                          )}
                        />
                        {!country.trim() && (
                          <p className="text-[10px] text-amber-600 mt-1">Campo obrigatório</p>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">
                          Região / Cidade <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={region}
                          onChange={e => setRegion(e.target.value)}
                          placeholder="Ex: Lisboa"
                          className={cn(
                            'w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border rounded-xl focus:ring-2 focus:ring-tuggi-blue transition-all text-sm',
                            !region.trim() ? 'border-amber-300 dark:border-amber-700' : 'border-transparent'
                          )}
                        />
                        {!region.trim() && (
                          <p className="text-[10px] text-amber-600 mt-1">Campo obrigatório</p>
                        )}
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            )}

            {/* ══ TAB: EXPERIÊNCIA ══ */}
            {activeTab === 'experience' && (
              <div className="overflow-y-auto custom-scrollbar h-full">
                <div className="p-8 space-y-8">

                  {/* A Experiência — Scenic, Best Time, Photogenic */}
                  <section className="space-y-5">
                    <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                      <Camera className="h-4 w-4" /> A Experiência
                    </h3>

                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-2">Perfil Cênico</label>
                      <div className="grid grid-cols-5 gap-2">
                        {[
                          { id: 'panoramic', label: 'Panorâmica', icon: Mountain },
                          { id: 'historical', label: 'Histórica',  icon: Building2 },
                          { id: 'nature',     label: 'Natureza',   icon: Trees },
                          { id: 'urban',      label: 'Urbana',     icon: Building2 },
                          { id: 'rural',      label: 'Rural',      icon: Wheat },
                        ].map(({ id, label, icon: Icon }) => (
                          <button key={id} type="button"
                            onClick={() => setScenicProfile(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])}
                            className={cn(
                              'flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all text-xs font-medium',
                              scenicProfile.includes(id) ? 'bg-tuggi-blue/10 border-tuggi-blue text-tuggi-blue' : 'bg-gray-50 dark:bg-gray-800 border-transparent hover:border-gray-200 text-gray-500'
                            )}
                          >
                            <Icon className="h-5 w-5" /> {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-2">Melhor Período</label>
                      <div className="grid grid-cols-4 gap-2">
                        {[
                          { id: 'morning',   label: 'Manhã',      icon: Sun },
                          { id: 'afternoon', label: 'Tarde',      icon: Sun },
                          { id: 'sunset',    label: 'Pôr do Sol', icon: Sunrise },
                          { id: 'night',     label: 'Noite',      icon: Moon },
                        ].map(({ id, label, icon: Icon }) => (
                          <button key={id} type="button"
                            onClick={() => setBestTime(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])}
                            className={cn(
                              'flex flex-col items-center gap-1 p-2 rounded-xl border-2 transition-all text-[10px] font-medium',
                              bestTime.includes(id) ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-300 text-orange-600' : 'bg-gray-50 dark:bg-gray-800 border-transparent hover:border-gray-200 text-gray-500'
                            )}
                          >
                            <Icon className="h-4 w-4" /> {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-2">Fotogênica</label>
                      <div className="grid grid-cols-4 gap-2">
                        {[{ id: 'low', label: 'Básica' }, { id: 'medium', label: 'Boa' }, { id: 'high', label: 'Incrível' }, { id: 'unknown', label: 'N/I' }].map(({ id, label }) => (
                          <button key={id} type="button" onClick={() => setPhotogenicRating(id)}
                            className={cn('py-2 px-3 rounded-xl border-2 transition-all text-xs font-bold',
                              photogenicRating === id ? 'bg-pink-50 dark:bg-pink-900/20 border-pink-300 text-pink-600' : 'bg-gray-50 dark:bg-gray-800 border-transparent hover:border-gray-200 text-gray-500'
                            )}
                          >{label}</button>
                        ))}
                      </div>
                    </div>
                  </section>

                  {/* A Direção — Drivability, Road Conditions */}
                  <section className="space-y-5 pt-4 border-t border-gray-100 dark:border-gray-800">
                    <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                      <Car className="h-4 w-4" /> A Direção
                    </h3>

                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-2">Facilidade ao Dirigir</label>
                      <div className="grid grid-cols-4 gap-2">
                        {[{ id: 'easy', label: 'Fácil' }, { id: 'moderate', label: 'Moderado' }, { id: 'demanding', label: 'Exigente' }, { id: 'unknown', label: 'N/I' }].map(({ id, label }) => (
                          <button key={id} type="button" onClick={() => setDrivability(id)}
                            className={cn('py-2 px-3 rounded-xl border-2 transition-all text-xs font-bold',
                              drivability === id ? 'bg-tuggi-blue/10 border-tuggi-blue text-tuggi-blue' : 'bg-gray-50 dark:bg-gray-800 border-transparent hover:border-gray-200 text-gray-500'
                            )}
                          >{label}</button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-2">Condições do Caminho</label>
                      <div className="flex flex-wrap gap-2">
                        {[{ id: 'paved', label: 'Asfalto' }, { id: 'dirt', label: 'Terra' }, { id: 'steep', label: 'Íngremes' }, { id: 'curves', label: 'Curvas' }].map(({ id, label }) => (
                          <button key={id} type="button"
                            onClick={() => setRoadConditions(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])}
                            className={cn('py-1.5 px-3 rounded-full border-2 transition-all text-xs font-medium',
                              roadConditions.includes(id) ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 text-blue-600' : 'bg-gray-50 dark:bg-gray-800 border-transparent hover:border-gray-200 text-gray-500'
                            )}
                          >{label}</button>
                        ))}
                      </div>
                    </div>
                  </section>

                  {/* Acessibilidade */}
                  <section className="space-y-5 pt-4 border-t border-gray-100 dark:border-gray-800">
                    <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                      <Accessibility className="h-4 w-4" /> Acessibilidade
                    </h3>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-2">Acesso para Cadeirantes (Rota)</label>
                      <div className="grid grid-cols-4 gap-2">
                        {[{ id: 'accessible', label: 'Acessível' }, { id: 'partial', label: 'Parcial' }, { id: 'not_accessible', label: 'Não' }, { id: 'unknown', label: 'N/I' }].map(({ id, label }) => (
                          <button key={id} type="button" onClick={() => setAccessibility(id)}
                            className={cn('py-2 px-2 rounded-xl border-2 transition-all text-[10px] font-bold',
                              accessibility === id ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-300 text-purple-600' : 'bg-gray-50 dark:bg-gray-800 border-transparent hover:border-gray-200 text-gray-500'
                            )}
                          >{label}</button>
                        ))}
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            )}

            {/* ══ TAB: IDIOMAS ══ */}
            {activeTab === 'languages' && isEditing && routeId && (
              <div className="h-full overflow-y-auto custom-scrollbar">
                <RouteTranslationsPanel
                  routeId={routeId}
                  routeName={name || initialData?.name || ''}
                  inline
                />
              </div>
            )}

          </main>
        </div>
      </div>
    </div>
  )
}

// ─── Public component (wraps Google Maps loader) ─────────────────────────────

export function RouteEditorModal({ isOpen, ...props }: RouteEditorModalProps) {
  if (!isOpen) return null

  return (
    <Wrapper
      apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''}
      libraries={GOOGLE_MAPS_LIBRARIES}
      version={GOOGLE_MAPS_VERSION}
      render={(status) => {
        if (status === Status.LOADING) {
          return (
            <div className="fixed inset-0 z-[100] flex justify-end bg-black/50 backdrop-blur-sm">
              <div className="w-[85vw] bg-white dark:bg-gray-900 h-full flex items-center justify-center shadow-2xl">
                <div className="flex flex-col items-center gap-4">
                  <div className="w-16 h-16 border-8 border-tuggi-blue/10 border-t-tuggi-blue rounded-full animate-spin" />
                  <p className="text-gray-400 font-bold animate-pulse">Iniciando Editor...</p>
                </div>
              </div>
            </div>
          )
        }
        if (status === Status.FAILURE) {
          return (
            <div className="fixed inset-0 z-[100] flex justify-end bg-black/50 backdrop-blur-sm">
              <div className="w-[85vw] bg-white dark:bg-gray-900 h-full flex items-center justify-center shadow-2xl">
                <div className="flex items-center gap-2 text-red-500">
                  <AlertCircle className="h-6 w-6" />
                  <span className="font-bold">Erro ao carregar mapas</span>
                </div>
              </div>
            </div>
          )
        }
        return <RouteEditorModalInner {...props} />
      }}
    />
  )
}
