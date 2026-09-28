import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { PoiMigrationPipeline, PipelineOptions } from '@/lib/services/poi-migration-pipeline'

export const maxDuration = 60 // Vercel Hobby plan limit (max 60s)

/**
 * API Endpoint: Migrate single POI from homolog to core
 * POST /api/migration/migrate-poi
 *
 * Gate: `withAuth({ roles: ['admin'] })` (#780). It used to accept any session via
 * `getSession()`, which reads the cookie without revalidating the JWT, and then wrote to
 * production as service role. Same gate as `migrate-batch`.
 */
export const POST = withAuth({ roles: ['admin'] }, async (request) => {
  try {
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
      mode: options.mode || 'full',
      // Forwarded, not rebuilt: this handler used to list the options one by one and silently
      // drop these two, so the operator's language and voice choices died here (#157).
      languages: options.languages ?? ['pt-br'],
      voice_gender: options.voice_gender ?? 'male'
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
})
