/**
 * GET /api/dashboard/waitlist/pins — demand pins for the geography report.
 *
 * SEC-37. 54 measured anon calls, and the payload is a location per person who
 * asked for a region. Admin only, operator's own JWT.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { readBoolean, readBoundedInt } from '@/lib/api/query-params'

export const dynamic = 'force-dynamic'

/** The map draws at most a few thousand pins; the ceiling is what the screen can use. */
const LIMIT = { fallback: 5_000, min: 1, max: 20_000 }

export const GET = withAuth({ roles: ['admin'] }, async (req: NextRequest, _ctx, auth) => {
  const params = new URL(req.url).searchParams

  const { data, error } = await auth.supabase.schema('core').rpc('dashboard_waitlist_pins', {
    p_limit: readBoundedInt(params, 'limit', LIMIT),
    p_only_pending: readBoolean(params, 'onlyPending', true),
  })

  if (error) {
    console.error('[dashboard/waitlist/pins] rpc failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 502 })
  }

  return NextResponse.json({ data })
})
