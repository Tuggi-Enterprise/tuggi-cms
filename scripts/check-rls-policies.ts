#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Test with anon key
const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey)

// Test with service role key
const supabaseService = createClient(supabaseUrl, supabaseServiceKey)

async function checkRLSPolicies() {
  console.log('🔍 Checking RLS policies and access levels...\n')

  try {
    // 1. Count with anon key
    console.log('🔑 Testing with ANON key:')
    const { count: anonCount } = await supabaseAnon
      .schema('core')
      .from('attractions')
      .select('id', { count: 'exact', head: true })

    console.log(`   Count: ${anonCount}`)

    // 2. Count with service role key
    console.log('\n🔧 Testing with SERVICE ROLE key:')
    const { count: serviceCount } = await supabaseService
      .schema('core')
      .from('attractions')
      .select('id', { count: 'exact', head: true })

    console.log(`   Count: ${serviceCount}`)

    // 3. Check if there are RLS policies
    console.log('\n🔒 Checking RLS policies:')
    
    // Try to get policy information (this might not work with anon key)
    try {
      const { data: policies } = await supabaseService
        .schema('core')
        .from('attractions')
        .select('*')
        .limit(1)
      
      console.log('   Service role can access data')
    } catch (error) {
      console.log('   Service role access error:', error)
    }

    // 4. Check if there are different user contexts
    console.log('\n👤 Checking user contexts:')
    
    const { data: { user: anonUser } } = await supabaseAnon.auth.getUser()
    const { data: { user: serviceUser } } = await supabaseService.auth.getUser()
    
    console.log(`   Anon user: ${anonUser ? anonUser.id : 'Anonymous'}`)
    console.log(`   Service user: ${serviceUser ? serviceUser.id : 'Anonymous'}`)

    // 5. Test Edge Function access (simulate)
    console.log('\n⚡ Testing Edge Function simulation:')
    
    // Simulate what the Edge Function sees
    const { data: edgeFunctionData } = await supabaseService
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
      .limit(5)

    console.log(`   Edge Function can see: ${edgeFunctionData?.length || 0} POIs`)
    if (edgeFunctionData && edgeFunctionData.length > 0) {
      console.log(`   Sample: ${edgeFunctionData[0].name}`)
    }

    // 6. Check if there are different schemas or tables
    console.log('\n🗂️ Checking for other data sources:')
    
    // Check if there are other tables with more data
    const tablesToCheck = [
      'attractions',
      'attraction', 
      'pois',
      'poi',
      'points_of_interest',
      'locations',
      'places'
    ]

    for (const table of tablesToCheck) {
      try {
        const { count: tableCount } = await supabaseService
          .schema('core')
          .from(table)
          .select('id', { count: 'exact', head: true })
        
        if (tableCount && tableCount > 0) {
          console.log(`   📋 ${table}: ${tableCount} records`)
        }
      } catch (error) {
        // Table doesn't exist
      }
    }

    // 7. Check if there are different environments
    console.log('\n🌍 Environment check:')
    console.log(`   URL: ${supabaseUrl}`)
    console.log(`   Anon key: ${supabaseAnonKey.substring(0, 20)}...`)
    console.log(`   Service key: ${supabaseServiceKey.substring(0, 20)}...`)

    // Summary
    console.log('\n📊 Summary:')
    console.log(`   Anon key sees: ${anonCount} POIs`)
    console.log(`   Service key sees: ${serviceCount} POIs`)
    console.log(`   Difference: ${(serviceCount || 0) - (anonCount || 0)} POIs`)
    
    if (serviceCount && serviceCount > anonCount) {
      console.log('   🚨 RLS policies are limiting anon key access!')
    } else if (serviceCount === anonCount) {
      console.log('   ✅ Both keys see the same data')
    }

  } catch (error) {
    console.error('💥 Error checking RLS policies:', error)
  }
}

checkRLSPolicies()
