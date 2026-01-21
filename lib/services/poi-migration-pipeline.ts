/**
 * POI Migration Pipeline - Orchestrates complete migration process
 * 
 * Handles end-to-end migration: homolog → core → description → audio → trigger points → activation
 */

import { MigrationResult, MigrationService } from './migration-service'
import ProcessingService from '@/lib/core/processing-service'
import { getSupabase } from '@/lib/core/supabase-client'
import { HomologEnrichmentService } from './poi-processing/homolog-enrichment.service'

const supabase = getSupabase('service')

// Get Supabase URL and anon key for Edge Functions (same as frontend)
const getSupabaseConfig = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  
  if (!supabaseUrl || !anonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables')
  }
  
  return { supabaseUrl, anonKey }
}

export interface PipelineOptions {
  auto_generate_audio?: boolean
  auto_approve_if_satisfactory?: boolean
  skip_if_exists?: boolean
  update_if_exists?: boolean
  // Mode determines which steps to run:
  // - 'enrichment_migration_triggers': Enrichment -> Migration -> Trigger Points -> Simplified Approval (DEFAULT)
  // - 'migration_only': Migration only
  // - 'migration_description': Migration -> Description
  // - 'migration_description_audio': Migration -> Description -> Audio
  // - 'full': All steps with full approval criteria
  mode?: 'enrichment_migration_triggers' | 'migration_only' | 'migration_description' | 'migration_description_audio' | 'full'
  // Optional: languages for description/audio generation (when mode includes description/audio)
  languages?: string[]
  // Optional: voice gender for audio generation
  voice_gender?: 'male' | 'female'
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
      auto_generate_audio = false, // DISABLED by default as per new requirements
      auto_approve_if_satisfactory = false,
      skip_if_exists = true,
      update_if_exists = false,
      mode = 'enrichment_migration_triggers', // NEW DEFAULT: Enrichment -> Migration -> Triggers
      languages = ['pt-br'],
      voice_gender = 'male'
    } = options

    try {
      // Pre-flight check: Should this POI be processed?
      const shouldProcess = await MigrationService.shouldProcessPOI(uuid_id)
      if (!shouldProcess.should_process) {
        return {
          success: false,
          steps,
          total_time: Date.now() - startTime,
          error: shouldProcess.reason || 'POI should not be processed'
        }
      }

      // Mark as processing
      await MigrationService.updateProcessingStatus(uuid_id, 'processing')

      // Step 0: Enrichment (Homolog) - NEW STEP
      console.log(`🌍 Step 0: Enriching Homolog POI ${uuid_id}...`)
      const enrichmentStep = await this.executeEnrichmentStep(uuid_id)
      steps.push(enrichmentStep)

      if (!enrichmentStep.success) {
        // We log error but maybe we can continue if it's just enrichment failure?
        // User said: "Fez o enriquecimento e salvou, vai pegar o mesmo poi, vai migrar..."
        // Use logic implies strict dependency.
        console.warn(`⚠️ Enrichment failed for ${uuid_id}: ${enrichmentStep.error}. Continuing with migration anyway...`)
      } else {
        console.log(`✅ Enrichment successful/completed for ${uuid_id}`)
      }

      // Step 1: Migration (homolog → core)
      console.log(`🔄 Step 1: Migrating POI ${uuid_id} from homolog to core...`)
      const migrationStep = await this.executeMigrationStep(uuid_id, { skip_if_exists, update_if_exists })
      steps.push(migrationStep)

      if (!migrationStep.success) {
        console.error(`❌ Migration failed for ${uuid_id}: ${migrationStep.error}`)
        // Mark as failed
        await MigrationService.updateProcessingStatus(uuid_id, 'failed', migrationStep.error)
        return {
          success: false,
          steps,
          total_time: Date.now() - startTime,
          error: migrationStep.error || 'Migration failed'
        }
      }
      console.log(`✅ Migration successful for ${uuid_id}, attraction_id: ${migrationStep.data?.attraction_id}`)

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

      // NOTE: Description and Audio steps are effectively DISABLED for the standard flow now,
      // but we keep the code reachable if explicitly requested via mode settings or future flags.
      // The user stated: "We will not generate description and neither generate audio anymore."
      
      const shouldGenerateDescription = mode === 'migration_description' || mode === 'migration_description_audio'
      
      if (shouldGenerateDescription) {
          // Step 2: Generate Description
          console.log(`📝 Step 2: Generating description for ${attraction_id}...`)
          const descriptionStep = await this.executeDescriptionStep(attraction_id, { auto_generate_audio })
          steps.push(descriptionStep)

          // If description fails, rollback and stop pipeline (critical step)
          if (!descriptionStep.success) {
            console.error(`❌ Description generation failed for ${attraction_id}: ${descriptionStep.error}`)
            // Rollback: remove POI from core
            await MigrationService.rollbackMigration(attraction_id)
            // Mark as failed
            await MigrationService.updateProcessingStatus(uuid_id, 'failed', descriptionStep.error)
            return {
              success: false,
              attraction_id,
              steps,
              total_time: Date.now() - startTime,
              error: `Description generation failed: ${descriptionStep.error}`,
              warnings
            }
          }
          console.log(`✅ Description generated successfully for ${attraction_id}`)
      } else {
          console.log(`⏭️  Skipping Description Step (Disabled by default)`)
      }
      console.log(`✅ Description generated successfully for ${attraction_id}`)

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

      // Step 3: Audio (Skipped if description was skipped or auto_generate_audio is false)
      if (shouldGenerateDescription && auto_generate_audio) {
          if (auto_generate_audio) {
            console.log(`⏳ Waiting 1s for pt-br audio to be persisted...`)
            await new Promise(resolve => setTimeout(resolve, 1000))
          }
          
          // Check if audio was generated (pt-br)
          const audioStep = await this.checkAudioStep(attraction_id)
          steps.push(audioStep)

          // Step 3b: Generate multi-language audios (en-us, es-es)
          if (audioStep.success && auto_generate_audio) {
            console.log(`⏳ Waiting 500ms before generating multi-language audios...`)
            await new Promise(resolve => setTimeout(resolve, 500))
            
            const multiLanguageAudioStep = await this.executeMultiLanguageAudioStep(attraction_id)
            steps.push(multiLanguageAudioStep)
            if (!multiLanguageAudioStep.success) {
              warnings.push(`Multi-language audio generation failed: ${multiLanguageAudioStep.error}`)
            }
          }
      } else {
           console.log(`⏭️  Skipping Audio Steps (Disabled by default)`)
      }

      // If mode is migration_description_audio, stop here
      if (mode === 'migration_description_audio') {
        // Mark as migrated (but not approved yet)
        await MigrationService.updateProcessingStatus(uuid_id, 'migrated')
        return {
          success: true,
          attraction_id,
          steps,
          total_time: Date.now() - startTime,
          warnings: warnings.length > 0 ? warnings : undefined
        }
      }

      // Step 4: Generate Trigger Points
      console.log(`📍 Step 4: Generating trigger points for ${attraction_id}...`)
      const triggerPointsStep = await this.executeTriggerPointsStep(attraction_id)
      steps.push(triggerPointsStep)

      // If trigger points fail, rollback and stop (critical for approval)
      if (!triggerPointsStep.success) {
        console.error(`❌ Trigger points generation failed for ${attraction_id}: ${triggerPointsStep.error}`)
        // Rollback: remove POI from core
        await MigrationService.rollbackMigration(attraction_id)
        // Mark as failed
        await MigrationService.updateProcessingStatus(uuid_id, 'failed', triggerPointsStep.error)
        return {
          success: false,
          attraction_id,
          steps,
          total_time: Date.now() - startTime,
          error: `Trigger points generation failed: ${triggerPointsStep.error}`,
          warnings
        }
      }
      console.log(`✅ Trigger points generated successfully for ${attraction_id}`)

      // NEW SIMPLIFIED FLOW: For enrichment_migration_triggers mode,
      // auto-approve and delete from homolog immediately after trigger points succeed
      if (mode === 'enrichment_migration_triggers') {
        console.log(`🚀 Simplified approval flow (enrichment_migration_triggers mode)...`)
        
        const simplifiedApprovalStep = await this.executeSimplifiedApprovalStep(attraction_id, uuid_id)
        steps.push(simplifiedApprovalStep)
        
        if (!simplifiedApprovalStep.success) {
          // Rollback: remove POI from core
          await MigrationService.rollbackMigration(attraction_id)
          // Mark as failed
          await MigrationService.updateProcessingStatus(uuid_id, 'failed', simplifiedApprovalStep.error)
          return {
            success: false,
            attraction_id,
            steps,
            total_time: Date.now() - startTime,
            error: `Simplified approval failed: ${simplifiedApprovalStep.error}`,
            warnings
          }
        }
        
        return {
          success: true,
          attraction_id,
          steps,
          total_time: Date.now() - startTime,
          warnings: warnings.length > 0 ? warnings : undefined
        }
      }

      // Step 5: Auto-approve if criteria met (FULL mode with description/audio)
      if (auto_approve_if_satisfactory) {
        const approvalStep = await this.executeApprovalStep(attraction_id, steps)
        steps.push(approvalStep)

        if (!approvalStep.success) {
          // Rollback: remove POI from core
          await MigrationService.rollbackMigration(attraction_id)
          // Mark as failed
          await MigrationService.updateProcessingStatus(uuid_id, 'failed', approvalStep.error)
          return {
            success: false,
            attraction_id,
            steps,
            total_time: Date.now() - startTime,
            error: `Approval failed: ${approvalStep.error}`,
            warnings
          }
        }

        // Step 6: Remove duplicate POIs by coordinates (only if approved)
        if (approvalStep.success && approvalStep.data?.approved) {
          const cleanupStep = await this.executeRemoveDuplicatesStep(attraction_id)
          steps.push(cleanupStep)
          
          if (!cleanupStep.success) {
            warnings.push(`Failed to remove duplicate POIs: ${cleanupStep.error}`)
            // Don't fail the whole migration if cleanup fails
          }
        }

        // Step 7: Remove from homolog (only if approved)
        if (approvalStep.success && approvalStep.data?.approved) {
          const deleteStep = await this.executeDeleteFromHomologStep(uuid_id)
          steps.push(deleteStep)
          
          if (!deleteStep.success) {
            warnings.push(`Failed to delete from homolog: ${deleteStep.error}`)
            // Don't fail the whole migration if delete fails - POI is already in core and approved
          }
        }
      } else {
        // Even if not auto-approved, mark as migrated (manual approval later)
        await MigrationService.updateProcessingStatus(uuid_id, 'migrated')
      }

      return {
        success: true,
        attraction_id,
        steps,
        total_time: Date.now() - startTime,
        warnings: warnings.length > 0 ? warnings : undefined
      }
    } catch (error) {
      console.error('❌ Pipeline exception for POI:', uuid_id)
      console.error('   Error:', error)
      if (error instanceof Error) {
        console.error('   Stack:', error.stack)
      }
      console.error('   Steps completed before error:', steps.length)
      return {
        success: false,
        steps,
        total_time: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error during pipeline execution'
      }
    }
  }

  /**
   * Step 0: Enrichment (Homolog)
   */
  private static async executeEnrichmentStep(uuid_id: string): Promise<PipelineStepResult> {
    const stepStart = Date.now()
    try {
      // 1. Load basic data from Homolog
      const { data: poi, error } = await supabase
        .schema('homolog')
        .from('pois')
        .select('uuid_id, name')
        .eq('uuid_id', uuid_id)
        .single()
        
      if (error || !poi) {
         return {
            step: 'enrichment',
            success: false,
            error: `Failed to load POI from homolog: ${error?.message}`,
            processing_time: Date.now() - stepStart
         }
      }

      // 2. Call Enrichment Service
      const result = await HomologEnrichmentService.enrichPOI({
          uuid_id: poi.uuid_id,
          name: poi.name
      })

      return {
          step: 'enrichment',
          success: result.success,
          error: result.error,
          data: result.fields_updated ? { fields_updated: result.fields_updated } : undefined,
          processing_time: Date.now() - stepStart
      }
    } catch (error) {
       return {
          step: 'enrichment',
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error during enrichment',
          processing_time: Date.now() - stepStart
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
      console.log(`   Executing MigrationService.migratePOI(${uuid_id})...`)
      const result = await MigrationService.migratePOI(uuid_id)
      
      if (!result.success) {
        console.error(`   Migration error: ${result.error}`)
        if (result.warnings && result.warnings.length > 0) {
          console.warn(`   Warnings:`, result.warnings)
        }
      }

      return {
        step: 'migration',
        success: result.success,
        error: result.error,
        data: result.attraction_id ? { attraction_id: result.attraction_id } : undefined,
        processing_time: Date.now() - stepStart
      }
    } catch (error) {
      console.error(`   Migration exception:`, error)
      if (error instanceof Error) {
        console.error(`   Stack:`, error.stack)
      }
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

      // Get POI data for description generation (using SSOT function)
      console.log(`   Loading POI data from core.attractions...`)
      const poiResult = await MigrationService.loadPOIWithCoordinates(attraction_id)

      if (!poiResult.success || !poiResult.data) {
        console.error(`   Failed to load POI: ${poiResult.error}`)
        return {
          step: 'description',
          success: false,
          error: `Failed to load POI: ${poiResult.error}`,
          processing_time: Date.now() - stepStart
        }
      }

      const { poi, coordinate } = poiResult.data

      console.log(`   POI loaded: ${poi.name} (${poi.city}, ${poi.state})`)
      console.log(`   Coordinates: ${coordinate.latitude}, ${coordinate.longitude}`)

      // Use DescriptionService directly (better than API call)
      console.log(`   Calling DescriptionService.generate()...`)
      const { DescriptionService } = await import('./poi-processing/description.service')
      
      const poiData = {
        id: attraction_id,
        name: poi.name,
        city: poi.city,
        state: poi.state,
        country: poi.country,
        lat: coordinate.latitude,
        lng: coordinate.longitude
      }

      const result = await DescriptionService.generate(poiData, {
        auto_generate_audio: options.auto_generate_audio,
        persist_verification: true,
        language: 'pt-br'
      })

      if (!result.success) {
        console.error(`   DescriptionService.generate() failed: ${result.error}`)
        return {
          step: 'description',
          success: false,
          error: result.error || 'Description generation failed',
          processing_time: Date.now() - stepStart
        }
      }
      
      console.log(`   Description generated successfully`)

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
   * Note: Audio generation is currently a placeholder in DescriptionService
   * This step checks if audio exists but doesn't fail the pipeline if it doesn't
   */
  private static async checkAudioStep(attraction_id: string): Promise<PipelineStepResult> {
    const stepStart = Date.now()

    try {
      console.log(`🎵 Step 3: Checking audio for ${attraction_id}...`)
      
      // Check if audio exists
      const { data: description, error: descError } = await supabase
        .schema('core')
        .from('attraction_descriptions')
        .select('audio_url')
        .eq('attraction_id', attraction_id)
        .eq('language', 'pt-br')
        .maybeSingle()

      if (descError) {
        console.warn(`⚠️  Error checking audio: ${descError.message}`)
        // Don't fail - audio is optional
        return {
          step: 'audio',
          success: false,
          data: { audio_url: null, note: 'Audio check failed, but continuing' },
          processing_time: Date.now() - stepStart
        }
      }

      const hasAudio = !!description?.audio_url
      console.log(`   Audio status: ${hasAudio ? '✅ Found' : '⚠️  Not found (will be generated later)'}`)
      
      // Audio is optional - don't fail pipeline if it doesn't exist
      // It will be generated later via AudioService or Edge Function
      return {
        step: 'audio',
        success: true, // Always return success - audio is optional
        data: { 
          audio_url: description?.audio_url || null,
          note: hasAudio ? 'Audio exists' : 'Audio not yet generated (will be generated later)'
        },
        processing_time: Date.now() - stepStart
      }
    } catch (error) {
      console.warn(`⚠️  Exception checking audio:`, error)
      // Don't fail pipeline for audio check errors
      return {
        step: 'audio',
        success: true, // Return success even on error - audio is optional
        data: { audio_url: null, note: 'Audio check failed, but continuing' },
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
      console.log(`📍 Step 4: Generating trigger points for ${attraction_id}...`)
      
      // First, verify POI exists and load it with coordinates (using SSOT function)
      console.log(`   Loading POI data...`)
      const poiResult = await MigrationService.loadPOIWithCoordinates(attraction_id)
      
      if (!poiResult.success || !poiResult.data) {
        console.error(`   ❌ Failed to load POI: ${poiResult.error}`)
        return {
          step: 'trigger_points',
          success: false,
          error: `Failed to load POI: ${poiResult.error}`,
          processing_time: Date.now() - stepStart
        }
      }
      
      const { poi, coordinate } = poiResult.data
      console.log(`   ✅ POI loaded: ${poi.name} (${poi.city}, ${poi.state})`)
      console.log(`   📍 Coordinates: ${coordinate.latitude}, ${coordinate.longitude}`)
      
      const lat = coordinate.latitude
      const lng = coordinate.longitude

      // Prepare POI data for trigger points generation (same format as /trigger-points-single)
      const poiData = {
        id: poi.id,
        name: poi.name,
        location: {
          lat: lat,
          lng: lng
        },
        type: poi.category || 'point_of_interest',
        country: poi.country,
        city: poi.city,
        state: poi.state
      }

      // Use CoreTriggerPointPredictor (same motor as /trigger-points-single page)
      console.log(`   🎯 Calling CoreTriggerPointPredictor (new motor - same as /trigger-points-single)...`)
      const { CoreTriggerPointPredictor } = await import('./trigger-points-google/core/trigger-point-predictor')
      
      const predictor = new CoreTriggerPointPredictor()
      const predictionResult = await predictor.predictTriggerPointsComplete(poiData, {
        maxSearchRadius: 1000,
        minQuality: 0.4
      })

      if (!predictionResult.triggerPoints || predictionResult.triggerPoints.length === 0) {
        const errorMsg = 'No trigger points generated'
        console.error(`   ❌ Trigger points generation failed: ${errorMsg}`)
        return {
          step: 'trigger_points',
          success: false,
          error: errorMsg,
          processing_time: Date.now() - stepStart
        }
      }

      const triggerPointsCount = predictionResult.triggerPoints.length
      console.log(`   ✅ Generated ${triggerPointsCount} trigger points`)

      // Save trigger points to database using TriggerPointSavingService
      console.log(`   💾 Saving trigger points to database...`)
      const { TriggerPointSavingService } = await import('./trigger-point-saving')
      
      // Convert TriggerPoint[] to TriggerPointSaveData[]
      const triggerPointsToSave = predictionResult.triggerPoints.map(tp => ({
        attraction_id,
        lat: tp.location.lat,
        lng: tp.location.lng,
        radius_meters: tp.radius || 50,
        expected_bearing: tp.expectedBearing,
        bearing_threshold: tp.bearingThreshold || 30,
        type: tp.type,
        priority: tp.priority || 1,
        is_active: true,
        access: 'both' as 'walk' | 'car' | 'both',
        confidence: tp.confidence || 0.5,
        generation_method: tp.generationMethod || 'google_apis',
        boundary_source: predictionResult.boundary?.source || 'unknown'
      }))
      
      const saveResult = await TriggerPointSavingService.saveTriggerPoints(
        attraction_id,
        triggerPointsToSave,
        {
          mode: 'replace_all',
          boundarySource: predictionResult.boundary?.source || 'unknown'
        }
      )

      const savedCount = saveResult.saved || 0

      // Validate that at least one trigger point was saved
      if (savedCount === 0) {
        const errorMsg = saveResult.errors && saveResult.errors.length > 0
          ? `Failed to save trigger points: ${saveResult.errors.join('; ')}`
          : 'No trigger points were saved to database (generated but not persisted)'
        console.error(`   ❌ ${errorMsg}`)
        return {
          step: 'trigger_points',
          success: false,
          error: errorMsg,
          processing_time: Date.now() - stepStart
        }
      }

      // Log warnings if there were errors but some TPs were saved
      if (saveResult.errors && saveResult.errors.length > 0) {
        console.warn(`   ⚠️  Some errors occurred but ${savedCount} trigger points were saved: ${saveResult.errors.join('; ')}`)
      }

      console.log(`   ✅ Saved ${savedCount} trigger points to database`)

      // Calculate max confidence from saved trigger points
      const maxConfidence = predictionResult.triggerPoints.length > 0
        ? Math.max(...predictionResult.triggerPoints.map(tp => tp.confidence || 0))
        : 0

      return {
        step: 'trigger_points',
        success: true,
        data: {
          trigger_points_generated: triggerPointsCount,
          trigger_points_saved: savedCount,
          trigger_points_skipped: saveResult.skipped || 0,
          confidence_score: maxConfidence,
          boundary_source: predictionResult.boundary?.source || 'unknown'
        },
        processing_time: Date.now() - stepStart
      }
    } catch (error) {
      console.error(`   ❌ Exception in trigger points generation:`, error)
      if (error instanceof Error) {
        console.error(`   Stack:`, error.stack)
      }
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

      // Get audio step result (pt-br)
      const audioStep = previousSteps.find(s => s.step === 'audio')
      // Check if audio URL exists and is a valid string (not just truthy)
      const audioGenerated = !!(audioStep?.success && audioStep?.data?.audio_url && typeof audioStep.data.audio_url === 'string' && audioStep.data.audio_url.length > 0)

      // Get multi-language audio step result (en-us, es-es)
      const multiLanguageAudioStep = previousSteps.find(s => s.step === 'multi_language_audio')
      
      // Check if multi-language audios actually exist in database (more reliable than step result)
      const { data: multiLangDescriptions } = await supabase
        .schema('core')
        .from('attraction_descriptions')
        .select('language, audio_url')
        .eq('attraction_id', attraction_id)
        .in('language', ['en-us', 'es-es'])
      
      const multiLanguageAudioSuccess = multiLangDescriptions && multiLangDescriptions.length >= 1 && 
        multiLangDescriptions.some(d => d.audio_url) // At least one has audio URL

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
      // Now requires: description, pt-br audio, multi-language audios (en-us, es-es), and trigger points
      const shouldApprove =
        descriptionScore !== undefined &&
        descriptionScore >= 75 && // Score >= 75 (approved descriptions start at 75)
        descriptionApproved === true &&
        audioGenerated === true && // pt-br audio must be generated
        multiLanguageAudioSuccess === true && // Multi-language audios (en-us, es-es) must be generated
        triggerPointsCount >= 1 && // At least 1 trigger point
        maxConfidence > 0.4 // Max confidence > 0.4

      // Log criteria for debugging
      console.log(`   📊 Approval criteria check:`)
      console.log(`      - description_score: ${descriptionScore} (required: >= 75) - ${descriptionScore !== undefined && descriptionScore >= 75 ? '✅' : '❌'}`)
      console.log(`      - description_approved: ${descriptionApproved} (required: true) - ${descriptionApproved === true ? '✅' : '❌'}`)
      const audioUrlValue = audioStep?.data?.audio_url
      console.log(`      - audio_generated: ${audioUrlValue || 'false'} (required: true) - ${audioGenerated === true ? '✅' : '❌'}`)
      console.log(`         (audioStep.success: ${audioStep?.success}, audio_url type: ${typeof audioUrlValue}, audio_url length: ${audioUrlValue?.length || 0})`)
      console.log(`      - multi_language_audio_success: ${multiLanguageAudioSuccess} (required: true) - ${multiLanguageAudioSuccess === true ? '✅' : '❌'}`)
      console.log(`      - trigger_points_count: ${triggerPointsCount} (required: >= 1) - ${triggerPointsCount >= 1 ? '✅' : '❌'}`)
      console.log(`      - max_confidence: ${maxConfidence} (required: > 0.4) - ${maxConfidence > 0.4 ? '✅' : '❌'}`)
      console.log(`   🔍 shouldApprove evaluation: ${shouldApprove}`)

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
              multi_language_audio_success: multiLanguageAudioSuccess,
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

  /**
   * Simplified Approval Step for enrichment_migration_triggers mode
   * Only requires: Migration successful + Trigger Points (≥1 with confidence > 0.4)
   * Auto-activates POI and deletes from homolog
   */
  private static async executeSimplifiedApprovalStep(
    attraction_id: string,
    uuid_id: string
  ): Promise<PipelineStepResult> {
    const stepStart = Date.now()

    try {
      // Check trigger points exist and have good confidence
      const { data: triggerPoints, error: tpError } = await supabase
        .schema('core')
        .from('attraction_trigger_points')
        .select('id, confidence_score')
        .eq('attraction_id', attraction_id)
        .eq('is_active', true)
        .order('confidence_score', { ascending: false })
        .limit(5)

      if (tpError) {
        return {
          step: 'simplified_approval',
          success: false,
          error: `Failed to check trigger points: ${tpError.message}`,
          processing_time: Date.now() - stepStart
        }
      }

      const triggerPointsCount = triggerPoints?.length || 0
      const maxConfidence = triggerPoints?.[0]?.confidence_score || 0

      console.log(`   📊 Simplified Approval criteria check:`)
      console.log(`      - trigger_points_count: ${triggerPointsCount} (required: >= 1) - ${triggerPointsCount >= 1 ? '✅' : '❌'}`)
      console.log(`      - max_confidence: ${maxConfidence} (required: > 0.4) - ${maxConfidence > 0.4 ? '✅' : '❌'}`)

      // Simplified criteria: only need trigger points with good confidence
      const shouldApprove = triggerPointsCount >= 1 && maxConfidence > 0.4

      if (!shouldApprove) {
        return {
          step: 'simplified_approval',
          success: false,
          error: 'Criteria not met: Need at least 1 trigger point with confidence > 0.4',
          data: {
            trigger_points_count: triggerPointsCount,
            max_confidence: maxConfidence
          },
          processing_time: Date.now() - stepStart
        }
      }

      // Step 1: Activate POI (set approved = true)
      console.log(`   ✅ Activating POI ${attraction_id}...`)
      const { error: updateError } = await supabase
        .schema('core')
        .from('attractions')
        .update({ approved: true })
        .eq('id', attraction_id)

      if (updateError) {
        return {
          step: 'simplified_approval',
          success: false,
          error: `Failed to activate POI: ${updateError.message}`,
          processing_time: Date.now() - stepStart
        }
      }

      // Step 2: Delete from homolog (POI now lives only in core)
      console.log(`   🗑️ Deleting POI from homolog ${uuid_id}...`)
      const deleteResult = await MigrationService.safeDeleteFromHomolog(uuid_id)
      
      if (!deleteResult.success) {
        // Log warning but don't fail - POI is already activated in core
        console.warn(`   ⚠️ Failed to delete from homolog: ${deleteResult.error}`)
        return {
          step: 'simplified_approval',
          success: true,
          data: { 
            approved: true,
            deleted_from_homolog: false,
            warning: deleteResult.error
          },
          processing_time: Date.now() - stepStart
        }
      }

      // Step 3: Mark as migrated in processing status
      await MigrationService.updateProcessingStatus(uuid_id, 'migrated')

      console.log(`   ✅ Simplified approval complete: POI activated and removed from homolog`)

      return {
        step: 'simplified_approval',
        success: true,
        data: { 
          approved: true, 
          deleted_from_homolog: true,
          trigger_points_count: triggerPointsCount,
          max_confidence: maxConfidence
        },
        processing_time: Date.now() - stepStart
      }
    } catch (error) {
      return {
        step: 'simplified_approval',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        processing_time: Date.now() - stepStart
      }
    }
  }

  /**
   * Step 3b: Generate multi-language audios (en-us, es-es)
   */
  private static async executeMultiLanguageAudioStep(attraction_id: string): Promise<PipelineStepResult> {
    const stepStart = Date.now()

    try {
      // CRITICAL: Verify that pt-br description exists before generating translations
      // The Edge Function needs the original Portuguese description to translate
      console.log(`🔍 Verifying pt-br description exists before generating multi-language audios...`)
      
      let ptBrDescription = null
      let retries = 3
      while (retries > 0 && !ptBrDescription) {
        const { data: desc, error: descError } = await supabase
          .schema('core')
          .from('attraction_descriptions')
          .select('description, language')
          .eq('attraction_id', attraction_id)
          .in('language', ['pt-br', 'pt'])
          .order('language', { ascending: true }) // Prefer pt-br over pt
          .limit(1)
          .maybeSingle()

        if (descError) {
          console.error(`   ❌ Error checking pt-br description: ${descError.message}`)
          throw new Error(`Failed to verify pt-br description: ${descError.message}`)
        }

        if (desc?.description) {
          ptBrDescription = desc.description
          console.log(`   ✅ Found pt-br description (${desc.language}, ${ptBrDescription.length} chars)`)
          break
        }

        retries--
        if (retries > 0) {
          console.log(`   ⏳ pt-br description not found, waiting 1s before retry (${retries} retries left)...`)
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
      }

      if (!ptBrDescription) {
        const errorMsg = 'Portuguese (pt-br) description not found in database. Cannot generate translations without original description.'
        console.error(`   ❌ ${errorMsg}`)
        throw new Error(errorMsg)
      }

      const languages = ['en-us', 'es-es']
      const results: string[] = []
      const { supabaseUrl, anonKey } = getSupabaseConfig()

      for (const lang of languages) {
        try {
          console.log(`🎙️  Generating ${lang} audio for attraction: ${attraction_id}`)
          
          const response = await fetch(`${supabaseUrl}/functions/v1/generate-translated-audio`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${anonKey}`
            },
            body: JSON.stringify({
              attractionId: attraction_id,
              targetLanguage: lang,
              voiceGender: 'male'
            })
          })

          if (!response.ok) {
            const errorText = await response.text()
            let errorData
            try {
              errorData = JSON.parse(errorText)
            } catch {
              errorData = { error: errorText }
            }
            const errorMsg = errorData.error || errorText
            console.error(`   ❌ ${lang} audio generation failed: HTTP ${response.status} - ${errorMsg}`)
            throw new Error(`HTTP ${response.status}: ${errorMsg}`)
          }

          const result = await response.json()
          console.log(`   ✅ ${lang} audio generated successfully`)
          if (result.data?.audioUrl) {
            console.log(`   📍 Audio URL: ${result.data.audioUrl}`)
          }
          results.push(`✅ ${lang}: generated successfully`)
          
          // Add small delay between languages to avoid rate limiting
          if (lang === 'en-us' && languages.indexOf('es-es') > -1) {
            console.log(`   ⏳ Waiting 500ms before generating next language...`)
            await new Promise(resolve => setTimeout(resolve, 500))
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error'
          console.error(`   ❌ ${lang} audio generation error: ${errorMsg}`)
          results.push(`❌ ${lang}: failed - ${errorMsg}`)
          // Continue with next language even if one fails
        }
      }

      const allSuccess = results.every(r => r.startsWith('✅'))
      
      return {
        step: 'multi_language_audio',
        success: allSuccess,
        error: allSuccess ? undefined : 'Some languages failed to generate audio',
        data: { results },
        processing_time: Date.now() - stepStart
      }
    } catch (error) {
      return {
        step: 'multi_language_audio',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        processing_time: Date.now() - stepStart
      }
    }
  }

  /**
   * Step 6: Remove duplicate POIs by coordinates (only after successful approval)
   */
  private static async executeRemoveDuplicatesStep(attraction_id: string): Promise<PipelineStepResult> {
    const stepStart = Date.now()

    try {
      console.log(`🧹 Step 6: Removing duplicate POIs for ${attraction_id}...`)
      
      // Get coordinates for the current POI
      const { data: coordinate } = await supabase
        .schema('core')
        .from('attraction_coordinate')
        .select('latitude, longitude')
        .eq('attraction_id', attraction_id)
        .maybeSingle()

      if (!coordinate) {
        return {
          step: 'remove_duplicates',
          success: false,
          error: 'Could not find coordinates for attraction',
          processing_time: Date.now() - stepStart
        }
      }

      const result = await MigrationService.removeDuplicatePOIsByCoordinates(
        attraction_id,
        coordinate.latitude,
        coordinate.longitude
      )

      if (result.errors.length > 0 && result.removed_count === 0) {
        return {
          step: 'remove_duplicates',
          success: false,
          error: result.errors.join('; '),
          data: result,
          processing_time: Date.now() - stepStart
        }
      }

      console.log(`✅ Removed ${result.removed_count} duplicate POI(s)`)
      
      return {
        step: 'remove_duplicates',
        success: true,
        data: result,
        processing_time: Date.now() - stepStart
      }
    } catch (error) {
      console.error(`❌ Error removing duplicates:`, error)
      return {
        step: 'remove_duplicates',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        processing_time: Date.now() - stepStart
      }
    }
  }

  /**
   * Step 7: Delete from homolog (only after successful approval)
   */
  private static async executeDeleteFromHomologStep(uuid_id: string): Promise<PipelineStepResult> {
    const stepStart = Date.now()

    try {
      console.log(`🗑️  Step 7: Removing POI ${uuid_id} from homolog...`)
      const result = await MigrationService.safeDeleteFromHomolog(uuid_id)

      if (!result.success) {
        return {
          step: 'delete_from_homolog',
          success: false,
          error: result.error,
          processing_time: Date.now() - stepStart
        }
      }

      console.log(`✅ Removed POI ${uuid_id} from homolog`)
      return {
        step: 'delete_from_homolog',
        success: true,
        data: { deleted: true },
        processing_time: Date.now() - stepStart
      }
    } catch (error) {
      return {
        step: 'delete_from_homolog',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        processing_time: Date.now() - stepStart
      }
    }
  }
}

