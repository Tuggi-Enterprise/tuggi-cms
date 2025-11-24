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
   * Process POIs for trigger points generation using new motor
   */
  static async processTriggerPoints(
    poiIds: string[],
    options: ProcessingOptions = {}
  ): Promise<ProcessingResult> {
    const operation = 'trigger_points'
    const processId = this.generateProcessId(operation)
    
    try {
      console.log(`🎯 Starting trigger points processing for ${poiIds.length} POIs using new motor`)
      
      // Import utilities dynamically to avoid circular dependencies
      const { convertTriggerPointsToDB } = await import('@/lib/services/trigger-points-google/utils/conversion')
      const { validateTriggerPoints } = await import('@/lib/services/trigger-points-google/utils/validation')
      const { updateAttractionWithTPMetadata } = await import('@/lib/services/trigger-points-google/utils/attraction-update')
      const { poiService } = await import('./poi-service')
      
      const result = await this.processBatch(
        processId,
        operation,
        poiIds,
        async (poiId: string) => {
          const startTime = Date.now()
          
          try {
            // 1. Buscar dados do POI
            const poiResult = await poiService.getById(poiId)
            if (!poiResult.success || !poiResult.data) {
              throw new Error(`Failed to load POI: ${poiResult.error || 'POI not found'}`)
            }
            
            const poi = poiResult.data
            if (!poi.coordinates) {
              throw new Error('POI has no coordinates')
            }
            
            // 2. Preparar POIData para o novo motor
            const poiData = {
              id: poi.id,
              name: poi.name,
              location: {
                lat: poi.coordinates.latitude,
                lng: poi.coordinates.longitude
              },
              type: poi.category || 'point_of_interest',
              country: poi.country,
              city: poi.city,
              state: poi.state
            }
            
            // 3. Chamar novo motor
            const response = await fetch('/api/trigger-points/google/generate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ poiData })
            })
            
            const responseData = await response.json()
            
            if (!response.ok || !responseData.success) {
              throw new Error(responseData.error || 'Failed to generate trigger points')
            }
            
            const triggerPointResult = responseData.data
            const metadata = responseData.metadata || {}
            const boundary = responseData.boundary || null
            const boundarySource = metadata.boundarySource || 'unknown'
            
            // 4. Converter para formato do banco
            const convertedTPs = convertTriggerPointsToDB(
              triggerPointResult.triggerPoints,
              boundarySource
            )
            
            // 5. Validar antes de salvar
            const validation = validateTriggerPoints(convertedTPs)
            
            if (validation.validItems.length === 0) {
              console.warn(`⚠️ No valid trigger points for POI ${poiId} after validation`)
              if (validation.errors.length > 0) {
                console.warn('Validation errors:', validation.errors)
              }
            }
            
            // 6. Salvar TPs válidos através de API route (para ter acesso à service role key)
            let saved = 0
            let skipped = 0
            
            if (validation.validItems.length > 0) {
              // Converter para formato esperado pela API route
              const tpsForSaving = validation.validItems.map(tp => ({
                lat: tp.lat,
                lng: tp.lng,
                type: tp.type,
                confidence: tp.confidence_score,
                auto_status: tp.auto_status,
                final_status: tp.final_status,
                radius_meters: tp.radius_meters,
                expected_bearing: tp.expected_bearing,
                bearing_threshold: tp.bearing_threshold || 30,
                priority: tp.priority,
                score_factors: tp.score_factors,
                generation_method: tp.generation_method,
                validation_notes: tp.validation_notes,
                access: tp.access || 'both'
              }))
              
              // Call generate-batch API route which already handles saving with service role key
              // Pass pre-generated trigger points - the route will skip generation and just save (DRY principle)
              const saveResponse = await fetch('/api/trigger-points/generate-batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  pre_generated_tps: tpsForSaving.map(tp => ({
                    attraction_id: poiId,
                    lat: tp.lat,
                    lng: tp.lng,
                    type: tp.type,
                    confidence: tp.confidence,
                    auto_status: tp.auto_status,
                    final_status: tp.final_status,
                    radius_meters: tp.radius_meters || 20,
                    expected_bearing: tp.expected_bearing,
                    bearing_threshold: tp.bearing_threshold || 30,
                    priority: tp.priority,
                    score_factors: tp.score_factors,
                    generation_method: tp.generation_method,
                    validation_notes: tp.validation_notes,
                    access: tp.access || 'both'
                  })),
                  boundary_source: boundarySource
                })
              })
              
              const saveResult = await saveResponse.json()
              
              if (!saveResponse.ok || !saveResult.success) {
                throw new Error(saveResult.error || 'Failed to save trigger points')
              }
              
              // Extract saved count from result
              const poiResult = saveResult.results?.[0]
              saved = poiResult?.trigger_points_saved || 0
              // Skipped = validation errors + save errors (não há mais duplicatas)
              skipped = (convertedTPs.length - validation.validItems.length) + (validation.validItems.length - saved)
            } else {
              skipped = convertedTPs.length
            }
            
            // 7. Atualizar attraction com metadata (só se salvou TPs)
            if (saved > 0) {
              await updateAttractionWithTPMetadata(
              poiId,
              {
                boundarySource,
                boundaryConfidence: metadata.boundaryConfidence,
                searchRadius: metadata.searchRadius,
                streetCount: metadata.streetCount,
                elevationAnalysis: metadata.elevationAnalysis,
                optimalPointsFound: metadata.optimalPointsFound,
                streetValidatedCandidates: metadata.streetValidatedCandidates,
                validatedPoints: metadata.validatedPoints,
                finalPoints: metadata.finalPoints
              },
              boundary
              )
            }
            
            const processingTime = Date.now() - startTime
            
            return {
              success: true,
              message: `Generated ${triggerPointResult.count} TPs, saved ${saved}, skipped ${skipped}`,
              data: {
                trigger_points_generated: triggerPointResult.count,
                trigger_points_saved: saved,
                trigger_points_skipped: skipped,
                boundary_source: boundarySource,
                processing_time: processingTime
              },
              triggerPointsSaved: saved,
              triggerPointsSkipped: skipped,
              triggerPointsGenerated: triggerPointResult.count,
              boundarySource
            }
            
          } catch (error) {
            const processingTime = Date.now() - startTime
            throw {
              success: false,
              message: error instanceof Error ? error.message : 'Unknown error',
              data: {
                trigger_points_generated: 0,
                trigger_points_saved: 0,
                trigger_points_skipped: 0,
                processing_time: processingTime
              },
              error: error instanceof Error ? error.message : 'Unknown error'
            }
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
   * Now uses DescriptionService directly for better performance and consistency
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
      
      // Import DescriptionService
      const { DescriptionService } = await import('@/lib/services/poi-processing/description.service')
      const { getSupabase } = await import('@/lib/core/supabase-client')
      const supabase = getSupabase('service')
      
      const result = await this.processBatch(
        processId,
        operation,
        poiIds,
        async (poiId: string) => {
          // Get POI data from database
          const { data: poi, error: poiError } = await supabase
            .schema('core')
            .from('attractions')
            .select(`
              id,
              name,
              city,
              state,
              country,
              formatted_address,
              category,
              rating,
              user_ratings_total,
              website,
              google_place_id,
              reference_links,
              osm_tags,
              attraction_coordinate!inner(latitude, longitude)
            `)
            .eq('id', poiId)
            .single()
          
          if (poiError || !poi) {
            throw new Error(`Failed to load POI data: ${poiError?.message || 'POI not found'}`)
          }
          
          const existingDescription = options.existingDescriptions?.get(poiId)
          
          // SSOT: DescriptionService will fetch ALL data from database when ID is provided
          // Only pass ID - service will fetch complete data from core.attractions
          const poiData = {
            id: poi.id // This triggers SSOT - all data fetched from database
          }
          
          // Prepare options for DescriptionService
          const descriptionOptions = {
            language: options.language || 'pt-br',
            persist_verification: true,
            auto_generate_audio: options.autoGenerateAudio || false,
            existing_description: existingDescription?.description,
            description_id: existingDescription?.id,
            use_dynamic_sources: true,
            optimization_mode: true,
            enrich_with_osm: true,
            skip_enrichment_if_exists: true
          }
          
          // Call DescriptionService directly
          const serviceResult = await DescriptionService.generate(poiData, descriptionOptions)
          
          return {
            success: serviceResult.success,
            message: serviceResult.success ? 'Description processed' : serviceResult.error,
            data: {
              description: serviceResult.data?.description,
              verification: serviceResult.data?.verification,
              description_id: serviceResult.data?.description_id,
              audio_generation: serviceResult.data?.audio_generation,
              quality_analysis: serviceResult.data?.quality_analysis
            },
            descriptionGenerated: !!serviceResult.data?.description,
            audioGenerated: serviceResult.data?.audio_generation?.success || false
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
