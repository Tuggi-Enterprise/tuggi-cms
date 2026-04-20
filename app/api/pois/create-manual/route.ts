import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseRouteHandler } from '@/lib/core/supabase-client'
import { cookies } from 'next/headers'
import { getSupabase } from '@/lib/core/supabase-client'
import { ReverseGeocodingService } from '@/lib/services/reverse-geocoding.service'
import { POICreationService } from '@/lib/services/poi-creation.service'
import { logAuditEvent } from '@/lib/services/audit-service'

// Use service role client to bypass RLS for fetching created POI
const supabase = getSupabase('service')

export async function POST(request: NextRequest) {
  try {
    // Authentication & role check - allow admin and client
    const cookieStore = await cookies()
    const supabaseAuth = getSupabaseRouteHandler(cookieStore)
    const { data: { session }, error: authError } = await supabaseAuth.auth.getSession()
    if (authError || !session) {
      return NextResponse.json({ error: 'Unauthorized - Authentication required' }, { status: 401 })
    }
    // Check cms user entry and active status
    const { data: cmsUser, error: cmsError } = await supabaseAuth
      .schema('core')
      .from('cms_users')
      .select('id, role, is_active')
      .eq('email', session.user.email as string)
      .eq('is_active', true)
      .single()
    if (cmsError || !cmsUser) {
      return NextResponse.json({ error: 'Unauthorized - CMS access denied' }, { status: 403 })
    }
    if (!['admin', 'client', 'editor'].includes(cmsUser.role)) {
      return NextResponse.json({ error: 'Unauthorized - Insufficient privileges' }, { status: 403 })
    }
    const body = await request.json()
    const { name, lat, lng, boundary, category, primary_category, owner_id, business_status } = body

    console.log('📍 [create-manual] Received request:', {
      name,
      lat,
      lng,
      category,
      primary_category,
      hasBoundary: !!boundary,
      owner_id
    })

    // Validate required fields
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { error: 'Missing or invalid required field: name' },
        { status: 400 }
      )
    }

    if (lat === undefined || lng === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: lat, lng' },
        { status: 400 }
      )
    }

    // Validate boundary if provided
    if (boundary) {
      if (!Array.isArray(boundary) || boundary.length < 3) {
        return NextResponse.json(
          { error: 'Boundary inválido: mínimo 3 pontos' },
          { status: 400 }
        )
      }
    }

    console.log(`🆕 Creating manual POI: ${name} at ${lat}, ${lng}${boundary ? ` with ${boundary.length}-point boundary` : ''}`)

    // Step 1: Reverse geocoding to get city, state, country
    let city: string | null = null
    let state: string | null = null
    let country: string | null = 'Brazil' // Default
    let formatted_address: string | null = null

    const geocodingResult = await ReverseGeocodingService.reverseGeocode(lat, lng)
    
    if (geocodingResult) {
      city = geocodingResult.city
      state = geocodingResult.state
      country = geocodingResult.country || 'Brazil'
      formatted_address = geocodingResult.formatted_address ?? null
      
      console.log(`📍 Reverse geocoding result: ${city}, ${state}, ${country}`)
    } else {
      console.warn(`⚠️ Reverse geocoding failed for ${lat}, ${lng}. Will require manual city/state input.`)
    }

    // Validate that we have at least city and country (required fields)
    if (!city || !country) {
      return NextResponse.json(
        { 
          error: 'Could not determine city and country from coordinates. Please ensure the coordinates are valid and try again.',
          details: 'Reverse geocoding failed. City and country are required fields.'
        },
        { status: 400 }
      )
    }

    // Step 2: Create POI using centralized service (atomic operation)
    // Setup additional fields based on category
    const additionalFields: any = {
      created_by: cmsUser.id
    }
    
    if (category) {
      additionalFields.category = category
    }
    
    if (primary_category) {
      additionalFields.primary_category = primary_category
      if (primary_category === 'geofence') {
        additionalFields.approved = true // Auto-approve geofences
      }
    } else if (category === 'geofence') {
      additionalFields.primary_category = 'geofence'
      additionalFields.approved = true
    }
    
    if (owner_id) {
      additionalFields.owner_id = owner_id
    }
    
    if (business_status) {
      additionalFields.business_status = business_status
    }

    const createResult = await POICreationService.createPOIWithCoordinates({
      name: name.trim(),
      city: city,
      state: state || null,
      country: country,
      formatted_address: formatted_address ?? null,
      latitude: lat,
      longitude: lng,
      import_source: 'manual',
      source_type: 'manual',
      additionalFields
    })

    if (!createResult.success || !createResult.attraction_id) {
      return NextResponse.json(
        { 
          error: createResult.error || 'Failed to create POI',
          details: createResult.details
        },
        { status: 500 }
      )
    }

    const attractionId = createResult.attraction_id
    console.log(`✅ POI created successfully with ID: ${attractionId}`)

    // Removed OSM enrichment logic as requested by user

    // Step 4: Save boundary if provided
    if (boundary && Array.isArray(boundary) && boundary.length >= 3) {
      console.log(`💾 Saving boundary for POI ${attractionId} (${boundary.length} points)`)
      
      try {
        // Convert boundary to GeoJSON
        const geoJson = {
          type: 'Polygon',
          coordinates: [[
            ...boundary.map((p: {lat: number; lng: number}) => [p.lng, p.lat]),
            [boundary[0].lng, boundary[0].lat] // Close the polygon
          ]]
        }

        // Calculate area using Shoelace formula (approximate)
        let area = 0
        for (let i = 0; i < boundary.length; i++) {
          const j = (i + 1) % boundary.length
          area += boundary[i].lng * boundary[j].lat
          area -= boundary[j].lng * boundary[i].lat
        }
        area = Math.abs(area / 2) * 111320 * 111320 // Convert to m²

        // Calculate centroid
        const centroid = {
          lat: boundary.reduce((sum: number, p: {lat: number}) => sum + p.lat, 0) / boundary.length,
          lng: boundary.reduce((sum: number, p: {lng: number}) => sum + p.lng, 0) / boundary.length
        }

        // Call update_boundary_geometry RPC (function is in core schema)
        // Note: parameter is p_geojson, not p_boundary_geometry_geojson
        const { error: boundaryError } = await supabase
          .schema('core')
          .rpc(
            'update_boundary_geometry',
            {
              p_attraction_id: attractionId,
              p_geojson: JSON.stringify(geoJson),
              p_boundary_type: 'manual',
              p_boundary_source: 'manual_drawing',
              p_boundary_confidence: 1.0,
              p_boundary_area_m2: area,
              p_boundary_centroid_lat: centroid.lat,
              p_boundary_centroid_lng: centroid.lng
            }
          )

        if (boundaryError) {
          console.error('❌ Error saving boundary:', boundaryError.message)
        } else {
          console.log('✅ Boundary saved successfully')
        }
      } catch (boundaryErr) {
        console.error('❌ Error processing boundary:', boundaryErr)
      }
    }

    // Step 5: Fetch complete POI data to return
    const { data: completePOI, error: fetchError } = await supabase
      .schema('core')
      .from('attractions')
      .select(`
        *,
        attraction_coordinate (
          latitude,
          longitude,
          boundary_area_m2,
          boundary_centroid_lat,
          boundary_centroid_lng
        )
      `)
      .eq('id', attractionId)
      .single()

    if (fetchError || !completePOI) {
      console.error('❌ Error fetching created POI:', fetchError)
    }

    await logAuditEvent({
      request,
      action: 'CREATE_POI',
      entity: 'POI',
      entityId: attractionId,
      userId: cmsUser.id,
      userEmail: session.user.email || null,
      description: `Created POI "${name.trim()}" in ${city}, ${country}`
    })

    return NextResponse.json({
      success: true,
      data: {
        // Provide defaults from input/geocoding in case fetch fails
        id: attractionId,
        name: name.trim(),
        city,
        state,
        country,
        formatted_address,
        // Spread fetched data (will overwrite defaults if valid)
        ...completePOI,
        coordinates: completePOI?.attraction_coordinate?.[0] ? {
          latitude: completePOI.attraction_coordinate[0].latitude,
          longitude: completePOI.attraction_coordinate[0].longitude,
          boundary_area_m2: completePOI.attraction_coordinate[0].boundary_area_m2,
          boundary_centroid_lat: completePOI.attraction_coordinate[0].boundary_centroid_lat,
          boundary_centroid_lng: completePOI.attraction_coordinate[0].boundary_centroid_lng
        } : { latitude: lat, longitude: lng }
      },
      message: `POI criado com sucesso${boundary ? ' com boundary' : ''}`
    })

  } catch (error) {
    console.error('❌ Error processing manual POI creation:', error)
    return NextResponse.json(
      { 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

