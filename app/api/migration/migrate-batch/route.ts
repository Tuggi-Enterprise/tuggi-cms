import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseRouteHandler } from '@/lib/core/supabase-client'
import { cookies } from 'next/headers'
import { getSupabase } from '@/lib/core/supabase-client'
import { PoiMigrationPipeline, PipelineOptions } from '@/lib/services/poi-migration-pipeline'
import { MigrationService } from '@/lib/services/migration-service'

export const maxDuration = 60 // Vercel Hobby plan limit (max 60s)

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
export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
  try {
    // Authentication check
    const cookieStore = await cookies()
    const supabaseAuth = getSupabaseRouteHandler(cookieStore)
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
      // Special filter: __missing__ selects POIs without complete location data
      // These POIs have coordinates but missing city/state/country - enrichment will fix this
      if (filters.country === '__missing__') {
        // POIs where country OR state OR city is null/empty (will be enriched via coordinates)
        query = query.or('country.is.null,country.eq.,state.is.null,state.eq.,city.is.null,city.eq.')
      } else if (filters.country && filters.country !== 'all') {
        query = query.eq('country', filters.country)
      }
      if (filters.state && filters.state !== 'all' && filters.country !== '__missing__') {
        query = query.eq('state', filters.state)
      }
      if (filters.city && filters.city !== 'all' && filters.country !== '__missing__') {
        query = query.eq('city', filters.city)
      }
      if (filters.processing_status && filters.processing_status !== 'all') {
        query = query.eq('processing_status', filters.processing_status)
      }
      // If 'all' or no filter specified, don't filter by status
      // The shouldProcessPOI() function will handle the intelligent filtering
      if (filters.approved !== undefined) {
        query = query.eq('approved', filters.approved)
      }
      if (filters.category && filters.category !== 'all') {
        query = query.eq('category', filters.category)
      }

      // Fetch more POIs to account for filtering by shouldProcessPOI()
      // This ensures we get enough POIs after the intelligent filtering
      query = query.limit(batch_size * 2)
    }

    const { data: pois, error: poisError } = await query

    if (poisError) {
      console.error('❌ Error fetching POIs:', poisError)
      return NextResponse.json(
        {
          success: false,
          error: `Failed to fetch POIs: ${poisError.message}`
        },
        { status: 500 }
      )
    }

    console.log(`📋 Found ${pois?.length || 0} POIs from query`)

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
    const skippedReasons: Record<string, number> = {}
    
    for (const poi of pois) {
      const shouldProcess = await MigrationService.shouldProcessPOI(poi.uuid_id)
      if (shouldProcess.should_process) {
        poisToProcess.push(poi)
        if (poisToProcess.length >= batch_size) {
          break // Limit to batch_size
        }
      } else {
        // Track why POIs were skipped
        const reason = shouldProcess.reason || 'Unknown reason'
        skippedReasons[reason] = (skippedReasons[reason] || 0) + 1
      }
    }

    console.log(`✅ ${poisToProcess.length} POIs to process, ${pois.length - poisToProcess.length} skipped`)
    if (Object.keys(skippedReasons).length > 0) {
      console.log('📊 Skip reasons:', skippedReasons)
    }

    if (poisToProcess.length === 0) {
      return NextResponse.json({
        success: true,
        total_pois: pois.length,
        processed: 0,
        successful: 0,
        failed: 0,
        results: [],
        message: `No POIs need processing. Found ${pois.length} POIs but all were skipped. Reasons: ${JSON.stringify(skippedReasons)}`,
        skipped_reasons: skippedReasons
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
        
        // Log detailed step results
        if (result.steps && result.steps.length > 0) {
          console.log(`📋 Pipeline steps for ${poi.name}:`)
          result.steps.forEach((step, idx) => {
            const status = step.success ? '✅' : '❌'
            const time = `${step.processing_time}ms`
            console.log(`  ${idx + 1}. ${status} ${step.step} (${time})`)
            if (!step.success && step.error) {
              console.log(`     Error: ${step.error}`)
            }
          })
        }
        
        if (!result.success) {
          console.error(`❌ POI ${poi.name} failed: ${result.error}`)
          if (result.warnings && result.warnings.length > 0) {
            console.warn(`⚠️  Warnings:`, result.warnings)
          }
        }
        
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
        console.error(`❌ Exception processing POI ${poi.uuid_id} (${poi.name}):`, error)
        if (error instanceof Error) {
          console.error(`   Stack:`, error.stack)
        }
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


