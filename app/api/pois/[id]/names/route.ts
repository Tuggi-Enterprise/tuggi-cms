/**
 * GET  /api/pois/[id]/names  — lista os nomes traduzidos do POI por idioma
 * POST /api/pois/[id]/names  — salva edição manual do nome de um idioma
 *
 * Espelha /api/routes/[id]/translations, mas para o NOME do POI, que mora em
 * core.attraction_descriptions.name (SSOT: junto da descrição daquele idioma).
 * O nome é independente de gênero, então a escrita atinge todas as linhas de
 * (attraction_id, language) via upsertPoiName.
 *
 * Auth: sessão via getSupabaseRouteHandler. DB: service role para ignorar RLS.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase, getSupabaseRouteHandler } from '@/lib/core/supabase-client'
import { upsertPoiName } from '@/lib/core/poi-descriptions-service'
import { cookies } from 'next/headers'

export const dynamic = 'force-dynamic'

async function requireAuth() {
  const cookieStore = await cookies()
  const supabaseAuth = getSupabaseRouteHandler(cookieStore)
  const { data: { session }, error } = await supabaseAuth.auth.getSession()
  if (error || !session) return null
  return session
}

// ─── GET — nome original + nomes traduzidos por idioma ──────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: poiId } = await params
  const supabase = getSupabase('service')

  // Nome canônico (original) do POI
  const { data: poi, error: poiError } = await supabase
    .schema('core')
    .from('attractions')
    .select('id, name')
    .eq('id', poiId)
    .maybeSingle()

  if (poiError || !poi) {
    return NextResponse.json({ error: 'POI not found' }, { status: 404 })
  }

  // Nomes traduzidos: um por idioma (independente de gênero — colapsamos linhas)
  const { data: rows, error: rowsError } = await supabase
    .schema('core')
    .from('attraction_descriptions')
    .select('language, name, updated_at')
    .eq('attraction_id', poiId)
    .order('language')

  if (rowsError) {
    return NextResponse.json({ error: rowsError.message }, { status: 500 })
  }

  const byLanguage = new Map<string, { language: string; name: string | null; updated_at: string }>()
  for (const r of rows ?? []) {
    if (!byLanguage.has(r.language)) {
      byLanguage.set(r.language, { language: r.language, name: r.name ?? null, updated_at: r.updated_at })
    }
  }

  return NextResponse.json({
    original: { name: poi.name },
    names: Array.from(byLanguage.values()),
  })
}

// ─── POST — salvar edição manual do nome de um idioma ───────────────────────────
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: poiId } = await params
  const body = await req.json()
  const { language, name } = body

  if (!language || typeof name !== 'string') {
    return NextResponse.json({ error: 'language and name are required' }, { status: 400 })
  }

  const supabase = getSupabase('service')

  try {
    const rowsUpdated = await upsertPoiName(supabase, poiId, language, name)
    return NextResponse.json({ language, name, rowsUpdated })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed to save name' }, { status: 500 })
  }
}
