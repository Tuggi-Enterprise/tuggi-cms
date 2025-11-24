import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { PoiMigrationPipeline, PipelineOptions } from '@/lib/services/poi-migration-pipeline'
import { MigrationService } from '@/lib/services/migration-service'

/**
 * API Endpoint: Safe migration of single POI from homolog to core
 * POST /api/migration/migrate-poi-safe
 * 
 * Features:
 * - Verifies if POI should be processed (not already migrated, not failed permanently)
 * - Processes 1 POI at a time (sequential)
 * - Automatic rollback on any error
 * - Removes from homolog only after successful approval
 * - Generates multi-language audios (pt-br, en-us, es-es)
 */
export async function POST(request: NextRequest) {
  try {
    // Authentication check
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { session }, error: authError } = await supabase.auth.getSession()

    if (authError || !session) {
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const {
      poi_uuid_id,
      options = {}
    }: {
      poi_uuid_id: string
      options?: PipelineOptions
    } = body

    if (!poi_uuid_id) {
      return NextResponse.json(
        { error: 'Missing required parameter: poi_uuid_id' },
        { status: 400 }
      )
    }

    console.log(`🚀 [SAFE] Starting safe migration for POI: ${poi_uuid_id}`)

    // Pre-flight check: Should this POI be processed?
    const shouldProcess = await MigrationService.shouldProcessPOI(poi_uuid_id)
    if (!shouldProcess.should_process) {
      return NextResponse.json(
        {
          success: false,
          error: shouldProcess.reason || 'POI should not be processed',
          skipped: true
        },
        { status: 200 } // 200 because it's a valid response (skip, not error)
      )
    }

    // Execute pipeline with safe options
    const result = await PoiMigrationPipeline.executePipeline(poi_uuid_id, {
      auto_generate_audio: options.auto_generate_audio ?? true,
      auto_approve_if_satisfactory: options.auto_approve_if_satisfactory ?? false,
      skip_if_exists: options.skip_if_exists ?? true,
      update_if_exists: options.update_if_exists ?? false,
      mode: options.mode || 'full'
    })

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error,
          steps: result.steps,
          warnings: result.warnings
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      attraction_id: result.attraction_id,
      steps: result.steps,
      total_time: result.total_time,
      warnings: result.warnings
    })
  } catch (error) {
    console.error('❌ [SAFE] Migration API error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

