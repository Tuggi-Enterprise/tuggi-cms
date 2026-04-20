import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseRouteHandler } from '@/lib/core/supabase-client'
import { RouteService } from '@/lib/services/route-service'
import { cookies } from 'next/headers'

/**
 * GET /api/routes?client_id=xxx
 * List routes for a client
 */
export async function GET(request: NextRequest) {
  try {
    // Require authentication
    const cookieStore = await cookies()
    const supabaseAuth = getSupabaseRouteHandler(cookieStore)
    const { data: { session }, error: authError } = await supabaseAuth.auth.getSession()

    if (authError || !session) {
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      )
    }

    // Get user details to check role
    const { data: cmsUser } = await supabaseAuth
      .schema('core')
      .from('cms_users')
      .select('id, role')
      .eq('email', session.user.email as string)
      .single()

    const { searchParams } = new URL(request.url)
    const clientId = searchParams.get('client_id')

    let routes = []

    if (clientId) {
      // List for specific client
      routes = await RouteService.getRoutesByClient(supabaseAuth, clientId)
    } else if (cmsUser?.role === 'admin') {
      // Admin: List all routes (or we could default to something else, but for now let's allow listing all)
      const { data, error } = await (supabaseAuth as any)
        .schema('core')
        .from('custom_routes')
        .select('*')
        .order('created_at', { ascending: false })
      
      if (error) throw error
      routes = data || []
    } else if (cmsUser?.role === 'client') {
      // Client: List routes for all clients they belong to
      const { data: clientLinks } = await supabaseAuth
        .schema('core')
        .from('client_cms_users')
        .select('client_id')
        .eq('cms_user_id', cmsUser.id)
      
      if (clientLinks && clientLinks.length > 0) {
        const clientIds = clientLinks.map((link: any) => link.client_id)
        const { data, error } = await (supabaseAuth as any)
          .schema('core')
          .from('custom_routes')
          .select('*')
          .in('client_id', clientIds)
          .order('created_at', { ascending: false })
        
        if (error) throw error
        routes = data || []
      }
    }

    return NextResponse.json({ routes })
  } catch (error) {
    console.error('GET /api/routes error:', error)
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    )
  }
}

/**
 * POST /api/routes
 * Create a new route
 * 
 * Body: {
 *   name: string,
 *   description?: string,
 *   client_id: string,
 *   waypoints: [{ lat, lng }],
 *   snap_to_roads?: boolean
 * }
 */
export async function POST(request: NextRequest) {
  try {
    // Require authentication
    const cookieStore = await cookies()
    const supabaseAuth = getSupabaseRouteHandler(cookieStore)
    const { data: { session }, error: authError } = await supabaseAuth.auth.getSession()

    if (authError || !session) {
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      )
    }

    const body = await request.json()

    // Validate required fields
    if (!body.name || !body.waypoints) {
      return NextResponse.json(
        { error: 'name and waypoints are required' },
        { status: 400 }
      )
    }

    if (!Array.isArray(body.waypoints) || body.waypoints.length < 2) {
      return NextResponse.json(
        { error: 'At least 2 waypoints are required' },
        { status: 400 }
      )
    }

    // Get the authenticated user ID
    const userId = session.user.id

    const route = await RouteService.createRoute(supabaseAuth, {
      name: body.name,
      description: body.description,
      client_id: body.client_id,
      waypoints: body.waypoints,
      snap_to_roads: body.snap_to_roads ?? true,
      // Characteristics
      accessibility: body.accessibility,
      drivability: body.drivability,
      scenic_profile: body.scenic_profile,
      best_time: body.best_time,
      road_conditions: body.road_conditions,
      resources: body.resources,
      photogenic_rating: body.photogenic_rating,
      stops_count: body.stops_count
    }, userId)

    return NextResponse.json({ route }, { status: 201 })
  } catch (error) {
    console.error('POST /api/routes error:', error)
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    )
  }
}
