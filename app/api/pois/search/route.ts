import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '../../../../lib/core/supabase-client'
import { memoryCache } from '@/lib/cache/memory-cache'

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
    
    // Declare variables for all code paths
    let pois: any[] = []
    let error: any = null
    let count: any = null
    
    // Build base query
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
        google_types,
        category,
        rating,
        image_url,
        approved,
        created_at,
        updated_at,
        user_id,
        business_status,
        formatted_phone_number,
        coordinates:attraction_coordinate(latitude, longitude),
        descriptions:attraction_descriptions(
          id,
          language,
          description,
          audio_url,
          verification_status,
          last_verified_at,
          is_original,
          description_scores(
            score_overall,
            subscores,
            flags,
            created_at
          )
        ),
        trigger_points:attraction_trigger_points(
          id,
          is_active
        ),
        group_membership:attraction_group_members(
          group_id,
          group_role,
          attraction_groups(id, name)
        )
      `, { count: 'exact' })
    
    // Apply filters
    
    // Search filter - optimized for large datasets (30k+ records)
    if (search) {
      const searchTerm = search.trim()
      if (searchTerm) {
        // For better performance on large datasets, prioritize exact matches first
        // then partial matches. This works better with database indexes.
        if (searchTerm.length >= 3) {
          // Use ilike for partial matching on longer terms
          query = query.or(`name.ilike.%${searchTerm}%,city.ilike.%${searchTerm}%,country.ilike.%${searchTerm}%,state.ilike.%${searchTerm}%`)
        } else {
          // For short terms, use exact matching to avoid too many results
          query = query.or(`name.ilike.${searchTerm}%,city.ilike.${searchTerm}%,country.ilike.${searchTerm}%,state.ilike.${searchTerm}%`)
        }
      }
    }
    
    // Status filter
    if (status !== 'all') {
      query = query.eq('approved', status === 'approved')
    }
    
    // Country filter
    if (country) {
      query = query.eq('country', country)
    }
    
    // State filter
    if (state) {
      query = query.eq('state', state)
    }
    
    // City filter
    if (city) {
      query = query.eq('city', city)
    }
    
    // Google Types filter
    if (googleTypes) {
      query = query.contains('google_types', [googleTypes])
    }
    
    // Category filter
    if (category) {
      query = query.eq('category', category)
    }
    
    // Order by created_at desc for consistent pagination
    query = query.order('created_at', { ascending: false })
    
    // For large datasets, we need to handle pagination differently
    // Apply pagination only if not requesting all counts and not map view
    // and if we don't have complex filters that require post-processing
    
    if (all) {
      // For all=true, we need to fetch ALL POIs using pagination to overcome Supabase 1000 limit
      console.log('🔍 POI Search (all=true): Fetching ALL POIs with pagination...')
      
      let allPoisData: any[] = []
      let hasMorePois = true
      let poisPage = 0
      const pageSize = 1000
      
      while (hasMorePois) {
        const { data: pageData, error: pageError } = await supabase
          .schema('core')
          .from('attractions')
          .select(`
            id,
            name,
            city,
            state,
            country,
            google_place_id,
            google_types,
            category,
            rating,
            image_url,
            approved,
            created_at,
            updated_at,
            user_id,
            business_status,
            formatted_phone_number,
            coordinates:attraction_coordinate(latitude, longitude),
            descriptions:attraction_descriptions(
              id,
              language,
              description,
              audio_url,
              verification_status
            ),
            trigger_points:attraction_trigger_points(
              id,
              is_active
            ),
            group_membership:attraction_group_members(
              group_id,
              group_role,
              attraction_groups(id, name)
            )
          `)
          .range(poisPage * pageSize, (poisPage + 1) * pageSize - 1)
        
        if (pageError) {
          console.error('Error fetching POIs page:', pageError)
          break
        }
        
        if (!pageData || pageData.length === 0) {
          hasMorePois = false
        } else {
          allPoisData = [...allPoisData, ...pageData]
          poisPage++
          
          // Safety check to prevent infinite loops
          if (poisPage > 50) { // Max 50,000 POIs
            console.warn('🔍 POI Search (all=true): Reached safety limit of 50,000 POIs')
            break
          }
        }
      }
      
      console.log(`🔍 POI Search (all=true): Fetched ${allPoisData.length} POIs total`)
      
      // Apply filters to the paginated data
      let filteredData = allPoisData
      
      if (search) {
        filteredData = filteredData.filter(poi => 
          poi.name?.toLowerCase().includes(search.toLowerCase()) ||
          poi.city?.toLowerCase().includes(search.toLowerCase()) ||
          poi.country?.toLowerCase().includes(search.toLowerCase())
        )
      }
      
      if (status !== 'all') {
        filteredData = filteredData.filter(poi => 
          status === 'approved' ? poi.approved : !poi.approved
        )
      }
      
      if (country) {
        filteredData = filteredData.filter(poi => poi.country === country)
      }
      
      if (state) {
        filteredData = filteredData.filter(poi => poi.state === state)
      }
      
      if (city) {
        filteredData = filteredData.filter(poi => poi.city === city)
      }
      
      if (googleTypes) {
        filteredData = filteredData.filter(poi => 
          poi.google_types?.includes(googleTypes)
        )
      }
      
      if (category) {
        filteredData = filteredData.filter(poi => poi.category === category)
      }
      
      console.log(`🔍 POI Search (all=true): After filtering: ${filteredData.length} POIs`)
      pois = filteredData
    } else {
      // For regular queries, use the original logic
      if (!all && !mapView && !hasComplexFilters) {
        query = query.range(startIndex, endIndex)
      } else if (mapView) {
        // For map view, set a high limit to get all POIs (Supabase default limit is 1000)
        query = query.limit(50000)
      } else if (!all && !mapView && hasComplexFilters) {
         // For complex filters, we need to fetch more data and paginate after filtering
         // Use a smart limit based on the page number to avoid fetching too much data
         const smartLimit = Math.min(10000, (page * limit) + (limit * 5)) // Fetch a bit more than needed
         query = query.limit(smartLimit)
       }
      
      const { data: queryPois, error: queryError, count: queryCount } = await query
      pois = queryPois || []
      error = queryError
      count = queryCount
    }
    
    if (error) {
      console.error('Error fetching POIs:', error)
      return NextResponse.json(
        { error: 'Failed to fetch POIs' },
        { status: 500 }
      )
    }
    
    // Process POIs to add computed fields
    const processedPois = pois?.map(poi => {
      const descriptions = poi.descriptions || []
      const triggerPoints = poi.trigger_points || []
      const groupMembership = poi.group_membership?.[0]
      
      // Calculate content status
      const hasDescription = descriptions.some((desc: any) => 
        desc.description && desc.description.trim()
      )
      const hasAudio = descriptions.some((desc: any) => 
        desc.audio_url && desc.audio_url.trim()
      )
      
      // Calculate available languages
      const availableLanguages = descriptions
        .filter((desc: any) => desc.description && desc.description.trim())
        .map((desc: any) => desc.language)
      
      // Process verification data for original pt-br description
      const originalDescription = descriptions.find((desc: any) => 
        desc.is_original && desc.language === 'pt-br'
      )
      
      let verificationData = null
      if (originalDescription) {
        const latestScore = originalDescription.description_scores
          ?.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
        
        verificationData = {
          verification_status: originalDescription.verification_status,
          score: latestScore?.score_overall || null,
          last_verified_at: originalDescription.last_verified_at,
          is_original: originalDescription.is_original,
          language: originalDescription.language,
          subscores: latestScore?.subscores,
          flags: latestScore?.flags,
          description_id: originalDescription.id
        }
      }
      
      // Calculate trigger points counts
      const triggerPointsCount = triggerPoints.length
      const activeTriggerPointsCount = triggerPoints.filter((tp: any) => tp.is_active).length
      
      // Process group status
      const processedGroupStatus = groupMembership ? {
        is_in_group: true,
        group_id: groupMembership.group_id,
        group_name: groupMembership.attraction_groups?.[0]?.name || null,
        group_role: groupMembership.group_role
      } : {
        is_in_group: false,
        group_id: null,
        group_name: null,
        group_role: null
      }
      
      return {
        ...poi,
        coordinates: poi.coordinates?.[0] || null,
        has_description: hasDescription,
        has_audio: hasAudio,
        description_count: descriptions.filter((desc: any) => desc.description && desc.description.trim()).length,
        audio_count: descriptions.filter((desc: any) => desc.audio_url && desc.audio_url.trim()).length,
        available_languages: availableLanguages,
        trigger_points_count: triggerPointsCount,
        active_trigger_points_count: activeTriggerPointsCount,
        group_status: processedGroupStatus,
        verification_data: verificationData,
        groups: processedGroupStatus.group_name,
        group_count: processedGroupStatus.is_in_group ? 1 : 0,
        // Keep descriptions for frontend filtering if needed
        descriptions: descriptions.map((desc: any) => ({
          language: desc.language,
          verification_status: desc.verification_status
        }))
      }
    }) || []
    
    // Apply additional filters that require processed data
    let filteredPois = processedPois
    
    // Content Status filter
    if (contentStatus !== 'all') {
      filteredPois = filteredPois.filter(poi => {
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
      filteredPois = filteredPois.filter(poi => {
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
      filteredPois = filteredPois.filter(poi => {
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
      filteredPois = filteredPois.filter(poi => {
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
    
    // If 'all=true', return only counts and cache the result
    if (all) {
      const totalCount = filteredPois.length
      const approvedCount = filteredPois.filter(poi => poi.approved).length
      const pendingCount = filteredPois.filter(poi => !poi.approved).length
      const withDescriptionCount = filteredPois.filter(poi => poi.has_description).length
      const withAudioCount = filteredPois.filter(poi => poi.has_audio).length
      const completeCount = filteredPois.filter(poi => poi.has_description && poi.has_audio).length
      const withTriggerPointsCount = filteredPois.filter(poi => poi.trigger_points_count > 0).length
      
      const countsResult = {
        success: true,
        totalCount,
        counts: {
          total: totalCount,
          approved: approvedCount,
          pending: pendingCount,
          withDescription: withDescriptionCount,
          withAudio: withAudioCount,
          complete: completeCount,
          withTriggerPoints: withTriggerPointsCount
        },
        filters: {
          search, status, country, state, city, googleTypes, category,
          contentStatus, groupStatus, scoreFilter, triggerPointsFilter
        }
      }
      
      // Cache the counts for 5 minutes
      const sortedParams = Object.entries({
        search, status, country, city, googleTypes, category, contentStatus,
        groupStatus, scoreFilter, triggerPointsFilter
      })
        .filter(([_, value]) => value !== null && value !== undefined && value !== '' && value !== 'all')
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join('&')
      
      const cacheKey = `pois-search-all:${sortedParams || 'default'}`
      memoryCache.set(cacheKey, countsResult, 5)
      console.log(`🔍 POI Search (all=true): Cached counts for key: ${cacheKey}`)
      
      return NextResponse.json(countsResult)
    }

    // Regular paginated response
    // If we have complex filters, we need to paginate the filtered results
    
    let finalPois = filteredPois
    let actualTotalCount = count || 0
    
    if (hasComplexFilters) {
      // For complex filters, the total count is the filtered results count
      actualTotalCount = filteredPois.length
      
      // Apply pagination to filtered results
      const paginatedStart = (page - 1) * limit
      const paginatedEnd = paginatedStart + limit
      finalPois = filteredPois.slice(paginatedStart, paginatedEnd)
    } else {
      // For simple filters, use the original count from Supabase
      actualTotalCount = count || 0
    }
    
    const totalPages = Math.ceil(actualTotalCount / limit)
    const hasNextPage = page < totalPages
    const hasPrevPage = page > 1
    const actualStartIndex = hasComplexFilters ? (page - 1) * limit : startIndex
    const actualEndIndex = hasComplexFilters ? 
      Math.min(actualStartIndex + limit, actualTotalCount) : 
      Math.min(startIndex + limit, actualTotalCount)

    const response = {
      success: true,
      data: finalPois,
      pagination: {
        page,
        limit,
        totalCount: actualTotalCount,
        totalPages,
        hasNextPage,
        hasPrevPage,
        startIndex: actualStartIndex + 1,
        endIndex: actualEndIndex
      },
      filters: {
        search,
        status,
        country,
        state,
        city,
        googleTypes,
        category,
        contentStatus,
        groupStatus,
        scoreFilter,
        triggerPointsFilter
      }
    }
    
    // Cache simple search results for better performance
    if (!hasComplexFilters && search && search.length >= 3) {
      const searchCacheKey = `pois-search:${sortedParams}`
      memoryCache.set(searchCacheKey, response, 2) // Cache for 2 minutes
      console.log(`🔍 POI Search: Cached search results for key: ${searchCacheKey}`)
    }

    return NextResponse.json(response)
    
  } catch (error) {
    console.error('🔍 POI Search API Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}