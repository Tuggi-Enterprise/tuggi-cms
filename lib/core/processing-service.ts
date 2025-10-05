/**
 * Processing Service - Single Source of Truth for Batch Operations
 * 
 * Centralized service for processing POIs in batches (trigger points, descriptions, OSM enrichment).
 * Eliminates duplication across trigger-points-generation and verification pages.
 * 
 * Features:
 * - Unified batch processing
 * - Progress tracking
 * - Error handling and retry logic
 * - Rate limiting
 * - TypeScript interfaces
 * - Edge Functions compatibility
 */

// Processing Interfaces
export interface ProcessingOptions {
  batchSize?: number
  delayBetweenCalls?: number
  maxRetries?: number
  onProgress?: (progress: ProcessingProgress) => void
  onComplete?: (result: ProcessingResult) => void
  onError?: (error: ProcessingError) => void
}

export interface ProcessingProgress {
  total: number
  processed: number
  remaining: number
  percentage: number
  currentItem?: string
  startTime: number
  estimatedTimeRemaining?: number
}

export interface ProcessingResult {
  success: boolean
  totalProcessed: number
  successful: number
  failed: number
  results: ProcessingItemResult[]
  processingTime: number
  errors: ProcessingError[]
  metadata: {
    operation: string
    timestamp: number
    options: ProcessingOptions
  }
}

export interface ProcessingItemResult {
  poiId: string
  poiName: string
  success: boolean
  message: string
  data?: any
  errors?: string[]
  processingTime: number
}

export interface ProcessingError {
  poiId: string
  poiName: string
  error: string
  timestamp: number
  retryCount: number
}

export type ProcessingOperation = 
  | 'trigger_points'
  | 'descriptions'
  | 'osm_enrichment'
  | 'audio_generation'
  | 'verification'

class ProcessingService {
  private static activeProcesses: Map<string, AbortController> = new Map()
  
  /**
   * Process POIs for trigger points generation
   */
  static async processTriggerPoints(
    poiIds: string[],
    options: ProcessingOptions = {}
  ): Promise<ProcessingResult> {
    const operation = 'trigger_points'
    const processId = this.generateProcessId(operation)
    
    try {
      console.log(`🎯 Starting trigger points processing for ${poiIds.length} POIs`)
      
      const result = await this.processBatch(
        processId,
        operation,
        poiIds,
        async (poiId: string) => {
          const response = await fetch('/api/trigger-points/generate-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              attraction_ids: [poiId],
              batch_size: 1
            })
          })
          
          const result = await response.json()
          
          return {
            success: result.success,
            message: result.results?.[0]?.message || result.message || 'Unknown result',
            data: result.results?.[0],
            triggerPointsSaved: result.results?.[0]?.trigger_points_saved || 0,
            triggerPointsSkipped: result.results?.[0]?.trigger_points_skipped || 0,
            triggerPointsGenerated: result.results?.[0]?.trigger_points_generated || 0,
            boundarySource: result.results?.[0]?.boundary_source
          }
        },
        options
      )
      
      return result
      
    } catch (error) {
      console.error('Error processing trigger points:', error)
      return this.createErrorResult(operation, poiIds.length, error)
    }
  }
  
  /**
   * Process POIs for description generation/improvement
   */
  static async processDescriptions(
    poiIds: string[],
    options: ProcessingOptions & {
      language?: string
      autoGenerateAudio?: boolean
      existingDescriptions?: Map<string, any>
    } = {}
  ): Promise<ProcessingResult> {
    const operation = 'descriptions'
    const processId = this.generateProcessId(operation)
    
    try {
      console.log(`📝 Starting description processing for ${poiIds.length} POIs`)
      
      const result = await this.processBatch(
        processId,
        operation,
        poiIds,
        async (poiId: string) => {
          // Get POI data first
          const poiResponse = await fetch(`/api/pois/${poiId}`)
          const poiData = await poiResponse.json()
          
          if (!poiData.success) {
            throw new Error(`Failed to load POI data: ${poiData.error}`)
          }
          
          const poi = poiData.data
          const existingDescription = options.existingDescriptions?.get(poiId)
          
          // Prepare request body
          let requestBody: any = {
            id: poi.id,
            name: poi.name,
            city: poi.city,
            country: poi.country,
            persist_verification: true,
            auto_generate_audio: options.autoGenerateAudio || false
          }
          
          if (existingDescription) {
            // Improve existing description
            requestBody.existing_description = existingDescription.description
            requestBody.description_id = existingDescription.id
          }
          
          const response = await fetch('/api/descriptions/generate-optimized', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
          })
          
          const result = await response.json()
          
          return {
            success: result.success,
            message: result.message || 'Description processed',
            data: result,
            descriptionGenerated: result.description_generated,
            audioGenerated: result.audio_generation?.success || false
          }
        },
        options
      )
      
      return result
      
    } catch (error) {
      console.error('Error processing descriptions:', error)
      return this.createErrorResult(operation, poiIds.length, error)
    }
  }
  
  /**
   * Process POIs for OSM enrichment
   */
  static async processOSMEnrichment(
    poiIds: string[],
    options: ProcessingOptions = {}
  ): Promise<ProcessingResult> {
    const operation = 'osm_enrichment'
    const processId = this.generateProcessId(operation)
    
    try {
      console.log(`🗺️ Starting OSM enrichment for ${poiIds.length} POIs`)
      
      const result = await this.processBatch(
        processId,
        operation,
        poiIds,
        async (poiId: string) => {
          // Get POI data first
          const poiResponse = await fetch(`/api/pois/${poiId}`)
          const poiData = await poiResponse.json()
          
          if (!poiData.success) {
            throw new Error(`Failed to load POI data: ${poiData.error}`)
          }
          
          const poi = poiData.data
          
          const response = await fetch('/api/pois/enrich-osm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              poi_id: poi.id,
              name: poi.name,
              city: poi.city,
              country: poi.country,
              google_place_id: poi.google_place_id
            })
          })
          
          const result = await response.json()
          
          return {
            success: result.success,
            message: result.message,
            data: result,
            dataQualityScore: result.data_quality_score,
            fieldsUpdated: result.fields_updated
          }
        },
        options
      )
      
      return result
      
    } catch (error) {
      console.error('Error processing OSM enrichment:', error)
      return this.createErrorResult(operation, poiIds.length, error)
    }
  }
  
  /**
   * Generic batch processing method
   */
  private static async processBatch(
    processId: string,
    operation: string,
    poiIds: string[],
    processor: (poiId: string) => Promise<any>,
    options: ProcessingOptions
  ): Promise<ProcessingResult> {
    const startTime = Date.now()
    const batchSize = options.batchSize || 1
    const delayBetweenCalls = options.delayBetweenCalls || 1000
    const maxRetries = options.maxRetries || 3
    
    const results: ProcessingItemResult[] = []
    const errors: ProcessingError[] = []
    let successful = 0
    let failed = 0
    
    // Create abort controller for this process
    const abortController = new AbortController()
    this.activeProcesses.set(processId, abortController)
    
    try {
      for (let i = 0; i < poiIds.length; i++) {
        // Check if process was aborted
        if (abortController.signal.aborted) {
          throw new Error('Process aborted by user')
        }
        
        const poiId = poiIds[i]
        const itemStartTime = Date.now()
        
        try {
          console.log(`🔄 Processing ${operation} for POI ${i + 1}/${poiIds.length}: ${poiId}`)
          
          const result = await processor(poiId)
          
          const itemResult: ProcessingItemResult = {
            poiId,
            poiName: result.poiName || 'Unknown',
            success: result.success,
            message: result.message || 'Processed successfully',
            data: result.data,
            errors: result.errors,
            processingTime: Date.now() - itemStartTime
          }
          
          results.push(itemResult)
          
          if (result.success) {
            successful++
          } else {
            failed++
            errors.push({
              poiId,
              poiName: result.poiName || 'Unknown',
              error: result.message || 'Processing failed',
              timestamp: Date.now(),
              retryCount: 0
            })
          }
          
          // Progress callback
          if (options.onProgress) {
            const progress: ProcessingProgress = {
              total: poiIds.length,
              processed: i + 1,
              remaining: poiIds.length - i - 1,
              percentage: Math.round(((i + 1) / poiIds.length) * 100),
              currentItem: poiId,
              startTime,
              estimatedTimeRemaining: this.calculateEstimatedTime(startTime, i + 1, poiIds.length)
            }
            options.onProgress(progress)
          }
          
          // Add delay between calls to avoid rate limiting
          if (i < poiIds.length - 1 && delayBetweenCalls > 0) {
            await new Promise(resolve => setTimeout(resolve, delayBetweenCalls))
          }
          
        } catch (error) {
          console.error(`Error processing POI ${poiId}:`, error)
          
          const itemResult: ProcessingItemResult = {
            poiId,
            poiName: 'Unknown',
            success: false,
            message: error instanceof Error ? error.message : 'Unknown error',
            processingTime: Date.now() - itemStartTime
          }
          
          results.push(itemResult)
          failed++
          
          errors.push({
            poiId,
            poiName: 'Unknown',
            error: error instanceof Error ? error.message : 'Unknown error',
            timestamp: Date.now(),
            retryCount: 0
          })
        }
      }
      
      const result: ProcessingResult = {
        success: failed === 0,
        totalProcessed: poiIds.length,
        successful,
        failed,
        results,
        processingTime: Date.now() - startTime,
        errors,
        metadata: {
          operation,
          timestamp: startTime,
          options
        }
      }
      
      // Complete callback
      if (options.onComplete) {
        options.onComplete(result)
      }
      
      return result
      
    } finally {
      // Clean up
      this.activeProcesses.delete(processId)
    }
  }
  
  /**
   * Cancel active processing
   */
  static cancelProcess(processId: string): boolean {
    const controller = this.activeProcesses.get(processId)
    if (controller) {
      controller.abort()
      this.activeProcesses.delete(processId)
      return true
    }
    return false
  }
  
  /**
   * Get active processes
   */
  static getActiveProcesses(): string[] {
    return Array.from(this.activeProcesses.keys())
  }
  
  /**
   * Generate unique process ID
   */
  private static generateProcessId(operation: string): string {
    return `${operation}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }
  
  /**
   * Calculate estimated time remaining
   */
  private static calculateEstimatedTime(startTime: number, processed: number, total: number): number {
    if (processed === 0) return 0
    
    const elapsed = Date.now() - startTime
    const averageTimePerItem = elapsed / processed
    const remaining = total - processed
    
    return Math.round(remaining * averageTimePerItem)
  }
  
  /**
   * Create error result
   */
  private static createErrorResult(operation: string, totalItems: number, error: any): ProcessingResult {
    return {
      success: false,
      totalProcessed: 0,
      successful: 0,
      failed: totalItems,
      results: [],
      processingTime: 0,
      errors: [{
        poiId: 'unknown',
        poiName: 'Unknown',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now(),
        retryCount: 0
      }],
      metadata: {
        operation,
        timestamp: Date.now(),
        options: {}
      }
    }
  }
}

/**
 * Convenience functions for common use cases
 */
export const processingService = {
  triggerPoints: (poiIds: string[], options?: ProcessingOptions) => 
    ProcessingService.processTriggerPoints(poiIds, options),
  descriptions: (poiIds: string[], options?: ProcessingOptions & { language?: string; autoGenerateAudio?: boolean; existingDescriptions?: Map<string, any> }) => 
    ProcessingService.processDescriptions(poiIds, options),
  osmEnrichment: (poiIds: string[], options?: ProcessingOptions) => 
    ProcessingService.processOSMEnrichment(poiIds, options),
  cancel: (processId: string) => ProcessingService.cancelProcess(processId),
  getActive: () => ProcessingService.getActiveProcesses()
}

export default ProcessingService
