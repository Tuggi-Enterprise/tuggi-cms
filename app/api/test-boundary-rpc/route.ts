import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/core/supabase-client'

// Test endpoint to diagnose RPC function issues
export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabase('service')
    const { searchParams } = new URL(request.url)
    const attractionId = searchParams.get('attractionId')

    if (!attractionId) {
      return NextResponse.json(
        { error: 'attractionId query parameter is required' },
        { status: 400 }
      )
    }

    console.log(`🔍 Testing RPC function for attraction: ${attractionId}`)

    // Test 1: Check if coordinate exists
    console.log('📊 Test 1: Checking if coordinate exists...')
    const { data: coord, error: coordError } = await supabase
      .schema('core')
      .from('attraction_coordinate')
      .select('id, attraction_id, latitude, longitude')
      .eq('attraction_id', attractionId)
      .single()

    if (coordError) {
      return NextResponse.json({
        test: 'coordinate_check',
        success: false,
        error: coordError.message,
        code: coordError.code
      })
    }

    console.log('✅ Coordinate found:', coord)

    // Test 2: Check if RPC function exists by trying to call it with NULL
    console.log('📊 Test 2: Checking if RPC function exists...')
    const testGeoJSON = JSON.stringify({
      type: 'Polygon',
      coordinates: [[[-46.539, -22.962], [-46.540, -22.962], [-46.540, -22.963], [-46.539, -22.963], [-46.539, -22.962]]]
    })

    const { data: rpcData, error: rpcError } = await supabase
      .schema('core')
      .rpc('update_boundary_geometry', {
        p_attraction_id: attractionId,
        p_geojson: testGeoJSON,
        p_boundary_type: 'polygon',
        p_boundary_source: 'test',
        p_boundary_confidence: 1.0,
        p_boundary_area_m2: 1000,
        p_boundary_centroid_lat: -22.962,
        p_boundary_centroid_lng: -46.539
      })

    if (rpcError) {
      console.error('❌ RPC Error:', rpcError)
      return NextResponse.json({
        test: 'rpc_call',
        success: false,
        error: rpcError.message,
        code: rpcError.code,
        details: rpcError.details,
        hint: rpcError.hint,
        coordinate_exists: !!coord
      })
    }

    console.log('✅ RPC call successful:', rpcData)

    // Test 3: Verify the update
    const { data: updatedCoord, error: verifyError } = await supabase
      .schema('core')
      .from('attraction_coordinate')
      .select('boundary_type, boundary_source, boundary_area_m2, boundary_geometry')
      .eq('attraction_id', attractionId)
      .single()

    return NextResponse.json({
      test: 'complete',
      success: true,
      coordinate_id: coord.id,
      rpc_result: rpcData,
      updated_coordinate: {
        boundary_type: updatedCoord?.boundary_type,
        boundary_source: updatedCoord?.boundary_source,
        boundary_area_m2: updatedCoord?.boundary_area_m2,
        has_geometry: !!updatedCoord?.boundary_geometry
      }
    })

  } catch (error) {
    console.error('❌ Test error:', error)
    return NextResponse.json(
      {
        test: 'exception',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      },
      { status: 500 }
    )
  }
}

