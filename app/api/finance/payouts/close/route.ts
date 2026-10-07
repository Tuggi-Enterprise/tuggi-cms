/**
 * POST /api/finance/payouts/close — calculates the place payouts of a closed month (#903,
 * BR-B2B-044 item 6, term 5.4). Two callers, one calculation (`closePayoutPeriod`):
 *
 *   - the daily job (`places-payment-sweep`, decision 7): header `x-cms-job-secret` = CMS_JOB_SECRET,
 *     compared in constant time; closes the month before today, and only if it was never calculated;
 *   - the admin's "Apurar {mês}" button: `{ periodMonth }`, recalculates on purpose (only what is
 *     still `calculated` changes; the database locks the rest).
 *
 * Only an admin calculates (B1: the database function does not gate). An unset secret refuses every
 * job call.
 */

import { timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth, withRateLimit, type RouteContext } from '@/lib/auth-middleware'
import { MODULES } from '@/lib/modules'
import { requireModule } from '@/lib/modules/requireModule'
import { logAuditEvent } from '@/lib/services/audit-service'
import { closePayoutPeriod } from '@/lib/services/place-payout-service'
import { previousPeriod } from '@/lib/finance/payouts'
import { saoPauloDate } from '@/lib/finance/place-billing'

export const dynamic = 'force-dynamic'

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])-01$/
const JOB_SECRET_HEADER = 'x-cms-job-secret'

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

const today = () => saoPauloDate(new Date().toISOString()) as string

const adminClose = withRateLimit(10, 60_000)(
  withAuth({ roles: ['admin'] }, async (req, _ctx, auth) => {
    const gate = await requireModule(MODULES.FINANCE, await cookies())
    if (!gate.ok) return gate.response

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    const period = typeof body?.periodMonth === 'string' ? body.periodMonth : ''
    if (!PERIOD.test(period) || period >= `${today().slice(0, 7)}-01`) {
      return NextResponse.json({ error: 'invalid_month' }, { status: 400 })
    }
    const r = await closePayoutPeriod(period, auth.cmsUser.id, { skipIfCalculated: false })
    if (r.status === 200) {
      await logAuditEvent({
        userId: auth.user.id,
        userEmail: auth.user.email,
        action: 'CALCULATE_FINANCE_PAYOUTS',
        entity: 'FINANCE',
        entityId: period,
        description: `Apuracao do repasse de ${period}: ${String(r.body.payouts)} locais`,
        request: req,
      })
    }
    return NextResponse.json(r.body, { status: r.status })
  })
)

export async function POST(req: NextRequest, ctx?: RouteContext): Promise<Response> {
  const given = req.headers.get(JOB_SECRET_HEADER)
  if (given === null) return adminClose(req, ctx)

  const expected = (process.env.CMS_JOB_SECRET ?? '').trim()
  if (!expected || !sameSecret(given.trim(), expected)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const r = await closePayoutPeriod(previousPeriod(today()), null, { skipIfCalculated: true })
  return NextResponse.json(r.body, { status: r.status })
}
