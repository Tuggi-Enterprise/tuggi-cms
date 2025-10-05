import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../../lib/core/supabase-client';

const supabase = getSupabase('service');

// Simple in-memory cache
const memoryCache = new Map<string, any>()
const CACHE_TTL = 30 * 60 * 1000 // 30 minutes

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const country = searchParams.get('country');
    
    if (!country) {
      return NextResponse.json(
        { error: 'Country parameter is required' },
        { status: 400 }
      )
    }

    // Generate cache key for states by country
    const cacheKey = `states:${country}`

    // Try to get from cache first
    const cachedStates = memoryCache.get(cacheKey)
    if (cachedStates) {
      console.log(`🏛️ States: Returning cached data for ${country}`)
      return NextResponse.json({
        success: true,
        data: cachedStates
      })
    }

    console.log(`🏛️ States API: Processing fresh data for ${country}...`)
    
    // Fetch ALL states for the specific country using pagination to overcome Supabase 1000 limit
    let allStatesData: any[] = []
    let hasMoreStates = true
    let statesPage = 0
    const pageSize = 1000
    
    while (hasMoreStates) {
      const { data: pageData, error: pageError } = await supabase
        .schema('core')
        .from('attractions')
        .select('state')
        .eq('country', country)
        .not('state', 'is', null)
        .not('state', 'eq', '')
        .range(statesPage * pageSize, (statesPage + 1) * pageSize - 1)
      
      if (pageError) {
        console.error('Error fetching states page:', pageError)
        return NextResponse.json(
          { error: 'Failed to fetch states' },
          { status: 500 }
        )
      }
      
      if (!pageData || pageData.length === 0) {
        hasMoreStates = false
      } else {
        allStatesData = [...allStatesData, ...pageData]
        statesPage++
        
        // Safety check to prevent infinite loops
        if (statesPage > 50) { // Max 50,000 states
          console.warn('🏛️ States: Reached safety limit of 50,000 states')
          break
        }
      }
    }
    
    console.log(`🏛️ States: Fetched ${allStatesData.length} total states for ${country}`)
    
    // Process states and count POIs
    const stateMap = new Map<string, number>()
    
    allStatesData?.forEach(item => {
      if (item.state) {
        const count = stateMap.get(item.state) || 0
        stateMap.set(item.state, count + 1)
      }
    })
    
    // Convert to sorted array without counts
    const states = Array.from(stateMap.keys())
      .map(state => ({
        value: state,
        label: state
      }))
      .sort((a, b) => a.value.localeCompare(b.value))
    
    const result = {
      success: true,
      data: states
    }
    
    // Cache the result
    memoryCache.set(cacheKey, states)
    setTimeout(() => memoryCache.delete(cacheKey), CACHE_TTL)
    
    console.log(`🏛️ States API: Processed ${states.length} states for ${country}`)
    
    return NextResponse.json(result)
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}