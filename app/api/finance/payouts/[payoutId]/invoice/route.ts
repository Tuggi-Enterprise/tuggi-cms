/**
 * POST /api/finance/payouts/{payoutId}/invoice — the number of the invoice the place issued for its
 * commission (#903, decision 10). Optional: it never blocks the release. Admin only, like every
 * write on the payout (B1). The file upload is not in this version: number only.
 */

import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { MODULES } from '@/lib/modules'
import { requireModule } from '@/lib/modules/requireModule'
import { logAuditEvent } from '@/lib/services/audit-service'
import { recordPartnerInvoice } from '@/lib/services/place-payout-service'

type Params = { payoutId: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export const POST = withRateLimit(30, 60_000)(
  withAuth<Params>({ roles: ['admin'] }, async (req, ctx, auth) => {
    const gate = await requireModule(MODULES.FINANCE, await cookies())
    if (!gate.ok) return gate.response

    const { payoutId } = (await ctx.params) as Params
    if (!UUID.test(payoutId ?? '')) return NextResponse.json({ error: 'invalid_payout' }, { status: 400 })
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    const number = typeof body?.number === 'string' ? body.number.trim() : ''
    if (!number || number.length > 40) return NextResponse.json({ error: 'invalid_number' }, { status: 400 })

    const r = await recordPartnerInvoice(payoutId, number)
    if (!r.ok) {
      return NextResponse.json({ error: r.code === 'TGP01' ? 'not_found' : 'write_failed' }, { status: r.code === 'TGP01' ? 404 : 503 })
    }
    await logAuditEvent({
      userId: auth.user.id,
      userEmail: auth.user.email,
      action: 'RECORD_FINANCE_PAYOUT_INVOICE',
      entity: 'FINANCE',
      entityId: payoutId,
      description: `NF do local no repasse ${payoutId}: ${number}`,
      request: req,
    })
    return NextResponse.json({ ok: true })
  })
)
