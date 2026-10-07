/**
 * POI Migration Pipeline - Orchestrates complete migration process
 * 
 * Handles end-to-end migration: homolog → core → description → audio → trigger points → activation
 */

import { MigrationResult, MigrationService } from './migration-service'
import ProcessingService from '@/lib/core/processing-service'
import { getSupabase } from '@/lib/core/supabase-client'
import { HomologEnrichmentService } from './poi-processing/homolog-enrichment.service'
import { stampGenerationMethod } from './dem/dem-sources'
import { boundaryGeoJson } from './trigger-points-google/utils/boundary-choice'
import { isAdminBorder } from './trigger-points-google/utils/admin-border-tps'
import { clearStoredBoundary } from './stored-boundary'

const supabase = getSupabase('service')

/**
 * Opções do motor de TP usadas na gravação e no dry-run. Sem maxSearchRadius — o motor
 * calcula dinamicamente via fan de visibilidade (o cap de 1000m cortava POIs grandes).
 */
export const TP_ENGINE_OPTIONS = { clusterIntersections: true, minQuality: 0.3 } as const

/**
 * Language the POI description is authored in. Translations always start from it, and the
 * audio step upstream already produces its narration — so it is never a translation target.
 * The catalogue of languages a POI may exist in belongs to BR-IDIOMA-001 and is chosen by the
 * operator; this file must not restate it.
 */
const SOURCE_LANGUAGE_TAGS = ['pt-br', 'pt']

// Get Supabase URL and anon key for Edge Functions (same as frontend)
const getSupabaseConfig = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY environment variables')
  }
  
  return { supabaseUrl, supabaseKey }
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
  // - 'reprocess_triggers_core': Skip Enrichment/Migration, run ONLY Trigger Points generation on Core DB
  mode?: 'enrichment_migration_triggers' | 'migration_only' | 'migration_description' | 'migration_description_audio' | 'full' | 'reprocess_triggers_core'
  // Optional: languages for description/audio generation (when mode includes description/audio)
  languages?: string[]
  // Optional: voice gender for audio generation
  voice_gender?: 'male' | 'female'
  // Phase 0 (TP quality plan): emit one `[TP_DEBUG_QUALITY] {...}` JSON line
  // per POI from the predictor. No behavior change. Pure observation, gated
  // by `--debug-quality true` on `scripts/migrate-pois-batch.ts`.
  debug_quality?: boolean
  // #779: the stored border wins over a detection of another footprint (`--stored-boundary`).
  stored_boundary_reference?: boolean
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
  skipped?: boolean
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
      voice_gender = 'male',
      debug_quality = false,
      stored_boundary_reference = false
    } = options

    // Set once this run owns the homolog row / a core row it may have to undo.
    let claimedHomologRow = false
    let rollbackTarget: string | undefined

    try {
      // SPECIAL MODE: Reprocess Triggers (Core Only)
      if (mode === 'reprocess_triggers_core') {
        console.log(`🎯 MODE: Reprocess Triggers (Core) for ${uuid_id}`)
        
        // Skip Homolog checks and Enrichment/Migration steps
        // The uuid_id passed here IS the attraction_id in core
        const attraction_id = uuid_id
        
        // Directly to Step 4: Generate Trigger Points
        console.log(`📍 Step 4: Generating trigger points for ${attraction_id}...`)
        const triggerPointsStep = await this.executeTriggerPointsStep(attraction_id, { debug_quality, stored_boundary_reference })
        steps.push(triggerPointsStep)

        if (!triggerPointsStep.success) {
           console.error(`❌ Trigger points generation failed for ${attraction_id}: ${triggerPointsStep.error}`)
           return {
             success: false,
             attraction_id,
             steps,
             total_time: Date.now() - startTime,
             error: `Trigger points generation failed: ${triggerPointsStep.error}`,
             warnings
           }
        }
        
        // Reprocessar TP não aprova POI: aprovação é decisão de curadoria, e a
        // confiança do motor não é critério para publicar (auditoria de TP, 2026-09-27).
        // `auto_approve_if_satisfactory` não vale neste modo.
        console.log(`✅ Trigger points reprocessed successfully for ${attraction_id}`)
        return {
          success: true,
          attraction_id,
          steps,
          total_time: Date.now() - startTime,
          warnings: warnings.length > 0 ? warnings : undefined
        }
      }

      // Pre-flight check: Should this POI be processed?
      const shouldProcess = await MigrationService.shouldProcessPOI(uuid_id)
      if (!shouldProcess.should_process) {
        console.log(`⏭️  Skipping POI ${uuid_id}: ${shouldProcess.reason}`)

        // If it's already in core, we consider this a successful "already done" state
        const isDuplicateInRange = shouldProcess.reason?.includes('already exists')

        return {
          success: true,
          skipped: true,
          steps,
          total_time: Date.now() - startTime,
          warnings: isDuplicateInRange ? [shouldProcess.reason!] : [shouldProcess.reason || 'POI should not be processed'],
          error: isDuplicateInRange ? undefined : (shouldProcess.reason || 'POI should not be processed')
        }
      }

      // Atomic claim: prevent multiple workers from processing the same POI
      const claim = await MigrationService.claimForProcessing(uuid_id)
      if (!claim.claimed) {
        console.log(`⏭️  Skipping POI ${uuid_id}: ${claim.reason}`)
        return {
          success: true,
          skipped: true,
          steps,
          total_time: Date.now() - startTime,
          warnings: [`Skipped: ${claim.reason}`]
        }
      }
      claimedHomologRow = true

      // Homolog → core ordering, owned here and nowhere else: copy to core, run the remaining
      // steps, and only then delete the homolog row (operator decision, 2026-10-06). Any failure
      // rolls core back and leaves the homolog row as `failed`, with the error, ready to retry.
      const succeed = async (attraction_id: string): Promise<PipelineResult> => {
        const deleteStep = await this.completeHomologMigration(uuid_id)
        steps.push(deleteStep)
        if (!deleteStep.success) {
          warnings.push(`Failed to delete from homolog: ${deleteStep.error}`)
        }
        return {
          success: true,
          attraction_id,
          steps,
          total_time: Date.now() - startTime,
          warnings: warnings.length > 0 ? warnings : undefined
        }
      }
      const fail = async (error: string, attraction_id?: string): Promise<PipelineResult> => {
        await this.failHomologMigration(uuid_id, attraction_id, error)
        return {
          success: false,
          attraction_id,
          steps,
          total_time: Date.now() - startTime,
          error,
          warnings: warnings.length > 0 ? warnings : undefined
        }
      }

      // Step 0: Enrichment (Homolog)
      console.log(`🌍 Step 0: Enriching Homolog POI ${uuid_id}...`)
      const enrichmentStep = await this.executeEnrichmentStep(uuid_id)
      steps.push(enrichmentStep)

      if (!enrichmentStep.success) {
        // Enrichment is best-effort: the migration still runs with the homolog data as it is.
        console.warn(`⚠️ Enrichment failed for ${uuid_id}: ${enrichmentStep.error}. Continuing with migration anyway...`)
      } else {
        console.log(`✅ Enrichment successful/completed for ${uuid_id}`)
      }

      // Step 1: Migration (homolog → core)
      console.log(`🔄 Step 1: Migrating POI ${uuid_id} from homolog to core...`)
      const migrationStep = await this.executeMigrationStep(uuid_id, { skip_if_exists, update_if_exists })
      steps.push(migrationStep)

      if (!migrationStep.success) {
        // migratePOI already undid its own partial core writes; nothing of ours to roll back.
        console.error(`❌ Migration failed for ${uuid_id}: ${migrationStep.error}`)
        return fail(migrationStep.error || 'Migration failed')
      }
      console.log(`✅ Migration successful for ${uuid_id}, attraction_id: ${migrationStep.data?.attraction_id}`)

      const attraction_id = migrationStep.data?.attraction_id
      if (!attraction_id) {
        return fail('Migration succeeded but no attraction_id returned')
      }

      // Self-healed duplicate: the POI already lived in core and migratePOI removed the homolog
      // row. Nothing of ours to run on, and nothing of ours to roll back.
      if (migrationStep.data?.self_healed) {
        return {
          success: true,
          attraction_id,
          steps,
          total_time: Date.now() - startTime,
          warnings: migrationStep.data.warnings
        }
      }
      rollbackTarget = attraction_id

      // If mode is migration_only, stop here
      if (mode === 'migration_only') {
        return succeed(attraction_id)
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
            return fail(`Description generation failed: ${descriptionStep.error}`, attraction_id)
          }
          console.log(`✅ Description generated successfully for ${attraction_id}`)
      } else {
          console.log(`⏭️  Skipping Description Step (Disabled by default)`)
      }

      // If mode is migration_description, stop here
      if (mode === 'migration_description') {
        return succeed(attraction_id)
      }

      // Step 3: Audio (Skipped if description was skipped or auto_generate_audio is false)
      if (shouldGenerateDescription && auto_generate_audio) {
          console.log(`⏳ Waiting 1s for pt-br audio to be persisted...`)
          await new Promise(resolve => setTimeout(resolve, 1000))

          // Check if audio was generated (pt-br)
          const audioStep = await this.checkAudioStep(attraction_id)
          steps.push(audioStep)

          // Step 3b: Generate audio for every language the operator selected (BR-IDIOMA-001)
          if (audioStep.success) {
            console.log(`⏳ Waiting 500ms before generating multi-language audios...`)
            await new Promise(resolve => setTimeout(resolve, 500))

            const multiLanguageAudioStep = await this.executeMultiLanguageAudioStep(attraction_id, languages, voice_gender)
            steps.push(multiLanguageAudioStep)
            if (!multiLanguageAudioStep.success) {
              warnings.push(`Multi-language audio generation failed: ${multiLanguageAudioStep.error}`)
            }
          }
      } else {
           console.log(`⏭️  Skipping Audio Steps (Disabled by default)`)
      }

      // If mode is migration_description_audio, stop here (migrated, not approved yet)
      if (mode === 'migration_description_audio') {
        return succeed(attraction_id)
      }

      // Step 4: Generate Trigger Points
      console.log(`📍 Step 4: Generating trigger points for ${attraction_id}...`)
      const triggerPointsStep = await this.executeTriggerPointsStep(attraction_id, { debug_quality, stored_boundary_reference })
      steps.push(triggerPointsStep)

      // If trigger points fail, rollback and stop (critical for approval)
      if (!triggerPointsStep.success) {
        console.error(`❌ Trigger points generation failed for ${attraction_id}: ${triggerPointsStep.error}`)
        return fail(`Trigger points generation failed: ${triggerPointsStep.error}`, attraction_id)
      }
      console.log(`✅ Trigger points generated successfully for ${attraction_id}`)

      // SIMPLIFIED FLOW (enrichment_migration_triggers): auto-approve right after trigger points
      if (mode === 'enrichment_migration_triggers') {
        console.log(`🚀 Simplified approval flow (enrichment_migration_triggers mode)...`)

        const simplifiedApprovalStep = await this.executeSimplifiedApprovalStep(attraction_id)
        steps.push(simplifiedApprovalStep)

        if (!simplifiedApprovalStep.success) {
          return fail(`Simplified approval failed: ${simplifiedApprovalStep.error}`, attraction_id)
        }
        return succeed(attraction_id)
      }

      // Step 5: Auto-approve if criteria met (FULL mode with description/audio)
      if (auto_approve_if_satisfactory) {
        const approvalStep = await this.executeApprovalStep(attraction_id, steps)
        steps.push(approvalStep)

        if (!approvalStep.success) {
          return fail(`Approval failed: ${approvalStep.error}`, attraction_id)
        }

        // Step 6: Remove duplicate POIs by coordinates (only if approved)
        if (approvalStep.data?.approved) {
          const cleanupStep = await this.executeRemoveDuplicatesStep(attraction_id)
          steps.push(cleanupStep)

          if (!cleanupStep.success) {
            warnings.push(`Failed to remove duplicate POIs: ${cleanupStep.error}`)
            // Don't fail the whole migration if cleanup fails
          }
        }
      }

      // Not auto-approved: the POI is in core awaiting manual approval, and the pipeline is done.
      return succeed(attraction_id)
    } catch (error) {
      console.error('❌ Pipeline exception for POI:', uuid_id)
      console.error('   Error:', error)
      if (error instanceof Error) {
        console.error('   Stack:', error.stack)
      }
      console.error('   Steps completed before error:', steps.length)
      const message = error instanceof Error ? error.message : 'Unknown error during pipeline execution'
      if (claimedHomologRow) {
        await this.failHomologMigration(uuid_id, rollbackTarget, message)
      }
      return {
        success: false,
        attraction_id: rollbackTarget,
        steps,
        total_time: Date.now() - startTime,
        error: message
      }
    }
  }

  /**
   * Failure of a claimed homolog POI: undo the core copy (cascades to coordinate, descriptions,
   * trigger points) and keep the homolog row as `failed` with the error. Never deletes homolog.
   */
  private static async failHomologMigration(
    uuid_id: string,
    attraction_id: string | undefined,
    error: string
  ): Promise<void> {
    let message = error
    if (attraction_id) {
      const rollback = await MigrationService.rollbackMigration(attraction_id)
      if (!rollback.success) {
        message = `${error} | core rollback failed: ${rollback.error}`
      }
    }
    await MigrationService.updateProcessingStatus(uuid_id, 'failed', message)
  }

  /**
   * Last step of a successful pipeline: the POI now lives in core, so the homolog row goes.
   * If the delete fails the row is marked `migrated`, so no worker picks it up again.
   */
  private static async completeHomologMigration(uuid_id: string): Promise<PipelineStepResult> {
    const stepStart = Date.now()
    console.log(`🗑️  Removing POI ${uuid_id} from homolog (pipeline finished)...`)
    const result = await MigrationService.safeDeleteFromHomolog(uuid_id)
    if (!result.success) {
      await MigrationService.updateProcessingStatus(uuid_id, 'migrated', result.error)
      return {
        step: 'delete_from_homolog',
        success: false,
        error: result.error,
        processing_time: Date.now() - stepStart
      }
    }
    return {
      step: 'delete_from_homolog',
      success: true,
      data: { deleted: true },
      processing_time: Date.now() - stepStart
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
        data: result.attraction_id
          ? { attraction_id: result.attraction_id, self_healed: result.self_healed, warnings: result.warnings }
          : undefined,
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

      // SSOT: Always use the central Edge Function
      console.log(`   📡 Calling central Edge Function 'generate-description' for ${attraction_id}...`)
      
      const { data: res, error: invokeError } = await supabase.functions.invoke('generate-description', {
        body: {
          poi_id: attraction_id,
          language: 'pt-br', // Default for migration pipeline
          force: true, // Pipeline always needs a fresh/official master
          generate_audio: options.auto_generate_audio
        }
      })
      
      if (invokeError) {
        console.error(`   ❌ Edge Function invocation error: ${invokeError.message}`)
        return {
          step: 'description',
          success: false,
          error: invokeError.message,
          processing_time: Date.now() - stepStart
        }
      }

      if (!res?.success) {
        console.error(`   ❌ Edge Function failed: ${res?.error}`)
        return {
          step: 'description',
          success: false,
          error: res?.error || 'Edge Function failed',
          processing_time: Date.now() - stepStart
        }
      }
      
      const generatedData = res.data
      console.log(`   ✅ Description and audio generated successfully`)

      return {
        step: 'description',
        success: true,
        data: {
          description: generatedData.description,
          verification: {
            aprovada: generatedData.verification_status === 'approved',
            pontuacao: generatedData.last_score_overall
          },
          description_id: generatedData.id,
          audio_url: generatedData.audio_url
        },
        processing_time: Date.now() - stepStart
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
   * Entrada do motor de TP a partir do POI do core. Uma só montagem para a gravação
   * (executeTriggerPointsStep) e para o dry-run (lib/services/tp-dry-run), para que o
   * dry-run meça exatamente o que seria gravado.
   */
  static buildEngineInput(poi: any, coordinate: { latitude: number; longitude: number }) {
    const osmId = poi.osm_id
    const osmType = poi.osm_type || poi.osm_element_type
    if (osmId) {
      console.log(`   🔗 Engine input with OSM ID: ${osmType}(${osmId})`)
    } else {
      console.log(`   ⚠️ Engine input WITHOUT OSM ID (fallback mode)`)
    }
    return {
      id: poi.id,
      name: poi.name,
      location: { lat: coordinate.latitude, lng: coordinate.longitude },
      // The category never decides class or reach: those come from what is measured on the POI
      // (operator, 2026-09-27; BR-AUDIO-010). It only keeps the relief footprint to a natural
      // landform (#779, `isNaturalLandform`).
      type: 'point_of_interest',
      category: poi.category ?? null,
      country: poi.country,
      city: poi.city,
      state: poi.state,
      osm_id: osmId,
      osm_type: osmType,
      // No `estimated_height_m`: it is registered data, not measured. Height comes from the OSM
      // tags or a building inside the footprint (INV-E3, operator 2026-09-27).
      tags: poi.osm_tags
    }
  }

  /**
   * Step 4: Generate Trigger Points
   */
  private static async executeTriggerPointsStep(
    attraction_id: string,
    opts: { debug_quality?: boolean; stored_boundary_reference?: boolean } = {}
  ): Promise<PipelineStepResult> {
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
      
      const poiData = PoiMigrationPipeline.buildEngineInput(poi, coordinate)

      // Use CoreTriggerPointPredictor (same motor as /trigger-points-single page)
      console.log(`   🎯 Calling CoreTriggerPointPredictor (new motor - same as /trigger-points-single)...`)
      const { CoreTriggerPointPredictor } = await import('./trigger-points-google/core/trigger-point-predictor')
      
      const predictor = new CoreTriggerPointPredictor()
      const predictionResult = await predictor.predictTriggerPointsComplete(poiData, {
        ...TP_ENGINE_OPTIONS,
        debugQuality: opts.debug_quality,
        storedBoundaryReference: opts.stored_boundary_reference
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
      
      // E11 post-conditions (INV-E11, BR-AUDIO-010): the same step the dry-run runs, so its
      // numbers predict this save. A TP far from or inside the POI never reaches the
      // database.
      const { applyTpPostConditions } = await import('./trigger-points-google/utils/tp-selection')
      const post = applyTpPostConditions(predictionResult.triggerPoints, poiData.location, predictionResult.boundary)
      if (post.dropped.length > 0) {
        const byReason = post.dropped.reduce<Record<string, number>>((acc, d) => ({ ...acc, [d.reason]: (acc[d.reason] ?? 0) + 1 }), {})
        console.warn(`   🚫 ${post.dropped.length} TP(s) dropped by post-conditions (reach cap ${post.reachCapM}m): ${JSON.stringify(byReason)}`)
      }
      if (post.kept.length === 0) {
        const errorMsg = `All ${triggerPointsCount} trigger points failed the post-conditions (reach cap ${post.reachCapM}m)`
        console.error(`   ❌ ${errorMsg}`)
        return {
          step: 'trigger_points',
          success: false,
          error: errorMsg,
          processing_time: Date.now() - stepStart
        }
      }

      // Convert TriggerPoint[] to TriggerPointSaveData[]
      const triggerPointsToSave = post.kept.map(tp => ({
        attraction_id,
        lat: tp.location.lat,
        lng: tp.location.lng,
        radius_meters: tp.radius || 50,
        expected_bearing: tp.expectedBearing,
        bearing_threshold: tp.bearingThreshold || 30,
        type: tp.type,
        priority: tp.priority || 1,
        is_active: true,
        // `access` fica de fora: o motor não sabe o modo, e o default do banco ('car') vale.
        confidence: tp.confidence || 0.5,
        // #782: the relief sources travel with the method, so a batch is reprocessable by data version
        generation_method: stampGenerationMethod(tp.generationMethod || 'local_osm'),
        boundary_source: predictionResult.boundary?.source || 'unknown',
        // TPs do tipo geofence carregam o polígono GeoJSON; requer a migração
        // 20260515_add_geofence_trigger_type.sql aplicada.
        geometry_geojson: tp.geometryGeoJson || null,
      }))
      
      // The border goes in BEFORE the TPs (#779, BR-POI-009): `core.tg_reject_tp_beyond_distance_cap`
      // measures each inserted TP to the border stored at that moment, and the post-conditions
      // measured to this one (`withinDatabaseCap`). Saved after, the database measured to the old
      // one — a 10 m synthetic circle on Morro do Telégrafo — and refused the whole replace.
      // #779: a curated border (CMS drawing, correction SQL) is never written over by the batch.
      if (predictionResult.boundary?.curated) {
        console.log(`   🔒 Curated boundary kept (${predictionResult.boundary.source}, confidence 1)`)
      } else if (predictionResult.boundary?.coordinates && predictionResult.boundary.coordinates.length >= 3) {
        console.log(`   💾 Saving boundary geometry from source: ${predictionResult.boundary.source}...`)
        
        try {
          // BR-POI-010: a municipal border is saved with every part (islands, exclaves), not only the pin's.
          const geoJsonString = JSON.stringify(boundaryGeoJson(predictionResult.boundary));
          
          const { error: boundaryError } = await supabase.schema('core').rpc('update_boundary_geometry', {
            p_attraction_id: attraction_id,
            p_geojson: geoJsonString,
            p_boundary_type: 'polygon',
            p_boundary_source: predictionResult.boundary.source,
            p_boundary_confidence: predictionResult.boundary.source.includes('osm') ? 0.9 : 0.5
          });
          
          if (boundaryError) {
             console.warn(`   ⚠️ Failed to save boundary geometry: ${boundaryError.message}`)
          } else {
             console.log(`   ✅ Boundary geometry saved successfully`)
          }
        } catch (e) {
          console.warn(`   ⚠️ Exception while saving boundary geometry:`, e)
        }
      }

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

      // BR-POI-010 (operator, 2026-10-06): a municipal border stays in the database only while its
      // TPs are inserted — the cap trigger measures them to it, and a large concelho has TPs past
      // 15 km from the pin. Left stored, the app plays the city audio to whoever is inside the
      // border. The next run re-detects it from the seat (`BoundaryDetector#municipalityBoundary`).
      // A failed clear is logged and traced; the TPs stay.
      let boundaryClear: { boundary_cleared?: boolean; boundary_clear_error?: string } = {}
      if (isAdminBorder(predictionResult.boundary)) {
        try {
          const { error } = await clearStoredBoundary(supabase, attraction_id)
          boundaryClear = error ? { boundary_cleared: false, boundary_clear_error: error } : { boundary_cleared: true }
        } catch (e) {
          boundaryClear = { boundary_cleared: false, boundary_clear_error: e instanceof Error ? e.message : String(e) }
        }
        if (boundaryClear.boundary_cleared) console.log(`   🧹 Municipal border cleared after the TPs (BR-POI-010)`)
        else console.warn(`   ⚠️ Failed to clear the municipal border (BR-POI-010): ${boundaryClear.boundary_clear_error}`)
      }

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
          boundary_source: predictionResult.boundary?.source || 'unknown',
          ...boundaryClear
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
        .update({ 
          approved: true,
          processing_status: 'completed'
        })
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
   * Auto-activates POI. The homolog row is deleted by the pipeline afterwards.
   */
  private static async executeSimplifiedApprovalStep(
    attraction_id: string
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
        const reason = triggerPointsCount === 0 
          ? 'No active trigger points were generated' 
          : `Max confidence ${maxConfidence.toFixed(2)} is below threshold (0.4)`
          
        console.warn(`❌ Simplified Approval failed for ${attraction_id}: ${reason}`)
        return {
          step: 'simplified_approval',
          success: false,
          error: reason,
          processing_time: Date.now() - stepStart
        }
      }


      // Step 1: Activate POI (set approved = true and status = completed)
      console.log(`   ✅ Activating POI ${attraction_id}...`)
      const { error: updateError } = await supabase
        .schema('core')
        .from('attractions')
        .update({ 
          approved: true,
          processing_status: 'completed'
        })
        .eq('id', attraction_id)

      if (updateError) {
        return {
          step: 'simplified_approval',
          success: false,
          error: `Failed to activate POI: ${updateError.message}`,
          processing_time: Date.now() - stepStart
        }
      }

      console.log(`   ✅ Simplified approval complete: POI activated`)

      return {
        step: 'simplified_approval',
        success: true,
        data: { 
          approved: true, 
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
   * Step 3b: Generate narration for the languages the caller selected.
   *
   * The list is the caller's (BR-IDIOMA-001 owns the catalogue the operator picks from); this
   * step neither restates it nor narrows it. It used to declare `['en-us', 'es-es']` locally,
   * shadowing the parameter — the selector offered 12 languages and the pipeline produced 2,
   * with no type or lint error to show for it (#157).
   *
   * @param languages Selected content languages; the source language is dropped, since its
   *                  narration comes from the audio step above.
   * @param voiceGender Voice gender selected by the operator.
   */
  private static async executeMultiLanguageAudioStep(
    attraction_id: string,
    languages: string[],
    voiceGender: 'male' | 'female'
  ): Promise<PipelineStepResult> {
    const stepStart = Date.now()

    // Deduplicate and drop the source language: asking for it here would re-spend TTS budget
    // on narration that already exists.
    const targetLanguages = Array.from(
      new Set((languages || []).map(lang => lang.trim().toLowerCase()).filter(Boolean))
    ).filter(lang => !SOURCE_LANGUAGE_TAGS.includes(lang))

    if (targetLanguages.length === 0) {
      console.log(`⏭️  No translation language selected — skipping multi-language audio`)
      return {
        step: 'multi_language_audio',
        success: true,
        data: { results: [], skipped: true, reason: 'No translation language selected' },
        processing_time: Date.now() - stepStart
      }
    }

    console.log(`🌍 Languages selected for ${attraction_id}: ${targetLanguages.join(', ')} (voice: ${voiceGender})`)

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
          .in('language', SOURCE_LANGUAGE_TAGS)
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

      const results: string[] = []
      const { supabaseUrl, supabaseKey: anonKey } = getSupabaseConfig()

      for (const [index, lang] of targetLanguages.entries()) {
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
              voiceGender
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
          if (index < targetLanguages.length - 1) {
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
}

