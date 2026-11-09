/**
 * GET /api/admin/public-identity/lists — the reserved names (BR-USUARIO-050 item 7), the own
 * blocked and allowed terms (BR-USUARIO-051 items 2 and 2.d) and the LDNOOBW, read only (item 2,
 * written only by migrations). #1144. Admin only, `no-store`.
 */

import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { readFilterLists } from '@/lib/services/public-identity-moderation-service'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

export const GET = withRateLimit(60, 60_000)(
  withAuth({ roles: ['admin'] }, async () => {
    const lists = await readFilterLists()
    if (lists === null) return NextResponse.json({ error: 'lists_unavailable' }, { status: 503, headers: NO_STORE })
    return NextResponse.json(lists, { headers: NO_STORE })
  })
)
