#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function debugProgressTable() {
  console.log('🔍 Debugging city correction progress table...\n')

  try {
    // Check if table exists
    console.log('1. Checking if table exists...')
    const { data: tableCheck, error: tableError } = await supabase
      .schema('core')
      .from('city_correction_progress')
      .select('*')
      .limit(1)

    if (tableError) {
      console.error('❌ Table error:', tableError)
      return
    }

    console.log('✅ Table exists and is accessible')

    // Check table structure
    console.log('\n2. Checking table structure...')
    const { data: structure, error: structureError } = await supabase
      .rpc('get_table_columns', { table_name: 'city_correction_progress', schema_name: 'core' })
      .single()

    if (structureError) {
      console.log('⚠️  Could not get table structure (this is normal)')
    } else {
      console.log('📋 Table structure:', structure)
    }

    // Check for existing records
    console.log('\n3. Checking existing records...')
    const { data: records, error: recordsError } = await supabase
      .schema('core')
      .from('city_correction_progress')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(10)

    if (recordsError) {
      console.error('❌ Error fetching records:', recordsError)
      return
    }

    console.log(`📊 Found ${records?.length || 0} records:`)
    if (records && records.length > 0) {
      records.forEach((record, index) => {
        console.log(`\n  Record ${index + 1}:`)
        console.log(`    Key: ${record.progress_key}`)
        console.log(`    Status: ${record.progress_data?.status || 'unknown'}`)
        console.log(`    Total POIs: ${record.progress_data?.total_pois || 0}`)
        console.log(`    Processed: ${record.progress_data?.processed || 0}`)
        console.log(`    Created: ${record.created_at}`)
        console.log(`    Updated: ${record.updated_at}`)
      })
    } else {
      console.log('  No records found')
    }

    // Test insert
    console.log('\n4. Testing insert...')
    const testKey = `test_${Date.now()}`
    const testData = {
      progress_key: testKey,
      progress_data: {
        total_pois: 10,
        processed: 0,
        corrections_applied: 0,
        manual_review_needed: 0,
        errors: 0,
        status: 'starting',
        started_at: new Date().toISOString()
      }
    }

    const { data: insertData, error: insertError } = await supabase
      .schema('core')
      .from('city_correction_progress')
      .insert(testData)
      .select()

    if (insertError) {
      console.error('❌ Insert error:', insertError)
    } else {
      console.log('✅ Test insert successful:', insertData)
      
      // Clean up test record
      await supabase
        .schema('core')
        .from('city_correction_progress')
        .delete()
        .eq('progress_key', testKey)
      
      console.log('🧹 Test record cleaned up')
    }

  } catch (error) {
    console.error('💥 Unexpected error:', error)
  }
}

debugProgressTable()
