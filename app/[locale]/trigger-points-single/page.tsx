'use client'

import { useState } from 'react'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import { 
  Search, Target, Loader2, AlertCircle, CheckCircle, Info
} from 'lucide-react'
import { useTriggerPointsGeneration } from '@/lib/hooks/use-trigger-points-generation'
import { TriggerPointsMap } from '@/components/trigger-points/TriggerPointsMap'
import { TriggerPointsMetadata } from '@/components/trigger-points/TriggerPointsMetadata'
import { TriggerPointsList } from '@/components/trigger-points/TriggerPointsList'
import { TriggerPointsStatistics } from '@/components/trigger-points/TriggerPointsStatistics'

interface POIInfo {
  id: string
  name: string
  location: { lat: number; lng: number }
  type: string
  country: string
  city: string
  state?: string
  // 🆕 Campos opcionais para OSM ID
  osm_id?: string | number
  osm_type?: 'node' | 'way' | 'relation'
  osm_tags?: any
}

export default function TriggerPointsSinglePage() {
  const supabase = useSupabaseClient()
  const {
    generate: generateTriggerPoints,
    isLoading: isGenerating,
    error: generationError,
    metadata,
    boundary,
    triggerPoints,
    statistics,
    reset: resetGeneration
  } = useTriggerPointsGeneration()
  
  // State
  const [poiId, setPoiId] = useState('')
  const [poiInfo, setPoiInfo] = useState<POIInfo | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  
  // UI State
  const [showBoundary, setShowBoundary] = useState(true)
  const [showTriggerPoints, setShowTriggerPoints] = useState(true)
  const [showSearchRadius, setShowSearchRadius] = useState(true)
  const [showStatistics, setShowStatistics] = useState(false)

  // Visibility-driven mode — default ON (motor padrão agora)
  const [useVisibilityMap, setUseVisibilityMap] = useState(true)

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
    resetGeneration()

    try {
      console.log(`🔍 Searching for POI: ${poiId}`)
      
      const { data, error } = await supabase
        .schema('core')
        .from('attractions')
        .select(`
          id, 
          name, 
          category, 
          country, 
          city, 
          state,
          osm_id,
          osm_type,
          osm_tags,
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

      // 🆕 Extrair OSM ID e tipo (prioridade: colunas diretas > osm_tags)
      // 1. Tentar colunas diretas da tabela (mais confiável)
      let osmId = data.osm_id;
      let osmType = data.osm_type;
      
      // 2. Se não tiver nas colunas, tentar extrair de osm_tags
      if (!osmId || !osmType) {
        const osmTags = data.osm_tags || {};
        osmId = osmId || osmTags['@id'] || osmTags.id || osmTags.osm_id;
        // Para osm_type, normalizar valores (ex: "way" de "way/8100248" ou de @type)
        if (!osmType) {
          const rawType = osmTags['@type'] || osmTags.type || osmTags.osm_type;
          // Normalizar: se vier "way/8100248", extrair "way"
          if (typeof rawType === 'string' && rawType.includes('/')) {
            osmType = rawType.split('/')[0] as 'node' | 'way' | 'relation';
          } else if (rawType && ['node', 'way', 'relation'].includes(rawType.toLowerCase())) {
            osmType = rawType.toLowerCase() as 'node' | 'way' | 'relation';
          }
        }
      }
      
      // Normalizar osm_type para garantir que seja válido
      if (osmType && !['node', 'way', 'relation'].includes(osmType.toLowerCase())) {
        console.warn(`⚠️ Invalid osm_type: ${osmType}, ignoring OSM ID lookup`);
        osmId = undefined;
        osmType = undefined;
      }
      
      const osmTags = data.osm_tags || {};
      
      const poi: POIInfo = {
        id: data.id,
        name: data.name,
        location: { 
          lat: (data.coordinates as any).latitude, 
          lng: (data.coordinates as any).longitude 
        },
        type: data.category || 'unknown',
        country: data.country,
        city: data.city,
        state: data.state,
        // 🆕 Incluir OSM ID se disponível
        ...(osmId && { osm_id: osmId }),
        ...(osmType && { osm_type: osmType as 'node' | 'way' | 'relation' }),
        ...(osmTags && Object.keys(osmTags).length > 0 && { osm_tags: osmTags })
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

  // Gerar trigger points usando hook
  const handleGenerateTriggerPoints = async () => {
    if (!poiInfo) {
      setError('Por favor, busque um POI primeiro')
      return
    }

    setError(null)
    setSuccess(null)
    
    await generateTriggerPoints(poiInfo, { useVisibilityMap })
    
    if (generationError) {
      setError(generationError)
    } else if (triggerPoints.length > 0) {
      setSuccess(`Gerados ${triggerPoints.length} trigger points`)
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

  const displayError = error || generationError
  const displaySuccess = success

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            Trigger Points - Teste Individual
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Teste o sistema de geração de trigger points para um único POI
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
                  onClick={handleGenerateTriggerPoints}
                  disabled={isGenerating || !poiInfo}
                  className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Target className="h-4 w-4" />}
                  Gerar Trigger Points
                </button>

                {/* Visibility-driven mode toggle (DEFAULT ON) */}
                <label className="flex items-start gap-3 mt-2 p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-md cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useVisibilityMap}
                    onChange={(e) => setUseVisibilityMap(e.target.checked)}
                    className="mt-1 rounded"
                  />
                  <div className="text-xs">
                    <div className="font-semibold text-emerald-900 dark:text-emerald-100">
                      👁️ Modo Visibility-Driven (padrão)
                    </div>
                    <div className="text-emerald-800 dark:text-emerald-200 mt-1">
                      Motor físico: ray-cast 2.5D usando alturas dos prédios + SRTM.
                      Substitui filtros categóricos. Desmarque para usar o motor categórico legado.
                    </div>
                  </div>
                </label>
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
              
              <TriggerPointsMap
                poiInfo={poiInfo}
                triggerPoints={triggerPoints}
                boundary={boundary}
                metadata={metadata}
                showBoundary={showBoundary}
                showTriggerPoints={showTriggerPoints}
                showSearchRadius={showSearchRadius}
              />
            </div>

            {/* Metadata */}
            {metadata && (
              <TriggerPointsMetadata
                metadata={metadata}
                boundary={boundary}
              />
            )}

            {/* Estatísticas */}
            <TriggerPointsStatistics
              statistics={statistics}
              show={showStatistics}
            />

            {/* Lista de Trigger Points */}
            <TriggerPointsList triggerPoints={triggerPoints} />

            {/* Mensagens */}
            {displayError && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-red-500" />
                  <span className="text-red-700 dark:text-red-300 font-medium">Erro</span>
                </div>
                <p className="text-red-600 dark:text-red-400 mt-1">{displayError}</p>
              </div>
            )}

            {displaySuccess && (
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  <span className="text-green-700 dark:text-green-300 font-medium">Sucesso</span>
                </div>
                <p className="text-green-600 dark:text-green-400 mt-1">{displaySuccess}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
