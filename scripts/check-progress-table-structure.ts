#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function checkProgressTableStructure() {
  console.log('🔍 Checking city_correction_progress table structure...\n')

  try {
    // Get a sample record to see the structure
    const { data: sampleRecord, error } = await supabase
      .schema('core')
      .from('city_correction_progress')
      .select('*')
      .limit(1)
      .single()

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error('❌ Error querying table:', error)
      return
    }

    if (sampleRecord) {
      console.log('📋 Sample record structure:')
      console.log('Columns:', Object.keys(sampleRecord))
      console.log('\n📊 progress_data structure:')
      console.log(JSON.stringify(sampleRecord.progress_data, null, 2))
      
      // Check if target_goal exists
      if (sampleRecord.progress_data && sampleRecord.progress_data.target_goal !== undefined) {
        console.log(`\n✅ target_goal field exists: ${sampleRecord.progress_data.target_goal}`)
      } else {
        console.log('\n❌ target_goal field does NOT exist in progress_data')
      }
    } else {
      console.log('📋 No records found in table, showing expected structure:')
      
      const expectedStructure = {
        progress_key: 'string - unique job identifier',
        progress_data: {
          status: 'string - processing/completed/failed/needs_retry',
          target_goal: 'number - total POIs to process (OBJECTIVE)',
          total_pois: 'number - POIs in current batch',
          processed: 'number - POIs processed in current batch',
          total_processed_so_far: 'number - total POIs processed across all batches',
          remaining_pois: 'number - POIs still to be processed',
          corrections_applied: 'number - corrections made',
          manual_review_needed: 'number - POIs needing manual review',
          errors: 'number - errors encountered',
          retry_count: 'number - number of retries',
          started_at: 'ISO string - when job started',
          completed_at: 'ISO string - when job completed',
          current_poi: 'string - currently processing POI name'
        },
        created_at: 'timestamp - when record was created',
        updated_at: 'timestamp - when record was last updated'
      }
      
      console.log(JSON.stringify(expectedStructure, null, 2))
    }

    // Check if table exists by trying to query it
    console.log('\n🗂️ Table accessibility check:')
    const { data, error: countError } = await supabase
      .schema('core')
      .from('city_correction_progress')
      .select('progress_key', { count: 'exact', head: true })

    if (countError) {
      console.error('❌ Table access error:', countError)
    } else {
      console.log(`✅ Table exists and contains ${data} records`)
    }

  } catch (error) {
    console.error('💥 Error checking table structure:', error)
  }
}

checkProgressTableStructure()
