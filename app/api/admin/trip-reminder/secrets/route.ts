/**
 * PUT /api/admin/trip-reminder/secrets `{ name, value }` — writes one provider secret to the
 * database vault (#1233, BR-COMUNICACAO-024 item 10): `drive.cms_set_provider_secret(p_name,
 * p_value, p_actor)`.
 *
 * The value travels only as a bound RPC parameter: `rpc()` of supabase-js is a PostgREST POST with
 * the arguments in the request body (condition of the `security-reviewer` in #1230). Never a GET
 * RPC, never a direct `postgres` connection, never SQL text: those can land the value in the
 * database log. Here the value is never logged, never echoed and never part of an error: the
 * reply is `pickSecret` of the function's `{ name, channel, configured_at, last4 }`, and a refusal
 * carries the SQLSTATE class only. `p_actor` is the session's `auth.users.id`; the function writes
 * who and when to `drive.provider_secret_changes`, without the value.
 *
 * `withRateLimit` is a double-click brake, not a barrier; the barrier is `withAuth` admin.
 */

import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import {
  classifyTripAdminError,
  parseSecretInput,
  pickSecret,
  tripAdminErrorStatus,
  type TripAdminError,
} from '@/lib/trip-reminder/settings'

const NO_STORE = { 'Cache-Control': 'no-store' }

function refuse(error: TripAdminError): NextResponse {
  return NextResponse.json({ error }, { status: tripAdminErrorStatus(error), headers: NO_STORE })
}

export const PUT = withRateLimit(10, 60_000)(
  withAuth({ roles: ['admin'] }, async (req, _ctx, auth) => {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return refuse({ code: 'invalid_body' })
    }
    const input = parseSecretInput(body)
    if (!input) return refuse({ code: 'invalid_secret' })

    const { data, error } = await getSupabaseService()
      .schema('drive')
      .rpc('cms_set_provider_secret', { p_name: input.name, p_value: input.value, p_actor: auth.user.id })
    if (error) {
      console.error('[trip-reminder] secret write refused:', error.code)
      return refuse(classifyTripAdminError(error))
    }
    const slot = pickSecret(data)
    if (!slot) return refuse({ code: 'unknown' })
    return NextResponse.json(
      { name: slot.name, channel: slot.channel, configured_at: slot.configured_at, last4: slot.last4 },
      { headers: NO_STORE }
    )
  })
)
