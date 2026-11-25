/**
 * The curator's acts on a partner message (#1264, BR-COMUNICACAO-026 items 4.a, 4.d and 6.b;
 * contract `docs/contracts/tuggi-do-parceiro.md` §11.2).
 *
 * `POST` `{ action: 'approve' }` | `{ action: 'refuse' | 'cancel', reason }` |
 *        `{ action: 'schedule', local_send_at: 'YYYY-MM-DDTHH:MM' }` | `{ action: 'unschedule' }`
 *        → `{ message }`.
 * `local_send_at` is a wall clock without zone: the message leaves at that hour in each person's
 * zone, between 9h and 20h. The database answers the precise refusal: 409 `sending_off` (TGB96),
 * `wrong_state` / `already_started` (TGB90), `partner_cannot_send` (TGB91), `monthly_cap` (TGB92,
 * with the cap), `too_close` (TGB93); 422 `outside_window` / `in_the_past` (TGB94), `invalid_field`
 * (TGB95). A refusal or a cancellation without a reason never reaches the database.
 *
 * `withAuth({ roles: ['admin'] })`, then the service role, with the session's user as `p_actor`.
 * The audit carries the act and the ids, never the reason.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import { logAuditEvent } from '@/lib/services/audit-service'
import { decideMessage } from '@/lib/services/partner-message-service'
import { isUuid, parseDecisionBody, partnerMessageErrorStatus, type PartnerMessageError } from '@/lib/partner-message/message'

function refuse(error: PartnerMessageError): NextResponse {
  return NextResponse.json({ error }, { status: partnerMessageErrorStatus(error) })
}

export const POST = withAuth<{ messageId: string }>({ roles: ['admin'] }, async (req, ctx, auth) => {
  const messageId = (await ctx.params)?.messageId
  if (!isUuid(messageId)) return refuse({ code: 'invalid_id' })
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return refuse({ code: 'invalid_body' })
  }
  const parsed = parseDecisionBody(body)
  if (!parsed.ok) return refuse(parsed.error)

  const id = messageId.toLowerCase()
  const decided = await decideMessage(getSupabaseService(), id, parsed.value, auth.user.id)
  if (!decided.ok) return refuse(decided.error)

  await logAuditEvent({
    request: req,
    action: 'DECIDE_PARTNER_MESSAGE',
    entity: 'CLIENT',
    entityId: id,
    userId: auth.user.id,
    userEmail: auth.user.email ?? null,
    description: `Partner message ${id}: ${parsed.value.action}`,
  })
  return NextResponse.json({ message: decided.value })
})
