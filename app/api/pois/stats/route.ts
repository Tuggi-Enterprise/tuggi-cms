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
    
    // Parse filters to apply same filtering as search endpoint
    const search = searchParams.get('search') || ''
    const status = searchParams.get('status') || 'all'
    const country = searchParams.get('country') || ''
    const city = searchParams.get('city') || ''
    const googleTypes = searchParams.get('googleTypes') || ''
    const category = searchParams.get('category') || ''
    
    // Generate cache key based on all parameters
  const sortedParams = Object.entries({
    search,
    status,
    country,
    city,
    googleTypes,
    category
  })
    .filter(([_, value]) => value !== null && value !== undefined && value !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
  
  const cacheKey = `pois-stats:${sortedParams || 'default'}`

    // Try to get from cache first
    const cachedStats = memoryCache.get(cacheKey)
    if (cachedStats) {
      console.log('📊 POI Stats: Returning cached data')
      return NextResponse.json(cachedStats)
    }

    console.log('📊 POI Stats: Processing fresh data...')
    
    console.log('📊 POI Stats API:', {
      search, status, country, city, googleTypes, category
    })
    
    // Fetch all POIs using pagination to overcome Supabase 1000 limit
    // Following the same pattern as dashboard
    let allPoisData: any[] = []
    let hasMorePois = true
    let poisPage = 0
    const pageSize = 1000
    
    while (hasMorePois) {
      // Build base query for each chunk
      let baseQuery = supabase
        .schema('core')
        .from('attractions')
        .select(`
          id,
          approved,
          city,
          country,
          google_types,
          category,
          name,
          image_url,
          descriptions:attraction_descriptions(
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
            group_role
          )
        `)
        .range(poisPage * pageSize, (poisPage + 1) * pageSize - 1)
      
      // Apply same filters as search endpoint
      if (search) {
        baseQuery = baseQuery.or(`name.ilike.%${search}%,city.ilike.%${search}%,country.ilike.%${search}%`)
      }
      
      if (status !== 'all') {
        baseQuery = baseQuery.eq('approved', status === 'approved')
      }
      
      if (country) {
        baseQuery = baseQuery.eq('country', country)
      }
      
      if (city) {
        baseQuery = baseQuery.eq('city', city)
      }
      
      if (googleTypes) {
        baseQuery = baseQuery.contains('google_types', [googleTypes])
      }
      
      if (category) {
        baseQuery = baseQuery.eq('category', category)
      }
      
      const { data: poisChunk, error: poisError } = await baseQuery
      
      if (poisError) {
        console.error('Error fetching POIs chunk for stats:', poisError)
        return NextResponse.json(
          { error: 'Failed to fetch POI statistics' },
          { status: 500 }
        )
      }
      
      if (poisChunk && poisChunk.length > 0) {
        allPoisData = [...allPoisData, ...poisChunk]
        poisPage++
      } else {
        hasMorePois = false
      }
      
      // Safety check to prevent infinite loops
      if (poisPage > 25) {
        console.log('⚠️ Stats API: Reached maximum page limit (25), stopping pagination')
        hasMorePois = false
      }
    }
    
    console.log(`📊 Stats API: Processed ${allPoisData.length} POIs across ${poisPage} pages`)
    
    const pois = allPoisData
    
    if (!pois) {
      return NextResponse.json({
        success: true,
        data: {
          total: 0,
          approved: 0,
          pending: 0,
          content_stats: {
            with_description: 0,
            with_audio: 0,
            complete: 0,
            missing_description: 0,
            missing_audio: 0
          },
          group_stats: {
            grouped: 0,
            ungrouped: 0,
            group_main: 0,
            group_member: 0
          },
          trigger_points_stats: {
            with_trigger_points: 0,
            without_trigger_points: 0,
            total_trigger_points: 0,
            active_trigger_points: 0
          },
          verification_stats: {
            no_score: 0,
            pending: 0,
            approved: 0,
            rejected: 0
          },
          countries: [],
          cities: []
        }
      })
    }
    
    // Process POIs and calculate statistics
    let totalCount = 0
    let approvedCount = 0
    let pendingCount = 0
    
    // Content statistics
    let withDescriptionCount = 0
    let withAudioCount = 0
    let completeCount = 0
    let missingDescriptionCount = 0
    let missingAudioCount = 0
    
    // Group statistics
    let groupedCount = 0
    let ungroupedCount = 0
    let groupMainCount = 0
    let groupMemberCount = 0
    
    // Trigger points statistics
    let withTriggerPointsCount = 0
    let withoutTriggerPointsCount = 0
    let totalTriggerPoints = 0
    let activeTriggerPoints = 0
    
    // Verification statistics
    let noScoreCount = 0
    let verificationPendingCount = 0
    let verificationApprovedCount = 0
    let verificationRejectedCount = 0
    
    // Location statistics
    const countriesSet = new Set<string>()
    const citiesSet = new Set<string>()
    
    pois.forEach(poi => {
      totalCount++
      
      // Approval status
      if (poi.approved) {
        approvedCount++
      } else {
        pendingCount++
      }
      
      // Location data
      if (poi.country) countriesSet.add(poi.country)
      if (poi.city) citiesSet.add(poi.city)
      
      // Process descriptions
      const descriptions = poi.descriptions || []
      const hasDescription = descriptions.some((desc: any) => 
        desc.description && desc.description.trim()
      )
      const hasAudio = descriptions.some((desc: any) => 
        desc.audio_url && desc.audio_url.trim()
      )
      
      // Content statistics
      if (hasDescription) withDescriptionCount++
      if (hasAudio) withAudioCount++
      if (hasDescription && hasAudio) completeCount++
      if (!hasDescription) missingDescriptionCount++
      if (!hasAudio) missingAudioCount++
      
      // Group statistics
      const groupMembership = poi.group_membership?.[0]
      if (groupMembership) {
        groupedCount++
        if (groupMembership.group_role === 'main') {
          groupMainCount++
        } else {
          groupMemberCount++
        }
      } else {
        ungroupedCount++
      }
      
      // Trigger points statistics
      const triggerPoints = poi.trigger_points || []
      const triggerPointsCount = triggerPoints.length
      const activeTriggerPointsCount = triggerPoints.filter((tp: any) => tp.is_active).length
      
      totalTriggerPoints += triggerPointsCount
      activeTriggerPoints += activeTriggerPointsCount
      
      if (triggerPointsCount > 0) {
        withTriggerPointsCount++
      } else {
        withoutTriggerPointsCount++
      }
      
      // Verification statistics (based on pt-br descriptions)
      const ptBrDescription = descriptions.find((desc: any) => 
        desc.language === 'pt-br'
      )
      
      if (!ptBrDescription || !ptBrDescription.verification_status) {
        noScoreCount++
      } else {
        switch (ptBrDescription.verification_status) {
          case 'pending':
            verificationPendingCount++
            break
          case 'approved':
            verificationApprovedCount++
            break
          case 'rejected':
            verificationRejectedCount++
            break
          default:
            noScoreCount++
        }
      }
    })
    
    // Convert sets to sorted arrays
    const countries = Array.from(countriesSet).sort()
    const cities = Array.from(citiesSet).sort()
    
    const stats = {
      total: totalCount,
      approved: approvedCount,
      pending: pendingCount,
      content_stats: {
        with_description: withDescriptionCount,
        with_audio: withAudioCount,
        complete: completeCount,
        missing_description: missingDescriptionCount,
        missing_audio: missingAudioCount
      },
      group_stats: {
        grouped: groupedCount,
        ungrouped: ungroupedCount,
        group_main: groupMainCount,
        group_member: groupMemberCount
      },
      trigger_points_stats: {
        with_trigger_points: withTriggerPointsCount,
        without_trigger_points: withoutTriggerPointsCount,
        total_trigger_points: totalTriggerPoints,
        active_trigger_points: activeTriggerPoints
      },
      verification_stats: {
        no_score: noScoreCount,
        pending: verificationPendingCount,
        approved: verificationApprovedCount,
        rejected: verificationRejectedCount
      },
      countries,
      cities
    }
    
    console.log('📊 POI Stats calculated:', {
      total: totalCount,
      approved: approvedCount,
      pending: pendingCount,
      countries: countries.length,
      cities: cities.length
    })
    
    const statsResult = {
      success: true,
      data: stats
    }

    // Cache the result for 10 minutes
    memoryCache.set(cacheKey, statsResult, 10)
    console.log(`📊 POI Stats: Cached result for key: ${cacheKey}`)

    return NextResponse.json(statsResult)
    
  } catch (error) {
    console.error('📊 POI Stats API Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}