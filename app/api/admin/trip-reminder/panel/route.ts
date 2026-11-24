/**
 * GET /api/admin/trip-reminder/panel — planned trips by destination, month and length band, answers,
 * phone contacts by channel and trips credited (#1233, #1238, BR-USUARIO-055 item 6.c):
 * `drive.cms_get_planned_trips_panel()`. An account may have many trips, so `trips` and `accounts`
 * differ. Counts only: the read never carries a person or a number, and `normalizePlannedTripsPanel`
 * keeps it that way if the read grows. service_role after `withAuth` proved an admin.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import { classifyTripAdminError, normalizePlannedTripsPanel, tripAdminErrorStatus } from '@/lib/trip-reminder/settings'

export const GET = withAuth({ roles: ['admin'] }, async () => {
  const { data, error } = await getSupabaseService().schema('drive').rpc('cms_get_planned_trips_panel')
  if (error) {
    console.error('[trip-reminder] panel read refused:', error.code)
    const refusal = classifyTripAdminError(error)
    return NextResponse.json({ error: refusal }, { status: tripAdminErrorStatus(refusal) })
  }
  return NextResponse.json(normalizePlannedTripsPanel(data), { headers: { 'Cache-Control': 'no-store' } })
})
