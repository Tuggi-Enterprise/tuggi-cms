import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Use service role for database operations (has full access)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Import services to avoid fetch issues in production
import { BoundaryDetectionService } from '@/lib/services/boundary-detection'
import { TriggerPointsService } from '@/lib/services/trigger-points-generation'
import { OSMDataEnrichmentService } from '@/lib/services/osm-data-enrichment'

interface BatchGenerationRequest {
  country?: string
  city?: string
  attraction_ids?: string[]
  batch_size?: number
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
}

export async function POST(request: NextRequest) {
  try {
    const body: BatchGenerationRequest = await request.json()
    const { country, city, attraction_ids, batch_size = 50 } = body

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
      summary: { approved_tps: 0, review_tps: 0, rejected_tps: 0 }
    }

    // Process each POI
    for (const poi of filteredPOIs) {
      results.processed++
      const coordinate = poi.attraction_coordinate[0]
      
      try {
        console.log(`🎯 Processing: ${poi.name} (${poi.city}, ${poi.country})`)

        // Generate trigger points using direct function call (avoids fetch issues in production)
        const result = await detectPOIBoundariesDirect(poi.id)

        if (result.success && result.trigger_points && result.trigger_points.success && Array.isArray(result.trigger_points.trigger_points) && result.trigger_points.trigger_points.length > 0) {
          // Filter trigger points: only approved primary and secondary types
          const triggerPointsArray = result.trigger_points.trigger_points
          const approvedTPs = triggerPointsArray.filter((tp: any) => 
            tp.auto_status === 'approved' && 
            (tp.type === 'primary' || tp.type === 'secondary')
          )
          const reviewTPs = triggerPointsArray.filter((tp: any) => tp.auto_status === 'review')
          const rejectedTPs = triggerPointsArray.filter((tp: any) => tp.auto_status === 'rejected')
          const fallbackTPs = triggerPointsArray.filter((tp: any) => tp.type === 'fallback')
          
          results.summary.approved_tps += approvedTPs.length
          results.summary.review_tps += reviewTPs.length
          results.summary.rejected_tps += rejectedTPs.length

          console.log(`📊 ${poi.name}: Generated ${triggerPointsArray.length} TPs (${approvedTPs.length} approved primary/secondary, ${fallbackTPs.length} fallback excluded)`)

          if (approvedTPs.length > 0) {
            // Validate for duplicates before saving
            console.log(`🔍 ${poi.name}: Validating ${approvedTPs.length} TPs for duplicates`)
            
            const tpsForValidation = approvedTPs.map((tp: any) => ({
              lat: tp.lat,
              lng: tp.lng,
              type: tp.type,
              confidence: tp.individual_confidence_score,
              auto_status: tp.auto_status,
              reasoning: tp.reasoning,
              radius_meters: tp.radius_meters || 20,
              expected_bearing: tp.expected_bearing,
              score_factors: tp.score_factors,
              generation_method: tp.generation_method,
              final_status: tp.final_status
            }))
            
            const { data: validatedTPs, error: validationError } = await supabase
              .schema('core')
              .rpc('validate_trigger_points_batch', {
                p_attraction_id: poi.id,
                p_trigger_points: tpsForValidation,
                p_distance_threshold: 20.0
              })
            
            if (validationError) {
              throw new Error(`Validation failed: ${validationError.message}`)
            }
            
            const validatedTPsArray = validatedTPs as any[]
            const duplicatesSkipped = approvedTPs.length - validatedTPsArray.length
            
            if (validatedTPsArray.length === 0) {
              console.log(`⚠️ ${poi.name}: All ${approvedTPs.length} TPs were duplicates - skipping`)
              results.successful++
              continue
            }
            
            // Save validated TPs to database
            const tpsForDB = validatedTPsArray.map((tp: any) => ({
              attraction_id: poi.id,
              location: `POINT(${tp.lng} ${tp.lat})`,
              radius_meters: tp.radius_meters || 20,
              expected_bearing: tp.expected_bearing,
              bearing_threshold: 30,
              type: tp.type,
              priority: tp.type === 'primary' ? 1 : tp.type === 'secondary' ? 2 : 3,
              is_active: true,
              confidence_score: tp.confidence,
              auto_status: tp.auto_status,
              manual_status: 'pending',
              final_status: tp.final_status,
              score_factors: tp.score_factors,
              generation_method: tp.generation_method,
              validation_notes: tp.reasoning
            }))

            const { error: insertError } = await supabase
              .schema('core')
              .from('attraction_trigger_points')
              .insert(tpsForDB)

            if (insertError) {
              throw new Error(`Database insert failed: ${insertError.message}`)
            }

            console.log(`✅ ${poi.name}: ${validatedTPsArray.length} validated TPs saved (${duplicatesSkipped} duplicates skipped)`)
            results.successful++
          } else {
            // Mark POI as having no approved primary/secondary TPs
            await markPOIAsNoTPs(poi.id, 'no_approved_primary_secondary_tps', `Generated ${triggerPointsArray.length} TPs but none were approved primary/secondary types`)
            console.log(`⚠️ ${poi.name}: No approved primary/secondary TPs (${fallbackTPs.length} fallback TPs excluded)`)
            results.successful++ // Still count as processed successfully
          }
        } else {
          // Generation failed completely
          await markPOIAsNoTPs(poi.id, 'generation_failed', result.error || 'Unknown generation error')
          console.log(`❌ ${poi.name}: Generation failed - ${result.error}`)
          results.failed++
          results.errors.push({
            attraction_id: poi.id,
            attraction_name: poi.name,
            error: result.error || 'Unknown generation error'
          })
        }

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown processing error'
        console.error(`❌ Error processing ${poi.name}:`, errorMsg)
        
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

// Helper function to detect POI boundaries and generate trigger points (avoids fetch issues)
async function detectPOIBoundariesDirect(attractionId: string) {
  try {
    // Get POI data
    const { data: poi, error: poiError } = await supabase
      .schema('core')
      .from('attractions')
      .select(`
        id,
        name,
        city,
        country,
        attraction_coordinate!inner(latitude, longitude)
      `)
      .eq('id', attractionId)
      .single()

    if (poiError || !poi) {
      return { success: false, error: 'POI not found' }
    }

    const coordinate = poi.attraction_coordinate[0]
    
    // Detect boundary using the service
    const boundaryResult = await BoundaryDetectionService.detectBoundary(
      coordinate.latitude,
      coordinate.longitude,
      poi.name
    )

    if (!boundaryResult.success || !boundaryResult.boundary) {
      return { success: false, error: boundaryResult.error || 'Boundary detection failed' }
    }

    // Generate trigger points
    const triggerPoints = await TriggerPointsService.generateTriggerPoints(
      boundaryResult.boundary,
      coordinate.latitude,
      coordinate.longitude,
      poi.name,
      [], // Empty streets array for now
      { isHighVisibility: false, maxRange: 1000, elevationDiff: 0 } // Default landmark info
    )

    // Enrich OSM data
    const enrichmentData = OSMDataEnrichmentService.extractFromBoundary(boundaryResult.boundary, boundaryResult.boundary.source)
    await OSMDataEnrichmentService.saveEnrichmentData(poi.id, enrichmentData)

    return {
      success: true,
      trigger_points: triggerPoints,
      boundary: boundaryResult.boundary
    }

  } catch (error) {
    console.error('Error in direct boundary detection:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

// Helper function to log POI processing status
async function markPOIAsNoTPs(attractionId: string, reason: string, details: string) {
  try {
    console.log(`📝 Marking POI ${attractionId} as no valid TPs: ${reason} - ${details}`)
    
    // TODO: Consider creating a separate table for POI processing logs
    // For now, we just log the information
    
    // Alternative: Update the attraction record with processing metadata
    // This avoids RLS issues with trigger_points table
    const { error } = await supabase
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
