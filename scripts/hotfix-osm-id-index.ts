/**
 * Hotfix: Expression indexes on data/local_osm.db so the trigger-points
 * pipeline can find OSM elements by their real @id (which today lives only
 * inside tags_json — see osm-local-data-service.ts for the importer bug).
 *
 * Without these indexes, LocalOSMFetcher.fetchElementById falls back to
 * `tags_json LIKE '%"@id":N%'` and full-scans pois (5M+) + streets (5M+) +
 * buildings (19M+) — observed cost ~100-300s per POI on Step 4.
 *
 * Safe to run on any machine. Idempotent — uses CREATE INDEX IF NOT EXISTS.
 * Does NOT touch row data; the importer is fixed separately for new imports.
 *
 * Usage:
 *   npx tsx scripts/hotfix-osm-id-index.ts                 # default: data/local_osm.db
 *   npx tsx scripts/hotfix-osm-id-index.ts --db /custom/path/local_osm.db
 *   npx tsx scripts/hotfix-osm-id-index.ts --dry-run       # only inspect, no DDL
 *   npx tsx scripts/hotfix-osm-id-index.ts --skip-analyze  # skip ANALYZE at the end
 */

import Database from 'better-sqlite3'
import { existsSync, statSync } from 'fs'
import { join, resolve } from 'path'

interface Options {
  dbPath: string
  dryRun: boolean
  skipAnalyze: boolean
}

function parseArgs(): Options {
  const args = process.argv.slice(2)
  const opts: Options = {
    dbPath: join(process.cwd(), 'data', 'local_osm.db'),
    dryRun: false,
    skipAnalyze: false
  }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--db' && args[i + 1]) {
      opts.dbPath = resolve(args[++i])
    } else if (a === '--dry-run') {
      opts.dryRun = true
    } else if (a === '--skip-analyze') {
      opts.skipAnalyze = true
    } else if (a === '--help' || a === '-h') {
      console.log(`
Usage: npx tsx scripts/hotfix-osm-id-index.ts [options]

Options:
  --db <path>       Path to local_osm.db (default: ./data/local_osm.db)
  --dry-run         Inspect only, do not create indexes
  --skip-analyze    Skip ANALYZE at the end (re-run later as 'ANALYZE;')
  --help, -h        Show this message
`)
      process.exit(0)
    }
  }
  return opts
}

function ms(start: number): string {
  return `${((Date.now() - start) / 1000).toFixed(1)}s`
}

function fmt(n: number): string {
  return n.toLocaleString('en-US')
}

const INDEXES: Array<{ name: string; table: string; estimateMinutes: string }> = [
  { name: 'idx_pois_realosmid',      table: 'pois',      estimateMinutes: '~5 min' },
  { name: 'idx_streets_realosmid',   table: 'streets',   estimateMinutes: '~5 min' },
  { name: 'idx_buildings_realosmid', table: 'buildings', estimateMinutes: '~20-30 min' }
]

function main() {
  const opts = parseArgs()
  const runStart = Date.now()

  console.log('━'.repeat(70))
  console.log('🔧 Hotfix: expression indexes on local_osm.db')
  console.log('━'.repeat(70))
  console.log(`DB:         ${opts.dbPath}`)
  console.log(`Dry-run:    ${opts.dryRun}`)
  console.log(`Started at: ${new Date().toISOString()}`)
  console.log()

  if (!existsSync(opts.dbPath)) {
    console.error(`❌ Database not found at ${opts.dbPath}`)
    console.error(`   Pass --db <path> if your local_osm.db lives elsewhere.`)
    process.exit(1)
  }

  const sizeGb = (statSync(opts.dbPath).size / (1024 ** 3)).toFixed(2)
  console.log(`📦 DB size on disk: ${sizeGb} GB`)

  const db = new Database(opts.dbPath, { readonly: opts.dryRun })

  // Speed up the index build — these PRAGMAs only affect this connection.
  if (!opts.dryRun) {
    db.pragma('journal_mode = WAL')
    db.pragma('temp_store = MEMORY')
    db.pragma('cache_size = -2000000') // 2GB page cache for the build
    db.pragma('mmap_size = 30000000000') // up to 30GB memory-mapped (capped by OS)
  }

  // ── Diagnostic snapshot ──────────────────────────────────────────────
  console.log('\n📊 Pre-flight diagnostics')
  const tables = ['pois', 'streets', 'buildings'] as const
  const rowCounts: Record<string, number> = {}
  for (const t of tables) {
    const t0 = Date.now()
    const row = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }
    rowCounts[t] = row.c
    console.log(`   ${t.padEnd(10)}: ${fmt(row.c).padStart(12)} rows  (${ms(t0)})`)
  }

  // Confirm the bug is present (sample 1 row from pois)
  const sample = db.prepare(`SELECT osm_type, osm_id, substr(tags_json, 1, 80) AS tags_preview FROM pois LIMIT 1`).get() as
    | { osm_type: string; osm_id: string; tags_preview: string }
    | undefined
  if (sample) {
    const looksBroken = sample.osm_type === 'unknown' || /^[a-z0-9]{8,}$/.test(sample.osm_id ?? '')
    console.log(`\n   Sample pois row:`)
    console.log(`     osm_type=${sample.osm_type}   osm_id=${sample.osm_id}`)
    console.log(`     tags_json: ${sample.tags_preview}`)
    if (looksBroken) {
      console.log(`   ⚠️  osm_id/osm_type look broken — this hotfix IS needed.`)
    } else {
      console.log(`   ✅ osm_id/osm_type look valid — this DB may not need the hotfix.`)
    }
  }

  // Existing indexes
  const existing = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%_realosmid'`).all() as Array<{ name: string }>
  if (existing.length > 0) {
    console.log(`\n   Already present:`)
    existing.forEach(r => console.log(`     ✓ ${r.name}`))
  }

  if (opts.dryRun) {
    console.log('\n🟡 Dry-run requested — exiting without changes.')
    db.close()
    return
  }

  // ── Build indexes ────────────────────────────────────────────────────
  console.log('\n🏗️  Creating expression indexes (idempotent)')
  console.log('   Each CREATE INDEX scans its table once. Be patient.\n')

  for (const idx of INDEXES) {
    const alreadyExists = existing.some(e => e.name === idx.name)
    if (alreadyExists) {
      console.log(`   ⏭️  ${idx.name} — already exists, skipping`)
      continue
    }
    const rows = rowCounts[idx.table] ?? 0
    console.log(`   ▸ ${idx.name} on ${idx.table} (${fmt(rows)} rows, est. ${idx.estimateMinutes})...`)
    const t0 = Date.now()
    db.exec(`CREATE INDEX IF NOT EXISTS ${idx.name} ON ${idx.table}(json_extract(tags_json, '$."@id"'))`)
    console.log(`     ✅ done in ${ms(t0)}`)
  }

  // ── ANALYZE ──────────────────────────────────────────────────────────
  if (!opts.skipAnalyze) {
    console.log('\n📈 Running ANALYZE so the query planner picks the new indexes')
    for (const t of tables) {
      const t0 = Date.now()
      db.exec(`ANALYZE ${t}`)
      console.log(`   ▸ ANALYZE ${t} (${ms(t0)})`)
    }
  } else {
    console.log('\n⏭️  Skipping ANALYZE (--skip-analyze). Re-run as plain `ANALYZE;` later.')
  }

  // ── Smoke test ───────────────────────────────────────────────────────
  console.log('\n🔬 Smoke test')
  const testIds = [167008935, 40666277, 1] // way 167008935 = Bartlett Park (if present)
  for (const id of testIds) {
    const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT 1 FROM pois WHERE json_extract(tags_json, '$."@id"') = ? LIMIT 1`).all(id) as Array<{ detail: string }>
    const usesIndex = plan.some(r => /USING INDEX idx_pois_realosmid/i.test(r.detail ?? ''))

    const t0 = Date.now()
    db.prepare(`SELECT id FROM pois WHERE json_extract(tags_json, '$."@id"') = ? LIMIT 1`).get(id)
    const took = Date.now() - t0
    console.log(`   pois @id=${id}: ${took}ms  ${usesIndex ? '(✅ index used)' : '(⚠️  NOT using index — check planner)'}`)
  }

  db.close()

  console.log('\n' + '━'.repeat(70))
  console.log(`✅ Hotfix finished in ${ms(runStart)}`)
  console.log('━'.repeat(70))
  console.log()
  console.log('Next step: run the migration batch and confirm Step 4 (Trigger Points)')
  console.log('  takes seconds per POI instead of minutes.')
  console.log()
  console.log('  npx tsx scripts/migrate-pois-batch.ts --state California --limit 5')
  console.log()
}

try {
  main()
} catch (err) {
  console.error('\n❌ Hotfix failed:', err instanceof Error ? err.message : err)
  console.error('   Re-run is safe — CREATE INDEX IF NOT EXISTS is idempotent.')
  process.exit(1)
}
