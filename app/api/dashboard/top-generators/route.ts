/**
 * GET /api/dashboard/top-generators — who authored the most content.
 *
 * SEC-37. The rows carry a user id and a nickname, so this is a read about people.
 * Admin only, operator's own JWT.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { readBoundedInt } from '@/lib/api/query-params'

export const dynamic = 'force-dynamic'

const LIMIT = { fallback: 10, min: 1, max: 100 }

export const GET = withAuth({ roles: ['admin'] }, async (req: NextRequest, _ctx, auth) => {
  const limit = readBoundedInt(new URL(req.url).searchParams, 'limit', LIMIT)

  const { data, error } = await auth.supabase
    .schema('core')
    .rpc('dashboard_top_generators', { limit_count: limit })

  if (error) {
    console.error('[dashboard/top-generators] rpc failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 502 })
  }

  return NextResponse.json({ data })
})
