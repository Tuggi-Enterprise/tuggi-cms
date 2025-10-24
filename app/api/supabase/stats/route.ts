import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseKey)

export async function GET(request: NextRequest) {
  try {
    console.log('📊 [SUPABASE] Fetching POIs statistics')

    // Get statistics from the view
    const { data: stats, error: statsError } = await supabase
      .from('pois_stats')
      .select('*')

    if (statsError) {
      console.error('❌ [SUPABASE] Error fetching stats:', statsError)
      return NextResponse.json({ 
        success: false, 
        error: statsError.message 
      }, { status: 500 })
    }

    // Get unique cities
    const { data: cities, error: citiesError } = await supabase
      .from('pois')
      .select('city')
      .not('city', 'is', null)
      .not('city', 'eq', '')

    if (citiesError) {
      console.error('❌ [SUPABASE] Error fetching cities:', citiesError)
    }

    // Get unique categories
    const { data: categories, error: categoriesError } = await supabase
      .from('pois')
      .select('category')
      .not('category', 'is', null)
      .not('category', 'eq', '')

    if (categoriesError) {
      console.error('❌ [SUPABASE] Error fetching categories:', categoriesError)
    }

    // Get unique states
    const { data: states, error: statesError } = await supabase
      .from('pois')
      .select('state')
      .not('state', 'is', null)
      .not('state', 'eq', '')

    if (statesError) {
      console.error('❌ [SUPABASE] Error fetching states:', statesError)
    }

    // Process unique values
    const uniqueCities = [...new Set(cities?.map(c => c.city) || [])].sort()
    const uniqueCategories = [...new Set(categories?.map(c => c.category) || [])].sort()
    const uniqueStates = [...new Set(states?.map(s => s.state) || [])].sort()

    const result = {
      ...stats?.[0],
      uniqueCities,
      uniqueCategories,
      uniqueStates
    }

    console.log('✅ [SUPABASE] Statistics retrieved:', result)

    return NextResponse.json({
      success: true,
      data: result
    })

  } catch (error) {
    console.error('❌ [SUPABASE] Error in stats API:', error)
    return NextResponse.json({ 
      success: false, 
      error: 'Internal server error' 
    }, { status: 500 })
  }
}
