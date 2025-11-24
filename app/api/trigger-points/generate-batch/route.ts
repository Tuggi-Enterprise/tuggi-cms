import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '../../../../lib/core/supabase-client'

// Use service role for database operations (has full access)
const supabase = getSupabase('service')

// No longer need direct service imports - using the same API endpoint as /test-poi-boundaries

interface BatchGenerationRequest {
  country?: string
  city?: string
  attraction_ids?: string[]
  batch_size?: number
  // Optional: pre-generated trigger points to save (skips generation)
  pre_generated_tps?: Array<{
    attraction_id: string
    lat: number
    lng: number
    type: string
    confidence: number
    auto_status: string
    final_status: string
    radius_meters?: number
    expected_bearing?: number
    bearing_threshold?: number
    priority?: number
    score_factors?: any
    generation_method: string
    validation_notes?: string
    access?: string
  }>
  boundary_source?: string
}

interface BatchGenerationResult {
  success: boolean
  processed: number
  successful: number
  failed: number
  errors: Array<{
    attraction_id: string
    attraction_name: string
    error: string
  }>
  summary: {
    approved_tps: number
    review_tps: number
    rejected_tps: number
  }
  results?: Array<{
    poi_id: string
    poi_name: string
    success: boolean
    message: string
    trigger_points_generated: number
    trigger_points_saved: number
    trigger_points_skipped: number
    boundary_source?: string
    processing_time?: number
    errors?: string[]
  }>
}

export async function POST(request: NextRequest) {
  try {
    const body: BatchGenerationRequest = await request.json()
    const { country, city, attraction_ids, batch_size = 50, pre_generated_tps, boundary_source } = body

    // If pre-generated TPs are provided, skip generation and just save
    if (pre_generated_tps && pre_generated_tps.length > 0) {
      console.log(`💾 Saving ${pre_generated_tps.length} pre-generated trigger points`)
      
      // Group TPs by attraction_id
      const tpsByAttraction = new Map<string, typeof pre_generated_tps>()
      for (const tp of pre_generated_tps) {
        if (!tpsByAttraction.has(tp.attraction_id)) {
          tpsByAttraction.set(tp.attraction_id, [])
        }
        tpsByAttraction.get(tp.attraction_id)!.push(tp)
      }

      const results = {
        success: true,
        processed: tpsByAttraction.size,
        successful: 0,
        failed: 0,
        errors: [] as Array<{ attraction_id: string; attraction_name: string; error: string }>,
        summary: { approved_tps: 0, review_tps: 0, rejected_tps: 0 },
        results: [] as Array<{
          poi_id: string
          poi_name: string
          success: boolean
          message: string
          trigger_points_generated: number
          trigger_points_saved: number
          trigger_points_skipped: number
          boundary_source?: string
          processing_time?: number
          errors?: string[]
        }>
      }

      // Save TPs for each attraction
      for (const [attractionId, tps] of tpsByAttraction.entries()) {
        try {
          // Get POI name for logging
          const { data: poi } = await supabase
            .schema('core')
            .from('attractions')
            .select('name')
            .eq('id', attractionId)
            .single()

          const tpsForSaving = tps.map(tp => ({
            lat: tp.lat,
            lng: tp.lng,
            type: tp.type,
            confidence: tp.confidence,
            auto_status: tp.auto_status,
            final_status: tp.final_status,
            radius_meters: tp.radius_meters || 20,
            expected_bearing: tp.expected_bearing,
            bearing_threshold: tp.bearing_threshold || 30,
            priority: tp.priority || (tp.type === 'primary' ? 1 : tp.type === 'secondary' ? 2 : 3),
            score_factors: tp.score_factors || null,
            generation_method: tp.generation_method,
            validation_notes: tp.validation_notes,
            access: tp.access || 'both'
          }))

          const { TriggerPointSavingService } = await import('@/lib/services/trigger-point-saving')
          const saveResult = await TriggerPointSavingService.saveTriggerPointsBatch(
            attractionId,
            tpsForSaving,
            boundary_source || 'unknown'
          )

          if (saveResult.errors.length > 0) {
            throw new Error(`Save failed: ${saveResult.errors.join('; ')}`)
          }

          results.successful++
          results.summary.approved_tps += saveResult.saved
          results.results.push({
            poi_id: attractionId,
            poi_name: poi?.name || 'Unknown',
            success: true,
            message: `Successfully saved ${saveResult.saved} trigger points`,
            trigger_points_generated: tps.length,
            trigger_points_saved: saveResult.saved,
            trigger_points_skipped: saveResult.skipped,
            boundary_source: boundary_source || 'unknown',
            errors: []
          })
        } catch (error: any) {
          results.failed++
          results.errors.push({
            attraction_id: attractionId,
            attraction_name: 'Unknown',
            error: error.message || 'Unknown error'
          })
        }
      }

      return NextResponse.json(results)
    }

    console.log(`🚀 Starting batch trigger point generation...`)
    console.log(`📍 Filters: country=${country}, city=${city}, batch_size=${batch_size}`)

    // Build query to get POIs
    let query = supabase
      .schema('core')
      .from('attractions')
      .select(`
        id,
        name,
        city,
        country,
        state,
        category,
        osm_tags,
        attraction_coordinate!inner(latitude, longitude)
      `)
      .not('attraction_coordinate', 'is', null)

    // Apply filters
    if (attraction_ids && attraction_ids.length > 0) {
      query = query.in('id', attraction_ids)
    } else {
      if (country && country !== 'all') {
        query = query.eq('country', country)
      }
      if (city && city !== 'all') {
        query = query.eq('city', city)
      }
      
      // Limit to POIs without trigger points
      query = query.limit(batch_size)
    }

    const { data: poisData, error: poisError } = await query

    if (poisError) {
      console.error('❌ Error fetching POIs:', poisError)
      return NextResponse.json({
        success: false,
        error: `Error fetching POIs: ${poisError.message}`
      }, { status: 500 })
    }

    if (!poisData || poisData.length === 0) {
      return NextResponse.json({
        success: true,
        processed: 0,
        successful: 0,
        failed: 0,
        errors: [],
        summary: { approved_tps: 0, review_tps: 0, rejected_tps: 0 }
      } as BatchGenerationResult)
    }

    console.log(`📊 Found ${poisData.length} POIs to process`)

    // Filter out POIs that already have trigger points (unless specific IDs requested)
    let filteredPOIs = poisData
    if (!attraction_ids) {
      const poisWithoutTPs = []
      for (const poi of poisData) {
        const { data: existingTPs } = await supabase
          .schema('core')
          .from('attraction_trigger_points')
          .select('id')
          .eq('attraction_id', poi.id)
          .limit(1)

        if (!existingTPs || existingTPs.length === 0) {
          poisWithoutTPs.push(poi)
        }
      }
      filteredPOIs = poisWithoutTPs
    }

    console.log(`🎯 Processing ${filteredPOIs.length} POIs without trigger points`)

    const results = {
      processed: 0,
      successful: 0,
      failed: 0,
      errors: [] as Array<{ attraction_id: string, attraction_name: string, error: string }>,
      summary: { approved_tps: 0, review_tps: 0, rejected_tps: 0 },
      results: [] as Array<{
        poi_id: string
        poi_name: string
        success: boolean
        message: string
        trigger_points_generated: number
        trigger_points_saved: number
        trigger_points_skipped: number
        boundary_source?: string
        processing_time?: number
        errors?: string[]
      }>
    }

    // Process each POI
    for (const poi of filteredPOIs) {
      results.processed++
      const coordinate = poi.attraction_coordinate[0]
      
      try {
        const processingStart = Date.now()
        console.log(`🎯 Processing: ${poi.name} (${poi.city}, ${poi.country})`)

        // Use new motor (CoreTriggerPointPredictor) - same as /trigger-points-single
        const poiData = {
          id: poi.id,
          name: poi.name,
          location: {
            lat: coordinate.latitude,
            lng: coordinate.longitude
          },
          type: poi.category || 'point_of_interest',
          country: poi.country,
          city: poi.city,
          state: poi.state
        }

        // Call new trigger points generation API
        const { CoreTriggerPointPredictor } = await import('@/lib/services/trigger-points-google/core/trigger-point-predictor')
        const { TriggerPointSavingService } = await import('@/lib/services/trigger-point-saving')
        
        const predictor = new CoreTriggerPointPredictor()
        const predictionResult = await predictor.predictTriggerPointsComplete(poiData, {
          maxSearchRadius: 1000,
          minQuality: 0.4
        })

        if (!predictionResult.triggerPoints || predictionResult.triggerPoints.length === 0) {
          // No trigger points generated
          results.failed++
          results.results.push({
            poi_id: poi.id,
            poi_name: poi.name,
            success: false,
            message: 'No trigger points generated',
            trigger_points_generated: 0,
            trigger_points_saved: 0,
            trigger_points_skipped: 0,
            processing_time: Date.now() - processingStart
          })
          continue
        }

        // Convert and save trigger points
        const triggerPointsToSave = predictionResult.triggerPoints.map(tp => ({
          attraction_id: poi.id,
          lat: tp.location.lat,
          lng: tp.location.lng,
          radius_meters: tp.radius || 50,
          expected_bearing: tp.expectedBearing,
          bearing_threshold: tp.bearingThreshold || 30,
          type: tp.type,
          priority: tp.priority || 1,
          is_active: true,
          access: 'both' as 'walk' | 'car' | 'both',
          confidence: tp.confidence || 0.5,
          generation_method: tp.generationMethod || 'google_apis',
          boundary_source: predictionResult.boundary?.source || 'unknown'
        }))

        const saveResult = await TriggerPointSavingService.saveTriggerPoints(
          poi.id,
          triggerPointsToSave,
          {
            mode: 'replace_all',
            boundarySource: predictionResult.boundary?.source || 'unknown'
          }
        )

        if (saveResult.saved > 0) {
          console.log(`✅ ${poi.name}: Generated and saved ${saveResult.saved} TPs`)
          
          const approvedTPs = predictionResult.triggerPoints.filter(tp => 
            (tp.confidence || 0) >= 0.7 && 
            (tp.type === 'primary' || tp.type === 'secondary')
          )
          
          results.summary.approved_tps += approvedTPs.length
          results.successful++
          
          results.results.push({
            poi_id: poi.id,
            poi_name: poi.name,
            success: true,
            trigger_points_generated: predictionResult.triggerPoints.length,
            trigger_points_saved: saveResult.saved,
            trigger_points_skipped: saveResult.skipped || 0,
            message: `Successfully processed: ${saveResult.saved} TPs saved`,
            boundary_source: predictionResult.boundary?.source || 'unknown',
            processing_time: Date.now() - processingStart
          })
        } else {
          // No trigger points saved
          results.failed++
          results.results.push({
            poi_id: poi.id,
            poi_name: poi.name,
            success: false,
            message: 'No trigger points saved',
            trigger_points_generated: predictionResult.triggerPoints.length,
            trigger_points_saved: 0,
            trigger_points_skipped: predictionResult.triggerPoints.length,
            processing_time: Date.now() - processingStart
          })
        }

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown processing error'
        console.error(`❌ Error processing ${poi.name}:`, errorMsg)
        
        // Add detailed result for frontend
        results.results.push({
          poi_id: poi.id,
          poi_name: poi.name,
          success: false,
          message: errorMsg,
          trigger_points_generated: 0,
          trigger_points_saved: 0,
          trigger_points_skipped: 0,
          errors: [errorMsg]
        })
        
        results.failed++
        results.errors.push({
          attraction_id: poi.id,
          attraction_name: poi.name,
          error: errorMsg
        })
        
        // Mark POI as failed
        await markPOIAsNoTPs(poi.id, 'processing_error', errorMsg)
      }
    }

    console.log(`📊 Batch generation completed:`)
    console.log(`   - Processed: ${results.processed}`)
    console.log(`   - Successful: ${results.successful}`)
    console.log(`   - Failed: ${results.failed}`)
    console.log(`   - Approved TPs: ${results.summary.approved_tps}`)
    console.log(`   - Review TPs: ${results.summary.review_tps}`)
    console.log(`   - Rejected TPs: ${results.summary.rejected_tps}`)

    return NextResponse.json({
      success: true,
      ...results
    } as BatchGenerationResult)

  } catch (error) {
    console.error('❌ Error in batch generation:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

// Function removed - now using the same API endpoint as /test-poi-boundaries for consistency

// Helper function to log POI processing status
async function markPOIAsNoTPs(attractionId: string, reason: string, details: string) {
  try {
    console.log(`📝 Marking POI ${attractionId} as no valid TPs: ${reason} - ${details}`)
    
    // TODO: Consider creating a separate table for POI processing logs
    // For now, we just log the information
    
    // Alternative: Update the attraction record with processing metadata
    // This avoids RLS issues with trigger_points table
    const supabaseClient = getSupabase('service')
    const { error } = await supabaseClient
      .schema('core')
      .from('attractions')
      .update({
        updated_at: new Date().toISOString(),
        // Note: We could add a processing_notes column to store this info
      })
      .eq('id', attractionId)

    if (error) {
      console.log(`⚠️ Could not update attraction record: ${error.message}`)
    }
  } catch (error) {
    console.log(`⚠️ Could not mark POI status: ${error}`)
  }
}
