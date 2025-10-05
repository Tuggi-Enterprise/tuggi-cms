import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '../../../../lib/core/supabase-client'
import { memoryCache } from '@/lib/cache/memory-cache'

const supabase = getSupabase('service')

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const country = searchParams.get('country')
    
    // Generate cache key for categories
    const cacheKey = country ? `pois-categories:${country}` : 'pois-categories:all'

    // Try to get from cache first
    const cachedCategories = memoryCache.get(cacheKey)
    if (cachedCategories) {
      console.log(`🏷️ POI Categories: Returning cached data for ${country || 'all countries'}`)
      return NextResponse.json(cachedCategories)
    }

    console.log(`🏷️ POI Categories API: Processing fresh data for ${country || 'all countries'}...`)
    
    // Build query for categories with optional country filter
    let query = supabase
      .schema('core')
      .from('attractions')
      .select('category')
      .not('category', 'is', null)
      .not('category', 'eq', '')
    
    // Add country filter if provided
    if (country) {
      query = query.eq('country', country)
    }
    
    const { data: categoriesData, error: categoriesError } = await query
    
    if (categoriesError) {
      console.error('Error fetching categories:', categoriesError)
      return NextResponse.json(
        { error: 'Failed to fetch categories' },
        { status: 500 }
      )
    }
    
    // Process categories to get unique values
    const categorySet = new Set<string>()
    
    categoriesData?.forEach(item => {
      if (item.category) {
        categorySet.add(item.category)
      }
    })
    
    // Convert to sorted array without counts
    const categories = Array.from(categorySet)
      .map(category => ({
        value: category,
        label: category
      }))
      .sort((a, b) => a.value.localeCompare(b.value))
    
    console.log(`🏷️ POI Categories processed: ${categories.length} categories for ${country || 'all countries'}`)
    
    const result = {
      success: true,
      data: categories,
      country: country || null
    }

    // Cache the result for 30 minutes
    memoryCache.set(cacheKey, result, 30)
    console.log(`🏷️ POI Categories: Cached result for key: ${cacheKey}`)

    return NextResponse.json(result)
    
  } catch (error) {
    console.error('🏷️ POI Categories API Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}