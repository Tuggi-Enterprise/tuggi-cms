/**
 * POST /api/admin/partnerships/clients/{clientId}/places/{attractionId}/registration —
 * `Puxar dados do cadastro` (#885).
 *
 * The same act the link runs right after linking (`mergeRegistrationIntoPlace`, BR-B2B-033 item 5),
 * for a place that is ALREADY linked — the clients linked before #885 carry none of what they
 * filled in. Idempotent: running it twice writes the same values and the description never writes
 * over one, so there is no confirmation step.
 *
 * The outcome is DATA (`PartnerPlaceOutcome`) with 200, never a 500: the screen tells the operator
 * what came in, what was not there to bring, and what failed. Written with the operator's session —
 * `cms_set_attraction_coordinate` and the description RPC gate on the CMS editor's JWT.
 */

import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { logAuditEvent } from '@/lib/services/audit-service'
import { mergeRegistrationIntoPlace } from '@/lib/services/partner-place-provisioning'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const POST = withRateLimit(20, 60_000)(
  withAuth<{ clientId: string; attractionId: string }>({ roles: ['admin'] }, async (req, ctx, auth) => {
    const params = await ctx.params
    const clientId = params?.clientId
    const attractionId = params?.attractionId
    if (!clientId || !UUID_PATTERN.test(clientId)) {
      return NextResponse.json({ error: 'invalid_client_id' }, { status: 400 })
    }
    if (!attractionId || !UUID_PATTERN.test(attractionId)) {
      return NextResponse.json({ error: 'invalid_attraction_id' }, { status: 400 })
    }

    const outcome = await mergeRegistrationIntoPlace(clientId, attractionId, auth.supabase)

    if (outcome.status === 'merged') {
      await logAuditEvent({
        request: req,
        action: 'PULL_PARTNER_REGISTRATION',
        entity: 'POI',
        entityId: attractionId,
        userId: auth.user.id,
        userEmail: auth.user.email ?? null,
        description:
          `Registration of client ${clientId} merged into ${attractionId} ` +
          `(prefill: ${outcome.prefill}, description: ${outcome.description})`,
      })
    }

    return NextResponse.json({ outcome })
  })
)
