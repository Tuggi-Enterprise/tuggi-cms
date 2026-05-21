'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Wrapper, Status } from '@googlemaps/react-wrapper'
import { 
  Save,
  Trash2,
  Navigation,
  Map as MapIcon,
  Activity,
  Clock,
  AlertCircle,
  Plus,
  X,
  GripVertical,
  CheckCircle2,
  RefreshCw,
  Route,
  PenTool,
  ChevronLeft,
  CheckCircle,
  XCircle,
  Edit,
  Link2,
  ExternalLink,
  Globe,
  Settings,
  // Characteristics icons
  Accessibility,
  Car,
  Mountain,
  Sun,
  Moon,
  Sunrise,
  Camera,
  Trees,
  Building2,
  Wheat,
  ParkingCircle,
  ChevronDown,
  ChevronUp,
  MapPin
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { useRouter } from '@/navigation'
import { GOOGLE_MAPS_LIBRARIES, GOOGLE_MAPS_VERSION } from '@/lib/maps-config'
import { useCmsUser } from '@/lib/hooks/useCmsUser'
import { RouteTranslationsPanel } from './RouteTranslationsPanel'

const LIBRARIES = GOOGLE_MAPS_LIBRARIES

interface LatLng {
  lat: number
  lng: number
}

interface WaypointMetadata {
  // Identificação do local (novo)
  name?: string
  attraction_id?: string | null
  is_generic?: boolean
  // Recursos do ponto (existente)
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

interface RouteEditorProps {
  initialData?: any
  isEditing?: boolean
}

function RouteEditorInner({ initialData, isEditing = false }: RouteEditorProps) {
  const t = useTranslations('CustomRoutes.editor')
  const commonT = useTranslations('Common')
  const router = useRouter()
  const { canEdit, isViewer, isAdmin, role: cmsRole } = useCmsUser()

  // Form State
  const [name, setName] = useState(initialData?.name || '')
  const [description, setDescription] = useState(initialData?.description || '')
  const [clientId, setClientId] = useState(initialData?.client_id || '')
  const [clients, setClients] = useState<any[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [userRole, setUserRole] = useState<string | null>(null)
  
  // Route State
  const [waypoints, setWaypoints] = useState<Waypoint[]>(initialData?.waypoints || [])
  const [snapToRoads, setSnapToRoads] = useState<boolean>(initialData?.metadata?.source === 'osrm' || true)
  const [routeGeometry, setRouteGeometry] = useState<LatLng[]>(initialData?.geometry_coords || [])
  const [distance, setDistance] = useState<number | null>(initialData?.metadata?.distance || null)
  const [duration, setDuration] = useState<number | null>(initialData?.metadata?.duration || null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isActive, setIsActive] = useState<boolean>(initialData?.is_active ?? true)

  // Characteristics State
  const [accessibility, setAccessibility] = useState<string>(initialData?.accessibility || 'unknown')
  const [drivability, setDrivability] = useState<string>(initialData?.drivability || 'unknown')
  const [scenicProfile, setScenicProfile] = useState<string[]>(initialData?.scenic_profile || [])
  const [bestTime, setBestTime] = useState<string[]>(initialData?.best_time || [])
  const [roadConditions, setRoadConditions] = useState<string[]>(initialData?.road_conditions || [])
  const [resources, setResources] = useState<Record<string, string>>(initialData?.resources || {})
  const [photogenicRating, setPhotogenicRating] = useState<string>(initialData?.photogenic_rating || 'unknown')
  
  // Waypoint UI State
  const [expandedWaypointId, setExpandedWaypointId] = useState<string | null>(null)

  // Tab navigation (padrão POI modal)
  type EditorTab = 'route' | 'experience' | 'languages' | 'settings'
  const [activeTab, setActiveTab] = useState<EditorTab>('route')

  // POI Search State (busca manual pelo admin)
  const [poiSearchQuery, setPoiSearchQuery] = useState('')
  const [poiSearchResults, setPoiSearchResults] = useState<PoiSearchResult[]>([])
  const [isSearchingPoi, setIsSearchingPoi] = useState(false)
  const [showPoiSearch, setShowPoiSearch] = useState(false)
  const poiSearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Tuggi POIs ao longo da rota (exibidos no mapa como contexto)
  const [tuggiPOIs, setTuggiPOIs] = useState<any[]>([])
  const [showTuggiPOIs, setShowTuggiPOIs] = useState(true)
  const [isLoadingPOIs, setIsLoadingPOIs] = useState(false)
  const tuggiMarkersRef       = useRef<google.maps.Marker[]>([])
  const tuggiClustererRef     = useRef<any | null>(null)
  const viewportFetchTimer    = useRef<ReturnType<typeof setTimeout> | null>(null)
  // fetchViewportPOIsRef — aponta sempre para a versão mais recente da função,
  // evitando stale closure no listener de `idle` do mapa.
  const fetchViewportPOIsRef  = useRef<() => void>(() => {})

  // Coordenadas reais dos POIs vinculados (attraction_id → {lat, lng, name})
  // Podem diferir da posição do waypoint (que é onde o user clicou/script colocou)
  const [linkedPOICoords, setLinkedPOICoords] = useState<Record<string, { lat: number; lng: number; name: string }>>({})
  const linkedPOIMarkersRef = useRef<google.maps.Marker[]>([])

  // Computed: stops count = all waypoints (including start and end)
  const stopsCount = waypoints.length

  // Map Refs
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<google.maps.Map | null>(null)
  const polylineRef = useRef<google.maps.Polyline | null>(null)
  const markersRef = useRef<google.maps.Marker[]>([])
  // Fetch user role and clients
  useEffect(() => {
    async function fetchUserAndClients() {
      try {
        const authRes = await fetch('/api/auth/check')
        if (authRes.ok) {
          const authData = await authRes.json()
          setUserRole(authData.user?.role || null)
          
          // Only fetch all clients if admin
          if (authData.user?.role === 'admin') {
            const response = await fetch('/api/clients/my-clients')
            if (response.ok) {
              const data = await response.json()
              setClients(data.clients || [])
            }
          }
        }
      } catch (err) {
        console.error('Error fetching auth/clients:', err)
      }
    }
    fetchUserAndClients()
  }, [])

  // Initialize Map
  useEffect(() => {
    if (mapRef.current && !mapInstanceRef.current && window.google) {
      // Prioridade: 1) primeiro waypoint existente, 2) última posição salva, 3) São Paulo
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
        // Mapa limpo: remove POIs padrão do Google (restaurantes, hotéis, atrações)
        // para não confundir com os POIs do Tuggi que exibimos em laranja.
        styles: [
          { featureType: 'poi',            stylers: [{ visibility: 'off' }] },
          { featureType: 'poi.park',       elementType: 'geometry', stylers: [{ visibility: 'on' }] },
          { featureType: 'transit.station', elementType: 'labels',  stylers: [{ visibility: 'off' }] },
        ],
      })

      map.addListener('click', (e: google.maps.MapMouseEvent) => {
        if (e.latLng) {
          const newWaypoint: Waypoint = {
            id: Math.random().toString(36).substr(2, 9),
            lat: e.latLng.lat(),
            lng: e.latLng.lng(),
            metadata: {
              wheelchair_access: 'unknown',
              parking: 'unknown',
              restrooms: 'unknown',
              rest_areas: 'unknown',
              photogenic_rating: 'unknown'
            }
          }
          setWaypoints(prev => [...prev, newWaypoint])
        }
      })

      // Idle: dispara após o mapa parar de mover (pan/zoom finalizado).
      // Carrega POIs do viewport atual — debounced 700ms.
      // Usa ref para apontar sempre para a versão mais recente da função.
      map.addListener('idle', () => {
        if (viewportFetchTimer.current) clearTimeout(viewportFetchTimer.current)
        viewportFetchTimer.current = setTimeout(() => {
          fetchViewportPOIsRef.current()
        }, 700)
      })

      mapInstanceRef.current = map
    }
  }, [waypoints])

  // Generate Route when waypoints or snap changes
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
        const response = await fetch('/api/routes/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            waypoints, 
            mode: snapToRoads ? 'route' : 'manual' 
          })
        })

        if (response.ok) {
          const data = await response.json()
          setRouteGeometry(data.coordinates)
          setDistance(data.distance)
          setDuration(data.duration)
        } else {
          // Fallback to straight lines if snap fails
          const coords = waypoints.map(w => ({ lat: w.lat, lng: w.lng }))
          setRouteGeometry(coords)
        }
      } catch (err) {
        console.error('Error generating route:', err)
      } finally {
        setIsGenerating(false)
      }
    }

    const timer = setTimeout(generate, 500) // Debounce
    return () => clearTimeout(timer)
  }, [waypoints, snapToRoads])

  // Update Map Visuals
  useEffect(() => {
    if (!mapInstanceRef.current) return

    // Clear old markers
    markersRef.current.forEach(m => m.setMap(null))
    markersRef.current = []

    // Draw waypoints
    waypoints.forEach((wp, index) => {
      const marker = new google.maps.Marker({
        position: wp,
        map: mapInstanceRef.current,
        label: {
          text: (index + 1).toString(),
          color: 'white',
          fontSize: '12px',
          fontWeight: 'bold'
        },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          fillColor: index === 0 ? '#10B981' : (index === waypoints.length - 1 ? '#EF4444' : '#3B82F6'),
          fillOpacity: 1,
          strokeColor: 'white',
          strokeWeight: 2,
          scale: 14
        },
        draggable: true
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

    // Draw Route Polyline (estilo tracejado = "prévia aproximada", não rota definitiva)
    if (polylineRef.current) polylineRef.current.setMap(null)

    if (routeGeometry.length > 0) {
      const polyline = new google.maps.Polyline({
        path: routeGeometry,
        geodesic: true,
        strokeColor: '#6366F1',   // índigo — diferente do azul sólido para indicar "prévia"
        strokeOpacity: 0,         // opacidade 0 para usar ícones de tracejado
        strokeWeight: 3,
        icons: [{
          icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.7, scale: 3 },
          offset: '0',
          repeat: '12px'
        }],
        map: mapInstanceRef.current
      })
      polylineRef.current = polyline
    } else if (waypoints.length > 1 && !isGenerating) {
      // Fallback linha reta ainda mais suave
      const polyline = new google.maps.Polyline({
        path: waypoints,
        geodesic: true,
        strokeColor: '#9CA3AF',
        strokeOpacity: 0.4,
        strokeWeight: 2,
        map: mapInstanceRef.current
      })
      polylineRef.current = polyline
    }

  }, [waypoints, routeGeometry, isGenerating])

  const handleSave = async () => {
    if (!name || waypoints.length < 2) {
      alert(t('points_required'))
      return
    }

    try {
      setIsSaving(true)
      const url = isEditing ? `/api/routes/${initialData.id}` : '/api/routes'
      const method = isEditing ? 'PUT' : 'POST'

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description,
          client_id: clientId,
          waypoints,
          snap_to_roads: snapToRoads,
          is_active: isActive,
          // Characteristics
          accessibility,
          drivability,
          scenic_profile: scenicProfile,
          best_time: bestTime,
          road_conditions: roadConditions,
          resources,
          photogenic_rating: photogenicRating,
          stops_count: stopsCount || waypoints.length
        })
      })

      if (response.ok) {
        router.push('/routes')
      } else {
        const err = await response.json()
        alert(`${t('save_error')}: ${err.error}`)
      }
    } catch (err) {
      console.error('Error saving route:', err)
      alert(t('save_error'))
    } finally {
      setIsSaving(false)
    }
  }

  const removeWaypoint = (id: string) => {
    setWaypoints(prev => prev.filter(w => w.id !== id))
  }

  // ─── POIs Tuggi ao longo da rota ────────────────────────────────────────────

  // Limpar todos os marcadores Tuggi do mapa
  const clearTuggiMarkers = useCallback(() => {
    if (tuggiClustererRef.current) {
      tuggiClustererRef.current.clearMarkers?.()
      tuggiClustererRef.current.setMap?.(null)
      tuggiClustererRef.current = null
    }
    tuggiMarkersRef.current.forEach(m => m.setMap(null))
    tuggiMarkersRef.current = []
  }, [])

  // Ícone SVG para POI individual: ● [Nome do Local]
  // Quando clustering: o individual some (substituído pelo cluster laranja).
  // Quando individual: o SVG fica visível — círculo laranja + pill branco com nome.
  const createTuggiPOIIcon = useCallback((name: string) => {
    const truncated = name.length > 24 ? name.slice(0, 24) + '…' : name
    // ~5.5px por char a 9px de font — suficiente para estimativa de largura
    const textWidth = Math.round(truncated.length * 5.5)
    const pillW     = textWidth + 14
    const totalW    = 14 + pillW   // circle zone (14px) + pill
    const H         = 20

    // Sanitizar texto para SVG
    const safe = truncated
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${H}">
      <circle cx="7" cy="10" r="5" fill="#FF6B35" stroke="white" stroke-width="1.5"/>
      <rect x="14" y="3" width="${pillW}" height="13" rx="6"
            fill="rgba(255,255,255,0.93)" stroke="#e5e7eb" stroke-width="0.5"/>
      <text x="21" y="13" font-family="-apple-system,system-ui,Arial,sans-serif"
            font-size="9" font-weight="500" fill="#111827">${safe}</text>
    </svg>`

    return {
      url:        `data:image/svg+xml,${encodeURIComponent(svg)}`,
      scaledSize: new google.maps.Size(totalW, H),
      anchor:     new google.maps.Point(7, 10),   // ancora no centro do círculo
    }
  }, [])

  // Criar marcadores e inicializar clustering
  const renderTuggiMarkers = useCallback(async (pois: any[], visible: boolean) => {
    clearTuggiMarkers()
    if (!mapInstanceRef.current || !visible || pois.length === 0) return

    // Suporta ambos os formatos de coordenadas retornados pela API
    const getLat = (p: any): number | null => p.latitude ?? p.coordinates?.latitude ?? null
    const getLng = (p: any): number | null => p.longitude ?? p.coordinates?.longitude ?? null

    const validPOIs = pois.filter(p => getLat(p) !== null && getLng(p) !== null)
    const markers: google.maps.Marker[] = validPOIs.map(poi =>
      new google.maps.Marker({
        position: { lat: getLat(poi)!, lng: getLng(poi)! },
        title: poi.name,
        // Ícone SVG com nome: visível apenas quando o marker NÃO está em cluster.
        // Quando está em cluster, o clusterer o oculta e mostra o cluster laranja.
        icon:  createTuggiPOIIcon(poi.name ?? ''),
        zIndex: 5,
      })
    )
    tuggiMarkersRef.current = markers

    try {
      const { MarkerClusterer } = await import('@googlemaps/markerclusterer')

      // Renderer customizado: clusters laranja Tuggi em vez do azul padrão
      const renderer = {
        render: ({ count, position }: { count: number; position: google.maps.LatLng }) =>
          new google.maps.Marker({
            position,
            label: {
              text:       String(count),
              color:      '#FFFFFF',
              fontSize:   '11px',
              fontWeight: 'bold',
            },
            icon: {
              path:        google.maps.SymbolPath.CIRCLE,
              scale:       12 + Math.min(count * 0.5, 8),  // cresce levemente com a densidade
              fillColor:   '#FF6B35',   // laranja Tuggi
              fillOpacity: 0.9,
              strokeColor: '#FFFFFF',
              strokeWeight: 2,
            },
            zIndex: Number(google.maps.Marker.MAX_ZINDEX) + count,
          }),
      }

      tuggiClustererRef.current = new MarkerClusterer({
        map: mapInstanceRef.current,
        markers,
        renderer,
      })
    } catch {
      // Fallback sem clustering — adiciona cada marker direto no mapa
      markers.forEach(m => m.setMap(mapInstanceRef.current))
    }
  }, [clearTuggiMarkers])

  // Buscar POIs do Tuggi para o viewport atual do mapa.
  //
  // Estratégia: carregar o que está visível no mapa (80% do viewport),
  // para que o admin veja os POIs disponíveis ANTES de decidir onde colocar
  // o próximo waypoint.
  // Acionado pelo evento `idle` do mapa (pan/zoom finalizado), debounced 700ms.
  // Limite: zoom >= 12 (abaixo disso, cidades inteiras entram na bbox).
  const fetchTuggiPOIsForViewport = useCallback(async () => {
    if (!mapInstanceRef.current) return

    const zoom = mapInstanceRef.current.getZoom() ?? 10
    if (zoom < 12) {
      // Muito afastado — limpa para não sobrecarregar
      clearTuggiMarkers()
      setTuggiPOIs([])
      return
    }

    const bounds = mapInstanceRef.current.getBounds()
    if (!bounds) return

    const ne  = bounds.getNorthEast()
    const sw  = bounds.getSouthWest()
    const dLat = ne.lat() - sw.lat()
    const dLng = ne.lng() - sw.lng()
    // Usar 80% do viewport (recuamos 10% em cada lado)
    const M   = 0.10
    const params = new URLSearchParams({
      min_lat: (sw.lat() + dLat * M).toFixed(6),
      min_lng: (sw.lng() + dLng * M).toFixed(6),
      max_lat: (ne.lat() - dLat * M).toFixed(6),
      max_lng: (ne.lng() - dLng * M).toFixed(6),
      // Sem limit explícito — o servidor calcula dinamicamente pela área do viewport
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

  // Atualiza o ref sempre que fetchTuggiPOIsForViewport muda (evita stale closure no idle listener)
  useEffect(() => {
    fetchViewportPOIsRef.current = fetchTuggiPOIsForViewport
  }, [fetchTuggiPOIsForViewport])

  // ─── POIs Vinculados: posição real no banco ───────────────────────────────

  // Busca as coordenadas reais dos POIs vinculados aos waypoints.
  // A posição do waypoint (onde o user clicou) pode diferir da posição real
  // do POI no banco — mostramos ambas no mapa para o admin ver a relação.
  useEffect(() => {
    const ids = waypoints
      .map(w => w.metadata?.attraction_id)
      .filter(Boolean) as string[]

    if (ids.length === 0) {
      setLinkedPOICoords({})
      return
    }

    fetch(`/api/attractions/coordinates?ids=${ids.join(',')}`)
      .then(r => r.json())
      .then(data => {
        const map: Record<string, { lat: number; lng: number; name: string }> = {}
        ;(data.coords ?? []).forEach((c: any) => {
          map[c.id] = { lat: c.latitude, lng: c.longitude, name: c.name }
        })
        setLinkedPOICoords(map)
      })
      .catch(() => {})
  }, [waypoints])

  // Renderiza marcadores dos POIs vinculados no mapa.
  // São pins laranja (posição real do DB) distintos dos círculos azuis (waypoints).
  useEffect(() => {
    linkedPOIMarkersRef.current.forEach(m => m.setMap(null))
    linkedPOIMarkersRef.current = []

    if (!mapInstanceRef.current || Object.keys(linkedPOICoords).length === 0) return

    const markers = Object.entries(linkedPOICoords).map(([, poi]) => {
      const marker = new google.maps.Marker({
        position: { lat: poi.lat, lng: poi.lng },
        map: mapInstanceRef.current,
        title: poi.name,
        // Reutiliza o mesmo ícone SVG dos POIs do Tuggi (círculo laranja + pill com nome).
        // Ficam visíveis sempre (sem clustering), pois são poucos (1 por waypoint vinculado).
        icon: createTuggiPOIIcon(poi.name),
        zIndex: 25,  // acima dos POIs do viewport (zIndex 5) e da rota (zIndex 10)
      })
      return marker
    })

    linkedPOIMarkersRef.current = markers
  }, [linkedPOICoords])

  // Cleanup dos marcadores de POIs vinculados no unmount
  useEffect(() => () => {
    linkedPOIMarkersRef.current.forEach(m => m.setMap(null))
  }, [])

  // Toggle visibilidade dos POIs Tuggi
  const toggleTuggiPOIs = useCallback(async () => {
    const next = !showTuggiPOIs
    setShowTuggiPOIs(next)
    if (next) {
      // Recarregar pelo viewport atual ao reativar
      await fetchTuggiPOIsForViewport()
    } else {
      clearTuggiMarkers()
    }
  }, [showTuggiPOIs, fetchTuggiPOIsForViewport, clearTuggiMarkers])

  // Cleanup no unmount
  useEffect(() => () => {
    clearTuggiMarkers()
    if (viewportFetchTimer.current) clearTimeout(viewportFetchTimer.current)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Busca POIs do nosso banco (core.attractions) — sem custo, sem Google Places
  const handlePoiSearch = (query: string) => {
    setPoiSearchQuery(query)
    if (poiSearchTimeoutRef.current) clearTimeout(poiSearchTimeoutRef.current)
    if (!query.trim() || query.length < 2) {
      setPoiSearchResults([])
      return
    }
    poiSearchTimeoutRef.current = setTimeout(async () => {
      setIsSearchingPoi(true)
      try {
        const params = new URLSearchParams({ search: query, limit: '8' })
        const res = await fetch(`/api/pois/search?${params}`)
        if (!res.ok) throw new Error('Search failed')
        const data = await res.json()
        setPoiSearchResults(data.pois || data.data || [])
      } catch {
        setPoiSearchResults([])
      } finally {
        setIsSearchingPoi(false)
      }
    }, 300)
  }

  // Adiciona waypoint a partir de um POI do banco
  const addWaypointFromPoi = (poi: PoiSearchResult) => {
    if (!poi.coordinates) return
    const newWaypoint: Waypoint = {
      id: Math.random().toString(36).substring(2, 9),
      lat: poi.coordinates.latitude,
      lng: poi.coordinates.longitude,
      metadata: {
        name: poi.name,
        attraction_id: poi.id,
        is_generic: false,
        wheelchair_access: 'unknown',
        parking: 'unknown',
        restrooms: 'unknown',
        rest_areas: 'unknown',
        photogenic_rating: 'unknown',
      }
    }
    setWaypoints(prev => [...prev, newWaypoint])
    // Centralizar mapa no POI adicionado
    if (mapInstanceRef.current) {
      mapInstanceRef.current.panTo({ lat: poi.coordinates!.latitude, lng: poi.coordinates!.longitude })
      mapInstanceRef.current.setZoom(15)
    }
    // Salvar posição no localStorage para próxima sessão
    try {
      localStorage.setItem('tuggi:last-map-center', JSON.stringify({ lat: poi.coordinates.latitude, lng: poi.coordinates.longitude }))
    } catch { /* ignore */ }
    // Fechar busca
    setPoiSearchQuery('')
    setPoiSearchResults([])
    setShowPoiSearch(false)
  }

  // Atualiza o nome de um waypoint específico
  const updateWaypointName = (id: string, name: string) => {
    setWaypoints(prev => prev.map(w =>
      w.id === id ? { ...w, metadata: { ...w.metadata, name } } : w
    ))
  }

  const formatDistance = (m: number | null) => {
    if (m === null) return '--'
    return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(0)} m`
  }

  const formatDuration = (s: number | null) => {
    if (s === null) return '--'
    const mins = Math.round(s / 60)
    return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`
  }

  return (
    <div className="flex h-full overflow-hidden bg-white dark:bg-gray-900 border-none">
      {/* Sidebar Editor */}
      <div className="w-[450px] flex flex-col h-full bg-white dark:bg-gray-900 shadow-2xl z-10 border-r border-gray-100 dark:border-gray-800">

        {/* ── Fixed header ─────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <button
            onClick={() => router.push('/routes')}
            className="p-2 bg-gray-50 dark:bg-gray-800 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 transition-all text-gray-500 hover:text-tuggi-blue shrink-0"
            title="Voltar"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2 truncate">
              {isEditing ? <Edit className="h-4 w-4 text-tuggi-blue shrink-0" /> : <Plus className="h-4 w-4 text-tuggi-blue shrink-0" />}
              {name || (isEditing ? t('edit_title') : t('create_title'))}
            </h2>
            {(distance || stopsCount > 0) && (
              <p className="text-[10px] text-gray-400 font-medium">
                {stopsCount} paradas{distance ? ` · ${formatDistance(distance)}` : ''}
              </p>
            )}
          </div>
        </div>

        {/* ── Tab navigation (padrão POI modal) ────────────────────────── */}
        <div className="flex items-center gap-1 px-4 py-2 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
          {([
            { id: 'route',      icon: Navigation, label: 'Rota'        },
            { id: 'experience', icon: Camera,     label: 'Experiência' },
            { id: 'settings',   icon: Settings,   label: 'Config'      },
            ...(isEditing && initialData?.id
              ? [{ id: 'languages', icon: Globe, label: 'Idiomas' }]
              : [])
          ] as { id: string; icon: any; label: string }[]).map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all flex-1 justify-center',
                activeTab === tab.id
                  ? 'bg-tuggi-blue text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-tuggi-blue hover:bg-tuggi-blue/5'
              )}
            >
              <tab.icon className={cn('h-3.5 w-3.5', activeTab === tab.id && 'animate-pulse')} />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>

        {/* ── Scrollable tab content ────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="p-6 flex flex-col gap-6">

          {/* ══ TAB: ROTA ══════════════════════════════════════════════ */}
          {activeTab === 'route' && <>

          {/* Concept Banner */}
          <div className="flex items-start gap-3 p-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800/30 rounded-2xl">
            <MapPin className="h-4 w-4 text-indigo-500 shrink-0 mt-0.5" />
            <p className="text-[11px] text-indigo-700 dark:text-indigo-300 leading-relaxed font-medium">
              Você define os <strong>pontos de interesse</strong>. O Google Maps ou Apple Maps escolherá o melhor caminho entre eles. O traçado aqui é uma <strong>prévia aproximada</strong>.
            </p>
          </div>

          {/* Basic Info */}
          <section className="space-y-4">
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              {t('basic_info')}
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('name')}</label>
                <input 
                  type="text" 
                  value={name} 
                  onChange={e => setName(e.target.value)} 
                  className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-800 border-none rounded-xl focus:ring-2 focus:ring-tuggi-blue transition-all"
                  placeholder="Ex: Rota Histórica Centro"
                />
              </div>

{/* 
              {userRole === 'admin' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('client')}</label>
                  <select 
                    value={clientId} 
                    onChange={e => setClientId(e.target.value)}
                    className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-800 border-none rounded-xl focus:ring-2 focus:ring-tuggi-blue transition-all"
                  >
                    <option value="">Selecione um cliente...</option>
                    {clients.map(c => (
                      <option key={c.id} value={c.id}>{c.company_name || c.name}</option>
                    ))}
                  </select>
                </div>
              )}
*/}

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('description')}</label>
                <textarea 
                  value={description} 
                  onChange={e => setDescription(e.target.value)}
                  className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-800 border-none rounded-xl focus:ring-2 focus:ring-tuggi-blue transition-all resize-none"
                  rows={2}
                  placeholder="Opcional..."
                />
              </div>
            </div>
          </section>

          </> /* end TAB: ROTA */}

          {/* ══ TAB: EXPERIÊNCIA ═══════════════════════════════════════ */}
          {activeTab === 'experience' && <>

          {/* THE EXPERIENCE - Scenic, Best Time, Photogenic */}
          <section className="space-y-4">
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
              <Camera className="h-4 w-4" />
              A Experiência
            </h3>
            
            {/* Scenic Profile - Multi-select with icons */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-2">Perfil Cênico</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'panoramic', label: 'Panorâmica', icon: Mountain },
                  { id: 'historical', label: 'Histórica', icon: Building2 },
                  { id: 'nature', label: 'Natureza', icon: Trees },
                  { id: 'urban', label: 'Urbana', icon: Building2 },
                  { id: 'rural', label: 'Rural', icon: Wheat },
                ].map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setScenicProfile(prev => 
                      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
                    )}
                    className={cn(
                      "flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all text-xs font-medium",
                      scenicProfile.includes(id) 
                        ? "bg-tuggi-blue/10 border-tuggi-blue text-tuggi-blue" 
                        : "bg-gray-50 dark:bg-gray-800 border-transparent hover:border-gray-200 text-gray-500"
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Best Time - Multi-select */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-2">Melhor Período</label>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { id: 'morning', label: 'Manhã', icon: Sun },
                  { id: 'afternoon', label: 'Tarde', icon: Sun },
                  { id: 'sunset', label: 'Pôr do Sol', icon: Sunrise },
                  { id: 'night', label: 'Noite', icon: Moon },
                ].map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setBestTime(prev => 
                      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
                    )}
                    className={cn(
                      "flex flex-col items-center gap-1 p-2 rounded-xl border-2 transition-all text-[10px] font-medium",
                      bestTime.includes(id) 
                        ? "bg-orange-50 dark:bg-orange-900/20 border-orange-300 text-orange-600" 
                        : "bg-gray-50 dark:bg-gray-800 border-transparent hover:border-gray-200 text-gray-500"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Photogenic Rating */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-2">Fotogênica</label>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { id: 'low', label: 'Básica' },
                  { id: 'medium', label: 'Boa' },
                  { id: 'high', label: 'Incrível' },
                  { id: 'unknown', label: 'N/I' },
                ].map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setPhotogenicRating(id)}
                    className={cn(
                      "py-2 px-3 rounded-xl border-2 transition-all text-xs font-bold",
                      photogenicRating === id 
                        ? "bg-pink-50 dark:bg-pink-900/20 border-pink-300 text-pink-600" 
                        : "bg-gray-50 dark:bg-gray-800 border-transparent hover:border-gray-200 text-gray-500"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* THE DRIVE - Drivability, Road Conditions */}
          <section className="space-y-4 pt-4 border-t border-gray-100 dark:border-gray-800">
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
              <Car className="h-4 w-4" />
              A Direção
            </h3>
            
            {/* Drivability */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-2">Facilidade ao Dirigir</label>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { id: 'easy', label: 'Fácil', color: 'green' },
                  { id: 'moderate', label: 'Moderado', color: 'yellow' },
                  { id: 'demanding', label: 'Exigente', color: 'red' },
                  { id: 'unknown', label: 'N/I', color: 'gray' },
                ].map(({ id, label, color }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setDrivability(id)}
                    className={cn(
                      "py-2 px-3 rounded-xl border-2 transition-all text-xs font-bold",
                      drivability === id 
                        ? `bg-${color}-50 dark:bg-${color}-900/20 border-${color}-300 text-${color}-600` 
                        : "bg-gray-50 dark:bg-gray-800 border-transparent hover:border-gray-200 text-gray-500"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Road Conditions - Multi-select tags */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-2">Condições do Caminho</label>
              <div className="flex flex-wrap gap-2">
                {[
                  { id: 'paved', label: 'Asfalto' },
                  { id: 'dirt', label: 'Terra' },
                  { id: 'steep', label: 'Íngremes' },
                  { id: 'curves', label: 'Curvas' },
                ].map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setRoadConditions(prev => 
                      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
                    )}
                    className={cn(
                      "py-1.5 px-3 rounded-full border-2 transition-all text-xs font-medium",
                      roadConditions.includes(id) 
                        ? "bg-blue-50 dark:bg-blue-900/20 border-blue-300 text-blue-600" 
                        : "bg-gray-50 dark:bg-gray-800 border-transparent hover:border-gray-200 text-gray-500"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* LOGISTICS - Wheelchair Accessibility & Stops Summary */}
          <section className="space-y-4 pt-4 border-t border-gray-100 dark:border-gray-800">
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
              <Accessibility className="h-4 w-4" />
              Acessibilidade & Logística
            </h3>
            
            {/* Wheelchair Accessibility (Route-level summary) */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-2">Acesso para Cadeirantes</label>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { id: 'accessible', label: 'Acessível' },
                  { id: 'partial', label: 'Parcial' },
                  { id: 'not_accessible', label: 'Não' },
                  { id: 'unknown', label: 'N/I' },
                ].map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setAccessibility(id)}
                    className={cn(
                      "py-2 px-2 rounded-xl border-2 transition-all text-[10px] font-bold",
                      accessibility === id 
                        ? "bg-purple-50 dark:bg-purple-900/20 border-purple-300 text-purple-600" 
                        : "bg-gray-50 dark:bg-gray-800 border-transparent hover:border-gray-200 text-gray-500"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-gray-400 mt-2 italic">
                Configure recursos específicos em cada ponto de passagem abaixo.
              </p>
            </div>

            {/* Stops Count (Auto-calculated) */}
            <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-tuggi-blue" />
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Paradas Turísticas:</span>
              </div>
              <span className="text-xl font-bold text-tuggi-blue">{stopsCount}</span>
              <span className="text-[10px] text-gray-400">(calculado dos pontos)</span>
            </div>
          </section>

          {/* Route Points */}
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
                {/* Botão para abrir busca de POI */}
                <button
                  type="button"
                  onClick={() => setShowPoiSearch(v => !v)}
                  title="Buscar ponto de interesse"
                  className={cn(
                    "p-1.5 rounded-lg transition-all text-xs font-semibold flex items-center gap-1",
                    showPoiSearch
                      ? "bg-tuggi-blue text-white"
                      : "bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700"
                  )}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Buscar POI
                </button>
              </div>
            </div>

            {/* Busca de POI — usa nossa base de atrações, sem custo */}
            {showPoiSearch && (
              <div className="relative">
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl">
                  <MapPin className="h-4 w-4 text-gray-400 shrink-0" />
                  <input
                    type="text"
                    autoFocus
                    value={poiSearchQuery}
                    onChange={e => handlePoiSearch(e.target.value)}
                    placeholder="Buscar local no banco... (ex: Castelo, Rossio)"
                    className="flex-1 text-xs bg-transparent outline-none text-gray-700 dark:text-gray-300 placeholder:text-gray-400"
                  />
                  {isSearchingPoi && <RefreshCw className="h-3.5 w-3.5 text-gray-400 animate-spin shrink-0" />}
                  {poiSearchQuery && !isSearchingPoi && (
                    <button onClick={() => { setPoiSearchQuery(''); setPoiSearchResults([]) }}>
                      <X className="h-3.5 w-3.5 text-gray-400" />
                    </button>
                  )}
                </div>
                {/* Resultados */}
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
                        {!poi.coordinates && (
                          <span className="text-[10px] text-orange-400 shrink-0">sem coords</span>
                        )}
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

            <div className="space-y-2 max-h-80 overflow-y-auto pr-2 custom-scrollbar">
              {waypoints.map((wp, index) => {
                const isExpanded = expandedWaypointId === wp.id
                const isStartOrEnd = index === 0 || index === waypoints.length - 1
                const pointLabel = index === 0 ? 'Início' : (index === waypoints.length - 1 ? 'Fim' : `Ponto ${index}`)
                
                return (
                  <div key={wp.id} className="group">
                    <div 
                      className={cn(
                        "flex items-center gap-3 p-3 rounded-xl transition-all border cursor-pointer",
                        isExpanded 
                          ? "bg-tuggi-blue/5 border-tuggi-blue/30" 
                          : "bg-gray-50 dark:bg-gray-800 border-transparent hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:border-gray-200 dark:hover:border-gray-700"
                      )}
                      onClick={() => setExpandedWaypointId(isExpanded ? null : wp.id)}
                    >
                      <div className={cn(
                        "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0",
                        index === 0 ? "bg-green-500" : (index === waypoints.length - 1 ? "bg-red-500" : "bg-blue-500")
                      )}>
                        {index + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        {/* Nome do POI vinculado ou rótulo genérico */}
                        <div className="flex items-center gap-1.5 min-w-0">
                          {wp.metadata?.attraction_id ? (
                            <Link2 className="h-3 w-3 text-green-500 shrink-0" />
                          ) : (
                            <span className="h-3 w-3 shrink-0" /> /* spacer */
                          )}
                          <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
                            {wp.metadata?.name || pointLabel}
                          </p>
                        </div>
                        {/* Label de posição (Início/Fim/Ponto N) */}
                        <p className="text-[10px] text-gray-400 truncate pl-4">
                          {pointLabel}
                          {!wp.metadata?.name && (
                            <span className="font-mono ml-1 opacity-60">{wp.lat.toFixed(4)}, {wp.lng.toFixed(4)}</span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        {wp.metadata?.wheelchair_access && wp.metadata.wheelchair_access !== 'unknown' && (
                          <Accessibility className={cn("h-3 w-3", wp.metadata.wheelchair_access === 'yes' ? "text-green-500" : "text-orange-400")} />
                        )}
                        {wp.metadata?.parking === 'yes' && <ParkingCircle className="h-3 w-3 text-blue-500" />}
                      </div>
                      {!isStartOrEnd && (
                        <button 
                          onClick={(e) => { e.stopPropagation(); removeWaypoint(wp.id) }}
                          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                      <ChevronDown className={cn("h-4 w-4 text-gray-400 transition-transform", isExpanded && "rotate-180")} />
                    </div>
                    
                    {/* Expanded Metadata */}
                    {isExpanded && (
                      <div className="mt-2 ml-9 p-4 bg-white dark:bg-gray-800/80 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm space-y-4">
                        {/* Nome do ponto — editável */}
                        <div>
                          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] mb-1.5">
                            Nome do Local
                          </label>
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
                                  <p className="text-[10px] font-bold text-green-700 dark:text-green-400">
                                    POI vinculado
                                  </p>
                                  {/* Nome do POI real no banco (pode diferir do nome do waypoint) */}
                                  {linkedPOICoords[wp.metadata.attraction_id] && (
                                    <p className="text-[10px] text-green-600 dark:text-green-500 truncate">
                                      {linkedPOICoords[wp.metadata.attraction_id].name}
                                    </p>
                                  )}
                                  <p className="text-[10px] text-green-500/70 font-mono mt-0.5">
                                    {wp.metadata.attraction_id.slice(0, 8)}…
                                  </p>
                                </div>
                              </div>
                              {/* Link para abrir o POI no painel */}
                              <a
                                href={`/pois?poiId=${wp.metadata.attraction_id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={e => e.stopPropagation()}
                                className="p-1 rounded-lg hover:bg-green-100 dark:hover:bg-green-800/30 transition-colors shrink-0"
                                title="Abrir POI no painel"
                              >
                                <ExternalLink className="h-3 w-3 text-green-500" />
                              </a>
                            </div>
                          ) : (
                            <p className="text-[10px] text-gray-400 mt-1 flex items-center gap-1">
                              <span className="w-3 h-3 rounded-full bg-gray-300 inline-block shrink-0" />
                              Ponto genérico — não vinculado a POI do banco
                            </p>
                          )}
                        </div>

                        <div className="flex items-center justify-between">
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em]">Recursos do Ponto</p>
                          {isStartOrEnd && (
                            <span className="text-[10px] font-bold px-2 py-0.5 bg-tuggi-blue/10 text-tuggi-blue rounded-full capitalize">
                              {index === 0 ? 'Início' : 'Fim'}
                            </span>
                          )}
                        </div>
                        
                        {/* Wheelchair Access */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Accessibility className="h-4 w-4 text-tuggi-blue" />
                            <span className="text-xs font-bold text-gray-700 dark:text-gray-300">Cadeirante</span>
                          </div>
                          <div className="flex gap-1 p-1 bg-gray-50 dark:bg-gray-900 rounded-xl">
                            {(['yes', 'partial', 'no', 'unknown'] as const).map(val => (
                              <button
                                key={val}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setWaypoints(prev => prev.map(w => 
                                    w.id === wp.id ? { ...w, metadata: { ...w.metadata, wheelchair_access: val } } : w
                                  ))
                                }}
                                className={cn(
                                  "px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all",
                                  wp.metadata?.wheelchair_access === val 
                                    ? "bg-white dark:bg-gray-800 text-tuggi-blue shadow-sm ring-1 ring-black/5" 
                                    : "text-gray-400 hover:text-gray-600"
                                )}
                              >
                                {val === 'yes' ? 'Sim' : val === 'partial' ? 'Parcial' : val === 'no' ? 'Não' : 'N/I'}
                              </button>
                            ))}
                          </div>
                        </div>
                        
                        {/* Parking */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <ParkingCircle className="h-4 w-4 text-blue-500" />
                            <span className="text-xs font-bold text-gray-700 dark:text-gray-300">Estacionamento</span>
                          </div>
                          <div className="flex gap-1 p-1 bg-gray-50 dark:bg-gray-900 rounded-xl">
                            {(['yes', 'no', 'unknown'] as const).map(val => (
                              <button
                                key={val}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setWaypoints(prev => prev.map(w => 
                                    w.id === wp.id ? { ...w, metadata: { ...w.metadata, parking: val } } : w
                                  ))
                                }}
                                className={cn(
                                  "px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all",
                                  wp.metadata?.parking === val 
                                    ? "bg-white dark:bg-gray-800 text-blue-600 shadow-sm ring-1 ring-black/5" 
                                    : "text-gray-400 hover:text-gray-600"
                                )}
                              >
                                {val === 'yes' ? 'Sim' : val === 'no' ? 'Não' : 'N/I'}
                              </button>
                            ))}
                          </div>
                        </div>
                        
                        {/* Restrooms */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-emerald-500" />
                            <span className="text-xs font-bold text-gray-700 dark:text-gray-300">Banheiros</span>
                          </div>
                          <div className="flex gap-1 p-1 bg-gray-50 dark:bg-gray-900 rounded-xl">
                            {(['yes', 'no', 'unknown'] as const).map(val => (
                              <button
                                key={val}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setWaypoints(prev => prev.map(w => 
                                    w.id === wp.id ? { ...w, metadata: { ...w.metadata, restrooms: val } } : w
                                  ))
                                }}
                                className={cn(
                                  "px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all",
                                  wp.metadata?.restrooms === val 
                                    ? "bg-white dark:bg-gray-800 text-emerald-600 shadow-sm ring-1 ring-black/5" 
                                    : "text-gray-400 hover:text-gray-600"
                                )}
                              >
                                {val === 'yes' ? 'Sim' : val === 'no' ? 'Não' : 'N/I'}
                              </button>
                            ))}
                          </div>
                        </div>
                        
                        {/* Rest Areas */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Trees className="h-4 w-4 text-orange-500" />
                            <span className="text-xs font-bold text-gray-700 dark:text-gray-300">Área de Descanso</span>
                          </div>
                          <div className="flex gap-1 p-1 bg-gray-50 dark:bg-gray-900 rounded-xl">
                            {(['yes', 'no', 'unknown'] as const).map(val => (
                              <button
                                key={val}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setWaypoints(prev => prev.map(w => 
                                    w.id === wp.id ? { ...w, metadata: { ...w.metadata, rest_areas: val } } : w
                                  ))
                                }}
                                className={cn(
                                  "px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all",
                                  wp.metadata?.rest_areas === val 
                                    ? "bg-white dark:bg-gray-800 text-orange-600 shadow-sm ring-1 ring-black/5" 
                                    : "text-gray-400 hover:text-gray-600"
                                )}
                              >
                                {val === 'yes' ? 'Sim' : val === 'no' ? 'Não' : 'N/I'}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Photogenic Rating at Waypoint level */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Camera className="h-4 w-4 text-pink-500" />
                            <span className="text-xs font-bold text-gray-700 dark:text-gray-300">Fotogênica</span>
                          </div>
                          <div className="flex gap-1 p-1 bg-gray-50 dark:bg-gray-900 rounded-xl">
                            {(['low', 'medium', 'high', 'unknown'] as const).map(val => (
                              <button
                                key={val}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setWaypoints(prev => prev.map(w => 
                                    w.id === wp.id ? { ...w, metadata: { ...w.metadata, photogenic_rating: val } } : w
                                  ))
                                }}
                                className={cn(
                                  "px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all",
                                  wp.metadata?.photogenic_rating === val 
                                    ? "bg-white dark:bg-gray-800 text-pink-600 shadow-sm ring-1 ring-black/5" 
                                    : "text-gray-400 hover:text-gray-600"
                                )}
                              >
                                {val === 'low' ? 'Baixa' : val === 'medium' ? 'Média' : val === 'high' ? 'Alta' : 'N/I'}
                              </button>
                            ))}
                          </div>
                        </div>
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
              <Trash2 className="h-3.5 w-3.5" />
              {t('clear_points')}
            </button>
          </section>

          </> /* end TAB: EXPERIÊNCIA */}

          {/* ══ TAB: IDIOMAS ═══════════════════════════════════════════ */}
          {activeTab === 'languages' && isEditing && initialData?.id && (
            <RouteTranslationsPanel
              routeId={initialData.id}
              routeName={name || initialData.name}
              inline
            />
          )}

          {/* ══ TAB: CONFIG ════════════════════════════════════════════ */}
          {activeTab === 'settings' && <>

          {/* Settings Group */}
          <section className="space-y-3">
            <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] mb-2 px-1">Configurações de Exibição</h3>
            
             <div 
              className={cn(
                "flex items-center justify-between p-4 rounded-2xl cursor-pointer select-none transition-all border",
                snapToRoads 
                  ? "bg-blue-50/50 dark:bg-blue-900/10 border-blue-100 dark:border-blue-900/30" 
                  : "bg-gray-50 dark:bg-gray-800 border-transparent hover:border-gray-200 dark:hover:border-gray-700"
              )}
              onClick={() => setSnapToRoads(!snapToRoads)}
            >
              <div className="flex items-center gap-3">
                <div className={cn(
                  "p-2.5 rounded-xl transition-colors shadow-sm",
                  snapToRoads ? "bg-white dark:bg-blue-900/40 text-tuggi-blue" : "bg-gray-200 dark:bg-gray-700 text-gray-400"
                )}>
                  {snapToRoads ? <Route className="h-5 w-5" /> : <PenTool className="h-5 w-5" />}
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900 dark:text-white">{t('snap_to_roads')}</p>
                  <p className="text-[10px] text-gray-500 font-medium">{snapToRoads ? 'Seguir vias mapeadas' : 'Linhas retas (Manual)'}</p>
                </div>
              </div>
              <div className={cn(
                "w-11 h-6 rounded-full relative transition-all duration-300",
                snapToRoads ? "bg-tuggi-blue" : "bg-gray-300 dark:bg-gray-600"
              )}>
                <div className={cn(
                  "absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-all duration-300 shadow-md",
                  snapToRoads ? "translate-x-5" : "translate-x-0"
                )} />
              </div>
            </div>

            <div 
              className={cn(
                "flex items-center justify-between p-4 rounded-2xl cursor-pointer select-none transition-all border",
                isActive 
                  ? "bg-green-50/50 dark:bg-green-900/10 border-green-100 dark:border-green-900/30" 
                  : "bg-gray-50 dark:bg-gray-800 border-transparent hover:border-gray-200 dark:hover:border-gray-700"
              )}
              onClick={() => setIsActive(!isActive)}
            >
              <div className="flex items-center gap-3">
                <div className={cn(
                  "p-2.5 rounded-xl transition-colors shadow-sm",
                  isActive ? "bg-white dark:bg-green-900/40 text-green-600" : "bg-gray-200 dark:bg-gray-700 text-gray-400"
                )}>
                  {isActive ? <CheckCircle className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900 dark:text-white">Status da Rota</p>
                  <p className="text-[10px] text-gray-500 font-medium">{isActive ? 'Visível no Tuggi App' : 'Oculta para usuários'}</p>
                </div>
              </div>
              <div className={cn(
                "w-11 h-6 rounded-full relative transition-all duration-300",
                isActive ? "bg-green-500" : "bg-gray-300 dark:bg-gray-600"
              )}>
                <div className={cn(
                  "absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-all duration-300 shadow-md",
                  isActive ? "translate-x-5" : "translate-x-0"
                )} />
              </div>
            </div>
          </section>
          </> /* end TAB: CONFIG */}

        </div>{/* end flex flex-col gap-6 */}
        </div>{/* end overflow-y-auto */}

        {/* Action Footer — oculto na tab Idiomas (ela tem seus próprios controles) */}
        {activeTab !== 'languages' && (
        <div className="p-6 bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 space-y-4 mt-auto">
          {/* Stats Summary */}
          {(distance || isGenerating) && (
            <div className="grid grid-cols-2 gap-3 mb-2">
              <div className="bg-white dark:bg-gray-800 p-3 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
                <div className="flex items-center gap-2 text-xs text-gray-400 font-bold uppercase mb-1">
                  <Activity className="h-3 w-3" /> Distância
                </div>
                <div className="text-lg font-bold text-tuggi-blue font-mono leading-none">
                  {isGenerating ? <RefreshCw className="h-4 w-4 animate-spin" /> : formatDistance(distance)}
                </div>
              </div>
              <div className="bg-white dark:bg-gray-800 p-3 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
                <div className="flex items-center gap-2 text-xs text-gray-400 font-bold uppercase mb-1">
                  <Clock className="h-3 w-3" /> Duração
                </div>
                <div className="text-lg font-bold text-tuggi-blue font-mono leading-none">
                  {isGenerating ? <RefreshCw className="h-4 w-4 animate-spin" /> : formatDuration(duration)}
                </div>
              </div>
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={!canEdit || isViewer || isSaving || isGenerating || !name || waypoints.length < 2}
            className="w-full py-4 bg-tuggi-blue text-white font-bold rounded-2xl hover:bg-tuggi-blue/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-xl shadow-tuggi-blue/30 active:scale-[0.98] flex items-center justify-center gap-3 text-lg"
          >
            {isSaving ? <RefreshCw className="h-6 w-6 animate-spin" /> : <Save className="h-6 w-6" />}
            {commonT('actions.save')}
          </button>
        </div>
        )} {/* end activeTab !== 'languages' */}
      </div>

      {/* Main Map Area */}
      <div className="flex-1 relative bg-gray-100 dark:bg-gray-950">
        <div ref={mapRef} className="w-full h-full" />
        
        {/* Instructions Overlay */}
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

        {/* Toggle POIs Tuggi — canto inferior esquerdo */}
        <div className="absolute bottom-8 left-8 z-10">
          <button
            onClick={toggleTuggiPOIs}
            title={showTuggiPOIs ? 'Ocultar POIs do Tuggi' : 'Mostrar POIs do Tuggi ao longo da rota'}
            className={cn(
              "flex items-center gap-2 px-3 py-2.5 rounded-2xl shadow-lg text-xs font-semibold transition-all border",
              showTuggiPOIs
                ? "bg-orange-500 text-white border-orange-400 hover:bg-orange-600"
                : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-gray-300"
            )}
          >
            <MapPin className={cn("h-3.5 w-3.5", showTuggiPOIs && "text-white")} />
            {isLoadingPOIs
              ? <><RefreshCw className="h-3 w-3 animate-spin" /> Buscando...</>
              : showTuggiPOIs && tuggiPOIs.length > 0
                ? `${tuggiPOIs.length} POIs Tuggi`
                : showTuggiPOIs
                  ? 'POIs Tuggi'
                  : 'Mostrar POIs Tuggi'
            }
          </button>
        </div>

        {/* Floating Map Utils */}
        <div className="absolute bottom-8 right-8 flex flex-col gap-2">
           <button className="p-4 bg-white dark:bg-gray-900 rounded-2xl shadow-2xl hover:scale-110 active:scale-95 transition-all text-gray-600 dark:text-gray-300 border border-gray-100 dark:border-gray-800">
             <MapIcon className="h-6 w-6" />
           </button>
        </div>
      </div>
    </div>
  )
}

export function RouteEditor(props: RouteEditorProps) {
  return (
    <div className="w-full h-full">
      <Wrapper
        apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''}
        libraries={LIBRARIES}
        version={GOOGLE_MAPS_VERSION}
        render={(status) => {
          if (status === Status.LOADING) {
             return (
               <div className="h-full flex flex-col items-center justify-center gap-4">
                 <div className="w-16 h-16 border-8 border-tuggi-blue/10 border-t-tuggi-blue rounded-full animate-spin" />
                 <p className="text-gray-400 font-bold animate-pulse">Iniciando Editor...</p>
               </div>
             )
          }
          if (status === Status.FAILURE) return <div className="h-full flex items-center justify-center text-red-500 gap-2"><AlertCircle /> Erro ao carregar mapas</div>
          return <RouteEditorInner {...props} />
        }}
      />
    </div>
  )
}
