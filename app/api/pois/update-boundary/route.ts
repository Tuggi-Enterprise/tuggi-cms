import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseRouteHandler } from '@/lib/core/supabase-client'
import { cookies } from 'next/headers'
import { invalidatePOICache } from '@/lib/cache/poi-cache-invalidator'
import { getSupabase } from '@/lib/core/supabase-client'
import { logAuditEvent } from '@/lib/services/audit-service'

// A área do polígono tem um dono: lib/utils/geometry.ts. Esta rota mantinha a terceira
// cópia da mesma conta — e as três estavam erradas do mesmo jeito.
import { calculatePolygonArea } from '@/lib/utils/geometry'

/**
 * Calculate polygon center (centroid) - reused from existing implementations
 */
function calculatePolygonCenter(coordinates: Array<{ lat: number; lng: number }>): { lat: number; lng: number } {
  if (coordinates.length === 0) return { lat: 0, lng: 0 }

  let totalLat = 0
  let totalLng = 0
  
  for (const coord of coordinates) {
    totalLat += coord.lat
    totalLng += coord.lng
  }
  
  return {
    lat: totalLat / coordinates.length,
    lng: totalLng / coordinates.length
  }
}

/**
 * Convert coordinates array to GeoJSON Polygon
 * Reuses existing pattern from PolygonService
 */
function coordinatesToGeoJSON(coordinates: Array<{ lat: number; lng: number }>): string {
  // Close the polygon if not already closed
  const coords = [...coordinates]
  if (coords.length > 0) {
    const first = coords[0]
    const last = coords[coords.length - 1]
    if (first.lat !== last.lat || first.lng !== last.lng) {
      coords.push(first)
    }
  }

  // Convert to GeoJSON format: [lng, lat] pairs (same as PolygonService.savePolygon)
  const geoJsonCoords = coords.map(coord => [coord.lng, coord.lat])
  
  const geoJson = {
    type: 'Polygon',
    coordinates: [geoJsonCoords]
  }

  return JSON.stringify(geoJson)
}

export async function POST(request: NextRequest) {
  try {
    let auditUserId: string | null = null
    let auditUserEmail: string | null = null

    // Check authentication first
    // Allow service role key in header for testing (same pattern as other endpoints)
    const serviceRoleKey = request.headers.get('x-service-role-key')
    const isServiceRoleRequest = serviceRoleKey === process.env.SUPABASE_SECRET_KEY
    
    if (!isServiceRoleRequest) {
      // Regular authentication check for frontend requests
      const cookieStore = await cookies()
      const authSupabase = getSupabaseRouteHandler(cookieStore)
      const { data: { user }, error: authError } = await authSupabase.auth.getUser()
      if (authError || !user) {
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        )
      }
      // Check CMS role - only admin allowed to update boundary
      const { data: cmsUser, error: cmsError } = await authSupabase
        .schema('core')
        .from('cms_users')
        .select('id, role, is_active')
        .eq('email', user.email as string)
        .eq('is_active', true)
        .single()
      if (cmsError || !cmsUser || cmsUser.role !== 'admin') {
        return NextResponse.json({ error: 'Unauthorized - Admin only' }, { status: 403 })
      }

      auditUserId = cmsUser.id
      auditUserEmail = user.email || null
    } else {
      console.log('🔑 Using service role authentication for boundary update (test mode)')
    }

    // Use service role client to bypass RLS for boundary updates
    const supabase = getSupabase('service')

    const body = await request.json()
    const { attractionId: attrId, poi_id, coordinates, get_only, clear_boundary } = body

    // Support both parameter names
    const attractionId = attrId || poi_id

    console.log(`📥 Received request body:`, {
      attractionId,
      poi_id,
      get_only,
      coordinates_count: coordinates?.length,
    })

    if (!attractionId) {
      return NextResponse.json({ error: 'attractionId or poi_id is required' }, { status: 400 })
    }

    // Handle GET ONLY mode
    if (get_only) {
      console.log(`🔍 Fetching existing boundary for POI: ${attractionId}`)
      
      // Use RPC function to get boundary as GeoJSON string safely
      const { data, error } = await supabase
        .schema('core')
        .rpc('get_boundary_geometry', { p_attraction_id: attractionId })

      if (error) {
        console.error('Error fetching boundary via RPC:', error)
        return NextResponse.json({ error: 'Failed to fetch boundary' }, { status: 500 })
      }

      if (!data) {
        return NextResponse.json({ boundary: null })
      }

      // Transform GeoJSON to coordinate arrays.
      //
      // This branch used to accept ONLY type === 'Polygon'; a MultiPolygon fell through to
      // `boundary: null`, so the CMS showed no boundary at all for the 74k POIs stored as
      // multi-part — the wall of Segovia (39 parts), any POI whose OSM relation has annexes.
      //
      // The response keeps `boundary` as the flat outer ring it always was, because the
      // drawing/editing flow edits exactly one ring, and adds `boundaryRings` with every ring
      // for whoever only needs to display it. Old callers keep working untouched.
      try {
        const geojson = typeof data === 'string' ? JSON.parse(data) : data
        const rings: Array<Array<[number, number]>> =
          geojson?.type === 'MultiPolygon' ? geojson.coordinates.flat()
            : geojson?.type === 'Polygon' ? geojson.coordinates
              : []

        const toPoints = (ring: Array<[number, number]>) => {
          const pts = ring.map((c) => ({ lat: c[1], lng: c[0] }))
          // GeoJSON repeats the first point to close the ring; Google Maps closes on its own.
          if (pts.length > 1) pts.pop()
          return pts
        }

        const boundaryRings = rings.map(toPoints).filter((r) => r.length >= 3)
        if (boundaryRings.length > 0) {
          // Largest ring first: it is the one worth editing, and part [0] of a MultiPolygon is
          // often a sliver rather than the main shape.
          const largest = boundaryRings.reduce((a, b) => (b.length > a.length ? b : a))
          return NextResponse.json({
            boundary: largest,
            boundaryRings,
            partCount: geojson?.type === 'MultiPolygon' ? geojson.coordinates.length : 1,
          })
        }
      } catch (e) {
        console.error('Error parsing boundary geometry from RPC:', e)
      }

      return NextResponse.json({ boundary: null })
    }

    // Handle DELETE / CLEAR boundary mode.
    // Contract: the client (poi-boundary-service.deleteBoundary) posts
    // { poi_id, clear_boundary: true }. The legacy { boundary: null } shape is also
    // accepted for backwards compatibility. There is no delete RPC, so we NULL the
    // boundary_* columns directly — setting columns to null is a plain UPDATE (no DDL,
    // no PostGIS parsing). The service-role client bypasses RLS. The POI's own lat/lng
    // coordinate is preserved; only the polygon boundary is removed.
    if (clear_boundary === true || body.boundary === null) {
      console.log(`🧹 Clearing boundary for POI: ${attractionId}`)

      const { error: clearError } = await supabase
        .schema('core')
        .from('attraction_coordinate')
        .update({
          boundary_geometry: null,
          boundary_type: null,
          boundary_source: null,
          boundary_confidence: null,
          boundary_area_m2: null,
          boundary_centroid_lat: null,
          boundary_centroid_lng: null,
        })
        .eq('attraction_id', attractionId)

      if (clearError) {
        console.error('❌ Error clearing boundary:', clearError)
        return NextResponse.json(
          { error: 'Failed to clear boundary', details: clearError.message },
          { status: 500 }
        )
      }

      await logAuditEvent({
        request,
        action: 'UPDATE_POI',
        entity: 'POI',
        entityId: attractionId,
        userId: auditUserId,
        userEmail: auditUserEmail,
        description: 'Cleared POI boundary',
      })

      invalidatePOICache('POI boundary cleared')

      return NextResponse.json({ success: true, cleared: true })
    }

    if (!coordinates || !Array.isArray(coordinates) || coordinates.length < 3) {
      console.error('❌ Validation failed:', {
        has_coordinates: !!coordinates,
        is_array: Array.isArray(coordinates),
        length: coordinates?.length
      })
      return NextResponse.json(
        { error: 'Missing or invalid required fields: attractionId, coordinates (array with at least 3 points)' },
        { status: 400 }
      )
    }

    console.log(`🗺️ Updating POI boundary: ${attractionId} with ${coordinates.length} points`)

    // First, check if the attraction exists
    const { data: attraction, error: attractionError } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name')
      .eq('id', attractionId)
      .single()

    if (attractionError || !attraction) {
      return NextResponse.json(
        { error: 'Attraction not found' },
        { status: 404 }
      )
    }

    // Check if coordinates record exists for this attraction
    const { data: existingCoords, error: coordsCheckError } = await supabase
      .schema('core')
      .from('attraction_coordinate')
      .select('id, latitude, longitude, show_in_map')
      .eq('attraction_id', attractionId)
      .single()

    if (coordsCheckError && coordsCheckError.code !== 'PGRST116') {
      console.error('Error checking existing coordinates:', coordsCheckError)
      return NextResponse.json(
        { error: 'Failed to check existing coordinates' },
        { status: 500 }
      )
    }

    if (!existingCoords) {
      return NextResponse.json(
        { error: 'POI coordinates must exist before setting boundary. Please set coordinates first.' },
        { status: 400 }
      )
    }

    // Convert coordinates to GeoJSON
    const geoJsonString = coordinatesToGeoJSON(coordinates)
    console.log(`📐 GeoJSON generated (length: ${geoJsonString.length}): ${geoJsonString.substring(0, 200)}...`)
    console.log(`📐 Full GeoJSON:`, geoJsonString)
    
    // Calculate boundary metadata using reusable functions
    const area = Math.round(calculatePolygonArea(coordinates))
    const centroid = calculatePolygonCenter(coordinates)
    console.log(`📊 Boundary metadata: area=${area}m², centroid=(${centroid.lat}, ${centroid.lng})`)
    console.log(`📊 Input coordinates:`, coordinates)

    // Update boundary using RPC function (reuses existing pattern from homolog.upsert_coordinate)
    // This ensures proper GeoJSON to GEOGRAPHY conversion
    const rpcParams = {
      p_attraction_id: attractionId,
      p_geojson: geoJsonString,
      p_boundary_type: 'polygon',
      p_boundary_source: 'manual',
      p_boundary_confidence: 1.0, // Manual drawing = 100% confidence
      p_boundary_area_m2: area,
      p_boundary_centroid_lat: centroid.lat,
      p_boundary_centroid_lng: centroid.lng
    }
    
    console.log(`🔄 Calling RPC: update_boundary_geometry for attraction ${attractionId}`)
    console.log(`🔄 RPC Parameters:`, {
      ...rpcParams,
      p_geojson: rpcParams.p_geojson.substring(0, 200) + '...'
    })
    
    let coordinateId = null
    let rpcError = null
    
    const { data: rpcData, error: rpcErr } = await supabase
      .schema('core')
      .rpc('update_boundary_geometry', rpcParams)

    if (rpcErr) {
      rpcError = rpcErr
      console.error('❌ Error updating boundary via RPC:', rpcError)
      console.error('❌ RPC Error details:', JSON.stringify(rpcError, null, 2))
      console.error('❌ RPC Error code:', rpcError.code)
      console.error('❌ RPC Error message:', rpcError.message)
      console.error('❌ RPC Error details:', rpcError.details)
      console.error('❌ RPC Error hint:', rpcError.hint)
      console.error('❌ Input data:', {
        attraction_id: attractionId,
        geojson_length: geoJsonString.length,
        boundary_type: 'polygon',
        boundary_source: 'manual',
        area: area,
        centroid: centroid
      })
      
      // Try fallback: use insert_coordinate_safe if update_boundary_geometry fails
      console.log('🔄 Attempting fallback: using insert_coordinate_safe...')
      const { data: fallbackResult, error: fallbackError } = await supabase
        .schema('core')
        .rpc('insert_coordinate_safe', {
          p_attraction_id: attractionId,
          p_latitude: existingCoords.latitude,
          p_longitude: existingCoords.longitude,
          p_boundary_geometry_geojson: geoJsonString,
          p_boundary_type: 'polygon',
          p_boundary_source: 'manual',
          p_boundary_confidence: 1.0,
          p_boundary_area_m2: area,
          p_boundary_centroid_lat: centroid.lat,
          p_boundary_centroid_lng: centroid.lng
        })
      
      if (fallbackError) {
        console.error('❌ Fallback also failed:', fallbackError)
        return NextResponse.json(
          { 
            error: 'Failed to update boundary via RPC',
            details: rpcError.message,
            code: rpcError.code,
            hint: rpcError.hint,
            fallback_error: fallbackError.message,
            full_error: rpcError
          },
          { status: 500 }
        )
      }
      
      console.log('✅ Fallback successful:', fallbackResult)
      coordinateId = fallbackResult || existingCoords.id
    } else {
      coordinateId = rpcData || existingCoords.id
      console.log(`✅ RPC call successful, coordinate ID: ${coordinateId}`)
    }

    // Verify the update was successful by fetching the updated record
    // Wait a bit to ensure database transaction is committed
    await new Promise(resolve => setTimeout(resolve, 100))
    
    const { data: updatedCoord, error: verifyError } = await supabase
      .schema('core')
      .from('attraction_coordinate')
      .select('boundary_type, boundary_source, boundary_area_m2, boundary_geometry, boundary_centroid_lat, boundary_centroid_lng')
      .eq('attraction_id', attractionId)
      .single()

    if (verifyError) {
      console.error('⚠️ Warning: Could not verify boundary update:', verifyError)
      return NextResponse.json(
        { 
          error: 'Boundary update may have failed - could not verify',
          details: verifyError.message
        },
        { status: 500 }
      )
    }

    const hasGeometry = !!updatedCoord?.boundary_geometry
    const hasAllFields = updatedCoord?.boundary_type === 'polygon' && 
                         updatedCoord?.boundary_source === 'manual' &&
                         updatedCoord?.boundary_area_m2 !== null

    console.log(`✅ Verified boundary update:`, {
      boundary_type: updatedCoord?.boundary_type,
      boundary_source: updatedCoord?.boundary_source,
      boundary_area_m2: updatedCoord?.boundary_area_m2,
      boundary_centroid_lat: updatedCoord?.boundary_centroid_lat,
      boundary_centroid_lng: updatedCoord?.boundary_centroid_lng,
      has_geometry: hasGeometry,
      has_all_fields: hasAllFields
    })

    // If verification shows boundary was NOT saved, return error
    if (!hasGeometry || !hasAllFields) {
      console.error('❌ CRITICAL: Boundary update verification failed!', {
        has_geometry: hasGeometry,
        has_all_fields: hasAllFields,
        boundary_type: updatedCoord?.boundary_type,
        boundary_source: updatedCoord?.boundary_source,
        boundary_area_m2: updatedCoord?.boundary_area_m2
      })
      return NextResponse.json(
        { 
          error: 'Boundary update failed - verification shows boundary was not saved',
          details: {
            has_geometry: hasGeometry,
            has_all_fields: hasAllFields,
            saved_data: updatedCoord
          }
        },
        { status: 500 }
      )
    }

    console.log(`✅ Successfully updated boundary for POI: ${attraction.name}`)

    await logAuditEvent({
      request,
      action: 'UPDATE_POI',
      entity: 'POI',
      entityId: attractionId,
      userId: auditUserId,
      userEmail: auditUserEmail,
      description: `Updated POI boundary (${coordinates.length} points)`
    })

    // Invalidate cache
    invalidatePOICache('POI boundary updated')

    return NextResponse.json({
      success: true,
      data: {
        attraction_id: attractionId,
        coordinate_id: coordinateId,
        boundary_type: updatedCoord.boundary_type,
        boundary_source: updatedCoord.boundary_source,
        boundary_area_m2: updatedCoord.boundary_area_m2,
        boundary_centroid: {
          lat: updatedCoord.boundary_centroid_lat,
          lng: updatedCoord.boundary_centroid_lng
        },
        points_count: coordinates.length,
        verified: true
      }
    })

  } catch (error) {
    console.error('❌ Error updating POI boundary:', error)
    return NextResponse.json(
      { 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

