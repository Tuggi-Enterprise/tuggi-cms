/**
 * BR-POI-010 (operator, 2026-10-06/07): a municipal POI enters core with `osm_category = 'city'`,
 * decided on the homolog→core hop (`MigrationService.mapHomologToCore`, shared by the script and the
 * API routes). The only criterion is the seat link: the POI's OSM element is the seat of a municipal
 * relation in the region's local base (`admin_boundary_seats`). No name, no word, no `place` value.
 *
 * Run with: npm run test:api
 */
import { before, after, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'

type LatLng = { lat: number; lng: number }
const TOWN: LatLng = { lat: 39.08, lng: -28.01 }
const ELSEWHERE: LatLng = { lat: 10, lng: 10 }
const sq = (o: LatLng, d: number) => [[o.lng - d, o.lat - d], [o.lng - d, o.lat + d], [o.lng + d, o.lat + d], [o.lng + d, o.lat - d], [o.lng - d, o.lat - d]]
const poly = (name: string, o: LatLng) => `${name}\n1\n${sq(o, 1).map(([x, y]) => `   ${x}   ${y}`).join('\n')}\nEND\nEND\n`
const line = (id: number, tags: Record<string, unknown>, geometry: unknown) =>
  JSON.stringify({ type: 'Feature', geometry, properties: { '@type': 'relation', '@id': id, boundary: 'administrative', ...tags } })
async function* lines(...ls: string[]) { for (const l of ls) yield `\x1e${l}` }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-city-'))
let MigrationService: any

before(async () => {
  process.env.LOCAL_OSM_DIR = dir
  mock.module('@/lib/core/supabase-client', { namedExports: { getSupabase: () => ({}) } })
  const { OSMLocalDataService } = await import('../../lib/services/osm-local-data-service')
  const { parsePoly } = await import('../../lib/services/local-osm-regions')
  // `pt`: a level-7 municipality whose seat is node 100. `zz`: a region whose extract has no country.
  for (const [region, at] of [['pt', TOWN], ['zz', ELSEWHERE]] as const) {
    const text = poly(region, at)
    fs.writeFileSync(path.join(dir, `${region}.poly`), text)
    const db = new OSMLocalDataService(path.join(dir, `${region}.db`))
    const ll = [line(7, { admin_level: '7', name: 'Santa Cruz da Graciosa' }, { type: 'Polygon', coordinates: [sq(at, 0.05)] })]
    if (region === 'pt') ll.push(line(295480, { admin_level: '2', name: 'Portugal', 'ISO3166-1': 'PT' }, { type: 'Polygon', coordinates: [sq(at, 2)] }))
    const seatScan = { seated: new Set<number>(), seats: new Map([[7, [{ type: 'node' as const, id: 100, role: 'admin_centre' as const }]]]) }
    await db.importAdminBoundaries(lines(...ll), { region: parsePoly(text), seatScan })
    db.close()
    const raw = new Database(path.join(dir, `${region}.db`))
    raw.prepare(`INSERT OR REPLACE INTO admin_boundary_seats VALUES (7, 'node', 100, 'admin_centre')`).run()
    raw.close()
  }
  ;({ MigrationService } = await import('../../lib/services/migration-service'))
})

after(() => { try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* left in the OS temp */ } })

const homolog = (element: { osm_type: string; osm_id: number }, category = 'town') =>
  ({ uuid_id: 'u1', name: 'Santa Cruz da Graciosa', country: 'Portugal', category, place: category, ...element })
const coord = (at: LatLng) => ({ latitude: at.lat, longitude: at.lng })

describe('BR-POI-010 — osm_category = city on the homolog→core hop, by the seat link only', () => {
  it('the seat of the municipality enters as city even with place=town', () => {
    const mapped = MigrationService.mapHomologToCore(homolog({ osm_type: 'node', osm_id: 100 }), coord(TOWN))
    assert.equal(mapped.osm_category, 'city')
  })

  it('same name and place, other OSM element (no seat link): keeps its own category', () => {
    const mapped = MigrationService.mapHomologToCore(homolog({ osm_type: 'node', osm_id: 101 }), coord(TOWN))
    assert.equal(mapped.osm_category, 'town')
    const way = MigrationService.mapHomologToCore(homolog({ osm_type: 'way', osm_id: 100 }), coord(TOWN))
    assert.equal(way.osm_category, 'town', 'node 100 and way 100 are different elements')
  })

  it('a region without country in its base, or no region at all: unchanged', () => {
    const noCountry = MigrationService.mapHomologToCore(homolog({ osm_type: 'node', osm_id: 100 }, 'village'), coord(ELSEWHERE))
    assert.equal(noCountry.osm_category, 'village')
    const noBase = MigrationService.mapHomologToCore(homolog({ osm_type: 'node', osm_id: 100 }), coord({ lat: -40, lng: 150 }))
    assert.equal(noBase.osm_category, 'town')
  })
})
