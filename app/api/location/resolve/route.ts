/**
 * Location Resolution API Endpoint
 * 
 * Provides hierarchical fallback system for geographic boundary searches
 * Handles city → county fallback when specific city boundaries are not available
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { LocationResolver, LocationSearchResult } from '@/lib/services/location-resolver'

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * POST /api/location/resolve
 * 
 * Resolves location with hierarchical fallback system
 * 
 * Request body:
 * {
 *   "search_term": "Orlando",
 *   "lat": 28.5383,
 *   "lng": -81.3792,
 *   "state": "Florida"
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "data": LocationSearchResult
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { search_term, lat, lng, state } = body
    
    // Validate required parameters
    if (!search_term || typeof search_term !== 'string') {
      return NextResponse.json(
        { 
          success: false, 
          error: 'search_term is required and must be a string' 
        },
        { status: 400 }
      )
    }
    
    // Validate optional coordinates
    if ((lat !== undefined && typeof lat !== 'number') || 
        (lng !== undefined && typeof lng !== 'number')) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'lat and lng must be numbers if provided' 
        },
        { status: 400 }
      )
    }
    
    // Create LocationResolver instance
    const resolver = new LocationResolver(supabase)
    
    // Perform location resolution
    console.log(`🔍 API: Resolving location for "${search_term}"${lat && lng ? ` at (${lat}, ${lng})` : ''}`)
    
    const result: LocationSearchResult = await resolver.resolveLocation(
      search_term,
      lat,
      lng,
      state
    )
    
    // Log result for debugging
    console.log(`📍 API: Resolution result:`, {
      status: result.status,
      display_name: result.display_name,
      boundary_type: result.boundary_type,
      confidence: result.confidence
    })
    
    // Return successful response
    return NextResponse.json({
      success: true,
      data: result
    })
    
  } catch (error) {
    console.error('❌ API Error in location resolution:', error)
    
    return NextResponse.json(
      { 
        success: false, 
        error: 'Internal server error during location resolution',
        details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
      },
      { status: 500 }
    )
  }
}

/**
 * GET /api/location/resolve
 * 
 * Get location resolution with query parameters
 * 
 * Query parameters:
 * - search_term: string (required)
 * - lat: number (optional)
 * - lng: number (optional) 
 * - state: string (optional)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    
    const search_term = searchParams.get('search_term')
    const latParam = searchParams.get('lat')
    const lngParam = searchParams.get('lng')
    const state = searchParams.get('state')
    
    // Validate required parameters
    if (!search_term) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'search_term query parameter is required' 
        },
        { status: 400 }
      )
    }
    
    // Parse coordinates if provided
    let lat: number | undefined
    let lng: number | undefined
    
    if (latParam) {
      lat = parseFloat(latParam)
      if (isNaN(lat)) {
        return NextResponse.json(
          { 
            success: false, 
            error: 'lat must be a valid number' 
          },
          { status: 400 }
        )
      }
    }
    
    if (lngParam) {
      lng = parseFloat(lngParam)
      if (isNaN(lng)) {
        return NextResponse.json(
          { 
            success: false, 
            error: 'lng must be a valid number' 
          },
          { status: 400 }
        )
      }
    }
    
    // Create LocationResolver instance
    const resolver = new LocationResolver(supabase)
    
    // Perform location resolution
    console.log(`🔍 API (GET): Resolving location for "${search_term}"${lat && lng ? ` at (${lat}, ${lng})` : ''}`)
    
    const result: LocationSearchResult = await resolver.resolveLocation(
      search_term,
      lat,
      lng,
      state || undefined
    )
    
    // Log result for debugging
    console.log(`📍 API (GET): Resolution result:`, {
      status: result.status,
      display_name: result.display_name,
      boundary_type: result.boundary_type,
      confidence: result.confidence
    })
    
    // Return successful response
    return NextResponse.json({
      success: true,
      data: result
    })
    
  } catch (error) {
    console.error('❌ API Error in location resolution (GET):', error)
    
    return NextResponse.json(
      { 
        success: false, 
        error: 'Internal server error during location resolution',
        details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
      },
      { status: 500 }
    )
  }
}

/**
 * OPTIONS /api/location/resolve
 * 
 * Handle CORS preflight requests
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}