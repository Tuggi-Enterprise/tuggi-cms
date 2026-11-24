/**
 * The queue of partner logos waiting for the curator (#1257, BR-B2B-070 item 2; contract
 * `docs/contracts/tuggi-do-parceiro.md` §5).
 *
 * `GET`  → `{ logos: PendingLogo[] }`, oldest first, each one signed from the private bucket.
 * `POST` `{ client_id, logo_path, approve, reason? }` → `{ decision }`: `partner.cms_decide_partner_logo`
 *        with the session's user as `p_actor`, never the body's. A refusal needs `reason` (the portal
 *        shows it); `409 logo_not_pending` (TGB71) when that file is not the pending one any more.
 *
 * `withAuth({ roles: ['admin'] })` is the whole gate (`/api/*` is outside the proxy matcher), then the
 * service role. Logs carry the SQLSTATE only.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import { logAuditEvent } from '@/lib/services/audit-service'
import { decideLogo, listPendingLogos } from '@/lib/services/partner-brand-service'
import { parseLogoDecision, partnerBrandErrorStatus, type PartnerBrandError } from '@/lib/partner-brand/brand'

const NO_STORE = { 'Cache-Control': 'no-store' }

function refuse(error: PartnerBrandError): NextResponse {
  return NextResponse.json({ error }, { status: partnerBrandErrorStatus(error) })
}

export const GET = withAuth({ roles: ['admin'] }, async () => {
  const read = await listPendingLogos(getSupabaseService())
  if (!read.ok) return refuse(read.error)
  return NextResponse.json({ logos: read.value }, { headers: NO_STORE })
})

export const POST = withAuth({ roles: ['admin'] }, async (req, _ctx, auth) => {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return refuse({ code: 'invalid_body' })
  }
  const parsed = parseLogoDecision(body)
  if (!parsed.ok) return refuse(parsed.error)

  const decided = await decideLogo(getSupabaseService(), parsed.value, auth.user.id)
  if (!decided.ok) return refuse(decided.error)

  await logAuditEvent({
    request: req,
    action: 'DECIDE_PARTNER_LOGO',
    entity: 'CLIENT',
    entityId: parsed.value.client_id,
    userId: auth.user.id,
    userEmail: auth.user.email ?? null,
    description: `Partner ${parsed.value.client_id}: logo ${parsed.value.approve ? 'approved' : 'refused'}`,
  })
  return NextResponse.json({ decision: decided.value })
})
