/**
 * Hotfix: R-tree spatial indexes on a local OSM region database so bbox queries from
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
 * Safe to run on any machine. Idempotent — an R-tree with the same row count AND the same
 * highest rowid as its source is skipped; anything else (missing, partial, or stale after a
 * re-import moved the rowids, L9 #833) is rebuilt. `--force` rebuilds regardless; the import
 * (`scripts/manage-osm.ts --import-pbf`) always passes it. See `lib/services/osm-rtree-index`.
 *
 * Usage:
 *   npx tsx scripts/hotfix-osm-rtree-index.ts --region pt
 *   npx tsx scripts/hotfix-osm-rtree-index.ts --db /path.db --force
 *   npx tsx scripts/hotfix-osm-rtree-index.ts --dry-run       # inspect only
 *   npx tsx scripts/hotfix-osm-rtree-index.ts --only buildings  # one table
 */

import Database from 'better-sqlite3'
import { existsSync, statSync } from 'fs'
import { resolve } from 'path'
import { regionDbPath } from '../lib/services/local-osm-regions'

import { rebuildRtree, rtreeIsCurrent, rtreeState, OsmTable as TableName, RtreeState } from '../lib/services/osm-rtree-index'

interface Options {
  dbPath: string
  dryRun: boolean
  force: boolean
  only?: TableName
}

function parseArgs(): Options {
  const args = process.argv.slice(2)
  const opts: Options = {
    dbPath: '',
    dryRun: false,
    force: false
  }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--db' && args[i + 1]) {
      opts.dbPath = resolve(args[++i])
    } else if (a === '--region' && args[i + 1]) {
      opts.dbPath = regionDbPath(args[++i])
    } else if (a === '--dry-run') {
      opts.dryRun = true
    } else if (a === '--force') {
      opts.force = true
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
  --db <path>      Path to the region database
  --region <name>  Region database in LOCAL_OSM_DIR (default data/osm): <name>.db
  --dry-run        Inspect only, do not create or populate indexes
  --force          Rebuild even when the R-tree looks current
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
  console.log('🗺️  Hotfix: R-tree spatial indexes on a local OSM region')
  console.log('━'.repeat(70))
  console.log(`DB:         ${opts.dbPath}`)
  console.log(`Dry-run:    ${opts.dryRun}`)
  if (opts.only) console.log(`Only:       ${opts.only}`)
  console.log(`Started at: ${new Date().toISOString()}`)
  console.log()

  if (!opts.dbPath) {
    console.error(`❌ Pass --db <path> or --region <name> (one database per region, #833)`)
    process.exit(1)
  }
  if (!existsSync(opts.dbPath)) {
    console.error(`❌ Database not found at ${opts.dbPath}`)
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
  const states: Partial<Record<TableName, RtreeState>> = {}

  for (const t of targets) {
    const t0 = Date.now()
    const st = rtreeState(db, t.name)
    states[t.name] = st
    const status =
      st.rtCount === null ? '(missing)'
      : rtreeIsCurrent(st) ? '(✅ complete)'
      : st.rtCount === 0 ? '(empty)'
      : st.rtCount === st.srcCount ? `(stale: max rowid ${st.rtMaxRowid} vs ${st.srcMaxRowid})`
      : `(partial: ${fmt(st.rtCount)} of ${fmt(st.srcCount)})`

    console.log(`   ${t.name.padEnd(10)}: src=${fmt(st.srcCount).padStart(12)}   rtree=${st.rtCount === null ? 'n/a' : fmt(st.rtCount).padStart(12)} ${status}  (${ms(t0)})`)
  }

  if (opts.dryRun) {
    console.log('\n🟡 Dry-run requested — exiting without changes.')
    db.close()
    return
  }

  console.log('\n🏗️  Building R-tree virtual tables\n')

  for (const t of targets) {
    const st = states[t.name]!
    if (!opts.force && rtreeIsCurrent(st)) {
      console.log(`   ⏭️  ${t.rtree} already complete (${fmt(st.srcCount)} rows), skipping`)
      continue
    }
    console.log(`   ▸ ${t.rtree} from ${t.name} (${fmt(st.srcCount)} rows, est. ${t.estimate})...`)
    const t0 = Date.now()
    const n = rebuildRtree(db, t.name)
    console.log(`     ✅ inserted ${fmt(n)} rows in ${ms(t0)}`)
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
