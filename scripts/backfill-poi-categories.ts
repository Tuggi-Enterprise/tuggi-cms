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
 * Usage:
 *   # dry-run (no writes) — validate distribution first
 *   npx tsx --env-file=.env scripts/backfill-poi-categories.ts --country "United States" --dry-run
 *   # small live test
 *   npx tsx --env-file=.env scripts/backfill-poi-categories.ts --country "United States" --limit 5000
 *   # full run (resumable: pass --resume-after <lastId> to continue)
 *   npx tsx --env-file=.env scripts/backfill-poi-categories.ts --country "United States"
 *
 * Flags:
 *   --country <name>        default "United States"
 *   --dry-run               classify + tally only, no writes
 *   --batch-size <n>        rows fetched per page (default 1000)
 *   --concurrency <n>       parallel UPDATEs per batch (default 8)
 *   --limit <n>             stop after N rows scanned
 *   --resume-after <id>     keyset cursor to continue a prior run
 *   --no-log-file           don't write the .log file
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
  'id', 'name', 'osm_category', 'osm_tags', 'primary_category', 'category', 'source_type', 'category_group',
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
  limit?: number; resumeAfter?: string; logFile: boolean
}

function parseArgs(): Opts {
  const args = process.argv.slice(2)
  const o: Opts = { country: 'United States', dryRun: false, batchSize: 1000, concurrency: 8, logFile: true }
  for (let i = 0; i < args.length; i++) {
    const k = args[i]?.replace(/^--/, '')
    if (k === 'dry-run') { o.dryRun = true; continue }
    if (k === 'no-log-file') { o.logFile = false; continue }
    const v = args[++i]
    if (v === undefined) break
    if (k === 'country') o.country = v
    else if (k === 'batch-size') o.batchSize = parseInt(v, 10)
    else if (k === 'concurrency') o.concurrency = parseInt(v, 10)
    else if (k === 'limit') o.limit = parseInt(v, 10)
    else if (k === 'resume-after') o.resumeAfter = v
  }
  return o
}

function inc(m: Map<string, number>, k: string) { m.set(k, (m.get(k) || 0) + 1) }

async function main() {
  const opts = parseArgs()
  const runStamp = Date.now()
  const logPath = opts.logFile ? path.resolve(`backfill-categories-log-${runStamp}.log`) : null
  const logger = logPath ? attachFileLogger(logPath) : null

  console.log(`🚀 Backfill categories — country="${opts.country}" dryRun=${opts.dryRun} batch=${opts.batchSize} conc=${opts.concurrency}`)
  if (opts.resumeAfter) console.log(`   resume-after id > ${opts.resumeAfter}`)

  const byMatched = new Map<string, number>()
  const byGroup = new Map<string, number>()
  let scanned = 0, updated = 0, skippedCurated = 0, skippedDone = 0, excluded = 0, notable = 0, failed = 0
  let cursor = opts.resumeAfter || ''
  let lastId = cursor
  const startedAt = Date.now()

  while (true) {
    let q = supabase.schema('core').from('attractions')
      .select(SELECT_COLS)
      .eq('country', opts.country)
      .is('category_group', null)            // idempotency/resume: skip already-backfilled
      .order('id', { ascending: true })
      .limit(opts.batchSize)
    if (cursor) q = q.gt('id', cursor)

    const { data, error } = await q
    if (error) { console.error('❌ fetch error:', error.message); process.exit(1) }
    if (!data || data.length === 0) break

    const updates: Array<{ id: string; patch: Record<string, any> }> = []

    for (const row of data as any[]) {
      scanned++
      lastId = row.id

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
      if (res.category_group) inc(byGroup, res.category_group)

      const patch: Record<string, any> = { importance_score: score, is_notable: notableFlag }

      // NOTE: we deliberately do NOT write the legacy `category` column — the app
      // reads it and keys business rules on specific values (e.g. 'geofence').
      // New taxonomy lives only in primary_category / category_group.
      if (res.excluded) {
        excluded++
        patch.primary_category = EXCLUDED_STREET_SENTINEL
        patch.category_group = null
      } else if (res.primary_category) {
        patch.primary_category = res.primary_category
        patch.category_group = res.category_group
      } else {
        // unmapped: leave primary_category/categories as they are; record score only.
        // category_group stays null so a future improved run reprocesses this row.
      }

      updates.push({ id: row.id, patch })
    }

    if (!opts.dryRun && updates.length) {
      await runWithConcurrency(updates, opts.concurrency, async (u) => {
        const { error: upErr } = await supabase.schema('core').from('attractions').update(u.patch).eq('id', u.id)
        if (upErr) { failed++; console.warn(`⚠️ update ${u.id} failed: ${upErr.message}`) }
        else updated++
      })
    } else if (opts.dryRun) {
      updated += updates.length
    }

    cursor = lastId
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0)
    console.log(`… scanned=${scanned} ${opts.dryRun ? 'would-update' : 'updated'}=${updated} excluded=${excluded} curated=${skippedCurated} fail=${failed} (lastId=${lastId}, ${elapsed}s)`)

    if (opts.limit && scanned >= opts.limit) break
    if (data.length < opts.batchSize) break
  }

  const sortDesc = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])
  console.log('\n' + '='.repeat(60))
  console.log(`📊 Backfill summary (${opts.dryRun ? 'DRY-RUN' : 'LIVE'})`)
  console.log('='.repeat(60))
  console.log(`Scanned:            ${scanned}`)
  console.log(`${opts.dryRun ? 'Would update' : 'Updated'}:       ${updated}`)
  console.log(`Excluded streets:   ${excluded}`)
  console.log(`Notable (≥30):      ${notable}`)
  console.log(`Skipped curated:    ${skippedCurated}`)
  console.log(`Failed updates:     ${failed}`)
  console.log(`Last id processed:  ${lastId}`)
  console.log('\nmatched_by:')
  for (const [k, v] of sortDesc(byMatched)) console.log(`  ${String(v).padStart(8)}  ${k}`)
  console.log('\ncategory_group:')
  for (const [k, v] of sortDesc(byGroup)) console.log(`  ${String(v).padStart(8)}  ${k}`)
  console.log('='.repeat(60))

  const resultsFile = path.resolve(`backfill-categories-results-${runStamp}.json`)
  await (await import('fs/promises')).writeFile(resultsFile, JSON.stringify({
    timestamp: new Date().toISOString(), options: opts,
    scanned, updated, excluded, notable, skippedCurated, skippedDone, failed, lastId,
    matched_by: Object.fromEntries(byMatched), category_group: Object.fromEntries(byGroup),
  }, null, 2))
  console.log(`💾 Results: ${resultsFile}`)
  if (logPath) console.log(`📝 Log: ${logPath}`)
  if (logger) await logger.close()
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
