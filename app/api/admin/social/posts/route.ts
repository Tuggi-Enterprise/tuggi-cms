/**
 * `GET /api/admin/social/posts?month=AAAA-MM`: the posts of one Brasília month, with media and
 * targets, for the calendar, the list and the filter counts at once (#1058).
 *
 * Admin only (`withAuth`); `/api/*` is outside the proxy matcher, so this is the whole route gate.
 * The read runs on the operator's session, so the RLS of `social.*` is the second gate.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { monthBounds, parseMonthKey } from '@/lib/social/time'
import { listPosts, socialFailure } from '@/lib/social/repository'

export const GET = withAuth({ roles: ['admin'] }, async (req, _ctx, auth) => {
  const month = parseMonthKey(req.nextUrl.searchParams.get('month'))
  if (!month) return NextResponse.json({ error: { code: 'invalid_month' } }, { status: 400 })

  const { start, end } = monthBounds(month)
  try {
    return NextResponse.json({ posts: await listPosts(auth.supabase, start, end) })
  } catch (err) {
    return socialFailure('list', err)
  }
})
