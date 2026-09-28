import { NextRequest, NextResponse } from 'next/server'
import { RouteService } from '@/lib/services/route-service'
import { withAuth } from '@/lib/auth-middleware'

/**
 * PORTÃO (#780): `withAuth({ roles: ['admin', 'client'] })` nos três métodos. Quem chama é o editor
 * de `/routes` (`components/routes/RouteEditorModal`), tela que o proxy abre para `admin` e
 * `client` (`lib/navigation/access.ts#resolveAccess`). A escrita segue pelo client do cookie, e a
 * RLS de `core.custom_routes` continua valendo por baixo. Antes: só `getSession()`, que lê o
 * cookie sem revalidar o JWT.
 */
type Params = { id: string }

/**
 * GET /api/routes/[id]
 * Get a single route by ID
 */
export const GET = withAuth<Params>({ roles: ['admin', 'client'] }, async (_request: NextRequest, ctx, auth) => {
  try {
    const supabaseAuth = auth.supabase
    const { id } = (await ctx.params) as Params

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
})

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
export const PUT = withAuth<Params>({ roles: ['admin', 'client'] }, async (request: NextRequest, ctx, auth) => {
  try {
    const supabaseAuth = auth.supabase
    const { id } = (await ctx.params) as Params
    const body = await request.json()

    // Get the authenticated user ID
    const userId = auth.user.id

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

    // Persist extra fields not handled by RouteService
    const extras: Record<string, any> = {}
    if (body.country  !== undefined) extras.country = body.country
    if (body.region   !== undefined) extras.region  = body.region

    if (body.content_language) {
      // Merge content_language into existing metadata (preserve other fields)
      const { data: cur } = await (supabaseAuth as any)
        .schema('core').from('custom_routes').select('metadata').eq('id', id).single()
      extras.metadata = { ...(cur?.metadata ?? {}), content_language: body.content_language }
    }

    if (Object.keys(extras).length > 0) {
      await (supabaseAuth as any)
        .schema('core').from('custom_routes').update(extras).eq('id', id)
    }

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
})

/**
 * DELETE /api/routes/[id]
 * Soft delete a route (marks as inactive)
 */
export const DELETE = withAuth<Params>({ roles: ['admin', 'client'] }, async (_request: NextRequest, ctx, auth) => {
  try {
    const supabaseAuth = auth.supabase
    const { id } = (await ctx.params) as Params

    // Get the authenticated user ID
    const userId = auth.user.id

    await RouteService.deleteRoute(supabaseAuth, id, userId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DELETE /api/routes/[id] error:', error)
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    )
  }
})
