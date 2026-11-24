/**
 * GET /api/admin/trip-reminder/now-credits: who got the hours of "estou viajando agora" (#1281,
 * BR-MONETIZACAO-091 item 8.2), `drive.cms_get_trip_now_credits()` with its own defaults, so the
 * size of the list lives in the database and never here. Personal data (the email of the account):
 * admin only (BR-CMS-003), service_role after `withAuth` proved an admin, the reply never cached,
 * and `normalizeTripNowCredits` keeps the destination, the wish and the contact email out
 * (BR-USUARIO-055 items 6.b, 6.c and 8). The log carries the SQLSTATE, never a row.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import { classifyTripAdminError, normalizeTripNowCredits, tripAdminErrorStatus } from '@/lib/trip-reminder/settings'

const NO_STORE = { 'Cache-Control': 'no-store' }

export const GET = withAuth({ roles: ['admin'] }, async () => {
  const { data, error } = await getSupabaseService().schema('drive').rpc('cms_get_trip_now_credits')
  if (error) {
    console.error('[trip-reminder] now credits read refused:', error.code)
    const refusal = classifyTripAdminError(error)
    return NextResponse.json({ error: refusal }, { status: tripAdminErrorStatus(refusal), headers: NO_STORE })
  }
  return NextResponse.json(normalizeTripNowCredits(data), { headers: NO_STORE })
})
