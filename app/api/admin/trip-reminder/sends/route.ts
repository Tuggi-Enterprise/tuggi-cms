/**
 * GET /api/admin/trip-reminder/sends?channel=&limit= — the last message sends, newest first
 * (#1233, BR-COMUNICACAO-024 item 9, BR-COMUNICACAO-023 item 7): `drive.cms_get_message_sends`.
 *
 * The read carries only the last 4 digits of a phone and a `reason` already cleaned of numbers by
 * the database; the route hands it as is. service_role after `withAuth` proved an admin.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import {
  CHANNEL_RE,
  SENDS_LIMIT_MAX,
  classifyTripAdminError,
  tripAdminErrorStatus,
} from '@/lib/trip-reminder/settings'

export const GET = withAuth({ roles: ['admin'] }, async (req) => {
  const params = req.nextUrl.searchParams
  const channel = params.get('channel')
  const limitParam = params.get('limit')
  const limit = limitParam === null ? 50 : Number(limitParam)
  if ((channel !== null && (channel.length > 40 || !CHANNEL_RE.test(channel))) || !Number.isInteger(limit) || limit < 1 || limit > SENDS_LIMIT_MAX) {
    return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 })
  }

  const { data, error } = await getSupabaseService()
    .schema('drive')
    .rpc('cms_get_message_sends', { p_channel: channel, p_limit: limit })
  if (error) {
    console.error('[trip-reminder] sends read refused:', error.code)
    const refusal = classifyTripAdminError(error)
    return NextResponse.json({ error: refusal }, { status: tripAdminErrorStatus(refusal) })
  }
  return NextResponse.json({ sends: Array.isArray(data) ? data : [] })
})
