/**
 * POST /api/auth/request-password-reset — sends the reset e-mail.
 *
 * Public by definition: whoever has lost the password has no session. It talks to
 * GoTrue (`/auth/v1/recover`) and never to PostgREST, which is why the publishable
 * key is legitimate here — for the Auth API that key identifies the project, it is
 * not a database role. Nothing else in this handler reads or writes a table.
 *
 * SEC-37: it used to build that client with `getSupabase('server')`, the same
 * factory the dashboards used to query personal data as `anon`. The cookie-bound
 * route-handler client carries the same publishable key and no extra privilege.
 */

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getSupabaseRouteHandler } from '@/lib/core/supabase-client'
import { withPublicRoute } from '@/lib/auth-middleware'
import { logAuditEvent } from '@/lib/services/audit-service'

export const POST = withPublicRoute(
  { reason: 'Password reset: the caller has no session by definition. GoTrue only, no table access.' },
  async (request: NextRequest) => {
  try {
    const { email } = await request.json()

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    const supabase = getSupabaseRouteHandler(await cookies())

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim())

    if (error) {
      await logAuditEvent({
        request,
        action: 'PASSWORD_RESET_REQUEST',
        entity: 'AUTH',
        entityId: null,
        userId: null,
        userEmail: email.trim(),
        description: `Password reset request failed: ${error.message}`
      })

      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await logAuditEvent({
      request,
      action: 'PASSWORD_RESET_REQUEST',
      entity: 'AUTH',
      entityId: null,
      userId: null,
      userEmail: email.trim(),
      description: 'Password reset requested'
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Password reset request error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
