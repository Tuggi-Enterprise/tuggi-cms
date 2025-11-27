import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/core/supabase-client'

/**
 * Complete test flow for POI creation and boundary saving
 * This endpoint simulates the full user flow:
 * 1. Create a test POI
 * 2. Save a boundary for that POI
 * 3. Verify the boundary was saved correctly
 */
export async function GET(request: NextRequest) {
  const supabase = getSupabase('service')
  const testResults: any[] = []

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

    testResults.push({ step: '1_init', message: 'Starting complete POI flow test', data: testPOI })

    // Step 1: Create POI
    console.log('📝 Step 1: Creating test POI...')
    testResults.push({ step: '1_create_poi', message: 'Creating test POI', data: testPOI })

    const createResponse = await fetch(`${request.nextUrl.origin}/api/pois/create-manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: testPOI.name,
        lat: testPOI.lat,
        lng: testPOI.lng
      })
    })

    if (!createResponse.ok) {
      const error = await createResponse.json()
      testResults.push({ step: '1_create_poi_error', error: error, status: createResponse.status })
      return NextResponse.json({ success: false, results: testResults }, { status: 500 })
    }

    const createResult = await createResponse.json()
    const attractionId = createResult.data?.id

    if (!attractionId) {
      testResults.push({ step: '1_create_poi_error', error: 'No attraction ID returned', data: createResult })
      return NextResponse.json({ success: false, results: testResults }, { status: 500 })
    }

    testResults.push({ 
      step: '1_create_poi_success', 
      message: 'POI created successfully', 
      attraction_id: attractionId,
      data: createResult.data 
    })

    console.log(`✅ POI created: ${attractionId}`)

    // Wait a bit to ensure POI is fully created
    await new Promise(resolve => setTimeout(resolve, 1000))

    // Step 2: Verify coordinate exists
    console.log('📊 Step 2: Verifying coordinate exists...')
    const { data: coord, error: coordError } = await supabase
      .schema('core')
      .from('attraction_coordinate')
      .select('id, attraction_id, latitude, longitude, boundary_geometry')
      .eq('attraction_id', attractionId)
      .single()

    if (coordError) {
      testResults.push({ step: '2_verify_coord_error', error: coordError })
      return NextResponse.json({ success: false, results: testResults }, { status: 500 })
    }

    testResults.push({ 
      step: '2_verify_coord_success', 
      message: 'Coordinate exists', 
      coordinate_id: coord.id,
      has_boundary: !!coord.boundary_geometry
    })

    // Step 3: Create test boundary polygon
    console.log('🗺️ Step 3: Creating test boundary polygon...')
    const boundaryCoordinates = [
      { lat: testPOI.lat - 0.001, lng: testPOI.lng - 0.001 },
      { lat: testPOI.lat - 0.001, lng: testPOI.lng + 0.001 },
      { lat: testPOI.lat + 0.001, lng: testPOI.lng + 0.001 },
      { lat: testPOI.lat + 0.001, lng: testPOI.lng - 0.001 },
      { lat: testPOI.lat - 0.001, lng: testPOI.lng - 0.001 } // Close polygon
    ]

    testResults.push({ 
      step: '3_create_boundary', 
      message: 'Creating boundary polygon', 
      points_count: boundaryCoordinates.length,
      coordinates: boundaryCoordinates
    })

    // Step 4: Save boundary
    console.log('💾 Step 4: Saving boundary...')
    const boundaryResponse = await fetch(`${request.nextUrl.origin}/api/pois/update-boundary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attractionId: attractionId,
        coordinates: boundaryCoordinates
      })
    })

    if (!boundaryResponse.ok) {
      const error = await boundaryResponse.json()
      testResults.push({ 
        step: '4_save_boundary_error', 
        error: error, 
        status: boundaryResponse.status,
        response_text: await boundaryResponse.text()
      })
      return NextResponse.json({ success: false, results: testResults }, { status: 500 })
    }

    const boundaryResult = await boundaryResponse.json()
    testResults.push({ 
      step: '4_save_boundary_success', 
      message: 'Boundary save API call successful', 
      data: boundaryResult 
    })

    console.log(`✅ Boundary save API call successful`)

    // Step 5: Verify boundary was actually saved
    console.log('🔍 Step 5: Verifying boundary was saved...')
    await new Promise(resolve => setTimeout(resolve, 500)) // Wait for DB to update

    const { data: updatedCoord, error: verifyError } = await supabase
      .schema('core')
      .from('attraction_coordinate')
      .select('id, boundary_type, boundary_source, boundary_confidence, boundary_area_m2, boundary_centroid_lat, boundary_centroid_lng, boundary_geometry')
      .eq('attraction_id', attractionId)
      .single()

    if (verifyError) {
      testResults.push({ step: '5_verify_error', error: verifyError })
      return NextResponse.json({ success: false, results: testResults }, { status: 500 })
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

    testResults.push({ 
      step: '5_verify_success', 
      message: 'Verification complete', 
      verification: verificationResult,
      raw_data: updatedCoord
    })

    // Step 6: Try to retrieve boundary geometry as GeoJSON
    console.log('📐 Step 6: Retrieving boundary geometry as GeoJSON...')
    const { data: geoJsonData, error: geoJsonError } = await supabase
      .schema('core')
      .rpc('get_boundary_geometry', {
        p_attraction_id: attractionId
      })

    if (geoJsonError) {
      testResults.push({ 
        step: '6_get_geojson_error', 
        error: geoJsonError,
        message: 'Could not retrieve GeoJSON (this is OK if RPC does not exist)'
      })
    } else {
      testResults.push({ 
        step: '6_get_geojson_success', 
        message: 'Retrieved boundary as GeoJSON', 
        geojson: geoJsonData 
      })
    }

    // Final summary
    const success = !!updatedCoord?.boundary_geometry && 
                    updatedCoord.boundary_type === 'polygon' &&
                    updatedCoord.boundary_source === 'manual'

    testResults.push({ 
      step: 'final_summary', 
      success: success,
      message: success ? '✅ All tests passed! Boundary was saved correctly.' : '❌ Boundary was not saved correctly.',
      attraction_id: attractionId,
      coordinate_id: coord.id
    })

    return NextResponse.json({
      success: success,
      results: testResults,
      summary: {
        attraction_id: attractionId,
        coordinate_id: coord.id,
        boundary_saved: success,
        verification: verificationResult
      }
    })

  } catch (error) {
    console.error('❌ Test error:', error)
    testResults.push({ 
      step: 'exception', 
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    })
    return NextResponse.json({ 
      success: false, 
      results: testResults,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

