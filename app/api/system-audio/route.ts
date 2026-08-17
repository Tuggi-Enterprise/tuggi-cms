/**
 * /api/system-audio — proxy for the `generate-system-audio` Edge Function.
 *
 * The browser never calls the Edge Function directly: this route owns the auth. It
 * forwards the operator's own `access_token`, because `SUPABASE_SECRET_KEY` is in the
 * `sb_secret_...` format and is NOT a JWT, while Edge Functions require a Bearer JWT
 * — the same trap already documented in
 * `app/api/routes/[id]/translations/generate/route.ts`.
 *
 * The catalogue (keys, locales, copy, voices) is NOT restated here. It lives in
 * `supabase/functions/_shared/systemAudioScripts.ts` and reaches the screen through
 * the `GET` payload, so there is one list in the codebase and not two that drift.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import type { AuthContext } from '@/lib/auth-middleware'

export const dynamic = 'force-dynamic'

const FUNCTION_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/generate-system-audio`

async function callFunction(
  auth: AuthContext,
  method: 'GET' | 'POST' | 'DELETE',
  body?: unknown
): Promise<Response> {
  const { data: { session } } = await auth.supabase.auth.getSession()

  if (!session?.access_token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const res = await fetch(FUNCTION_URL, {
    method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

  const payload = await res.json().catch(() => ({ error: 'Edge Function returned no JSON' }))
  return NextResponse.json(payload, { status: res.status })
}

/** Catalogue + inventory of what is in the bucket. */
export const GET = withAuth({ roles: ['admin'] }, async (_req: NextRequest, _ctx, auth) =>
  callFunction(auth, 'GET')
)

/**
 * Generates one clip (or, with `previewOnly`, only resolves the text). Rate limited
 * because each call is a Google TTS synthesis and a Gemini translation.
 *
 * The ceiling is 240/min, not 60: the screen's normal move is one batch of 12 keys ×
 * 12 locales × 2 voices, and a limit that turns the intended workflow into a 429 is a
 * limit that only teaches the operator to retry.
 */
export const POST = withRateLimit(240, 60_000)(
  withAuth({ roles: ['admin'] }, async (req: NextRequest, _ctx, auth) =>
    callFunction(auth, 'POST', await req.json())
  )
)

/** Deletes one file. The Edge Function validates the path against the parser. */
export const DELETE = withAuth({ roles: ['admin'] }, async (req: NextRequest, _ctx, auth) =>
  callFunction(auth, 'DELETE', await req.json())
)
