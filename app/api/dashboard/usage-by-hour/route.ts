/**
 * GET /api/dashboard/usage-by-hour: when the app is in use, hour by hour and day by day (#1204).
 *
 * `core.dashboard_usage_by_hour` reads `drive.user_location_history`, the table of the live map.
 * It returns aggregates only, but the function asserts platform admin, so the route says the same
 * thing before the call: admin only, with the operator's own JWT (contract banco-para-cms Parte 30).
 *
 * A failed RPC is a 502 with the message, never an empty payload: 24 hours of zero would claim
 * that nobody used the app.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { readBoundedInt } from '@/lib/api/query-params'

export const dynamic = 'force-dynamic'

/** One day to one month, the bounds the function itself clamps to; the widget asks for 7 or 30. */
const DAYS = { fallback: 7, min: 1, max: 31 }

export const GET = withAuth({ roles: ['admin'] }, async (req: NextRequest, _ctx, auth) => {
  const days = readBoundedInt(new URL(req.url).searchParams, 'days', DAYS)

  const { data, error } = await auth.supabase.schema('core').rpc('dashboard_usage_by_hour', { days })

  if (error) {
    console.error('[dashboard/usage-by-hour] rpc failed:', error.message)
    return NextResponse.json({ error: error.message, code: error.code }, { status: 502 })
  }

  return NextResponse.json({ data })
})
