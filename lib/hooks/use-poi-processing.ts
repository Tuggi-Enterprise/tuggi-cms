/**
 * usePOIProcessing Hook - Unified POI Processing Management
 * 
 * Centralized hook for managing POI processing operations (trigger points, descriptions, OSM enrichment).
 * Eliminates duplication across trigger-points-generation and verification pages.
 * 
 * Features:
 * - Unified processing state management
 * - Progress tracking
 * - Error handling and retry logic
 * - Batch operations
 * - TypeScript support
 */

import { useState, useCallback, useRef } from 'react'
import { 
  processingService, 
  ProcessingOptions, 
  ProcessingResult, 
  ProcessingProgress,
  ProcessingOperation 
} from '../core/processing-service'
import { POI } from '../core/poi-service'

export interface UsePOIProcessingOptions {
  batchSize?: number
  delayBetweenCalls?: number
  maxRetries?: number
  onProgress?: (progress: ProcessingProgress) => void
  onComplete?: (result: ProcessingResult) => void
  onError?: (error: string) => void
}

export interface UsePOIProcessingReturn {
  // Processing state
  isProcessing: boolean
  progress: ProcessingProgress | null
  result: ProcessingResult | null
  error: string | null
  
  // Processing operations
  processTriggerPoints: (poiIds: string[], options?: UsePOIProcessingOptions) => Promise<ProcessingResult>
  processDescriptions: (poiIds: string[], options?: UsePOIProcessingOptions & { language?: string; autoGenerateAudio?: boolean }) => Promise<ProcessingResult>
  processOSMEnrichment: (poiIds: string[], options?: UsePOIProcessingOptions) => Promise<ProcessingResult>
  processMigration: (poiIds: string[], options?: UsePOIProcessingOptions & {
    mode?: string
    autoGenerateAudio?: boolean
    autoApprove?: boolean
    skipIfExists?: boolean
    updateIfExists?: boolean
    languages?: string[]
    voiceGender?: string
  }) => Promise<ProcessingResult>
  
  // Control operations
  cancelProcessing: () => void
  reset: () => void
  
  // Utility functions
  getActiveProcesses: () => string[]
}

export function usePOIProcessing(options: UsePOIProcessingOptions = {}): UsePOIProcessingReturn {
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState<ProcessingProgress | null>(null)
  const [result, setResult] = useState<ProcessingResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  
  const currentProcessId = useRef<string | null>(null)
  const abortController = useRef<AbortController | null>(null)
  
  // Process trigger points
  const processTriggerPoints = useCallback(async (
    poiIds: string[], 
    processingOptions: UsePOIProcessingOptions = {}
  ): Promise<ProcessingResult> => {
    if (isProcessing) {
      throw new Error('Another processing operation is already in progress')
    }
    
    setIsProcessing(true)
    setProgress(null)
    setResult(null)
    setError(null)
    
    const processId = processingService.generateProcessId('trigger_points')
    currentProcessId.current = processId

    try {
      console.log(`🎯 Starting trigger points processing for ${poiIds.length} POIs (Process ID: ${processId})`)
      
      const mergedOptions: ProcessingOptions = {
        ...options,
        ...processingOptions,
        processId,
        onProgress: (progress) => {
          setProgress(progress)
          processingOptions.onProgress?.(progress)
        },
        onComplete: (result) => {
          setResult(result)
          processingOptions.onComplete?.(result)
        },
        onError: (error) => {
          const errorMessage = error.poiId ? `${error.poiName}: ${error.error}` : error.error
          setError(errorMessage)
          processingOptions.onError?.(errorMessage)
        }
      }
      
      const result = await processingService.triggerPoints(poiIds, mergedOptions)
      
      setResult(result)
      return result
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      setError(errorMessage)
      processingOptions.onError?.(errorMessage)
      throw error
    } finally {
      setIsProcessing(false)
      setProgress(null)
      currentProcessId.current = null
    }
  }, [isProcessing, options])
  
  // Process descriptions
  const processDescriptions = useCallback(async (
    poiIds: string[], 
    processingOptions: UsePOIProcessingOptions & { language?: string; autoGenerateAudio?: boolean } = {}
  ): Promise<ProcessingResult> => {
    if (isProcessing) {
      throw new Error('Another processing operation is already in progress')
    }
    
    setIsProcessing(true)
    setProgress(null)
    setResult(null)
    setError(null)
    
    const processId = processingService.generateProcessId('descriptions')
    currentProcessId.current = processId

    try {
      console.log(`📝 Starting description processing for ${poiIds.length} POIs (Process ID: ${processId})`)
      
      const mergedOptions: ProcessingOptions = {
        ...options,
        ...processingOptions,
        processId,
        onProgress: (progress) => {
          setProgress(progress)
          processingOptions.onProgress?.(progress)
        },
        onComplete: (result) => {
          setResult(result)
          processingOptions.onComplete?.(result)
        },
        onError: (error) => {
          const errorMessage = error.poiId ? `${error.poiName}: ${error.error}` : error.error
          setError(errorMessage)
          processingOptions.onError?.(errorMessage)
        }
      }
      
      const result = await processingService.descriptions(poiIds, mergedOptions)
      
      setResult(result)
      return result
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      setError(errorMessage)
      processingOptions.onError?.(errorMessage)
      throw error
    } finally {
      setIsProcessing(false)
      setProgress(null)
      currentProcessId.current = null
    }
  }, [isProcessing, options])
  
  // Process OSM enrichment
  const processOSMEnrichment = useCallback(async (
    poiIds: string[], 
    processingOptions: UsePOIProcessingOptions = {}
  ): Promise<ProcessingResult> => {
    if (isProcessing) {
      throw new Error('Another processing operation is already in progress')
    }
    
    setIsProcessing(true)
    setProgress(null)
    setResult(null)
    setError(null)
    
    const processId = processingService.generateProcessId('osm_enrichment')
    currentProcessId.current = processId

    try {
      console.log(`🗺️ Starting OSM enrichment for ${poiIds.length} POIs (Process ID: ${processId})`)
      
      const mergedOptions: ProcessingOptions = {
        ...options,
        ...processingOptions,
        processId,
        onProgress: (progress) => {
          setProgress(progress)
          processingOptions.onProgress?.(progress)
        },
        onComplete: (result) => {
          setResult(result)
          processingOptions.onComplete?.(result)
        },
        onError: (error) => {
          const errorMessage = error.poiId ? `${error.poiName}: ${error.error}` : error.error
          setError(errorMessage)
          processingOptions.onError?.(errorMessage)
        }
      }
      
      const result = await processingService.osmEnrichment(poiIds, mergedOptions)
      
      setResult(result)
      return result
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      setError(errorMessage)
      processingOptions.onError?.(errorMessage)
      throw error
    } finally {
      setIsProcessing(false)
      setProgress(null)
      currentProcessId.current = null
    }
  }, [isProcessing, options])

  // Process Migration
  const processMigration = useCallback(async (
    poiIds: string[], 
    processingOptions: UsePOIProcessingOptions & {
      mode?: string
      autoGenerateAudio?: boolean
      autoApprove?: boolean
      skipIfExists?: boolean
      updateIfExists?: boolean
      languages?: string[]
      voiceGender?: string
    } = {}
  ): Promise<ProcessingResult> => {
    if (isProcessing) {
      throw new Error('Another processing operation is already in progress')
    }
    
    setIsProcessing(true)
    setProgress(null)
    setResult(null)
    setError(null)
    
    const processId = processingService.generateProcessId('migration')
    currentProcessId.current = processId

    try {
      console.log(`📦 Starting migration processing for ${poiIds.length} POIs (Process ID: ${processId})`)
      
      const mergedOptions: ProcessingOptions = {
        ...options,
        ...processingOptions,
        processId,
        onProgress: (progress) => {
          setProgress(progress)
          processingOptions.onProgress?.(progress)
        },
        onComplete: (result) => {
          setResult(result)
          processingOptions.onComplete?.(result)
        },
        onError: (error) => {
          const errorMessage = error.poiId ? `${error.poiName}: ${error.error}` : error.error
          setError(errorMessage)
          processingOptions.onError?.(errorMessage)
        }
      }
      
      const result = await processingService.processMigration(poiIds, mergedOptions)
      
      setResult(result)
      return result
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      setError(errorMessage)
      processingOptions.onError?.(errorMessage)
      throw error
    } finally {
      setIsProcessing(false)
      setProgress(null)
      currentProcessId.current = null
    }
  }, [isProcessing, options])
  
  // Cancel processing
  const cancelProcessing = useCallback(() => {
    if (currentProcessId.current) {
      console.log(`🛑 Attempting to cancel process: ${currentProcessId.current}`)
      const cancelled = processingService.cancelProcess(currentProcessId.current)
      if (cancelled) {
        console.log('✅ Processing cancelled successfully')
        setIsProcessing(false)
        setProgress(null)
        setError('Processing cancelled by user')
        currentProcessId.current = null
      } else {
        console.warn('⚠️ Could not cancel process - might be already finished')
      }
    }
  }, [])
  
  // Reset state
  const reset = useCallback(() => {
    setIsProcessing(false)
    setProgress(null)
    setResult(null)
    setError(null)
    currentProcessId.current = null
  }, [])
  
  // Get active processes
  const getActiveProcesses = useCallback(() => {
    return processingService.getActive()
  }, [])
  
  return {
    // Processing state
    isProcessing,
    progress,
    result,
    error,
    
    // Processing operations
    processTriggerPoints,
    processDescriptions,
    processOSMEnrichment,
    processMigration,
    
    // Control operations
    cancelProcessing,
    reset,
    
    // Utility functions
    getActiveProcesses
  }
}

export default usePOIProcessing
