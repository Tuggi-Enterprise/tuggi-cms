import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { isUuid } from '@/lib/routes/route-revisions'
import { getRevisionDetail } from '@/lib/services/route-revision-service'

export const dynamic = 'force-dynamic'

type Params = { revisionId: string }

/**
 * GET /api/route-revisions/[revisionId] : one version for the curator (#1106): its content, the
 * version on the air and the diff between them, the joined line with the uncovered stretches
 * (BR-ROTA-008 item 7), signed photo URLs, and the POIs around each annotation (BR-ROTA-009). Admin only.
 */
export const GET = withAuth<Params>({ roles: ['admin'] }, async (_req, ctx, auth) => {
  const { revisionId } = (await ctx.params) as Params
  if (!isUuid(revisionId)) return NextResponse.json({ error: 'invalid_revision_id' }, { status: 400 })
  const result = await getRevisionDetail(auth.supabase, revisionId)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  if (!result.data) return NextResponse.json({ error: 'revision_not_found' }, { status: 404 })
  return NextResponse.json(result.data)
})
