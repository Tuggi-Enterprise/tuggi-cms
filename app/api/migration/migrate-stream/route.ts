import { NextRequest } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { getSupabase } from '@/lib/core/supabase-client'
import { PoiMigrationPipeline, PipelineOptions } from '@/lib/services/poi-migration-pipeline'
import { MigrationService } from '@/lib/services/migration-service'

const supabase = getSupabase('service')

/**
 * API Endpoint: Migrate POIs in batch with SSE streaming for real-time progress
 * POST /api/migration/migrate-stream
 * 
 * batch_size = 0 means "process ALL POIs until none are left"
 */
export const maxDuration = 60 // Vercel Hobby plan limit (max 60s)

export async function POST(request: NextRequest) {
  // Authentication check
  const cookieStore = await cookies()
  const supabaseAuth = createRouteHandlerClient({ cookies: () => cookieStore as any })
  const { data: { session }, error: authError } = await supabaseAuth.auth.getSession()

  if (authError || !session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const body = await request.json()
  const { filters = {}, options = {} } = body

  const {
    batch_size = 25,
    mode = 'enrichment_migration_triggers',
    auto_generate_audio = false,
    auto_approve_if_satisfactory = false,
    skip_if_exists = true,
    update_if_exists = false,
    languages = ['pt-br'],
    voice_gender = 'male'
  } = options

  // Continuous mode: batch_size = 0 means process all
  const continuousMode = batch_size === 0
  const fetchLimit = continuousMode ? 100 : batch_size * 2

  // Create a readable stream for SSE
  const encoder = new TextEncoder()
  
  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: string, data: any) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      const pipelineOptions: PipelineOptions = {
        auto_generate_audio,
        auto_approve_if_satisfactory,
        skip_if_exists,
        update_if_exists,
        mode: mode as any,
        languages,
        voice_gender
      }

      let totalProcessed = 0
      let totalSuccessful = 0
      let totalFailed = 0
      let hasMorePOIs = true
      let round = 0
      let lastUuidId = null

      const startTimeExecution = Date.now()
      const TIME_LIMIT_MS = (maxDuration - 20) * 1000 // Leave 20s buffer for cleanup

      try {
        sendEvent('status', { 
          message: continuousMode ? 'Starting continuous migration...' : 'Starting migration...', 
          phase: 'init',
          continuous: continuousMode
        })

        // Continuous loop for processing all POIs
        while (hasMorePOIs) {
          // Check if we are approaching timeout
          if (Date.now() - startTimeExecution > TIME_LIMIT_MS) {
            sendEvent('status', { 
              message: 'Approaching execution time limit. Ending current stream to allow reconnection...',
              phase: 'timeout_limit',
              totalProcessed,
              totalSuccessful,
              totalFailed
            })
            
            sendEvent('complete', {
              total: totalProcessed,
              processed: totalProcessed,
              successful: totalSuccessful,
              failed: totalFailed,
              hasMore: true, // Signal to client that it should call again
              message: `Processed ${totalProcessed} POIs. Reconnecting to continue...`
            })
            
            controller.close()
            return
          }

          round++
          
          // Build query to get POIs from homolog
          let query = supabase
            .schema('homolog')
            .from('pois')
            .select('uuid_id, name, city, state, country, processing_status, approved')
            .order('uuid_id', { ascending: true })

          // Apply pagination
          if (lastUuidId) {
            query = query.gt('uuid_id', lastUuidId)
          }

          // Apply filters
          if (filters.country === '__missing__') {
            query = query.or('country.is.null,country.eq.,state.is.null,state.eq.,city.is.null,city.eq.')
          } else if (filters.country && filters.country !== 'all') {
            query = query.eq('country', filters.country)
          }
          if (filters.state && filters.state !== 'all' && filters.country !== '__missing__') {
            query = query.eq('state', filters.state)
          }
          if (filters.city && filters.city !== 'all' && filters.country !== '__missing__') {
            query = query.eq('city', filters.city)
          }
          if (filters.processing_status && filters.processing_status !== 'all') {
            query = query.eq('processing_status', filters.processing_status)
          }

          query = query.limit(fetchLimit)


          const { data: pois, error: poisError } = await query
          
          if (pois && pois.length > 0) {
            lastUuidId = pois[pois.length - 1].uuid_id
          }


          if (poisError) {
            sendEvent('error', { error: `Failed to fetch POIs: ${poisError.message}` })
            controller.close()
            return
          }

          if (!pois || pois.length === 0) {
            if (totalProcessed === 0) {
              sendEvent('complete', { 
                total: 0, 
                processed: 0, 
                successful: 0, 
                failed: 0,
                message: 'No POIs found matching filters'
              })
            } else {
              sendEvent('complete', {
                total: totalProcessed,
                processed: totalProcessed,
                successful: totalSuccessful,
                failed: totalFailed,
                message: `Migration completed! ${totalSuccessful} successful, ${totalFailed} failed (${round} rounds)`
              })
            }
            controller.close()
            return
          }

          sendEvent('status', { 
            message: `Round ${round}: Found ${pois.length} POIs, filtering...`, 
            phase: 'filtering',
            round
          })

          sendEvent('status', { 
            message: `Round ${round}: Found ${pois.length} POIs, processing...`, 
            phase: 'processing',
            round
          })

          // Process POIs from this round one by one
          for (let i = 0; i < pois.length; i++) {
            const poi = pois[i]
            const globalIndex = totalProcessed + 1
            
            // Check if we should process this POI
            const shouldProcess = await MigrationService.shouldProcessPOI(poi.uuid_id)
            
            if (shouldProcess.should_process) {
              // Truly process this POI
              sendEvent('progress', {
                current: globalIndex,
                total: continuousMode ? '?' : batch_size,
                roundCurrent: i + 1,
                roundTotal: pois.length,
                percentage: continuousMode ? 0 : Math.round((globalIndex / batch_size) * 100),
                poi_name: poi.name,
                poi_id: poi.uuid_id,
                phase: 'processing',
                round
              })

              try {
                // Point of Interest: Each executePipeline performs ~2 OSM calls (Enrichment + Triggers)
                // We process sequentially (1 by 1) to respect Nominatim/Overpass rate limits
                const result = await PoiMigrationPipeline.executePipeline(poi.uuid_id, pipelineOptions)
                
                if (result.success) {
                  totalSuccessful++
                  sendEvent('poi_complete', {
                    current: globalIndex,
                    total: continuousMode ? '?' : batch_size,
                    poi_name: poi.name,
                    poi_id: poi.uuid_id,
                    success: true,
                    attraction_id: result.attraction_id,
                    steps: result.steps?.map(s => ({ step: s.step, success: s.success, time: s.processing_time }))
                  })
                } else {
                  totalFailed++
                  sendEvent('poi_complete', {
                    current: globalIndex,
                    total: continuousMode ? '?' : batch_size,
                    poi_name: poi.name,
                    poi_id: poi.uuid_id,
                    success: false,
                    error: result.error,
                    steps: result.steps?.map(s => ({ step: s.step, success: s.success, error: s.error, time: s.processing_time }))
                  })
                }
              } catch (error) {
                totalFailed++
                sendEvent('poi_complete', {
                  current: globalIndex,
                  total: globalIndex,
                  poi_name: poi.name,
                  poi_id: poi.uuid_id,
                  success: false,
                  error: error instanceof Error ? error.message : 'Unknown error'
                })
              }

              totalProcessed++

              // If we reached batch size in non-continuous mode, stop
              if (!continuousMode && totalProcessed >= batch_size) {
                hasMorePOIs = false
                break
              }

              // Delay between POIs (1s to respect Nominatim/Overpass rate limits)
              await new Promise(resolve => setTimeout(resolve, 1000))

            } else {
              // POI was skipped (already exists, error, etc.)
              const reason = shouldProcess.reason || 'Already processed'
              
              // Update status in homolog to prevent it appearing in next round
              if (reason.includes('already exists in core')) {
                await MigrationService.updateProcessingStatus(poi.uuid_id, 'migrated')
              } else {
                await MigrationService.updateProcessingStatus(poi.uuid_id, 'skipped', reason)
              }

              sendEvent('poi_skipped', {
                poi_name: poi.name,
                poi_id: poi.uuid_id,
                reason,
                round
              })

              // Small delay even for skips to avoid flooding
              await new Promise(resolve => setTimeout(resolve, 50))
            }
          }

          // In non-continuous mode, stop if batch reached or no more POIs in database
          if (!continuousMode) {
            if (totalProcessed >= batch_size || pois.length < fetchLimit) {
              hasMorePOIs = false
              sendEvent('complete', {
                total: totalProcessed,
                processed: totalProcessed,
                successful: totalSuccessful,
                failed: totalFailed,
                message: `Migration completed! ${totalSuccessful} successful, ${totalFailed} failed`
              })
              controller.close()
              return
            }
          }

          // In continuous mode, check if we've reached the end of the DB
          if (continuousMode && pois.length < fetchLimit) {
            hasMorePOIs = false
            sendEvent('complete', {
              total: totalProcessed,
              processed: totalProcessed,
              successful: totalSuccessful,
              failed: totalFailed,
              message: `Continuous migration finished. No more POIs found.`
            })
            controller.close()
            return
          }

          // Continuous mode heartbeat
          sendEvent('round_complete', {
            round,
            totalProcessed,
            totalSuccessful,
            totalFailed,
            message: `Round ${round} complete. Continuing...`
          })

          await new Promise(resolve => setTimeout(resolve, 500))
        }

        controller.close()
      } catch (error) {
        sendEvent('error', { error: error instanceof Error ? error.message : 'Unknown error' })
        controller.close()
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
