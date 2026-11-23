/**
 * PUT /api/admin/trip-reminder/templates `{ channel, piece, language, template_name, provider_language }`
 * — writes one WhatsApp template name per piece and language (#1233, BR-COMUNICACAO-024 item 8):
 * `drive.cms_set_message_template(...)`. `template_name: null` removes it.
 *
 * `p_actor` is the session's `auth.users.id`. The shape is checked here against the mirrors of the
 * CHECKs (`parseTemplateInput`); the database stays the judge (TGJ23, 23514).
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import {
  classifyTripAdminError,
  parseTemplateInput,
  tripAdminErrorStatus,
  type TripAdminError,
} from '@/lib/trip-reminder/settings'

function refuse(error: TripAdminError): NextResponse {
  return NextResponse.json({ error }, { status: tripAdminErrorStatus(error) })
}

export const PUT = withAuth({ roles: ['admin'] }, async (req, _ctx, auth) => {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return refuse({ code: 'invalid_body' })
  }
  const input = parseTemplateInput(body)
  if (!input) return refuse({ code: 'invalid_body' })

  const { data, error } = await getSupabaseService().schema('drive').rpc('cms_set_message_template', {
    p_channel: input.channel,
    p_piece: input.piece,
    p_language: input.language,
    p_template_name: input.template_name,
    p_provider_language: input.provider_language,
    p_actor: auth.user.id,
  })
  if (error) {
    console.error('[trip-reminder] template write refused:', error.code)
    return refuse(classifyTripAdminError(error))
  }
  return NextResponse.json(data)
})
