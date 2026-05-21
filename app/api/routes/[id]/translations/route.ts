/**
 * GET  /api/routes/[id]/translations  — lista todas as traduções da rota
 * POST /api/routes/[id]/translations  — salva edição manual de um idioma
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/core/supabase-client'

export const dynamic = 'force-dynamic'

// ─── GET — listar traduções ────────────────────────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const routeId = params.id
  const supabase = getSupabase('service')

  // Buscar dados originais da rota (pt-BR)
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
  { params }: { params: { id: string } }
) {
  const routeId = params.id
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
