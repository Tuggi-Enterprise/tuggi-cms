import { getSupabase } from '../../../../lib/core/supabase-client'
import { NextResponse } from 'next/server'

const supabase = getSupabase('service')

export async function POST() {
  try {
    console.log('🔄 Auto-retry system checking for jobs...')

    // Find jobs that need retry
    const { data: jobsNeedingRetry, error: findError } = await supabase
      .schema('core')
      .from('city_correction_progress')
      .select('*')
      .eq('progress_data->status', 'needs_retry')
      .order('updated_at', { ascending: true }) // Oldest first
      .limit(1) // Process one at a time

    if (findError) {
      console.error('❌ Error finding jobs needing retry:', findError)
      return NextResponse.json({
        success: false,
        error: 'Failed to find jobs needing retry'
      })
    }

    if (!jobsNeedingRetry || jobsNeedingRetry.length === 0) {
      console.log('✅ No jobs need retry at this time')
      return NextResponse.json({
        success: true,
        message: 'No jobs need retry',
        jobs_processed: 0
      })
    }

    const job = jobsNeedingRetry[0]
    const progressData = job.progress_data
    
    console.log(`🎯 Found job needing retry: ${job.progress_key}`)
    console.log(`📊 Progress: ${progressData.total_processed_so_far}/${progressData.target_goal}`)
    console.log(`📦 Remaining: ${progressData.remaining_pois} POIs`)

    // Check if job was updated recently (avoid immediate retry)
    const now = new Date()
    const updatedAt = new Date(job.updated_at)
    const timeDiff = now.getTime() - updatedAt.getTime()
    const minutesDiff = timeDiff / (1000 * 60)

    if (minutesDiff < 2) {
      console.log(`⏰ Job too recent (${minutesDiff.toFixed(1)} min), waiting...`)
      return NextResponse.json({
        success: true,
        message: 'Job too recent, waiting before retry',
        wait_time: 2 - minutesDiff
      })
    }

    // Calculate batch size for retry
    const remainingPOIs = progressData.remaining_pois || 0
    const batchSize = Math.min(remainingPOIs, 5) // Process up to 5 POIs per retry

    if (remainingPOIs <= 0) {
      // No POIs left, mark as completed
      await supabase
        .schema('core')
        .from('city_correction_progress')
        .update({
          progress_data: {
            ...progressData,
            status: 'completed',
            completed_at: new Date().toISOString(),
            message: 'Goal completed - all POIs processed'
          }
        })
        .eq('progress_key', job.progress_key)

      console.log(`🎉 Job ${job.progress_key} marked as completed - no POIs remaining`)
      return NextResponse.json({
        success: true,
        message: 'Job completed - no POIs remaining',
        job_key: job.progress_key
      })
    }

    // Update job status to retrying
    const retryCount = (progressData.retry_count || 0) + 1
    await supabase
      .schema('core')
      .from('city_correction_progress')
      .update({
        progress_data: {
          ...progressData,
          status: 'retrying',
          retry_count: retryCount,
          retry_at: new Date().toISOString(),
          message: `Auto-retry #${retryCount} initiated`
        }
      })
      .eq('progress_key', job.progress_key)

    console.log(`🔄 Initiating auto-retry #${retryCount} for ${job.progress_key}`)
    console.log(`📦 Batch size: ${batchSize} POIs`)

    // Trigger Edge Function
    const { data: edgeResult, error: edgeError } = await supabase.functions.invoke('city-correction', {
      body: {
        action: 'process_batch',
        progress_key: job.progress_key,
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
      console.error(`❌ Edge Function retry failed:`, edgeError)
      
      // Mark retry as failed
      await supabase
        .schema('core')
        .from('city_correction_progress')
        .update({
          progress_data: {
            ...progressData,
            status: 'retry_failed',
            retry_count: retryCount,
            error: edgeError.message,
            failed_at: new Date().toISOString()
          }
        })
        .eq('progress_key', job.progress_key)

      return NextResponse.json({
        success: false,
        error: 'Edge Function retry failed',
        job_key: job.progress_key,
        retry_count: retryCount
      })
    }

    console.log(`✅ Auto-retry initiated successfully for ${job.progress_key}`)

    return NextResponse.json({
      success: true,
      message: 'Auto-retry initiated successfully',
      job_key: job.progress_key,
      retry_count: retryCount,
      batch_size: batchSize,
      remaining_pois: remainingPOIs
    })

  } catch (error) {
    console.error('💥 Error in auto-retry system:', error)
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}
