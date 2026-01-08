import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { getSupabase } from '@/lib/core/supabase-client'

export const dynamic = 'force-dynamic'

const supabase = getSupabase('service')

/**
 * API Endpoint: Get locations (countries, states, cities) from homolog.pois
 * GET /api/migration/locations?type=countries|states|cities&country=...&state=...
 */
export async function GET(request: NextRequest) {
  try {
    // Authentication check
    const cookieStore = await cookies()
    const supabaseAuth = createRouteHandlerClient({ cookies: () => cookieStore as any })
    const { data: { session }, error: authError } = await supabaseAuth.auth.getSession()

    if (authError || !session) {
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') // 'countries', 'states', 'cities'
    const country = searchParams.get('country')
    const state = searchParams.get('state')

    if (!type) {
      return NextResponse.json(
        { error: 'Missing required parameter: type' },
        { status: 400 }
      )
    }

    // Fetch ALL items using pagination to overcome Supabase 1000 limit
    // Following the same pattern used in app/api/pois/countries/route.ts and app/api/pois/cities/route.ts
    let allData: any[] = []
    let hasMore = true
    let page = 0
    const pageSize = 1000

    // Determine field name based on type
    const fieldName = type === 'countries' ? 'country' : type === 'states' ? 'state' : 'city'

    while (hasMore) {
      // Build query based on type
      let query = supabase
        .schema('homolog')
        .from('pois')
        .select(fieldName)
        .not(fieldName, 'is', null)
        .not(fieldName, 'eq', '')

      // Apply filters
      if (type === 'states' && country && country !== 'all') {
        query = query.eq('country', country)
      } else if (type === 'cities') {
        if (country && country !== 'all') {
          query = query.eq('country', country)
        }
        if (state && state !== 'all') {
          query = query.eq('state', state)
        }
      }

      // Apply pagination
      const { data: pageData, error: pageError } = await query
        .range(page * pageSize, (page + 1) * pageSize - 1)

      if (pageError) {
        return NextResponse.json(
          { error: `Failed to fetch ${type}: ${pageError.message}` },
          { status: 500 }
        )
      }

      if (!pageData || pageData.length === 0) {
        hasMore = false
      } else {
        allData = [...allData, ...pageData]
        page++

        // Safety check to prevent infinite loops
        if (page > 50) { // Max 50,000 items
          console.warn(`⚠️ ${type}: Reached safety limit of 50,000 items`)
          break
        }

        // If we got less than pageSize, we've reached the end
        if (pageData.length < pageSize) {
          hasMore = false
        }
      }
    }

    console.log(`📊 ${type}: Fetched ${allData.length} total items from homolog.pois`)

    // Process and group by unique values with count
    const valueMap = new Map<string, number>()

    allData.forEach((row: any) => {
      const value = row[fieldName]
      if (value) {
        valueMap.set(value, (valueMap.get(value) || 0) + 1)
      }
    })

    const result: Array<{ value: string; label: string; count?: number }> = Array.from(valueMap.entries())
      .map(([name, count]) => ({ value: name, label: name, count }))
      .sort((a, b) => a.label.localeCompare(b.label))

    return NextResponse.json({
      success: true,
      data: result
    })
  } catch (error) {
    console.error('Migration locations API error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

