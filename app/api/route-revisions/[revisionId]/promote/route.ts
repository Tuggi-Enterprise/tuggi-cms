import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { isUuid, parsePromotion } from '@/lib/routes/route-revisions'
import { promoteAnnotation } from '@/lib/services/route-revision-service'

export const dynamic = 'force-dynamic'

type Params = { revisionId: string }

/**
 * POST /api/route-revisions/[revisionId]/promote (#1106, BR-ROTA-009): one annotation of the version
 * becomes a POI through `core.promote_annotation_to_poi`, born `approved = false` (the usual POI
 * review follows), with the author's text as the curator corrected it. Body `{ annotationId, name,
 * description, city, country, state?, photoKey? }`. Admin only.
 */
export const POST = withAuth<Params>({ roles: ['admin'] }, async (req: NextRequest, ctx, auth) => {
  const { revisionId } = (await ctx.params) as Params
  if (!isUuid(revisionId)) return NextResponse.json({ error: 'invalid_revision_id' }, { status: 400 })
  const parsed = parsePromotion(await req.json().catch(() => null))
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const result = await promoteAnnotation(auth.supabase, revisionId, parsed.input)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result.data)
})
