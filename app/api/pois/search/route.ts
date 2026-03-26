import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '../../../../lib/core/supabase-client'
import { memoryCache } from '@/lib/cache/memory-cache'
import { cookies } from 'next/headers'

const supabase = getSupabase('service')

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    
    // Parse query parameters
    const search = searchParams.get('search') || ''
    const status = searchParams.get('status') || 'all'
    const country = searchParams.get('country') || ''
    const state = searchParams.get('state') || ''
    const city = searchParams.get('city') || ''
    const googleTypes = searchParams.get('googleTypes') || ''
    const category = searchParams.get('category') || ''
    const contentStatus = searchParams.get('contentStatus') || 'all'
    const groupStatus = searchParams.get('groupStatus') || 'all'
    const scoreFilter = searchParams.get('scoreFilter') || 'all'
    const triggerPointsFilter = searchParams.get('triggerPointsFilter') || 'all'
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const all = searchParams.get('all') === 'true' // New parameter for total counts
    const mapView = searchParams.get('mapView') === 'true' // New parameter for map view (no pagination)
    
    // Calculate pagination
    const startIndex = (page - 1) * limit
    const endIndex = startIndex + limit - 1
    
    console.log('🔍 POI Search API:', {
      search, status, country, state, city, googleTypes, category, contentStatus,
      groupStatus, scoreFilter, triggerPointsFilter, page, limit, all
    })
    
    // Check if we have complex filters that require post-processing
    const hasComplexFilters = contentStatus !== 'all' || groupStatus !== 'all' || 
                             scoreFilter !== 'all' || triggerPointsFilter !== 'all'

    // Enhanced caching for better performance with large datasets
    const sortedParams = Object.entries({
      search, status, country, state, city, googleTypes, category, contentStatus,
      groupStatus, scoreFilter, triggerPointsFilter, page, limit
    })
      .filter(([_, value]) => value !== null && value !== undefined && value !== '' && value !== 'all')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('&')
    
    // If 'all=true', check cache first for total counts
    if (all) {
      const cacheKey = `pois-search-all:${sortedParams || 'default'}`
      const cachedCounts = memoryCache.get(cacheKey)
      
      if (cachedCounts) {
        console.log('🔍 POI Search (all=true): Returning cached counts')
        return NextResponse.json(cachedCounts)
      }
      
      console.log('🔍 POI Search (all=true): Processing fresh counts...')
    } else if (!hasComplexFilters && search && search.length >= 3) {
      // Cache simple search results for better performance
      const searchCacheKey = `pois-search:${sortedParams}`
      const cachedResults = memoryCache.get(searchCacheKey)
      
      if (cachedResults) {
        console.log('🔍 POI Search: Returning cached search results')
        return NextResponse.json(cachedResults)
      }
    }
    
    // Use RPC function for efficient search
    console.log('🔍 Using RPC cms_search_pois for POI search')
    
    const rpcParams = {
      search_term: search || null,
      status_filter: status,
      country_filter: country || null,
      state_filter: state || null,
      city_filter: city || null,
      google_types_filter: googleTypes || null,
      category_filter: category || null,
      content_status_filter: contentStatus,
      group_status_filter: groupStatus,
      score_filter: scoreFilter,
      trigger_points_filter: triggerPointsFilter,
      limit_count: mapView ? 10000 : limit, // Higher limit for map view
      offset_count: mapView ? 0 : startIndex,
      fetch_all: mapView || all || false
    }
    
    // Try to detect logged user and, if client, restrict results to their own POIs
    let cmsUser = null
    try {
      const cookieStore = await cookies()
      if (cookieStore) {
        const createRouteHandlerClient = (await import('@supabase/auth-helpers-nextjs')).createRouteHandlerClient
        const supabaseAuth = createRouteHandlerClient({ cookies: () => cookieStore as any })
        const { data: { session } } = await supabaseAuth.auth.getSession()
        if (session) {
          const { data, error } = await supabaseAuth
            .schema('core')
            .from('cms_users')
            .select('id, role')
            .eq('email', session.user.email)
            .single()
          if (!error && data) cmsUser = data
        }
      }
    } catch (err) {
      console.warn('🔍 POI Search: could not determine cms user for client filtering', err)
    }

    if (cmsUser && cmsUser.role === 'client') {
      // cms_search_pois enforces owner scoping for non-admin callers
      console.log('🔍 POI Search: client detected; RPC will be scoped by role')
    }

    console.log('🔍 RPC Parameters:', rpcParams)
    
    const { data: rpcData, error: rpcError } = await supabase
      .schema('core')
      .rpc('cms_search_pois', rpcParams)
    
    if (rpcError) {
      console.error('❌ RPC Error:', rpcError)
      return NextResponse.json({
        success: false,
        error: `RPC error: ${rpcError.message}`,
        data: [],
        pagination: {
          totalCount: 0,
          totalPages: 0,
          currentPage: page,
          hasNextPage: false,
          hasPrevPage: false
        }
      }, { status: 500 })
    }
    
    console.log('🔍 RPC Response data length:', rpcData?.length)
    
    if (!rpcData || rpcData.length === 0) {
      return NextResponse.json({
        success: true,
        data: [],
        pagination: {
          totalCount: 0,
          totalPages: 0,
          currentPage: page,
          hasNextPage: false,
          hasPrevPage: false
        }
      })
    }
    
    // Extract statistics from the first row
    const stats = {
      total: rpcData[0].total_count || 0,
      approved: rpcData[0].approved_count || 0,
      pending: rpcData[0].pending_count || 0,
      withDescription: rpcData[0].with_description_count || 0,
      withAudio: rpcData[0].with_audio_count || 0,
      withTriggerPoints: rpcData[0].with_trigger_points_count || 0,
      complete: rpcData[0].complete_count || 0
    }
    
    // Transform RPC data to match expected format
    const pois = rpcData.map((row: any) => ({
      id: row.id,
      name: row.name,
      city: row.city,
      state: row.state,
      country: row.country,
      google_place_id: row.google_place_id,
      google_types: row.google_types,
      category: row.category,
      rating: row.rating,
      image_url: row.image_url,
      approved: row.approved,
      created_at: row.created_at,
      updated_at: row.updated_at,
      user_id: row.user_id,
      business_status: row.business_status,
      formatted_phone_number: row.formatted_phone_number,
      coordinates: (row.latitude && row.longitude) ? {
        latitude: Number(row.latitude),
        longitude: Number(row.longitude)
      } : null,
      descriptions: row.descriptions || [],
      trigger_points: row.trigger_points || [],
      group_membership: row.group_membership || [],
      verification_data: row.verification_data,
      // Content status indicators
      has_description: (row.descriptions?.length || 0) > 0,
      has_audio: (row.descriptions?.filter((d: any) => d.audio_url)?.length || 0) > 0,
      description_count: row.descriptions?.length || 0,
      audio_count: row.descriptions?.filter((d: any) => d.audio_url)?.length || 0,
      available_languages: row.descriptions?.map((d: any) => d.language) || [],
      trigger_points_count: row.trigger_points?.length || 0,
      active_trigger_points_count: row.trigger_points?.filter((tp: any) => tp.is_active)?.length || 0,
      // Group status
      group_status: row.group_membership?.[0] ? {
        is_in_group: true,
        group_id: row.group_membership[0].group_id,
        group_name: row.group_membership[0].group_name,
        group_role: row.group_membership[0].group_role || 'main',
        group_member_count: row.group_membership.length
      } : undefined
    }))
    
    const totalCount = stats.total
    const totalPages = Math.ceil(totalCount / limit)
    
    // Apply post-processing filters if needed (for complex filters not handled by RPC)
    let filteredPois = pois
    
    if (hasComplexFilters) {
      console.log('🔍 Applying post-processing filters for complex filters')
      
      // Content Status filter
      if (contentStatus !== 'all') {
        filteredPois = filteredPois.filter((poi: any) => {
          switch (contentStatus) {
            case 'missing_description':
              return !poi.has_description
            case 'missing_audio':
              return !poi.has_audio
            case 'complete':
              return poi.has_description && poi.has_audio
            default:
              return true
          }
        })
      }
      
      // Group Status filter
      if (groupStatus !== 'all') {
        filteredPois = filteredPois.filter((poi: any) => {
          switch (groupStatus) {
            case 'grouped':
              return poi.group_status?.is_in_group === true
            case 'ungrouped':
              return poi.group_status?.is_in_group === false
            case 'group_main':
              return poi.group_status?.is_in_group === true && poi.group_status?.group_role === 'main'
            case 'group_member':
              return poi.group_status?.is_in_group === true && poi.group_status?.group_role === 'member'
            default:
              return true
          }
        })
      }
      
      // Score filter
      if (scoreFilter !== 'all') {
        filteredPois = filteredPois.filter((poi: any) => {
          const ptBrDescription = poi.descriptions?.find((desc: any) => 
            desc.language === 'pt-br'
          )
          
          if (!ptBrDescription) {
            return scoreFilter === 'no_score'
          }
          
          const verificationStatus = ptBrDescription.verification_status
          
          switch (scoreFilter) {
            case 'no_score':
              return !verificationStatus
            case 'rejected':
              return verificationStatus === 'rejected'
            case 'pending':
              return verificationStatus === 'pending'
            case 'approved':
              return verificationStatus === 'approved'
            default:
              return true
          }
        })
      }
      
      // Trigger Points filter
      if (triggerPointsFilter !== 'all') {
        filteredPois = filteredPois.filter((poi: any) => {
          switch (triggerPointsFilter) {
            case 'with_trigger_points':
              return poi.trigger_points_count > 0
            case 'without_trigger_points':
              return poi.trigger_points_count === 0
            default:
              return true
          }
        })
      }
    }
    
    // If 'all=true', return only counts and cache the result
    if (all) {
      const countsResult = {
        success: true,
        data: {
          total: totalCount,
          approved: stats.approved,
          pending: stats.pending,
          withDescription: stats.withDescription,
          withAudio: stats.withAudio,
          withTriggerPoints: stats.withTriggerPoints,
          complete: stats.complete
        }
      }
      
      // Cache the result for 5 minutes
      const cacheKey = `pois-search-all:${sortedParams || 'default'}`
      memoryCache.set(cacheKey, countsResult, 5)
      console.log(`🔍 POI Search (all=true): Cached result for key: ${cacheKey}`)
      
      return NextResponse.json(countsResult)
    }
    
    // Return the filtered results
    const result = {
      success: true,
      data: filteredPois,
      pagination: {
        totalCount,
        totalPages,
        currentPage: page,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      }
    }
    
    // Cache simple search results for better performance
    if (!hasComplexFilters && search && search.length >= 3) {
      const searchCacheKey = `pois-search:${sortedParams}`
      memoryCache.set(searchCacheKey, result, 2) // Cache for 2 minutes
      console.log(`🔍 POI Search: Cached result for key: ${searchCacheKey}`)
    }
    
    console.log(`✅ POI Search completed: ${filteredPois.length} POIs returned`)
    return NextResponse.json(result)
  } catch (error) {
    console.error('🔍 POI Search API Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
