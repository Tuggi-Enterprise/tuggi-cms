/**
 * POST /api/admin/partnerships/clients/{clientId}/places — `Criar o local a partir da proposta`.
 *
 * IT DOES NOT IMPLEMENT ANYTHING. It calls `provisionPartnerPlace`, the same function the
 * partner approval runs (#360): the place is created from what the partner wrote in the form
 * (`buildPlacePrefill`) and linked by `core.attractions.partner_client_id`, in the curation
 * state. A second prefill on this path would be the second implementation of one decision, and
 * the two would drift on the first field somebody adds (CLAUDE.md §6).
 *
 * WHY THE ROUTE EXISTS AT ALL, given the approval already does it: the approval only fires
 * once, and the 10 clients that predate the form — plus any client approved before #360 — have
 * no place behind them. This is the button the empty state of band 4 offers.
 *
 * It is idempotent by the same guard the approval uses: a client that already has a linked
 * place answers `already_provisioned` and creates nothing. It APPROVES nothing — the place is
 * born `approved = false`, which is the whole of BR-B2B-011: the triage is a human decision.
 */

import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { logAuditEvent } from '@/lib/services/audit-service'
import { provisionPartnerPlace } from '@/lib/services/partner-place-provisioning'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const POST = withRateLimit(20, 60_000)(
  withAuth<{ clientId: string }>({ roles: ['admin'] }, async (req, ctx, auth) => {
    const params = await ctx.params
    const clientId = params?.clientId
    if (!clientId || !UUID_PATTERN.test(clientId)) {
      return NextResponse.json({ error: 'invalid_client_id' }, { status: 400 })
    }

    const outcome = await provisionPartnerPlace(clientId, auth.supabase)

    if (outcome.status === 'failed') {
      console.error('[partnerships] place provisioning failed:', outcome.reason)
      return NextResponse.json({ error: outcome.reason, place: outcome }, { status: 503 })
    }

    if (outcome.status === 'created') {
      await logAuditEvent({
        request: req,
        action: 'CREATE_PARTNER_PLACE',
        entity: 'POI',
        entityId: outcome.attractionId,
        userId: auth.user.id,
        userEmail: auth.user.email ?? null,
        description: `Partner place ${outcome.attractionId} created from the proposal of client ${clientId}, from the partnership pipeline`,
      })
    }

    return NextResponse.json({ ok: true, place: outcome })
  })
)
