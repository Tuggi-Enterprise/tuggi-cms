/**
 * PATCH /api/admin/trip-reminder/switches `{ key, is_on }` — turns one switch on or off (#1233,
 * BR-COMUNICACAO-023 item 5, BR-COMUNICACAO-024 item 9, BR-USUARIO-054 item 1):
 * `drive.cms_set_feature_switch(p_key, p_is_on, p_actor)`.
 *
 * `p_actor` is the session's `auth.users.id`, never the body's; the function refuses (42501) when it
 * is not an active admin, after `withAuth` already did. The key set is the database's (TGJ22).
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import {
  SWITCH_KEY_RE,
  classifyTripAdminError,
  tripAdminErrorStatus,
  type TripAdminError,
} from '@/lib/trip-reminder/settings'

function refuse(error: TripAdminError): NextResponse {
  return NextResponse.json({ error }, { status: tripAdminErrorStatus(error) })
}

export const PATCH = withAuth({ roles: ['admin'] }, async (req, _ctx, auth) => {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return refuse({ code: 'invalid_body' })
  }
  const key = body?.key
  const isOn = body?.is_on
  if (typeof key !== 'string' || key.length > 120 || !SWITCH_KEY_RE.test(key) || typeof isOn !== 'boolean') {
    return refuse({ code: 'invalid_body' })
  }

  const { data, error } = await getSupabaseService()
    .schema('drive')
    .rpc('cms_set_feature_switch', { p_key: key, p_is_on: isOn, p_actor: auth.user.id })
  if (error) {
    console.error('[trip-reminder] switch write refused:', error.code)
    return refuse(classifyTripAdminError(error))
  }
  return NextResponse.json(data)
})
