import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { getSupabase } from '@/lib/core/supabase-client'
import { calculatePolygonArea, calculatePolygonCenter } from '@/lib/utils/geometry'

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const supabaseAuth = createRouteHandlerClient({ cookies: () => cookieStore as any })
    const { data: { session }, error: authError } = await supabaseAuth.auth.getSession()
    
    if (authError || !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = getSupabase('service')
    const body = await request.json()
    console.log('📥 [GEOFENCE CREATE] Received Body:', JSON.stringify(body, null, 2))
    const { name, country, state, city, owner_id, business_status, description, boundary } = body

    if (!name || !boundary || boundary.length < 3) {
      console.warn('⚠️ [GEOFENCE CREATE] Validation failed: name or boundary missing/invalid')
      return NextResponse.json({ error: 'Name and a valid polygonal boundary (at least 3 points) are required.' }, { status: 400 })
    }

    if (!owner_id) {
       return NextResponse.json({ error: 'Owner ID (Client) is required.' }, { status: 400 })
    }

    // 1. Get CMS User ID
    const { data: cmsUser, error: cmsError } = await supabase
      .schema('core')
      .from('cms_users')
      .select('id')
      .eq('email', session.user.email)
      .single()

    if (cmsError || !cmsUser) {
      return NextResponse.json({ error: 'CMS User not found' }, { status: 403 })
    }

    // 2. Calculate centroid and area from boundary
    const { lat, lng } = calculatePolygonCenter(boundary)
    const area = calculatePolygonArea(boundary)

    // 3. Create Attraction
    const insertPayload: any = {
      name,
      city,
      state,
      country,
      category: 'geofence',
      primary_category: 'geofence',
      business_status, // Trigger Behavior ('ENTER_ONLY', 'INSIDE_ONLY', 'BOTH')
      approved: true,
      owner_id,
      created_by: cmsUser.id,
      is_active: true,
      import_source: 'manual',
      source_type: 'manual',
      is_complete: true,
      boundary_source: 'manual_drawing',
      boundary_confidence: 1.0,
      boundary_area_m2: area,
      show_in_map: true
    }
    console.log('🔄 [GEOFENCE CREATE] Inserting attraction with payload:', JSON.stringify(insertPayload, null, 2))

    const { data: poi, error: poiError } = await supabase
      .schema('core')
      .from('attractions')
      .insert(insertPayload)
      .select('id')
      .single()

    if (poiError || !poi) {
      console.error('❌ [GEOFENCE CREATE] Error creating attraction:', poiError.message, poiError)
      return NextResponse.json({ error: 'Failed to create Geofence POI' }, { status: 500 })
    }

    const attractionId = poi.id
    console.log('✅ [GEOFENCE CREATE] Attraction created successfully:', attractionId)

    // 3. Save Coordinates & Boundary
    const geoJsonString = JSON.stringify({
      type: 'Polygon',
      coordinates: [[
        ...boundary.map((p: any) => [p.lng, p.lat]),
        [boundary[0].lng, boundary[0].lat]
      ]]
    })

    const rpcParams = {
      p_attraction_id: attractionId,
      p_latitude: lat,
      p_longitude: lng,
      p_boundary_geometry_geojson: geoJsonString,
      p_boundary_type: 'polygon',
      p_boundary_source: 'manual_drawing',
      p_boundary_confidence: 1.0,
      p_boundary_area_m2: area,
      p_boundary_centroid_lat: lat,
      p_boundary_centroid_lng: lng,
      p_show_in_map: true
    }

    const { error: rpcError } = await supabase
      .schema('core')
      .rpc('insert_coordinate_safe', rpcParams)

    if (rpcError) {
      console.error('❌ [GEOFENCE CREATE] Error saving boundary:', rpcError.message)
    }

    // 4. Save Description/Message
    if (description) {
      await supabase
        .schema('core')
        .from('attraction_descriptions')
        .insert({
          attraction_id: attractionId,
          language: 'pt-br',
          description: description,
          is_original: true
        })
    }

    return NextResponse.json({ success: true, data: { id: attractionId } })

  } catch (error: any) {
    console.error('CRITICAL GEOFENCE CREATE ERROR', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
