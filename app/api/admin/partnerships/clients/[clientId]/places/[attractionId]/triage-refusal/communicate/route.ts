/**
 * POST …/places/{attractionId}/triage-refusal/communicate — the act that STOPS THE CLOCK.
 *
 * WHY IT IS A ROUTE OF ITS OWN, and this is the whole point of the pair: BR-B2B-010, item 4,
 * promises that within 72 straight hours of the partnership's approval either the place is
 * published or the refusal WAS COMMUNICATED. BR-B2B-011, item 5, says the same thing from the
 * other side — "a recusa comunicada encerra o prazo". Deciding and telling are two acts by the
 * rule, so they are two acts on the screen and two routes here. One click doing both would stop
 * the clock of a partner nobody has told, which is precisely the failure the `data` wrote into
 * `COMMENT ON COLUMN partner.partner_triage_refusals.communicated_at`.
 *
 * IT DOES NOT SEND ANYTHING. There is no channel here, and the CMS has no partner e-mail path:
 * the operator communicates the refusal by whatever channel the `design` owns, and this route
 * records that it happened. Naming it `communicate` and having it send nothing is the only
 * honest reading of a stamp that says "this was told" — the copy on the screen says so too.
 *
 * WRITE-ONCE, AND THE DATABASE IS WHAT SAYS SO. The UPDATE is narrowed to
 * `communicated_at IS NULL` and the outcome is decided by ROWS AFFECTED, not by reading first
 * and writing after: two operators clicking at the same time is a race, and `409` for the loser
 * is the correct answer rather than a second timestamp. `core.tg_partner_triage_refusal_guard`
 * (SQLSTATE `TGB11`) is the belt behind that brace.
 */

import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { logAuditEvent } from '@/lib/services/audit-service'
import { triageRefusalService } from '@/lib/core/triage-refusal-service'
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

      // WHICH refusal, explicitly. The current one is derivable, and deriving it here would
      // stamp a round the operator was not looking at when a second one arrived meanwhile.
      const refusalId = typeof body.refusalId === 'string' ? body.refusalId : ''
      if (!UUID_PATTERN.test(refusalId)) {
        return NextResponse.json({ error: 'invalid_refusal_id' }, { status: 400 })
      }

      const place = await loadPartnerPlace(clientId, attractionId, auth.supabase)
      if (!place) {
        return NextResponse.json({ error: 'place_not_linked' }, { status: 404 })
      }

      let outcome
      try {
        outcome = await triageRefusalService.markCommunicated(refusalId, attractionId)
      } catch (error) {
        console.error('[partnerships] triage communication write refused:', error)
        return NextResponse.json({ error: 'write_failed' }, { status: 503 })
      }

      if (outcome.outcome === 'not_found') {
        return NextResponse.json({ error: 'refusal_not_found' }, { status: 404 })
      }
      if (outcome.outcome === 'already_communicated') {
        // Not an error the operator caused: the job is done, and the screen says so instead of
        // offering the act again.
        return NextResponse.json(
          { error: 'already_communicated', communicatedAt: outcome.row?.communicated_at ?? null },
          { status: 409 }
        )
      }

      await logAuditEvent({
        request: req,
        action: 'COMMUNICATE_PARTNER_PLACE_TRIAGE_REFUSAL',
        entity: 'POI',
        entityId: attractionId,
        userId: auth.user.id,
        userEmail: auth.user.email ?? null,
        description: `Triage refusal ${refusalId} of partner place ${attractionId} (client ${clientId}) recorded as communicated — the 72h deadline of BR-B2B-010 item 4 ends here`,
      })

      const after = await loadPartnerPlace(clientId, attractionId, auth.supabase)
      return NextResponse.json({ ok: true, place: after ?? place })
    }
  )
)
