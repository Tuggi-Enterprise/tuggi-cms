#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function investigatePOICount() {
  console.log('🔍 Investigating POI count discrepancy...\n')

  try {
    // 1. Count using anon key (what frontend sees)
    const { count: anonCount } = await supabase
      .schema('core')
      .from('attractions')
      .select('id', { count: 'exact', head: true })

    console.log(`🔑 Anon key count: ${anonCount}`)

    // 2. Check if there are RLS policies affecting the count
    console.log('\n🔒 Checking RLS policies...')
    
    // Try to get a sample with anon key
    const { data: anonSample, error: anonError } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city, state, country')
      .limit(5)

    if (anonError) {
      console.error('❌ Anon key error:', anonError)
    } else {
      console.log(`✅ Anon key sample: ${anonSample?.length || 0} POIs`)
      if (anonSample && anonSample.length > 0) {
        anonSample.forEach((poi, index) => {
          console.log(`   ${index + 1}. ${poi.name} (${poi.city}, ${poi.state}, ${poi.country})`)
        })
      }
    }

    // 3. Check different schemas
    console.log('\n📊 Checking different schemas...')
    
    // Try public schema
    const { count: publicCount } = await supabase
      .from('attractions')
      .select('id', { count: 'exact', head: true })

    console.log(`🌐 Public schema count: ${publicCount}`)

    // 4. Check if there are multiple tables
    console.log('\n🗂️ Checking for multiple attraction tables...')
    
    // Try different table names
    const tableNames = ['attractions', 'attraction', 'pois', 'poi', 'points_of_interest']
    
    for (const tableName of tableNames) {
      try {
        const { count: tableCount } = await supabase
          .schema('core')
          .from(tableName)
          .select('id', { count: 'exact', head: true })
        
        if (tableCount && tableCount > 0) {
          console.log(`   📋 ${tableName}: ${tableCount} records`)
        }
      } catch (error) {
        // Table doesn't exist, ignore
      }
    }

    // 5. Check if there are filters being applied
    console.log('\n🔍 Checking for hidden filters...')
    
    // Check if there are any WHERE conditions that might be filtering
    const { data: allData } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city, state, country, created_at, updated_at')
      .limit(10)

    console.log(`📋 Sample of all data: ${allData?.length || 0} records`)
    if (allData && allData.length > 0) {
      allData.forEach((poi, index) => {
        console.log(`   ${index + 1}. ${poi.name}`)
        console.log(`      Created: ${poi.created_at}`)
        console.log(`      Updated: ${poi.updated_at}`)
      })
    }

    // 6. Check if there are different user contexts
    console.log('\n👤 Checking user context...')
    
    const { data: { user } } = await supabase.auth.getUser()
    console.log(`👤 Current user: ${user ? user.id : 'Anonymous'}`)

    // 7. Check if there are different databases or environments
    console.log('\n🌍 Checking environment...')
    console.log(`🔗 Supabase URL: ${supabaseUrl}`)
    console.log(`🔑 Using anon key: ${supabaseAnonKey.substring(0, 20)}...`)

    // 8. Try to get the exact count that the API returns
    console.log('\n📡 Checking API endpoint...')
    
    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/attractions?select=id&limit=1`, {
        headers: {
          'apikey': supabaseAnonKey,
          'Authorization': `Bearer ${supabaseAnonKey}`,
          'Content-Type': 'application/json'
        }
      })
      
      const totalCount = response.headers.get('content-range')
      console.log(`📡 API content-range: ${totalCount}`)
    } catch (error) {
      console.log(`❌ API check failed: ${error}`)
    }

  } catch (error) {
    console.error('💥 Error investigating POI count:', error)
  }
}

investigatePOICount()
