/**
 * `GET /api/admin/weekly-push/engagement`: received and opened of each weekly push send, and the
 * summary of the last weeks of `drive.push_report_policy()` (BR-COMUNICACAO-019 3.m.9, #1051),
 * from `drive.cms_get_weekly_push_engagement`. Matches `.../results` by piece and local date.
 *
 * Separate from `.../results` so the new numbers fail alone and the table keeps its columns.
 * Admin by `withAuth`, then service_role. Aggregates only: no user id leaves the function.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import {
  WEEKLY_PUSH_RESULT_WEEKS,
  classifyWeeklyPushError,
  weeklyPushErrorStatus,
} from '@/lib/notifications/weekly-push'

export const GET = withAuth({ roles: ['admin'] }, async () => {
  const { data, error } = await getSupabaseService()
    .schema('drive')
    .rpc('cms_get_weekly_push_engagement', { p_weeks: WEEKLY_PUSH_RESULT_WEEKS })
  if (error) {
    console.error('[weekly-push] engagement read refused:', error.code)
    const refusal = classifyWeeklyPushError(error)
    return NextResponse.json({ error: refusal }, { status: weeklyPushErrorStatus(refusal) })
  }
  return NextResponse.json(data)
})
