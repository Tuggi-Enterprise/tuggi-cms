#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function checkCoordinatesDetailed() {
  console.log('🔍 Checking coordinates in detail...\n')

  try {
    // 1. Total POIs
    const { count: totalPOIs } = await supabase
      .schema('core')
      .from('attractions')
      .select('id', { count: 'exact', head: true })

    console.log(`📊 Total POIs: ${totalPOIs}`)

    // 2. Total coordinates
    const { count: totalCoordinates } = await supabase
      .schema('core')
      .from('attraction_coordinate')
      .select('id', { count: 'exact', head: true })

    console.log(`📍 Total coordinates: ${totalCoordinates}`)

    // 3. POIs with coordinates using different methods
    console.log('\n🔍 Testing different methods to count POIs with coordinates:')

    // Method 1: Using JOIN with limit (what API uses)
    const { data: method1Data } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, attraction_coordinate!inner(id)')
      .limit(1000)

    console.log(`   Method 1 (JOIN with limit 1000): ${method1Data?.length || 0}`)

    // Method 2: Using JOIN without limit
    const { data: method2Data } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, attraction_coordinate!inner(id)')

    console.log(`   Method 2 (JOIN without limit): ${method2Data?.length || 0}`)

    // Method 3: Using count with JOIN
    const { count: method3Count } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, attraction_coordinate!inner(id)', { count: 'exact', head: true })

    console.log(`   Method 3 (JOIN with count): ${method3Count}`)

    // Method 4: Check if there's a limit in the query
    console.log('\n🔍 Testing with different limits:')
    
    for (const limit of [100, 500, 1000, 2000, 5000]) {
      const { data: limitData } = await supabase
        .schema('core')
        .from('attractions')
        .select('id, attraction_coordinate!inner(id)')
        .limit(limit)

      console.log(`   Limit ${limit}: ${limitData?.length || 0} POIs`)
    }

    // 5. Check if there are any filters being applied
    console.log('\n🔍 Checking for hidden filters:')
    
    // Check if there are any WHERE conditions
    const { data: sampleData } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city, state, country, created_at')
      .limit(10)

    console.log(`   Sample data: ${sampleData?.length || 0} records`)
    if (sampleData && sampleData.length > 0) {
      console.log(`   First POI: ${sampleData[0].name} (${sampleData[0].city})`)
      console.log(`   Created: ${sampleData[0].created_at}`)
    }

    // 6. Check if there are different schemas
    console.log('\n🗂️ Checking different schemas:')
    
    // Try public schema
    const { count: publicCount } = await supabase
      .from('attractions')
      .select('id', { count: 'exact', head: true })

    console.log(`   Public schema: ${publicCount}`)

    // 7. Check if there are multiple coordinate tables
    console.log('\n📍 Checking coordinate tables:')
    
    const coordTables = ['attraction_coordinate', 'coordinates', 'poi_coordinates', 'location_coordinates']
    
    for (const table of coordTables) {
      try {
        const { count: tableCount } = await supabase
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

    // 8. Check the relationship between attractions and coordinates
    console.log('\n🔗 Checking relationship:')
    
    // Get a sample of attractions with their coordinates
    const { data: relationshipData } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, attraction_coordinate(id, latitude, longitude)')
      .limit(5)

    if (relationshipData && relationshipData.length > 0) {
      relationshipData.forEach((attraction, index) => {
        console.log(`   ${index + 1}. ${attraction.name}`)
        if (attraction.attraction_coordinate && attraction.attraction_coordinate.length > 0) {
          const coord = attraction.attraction_coordinate[0]
          console.log(`      Has coordinates: ${coord.latitude}, ${coord.longitude}`)
        } else {
          console.log(`      No coordinates`)
        }
      })
    }

    // Summary
    console.log('\n📊 Summary:')
    console.log(`   Total POIs: ${totalPOIs}`)
    console.log(`   Total coordinates: ${totalCoordinates}`)
    console.log(`   POIs with coordinates (Method 2): ${method2Data?.length || 0}`)
    console.log(`   POIs with coordinates (Method 3): ${method3Count}`)
    
    if (method2Data && method2Data.length > 0) {
      console.log(`   ✅ Found ${method2Data.length} POIs with coordinates`)
    } else {
      console.log(`   ❌ No POIs with coordinates found`)
    }

  } catch (error) {
    console.error('💥 Error checking coordinates:', error)
  }
}

checkCoordinatesDetailed()
