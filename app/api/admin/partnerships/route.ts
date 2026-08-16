/**
 * GET /api/admin/partnerships — the pipeline queue.
 *
 * It replaces nothing at the API layer: `/api/admin/partner-proposals/*` keeps serving the
 * proposal's own screens, which is where the conference, the promotion and the discard live.
 * What is new here is the JOIN nobody had done — proposal, client, contract and place in one
 * answer, so the queue can say which state each partnership is in without the operator holding
 * it in their head.
 *
 * The operator's client is handed to the service because `core.attractions` is read with the
 * identity on the screen — see the note at the top of `partnership-service.ts`.
 */

import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { loadPartnershipQueue } from '@/lib/services/partnership-service'

export const GET = withRateLimit(60, 60_000)(
  withAuth({ roles: ['admin'] }, async (_req, _ctx, auth) => {
    const rows = await loadPartnershipQueue(auth.supabase)
    return NextResponse.json({ partnerships: rows })
  })
)
