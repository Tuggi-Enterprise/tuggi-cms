#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Simular o cliente do frontend (anon key)
const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function testFrontendQueries() {
  console.log('🔍 Testing frontend queries...\n')

  try {
    // Test 1: Load recent jobs (same as frontend)
    console.log('1. Testing recent jobs query...')
    const { data: recentJobs, error: recentJobsError } = await supabase
      .schema('core')
      .from('city_correction_progress')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(5)

    if (recentJobsError) {
      console.error('❌ Recent jobs error:', recentJobsError)
    } else {
      console.log('✅ Recent jobs query successful:')
      console.log(`   Found ${recentJobs?.length || 0} jobs`)
      if (recentJobs && recentJobs.length > 0) {
        recentJobs.forEach((job, index) => {
          console.log(`   Job ${index + 1}: ${job.progress_key} - ${job.progress_data?.status}`)
        })
      }
    }

    // Test 2: Load system stats (same as frontend)
    console.log('\n2. Testing system stats queries...')
    
    // Get candidates count
    const { count: candidatesCount, error: candidatesError } = await supabase
      .schema('core')
      .from('attractions')
      .select('id', { count: 'exact', head: true })
      .is('city_correction_audit', null)

    if (candidatesError) {
      console.error('❌ Candidates count error:', candidatesError)
    } else {
      console.log(`✅ Candidates count: ${candidatesCount || 0}`)
    }

    // Get manual review count
    const { count: manualReviewCount, error: manualReviewError } = await supabase
      .schema('core')
      .from('attractions')
      .select('id', { count: 'exact', head: true })
      .eq('city_correction_audit->needs_manual_review', true)

    if (manualReviewError) {
      console.error('❌ Manual review count error:', manualReviewError)
    } else {
      console.log(`✅ Manual review count: ${manualReviewCount || 0}`)
    }

    // Get processed count
    const { count: processedCount, error: processedError } = await supabase
      .schema('core')
      .from('attractions')
      .select('id', { count: 'exact', head: true })
      .not('city_correction_audit', 'is', null)

    if (processedError) {
      console.error('❌ Processed count error:', processedError)
    } else {
      console.log(`✅ Processed count: ${processedCount || 0}`)
    }

    // Test 3: Fetch specific job progress
    if (recentJobs && recentJobs.length > 0) {
      console.log('\n3. Testing specific job progress query...')
      const jobKey = recentJobs[0].progress_key
      
      const { data: jobProgress, error: jobProgressError } = await supabase
        .schema('core')
        .from('city_correction_progress')
        .select('*')
        .eq('progress_key', jobKey)
        .single()

      if (jobProgressError) {
        console.error('❌ Job progress error:', jobProgressError)
      } else {
        console.log('✅ Job progress query successful:')
        console.log(`   Key: ${jobProgress.progress_key}`)
        console.log(`   Status: ${jobProgress.progress_data?.status}`)
        console.log(`   Total POIs: ${jobProgress.progress_data?.total_pois}`)
        console.log(`   Processed: ${jobProgress.progress_data?.processed}`)
      }
    }

  } catch (error) {
    console.error('💥 Unexpected error:', error)
  }
}

testFrontendQueries()
