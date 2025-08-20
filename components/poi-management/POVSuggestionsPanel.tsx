'use client'

import { useState, useEffect } from 'react'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import { Sparkles, MapPin, Target, Plus, Loader2, RefreshCw, CheckCircle, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface POVSuggestion {
  id: string
  lat: number
  lng: number
  distance_m: number
  bearing_deg: number
  access_type: 'walk' | 'car' | 'both'
  estimated_visibility: string
  confidence_score: number
  reasoning: string
  pattern_based: boolean
}

interface POVSuggestionsPanelProps {
  attractionId: string
  attractionName: string
  attractionCoordinates: { lat: number; lng: number }
  attractionTypes?: string[]
  onTriggerPointAdded: () => void
  onSuggestionsChange?: (suggestions: POVSuggestion[]) => void
  autoGenerate?: boolean
}

export function POVSuggestionsPanel({
  attractionId,
  attractionName,
  attractionCoordinates,
  attractionTypes = [],
  onTriggerPointAdded,
  onSuggestionsChange,
  autoGenerate = false
}: POVSuggestionsPanelProps) {
  const supabase = useSupabaseClient()
  const [suggestions, setSuggestions] = useState<POVSuggestion[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [addingIds, setAddingIds] = useState<Set<string>>(new Set())

  // Auto-generate suggestions when component mounts if requested
  useEffect(() => {
    if (autoGenerate && suggestions.length === 0 && !isLoading) {
      console.log('🤖 Auto-generating POV suggestions...')
      generateSuggestions()
    }
  }, [autoGenerate]) // Only run when autoGenerate changes

  // Gerar sugestões
  async function generateSuggestions() {
    setIsLoading(true)
    setError(null)
    setSuggestions([])

    try {
      const response = await fetch('/api/pov-suggestions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          poi_id: attractionId,
          poi_name: attractionName,
          poi_lat: attractionCoordinates.lat,
          poi_lng: attractionCoordinates.lng,
          poi_types: attractionTypes,
          limit: 8,
          min_confidence: 60
        })
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to generate suggestions')
      }

      setSuggestions(result.data.suggestions)
      onSuggestionsChange?.(result.data.suggestions)
    } catch (err) {
      console.error('Error generating suggestions:', err)
      setError(err instanceof Error ? err.message : 'Failed to generate suggestions')
      setSuggestions([])
      onSuggestionsChange?.([])
    } finally {
      setIsLoading(false)
    }
  }

  // Calcular bearing do trigger point para o POI
  function calculateBearing(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
    const φ1 = fromLat * Math.PI / 180
    const φ2 = toLat * Math.PI / 180
    const Δλ = (toLng - fromLng) * Math.PI / 180

    const y = Math.sin(Δλ) * Math.cos(φ2)
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)

    let bearing = Math.atan2(y, x) * 180 / Math.PI
    bearing = (bearing + 360) % 360

    return Math.round(bearing)
  }

  // Adicionar trigger point baseado na sugestão
  async function addTriggerPointFromSuggestion(suggestion: POVSuggestion) {
    setAddingIds(prev => new Set([...prev, suggestion.id]))

    try {
      // Calcular bearing do trigger point para o POI
      const expectedBearing = calculateBearing(
        suggestion.lat, 
        suggestion.lng, 
        attractionCoordinates.lat, 
        attractionCoordinates.lng
      )

      // Criar trigger point usando a API do Supabase
      const { error } = await supabase
        .schema('core')
        .from('attraction_trigger_points')
        .insert({
          attraction_id: attractionId,
          location: `POINT(${suggestion.lng} ${suggestion.lat})`,
          type: 'primary',
          priority: 1,
          radius_meters: 50,
          is_active: true,
          expected_bearing: expectedBearing,
          bearing_threshold: 15,
          name: `POV Suggestion ${suggestion.distance_m}m`,
          description: `AI suggested POV: ${suggestion.reasoning} | Bearing: ${expectedBearing}°`,
          access: suggestion.access_type || 'both'
        })

      if (error) {
        throw error
      }

      // Enviar feedback positivo para o sistema de aprendizado
      await fetch('/api/pov-suggestions/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          suggestionId: suggestion.id,
          poiId: attractionId,
          action: 'accept',
          feedback: 'Added as trigger point from POI management',
          coordinates: {
            lat: suggestion.lat,
            lng: suggestion.lng
          }
        })
      })

      // Remover da lista de sugestões
      const newSuggestions = suggestions.filter(s => s.id !== suggestion.id)
      setSuggestions(newSuggestions)
      onSuggestionsChange?.(newSuggestions)
      
      // Notificar o componente pai
      onTriggerPointAdded()

    } catch (err) {
      console.error('Error adding trigger point:', err)
      setError(err instanceof Error ? err.message : 'Failed to add trigger point')
    } finally {
      setAddingIds(prev => {
        const newSet = new Set(prev)
        newSet.delete(suggestion.id)
        return newSet
      })
    }
  }

  // Rejeitar sugestão
  async function rejectSuggestion(suggestion: POVSuggestion, reason?: string) {
    try {
      // Enviar feedback negativo
      await fetch('/api/pov-suggestions/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          suggestionId: suggestion.id,
          poiId: attractionId,
          action: 'reject',
          feedback: reason || 'Rejected from POI management',
          coordinates: {
            lat: suggestion.lat,
            lng: suggestion.lng
          }
        })
      })

      // Remover da lista
      const newSuggestions = suggestions.filter(s => s.id !== suggestion.id)
      setSuggestions(newSuggestions)
      onSuggestionsChange?.(newSuggestions)

    } catch (err) {
      console.error('Error rejecting suggestion:', err)
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

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center">
            <Sparkles className="h-5 w-5 text-purple-600 mr-2" />
            <h3 className="text-sm font-medium text-gray-900 dark:text-white">
              AI Suggestions
            </h3>
          </div>
          <button
            onClick={generateSuggestions}
            disabled={isLoading}
            className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                Loading...
              </>
            ) : (
              <>
                <RefreshCw className="h-3 w-3 mr-1" />
                Generate
              </>
            )}
          </button>
        </div>
        <p className="text-xs text-gray-600 dark:text-gray-400">
          AI-powered suggestions for optimal trigger point locations
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="p-4">
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          </div>
        )}

        {isLoading && (
          <div className="flex items-center justify-center h-32">
            <div className="text-center">
              <Loader2 className="h-8 w-8 animate-spin text-purple-600 mx-auto mb-2" />
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Analyzing location patterns...
              </p>
            </div>
          </div>
        )}

        {!isLoading && !error && suggestions.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 text-gray-500 dark:text-gray-400 p-4">
            <Sparkles className="h-8 w-8 mb-2" />
            <p className="text-sm text-center">
              Click "Generate" to get AI suggestions for trigger points
            </p>
          </div>
        )}

        {suggestions.length > 0 && (
          <div className="space-y-3 p-4">
            {suggestions.map((suggestion, index) => (
              <div
                key={suggestion.id}
                className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-medium text-gray-900 dark:text-white">
                      #{index + 1}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getScoreColor(suggestion.confidence_score)}`}>
                      {suggestion.confidence_score.toFixed(1)}%
                    </span>
                  </div>
                  <div className="text-xs text-gray-500">
                    {suggestion.pattern_based ? '📊 Pattern' : '🤖 AI'}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs mb-2">
                  <div>
                    <span className="font-medium text-gray-700 dark:text-gray-300">Distance:</span>
                    <br />
                    <span className="text-gray-900 dark:text-white">{suggestion.distance_m}m</span>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700 dark:text-gray-300">Direction:</span>
                    <br />
                    <span className="text-gray-900 dark:text-white">{formatBearing(suggestion.bearing_deg)}</span>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700 dark:text-gray-300">Access:</span>
                    <br />
                    <span className="text-gray-900 dark:text-white capitalize">{suggestion.access_type}</span>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700 dark:text-gray-300">Visibility:</span>
                    <br />
                    <span className="text-gray-900 dark:text-white capitalize">{suggestion.estimated_visibility}</span>
                  </div>
                </div>

                <div className="mb-2">
                  <span className="font-medium text-gray-700 dark:text-gray-300 text-xs">Bearing to POI:</span>
                  <br />
                  <span className="text-gray-900 dark:text-white text-xs">
                    {calculateBearing(suggestion.lat, suggestion.lng, attractionCoordinates.lat, attractionCoordinates.lng)}°
                    <span className="text-gray-500 ml-1">
                      ({formatBearing(calculateBearing(suggestion.lat, suggestion.lng, attractionCoordinates.lat, attractionCoordinates.lng))})
                    </span>
                  </span>
                </div>

                {suggestion.reasoning && (
                  <div className="mb-3">
                    <span className="font-medium text-gray-700 dark:text-gray-300 text-xs">Reasoning:</span>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                      {suggestion.reasoning}
                    </p>
                  </div>
                )}

                <div className="flex space-x-2">
                  <button
                    onClick={() => addTriggerPointFromSuggestion(suggestion)}
                    disabled={addingIds.has(suggestion.id)}
                    className="flex-1 px-2 py-1.5 bg-green-600 text-white text-xs font-medium rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                  >
                    {addingIds.has(suggestion.id) ? (
                      <>
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        Adding...
                      </>
                    ) : (
                      <>
                        <Plus className="h-3 w-3 mr-1" />
                        Add
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => {
                      const reason = prompt('Reason for rejection (optional):')
                      if (reason !== null) {
                        rejectSuggestion(suggestion, reason)
                      }
                    }}
                    className="px-2 py-1.5 bg-red-600 text-white text-xs font-medium rounded hover:bg-red-700 flex items-center"
                  >
                    <XCircle className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
