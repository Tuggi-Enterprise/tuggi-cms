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
    // Generate cache key for filters (no parameters for now, but ready for future)
    const cacheKey = 'pois-filters:all'

    // Try to get from cache first
    const cachedFilters = memoryCache.get(cacheKey)
    if (cachedFilters) {
      console.log('🔧 POI Filters: Returning cached data')
      return NextResponse.json(cachedFilters)
    }

    console.log('🔧 POI Filters API: Processing fresh data...')
    
    // Fetch all locations using pagination to overcome Supabase 1000 limit
    // Following the same pattern as dashboard
    let allLocationsData: any[] = []
    let hasMoreLocations = true
    let locationsPage = 0
    const pageSize = 1000
    
    while (hasMoreLocations) {
      const { data: locationsChunk, error: locationsError } = await supabase
        .schema('core')
        .from('attractions')
        .select('country, city')
        .not('country', 'is', null)
        .not('city', 'is', null)
        .range(locationsPage * pageSize, (locationsPage + 1) * pageSize - 1)
      
      if (locationsError) {
        console.error('Error fetching locations chunk:', locationsError)
        return NextResponse.json(
          { error: 'Failed to fetch filter options' },
          { status: 500 }
        )
      }
      
      if (locationsChunk && locationsChunk.length > 0) {
        allLocationsData = [...allLocationsData, ...locationsChunk]
        locationsPage++
      } else {
        hasMoreLocations = false
      }
      
      // Safety check to prevent infinite loops
      if (locationsPage > 25) {
        console.log('⚠️ Filters API: Reached maximum page limit (25) for locations, stopping pagination')
        hasMoreLocations = false
      }
    }
    
    // Fetch all Google types using pagination
    let allGoogleTypesData: any[] = []
    let hasMoreGoogleTypes = true
    let googleTypesPage = 0
    
    while (hasMoreGoogleTypes) {
      const { data: googleTypesChunk, error: googleTypesError } = await supabase
        .schema('core')
        .from('attractions')
        .select('google_types')
        .not('google_types', 'is', null)
        .range(googleTypesPage * pageSize, (googleTypesPage + 1) * pageSize - 1)
      
      if (googleTypesError) {
        console.error('Error fetching Google types chunk:', googleTypesError)
        return NextResponse.json(
          { error: 'Failed to fetch filter options' },
          { status: 500 }
        )
      }
      
      if (googleTypesChunk && googleTypesChunk.length > 0) {
        allGoogleTypesData = [...allGoogleTypesData, ...googleTypesChunk]
        googleTypesPage++
      } else {
        hasMoreGoogleTypes = false
      }
      
      // Safety check to prevent infinite loops
      if (googleTypesPage > 25) {
        console.log('⚠️ Filters API: Reached maximum page limit (25) for Google types, stopping pagination')
        hasMoreGoogleTypes = false
      }
    }
    
    // Fetch all categories using pagination
    let allCategoriesData: any[] = []
    let hasMoreCategories = true
    let categoriesPage = 0
    
    while (hasMoreCategories) {
      const { data: categoriesChunk, error: categoriesError } = await supabase
        .schema('core')
        .from('attractions')
        .select('category')
        .not('category', 'is', null)
        .not('category', 'eq', '')
        .range(categoriesPage * pageSize, (categoriesPage + 1) * pageSize - 1)
      
      if (categoriesError) {
        console.error('Error fetching categories chunk:', categoriesError)
        return NextResponse.json(
          { error: 'Failed to fetch filter options' },
          { status: 500 }
        )
      }
      
      if (categoriesChunk && categoriesChunk.length > 0) {
        allCategoriesData = [...allCategoriesData, ...categoriesChunk]
        categoriesPage++
      } else {
        hasMoreCategories = false
      }
      
      // Safety check to prevent infinite loops
      if (categoriesPage > 25) {
        console.log('⚠️ Filters API: Reached maximum page limit (25) for categories, stopping pagination')
        hasMoreCategories = false
      }
    }
    
    console.log(`🔧 Filters API: Processed ${allLocationsData.length} locations, ${allGoogleTypesData.length} Google types and ${allCategoriesData.length} categories records`)
    
    const locations = allLocationsData
    const googleTypesData = allGoogleTypesData
    const categoriesData = allCategoriesData
    
    // Process locations
    const countriesSet = new Set<string>()
    const citiesSet = new Set<string>()
    const countryCityMap = new Map<string, Set<string>>()
    
    locations?.forEach(location => {
      if (location.country) {
        countriesSet.add(location.country)
        
        if (!countryCityMap.has(location.country)) {
          countryCityMap.set(location.country, new Set())
        }
        
        if (location.city) {
          citiesSet.add(location.city)
          countryCityMap.get(location.country)?.add(location.city)
        }
      }
    })
    
    // Process Google types
    const googleTypesSet = new Set<string>()
    
    googleTypesData?.forEach(item => {
      if (item.google_types && Array.isArray(item.google_types)) {
        item.google_types.forEach((type: string) => {
          if (type && type.trim()) {
            googleTypesSet.add(type.trim())
          }
        })
      }
    })
    
    // Process categories
    const categoriesSet = new Set<string>()
    
    categoriesData?.forEach(item => {
      if (item.category && item.category.trim()) {
        categoriesSet.add(item.category.trim())
      }
    })
    
    // Convert to sorted arrays
    const countries = Array.from(countriesSet).sort()
    const cities = Array.from(citiesSet).sort()
    const googleTypes = Array.from(googleTypesSet).sort()
    const categories = Array.from(categoriesSet).sort()
    
    // Create country-city mapping for frontend
    const countryOptions = countries.map(country => ({
      value: country,
      label: country,
      cities: Array.from(countryCityMap.get(country) || []).sort().map(city => ({
        value: city,
        label: city
      }))
    }))
    
    // Create Google types options with human-readable labels
    const googleTypeOptions = googleTypes.map(type => ({
      value: type,
      label: formatGoogleTypeLabel(type)
    }))
    
    // Create categories options
    const categoryOptions = categories.map(category => ({
      value: category,
      label: category
    }))
    
    // Static filter options
    const statusOptions = [
      { value: 'all', label: 'Todos' },
      { value: 'approved', label: 'Aprovados' },
      { value: 'pending', label: 'Pendentes' }
    ]
    
    const contentStatusOptions = [
      { value: 'all', label: 'Todos' },
      { value: 'complete', label: 'Completo (descrição + áudio)' },
      { value: 'missing_description', label: 'Sem descrição' },
      { value: 'missing_audio', label: 'Sem áudio' }
    ]
    
    const groupStatusOptions = [
      { value: 'all', label: 'Todos' },
      { value: 'grouped', label: 'Em grupo' },
      { value: 'ungrouped', label: 'Sem grupo' },
      { value: 'group_main', label: 'Principal do grupo' },
      { value: 'group_member', label: 'Membro do grupo' }
    ]
    
    const scoreFilterOptions = [
      { value: 'all', label: 'Todos' },
      { value: 'no_score', label: 'Sem pontuação' },
      { value: 'pending', label: 'Pendente' },
      { value: 'approved', label: 'Aprovado' },
      { value: 'rejected', label: 'Rejeitado' }
    ]
    
    const triggerPointsFilterOptions = [
      { value: 'all', label: 'Todos' },
      { value: 'with_trigger_points', label: 'Com trigger points' },
      { value: 'without_trigger_points', label: 'Sem trigger points' }
    ]
    
    const filters = {
      countries: countryOptions,
      cities: cities.map(city => ({ value: city, label: city })),
      googleTypes: googleTypeOptions,
      categories: categoryOptions,
      status: statusOptions,
      contentStatus: contentStatusOptions,
      groupStatus: groupStatusOptions,
      scoreFilter: scoreFilterOptions,
      triggerPointsFilter: triggerPointsFilterOptions
    }
    
    console.log('🔧 POI Filters processed:', {
      countries: countries.length,
      cities: cities.length,
      googleTypes: googleTypes.length,
      categories: categories.length
    })
    
    const filtersResult = {
      success: true,
      data: filters
    }

    // Cache the result for 15 minutes (filters change less frequently)
    memoryCache.set(cacheKey, filtersResult, 15)
    console.log(`🔧 POI Filters: Cached result for key: ${cacheKey}`)

    return NextResponse.json(filtersResult)
    
  } catch (error) {
    console.error('🔧 POI Filters API Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// Helper function to format Google type labels
function formatGoogleTypeLabel(type: string): string {
  // Convert snake_case to Title Case
  return type
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}