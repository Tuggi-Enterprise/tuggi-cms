/**
 * POST /api/admin/trip-reminder/test-send `{ piece, channel }` — "send a test to me" (#1233,
 * BR-COMUNICACAO-024 item 9): the `trip-message-test` Edge Function sends the piece on the channel
 * to the logged admin's e-mail and phone, and records it as `piece = 'test'`.
 *
 * Admin only here, and again in the function (the token). The reply is the function's
 * `{ ok, channel, error_code? }` and nothing else (`toTestSendResult`), so a provider message never
 * reaches the screen. `withRateLimit` is a double-click brake.
 */

import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { isTemplatePiece, isTestChannel } from '@/lib/trip-reminder/settings'
import { callTripMessageTest } from '@/lib/trip-reminder/test-send'

export const POST = withRateLimit(10, 60_000)(
  withAuth({ roles: ['admin'] }, async (req, _ctx, auth) => {
    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 })
    }
    const piece = body?.piece
    const channel = body?.channel
    if (!isTemplatePiece(piece) || !isTestChannel(channel)) {
      return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 })
    }

    // `withAuth` already proved the user with `getUser()`; the token only travels, and the function
    // proves it again against the Auth server.
    const { data } = await auth.supabase.auth.getSession()
    const token = typeof data?.session?.access_token === 'string' ? data.session.access_token : null
    if (!token) return NextResponse.json({ ok: false, channel, error_code: 'relogin' }, { status: 401 })

    const result = await callTripMessageTest({ piece, channel }, token)
    if (result.status !== 200) {
      console.error('[trip-reminder] test send did not answer:', result.status, result.body.error_code)
    }
    return NextResponse.json(result.body, { status: result.status })
  })
)
