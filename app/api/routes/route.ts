import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseRouteHandler } from '@/lib/core/supabase-client'
import { RouteService } from '@/lib/services/route-service'
import { cookies } from 'next/headers'
import { namePattern } from '@/lib/shared/name-search'

/**
 * GET /api/routes
 * List routes with optional filters and pagination.
 *
 * Query params:
 *   client_id    — filter by specific client (optional)
 *   search       — name search (case-insensitive)
 *   status       — 'active' | 'inactive' | '' (all)
 *   country      — e.g. 'Portugal'
 *   drivability  — 'easy' | 'moderate' | 'demanding'
 *   scenic       — comma-separated profile values, e.g. 'historical,panoramic'
 *   accessibility — 'accessible' | 'partial' | 'not_accessible'
 *   page         — 1-based page number (default 1)
 *   pageSize     — items per page (default 50, max 200)
 */
export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const supabaseAuth = getSupabaseRouteHandler(cookieStore)
    const { data: { session }, error: authError } = await supabaseAuth.auth.getSession()

    if (authError || !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: cmsUser } = await supabaseAuth
      .schema('core')
      .from('cms_users')
      .select('id, role')
      .eq('email', session.user.email as string)
      .single()

    const { searchParams } = new URL(request.url)
    const clientId     = searchParams.get('client_id')
    const search       = searchParams.get('search')?.trim() || ''
    const status       = searchParams.get('status') || ''        // 'active' | 'inactive' | ''
    const country      = searchParams.get('country') || ''
    const drivability  = searchParams.get('drivability') || ''
    const scenic       = searchParams.get('scenic') || ''        // comma-separated
    const accessibility = searchParams.get('accessibility') || ''
    const page         = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const pageSize     = Math.min(200, Math.max(1, parseInt(searchParams.get('pageSize') || '50', 10)))

    // Determine which client IDs to filter
    let clientIds: string[] | null = null

    if (clientId) {
      clientIds = [clientId]
    } else if (cmsUser?.role !== 'admin') {
      // Non-admin: restrict to their clients
      const { data: clientLinks } = await supabaseAuth
        .schema('partner')
        .from('client_cms_users')
        .select('client_id')
        .eq('cms_user_id', cmsUser?.id)

      const ids: string[] = clientLinks?.map((l: any) => l.client_id) ?? []
      clientIds = ids
      if (ids.length === 0) {
        return NextResponse.json({ routes: [], total: 0, page, pageSize })
      }
    }

    // Build query
    let query = (supabaseAuth as any)
      .schema('core')
      .from('custom_routes')
      .select(
        'id, name, description, client_id, is_active, created_at, updated_at, ' +
        'metadata, accessibility, drivability, scenic_profile, best_time, ' +
        'road_conditions, photogenic_rating, stops_count, country, region',
        { count: 'exact' }
      )
      .order('created_at', { ascending: false })

    if (clientIds) {
      query = query.in('client_id', clientIds)
    }

    if (search) {
      query = query.imatch('name', namePattern(search))
    }

    if (status === 'active') {
      query = query.eq('is_active', true)
    } else if (status === 'inactive') {
      query = query.eq('is_active', false)
    }

    if (country) {
      query = query.eq('country', country)
    }

    if (drivability) {
      query = query.eq('drivability', drivability)
    }

    if (accessibility) {
      query = query.eq('accessibility', accessibility)
    }

    if (scenic) {
      // scenic_profile is an array column — use overlap operator (@>)
      const profiles = scenic.split(',').map(s => s.trim()).filter(Boolean)
      if (profiles.length > 0) {
        query = query.overlaps('scenic_profile', profiles)
      }
    }

    // Pagination
    const from = (page - 1) * pageSize
    const to   = from + pageSize - 1
    query = query.range(from, to)

    const { data: routes, error, count } = await query

    if (error) throw error

    return NextResponse.json({
      routes: routes ?? [],
      total: count ?? 0,
      page,
      pageSize,
    })
  } catch (error) {
    console.error('GET /api/routes error:', error)
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}

/**
 * POST /api/routes
 * Create a new route
 */
export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const supabaseAuth = getSupabaseRouteHandler(cookieStore)
    const { data: { session }, error: authError } = await supabaseAuth.auth.getSession()

    if (authError || !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()

    if (!body.name || !body.waypoints) {
      return NextResponse.json({ error: 'name and waypoints are required' }, { status: 400 })
    }

    if (!Array.isArray(body.waypoints) || body.waypoints.length < 2) {
      return NextResponse.json({ error: 'At least 2 waypoints are required' }, { status: 400 })
    }

    // country and region required for app filters and display
    if (!body.country || !body.region) {
      return NextResponse.json({ error: 'country and region are required' }, { status: 400 })
    }

    const userId = session.user.id

    const route = await RouteService.createRoute(supabaseAuth, {
      name:              body.name,
      description:       body.description,
      client_id:         body.client_id,
      waypoints:         body.waypoints,
      snap_to_roads:     body.snap_to_roads ?? true,
      accessibility:     body.accessibility,
      drivability:       body.drivability,
      scenic_profile:    body.scenic_profile,
      best_time:         body.best_time,
      road_conditions:   body.road_conditions,
      resources:         body.resources,
      photogenic_rating: body.photogenic_rating,
      stops_count:       body.stops_count,
    }, userId)

    // Set country/region if provided (not handled by RouteService yet)
    if (route?.id && (body.country || body.region)) {
      await (supabaseAuth as any)
        .schema('core')
        .from('custom_routes')
        .update({ country: body.country || null, region: body.region || null })
        .eq('id', route.id)
    }

    return NextResponse.json({ route }, { status: 201 })
  } catch (error) {
    console.error('POST /api/routes error:', error)
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}
