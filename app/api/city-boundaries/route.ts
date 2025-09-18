import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { LocationResolver } from '@/lib/services/location-resolver'

// Initialize Supabase client with service role key for server-side operations
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Simple in-memory cache for city boundaries (5 minute TTL)
const cityBoundariesCache = new Map<string, { data: any, timestamp: number }>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const cityName = searchParams.get('city')
    const stateName = searchParams.get('state')
    const countryName = searchParams.get('country')
    const latParam = searchParams.get('lat')
    const lngParam = searchParams.get('lng')

    if (!cityName) {
      return NextResponse.json(
        { success: false, error: 'City name is required' },
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
          { success: false, error: 'lat must be a valid number' },
          { status: 400 }
        )
      }
    }
    
    if (lngParam) {
      lng = parseFloat(lngParam)
      if (isNaN(lng)) {
        return NextResponse.json(
          { success: false, error: 'lng must be a valid number' },
          { status: 400 }
        )
      }
    }

    // If state is provided, use hierarchical validation
    if (stateName) {
      console.log(`🔍 Validating city "${cityName}" within state "${stateName}"`)
      
      // Check cache first
      const cacheKey = `${cityName}-${stateName}-${countryName || 'default'}`
      const cached = cityBoundariesCache.get(cacheKey)
      if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
        console.log(`💾 Cache hit for "${cacheKey}"`)
        return NextResponse.json(cached.data)
      }
      
      // Step 1: Find the state boundary first (admin_level 4) for optimized search
      const stateQuery = await supabase
        .schema('core')
        .from('city_boundaries')
        .select('name, name_en, geom, admin_level')
        .or(`name.ilike.%${stateName}%,name_en.ilike.%${stateName}%`)
        .eq('admin_level', 4) // State level
        .not('geom', 'is', null)
        .limit(1)

      if (stateQuery.error) {
        console.error('Error querying state:', stateQuery.error)
        return NextResponse.json(
          { success: false, error: 'Failed to query state' },
          { status: 500 }
        )
      }

      const states = stateQuery.data || []
      if (states.length === 0) {
        console.log(`⚠️ State "${stateName}" not found, falling back to LocationResolver`)
        // Fallback to LocationResolver
        const resolver = new LocationResolver(supabase)
        const result = await resolver.resolveLocation(cityName, lat, lng, countryName || undefined)
        
        if (result.status === 'not_found') {
          return NextResponse.json({
            success: true,
            data: [],
            count: 0,
            message: result.message
          })
        }

        const processedData = result.boundary_data ? [{
          osm_id: 0,
          name: result.boundary_data.name,
          name_en: result.boundary_data.name_en,
          boundary: null,
          admin_level: result.boundary_data.admin_level,
          geojson: result.boundary_data.geom,
          coordinates: result.boundary_data.coordinates,
          validation_status: 'fallback',
          validation_message: `State "${stateName}" not found, using fallback method`
        }] : []

        return NextResponse.json({
          success: true,
          data: processedData,
          count: processedData.length,
          status: result.status,
          message: result.message,
          boundary_type: result.boundary_type
        })
      }

      const state = states[0]
      console.log(`🏛️ Found state: ${state.name}`)

      // Step 2: Find cities within the state using spatial query (optimized)
      console.log(`🔍 Searching for cities named "${cityName}" within state "${state.name}" using spatial filter`)
      
      // First get cities with EXACT name match, then filter spatially using RPC
      console.log(`🔍 Searching for exact matches of city "${cityName}"`)
      const exactMatchQuery = await supabase
        .schema('core')
        .from('city_boundaries')
        .select('name, name_en, geom, admin_level')
        .or(`name.eq.${cityName},name_en.eq.${cityName}`)
        .eq('admin_level', 8) // City level
        .not('geom', 'is', null)

      let allCitiesQuery = exactMatchQuery
      
      // If no exact matches, try partial matches as fallback
      if (!exactMatchQuery.error && (!exactMatchQuery.data || exactMatchQuery.data.length === 0)) {
        console.log(`⚠️ No exact matches found, trying partial matches for "${cityName}"`)
        allCitiesQuery = await supabase
          .schema('core')
          .from('city_boundaries')
          .select('name, name_en, geom, admin_level')
          .or(`name.ilike.%${cityName}%,name_en.ilike.%${cityName}%`)
          .eq('admin_level', 8) // City level
          .not('geom', 'is', null)
          .limit(10) // Limit partial matches to avoid too many results
      }

      if (allCitiesQuery.error) {
        console.error('Error querying cities:', allCitiesQuery.error)
        console.log(`⚠️ City query failed, falling back to LocationResolver`)
      } else {
        const allCities = allCitiesQuery.data || []
        console.log(`📍 Found ${allCities.length} cities named "${cityName}", filtering by state`)

        // Filter cities that are within the state using spatial validation
        let validCity = null
        
        // Try to find exact name match first (most likely to be correct)
        const exactMatches = allCities.filter(city => 
          city.name === cityName || city.name_en === cityName
        )
        
        const citiesToCheck = exactMatches.length > 0 ? exactMatches : allCities
        console.log(`🎯 Checking ${citiesToCheck.length} cities (${exactMatches.length} exact matches)`)
        
        for (const city of citiesToCheck) {
          console.log(`🔍 Validating "${city.name}" spatially...`)
          try {
            const spatialQuery = await supabase
              .schema('core')
              .rpc('st_within_check', {
                city_geom: city.geom,
                state_geom: state.geom
              })

            if (spatialQuery.data === true) {
              validCity = city
              console.log(`✅ Found city "${city.name}" within state "${state.name}" (optimized)`)
              break
            } else {
              console.log(`❌ City "${city.name}" is NOT within state "${state.name}"`)
            }
          } catch (error) {
            console.log(`⚠️ Spatial validation failed for ${city.name}:`, error)
            continue
          }
        }

        if (!validCity) {
          console.log(`❌ No city "${cityName}" found within state "${stateName}" (optimized search)`)
          return NextResponse.json({
            success: true,
            data: [],
            count: 0,
            message: `City "${cityName}" not found within state "${stateName}".`,
            validation_status: 'failed'
          })
        }

        // Process the valid city data using RPC function
        let geojson = null
        let coordinates = null
        
        try {
          const geomData = await supabase
            .schema('core')
            .rpc('st_geom_to_coords', {
              geom_input: validCity.geom
            })

          if (geomData.data) {
            geojson = geomData.data.geojson
            coordinates = geomData.data.coordinates
          }
        } catch (parseError) {
          console.error('Error processing city geometry:', parseError)
        }

        const processedData = [{
          osm_id: 0,
          name: validCity.name,
          name_en: validCity.name_en,
          boundary: null,
          admin_level: validCity.admin_level,
          geojson: geojson,
          coordinates: coordinates,
          validation_status: 'validated',
          validation_message: `City "${validCity.name}" validated within state "${state.name}" (optimized)`
        }]

        const response = {
          success: true,
          data: processedData,
          count: processedData.length,
          status: 'success',
          message: `Found validated city "${validCity.name}" in state "${state.name}" (optimized)`,
          boundary_type: 'city',
          validation_status: 'validated'
        }

        // Cache the successful result
        cityBoundariesCache.set(cacheKey, { data: response, timestamp: Date.now() })
        console.log(`💾 Cached result for "${cacheKey}"`)

        return NextResponse.json(response)
      }

      // Fallback method starts here  
      if (allCitiesQuery.error) {
        console.log(`⚠️ Falling back to LocationResolver due to query error`)
        
        const resolver = new LocationResolver(supabase)
        const result = await resolver.resolveLocation(cityName, lat, lng, countryName || undefined)
        
        if (result.status === 'not_found') {
          return NextResponse.json({
            success: true,
            data: [],
            count: 0,
            message: result.message
          })
        }

        const processedData = result.boundary_data ? [{
          osm_id: 0,
          name: result.boundary_data.name,
          name_en: result.boundary_data.name_en,
          boundary: null,
          admin_level: result.boundary_data.admin_level,
          geojson: result.boundary_data.geom,
          coordinates: result.boundary_data.coordinates,
          validation_status: 'fallback',
          validation_message: `Query error, using fallback method`
        }] : []

        return NextResponse.json({
          success: true,
          data: processedData,
          count: processedData.length,
          status: result.status,
          message: result.message,
          boundary_type: result.boundary_type
        })
      }

    }

    // Fallback to LocationResolver if no state provided
    const resolver = new LocationResolver(supabase)
    const result = await resolver.resolveLocation(cityName, lat, lng, countryName || undefined)

    if (result.status === 'not_found') {
      return NextResponse.json({
        success: true,
        data: [],
        count: 0,
        message: result.message
      })
    }

    // Convert LocationResolver result to our expected format
    const processedData = result.boundary_data ? [{
      osm_id: 0, // LocationResolver doesn't return OSM ID
      name: result.boundary_data.name,
      name_en: result.boundary_data.name_en,
      boundary: null,
      admin_level: result.boundary_data.admin_level,
      geojson: result.boundary_data.geom,
      coordinates: result.boundary_data.coordinates,
      validation_status: 'unvalidated',
      validation_message: 'No state provided for validation'
    }] : []

    return NextResponse.json({
      success: true,
      data: processedData,
      count: processedData.length,
      status: result.status,
      message: result.message,
      boundary_type: result.boundary_type
    })

  } catch (error) {
    console.error('Error in city boundaries API:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
