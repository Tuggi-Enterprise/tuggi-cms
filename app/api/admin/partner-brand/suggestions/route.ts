/**
 * The partners' place suggestions waiting for the curator (#1261, BR-B2B-073 item 3.b; contract
 * `docs/contracts/tuggi-do-parceiro.md` §10.3).
 *
 * `GET  ?client_id=` → `{ suggestions: PlaceSuggestion[] }`, pending only, oldest first, each with
 *        the POIs around its pin. `client_id` narrows to one partner (the Marca tab of the record).
 * `POST` `{ suggestion_id, decision: 'link' | 'created' | 'refuse', attraction_id?, poi?, reason? }`
 *        → `{ decision, attraction_id }`: `partner.cms_decide_partner_pick_suggestion` with the
 *        session's user as `p_actor`, never the body's. `created` creates the POI first by the
 *        common path; if the decision then fails, the answer carries the `attraction_id` of the POI
 *        that stays in the usual review. `409 suggestion_not_pending` (TGB86) when someone answered
 *        or the partner cancelled meanwhile.
 *
 * `withAuth({ roles: ['admin'] })` is the whole gate (`/api/*` is outside the proxy matcher), then the
 * service role. Logs and the audit carry ids and the outcome only, never the reason.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import { logAuditEvent } from '@/lib/services/audit-service'
import { answerPlaceSuggestion, listPlaceSuggestions } from '@/lib/services/partner-brand-service'
import { isUuid, partnerBrandErrorStatus, type PartnerBrandError } from '@/lib/partner-brand/brand'
import { parseSuggestionDecision } from '@/lib/partner-brand/suggestions'

const NO_STORE = { 'Cache-Control': 'no-store' }

function refuse(error: PartnerBrandError, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ error, ...extra }, { status: partnerBrandErrorStatus(error) })
}

export const GET = withAuth({ roles: ['admin'] }, async (req) => {
  const raw = new URL(req.url).searchParams.get('client_id')
  if (raw !== null && !isUuid(raw)) return refuse({ code: 'invalid_client' })
  const read = await listPlaceSuggestions(getSupabaseService(), raw ? raw.toLowerCase() : null)
  if (!read.ok) return refuse(read.error)
  return NextResponse.json({ suggestions: read.value }, { headers: NO_STORE })
})

export const POST = withAuth({ roles: ['admin'] }, async (req, _ctx, auth) => {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return refuse({ code: 'invalid_body' })
  }
  const parsed = parseSuggestionDecision(body)
  if (!parsed.ok) return refuse(parsed.error)

  const answered = await answerPlaceSuggestion(getSupabaseService(), parsed.value, auth.user.id, auth.cmsUser.id)
  if (!answered.ok) return refuse(answered.error, answered.attraction_id ? { attraction_id: answered.attraction_id } : {})

  await logAuditEvent({
    request: req,
    action: 'DECIDE_PARTNER_PICK_SUGGESTION',
    entity: 'CLIENT',
    entityId: parsed.value.suggestion_id,
    userId: auth.user.id,
    userEmail: auth.user.email ?? null,
    description: `Partner place suggestion ${parsed.value.suggestion_id}: ${parsed.value.decision}${answered.value.attraction_id ? ` (POI ${answered.value.attraction_id})` : ''}`,
  })
  return NextResponse.json(answered.value)
})
