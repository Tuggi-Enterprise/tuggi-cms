import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '../../../../lib/core/supabase-client'

const supabase = getSupabase('service')

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    console.log('🔍 Starting trigger points debug...')

    // Check total trigger points count
    const { data: allTPs, error: allError } = await supabase
      .schema('core')
      .from('attraction_trigger_points')
      .select('id, attraction_id, auto_status, final_status, is_active, created_at, confidence_score')

    if (allError) {
      console.error('❌ Error fetching all TPs:', allError)
      return NextResponse.json({
        success: false,
        error: `Error fetching trigger points: ${allError.message}`
      }, { status: 500 })
    }

    console.log(`📊 Found ${allTPs?.length || 0} total trigger points`)

    // Check specific attraction
    const url = new URL(request.url)
    const testAttractionId = url.searchParams.get('attraction_id') || '42ab01b0-66a1-493c-a209-e2a03682a3f7'

    const { data: specificTPs, error: specificError } = await supabase
      .schema('core')
      .from('attraction_trigger_points')
      .select('*')
      .eq('attraction_id', testAttractionId)

    if (specificError) {
      console.error('❌ Error fetching specific TPs:', specificError)
      return NextResponse.json({
        success: false,
        error: `Error fetching specific TPs: ${specificError.message}`
      }, { status: 500 })
    }

    // Test the same query as the frontend (with anon key)
    const frontendSupabase = getSupabase('server')

    const { data: frontendQuery, error: frontendError } = await frontendSupabase
      .schema('core')
      .from('attraction_trigger_points')
      .select('id, confidence_score, auto_status, created_at')
      .eq('attraction_id', testAttractionId)

    console.log(`🔍 Frontend query result: ${frontendQuery?.length || 0} TPs`)
    if (frontendError) {
      console.error('❌ Frontend query error:', frontendError)
    }

    // Get attractions with trigger points
    const attractionIds = [...new Set(allTPs?.map(tp => tp.attraction_id) || [])]
    console.log(`📊 ${attractionIds.length} unique attractions have trigger points`)

    // Sample some attraction names
    const { data: sampleAttractions } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name')
      .in('id', attractionIds.slice(0, 5))

    return NextResponse.json({
      success: true,
      summary: {
        total_trigger_points: allTPs?.length || 0,
        unique_attractions_with_tps: attractionIds.length,
        trigger_points_by_status: {
          approved: allTPs?.filter(tp => tp.auto_status === 'approved').length || 0,
          review: allTPs?.filter(tp => tp.auto_status === 'review').length || 0,
          rejected: allTPs?.filter(tp => tp.auto_status === 'rejected').length || 0,
          active: allTPs?.filter(tp => tp.is_active).length || 0,
          inactive: allTPs?.filter(tp => !tp.is_active).length || 0
        },
        sample_attractions_with_tps: sampleAttractions || []
      },
      test_attraction: {
        attraction_id: testAttractionId,
        service_role_query: {
          count: specificTPs?.length || 0,
          trigger_points: specificTPs || []
        },
        frontend_query: {
          count: frontendQuery?.length || 0,
          error: frontendError?.message || null,
          trigger_points: frontendQuery || []
        }
      },
      debugging_info: {
        service_role_key_configured: !!process.env.SUPABASE_SECRET_KEY,
        anon_key_configured: !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        url_configured: !!process.env.NEXT_PUBLIC_SUPABASE_URL
      }
    })

  } catch (error) {
    console.error('❌ Error in debug API:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
