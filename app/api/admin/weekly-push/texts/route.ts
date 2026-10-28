/**
 * `PUT /api/admin/weekly-push/texts`: writes the title and body of one piece, variant and language
 * of the weekly push through `drive.cms_set_weekly_push_text` (BR-COMUNICACAO-019 3.m, #1047).
 *
 * Admin by `withAuth`, then `service_role`. The text rules are the database's (TGN01 to TGN10),
 * mapped by `classifyWeeklyPushError`; here only the shape and a length ceiling so a pasted
 * novel never reaches the RPC. Logs carry the SQLSTATE only, never the text.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import {
  classifyWeeklyPushError,
  isWeeklyPushLanguage,
  isWeeklyPushPiece,
  isWeeklyPushVariant,
  weeklyPushErrorStatus,
  type WeeklyPushError,
} from '@/lib/notifications/weekly-push'

const FIELD_CEILING = 1000

function refuse(error: WeeklyPushError): NextResponse {
  return NextResponse.json({ error }, { status: weeklyPushErrorStatus(error) })
}

const isText = (value: unknown): value is string => typeof value === 'string' && value.length <= FIELD_CEILING

export const PUT = withAuth({ roles: ['admin'] }, async (req) => {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return refuse({ code: 'invalid_body' })
  }

  const { piece, variant, language, title, body: text } = body ?? {}
  if (
    !isWeeklyPushPiece(piece) ||
    !isWeeklyPushVariant(variant) ||
    !isWeeklyPushLanguage(language) ||
    !isText(title) ||
    !isText(text)
  ) {
    return refuse({ code: 'invalid_body' })
  }

  const { data, error } = await getSupabaseService().schema('drive').rpc('cms_set_weekly_push_text', {
    p_piece: piece,
    p_variant: variant,
    p_language: language,
    p_title: title,
    p_body: text,
  })
  if (error) {
    console.error('[weekly-push] text write refused:', error.code)
    return refuse(classifyWeeklyPushError(error))
  }
  return NextResponse.json(data)
})
