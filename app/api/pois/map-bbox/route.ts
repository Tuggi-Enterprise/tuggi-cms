/**
 * GET /api/pois/map-bbox
 *
 * Retorna POIs dentro de um bounding box para exibição no mapa.
 * Usado pelo RouteEditor para mostrar POIs do Tuggi ao longo da rota.
 *
 * ## Estratégia de distribuição geográfica (Grade 4×4)
 *
 * O problema com LIMIT 80 direto: o banco retorna os primeiros 80 por ordem de
 * inserção, todos concentrados em uma faixa geográfica. Para cobrir o viewport
 * inteiro, dividimos o bbox em uma grade 4×4 (16 células) e buscamos até 5 POIs
 * por célula em paralelo. Resultado: até 80 POIs bem distribuídos pela tela.
 *
 * Parâmetros:
 *   min_lat, min_lng, max_lat, max_lng  — bounding box em graus
 *   limit                               — máximo total de pontos (padrão 80)
 *
 * Resposta:
 *   { pois: Array<{ id, name, latitude, longitude }>, cached?: boolean }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/core/supabase-client'
import { memoryCache } from '@/lib/cache/memory-cache'

export const dynamic = 'force-dynamic'

const GRID = 4  // 4×4 = 16 células

/**
 * Calcula o limite de POIs com base na área do viewport.
 * Quanto maior a área visível, mais POIs são exibidos (até 200).
 * Fórmula: área em graus² normalizada para a faixa [40, 200].
 */
function calcDynamicLimit(minLat: number, maxLat: number, minLng: number, maxLng: number, explicitLimit?: number): number {
  if (explicitLimit) return Math.min(explicitLimit, 200)
  // Área do viewport em graus²
  const area = (maxLat - minLat) * (maxLng - minLng)
  // Faixas empíricas para uso urbano:
  //   área ~0.001 (zoom 16, rua)   → ~40 POIs
  //   área ~0.01  (zoom 13, bairro) → ~80 POIs
  //   área ~0.1   (zoom 11, cidade) → ~160 POIs
  //   área >= 0.5 (zoom 9, região)  → 200 POIs (max)
  const raw = Math.round(40 + (area / 0.5) * 160)
  return Math.min(Math.max(raw, 40), 200)
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)

    const minLat = parseFloat(searchParams.get('min_lat') ?? '')
    const minLng = parseFloat(searchParams.get('min_lng') ?? '')
    const maxLat = parseFloat(searchParams.get('max_lat') ?? '')
    const maxLng = parseFloat(searchParams.get('max_lng') ?? '')
    const rawLimit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : undefined
    const limit  = calcDynamicLimit(minLat, maxLat, minLng, maxLng, rawLimit)

    if ([minLat, minLng, maxLat, maxLng].some(isNaN)) {
      return NextResponse.json(
        { error: 'min_lat, min_lng, max_lat, max_lng são obrigatórios' },
        { status: 400 }
      )
    }

    // Cache key com 4 casas decimais (~11m de precisão — suficiente para mapa)
    const cacheKey = `pois-bbox-grid:${minLat.toFixed(4)},${minLng.toFixed(4)},${maxLat.toFixed(4)},${maxLng.toFixed(4)}:${limit}`
    const cached = memoryCache.get<any[]>(cacheKey)
    if (cached) {
      return NextResponse.json({ pois: cached, cached: true })
    }

    const supabase   = getSupabase('service')
    const perCell    = Math.ceil(limit / (GRID * GRID))  // ex: ceil(80/16) = 5
    const cellLat    = (maxLat - minLat) / GRID
    const cellLng    = (maxLng - minLng) / GRID

    // Gerar queries para cada célula da grade (disparadas em paralelo)
    const cellQueries = []
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        const cMinLat = minLat + r * cellLat
        const cMaxLat = cMinLat + cellLat
        const cMinLng = minLng + c * cellLng
        const cMaxLng = cMinLng + cellLng

        cellQueries.push(
          supabase
            .schema('core')
            .from('attraction_coordinate')
            .select('attraction_id, latitude, longitude, attractions!inner(id, name)')
            .gte('latitude',  cMinLat)
            .lte('latitude',  cMaxLat)
            .gte('longitude', cMinLng)
            .lte('longitude', cMaxLng)
            .limit(perCell)
        )
      }
    }

    // Executar todas as 16 queries em paralelo
    const results = await Promise.all(cellQueries)

    // Flatten + deduplicação por attraction_id
    const seen    = new Set<string>()
    const allPois: any[] = []

    for (const { data } of results) {
      for (const row of (data ?? []) as any[]) {
        if (!seen.has(row.attraction_id)) {
          seen.add(row.attraction_id)
          const attraction = Array.isArray(row.attractions)
            ? row.attractions[0]
            : row.attractions
          allPois.push({
            id:        attraction?.id ?? row.attraction_id,
            name:      attraction?.name ?? '',
            latitude:  row.latitude,
            longitude: row.longitude,
          })
        }
      }
    }

    // Cache 5 minutos (mesma política de /api/pois/search)
    memoryCache.set(cacheKey, allPois, 5)

    return NextResponse.json({ pois: allPois })

  } catch (err) {
    console.error('[map-bbox] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
