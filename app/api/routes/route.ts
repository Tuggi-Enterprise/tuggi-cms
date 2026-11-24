import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseRouteHandler, getSupabaseService } from '@/lib/core/supabase-client'
import { RouteService } from '@/lib/services/route-service'
import { cookies } from 'next/headers'
import { namePattern } from '@/lib/shared/name-search'
import { parseRouteOwnership } from '@/lib/routes/route-ownership'
import { withAuth } from '@/lib/auth-middleware'
import {
  isMissingColumn, isMissingRelation, isUserRoute, openReports, reviewQueueIds,
  type QueueCandidate, type RouteReport,
} from '@/lib/routes/route-publication'

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
 *   origin       — 'cms' | 'users' (routes published from the app), #945
 *   queue        — '1': only the review queue (admin), #945
 *   page         — 1-based page number (default 1)
 *   pageSize     — items per page (default 50, max 200)
 *
 * Gate (#945): `withAuth({ roles: ['admin', 'client'] })`, the roles `resolveAccess` lets into
 * `/routes`. Before, `getSession()` read the cookie without revalidating it, and the role came from
 * an e-mail in that cookie; with a service_role read of nicknames below, that is not a gate.
 */
export const GET = withAuth({ roles: ['admin', 'client'] }, async (request: NextRequest, _ctx, auth) => {
  try {
    const supabaseAuth = auth.supabase
    const cmsUser = auth.cmsUser

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

    const isAdmin = cmsUser?.role === 'admin'
    const origin = searchParams.get('origin') || ''            // 'cms' | 'users' | '' (all), #945
    const queue  = searchParams.get('queue') === '1'           // review queue only, #945

    // #945: the review queue is an admin screen (BR-ROTA-006). Loaded first so the page query can
    // be cut to it; `null` = the migration is not applied and the queue does not exist yet.
    const review = isAdmin ? await loadReviewQueue(supabaseAuth) : null
    if (queue && (!review || review.ids.length === 0)) {
      return NextResponse.json({ routes: [], total: 0, page, pageSize, publication: Boolean(review), reviewCount: review?.ids.length ?? null })
    }

    const buildQuery = (columns: string, withPublication: boolean) => {
      let query = (supabaseAuth as any)
        .schema('core')
        .from('custom_routes')
        .select(columns, { count: 'exact' })
        .order('created_at', { ascending: false })

      if (clientIds) {
        query = query.in('client_id', clientIds)
      }

      if (search) {
        // `.filter(...)` e não `.imatch(...)`: o método existe na tipagem de `postgrest-js` 2.110.0
        // e não no objeto em runtime. Ver `lib/shared/name-search`.
        query = query.filter('name', 'imatch', namePattern(search))
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

      // #945: origin (spec 8.1). A user route is `owner_user_id` set, or `metadata.source =
      // 'user_trip'` when the account is gone (`isUserRoute`). Without the columns there is no
      // user route, and the filter is ignored rather than failing the page.
      if (withPublication && origin === 'users') {
        query = query.or('owner_user_id.not.is.null,metadata->>source.eq.user_trip')
      } else if (withPublication && origin === 'cms') {
        query = query.is('owner_user_id', null).or('metadata->>source.is.null,metadata->>source.neq.user_trip')
      } else if (!withPublication && origin === 'users') {
        query = query.in('id', [])
      }

      if (withPublication && queue && review) {
        query = query.in('id', review.ids)
      }

      // Pagination
      const from = (page - 1) * pageSize
      const to   = from + pageSize - 1
      return query.range(from, to)
    }

    // #945: the publication columns exist only after migration 20261019110000. Absent column =
    // the legacy select, and the page shows what it showed before.
    let withPublication = true
    let result = await buildQuery(LIST_COLUMNS + ', ' + PUBLICATION_COLUMNS, true)
    if (isMissingColumn(result.error)) {
      withPublication = false
      result = await buildQuery(LIST_COLUMNS, false)
    }
    const { data: routes, error, count } = result

    if (error) throw error

    const rows: Record<string, any>[] = routes ?? []
    if (withPublication && isAdmin) await annotateUserRoutes(rows, review)

    return NextResponse.json({
      routes: rows,
      total: count ?? 0,
      page,
      pageSize,
      publication: withPublication,
      reviewCount: review?.ids.length ?? null,
    })
  } catch (error) {
    console.error('GET /api/routes error:', error)
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
})

const LIST_COLUMNS =
  'id, name, description, client_id, is_active, created_at, updated_at, ' +
  'metadata, accessibility, drivability, scenic_profile, best_time, ' +
  'road_conditions, photogenic_rating, stops_count, country, region'

/** #945, migration 20261019110000. */
const PUBLICATION_COLUMNS =
  'slug, visibility, status, valid_from, valid_until, owner_user_id, moderation_reason, moderation_reviewed_at'

/** Cap of the queue reads: the queue is a working list, not a report. */
const QUEUE_READ_LIMIT = 1000

interface ReviewQueue {
  ids: string[]
  reports: RouteReport[]
}

/**
 * The review queue (spec 8.1, BR-ROTA-006): `pending_review` routes plus live routes with open
 * reports. `null` when the migration is not applied (columns or the reports table absent).
 */
async function loadReviewQueue(supabase: any): Promise<ReviewQueue | null> {
  const [pending, reports] = await Promise.all([
    supabase.schema('core').from('custom_routes')
      .select('id, status, moderation_reviewed_at').eq('status', 'pending_review').limit(QUEUE_READ_LIMIT),
    supabase.schema('core').from('custom_route_reports')
      .select('route_id, reason, created_at').order('created_at', { ascending: false }).limit(QUEUE_READ_LIMIT),
  ])
  if (isMissingColumn(pending.error) || isMissingRelation(reports.error)) return null
  if (pending.error) throw pending.error
  if (reports.error) throw reports.error

  const allReports: RouteReport[] = reports.data ?? []
  const reportedIds = [...new Set(allReports.map((r) => r.route_id))]
  let reported: QueueCandidate[] = []
  if (reportedIds.length > 0) {
    const res = await supabase.schema('core').from('custom_routes')
      .select('id, status, moderation_reviewed_at').in('id', reportedIds)
    if (res.error) throw res.error
    reported = res.data ?? []
  }
  return { ids: reviewQueueIds(pending.data ?? [], reported, allReports), reports: allReports }
}

/**
 * Adds to each user route of the page the owner's nickname (BR-USUARIO-042: nickname only) and the
 * summary of its open reports. `drive.profiles` is read with service_role: the CMS JWT has no grant
 * on it, and the caller is an admin (checked before this runs).
 */
async function annotateUserRoutes(rows: Record<string, any>[], review: ReviewQueue | null) {
  const userRows = rows.filter((r) => isUserRoute(r))
  if (userRows.length === 0) return

  const ownerIds = [...new Set(userRows.map((r) => r.owner_user_id).filter(Boolean))] as string[]
  const nicknames = new Map<string, string | null>()
  if (ownerIds.length > 0) {
    const { data } = await getSupabaseService().schema('drive').from('profiles').select('id, nickname').in('id', ownerIds)
    for (const p of (data ?? []) as { id: string; nickname: string | null }[]) nicknames.set(p.id, p.nickname)
  }

  const queueIds = new Set(review?.ids ?? [])
  for (const row of userRows) {
    row.owner_nickname = row.owner_user_id ? nicknames.get(row.owner_user_id) ?? null : null
    row.in_review_queue = queueIds.has(row.id)
    row.reports = openReports((review?.reports ?? []).filter((r) => r.route_id === row.id), row.moderation_reviewed_at)
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

    const ownership = parseRouteOwnership(body)
    if ('error' in ownership) {
      return NextResponse.json({ error: ownership.error }, { status: 400 })
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

    // Fields `upsert_custom_route` does not carry: country/region, and travel mode + partner (#792).
    if (route?.id) {
      const { error: extrasError } = await (supabaseAuth as any)
        .schema('core')
        .from('custom_routes')
        .update({ country: body.country || null, region: body.region || null, ...ownership.patch })
        .eq('id', route.id)
      if (extrasError) throw new Error(`Route created, but saving its fields failed: ${extrasError.message}`)
    }

    return NextResponse.json({ route }, { status: 201 })
  } catch (error) {
    console.error('POST /api/routes error:', error)
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}
