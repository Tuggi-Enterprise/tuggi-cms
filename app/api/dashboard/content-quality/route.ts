/**
 * GET /api/dashboard/content-quality — language coverage of the catalogue.
 *
 * SEC-37. Admin only, operator's own JWT. Slim read used by the catalog report;
 * the Overview gets the same RPC through `/api/dashboard/overview`.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'

export const dynamic = 'force-dynamic'

export const GET = withAuth({ roles: ['admin'] }, async (_req, _ctx, auth) => {
  const { data, error } = await auth.supabase.schema('core').rpc('dashboard_content_quality')

  if (error) {
    console.error('[dashboard/content-quality] rpc failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 502 })
  }

  return NextResponse.json({ data })
})
