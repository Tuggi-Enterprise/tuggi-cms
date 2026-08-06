/**
 * GET /api/search-poi — one POI by id, with its coordinate.
 *
 * SEC-37 + CARD-CMS-01: it read `core.attractions` as `anon` and answered anyone.
 * Roles are the ones that can sign into the CMS at all.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'

export const dynamic = 'force-dynamic'

export const GET = withAuth({ roles: ['admin', 'client', 'editor'] }, async (request: NextRequest, _ctx, auth) => {
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
    
    const supabase = auth.supabase
    
    // Search POI in database
    const { data: poiData, error: poiError } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city, country, approved, created_at, updated_at')
      .eq('id', poiId)
      .single()
    
    if (poiError) {
      throw poiError
    }
    
    // Get coordinates separately
    const { data: coordData, error: coordError } = await supabase
      .schema('core')
      .from('attraction_coordinate')
      .select('latitude, longitude')
      .eq('attraction_id', poiId)
      .single()
    
    if (coordError && coordError.code !== 'PGRST116') {
      // PGRST116 is "not found" error, which is expected if no coordinates exist
      console.warn('Warning: No coordinates found for POI:', coordError.message)
    }
    
    if (!poiData) {
      return NextResponse.json({
        success: false,
        error: 'POI not found'
      }, { status: 404 })
    }
    
    console.log(`✅ Found POI: ${poiData.name} (${coordData?.latitude || 'no lat'}, ${coordData?.longitude || 'no lng'})`)
    
    return NextResponse.json({
      success: true,
      data: {
        id: poiData.id,
        name: poiData.name,
        lat: coordData?.latitude || null,
        lng: coordData?.longitude || null,
        city: poiData.city,
        country: poiData.country,
        approved: poiData.approved,
        created_at: poiData.created_at,
        updated_at: poiData.updated_at
      }
    })
    
  } catch (error) {
    console.error('❌ Search error:', error)
    
    return NextResponse.json({
      success: false,
      error: `Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    }, { status: 500 })
  }
})
