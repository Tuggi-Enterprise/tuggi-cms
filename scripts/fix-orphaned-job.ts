#!/usr/bin/env tsx

import { getSupabase } from '../lib/core/supabase-client'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const supabase = getSupabase('server')

async function fixOrphanedJob() {
  console.log('🔧 Fixing orphaned job...\n')

  const jobKey = 'job_1757624175237_qknuk23en'

  try {
    // First, check the current status
    console.log('1. Checking current job status...')
    const { data: currentJob, error: fetchError } = await supabase
      .schema('core')
      .from('city_correction_progress')
      .select('*')
      .eq('progress_key', jobKey)
      .single()

    if (fetchError) {
      console.error('❌ Error fetching job:', fetchError)
      return
    }

    console.log('✅ Current job status:', currentJob)

    // Check if job is orphaned (no updates for more than 5 minutes)
    const now = new Date()
    const updatedAt = new Date(currentJob.updated_at)
    const timeDiff = now.getTime() - updatedAt.getTime()
    const minutesDiff = timeDiff / (1000 * 60)

    console.log(`⏰ Time since last update: ${minutesDiff.toFixed(2)} minutes`)

    if (minutesDiff > 5) {
      console.log('🚨 Job is orphaned, marking as failed...')
      
      // Mark as failed
      const { error: updateError } = await supabase
        .schema('core')
        .from('city_correction_progress')
        .update({
          progress_data: {
            ...currentJob.progress_data,
            status: 'failed',
            error: 'Job timeout - no updates for more than 5 minutes',
            failed_at: new Date().toISOString()
          }
        })
        .eq('progress_key', jobKey)

      if (updateError) {
        console.error('❌ Error updating job:', updateError)
      } else {
        console.log('✅ Job marked as failed successfully')
      }
    } else {
      console.log('✅ Job is still active, no action needed')
    }

  } catch (error) {
    console.error('💥 Unexpected error:', error)
  }
}

fixOrphanedJob()
