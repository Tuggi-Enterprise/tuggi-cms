import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { isUuid } from '@/lib/routes/route-revisions'
import { approveRevision } from '@/lib/services/route-revision-service'

export const dynamic = 'force-dynamic'
// The translation of the approved text (route and annotations) runs inside this request.
export const maxDuration = 300

type Params = { revisionId: string }

/**
 * POST /api/route-revisions/[revisionId]/approve (#1106, BR-ROTA-006 item 3). The ONLY approval of a
 * user route version: `core.approve_route_revision`, never `core.upsert_custom_route` with
 * `p_status`. Then `generate-translated-audio` when the approved text needs it (contract, item 4).
 * Admin only.
 */
export const POST = withAuth<Params>({ roles: ['admin'] }, async (_req, ctx, auth) => {
  const { revisionId } = (await ctx.params) as Params
  if (!isUuid(revisionId)) return NextResponse.json({ error: 'invalid_revision_id' }, { status: 400 })
  // Only READS the access token to hand it to the Edge Function: withAuth already revalidated it with getUser().
  const { data: { session } } = await auth.supabase.auth.getSession()
  const result = await approveRevision(auth.supabase, revisionId, session?.access_token ?? null)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result.data)
})
