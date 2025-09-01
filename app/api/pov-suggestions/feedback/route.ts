import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: NextRequest) {
  // TEMPORARILY DISABLED - AI trigger points functionality
  console.log('🚫 POV suggestions feedback API temporarily disabled')
  
  return NextResponse.json(
    { 
      error: 'POV suggestions feedback API is temporarily disabled',
      details: 'AI trigger points functionality has been temporarily disabled'
    },
    { status: 503 }
  )

    // Get POI data for context
    const { data: poiData, error: poiError } = await supabase
      .schema('core')
      .from('attractions')
      .select(`
        name, 
        google_types,
        coordinates:attraction_coordinate(latitude, longitude)
      `)
      .eq('id', poiId)
      .single()

    if (poiError || !poiData) {
      return NextResponse.json(
        { error: 'POI not found' },
        { status: 404 }
      )
    }

    // Extract coordinates from the relationship
    const poiLat = poiData.coordinates?.[0]?.latitude
    const poiLng = poiData.coordinates?.[0]?.longitude

    if (!poiLat || !poiLng) {
      return NextResponse.json(
        { error: 'POI coordinates not found' },
        { status: 404 }
      )
    }

    // Calculate distance and bearing
    const distance = Math.round(calculateHaversineDistance(
      poiLat, poiLng,
      coordinates.lat, coordinates.lng
    ))

    const bearing = Math.round(calculateBearing(
      poiLat, poiLng,
      coordinates.lat, coordinates.lng
    ))

    // Classify POI category and detect urban density
    const { data: categoryResult } = await supabase.rpc('classify_poi_category', {
      google_types: poiData.google_types,
      poi_name: poiData.name
    })
    
    const { data: densityResult } = await supabase.rpc('detect_urban_density', {
      poi_lat: poiLat,
      poi_lng: poiLng
    })
    
    const poiCategory = categoryResult || 'landmark'
    const urbanDensity = densityResult || 'mixed'
    
    console.log(`🏷️ Classified POI: category="${poiCategory}", density="${urbanDensity}"`)
    
    // Create context text for learning
    const contextText = `POI: ${poiData.name} (${poiLat}, ${poiLng}) | Types: ${poiData.google_types?.join(', ')} | POV: (${coordinates.lat}, ${coordinates.lng}) | Distance: ${distance}m | Bearing: ${bearing}° | Action: ${action} | Feedback: ${feedback || 'None'}`

    // Insert feedback into training dataset
    const { data: feedbackData, error: feedbackError } = await supabase
      .schema('core')
      .from('pov_training_examples')
      .insert({
        attraction_id: poiId,
        poi_name: poiData.name,
        poi_lat: poiLat,
        poi_lng: poiLng,
        poi_types: poiData.google_types,
        urban_density: urbanDensity,
        poi_category: poiCategory,
        
        trigger_lat: coordinates.lat,
        trigger_lng: coordinates.lng,
        distance_m: distance,
        bearing_deg: bearing,
        access_type: accessType || 'both', // Use from suggestion or default
        trigger_type: 'suggested',
        priority: action === 'accept' ? 1 : 0,
        radius_meters: 50, // Default value
        
        human_created: false,
        quality_score: action === 'accept' ? 85 : 25, // Default scores
        is_positive_example: action === 'accept',
        estimated_visibility: 'good', // Default value
        
        context_text: contextText
      })
      .select()
      .single()

    if (feedbackError) {
      console.error('Error saving feedback:', feedbackError)
      console.error('Error details:', JSON.stringify(feedbackError, null, 2))
      return NextResponse.json(
        { error: 'Failed to save feedback', details: feedbackError },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: `Suggestion ${action}ed successfully`,
      feedbackId: feedbackData.id
    })

  } catch (error) {
    console.error('Error processing feedback:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// Helper functions for geographic calculations
function calculateHaversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371e3 // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180
  const φ2 = lat2 * Math.PI / 180
  const Δφ = (lat2 - lat1) * Math.PI / 180
  const Δλ = (lng2 - lng1) * Math.PI / 180

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return R * c
}

function calculateBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const φ1 = lat1 * Math.PI / 180
  const φ2 = lat2 * Math.PI / 180
  const Δλ = (lng2 - lng1) * Math.PI / 180

  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)

  let bearing = Math.atan2(y, x) * 180 / Math.PI
  bearing = (bearing + 360) % 360

  return bearing
}
