/**
 * `GET /api/admin/social/posts` (#1059): every post of our account, newest first, with the last
 * `media_metrics` row of each. Admin only; the read runs on the operator's session (RLS of `social.*`).
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { readPosts, socialFailure } from '@/lib/social/repository'

export const GET = withAuth({ roles: ['admin'] }, async (_req, _ctx, { supabase }) => {
  try {
    return NextResponse.json(await readPosts(supabase))
  } catch (err) {
    return socialFailure('posts', err)
  }
})
