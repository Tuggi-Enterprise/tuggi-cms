/**
 * GET /api/pois/count — city-correction counters over core.attractions.
 *
 * SEC-37 + CARD-CMS-01. The counts were read with `getSupabase('server')`, i.e. as
 * `anon`, from a route nobody gated. It now runs with the operator's own JWT.
 * The two unused module constants that named `SUPABASE_SECRET_KEY` went with it:
 * they made a grep classify this route as service_role, which was the opposite of
 * the truth.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'

export const GET = withAuth({ roles: ['admin'] }, async (_req, _ctx, auth) => {
  const supabase = auth.supabase
  try {
    // Get total POIs count
    const { count: totalPOIs } = await supabase
      .schema('core')
      .from('attractions')
      .select('id', { count: 'exact', head: true })

    // Get processed POIs count
    const { count: processedPOIs } = await supabase
      .schema('core')
      .from('attractions')
      .select('id', { count: 'exact', head: true })
      .not('city_correction_audit', 'is', null)

    // Get pending POIs count
    const { count: pendingPOIs } = await supabase
      .schema('core')
      .from('attractions')
      .select('id', { count: 'exact', head: true })
      .is('city_correction_audit', null)

    // Get POIs with coordinates (can be processed) - use count to avoid 1000 limit
    const { count: poisWithCoords } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, attraction_coordinate!inner(id)', { count: 'exact', head: true })
      .is('city_correction_audit', null)

    // Get manual review count
    const { count: manualReviewCount } = await supabase
      .schema('core')
      .from('attractions')
      .select('id', { count: 'exact', head: true })
      .eq('city_correction_audit->needs_manual_review', true)

    return NextResponse.json({
      success: true,
      data: {
        total_pois: totalPOIs || 0,
        processed_pois: processedPOIs || 0,
        pending_pois: pendingPOIs || 0,
        pois_with_coordinates: poisWithCoords || 0,
        pois_without_coordinates: (pendingPOIs || 0) - (poisWithCoords || 0),
        manual_review_needed: manualReviewCount || 0,
        corrections_applied: processedPOIs || 0
      }
    })

  } catch (error) {
    console.error('Error getting POI counts:', error)
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
})
