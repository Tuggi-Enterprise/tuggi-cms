/**
 * GET /api/admin/trip-reminder/panel — planned trips by destination and month, answers, phone
 * contacts by channel and trip hours released (#1233, BR-USUARIO-055 item 6.c):
 * `drive.cms_get_planned_trips_panel()`. Counts only: the read never carries a person or a number.
 * service_role after `withAuth` proved an admin.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import { classifyTripAdminError, tripAdminErrorStatus } from '@/lib/trip-reminder/settings'

export const GET = withAuth({ roles: ['admin'] }, async () => {
  const { data, error } = await getSupabaseService().schema('drive').rpc('cms_get_planned_trips_panel')
  if (error) {
    console.error('[trip-reminder] panel read refused:', error.code)
    const refusal = classifyTripAdminError(error)
    return NextResponse.json({ error: refusal }, { status: tripAdminErrorStatus(refusal) })
  }
  return NextResponse.json(data ?? {})
})
