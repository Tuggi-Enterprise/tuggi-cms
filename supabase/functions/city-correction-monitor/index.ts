import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    console.log('🔍 City Correction Monitor - Starting system check...')

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 1. Check for orphaned/stuck jobs (processing for too long)
    const now = new Date()
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000)

    const { data: stuckJobs, error: stuckError } = await supabase
      .schema('core')
      .from('city_correction_progress')
      .select('*')
      .ilike('progress_data', '%processing%')
      .lt('updated_at', fiveMinutesAgo.toISOString())

    if (stuckError) {
      console.error('❌ Error finding stuck jobs:', stuckError)
    } else if (stuckJobs && stuckJobs.length > 0) {
      console.log(`🚨 Found ${stuckJobs.length} stuck job(s)`)
      
      for (const job of stuckJobs) {
        const progressData = typeof job.progress_data === 'string' 
          ? JSON.parse(job.progress_data) 
          : job.progress_data
        console.log(`🔧 Marking stuck job ${job.progress_key} as failed`)
        
        // Mark as failed
        await supabase
          .schema('core')
          .from('city_correction_progress')
          .update({
            progress_data: JSON.stringify({
              ...progressData,
              status: 'failed',
              message: 'Job stuck - marked as failed by monitor',
              completed_at: new Date().toISOString()
            })
          })
          .eq('progress_key', job.progress_key)
      }
    }

    // 2. Check for jobs that need retry
    const { data: retryJobs, error: retryError } = await supabase
      .schema('core')
      .from('city_correction_progress')
      .select('*')
      .ilike('progress_data', '%needs_retry%')

    if (retryError) {
      console.error('❌ Error finding retry jobs:', retryError)
    } else if (retryJobs && retryJobs.length > 0) {
      console.log(`🔄 Found ${retryJobs.length} job(s) needing retry`)
      
      for (const job of retryJobs) {
        const progressData = typeof job.progress_data === 'string' 
          ? JSON.parse(job.progress_data) 
          : job.progress_data
        const currentRemaining = progressData.remaining_pois || 0
        
        if (currentRemaining > 0) {
          // Still have POIs to process, trigger retry
          const batchSize = Math.min(currentRemaining, 5)
          const retryCount = (progressData.retry_count || 0) + 1
          
          // Update status to retrying
          await supabase
            .schema('core')
            .from('city_correction_progress')
            .update({
              progress_data: JSON.stringify({
                ...progressData,
                status: 'retrying',
                retry_count: retryCount,
                message: `Auto-retry #${retryCount} - processing ${batchSize} POIs`
              })
            })
            .eq('progress_key', job.progress_key)

          // Trigger the Edge Function
          try {
            const edgeFunctionUrl = `${supabaseUrl}/functions/v1/city-correction`
            const response = await fetch(edgeFunctionUrl, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                action: 'process_batch',
                progress_key: job.progress_key,
                batch_size: batchSize,
                limit: batchSize
              })
            })

            if (response.ok) {
              console.log(`✅ Successfully triggered retry for job ${job.progress_key}`)
            } else {
              console.error(`❌ Failed to trigger retry for job ${job.progress_key}:`, response.statusText)
            }
          } catch (error) {
            console.error(`❌ Error triggering retry for job ${job.progress_key}:`, error)
          }
        } else {
          // No more POIs to process, mark as completed
          await supabase
            .schema('core')
            .from('city_correction_progress')
            .update({
              progress_data: JSON.stringify({
                ...progressData,
                status: 'completed',
                message: 'All POIs processed successfully!',
                completed_at: new Date().toISOString()
              })
            })
            .eq('progress_key', job.progress_key)
          
          console.log(`🎉 GOAL COMPLETED! Job ${job.progress_key} finished successfully.`)
        }
      }
    }

    // 3. Get system statistics
    const { data: totalPOIs } = await supabase
      .schema('core')
      .from('attractions')
      .select('id', { count: 'exact', head: true })

    const { data: processedPOIs } = await supabase
      .schema('core')
      .from('attractions')
      .select('id', { count: 'exact', head: true })
      .not('city_correction_audit', 'is', null)

    const { data: unprocessedPOIs } = await supabase
      .schema('core')
      .from('attractions')
      .select('id', { count: 'exact', head: true })
      .is('city_correction_audit', null)

    const { data: activeJobs } = await supabase
      .schema('core')
      .from('city_correction_progress')
      .select('progress_key')
      .or('progress_data.ilike.%processing%, progress_data.ilike.%retrying%, progress_data.ilike.%needs_retry%')

    if ((unprocessedPOIs || 0) > 0 && (!activeJobs || activeJobs.length === 0)) {
      console.log(`🚨 Found ${unprocessedPOIs} unprocessed POIs with no active jobs!`)
      console.log(`💡 Consider starting a new job to process remaining POIs.`)
    }

    // 4. Generate summary report
    const { data: allJobs } = await supabase
      .schema('core')
      .from('city_correction_progress')
      .select('progress_data')
      .order('created_at', { ascending: false })
      .limit(10)

    const completedJobs = allJobs?.filter(job => {
      const data = typeof job.progress_data === 'string' ? JSON.parse(job.progress_data) : job.progress_data
      return data.status === 'completed'
    }) || []
    const failedJobs = allJobs?.filter(job => {
      const data = typeof job.progress_data === 'string' ? JSON.parse(job.progress_data) : job.progress_data
      return data.status === 'failed'
    }) || []

    const summary = {
      stuck_jobs_fixed: stuckJobs?.length || 0,
      retry_jobs_triggered: retryJobs?.length || 0,
      total_pois: totalPOIs || 0,
      processed_pois: processedPOIs || 0,
      unprocessed_pois: unprocessedPOIs || 0,
      active_jobs: activeJobs?.length || 0,
      completed_jobs: completedJobs.length,
      failed_jobs: failedJobs.length
    }

    console.log('📊 System Summary:', summary)

    return new Response(
      JSON.stringify({
        success: true,
        message: 'System monitoring completed',
        summary
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    console.error('💥 Monitor error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    )
  }
})
