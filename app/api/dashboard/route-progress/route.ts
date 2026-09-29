/**
 * GET /api/dashboard/route-progress — who started, is in progress and completed each route (#794).
 *
 *   no parameter   → `{ data: { summary } }`, one row per route with progress
 *   `?routeId=`    → `{ data: { users } }`, one row per user on that route
 *
 * THE CLIENT IS THE SESSION ONE (`auth.supabase`), NOT THE SERVICE KEY. Both RPCs open with
 * `core.assert_platform_admin()`, which anchors on the caller's JWT `sub`: with the service key
 * there is no caller and the answer is `42501`. `withAuth({ roles: ['admin'] })` is the CMS gate;
 * the RPC body is the database's, and both must agree.
 *
 * `email` IS DROPPED HERE. The users RPC returns it, and BR-USUARIO-042 item 1 says no CMS surface
 * shows a tourist's e-mail — the only exception is the manual grant. Dropping it on the server,
 * not in the component, keeps it out of the browser's network tab too.
 *
 * `routeId` is validated as a uuid before it reaches PostgREST.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { UUID } from '@/lib/finance/input'
import type { RouteProgressSummaryRow, RouteProgressUserRow } from '@/lib/routes/route-progress'

export const dynamic = 'force-dynamic'

export const GET = withAuth({ roles: ['admin'] }, async (req: NextRequest, _ctx, auth) => {
  const routeId = new URL(req.url).searchParams.get('routeId')

  if (routeId === null) {
    const { data, error } = await auth.supabase
      .schema('core')
      .rpc('admin_get_custom_route_progress_summary', { p_route_id: null })

    if (error) {
      console.error('[dashboard/route-progress] summary failed:', error.message)
      return NextResponse.json({ error: error.message, code: error.code }, { status: 502 })
    }

    return NextResponse.json({ data: { summary: (data ?? []) as RouteProgressSummaryRow[] } })
  }

  if (!UUID.test(routeId)) {
    return NextResponse.json({ error: 'routeId must be a uuid' }, { status: 400 })
  }

  const { data, error } = await auth.supabase
    .schema('core')
    .rpc('admin_get_custom_route_progress_users', { p_route_id: routeId })

  if (error) {
    console.error('[dashboard/route-progress] users failed:', error.message)
    return NextResponse.json({ error: error.message, code: error.code }, { status: 502 })
  }

  const users: RouteProgressUserRow[] = ((data ?? []) as Array<RouteProgressUserRow & { email?: unknown }>).map(
    ({ email: _email, ...row }) => row
  )

  return NextResponse.json({ data: { users } })
})
