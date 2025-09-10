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
    
    // Build query for cities with optional state filter
    let query = supabase
      .schema('core')
      .from('attractions')
      .select('city')
      .eq('country', country)
      .not('city', 'is', null)
      .not('city', 'eq', '')
    
    // Add state filter if provided
    if (state) {
      query = query.eq('state', state)
    }
    
    const { data: citiesData, error: citiesError } = await query
    
    if (citiesError) {
      console.error('Error fetching cities:', citiesError)
      return NextResponse.json(
        { error: 'Failed to fetch cities' },
        { status: 500 }
      )
    }
    
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