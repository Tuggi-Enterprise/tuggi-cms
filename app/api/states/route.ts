import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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
    
    // Fetch states for the specific country
    const { data: statesData, error: statesError } = await supabase
      .schema('core')
      .from('attractions')
      .select('state')
      .eq('country', country)
      .not('state', 'is', null)
      .not('state', 'eq', '')
    
    if (statesError) {
      console.error('Error fetching states:', statesError)
      return NextResponse.json(
        { error: 'Failed to fetch states' },
        { status: 500 }
      )
    }
    
    // Process states and count POIs
    const stateMap = new Map<string, number>()
    
    statesData?.forEach(item => {
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