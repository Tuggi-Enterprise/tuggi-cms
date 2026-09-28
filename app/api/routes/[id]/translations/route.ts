/**
 * GET  /api/routes/[id]/translations  — lista todas as traduções da rota
 * POST /api/routes/[id]/translations  — salva edição manual de um idioma
 *
 * Auth: `withAuth` (admin, client) — ver PORTÃO abaixo.
 * DB:   usa getSupabase('service') para operações que precisam ignorar RLS
 *       (o admin precisa ler/escrever traduções de qualquer rota do cliente).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/core/supabase-client'
import { withAuth } from '@/lib/auth-middleware'

export const dynamic = 'force-dynamic'

// ─── Auth helper ──────────────────────────────────────────────────────────────

/**
 * PORTÃO (#780): `withAuth({ roles: ['admin', 'client'] })`. Quem chama é
 * `components/routes/RouteTranslationsPanel`, dentro do editor de `/routes`, tela que o proxy abre
 * para `admin` e `client` (`lib/navigation/access.ts#resolveAccess`). Antes: só `getSession()`,
 * que lê o cookie sem revalidar o JWT.
 */
type Params = { id: string }

// ─── GET — listar traduções ────────────────────────────────────────────────────
export const GET = withAuth<Params>({ roles: ['admin', 'client'] }, async (_req: NextRequest, ctx) => {
  const { id: routeId } = (await ctx.params) as Params
  const supabase = getSupabase('service')

  // Buscar dados originais da rota (conteúdo base)
  const { data: route, error: routeError } = await supabase
    .schema('core')
    .from('custom_routes')
    .select('id, name, description')
    .eq('id', routeId)
    .maybeSingle()

  if (routeError || !route) {
    return NextResponse.json({ error: 'Route not found' }, { status: 404 })
  }

  // Buscar todas as traduções disponíveis
  const { data: translations, error: transError } = await supabase
    .schema('core')
    .from('custom_route_descriptions')
    .select('id, language, gender, name, description, audio_url, status, manually_edited, manually_edited_at, updated_at')
    .eq('route_id', routeId)
    .order('language')
    .order('gender')

  if (transError) {
    return NextResponse.json({ error: transError.message }, { status: 500 })
  }

  return NextResponse.json({
    original: { name: route.name, description: route.description },
    translations: translations ?? [],
  })
})

// ─── POST — salvar edição manual ──────────────────────────────────────────────
export const POST = withAuth<Params>({ roles: ['admin', 'client'] }, async (req: NextRequest, ctx) => {
  const { id: routeId } = (await ctx.params) as Params
  const body = await req.json()
  const { language, gender = 'male', name, description } = body

  if (!language) {
    return NextResponse.json({ error: 'language is required' }, { status: 400 })
  }

  const supabase = getSupabase('service')

  const { data, error } = await supabase
    .schema('core')
    .from('custom_route_descriptions')
    .upsert({
      route_id:           routeId,
      language,
      gender,
      name,
      description,
      status:             'ready',
      manually_edited:    true,
      manually_edited_at: new Date().toISOString(),
      updated_at:         new Date().toISOString(),
    }, { onConflict: 'route_id,language,gender' })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ translation: data })
})
