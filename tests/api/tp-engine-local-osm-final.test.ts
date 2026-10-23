// Operator, 2026-10-24: "nós deveríamos consultar tudo local". A point covered by a local OSM
// region is answered by it, empty included — an empty answer where we hold the whole country is
// data, not a miss. Overpass stays as the fallback of 2026-10-05 for the point no region covers
// and for the local query that fails (no error, no lock).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { LocalOSMFetcher } from '../../lib/services/trigger-points-google/services/local-osm-fetcher'
import { StreetAnalyzer } from '../../lib/services/trigger-points-google/analyzers/street-analyzer'

// Gulf of Tehuantepec, a sea pin with no street within reach in the Mexico extract.
const SEA = { lat: 15.5, lng: -94.8333333 }
const OUTSIDE = { lat: 48.2082, lng: 16.3738 } // Vienna: no region
const insideMx = (lat: number, lng: number) => lat > 14 && lat < 33 && lng > -119 && lng < -86

const FLAGS = { pois: false, streets: false, buildings: false }
const emptyStreetsDb = () => {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE streets (id TEXT PRIMARY KEY, name TEXT, type TEXT, geometry_json TEXT, min_lat REAL, max_lat REAL, min_lng REAL, max_lng REAL, tags_json TEXT);
           CREATE TABLE buildings (id TEXT PRIMARY KEY, geometry_json TEXT, min_lat REAL, max_lat REAL, min_lng REAL, max_lng REAL, tags_json TEXT, height REAL, levels INTEGER);`)
  return db
}
const brokenDb = () => new Database(':memory:') // no tables: every query throws

const OVERPASS_WAY = { type: 'way', id: 7, tags: { highway: 'residential', name: 'Calle Overpass' }, geometry: [{ lat: 15.5, lon: -94.8334 }, { lat: 15.5004, lon: -94.8334 }] }

async function withRegion(db: Database.Database, run: (calls: string[]) => Promise<void>) {
  const fetcher = LocalOSMFetcher.getInstance() as any
  const restore = { regions: fetcher.regions, fetch: globalThis.fetch }
  fetcher.regions = [{ name: 'mx', covers: insideMx, db, rtree: FLAGS }]
  const calls: string[] = []
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url))
    return new Response(JSON.stringify({ elements: [OVERPASS_WAY] }), { status: 200 })
  }) as typeof fetch
  try {
    await run(calls)
  } finally {
    fetcher.regions = restore.regions
    globalThis.fetch = restore.fetch
  }
}

const boundaryAt = (p: { lat: number; lng: number }) => ({
  type: 'polygon', center: p, coordinates: [p, { lat: p.lat + 0.0001, lng: p.lng }, { lat: p.lat, lng: p.lng + 0.0001 }],
  area_m2: 50, perimeter_m: 30, confidence: 0.5, source: 'synthetic',
}) as any

describe('local OSM answer is final where a region covers the point (operator, 2026-10-24)', () => {
  it('fetcher: covered and empty → [] and { elements: [] }; uncovered → null; failing query → null', async () => {
    await withRegion(emptyStreetsDb(), async () => {
      const f = LocalOSMFetcher.getInstance()
      assert.deepEqual(f.fetchExtendedStreets(SEA, 60), [])
      assert.deepEqual(f.fetchAsOverpassData(SEA, 60, { includeBuildings: true }), { elements: [] })
      assert.equal(f.fetchExtendedStreets(OUTSIDE, 60), null)
      assert.equal(f.fetchAsOverpassData(OUTSIDE, 60), null)
    })
    await withRegion(brokenDb(), async () => {
      const f = LocalOSMFetcher.getInstance()
      assert.equal(f.fetchExtendedStreets(SEA, 60), null)
      assert.equal(f.fetchAsOverpassData(SEA, 60), null)
    })
  })

  for (const [label, call] of [
    ['streets around boundary', (a: any, p: any) => a.getStreetsFromOSMOptimizedBoundary(boundaryAt(p), 60)],
    ['streets around point', (a: any, p: any) => a.getStreetsFromOSMOptimized(p, 50)],
  ] as const) {
    it(`StreetAnalyzer ${label}: covered and empty → no network call`, async () => {
      await withRegion(emptyStreetsDb(), async (calls) => {
        const streets = await call(new StreetAnalyzer(), SEA)
        assert.deepEqual(streets, [])
        assert.equal(calls.length, 0)
      })
    })

    it(`StreetAnalyzer ${label}: no region covers the point → Overpass`, async () => {
      await withRegion(emptyStreetsDb(), async (calls) => {
        await call(new StreetAnalyzer(), OUTSIDE) // the mocked way lies at SEA, so the reach filter may drop it
        assert.ok(calls.length >= 1, 'Overpass was not asked')
      })
    })

    it(`StreetAnalyzer ${label}: the local query fails → Overpass`, async () => {
      await withRegion(brokenDb(), async (calls) => {
        const streets = await call(new StreetAnalyzer(), SEA)
        assert.ok(calls.length >= 1, 'Overpass was not asked')
        assert.ok(streets.length >= 1)
      })
    })
  }
})
