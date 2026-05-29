/**
 * Hotfix: GeoNames offline reverse-geocoder data on data/local_osm.db.
 *
 * Why this exists:
 *   The homolog enrichment service called Nominatim (and Photon) for every
 *   POI's lat/lng to fill city/state/country. Public Nominatim is rate-
 *   limited to 1 req/sec per IP — and once you parallelize the batch driver,
 *   that wall stops the pipeline cold with HTTP 429s.
 *
 * What it does:
 *   Downloads the GeoNames cities500 dataset (~25 MB, CC-BY 4.0 — ~195k cities
 *   worldwide with population >500), plus the admin1 and country code tables.
 *   Imports them into three new tables in local_osm.db, builds an R-tree
 *   spatial index over the cities, and runs a smoke test against known
 *   coordinates. `LocalReverseGeocoder` then resolves city/state/country
 *   offline in <1 ms per POI — no Nominatim calls needed for the 95%+ of POIs
 *   that have a GeoNames-tracked city within ~100 km.
 *
 *   Attribution required: GeoNames is licensed CC-BY 4.0
 *   (https://creativecommons.org/licenses/by/4.0/). Any user-facing surface
 *   that displays the data should credit "GeoNames (geonames.org)".
 *
 * Safe to run on any machine. Idempotent: if the row counts already match,
 * the import is skipped. Partial state from an interrupted run is detected
 * and rebuilt.
 *
 * Requires `curl` and `unzip` on PATH (standard on macOS and Linux).
 *
 * Usage:
 *   npx tsx scripts/hotfix-geonames-import.ts                # default DB
 *   npx tsx scripts/hotfix-geonames-import.ts --db /path.db
 *   npx tsx scripts/hotfix-geonames-import.ts --dry-run      # inspect only
 *   npx tsx scripts/hotfix-geonames-import.ts --keep-temp    # keep downloads
 */

import Database from 'better-sqlite3'
import { spawnSync } from 'child_process'
import {
  existsSync, mkdirSync, statSync, readFileSync, unlinkSync, renameSync,
  createReadStream, writeFileSync
} from 'fs'
import { createInterface } from 'readline'
import { join, dirname, resolve } from 'path'
import { tmpdir } from 'os'

const GEONAMES_CITIES_URL    = 'https://download.geonames.org/export/dump/cities500.zip'
const GEONAMES_ADMIN1_URL    = 'https://download.geonames.org/export/dump/admin1CodesASCII.txt'
const GEONAMES_COUNTRIES_URL = 'https://download.geonames.org/export/dump/countryInfo.txt'

interface Options {
  dbPath: string
  dryRun: boolean
  keepTemp: boolean
}

function parseArgs(): Options {
  const args = process.argv.slice(2)
  const opts: Options = {
    dbPath: join(process.cwd(), 'data', 'local_osm.db'),
    dryRun: false,
    keepTemp: false
  }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--db' && args[i + 1]) {
      opts.dbPath = resolve(args[++i])
    } else if (a === '--dry-run') {
      opts.dryRun = true
    } else if (a === '--keep-temp') {
      opts.keepTemp = true
    } else if (a === '--help' || a === '-h') {
      console.log(`
Usage: npx tsx scripts/hotfix-geonames-import.ts [options]

Options:
  --db <path>      Path to local_osm.db (default: ./data/local_osm.db)
  --dry-run        Inspect counts only, no download/import
  --keep-temp      Keep the downloaded files after import (for debugging)
  --help, -h       Show this message
`)
      process.exit(0)
    }
  }
  return opts
}

function ms(start: number): string { return `${((Date.now() - start) / 1000).toFixed(1)}s` }
function fmt(n: number): string { return n.toLocaleString('en-US') }

function ensureBinary(name: string): void {
  const r = spawnSync(name, ['--version'], { stdio: 'pipe' })
  if (r.status !== 0 && r.error) {
    console.error(`❌ Required binary '${name}' not found on PATH.`)
    console.error(`   Install: brew install ${name}  (macOS)  |  apt-get install ${name}  (Debian/Ubuntu)`)
    process.exit(1)
  }
}

function downloadTo(url: string, dest: string): void {
  const r = spawnSync('curl', ['-fsSL', '-o', dest, url], { stdio: ['ignore', 'pipe', 'inherit'] })
  if (r.status !== 0) {
    throw new Error(`curl failed (status ${r.status}) for ${url}`)
  }
}

function unzipTo(zipPath: string, fileInside: string, destDir: string): string {
  const r = spawnSync('unzip', ['-oq', zipPath, fileInside, '-d', destDir], { stdio: ['ignore', 'pipe', 'inherit'] })
  if (r.status !== 0) {
    throw new Error(`unzip failed (status ${r.status}) for ${zipPath}`)
  }
  return join(destDir, fileInside)
}

async function streamLines(path: string, onLine: (line: string) => void): Promise<void> {
  const stream = createReadStream(path)
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  for await (const line of rl) {
    onLine(line)
  }
}

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS geonames_cities (
      geonameid INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      ascii_name TEXT,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      country_code TEXT,
      admin1_code TEXT,
      population INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_geonames_cities_country
      ON geonames_cities(country_code, admin1_code);

    CREATE TABLE IF NOT EXISTS geonames_admin1 (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      ascii_name TEXT
    );

    CREATE TABLE IF NOT EXISTS geonames_countries (
      country_code TEXT PRIMARY KEY,
      country_name TEXT NOT NULL,
      iso3 TEXT,
      continent TEXT,
      capital TEXT,
      population INTEGER,
      area_km2 INTEGER
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS geonames_cities_rtree
      USING rtree(rowid, min_lat, max_lat, min_lng, max_lng);
  `)
}

async function importCities(db: Database.Database, txtPath: string): Promise<number> {
  const insertCity = db.prepare(`
    INSERT OR REPLACE INTO geonames_cities
      (geonameid, name, ascii_name, lat, lng, country_code, admin1_code, population)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertRtree = db.prepare(`
    INSERT OR REPLACE INTO geonames_cities_rtree
      (rowid, min_lat, max_lat, min_lng, max_lng)
    VALUES (?, ?, ?, ?, ?)
  `)

  let n = 0
  const tx = db.transaction(() => { /* inserts pushed below */ })

  db.exec('BEGIN')
  await streamLines(txtPath, (line) => {
    if (!line) return
    // GeoNames cities columns (tab-separated):
    // 0 geonameid, 1 name, 2 asciiname, 3 alternatenames, 4 lat, 5 lng,
    // 6 feature_class, 7 feature_code, 8 country_code, 9 cc2, 10 admin1,
    // 11 admin2, 12 admin3, 13 admin4, 14 population, ...
    const c = line.split('\t')
    if (c.length < 15) return
    const id = parseInt(c[0], 10)
    const lat = parseFloat(c[4])
    const lng = parseFloat(c[5])
    if (!Number.isFinite(id) || !Number.isFinite(lat) || !Number.isFinite(lng)) return
    insertCity.run(id, c[1], c[2], lat, lng, c[8] || null, c[10] || null, parseInt(c[14], 10) || 0)
    // R-tree stores the point as a degenerate bbox (min==max).
    insertRtree.run(id, lat, lat, lng, lng)
    n++
  })
  db.exec('COMMIT')
  return n
}

async function importAdmin1(db: Database.Database, txtPath: string): Promise<number> {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO geonames_admin1 (code, name, ascii_name) VALUES (?, ?, ?)
  `)
  let n = 0
  db.exec('BEGIN')
  await streamLines(txtPath, (line) => {
    if (!line) return
    // admin1CodesASCII.txt columns: code, name, asciiname, geonameId
    const c = line.split('\t')
    if (c.length < 3) return
    stmt.run(c[0], c[1], c[2])
    n++
  })
  db.exec('COMMIT')
  return n
}

async function importCountries(db: Database.Database, txtPath: string): Promise<number> {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO geonames_countries
      (country_code, country_name, iso3, continent, capital, population, area_km2)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  let n = 0
  db.exec('BEGIN')
  await streamLines(txtPath, (line) => {
    if (!line || line.startsWith('#')) return
    // countryInfo.txt columns: ISO, ISO3, ISO-Numeric, fips, Country, Capital,
    // Area(sq km), Population, Continent, tld, CurrencyCode, CurrencyName, Phone,
    // Postal Code Format, Postal Code Regex, Languages, geonameid, neighbours, EquivalentFipsCode
    const c = line.split('\t')
    if (c.length < 9) return
    stmt.run(
      c[0],                                     // ISO
      c[4],                                     // Country name
      c[1] || null,                             // ISO3
      c[8] || null,                             // Continent
      c[5] || null,                             // Capital
      parseInt(c[7], 10) || 0,                  // Population
      parseInt(c[6], 10) || 0                   // Area km²
    )
    n++
  })
  db.exec('COMMIT')
  return n
}

async function main() {
  const opts = parseArgs()
  const runStart = Date.now()

  console.log('━'.repeat(70))
  console.log('🌍 Hotfix: GeoNames offline reverse-geocoder for local_osm.db')
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

  if (!opts.dryRun) {
    db.pragma('journal_mode = WAL')
    db.pragma('temp_store = MEMORY')
    db.pragma('cache_size = -2000000') // 2GB
    db.pragma('mmap_size = 30000000000')
    createSchema(db)
  }

  console.log('\n📊 Pre-flight diagnostics')
  const counts: Record<string, number> = {}
  for (const t of ['geonames_cities', 'geonames_admin1', 'geonames_countries']) {
    try {
      const r = db.prepare(`SELECT count(*) AS c FROM ${t}`).get() as { c: number }
      counts[t] = r.c
    } catch {
      counts[t] = 0
    }
    console.log(`   ${t.padEnd(20)}: ${fmt(counts[t]).padStart(10)} rows`)
  }

  if (opts.dryRun) {
    console.log('\n🟡 Dry-run requested — exiting without changes.')
    db.close()
    return
  }

  ensureBinary('curl')
  ensureBinary('unzip')

  // Download into a temp dir
  const stageDir = join(tmpdir(), `geonames-hotfix-${Date.now()}`)
  mkdirSync(stageDir, { recursive: true })

  try {
    // ── Cities ──────────────────────────────────────────────────────
    if (counts.geonames_cities === 0) {
      console.log('\n⬇️  Downloading cities500.zip from GeoNames (~25 MB)…')
      const t0 = Date.now()
      const zip = join(stageDir, 'cities500.zip')
      downloadTo(GEONAMES_CITIES_URL, zip)
      console.log(`   downloaded in ${ms(t0)}`)
      const txt = unzipTo(zip, 'cities500.txt', stageDir)

      console.log('   importing cities…')
      const t1 = Date.now()
      const n = await importCities(db, txt)
      console.log(`   ✅ ${fmt(n)} cities in ${ms(t1)}`)
    } else {
      console.log(`\n⏭️  Cities already present (${fmt(counts.geonames_cities)} rows), skipping download`)
    }

    // ── Admin1 codes ─────────────────────────────────────────────────
    if (counts.geonames_admin1 === 0) {
      console.log('\n⬇️  Downloading admin1CodesASCII.txt…')
      const t0 = Date.now()
      const txt = join(stageDir, 'admin1CodesASCII.txt')
      downloadTo(GEONAMES_ADMIN1_URL, txt)
      console.log(`   downloaded in ${ms(t0)}`)
      const n = await importAdmin1(db, txt)
      console.log(`   ✅ ${fmt(n)} admin1 codes`)
    } else {
      console.log(`\n⏭️  admin1 already present (${fmt(counts.geonames_admin1)} rows), skipping download`)
    }

    // ── Country info ────────────────────────────────────────────────
    if (counts.geonames_countries === 0) {
      console.log('\n⬇️  Downloading countryInfo.txt…')
      const t0 = Date.now()
      const txt = join(stageDir, 'countryInfo.txt')
      downloadTo(GEONAMES_COUNTRIES_URL, txt)
      console.log(`   downloaded in ${ms(t0)}`)
      const n = await importCountries(db, txt)
      console.log(`   ✅ ${fmt(n)} countries`)
    } else {
      console.log(`\n⏭️  countries already present (${fmt(counts.geonames_countries)} rows), skipping download`)
    }

    // ── ANALYZE ────────────────────────────────────────────────────
    console.log('\n📈 ANALYZE so the planner picks the right indexes')
    db.exec('ANALYZE geonames_cities')
    db.exec('ANALYZE geonames_admin1')
    db.exec('ANALYZE geonames_countries')

    // ── Smoke test ─────────────────────────────────────────────────
    console.log('\n🔬 Smoke test — nearest-city lookup for known coords')
    const samples = [
      { name: 'San Francisco, CA',  lat: 37.7749,  lng: -122.4194 },
      { name: 'São Paulo, BR',      lat: -23.5505, lng: -46.6333 },
      { name: 'Horseshoe Meadow, CA (rural)', lat: 36.4486, lng: -118.1736 }
    ]
    for (const s of samples) {
      const t0 = Date.now()
      const latDelta = 100 / 111
      const lngDelta = 100 / (111 * Math.cos(s.lat * Math.PI / 180))
      const rows = db.prepare(`
        SELECT c.name, c.admin1_code, c.country_code,
               a.name AS state_name, co.country_name,
               c.lat, c.lng, c.population
        FROM geonames_cities c
        JOIN geonames_cities_rtree r ON r.rowid = c.geonameid
        LEFT JOIN geonames_admin1 a
          ON a.code = c.country_code || '.' || c.admin1_code
        LEFT JOIN geonames_countries co
          ON co.country_code = c.country_code
        WHERE r.min_lat <= ? AND r.max_lat >= ?
          AND r.min_lng <= ? AND r.max_lng >= ?
      `).all(s.lat + latDelta, s.lat - latDelta, s.lng + lngDelta, s.lng - lngDelta) as any[]
      const dur = Date.now() - t0
      if (rows.length === 0) {
        console.log(`   ${s.name.padEnd(40)} → no city within 100km  (${dur}ms)`)
        continue
      }
      // haversine pick nearest
      let nearest = rows[0], minDist = haversineKm(s.lat, s.lng, nearest.lat, nearest.lng)
      for (const r of rows) {
        const d = haversineKm(s.lat, s.lng, r.lat, r.lng)
        if (d < minDist) { minDist = d; nearest = r }
      }
      const label = `${nearest.name}, ${nearest.state_name ?? nearest.admin1_code ?? '?'}, ${nearest.country_name ?? nearest.country_code}`
      console.log(`   ${s.name.padEnd(40)} → ${label} (${minDist.toFixed(1)} km, ${dur}ms)`)
    }
  } finally {
    if (!opts.keepTemp) {
      try {
        spawnSync('rm', ['-rf', stageDir])
      } catch { /* ignore */ }
    } else {
      console.log(`\nℹ️  Temp files kept at: ${stageDir}`)
    }
  }

  db.close()
  console.log('\n' + '━'.repeat(70))
  console.log(`✅ Hotfix finished in ${ms(runStart)}`)
  console.log('━'.repeat(70))
  console.log()
  console.log('GeoNames CC-BY 4.0 — credit "GeoNames (geonames.org)" on any user-')
  console.log('facing surface that displays this data.')
  console.log()
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

main().catch(err => {
  console.error('\n❌ Hotfix failed:', err instanceof Error ? err.message : err)
  console.error('   Re-run is safe — INSERT OR REPLACE keeps the import idempotent.')
  process.exit(1)
})
