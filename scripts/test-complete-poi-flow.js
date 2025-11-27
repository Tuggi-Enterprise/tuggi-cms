#!/usr/bin/env node

/**
 * Complete POI Flow Test Script
 * 
 * Tests the complete flow (simulating frontend):
 * 1. Create a test POI manually
 * 2. Save a boundary for that POI using HTTP endpoint (same as frontend)
 * 3. Verify the boundary was saved correctly
 * 
 * Usage: 
 *   1. Start Next.js dev server: npm run dev
 *   2. Run this script: node scripts/test-complete-poi-flow.js
 * 
 * Note: This script uses HTTP endpoint /api/pois/update-boundary (same as frontend)
 *       The endpoint requires authentication, so make sure you're logged in or
 *       the endpoint allows service role access.
 */

require('dotenv').config({ path: require('path').resolve(process.cwd(), '.env.local') })
require('dotenv').config({ path: require('path').resolve(process.cwd(), '.env') })

const { createClient } = require('@supabase/supabase-js')

// Get Supabase client
function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing required environment variables: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  }
  
  return createClient(supabaseUrl, supabaseKey, {
    auth: { 
      autoRefreshToken: false, 
      persistSession: false,
      detectSessionInUrl: false
    }
  })
}

// Calculate polygon area
function calculatePolygonArea(coordinates) {
  if (coordinates.length < 3) return 0

  let area = 0
  const n = coordinates.length
  
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const xi = coordinates[i].lng * Math.PI / 180
    const yi = coordinates[i].lat * Math.PI / 180
    const xj = coordinates[j].lng * Math.PI / 180
    const yj = coordinates[j].lat * Math.PI / 180
    area += xi * yj - xj * yi
  }
  
  area = Math.abs(area) / 2
  const R = 6371000 // Earth's radius in meters
  return Math.round(area * R * R)
}

// Calculate polygon center
function calculatePolygonCenter(coordinates) {
  if (coordinates.length === 0) return { lat: 0, lng: 0 }

  let totalLat = 0
  let totalLng = 0
  
  for (const coord of coordinates) {
    totalLat += coord.lat
    totalLng += coord.lng
  }
  
  return {
    lat: totalLat / coordinates.length,
    lng: totalLng / coordinates.length
  }
}

// Convert coordinates to GeoJSON
function coordinatesToGeoJSON(coordinates) {
  const coords = [...coordinates]
  if (coords.length > 0) {
    const first = coords[0]
    const last = coords[coords.length - 1]
    if (first.lat !== last.lat || first.lng !== last.lng) {
      coords.push(first)
    }
  }

  const geoJsonCoords = coords.map(coord => [coord.lng, coord.lat])
  
  const geoJson = {
    type: 'Polygon',
    coordinates: [geoJsonCoords]
  }

  return JSON.stringify(geoJson)
}

async function testCompletePOIFlow() {
  const supabase = getSupabaseClient()
  const testResults = []

  try {
    // Test POI data
    const testPOI = {
      name: `Test POI ${Date.now()}`,
      lat: -22.9619985344045,
      lng: -46.5392549910778,
      city: 'Bragança Paulista',
      state: 'SP',
      country: 'Brazil'
    }

    console.log('🧪 Starting complete POI flow test\n')
    console.log('📝 Test POI:', testPOI)
    testResults.push({ step: '1_init', message: 'Starting test', data: testPOI })

    // Step 1: Create POI directly in database
    console.log('\n📝 Step 1: Creating test POI in database...')
    
    const { data: attraction, error: createError } = await supabase
      .schema('core')
      .from('attractions')
      .insert({
        name: testPOI.name,
        city: testPOI.city,
        state: testPOI.state,
        country: testPOI.country,
        import_source: 'manual',
        source_type: 'manual',
        approved: false
      })
      .select()
      .single()

    if (createError || !attraction) {
      console.error('❌ Error creating POI:', createError)
      testResults.push({ step: '1_create_poi_error', error: createError })
      return { success: false, results: testResults }
    }

    const attractionId = attraction.id
    console.log(`✅ POI created: ${attractionId}`)
    testResults.push({ 
      step: '1_create_poi_success', 
      message: 'POI created', 
      attraction_id: attractionId 
    })

    // Step 2: Create coordinate
    console.log('\n📍 Step 2: Creating coordinate...')
    
    const { data: coordinate, error: coordError } = await supabase
      .schema('core')
      .rpc('insert_coordinate_safe', {
        p_attraction_id: attractionId,
        p_latitude: testPOI.lat,
        p_longitude: testPOI.lng
      })

    if (coordError) {
      console.error('❌ Error creating coordinate:', coordError)
      testResults.push({ step: '2_create_coord_error', error: coordError })
      return { success: false, results: testResults }
    }

    console.log(`✅ Coordinate created`)
    testResults.push({ 
      step: '2_create_coord_success', 
      message: 'Coordinate created',
      coordinate_id: coordinate
    })

    // Step 3: Verify coordinate exists
    console.log('\n🔍 Step 3: Verifying coordinate exists...')
    const { data: coord, error: verifyCoordError } = await supabase
      .schema('core')
      .from('attraction_coordinate')
      .select('id, attraction_id, latitude, longitude, boundary_geometry')
      .eq('attraction_id', attractionId)
      .single()

    if (verifyCoordError || !coord) {
      console.error('❌ Error verifying coordinate:', verifyCoordError)
      testResults.push({ step: '3_verify_coord_error', error: verifyCoordError })
      return { success: false, results: testResults }
    }

    console.log(`✅ Coordinate verified: ${coord.id}`)
    console.log(`   Boundary geometry: ${coord.boundary_geometry ? 'EXISTS' : 'NULL'}`)
    testResults.push({ 
      step: '3_verify_coord_success', 
      message: 'Coordinate verified',
      coordinate_id: coord.id,
      has_boundary: !!coord.boundary_geometry
    })

    // Step 4: Create test boundary polygon
    console.log('\n🗺️ Step 4: Creating test boundary polygon...')
    const boundaryCoordinates = [
      { lat: testPOI.lat - 0.001, lng: testPOI.lng - 0.001 },
      { lat: testPOI.lat - 0.001, lng: testPOI.lng + 0.001 },
      { lat: testPOI.lat + 0.001, lng: testPOI.lng + 0.001 },
      { lat: testPOI.lat + 0.001, lng: testPOI.lng - 0.001 },
      { lat: testPOI.lat - 0.001, lng: testPOI.lng - 0.001 } // Close polygon
    ]

    const geoJsonString = coordinatesToGeoJSON(boundaryCoordinates)
    const area = calculatePolygonArea(boundaryCoordinates)
    const centroid = calculatePolygonCenter(boundaryCoordinates)

    console.log(`   Points: ${boundaryCoordinates.length}`)
    console.log(`   Area: ${area} m²`)
    console.log(`   Centroid: (${centroid.lat}, ${centroid.lng})`)
    console.log(`   GeoJSON: ${geoJsonString.substring(0, 100)}...`)

    testResults.push({ 
      step: '4_create_boundary', 
      message: 'Boundary polygon created',
      points_count: boundaryCoordinates.length,
      area: area,
      centroid: centroid
    })

    // Step 5: Save boundary using HTTP endpoint (same as frontend)
    console.log('\n💾 Step 5: Saving boundary using HTTP endpoint (simulating frontend)...')
    
    const apiBaseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_VERCEL_URL || 'http://localhost:3000'
    console.log(`   Using API base URL: ${apiBaseUrl}`)
    console.log(`   Sending coordinates: ${boundaryCoordinates.length} points`)
    console.log(`   Coordinates sample:`, boundaryCoordinates.slice(0, 3))
    
    const requestBody = {
      attractionId: attractionId,
      coordinates: boundaryCoordinates
    }
    
    console.log(`   Request body:`, JSON.stringify(requestBody, null, 2))
    
    // Use service role key for authentication (same as frontend would use cookies)
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for testing')
    }
    
    const boundaryResponse = await fetch(`${apiBaseUrl}/api/pois/update-boundary`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-service-role-key': serviceRoleKey // For testing - frontend uses cookies
      },
      body: JSON.stringify(requestBody)
    })

    console.log(`   Response status: ${boundaryResponse.status} ${boundaryResponse.statusText}`)

    if (!boundaryResponse.ok) {
      const errorText = await boundaryResponse.text()
      console.error('❌ HTTP Error:', {
        status: boundaryResponse.status,
        statusText: boundaryResponse.statusText,
        body: errorText
      })
      let error
      try {
        error = JSON.parse(errorText)
      } catch {
        error = { error: errorText }
      }
      testResults.push({ 
        step: '5_save_boundary_http_error', 
        error: error,
        status: boundaryResponse.status,
        statusText: boundaryResponse.statusText
      })
      return { success: false, results: testResults }
    }

    const boundaryResult = await boundaryResponse.json()
    console.log(`✅ HTTP endpoint call successful`)
    console.log(`   Response:`, JSON.stringify(boundaryResult, null, 2))
    testResults.push({ 
      step: '5_save_boundary_http_success', 
      message: 'HTTP endpoint call successful',
      response: boundaryResult
    })

    // Step 6: Verify boundary was saved
    console.log('\n🔍 Step 6: Verifying boundary was saved...')
    await new Promise(resolve => setTimeout(resolve, 500)) // Wait for DB

    const { data: updatedCoord, error: verifyError } = await supabase
      .schema('core')
      .from('attraction_coordinate')
      .select('id, boundary_type, boundary_source, boundary_confidence, boundary_area_m2, boundary_centroid_lat, boundary_centroid_lng, boundary_geometry')
      .eq('attraction_id', attractionId)
      .single()

    if (verifyError) {
      console.error('❌ Error verifying boundary:', verifyError)
      testResults.push({ step: '6_verify_error', error: verifyError })
      return { success: false, results: testResults }
    }

    const verificationResult = {
      boundary_type: updatedCoord?.boundary_type,
      boundary_source: updatedCoord?.boundary_source,
      boundary_confidence: updatedCoord?.boundary_confidence,
      boundary_area_m2: updatedCoord?.boundary_area_m2,
      boundary_centroid_lat: updatedCoord?.boundary_centroid_lat,
      boundary_centroid_lng: updatedCoord?.boundary_centroid_lng,
      has_boundary_geometry: !!updatedCoord?.boundary_geometry
    }

    console.log('📊 Verification result:')
    console.log(JSON.stringify(verificationResult, null, 2))

    testResults.push({ 
      step: '6_verify_success', 
      message: 'Verification complete',
      verification: verificationResult
    })

    // Step 7: Try to retrieve boundary as GeoJSON
    console.log('\n📐 Step 7: Retrieving boundary as GeoJSON...')
    const { data: geoJsonData, error: geoJsonError } = await supabase
      .schema('core')
      .rpc('get_boundary_geometry', {
        p_attraction_id: attractionId
      })

    if (geoJsonError) {
      console.log('⚠️ Could not retrieve GeoJSON (RPC may not exist):', geoJsonError.message)
      testResults.push({ 
        step: '7_get_geojson_error', 
        error: geoJsonError.message,
        message: 'Could not retrieve GeoJSON (this is OK if RPC does not exist)'
      })
    } else {
      console.log('✅ GeoJSON retrieved:', geoJsonData)
      testResults.push({ 
        step: '7_get_geojson_success', 
        message: 'Retrieved boundary as GeoJSON',
        geojson: geoJsonData 
      })
    }

    // Final summary
    const success = !!updatedCoord?.boundary_geometry && 
                    updatedCoord.boundary_type === 'polygon' &&
                    updatedCoord.boundary_source === 'manual'

    console.log('\n' + '='.repeat(60))
    if (success) {
      console.log('✅ TEST PASSED: Boundary was saved correctly!')
    } else {
      console.log('❌ TEST FAILED: Boundary was not saved correctly')
      console.log('   Expected: boundary_geometry NOT NULL, boundary_type=polygon, boundary_source=manual')
      console.log('   Actual:', verificationResult)
    }
    console.log('='.repeat(60))

    testResults.push({ 
      step: 'final_summary', 
      success: success,
      message: success ? '✅ All tests passed!' : '❌ Boundary was not saved correctly',
      attraction_id: attractionId,
      coordinate_id: coord.id,
      verification: verificationResult
    })

    return {
      success: success,
      results: testResults,
      summary: {
        attraction_id: attractionId,
        coordinate_id: coord.id,
        boundary_saved: success,
        verification: verificationResult
      }
    }

  } catch (error) {
    console.error('\n❌ Test exception:', error)
    testResults.push({ 
      step: 'exception', 
      error: error.message,
      stack: error.stack
    })
    return { success: false, results: testResults, error: error.message }
  }
}

// Run the test
if (require.main === module) {
  testCompletePOIFlow()
    .then(result => {
      if (result.success) {
        console.log('\n✅ Test completed successfully!')
        process.exit(0)
      } else {
        console.log('\n❌ Test failed!')
        console.log('\nFull results:')
        console.log(JSON.stringify(result.results, null, 2))
        process.exit(1)
      }
    })
    .catch(error => {
      console.error('\n❌ Fatal error:', error)
      process.exit(1)
    })
}

module.exports = { testCompletePOIFlow }

