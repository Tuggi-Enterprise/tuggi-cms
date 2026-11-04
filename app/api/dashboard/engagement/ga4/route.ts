/**
 * `GET /api/dashboard/engagement/ga4?country=&platform=`: the GA4 half of the Engagement report
 * (#1094), through the `engagement-ga4` Edge Function, which holds the GA4 credential. This server
 * holds none.
 *
 * Admin by `withAuth`; then the CMS server's secret key, which the function's `requireAdmin`
 * accepts (the same call as `lookupInstagram` in `lib/social/repository.ts`). Source and account
 * do not exist in GA4: the screen does not ask this route under them, and they are refused here
 * so nobody reads GA4 numbers as if they were filtered.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import { engagementMonths } from '@/lib/engagement/months'
import { ga4Filterable, parseEngagementFilters, parseGa4Report } from '@/lib/engagement/report'

export const dynamic = 'force-dynamic'

const ENGAGEMENT_GA4_FUNCTION = 'engagement-ga4'

export const GET = withAuth({ roles: ['admin'] }, async (req: NextRequest) => {
  const filters = parseEngagementFilters(new URL(req.url).searchParams)
  if (filters === 'invalid' || !ga4Filterable(filters)) {
    return NextResponse.json({ error: 'invalid filter', code: '22023' }, { status: 400 })
  }

  // supabase-js sends an `sb_secret_` key only in `apikey`; the function's gate reads `Authorization`.
  const key = process.env.SUPABASE_SECRET_KEY
  if (!key) {
    console.error('[dashboard/engagement/ga4] SUPABASE_SECRET_KEY missing')
    return NextResponse.json({ error: 'ga4 read failed', code: 'not_configured' }, { status: 502 })
  }

  const { data, error } = await getSupabaseService().functions.invoke(ENGAGEMENT_GA4_FUNCTION, {
    body: { from_month: engagementMonths()[0], platform: filters.platform, country: filters.country },
    headers: { Authorization: `Bearer ${key}` },
  })
  const report = error ? null : parseGa4Report(data)
  if (!report) {
    console.error('[dashboard/engagement/ga4] read failed:', error ? error.name : 'bad_shape')
    return NextResponse.json({ error: 'ga4 read failed', code: 'ga4_failed' }, { status: 502 })
  }
  return NextResponse.json({ data: report })
})
