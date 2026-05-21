/**
 * GET  /api/routes/[id]/translations  — lista todas as traduções da rota
 * POST /api/routes/[id]/translations  — salva edição manual de um idioma
 *
 * Auth: verifica sessão via getSupabaseRouteHandler (como todas as outras rotas).
 * DB:   usa getSupabase('service') para operações que precisam ignorar RLS
 *       (o admin precisa ler/escrever traduções de qualquer rota do cliente).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase, getSupabaseRouteHandler } from '@/lib/core/supabase-client'
import { cookies } from 'next/headers'

export const dynamic = 'force-dynamic'

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function requireAuth() {
  const cookieStore = await cookies()
  const supabaseAuth = getSupabaseRouteHandler(cookieStore)
  const { data: { session }, error } = await supabaseAuth.auth.getSession()
  if (error || !session) return null
  return session
}

// ─── GET — listar traduções ────────────────────────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: routeId } = await params
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
}

// ─── POST — salvar edição manual ──────────────────────────────────────────────
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: routeId } = await params
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
}
