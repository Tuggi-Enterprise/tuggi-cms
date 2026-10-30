/**
 * `GET /api/admin/social/markets` (#1064, spec M3 and M8 item 3): what works in each market, the
 * dense matrix of format, theme and weekday by Brasil, EUA and Europa over the competitors' posts of
 * the last `MARKET_WINDOW_DAYS`. Admin only; the reads run on the operator's session.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { readMarkets, socialFailure } from '@/lib/social/repository'

export const GET = withAuth({ roles: ['admin'] }, async (_req, _ctx, { supabase }) => {
  try {
    return NextResponse.json(await readMarkets(supabase))
  } catch (err) {
    return socialFailure('markets', err)
  }
})
