/**
 * `GET /api/dashboard/engagement/active?source=&country=&platform=&account=`: DAU, WAU and MAU in people
 * for the Engagement page (#1162), from `drive.cms_get_active_users_monthly` (service_role only, contract
 * banco-para-cms Parte 27 §5).
 *
 * Admin by `withAuth`, then service_role: the function has no caller check of its own (condition of the
 * security review of #1160). Aggregates only, no user id. Same month ruler and filters as
 * `/api/dashboard/engagement/usage`; a refusal answers its SQLSTATE, never its message.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import { engagementMonths, engagementRange } from '@/lib/engagement/months'
import { parseEngagementFilters } from '@/lib/engagement/report'
import { parseActiveUsersReport } from '@/lib/engagement/active-users'

export const dynamic = 'force-dynamic'

export const GET = withAuth({ roles: ['admin'] }, async (req: NextRequest) => {
  const filters = parseEngagementFilters(new URL(req.url).searchParams)
  if (filters === 'invalid') {
    return NextResponse.json({ error: 'invalid filter', code: '22023' }, { status: 400 })
  }

  const { p_from, p_to } = engagementRange(engagementMonths())
  const { data, error } = await getSupabaseService()
    .schema('drive')
    .rpc('cms_get_active_users_monthly', {
      p_from,
      p_to,
      p_source: filters.source,
      p_country: filters.country,
      p_platform: filters.platform,
      p_account: filters.account,
    })
  if (error) {
    // SQLSTATE only: the message of a refused call can echo the arguments.
    const code = error.code ?? 'unknown'
    console.error('[dashboard/engagement/active] read refused:', code)
    const status = code === '22023' ? 400 : code === '42501' ? 403 : 502
    return NextResponse.json({ error: 'active users read refused', code }, { status })
  }
  return NextResponse.json({ data: parseActiveUsersReport(data) })
})
