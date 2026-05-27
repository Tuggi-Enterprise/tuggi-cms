import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/core/supabase-client'

const supabase = getSupabase('service')

export const dynamic = 'force-dynamic'

function parseBoundary(raw: unknown): Array<{ lat: number; lng: number }> | null {
  if (!raw) return null
  try {
    const geojson = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (geojson?.type === 'Polygon' && Array.isArray(geojson.coordinates?.[0])) {
      const coords = geojson.coordinates[0]
        .map((c: [number, number]) => ({ lat: c[1], lng: c[0] }))
      if (coords.length > 1) coords.pop() // drop the closing point
      return coords
    }
    if (geojson?.type === 'MultiPolygon' && Array.isArray(geojson.coordinates?.[0]?.[0])) {
      // Use only the first ring of the first polygon for visualization
      const coords = geojson.coordinates[0][0]
        .map((c: [number, number]) => ({ lat: c[1], lng: c[0] }))
      if (coords.length > 1) coords.pop()
      return coords
    }
  } catch (e) {
    console.error('[pois/:id/trigger-points] boundary parse error:', e)
  }
  return null
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: poiId } = await params

    if (!poiId) {
      return NextResponse.json({ error: 'POI id is required' }, { status: 400 })
    }

    const [tpsResult, boundaryResult] = await Promise.all([
      supabase
        .schema('core')
        .from('trigger_points_with_coords')
        .select('id, attraction_id, latitude, longitude, expected_bearing, is_active, type, priority, radius_meters')
        .eq('attraction_id', poiId),
      supabase
        .schema('core')
        .rpc('get_boundary_geometry', { p_attraction_id: poiId })
    ])

    if (tpsResult.error) {
      console.error('[pois/:id/trigger-points] TPs DB error:', tpsResult.error)
      return NextResponse.json({ error: tpsResult.error.message }, { status: 500 })
    }

    const trigger_points = (tpsResult.data ?? []).map((tp: any) => ({
      id: tp.id,
      latitude: tp.latitude,
      longitude: tp.longitude,
      bearing: tp.expected_bearing,
      is_active: tp.is_active,
      type: tp.type,
      priority: tp.priority,
      radius_meters: tp.radius_meters
    }))

    // Boundary is optional — log if it errors but don't fail the request
    let boundary: Array<{ lat: number; lng: number }> | null = null
    if (boundaryResult.error) {
      console.warn('[pois/:id/trigger-points] boundary RPC error:', boundaryResult.error.message)
    } else {
      boundary = parseBoundary(boundaryResult.data)
    }

    return NextResponse.json({ trigger_points, boundary })
  } catch (err) {
    console.error('[pois/:id/trigger-points] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
