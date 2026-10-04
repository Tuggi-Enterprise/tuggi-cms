// #833 (L1, L9 of docs/arquitetura/cms/pipeline-pais.md): one local OSM database per region,
// picked by coordinate; a POI outside every region fails instead of going to Overpass in
// silence; the R-tree is rebuilt when a re-import moves the rowids.
import { describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import Database from 'better-sqlite3'
import {
  ALLOW_OVERPASS_ENV, LOCAL_OSM_DIR_ENV, LocalOsmNotCoveredError, geonamesDbPath, listOsmRegions,
  localOsmDir, parsePoly, regionAt, regionDbPath, requireLocalOsmCoverage,
} from '../../lib/services/local-osm-regions'
import { OSMLocalDataService } from '../../lib/services/osm-local-data-service'
import { rebuildRtree, rtreeIsCurrent, rtreeState } from '../../lib/services/osm-rtree-index'
import { LocalOSMFetcher } from '../../lib/services/trigger-points-google/services/local-osm-fetcher'

const poly = (name: string, rings: Array<{ hole?: boolean; pts: Array<[number, number]> }>) =>
  [name, ...rings.flatMap((r, i) => [`${r.hole ? '!' : ''}${i + 1}`, ...r.pts.map(([lon, lat]) => `   ${lon.toExponential(6)}   ${lat.toExponential(6)}`), 'END']), 'END', ''].join('\n')

// Rough boxes, enough to tell the countries apart: the Sudeste (SP, RJ, MG, ES) and Portugal
// with Madeira as a second ring. A hole in the Sudeste stands for an excluded area.
const SUDESTE = poly('sudeste', [
  { pts: [[-53.2, -25.4], [-39.6, -25.4], [-39.6, -14.2], [-53.2, -14.2]] },
  { hole: true, pts: [[-41.0, -15.0], [-40.0, -15.0], [-40.0, -14.5], [-41.0, -14.5]] },
])
const PORTUGAL = poly('portugal', [
  { pts: [[-9.6, 36.9], [-6.1, 36.9], [-6.1, 42.2], [-9.6, 42.2]] },
  { pts: [[-17.4, 32.5], [-16.2, 32.5], [-16.2, 33.2], [-17.4, 33.2]] },
])

function regionDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-833-'))
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text)
  return dir
}

const PIN = {
  saoPaulo: { lat: -23.5874, lng: -46.6576 },   // Parque Ibirapuera
  lisbon: { lat: 38.6916, lng: -9.2160 },       // Torre de Belém
  funchal: { lat: 32.6497, lng: -16.9086 },     // Madeira
  vienna: { lat: 48.2082, lng: 16.3738 },
  hole: { lat: -14.8, lng: -40.5 },
}

describe('local OSM region by coordinate (#833, L1)', () => {
  const dir = regionDir({ 'br.db': '', 'br.poly': SUDESTE, 'pt.db': '', 'pt.poly': PORTUGAL, 'geonames.db': '' })
  const regions = listOsmRegions(dir)

  it('lists every <region>.db with its .poly, and GeoNames is not a region', () => {
    assert.deepEqual(regions.map(r => r.name), ['br', 'pt'])
    assert.equal(regions[0].dbPath, path.join(dir, 'br.db'))
  })

  it('picks the region whose polygon contains the coordinate, island rings included', () => {
    assert.equal(regionAt(regions, PIN.saoPaulo.lat, PIN.saoPaulo.lng)?.name, 'br')
    assert.equal(regionAt(regions, PIN.lisbon.lat, PIN.lisbon.lng)?.name, 'pt')
    assert.equal(regionAt(regions, PIN.funchal.lat, PIN.funchal.lng)?.name, 'pt')
  })

  it('a coordinate outside every polygon, inside a hole, or not a number has no region', () => {
    assert.equal(regionAt(regions, PIN.vienna.lat, PIN.vienna.lng), null)
    assert.equal(regionAt(regions, PIN.hole.lat, PIN.hole.lng), null)
    assert.equal(regionAt(regions, NaN, 1), null)
  })

  it('parses the Geofabrik format: outer rings, holes and the closing END', () => {
    const p = parsePoly(PORTUGAL)
    assert.equal(p.outer.length, 2)
    assert.equal(p.holes.length, 0)
    assert.equal(parsePoly(SUDESTE).holes.length, 1)
    assert.throws(() => parsePoly('x\n1\n  1 2\n'), /without END/)
  })

  it('a database without its .poly is an error, never a region that covers nothing or everything', () => {
    const bad = regionDir({ 'at.db': '' })
    assert.throws(() => listOsmRegions(bad), /"at" has no boundary: .*at\.poly is missing/)
  })

  it('a region name is a file name: lowercase, digits and "-" only', () => {
    assert.equal(regionDbPath('br', '/x'), '/x/br.db')
    assert.throws(() => regionDbPath('../br', '/x'), /Invalid OSM region name/)
  })

  it('the directory comes from LOCAL_OSM_DIR, else data/osm under the cwd', () => {
    const before = process.env[LOCAL_OSM_DIR_ENV]
    try {
      delete process.env[LOCAL_OSM_DIR_ENV]
      assert.equal(localOsmDir(), path.join(process.cwd(), 'data', 'osm'))
      process.env[LOCAL_OSM_DIR_ENV] = dir
      assert.equal(localOsmDir(), dir)
      assert.equal(geonamesDbPath(), path.join(dir, 'geonames.db'))
    } finally {
      if (before === undefined) delete process.env[LOCAL_OSM_DIR_ENV]
      else process.env[LOCAL_OSM_DIR_ENV] = before
    }
  })
})

describe('no silent Overpass fallback (#833, L1)', () => {
  const dir = regionDir({ 'br.db': '', 'br.poly': SUDESTE })
  const regions = listOsmRegions(dir)

  it('a POI outside every region fails with a clear error naming the regions and the opt-in', () => {
    assert.throws(
      () => requireLocalOsmCoverage(PIN.vienna.lat, PIN.vienna.lng, regions, dir),
      (e: unknown) => e instanceof LocalOsmNotCoveredError
        && /No local OSM region covers \(48\.2082, 16\.3738\)/.test((e as Error).message)
        && /regions: br/.test((e as Error).message)
        && /TP_ALLOW_OVERPASS=1/.test((e as Error).message),
    )
    assert.doesNotThrow(() => requireLocalOsmCoverage(PIN.saoPaulo.lat, PIN.saoPaulo.lng, regions, dir))
  })

  it('Overpass only on purpose: TP_ALLOW_OVERPASS=1 lets the uncovered POI through', () => {
    process.env[ALLOW_OVERPASS_ENV] = '1'
    try {
      assert.doesNotThrow(() => requireLocalOsmCoverage(PIN.vienna.lat, PIN.vienna.lng, regions, dir))
    } finally {
      delete process.env[ALLOW_OVERPASS_ENV]
    }
  })

  it('the engine refuses the uncovered POI before the relief and before any street search', async () => {
    const { CoreTriggerPointPredictor } = await import('../../lib/services/trigger-points-google/core/trigger-point-predictor')
    const list = mock.method(LocalOSMFetcher.prototype, 'regionList', () => regions)
    try {
      await assert.rejects(
        new CoreTriggerPointPredictor().predictTriggerPointsComplete({ id: 'x', name: 'Stephansdom', location: PIN.vienna } as any),
        LocalOsmNotCoveredError,
      )
    } finally {
      list.mock.restore()
    }
  })
})

function memoryRegion(streets: Array<{ id: string; lat: number; lng: number }>) {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE streets (id TEXT PRIMARY KEY, name TEXT, type TEXT, geometry_json TEXT, min_lat REAL, max_lat REAL, min_lng REAL, max_lng REAL, tags_json TEXT)`)
  for (const s of streets) {
    db.prepare(`INSERT INTO streets VALUES (?, ?, 'residential', ?, ?, ?, ?, ?, '{"highway":"residential"}')`)
      .run(s.id, s.id, JSON.stringify([{ lat: s.lat, lng: s.lng }, { lat: s.lat + 0.0005, lng: s.lng }]), s.lat, s.lat + 0.0005, s.lng, s.lng)
  }
  return db
}

describe('the engine reads the region of each query point (#833)', () => {
  it('a street query in São Paulo reads br, in Lisbon reads pt, and in Vienna nothing', () => {
    const regions = listOsmRegions(regionDir({ 'br.db': '', 'br.poly': SUDESTE, 'pt.db': '', 'pt.poly': PORTUGAL }))
    const flags = { pois: false, streets: false, buildings: false }
    const fetcher = Object.create(LocalOSMFetcher.prototype)
    fetcher.regions = [
      { name: 'br', covers: regions[0].covers, db: memoryRegion([{ id: 'osm_way_sp', ...PIN.saoPaulo }]), rtree: flags },
      { name: 'pt', covers: regions[1].covers, db: memoryRegion([{ id: 'osm_way_lx', ...PIN.lisbon }]), rtree: flags },
    ]
    const ids = (p: { lat: number; lng: number }) => (fetcher.fetchExtendedStreets(p, 300) as Array<{ id: string }> | null)?.map(s => s.id) ?? null
    assert.deepEqual(ids(PIN.saoPaulo), ['osm_way_sp'])
    assert.deepEqual(ids(PIN.lisbon), ['osm_way_lx'])
    assert.equal(ids(PIN.vienna), null)
  })
})

describe('R-tree after a re-import (#833, L9)', () => {
  const feature = (id: number, lat: number, lng: number) => JSON.stringify({
    type: 'Feature', properties: { '@type': 'way', '@id': id, highway: 'residential', name: `R${id}` },
    geometry: { type: 'LineString', coordinates: [[lng, lat], [lng + 0.001, lat + 0.001]] },
  })
  const lines = [feature(1, -23.58, -46.65), feature(2, -23.59, -46.66), feature(3, -23.60, -46.67)].join('\n')
  const viaRtree = (db: Database.Database, lat: number, lng: number) =>
    (db.prepare(`SELECT s.id FROM streets s JOIN streets_rtree r ON r.rowid = s.rowid
                 WHERE r.min_lat <= ? AND r.max_lat >= ? AND r.min_lng <= ? AND r.max_lng >= ?`)
      .all(lat + 1e-4, lat - 1e-4, lng + 1e-4, lng - 1e-4) as Array<{ id: string }>).map(r => r.id)

  it('same row count with moved rowids is stale and is rebuilt; the rebuilt index finds the street again', async () => {
    const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'osm-833-rtree-')), 'br.db')
    const svc = new OSMLocalDataService(dbPath)
    await svc.importGeoJSONSeq(Readable.from([lines]))
    svc.close()
    const db = new Database(dbPath)
    assert.equal(rebuildRtree(db, 'streets'), 3)
    assert.equal(rtreeIsCurrent(rtreeState(db, 'streets')), true)
    assert.deepEqual(viaRtree(db, -23.60, -46.67), ['osm_way_3'])
    db.close()

    // the same PBF imported again: INSERT OR REPLACE keeps the count and moves every rowid
    const again = new OSMLocalDataService(dbPath)
    await again.importGeoJSONSeq(Readable.from([lines]))
    again.close()
    const db2 = new Database(dbPath)
    const st = rtreeState(db2, 'streets')
    assert.equal(st.rtCount, st.srcCount, 'the old check (count only) would skip this one')
    assert.equal(rtreeIsCurrent(st), false)
    assert.deepEqual(viaRtree(db2, -23.60, -46.67), [], 'the stale index points at rows that are gone')
    rebuildRtree(db2, 'streets')
    assert.equal(rtreeIsCurrent(rtreeState(db2, 'streets')), true)
    assert.deepEqual(viaRtree(db2, -23.60, -46.67), ['osm_way_3'])
    db2.close()
  })

  it('a missing R-tree is not current', () => {
    const db = memoryRegion([{ id: 'a', lat: 0, lng: 0 }])
    assert.equal(rtreeIsCurrent(rtreeState(db, 'streets')), false)
  })
})
