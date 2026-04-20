/**
 * API Route: /api/routes/generate
 * 
 * POST: Generate a route preview (without saving)
 * Used by the map editor to show snapped route before saving
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseRouteHandler } from '@/lib/core/supabase-client'
import { RouteService } from '@/lib/services/route-service'
import { cookies } from 'next/headers'

/**
 * POST /api/routes/generate
 *   geometryEncoded: string
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

    if (!body.waypoints || !Array.isArray(body.waypoints) || body.waypoints.length < 2) {
      return NextResponse.json(
        { error: 'At least 2 waypoints are required' },
        { status: 400 }
      )
    }

    const mode = body.mode || 'route'

    let result
    if (mode === 'match') {
      // Map matching - for drawn/traced routes
      result = await RouteService.matchDrawnRoute(body.waypoints)
    } else {
      // Point-to-point routing
      result = await RouteService.previewRoute(body.waypoints)
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('POST /api/routes/generate error:', error)
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    )
  }
}
