import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseRouteHandler } from '@/lib/core/supabase-client'
import { RouteService } from '@/lib/services/route-service'
import { cookies } from 'next/headers'

interface RouteParams {
  params: { id: string }
}

/**
 * GET /api/routes/[id]
 * Get a single route by ID
 */
export async function GET(
  request: NextRequest,
  context: RouteParams
) {
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

    const { id } = await context.params

    const route = await RouteService.getRouteById(supabaseAuth, id)

    if (!route) {
      return NextResponse.json(
        { error: 'Route not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ route })
  } catch (error) {
    console.error('GET /api/routes/[id] error:', error)
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/routes/[id]
 * Update a route
 * 
 * Body: {
 *   name?: string,
 *   description?: string,
 *   waypoints?: [{ lat, lng }],
 *   is_active?: boolean,
 *   snap_to_roads?: boolean
 * }
 */
export async function PUT(
  request: NextRequest,
  context: RouteParams
) {
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

    const { id } = await context.params
    const body = await request.json()

    // Get the authenticated user ID
    const userId = session.user.id

    const route = await RouteService.updateRoute(supabaseAuth, id, {
      name: body.name,
      description: body.description,
      waypoints: body.waypoints,
      is_active: body.is_active,
      snap_to_roads: body.snap_to_roads,
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

    return NextResponse.json({ route })
  } catch (error) {
    console.error('PUT /api/routes/[id] error:', error)
    
    if ((error as Error).message === 'Route not found') {
      return NextResponse.json(
        { error: 'Route not found' },
        { status: 404 }
      )
    }

    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/routes/[id]
 * Soft delete a route (marks as inactive)
 */
export async function DELETE(
  request: NextRequest,
  context: RouteParams
) {
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

    const { id } = await context.params

    // Get the authenticated user ID
    const userId = session.user.id

    await RouteService.deleteRoute(supabaseAuth, id, userId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DELETE /api/routes/[id] error:', error)
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    )
  }
}
