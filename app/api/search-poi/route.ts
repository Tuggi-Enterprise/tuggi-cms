import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const poiId = searchParams.get('id')
    
    if (!poiId) {
      return NextResponse.json({
        success: false,
        error: 'Missing POI ID parameter'
      }, { status: 400 })
    }
    
    console.log(`🔍 Searching for POI: ${poiId}`)
    
    // Initialize Supabase client
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    
    // Search POI in database
    const { data, error } = await supabase
      .from('core.attractions')
      .select('id, name, lat, lng, google_types, created_at, updated_at, status')
      .eq('id', poiId)
      .single()
    
    if (error) {
      console.error('❌ Database error:', error)
      return NextResponse.json({
        success: false,
        error: `Database error: ${error.message}`
      }, { status: 500 })
    }
    
    if (!data) {
      return NextResponse.json({
        success: false,
        error: 'POI not found'
      }, { status: 404 })
    }
    
    console.log(`✅ Found POI: ${data.name} (${data.lat}, ${data.lng})`)
    
    return NextResponse.json({
      success: true,
      data: {
        id: data.id,
        name: data.name,
        lat: data.lat,
        lng: data.lng,
        google_types: data.google_types,
        status: data.status,
        created_at: data.created_at,
        updated_at: data.updated_at
      }
    })
    
  } catch (error) {
    console.error('❌ Search error:', error)
    
    return NextResponse.json({
      success: false,
      error: `Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    }, { status: 500 })
  }
}
