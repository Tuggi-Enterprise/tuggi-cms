#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Simular o cliente do frontend (anon key)
const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function debugFrontendState() {
  console.log('🔍 Debugging frontend state...\n')

  try {
    // Simulate the exact same queries as the frontend
    console.log('1. Simulating loadSystemStats...')
    
    // Get candidates count
    const { count: candidatesCount, error: candidatesError } = await supabase
      .schema('core')
      .from('attractions')
      .select('id', { count: 'exact', head: true })
      .is('city_correction_audit', null)

    if (candidatesError) {
      console.error('❌ Candidates count error:', candidatesError)
    } else {
      console.log('✅ Candidates count:', candidatesCount)
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
      console.log('✅ Manual review count:', manualReviewCount)
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
      console.log('✅ Processed count:', processedCount)
    }

    // Simulate the exact same state setting as frontend
    const systemStats = {
      candidates_remaining: candidatesCount || 0,
      manual_review_queue: manualReviewCount || 0,
      total_processed: processedCount || 0,
      corrections_applied: 0
    }

    console.log('\n2. Simulated systemStats state:')
    console.log(JSON.stringify(systemStats, null, 2))

    // Check if there are any attractions with city_correction_audit data
    console.log('\n3. Checking for attractions with city_correction_audit data...')
    const { data: auditData, error: auditError } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, city_correction_audit')
      .not('city_correction_audit', 'is', null)
      .limit(10)

    if (auditError) {
      console.error('❌ Audit data error:', auditError)
    } else {
      console.log(`✅ Found ${auditData?.length || 0} attractions with audit data`)
      if (auditData && auditData.length > 0) {
        auditData.forEach((item, index) => {
          console.log(`   ${index + 1}. ID: ${item.id}`)
          console.log(`      Audit: ${JSON.stringify(item.city_correction_audit, null, 2)}`)
        })
      }
    }

    // Check total count from different sources
    console.log('\n4. Checking total count from different sources...')
    
    // From attractions table
    const { count: totalAttractions } = await supabase
      .schema('core')
      .from('attractions')
      .select('id', { count: 'exact', head: true })

    console.log(`✅ Total attractions: ${totalAttractions}`)

    // From attraction_coordinate table (if different)
    const { count: totalCoordinates } = await supabase
      .schema('core')
      .from('attraction_coordinate')
      .select('id', { count: 'exact', head: true })

    console.log(`✅ Total coordinates: ${totalCoordinates}`)

  } catch (error) {
    console.error('💥 Unexpected error:', error)
  }
}

debugFrontendState()
