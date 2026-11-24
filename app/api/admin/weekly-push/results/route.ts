/**
 * `GET /api/admin/weekly-push/results`: what each weekly push send produced, by calendar week,
 * the last 12 weeks (BR-COMUNICACAO-019 3.m.9 and 4.1, #1047), from `drive.cms_get_weekly_push_results`.
 *
 * Separate from the settings read so a slow or failing aggregate never blanks the pieces and the
 * texts (spec 3: each block fails alone). Admin by `withAuth`, then `service_role`. Aggregates
 * only: no user id leaves the function.
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
    .rpc('cms_get_weekly_push_results', { p_weeks: WEEKLY_PUSH_RESULT_WEEKS })
  if (error) {
    console.error('[weekly-push] results read refused:', error.code)
    const refusal = classifyWeeklyPushError(error)
    return NextResponse.json({ error: refusal }, { status: weeklyPushErrorStatus(refusal) })
  }
  return NextResponse.json(data)
})
