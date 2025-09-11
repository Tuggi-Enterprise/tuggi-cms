import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

// Load environment variables
dotenv.config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

console.log('🔍 Testing monitor queries...')

async function testMonitorQueries() {
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // Test the exact query used by the monitor
  console.log('\n1. Testing needs_retry query...')
  const { data: retryJobs, error: retryError } = await supabase
    .schema('core')
    .from('city_correction_progress')
    .select('*')
    .eq('progress_data->>status', 'needs_retry')

  if (retryError) {
    console.error('❌ Error:', retryError)
  } else {
    console.log(`✅ Found ${retryJobs?.length || 0} jobs needing retry:`)
    retryJobs?.forEach((job, i) => {
      console.log(`  Job ${i + 1}: ${job.progress_key}`)
      console.log(`    Status: ${job.progress_data.status}`)
      console.log(`    Remaining: ${job.progress_data.remaining_pois}`)
    })
  }

  // Test all jobs query
  console.log('\n2. Testing all jobs query...')
  const { data: allJobs, error: allError } = await supabase
    .schema('core')
    .from('city_correction_progress')
    .select('*')

  if (allError) {
    console.error('❌ Error:', allError)
  } else {
    console.log(`✅ Found ${allJobs?.length || 0} total jobs:`)
    allJobs?.forEach((job, i) => {
      const status = typeof job.progress_data === 'string' 
        ? JSON.parse(job.progress_data).status 
        : job.progress_data.status
      console.log(`  Job ${i + 1}: ${job.progress_key} - Status: ${status}`)
    })
  }
}

testMonitorQueries().catch(console.error)
