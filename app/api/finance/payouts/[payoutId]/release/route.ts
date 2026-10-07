/**
 * POST /api/finance/payouts/{payoutId}/release — the admin confirms the Pix of one payout (#903).
 *
 * THE ONLY DOOR TO THE MONEY. Only an admin (B1, decision 2: the database functions do not gate).
 * The body carries the amount the screen showed (`expectedAmountCents`); a recalculation since the
 * load refuses with 409 `amount_changed` and the current amount (decision 3), so nobody pays a
 * value they did not see. Then the `places-payout` Edge Function: `release_place_payout`, and only
 * on `applied` the Asaas transfer — a double click or a retry ends at `unchanged` without Asaas.
 *
 * 200 `{result: 'sent'|'unchanged'}` · 400 · 404 · 409 `amount_changed {amountCents}` |
 * `not_releasable {reason}` · 502/504 (the transfer failed or timed out: the row stays `released`,
 * the pending item `payout_stuck_released` tells the operator to search Asaas).
 */

import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { MODULES } from '@/lib/modules'
import { requireModule } from '@/lib/modules/requireModule'
import { logAuditEvent } from '@/lib/services/audit-service'
import { callPayoutEdge, loadPayoutForRelease } from '@/lib/services/place-payout-service'

type Params = { payoutId: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export const POST = withRateLimit(20, 60_000)(
  withAuth<Params>({ roles: ['admin'] }, async (req, ctx, auth) => {
    const gate = await requireModule(MODULES.FINANCE, await cookies())
    if (!gate.ok) return gate.response

    const { payoutId } = (await ctx.params) as Params
    if (!UUID.test(payoutId ?? '')) return NextResponse.json({ error: 'invalid_payout' }, { status: 400 })
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    const expected = body?.expectedAmountCents
    if (typeof expected !== 'number' || !Number.isInteger(expected)) {
      return NextResponse.json({ error: 'invalid_amount' }, { status: 400 })
    }

    const current = await loadPayoutForRelease(payoutId)
    if (current === null) return NextResponse.json({ error: 'payouts_unavailable' }, { status: 503 })
    if (current === undefined) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    if (current.amountCents !== expected) {
      return NextResponse.json({ error: 'amount_changed', amountCents: current.amountCents }, { status: 409 })
    }

    const r = await callPayoutEdge({ action: 'release', payout_id: payoutId, released_by: auth.cmsUser.id })
    if (r.status === 200 && r.body.result === 'sent') {
      await logAuditEvent({
        userId: auth.user.id,
        userEmail: auth.user.email,
        action: 'RELEASE_FINANCE_PAYOUT',
        entity: 'FINANCE',
        entityId: payoutId,
        description: `Repasse ${payoutId} liberado por Pix: ${expected} centavos`,
        request: req,
      })
    }
    return NextResponse.json(r.body, { status: r.status })
  })
)
