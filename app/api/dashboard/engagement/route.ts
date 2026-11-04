/**
 * `GET /api/dashboard/engagement?source=&country=&platform=&account=`: the database half of the
 * Engagement report (#1094), from `drive.cms_get_engagement_monthly` (service_role only, contract
 * banco-para-cms Parte 25).
 *
 * Admin by `withAuth`, then service_role: the function has no caller check of its own. Aggregates
 * only, no user id. The period is the month ruler of `lib/engagement/months.ts`, the same list
 * the screen draws, so a column never asks for a month the query did not read. `PGRST202` (the
 * function is not there yet) answers 502 like any other refusal: the screen prints "no data".
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import { engagementMonths, engagementRange } from '@/lib/engagement/months'
import { parseBankReport, parseEngagementFilters } from '@/lib/engagement/report'

export const dynamic = 'force-dynamic'

export const GET = withAuth({ roles: ['admin'] }, async (req: NextRequest) => {
  const filters = parseEngagementFilters(new URL(req.url).searchParams)
  if (filters === 'invalid') {
    return NextResponse.json({ error: 'invalid filter', code: '22023' }, { status: 400 })
  }

  const { p_from, p_to } = engagementRange(engagementMonths())
  const { data, error } = await getSupabaseService()
    .schema('drive')
    .rpc('cms_get_engagement_monthly', {
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
    console.error('[dashboard/engagement] read refused:', code)
    const status = code === '22023' ? 400 : code === '42501' ? 403 : 502
    return NextResponse.json({ error: 'engagement read refused', code }, { status })
  }
  return NextResponse.json({ data: parseBankReport(data) })
})
