/**
 * `PATCH /api/admin/partner-brand/packages` `{ days, price_cents, price_currency }` (#1257,
 * BR-B2B-070 item 9): the price of one gift package, the two fields together (ISO 4217) or both
 * `null` (no price, the state today). Writes `partner.gift_day_packages` on the service role;
 * `404 package_not_found` when no package has that length. Nothing charges anyone from here.
 * Gate: `withAuth({ roles: ['admin'] })`. Logs carry the SQLSTATE only.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import { logAuditEvent } from '@/lib/services/audit-service'
import { savePackagePrice } from '@/lib/services/partner-brand-service'
import { parsePackagePrice, partnerBrandErrorStatus, type PartnerBrandError } from '@/lib/partner-brand/brand'

function refuse(error: PartnerBrandError): NextResponse {
  return NextResponse.json({ error }, { status: partnerBrandErrorStatus(error) })
}

export const PATCH = withAuth({ roles: ['admin'] }, async (req, _ctx, auth) => {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return refuse({ code: 'invalid_body' })
  }
  const parsed = parsePackagePrice(body)
  if (!parsed.ok) return refuse(parsed.error)

  const saved = await savePackagePrice(getSupabaseService(), parsed.value)
  if (!saved.ok) return refuse(saved.error)

  await logAuditEvent({
    request: req,
    action: 'SET_GIFT_PACKAGE_PRICE',
    entity: 'FINANCE',
    entityId: null,
    userId: auth.user.id,
    userEmail: auth.user.email ?? null,
    description: `Gift package ${parsed.value.days}: price ${parsed.value.price_cents === null ? 'cleared' : `${parsed.value.price_cents} ${parsed.value.price_currency}`}`,
  })
  return NextResponse.json({ package: saved.value })
})
