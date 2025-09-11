import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

// Load environment variables
dotenv.config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

console.log('🔧 Manual retry test...')

async function testManualRetry() {
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // 1. Find jobs needing retry
  console.log('\n1. Finding jobs needing retry...')
  const { data: retryJobs, error: retryError } = await supabase
    .schema('core')
    .from('city_correction_progress')
    .select('*')
    .eq('progress_data->>status', 'needs_retry')

  if (retryError) {
    console.error('❌ Error finding retry jobs:', retryError)
    return
  }

  if (!retryJobs || retryJobs.length === 0) {
    console.log('ℹ️  No jobs needing retry found')
    return
  }

  console.log(`✅ Found ${retryJobs.length} job(s) needing retry`)

  // 2. Process each job
  for (const job of retryJobs) {
    console.log(`\n🔄 Processing job: ${job.progress_key}`)
    
    const progressData = typeof job.progress_data === 'string' 
      ? JSON.parse(job.progress_data) 
      : job.progress_data

    const currentRemaining = progressData.remaining_pois || 0
    console.log(`   Remaining POIs: ${currentRemaining}`)
    
    if (currentRemaining > 0) {
      const batchSize = Math.min(currentRemaining, 15) // Using our new limit
      const retryCount = (progressData.retry_count || 0) + 1
      
      console.log(`   Batch size: ${batchSize}`)
      console.log(`   Retry count: ${retryCount}`)
      
      // Update status to retrying
      console.log('   📝 Updating status to retrying...')
      const { error: updateError } = await supabase
        .schema('core')
        .from('city_correction_progress')
        .update({
          progress_data: {
            ...progressData,
            status: 'retrying',
            retry_count: retryCount,
            message: `Manual retry test #${retryCount} - processing ${batchSize} POIs`
          }
        })
        .eq('progress_key', job.progress_key)

      if (updateError) {
        console.error('   ❌ Error updating status:', updateError)
        continue
      }

      // Trigger the Edge Function
      console.log('   🚀 Triggering Edge Function...')
      try {
        const edgeFunctionUrl = `${supabaseUrl}/functions/v1/city-correction`
        const response = await fetch(edgeFunctionUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseAnonKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            action: 'process_batch',
            limit: batchSize
          })
        })

        if (response.ok) {
          const result = await response.json()
          console.log('   ✅ Edge Function triggered successfully')
          console.log('   📊 Result:', JSON.stringify(result, null, 2))
        } else {
          const errorText = await response.text()
          console.error('   ❌ Edge Function failed:', response.status, errorText)
        }
      } catch (fetchError) {
        console.error('   ❌ Error triggering Edge Function:', fetchError)
      }
    } else {
      console.log('   ✅ Job completed - no remaining POIs')
    }
  }
}

testManualRetry().catch(console.error)
