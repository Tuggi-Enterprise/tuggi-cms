import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseRouteHandler } from '@/lib/core/supabase-client'
import { cookies } from 'next/headers'
import { PoiMigrationPipeline, PipelineOptions } from '@/lib/services/poi-migration-pipeline'

export const maxDuration = 60 // Vercel Hobby plan limit (max 60s)

/**
 * API Endpoint: Migrate single POI from homolog to core
 * POST /api/migration/migrate-poi
 */
export async function POST(request: NextRequest) {
  try {
// Authentication check
    const cookieStore = await cookies()
    const supabase = getSupabaseRouteHandler(cookieStore)
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

    console.log(`🚀 Starting migration for POI: ${poi_uuid_id}`)

    // Execute pipeline
    const result = await PoiMigrationPipeline.executePipeline(poi_uuid_id, {
      auto_generate_audio: options.auto_generate_audio ?? true,
      auto_approve_if_satisfactory: options.auto_approve_if_satisfactory ?? false,
      skip_if_exists: options.skip_if_exists ?? true,
      update_if_exists: options.update_if_exists ?? false,
      mode: options.mode || 'full'
    })

    if (!result.success) {
      // Return 200 for business logic failures to avoid noisy console errors
      // The client will still see success: false and handle the failure
      return NextResponse.json(
        {
          success: false,
          error: result.error,
          steps: result.steps,
          warnings: result.warnings
        },
        { status: 200 }
      )
    }

    return NextResponse.json({
      success: true,
      attraction_id: result.attraction_id,
      steps: result.steps,
      total_time: result.total_time,
      warnings: result.warnings,
      skipped: result.skipped
    })
  } catch (error) {
    console.error('Migration API error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}


