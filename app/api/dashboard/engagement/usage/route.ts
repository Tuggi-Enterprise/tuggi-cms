/**
 * `GET /api/dashboard/engagement/usage?source=&country=&platform=&account=`: the usage of each month of the
 * Engagement page (#1161), from `drive.cms_get_usage_monthly` (service_role only, contract banco-para-cms
 * Parte 27 §4).
 *
 * Admin by `withAuth`, then service_role: the function has no caller check of its own. Aggregates only, no
 * user id. Same month ruler and filters as `/api/dashboard/engagement`. `PGRST202` (the migration of #1160
 * is not applied yet) answers 502 like any other refusal: each block that reads this prints its failed
 * read and the rest of the page stands.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import { engagementMonths, engagementRange } from '@/lib/engagement/months'
import { parseEngagementFilters } from '@/lib/engagement/report'
import { parseUsageReport } from '@/lib/engagement/usage'

export const dynamic = 'force-dynamic'

export const GET = withAuth({ roles: ['admin'] }, async (req: NextRequest) => {
  const filters = parseEngagementFilters(new URL(req.url).searchParams)
  if (filters === 'invalid') {
    return NextResponse.json({ error: 'invalid filter', code: '22023' }, { status: 400 })
  }

  const { p_from, p_to } = engagementRange(engagementMonths())
  const { data, error } = await getSupabaseService()
    .schema('drive')
    .rpc('cms_get_usage_monthly', {
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
    console.error('[dashboard/engagement/usage] read refused:', code)
    const status = code === '22023' ? 400 : code === '42501' ? 403 : 502
    return NextResponse.json({ error: 'usage read refused', code }, { status })
  }
  return NextResponse.json({ data: parseUsageReport(data) })
})
