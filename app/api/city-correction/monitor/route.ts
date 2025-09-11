import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

export async function POST() {
  try {
    console.log('🔍 City Correction Monitor - Starting system check...')

    // 1. Check for orphaned/stuck jobs (processing for too long)
    const now = new Date()
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000)

    const { data: stuckJobs, error: stuckError } = await supabase
      .schema('core')
      .from('city_correction_progress')
      .select('*')
      .eq('progress_data->status', 'processing')
      .lt('updated_at', fiveMinutesAgo.toISOString())

    if (stuckError) {
      console.error('❌ Error finding stuck jobs:', stuckError)
    } else if (stuckJobs && stuckJobs.length > 0) {
      console.log(`🚨 Found ${stuckJobs.length} stuck job(s)`)
      
      for (const job of stuckJobs) {
        const progressData = job.progress_data
        
        // Mark stuck job as needs_retry
        await supabase
          .schema('core')
          .from('city_correction_progress')
          .update({
            progress_data: {
              ...progressData,
              status: 'needs_retry',
              error: 'Job stuck - no updates for more than 5 minutes',
              stuck_at: new Date().toISOString()
            }
          })
          .eq('progress_key', job.progress_key)
        
        console.log(`🔄 Marked stuck job as needs_retry: ${job.progress_key}`)
      }
    }

    // 2. Check for jobs that need retry
    const { data: retryJobs, error: retryError } = await supabase
      .schema('core')
      .from('city_correction_progress')
      .select('*')
      .eq('progress_data->status', 'needs_retry')
      .order('updated_at', { ascending: true })

    if (retryError) {
      console.error('❌ Error finding retry jobs:', retryError)
    } else if (retryJobs && retryJobs.length > 0) {
      console.log(`🔄 Found ${retryJobs.length} job(s) needing retry`)
      
      // Process the oldest retry job
      const job = retryJobs[0]
      const progressData = job.progress_data
      
      // Check if enough time has passed since last update (avoid immediate retry)
      const updatedAt = new Date(job.updated_at)
      const timeDiff = now.getTime() - updatedAt.getTime()
      const minutesDiff = timeDiff / (1000 * 60)
      
      if (minutesDiff >= 1) { // Wait at least 1 minute between retries
        console.log(`🎯 Processing retry for job: ${job.progress_key}`)
        
        // Get current remaining POIs
        const { count: currentRemaining } = await supabase
          .schema('core')
          .from('attractions')
          .select('id, attraction_coordinate!inner(id)', { count: 'exact', head: true })
          .is('city_correction_audit', null)

        if (currentRemaining === 0) {
          // Goal completed!
          await supabase
            .schema('core')
            .from('city_correction_progress')
            .update({
              progress_data: {
                ...progressData,
                status: 'completed',
                remaining_pois: 0,
                total_processed_so_far: progressData.target_goal,
                completed_at: new Date().toISOString(),
                message: '🎉 Goal completed! All POIs processed.'
              }
            })
            .eq('progress_key', job.progress_key)
          
          console.log(`🎉 GOAL COMPLETED! Job ${job.progress_key} finished successfully.`)
        } else {
          // Still have POIs to process, trigger retry
          const batchSize = Math.min(currentRemaining || 0, 5)
          const retryCount = (progressData.retry_count || 0) + 1
          
          // Update status to retrying
          await supabase
            .schema('core')
            .from('city_correction_progress')
            .update({
              progress_data: {
                ...progressData,
                status: 'retrying',
                retry_count: retryCount,
                remaining_pois: currentRemaining,
                retry_at: new Date().toISOString(),
                message: `Auto-retry #${retryCount} - ${currentRemaining} POIs remaining`
              }
            })
            .eq('progress_key', job.progress_key)
          
          console.log(`🔄 Triggering auto-retry #${retryCount} for ${job.progress_key}`)
          console.log(`📦 Batch size: ${batchSize}, Remaining: ${currentRemaining}`)
          
          // Trigger Edge Function
          const { error: edgeError } = await supabase.functions.invoke('city-correction', {
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
            console.error(`❌ Auto-retry failed for ${job.progress_key}:`, edgeError)
            
            // Mark as retry failed, but don't give up - will try again next time
            await supabase
              .schema('core')
              .from('city_correction_progress')
              .update({
                progress_data: {
                  ...progressData,
                  status: 'needs_retry',
                  retry_count: retryCount,
                  error: `Retry #${retryCount} failed: ${edgeError.message}`,
                  failed_at: new Date().toISOString()
                }
              })
              .eq('progress_key', job.progress_key)
          } else {
            console.log(`✅ Auto-retry #${retryCount} triggered successfully`)
          }
        }
      } else {
        console.log(`⏰ Waiting ${1 - minutesDiff} more minutes before retry`)
      }
    }

    // 3. Check if there are POIs that need processing but no active jobs
    const { count: unprocessedPOIs } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, attraction_coordinate!inner(id)', { count: 'exact', head: true })
      .is('city_correction_audit', null)

    const { data: activeJobs } = await supabase
      .schema('core')
      .from('city_correction_progress')
      .select('progress_key')
      .in('progress_data->status', ['processing', 'retrying', 'needs_retry'])

    if ((unprocessedPOIs || 0) > 0 && (!activeJobs || activeJobs.length === 0)) {
      console.log(`🚨 Found ${unprocessedPOIs} unprocessed POIs with no active jobs!`)
      console.log(`💡 Consider starting a new job to process remaining POIs.`)
    }

    // 4. Generate summary report
    const { data: allJobs } = await supabase
      .schema('core')
      .from('city_correction_progress')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10)

    const summary = {
      timestamp: new Date().toISOString(),
      unprocessed_pois: unprocessedPOIs,
      active_jobs: activeJobs?.length || 0,
      stuck_jobs_fixed: stuckJobs?.length || 0,
      retry_jobs_found: retryJobs?.length || 0,
      recent_jobs: allJobs?.map(job => ({
        key: job.progress_key,
        status: job.progress_data.status,
        progress: job.progress_data.total_processed_so_far || job.progress_data.processed || 0,
        target: job.progress_data.target_goal || 0,
        percentage: job.progress_data.target_goal > 0 
          ? Math.round(((job.progress_data.total_processed_so_far || job.progress_data.processed || 0) / job.progress_data.target_goal) * 100)
          : 0
      })) || []
    }

    console.log('📊 Monitor Summary:', JSON.stringify(summary, null, 2))

    return NextResponse.json({
      success: true,
      message: 'System monitoring completed',
      summary
    })

  } catch (error) {
    console.error('💥 Error in monitoring system:', error)
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}

// GET endpoint for manual monitoring check
export async function GET() {
  return POST()
}
