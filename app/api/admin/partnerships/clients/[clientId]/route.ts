/**
 * GET /api/admin/partnerships/clients/{clientId} — the pipeline of one partnership.
 *
 * The five bands of the detail come from here in one answer: the proposal behind it, the
 * conference, the client and the contract, and every place with its pendency report and its
 * publish plan already resolved. The screen renders; it does not decide.
 */

import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { loadPartnershipDetail } from '@/lib/services/partnership-service'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const GET = withRateLimit(120, 60_000)(
  withAuth<{ clientId: string }>({ roles: ['admin'] }, async (_req, ctx, auth) => {
    const params = await ctx.params
    const clientId = params?.clientId
    if (!clientId || !UUID_PATTERN.test(clientId)) {
      return NextResponse.json({ error: 'invalid_client_id' }, { status: 400 })
    }

    const detail = await loadPartnershipDetail(clientId, auth.supabase)
    if (!detail) {
      return NextResponse.json({ error: 'partnership_not_found' }, { status: 404 })
    }

    return NextResponse.json({ detail })
  })
)
