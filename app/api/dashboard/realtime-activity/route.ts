/**
 * GET /api/dashboard/realtime-activity — who is on the road right now.
 *
 * SEC-37. The heaviest anon caller of the seven (68 measured calls): the RPC
 * returns user ids with latitude and longitude, and it was reachable from any
 * browser holding the publishable key. Admin only, operator's own JWT.
 *
 * `windowSeconds` is the presence window used by `core.dashboard_realtime_activity`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { readBoundedInt } from '@/lib/api/query-params'

export const dynamic = 'force-dynamic'

/** One minute to one day: the radar is a live view, not a history query. */
const WINDOW_SECONDS = { fallback: 120, min: 60, max: 86_400 }

export const GET = withAuth({ roles: ['admin'] }, async (req: NextRequest, _ctx, auth) => {
  const params = new URL(req.url).searchParams
  const windowSeconds = readBoundedInt(params, 'windowSeconds', WINDOW_SECONDS)

  const { data, error } = await auth.supabase
    .schema('core')
    .rpc('dashboard_realtime_activity', { window_seconds: windowSeconds })

  if (error) {
    console.error('[dashboard/realtime-activity] rpc failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 502 })
  }

  return NextResponse.json({ data })
})
