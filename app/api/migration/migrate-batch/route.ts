import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { getSupabase } from '@/lib/core/supabase-client'
import { PoiMigrationPipeline, PipelineOptions } from '@/lib/services/poi-migration-pipeline'
import { MigrationService } from '@/lib/services/migration-service'

const supabase = getSupabase('service')

interface BatchMigrationRequest {
  filters?: {
    country?: string
    state?: string
    city?: string
    processing_status?: string
    approved?: boolean
    category?: string
  }
  options?: {
    batch_size?: number
    mode?: 'migration_only' | 'migration_description' | 'migration_description_audio' | 'full'
    auto_generate_audio?: boolean
    auto_approve_if_satisfactory?: boolean
    skip_if_exists?: boolean
    update_if_exists?: boolean
  }
  poi_uuid_ids?: string[] // Optional: specific POI UUIDs to migrate
}

interface BatchMigrationResult {
  success: boolean
  job_id?: string
  total_pois?: number
  queued_pois?: string[]
  error?: string
}

/**
 * API Endpoint: Migrate POIs in batch from homolog to core
 * POST /api/migration/migrate-batch
 */
export async function POST(request: NextRequest) {
  try {
    // Authentication check
    const supabaseAuth = createRouteHandlerClient({ cookies })
    const { data: { session }, error: authError } = await supabaseAuth.auth.getSession()

    if (authError || !session) {
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      )
    }

    const body: BatchMigrationRequest = await request.json()
    const {
      filters = {},
      options = {},
      poi_uuid_ids
    } = body

    const {
      batch_size = 25,
      mode = 'full',
      auto_generate_audio = true,
      auto_approve_if_satisfactory = false,
      skip_if_exists = true,
      update_if_exists = false
    } = options

    console.log(`🚀 Starting batch migration:`, { filters, batch_size, mode })

    // Build query to get POIs from homolog
    let query = supabase
      .schema('homolog')
      .from('pois')
      .select('uuid_id, name, city, state, country, processing_status, approved')

    // Apply filters
    if (poi_uuid_ids && poi_uuid_ids.length > 0) {
      query = query.in('uuid_id', poi_uuid_ids)
    } else {
      if (filters.country && filters.country !== 'all') {
        query = query.eq('country', filters.country)
      }
      if (filters.state && filters.state !== 'all') {
        query = query.eq('state', filters.state)
      }
      if (filters.city && filters.city !== 'all') {
        query = query.eq('city', filters.city)
      }
      if (filters.processing_status && filters.processing_status !== 'all') {
        query = query.eq('processing_status', filters.processing_status)
      }
      if (filters.approved !== undefined) {
        query = query.eq('approved', filters.approved)
      }
      if (filters.category && filters.category !== 'all') {
        query = query.eq('category', filters.category)
      }

      // Query for POIs that should be processed:
      // - processing_status = 'pending' OR
      // - processing_status = 'processing' AND last_migration_attempt_at < NOW() - 10 minutes (timeout)
      // - NOT already in core.attractions
      // We'll filter in-memory after fetching to check core.attractions
      query = query.or('processing_status.eq.pending,processing_status.eq.processing')
      query = query.limit(batch_size * 2) // Fetch more to account for filtering
    }

    const { data: pois, error: poisError } = await query

    if (poisError) {
      return NextResponse.json(
        {
          success: false,
          error: `Failed to fetch POIs: ${poisError.message}`
        },
        { status: 500 }
      )
    }

    if (!pois || pois.length === 0) {
      return NextResponse.json({
        success: true,
        total_pois: 0,
        processed: 0,
        successful: 0,
        failed: 0,
        results: [],
        message: 'No POIs found matching filters'
      })
    }

    // Filter POIs that should be processed (using shouldProcessPOI logic)
    const poisToProcess: typeof pois = []
    for (const poi of pois) {
      const shouldProcess = await MigrationService.shouldProcessPOI(poi.uuid_id)
      if (shouldProcess.should_process) {
        poisToProcess.push(poi)
        if (poisToProcess.length >= batch_size) {
          break // Limit to batch_size
        }
      }
    }

    if (poisToProcess.length === 0) {
      return NextResponse.json({
        success: true,
        total_pois: pois.length,
        processed: 0,
        successful: 0,
        failed: 0,
        results: [],
        message: 'No POIs need processing (all already migrated or failed permanently)'
      })
    }

    console.log(`📊 Found ${poisToProcess.length} POIs to migrate (filtered from ${pois.length} total)`)

    const pipelineOptions: PipelineOptions = {
      auto_generate_audio,
      auto_approve_if_satisfactory,
      skip_if_exists,
      update_if_exists,
      mode
    }

    // Process POIs SEQUENTIALLY (1 at a time) - CRITICAL for timeout prevention
    const results = []
    for (const poi of poisToProcess) {
      try {
        console.log(`🔄 Processing POI ${poi.uuid_id} (${poi.name})...`)
        const result = await PoiMigrationPipeline.executePipeline(poi.uuid_id, pipelineOptions)
        results.push({
          poi_uuid_id: poi.uuid_id,
          poi_name: poi.name,
          success: result.success,
          attraction_id: result.attraction_id,
          error: result.error,
          steps: result.steps,
          warnings: result.warnings
        })
        console.log(`✅ Completed POI ${poi.uuid_id}: ${result.success ? 'SUCCESS' : 'FAILED'}`)
      } catch (error) {
        console.error(`❌ Error processing POI ${poi.uuid_id}:`, error)
        results.push({
          poi_uuid_id: poi.uuid_id,
          poi_name: poi.name,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
      // Small delay between POIs to avoid overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    return NextResponse.json({
      success: true,
      total_pois: poisToProcess.length,
      processed: results.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results
    })
  } catch (error) {
    console.error('Batch migration API error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}


