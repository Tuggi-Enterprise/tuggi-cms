/**
 * POST /api/admin/partnerships/clients/{clientId}/places/{attractionId}/publish — the 4 → 5
 * act, and the 5 → 4 one.
 *
 * WHAT IT WRITES IS ONE COLUMN, `core.attractions.approved`, through `placeService.setApproved`
 * — criterion 18. Nothing on this path can reach `commission_rate`, `monthly_fee_cents`,
 * `is_courtesy`, the client's `status` or the `slug`, and it is not a denylist that keeps them
 * out: there is no patch object here for a second key to be added to.
 *
 * THE PLAN IS REBUILT FROM THE DATABASE, exactly like the promotion route. The panel's plan is
 * a rendering; this one is the decision. That is what makes DS-COMPONENTE-021, point 2, real
 * rather than cosmetic: a request that would start a monthly fee the record does not declare
 * is refused here, where no crafted body can talk it round. Refusing the CONFIRMATION is not
 * refusing the place — BR-B2B-011's preamble is explicit that no software turns a partner's
 * place down, and the way out is registering the fee or the courtesy with its reason
 * (BR-B2B-017, item 6).
 *
 * TAKING IT OUT OF THE APP IS NEVER REFUSED. It writes `approved = false` and it says, in the
 * confirmation, exactly what is written and nothing more: BR-B2B-018 says when the fee STARTS
 * and no rule describes what happens when the POI leaves the air (spec §9, question 1).
 *
 * IDEMPOTENT AT THE DESTINATION. Publishing the same place twice is the same state, which is
 * why the screen may offer `Tentar de novo` after a network error (DS-COMPONENTE-021, 2nd edge
 * case) — the guarantee lives in the single-column UPDATE, not in a token in the body.
 */

import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { logAuditEvent } from '@/lib/services/audit-service'
import { placeService } from '@/lib/core/place-service'
import { loadPartnerPlace } from '@/lib/services/partnership-service'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const POST = withRateLimit(30, 60_000)(
  withAuth<{ clientId: string; attractionId: string }>(
    { roles: ['admin'] },
    async (req, ctx, auth) => {
      const params = await ctx.params
      const clientId = params?.clientId
      const attractionId = params?.attractionId

      if (!clientId || !UUID_PATTERN.test(clientId)) {
        return NextResponse.json({ error: 'invalid_client_id' }, { status: 400 })
      }
      if (!attractionId || !UUID_PATTERN.test(attractionId)) {
        return NextResponse.json({ error: 'invalid_place_id' }, { status: 400 })
      }

      let body: Record<string, unknown>
      try {
        body = (await req.json()) as Record<string, unknown>
      } catch {
        return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
      }

      if (typeof body.approved !== 'boolean') {
        return NextResponse.json({ error: 'invalid_approved' }, { status: 400 })
      }
      const approved = body.approved

      // The place has to BE this client's. Anything else is a place with no partner behind it,
      // and this route is not the Places screen (BR-CMS-002: possession is
      // `attractions.partner_client_id`, never `owner_id` and never `created_by`).
      const before = await loadPartnerPlace(clientId, attractionId, auth.supabase)
      if (!before) {
        return NextResponse.json({ error: 'place_not_linked' }, { status: 404 })
      }

      if (approved && !before.plan.offersAct) {
        return NextResponse.json(
          { error: 'publish_not_offered', variant: before.plan.variant },
          { status: 409 }
        )
      }

      try {
        await placeService.setApproved(attractionId, approved, auth.supabase)
      } catch (error) {
        console.error('[partnerships] place approval write refused:', error)
        return NextResponse.json({ error: 'write_failed' }, { status: 503 })
      }

      await logAuditEvent({
        request: req,
        action: approved ? 'PUBLISH_PARTNER_PLACE' : 'UNPUBLISH_PARTNER_PLACE',
        entity: 'POI',
        entityId: attractionId,
        userId: auth.user.id,
        userEmail: auth.user.email ?? null,
        description: approved
          ? `Partner place ${attractionId} of client ${clientId} published (variant ${before.plan.variant}, billing ${before.plan.startsBilling ? 'starts' : 'does not start'})`
          : `Partner place ${attractionId} of client ${clientId} taken out of the app`,
      })

      const after = await loadPartnerPlace(clientId, attractionId, auth.supabase)
      return NextResponse.json({ ok: true, place: after ?? before })
    }
  )
)
