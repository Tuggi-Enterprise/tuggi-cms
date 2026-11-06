import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { RouteService, RouteWriteError } from '@/lib/services/route-service'
import {
  classifyPublicationError, isModerationAction, isUserRoute, moderationStatus, type PublicationFields,
} from '@/lib/routes/route-publication'

/**
 * POST /api/routes/[id]/moderation : body `{ action: 'approve' | 'remove' | 'restore' }` (#945).
 *
 * BR-ROTA-006: moderation of a route that is already decided. `remove` writes `removed_by_moderation`
 * and never DELETEs (BR-ROTA-002); `approve` keeps a reported route on the air and `restore` brings a
 * moderation removal back, both writing `active`. All three go through `core.upsert_custom_route`
 * with `p_status`, on the operator's cookie client: the RPC is the one that refuses a non-admin, a
 * `removed_by_author` route (TGW10, BR-ROTA-007), and that stamps `moderation_reviewed_at`, which
 * closes the open reports of the route.
 *
 * Since #1106 (BR-ROTA-006 item 3) a route in `pending_review` is NOT approved here: that would put
 * its submission on the air without deciding the version. It answers 409 `use_revision_queue`, and
 * the version is decided in /admin/route-review (`core.approve_route_revision`).
 *
 * #1109: a user route removed before any version was approved has no `live_revision_id`, and
 * `active` would put it on the air with no approved version (BR-ROTA-006 item 3). Restore takes it
 * back to `pending_review`, the state it was removed from, and the version is decided in
 * /admin/route-review like any other. A CMS route has no versions and still restores to `active`.
 *
 * Admin only at the door too: the queue is an admin screen, and a partner has no user route to see.
 */
type Params = { id: string }

/** User route with the versions column and no version on the air (#1109). */
function restoresToReview(route: object): boolean {
  const row = route as PublicationFields & { live_revision_id?: string | null }
  return 'live_revision_id' in row && !row.live_revision_id && isUserRoute(row)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const POST = withAuth<Params>({ roles: ['admin'] }, async (request: NextRequest, ctx, auth) => {
  const { id } = (await ctx.params) as Params
  if (!id || !UUID_RE.test(id)) return NextResponse.json({ error: 'invalid_route_id' }, { status: 400 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }
  if (!isModerationAction(body.action)) return NextResponse.json({ error: 'invalid_action' }, { status: 400 })

  try {
    let status: 'active' | 'pending_review' | 'removed_by_moderation' = moderationStatus(body.action)
    if (body.action !== 'remove') {
      const current = await RouteService.getRouteById(auth.supabase, id)
      if (!current) return NextResponse.json({ error: 'route_not_found' }, { status: 404 })
      if (body.action === 'approve' && (current as { status?: string }).status === 'pending_review') {
        return NextResponse.json({ error: 'use_revision_queue' }, { status: 409 })
      }
      if (body.action === 'restore' && restoresToReview(current)) status = 'pending_review'
    }
    const route = await RouteService.updateRoute(auth.supabase, id, { status }, auth.user.id)
    return NextResponse.json({ route })
  } catch (error) {
    if ((error as Error).message === 'Route not found') {
      return NextResponse.json({ error: 'route_not_found' }, { status: 404 })
    }
    const code = error instanceof RouteWriteError ? classifyPublicationError(error.dbError) : null
    if (code === 'route_removed_by_author') return NextResponse.json({ error: code }, { status: 409 })
    // No message in the log: it can carry the route name, which may be the offending text.
    console.error('[routes/moderation] refused:', error instanceof RouteWriteError ? error.dbError.code : 'unknown')
    return NextResponse.json({ error: 'moderation_failed' }, { status: 500 })
  }
})
