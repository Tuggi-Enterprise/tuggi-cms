/**
 * POST /api/routes/[id]/translations/generate
 *
 * Proxy para a Edge Function generate-translated-audio (route mode).
 * O browser não chama a EF diretamente — esta rota CMS gerencia a auth.
 *
 * Problema anterior: getSupabaseService() usa a SUPABASE_SECRET_KEY no
 * formato sb_secret_... que NÃO é um JWT válido. As Edge Functions do
 * Supabase exigem um Bearer JWT.
 *
 * Solução: obter o access_token da sessão autenticada do utilizador e
 * passar explicitamente no header Authorization — mesmo padrão do hook
 * useAuthenticatedFunctionCall usado no POI management.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'

export const dynamic = 'force-dynamic'

/**
 * PORTÃO (#780): `withAuth({ roles: ['admin', 'client'] })` — chamado pelo
 * `components/routes/RouteTranslationsPanel`, no editor de `/routes` (admin e client). O
 * `getSession()` que sobra só LÊ o `access_token` para repassar à EF, depois de `withAuth` já ter
 * revalidado o JWT com `getUser()` — mesmo padrão de `app/api/system-audio/route.ts`.
 */
export const POST = withAuth<{ id: string }>({ roles: ['admin', 'client'] }, async (req: NextRequest, ctx, auth) => {
  const { id: routeId } = (await ctx.params) as { id: string }
  const body = await req.json()
  const { language, gender = 'male', generateAudio = true } = body

  if (!language) {
    return NextResponse.json({ error: 'language is required' }, { status: 400 })
  }

  // ── Autenticação — obter JWT da sessão do utilizador ──────────────────────
  const { data: { session }, error: authError } = await auth.supabase.auth.getSession()

  if (authError || !session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const jwt = session.access_token

  // ── Chamar a EF com o JWT válido do utilizador ────────────────────────────
  const efUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/generate-translated-audio`

  const efRes = await fetch(efUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      routeId,
      targetLanguage: language,
      voiceGender:    gender,
      generateAudio,
    }),
  })

  if (!efRes.ok) {
    const errText = await efRes.text().catch(() => efRes.statusText)
    console.error('[translations/generate] EF error:', efRes.status, errText.slice(0, 200))
    return NextResponse.json(
      { error: `Edge Function error ${efRes.status}: ${errText.slice(0, 100)}` },
      { status: efRes.status }
    )
  }

  const data = await efRes.json()
  return NextResponse.json(data)
})
