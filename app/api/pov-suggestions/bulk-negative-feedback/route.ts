import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

interface BulkNegativeFeedbackRequest {
  poiId: string
  poiName: string
  poiLat: number
  poiLng: number
  suggestions: {
    suggestionId: string
    coordinates: { lat: number; lng: number }
    accessType: string
    source: string
    confidence: number
    reasoning: string
  }[]
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body: BulkNegativeFeedbackRequest = await request.json()
    const { poiId, poiName, poiLat, poiLng, suggestions } = body

    if (!poiId || !suggestions || suggestions.length === 0) {
      return NextResponse.json({ 
        success: false, 
        error: 'POI ID and suggestions are required' 
      }, { status: 400 })
    }

    console.log(`💾 Processing bulk negative feedback for ${poiName}: ${suggestions.length} suggestions`)

    // Get POI data for classification
    const { data: poiData, error: poiError } = await supabase
      .schema('core')
      .from('attractions')
      .select('name, google_types')
      .eq('id', poiId)
      .single()

    if (poiError) {
      console.error('Error fetching POI data:', poiError)
      return NextResponse.json({ 
        success: false, 
        error: 'Failed to fetch POI data' 
      }, { status: 500 })
    }

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
    
    console.log(`🏷️ POI Classification: category="${poiCategory}", density="${urbanDensity}"`)

    let savedCount = 0
    const errors: string[] = []

    // Process each suggestion as negative feedback
    for (const suggestion of suggestions) {
      try {
        // Calculate distance and bearing
        const distance = Math.round(
          6371000 * Math.acos(
            Math.cos(poiLat * Math.PI / 180) * 
            Math.cos(suggestion.coordinates.lat * Math.PI / 180) * 
            Math.cos((suggestion.coordinates.lng - poiLng) * Math.PI / 180) + 
            Math.sin(poiLat * Math.PI / 180) * 
            Math.sin(suggestion.coordinates.lat * Math.PI / 180)
          )
        )

        const bearing = Math.round(
          (Math.atan2(
            Math.sin((suggestion.coordinates.lng - poiLng) * Math.PI / 180) * 
            Math.cos(suggestion.coordinates.lat * Math.PI / 180),
            Math.cos(poiLat * Math.PI / 180) * 
            Math.sin(suggestion.coordinates.lat * Math.PI / 180) - 
            Math.sin(poiLat * Math.PI / 180) * 
            Math.cos(suggestion.coordinates.lat * Math.PI / 180) * 
            Math.cos((suggestion.coordinates.lng - poiLng) * Math.PI / 180)
          ) * 180 / Math.PI + 360) % 360
        )

        // Create context text for learning
        const contextText = `POI: ${poiData.name} (${poiLat}, ${poiLng}) | Types: ${poiData.google_types?.join(', ')} | POV: (${suggestion.coordinates.lat}, ${suggestion.coordinates.lng}) | Distance: ${distance}m | Bearing: ${bearing}° | Action: reject | Feedback: ${suggestion.reasoning} | Source: ${suggestion.source} | Confidence: ${suggestion.confidence}`

        // Insert negative feedback into training dataset
        const { error: insertError } = await supabase
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
            
            trigger_lat: suggestion.coordinates.lat,
            trigger_lng: suggestion.coordinates.lng,
            distance_m: distance,
            bearing_deg: bearing,
            access_type: suggestion.accessType || 'both',
            trigger_type: 'suggested',
            priority: 0, // Negative example
            radius_meters: 50,
            
            human_created: false,
            quality_score: 25, // Low score for negative examples
            is_positive_example: false, // Mark as negative
            estimated_visibility: 'poor',
            
            context_text: contextText
          })

        if (insertError) {
          console.error(`❌ Error inserting negative example for suggestion ${suggestion.suggestionId}:`, insertError)
          errors.push(`Failed to save suggestion ${suggestion.suggestionId}: ${insertError.message}`)
        } else {
          savedCount++
          console.log(`✅ Saved negative example for suggestion ${suggestion.suggestionId}`)
        }
      } catch (error) {
        console.error(`❌ Error processing suggestion ${suggestion.suggestionId}:`, error)
        errors.push(`Error processing suggestion ${suggestion.suggestionId}: ${error}`)
      }
    }

    console.log(`📊 Bulk negative feedback completed: ${savedCount}/${suggestions.length} saved`)

    return NextResponse.json({
      success: true,
      saved_count: savedCount,
      total_suggestions: suggestions.length,
      errors: errors.length > 0 ? errors : undefined
    })

  } catch (error) {
    console.error('❌ Bulk negative feedback error:', error)
    return NextResponse.json({
      success: false,
      error: 'Internal server error'
    }, { status: 500 })
  }
}
