'use client'

import { useState, useEffect } from 'react'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import { 
  Search, MapPin, Target, Loader2, AlertCircle, CheckCircle, 
  Eye, EyeOff, Settings, Download, RefreshCw, Info
} from 'lucide-react'
import { GoogleMapComponent } from '@/components/ui/GoogleMapComponent'
import { POIData, TriggerPoint } from '@/lib/services/trigger-points-google/types/interfaces'

interface POIInfo {
  id: string
  name: string
  location: { lat: number; lng: number }
  type: string
  country: string
  city: string
  state?: string
}

interface TriggerPointResult {
  poiId: string
  poiName: string
  triggerPoints: TriggerPoint[]
  count: number
  generatedAt: string
  processingTime: number
  statistics: any
  metadata?: {
    boundarySource: string
    boundaryConfidence: number
    streetCount: number
    searchRadius: number
    optimalPointsFound?: number
    streetValidatedCandidates?: number
    validatedPoints?: number
    finalPoints?: number
    elevationAnalysis?: {
      poiElevation?: number
      baseElevation?: number
      elevationDiff?: number
      isHighVisibility?: boolean
    } | null
    fallbackUsed: boolean
  }
}

export default function TestTriggerPointsGooglePage() {
  const supabase = useSupabaseClient()
  
  // State
  const [poiId, setPoiId] = useState('')
  const [poiInfo, setPoiInfo] = useState<POIInfo | null>(null)
  const [triggerPoints, setTriggerPoints] = useState<TriggerPoint[]>([])
  const [boundary, setBoundary] = useState<{
    coordinates: Array<{lat: number, lng: number}>
    classification?: {
      group?: string
      strategy?: string
      reasoning?: string
    }
  } | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  
  // UI State
  const [showBoundary, setShowBoundary] = useState(true)
  const [showTriggerPoints, setShowTriggerPoints] = useState(true)
  const [showSearchRadius, setShowSearchRadius] = useState(true)
  const [showStatistics, setShowStatistics] = useState(false)
  const [statistics, setStatistics] = useState<any>(null)
  const [metadata, setMetadata] = useState<any>(null)
  
  // Options - REMOVIDO: Usar apenas lógica matemática do código
  // const [options, setOptions] = useState({
  //   maxSearchRadius: 1000,
  //   minQuality: 0.3,
  //   maxTriggerPoints: 10
  // })

  // Buscar POI por ID
  const searchPOI = async () => {
    if (!poiId.trim()) {
      setError('Por favor, insira um ID de POI')
      return
    }

    setIsLoading(true)
    setError(null)
    setSuccess(null)
    setPoiInfo(null)
    setTriggerPoints([])
    setBoundary(null)
    setStatistics(null)

    try {
      console.log(`🔍 Searching for POI: ${poiId}`)
      
      const { data, error } = await supabase
        .schema('core')
        .from('attractions')
        .select(`
          id, 
          name, 
          google_types, 
          country, 
          city, 
          state,
          coordinates:attraction_coordinate!inner(latitude, longitude)
        `)
        .eq('id', poiId)
        .single()

      if (error) {
        throw new Error(`Database error: ${error.message}`)
      }

      if (!data) {
        throw new Error('POI não encontrado')
      }

      const poi: POIInfo = {
        id: data.id,
        name: data.name,
        location: { 
          lat: (data.coordinates as any).latitude, 
          lng: (data.coordinates as any).longitude 
        },
        type: data.google_types?.[0] || 'unknown',
        country: data.country,
        city: data.city,
        state: data.state
      }

      setPoiInfo(poi)
      setSuccess(`POI encontrado: ${poi.name}`)
      
      console.log(`✅ POI found: ${poi.name} at ${poi.location.lat}, ${poi.location.lng}`)
      
    } catch (err) {
      console.error('Error searching POI:', err)
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }

  // Gerar trigger points
  const generateTriggerPoints = async () => {
    if (!poiInfo) {
      setError('Por favor, busque um POI primeiro')
      return
    }

    setIsLoading(true)
    setError(null)
    setSuccess(null)
    setTriggerPoints([])
    setBoundary(null)
    setStatistics(null)

    try {
      console.log(`🚀 Generating trigger points for: ${poiInfo.name}`)
      
      const response = await fetch('/api/trigger-points/google/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          poiData: poiInfo
          // options removido - usar apenas lógica matemática do código
        })
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Erro na geração de trigger points')
      }

      if (!result.success) {
        throw new Error(result.error || 'Falha na geração de trigger points')
      }

      const triggerPointResult: TriggerPointResult = result.data
      
      setTriggerPoints(triggerPointResult.triggerPoints)
      setStatistics(triggerPointResult.statistics)
      // Metadata está no nível raiz da resposta, não dentro de data
      setMetadata(result.metadata || triggerPointResult.metadata)
      setSuccess(`Gerados ${triggerPointResult.count} trigger points em ${triggerPointResult.processingTime}ms`)
      
      // Extrair boundary se disponível
      if (result.boundary) {
        setBoundary(result.boundary)
        console.log(`📐 Boundary extracted: ${result.boundary.coordinates.length} points, confidence: ${result.boundary.confidence}`)
      }
      
      // Log metadados para debugging
      const metadataToLog = result.metadata || triggerPointResult.metadata
      if (metadataToLog) {
        console.log(`📊 Metadata:`, metadataToLog)
        if (metadataToLog.searchRadius) {
          console.log(`🎯 Search radius: ${metadataToLog.searchRadius}m`)
        }
        if (metadataToLog.elevationAnalysis) {
          console.log(`🏔️ Elevation analysis:`, metadataToLog.elevationAnalysis)
        }
      }
      
      console.log(`✅ Generated ${triggerPointResult.count} trigger points`)
      
    } catch (err) {
      console.error('Error generating trigger points:', err)
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }

  // Analisar contexto geográfico
  const analyzeContext = async () => {
    if (!poiInfo) {
      setError('Por favor, busque um POI primeiro')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      console.log(`🌍 Analyzing geographic context for: ${poiInfo.name}`)
      
      const response = await fetch('/api/trigger-points/google/analyze-context', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          location: poiInfo.location,
          poiName: poiInfo.name,
          poiType: poiInfo.type
        })
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Erro na análise de contexto')
      }

      if (!result.success) {
        throw new Error(result.error || 'Falha na análise de contexto')
      }

      console.log('✅ Geographic context analyzed:', result.data.context)
      setSuccess('Contexto geográfico analisado com sucesso')
      
    } catch (err) {
      console.error('Error analyzing context:', err)
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }

  // Preparar dados para o mapa
  const mapMarkers = poiInfo ? [{
    id: 'poi',
    position: poiInfo.location,
    title: poiInfo.name,
    description: `${poiInfo.type} - ${poiInfo.city}, ${poiInfo.country}`,
    color: '#FF0000'
  }] : []

  const mapCircles = [
    // Trigger points circles
    ...(showTriggerPoints ? triggerPoints.map(tp => ({
      id: tp.id,
      center: tp.location,
      radius: tp.radius,
      strokeColor: getTriggerPointColor(tp.type),
      strokeOpacity: 0.8,
      strokeWeight: 2,
      fillColor: getTriggerPointColor(tp.type),
      fillOpacity: 0.2
    })) : []),
    // Search radius circle
    ...(showSearchRadius && poiInfo && metadata?.searchRadius ? [{
      id: 'search-radius',
      center: poiInfo.location,
      radius: metadata.searchRadius,
      strokeColor: '#8B5CF6', // Purple
      strokeOpacity: 0.6,
      strokeWeight: 3,
      fillColor: '#8B5CF6',
      fillOpacity: 0.1
    }] : [])
  ]

  const mapPolygon = showBoundary && boundary ? boundary.coordinates : null

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            Teste - Trigger Points Google APIs
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Teste o sistema de geração de trigger points migrado para Google APIs
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Controles */}
          <div className="lg:col-span-1 space-y-6">
            {/* Busca de POI */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                Buscar POI
              </h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    ID do POI
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={poiId}
                      onChange={(e) => setPoiId(e.target.value)}
                      placeholder="Digite o ID do POI"
                      className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    />
                    <button
                      onClick={searchPOI}
                      disabled={isLoading}
                      className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                    >
                      {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                      Buscar
                    </button>
                  </div>
                </div>

                {poiInfo && (
                  <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-md">
                    <h3 className="font-medium text-green-800 dark:text-green-200 mb-2">
                      POI Encontrado
                    </h3>
                    <p className="text-sm text-green-700 dark:text-green-300">
                      <strong>{poiInfo.name}</strong><br />
                      {poiInfo.type} - {poiInfo.city}, {poiInfo.country}<br />
                      {poiInfo.location.lat.toFixed(6)}, {poiInfo.location.lng.toFixed(6)}
                    </p>
                  </div>
                )}
              </div>
            </div>

           

            {/* Ações */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                Ações
              </h2>
              
              <div className="space-y-3">
                <button
                  onClick={analyzeContext}
                  disabled={isLoading || !poiInfo}
                  className="w-full px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Info className="h-4 w-4" />}
                  Analisar Contexto
                </button>

                <button
                  onClick={generateTriggerPoints}
                  disabled={isLoading || !poiInfo}
                  className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Target className="h-4 w-4" />}
                  Gerar Trigger Points
                </button>
              </div>
            </div>

            {/* Controles de Visualização */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                Visualização
              </h2>
              
              <div className="space-y-3">
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={showBoundary}
                    onChange={(e) => setShowBoundary(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    Mostrar Boundary
                  </span>
                </label>

                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={showTriggerPoints}
                    onChange={(e) => setShowTriggerPoints(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    Mostrar Trigger Points
                  </span>
                </label>

                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={showSearchRadius}
                    onChange={(e) => setShowSearchRadius(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    Mostrar Raio de Busca
                  </span>
                </label>

                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={showStatistics}
                    onChange={(e) => setShowStatistics(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    Mostrar Estatísticas
                  </span>
                </label>
              </div>
            </div>
          </div>

          {/* Mapa e Resultados */}
          <div className="lg:col-span-2 space-y-6">
            {/* Mapa */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                Mapa
              </h2>
              
              <div className="h-96 rounded-lg overflow-hidden">
                <GoogleMapComponent
                  center={poiInfo?.location || { lat: -23.5505, lng: -46.6333 }}
                  zoom={15}
                  markers={mapMarkers}
                  circles={mapCircles}
                  polygon={mapPolygon || undefined}
                  height="100%"
                />
              </div>
            </div>

            {/* Informações de Elevação e Raio */}
            {metadata && (
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                  Análise de Raio de Busca
                </h2>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Raio de Busca */}
                  <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                    <h3 className="font-semibold text-purple-800 dark:text-purple-200 mb-2">
                      Raio Calculado
                    </h3>
                    <div className="text-2xl font-bold text-purple-600">
                      {metadata.searchRadius ? `${metadata.searchRadius}m` : 'N/A'}
                    </div>
                    <div className="text-sm text-purple-700 dark:text-purple-300 mt-1">
                      {metadata.searchRadius > 2000 ? 'Landmark de Alta Elevação' : 
                       metadata.searchRadius > 1000 ? 'POI Elevado' : 
                       'POI Padrão'}
                    </div>
                  </div>

                  {/* Informações do Boundary */}
                  <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                    <h3 className="font-semibold text-blue-800 dark:text-blue-200 mb-2">
                      Boundary
                    </h3>
                    <div className="text-lg font-bold text-blue-600">
                      {metadata.boundarySource}
                    </div>
                    <div className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                      Confiança: {(metadata.boundaryConfidence * 100).toFixed(1)}%
                    </div>
                    <div className="text-sm text-blue-700 dark:text-blue-300">
                      {metadata.streetCount} ruas encontradas
                    </div>
                    {/* Classificação do POI */}
                    {boundary?.classification?.group && (
                      <div className="mt-2 pt-2 border-t border-blue-200 dark:border-blue-700">
                        <div className="text-xs font-semibold text-blue-600 uppercase">
                          {boundary.classification.group === 'high' && '🏔️ HIGH'}
                          {boundary.classification.group === 'medium' && '🏗️ MEDIUM'}
                          {boundary.classification.group === 'canyon' && '🏙️ CANYON'}
                          {boundary.classification.group === 'flat' && '🏞️ FLAT'}
                        </div>
                        {boundary.classification.strategy && (
                          <div className="text-xs text-blue-600 mt-1">
                            Estratégia: {boundary.classification.strategy}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Análise de Elevação */}
                {metadata.elevationAnalysis && (
                  <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                    <h3 className="font-semibold text-green-800 dark:text-green-200 mb-3">
                      Análise de Elevação
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="text-center">
                        <div className="text-lg font-bold text-green-600">
                          {metadata.elevationAnalysis.poiElevation != null 
                            ? `${metadata.elevationAnalysis.poiElevation.toFixed(0)}m`
                            : 'N/A'}
                        </div>
                        <div className="text-sm text-green-700 dark:text-green-300">POI</div>
                      </div>
                      <div className="text-center">
                        <div className="text-lg font-bold text-green-600">
                          {metadata.elevationAnalysis.baseElevation != null
                            ? `${metadata.elevationAnalysis.baseElevation.toFixed(0)}m`
                            : 'N/A'}
                        </div>
                        <div className="text-sm text-green-700 dark:text-green-300">Base Regional</div>
                      </div>
                      <div className="text-center">
                        <div className="text-lg font-bold text-green-600">
                          {metadata.elevationAnalysis.elevationDiff != null
                            ? `+${metadata.elevationAnalysis.elevationDiff.toFixed(0)}m`
                            : 'N/A'}
                        </div>
                        <div className="text-sm text-green-700 dark:text-green-300">Diferença</div>
                      </div>
                      <div className="text-center">
                        <div className={`text-lg font-bold ${metadata.elevationAnalysis.isHighVisibility ? 'text-orange-600' : 'text-green-600'}`}>
                          {metadata.elevationAnalysis.isHighVisibility ? 'ALTA' : 'Normal'}
                        </div>
                        <div className="text-sm text-green-700 dark:text-green-300">Visibilidade</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Processamento de Pontos */}
                {(metadata.optimalPointsFound !== undefined || metadata.streetValidatedCandidates !== undefined) && (
                  <div className="mt-4 p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg">
                    <h3 className="font-semibold text-indigo-800 dark:text-indigo-200 mb-3">
                      Processamento de Pontos
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {metadata.optimalPointsFound !== undefined && (
                        <div className="text-center">
                          <div className="text-lg font-bold text-indigo-600">
                            {metadata.optimalPointsFound}
                          </div>
                          <div className="text-sm text-indigo-700 dark:text-indigo-300">Ótimos Encontrados</div>
                        </div>
                      )}
                      {metadata.streetValidatedCandidates !== undefined && (
                        <div className="text-center">
                          <div className="text-lg font-bold text-indigo-600">
                            {metadata.streetValidatedCandidates}
                          </div>
                          <div className="text-sm text-indigo-700 dark:text-indigo-300">Validados em Ruas</div>
                        </div>
                      )}
                      {metadata.validatedPoints !== undefined && (
                        <div className="text-center">
                          <div className="text-lg font-bold text-indigo-600">
                            {metadata.validatedPoints}
                          </div>
                          <div className="text-sm text-indigo-700 dark:text-indigo-300">Validados</div>
                        </div>
                      )}
                      {metadata.finalPoints !== undefined && (
                        <div className="text-center">
                          <div className="text-lg font-bold text-indigo-600">
                            {metadata.finalPoints}
                          </div>
                          <div className="text-sm text-indigo-700 dark:text-indigo-300">Finais</div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Estatísticas */}
            {showStatistics && statistics && (
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                  Estatísticas
                </h2>
                
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-600">{statistics.total}</div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">Total</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600">{statistics.byType.primary || 0}</div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">Primários</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-yellow-600">{statistics.byType.secondary || 0}</div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">Secundários</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-gray-600">{statistics.byType.fallback || 0}</div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">Fallback</div>
                  </div>
                </div>
                
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div className="text-center">
                    <div className="text-lg font-semibold text-purple-600">
                      {(statistics.averageQuality * 100).toFixed(1)}%
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">Qualidade Média</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-semibold text-indigo-600">
                      {(statistics.averageConfidence * 100).toFixed(1)}%
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">Confiança Média</div>
                  </div>
                </div>
              </div>
            )}

            {/* Lista de Trigger Points */}
            {triggerPoints.length > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                  Trigger Points ({triggerPoints.length})
                </h2>
                
                <div className="space-y-3 max-h-64 overflow-y-auto">
                  {triggerPoints.map((tp, index) => (
                    <div key={tp.id} className="p-3 border border-gray-200 dark:border-gray-600 rounded-md">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div 
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: getTriggerPointColor(tp.type) }}
                          />
                          <span className="font-medium text-gray-900 dark:text-white">
                            {tp.type.charAt(0).toUpperCase() + tp.type.slice(1)} #{index + 1}
                          </span>
                        </div>
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                          {tp.distance.toFixed(0)}m
                        </span>
                      </div>
                      
                      <div className="text-sm text-gray-600 dark:text-gray-400">
                        <div>Localização: {tp.location.lat.toFixed(6)}, {tp.location.lng.toFixed(6)}</div>
                        <div>Raio: {tp.radius}m | Qualidade: {(tp.quality * 100).toFixed(1)}% | Confiança: {(tp.confidence * 100).toFixed(1)}%</div>
                        <div>Bearing: {tp.expectedBearing.toFixed(0)}° | Prioridade: {tp.priority}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Mensagens */}
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-red-500" />
                  <span className="text-red-700 dark:text-red-300 font-medium">Erro</span>
                </div>
                <p className="text-red-600 dark:text-red-400 mt-1">{error}</p>
              </div>
            )}

            {success && (
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  <span className="text-green-700 dark:text-green-300 font-medium">Sucesso</span>
                </div>
                <p className="text-green-600 dark:text-green-400 mt-1">{success}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Função auxiliar para obter cor do trigger point
function getTriggerPointColor(type: string): string {
  switch (type) {
    case 'primary':
      return '#10B981' // Verde
    case 'secondary':
      return '#F59E0B' // Amarelo
    case 'fallback':
      return '#6B7280' // Cinza
    default:
      return '#3B82F6' // Azul
  }
}

