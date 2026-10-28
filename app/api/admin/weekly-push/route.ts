/**
 * The CMS door to the weekly push pieces, BR-COMUNICACAO-019 3.m (#1047).
 *
 * `GET`   pieces, texts (no `new_place`), policy and last change: `drive.cms_get_weekly_push_settings()`.
 * `PATCH` turns ONE piece on or off and/or sets its local hour: `drive.cms_set_weekly_push_piece`.
 *
 * Both run on `service_role` (EXECUTE is granted to it only) after `withAuth` proved an admin;
 * `/api/*` is outside the proxy matcher, so `withAuth` is the whole gate. The hour range is the
 * database's (`policy.allowed_hours`, TGN02); here only the shape. Logs carry the SQLSTATE only.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import {
  classifyWeeklyPushError,
  isWeeklyPushPiece,
  weeklyPushErrorStatus,
  type WeeklyPushError,
} from '@/lib/notifications/weekly-push'

function refuse(error: WeeklyPushError): NextResponse {
  return NextResponse.json({ error }, { status: weeklyPushErrorStatus(error) })
}

export const GET = withAuth({ roles: ['admin'] }, async () => {
  const { data, error } = await getSupabaseService().schema('drive').rpc('cms_get_weekly_push_settings')
  if (error) {
    console.error('[weekly-push] read refused:', error.code)
    return refuse(classifyWeeklyPushError(error))
  }
  return NextResponse.json(data)
})

export const PATCH = withAuth({ roles: ['admin'] }, async (req) => {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return refuse({ code: 'invalid_body' })
  }

  const piece = body?.piece
  const isActive = body?.is_active
  const localHour = body?.local_hour
  const activeOk = isActive === undefined || typeof isActive === 'boolean'
  const hourOk = localHour === undefined || (typeof localHour === 'number' && Number.isInteger(localHour))
  if (!isWeeklyPushPiece(piece) || !activeOk || !hourOk || (isActive === undefined && localHour === undefined)) {
    return refuse({ code: 'invalid_body' })
  }

  const { data, error } = await getSupabaseService()
    .schema('drive')
    .rpc('cms_set_weekly_push_piece', {
      p_piece: piece,
      p_is_active: isActive ?? null,
      p_local_hour: localHour ?? null,
    })
  if (error) {
    console.error('[weekly-push] piece write refused:', error.code)
    return refuse(classifyWeeklyPushError(error))
  }
  return NextResponse.json(data)
})
