import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Use service role for database operations (has full access)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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

        // Generate trigger points using our detection API
        const response = await fetch(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/poi-boundaries/detect`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ 
            attraction_id: poi.id 
          }),
        })

        const result = await response.json()

        if (result.success && result.trigger_points && result.trigger_points.length > 0) {
          // Filter trigger points: only approved primary and secondary types
          const approvedTPs = result.trigger_points.filter((tp: any) => 
            tp.auto_status === 'approved' && 
            (tp.type === 'primary' || tp.type === 'secondary')
          )
          const reviewTPs = result.trigger_points.filter((tp: any) => tp.auto_status === 'review')
          const rejectedTPs = result.trigger_points.filter((tp: any) => tp.auto_status === 'rejected')
          const fallbackTPs = result.trigger_points.filter((tp: any) => tp.type === 'fallback')
          
          results.summary.approved_tps += approvedTPs.length
          results.summary.review_tps += reviewTPs.length
          results.summary.rejected_tps += rejectedTPs.length

          console.log(`📊 ${poi.name}: Generated ${result.trigger_points.length} TPs (${approvedTPs.length} approved primary/secondary, ${fallbackTPs.length} fallback excluded)`)

          if (approvedTPs.length > 0) {
            // Save approved TPs to database
            const tpsForDB = approvedTPs.map((tp: any) => ({
              attraction_id: poi.id,
              location: `POINT(${tp.lng} ${tp.lat})`,
              radius_meters: tp.radius_meters || 20,
              expected_bearing: tp.expected_bearing,
              bearing_threshold: 30,
              type: tp.type,
              priority: tp.type === 'primary' ? 1 : tp.type === 'secondary' ? 2 : 3,
              is_active: true,
              confidence_score: tp.individual_confidence_score,
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

            console.log(`✅ ${poi.name}: ${approvedTPs.length} approved TPs saved successfully`)
            results.successful++
          } else {
            // Mark POI as having no approved primary/secondary TPs
            await markPOIAsNoTPs(poi.id, 'no_approved_primary_secondary_tps', `Generated ${result.trigger_points.length} TPs but none were approved primary/secondary types`)
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
