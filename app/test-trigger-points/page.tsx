'use client'

import { useState, useRef, useEffect } from 'react'
import { GoogleMapComponent } from '@/components/ui/GoogleMapComponent'

interface POIData {
  id: string
  name: string
  lat: number
  lng: number
}

interface BoundaryData {
  type: 'polygon' | 'circle'
  coordinates: Array<{lat: number, lng: number}>
  area_m2: number
  perimeter_m: number
  confidence: number
  source: string
}

interface TriggerPoint {
  lat: number
  lng: number
  type: 'primary' | 'secondary' | 'fallback'
  reasoning: string
  confidence: number
  distance_from_poi: number
  expected_bearing: number
  radius_meters: number
}

interface BufferData {
  coordinates: Array<{lat: number, lng: number}> | null
  radius: number
  strategy: 'circular' | 'boundary_offset'
}

interface TestResult {
  success: boolean
  data?: {
    trigger_points: TriggerPoint[]
    boundary: BoundaryData
    buffer?: BufferData
    confidence: number
    processing_metadata: {
      step: string
      timestamp: string
      legacy_migration: boolean
      landmark_info?: {
        isHighVisibility: boolean
        maxRange: number
        elevationDiff: number
      }
      boundary_method: string
      total_candidates: number
      processing_time_ms: number
    }
    debug_report?: {
      poi_info: {
        id: string | number
        name: string
        coordinates: { lat: number, lng: number }
        landmark_detection: {
          is_high_visibility: boolean
          max_range: number
          elevation_diff: number
        }
      }
      boundary_analysis: {
        source: string
        method_used: string
        area_m2: number
        perimeter_m: number
        confidence: number
        coordinates_count: number
      }
      trigger_points_generation: {
        total_generated: number
        generation_range: number
        average_confidence: number
        points_by_type: {
          primary: number
          secondary: number
          fallback: number
        }
        distance_analysis: {
          closest_point: number
          furthest_point: number
          average_distance: number
        }
      }
      processing_summary: {
        timestamp: string
        legacy_migration: boolean
        poi_confidence_score: number
        database_saved: boolean
        step: string
      }
    }
  }
  error?: string
  processing_time?: number
  edge_function_result?: any // For debugging
}

export default function TestTriggerPointsPage() {
  const [poiData, setPoiData] = useState<POIData>({
    id: '50cd5835-70db-41be-9084-3adcae63c15e',
    name: 'Parque Ibirapuera',
    lat: -23.5874,
    lng: -46.6576
  })
  
  const [isProcessing, setIsProcessing] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const [searchId, setSearchId] = useState('')
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [mapCenter, setMapCenter] = useState({ lat: poiData.lat, lng: poiData.lng })
  const [mapZoom, setMapZoom] = useState(16)

  const handlePOIChange = (field: keyof POIData, value: string | number) => {
    const newPOI = { ...poiData, [field]: value }
    setPoiData(newPOI)
    
    if (field === 'lat' || field === 'lng') {
      setMapCenter({ lat: newPOI.lat, lng: newPOI.lng })
    }
  }

  const searchPOI = async () => {
    if (!searchId.trim()) {
      alert('Por favor, digite um ID do POI')
      return
    }

    setIsSearching(true)
    
    try {
      console.log(`🔍 Searching for POI: ${searchId}`)
      
      const response = await fetch(`/api/search-poi?id=${encodeURIComponent(searchId)}`)
      const result = await response.json()
      
      if (result.success) {
        console.log('✅ POI found:', result.data)
        
        // Update POI data
        setPoiData({
          id: result.data.id,
          name: result.data.name,
          lat: result.data.lat,
          lng: result.data.lng
        })
        
        // Update map center
        setMapCenter({ lat: result.data.lat, lng: result.data.lng })
        
        // Clear search field
        setSearchId('')
        
        alert(`✅ POI encontrado: ${result.data.name}`)
      } else {
        console.error('❌ POI not found:', result.error)
        alert(`❌ Erro: ${result.error}`)
      }
    } catch (error) {
      console.error('❌ Search error:', error)
      alert(`❌ Erro na busca: ${error instanceof Error ? error.message : 'Erro desconhecido'}`)
    } finally {
      setIsSearching(false)
    }
  }

  const runTest = async () => {
    setIsProcessing(true)
    setTestResult(null)
    
    try {
      console.log('🧪 Starting trigger points test...')
      
      // Simulate API call to our corrected service
      const response = await fetch('/api/test-trigger-points', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(poiData)
      })
      
      const result = await response.json()
      setTestResult(result)
      
      if (result.success) {
        console.log('✅ Test completed successfully!')
        console.log(`📊 Generated ${result.data?.processing_metadata.total_points} trigger points`)
        console.log(`🎯 Boundary confidence: ${result.data?.boundary.confidence}`)
        console.log(`⏱️ Processing time: ${result.processing_time}ms`)
      } else {
        console.error('❌ Test failed:', result.error)
      }
      
    } catch (error) {
      console.error('❌ Test error:', error)
      setTestResult({
        success: false,
        error: `Test failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      })
    } finally {
      setIsProcessing(false)
    }
  }

  const getBoundaryColor = (source: string) => {
    switch (source) {
      case 'osm_nominatim': return '#00ff00' // Green - highest confidence
      case 'osm_reverse_geocoding': return '#ffff00' // Yellow - medium confidence
      case 'unified_overpass': return '#ff8800' // Orange - good confidence
      case 'fallback_street_analysis': return '#ff4400' // Red-orange - lower confidence
      case 'estimated_boundary': return '#ff0000' // Red - lowest confidence
      default: return '#888888' // Gray - unknown
    }
  }

  const getTriggerPointColor = (type: string) => {
    switch (type) {
      case 'primary': return '#00ff00' // Green
      case 'secondary': return '#ffff00' // Yellow
      case 'fallback': return '#ff8800' // Orange
      default: return '#888888' // Gray
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            🧪 Teste de Geração de Trigger Points
          </h1>
          <p className="text-gray-600">
            Teste a geração de trigger points usando a nova Edge Function com código legado migrado
          </p>
        </div>

        {/* POI Search */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">🔍 Buscar POI por ID</h2>
          <div className="flex gap-4">
            <div className="flex-1">
              <input
                type="text"
                value={searchId}
                onChange={(e) => setSearchId(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && searchPOI()}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Digite o ID do POI (ex: 50cd5835-70db-41be-9084-3adcae63c15e)"
                disabled={isSearching}
              />
            </div>
            <button
              onClick={searchPOI}
              disabled={isSearching || !searchId.trim()}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-2 px-6 rounded-md transition-colors whitespace-nowrap"
            >
              {isSearching ? '🔄 Buscando...' : '🔍 Buscar'}
            </button>
          </div>
          <p className="text-sm text-gray-500 mt-2">
            💡 O sistema buscará o POI no banco de dados e preencherá automaticamente os campos abaixo
          </p>
        </div>

        {/* Quick Test Buttons */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">🚀 Testes Rápidos via Edge Function</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <button
              onClick={() => setPoiData({
                id: '50cd5835-70db-41be-9084-3adcae63c15e',
                name: 'Parque Ibirapuera',
                lat: -23.5873,
                lng: -46.6567
              })}
              className="bg-green-100 hover:bg-green-200 text-green-800 px-4 py-3 rounded-lg text-sm font-medium transition-colors border border-green-200"
            >
              🌳 Parque Ibirapuera<br/>
              <span className="text-xs text-green-600">Área grande • São Paulo</span>
            </button>
            <button
              onClick={() => setPoiData({
                id: 'cristo-redentor-test',
                name: 'Cristo Redentor',
                lat: -22.9519,
                lng: -43.2105
              })}
              className="bg-blue-100 hover:bg-blue-200 text-blue-800 px-4 py-3 rounded-lg text-sm font-medium transition-colors border border-blue-200"
            >
              🗿 Cristo Redentor<br/>
              <span className="text-xs text-blue-600">Landmark • Rio de Janeiro</span>
            </button>
            <button
              onClick={() => setPoiData({
                id: 'pao-de-acucar-test',
                name: 'Pão de Açúcar',
                lat: -22.9487,
                lng: -43.1566
              })}
              className="bg-yellow-100 hover:bg-yellow-200 text-yellow-800 px-4 py-3 rounded-lg text-sm font-medium transition-colors border border-yellow-200"
            >
              🏔️ Pão de Açúcar<br/>
              <span className="text-xs text-yellow-600">Landmark • Rio de Janeiro</span>
            </button>
          </div>
        </div>

        {/* POI Input Form */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">📍 Configuração Manual do POI</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                ID do POI
              </label>
              <input
                type="text"
                value={poiData.id}
                onChange={(e) => handlePOIChange('id', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="ID do POI"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Nome do POI
              </label>
              <input
                type="text"
                value={poiData.name}
                onChange={(e) => handlePOIChange('name', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Nome do POI"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Latitude
              </label>
              <input
                type="number"
                step="any"
                value={poiData.lat}
                onChange={(e) => handlePOIChange('lat', parseFloat(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Latitude"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Longitude
              </label>
              <input
                type="number"
                step="any"
                value={poiData.lng}
                onChange={(e) => handlePOIChange('lng', parseFloat(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Longitude"
              />
            </div>
          </div>
          
          <div className="mt-6">
            <button
              onClick={runTest}
              disabled={isProcessing}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-2 px-6 rounded-md transition-colors"
            >
              {isProcessing ? '🔄 Testando Edge Function...' : '⚡ Testar Edge Function'}
            </button>
            
            {/* Debug Button */}
            {testResult?.success && (
              <button
                onClick={() => {
                  console.log('🐛 Debug - Full testResult:', testResult);
                  console.log('🐛 Debug - Boundary data:', testResult.data?.boundary);
                  console.log('🐛 Debug - Boundary type:', testResult.data?.boundary?.type);
                  console.log('🐛 Debug - Boundary coordinates:', testResult.data?.boundary?.coordinates);
                  console.log('🐛 Debug - Processing metadata:', testResult.data?.processing_metadata);
                  console.log('🐛 Debug - Debug report:', testResult.data?.debug_report);
                }}
                className="ml-2 px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600"
              >
                🐛 Debug Data
              </button>
            )}
          </div>
        </div>

        {/* Map Visualization */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">🗺️ Visualização do Mapa</h2>
          <div className="h-96 rounded-lg overflow-hidden border border-gray-200">
            <GoogleMapComponent
              center={mapCenter}
              zoom={mapZoom}
              height="100%"
              enableDrawing={false}
              markers={[
                // POI Principal
                {
                  id: 'poi-main',
                  position: { lat: poiData.lat, lng: poiData.lng },
                  title: poiData.name,
                  description: 'POI Principal',
                  color: '#3B82F6'
                },
                // Trigger Points
                ...(testResult?.success && testResult.data?.trigger_points.map((tp, index) => ({
                  id: `tp-${index}`,
                  position: { lat: tp.lat, lng: tp.lng },
                  title: `Trigger Point ${index + 1}`,
                  description: `${tp.type || 'unknown'} - ${(tp.distance_from_poi || 0).toFixed(1)}m - ${((tp.confidence || 0) * 100).toFixed(0)}%`,
                  color: getTriggerPointColor(tp.type)
                })) || [])
              ]}
              polygon={(() => {
                // Verificação defensiva - mostra BOUNDARY como polígono principal
                if (!testResult || !testResult.success || !testResult.data || !testResult.data.boundary) {
                  console.log('🚫 No boundary data available');
                  return undefined;
                }
                
                const boundary = testResult.data.boundary;
                const hasCoordinates = boundary.coordinates && boundary.coordinates.length > 3;
                
                console.log('🟢 Boundary polygon check:', {
                  success: testResult?.success,
                  hasBoundary: !!boundary,
                  boundaryType: boundary.type,
                  hasCoordinates: hasCoordinates,
                  coordinatesLength: boundary.coordinates?.length,
                  source: boundary.source
                });
                
                // Se tem coordenadas válidas, mostrar boundary como polígono verde
                return hasCoordinates ? boundary.coordinates : undefined;
              })()}
              polygonOptions={{
                strokeColor: '#00FF00', // Verde para boundary
                strokeOpacity: 1.0,
                strokeWeight: 4,
                fillColor: '#00FF00',
                fillOpacity: 0.3
              }}
              circles={(() => {
                // Verificação defensiva
                if (!testResult || !testResult.success || !testResult.data) {
                  console.log('🚫 No test result data available for circles');
                  return [];
                }
                
                const circles = [];
                
                // Boundary circular (quando não há coordenadas suficientes para polígono)
                const boundary = testResult.data.boundary;
                const hasInsufficientCoordinates = !boundary.coordinates || boundary.coordinates.length <= 3;
                const hasArea = boundary.area_m2 && boundary.area_m2 > 0;
                
                console.log('🔵 Circle Boundary check:', {
                  success: testResult?.success,
                  hasBoundary: !!boundary,
                  boundaryType: boundary.type,
                  hasArea: hasArea,
                  area: boundary.area_m2,
                  hasInsufficientCoordinates: hasInsufficientCoordinates,
                  coordinatesLength: boundary.coordinates?.length,
                  calculatedRadius: hasArea ? Math.sqrt(boundary.area_m2 / Math.PI) : 0
                });
                
                // Se não tem coordenadas suficientes para polígono MAS tem área, mostrar como círculo
                if (hasInsufficientCoordinates && hasArea) {
                  const radius = Math.sqrt(boundary.area_m2 / Math.PI);
                  console.log('✅ Adding boundary circle with radius:', radius);
                  circles.push({
                    id: 'boundary-circle',
                    center: { lat: poiData.lat, lng: poiData.lng },
                    radius: radius,
                    strokeColor: '#00FF00', // Verde bem visível
                    strokeOpacity: 1.0,
                    strokeWeight: 4,
                    fillColor: '#00FF00',
                    fillOpacity: 0.3
                  });
                }
                
                // Buffer circular (sempre mostrar para landmarks ou quando não há buffer poligonal)
                const buffer = testResult.data.buffer;
                const shouldShowCircularBuffer = buffer && (
                  buffer.strategy === 'circular' || // Landmarks usam estratégia circular
                  !buffer.coordinates // Não há buffer poligonal disponível
                );
                
                console.log('🔴 Buffer check:', {
                  hasBuffer: !!buffer,
                  strategy: buffer?.strategy,
                  hasBufferCoordinates: !!(buffer?.coordinates && buffer.coordinates.length > 3),
                  shouldShowCircular: shouldShowCircularBuffer,
                  radius: buffer?.radius
                });
                
                if (shouldShowCircularBuffer && buffer.radius > 0) {
                  console.log('✅ Adding buffer circle with radius:', buffer.radius);
                  circles.push({
                    id: 'buffer-circle',
                    center: { lat: poiData.lat, lng: poiData.lng },
                    radius: buffer.radius,
                    strokeColor: '#FF6B6B',
                    strokeOpacity: 0.6,
                    strokeWeight: 2,
                    fillColor: '#FF6B6B',
                    fillOpacity: 0.05
                  });
                }
                // Buffer/Raio de geração de trigger points
                const hasBuffer = testResult?.success && (
                  testResult?.data?.debug_report?.trigger_points_generation?.generation_range ||
                  testResult?.data?.processing_metadata?.landmark_info?.maxRange
                );
                const bufferRadius = testResult?.data?.debug_report?.trigger_points_generation?.generation_range || 
                                   testResult?.data?.processing_metadata?.landmark_info?.maxRange || 500;
                
                console.log('🔴 Buffer check:', {
                  success: testResult?.success,
                  hasDebugRange: !!testResult?.data?.debug_report?.trigger_points_generation?.generation_range,
                  debugRange: testResult?.data?.debug_report?.trigger_points_generation?.generation_range,
                  hasMetadataRange: !!testResult?.data?.processing_metadata?.landmark_info?.maxRange,
                  metadataRange: testResult?.data?.processing_metadata?.landmark_info?.maxRange,
                  finalRadius: bufferRadius,
                  willShowBuffer: hasBuffer
                });
                
                if (hasBuffer) {
                  circles.push({
                    id: 'generation-buffer',
                    center: { lat: poiData.lat, lng: poiData.lng },
                    radius: bufferRadius,
                    strokeColor: '#FF6B6B',
                    strokeOpacity: 0.6,
                    strokeWeight: 2,
                    fillColor: '#FF6B6B',
                    fillOpacity: 0.05
                  });
                }
                
                return circles;
              })()}
            />
          </div>
          
          {/* Map Legend */}
          <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <h3 className="font-semibold text-gray-800 mb-3">🗺️ Legenda do Mapa</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              
              {/* Elementos Visuais */}
              <div>
                <h4 className="font-medium text-gray-700 mb-2">📍 Elementos</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                    <span>POI Principal (coordenadas base)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-green-500"></div>
                    <span>Trigger Points Primários</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                    <span>Trigger Points Secundários</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-orange-500"></div>
                    <span>Trigger Points Fallback</span>
                  </div>
                </div>
              </div>

              {/* Áreas e Raios */}
              <div>
                <h4 className="font-medium text-gray-700 mb-2">🎯 Áreas e Raios</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-2 border-2 border-green-500 bg-green-500 bg-opacity-20"></div>
                    <span>Boundary do POI (área real detectada)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-2 border border-red-400 bg-red-400 bg-opacity-5 opacity-60"></div>
                    <span>Buffer de Geração de TPs (raio de busca)</span>
                  </div>
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  💡 O raio de geração é calculado baseado no POI (coordenadas) + landmark detection + densidade urbana
                </div>
              </div>
            </div>
          </div>

          {/* Boundary Info - DESTACADO */}
          {testResult?.success && testResult.data?.boundary && (
            <div className="mt-4 p-4 bg-green-50 rounded-lg border-2 border-green-200">
              <h3 className="font-bold text-green-800 mb-3 text-lg">🎯 BOUNDARY DETECTADO</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div className="bg-white p-2 rounded">
                  <span className="text-gray-600">Tipo:</span>
                  <span className="ml-2 font-bold text-green-700">{testResult.data.boundary.type || 'N/A'}</span>
                </div>
                <div className="bg-white p-2 rounded">
                  <span className="text-gray-600">Fonte:</span>
                  <span className="ml-2 font-bold text-green-700">{testResult.data.boundary.source}</span>
                </div>
                <div className="bg-white p-2 rounded">
                  <span className="text-gray-600">Confiança:</span>
                  <span className="ml-2 font-bold text-green-700">{(testResult.data.boundary.confidence * 100).toFixed(0)}%</span>
                </div>
                <div className="bg-white p-2 rounded">
                  <span className="text-gray-600">Área:</span>
                  <span className="ml-2 font-bold text-green-700">{testResult.data.boundary.area_m2?.toLocaleString()} m²</span>
                </div>
              </div>
              <div className="mt-3 p-2 bg-white rounded">
                <span className="text-gray-600">Coordenadas:</span>
                <span className="ml-2 font-medium text-green-700">
                  {testResult.data.boundary.coordinates?.length || 0} pontos
                </span>
                {testResult.data.boundary.coordinates?.length > 0 && (
                  <span className="ml-2 text-xs text-gray-500">
                    (Primeiro: {testResult.data.boundary.coordinates[0]?.lat?.toFixed(6)}, {testResult.data.boundary.coordinates[0]?.lng?.toFixed(6)})
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Debug quando NÃO há boundary */}
          {testResult?.success && !testResult.data?.boundary && (
            <div className="mt-4 p-4 bg-red-50 rounded-lg border-2 border-red-200">
              <h3 className="font-bold text-red-800 mb-2">⚠️ BOUNDARY NÃO DETECTADO</h3>
              <p className="text-red-700">Nenhum boundary foi retornado pelo sistema.</p>
            </div>
          )}

          {/* Buffer/Range Info */}
          {testResult?.success && (testResult.data?.debug_report?.trigger_points_generation?.generation_range || testResult.data?.processing_metadata?.landmark_info?.maxRange) && (
            <div className="mt-4 p-3 bg-red-50 rounded-lg border border-red-200">
              <h3 className="font-semibold text-gray-800 mb-2">📏 Buffer de Geração (Raio de Busca)</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-gray-600">Raio:</span>
                  <span className="ml-2 font-medium text-red-700">
                    {(testResult.data?.debug_report?.trigger_points_generation?.generation_range || 
                      testResult.data?.processing_metadata?.landmark_info?.maxRange || 0).toFixed(0)}m
                  </span>
                </div>
                <div>
                  <span className="text-gray-600">Tipo POI:</span>
                  <span className="ml-2 font-medium">
                    {testResult.data?.processing_metadata?.landmark_info?.isHighVisibility ? 'Landmark' : 'Regular'}
                  </span>
                </div>
                <div>
                  <span className="text-gray-600">Elevação:</span>
                  <span className="ml-2 font-medium">
                    {testResult.data?.processing_metadata?.landmark_info?.elevationDiff?.toFixed(0) || 0}m
                  </span>
                </div>
                <div>
                  <span className="text-gray-600">Estratégia:</span>
                  <span className="ml-2 font-medium">
                    {testResult.data?.processing_metadata?.landmark_info?.isHighVisibility ? 'Circular' : 'Boundary-offset'}
                  </span>
                </div>
              </div>
              <div className="mt-2 text-xs text-gray-600">
                💡 O raio é calculado dinamicamente baseado na altura do POI, densidade urbana e visibilidade
              </div>
            </div>
          )}

          {/* Range Analysis */}
          {testResult?.success && testResult.data?.debug_report?.trigger_points_generation && (
            <div className="mt-4 p-3 bg-red-50 rounded-lg border border-red-200">
              <h3 className="font-semibold text-red-800 mb-2">📏 Análise do Raio de Geração</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-red-600">Raio de Geração:</span>
                  <span className="ml-2 font-medium">{testResult.data.debug_report.trigger_points_generation.generation_range}m</span>
                </div>
                <div>
                  <span className="text-red-600">Baseado em:</span>
                  <span className="ml-2 font-medium">Coordenadas do POI</span>
                </div>
                <div>
                  <span className="text-red-600">Fatores:</span>
                  <span className="ml-2 font-medium">
                    {testResult.data.processing_metadata.landmark_info?.isHighVisibility 
                      ? 'Landmark + Densidade' 
                      : 'Densidade Urbana'}
                  </span>
                </div>
              </div>
              <div className="mt-2 text-xs text-red-600">
                ⚠️ O círculo vermelho tracejado mostra o raio máximo onde os TPs podem ser gerados, 
                sempre centrado nas coordenadas do POI (não no boundary)
              </div>
            </div>
          )}
        </div>

        {/* Test Results */}
        {testResult && (
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold mb-4">
              📊 Resultados do Teste
              {testResult.success ? ' ✅' : ' ❌'}
            </h2>
            
            {testResult.success ? (
              <div className="space-y-4">
                {/* Edge Function Info */}
                <div className="bg-gradient-to-r from-blue-50 to-purple-50 p-4 rounded-lg border border-blue-200">
                  <h3 className="font-semibold text-blue-800 mb-2">⚡ Edge Function Status</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-blue-600">Método:</span>
                      <span className="ml-2 font-medium">{testResult.data?.processing_metadata.boundary_method}</span>
                    </div>
                    <div>
                      <span className="text-blue-600">Legacy Migration:</span>
                      <span className="ml-2 font-medium">{testResult.data?.processing_metadata.legacy_migration ? '✅ Ativo' : '❌ Inativo'}</span>
                    </div>
                    <div>
                      <span className="text-blue-600">Timestamp:</span>
                      <span className="ml-2 font-medium text-xs">{testResult.data?.processing_metadata.timestamp}</span>
                    </div>
                    <div>
                      <span className="text-blue-600">Step:</span>
                      <span className="ml-2 font-medium">{testResult.data?.processing_metadata.step}</span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-green-50 p-4 rounded-lg">
                    <h3 className="font-semibold text-green-800">🎯 Boundary</h3>
                    <p className="text-sm text-green-600">
                      Fonte: {testResult.data?.boundary.source}
                    </p>
                    <p className="text-sm text-green-600">
                      Confiança: {(testResult.data?.boundary.confidence! * 100).toFixed(0)}%
                    </p>
                    <p className="text-sm text-green-600">
                      Área: {testResult.data?.boundary.area_m2.toLocaleString()} m²
                    </p>
                  </div>
                  
                  <div className="bg-blue-50 p-4 rounded-lg">
                    <h3 className="font-semibold text-blue-800">📍 Trigger Points</h3>
                    <p className="text-sm text-blue-600">
                      Total: {testResult.data?.trigger_points.length}
                    </p>
                    <p className="text-sm text-blue-600">
                      Candidatos: {testResult.data?.processing_metadata.total_candidates}
                    </p>
                    <p className="text-sm text-blue-600">
                      Primários: {testResult.data?.trigger_points.filter(tp => tp.type === 'primary').length}
                    </p>
                    <p className="text-sm text-blue-600">
                      Secundários: {testResult.data?.trigger_points.filter(tp => tp.type === 'secondary').length}
                    </p>
                  </div>
                  
                  <div className="bg-purple-50 p-4 rounded-lg">
                    <h3 className="font-semibold text-purple-800">⚡ Performance</h3>
                    <p className="text-sm text-purple-600">
                      Score: {(testResult.data?.confidence! * 100).toFixed(0)}%
                    </p>
                    <p className="text-sm text-purple-600">
                      Tempo Total: {testResult.processing_time}ms
                    </p>
                    <p className="text-sm text-purple-600">
                      Edge Function: {testResult.data?.processing_metadata.processing_time_ms}ms
                    </p>
                  </div>
                </div>

                {/* Landmark Info */}
                {testResult.data?.processing_metadata.landmark_info && (
                  <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
                    <h3 className="font-semibold text-yellow-800 mb-2">🏔️ Landmark Detection</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                      <div>
                        <span className="text-yellow-600">High Visibility:</span>
                        <span className="ml-2 font-medium">
                          {testResult.data.processing_metadata.landmark_info.isHighVisibility ? '✅ Sim' : '❌ Não'}
                        </span>
                      </div>
                      <div>
                        <span className="text-yellow-600">Max Range:</span>
                        <span className="ml-2 font-medium">{testResult.data.processing_metadata.landmark_info.maxRange}m</span>
                      </div>
                      <div>
                        <span className="text-yellow-600">Elevation Diff:</span>
                        <span className="ml-2 font-medium">{testResult.data.processing_metadata.landmark_info.elevationDiff}m</span>
                      </div>
                    </div>
                  </div>
                )}
                
                <div className="bg-gray-50 p-4 rounded-lg">
                  <h3 className="font-semibold text-gray-800 mb-2">🔍 Detalhes dos Trigger Points</h3>
                  <div className="space-y-2">
                    {testResult.data?.trigger_points.map((tp, index) => (
                      <div key={index} className="text-sm text-gray-600 border-l-4 border-blue-200 pl-3">
                        <span className="font-medium">TP {index + 1}:</span> {tp.type || 'unknown'} - 
                        {(tp.distance_from_poi || 0).toFixed(1)}m - 
                        {((tp.confidence || 0) * 100).toFixed(0)}% - 
                        {tp.reasoning || 'No reasoning provided'}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Debug Report */}
                {testResult.data?.debug_report && (
                  <div className="bg-indigo-50 p-4 rounded-lg border border-indigo-200">
                    <h3 className="font-semibold text-indigo-800 mb-3">🔍 Relatório de Debug Detalhado</h3>
                    
                    {/* POI Info */}
                    <div className="mb-4">
                      <h4 className="font-medium text-indigo-700 mb-2">📍 Informações do POI</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-indigo-600">
                        <div><span className="font-medium">ID:</span> {testResult.data.debug_report.poi_info.id}</div>
                        <div><span className="font-medium">Nome:</span> {testResult.data.debug_report.poi_info.name}</div>
                        <div><span className="font-medium">Coordenadas:</span> {testResult.data.debug_report.poi_info.coordinates.lat.toFixed(4)}, {testResult.data.debug_report.poi_info.coordinates.lng.toFixed(4)}</div>
                        <div><span className="font-medium">Landmark:</span> {testResult.data.debug_report.poi_info.landmark_detection.is_high_visibility ? '✅ Sim' : '❌ Não'}</div>
                      </div>
                    </div>

                    {/* Boundary Analysis */}
                    <div className="mb-4">
                      <h4 className="font-medium text-indigo-700 mb-2">🎯 Análise do Boundary</h4>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm text-indigo-600">
                        <div><span className="font-medium">Método:</span> {testResult.data.debug_report.boundary_analysis.method_used}</div>
                        <div><span className="font-medium">Área:</span> {testResult.data.debug_report.boundary_analysis.area_m2.toLocaleString()} m²</div>
                        <div><span className="font-medium">Perímetro:</span> {testResult.data.debug_report.boundary_analysis.perimeter_m.toLocaleString()} m</div>
                        <div><span className="font-medium">Confiança:</span> {(testResult.data.debug_report.boundary_analysis.confidence * 100).toFixed(0)}%</div>
                        <div><span className="font-medium">Coordenadas:</span> {testResult.data.debug_report.boundary_analysis.coordinates_count} pontos</div>
                        <div><span className="font-medium">Fonte:</span> {testResult.data.debug_report.boundary_analysis.source}</div>
                      </div>
                    </div>

                    {/* Trigger Points Generation */}
                    <div className="mb-4">
                      <h4 className="font-medium text-indigo-700 mb-2">⚡ Geração de Trigger Points</h4>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm text-indigo-600">
                        <div><span className="font-medium">Total Gerado:</span> {testResult.data.debug_report.trigger_points_generation.total_generated}</div>
                        <div><span className="font-medium">Range de Geração:</span> {testResult.data.debug_report.trigger_points_generation.generation_range}m</div>
                        <div><span className="font-medium">Confiança Média:</span> {(testResult.data.debug_report.trigger_points_generation.average_confidence * 100).toFixed(0)}%</div>
                        <div><span className="font-medium">Primários:</span> {testResult.data.debug_report.trigger_points_generation.points_by_type.primary}</div>
                        <div><span className="font-medium">Secundários:</span> {testResult.data.debug_report.trigger_points_generation.points_by_type.secondary}</div>
                        <div><span className="font-medium">Fallback:</span> {testResult.data.debug_report.trigger_points_generation.points_by_type.fallback}</div>
                      </div>
                    </div>

                    {/* Distance Analysis */}
                    <div className="mb-4">
                      <h4 className="font-medium text-indigo-700 mb-2">📏 Análise de Distâncias</h4>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm text-indigo-600">
                        <div><span className="font-medium">Mais Próximo:</span> {testResult.data.debug_report.trigger_points_generation.distance_analysis.closest_point.toFixed(1)}m</div>
                        <div><span className="font-medium">Mais Distante:</span> {testResult.data.debug_report.trigger_points_generation.distance_analysis.furthest_point.toFixed(1)}m</div>
                        <div><span className="font-medium">Distância Média:</span> {testResult.data.debug_report.trigger_points_generation.distance_analysis.average_distance.toFixed(1)}m</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-red-50 p-4 rounded-lg">
                <h3 className="font-semibold text-red-800">❌ Erro no Teste</h3>
                <p className="text-red-600">{testResult.error}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
