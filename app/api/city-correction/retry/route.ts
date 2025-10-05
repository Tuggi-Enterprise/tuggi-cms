import { getSupabase } from '../../../../lib/core/supabase-client'
import { NextResponse } from 'next/server'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = getSupabase('server')

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { progress_key } = body

    if (!progress_key) {
      return NextResponse.json(
        { success: false, error: 'progress_key is required' },
        { status: 400 }
      )
    }

    // Get current job status
    const { data: currentJob, error: jobError } = await supabase
      .schema('core')
      .from('city_correction_progress')
      .select('*')
      .eq('progress_key', progress_key)
      .single()

    if (jobError || !currentJob) {
      return NextResponse.json(
        { success: false, error: 'Job not found' },
        { status: 404 }
      )
    }

    // Check if job is stuck (no updates for more than 5 minutes)
    const now = new Date()
    const updatedAt = new Date(currentJob.updated_at)
    const timeDiff = now.getTime() - updatedAt.getTime()
    const minutesDiff = timeDiff / (1000 * 60)

    if (minutesDiff < 5) {
      return NextResponse.json({
        success: false,
        error: 'Job is still active, wait at least 5 minutes before retry'
      })
    }

    // Get total POIs that can be processed (with coordinates and not processed)
    const { count: totalAvailablePOIs } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, attraction_coordinate!inner(id)', { count: 'exact', head: true })
      .is('city_correction_audit', null)

    const progressData = currentJob.progress_data
    const processedSoFar = progressData?.processed || 0
    const remainingPOIs = (totalAvailablePOIs || 0) - processedSoFar

    if (remainingPOIs <= 0) {
      // Mark job as completed if no more POIs to process
      await supabase
        .schema('core')
        .from('city_correction_progress')
        .update({
          progress_data: {
            ...progressData,
            status: 'completed',
            completed_at: new Date().toISOString(),
            message: 'All available POIs have been processed'
          }
        })
        .eq('progress_key', progress_key)

      return NextResponse.json({
        success: true,
        message: 'Job completed - no more POIs to process',
        processed: processedSoFar,
        total_available: totalAvailablePOIs
      })
    }

    // Update job status to retry
    await supabase
      .schema('core')
      .from('city_correction_progress')
      .update({
        progress_data: {
          ...progressData,
          status: 'retrying',
          retry_count: (progressData?.retry_count || 0) + 1,
          retry_at: new Date().toISOString(),
          total_pois: totalAvailablePOIs, // Update with current total
          remaining_pois: remainingPOIs
        }
      })
      .eq('progress_key', progress_key)

    // Calculate batch size based on remaining POIs
    const batchSize = Math.min(remainingPOIs, 5) // Process up to 5 POIs per retry

    // Trigger Edge Function with retry parameters
    const { data: edgeResult, error: edgeError } = await supabase.functions.invoke('city-correction', {
      body: {
        action: 'process_batch',
        progress_key,
        options: {
          batch_size: batchSize,
          limit: batchSize,
          dry_run: false,
          confidence_threshold: 85,
          enable_cross_validation: true
        }
      }
    })

    if (edgeError) {
      // Mark retry as failed
      await supabase
        .schema('core')
        .from('city_correction_progress')
        .update({
          progress_data: {
            ...progressData,
            status: 'retry_failed',
            error: edgeError.message,
            failed_at: new Date().toISOString()
          }
        })
        .eq('progress_key', progress_key)

      return NextResponse.json({
        success: false,
        error: 'Edge Function retry failed',
        details: edgeError.message
      })
    }

    return NextResponse.json({
      success: true,
      message: 'Retry initiated successfully',
      progress_key,
      processed_so_far: processedSoFar,
      remaining_pois: remainingPOIs,
      batch_size: batchSize,
      retry_count: (progressData?.retry_count || 0) + 1
    })

  } catch (error) {
    console.error('Error in retry API:', error)
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}
