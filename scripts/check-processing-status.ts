#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function checkProcessingStatus() {
  console.log('🔍 Checking POI processing status...\n')

  try {
    // 1. Total POIs
    const { count: totalPOIs } = await supabase
      .schema('core')
      .from('attractions')
      .select('id', { count: 'exact', head: true })

    console.log(`📊 Total POIs: ${totalPOIs}`)

    // 2. POIs already processed (have city_correction_audit)
    const { count: processedPOIs } = await supabase
      .schema('core')
      .from('attractions')
      .select('id', { count: 'exact', head: true })
      .not('city_correction_audit', 'is', null)

    console.log(`✅ Already processed: ${processedPOIs}`)

    // 3. POIs pending processing (no city_correction_audit)
    const { count: pendingPOIs } = await supabase
      .schema('core')
      .from('attractions')
      .select('id', { count: 'exact', head: true })
      .is('city_correction_audit', null)

    console.log(`⏳ Pending processing: ${pendingPOIs}`)

    // 4. POIs with coordinates (can be processed) - using JOIN
    const { data: poisWithCoordsData } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, attraction_coordinate!inner(id)')
      .is('city_correction_audit', null)

    const poisWithCoords = poisWithCoordsData?.length || 0
    console.log(`📍 Pending with coordinates: ${poisWithCoords}`)

    // 5. POIs without coordinates (cannot be processed)
    const poisWithoutCoords = (pendingPOIs || 0) - poisWithCoords

    console.log(`❌ Pending without coordinates: ${poisWithoutCoords}`)

    // 6. Check for corrections applied
    const { count: correctionsApplied } = await supabase
      .schema('core')
      .from('attractions')
      .select('id', { count: 'exact', head: true })
      .not('city_correction_audit', 'is', null)
      .eq('city_correction_audit->auto_corrected', true)

    console.log(`🔧 Auto-corrections applied: ${correctionsApplied}`)

    // 7. Check for manual review needed
    const { count: manualReviewNeeded } = await supabase
      .schema('core')
      .from('attractions')
      .select('id', { count: 'exact', head: true })
      .not('city_correction_audit', 'is', null)
      .eq('city_correction_audit->needs_manual_review', true)

    console.log(`👁️ Manual review needed: ${manualReviewNeeded}`)

    // 8. Sample of processed POIs
    console.log('\n📋 Sample of processed POIs:')
    const { data: sampleProcessed } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city, city_correction_audit')
      .not('city_correction_audit', 'is', null)
      .limit(5)

    if (sampleProcessed && sampleProcessed.length > 0) {
      sampleProcessed.forEach((poi, index) => {
        const audit = poi.city_correction_audit
        console.log(`   ${index + 1}. ${poi.name}`)
        console.log(`      Current city: ${poi.city}`)
        if (audit) {
          console.log(`      Original: ${audit.original_city}`)
          console.log(`      Corrected: ${audit.corrected_city}`)
          console.log(`      Confidence: ${audit.confidence}`)
          console.log(`      Auto-corrected: ${audit.auto_corrected}`)
        }
      })
    } else {
      console.log('   No processed POIs found')
    }

    // 9. Sample of pending POIs
    console.log('\n⏳ Sample of pending POIs:')
    const { data: samplePending } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city, state, country')
      .is('city_correction_audit', null)
      .limit(5)

    if (samplePending && samplePending.length > 0) {
      samplePending.forEach((poi, index) => {
        console.log(`   ${index + 1}. ${poi.name} (${poi.city}, ${poi.state}, ${poi.country})`)
      })
    } else {
      console.log('   No pending POIs found')
    }

    // Summary
    console.log('\n📊 Summary:')
    console.log(`   Total POIs: ${totalPOIs}`)
    console.log(`   Processed: ${processedPOIs} (${((processedPOIs || 0) / (totalPOIs || 1) * 100).toFixed(1)}%)`)
    console.log(`   Pending: ${pendingPOIs} (${((pendingPOIs || 0) / (totalPOIs || 1) * 100).toFixed(1)}%)`)
    console.log(`   Can be processed: ${poisWithCoords}`)
    console.log(`   Cannot be processed (no coords): ${poisWithoutCoords}`)

  } catch (error) {
    console.error('💥 Error checking processing status:', error)
  }
}

checkProcessingStatus()
