import { getSupabase } from '../../../../lib/core/supabase-client'
import { NextResponse } from 'next/server'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = getSupabase('server')

export async function GET() {
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
}