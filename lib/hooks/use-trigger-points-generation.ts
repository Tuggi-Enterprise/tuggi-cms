'use client'

import { useState, useRef, useCallback } from 'react'
import { TriggerPoint } from '@/lib/services/trigger-points-google/types/interfaces'

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

interface TriggerPointResult {
  poiId: string
  poiName: string
  triggerPoints: TriggerPoint[]
  count: number
  generatedAt: string
  processingTime: number
  statistics: any
  metadata?: any
}

interface Boundary {
  coordinates: Array<{lat: number, lng: number}>
  classification?: {
    group?: string
    strategy?: string
    reasoning?: string
  }
}

interface GenerateOptions {
  visibilityMaxHorizonM?: number
  simulateApproach?: boolean
  validateCorridor?: boolean
  clusterIntersections?: boolean
  intersectionClusterRadiusM?: number
}

interface UseTriggerPointsGenerationReturn {
  generate: (poiData: POIInfo, options?: GenerateOptions) => Promise<void>
  isLoading: boolean
  error: string | null
  result: TriggerPointResult | null
  metadata: any | null
  boundary: Boundary | null
  triggerPoints: TriggerPoint[]
  statistics: any | null
  reset: () => void
}

export function useTriggerPointsGeneration(): UseTriggerPointsGenerationReturn {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<TriggerPointResult | null>(null)
  const [metadata, setMetadata] = useState<any | null>(null)
  const [boundary, setBoundary] = useState<Boundary | null>(null)
  const [triggerPoints, setTriggerPoints] = useState<TriggerPoint[]>([])
  const [statistics, setStatistics] = useState<any | null>(null)
  
  // Prevenir race conditions
  const isGeneratingRef = useRef(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  const generate = useCallback(async (poiData: POIInfo, options: GenerateOptions = {}) => {
    // Prevenir múltiplas chamadas simultâneas
    if (isGeneratingRef.current) {
      console.warn('Generation already in progress, skipping...')
      return
    }

    // Cancelar requisição anterior se existir
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    // Criar novo AbortController
    abortControllerRef.current = new AbortController()
    isGeneratingRef.current = true

    setIsLoading(true)
    setError(null)
    setResult(null)
    setMetadata(null)
    setBoundary(null)
    setTriggerPoints([])
    setStatistics(null)

    try {
      console.log(`🚀 Generating trigger points for: ${poiData.name}`)
      
      const response = await fetch('/api/trigger-points/google/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          poiData,
          options,
        }),
        signal: abortControllerRef.current.signal
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
      setMetadata(result.metadata || triggerPointResult.metadata)
      setResult(triggerPointResult)
      
      // Extrair boundary se disponível
      if (result.boundary) {
        setBoundary(result.boundary)
        console.log(`📐 Boundary extracted: ${result.boundary.coordinates.length} points`)
      }
      
      console.log(`✅ Generated ${triggerPointResult.count} trigger points`)
      
    } catch (err: any) {
      // Ignorar erros de abort
      if (err.name === 'AbortError') {
        console.log('Generation cancelled')
        return
      }
      
      console.error('Error generating trigger points:', err)
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
      isGeneratingRef.current = false
      abortControllerRef.current = null
    }
  }, [])

  const reset = useCallback(() => {
    // Cancelar requisição em andamento
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    
    setError(null)
    setResult(null)
    setMetadata(null)
    setBoundary(null)
    setTriggerPoints([])
    setStatistics(null)
    isGeneratingRef.current = false
    abortControllerRef.current = null
  }, [])

  return {
    generate,
    isLoading,
    error,
    result,
    metadata,
    boundary,
    triggerPoints,
    statistics,
    reset
  }
}
