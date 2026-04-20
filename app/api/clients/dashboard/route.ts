import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseRouteHandler } from '@/lib/core/supabase-client'
import { cookies } from 'next/headers'

export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const supabase = getSupabaseRouteHandler(cookieStore)

    const { data: { session }, error: sessionErr } = await supabase.auth.getSession()
    if (sessionErr) return NextResponse.json({ error: 'Auth session error', details: sessionErr.message }, { status: 500 })
    if (!session) return NextResponse.json({ error: 'No active session' }, { status: 401 })

    // Lookup cms_user
    const { data: cmsUser, error: cmsErr } = await supabase
      .schema('core')
      .from('cms_users')
      .select('id, email, full_name, role, is_active')
      .eq('email', session.user.email)
      .maybeSingle()

    if (cmsErr) return NextResponse.json({ error: 'CMS user lookup failed', details: cmsErr.message }, { status: 500 })
    if (!cmsUser) return NextResponse.json({ error: 'CMS user not found' }, { status: 403 })

    // Only allow clients (and admins optionally) to use this endpoint
    if (cmsUser.role !== 'client' && cmsUser.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get POI stats via existing RPC but scoped to owner
    const rpcParams: any = {
      search_term: null,
      status_filter: 'all',
      country_filter: null,
      state_filter: null,
      city_filter: null,
      google_types_filter: null,
      category_filter: null,
      content_status_filter: null,
      group_status_filter: null,
      score_filter: null,
      trigger_points_filter: null,
      limit_count: 1,
      offset_count: 0,
      fetch_all: true
    }

    const { data: statsData, error: statsErr } = await supabase
      .schema('core')
      .rpc('cms_search_pois', rpcParams)

    if (statsErr) {
      console.warn('Client dashboard: cms_search_pois RPC error (falling back to simple counts):', statsErr.message)
    }

    // City distribution: aggregate simple select scoped to owner
    const { data: citiesData, error: citiesErr } = await supabase
      .schema('core')
      .from('attractions')
      .select('city')
      .eq('created_by', cmsUser.id)

    if (citiesErr) {
      console.warn('Client dashboard: city aggregation failed:', citiesErr.message)
    }

    // Aggregate city counts in JS (safest and simple)
    const cityCounts: Record<string, number> = Object.create(null)
    if (citiesData && Array.isArray(citiesData)) {
      citiesData.forEach((r: any) => {
        const city = String(r?.city || 'Unknown').trim()
        if (city && city !== 'Unknown') {
          cityCounts[city] = (cityCounts[city] || 0) + 1
        }
      })
    }

    const cityDistribution = Object.entries(cityCounts)
      .map(([city, count]) => ({ city, poi_count: count }))
      .sort((a, b) => b.poi_count - a.poi_count)
      .slice(0, 50)

    // Compose POI stats
    const poiStatsFromRpc = (statsData && statsData.length > 0) ? statsData[0] : null

    const poiStats = {
      total: poiStatsFromRpc?.total_count ?? (citiesData ? citiesData.length : 0),
      approved: poiStatsFromRpc?.approved_count ?? null,
      pending: poiStatsFromRpc?.pending_count ?? null,
      with_description: poiStatsFromRpc?.with_description_count ?? null,
      with_audio: poiStatsFromRpc?.with_audio_count ?? null,
      with_trigger_points: poiStatsFromRpc?.with_trigger_points_count ?? null
    }

    return NextResponse.json({
      success: true,
      data: {
        cmsUser: {
          id: cmsUser.id,
          email: cmsUser.email,
          full_name: cmsUser.full_name,
          role: cmsUser.role
        },
        poiStats,
        cityDistribution
      }
    })
  } catch (err) {
    console.error('Client dashboard route error:', err)
    return NextResponse.json({ error: 'Internal server error', details: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
