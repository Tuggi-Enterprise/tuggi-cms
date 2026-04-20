import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseRouteHandler } from '@/lib/core/supabase-client'
import { cookies } from 'next/headers'
import { invalidatePOICache } from '@/lib/cache/poi-cache-invalidator'
import { logAuditEvent } from '@/lib/services/audit-service'

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const supabase = getSupabaseRouteHandler(cookieStore)
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { data: cmsUser } = await supabase
      .schema('core')
      .from('cms_users')
      .select('id, email')
      .eq('email', user.email as string)
      .maybeSingle()

    const body = await request.json()
    const { attractionId, latitude, longitude } = body

    if (!attractionId || latitude === undefined || longitude === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: attractionId, latitude, longitude' },
        { status: 400 }
      )
    }

    // Validate coordinates
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return NextResponse.json(
        { error: 'Invalid coordinates' },
        { status: 400 }
      )
    }

    console.log(`🗺️ Updating POI coordinates: ${attractionId} -> ${latitude}, ${longitude}`)

    // First, check if the attraction exists
    const { data: attraction, error: attractionError } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name')
      .eq('id', attractionId)
      .single()

    if (attractionError || !attraction) {
      return NextResponse.json(
        { error: 'Attraction not found' },
        { status: 404 }
      )
    }

    // Check if coordinates already exist for this attraction
    const { data: existingCoords, error: coordsCheckError } = await supabase
      .schema('core')
      .from('attraction_coordinate')
      .select('id')
      .eq('attraction_id', attractionId)
      .single()

    if (coordsCheckError && coordsCheckError.code !== 'PGRST116') {
      // PGRST116 is "not found" error, which is expected if no coordinates exist
      console.error('Error checking existing coordinates:', coordsCheckError)
      return NextResponse.json(
        { error: 'Failed to check existing coordinates' },
        { status: 500 }
      )
    }

    let result
    if (existingCoords) {
      // Update existing coordinates
      const { data, error } = await supabase
        .schema('core')
        .from('attraction_coordinate')
        .update({
          latitude,
          longitude,
          updated_at: new Date().toISOString()
        })
        .eq('attraction_id', attractionId)
        .select()
        .single()

      if (error) {
        console.error('Error updating coordinates:', error)
        return NextResponse.json(
          { error: 'Failed to update coordinates' },
          { status: 500 }
        )
      }

      result = data
    } else {
      // Insert new coordinates
      const { data, error } = await supabase
        .schema('core')
        .from('attraction_coordinate')
        .insert({
          attraction_id: attractionId,
          latitude,
          longitude
        })
        .select()
        .single()

      if (error) {
        console.error('Error inserting coordinates:', error)
        return NextResponse.json(
          { error: 'Failed to insert coordinates' },
          { status: 500 }
        )
      }

      result = data
    }

    console.log(`✅ Successfully updated coordinates for POI: ${attraction.name}`)

    await logAuditEvent({
      request,
      action: 'UPDATE_POI',
      entity: 'POI',
      entityId: attractionId,
      userId: cmsUser?.id ?? user.id,
      userEmail: user.email || null,
      description: 'Updated POI coordinates'
    })

    // Invalidar cache de POIs após atualização de coordenadas
    invalidatePOICache('POI coordinates updated')

    return NextResponse.json({
      success: true,
      data: {
        attraction_id: attractionId,
        latitude,
        longitude,
        updated_at: result.updated_at
      }
    })

  } catch (error) {
    console.error('❌ Error updating POI coordinates:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
