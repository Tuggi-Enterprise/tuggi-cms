import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { RouteService, RouteWriteError } from '@/lib/services/route-service'
import { classifyPublicationError, isModerationAction, moderationStatus } from '@/lib/routes/route-publication'

/**
 * POST /api/routes/[id]/moderation : body `{ action: 'approve' | 'remove' | 'restore' }` (#945).
 *
 * BR-ROTA-006: the CMS admin decides the review queue. `remove` writes `removed_by_moderation` and
 * never DELETEs (BR-ROTA-002); `approve` and `restore` write `active`. All three go through
 * `core.upsert_custom_route` with `p_status`, on the operator's cookie client: the RPC is the one
 * that refuses a non-admin, a `removed_by_author` route (TGW10, BR-ROTA-007), and that stamps
 * `moderation_reviewed_at`, which closes the open reports of the route.
 *
 * Admin only at the door too: the queue is an admin screen, and a partner has no user route to see.
 */
type Params = { id: string }

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
    const route = await RouteService.updateRoute(auth.supabase, id, { status: moderationStatus(body.action) }, auth.user.id)
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
