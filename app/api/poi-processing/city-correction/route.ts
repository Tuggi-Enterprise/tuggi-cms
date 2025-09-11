import { NextRequest, NextResponse } from 'next/server'
import { CityCorrectionService, type CorrectionOptions } from '@/lib/services/poi-processing/city-correction.service'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { 
      action, 
      poi_ids, 
      country, 
      state, 
      limit = 100,
      options = {} 
    } = body

    console.log(`🔄 City correction API: ${action}`)

    switch (action) {
      case 'verify_single': {
        if (!poi_ids || !Array.isArray(poi_ids) || poi_ids.length === 0) {
          return NextResponse.json(
            { success: false, error: 'poi_ids array is required for verify_single action' },
            { status: 400 }
          )
        }

        // Get POI data first
        const pois = await CityCorrectionService.getPOIsForCorrection(1000, country, state)
        const targetPOI = pois.find(poi => poi.id === poi_ids[0])
        
        if (!targetPOI) {
          return NextResponse.json(
            { success: false, error: 'POI not found or missing coordinates' },
            { status: 404 }
          )
        }

        const result = await CityCorrectionService.verifySinglePOI(targetPOI, options)

        return NextResponse.json({
          success: true,
          data: result,
          message: `City verification completed for POI: ${targetPOI.name}`
        })
      }

      case 'batch_process': {
        const pois = await CityCorrectionService.getPOIsForCorrection(limit, country, state)
        
        if (pois.length === 0) {
          return NextResponse.json({
            success: true,
            data: {
              total_processed: 0,
              corrections_applied: 0,
              manual_review_needed: 0,
              errors: 0,
              processing_time: 0,
              results: []
            },
            message: 'No POIs found that need city correction'
          })
        }

        const batchResult = await CityCorrectionService.processBatch(pois, options)

        return NextResponse.json({
          success: true,
          data: batchResult,
          message: `Batch processing completed: ${batchResult.corrections_applied} corrections applied, ${batchResult.manual_review_needed} need manual review`
        })
      }

      case 'get_candidates': {
        const pois = await CityCorrectionService.getPOIsForCorrection(limit, country, state)

        return NextResponse.json({
          success: true,
          data: {
            total_candidates: pois.length,
            pois: pois.map(poi => ({
              id: poi.id,
              name: poi.name,
              city: poi.city,
              state: poi.state,
              country: poi.country,
              coordinates: {
                latitude: poi.latitude,
                longitude: poi.longitude
              }
            }))
          },
          message: `Found ${pois.length} POIs that may need city correction`
        })
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${action}` },
          { status: 400 }
        )
    }

  } catch (error) {
    console.error('❌ City correction API error:', error)
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      message: 'City correction processing failed'
    }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const country = searchParams.get('country')
    const state = searchParams.get('state')
    const limit = parseInt(searchParams.get('limit') || '100')

    // Get POIs that need correction
    const pois = await CityCorrectionService.getPOIsForCorrection(limit, country || undefined, state || undefined)

    return NextResponse.json({
      success: true,
      data: {
        total_candidates: pois.length,
        filters: {
          country: country || 'all',
          state: state || 'all',
          limit
        },
        pois: pois.slice(0, 10).map(poi => ({
          id: poi.id,
          name: poi.name,
          city: poi.city,
          state: poi.state,
          country: poi.country,
          coordinates: {
            latitude: poi.latitude,
            longitude: poi.longitude
          }
        }))
      },
      message: `Found ${pois.length} POIs that may need city correction`
    })

  } catch (error) {
    console.error('❌ City correction GET error:', error)
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }, { status: 500 })
  }
}
