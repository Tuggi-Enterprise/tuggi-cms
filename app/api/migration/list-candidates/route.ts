import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { getSupabase } from '@/lib/core/supabase-client'

export const dynamic = 'force-dynamic'

/**
 * API Endpoint: Get list of POIs candidates for migration
 * GET /api/migration/list-candidates
 */
export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const supabase = createRouteHandlerClient({ cookies: () => cookieStore as any })
    // Verify auth
    const { data: { session }, error: authError } = await supabase.auth.getSession()

    if (authError || !session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Use service role client for data fetching to ensure we can see homolog schema
    const supabaseService = getSupabase('service')

    const searchParams = request.nextUrl.searchParams
    const country = searchParams.get('country')
    const state = searchParams.get('state')
    const city = searchParams.get('city')
    const processingStatus = searchParams.get('processing_status')
    const limit = parseInt(searchParams.get('limit') || '50')
    const source = searchParams.get('source') || 'homolog'

    // Configure query target
    const targetSchema = source === 'core' ? 'core' : 'homolog'
    const targetTable = source === 'core' ? 'attractions' : 'pois'
    
    // Select columns based on source
    // Core uses 'id', Homolog uses 'uuid_id'
    const selectColumns = source === 'core' 
      ? 'id, name, city, state, country, approved' 
      : 'uuid_id, name, city, state, country, processing_status'

    // Build query
    let query = supabaseService
      .schema(targetSchema)
      .from(targetTable)
      .select(selectColumns)
      .order(source === 'core' ? 'id' : 'uuid_id', { ascending: true })

    // Apply filters
    if (country === '__missing__') {
      query = query.or('country.is.null,country.eq.,state.is.null,state.eq.,city.is.null,city.eq.')
    } else if (country && country !== 'all') {
      query = query.eq('country', country)
    }
    
    if (state && state !== 'all' && country !== '__missing__') {
      query = query.eq('state', state)
    }
    
    if (city && city !== 'all' && country !== '__missing__') {
      query = query.eq('city', city)
    }
    
    // Apply Status Filter
    if (processingStatus && processingStatus !== 'all') {
      if (source === 'core') {
        // For Core, map 'pending' to 'approved=true' (Active but needing triggers)
        // Or strictly filter.
        // User wants to find valid POIs. Usually active ones.
        if (processingStatus === 'pending') {
           // Maybe we want Approved POIs?
           query = query.eq('approved', true)
        } else if (processingStatus === 'failed') {
          // No direct mapping, maybe approved=false?
          query = query.eq('approved', false)
        }
        // 'all' passes through
      } else {
        // Homolog standard filtering
        query = query.eq('processing_status', processingStatus)
      }
    } else if (source === 'core' && (!processingStatus || processingStatus === 'all')) {
      // Default for Core if no status specified: Usually we want Approved items to reprocess
      // query = query.eq('approved', true) 
      // User might select 'all' to see everything? Let's leave it open if 'all'.
    }

    // Limit results
    query = query.limit(limit)

    const { data: pois, error } = await query

    if (error) {
      console.error('Error fetching migration candidates:', error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      data: pois?.map((p: any) => ({
        id: p.uuid_id || p.id,
        name: p.name,
        city: p.city,
        state: p.state,
        country: p.country,
        processing_status: p.processing_status || (p.approved ? 'approved' : 'pending')
      })) || []
    })

  } catch (error) {
    console.error('Error in list-candidates:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
