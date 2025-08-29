'use client'

import { useState, useEffect } from 'react'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import { Search, MapPin, Loader2, Target, Eye, Database, Map, Zap, CheckCircle2, AlertTriangle, Clock } from 'lucide-react'
import { GoogleMapComponent } from '@/components/ui/GoogleMapComponent'

interface POIData {
  id: string
  name: string
  city: string
  country: string
  google_place_id: string | null
  latitude: number
  longitude: number
  google_types?: string[]
  rating?: number
}

interface BoundaryResult {
  strategy: string
  success: boolean
  boundary?: {
    type: 'polygon' | 'circle'
    coordinates: Array<{lat: number, lng: number}>
    area_m2: number
    perimeter_m: number
    confidence: number
    source?: string
  }
  error?: string
  processingTime: number
  mapboxData?: {
    geocoding?: any
    tilequery?: any
    isochrone?: any
    vectorTiles?: any
  }
}

interface TriggerPointResult {
  lat: number
  lng: number
  type: 'primary' | 'secondary' | 'fallback'
  reasoning: string
  confidence: number
}

export default function POIBoundariesTestPage() {
  const supabase = useSupabaseClient()
  
  // State
  const [poiId, setPoiId] = useState('')
  const [poiData, setPoiData] = useState<POIData | null>(null)
  const [isLoadingPOI, setIsLoadingPOI] = useState(false)
  const [poiError, setPoiError] = useState('')
  
  // Boundary detection results
  const [boundaryResults, setBoundaryResults] = useState<BoundaryResult[]>([])
  const [triggerPoints, setTriggerPoints] = useState<TriggerPointResult[]>([])
  const [isDetecting, setIsDetecting] = useState(false)
  const [selectedStrategy, setSelectedStrategy] = useState<string | null>(null)
  
  // Map state
  const [mapCenter, setMapCenter] = useState({ lat: -23.5505, lng: -46.6333 })
  const [mapZoom, setMapZoom] = useState(13)
  const [mapMarkers, setMapMarkers] = useState<Array<{id: string, position: {lat: number, lng: number}, title: string, color?: string}>>([])
  const [mapPolygon, setMapPolygon] = useState<Array<{lat: number, lng: number}> | undefined>()

  // Load POI data from database
  const loadPOI = async () => {
    if (!poiId.trim()) {
      setPoiError('Por favor, insira um ID de POI')
      return
    }

    setIsLoadingPOI(true)
    setPoiError('')
    setPoiData(null)
    setBoundaryResults([])
    setTriggerPoints([])

    try {
      // Fetch POI with coordinates
      const { data, error } = await supabase
        .schema('core')
        .from('attractions')
        .select(`
          id,
          name,
          city,
          country,
          google_place_id,
          google_types,
          rating,
          coordinates:attraction_coordinate(latitude, longitude)
        `)
        .eq('id', poiId.trim())
        .single()

      if (error) {
        throw error
      }

      if (!data) {
        throw new Error('POI não encontrado')
      }

      if (!data.coordinates || data.coordinates.length === 0) {
        throw new Error('POI não possui coordenadas')
      }

      const coordinate = data.coordinates[0]
      const poi: POIData = {
        id: data.id,
        name: data.name,
        city: data.city,
        country: data.country,
        google_place_id: data.google_place_id,
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
        google_types: data.google_types,
        rating: data.rating
      }

      setPoiData(poi)
      setMapCenter({ lat: poi.latitude, lng: poi.longitude })
      setMapZoom(16)
      
      // Add POI marker to map
      setMapMarkers([{
        id: 'poi',
        position: { lat: poi.latitude, lng: poi.longitude },
        title: poi.name,
        color: 'red'
      }])

      console.log('✅ POI carregado:', poi)

    } catch (error) {
      console.error('❌ Erro ao carregar POI:', error)
      setPoiError(error instanceof Error ? error.message : 'Erro desconhecido')
    } finally {
      setIsLoadingPOI(false)
    }
  }

  // Detect boundaries using OpenStreetMap
  const detectBoundaries = async () => {
    if (!poiData) return

    setIsDetecting(true)
    setBoundaryResults([])
    setTriggerPoints([])
    setSelectedStrategy(null)
    setMapPolygon(undefined)

    const startTime = Date.now()
    
    try {
      console.log('🌍 Detecting boundaries with OpenStreetMap...')
      const response = await fetch('/api/poi-boundaries/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attraction_id: poiData.id,
          poi_lat: poiData.latitude,
          poi_lng: poiData.longitude,
          poi_name: poiData.name
        })
      })

      const result = await response.json()
      const processingTime = Date.now() - startTime

      const boundaryResult: BoundaryResult = {
        strategy: 'OpenStreetMap',
        success: result.success,
        boundary: result.boundary,
        error: result.error,
        processingTime
      }

      setBoundaryResults([boundaryResult])
      
      if (result.success && result.boundary) {
        // Automatically select and visualize the result
        setSelectedStrategy('OpenStreetMap')
        setMapPolygon(result.boundary.coordinates)
        
        if (result.trigger_points) {
          setTriggerPoints(result.trigger_points)
          
          // Add trigger points to map markers
          const triggerMarkers = result.trigger_points.map((tp: TriggerPointResult, index: number) => ({
            id: `trigger-${index}`,
            position: { lat: tp.lat, lng: tp.lng },
            title: `Trigger Point ${index + 1} (${tp.type})`,
            color: tp.type === 'primary' ? 'blue' : tp.type === 'secondary' ? 'green' : 'orange'
          }))

          setMapMarkers([
            { id: 'poi', position: { lat: poiData.latitude, lng: poiData.longitude }, title: poiData.name, color: 'red' },
            ...triggerMarkers
          ])
        }
      }

    } catch (error) {
      const processingTime = Date.now() - startTime
      setBoundaryResults([{
        strategy: 'OpenStreetMap',
        success: false,
        error: error instanceof Error ? error.message : 'Erro desconhecido',
        processingTime
      }])
    }

    setIsDetecting(false)
  }





  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="py-6">
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
              <Target className="h-8 w-8 text-blue-600" />
              Teste de Detecção de Fronteiras de POIs
            </h1>
            <p className="mt-2 text-gray-600">
              Sistema otimizado usando OpenStreetMap para detectar fronteiras reais dos POIs e gerar trigger points precisos.
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          {/* Left Panel - Controls */}
          <div className="space-y-6">
            
            {/* POI Input */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Database className="h-5 w-5 text-blue-600" />
                1. Carregar POI do Banco
              </h2>
              
              <div className="space-y-4">
                <div>
                  <label htmlFor="poi-id" className="block text-sm font-medium text-gray-700 mb-2">
                    ID do POI
                  </label>
                  <div className="flex gap-3">
                    <input
                      id="poi-id"
                      type="text"
                      value={poiId}
                      onChange={(e) => setPoiId(e.target.value)}
                      placeholder="Cole o UUID do POI aqui..."
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      onClick={loadPOI}
                      disabled={isLoadingPOI || !poiId.trim()}
                      className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      {isLoadingPOI ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Search className="h-4 w-4" />
                      )}
                      Carregar
                    </button>
                  </div>
                  {poiError && (
                    <p className="mt-2 text-sm text-red-600">{poiError}</p>
                  )}
                </div>

                {/* POI Info */}
                {poiData && (
                  <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                    <h3 className="font-semibold text-gray-900">{poiData.name}</h3>
                    <p className="text-sm text-gray-600">
                      📍 {poiData.city}, {poiData.country}
                    </p>
                    <p className="text-sm text-gray-600">
                      🌍 {poiData.latitude.toFixed(6)}, {poiData.longitude.toFixed(6)}
                    </p>
                    {poiData.google_place_id && (
                      <p className="text-sm text-gray-600">
                        🆔 Google Place ID: {poiData.google_place_id}
                      </p>
                    )}
                    {poiData.google_types && poiData.google_types.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {poiData.google_types.slice(0, 3).map((type, index) => (
                          <span key={index} className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded">
                            {type}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Boundary Detection */}
            {poiData && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Target className="h-5 w-5 text-green-600" />
                  2. Detectar Fronteiras com OpenStreetMap
                </h2>
                
                <button
                  onClick={detectBoundaries}
                  disabled={isDetecting}
                  className="w-full px-4 py-3 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-lg font-medium"
                >
                  {isDetecting ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      Detectando Fronteiras...
                    </>
                  ) : (
                    <>
                      <Zap className="h-5 w-5" />
                      Detectar Fronteiras Reais
                    </>
                  )}
                </button>

                {/* Results */}
                {boundaryResults.length > 0 && (
                  <div className="mt-6 space-y-3">
                    <h3 className="font-semibold text-gray-900">Resultados:</h3>
                    
                    {boundaryResults.map((result, index) => (
                      <div
                        key={index}
                        className={`border rounded-lg p-4 cursor-pointer transition-colors ${
                          selectedStrategy === result.strategy
                            ? 'border-blue-500 bg-blue-50'
                            : result.success
                            ? 'border-green-200 bg-green-50 hover:bg-green-100'
                            : 'border-red-200 bg-red-50'
                        }`}
                        onClick={() => result.success && console.log('Result already selected')}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {result.success ? (
                              <CheckCircle2 className="h-5 w-5 text-green-600" />
                            ) : (
                              <AlertTriangle className="h-5 w-5 text-red-600" />
                            )}
                            <span className="font-medium">{result.strategy}</span>
                          </div>
                          <div className="flex items-center gap-2 text-sm text-gray-500">
                            <Clock className="h-4 w-4" />
                            {result.processingTime}ms
                          </div>
                        </div>
                        
                        {result.success && result.boundary ? (
                          <div className="mt-2 text-sm text-gray-600">
                            <p>📐 Área: {result.boundary.area_m2.toLocaleString()}m²</p>
                            <p>📏 Perímetro: {result.boundary.perimeter_m.toLocaleString()}m</p>
                            <p>🎯 Confiança: {(result.boundary.confidence * 100).toFixed(1)}%</p>
                            {result.boundary.source && (
                              <p>🔍 Fonte: {result.boundary.source}</p>
                            )}
                            <p className="text-green-600 mt-1">✅ Resultado aplicado automaticamente</p>
                            

                          </div>
                        ) : (
                          <p className="mt-2 text-sm text-red-600">❌ {result.error}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Trigger Points */}
                {triggerPoints.length > 0 && (
                  <div className="mt-6">
                    <h3 className="font-semibold text-gray-900 mb-3">Trigger Points Gerados:</h3>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {triggerPoints.map((tp, index) => (
                        <div key={index} className="bg-gray-50 rounded p-3 text-sm">
                          <div className="flex items-center justify-between">
                            <span className={`px-2 py-1 rounded text-xs font-medium ${
                              tp.type === 'primary' ? 'bg-blue-100 text-blue-800' :
                              tp.type === 'secondary' ? 'bg-green-100 text-green-800' :
                              'bg-orange-100 text-orange-800'
                            }`}>
                              {tp.type}
                            </span>
                            <span className="text-gray-500">
                              {(tp.confidence * 100).toFixed(1)}%
                            </span>
                          </div>
                          <p className="mt-1 text-gray-700">{tp.reasoning}</p>
                          <p className="text-xs text-gray-500 mt-1">
                            📍 {tp.lat.toFixed(6)}, {tp.lng.toFixed(6)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Instructions */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
              <h3 className="font-semibold text-blue-900 mb-3">📋 Como Usar:</h3>
              <ol className="space-y-2 text-sm text-blue-800">
                <li>1. Cole o ID de um POI do banco de dados</li>
                <li>2. Clique em &quot;Carregar&quot; para buscar os dados</li>
                <li>3. Clique em &quot;Detectar Fronteiras Reais&quot;</li>
                <li>4. Analise a fronteira e trigger points no mapa</li>
                <li>5. Verifique se os pontos estão bem posicionados</li>
              </ol>
              
              <div className="mt-4 pt-4 border-t border-blue-200">
                <h4 className="font-medium text-blue-900 mb-2">✅ Sistema Otimizado:</h4>
                <div className="space-y-1 text-xs text-blue-700">
                  <p>🌍 OpenStreetMap: Dados gratuitos e precisos</p>
                  <p>🎯 Fronteiras reais dos POIs</p>
                  <p>📍 Trigger points estratégicos</p>
                  <p>⚡ Sem custos de API</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Panel - Map */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Map className="h-5 w-5 text-green-600" />
              Visualização do Mapa
            </h2>
            
            {selectedStrategy && (
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-800">
                  <strong>Estratégia Selecionada:</strong> {selectedStrategy}
                </p>
                <p className="text-xs text-blue-600 mt-1">
                  🔴 Vermelho = POI | 🔵 Azul = Trigger Primary | 🟢 Verde = Trigger Secondary | 🟠 Laranja = Trigger Fallback
                </p>
              </div>
            )}

            <div className="h-96 rounded-lg overflow-hidden border border-gray-300">
              <GoogleMapComponent
                center={mapCenter}
                zoom={mapZoom}
                height="100%"
                markers={mapMarkers}
                polygon={mapPolygon}
                enableDrawing={false}
              />
            </div>
            
            {mapPolygon && (
              <div className="mt-4 text-sm text-gray-600 space-y-1">
                <p>📊 <strong>Vértices do Polígono:</strong> {mapPolygon.length}</p>
                <p>🎯 <strong>Trigger Points:</strong> {triggerPoints.length}</p>
                <p>📍 <strong>Centro:</strong> {mapCenter.lat.toFixed(6)}, {mapCenter.lng.toFixed(6)}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
