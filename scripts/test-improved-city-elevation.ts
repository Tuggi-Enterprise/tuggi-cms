import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function testImprovedCityElevation(attractionId: string) {
  console.log('🔍 TESTING IMPROVED CITY ELEVATION LOGIC')
  console.log('============================================================')

  try {
    // Get POI data
    const { data: attraction, error } = await supabase
      .schema('core')
      .from('attractions')
      .select(`
        id,
        name,
        city,
        country,
        coordinates:attraction_coordinate!inner(
          latitude,
          longitude
        )
      `)
      .eq('id', attractionId)
      .single()

    if (error || !attraction) {
      console.error('❌ Error fetching attraction:', error)
      return
    }

    const coord = attraction.coordinates[0]
    console.log(`📍 Testing for: ${attraction.name}`)
    console.log(`🏙️ City: ${attraction.city}, ${attraction.country}`)
    console.log(`📍 Coordinates: ${coord.latitude}, ${coord.longitude}`)
    console.log('')

    // Simulate the new elevation detection by calling the API endpoint
    console.log('🔄 Testing new city elevation detection via API...')
    
    const testData = {
      attraction_id: attractionId,
      poi_lat: coord.latitude,
      poi_lng: coord.longitude,
      poi_name: attraction.name
    }

    console.log('📡 Calling /api/poi-boundaries/detect with new elevation logic...')
    
    const response = await fetch('http://localhost:3000/api/poi-boundaries/detect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testData)
    })

    if (!response.ok) {
      console.error(`❌ API call failed: ${response.status}`)
      const errorText = await response.text()
      console.error('Error details:', errorText)
      return
    }

    const result = await response.json()
    
    console.log('')
    console.log('🎯 API RESPONSE ANALYSIS:')
    console.log('============================================================')
    console.log('Success:', result.success)
    
    if (result.landmark_info) {
      console.log(`🏔️ Landmark Info:`)
      console.log(`   • High Visibility: ${result.landmark_info.isHighVisibility}`)
      console.log(`   • Max Range: ${result.landmark_info.maxRange}m`)
      console.log(`   • Elevation Diff: ${result.landmark_info.elevationDiff}m`)
    }
    
    if (result.trigger_points_generated) {
      console.log(`🎯 Trigger Points: ${result.trigger_points_generated} generated`)
    }
    
    console.log('')
    console.log('📊 EXPECTED RESULTS WITH NEW LOGIC:')
    console.log('============================================================')
    console.log('🏙️ Expected City Base Elevation: 852m (Belo Horizonte)')
    console.log('🏔️ POI Elevation: 789m (aeroporto nearby)')
    console.log('📊 Expected Difference: 789 - 852 = -63m')
    console.log('🎯 Expected Classification: NORMAL (not high-visibility)')
    console.log('📏 Expected Trigger Point Spacing: NORMAL (not landmark spacing)')
    
    // Verify the result matches expectations
    if (result.landmark_info) {
      const isHighVis = result.landmark_info.isHighVisibility
      const elevDiff = result.landmark_info.elevationDiff
      
      console.log('')
      console.log('✅ VERIFICATION:')
      console.log('============================================================')
      
      if (!isHighVis && elevDiff <= 0) {
        console.log('✅ SUCCESS: Shopping correctly classified as NORMAL POI')
        console.log('✅ SUCCESS: Elevation difference is negative (below city average)')
        console.log('✅ SUCCESS: No longer treated as high-visibility landmark')
      } else if (isHighVis) {
        console.log('❌ ISSUE: Shopping still classified as high-visibility landmark')
        console.log(`   • This suggests the city elevation detection may not be working`)
        console.log(`   • Elevation difference: ${elevDiff}m`)
      } else {
        console.log('⚠️ PARTIAL: Shopping not high-visibility but elevation diff unexpected')
        console.log(`   • Elevation difference: ${elevDiff}m`)
      }
    } else {
      console.log('⚠️ No landmark info in response - may have failed earlier in the process')
    }

  } catch (error) {
    console.error('❌ Error:', error)
  }
}

// Execute test
const attractionId = process.argv[2] || '14fdc746-840e-4465-8af5-3bce26519be6'
testImprovedCityElevation(attractionId)
