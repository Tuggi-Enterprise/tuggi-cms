/**
 * `POST /api/admin/social/posts/[id]/cancel`: every network still `scheduled` or `failed` becomes
 * `canceled`; what is publishing or published is not touched (#1058). Admin only, on the
 * operator's session.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { cancelPost, socialFailure } from '@/lib/social/repository'
import { isUuid } from '@/lib/social/post'

export const POST = withAuth<{ id: string }>({ roles: ['admin'] }, async (_req, ctx, auth) => {
  const { id } = (await ctx.params) ?? { id: '' }
  if (!isUuid(id)) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 })
  try {
    const canceled = await cancelPost(auth.supabase, id)
    if (canceled === 0) return NextResponse.json({ error: { code: 'nothing_to_cancel' } }, { status: 409 })
    return NextResponse.json({ canceled })
  } catch (err) {
    return socialFailure('cancel', err)
  }
})
