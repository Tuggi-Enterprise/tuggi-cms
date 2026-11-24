/**
 * `GET /api/admin/social/overview?period=4w|12w|6m` (#1059): the recommendations of the latest week,
 * the four rankings of `social.own_media_ranking` and the daily funnel with the previous period.
 * Admin only; the reads run on the operator's session, under the RLS of `social.*`.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { readOverview, socialFailure } from '@/lib/social/repository'
import { DEFAULT_SOCIAL_PERIOD, isSocialPeriod } from '@/lib/social/time'

export const GET = withAuth({ roles: ['admin'] }, async (req, _ctx, { supabase }) => {
  const raw = new URL(req.url).searchParams.get('period')
  if (raw !== null && !isSocialPeriod(raw)) {
    return NextResponse.json({ error: { code: 'invalid_period' } }, { status: 400 })
  }
  try {
    return NextResponse.json(await readOverview(supabase, raw ?? DEFAULT_SOCIAL_PERIOD))
  } catch (err) {
    return socialFailure('overview', err)
  }
})
