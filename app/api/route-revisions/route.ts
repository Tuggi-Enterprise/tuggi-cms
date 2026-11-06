import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { listQueue } from '@/lib/services/route-revision-service'

export const dynamic = 'force-dynamic'

/**
 * GET /api/route-revisions : the approval queue of user route versions (#1106, BR-ROTA-006 item 3),
 * oldest first, from `core.list_pending_route_revisions()` on the curator's session. Admin only.
 * 503 `not_available` until migration 20261106130000 is applied.
 */
export const GET = withAuth({ roles: ['admin'] }, async (_req, _ctx, auth) => {
  const result = await listQueue(auth.supabase)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ items: result.data })
})
