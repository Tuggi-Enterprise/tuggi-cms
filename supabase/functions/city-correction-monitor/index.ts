import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validateAuthHeader } from '../_shared/auth-middleware.ts'
import { checkRateLimit, createRateLimitResponse, RATE_LIMIT_CONFIG } from '../_shared/rate-limiter.ts'
import { createSecureHeaders } from '../_shared/security-headers.ts'
import {
  validateRequestBody,
  createValidationErrorResponse,
  CityCorrectionMonitorSchema,
} from '../_shared/validation-schemas.ts'
import { createAuditLogger } from '../_shared/audit-logger.ts'
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: createSecureHeaders(corsHeaders) })
  }

  // ✅ VALIDAR AUTENTICAÇÃO
  const authResult = await validateAuthHeader(req)
  if (!authResult.valid) {
    console.warn(`[City-Correction-Monitor] ❌ Unauthorized: ${authResult.error}`)
    return new Response(
      JSON.stringify({ error: 'Unauthorized', detail: authResult.error }),
      { status: 401, headers: createSecureHeaders(corsHeaders) }
    )
  }
  console.log(`[City-Correction-Monitor] ✅ Authorized: ${authResult.email}`)

  // ✅ RATE LIMITING CHECK
  const config = RATE_LIMIT_CONFIG['city-correction-monitor']
  const rateLimit = checkRateLimit(req, 'city-correction-monitor', config.maxRequests, config.windowSeconds)
  if (!rateLimit.allowed) {
    console.warn(`[City-Correction-Monitor] ⚠️ Rate limit exceeded for ${rateLimit.clientId}`)
    return createRateLimitResponse(rateLimit, corsHeaders)
  }
  console.log(`[City-Correction-Monitor] ✅ Rate limit OK (${rateLimit.remaining} remaining)`)

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
      .eq('progress_data->>status', 'processing')
      .lt('updated_at', fiveMinutesAgo.toISOString())

    if (stuckError) {
      console.error('❌ Error finding stuck jobs:', stuckError)
    } else if (stuckJobs && stuckJobs.length > 0) {
      console.log(`🚨 Found ${stuckJobs.length} stuck job(s)`)
      
      for (const job of stuckJobs) {
        const progressData = job.progress_data
        console.log(`🔧 Marking stuck job ${job.progress_key} as failed`)
        
        // Mark as failed
        await supabase
          .schema('core')
          .from('city_correction_progress')
          .update({
            progress_data: {
              ...progressData,
              status: 'failed',
              message: 'Job stuck - marked as failed by monitor',
              completed_at: new Date().toISOString()
            }
          })
          .eq('progress_key', job.progress_key)
      }
    }

    // 2. Check for jobs that need retry
    const { data: retryJobs, error: retryError } = await supabase
      .schema('core')
      .from('city_correction_progress')
      .select('*')
      .eq('progress_data->>status', 'needs_retry')

    if (retryError) {
      console.error('❌ Error finding retry jobs:', retryError)
    } else if (retryJobs && retryJobs.length > 0) {
      console.log(`🔄 Found ${retryJobs.length} job(s) needing retry`)
      
      for (const job of retryJobs) {
        const progressData = job.progress_data
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
              progress_data: {
                ...progressData,
                status: 'retrying',
                retry_count: retryCount,
                message: `Auto-retry #${retryCount} - processing ${batchSize} POIs`
              }
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
              progress_data: {
                ...progressData,
                status: 'completed',
                message: 'All POIs processed successfully!',
                completed_at: new Date().toISOString()
              }
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
      .in('progress_data->>status', ['processing', 'retrying', 'needs_retry'])

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

    const { data: completedJobsData } = await supabase
      .schema('core')
      .from('city_correction_progress')
      .select('progress_key', { count: 'exact', head: true })
      .eq('progress_data->>status', 'completed')

    const { data: failedJobsData } = await supabase
      .schema('core')
      .from('city_correction_progress')
      .select('progress_key', { count: 'exact', head: true })
      .eq('progress_data->>status', 'failed')

    const summary = {
      stuck_jobs_fixed: stuckJobs?.length || 0,
      retry_jobs_triggered: retryJobs?.length || 0,
      total_pois: totalPOIs || 0,
      processed_pois: processedPOIs || 0,
      unprocessed_pois: unprocessedPOIs || 0,
      active_jobs: activeJobs?.length || 0,
      completed_jobs: completedJobsData || 0,
      failed_jobs: failedJobsData || 0
    }

    console.log('📊 System Summary:', summary)

    return new Response(
      JSON.stringify({
        success: true,
        message: 'System monitoring completed',
        summary
      }),
      {
        headers: { headers: createSecureHeaders(corsHeaders) },
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
        headers: { headers: createSecureHeaders(corsHeaders) },
        status: 500,
      }
    )
  }
})
