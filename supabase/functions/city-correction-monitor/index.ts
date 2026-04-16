import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    console.log('🔍 City Correction Monitor - Starting system check...')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!.trim()
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!.trim()
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 1. Check for orphaned/stuck jobs
    const now = new Date()
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000)

    const { data: stuckJobs } = await supabase
      .schema('core')
      .from('city_correction_progress')
      .select('*')
      .eq('progress_data->>status', 'processing')
      .lt('updated_at', fiveMinutesAgo.toISOString())

    if (stuckJobs && stuckJobs.length > 0) {
      for (const job of stuckJobs) {
        await supabase
          .schema('core')
          .from('city_correction_progress')
          .update({
            progress_data: {
              ...job.progress_data,
              status: 'failed',
              message: 'Job stuck - marked as failed by monitor',
              completed_at: new Date().toISOString()
            }
          })
          .eq('progress_key', job.progress_key)
      }
    }

    // 2. Check for jobs that need retry
    const { data: retryJobs } = await supabase
      .schema('core')
      .from('city_correction_progress')
      .select('*')
      .eq('progress_data->>status', 'needs_retry')

    if (retryJobs && retryJobs.length > 0) {
      for (const job of retryJobs) {
        const progressData = job.progress_data
        const currentRemaining = progressData.remaining_pois || 0
        
        if (currentRemaining > 0) {
          const batchSize = Math.min(currentRemaining, 5)
          const retryCount = (progressData.retry_count || 0) + 1
          
          await supabase
            .schema('core')
            .from('city_correction_progress')
            .update({
              progress_data: {
                ...progressData,
                status: 'retrying',
                retry_count: retryCount,
                message: `Auto-retry #${retryCount}`
              }
            })
            .eq('progress_key', job.progress_key)

          await fetch(`${supabaseUrl}/functions/v1/city-correction`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${supabaseServiceKey}`,
              'apikey': supabaseServiceKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              action: 'process_batch',
              progress_key: job.progress_key,
              batch_size: batchSize,
              limit: batchSize
            })
          })
        }
      }
    }

    // 3. Stats & Summary (CORRIGIDO: usando a propriedade .count)
    const { count: totalPOIs } = await supabase
      .schema('core')
      .from('attractions')
      .select('id', { count: 'exact', head: true })

    const { count: processedPOIs } = await supabase
      .schema('core')
      .from('attractions')
      .select('id', { count: 'exact', head: true })
      .not('city_correction_audit', 'is', null)

    const { count: unprocessedPOIs } = await supabase
      .schema('core')
      .from('attractions')
      .select('id', { count: 'exact', head: true })
      .is('city_correction_audit', null)

    const summary = {
      stuck_jobs_fixed: stuckJobs?.length || 0,
      retry_jobs_triggered: retryJobs?.length || 0,
      total_pois: totalPOIs || 0,
      processed_pois: processedPOIs || 0,
      unprocessed_pois: unprocessedPOIs || 0
    }

    console.log('📊 System Summary:', summary)

    return new Response(
      JSON.stringify({ success: true, summary }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('💥 Monitor error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
