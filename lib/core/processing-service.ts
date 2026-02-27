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
  processId?: string
}

export interface ProcessingProgress {
  total: number
  processed: number
  remaining: number
  percentage: number
  currentItem?: string
  startTime: number
  estimatedTimeRemaining?: number
  lastResult?: ProcessingItemResult
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
  cancelled?: boolean
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
  | 'migration'

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
    const processId = options.processId || this.generateProcessId(operation)
    
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
              poiName: poi.name,
              success: true,
              message: `Generated ${triggerPointResult.count} TPs, saved ${saved}, skipped ${skipped}`,
              data: {
                trigger_points_generated: triggerPointResult.count,
                trigger_points_saved: saved,
                trigger_points_skipped: skipped,
                boundary_source: boundarySource,
                processing_time: processingTime
              }
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
      
    } catch (error: any) {
      console.error('Error processing trigger points:', error)
      return this.createErrorResult(operation, poiIds.length, error)
    }
  }
  
  /**
   * Process POIs for description generation/improvement using central Edge Function (SSOT)
   */
  static async processDescriptions(
    poiIds: string[],
    options: ProcessingOptions & {
      language?: string
      autoGenerateAudio?: boolean
    } = {}
  ): Promise<ProcessingResult> {
    const operation = 'descriptions'
    const processId = options.processId || this.generateProcessId(operation)
    
    try {
      console.log(`📝 Starting description processing for ${poiIds.length} POIs via central Edge Function`)
      
      const { getSupabase } = await import('@/lib/core/supabase-client')
      const supabase = getSupabase('service')
      
      const result = await this.processBatch(
        processId,
        operation,
        poiIds,
        async (poiId: string) => {
          const startTime = Date.now()
          
          try {
            // Get POI Name for result metadata
            const { data: poi } = await supabase.schema('core').from('attractions').select('name').eq('id', poiId).single()
            const poiName = poi?.name || 'Unknown'

            // SSOT: Call the central Edge Function directly
            console.log(`📡 Calling central Edge Function 'generate-description' for POI: ${poiId}`)
            
            const { data: res, error: invokeError } = await supabase.functions.invoke('generate-description', {
              body: {
                poi_id: poiId,
                language: options.language || 'pt-br',
                force: true, // Batch processing usually wants fresh/validated content
                generate_audio: options.autoGenerateAudio || false
              }
            })
            
            if (invokeError) {
              throw new Error(`Edge Function Error: ${invokeError.message}`)
            }

            if (!res?.success) {
              throw new Error(res?.error || 'Failed to generate description via Edge Function')
            }
            
            const generatedData = res.data
            
            return {
              poiName,
              success: true,
              message: 'Description processed via central Edge Function',
              data: {
                description: generatedData.description,
                verification: {
                  aprovada: generatedData.verification_status === 'approved',
                  score: generatedData.last_score_overall
                },
                description_id: generatedData.id,
                audio_generation: {
                  success: !!generatedData.audio_url,
                  audio_url: generatedData.audio_url
                },
                processing_time: Date.now() - startTime
              }
            }
          } catch (error: any) {
            throw {
              success: false,
              message: error.message || 'Unknown error',
              processingTime: Date.now() - startTime
            }
          }
        },
        options
      )
      
      return result
      
    } catch (error: any) {
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
    const processId = options.processId || this.generateProcessId(operation)
    
    try {
      console.log(`🗺️ Starting OSM enrichment for ${poiIds.length} POIs`)
      
      const result = await this.processBatch(
        processId,
        operation,
        poiIds,
        async (poiId: string) => {
          const startTime = Date.now()
          
          try {
            // Get POI data first
            const poiResponse = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || ''}/api/pois/${poiId}`)
            const poiData = await poiResponse.json()
            
            if (!poiData.success) {
              throw new Error(`Failed to load POI data: ${poiData.error}`)
            }
            
            const poi = poiData.data
            
            const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || ''}/api/pois/enrich-osm`, {
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
              poiName: poi.name,
              success: result.success,
              message: result.message,
              data: {
                ...result,
                processing_time: Date.now() - startTime
              }
            }
          } catch (error: any) {
            throw {
              success: false,
              message: error.message || 'Unknown error',
              processingTime: Date.now() - startTime
            }
          }
        },
        options
      )
      
      return result
      
    } catch (error: any) {
      console.error('Error processing OSM enrichment:', error)
      return this.createErrorResult(operation, poiIds.length, error)
    }
  }
  
  /**
   * Process POIs for Migration (Homolog -> Core)
   */
  static async processMigration(
    poiIds: string[],
    options: ProcessingOptions & {
      mode?: string
      autoGenerateAudio?: boolean
      autoApprove?: boolean
      skipIfExists?: boolean
      updateIfExists?: boolean
      languages?: string[]
      voiceGender?: string
    } = {}
  ): Promise<ProcessingResult> {
    const operation = 'migration'
    const processId = options.processId || this.generateProcessId(operation)
    
    try {
      console.log(`📦 Starting migration for ${poiIds.length} POIs`)
      
      const result = await this.processBatch(
        processId,
        operation,
        poiIds,
        async (poiId: string) => {
          const startTime = Date.now()
          
          try {
            // Call migrate-poi API
            const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || ''}/api/migration/migrate-poi`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                poi_uuid_id: poiId,
                options: {
                  mode: options.mode,
                  auto_generate_audio: options.autoGenerateAudio,
                  auto_approve_if_satisfactory: options.autoApprove,
                  skip_if_exists: options.skipIfExists,
                  update_if_exists: options.updateIfExists,
                  languages: options.languages,
                  voice_gender: options.voiceGender
                }
              })
            })
            
            const result = await response.json()
            
            if (!result.success) {
               // Include steps in error if available
               const errorMsg = result.error || 'Migration failed'
               if (result.steps) {
                 throw { message: errorMsg, data: { steps: result.steps } } }
               throw new Error(errorMsg)
            }
            
            // Check for warnings
            let message = 'Migrated successfully'
            if (result.warnings && result.warnings.length > 0) {
              message += ` (Warnings: ${result.warnings.join(', ')})`
            }
            
            return {
              poiName: 'POI ' + poiId, // Name might not be returned, but we have ID
              success: true,
              message,
              data: {
                attraction_id: result.attraction_id,
                steps: result.steps,
                warnings: result.warnings,
                processing_time: Date.now() - startTime,
                skipped: result.skipped
              }
            }
          } catch (error: any) {
            // Extract data from thrown object if structured error
            const data = error.data || {}
            
            throw {
              success: false,
              message: error.message || 'Unknown error',
              data: { ...data, processing_time: Date.now() - startTime }
            }
          }
        },
        options
      )
      
      return result
      
    } catch (error: any) {
      console.error('Error processing migration:', error)
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
    const delayBetweenCalls = options.delayBetweenCalls || 1000
    
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
            options.onProgress({
              total: poiIds.length,
              processed: i + 1,
              remaining: poiIds.length - i - 1,
              percentage: Math.round(((i + 1) / poiIds.length) * 100),
              currentItem: poiId,
              startTime,
              estimatedTimeRemaining: this.calculateEstimatedTime(startTime, i + 1, poiIds.length),
              lastResult: itemResult
            })
          }
          
          // Add delay between calls to avoid rate limiting
          if (i < poiIds.length - 1 && delayBetweenCalls > 0) {
            await new Promise(resolve => setTimeout(resolve, delayBetweenCalls))
          }
          
        } catch (error: any) {
          console.error(`Error processing POI ${poiId}:`, error)
          
          const itemResult: ProcessingItemResult = {
            poiId,
            poiName: error.poiName || 'Unknown',
            success: false,
            message: error.message || 'Unknown error',
            processingTime: error.processingTime || (Date.now() - itemStartTime)
          }
          
          results.push(itemResult)
          failed++
          
          errors.push({
            poiId,
            poiName: error.poiName || 'Unknown',
            error: error.message || 'Unknown error',
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
  public static generateProcessId(operation: string): string {
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
    const isCancelled = error instanceof Error && (error.message === 'Process aborted by user' || error.message === 'The user aborted a request.');
    
    return {
      success: false,
      totalProcessed: 0,
      successful: 0,
      failed: totalItems,
      results: [],
      processingTime: 0,
      cancelled: isCancelled,
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
  descriptions: (poiIds: string[], options?: ProcessingOptions & { language?: string; autoGenerateAudio?: boolean }) => 
    ProcessingService.processDescriptions(poiIds, options),
  osmEnrichment: (poiIds: string[], options?: ProcessingOptions) => 
    ProcessingService.processOSMEnrichment(poiIds, options),
  processMigration: (poiIds: string[], options?: ProcessingOptions & {
    mode?: string
    autoGenerateAudio?: boolean
    autoApprove?: boolean
    skipIfExists?: boolean
    updateIfExists?: boolean
    languages?: string[]
    voiceGender?: string
  }) => ProcessingService.processMigration(poiIds, options),
  cancel: (processId: string) => ProcessingService.cancelProcess(processId),
  cancelProcess: (processId: string) => ProcessingService.cancelProcess(processId),
  getActive: () => ProcessingService.getActiveProcesses(),
  generateProcessId: (operation: string) => ProcessingService.generateProcessId(operation)
}

export default ProcessingService
