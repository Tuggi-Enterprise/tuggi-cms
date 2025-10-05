import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '../../../../lib/core/supabase-client'
import { memoryCache } from '@/lib/cache/memory-cache'

const supabase = getSupabase('service')

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const country = searchParams.get('country')
    const state = searchParams.get('state')
    
    if (!country) {
      return NextResponse.json(
        { error: 'Country parameter is required' },
        { status: 400 }
      )
    }

    // Generate cache key for cities by country and optionally state
    const cacheKey = state ? `pois-cities:${country}:${state}` : `pois-cities:${country}`

    // Try to get from cache first
    const cachedCities = memoryCache.get(cacheKey)
    if (cachedCities) {
      console.log(`🏙️ POI Cities: Returning cached data for ${country}${state ? ` in ${state}` : ''}`)
      return NextResponse.json(cachedCities)
    }

    console.log(`🏙️ POI Cities API: Processing fresh data for ${country}${state ? ` in ${state}` : ''}...`)
    
    // Fetch ALL cities using pagination to overcome Supabase 1000 limit
    let allCitiesData: any[] = []
    let hasMoreCities = true
    let citiesPage = 0
    const pageSize = 1000
    
    while (hasMoreCities) {
      let query = supabase
        .schema('core')
        .from('attractions')
        .select('city')
        .eq('country', country)
        .not('city', 'is', null)
        .not('city', 'eq', '')
        .range(citiesPage * pageSize, (citiesPage + 1) * pageSize - 1)
      
      // Add state filter if provided
      if (state) {
        query = query.eq('state', state)
      }
      
      const { data: pageData, error: pageError } = await query
      
      if (pageError) {
        console.error('Error fetching cities page:', pageError)
        return NextResponse.json(
          { error: 'Failed to fetch cities' },
          { status: 500 }
        )
      }
      
      if (!pageData || pageData.length === 0) {
        hasMoreCities = false
      } else {
        allCitiesData = [...allCitiesData, ...pageData]
        citiesPage++
        
        // Safety check to prevent infinite loops
        if (citiesPage > 50) { // Max 50,000 cities
          console.warn('🏙️ Cities: Reached safety limit of 50,000 cities')
          break
        }
      }
    }
    
    console.log(`🏙️ Cities: Fetched ${allCitiesData.length} total cities for ${country}${state ? ` in ${state}` : ''}`)
    
    const citiesData = allCitiesData
    
    // Process cities and count POIs
    const cityMap = new Map<string, number>()
    
    citiesData?.forEach(item => {
      if (item.city) {
        const count = cityMap.get(item.city) || 0
        cityMap.set(item.city, count + 1)
      }
    })
    
    // Convert to sorted array without counts
    const cities = Array.from(cityMap.keys())
      .map(city => ({
        value: city,
        label: city
      }))
      .sort((a, b) => a.value.localeCompare(b.value))
    
    console.log(`🏙️ POI Cities processed: ${cities.length} cities for ${country}`)
    
    const result = {
      success: true,
      data: cities,
      country: country,
      state: state || null
    }

    // Cache the result for 30 minutes
    memoryCache.set(cacheKey, result, 30)
    console.log(`🏙️ POI Cities: Cached result for key: ${cacheKey}`)

    return NextResponse.json(result)
    
  } catch (error) {
    console.error('🏙️ POI Cities API Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}