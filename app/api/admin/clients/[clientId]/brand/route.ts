/**
 * The Tuggi do parceiro in the client record (#1257; contract `docs/contracts/tuggi-do-parceiro.md` §5).
 *
 * `GET`   → `{ brand: ClientBrand }`: the last logo sent and its state, the approved one, both
 *         signed from the private bucket, and the pilot. An empty brand when nothing was saved.
 * `PATCH` `{ pilot_starts_at, pilot_ends_at }` → `{ pilot }`: both, the end after the start, or both
 *         empty (BR-B2B-070 item 9: without a pilot the partner does not have the product; extending
 *         it is changing the date here). Insert or update on `client_id`, the two columns only.
 *         `404 client_not_found` when the client does not exist.
 *
 * Gate: `withAuth({ roles: ['admin'] })`, then the service role. The Wi-Fi of the row never leaves.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import { logAuditEvent } from '@/lib/services/audit-service'
import { loadClientBrand, savePilot } from '@/lib/services/partner-brand-service'
import { isUuid, parsePilot, partnerBrandErrorStatus, type PartnerBrandError } from '@/lib/partner-brand/brand'

function refuse(error: PartnerBrandError): NextResponse {
  return NextResponse.json({ error }, { status: partnerBrandErrorStatus(error) })
}

async function clientIdOf(ctx: { params?: Promise<{ clientId: string }> }): Promise<string | null> {
  const params = ctx.params ? await ctx.params : undefined
  return isUuid(params?.clientId) ? params.clientId.toLowerCase() : null
}

export const GET = withAuth<{ clientId: string }>({ roles: ['admin'] }, async (_req, ctx) => {
  const clientId = await clientIdOf(ctx)
  if (!clientId) return refuse({ code: 'invalid_client' })
  const read = await loadClientBrand(getSupabaseService(), clientId)
  if (!read.ok) return refuse(read.error)
  return NextResponse.json({ brand: read.value }, { headers: { 'Cache-Control': 'no-store' } })
})

export const PATCH = withAuth<{ clientId: string }>({ roles: ['admin'] }, async (req, ctx, auth) => {
  const clientId = await clientIdOf(ctx)
  if (!clientId) return refuse({ code: 'invalid_client' })
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return refuse({ code: 'invalid_body' })
  }
  const parsed = parsePilot(body)
  if (!parsed.ok) return refuse(parsed.error)

  const saved = await savePilot(getSupabaseService(), clientId, parsed.value)
  if (!saved.ok) return refuse(saved.error)

  await logAuditEvent({
    request: req,
    action: 'SET_PARTNER_PILOT',
    entity: 'CLIENT',
    entityId: clientId,
    userId: auth.user.id,
    userEmail: auth.user.email ?? null,
    description: parsed.value.pilot_starts_at
      ? `Partner ${clientId}: pilot ${parsed.value.pilot_starts_at} to ${parsed.value.pilot_ends_at}`
      : `Partner ${clientId}: pilot cleared`,
  })
  return NextResponse.json({ pilot: saved.value })
})
