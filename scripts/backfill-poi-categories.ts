/**
 * Backfill POI Categories — core.attractions
 *
 * Applies the shared poi-taxonomy `classify` + `importanceScore` over existing
 * rows and writes the canonical category fields:
 *   primary_category, category, categories, category_group, is_notable, importance_score
 *
 * Idempotent + resumable (keyset by id). Safe to re-run. Defaults to a DRY-RUN.
 *
 * ⚠️ Requires the columns from supabase/migrations/20260602_add_poi_category_taxonomy.sql
 *    to exist (run that SQL manually in the panel first) — including in --dry-run, since
 *    it reads/filters category_group. For PRE-DDL validation use
 *    scripts/analyze-category-coverage.ts (it needs none of the new columns).
 *
 * TWO PHASES (--phase, default 1):
 *   Phase 1 (high confidence): writes the category ONLY when the OSM data guarantees
 *     it (matched_by osm_category/flattened/osm_tags_reparse/key_fallback, or a
 *     highway-tagged street). Each row ends marked category_confidence='high'.
 *     Low-confidence rows (name guesses, bare-key defaults, name-only streets,
 *     no-signal) are NOT categorized — just marked category_confidence='pending'.
 *   Phase 2 (review): processes only the 'pending' rows, applying the low-confidence
 *     guess → category_confidence='low' (or 'unmapped' if still nothing).
 *
 * Usage:
 *   # dry-run (no writes) — validate distribution first
 *   npx tsx --env-file=.env scripts/backfill-poi-categories.ts --country all --dry-run
 *   # Phase 1 — small live test, then full (resumable via --resume-after <lastId>)
 *   npx tsx --env-file=.env scripts/backfill-poi-categories.ts --country all --limit 5000
 *   npx tsx --env-file=.env scripts/backfill-poi-categories.ts --country all
 *   # Phase 2 — after Phase 1, classify the deferred rows
 *   npx tsx --env-file=.env scripts/backfill-poi-categories.ts --country all --phase 2
 *   # GENTLE off-peak run (won't overload prod RPCs like cms_search_pois):
 *   npx tsx --env-file=.env scripts/backfill-poi-categories.ts --country all --concurrency 3 --batch-size 500 --throttle-ms 750
 *
 * Flags:
 *   --country <name|all>    default "United States"; "all" = whole DB
 *   --phase <1|2>           default 1 (high-confidence); 2 = low-confidence review
 *   --dry-run               classify + tally only, no writes
 *   --batch-size <n>        rows fetched per page (default 1000; lower for sparse countries)
 *   --concurrency <n>       parallel UPDATEs per batch (default 8; use 2-3 to be gentle on prod)
 *   --throttle-ms <n>       pause between batches (default 0; use 500-1000 for off-peak runs)
 *   --limit <n>             stop after N rows scanned
 *   --resume-after <id>     keyset cursor to continue a prior run
 *   --no-log-file           don't write the .log file
 *
 * NOTE: a heavy concurrency can overload the DB and make prod RPCs 500 (statement
 * timeout). For a live run while the app is in use, prefer --concurrency 3 --throttle-ms 750.
 *
 * No-clobber: skips human-curated rows (source_type manual*) and rows already
 * backfilled (category_group not null). NOTE: `approved` and `import_source` are
 * uniformly set on this dataset and are NOT used as curation signals.
 *
 * Output: backfill-categories-results-<ts>.json (+ .log)
 */

import fs from 'fs'
import path from 'path'
import { getSupabase } from '../lib/core/supabase-client'
import { classify, importanceScore, isNotable, ClassifyInput } from '../lib/shared/poi-taxonomy'

const supabase = getSupabase('service')

const EXCLUDED_STREET_SENTINEL = '_excluded_street'
const CURATED_SOURCE_TYPES = ['manual', 'manual_premium_rescue', 'manual_rescue', 'rescue_mission']

const SELECT_COLS = [
  'id', 'name', 'osm_category', 'osm_tags', 'primary_category', 'category', 'source_type', 'category_group', 'category_confidence',
  'amenity', 'leisure', 'natural_water', 'waterway', 'man_made', 'building',
  'place', 'landuse', 'shop', 'park_type', 'monument_type', 'artwork_type',
  'information', 'type',
  'is_historic', 'is_touristic', 'wikidata', 'wikipedia',
  'heritage_status', 'unesco_status', 'importance_level', 'landmark_level',
].join(', ')

function attachFileLogger(logPath: string): { close: () => Promise<void> } {
  const stream = fs.createWriteStream(logPath, { flags: 'a' })
  const orig = { log: console.log.bind(console), warn: console.warn.bind(console), error: console.error.bind(console) }
  const write = (lvl: string, args: unknown[]) => {
    const line = args.map(a => (typeof a === 'string' ? a : (() => { try { return JSON.stringify(a) } catch { return String(a) } })())).join(' ')
    stream.write(`[${new Date().toISOString()}] [${lvl}] ${line}\n`)
  }
  console.log = (...a: unknown[]) => { write('LOG', a); orig.log(...a) }
  console.warn = (...a: unknown[]) => { write('WARN', a); orig.warn(...a) }
  console.error = (...a: unknown[]) => { write('ERR', a); orig.error(...a) }
  return { close: () => new Promise<void>(res => stream.end(() => res())) }
}

async function runWithConcurrency<T>(items: T[], concurrency: number, task: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length || 1) }, async () => {
    while (true) {
      const idx = cursor++
      if (idx >= items.length) return
      await task(items[idx])
    }
  })
  await Promise.all(workers)
}

interface Opts {
  country: string; dryRun: boolean; batchSize: number; concurrency: number
  limit?: number; resumeAfter?: string; logFile: boolean; phase: 1 | 2; throttleMs: number
}

function parseArgs(): Opts {
  const args = process.argv.slice(2)
  const o: Opts = { country: 'United States', dryRun: false, batchSize: 1000, concurrency: 8, logFile: true, phase: 1, throttleMs: 0 }
  for (let i = 0; i < args.length; i++) {
    const k = args[i]?.replace(/^--/, '')
    if (k === 'dry-run') { o.dryRun = true; continue }
    if (k === 'no-log-file') { o.logFile = false; continue }
    const v = args[++i]
    if (v === undefined) break
    if (k === 'country') o.country = v
    else if (k === 'phase') o.phase = (parseInt(v, 10) === 2 ? 2 : 1)
    else if (k === 'batch-size') o.batchSize = parseInt(v, 10)
    else if (k === 'concurrency') o.concurrency = parseInt(v, 10)
    else if (k === 'limit') o.limit = parseInt(v, 10)
    else if (k === 'resume-after') o.resumeAfter = v
    else if (k === 'throttle-ms') o.throttleMs = parseInt(v, 10)
  }
  return o
}

function inc(m: Map<string, number>, k: string) { m.set(k, (m.get(k) || 0) + 1) }

async function main() {
  const opts = parseArgs()
  const runStamp = Date.now()
  const logPath = opts.logFile ? path.resolve(`backfill-categories-log-${runStamp}.log`) : null
  const logger = logPath ? attachFileLogger(logPath) : null

  console.log(`🚀 Backfill categories — PHASE ${opts.phase} (${opts.phase === 1 ? 'high-confidence OSM' : 'low-confidence review'}) country="${opts.country}" dryRun=${opts.dryRun} batch=${opts.batchSize} conc=${opts.concurrency}`)
  if (opts.resumeAfter) console.log(`   resume-after id > ${opts.resumeAfter}`)

  const byMatched = new Map<string, number>()
  const byGroup = new Map<string, number>()
  let scanned = 0, updated = 0, skippedCurated = 0, skippedDone = 0, deferred = 0, excluded = 0, notable = 0, failed = 0, unmapped = 0
  let cursor = opts.resumeAfter || ''
  let lastId = cursor
  const startedAt = Date.now()

  // Phase 1 scans by id PK (fast) and skips already-processed rows in JS — the
  // `category_confidence IS NULL` filter would make the planner use the all-null
  // index and time out. Phase 2 filters on the SELECTIVE 'pending' value (index helps).
  const fetchPage = async (cur: string) => {
    let q = supabase.schema('core').from('attractions')
      .select(SELECT_COLS)
      .order('id', { ascending: true })
      .limit(opts.batchSize)
    if (opts.phase === 2) q = q.eq('category_confidence', 'pending')
    if (opts.country !== 'all') q = q.eq('country', opts.country)   // --country all => whole DB
    if (cur) q = q.gt('id', cur)
    return q
  }

  while (true) {
    // Self-healing: transient statement_timeouts on the read shouldn't kill a
    // multi-hour run. Retry the page up to 5x with exponential backoff before exiting.
    let data: any[] | null = null
    for (let attempt = 1; attempt <= 5; attempt++) {
      const res = await fetchPage(cursor)
      if (!res.error) { data = res.data as any[]; break }
      if (attempt === 5) { console.error(`❌ fetch error (gave up after 5 tries, lastId=${lastId}): ${res.error.message}`); process.exit(1) }
      const backoff = 2000 * attempt
      console.warn(`⚠️ fetch error (attempt ${attempt}/5): ${res.error.message} — retrying in ${backoff}ms`)
      await new Promise(r => setTimeout(r, backoff))
    }
    if (!data || data.length === 0) break

    const updates: Array<{ id: string; patch: Record<string, any> }> = []

    for (const row of data as any[]) {
      scanned++
      lastId = row.id

      // Phase 1 resume safety: skip rows already processed in a prior run.
      if (opts.phase === 1 && row.category_confidence != null) { skippedDone++; continue }

      // No-clobber: never touch human-curated rows, nor geofence POIs.
      // The app keys critical behavior on category==='geofence' (audio gen,
      // trigger type, synthetic TPs) — leave those rows entirely untouched.
      if (row.category === 'geofence') { skippedCurated++; continue }
      if (row.source_type && CURATED_SOURCE_TYPES.includes(row.source_type)) { skippedCurated++; continue }

      const res = classify(row as ClassifyInput)
      const score = importanceScore(row as ClassifyInput)
      const notableFlag = isNotable(row as ClassifyInput)
      if (notableFlag) notable++
      inc(byMatched, res.matched_by)

      // importance_score / is_notable are independent of category confidence — always set.
      // We deliberately do NOT write the legacy `category` column (app reads it).
      const patch: Record<string, any> = { importance_score: score, is_notable: notableFlag }

      if (opts.phase === 1) {
        // Phase 1: only write the category when OSM GUARANTEES it (high confidence).
        if (res.confidence === 'high') {
          patch.category_confidence = 'high'
          if (res.excluded) { excluded++; patch.primary_category = EXCLUDED_STREET_SENTINEL; patch.category_group = null }
          else if (res.primary_category) { patch.primary_category = res.primary_category; patch.category_group = res.category_group; inc(byGroup, res.category_group!) }
        } else {
          // low confidence (name/guess) — defer to Phase 2, just mark it.
          deferred++
          patch.category_confidence = 'pending'
        }
      } else {
        // Phase 2: the deferred rows. Apply the low-confidence guess now.
        if (res.excluded) { excluded++; patch.primary_category = EXCLUDED_STREET_SENTINEL; patch.category_group = null; patch.category_confidence = 'low' }
        else if (res.primary_category) { patch.primary_category = res.primary_category; patch.category_group = res.category_group; patch.category_confidence = 'low'; inc(byGroup, res.category_group!) }
        else { unmapped++; patch.category_confidence = 'unmapped' }   // truly no signal anywhere
      }

      updates.push({ id: row.id, patch })
    }

    if (!opts.dryRun && updates.length) {
      await runWithConcurrency(updates, opts.concurrency, async (u) => {
        // Retry transient pooler errors ("prepared statement does not exist",
        // "fetch failed") — they almost always succeed on a fresh connection.
        let lastErr: any = null
        for (let attempt = 1; attempt <= 3; attempt++) {
          const { error: upErr } = await supabase.schema('core').from('attractions').update(u.patch).eq('id', u.id)
          if (!upErr) { updated++; return }
          lastErr = upErr
          await new Promise(r => setTimeout(r, 300 * attempt))
        }
        failed++; console.warn(`⚠️ update ${u.id} failed após 3 tentativas: ${lastErr?.message}`)
      })
    } else if (opts.dryRun) {
      updated += updates.length
    }

    cursor = lastId
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0)
    console.log(`… scanned=${scanned} ${opts.dryRun ? 'would-update' : 'updated'}=${updated} deferred=${deferred} excluded=${excluded} unmapped=${unmapped} done=${skippedDone} curated=${skippedCurated} fail=${failed} (lastId=${lastId}, ${elapsed}s)`)

    if (opts.limit && scanned >= opts.limit) break
    if (data.length < opts.batchSize) break
    // Throttle between batches to keep production RPCs (e.g. cms_search_pois) healthy
    // during a long live run. Use e.g. --throttle-ms 750 for an off-peak gentle run.
    if (opts.throttleMs > 0) await new Promise(r => setTimeout(r, opts.throttleMs))
  }

  const sortDesc = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])
  console.log('\n' + '='.repeat(60))
  console.log(`📊 Backfill summary — PHASE ${opts.phase} (${opts.dryRun ? 'DRY-RUN' : 'LIVE'})`)
  console.log('='.repeat(60))
  console.log(`Scanned:                 ${scanned}`)
  console.log(`${opts.dryRun ? 'Would update' : 'Updated'}:            ${updated}`)
  if (opts.phase === 1) console.log(`Deferred → Phase 2:      ${deferred}  (marked 'pending')`)
  if (opts.phase === 2) console.log(`Still unmapped:          ${unmapped}`)
  console.log(`Excluded streets:        ${excluded}`)
  console.log(`Notable (≥30):           ${notable}`)
  console.log(`Skipped curated/geofence:${skippedCurated}`)
  console.log(`Failed updates:          ${failed}`)
  console.log(`Last id processed:       ${lastId}`)
  if (opts.phase === 1) console.log(`\n➡️  Next: run Phase 2 over the deferred rows:\n    npx tsx --env-file=.env scripts/backfill-poi-categories.ts --country ${opts.country === 'all' ? 'all' : `"${opts.country}"`} --phase 2`)
  console.log('\nmatched_by:')
  for (const [k, v] of sortDesc(byMatched)) console.log(`  ${String(v).padStart(8)}  ${k}`)
  console.log('\ncategory_group (written this phase):')
  for (const [k, v] of sortDesc(byGroup)) console.log(`  ${String(v).padStart(8)}  ${k}`)
  console.log('='.repeat(60))

  const resultsFile = path.resolve(`backfill-categories-results-p${opts.phase}-${runStamp}.json`)
  await (await import('fs/promises')).writeFile(resultsFile, JSON.stringify({
    timestamp: new Date().toISOString(), options: opts,
    scanned, updated, deferred, excluded, unmapped, notable, skippedCurated, failed, lastId,
    matched_by: Object.fromEntries(byMatched), category_group: Object.fromEntries(byGroup),
  }, null, 2))
  console.log(`💾 Results: ${resultsFile}`)
  if (logPath) console.log(`📝 Log: ${logPath}`)
  if (logger) await logger.close()
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
