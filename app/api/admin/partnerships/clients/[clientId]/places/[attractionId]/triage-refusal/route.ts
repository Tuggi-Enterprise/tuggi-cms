/**
 * POST /api/admin/partnerships/clients/{clientId}/places/{attractionId}/triage-refusal — the
 * other outcome of the triage: the refusal (BR-B2B-011).
 *
 * IT REGISTERS A HUMAN DECISION AND MAKES NONE. BR-B2B-011's preamble is explicit — *"quem
 * decide quem entra é operador, nao o sistema"* — so there is no gate evaluated here, no
 * heuristic and no automatic refusal. What arrives is which gate refused (1 to 3, the order the
 * rule numbers them) and what was missing, in the words that will be communicated (item 4: the
 * gate alone is "not approved", which the rule forbids).
 *
 * IT WRITES ONE ROW IN ONE TABLE. `partner.partner_triage_refusals` and nothing else: refusing the
 * place does NOT end the partnership (BR-B2B-010, 6th edge case) and takes no POI out of the
 * catalogue (BR-B2B-027, item 3). There is no path from this handler to `partner.clients` or to
 * `core.attractions`, and that is by construction rather than by review.
 *
 * IT DOES NOT COMMUNICATE ANYTHING. `communicated_at` is stamped by the sibling route, because
 * BR-B2B-010, item 4, stops the 72h clock at the COMMUNICATION and not at the decision — one
 * click doing both would stop a clock for a partner nobody has told.
 *
 * `decided_by` COMES FROM THE SESSION, never from the body: it is the attributable trail of
 * BR-B2B-029/-030, and a body-supplied author is not a trail.
 *
 * NOT IDEMPOTENT, and it must not be: the table is append-only and many rows per place are the
 * design (BR-B2B-011, item 5 — re-applying reopens the triage). Two rounds are two refusals, and
 * the one in force is the newest.
 */

import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { logAuditEvent } from '@/lib/services/audit-service'
import { triageRefusalService } from '@/lib/core/triage-refusal-service'
import { loadPartnerPlace } from '@/lib/services/partnership-service'
import { isTriageGate } from '@/lib/partnerships/triage'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The reason is what was said to the partner, not an essay. The cap is a bound on the write and
 * not a rule — `reason` is `text` with only a non-empty CHECK behind it, and an unbounded field
 * on a route that writes is an unbounded row.
 */
const REASON_MAX_LENGTH = 2000

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

      if (!isTriageGate(body.gate)) {
        return NextResponse.json({ error: 'invalid_gate' }, { status: 400 })
      }
      const gate = body.gate

      const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
      if (reason.length === 0) {
        // BR-B2B-011, item 4: the refusal says which gate AND what was missing. A blank reason
        // would make the row say "not approved", which the rule forbids — and the CHECK on the
        // column would refuse it anyway, with a message written for a developer.
        return NextResponse.json({ error: 'invalid_reason' }, { status: 400 })
      }
      if (reason.length > REASON_MAX_LENGTH) {
        return NextResponse.json({ error: 'reason_too_long' }, { status: 400 })
      }

      // The place has to BE this client's — the same gate the publish route applies, for the
      // same reason (BR-CMS-002: possession is `attractions.partner_client_id`).
      const place = await loadPartnerPlace(clientId, attractionId, auth.supabase)
      if (!place) {
        return NextResponse.json({ error: 'place_not_linked' }, { status: 404 })
      }

      // A place already in front of tourists is not refused at triage: BR-B2B-027, item 3, is
      // explicit that gate 3 is about ENTRY and never about removing what is already on air. The
      // way out of a published place is `Tirar do app`, which is the publish route and says only
      // what is written.
      if (place.readiness.published) {
        return NextResponse.json({ error: 'place_already_published' }, { status: 409 })
      }

      try {
        await triageRefusalService.register({
          attractionId,
          gate,
          reason,
          decidedBy: auth.user.id,
        })
      } catch (error) {
        console.error('[partnerships] triage refusal write refused:', error)
        return NextResponse.json({ error: 'write_failed' }, { status: 503 })
      }

      await logAuditEvent({
        request: req,
        action: 'REFUSE_PARTNER_PLACE_AT_TRIAGE',
        entity: 'POI',
        entityId: attractionId,
        userId: auth.user.id,
        userEmail: auth.user.email ?? null,
        // The gate, never the reason: the reason is the operator's free text and the audit row
        // is not where a copy of it belongs — `partner.partner_triage_refusals` holds it, once.
        description: `Partner place ${attractionId} of client ${clientId} refused at triage (gate ${gate})`,
      })

      const after = await loadPartnerPlace(clientId, attractionId, auth.supabase)
      return NextResponse.json({ ok: true, place: after ?? place }, { status: 201 })
    }
  )
)
