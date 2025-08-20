'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'
import dynamic from 'next/dynamic'

// Carregar o componente de mapa dinamicamente para evitar problemas de SSR
const GoogleMapComponent = dynamic(
  () => import('@/components/ui/GoogleMapComponent').then(mod => ({ default: mod.GoogleMapComponent })),
  { ssr: false, loading: () => <div className="h-full bg-gray-100 animate-pulse" /> }
)

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

interface Attraction {
  id: string
  name: string
  lat: number
  lng: number
  google_types?: string[]
}

interface POVSuggestion {
  id: string
  lat: number
  lng: number
  distance_m: number
  bearing_deg: number
  access_type: 'walk' | 'car' | 'both'
  confidence_score: number
  reasoning: string
  estimated_visibility: 'poor' | 'fair' | 'good' | 'excellent'
  pattern_based: boolean
}

interface SuggestionResponse {
  success: boolean
  data: {
    poi: {
      id: string
      name: string
      lat: number
      lng: number
      types: string[]
    }
    suggestions: POVSuggestion[]
    metadata: {
      total_suggestions: number
      limit: number
      min_confidence: number
      generated_at: string
    }
  }
}

export default function POVSuggestionsPage() {
  const [attractions, setAttractions] = useState<Attraction[]>([])
  const [selectedAttraction, setSelectedAttraction] = useState<Attraction | null>(null)
  const [suggestions, setSuggestions] = useState<POVSuggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [limit, setLimit] = useState(10)
  const [minConfidence, setMinConfidence] = useState(70)
  const [showMap, setShowMap] = useState(false)
  const [selectedSuggestion, setSelectedSuggestion] = useState<POVSuggestion | null>(null)
  const [feedbackLoading, setFeedbackLoading] = useState<string | null>(null)
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null)

  // Carregar atrações disponíveis
  useEffect(() => {
    async function loadAttractions() {
      try {
        const { data, error } = await supabase
          .schema('core')
          .from('attractions')
          .select(`
            id,
            name,
            google_types,
            coordinates:attraction_coordinate(latitude, longitude)
          `)
          .not('coordinates', 'is', null)
          .limit(50)
          .order('name')

        if (error) throw error

        const attractionsWithCoords = data
          ?.filter(attr => attr.coordinates && attr.coordinates.length > 0)
          .map(attr => ({
            id: attr.id,
            name: attr.name,
            lat: attr.coordinates[0].latitude,
            lng: attr.coordinates[0].longitude,
            google_types: attr.google_types
          })) || []

        setAttractions(attractionsWithCoords)
      } catch (err) {
        console.error('Error loading attractions:', err)
        setError('Failed to load attractions')
      }
    }

    loadAttractions()
  }, [])

  // Gerar sugestões para POI selecionado
  async function generateSuggestions(attraction: Attraction) {
    setLoading(true)
    setError(null)
    setSuggestions([])

    try {
      const response = await fetch('/api/pov-suggestions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          poi_id: attraction.id,
          poi_name: attraction.name,
          poi_lat: attraction.lat,
          poi_lng: attraction.lng,
          poi_types: attraction.google_types || [],
          limit,
          min_confidence: minConfidence
        })
      })

      const result: SuggestionResponse = await response.json()

      if (!response.ok) {
        throw new Error(result.data?.suggestions ? 'API Error' : result.error || 'Unknown error')
      }

      setSuggestions(result.data.suggestions)
      setSelectedAttraction(attraction)
    } catch (err) {
      console.error('Error generating suggestions:', err)
      setError(err instanceof Error ? err.message : 'Failed to generate suggestions')
    } finally {
      setLoading(false)
    }
  }

  // Função para formatar bearing em direção
  function formatBearing(bearing: number): string {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
    const index = Math.round(bearing / 45) % 8
    return `${directions[index]} (${bearing}°)`
  }

  // Função para obter cor baseada no score
  function getScoreColor(score: number): string {
    if (score >= 90) return 'text-green-600 bg-green-100'
    if (score >= 80) return 'text-blue-600 bg-blue-100'
    if (score >= 70) return 'text-yellow-600 bg-yellow-100'
    return 'text-red-600 bg-red-100'
  }

  // Função para copiar coordenadas para clipboard
  function copyCoordinatesToClipboard(suggestion: POVSuggestion) {
    const coords = `${suggestion.lat.toFixed(6)}, ${suggestion.lng.toFixed(6)}`
    navigator.clipboard.writeText(coords).then(() => {
      setFeedbackMessage(`Coordenadas copiadas: ${coords}`)
      setTimeout(() => setFeedbackMessage(null), 2000)
    }).catch(() => {
      setFeedbackMessage('Erro ao copiar coordenadas')
      setTimeout(() => setFeedbackMessage(null), 2000)
    })
  }

  // Função para enviar feedback
  async function sendFeedback(suggestion: POVSuggestion, action: 'accept' | 'reject', feedback?: string) {
    if (!selectedAttraction) return

    setFeedbackLoading(suggestion.id)
    setFeedbackMessage(null)

    try {
      const response = await fetch('/api/pov-suggestions/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          suggestionId: suggestion.id,
          poiId: selectedAttraction.id,
          action,
          feedback,
          coordinates: {
            lat: suggestion.lat,
            lng: suggestion.lng
          }
        })
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to send feedback')
      }

      setFeedbackMessage(`${action === 'accept' ? 'Aceita' : 'Rejeitada'} com sucesso!`)
      
      // Remove a sugestão da lista após feedback
      setSuggestions(prev => prev.filter(s => s.id !== suggestion.id))
      
      // Clear message after 3 seconds
      setTimeout(() => setFeedbackMessage(null), 3000)

    } catch (err) {
      console.error('Error sending feedback:', err)
      setFeedbackMessage(err instanceof Error ? err.message : 'Erro ao enviar feedback')
    } finally {
      setFeedbackLoading(null)
    }
  }

  // Função para preparar dados do mapa
  function prepareMapData() {
    if (!selectedAttraction) return null

    const mapData = {
      center: {
        lat: selectedAttraction.lat,
        lng: selectedAttraction.lng
      },
      poi: {
        id: selectedAttraction.id,
        name: selectedAttraction.name,
        lat: selectedAttraction.lat,
        lng: selectedAttraction.lng,
        type: 'poi'
      },
      suggestions: suggestions.map((suggestion, index) => ({
        id: suggestion.id,
        name: `Sugestão ${index + 1}`,
        lat: suggestion.lat,
        lng: suggestion.lng,
        type: 'suggestion',
        score: suggestion.confidence_score,
        distance: suggestion.distance_m,
        bearing: suggestion.bearing_deg,
        access: suggestion.access_type,
        color: suggestion.confidence_score >= 90 ? 'green' : 
               suggestion.confidence_score >= 80 ? 'blue' : 
               suggestion.confidence_score >= 70 ? 'yellow' : 'red'
      }))
    }

    return mapData
  }

  // Função para selecionar sugestão no mapa
  function handleSuggestionSelect(suggestion: POVSuggestion) {
    setSelectedSuggestion(suggestion)
    setShowMap(true)
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            🎯 POV Suggestions Dashboard
          </h1>
          <p className="text-gray-600">
            Teste o sistema de sugestões de trigger points baseado em aprendizado de máquina
          </p>
        </div>

                 <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
           {/* Painel de Controle */}
           <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-xl font-semibold mb-4">⚙️ Configurações</h2>
              
              {/* Parâmetros */}
              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Número de Sugestões
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={limit}
                    onChange={(e) => setLimit(parseInt(e.target.value) || 10)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Confiança Mínima (%)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={minConfidence}
                    onChange={(e) => setMinConfidence(parseInt(e.target.value) || 70)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Lista de POIs */}
              <div>
                <h3 className="text-lg font-medium mb-3">🏛️ Selecionar POI</h3>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {attractions.map((attraction) => (
                    <button
                      key={attraction.id}
                      onClick={() => generateSuggestions(attraction)}
                      disabled={loading}
                      className={`w-full text-left p-3 rounded-md border transition-colors ${
                        selectedAttraction?.id === attraction.id
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      } ${loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      <div className="font-medium text-gray-900">{attraction.name}</div>
                      <div className="text-sm text-gray-500">
                        {attraction.lat.toFixed(4)}, {attraction.lng.toFixed(4)}
                      </div>
                      {attraction.google_types && attraction.google_types.length > 0 && (
                        <div className="text-xs text-gray-400 mt-1">
                          {attraction.google_types.slice(0, 2).join(', ')}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

                     {/* Resultados */}
           <div className="lg:col-span-2">
             <div className="bg-white rounded-lg shadow-md p-6">
               <div className="flex justify-between items-center mb-4">
                 <h2 className="text-xl font-semibold">
                   🎯 Sugestões de Trigger Points
                 </h2>
                 {suggestions.length > 0 && (
                   <button
                     onClick={() => setShowMap(!showMap)}
                     className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                   >
                     {showMap ? '🔍 Ocultar Mapa' : '🗺️ Ver no Mapa'}
                   </button>
                 )}
               </div>

              {loading && (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
                  <p className="text-gray-600">Gerando sugestões...</p>
                </div>
              )}

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-4">
                  <div className="flex">
                    <div className="text-red-400">⚠️</div>
                    <div className="ml-3">
                      <h3 className="text-sm font-medium text-red-800">Erro</h3>
                      <p className="text-sm text-red-700 mt-1">{error}</p>
                    </div>
                  </div>
                </div>
              )}

              {feedbackMessage && (
                <div className="bg-green-50 border border-green-200 rounded-md p-4 mb-4">
                  <div className="flex">
                    <div className="text-green-400">✅</div>
                    <div className="ml-3">
                      <h3 className="text-sm font-medium text-green-800">Feedback</h3>
                      <p className="text-sm text-green-700 mt-1">{feedbackMessage}</p>
                    </div>
                  </div>
                </div>
              )}

              {selectedAttraction && !loading && (
                <div className="mb-4">
                  <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
                    <h3 className="font-medium text-blue-900 mb-2">
                      POI Selecionado: {selectedAttraction.name}
                    </h3>
                    <p className="text-sm text-blue-700">
                      Coordenadas: {selectedAttraction.lat.toFixed(6)}, {selectedAttraction.lng.toFixed(6)}
                    </p>
                    {selectedAttraction.google_types && selectedAttraction.google_types.length > 0 && (
                      <p className="text-sm text-blue-600 mt-1">
                        Tipos: {selectedAttraction.google_types.join(', ')}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {suggestions.length > 0 && (
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <p className="text-sm text-gray-600">
                      {suggestions.length} sugestões encontradas
                    </p>
                    <div className="text-sm text-gray-500">
                      Confiança mínima: {minConfidence}%
                    </div>
                  </div>

                                     <div className="space-y-3">
                     {suggestions.map((suggestion, index) => (
                       <div
                         key={suggestion.id}
                         className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors cursor-pointer"
                         onClick={() => handleSuggestionSelect(suggestion)}
                       >
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex items-center space-x-2">
                            <span className="text-lg font-medium text-gray-900">
                              #{index + 1}
                            </span>
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${getScoreColor(suggestion.confidence_score)}`}>
                              {suggestion.confidence_score.toFixed(1)}%
                            </span>
                          </div>
                          <div className="text-sm text-gray-500">
                            {suggestion.pattern_based ? '📊 Padrão' : '🤖 IA'}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <span className="font-medium text-gray-700">Distância:</span>
                            <br />
                            <span className="text-gray-900">{suggestion.distance_m}m</span>
                          </div>
                          <div>
                            <span className="font-medium text-gray-700">Direção:</span>
                            <br />
                            <span className="text-gray-900">{formatBearing(suggestion.bearing_deg)}</span>
                          </div>
                          <div>
                            <span className="font-medium text-gray-700">Acesso:</span>
                            <br />
                            <span className="text-gray-900 capitalize">{suggestion.access_type}</span>
                          </div>
                          <div>
                            <span className="font-medium text-gray-700">Visibilidade:</span>
                            <br />
                            <span className="text-gray-900 capitalize">{suggestion.estimated_visibility}</span>
                          </div>
                        </div>

                        <div className="mt-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="font-medium text-gray-700 text-sm">Coordenadas:</span>
                              <br />
                              <span className="text-gray-900 text-sm font-mono">
                                {suggestion.lat.toFixed(6)}, {suggestion.lng.toFixed(6)}
                              </span>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                copyCoordinatesToClipboard(suggestion)
                              }}
                              className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition-colors"
                              title="Copiar coordenadas"
                            >
                              📋
                            </button>
                          </div>
                        </div>

                        {suggestion.reasoning && (
                          <div className="mt-3 pt-3 border-t border-gray-100">
                            <span className="font-medium text-gray-700 text-sm">Justificativa:</span>
                            <br />
                            <span className="text-gray-600 text-sm">{suggestion.reasoning}</span>
                          </div>
                        )}

                        {/* Botões de Feedback */}
                        <div className="mt-4 pt-3 border-t border-gray-100">
                          <div className="flex space-x-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                sendFeedback(suggestion, 'accept')
                              }}
                              disabled={feedbackLoading === suggestion.id}
                              className="flex-1 px-3 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                              {feedbackLoading === suggestion.id ? '⏳' : '✅'} Aceitar
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                const feedback = prompt('Motivo da rejeição (opcional):')
                                if (feedback !== null) {
                                  sendFeedback(suggestion, 'reject', feedback)
                                }
                              }}
                              disabled={feedbackLoading === suggestion.id}
                              className="flex-1 px-3 py-2 bg-red-600 text-white text-sm font-medium rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                              {feedbackLoading === suggestion.id ? '⏳' : '❌'} Rejeitar
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedAttraction && suggestions.length === 0 && !loading && !error && (
                <div className="text-center py-8">
                  <div className="text-gray-400 text-6xl mb-4">🎯</div>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">
                    Nenhuma sugestão encontrada
                  </h3>
                  <p className="text-gray-600">
                    Tente reduzir a confiança mínima ou selecionar outro POI
                  </p>
                </div>
              )}

              {!selectedAttraction && !loading && (
                <div className="text-center py-8">
                  <div className="text-gray-400 text-6xl mb-4">🏛️</div>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">
                    Selecione um POI
                  </h3>
                  <p className="text-gray-600">
                    Escolha um ponto de interesse para gerar sugestões de trigger points
                  </p>
                </div>
                             )}
             </div>
           </div>

           {/* Mapa */}
           {showMap && selectedAttraction && (
             <div className="lg:col-span-1">
               <div className="bg-white rounded-lg shadow-md p-6">
                 <h2 className="text-xl font-semibold mb-4">🗺️ Mapa</h2>
                 <div className="h-96 rounded-lg overflow-hidden">
                   <GoogleMapComponent
                     center={{
                       lat: selectedAttraction.lat,
                       lng: selectedAttraction.lng
                     }}
                     zoom={16}
                     height="100%"
                     className="w-full"
                     markers={[
                       {
                         id: selectedAttraction.id,
                         position: { lat: selectedAttraction.lat, lng: selectedAttraction.lng },
                         title: selectedAttraction.name,
                         description: 'POI Principal',
                         color: '#FF0000'
                       },
                       ...suggestions.map((suggestion, index) => ({
                         id: suggestion.id,
                         position: { lat: suggestion.lat, lng: suggestion.lng },
                         title: `Sugestão ${index + 1}`,
                         description: `Score: ${suggestion.confidence_score.toFixed(1)}% | Distância: ${suggestion.distance_m}m | Acesso: ${suggestion.access_type}`,
                         color: suggestion.confidence_score >= 90 ? '#10B981' : 
                                suggestion.confidence_score >= 80 ? '#3B82F6' : 
                                suggestion.confidence_score >= 70 ? '#F59E0B' : '#EF4444'
                       }))
                     ]}
                     onMarkerClick={(markerId) => {
                       const suggestion = suggestions.find(s => s.id === markerId)
                       if (suggestion) {
                         setSelectedSuggestion(suggestion)
                       }
                     }}
                   />
                 </div>
                 
                 {selectedSuggestion && (
                   <div className="mt-4 p-3 bg-blue-50 rounded-lg">
                     <h3 className="font-medium text-blue-900 mb-2">
                       Sugestão Selecionada
                     </h3>
                     <div className="text-sm text-blue-800 space-y-1">
                       <p><strong>Score:</strong> {selectedSuggestion.confidence_score.toFixed(1)}%</p>
                       <p><strong>Distância:</strong> {selectedSuggestion.distance_m}m</p>
                       <p><strong>Direção:</strong> {formatBearing(selectedSuggestion.bearing_deg)}</p>
                       <p><strong>Acesso:</strong> {selectedSuggestion.access_type}</p>
                       <p><strong>Coordenadas:</strong> {selectedSuggestion.lat.toFixed(6)}, {selectedSuggestion.lng.toFixed(6)}</p>
                     </div>
                   </div>
                 )}
               </div>
             </div>
           )}
         </div>
       </div>
     </div>
   )
 }
