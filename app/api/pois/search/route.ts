import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { memoryCache } from '@/lib/cache/memory-cache'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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
    
    // Calculate pagination
    const startIndex = (page - 1) * limit
    const endIndex = startIndex + limit - 1
    
    console.log('🔍 POI Search API:', {
      search, status, country, state, city, googleTypes, category, contentStatus,
      groupStatus, scoreFilter, triggerPointsFilter, page, limit, all
    })

    // If 'all=true', check cache first for total counts
    if (all) {
      const sortedParams = Object.entries({
        search, status, country, state, city, googleTypes, category, contentStatus,
        groupStatus, scoreFilter, triggerPointsFilter
      })
        .filter(([_, value]) => value !== null && value !== undefined && value !== '' && value !== 'all')
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join('&')
      
      const cacheKey = `pois-search-all:${sortedParams || 'default'}`
      const cachedCounts = memoryCache.get(cacheKey)
      
      if (cachedCounts) {
        console.log('🔍 POI Search (all=true): Returning cached counts')
        return NextResponse.json(cachedCounts)
      }
      
      console.log('🔍 POI Search (all=true): Processing fresh counts...')
    }
    
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
      `, { count: 'exact' })
    
    // Apply filters
    
    // Search filter
    if (search) {
      query = query.or(`name.ilike.%${search}%,city.ilike.%${search}%,country.ilike.%${search}%`)
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
    
    // Apply pagination only if not requesting all counts
    if (!all) {
      query = query.range(startIndex, endIndex)
    }
    
    const { data: pois, error, count } = await query
    
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
    const totalCount = count || 0
    const totalPages = Math.ceil(totalCount / limit)
    const hasNextPage = page < totalPages
    const hasPrevPage = page > 1

    return NextResponse.json({
      success: true,
      data: filteredPois,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasNextPage,
        hasPrevPage,
        startIndex: startIndex + 1,
        endIndex: Math.min(startIndex + limit, totalCount)
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
    })
    
  } catch (error) {
    console.error('🔍 POI Search API Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}