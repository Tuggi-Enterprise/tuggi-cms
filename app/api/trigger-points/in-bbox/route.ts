import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/core/supabase-client'

const supabase = getSupabase('service')

export const dynamic = 'force-dynamic'

const BBOX_LIMIT_DEFAULT = 1000

/**
 * GET /api/trigger-points/in-bbox
 *
 * Returns all TPs (any status) inside a bounding box for the /pois map bulk mode.
 * Supports a `count_only` flag to get just the count (for guardrail before loading).
 *
 * Query params:
 *   min_lat, min_lng, max_lat, max_lng  — required
 *   limit                               — default 1000
 *   count_only                          — '1' returns { count } only
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const minLat = parseFloat(searchParams.get('min_lat') ?? '')
    const minLng = parseFloat(searchParams.get('min_lng') ?? '')
    const maxLat = parseFloat(searchParams.get('max_lat') ?? '')
    const maxLng = parseFloat(searchParams.get('max_lng') ?? '')
    const countOnly = searchParams.get('count_only') === '1'
    const limit = parseInt(searchParams.get('limit') ?? `${BBOX_LIMIT_DEFAULT}`, 10)

    if ([minLat, minLng, maxLat, maxLng].some(Number.isNaN)) {
      return NextResponse.json(
        { error: 'min_lat, min_lng, max_lat, max_lng are required' },
        { status: 400 }
      )
    }

    if (countOnly) {
      const { data, error } = await supabase
        .schema('core')
        .rpc('cms_count_trigger_points_map_bbox', {
          min_lat: minLat,
          min_lng: minLng,
          max_lat: maxLat,
          max_lng: maxLng
        })

      if (error) {
        console.error('[trigger-points/in-bbox count] DB error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      return NextResponse.json({ count: typeof data === 'number' ? data : 0 })
    }

    const { data, error } = await supabase
      .schema('core')
      .rpc('cms_get_trigger_points_map_bbox', {
        min_lat: minLat,
        min_lng: minLng,
        max_lat: maxLat,
        max_lng: maxLng,
        p_limit: limit
      })

    if (error) {
      console.error('[trigger-points/in-bbox] DB error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ trigger_points: data ?? [] })
  } catch (err) {
    console.error('[trigger-points/in-bbox] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
