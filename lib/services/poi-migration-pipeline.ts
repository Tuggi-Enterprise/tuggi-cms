/**
 * POI Migration Pipeline - Orchestrates complete migration process
 * 
 * Handles end-to-end migration: homolog → core → description → audio → trigger points → activation
 */

import { MigrationService, MigrationResult } from './migration-service'
import ProcessingService from '@/lib/core/processing-service'
import { getSupabase } from '@/lib/core/supabase-client'

const supabase = getSupabase('service')

export interface PipelineOptions {
  auto_generate_audio?: boolean
  auto_approve_if_satisfactory?: boolean
  skip_if_exists?: boolean
  update_if_exists?: boolean
  mode?: 'migration_only' | 'migration_description' | 'migration_description_audio' | 'full'
}

export interface PipelineStepResult {
  step: string
  success: boolean
  error?: string
  data?: any
  processing_time: number
}

export interface PipelineResult {
  success: boolean
  attraction_id?: string
  steps: PipelineStepResult[]
  total_time: number
  error?: string
  warnings?: string[]
}

export class PoiMigrationPipeline {
  /**
   * Execute complete migration pipeline
   */
  static async executePipeline(
    uuid_id: string,
    options: PipelineOptions = {}
  ): Promise<PipelineResult> {
    const startTime = Date.now()
    const steps: PipelineStepResult[] = []
    const warnings: string[] = []

    const {
      auto_generate_audio = true,
      auto_approve_if_satisfactory = false,
      skip_if_exists = true,
      update_if_exists = false,
      mode = 'full'
    } = options

    try {
      // Step 1: Migration (homolog → core)
      const migrationStep = await this.executeMigrationStep(uuid_id, { skip_if_exists, update_if_exists })
      steps.push(migrationStep)

      if (!migrationStep.success) {
        return {
          success: false,
          steps,
          total_time: Date.now() - startTime,
          error: migrationStep.error || 'Migration failed'
        }
      }

      const attraction_id = migrationStep.data?.attraction_id
      if (!attraction_id) {
        return {
          success: false,
          steps,
          total_time: Date.now() - startTime,
          error: 'Migration succeeded but no attraction_id returned'
        }
      }

      // If mode is migration_only, stop here
      if (mode === 'migration_only') {
        return {
          success: true,
          attraction_id,
          steps,
          total_time: Date.now() - startTime
        }
      }

      // Step 2: Generate Description
      const descriptionStep = await this.executeDescriptionStep(attraction_id, { auto_generate_audio })
      steps.push(descriptionStep)

      // If description fails, stop pipeline (critical step)
      if (!descriptionStep.success) {
        return {
          success: false,
          attraction_id,
          steps,
          total_time: Date.now() - startTime,
          error: `Description generation failed: ${descriptionStep.error}`,
          warnings
        }
      }

      // If mode is migration_description, stop here
      if (mode === 'migration_description') {
        return {
          success: true,
          attraction_id,
          steps,
          total_time: Date.now() - startTime,
          warnings: warnings.length > 0 ? warnings : undefined
        }
      }

      // Step 3: Audio is generated automatically if auto_generate_audio is true
      // Check if audio was generated
      const audioStep = await this.checkAudioStep(attraction_id)
      steps.push(audioStep)

      // If mode is migration_description_audio, stop here
      if (mode === 'migration_description_audio') {
        return {
          success: true,
          attraction_id,
          steps,
          total_time: Date.now() - startTime,
          warnings: warnings.length > 0 ? warnings : undefined
        }
      }

      // Step 4: Generate Trigger Points
      const triggerPointsStep = await this.executeTriggerPointsStep(attraction_id)
      steps.push(triggerPointsStep)

      // If trigger points fail, continue but don't auto-approve
      if (!triggerPointsStep.success) {
        warnings.push(`Trigger points generation failed: ${triggerPointsStep.error}`)
      }

      // Step 5: Auto-approve if criteria met
      if (auto_approve_if_satisfactory) {
        const approvalStep = await this.executeApprovalStep(attraction_id, steps)
        steps.push(approvalStep)

        if (!approvalStep.success) {
          warnings.push(`Auto-approval failed: ${approvalStep.error}`)
        }
      }

      return {
        success: true,
        attraction_id,
        steps,
        total_time: Date.now() - startTime,
        warnings: warnings.length > 0 ? warnings : undefined
      }
    } catch (error) {
      console.error('Pipeline error:', error)
      return {
        success: false,
        steps,
        total_time: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error during pipeline execution'
      }
    }
  }

  /**
   * Step 1: Migration
   */
  private static async executeMigrationStep(
    uuid_id: string,
    options: { skip_if_exists: boolean; update_if_exists: boolean }
  ): Promise<PipelineStepResult> {
    const stepStart = Date.now()

    try {
      // Check if already exists (if skip_if_exists is enabled)
      if (options.skip_if_exists) {
        const { data: existing } = await supabase
          .schema('core')
          .from('attractions')
          .select('id')
          .eq('id', uuid_id)
          .maybeSingle()

        if (existing) {
          console.log(`⏭️  Skipping ${uuid_id}: already exists in core`)
          return {
            step: 'migration',
            success: true,
            data: { attraction_id: existing.id, skipped: true },
            processing_time: Date.now() - stepStart
          }
        }
      }

      // Execute migration
      const result = await MigrationService.migratePOI(uuid_id)

      return {
        step: 'migration',
        success: result.success,
        error: result.error,
        data: result.attraction_id ? { attraction_id: result.attraction_id } : undefined,
        processing_time: Date.now() - stepStart
      }
    } catch (error) {
      return {
        step: 'migration',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        processing_time: Date.now() - stepStart
      }
    }
  }

  /**
   * Step 2: Generate Description
   */
  private static async executeDescriptionStep(
    attraction_id: string,
    options: { auto_generate_audio: boolean }
  ): Promise<PipelineStepResult> {
    const stepStart = Date.now()

    try {
      // Check if description already exists
      const { data: existingDescription } = await supabase
        .schema('core')
        .from('attraction_descriptions')
        .select('id')
        .eq('attraction_id', attraction_id)
        .eq('language', 'pt-br')
        .single()

      if (existingDescription) {
        return {
          step: 'description',
          success: true,
          data: { description_id: existingDescription.id, skipped: true },
          processing_time: Date.now() - stepStart
        }
      }

      // Get POI data for description generation
      const { data: poi, error: poiError } = await supabase
        .schema('core')
        .from('attractions')
        .select(`
          id,
          name,
          city,
          state,
          country,
          attraction_coordinate!inner(latitude, longitude)
        `)
        .eq('id', attraction_id)
        .single()

      if (poiError || !poi) {
        return {
          step: 'description',
          success: false,
          error: `Failed to load POI: ${poiError?.message || 'POI not found'}`,
          processing_time: Date.now() - stepStart
        }
      }

      // Use DescriptionService directly (better than API call)
      const { DescriptionService } = await import('./poi-processing/description.service')
      
      const poiData = {
        id: attraction_id,
        name: poi.name,
        city: poi.city,
        state: poi.state,
        country: poi.country,
        lat: poi.attraction_coordinate[0].latitude,
        lng: poi.attraction_coordinate[0].longitude
      }

      const result = await DescriptionService.generate(poiData, {
        auto_generate_audio: options.auto_generate_audio,
        persist_verification: true,
        language: 'pt-br'
      })

      if (!result.success) {
        return {
          step: 'description',
          success: false,
          error: result.error || 'Description generation failed',
          processing_time: Date.now() - stepStart
        }
      }

      // Extract verification result from description service
      const verification = result.data?.verification

      return {
        step: 'description',
        success: result.success,
        data: {
          description: result.data?.description,
          verification: verification,
          description_id: result.data?.description_id
        },
        processing_time: result.processing_time || Date.now() - stepStart
      }
    } catch (error) {
      return {
        step: 'description',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        processing_time: Date.now() - stepStart
      }
    }
  }

  /**
   * Step 3: Check Audio (generated automatically if auto_generate_audio was true)
   */
  private static async checkAudioStep(attraction_id: string): Promise<PipelineStepResult> {
    const stepStart = Date.now()

    try {
      // Check if audio exists
      const { data: description } = await supabase
        .schema('core')
        .from('attraction_descriptions')
        .select('audio_url')
        .eq('attraction_id', attraction_id)
        .eq('language', 'pt-br')
        .not('audio_url', 'is', null)
        .single()

      return {
        step: 'audio',
        success: !!description?.audio_url,
        data: { audio_url: description?.audio_url },
        processing_time: Date.now() - stepStart
      }
    } catch (error) {
      return {
        step: 'audio',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        processing_time: Date.now() - stepStart
      }
    }
  }

  /**
   * Step 4: Generate Trigger Points
   */
  private static async executeTriggerPointsStep(attraction_id: string): Promise<PipelineStepResult> {
    const stepStart = Date.now()

    try {
      // Use ProcessingService to generate trigger points
      const result = await ProcessingService.processTriggerPoints(
        [attraction_id],
        {
          batchSize: 1,
          delayBetweenCalls: 0
        }
      )

      const poiResult = result.results?.[0]

      return {
        step: 'trigger_points',
        success: poiResult?.success || false,
        error: poiResult?.message && !poiResult.success ? poiResult.message : undefined,
        data: poiResult?.data,
        processing_time: Date.now() - stepStart
      }
    } catch (error) {
      return {
        step: 'trigger_points',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        processing_time: Date.now() - stepStart
      }
    }
  }

  /**
   * Step 5: Auto-approve if criteria met
   */
  private static async executeApprovalStep(
    attraction_id: string,
    previousSteps: PipelineStepResult[]
  ): Promise<PipelineStepResult> {
    const stepStart = Date.now()

    try {
      // Get description step result
      const descriptionStep = previousSteps.find(s => s.step === 'description')
      const descriptionScore = descriptionStep?.data?.verification?.pontuacao
      const descriptionApproved = descriptionStep?.data?.verification?.aprovada

      // Get audio step result
      const audioStep = previousSteps.find(s => s.step === 'audio')
      const audioGenerated = audioStep?.success && audioStep?.data?.audio_url

      // Get trigger points step result
      const triggerPointsStep = previousSteps.find(s => s.step === 'trigger_points')
      const triggerPointsCount = triggerPointsStep?.data?.trigger_points_saved || 0

      // Check trigger points confidence
      const { data: triggerPoints } = await supabase
        .schema('core')
        .from('attraction_trigger_points')
        .select('confidence_score')
        .eq('attraction_id', attraction_id)
        .eq('is_active', true)
        .order('confidence_score', { ascending: false })
        .limit(1)

      const maxConfidence = triggerPoints?.[0]?.confidence_score || 0

      // Criteria for auto-approval (from plan decisions)
      const shouldApprove =
        descriptionScore !== undefined &&
        descriptionScore > 75 && // Score > 75 (not >=)
        descriptionApproved === true &&
        audioGenerated === true &&
        triggerPointsCount >= 1 && // At least 1 trigger point
        maxConfidence > 0.4 // Max confidence > 0.4

      if (!shouldApprove) {
        return {
          step: 'approval',
          success: false,
          error: 'Criteria not met for auto-approval',
          data: {
            criteria: {
              description_score: descriptionScore,
              description_approved: descriptionApproved,
              audio_generated: audioGenerated,
              trigger_points_count: triggerPointsCount,
              max_confidence: maxConfidence
            }
          },
          processing_time: Date.now() - stepStart
        }
      }

      // Approve POI
      const { error: updateError } = await supabase
        .schema('core')
        .from('attractions')
        .update({ approved: true })
        .eq('id', attraction_id)

      if (updateError) {
        return {
          step: 'approval',
          success: false,
          error: updateError.message,
          processing_time: Date.now() - stepStart
        }
      }

      return {
        step: 'approval',
        success: true,
        data: { approved: true },
        processing_time: Date.now() - stepStart
      }
    } catch (error) {
      return {
        step: 'approval',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        processing_time: Date.now() - stepStart
      }
    }
  }
}

