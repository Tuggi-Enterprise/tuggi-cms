/**
 * GET /api/admin/trip-reminder/settings — the switches, numbers, templates and provider secret
 * slots of the planned trip and the trip reminder (#1233): `drive.cms_get_trip_settings()`.
 *
 * service_role (EXECUTE is granted to it only) after `withAuth` proved an admin; `/api/*` is outside
 * the proxy matcher, so `withAuth` is the whole gate. A secret slot leaves as `configured_at` and
 * `last4` only (BR-COMUNICACAO-024 item 10): the read never had the value, and `normalizeTripSettings`
 * keeps it that way if the read grows. Logs carry the SQLSTATE only.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import { classifyTripAdminError, normalizeTripSettings, tripAdminErrorStatus } from '@/lib/trip-reminder/settings'

export const GET = withAuth({ roles: ['admin'] }, async () => {
  const { data, error } = await getSupabaseService().schema('drive').rpc('cms_get_trip_settings')
  if (error) {
    console.error('[trip-reminder] settings read refused:', error.code)
    const refusal = classifyTripAdminError(error)
    return NextResponse.json({ error: refusal }, { status: tripAdminErrorStatus(refusal) })
  }
  return NextResponse.json(normalizeTripSettings(data), { headers: { 'Cache-Control': 'no-store' } })
})
