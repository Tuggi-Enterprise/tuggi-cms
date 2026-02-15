import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseService } from '@/lib/core/supabase-client'

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseService()
    const { coordinates, poiUuidId } = await request.json()
    
    console.log(`📊 [SUPABASE] Received coordinates data:`, { coordinates, poiUuidId })
    
    if (!coordinates || !poiUuidId) {
      console.error('❌ [SUPABASE] Missing coordinates or poiUuidId:', { coordinates, poiUuidId })
      return NextResponse.json({ error: 'Missing coordinates or poiUuidId' }, { status: 400 })
    }

    console.log(`📊 [SUPABASE] Inserting coordinates for POI UUID: ${poiUuidId}`)

    // Generate boundary_geometry as GeoJSON if not provided
    const lat = coordinates.latitude || coordinates.lat
    const lon = coordinates.longitude || coordinates.lon
    const boundaryGeometryGeoJSON = coordinates.boundary_geometry || (lat && lon ? 
      JSON.stringify({
        type: "Point",
        coordinates: [lon, lat]
      }) : null
    )

    // Transform coordinates to match database schema
    // Note: boundary_geometry will be converted to GEOGRAPHY by PostGIS
    const transformedCoordinates: any = {
      poi_uuid_id: poiUuidId, // UUID reference
      latitude: lat,
      longitude: lon,
      elevation_m: coordinates.elevation_m || null,
      distance_from_sao_paulo_km: coordinates.distance_from_sao_paulo_km || null,
      distance_from_rio_km: coordinates.distance_from_rio_km || null,
      boundary_type: coordinates.boundary_type || 'point',
      boundary_source: coordinates.boundary_source || 'osm',
      boundary_confidence: coordinates.boundary_confidence || null,
      boundary_area_m2: coordinates.boundary_area_m2 || null,
      boundary_centroid_lat: coordinates.boundary_centroid_lat || null,
      boundary_centroid_lng: coordinates.boundary_centroid_lng || null,
      show_in_map: coordinates.show_in_map !== undefined ? coordinates.show_in_map : true
    }

    // Convert GeoJSON string to PostGIS GEOGRAPHY
    // Use RPC call to convert GeoJSON to GEOGRAPHY, or let PostGIS handle it
    if (boundaryGeometryGeoJSON) {
      // PostGIS will automatically convert GeoJSON string to GEOGRAPHY
      // We'll use ST_GeomFromGeoJSON in a raw SQL call if needed
      transformedCoordinates.boundary_geometry = boundaryGeometryGeoJSON
    }

    console.log(`📊 [SUPABASE] Transformed coordinates:`, transformedCoordinates)

    // Use upsert to handle UNIQUE constraint on poi_uuid_id
    // If coordinate already exists, update it; otherwise insert new
    // Generate UUID for id if not provided
    if (!transformedCoordinates.id) {
      transformedCoordinates.id = crypto.randomUUID()
    }

    // Convert boundary_geometry GeoJSON to PostGIS GEOGRAPHY using RPC or raw SQL
    // Since Supabase client doesn't directly support GEOGRAPHY conversion,
    // we'll use a raw SQL query through RPC
    const { data, error } = await supabase
      .schema('homolog')
      .rpc('upsert_coordinate', {
        p_poi_uuid_id: transformedCoordinates.poi_uuid_id,
        p_latitude: transformedCoordinates.latitude,
        p_longitude: transformedCoordinates.longitude,
        p_id: transformedCoordinates.id,
        p_elevation_m: transformedCoordinates.elevation_m,
        p_distance_from_sao_paulo_km: transformedCoordinates.distance_from_sao_paulo_km,
        p_distance_from_rio_km: transformedCoordinates.distance_from_rio_km,
        p_boundary_geometry_geojson: transformedCoordinates.boundary_geometry,
        p_boundary_type: transformedCoordinates.boundary_type,
        p_boundary_source: transformedCoordinates.boundary_source,
        p_boundary_confidence: transformedCoordinates.boundary_confidence,
        p_boundary_area_m2: transformedCoordinates.boundary_area_m2,
        p_boundary_centroid_lat: transformedCoordinates.boundary_centroid_lat,
        p_boundary_centroid_lng: transformedCoordinates.boundary_centroid_lng,
        p_show_in_map: transformedCoordinates.show_in_map
      })

    if (error) {
      console.error('❌ [SUPABASE] Error upserting coordinates:', error)
      console.error('❌ [SUPABASE] Error details:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      })
      return NextResponse.json({ 
        success: false, 
        error: error.message 
      }, { status: 500 })
    }

    console.log(`✅ [SUPABASE] Coordinates upserted successfully:`, data)

    return NextResponse.json({
      success: true,
      data: data?.[0] || data
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
    const supabase = getSupabaseService()
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const poiUuid = searchParams.get('poiUuid') || null
    const city = searchParams.get('city') || null
    const state = searchParams.get('state') || null
    const category = searchParams.get('category') || null
    const showInMap = searchParams.get('showInMap') === 'true' ? true : null
    const boundaryType = searchParams.get('boundaryType') || null

    const offset = (page - 1) * limit

    console.log(`📊 [SUPABASE] Fetching coordinates: page=${page}, limit=${limit}, poiUuid=${poiUuid}`)

    // Use RPC function to properly convert GEOGRAPHY to GeoJSON
    const { data, error } = await supabase
      .schema('homolog')
      .rpc('get_coordinates_paginated', {
        poi_uuid_filter: poiUuid || null,
        page_limit: limit,
        page_offset: offset
      })

    if (error) {
      console.error('❌ [SUPABASE] Error fetching coordinates:', error)
      console.error('❌ [SUPABASE] Error details:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      })
      return NextResponse.json({ 
        success: false, 
        error: error.message 
      }, { status: 500 })
    }

    const totalCount = data?.[0]?.total_count || 0
    const coordinates = data?.map((row: any) => {
      const { total_count, ...coordinate } = row
      return coordinate
    }) || []

    const totalPages = Math.ceil(totalCount / limit)

    console.log(`✅ [SUPABASE] Fetched ${coordinates.length} coordinates (total: ${totalCount})`)

    return NextResponse.json({
      success: true,
      data: coordinates,
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
    const supabase = getSupabaseService()
    const { ids } = await request.json()
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'No coordinate IDs provided' }, { status: 400 })
    }

    console.log(`🗑️ [SUPABASE] Deleting ${ids.length} coordinates`)

    const { data, error } = await supabase
      .schema('homolog')
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
