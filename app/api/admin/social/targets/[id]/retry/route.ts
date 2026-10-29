/**
 * `POST /api/admin/social/targets/[id]/retry`: a `failed` network goes back to `scheduled`, and the
 * next cron tick takes it (the post's `scheduled_at` is already past and is not touched). Any other
 * status answers 409 (#1058). Admin only, on the operator's session.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { retryTarget, socialFailure } from '@/lib/social/repository'
import { isUuid } from '@/lib/social/post'

export const POST = withAuth<{ id: string }>({ roles: ['admin'] }, async (_req, ctx, auth) => {
  const { id } = (await ctx.params) ?? { id: '' }
  if (!isUuid(id)) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 })
  try {
    if (!(await retryTarget(auth.supabase, id))) {
      return NextResponse.json({ error: { code: 'not_failed' } }, { status: 409 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return socialFailure('retry', err)
  }
})
