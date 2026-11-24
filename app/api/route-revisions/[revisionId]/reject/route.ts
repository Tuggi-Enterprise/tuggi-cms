import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { isUuid, parseRejectReason } from '@/lib/routes/route-revisions'
import { rejectRevision } from '@/lib/services/route-revision-service'

export const dynamic = 'force-dynamic'

type Params = { revisionId: string }

/**
 * POST /api/route-revisions/[revisionId]/reject : body `{ reason }` (#1106, BR-ROTA-006 item 3).
 * The reason is required (1 to 1,000 characters) and reaches the author as written. A blank reason
 * is refused here, before any call, and by the database again (TGW04). Admin only. After the
 * refusal, the author gets a generic push without the reason (#1120); its failure changes nothing here.
 */
export const POST = withAuth<Params>({ roles: ['admin'] }, async (req: NextRequest, ctx, auth) => {
  const { revisionId } = (await ctx.params) as Params
  if (!isUuid(revisionId)) return NextResponse.json({ error: 'invalid_revision_id' }, { status: 400 })
  const body = await req.json().catch(() => null)
  const reason = parseRejectReason((body as { reason?: unknown } | null)?.reason)
  if (!reason.ok) return NextResponse.json({ error: reason.error }, { status: 400 })
  // Only READS the access token to hand it to the push Edge Function: withAuth already revalidated it with getUser().
  const { data: { session } } = await auth.supabase.auth.getSession()
  const result = await rejectRevision(auth.supabase, revisionId, reason.reason, session?.access_token ?? null)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result.data)
})
