import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { getSupabase } from '@/lib/core/supabase-client'

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
    const { name, country, state, city, owner_id, category, business_status, description, boundary } = body

    if (!name || !boundary || boundary.length < 3) {
      return NextResponse.json({ error: 'Name and a valid polygonal boundary (at least 3 points) are required.' }, { status: 400 })
    }

    // 1. Calculate centroid from boundary
    const lat = boundary.reduce((sum: number, p: any) => sum + p.lat, 0) / boundary.length
    const lng = boundary.reduce((sum: number, p: any) => sum + p.lng, 0) / boundary.length

    // 2. Create Attraction
    const insertPayload: any = {
      name,
      city,
      state,
      country,
      category: 'geofence',
      business_status, // Storing 'ENTER_ONLY', 'INSIDE_ONLY', 'BOTH' here
      approved: true // Auto-approved for geofences usually
    }

    // Assign owner_id if given (only matters if valid)
    if (owner_id) insertPayload.owner_id = owner_id

    const { data: poi, error: poiError } = await supabase
      .schema('core')
      .from('attractions')
      .insert(insertPayload)
      .select('id')
      .single()

    if (poiError || !poi) {
      console.error(poiError)
      return NextResponse.json({ error: 'Failed to create Geofence POI' }, { status: 500 })
    }

    const attractionId = poi.id

    // 3. Save Coordinates & Boundary
    const geoJson = {
      type: 'Polygon',
      coordinates: [[
        ...boundary.map((p: any) => [p.lng, p.lat]),
        [boundary[0].lng, boundary[0].lat]
      ]]
    }

    const { error: boundaryError } = await supabase
      .schema('core')
      .rpc('update_boundary_geometry', {
        p_attraction_id: attractionId,
        p_geojson: JSON.stringify(geoJson),
        p_boundary_type: 'manual',
        p_boundary_source: 'manual_drawing',
        p_boundary_confidence: 1.0,
        p_boundary_area_m2: 0,
        p_boundary_centroid_lat: lat,
        p_boundary_centroid_lng: lng
      })

    if (boundaryError) console.error('Error saving boundary:', boundaryError.message)

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
