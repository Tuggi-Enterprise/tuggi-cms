#!/usr/bin/env tsx

/**
 * Quick City Correction Test
 * Simple test without rate limiting for demonstration
 */

import { config } from 'dotenv'
import { getSupabase } from '../lib/core/supabase-client'

// Load environment variables
config()

const supabase = getSupabase('service')

async function quickTest() {
  console.log('🚀 Quick City Correction Test')
  console.log('============================\n')

  try {
    // Get a few POIs that might need correction
    const { data: pois, error } = await supabase
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
      .limit(3)

    if (error) {
      console.error('❌ Error fetching POIs:', error.message)
      return
    }

    console.log(`📋 Found ${pois.length} POIs to test:\n`)

    for (let i = 0; i < pois.length; i++) {
      const poi = pois[i]
      const coords = poi.attraction_coordinate[0]
      
      if (!coords) continue

      console.log(`${i + 1}. ${poi.name}`)
      console.log(`   Current city: ${poi.city}`)
      console.log(`   Coordinates: ${coords.latitude}, ${coords.longitude}`)
      console.log(`   Country: ${poi.country}`)
      
      // Test Nominatim reverse geocoding
      try {
        console.log(`   🔍 Testing Nominatim...`)
        
        const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?lat=${coords.latitude}&lon=${coords.longitude}&format=json&addressdetails=1&zoom=10`
        
        const response = await fetch(nominatimUrl, {
          headers: {
            'User-Agent': 'TuggiCMS/1.0 (quick-test)'
          }
        })
        
        if (response.ok) {
          const data = await response.json()
          
          if (data.address) {
            const detectedCity = data.address.city || 
                               data.address.town || 
                               data.address.municipality || 
                               data.address.village || 
                               data.address.county || 'Unknown'
            
            console.log(`   ✅ Nominatim detected: ${detectedCity}`)
            
            if (detectedCity.toLowerCase() !== poi.city.toLowerCase()) {
              console.log(`   🎯 NEEDS CORRECTION: ${poi.city} → ${detectedCity}`)
            } else {
              console.log(`   ✅ City is correct`)
            }
          } else {
            console.log(`   ⚠️ No address data returned`)
          }
        } else {
          console.log(`   ❌ Nominatim error: ${response.status}`)
        }
        
      } catch (error) {
        console.log(`   ❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
      
      console.log('') // Empty line
      
      // Small delay to respect rate limits
      if (i < pois.length - 1) {
        console.log('   ⏳ Waiting 2 seconds for rate limit...\n')
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
    }
    
    console.log('✅ Quick test completed!')
    console.log('\n💡 To activate GeoNames:')
    console.log('   1. Go to https://www.geonames.org/manageaccount')
    console.log('   2. Click "Click here to enable" under Free Web Services')
    console.log('   3. Then run the full correction system')

  } catch (error) {
    console.error('💥 Test failed:', error)
  }
}

quickTest()
