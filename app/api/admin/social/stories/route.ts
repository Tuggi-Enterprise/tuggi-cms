/**
 * `GET /api/admin/social/stories?days=14` (#1062, spec R2.6): our stories of the last `days` days,
 * newest first, from `social.recent_stories`, with when the hourly job last ran. Admin only; the read
 * runs on the operator's session (RLS of `social.*`).
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { STORY_DAYS_DEFAULT, STORY_DAYS_MAX, readStories, socialFailure } from '@/lib/social/repository'

export const GET = withAuth({ roles: ['admin'] }, async (req, _ctx, { supabase }) => {
  const raw = new URL(req.url).searchParams.get('days')
  const days = raw === null ? STORY_DAYS_DEFAULT : Number(raw)
  if (!Number.isInteger(days) || days < 1 || days > STORY_DAYS_MAX) {
    return NextResponse.json({ error: { code: 'invalid_days' } }, { status: 400 })
  }
  try {
    return NextResponse.json(await readStories(supabase, days))
  } catch (err) {
    return socialFailure('stories', err)
  }
})
