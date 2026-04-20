/**
 * API Endpoint for managing POIs with client ownership
 * 
 * Routes:
 * - GET /api/clients/pois - List POIs for a client
 * - POST /api/clients/pois - Create a new POI for a client
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseRouteHandler } from '@/lib/core/supabase-client'
import { cookies } from 'next/headers'
import { getSupabase } from '@/lib/core/supabase-client'

const supabaseService = getSupabase('service')

/**
 * GET /api/clients/pois
 * 
 * Query Parameters:
 * - clientId: UUID of the client (required for non-admin users)
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 20)
 * - search: Search term for POI name/city
 * - approved: Filter by approval status (true, false, or 'all')
 * 
 * Returns: List of POIs owned by the client
 */
export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const supabaseAuth = getSupabaseRouteHandler(cookieStore)
    
    // Check authentication
    const { data: { session }, error: authError } = await supabaseAuth.auth.getSession()
    if (authError || !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get CMS user info
    const { data: cmsUser, error: cmsErr } = await supabaseAuth
      .schema('core')
      .from('cms_users')
      .select('id, role, client_id, is_active')
      .eq('email', session.user.email as string)
      .eq('is_active', true)
      .single()

    if (cmsErr || !cmsUser) {
      return NextResponse.json({ error: 'CMS access denied' }, { status: 403 })
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url)
    const clientId = searchParams.get('clientId')
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const search = searchParams.get('search')
    const approved = searchParams.get('approved')

    const isAdmin = cmsUser.role === 'admin' || cmsUser.role === 'super_admin'

    // Determine which client(s) to query
    let clientIdToQuery: string | null = null

    if (isAdmin) {
      // Admin can query any client if specified
      if (clientId) {
        clientIdToQuery = clientId
      } else {
        // Return all POIs if no client specified
        clientIdToQuery = null
      }
    } else if (cmsUser.role === 'client') {
      // Client users can only query their own client
      if (clientId && clientId !== cmsUser.client_id) {
        return NextResponse.json(
          { error: 'You can only access POIs for your own client' },
          { status: 403 }
        )
      }
      clientIdToQuery = cmsUser.client_id!
    } else {
      // Other roles (editor, viewer) cannot access client POIs
      return NextResponse.json(
        { error: 'Your role does not have access to client POIs' },
        { status: 403 }
      )
    }

    // Build query
    let query = supabaseService
      .schema('core')
      .from('attractions')
      .select(
        `
        id,
        name,
        city,
        state,
        country,
        approved,
        created_at,
        updated_at,
        owner_id,
        created_by,
        google_types,
        rating,
        image_url,
        formatted_address,
        attraction_coordinate(latitude, longitude),
        attraction_descriptions(id, language)
      `,
        { count: 'exact' }
      )

    // Filter by owner_id if client is specified
    if (clientIdToQuery) {
      query = query.eq('owner_id', clientIdToQuery)
    }

    // Filter by search term
    if (search) {
      query = query.or(`name.ilike.%${search}%,city.ilike.%${search}%`)
    }

    // Filter by approval status
    if (approved === 'true') {
      query = query.eq('approved', true)
    } else if (approved === 'false') {
      query = query.eq('approved', false)
    }

    // Pagination
    const offset = (page - 1) * limit
    query = query.order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    const { data: pois, error: poisErr, count } = await query

    if (poisErr) {
      console.error('Error fetching POIs:', poisErr)
      return NextResponse.json({ error: 'Failed to fetch POIs' }, { status: 500 })
    }

    // Transform response
    const response = {
      data: (pois || []).map((poi: any) => ({
        id: poi.id,
        name: poi.name,
        city: poi.city,
        state: poi.state,
        country: poi.country,
        approved: poi.approved,
        created_at: poi.created_at,
        updated_at: poi.updated_at,
        owner_id: poi.owner_id,
        created_by: poi.created_by,
        google_types: poi.google_types,
        rating: poi.rating,
        image_url: poi.image_url,
        formatted_address: poi.formatted_address,
        coordinates: poi.attraction_coordinate?.[0] ? {
          latitude: poi.attraction_coordinate[0].latitude,
          longitude: poi.attraction_coordinate[0].longitude
        } : null,
        descriptions_count: poi.attraction_descriptions?.length || 0
      })),
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: count ? Math.ceil(count / limit) : 0
      }
    }

    return NextResponse.json(response)

  } catch (err) {
    console.error('Error in GET /api/clients/pois:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/clients/pois
 * 
 * Creates a new POI for a client
 * 
 * Body:
 * - clientId: UUID (required if not in body, uses user's client if not admin)
 * - name: string (required)
 * - city: string (required)
 * - country: string (required)
 * - state?: string
 * - latitude: number (required)
 * - longitude: number (required)
 * - description?: string
 * - formatted_address?: string
 * 
 * Returns: Created POI object with id
 */
export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const supabaseAuth = getSupabaseRouteHandler(cookieStore)
    
    // Check authentication
    const { data: { session }, error: authError } = await supabaseAuth.auth.getSession()
    if (authError || !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get CMS user info
    const { data: cmsUser, error: cmsErr } = await supabaseAuth
      .schema('core')
      .from('cms_users')
      .select('id, role, client_id, is_active')
      .eq('email', session.user.email as string)
      .eq('is_active', true)
      .single()

    if (cmsErr || !cmsUser) {
      return NextResponse.json({ error: 'CMS access denied' }, { status: 403 })
    }

    // Parse request body
    const body = await request.json()
    const {
      clientId,
      name,
      city,
      country,
      state,
      latitude,
      longitude,
      description,
      formatted_address,
      google_types
    } = body

    // Validate required fields
    if (!name || !city || !country || latitude === undefined || longitude === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: name, city, country, latitude, longitude' },
        { status: 400 }
      )
    }

    const isAdmin = cmsUser.role === 'admin' || cmsUser.role === 'super_admin'

    // Determine owner_id
    let ownerIdToUse: string | null = null

    if (isAdmin && clientId) {
      ownerIdToUse = clientId
    } else if (cmsUser.role === 'client' && cmsUser.client_id) {
      ownerIdToUse = cmsUser.client_id
    } else if (clientId && isAdmin) {
      ownerIdToUse = clientId
    } else if (!isAdmin && !cmsUser.client_id) {
      return NextResponse.json(
        { error: 'You must belong to a client to create POIs' },
        { status: 403 }
      )
    } else {
      ownerIdToUse = cmsUser.client_id!
    }

    // Create attraction
    const { data: attraction, error: attrErr } = await supabaseService
      .schema('core')
      .from('attractions')
      .insert({
        name: name.trim(),
        city: city.trim(),
        state: state?.trim() || null,
        country: country.trim(),
        description: description?.trim() || null,
        formatted_address: formatted_address?.trim() || null,
        google_types: google_types || [],
        created_by: cmsUser.id,
        owner_id: ownerIdToUse,
        approved: false,
        processing_status: 'pending'
      })
      .select('id, name, city, country')
      .single()

    if (attrErr) {
      console.error('Error creating attraction:', attrErr)
      return NextResponse.json({ error: 'Failed to create POI' }, { status: 500 })
    }

    // Create coordinate
    const { data: coordinate, error: coordErr } = await supabaseService
      .schema('core')
      .from('attraction_coordinate')
      .insert({
        attraction_id: attraction.id,
        latitude,
        longitude
      })
      .select('id')
      .single()

    if (coordErr) {
      console.error('Error creating coordinate:', coordErr)
      // Continue - coordinate creation is not critical
    }

    return NextResponse.json(
      {
        success: true,
        poi: {
          id: attraction.id,
          name: attraction.name,
          city: attraction.city,
          country: attraction.country,
          owner_id: ownerIdToUse,
          created_by: cmsUser.id
        }
      },
      { status: 201 }
    )

  } catch (err) {
    console.error('Error in POST /api/clients/pois:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
