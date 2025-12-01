
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { CoreTriggerPointPredictor } from '@/lib/services/trigger-points-google/core/trigger-point-predictor'
import { TriggerPointSavingService } from '@/lib/services/trigger-point-saving'
import { convertTriggerPointsToDB } from '@/lib/services/trigger-points-google/utils/conversion'
import { POIData } from '@/lib/services/trigger-points-google/types/interfaces'

interface POIBoundaryRequest {
  attraction_id: string
  poi_lat: number
  poi_lng: number
  poi_name: string
}

interface BoundaryResult {
  success: boolean
  boundary?: {
    type: 'polygon' | 'circle'
    coordinates: Array<{lat: number, lng: number}>
    area_m2: number
    perimeter_m: number
    confidence: number
  }
  trigger_points?: Array<{
    lat: number
    lng: number
    type: 'primary' | 'secondary' | 'fallback'
    reasoning: string
    confidence: number
    distance_from_poi: number
    expected_bearing: number
    radius_meters: number
  }>
  poi_confidence_score?: {
    overall_score: number
    boundary_quality: number
    trigger_points_quality: number
    data_source_reliability: number
    coverage_completeness: number
    factors: {
      boundary_source: string
      boundary_precision: number
      tp_count: number
      tp_distribution: number
      visibility_coverage: number
      landmark_bonus: number
    }
  }
  error?: string
}

// REMOVED: CONFIG object - was created but never used in the code

export async function POST(request: NextRequest) {
  try {
    const body: POIBoundaryRequest = await request.json()
    let { attraction_id, poi_lat, poi_lng, poi_name } = body

    // If only attraction_id is provided, fetch POI data from database
    if (attraction_id && (!poi_lat || !poi_lng || !poi_name)) {
      console.log(`🔍 Fetching POI data from database for ID: ${attraction_id}`)
      
      const { createClient } = await import('@supabase/supabase-js')
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )

      const { data: poiData, error: poiError } = await supabase
        .schema('core')
        .from('attractions')
        .select(`
          id,
          name,
          attraction_coordinate!left(latitude, longitude)
        `)
        .eq('id', attraction_id)
        .single()

      if (poiError || !poiData) {
        return NextResponse.json({ 
          success: false, 
          error: `POI not found: ${poiError?.message || 'Unknown error'}` 
        })
      }

      if (!poiData.attraction_coordinate || poiData.attraction_coordinate.length === 0) {
        return NextResponse.json({ 
          success: false, 
          error: 'POI has no coordinates' 
        })
      }

      const coordinate = poiData.attraction_coordinate[0]
      poi_lat = coordinate.latitude
      poi_lng = coordinate.longitude
      poi_name = poiData.name

      console.log(`✅ POI data loaded: ${poi_name} at (${poi_lat}, ${poi_lng})`)
    }

    if (!poi_lat || !poi_lng || !poi_name) {
      return NextResponse.json({ 
        success: false, 
        error: 'Missing required parameters: poi_lat, poi_lng, poi_name or attraction_id' 
      })
    }

    console.log(`🌍 Using CoreTriggerPointPredictor for: ${poi_name}`)

    // Use the modular CoreTriggerPointPredictor system (SSOT)
    const predictor = new CoreTriggerPointPredictor()
    
    // Prepare POI data
    const poiData: POIData = {
      id: attraction_id || '',
      name: poi_name,
      location: {
        lat: poi_lat,
        lng: poi_lng
      },
      type: 'attraction',
      country: 'BR', // Default, pode ser melhorado
      city: 'Unknown' // Default, pode ser melhorado
    }
    
    // Generate trigger points using the modular system
    const predictionResult = await predictor.predictTriggerPointsComplete(poiData, {
      maxSearchRadius: 1000,
      minQuality: 0.4
    })
    
    if (!predictionResult.triggerPoints || predictionResult.triggerPoints.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No trigger points generated',
        metadata: predictionResult.metadata
      } as BoundaryResult, { status: 400 })
    }
    
    // Convert trigger points to the format expected by this API
    const convertedTPs = convertTriggerPointsToDB(
      predictionResult.triggerPoints,
      predictionResult.boundary?.source || 'unknown'
    )
    
    // Save trigger points
    const saveResult = await TriggerPointSavingService.saveTriggerPointsBatch(
      attraction_id,
      convertedTPs,
      predictionResult.boundary?.source || 'unknown'
    )
    
    // Convert boundary to expected format
    const boundary = predictionResult.boundary ? {
      type: 'polygon' as const,
      coordinates: predictionResult.boundary.coordinates,
      area_m2: predictionResult.boundary.area || 0,
      perimeter_m: 0, // Not available in BoundaryData
      confidence: predictionResult.boundary.confidence
    } : undefined
    
    // Convert trigger points to expected format
    const triggerPoints = convertedTPs.map(tp => ({
      lat: tp.lat,
      lng: tp.lng,
      type: tp.type as 'primary' | 'secondary' | 'fallback',
      reasoning: `Generated by CoreTriggerPointPredictor (${tp.generation_method || 'unknown'})`,
      confidence: tp.confidence_score || 0.5,
      distance_from_poi: 0, // Not available in TriggerPointForDB
      expected_bearing: tp.expected_bearing || 0,
      radius_meters: tp.radius_meters || 30
    }))
    
    return NextResponse.json({
      success: true,
      boundary,
      trigger_points: triggerPoints,
      source: predictionResult.boundary?.source || 'unknown',
      auto_save_result: saveResult,
      processing_time: predictionResult.processingTime,
      metadata: predictionResult.metadata
    } as BoundaryResult)

  } catch (error) {
    console.error('❌ Error in boundary detection:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    } as BoundaryResult, { status: 500 })
  }
}

// NOTE: This route now uses CoreTriggerPointPredictor (SSOT)
// All legacy functions have been removed and consolidated into the modular system
// The CoreTriggerPointPredictor handles:
// - Boundary detection (via BoundaryDetector)
// - Trigger point generation (via StreetAnalyzer, PointCalculator, Validator)
// - Visibility validation (via VisibilityValidator)
// - All OSM queries and data processing
