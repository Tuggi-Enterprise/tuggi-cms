import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseKey)

export async function POST(request: NextRequest) {
  try {
    const { pois, sourceFile } = await request.json()
    
    if (!pois || !Array.isArray(pois) || pois.length === 0) {
      return NextResponse.json({ error: 'No POIs provided' }, { status: 400 })
    }

    console.log(`📊 [SUPABASE] Inserting ${pois.length} POIs from ${sourceFile}`)

    // Transform POIs to match database schema
    const transformedPOIs = pois.map(poi => ({
      name: poi.properties?.name || 'Unnamed POI',
      city: poi.properties?.city || poi.properties?.['addr:city'] || poi.properties?.['is_in:city'],
      state: poi.properties?.state || poi.properties?.['addr:state'] || poi.properties?.['is_in:state'],
      country: poi.properties?.country || 'Brazil',
      category: poi.properties?.category || poi.properties?.google_types || 'unknown',
      lat: poi.geometry?.coordinates?.[1] || 0,
      lon: poi.geometry?.coordinates?.[0] || 0,
      osm_id: poi.properties?.osm_id,
      osm_type: poi.properties?.osm_type,
      place_id: poi.properties?.place_id,
      formatted_address: poi.properties?.formatted_address,
      importance: poi.properties?.importance,
      source_file: sourceFile,
      source_type: 'osm',
      osm_properties: poi.properties,
      processing_status: 'completed'
    }))

    // Insert POIs in batches to avoid payload size limits
    const batchSize = 100
    const results = []
    
    for (let i = 0; i < transformedPOIs.length; i += batchSize) {
      const batch = transformedPOIs.slice(i, i + batchSize)
      
      const { data, error } = await supabase
        .from('pois')
        .insert(batch)
        .select('id')

      if (error) {
        console.error(`❌ [SUPABASE] Error inserting batch ${Math.floor(i / batchSize) + 1}:`, error)
        return NextResponse.json({ 
          success: false, 
          error: `Failed to insert batch: ${error.message}` 
        }, { status: 500 })
      }

      results.push(...(data || []))
      console.log(`✅ [SUPABASE] Batch ${Math.floor(i / batchSize) + 1} inserted: ${batch.length} POIs`)
    }

    console.log(`✅ [SUPABASE] Successfully inserted ${results.length} POIs`)

    return NextResponse.json({
      success: true,
      imported: results.length,
      data: results
    })

  } catch (error) {
    console.error('❌ [SUPABASE] Error in POIs API:', error)
    return NextResponse.json({ 
      success: false, 
      error: 'Internal server error' 
    }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const search = searchParams.get('search') || null
    const city = searchParams.get('city') || null
    const state = searchParams.get('state') || null
    const category = searchParams.get('category') || null
    const onlyComplete = searchParams.get('onlyComplete') === 'true' ? true : null

    const offset = (page - 1) * limit

    console.log(`📊 [SUPABASE] Fetching POIs: page=${page}, limit=${limit}`)

    // Use the custom function for pagination
    const { data, error } = await supabase
      .rpc('get_pois_paginated', {
        page_limit: limit,
        page_offset: offset,
        search_term: search,
        city_filter: city,
        state_filter: state,
        category_filter: category,
        only_complete: onlyComplete
      })

    if (error) {
      console.error('❌ [SUPABASE] Error fetching POIs:', error)
      return NextResponse.json({ 
        success: false, 
        error: error.message 
      }, { status: 500 })
    }

    const totalCount = data?.[0]?.total_count || 0
    const totalPages = Math.ceil(totalCount / limit)

    console.log(`✅ [SUPABASE] Fetched ${data?.length || 0} POIs (total: ${totalCount})`)

    return NextResponse.json({
      success: true,
      data: data || [],
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    })

  } catch (error) {
    console.error('❌ [SUPABASE] Error in POIs GET API:', error)
    return NextResponse.json({ 
      success: false, 
      error: 'Internal server error' 
    }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { ids } = await request.json()
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'No POI IDs provided' }, { status: 400 })
    }

    console.log(`🗑️ [SUPABASE] Deleting ${ids.length} POIs`)

    const { data, error } = await supabase
      .from('pois')
      .delete()
      .in('id', ids)
      .select('id')

    if (error) {
      console.error('❌ [SUPABASE] Error deleting POIs:', error)
      return NextResponse.json({ 
        success: false, 
        error: error.message 
      }, { status: 500 })
    }

    console.log(`✅ [SUPABASE] Successfully deleted ${data?.length || 0} POIs`)

    return NextResponse.json({
      success: true,
      deleted: data?.length || 0
    })

  } catch (error) {
    console.error('❌ [SUPABASE] Error in POIs DELETE API:', error)
    return NextResponse.json({ 
      success: false, 
      error: 'Internal server error' 
    }, { status: 500 })
  }
}
