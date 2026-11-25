/**
 * One partner message (#1264, BR-COMUNICACAO-026 items 6.b, 6.e and 9; contract
 * `docs/contracts/tuggi-do-parceiro.md` §11.2).
 *
 * `GET` → `{ message }`: every column, the button link now, the texts by language, the exact numbers
 *        and how many have the yes now. 404 when it does not exist.
 * `PUT` `{ requested_by, requested_at, button_kind, button_ref?, image_path?, texts }` → `{ message }`:
 *        edits a draft (the texts are replaced at once). 409 `wrong_state` once it left the draft.
 *
 * `withAuth({ roles: ['admin'] })`, then the service role, with the session's user as `p_actor`.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import { logAuditEvent } from '@/lib/services/audit-service'
import { getMessage, saveMessage } from '@/lib/services/partner-message-service'
import { isUuid, parseSaveBody, partnerMessageErrorStatus, type PartnerMessageError } from '@/lib/partner-message/message'

function refuse(error: PartnerMessageError): NextResponse {
  return NextResponse.json({ error }, { status: partnerMessageErrorStatus(error) })
}

export const GET = withAuth<{ messageId: string }>({ roles: ['admin'] }, async (_req, ctx) => {
  const messageId = (await ctx.params)?.messageId
  if (!isUuid(messageId)) return refuse({ code: 'invalid_id' })
  const read = await getMessage(getSupabaseService(), messageId.toLowerCase())
  if (!read.ok) return refuse(read.error)
  return NextResponse.json({ message: read.value }, { headers: { 'Cache-Control': 'no-store' } })
})

export const PUT = withAuth<{ messageId: string }>({ roles: ['admin'] }, async (req, ctx, auth) => {
  const messageId = (await ctx.params)?.messageId
  if (!isUuid(messageId)) return refuse({ code: 'invalid_id' })
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return refuse({ code: 'invalid_body' })
  }
  const parsed = parseSaveBody(body, 'edit')
  if (!parsed.ok) return refuse(parsed.error)

  const id = messageId.toLowerCase()
  const saved = await saveMessage(getSupabaseService(), id, parsed.value, auth.user.id)
  if (!saved.ok) return refuse(saved.error)

  await logAuditEvent({
    request: req,
    action: 'SAVE_PARTNER_MESSAGE',
    entity: 'CLIENT',
    entityId: id,
    userId: auth.user.id,
    userEmail: auth.user.email ?? null,
    description: `Partner message ${id} draft edited`,
  })
  return NextResponse.json({ message: saved.value })
})
