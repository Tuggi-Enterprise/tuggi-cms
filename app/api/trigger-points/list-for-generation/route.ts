import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '../../../../lib/core/supabase-client'

const supabase = getSupabase('service')

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const country = searchParams.get('country')
    const state = searchParams.get('state')
    const city = searchParams.get('city')
    const processingType = searchParams.get('processing_type') || 'without_trigger_points'
    const limit = parseInt(searchParams.get('limit') || '50')

    console.log('🔍 Loading POIs for trigger point generation:', {
      country,
      state,
      city,
      processingType,
      limit
    })

    // Build the base query
    let query = supabase
      .schema('core')
      .from('attractions')
      .select(`
        id,
        name,
        city,
        state,
        country,
        google_place_id,
        osm_category,
        osm_data_quality_score,
        heritage_status,
        unesco_status,
        pov_quality_score,
        verification_status,
        approved,
        last_processed_at,
        trigger_points_count:attraction_trigger_points(count)
      `)
      .eq('approved', true) // Only approved POIs

    // Apply country filter
    if (country) {
      query = query.eq('country', country)
    }

    // Apply state filter
    if (state) {
      query = query.eq('state', state)
    }

    // Apply city filter
    if (city) {
      query = query.eq('city', city)
    }

    // Note: Processing type filters will be applied after fetching data

    query = query.limit(limit)

    const { data: attractions, error } = await query

    if (error) {
      console.error('❌ Error fetching attractions:', error)
      return NextResponse.json(
        { success: false, error: 'Failed to fetch attractions' },
        { status: 500 }
      )
    }

    // Get trigger point counts for each attraction
    const attractionIds = attractions?.map(a => a.id) || []
    
    let triggerPointCounts: { [key: string]: number } = {}
    
    if (attractionIds.length > 0) {
      const { data: tpCounts, error: tpError } = await supabase
        .schema('core')
        .from('attraction_trigger_points')
        .select('attraction_id')
        .in('attraction_id', attractionIds)

      if (!tpError && tpCounts) {
        // Count trigger points per attraction
        triggerPointCounts = tpCounts.reduce((acc, tp) => {
          acc[tp.attraction_id] = (acc[tp.attraction_id] || 0) + 1
          return acc
        }, {} as { [key: string]: number })
      }
    }

    // Process and filter the results
    let processedPois = attractions?.map(poi => ({
      id: poi.id,
      name: poi.name,
      city: poi.city,
      state: poi.state,
      country: poi.country,
      google_place_id: poi.google_place_id,
      osm_category: poi.osm_category,
      osm_data_quality_score: poi.osm_data_quality_score,
      heritage_status: poi.heritage_status,
      unesco_status: poi.unesco_status,
      pov_quality_score: poi.pov_quality_score,
      verification_status: poi.verification_status,
      approved: poi.approved,
      trigger_points_count: triggerPointCounts[poi.id] || 0,
      has_boundary: poi.osm_data_quality_score && poi.osm_data_quality_score > 0,
      last_processed_at: poi.last_processed_at
    })) || []

    // Apply post-processing filters
    switch (processingType) {
      case 'without_trigger_points':
        processedPois = processedPois.filter(poi => poi.trigger_points_count === 0)
        break
      case 'with_few_trigger_points':
        processedPois = processedPois.filter(poi => poi.trigger_points_count > 0 && poi.trigger_points_count < 3)
        break
      case 'all_approved':
        // No additional filtering needed
        break
      case 'needs_update':
        // Filter POIs that haven't been processed recently (older than 30 days or never processed)
        const thirtyDaysAgo = new Date()
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
        processedPois = processedPois.filter(poi => {
          if (!poi.last_processed_at) return true // Never processed
          const lastProcessed = new Date(poi.last_processed_at)
          return lastProcessed < thirtyDaysAgo // Older than 30 days
        })
        break
    }

    // Sort by priority: heritage sites first, then by name
    processedPois.sort((a, b) => {
      // Heritage sites first
      const aHeritage = a.heritage_status || a.unesco_status
      const bHeritage = b.heritage_status || b.unesco_status
      
      if (aHeritage && !bHeritage) return -1
      if (!aHeritage && bHeritage) return 1
      
      // Then by name
      return a.name.localeCompare(b.name)
    })

    console.log(`✅ Loaded ${processedPois.length} POIs for trigger point generation`)

    return NextResponse.json({
      success: true,
      pois: processedPois,
      total: processedPois.length,
      filters: {
        country,
        state,
        city,
        processing_type: processingType,
        limit
      }
    })

  } catch (error) {
    console.error('❌ Error in list-for-generation API:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
