/**
 * GET /api/attractions/coordinates?ids=uuid1,uuid2,...
 *
 * Retorna as coordenadas reais de um conjunto de atrações do banco.
 * Usado pelo RouteEditor para mostrar a posição exata do POI vinculado
 * a cada waypoint da rota (que pode diferir da posição do waypoint em si).
 *
 * Limite: 50 IDs por request (rotas têm no máximo ~20 waypoints).
 * Com 20 UUIDs de 36 chars = ~720 chars de URL — sem risco de overflow.
 *
 * Resposta: { coords: Array<{ id, name, latitude, longitude }> }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/core/supabase-client'
import { memoryCache } from '@/lib/cache/memory-cache'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const raw = searchParams.get('ids') ?? ''

    const ids = raw
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length === 36)   // UUID básico
      .slice(0, 50)                    // max 50 IDs

    if (ids.length === 0) {
      return NextResponse.json({ coords: [] })
    }

    const cacheKey = `attraction-coords:${ids.sort().join(',')}`
    const cached = memoryCache.get<any[]>(cacheKey)
    if (cached) {
      return NextResponse.json({ coords: cached, cached: true })
    }

    const supabase = getSupabase('service')

    const { data, error } = await supabase
      .schema('core')
      .from('attraction_coordinate')
      .select('attraction_id, latitude, longitude, attractions!inner(id, name)')
      .in('attraction_id', ids)

    if (error) {
      console.error('[attractions/coordinates] error:', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const coords = ((data ?? []) as any[]).map(row => {
      const attraction = Array.isArray(row.attractions) ? row.attractions[0] : row.attractions
      return {
        id:        attraction?.id ?? row.attraction_id,
        name:      attraction?.name ?? '',
        latitude:  row.latitude,
        longitude: row.longitude,
      }
    })

    // Cache 10 minutos (coordenadas de POIs são estáveis)
    memoryCache.set(cacheKey, coords, 10)

    return NextResponse.json({ coords })
  } catch (err) {
    console.error('[attractions/coordinates] unexpected:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
