/**
 * GET /api/dashboard/inventory-funnel — core/homolog inventory funnel.
 *
 * SEC-37. Admin only, operator's own JWT.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'

export const dynamic = 'force-dynamic'

export const GET = withAuth({ roles: ['admin'] }, async (_req, _ctx, auth) => {
  const { data, error } = await auth.supabase.schema('core').rpc('dashboard_inventory_funnel')

  if (error) {
    console.error('[dashboard/inventory-funnel] rpc failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 502 })
  }

  return NextResponse.json({ data })
})
