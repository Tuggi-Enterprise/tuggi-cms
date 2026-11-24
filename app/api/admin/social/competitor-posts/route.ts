/**
 * `GET /api/admin/social/competitor-posts?week=YYYY-MM-DD` (#1062, spec R2.1): the ten best posts of
 * the competitors in one week (Monday to Sunday, Brasília), by `social.competitor_top_posts`. Without
 * `week`, the last closed week. Only the weeks the screen offers are accepted (the four closed ones
 * and the current one). Admin only; the read runs on the operator's session (RLS of `social.*`).
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { readCompetitorPosts, socialFailure } from '@/lib/social/repository'

const DAY = /^\d{4}-\d{2}-\d{2}$/

export const GET = withAuth({ roles: ['admin'] }, async (req, _ctx, { supabase }) => {
  const week = new URL(req.url).searchParams.get('week')
  if (week !== null && !DAY.test(week)) return NextResponse.json({ error: { code: 'invalid_week' } }, { status: 400 })
  try {
    const payload = await readCompetitorPosts(supabase, week)
    if (!payload) return NextResponse.json({ error: { code: 'invalid_week' } }, { status: 400 })
    return NextResponse.json(payload)
  } catch (err) {
    return socialFailure('competitor_posts', err)
  }
})
