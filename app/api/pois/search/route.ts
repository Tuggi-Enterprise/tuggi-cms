import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseRouteHandler } from '@/lib/core/supabase-client'
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
    const ownerId = searchParams.get('ownerId') || null
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
      groupStatus, scoreFilter, triggerPointsFilter, page, limit, ownerId
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
    
    // Filtros compartilhados entre cms_list_pois (linhas) e cms_poi_facets (contadores).
    // Os filtros complexos (content/group/score/trigger) agora são aplicados no SQL
    // pelo RPC — não há mais pós-filtragem em JS.
    const sharedFilters = {
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
      owner_id: ownerId,
    }
    
    // Try to detect logged user and, if client, restrict results to their own POIs
    let cmsUser = null
    try {
      const cookieStore = await cookies()
      if (cookieStore) {
        const supabaseAuth = getSupabaseRouteHandler(cookieStore)
        const { data: { user } } = await supabaseAuth.auth.getUser()
        if (user) {
          const { data, error } = await supabaseAuth
            .schema('core')
            .from('cms_users')
            .select('id, role')
            .eq('email', user.email)
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

    // Dispatch:
    //  - lista/cards -> cms_list_pois (linhas) + cms_poi_facets (contadores/total) em paralelo
    //  - all=true    -> só cms_poi_facets (retorna cedo)
    //  - mapView     -> RPC legado cms_search_pois (ajuste do mapa é etapa à parte)
    let rpcData: any[] | null = null
    let rpcError: any = null
    let facetRow: any = {}

    if (mapView) {
      const res = await supabase
        .schema('core')
        .rpc('cms_search_pois', { ...sharedFilters, limit_count: 10000, offset_count: 0, fetch_all: true })
      rpcData = res.data
      rpcError = res.error
      facetRow = rpcData?.[0] || {}
    } else if (all) {
      const f = await supabase.schema('core').rpc('cms_poi_facets', sharedFilters)
      if (f.error) {
        console.error('❌ Facets RPC Error:', f.error)
        return NextResponse.json({ success: false, error: `RPC error: ${f.error.message}` }, { status: 500 })
      }
      const fr = f.data?.[0] || {}
      const countsResult = {
        success: true,
        data: {
          total: fr.total_count || 0,
          approved: fr.approved_count || 0,
          pending: fr.pending_count || 0,
          withDescription: fr.with_description_count || 0,
          withAudio: fr.with_audio_count || 0,
          withTriggerPoints: fr.with_trigger_points_count || 0,
          complete: fr.complete_count || 0,
        },
      }
      const cacheKey = `pois-search-all:${sortedParams || 'default'}`
      memoryCache.set(cacheKey, countsResult, 5)
      console.log(`🔍 POI Search (all=true): Cached counts for key: ${cacheKey}`)
      return NextResponse.json(countsResult)
    } else {
      const [listRes, facetsRes] = await Promise.all([
        supabase.schema('core').rpc('cms_list_pois', {
          ...sharedFilters, limit_count: limit, offset_count: startIndex, fetch_all: false,
        }),
        supabase.schema('core').rpc('cms_poi_facets', sharedFilters),
      ])
      rpcData = listRes.data
      rpcError = listRes.error
      facetRow = facetsRes.data?.[0] || {}
      if (facetsRes.error) console.warn('🔍 POI facets error (cards ficam zerados):', facetsRes.error.message)
    }
    
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
      const emptyTotal = facetRow.total_count || 0
      const emptyPages = Math.ceil(emptyTotal / limit)
      return NextResponse.json({
        success: true,
        data: [],
        pagination: {
          totalCount: emptyTotal,
          totalPages: emptyPages,
          currentPage: page,
          hasNextPage: page < emptyPages,
          hasPrevPage: page > 1
        }
      })
    }
    
    // Estatísticas vêm dos facets (MV quando sem filtro; count live quando filtrado).
    // No mapView, facetRow vem do RPC legado (rpcData[0]).
    const stats = {
      total: facetRow.total_count || 0,
      approved: facetRow.approved_count || 0,
      pending: facetRow.pending_count || 0,
      withDescription: facetRow.with_description_count || 0,
      withAudio: facetRow.with_audio_count || 0,
      withTriggerPoints: facetRow.with_trigger_points_count || 0,
      complete: facetRow.complete_count || 0
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
    
    // Sem pós-filtragem em JS: content/group/score/trigger são aplicados no SQL
    // por cms_list_pois (e por cms_poi_facets, mantendo o total coerente).
    // (all=true já retornou cedo no dispatch acima.)

    // Return the results
    const result = {
      success: true,
      data: pois,
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
    
    console.log(`✅ POI Search completed: ${pois.length} POIs returned`)
    return NextResponse.json(result)
  } catch (error) {
    console.error('🔍 POI Search API Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
