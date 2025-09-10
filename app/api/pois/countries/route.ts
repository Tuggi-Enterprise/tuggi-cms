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
    // Generate cache key for countries
    const cacheKey = 'pois-countries:all'

    // Try to get from cache first
    const cachedCountries = memoryCache.get(cacheKey)
    if (cachedCountries) {
      console.log('🌍 POI Countries: Returning cached data')
      return NextResponse.json(cachedCountries)
    }

    console.log('🌍 POI Countries API: Processing fresh data...')
    
    // Fetch unique countries with POI counts using aggregation
    const { data: countriesData, error: countriesError } = await supabase
      .schema('core')
      .from('attractions')
      .select('country')
      .not('country', 'is', null)
      .not('country', 'eq', '')
    
    if (countriesError) {
      console.error('Error fetching countries:', countriesError)
      return NextResponse.json(
        { error: 'Failed to fetch countries' },
        { status: 500 }
      )
    }
    
    // Process countries and count POIs
    const countryMap = new Map<string, number>()
    
    countriesData?.forEach(item => {
      if (item.country) {
        const count = countryMap.get(item.country) || 0
        countryMap.set(item.country, count + 1)
      }
    })
    
    // Convert to sorted array with counts
    const countries = Array.from(countryMap.entries())
      .map(([country, count]) => ({
        value: country,
        label: country,
        count: count
      }))
      .sort((a, b) => a.value.localeCompare(b.value))
    
    console.log(`🌍 POI Countries processed: ${countries.length} countries`)
    
    const result = {
      success: true,
      data: countries
    }

    // Cache the result for 30 minutes (countries change less frequently)
    memoryCache.set(cacheKey, result, 30)
    console.log(`🌍 POI Countries: Cached result for key: ${cacheKey}`)

    return NextResponse.json(result)
    
  } catch (error) {
    console.error('🌍 POI Countries API Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}