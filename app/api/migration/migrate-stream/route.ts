import { withAuth } from '@/lib/auth-middleware'
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

/**
 * PORTÃO: `withAuth({ roles: ['admin'] })`, desde 2026-09-01.
 *
 * Antes, a Única checagem era "existe sessão" — nenhuma linha deste arquivo lia `role` nem
 * `cms_users`. Logo abaixo, o módulo instancia `getSupabase('service')`. Ou seja: qualquer conta
 * do CMS com sessão (um `client`, que é um parceiro) disparava o pipeline de migração — escrita
 * em `core.attractions`, geração de descrição e áudio com custo de LLM/TTS, leitura do schema
 * `homolog` inteiro. A tela `/poi-processing` é admin-only pelo proxy; a API que ela consome
 * não era, e o proxy não cobre `/api`.
 *
 * `withAuth` também troca `getSession()` por `getUser()`, que revalida o JWT contra o servidor
 * de Auth — ver o cabeçalho de `lib/auth-middleware.ts`.
 */
export const POST = withAuth({ roles: ['admin'] }, async (request) => {
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
          
          // Build query based on mode (homolog or core)
          let query: any

          if (mode === 'reprocess_triggers_core') {
            // CORE MODE: Get from core.attractions
            query = supabase
              .schema('core')
              .from('attractions')
              .select('id, name, city, state, country, approved') // selecting 'id' but we'll map to 'uuid_id'
              .order('id', { ascending: true })
              
             if (lastUuidId) {
               query = query.gt('id', lastUuidId)
             }
             
             // Apply filters for Core
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
             // NOTE: 'processing_status' does not apply to core.attractions in the same way, ignored for now.
             
          } else {
             // DEFAULT HOMOLOG MODE: Get from homolog.pois
             query = supabase
              .schema('homolog')
              .from('pois')
              .select('uuid_id, name, city, state, country, processing_status, approved')
              .order('uuid_id', { ascending: true })

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
          }

          query = query.limit(fetchLimit)


          const { data: pois, error: poisError } = await query
          
          
          if (pois && pois.length > 0) {
            if (mode === 'reprocess_triggers_core') {
               // Map core 'id' to 'uuid_id' for consistent pipeline processing
               // @ts-ignore
               pois.forEach(p => p.uuid_id = p.id)
               lastUuidId = pois[pois.length - 1].id
            } else {
               lastUuidId = pois[pois.length - 1].uuid_id
            }
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

          // Pré-batch lookup: 2 queries totais em vez de 2×N. Self-healing
          // side-effect omitido aqui; quando o POI for processado individualmente,
          // executePipeline → claimForProcessing dispara checks atomic novamente.
          const shouldProcessMap = await MigrationService.shouldProcessPOIBatch(
            pois.map((p: { uuid_id: string }) => p.uuid_id)
          )

          // Process POIs from this round one by one
          for (let i = 0; i < pois.length; i++) {
            const poi = pois[i]
            const globalIndex = totalProcessed + 1

            // Check if we should process this POI (cached lookup do batch acima)
            const shouldProcess = shouldProcessMap.get(poi.uuid_id) || { should_process: true }
            
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
})
