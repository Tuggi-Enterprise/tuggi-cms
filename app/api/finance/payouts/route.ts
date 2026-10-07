/**
 * GET /api/finance/payouts?month=YYYY-MM-01 — the place payouts of one month (#903), with the
 * statement of each. Default: the closed month before today (São Paulo).
 *
 * Admin and editor read (the statement is internal audit; the partner never sees it — §3.5, B2).
 * `viewerIsAdmin` goes along because only an admin releases (B1): the screen does not decide roles.
 * 503 and never an empty list when the tables do not answer.
 */

import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { MODULES } from '@/lib/modules'
import { requireModule } from '@/lib/modules/requireModule'
import { loadPayoutMonth } from '@/lib/services/place-payout-service'
import { previousPeriod, sortPayoutRows } from '@/lib/finance/payouts'
import { saoPauloDate } from '@/lib/finance/place-billing'

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])-01$/

export const GET = withRateLimit(60, 60_000)(
  withAuth({ roles: ['admin', 'editor'] }, async (req, _ctx, auth) => {
    const gate = await requireModule(MODULES.FINANCE, await cookies())
    if (!gate.ok) return gate.response

    const today = saoPauloDate(new Date().toISOString()) as string
    const asked = req.nextUrl.searchParams.get('month')
    const month = asked && PERIOD.test(asked) ? asked : previousPeriod(today)
    if (month >= `${today.slice(0, 7)}-01`) return NextResponse.json({ error: 'invalid_month' }, { status: 400 })

    const loaded = await loadPayoutMonth(month)
    if (!loaded) return NextResponse.json({ error: 'payouts_unavailable' }, { status: 503 })
    return NextResponse.json({
      ...loaded,
      rows: sortPayoutRows(loaded.rows),
      today,
      viewerIsAdmin: auth.cmsUser.role === 'admin',
    })
  })
)
