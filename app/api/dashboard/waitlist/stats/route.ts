/**
 * GET /api/dashboard/waitlist/stats — aggregates of core.region_waitlist.
 *
 * SEC-37. 55 measured anon calls. Admin only, operator's own JWT.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'

export const dynamic = 'force-dynamic'

export const GET = withAuth({ roles: ['admin'] }, async (_req, _ctx, auth) => {
  const { data, error } = await auth.supabase.schema('core').rpc('dashboard_waitlist_stats')

  if (error) {
    console.error('[dashboard/waitlist/stats] rpc failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 502 })
  }

  return NextResponse.json({ data })
})
