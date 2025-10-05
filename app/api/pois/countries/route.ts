import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '../../../../lib/core/supabase-client'
import { memoryCache } from '@/lib/cache/memory-cache'

const supabase = getSupabase('service')

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
    
    // Fetch ALL countries using pagination to overcome Supabase 1000 limit
    let allCountriesData: any[] = []
    let hasMoreCountries = true
    let countriesPage = 0
    const pageSize = 1000
    
    while (hasMoreCountries) {
      const { data: pageData, error: pageError } = await supabase
        .schema('core')
        .from('attractions')
        .select('country')
        .not('country', 'is', null)
        .not('country', 'eq', '')
        .range(countriesPage * pageSize, (countriesPage + 1) * pageSize - 1)
      
      if (pageError) {
        console.error('Error fetching countries page:', pageError)
        return NextResponse.json(
          { error: 'Failed to fetch countries' },
          { status: 500 }
        )
      }
      
      if (!pageData || pageData.length === 0) {
        hasMoreCountries = false
      } else {
        allCountriesData = [...allCountriesData, ...pageData]
        countriesPage++
        
        // Safety check to prevent infinite loops
        if (countriesPage > 50) { // Max 50,000 countries
          console.warn('🌍 Countries: Reached safety limit of 50,000 countries')
          break
        }
      }
    }
    
    console.log(`🌍 Countries: Fetched ${allCountriesData.length} total countries`)
    
    // Process countries and count POIs
    const countryMap = new Map<string, number>()
    
    allCountriesData?.forEach(item => {
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