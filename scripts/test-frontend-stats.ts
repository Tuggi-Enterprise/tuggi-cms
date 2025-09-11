#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Simular o cliente do frontend (anon key)
const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function testFrontendStats() {
  console.log('🔍 Testing frontend stats queries...\n')

  try {
    // Test 1: Candidates count (same query as frontend)
    console.log('1. Testing candidates count query...')
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

    // Test 2: Manual review count (same query as frontend)
    console.log('\n2. Testing manual review count query...')
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

    // Test 3: Processed count (same query as frontend)
    console.log('\n3. Testing processed count query...')
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

    // Test 4: Total attractions count (for comparison)
    console.log('\n4. Testing total attractions count...')
    const { count: totalCount, error: totalError } = await supabase
      .schema('core')
      .from('attractions')
      .select('id', { count: 'exact', head: true })

    if (totalError) {
      console.error('❌ Total count error:', totalError)
    } else {
      console.log('✅ Total attractions count:', totalCount)
    }

    // Test 5: Check if city_correction_audit column exists
    console.log('\n5. Testing city_correction_audit column...')
    const { data: sampleData, error: sampleError } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, city_correction_audit')
      .limit(5)

    if (sampleError) {
      console.error('❌ Sample data error:', sampleError)
    } else {
      console.log('✅ Sample data with city_correction_audit:')
      sampleData?.forEach((item, index) => {
        console.log(`   ${index + 1}. ID: ${item.id}, audit: ${item.city_correction_audit ? 'has data' : 'null'}`)
      })
    }

    // Summary
    console.log('\n📊 Summary:')
    console.log(`   Total attractions: ${totalCount || 0}`)
    console.log(`   Candidates (no audit): ${candidatesCount || 0}`)
    console.log(`   Processed (has audit): ${processedCount || 0}`)
    console.log(`   Manual review needed: ${manualReviewCount || 0}`)
    console.log(`   Math check: ${(candidatesCount || 0) + (processedCount || 0)} = ${totalCount || 0}`)

  } catch (error) {
    console.error('💥 Unexpected error:', error)
  }
}

testFrontendStats()
