import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseKey)

export async function POST(request: NextRequest) {
  try {
    const { coordinates, poiId } = await request.json()
    
    if (!coordinates || !poiId) {
      return NextResponse.json({ error: 'Missing coordinates or poiId' }, { status: 400 })
    }

    console.log(`📊 [SUPABASE] Inserting coordinates for POI: ${poiId}`)

    // Transform coordinates to match database schema
    const transformedCoordinates = {
      poi_id: poiId,
      latitude: coordinates.latitude || coordinates.lat,
      longitude: coordinates.longitude || coordinates.lon,
      elevation_m: coordinates.elevation_m || null,
      distance_from_sao_paulo_km: coordinates.distance_from_sao_paulo_km || null,
      distance_from_rio_km: coordinates.distance_from_rio_km || null,
      boundary_geometry: coordinates.boundary_geometry || null,
      boundary_type: coordinates.boundary_type || 'point',
      boundary_source: coordinates.boundary_source || 'osm',
      boundary_confidence: coordinates.boundary_confidence || null,
      boundary_area_m2: coordinates.boundary_area_m2 || null,
      boundary_centroid_lat: coordinates.boundary_centroid_lat || null,
      boundary_centroid_lng: coordinates.boundary_centroid_lng || null,
      show_in_map: coordinates.show_in_map !== undefined ? coordinates.show_in_map : true
    }

    const { data, error } = await supabase
      .from('coordinates')
      .insert(transformedCoordinates)
      .select('id')

    if (error) {
      console.error('❌ [SUPABASE] Error inserting coordinates:', error)
      return NextResponse.json({ 
        success: false, 
        error: error.message 
      }, { status: 500 })
    }

    console.log(`✅ [SUPABASE] Coordinates inserted successfully:`, data)

    return NextResponse.json({
      success: true,
      data: data?.[0]
    })

  } catch (error) {
    console.error('❌ [SUPABASE] Error in coordinates API:', error)
    return NextResponse.json({ 
      success: false, 
      error: 'Internal server error' 
    }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const poiId = searchParams.get('poiId') ? parseInt(searchParams.get('poiId')!) : null
    const city = searchParams.get('city') || null
    const state = searchParams.get('state') || null
    const category = searchParams.get('category') || null
    const showInMap = searchParams.get('showInMap') === 'true' ? true : null
    const boundaryType = searchParams.get('boundaryType') || null

    const offset = (page - 1) * limit

    console.log(`📊 [SUPABASE] Fetching coordinates: page=${page}, limit=${limit}`)

    // Use the custom function for pagination
    const { data, error } = await supabase
      .rpc('get_coordinates_paginated', {
        page_limit: limit,
        page_offset: offset,
        poi_id_filter: poiId,
        city_filter: city,
        state_filter: state,
        category_filter: category,
        show_in_map_filter: showInMap,
        boundary_type_filter: boundaryType
      })

    if (error) {
      console.error('❌ [SUPABASE] Error fetching coordinates:', error)
      return NextResponse.json({ 
        success: false, 
        error: error.message 
      }, { status: 500 })
    }

    const totalCount = data?.[0]?.total_count || 0
    const totalPages = Math.ceil(totalCount / limit)

    console.log(`✅ [SUPABASE] Fetched ${data?.length || 0} coordinates (total: ${totalCount})`)

    return NextResponse.json({
      success: true,
      data: data || [],
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    })

  } catch (error) {
    console.error('❌ [SUPABASE] Error in coordinates GET API:', error)
    return NextResponse.json({ 
      success: false, 
      error: 'Internal server error' 
    }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { ids } = await request.json()
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'No coordinate IDs provided' }, { status: 400 })
    }

    console.log(`🗑️ [SUPABASE] Deleting ${ids.length} coordinates`)

    const { data, error } = await supabase
      .from('coordinates')
      .delete()
      .in('id', ids)
      .select('id')

    if (error) {
      console.error('❌ [SUPABASE] Error deleting coordinates:', error)
      return NextResponse.json({ 
        success: false, 
        error: error.message 
      }, { status: 500 })
    }

    console.log(`✅ [SUPABASE] Successfully deleted ${data?.length || 0} coordinates`)

    return NextResponse.json({
      success: true,
      deleted: data?.length || 0
    })

  } catch (error) {
    console.error('❌ [SUPABASE] Error in coordinates DELETE API:', error)
    return NextResponse.json({ 
      success: false, 
      error: 'Internal server error' 
    }, { status: 500 })
  }
}
