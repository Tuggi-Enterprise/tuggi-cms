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
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'ID is required' }, { status: 400 })

    const body = await request.json()
    const { name, country, state, city, owner_id, business_status, description, boundary } = body

    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

    // 1. Update Attraction
    const updatePayload: any = {
      name,
      city,
      state,
      country,
      business_status // Trigger Behavior stored here
    }

    if (owner_id !== undefined) updatePayload.owner_id = owner_id || null

    const { error: poiError } = await supabase
      .schema('core')
      .from('attractions')
      .update(updatePayload)
      .eq('id', id)

    if (poiError) {
      console.error(poiError)
      return NextResponse.json({ error: 'Failed to update Geofence' }, { status: 500 })
    }

    // 2. Update Coordinate/Boundary if provided
    if (boundary && boundary.length >= 3) {
      const lat = boundary.reduce((sum: number, p: any) => sum + p.lat, 0) / boundary.length
      const lng = boundary.reduce((sum: number, p: any) => sum + p.lng, 0) / boundary.length

      const geoJson = {
        type: 'Polygon',
        coordinates: [[
          ...boundary.map((p: any) => [p.lng, p.lat]),
          [boundary[0].lng, boundary[0].lat]
        ]]
      }

      await supabase
        .schema('core')
        .rpc('update_boundary_geometry', {
          p_attraction_id: id,
          p_geojson: JSON.stringify(geoJson),
          p_boundary_type: 'manual',
          p_boundary_source: 'manual_drawing',
          p_boundary_confidence: 1.0,
          p_boundary_area_m2: 0,
          p_boundary_centroid_lat: lat,
          p_boundary_centroid_lng: lng
        })
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
