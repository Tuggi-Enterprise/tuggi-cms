import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { getSupabase } from '@/lib/core/supabase-client'
import { PoiMigrationPipeline, PipelineOptions } from '@/lib/services/poi-migration-pipeline'

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

      // Limit to pending or not migrated
      query = query.in('processing_status', ['pending', 'processing'])
      query = query.limit(batch_size)
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
        queued_pois: [],
        message: 'No POIs found matching filters'
      })
    }

    console.log(`📊 Found ${pois.length} POIs to migrate`)

    // Generate job ID
    const job_id = `migration_${Date.now()}_${Math.random().toString(36).substring(7)}`

    // Return immediately with job_id (async processing)
    // In a real implementation, you'd use a job queue system
    // For now, we'll process synchronously but return job_id for tracking

    const pipelineOptions: PipelineOptions = {
      auto_generate_audio,
      auto_approve_if_satisfactory,
      skip_if_exists,
      update_if_exists,
      mode
    }

    // Process POIs (in production, this should be done in background)
    const results = []
    for (const poi of pois) {
      try {
        const result = await PoiMigrationPipeline.executePipeline(poi.uuid_id, pipelineOptions)
        results.push({
          poi_uuid_id: poi.uuid_id,
          poi_name: poi.name,
          success: result.success,
          attraction_id: result.attraction_id,
          error: result.error,
          steps: result.steps
        })
      } catch (error) {
        results.push({
          poi_uuid_id: poi.uuid_id,
          poi_name: poi.name,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }

    return NextResponse.json({
      success: true,
      job_id,
      total_pois: pois.length,
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


