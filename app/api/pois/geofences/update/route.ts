import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseRouteHandler } from '@/lib/core/supabase-client'
import { cookies } from 'next/headers'
import { getSupabase } from '@/lib/core/supabase-client'
import { calculatePolygonArea, calculatePolygonCenter } from '@/lib/utils/geometry'

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const supabaseAuth = getSupabaseRouteHandler(cookieStore)
    const { data: { session }, error: authError } = await supabaseAuth.auth.getSession()
    
    if (authError || !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = getSupabase('service')
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'ID is required' }, { status: 400 })

    const body = await request.json()
    console.log(`📥 [GEOFENCE UPDATE] ID: ${id}, Body:`, JSON.stringify(body, null, 2))
    const { name, country, state, city, owner_id, business_status, description, boundary } = body

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    // 1. Get CMS User ID (Single Source of Truth for created_by)
    const { data: cmsUser, error: cmsError } = await supabase
      .schema('core')
      .from('cms_users')
      .select('id')
      .eq('email', session.user.email)
      .single()

    if (cmsError || !cmsUser) {
      console.error('❌ [GEOFENCE UPDATE] CMS User not found:', cmsError)
      return NextResponse.json({ error: 'CMS User not found' }, { status: 403 })
    }

    // 2. Prepare Attraction Update
    const updatePayload: any = {
      name,
      city,
      state,
      country,
      business_status, // Trigger Behavior
      updated_at: new Date().toISOString(),
      owner_id: owner_id || null, // Directly assign owner_id
      created_by: cmsUser.id // Always ensure created_by is set
    }

    let boundaryData: any = null
    if (boundary && boundary.length >= 3) {
      const { lat, lng } = calculatePolygonCenter(boundary)
      const area = calculatePolygonArea(boundary)
      
      updatePayload.boundary_area_m2 = area
      updatePayload.boundary_source = 'manual_drawing'
      updatePayload.boundary_confidence = 1.0

      boundaryData = { lat, lng, area }
    }

    console.log('🔄 [GEOFENCE UPDATE] Updating attraction with payload:', JSON.stringify(updatePayload, null, 2))
    const { error: poiError } = await supabase
      .schema('core')
      .from('attractions')
      .update(updatePayload)
      .eq('id', id)

    if (poiError) {
      console.error('❌ [GEOFENCE UPDATE] Error updating attraction:', poiError.message, poiError)
      return NextResponse.json({ error: 'Failed to update Geofence' }, { status: 500 })
    }
    console.log('✅ [GEOFENCE UPDATE] Attraction updated successfully.')

    // 2. Update Coordinate/Boundary if provided
    if (boundaryData && boundary) {
      const { lat, lng, area } = boundaryData

      const geoJsonString = JSON.stringify({
        type: 'Polygon',
        coordinates: [[
          ...boundary.map((p: any) => [p.lng, p.lat]),
          [boundary[0].lng, boundary[0].lat]
        ]]
      })

      const rpcParams = {
        p_attraction_id: id,
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
        console.error('❌ [GEOFENCE UPDATE] Error saving boundary via RPC:', rpcError.message, rpcError)
      } else {
        console.log('✅ [GEOFENCE UPDATE] insert_coordinate_safe successful')
      }
    }

    // 3. Update Description
    if (description !== undefined) {
      // Upsert description
      const { data: currentDesc } = await supabase
        .schema('core')
        .from('attraction_descriptions')
        .select('id')
        .eq('attraction_id', id)
        .eq('language', 'pt-br')
        .maybeSingle()

      if (currentDesc) {
        await supabase
          .schema('core')
          .from('attraction_descriptions')
          .update({ description })
          .eq('id', currentDesc.id)
      } else if (description.trim() !== '') {
        await supabase
          .schema('core')
          .from('attraction_descriptions')
          .insert({
            attraction_id: id,
            language: 'pt-br',
            description,
            is_original: true
          })
      }
    }

    return NextResponse.json({ success: true, data: { id } })

  } catch (error: any) {
    console.error('CRITICAL GEOFENCE UPDATE ERROR', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
