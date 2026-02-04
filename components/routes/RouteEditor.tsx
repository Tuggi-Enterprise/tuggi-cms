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
  Edit
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { useRouter } from '@/navigation'

const LIBRARIES: any[] = ['drawing', 'geometry', 'places']

interface LatLng {
  lat: number
  lng: number
}

interface Waypoint extends LatLng {
  id: string
}

interface RouteEditorProps {
  initialData?: any
  isEditing?: boolean
}

function RouteEditorInner({ initialData, isEditing = false }: RouteEditorProps) {
  const t = useTranslations('CustomRoutes.editor')
  const commonT = useTranslations('Common')
  const router = useRouter()

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
      const initialCenter = waypoints.length > 0 
        ? { lat: waypoints[0].lat, lng: waypoints[0].lng }
        : { lat: -23.5505, lng: -46.6333 } // São Paulo default

      const map = new google.maps.Map(mapRef.current, {
        center: initialCenter,
        zoom: waypoints.length > 0 ? 12 : 10,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_CENTER }
      })

      map.addListener('click', (e: google.maps.MapMouseEvent) => {
        if (e.latLng) {
          const newWaypoint = {
            id: Math.random().toString(36).substr(2, 9),
            lat: e.latLng.lat(),
            lng: e.latLng.lng()
          }
          setWaypoints(prev => [...prev, newWaypoint])
        }
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

    // Draw Route Polyline
    if (polylineRef.current) polylineRef.current.setMap(null)
    
    if (routeGeometry.length > 0) {
      const polyline = new google.maps.Polyline({
        path: routeGeometry,
        geodesic: true,
        strokeColor: '#3B82F6',
        strokeOpacity: 0.8,
        strokeWeight: 4,
        map: mapInstanceRef.current
      })
      polylineRef.current = polyline
    } else if (waypoints.length > 1 && !isGenerating) {
        // Fallback straight line polyline
        const polyline = new google.maps.Polyline({
            path: waypoints,
            geodesic: true,
            strokeColor: '#3B82F6',
            strokeOpacity: 0.5,
            strokeWeight: 3,
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
          is_active: isActive
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
        <div className="p-8 space-y-8 overflow-y-auto flex-1 custom-scrollbar">
          {/* Header & Back Button */}
          <div className="flex items-start gap-4">
            <button 
              onClick={() => router.push('/routes')}
              className="mt-1 p-3 bg-gray-50 dark:bg-gray-800 rounded-2xl hover:bg-gray-100 dark:hover:bg-gray-700 transition-all text-gray-500 hover:text-tuggi-blue border border-transparent hover:border-gray-200 dark:hover:border-gray-700"
              title="Voltar para listagem"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <div>
              <h2 className="text-3xl font-black text-gray-900 dark:text-white tracking-tighter uppercase italic flex items-center gap-2">
                {isEditing ? <Edit className="h-6 w-6 text-tuggi-blue" /> : <Plus className="h-6 w-6 text-tuggi-blue" />}
                {isEditing ? t('edit_title') : t('create_title')}
              </h2>
              <p className="text-sm text-gray-500 font-medium leading-relaxed">
                Configure os detalhes da sua rota turística e defina os pontos no mapa.
              </p>
            </div>
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

          {/* Route Points */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                <Navigation className="h-4 w-4" />
                Pontos de Passagem
              </h3>
              <span className="text-xs font-bold px-2 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-500 rounded-full">
                {waypoints.length}
              </span>
            </div>

            <div className="space-y-2 max-h-64 overflow-y-auto pr-2 custom-scrollbar">
              {waypoints.map((wp, index) => (
                <div key={wp.id} className="group flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-all border border-transparent hover:border-gray-200 dark:hover:border-gray-700">
                  <div className={cn(
                    "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0",
                    index === 0 ? "bg-green-500" : (index === waypoints.length - 1 ? "bg-red-500" : "bg-blue-500")
                  )}>
                    {index + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-400 truncate">Ponto {index + 1}</p>
                    <p className="text-[10px] text-gray-500 truncate font-mono">{wp.lat.toFixed(6)}, {wp.lng.toFixed(6)}</p>
                  </div>
                  <button 
                    onClick={() => removeWaypoint(wp.id)}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
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

          {/* Settings Group */}
          <section className="space-y-3 pt-6 border-t border-gray-100 dark:border-gray-800">
            <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-2 px-1">Configurações de Exibição</h3>
            
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
        </div>

        {/* Action Footer */}
        <div className="p-6 bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 space-y-4 mt-auto">
          {/* Stats Summary */}
          {(distance || isGenerating) && (
            <div className="grid grid-cols-2 gap-3 mb-2">
              <div className="bg-white dark:bg-gray-800 p-3 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
                <div className="flex items-center gap-2 text-xs text-gray-400 font-bold uppercase mb-1">
                  <Activity className="h-3 w-3" /> Distância
                </div>
                <div className="text-lg font-black text-tuggi-blue font-mono leading-none">
                  {isGenerating ? <RefreshCw className="h-4 w-4 animate-spin" /> : formatDistance(distance)}
                </div>
              </div>
              <div className="bg-white dark:bg-gray-800 p-3 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
                <div className="flex items-center gap-2 text-xs text-gray-400 font-bold uppercase mb-1">
                  <Clock className="h-3 w-3" /> Duração
                </div>
                <div className="text-lg font-black text-tuggi-blue font-mono leading-none">
                  {isGenerating ? <RefreshCw className="h-4 w-4 animate-spin" /> : formatDuration(duration)}
                </div>
              </div>
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={isSaving || isGenerating || !name || waypoints.length < 2}
            className="w-full py-4 bg-tuggi-blue text-white font-black rounded-2xl hover:bg-tuggi-blue/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-xl shadow-tuggi-blue/30 active:scale-[0.98] flex items-center justify-center gap-3 text-lg"
          >
            {isSaving ? <RefreshCw className="h-6 w-6 animate-spin" /> : <Save className="h-6 w-6" />}
            {commonT('actions.save')}
          </button>
        </div>
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
              <p className="font-black text-gray-900 dark:text-white uppercase tracking-tighter italic">Comece aqui</p>
              <p className="text-xs text-gray-500 font-medium">Clique no mapa para definir o ponto de partida</p>
            </div>
          </div>
        )}

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
        version="weekly"
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
