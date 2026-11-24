/**
 * GET /api/dashboard/returning-users: people with the app sending location, month by month, split
 * into their first month and returning (#1204).
 *
 * `core.dashboard_monthly_returning_users` asserts platform admin; the route says the same thing
 * before the call, with the operator's own JWT (contract banco-para-cms Parte 30).
 *
 * A failed RPC is a 502 with the message, never an empty list: twelve empty months would read as
 * "nobody used the app".
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { readBoundedInt } from '@/lib/api/query-params'

export const dynamic = 'force-dynamic'

/** One month to two years, the bounds the function itself clamps to; the widget asks for 12. */
const MONTHS = { fallback: 12, min: 1, max: 24 }

export const GET = withAuth({ roles: ['admin'] }, async (req: NextRequest, _ctx, auth) => {
  const months = readBoundedInt(new URL(req.url).searchParams, 'months', MONTHS)

  const { data, error } = await auth.supabase.schema('core').rpc('dashboard_monthly_returning_users', { months })

  if (error) {
    console.error('[dashboard/returning-users] rpc failed:', error.message)
    return NextResponse.json({ error: error.message, code: error.code }, { status: 502 })
  }

  return NextResponse.json({ data })
})
