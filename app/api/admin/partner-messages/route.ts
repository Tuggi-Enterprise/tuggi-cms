/**
 * The partner messages (#1264, BR-COMUNICACAO-026 items 6.a, 6.b and 6.e; contract
 * `docs/contracts/tuggi-do-parceiro.md` §11.2).
 *
 * `GET  ?client_id=&status=` → `{ messages: PartnerMessageRow[] }`, latest hour first, exact numbers.
 * `POST` `{ client_id, requested_by, requested_at, button_kind, button_ref?, image_path?, texts }`
 *        → `{ message }`: a new draft, `partner.cms_save_partner_message` with the session's user as
 *        `p_actor`, never the body's. A text that breaks an automatic refusal comes back as 422
 *        `invalid_field` with the version and the rule to fix.
 *
 * `withAuth({ roles: ['admin'] })` is the whole gate (`/api/*` is outside the proxy matcher), then the
 * service role. Logs and the audit carry ids and the act only, never a text.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import { logAuditEvent } from '@/lib/services/audit-service'
import { listMessages, saveMessage } from '@/lib/services/partner-message-service'
import {
  isUuid,
  parseSaveBody,
  partnerMessageErrorStatus,
  PARTNER_MESSAGE_STATUSES,
  type PartnerMessageError,
  type PartnerMessageStatus,
} from '@/lib/partner-message/message'

const NO_STORE = { 'Cache-Control': 'no-store' }

function refuse(error: PartnerMessageError): NextResponse {
  return NextResponse.json({ error }, { status: partnerMessageErrorStatus(error) })
}

export const GET = withAuth({ roles: ['admin'] }, async (req) => {
  const params = new URL(req.url).searchParams
  const clientId = params.get('client_id')
  const status = params.get('status')
  if (clientId !== null && !isUuid(clientId)) return refuse({ code: 'invalid_id' })
  if (status !== null && !(PARTNER_MESSAGE_STATUSES as readonly string[]).includes(status)) return refuse({ code: 'invalid_body' })
  const read = await listMessages(getSupabaseService(), {
    clientId: clientId ? clientId.toLowerCase() : null,
    status: status as PartnerMessageStatus | null,
  })
  if (!read.ok) return refuse(read.error)
  return NextResponse.json({ messages: read.value }, { headers: NO_STORE })
})

export const POST = withAuth({ roles: ['admin'] }, async (req, _ctx, auth) => {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return refuse({ code: 'invalid_body' })
  }
  const parsed = parseSaveBody(body, 'create')
  if (!parsed.ok) return refuse(parsed.error)

  const saved = await saveMessage(getSupabaseService(), null, parsed.value, auth.user.id)
  if (!saved.ok) return refuse(saved.error)

  await logAuditEvent({
    request: req,
    action: 'SAVE_PARTNER_MESSAGE',
    entity: 'CLIENT',
    entityId: saved.value.id,
    userId: auth.user.id,
    userEmail: auth.user.email ?? null,
    description: `Partner message ${saved.value.id} created for client ${parsed.value.client_id}`,
  })
  return NextResponse.json({ message: saved.value }, { status: 201 })
})
