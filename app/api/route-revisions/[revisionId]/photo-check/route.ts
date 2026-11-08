import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { isUuid } from '@/lib/routes/route-revisions'
import { checkRevisionPhotos } from '@/lib/services/route-revision-service'

export const dynamic = 'force-dynamic'

type Params = { revisionId: string }

/**
 * POST /api/route-revisions/[revisionId]/photo-check (#1106, BR-ROTA-006 item 3): the automatic
 * screening of the version's photos by the Edge Function `moderate-route-photos`. A flagged photo is
 * shown marked; it blocks nothing. The Google Cloud Vision key lives only in the function. Admin only.
 */
export const POST = withAuth<Params>({ roles: ['admin'] }, async (_req, ctx, auth) => {
  const { revisionId } = (await ctx.params) as Params
  if (!isUuid(revisionId)) return NextResponse.json({ error: 'invalid_revision_id' }, { status: 400 })
  // Only READS the access token to hand it to the Edge Function: withAuth already revalidated it with getUser().
  const { data: { session } } = await auth.supabase.auth.getSession()
  if (!session?.access_token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const result = await checkRevisionPhotos(revisionId, session.access_token)
  return NextResponse.json(result.body, { status: result.status })
})
