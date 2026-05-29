/**
 * Hotfix: R-tree spatial indexes on data/local_osm.db so bbox queries from
 * LocalOSMFetcher run in O(log N) instead of full-scanning the b-tree index.
 *
 * Why this exists:
 *   The legacy index `idx_buildings_bbox (min_lat, max_lat, min_lng, max_lng)`
 *   can only use its leading column as a true range index — SQLite scans every
 *   matching row from there and filters the other 3 columns linearly. On a 19M
 *   `buildings` table a single 150m bbox query takes ~15 s and 100% of POIs
 *   pay it three times during Trigger Point generation.
 *
 * What it does:
 *   Creates `pois_rtree`, `streets_rtree`, `buildings_rtree` as SQLite RTREE
 *   virtual tables keyed on `rowid` and the same min/max lat/lng columns the
 *   source tables already store. `LocalOSMFetcher.queryStreets/queryBuildings`
 *   detects them at startup and joins through them; falls back transparently
 *   to the b-tree path on machines that haven't applied the hotfix yet.
 *
 * Safe to run on any machine. Idempotent — if a virtual table already has the
 * same row count as its source, it is skipped. Partial state (a previous run
 * that was interrupted mid-INSERT) is detected and rebuilt.
 *
 * Usage:
 *   npx tsx scripts/hotfix-osm-rtree-index.ts                 # default DB
 *   npx tsx scripts/hotfix-osm-rtree-index.ts --db /path.db
 *   npx tsx scripts/hotfix-osm-rtree-index.ts --dry-run       # inspect only
 *   npx tsx scripts/hotfix-osm-rtree-index.ts --only buildings  # one table
 */

import Database from 'better-sqlite3'
import { existsSync, statSync } from 'fs'
import { join, resolve } from 'path'

type TableName = 'pois' | 'streets' | 'buildings'

interface Options {
  dbPath: string
  dryRun: boolean
  only?: TableName
}

function parseArgs(): Options {
  const args = process.argv.slice(2)
  const opts: Options = {
    dbPath: join(process.cwd(), 'data', 'local_osm.db'),
    dryRun: false
  }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--db' && args[i + 1]) {
      opts.dbPath = resolve(args[++i])
    } else if (a === '--dry-run') {
      opts.dryRun = true
    } else if (a === '--only' && args[i + 1]) {
      const t = args[++i] as TableName
      if (t !== 'pois' && t !== 'streets' && t !== 'buildings') {
        console.error(`❌ --only must be one of: pois, streets, buildings`)
        process.exit(1)
      }
      opts.only = t
    } else if (a === '--help' || a === '-h') {
      console.log(`
Usage: npx tsx scripts/hotfix-osm-rtree-index.ts [options]

Options:
  --db <path>      Path to local_osm.db (default: ./data/local_osm.db)
  --dry-run        Inspect only, do not create or populate indexes
  --only <table>   Build only one of: pois, streets, buildings
  --help, -h       Show this message
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

const TABLES: Array<{ name: TableName; rtree: string; estimate: string }> = [
  { name: 'pois',      rtree: 'pois_rtree',      estimate: '~5-10 min' },
  { name: 'streets',   rtree: 'streets_rtree',   estimate: '~5-10 min' },
  { name: 'buildings', rtree: 'buildings_rtree', estimate: '~15-30 min' }
]

function main() {
  const opts = parseArgs()
  const runStart = Date.now()

  console.log('━'.repeat(70))
  console.log('🗺️  Hotfix: R-tree spatial indexes on local_osm.db')
  console.log('━'.repeat(70))
  console.log(`DB:         ${opts.dbPath}`)
  console.log(`Dry-run:    ${opts.dryRun}`)
  if (opts.only) console.log(`Only:       ${opts.only}`)
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

  // Confirm R-tree is available before we promise anything.
  // Skipped in dry-run because the probe needs write access; in dry-run we
  // assume the module is compiled in (it is, on every supported better-sqlite3).
  if (!opts.dryRun) {
    try {
      db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS __rtree_probe USING rtree(id, x1, x2, y1, y2)`)
      db.exec(`DROP TABLE IF EXISTS __rtree_probe`)
    } catch (err) {
      console.error(`❌ R-tree module not available in this SQLite build:`, err instanceof Error ? err.message : err)
      console.error(`   better-sqlite3 ships with R-tree enabled; if you see this on an unusual build,`)
      console.error(`   reinstall better-sqlite3 (npm rebuild better-sqlite3).`)
      process.exit(1)
    }
  }

  if (!opts.dryRun) {
    db.pragma('journal_mode = WAL')
    db.pragma('temp_store = MEMORY')
    db.pragma('cache_size = -2000000') // 2GB page cache
    db.pragma('mmap_size = 30000000000')
  }

  const targets = opts.only
    ? TABLES.filter(t => t.name === opts.only)
    : TABLES

  console.log('\n📊 Pre-flight diagnostics')
  const sourceCounts: Record<string, number> = {}
  const rtreeCounts: Record<string, number | null> = {}

  for (const t of targets) {
    const t0 = Date.now()
    const src = db.prepare(`SELECT COUNT(*) AS c FROM ${t.name}`).get() as { c: number }
    sourceCounts[t.name] = src.c

    // Does the virtual table exist?
    const exists = db.prepare(
      `SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`
    ).get(t.rtree) as { 1: number } | undefined

    if (exists) {
      const r = db.prepare(`SELECT COUNT(*) AS c FROM ${t.rtree}`).get() as { c: number }
      rtreeCounts[t.name] = r.c
    } else {
      rtreeCounts[t.name] = null
    }

    const rt = rtreeCounts[t.name]
    const status =
      rt === null ? '(missing)'
      : rt === sourceCounts[t.name] ? '(✅ complete)'
      : rt === 0 ? '(empty)'
      : `(partial: ${fmt(rt)} of ${fmt(sourceCounts[t.name])})`

    console.log(`   ${t.name.padEnd(10)}: src=${fmt(sourceCounts[t.name]).padStart(12)}   rtree=${rt === null ? 'n/a' : fmt(rt).padStart(12)} ${status}  (${ms(t0)})`)
  }

  if (opts.dryRun) {
    console.log('\n🟡 Dry-run requested — exiting without changes.')
    db.close()
    return
  }

  console.log('\n🏗️  Building R-tree virtual tables (idempotent)\n')

  for (const t of targets) {
    const srcCount = sourceCounts[t.name]
    const rtCount = rtreeCounts[t.name]

    if (rtCount === srcCount && srcCount > 0) {
      console.log(`   ⏭️  ${t.rtree} already complete (${fmt(srcCount)} rows), skipping`)
      continue
    }

    // Partial state (e.g., previous run was Ctrl+C'd): drop + rebuild.
    if (rtCount !== null && rtCount !== srcCount) {
      console.log(`   🗑️  ${t.rtree} is partial (${fmt(rtCount)}/${fmt(srcCount)}), dropping for clean rebuild`)
      db.exec(`DROP TABLE IF EXISTS ${t.rtree}`)
    }

    console.log(`   ▸ ${t.rtree} from ${t.name} (${fmt(srcCount)} rows, est. ${t.estimate})...`)
    const t0 = Date.now()

    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS ${t.rtree} USING rtree(rowid, min_lat, max_lat, min_lng, max_lng)`)

    // Single INSERT under a transaction — far faster than batched INSERTs for R-tree.
    const tx = db.transaction(() => {
      db.exec(`
        INSERT INTO ${t.rtree} (rowid, min_lat, max_lat, min_lng, max_lng)
        SELECT rowid, min_lat, max_lat, min_lng, max_lng
        FROM ${t.name}
        WHERE min_lat IS NOT NULL AND max_lat IS NOT NULL
          AND min_lng IS NOT NULL AND max_lng IS NOT NULL
      `)
    })
    tx()

    const verify = db.prepare(`SELECT COUNT(*) AS c FROM ${t.rtree}`).get() as { c: number }
    console.log(`     ✅ inserted ${fmt(verify.c)} rows in ${ms(t0)}`)
  }

  // ── Smoke test ───────────────────────────────────────────────────────
  console.log('\n🔬 Smoke test (bbox 150m around 34.184, -118.581 — Animal Science)')
  // bbox: 150m in lat = 0.00135°, 150m in lng (cos 34°) ≈ 0.00163°
  const bbox = {
    minLat: 34.18256,
    maxLat: 34.18526,
    minLng: -118.58303,
    maxLng: -118.57977
  }

  for (const t of targets) {
    // Old path (b-tree)
    const tOld = Date.now()
    const oldRows = db.prepare(`
      SELECT count(*) AS c FROM ${t.name}
      WHERE min_lat <= ? AND max_lat >= ?
        AND min_lng <= ? AND max_lng >= ?
    `).get(bbox.maxLat, bbox.minLat, bbox.maxLng, bbox.minLng) as { c: number }
    const oldMs = Date.now() - tOld

    // New path (R-tree JOIN)
    const tNew = Date.now()
    const newRows = db.prepare(`
      SELECT count(*) AS c FROM ${t.name} t
      JOIN ${t.rtree} r ON r.rowid = t.rowid
      WHERE r.min_lat <= ? AND r.max_lat >= ?
        AND r.min_lng <= ? AND r.max_lng >= ?
    `).get(bbox.maxLat, bbox.minLat, bbox.maxLng, bbox.minLng) as { c: number }
    const newMs = Date.now() - tNew

    const match = oldRows.c === newRows.c
    const speedup = oldMs > 0 ? (oldMs / Math.max(1, newMs)).toFixed(0) : '∞'
    console.log(`   ${t.name.padEnd(10)}: ${oldMs}ms (b-tree) → ${newMs}ms (R-tree)  ${match ? '✅' : '⚠️  COUNT MISMATCH'}  ${speedup}× faster, ${oldRows.c} rows`)
  }

  db.close()

  console.log('\n' + '━'.repeat(70))
  console.log(`✅ Hotfix finished in ${ms(runStart)}`)
  console.log('━'.repeat(70))
  console.log()
  console.log('Next step: run the migration batch and confirm fetchAsOverpassData')
  console.log('  (Overpass-compatible response) takes milliseconds instead of seconds.')
  console.log()
  console.log('  npx tsx scripts/migrate-pois-batch.ts --state California --limit 5')
  console.log()
}

try {
  main()
} catch (err) {
  console.error('\n❌ Hotfix failed:', err instanceof Error ? err.message : err)
  console.error('   Re-run is safe — partial state is detected and rebuilt.')
  process.exit(1)
}
