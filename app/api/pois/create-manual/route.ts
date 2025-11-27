import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/core/supabase-client'
import { ReverseGeocodingService } from '@/lib/services/reverse-geocoding.service'
import { OSMEnrichmentService } from '@/lib/services/poi-processing/osm-enrichment.service'
import { POICreationService } from '@/lib/services/poi-creation.service'

// Use service role client to bypass RLS for fetching created POI
const supabase = getSupabase('service')

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, lat, lng } = body

    // Validate required fields
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { error: 'Missing or invalid required field: name' },
        { status: 400 }
      )
    }

    if (lat === undefined || lng === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: lat, lng' },
        { status: 400 }
      )
    }

    console.log(`🆕 Creating manual POI: ${name} at ${lat}, ${lng}`)

    // Step 1: Reverse geocoding to get city, state, country
    let city: string | null = null
    let state: string | null = null
    let country: string | null = 'Brazil' // Default
    let formatted_address: string | null = null

    const geocodingResult = await ReverseGeocodingService.reverseGeocode(lat, lng)
    
    if (geocodingResult) {
      city = geocodingResult.city
      state = geocodingResult.state
      country = geocodingResult.country || 'Brazil'
      formatted_address = geocodingResult.formatted_address ?? null
      
      console.log(`📍 Reverse geocoding result: ${city}, ${state}, ${country}`)
    } else {
      console.warn(`⚠️ Reverse geocoding failed for ${lat}, ${lng}. Will require manual city/state input.`)
    }

    // Validate that we have at least city and country (required fields)
    if (!city || !country) {
      return NextResponse.json(
        { 
          error: 'Could not determine city and country from coordinates. Please ensure the coordinates are valid and try again.',
          details: 'Reverse geocoding failed. City and country are required fields.'
        },
        { status: 400 }
      )
    }

    // Step 2: Create POI using centralized service (atomic operation)
    const createResult = await POICreationService.createPOIWithCoordinates({
      name: name.trim(),
      city: city,
      state: state || null,
      country: country,
      formatted_address: formatted_address ?? null,
      latitude: lat,
      longitude: lng,
      import_source: 'manual',
      source_type: 'manual'
    })

    if (!createResult.success || !createResult.attraction_id) {
      return NextResponse.json(
        { 
          error: createResult.error || 'Failed to create POI',
          details: createResult.details
        },
        { status: 500 }
      )
    }

    const attractionId = createResult.attraction_id
    console.log(`✅ POI created successfully with ID: ${attractionId}`)

    // Step 3: Attempt OSM enrichment automatically (non-blocking)
    let enrichmentResult = null
    try {
      console.log(`🔄 Attempting OSM enrichment for POI: ${attractionId}`)
      
      enrichmentResult = await OSMEnrichmentService.enrichPOI({
        poi_id: attractionId,
        name: name.trim(),
        city: city,
        country: country,
        lat: lat,
        lng: lng
      })

      if (enrichmentResult.success) {
        console.log(`✅ OSM enrichment completed (Quality: ${enrichmentResult.data_quality_score}%)`)
      } else {
        console.log(`⚠️ OSM enrichment failed: ${enrichmentResult.message}`)
      }
    } catch (enrichmentError) {
      console.error('❌ Error during OSM enrichment (non-blocking):', enrichmentError)
      // Don't fail the request if enrichment fails
    }

    // Step 4: Fetch complete POI data to return
    const { data: completePOI, error: fetchError } = await supabase
      .schema('core')
      .from('attractions')
      .select(`
        *,
        attraction_coordinate (
          latitude,
          longitude
        )
      `)
      .eq('id', attractionId)
      .single()

    if (fetchError || !completePOI) {
      console.error('❌ Error fetching created POI:', fetchError)
      // Still return success since POI was created
    }

    return NextResponse.json({
      success: true,
      data: {
        ...completePOI,
        coordinates: completePOI?.attraction_coordinate?.[0] ? {
          latitude: completePOI.attraction_coordinate[0].latitude,
          longitude: completePOI.attraction_coordinate[0].longitude
        } : { latitude: lat, longitude: lng },
        enrichment_result: enrichmentResult
      }
    })

  } catch (error) {
    console.error('❌ Error processing manual POI creation:', error)
    return NextResponse.json(
      { 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

