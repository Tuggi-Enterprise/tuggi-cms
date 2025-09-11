#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function testEdgeFunctionQuery() {
  console.log('🔍 Testing Edge Function query...\n')

  try {
    // Test the exact query used by Edge Function
    const { data, error } = await supabase
      .schema('core')
      .from('attractions')
      .select(`
        id, 
        name, 
        city, 
        state, 
        country,
        attraction_coordinate!inner(latitude, longitude)
      `)
      .is('city_correction_audit', null) // Not already processed
      .limit(5)

    if (error) {
      console.error('❌ Query error:', error)
      return
    }

    console.log(`✅ Query successful: Found ${data?.length || 0} POIs`)
    
    if (data && data.length > 0) {
      console.log('\n📋 Sample POIs that can be processed:')
      data.forEach((poi, index) => {
        const coord = poi.attraction_coordinate[0]
        console.log(`   ${index + 1}. ${poi.name}`)
        console.log(`      City: ${poi.city}, State: ${poi.state}, Country: ${poi.country}`)
        console.log(`      Coordinates: ${coord.latitude}, ${coord.longitude}`)
        console.log(`      Audit: ${poi.city_correction_audit ? 'Has audit' : 'No audit'}`)
      })
    } else {
      console.log('❌ No POIs found for processing')
    }

    // Test with different limits
    console.log('\n🔍 Testing with different limits:')
    
    for (const limit of [1, 3, 5, 10]) {
      const { data: testData } = await supabase
        .schema('core')
        .from('attractions')
        .select(`
          id, 
          name, 
          city, 
          state, 
          country,
          attraction_coordinate!inner(latitude, longitude)
        `)
        .is('city_correction_audit', null)
        .limit(limit)

      console.log(`   Limit ${limit}: ${testData?.length || 0} POIs`)
    }

  } catch (error) {
    console.error('💥 Error testing query:', error)
  }
}

testEdgeFunctionQuery()
