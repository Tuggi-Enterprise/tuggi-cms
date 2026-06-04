/**
 * Batch Migration Script - Migrate POIs from homolog to core
 *
 * Usage:
 *   npx tsx scripts/migrate-pois-batch.ts --country "Brazil" --state "São Paulo" --city "São Paulo" --batch-size 25
 *
 * Concurrency:
 *   --concurrency 10           Process 10 POIs at a time (default: 1, preserves legacy behavior)
 *   --quiet true               One line per POI instead of full step breakdown (auto-on if concurrency > 1)
 *   --legacy-sleep true        Re-enable the legacy 1s sleep between POIs (only meaningful at concurrency=1)
 *   --no-shuffle true          Disable random batch order (default: shuffle on, reduces cross-process collisions)
 *   --debug-quality true       Emit one [TP_DEBUG_QUALITY] JSON line per POI (Phase 0 of TP quality plan).
 *                              Pure observation, no behavior change. Lines appear in migration-log-<ts>.log.
 *                              Extract them with: grep TP_DEBUG_QUALITY <log>
 *   --from-core true           Reprocess TPs on existing core.attractions instead of migrating homolog.pois.
 *                              Forces mode=reprocess_triggers_core. Uses the same country/state/city/category
 *                              filters but reads from core.attractions. Skips enrichment + migration; runs
 *                              ONLY Step 4 (TP generation). TP saves are atomic replace_all — idempotent.
 *                              Intended for Phase 0 data harvesting on already-migrated POIs.
 *   --quality-fix-fan-cap false  Kill-switch for Phase 2.A. The fan-cap (reject candidate TPs farther than
 *                              the fan's reach in their bearing × 1.1) is ON by default since 2026-05-29.
 *                              Pass `false` to fall back to the legacy "fan-mode skips distance cap" behavior
 *                              (for A/B against future quality changes).
 *
 * Output:
 *   migration-results-<ts>.json  Stats + per-step timings (machine-readable)
 *   migration-log-<ts>.log       Full stdout/stderr capture (--no-log-file to disable)
 */

import os from 'os'
import fs from 'fs'
import path from 'path'
import { MigrationService } from '../lib/services/migration-service'
import { PoiMigrationPipeline, PipelineOptions } from '../lib/services/poi-migration-pipeline'
import { getSupabase } from '../lib/core/supabase-client'

const supabase = getSupabase('service')

/**
 * Tee stdout/stderr to a log file. Wraps console.log/warn/error so every line
 * also goes to disk with an ISO timestamp prefix. Returns the file path and a
 * close fn that flushes the stream.
 */
function attachFileLogger(logPath: string): { close: () => Promise<void> } {
  const stream = fs.createWriteStream(logPath, { flags: 'a' })
  const origLog = console.log.bind(console)
  const origWarn = console.warn.bind(console)
  const origError = console.error.bind(console)

  const write = (level: string, args: unknown[]) => {
    const line = args
      .map(a => (typeof a === 'string' ? a : (() => { try { return JSON.stringify(a) } catch { return String(a) } })()))
      .join(' ')
    stream.write(`[${new Date().toISOString()}] [${level}] ${line}\n`)
  }

  console.log = (...args: unknown[]) => { write('LOG', args); origLog(...args) }
  console.warn = (...args: unknown[]) => { write('WARN', args); origWarn(...args) }
  console.error = (...args: unknown[]) => { write('ERR', args); origError(...args) }

  return {
    close: () =>
      new Promise<void>(resolve => {
        stream.end(() => resolve())
      })
  }
}

interface ScriptOptions {
  country?: string
  state?: string
  city?: string
  processing_status?: string
  approved?: boolean
  category?: string
  batch_size?: number
  mode?: 'enrichment_migration_triggers' | 'migration_only' | 'migration_description' | 'migration_description_audio' | 'full'
  auto_generate_audio?: boolean
  auto_approve_if_satisfactory?: boolean
  skip_if_exists?: boolean
  update_if_exists?: boolean
  limit?: number
  concurrency?: number
  quiet?: boolean
  legacy_sleep?: boolean
  log_file?: boolean
  shuffle?: boolean
  debug_quality?: boolean
  from_core?: boolean
  quality_fix_fan_cap?: boolean
}

/**
 * Fisher–Yates shuffle in place. Used so that multiple migrator processes
 * running the same query don't all attack POI #1 first and collide on the
 * `claimForProcessing` lock. Each process gets a different order; collisions
 * drop to near zero on the head of the batch.
 */
function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const idx = cursor++
      if (idx >= items.length) return
      results[idx] = await task(items[idx], idx)
    }
  })

  await Promise.all(workers)
  return results
}

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2)
  const options: ScriptOptions = {}

  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace('--', '')
    const value = args[i + 1]

    if (key && value) {
      switch (key) {
        case 'country':
          options.country = value
          break
        case 'state':
          options.state = value
          break
        case 'city':
          options.city = value
          break
        case 'processing-status':
          options.processing_status = value
          break
        case 'approved':
          options.approved = value === 'true'
          break
        case 'category':
          options.category = value
          break
        case 'batch-size':
          options.batch_size = parseInt(value, 10)
          break
        case 'mode':
          options.mode = value as any
          break
        case 'auto-generate-audio':
          options.auto_generate_audio = value === 'true'
          break
        case 'auto-approve':
          options.auto_approve_if_satisfactory = value === 'true'
          break
        case 'skip-if-exists':
          options.skip_if_exists = value === 'true'
          break
        case 'update-if-exists':
          options.update_if_exists = value === 'true'
          break
        case 'limit':
          options.limit = parseInt(value, 10)
          break
        case 'concurrency':
          options.concurrency = parseInt(value, 10)
          break
        case 'quiet':
          options.quiet = value === 'true'
          break
        case 'legacy-sleep':
          options.legacy_sleep = value === 'true'
          break
        case 'log-file':
        case 'no-log-file':
          options.log_file = key === 'log-file' ? value !== 'false' : false
          break
        case 'shuffle':
        case 'no-shuffle':
          options.shuffle = key === 'shuffle' ? value !== 'false' : false
          break
        case 'debug-quality':
          options.debug_quality = value === 'true'
          break
        case 'from-core':
          options.from_core = value === 'true'
          break
        case 'quality-fix-fan-cap':
          options.quality_fix_fan_cap = value === 'true'
          break
      }
    }
  }

  // Default values
  const batchSize = options.batch_size || 25
  const mode = options.mode || 'enrichment_migration_triggers'
  const autoGenerateAudio = options.auto_generate_audio ?? false
  const autoApprove = options.auto_approve_if_satisfactory ?? true
  const skipIfExists = options.skip_if_exists ?? true
  const updateIfExists = options.update_if_exists ?? false
  // Concurrency: default 1 (current behavior). Caller opts into parallelism explicitly.
  const concurrency = Math.max(1, options.concurrency ?? 1)
  const quiet = options.quiet ?? (concurrency > 1)
  const legacySleep = options.legacy_sleep ?? false
  const useLogFile = options.log_file ?? true
  // Shuffle: on by default so multiple migrator processes hitting the same
  // query don't all collide on the first POIs. Disable for reproducible runs.
  const shuffle = options.shuffle ?? true
  // Phase 0 of TP quality plan. Off by default. Opt in with --debug-quality true.
  const debugQuality = options.debug_quality ?? false
  // Read from core.attractions instead of homolog.pois. Forces reprocess_triggers_core mode.
  // Used to harvest Phase 0 data on already-migrated POIs without resetting status.
  const fromCore = options.from_core ?? false
  // Override mode if reprocessing from core. The pipeline's reprocess_triggers_core
  // mode treats uuid_id as attraction_id directly and skips Enrichment/Migration.
  const effectiveMode = fromCore ? 'reprocess_triggers_core' : mode
  // Phase 2.A — cap candidate TPs by visibility fan reach in their bearing.
  const qualityFixFanCap = options.quality_fix_fan_cap ?? false

  const runStartedAt = new Date()
  const runStamp = runStartedAt.getTime()
  const logPath = useLogFile ? path.resolve(`migration-log-${runStamp}.log`) : null
  const logger = logPath ? attachFileLogger(logPath) : null
  if (logPath) {
    console.log(`📝 Logging to: ${logPath}`)
  }

  console.log(`🚀 Starting batch migration at ${runStartedAt.toISOString()}`)
  console.log('Options:', {
    country: options.country || 'all',
    state: options.state || 'all',
    city: options.city || 'all',
    processing_status: options.processing_status || 'pending',
    batch_size: batchSize,
    mode,
    auto_generate_audio: autoGenerateAudio,
    auto_approve: autoApprove,
    concurrency,
    quiet,
    legacy_sleep: legacySleep,
    shuffle,
    debug_quality: debugQuality,
    from_core: fromCore,
    effective_mode: effectiveMode,
    quality_fix_fan_cap: qualityFixFanCap
  })

  if (options.processing_status === 'all') {
    console.log('ℹ️ Including all processing statuses')
  }

  // Build base query function for pagination.
  // Two sources depending on --from-core:
  //   - homolog.pois (default): POIs awaiting migration; pipeline runs full enrichment + migration + Step 4.
  //   - core.attractions (--from-core true): already-migrated POIs; pipeline runs ONLY Step 4 via
  //     reprocess_triggers_core mode. uuid_id field maps to attractions.id. No processing_status filter
  //     (column lives in homolog).
  const buildQuery = () => {
    if (fromCore) {
      // Reshape the core row to expose `uuid_id` (alias for `id`) so the rest of the script is unchanged.
      let query = supabase
        .schema('core')
        .from('attractions')
        .select('uuid_id:id, name, city, state, country, approved, category')

      if (options.country && options.country !== 'all') query = query.eq('country', options.country)
      if (options.state && options.state !== 'all') query = query.eq('state', options.state)
      if (options.city && options.city !== 'all') query = query.eq('city', options.city)
      if (options.approved !== undefined) query = query.eq('approved', options.approved)
      if (options.category && options.category !== 'all') query = query.eq('category', options.category)

      return query
    }

    let query = supabase
      .schema('homolog')
      .from('pois')
      .select('uuid_id, name, city, state, country, processing_status, approved, category')

    if (options.country && options.country !== 'all') query = query.eq('country', options.country)
    if (options.state && options.state !== 'all') query = query.eq('state', options.state)
    if (options.city && options.city !== 'all') query = query.eq('city', options.city)

    if (options.processing_status !== 'all') {
      if (options.processing_status) {
        query = query.eq('processing_status', options.processing_status)
      } else {
        // Default: only pending or processing
        query = query.in('processing_status', ['pending', 'processing'])
      }
    }

    if (options.approved !== undefined) query = query.eq('approved', options.approved)
    if (options.category && options.category !== 'all') query = query.eq('category', options.category)

    return query
  }

  const targetLimit = options.limit || batchSize
  let allPois: any[] = []
  let hasMore = true
  let cursor: string | null = null // keyset: último uuid_id visto
  const fetchSize = 1000 // Stay safely under Supabase 2000-row limit per request

  console.log(`📥 Fetching up to ${targetLimit} POIs via keyset pagination...`)

  while (hasMore) {
    // Keyset em vez de OFFSET: evita re-escanear a tabela inteira a cada página
    // (homolog.pois era o #1 reader de disk I/O) e não pula linhas quando o
    // processing_status muda durante a migração.
    let query = buildQuery().order('uuid_id', { ascending: true }).limit(fetchSize)
    if (cursor) query = query.gt('uuid_id', cursor)

    const { data: poisChunk, error: poisError } = await query

    if (poisError) {
      console.error('❌ Error fetching POIs:', poisError)
      process.exit(1)
    }

    if (!poisChunk || poisChunk.length === 0) {
      hasMore = false
    } else {
      allPois = allPois.concat(poisChunk)
      cursor = poisChunk[poisChunk.length - 1].uuid_id // avança o cursor

      console.log(`   Fetched ${allPois.length} POIs so far...`)

      if (poisChunk.length < fetchSize) {
        hasMore = false // última página (chunk parcial)
      }
      if (allPois.length >= targetLimit) {
        allPois = allPois.slice(0, targetLimit)
        hasMore = false
      }
    }
  }

  if (shuffle && allPois.length > 1) {
    shuffleInPlace(allPois)
    console.log(`🔀 Shuffled batch order (reduces collision with other workers/processes)`)
  }

  const pois = allPois

  if (!pois || pois.length === 0) {
    console.log('ℹ️ No POIs found matching filters')
    process.exit(0)
  }

  console.log(`📊 Found ${pois.length} POIs to migrate`)

  // Statistics
  const stats = {
    total: pois.length,
    successful: 0,
    failed: 0,
    skipped: 0,
    errors: [] as Array<{ uuid_id: string; name: string; error: string }>,
    per_poi_timings: [] as Array<{
      uuid_id: string
      name: string
      city: string | null
      state: string | null
      success: boolean
      skipped: boolean
      total_ms: number
      steps: Array<{ step: string; ms: number; success: boolean }>
    }>
  }

  // Process each POI
  const pipelineOptions: PipelineOptions = {
    auto_generate_audio: autoGenerateAudio,
    auto_approve_if_satisfactory: autoApprove,
    skip_if_exists: skipIfExists,
    update_if_exists: updateIfExists,
    mode: effectiveMode as PipelineOptions['mode'],
    debug_quality: debugQuality,
    quality_fix_fan_cap: qualityFixFanCap
  }

  const startedAt = Date.now()
  // Sequential number ONLY for POIs that actually ran through the pipeline.
  // Skipped POIs (claimed by another worker / already in core) do not consume
  // a slot — they appear without a [N] prefix.
  let processedSeq = 0

  await runWithConcurrency(pois, concurrency, async (poi) => {
    const lines: string[] = []
    const push = (line: string) => lines.push(line)

    const poiStartedAt = Date.now()
    let poiTotalMs = 0
    let poiSuccess = false
    let poiSkipped = false
    let poiSteps: Array<{ step: string; ms: number; success: boolean }> = []

    try {
      const result = await PoiMigrationPipeline.executePipeline(poi.uuid_id, pipelineOptions)
      poiTotalMs = result.total_time ?? (Date.now() - poiStartedAt)
      poiSuccess = result.success
      poiSkipped = result.skipped ?? false
      poiSteps = (result.steps || []).map(s => ({
        step: s.step,
        ms: s.processing_time,
        success: s.success
      }))

      if (result.skipped) {
        // POI was claimed by another worker, already migrated, or otherwise not
        // processed by us — does NOT consume a sequential slot.
        stats.skipped++
        const reason = result.warnings?.[0] ?? result.error ?? 'already processed'
        push(`⏭️  Skipped: ${poi.name} — ${reason}`)
      } else if (result.success) {
        // Assign the next sequential number only now, after we know this is a
        // real run-through. Atomic across async workers because ++ runs on a
        // single JS event-loop tick.
        const num = ++processedSeq
        stats.successful++
        push(`✅ [${num}] ${poi.name} (${poi.city ?? '?'}, ${poi.state ?? '?'}) — ${(poiTotalMs / 1000).toFixed(1)}s`)
        result.steps.forEach(step => {
          const status = step.success ? '✅' : '❌'
          push(`   ${status} ${step.step}: ${step.processing_time}ms`)
          if (step.error) {
            push(`      Error: ${step.error}`)
          }
        })
      } else {
        const num = ++processedSeq
        stats.failed++
        stats.errors.push({
          uuid_id: poi.uuid_id,
          name: poi.name,
          error: result.error || 'Unknown error'
        })
        push(`❌ [${num}] Failed: ${poi.name} — ${(poiTotalMs / 1000).toFixed(1)}s — ${result.error}`)
      }
    } catch (error) {
      poiTotalMs = Date.now() - poiStartedAt
      const num = ++processedSeq
      stats.failed++
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      stats.errors.push({
        uuid_id: poi.uuid_id,
        name: poi.name,
        error: errorMsg
      })
      push(`❌ [${num}] Error: ${poi.name} — ${(poiTotalMs / 1000).toFixed(1)}s — ${errorMsg}`)
    }

    stats.per_poi_timings.push({
      uuid_id: poi.uuid_id,
      name: poi.name,
      city: poi.city ?? null,
      state: poi.state ?? null,
      success: poiSuccess,
      skipped: poiSkipped,
      total_ms: poiTotalMs,
      steps: poiSteps
    })

    if (quiet) {
      // One concise line per POI; full step breakdown stays in migration-results JSON.
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
      const poiSec = (poiTotalMs / 1000).toFixed(1)
      if (poiSkipped) {
        console.log(`⏭️  ${stats.successful}✓ ${stats.failed}✗ ${stats.skipped}⏭ — ${poi.name}: skipped (wall ${elapsed}s)`)
      } else {
        console.log(`[${processedSeq}] ${stats.successful}✓ ${stats.failed}✗ ${stats.skipped}⏭ — ${poi.name}: ${poiSec}s (wall ${elapsed}s)`)
      }
    } else {
      // Concurrent runs interleave; flush this POI's lines together to keep them grouped.
      console.log('\n' + lines.join('\n'))
    }

    // Legacy 1s sleep between POIs — preserved behind --legacy-sleep for one release as a safety net.
    if (legacySleep && concurrency === 1 && i < pois.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  })

  // Print summary
  const runFinishedAt = new Date()
  const totalMs = runFinishedAt.getTime() - runStartedAt.getTime()
  const totalSec = totalMs / 1000
  const mins = Math.floor(totalSec / 60)
  const secs = (totalSec - mins * 60).toFixed(1)
  const elapsedHuman = mins > 0 ? `${mins}m${secs}s` : `${secs}s`
  const realRuns = stats.successful + stats.failed
  const avgPerProcessed = realRuns > 0 ? (totalSec / realRuns).toFixed(2) : '0'

  // Per-POI timing breakdown — skipped POIs are excluded because they don't
  // represent real processing cost (0.3-0.5s lock-check round trip).
  const processedTimings = stats.per_poi_timings.filter(t => !t.skipped)
  const sortedTimings = [...processedTimings].sort((a, b) => b.total_ms - a.total_ms)
  const medianMs = sortedTimings.length > 0
    ? sortedTimings[Math.floor(sortedTimings.length / 2)].total_ms
    : 0
  const slowest = sortedTimings.slice(0, Math.min(5, sortedTimings.length))
  const fastest = sortedTimings.length > 0
    ? sortedTimings[sortedTimings.length - 1]
    : null

  console.log('\n' + '='.repeat(60))
  console.log('📊 Migration Summary')
  console.log('='.repeat(60))
  console.log(`Total POIs fetched: ${stats.total}`)
  console.log(`✅ Processed:  ${stats.successful}`)
  console.log(`❌ Failed:     ${stats.failed}`)
  console.log(`⏭️  Skipped:   ${stats.skipped}  (claimed by another worker / already in core)`)
  console.log(`⏱️  Total time: ${elapsedHuman} (${avgPerProcessed}s/processed POI, concurrency=${concurrency})`)
  if (sortedTimings.length > 0) {
    console.log(`   Per-processed: median=${(medianMs / 1000).toFixed(1)}s` +
      (fastest ? `, fastest=${(fastest.total_ms / 1000).toFixed(1)}s` : ''))
    console.log(`   🐢 Slowest:`)
    slowest.forEach((t, idx) => {
      console.log(`      ${idx + 1}. ${(t.total_ms / 1000).toFixed(1)}s — ${t.name} (${t.city ?? '?'}, ${t.state ?? '?'})`)
    })
  }
  console.log(`   Started:  ${runStartedAt.toISOString()}`)
  console.log(`   Finished: ${runFinishedAt.toISOString()}`)
  console.log('='.repeat(60))

  if (stats.errors.length > 0) {
    console.log('\n❌ Errors:')
    stats.errors.forEach((err, idx) => {
      console.log(`${idx + 1}. ${err.name} (${err.uuid_id}): ${err.error}`)
    })
  }

  // Save results to file (paired with log file via runStamp)
  const resultsFile = path.resolve(`migration-results-${runStamp}.json`)
  const fsp = await import('fs/promises')
  await fsp.writeFile(
    resultsFile,
    JSON.stringify({
      timestamp: new Date().toISOString(),
      started_at: runStartedAt.toISOString(),
      finished_at: runFinishedAt.toISOString(),
      total_ms: totalMs,
      total_seconds: totalSec,
      // Wall-clock seconds per POI fetched (includes skipped). Useful for
      // overall throughput planning.
      avg_seconds_per_poi: stats.total > 0 ? totalSec / stats.total : 0,
      // Wall-clock seconds per POI that actually went through the pipeline
      // (successful + failed). Skipped POIs (claimed by another worker /
      // already in core) are excluded because they don't reflect real cost.
      avg_seconds_per_processed_poi: realRuns > 0 ? totalSec / realRuns : 0,
      processed_count: realRuns,
      concurrency,
      log_file: logPath,
      options,
      stats,
      errors: stats.errors
    }, null, 2)
  )

  console.log(`\n💾 Results saved to: ${resultsFile}`)
  if (logPath) console.log(`📝 Full log: ${logPath}`)

  // Refresh dashboards in parallel — they write to disjoint materialized views.
  // If Postgres has internal lock contention it will serialize; worst case is a wash.
  if (stats.successful > 0) {
    console.log('\n📊 Refreshing dashboards (parallel)...')

    const refreshes: Array<{ label: string; promise: Promise<{ error: any | null }> }> = [
      { label: 'Migration metrics', promise: supabase.schema('core').rpc('refresh_migration_metrics') },
      { label: 'Geographic stats', promise: supabase.schema('core').rpc('refresh_geographic_stats') },
      { label: 'User analytics', promise: supabase.schema('drive').rpc('refresh_user_stats') },
      { label: 'Inventory rankings', promise: supabase.schema('core').rpc('refresh_inventory_rankings') }
    ]

    const results = await Promise.allSettled(refreshes.map(r => r.promise))

    results.forEach((res, idx) => {
      const label = refreshes[idx].label
      if (res.status === 'rejected') {
        console.warn(`⚠️  Failed to refresh ${label}:`, res.reason?.message || res.reason)
      } else if (res.value?.error) {
        console.warn(`⚠️  Failed to refresh ${label}:`, res.value.error.message)
      } else {
        console.log(`✅ ${label} refreshed successfully`)
      }
    })
  }

  if (logger) await logger.close()
}


// Run script
main().catch(async (error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})


