/**
 * BR-POI-010 — municipal borders from the local OSM: the region's country is read from the extract,
 * the municipal admin_level comes from one table by country (Portugal: 7, default 8), and the
 * borders are imported whole and inside the region's `.poly` with their seat (`admin_centre`, else
 * `label`); a POI whose OSM element IS that seat, pin inside, takes the border as `osm_admin` — no
 * name takes part — and an `osm_admin` POI reads no relief.
 */
import { describe, it, mock, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'

type LatLng = { lat: number; lng: number }
const ANGRA: LatLng = { lat: 38.656, lng: -27.218 }
/** GeoJSON ring of a square of `d` degrees around `o`, closed. */
const sq = (o: LatLng, d: number) => [[o.lng - d, o.lat - d], [o.lng - d, o.lat + d], [o.lng + d, o.lat + d], [o.lng + d, o.lat - d], [o.lng - d, o.lat - d]]
const ISLET: LatLng = { lat: 38.60, lng: -27.10 }
/** Angra: main part with a hole (an enclave of another municipality) + an islet. */
const ANGRA_GEOMETRY = { type: 'MultiPolygon', coordinates: [[sq(ANGRA, 0.05), sq({ lat: 38.68, lng: -27.24 }, 0.005)], [sq(ISLET, 0.005)]] }
const FREGUESIA_GEOMETRY = { type: 'Polygon', coordinates: [sq(ANGRA, 0.01)] }
const POLY_PT = `pt\n1\n${sq(ANGRA, 1).map(([x, y]) => `   ${x}   ${y}`).join('\n')}\nEND\nEND\n`
const ELSEWHERE: LatLng = { lat: 10, lng: 10 }
/** The seat of Angra (its `admin_centre` node) and of the freguesia Sé (level 8, never municipal). */
const ANGRA_SEAT = { osm_type: 'node', osm_id: '100' } as const
const SE_SEAT = { osm_type: 'node', osm_id: 200 } as const
const poi = (id: string, name: string, location: LatLng, element: { osm_type?: string; osm_id?: string | number } = {}) =>
  ({ id, name, location, type: 'attraction', country: 'Portugal', city: 'Angra do Heroísmo', ...element }) as any
const POLY_ZZ = `zz\n1\n${sq(ELSEWHERE, 1).map(([x, y]) => `   ${x}   ${y}`).join('\n')}\nEND\nEND\n`

const line = (type: string, id: number, tags: Record<string, unknown>, geometry: unknown) =>
  JSON.stringify({ type: 'Feature', geometry, properties: { '@type': type, '@id': id, boundary: 'administrative', ...tags } })
async function* lines(...ls: string[]) { for (const l of ls) yield `\x1e${l}` }

const ANGRA_LINE = line('relation', 7448382, { admin_level: '7', name: 'Angra do Heroísmo' }, ANGRA_GEOMETRY)
const FREGUESIA_LINE = line('relation', 1, { admin_level: '8', name: 'Sé' }, FREGUESIA_GEOMETRY)
/** The country relations an extract carries: its own and a neighbour's, both with an ISO 3166-1 code. */
const PORTUGAL_LINE = line('relation', 295480, { admin_level: '2', name: 'Portugal', 'ISO3166-1': 'PT' }, { type: 'Polygon', coordinates: [sq(ANGRA, 2)] })
const SPAIN_LINE = line('relation', 1311341, { admin_level: '2', name: 'España', 'ISO3166-1:alpha2': 'ES' }, { type: 'Polygon', coordinates: [sq(ELSEWHERE, 2)] })

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-boundaries-'))
let ensureDemCellCalls = 0
let stored: { geojson: unknown; boundary_source: string | null; boundary_confidence: number | null } | null = null

before(async () => {
  process.env.LOCAL_OSM_DIR = dir
  // No relief prepared anywhere: a POI that needs it must ask `ensureDemCell`.
  process.env.DEM_CACHE_DIR = path.join(dir, 'dem-cache')
  const { OSMLocalDataService } = await import('../../lib/services/osm-local-data-service')
  const { parsePoly } = await import('../../lib/services/local-osm-regions')
  // Two regions with the same borders: `pt` carries its country relation, `zz` carries none.
  for (const [region, polyText, at] of [['pt', POLY_PT, ANGRA], ['zz', POLY_ZZ, ELSEWHERE]] as const) {
    fs.writeFileSync(path.join(dir, `${region}.poly`), polyText)
    const db = new OSMLocalDataService(path.join(dir, `${region}.db`))
    const shift = (g: any) => JSON.parse(JSON.stringify(g), (k, v) => (Array.isArray(v) && typeof v[0] === 'number' ? [v[0] - ANGRA.lng + at.lng, v[1] - ANGRA.lat + at.lat] : v))
    const ll = [line('relation', 7448382, { admin_level: '7', name: 'Angra do Heroísmo' }, shift(ANGRA_GEOMETRY)), line('relation', 1, { admin_level: '8', name: 'Sé' }, shift(FREGUESIA_GEOMETRY))]
    if (region === 'pt') ll.push(PORTUGAL_LINE)
    const seatScan = { seated: new Set<number>(), seats: new Map([[7448382, [{ type: 'node' as const, id: 100, role: 'admin_centre' as const }]]]) }
    await db.importAdminBoundaries(lines(...ll), { region: parsePoly(polyText), seatScan })
    db.close()
    // Rows on disk in both, whatever the import kept: the lookup must refuse the freguesia by its
    // level, and `zz` (no country) by the missing country, not by absence.
    const raw = new Database(path.join(dir, `${region}.db`))
    const bbox = [at.lat - 1, at.lat + 1, at.lng - 1, at.lng + 1]
    raw.prepare(`INSERT OR REPLACE INTO admin_boundaries VALUES (7448382, 7, 'Angra do Heroísmo', ?, ?, ?, ?, ?)`).run(JSON.stringify(shift(ANGRA_GEOMETRY)), ...bbox)
    raw.prepare(`INSERT OR REPLACE INTO admin_boundaries VALUES (1, 8, 'Sé', ?, ?, ?, ?, ?)`).run(JSON.stringify(shift(FREGUESIA_GEOMETRY)), ...bbox)
    raw.prepare(`INSERT OR REPLACE INTO admin_boundary_seats VALUES (7448382, 'node', 100, 'admin_centre'), (1, 'node', 200, 'admin_centre')`).run()
    raw.close()
  }
  mock.module('../../lib/services/dem/dem-prepare', {
    namedExports: { ensureDemCell: async () => { ensureDemCellCalls++; throw new Error('relief prepared') } },
  })
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabase: () => ({
        schema: () => ({
          rpc: async () => ({ data: stored?.geojson ?? null, error: null }),
          from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({
            data: stored && { boundary_source: stored.boundary_source, boundary_confidence: stored.boundary_confidence, latitude: ANGRA.lat, longitude: ANGRA.lng },
            error: null,
          }) }) }) }),
        }),
      }),
    },
  })
})

// The engine keeps the region databases open (a singleton): best effort on Windows.
after(() => { try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* left in the OS temp */ } })

describe('BR-POI-010 — import keeps the municipalities of the region, whole', () => {
  it('only relations at the country municipal level, centred inside the .poly; the levels inside are counted for the human', async () => {
    const { importAdminBoundaries, regionCountry } = await import('../../lib/services/admin-boundaries')
    const { parsePoly } = await import('../../lib/services/local-osm-regions')
    const db = new Database(':memory:')
    const spanish = line('relation', 2, { admin_level: '7', name: 'Tui' }, { type: 'Polygon', coordinates: [sq(ELSEWHERE, 0.05)] })
    const memberWay = line('way', 3, { admin_level: '7', name: 'Angra do Heroísmo' }, FREGUESIA_GEOMETRY)
    const r = await importAdminBoundaries(db, lines(ANGRA_LINE, FREGUESIA_LINE, spanish, memberWay, PORTUGAL_LINE, SPAIN_LINE), { region: parsePoly(POLY_PT) })
    assert.deepEqual(r, { country: 'PT', countrySource: 'admin_level=2', level: 7, byLevel: { 7: 1, 8: 1 }, seatsByLevel: {}, kept: 1, standaloneByLevel: {}, keptWithSeat: 0, keptSeatedByLabel: 0, outsideRegion: 1 })
    const rows = db.prepare('SELECT osm_id, admin_level, name, geometry_geojson FROM admin_boundaries').all() as any[]
    assert.equal(rows.length, 1)
    assert.equal(rows[0].osm_id, 7448382)
    assert.deepEqual(JSON.parse(rows[0].geometry_geojson), ANGRA_GEOMETRY, 'MultiPolygon with its hole, untouched')
    assert.equal(regionCountry(db), 'PT', 'the country is written into the region database for the reader')
  })

  it('each kept municipality stores its seat: admin_centre, else label; the seat of a dropped relation goes with it', async () => {
    const { importAdminBoundaries, scanMunicipalSeats } = await import('../../lib/services/admin-boundaries')
    const { parsePoly } = await import('../../lib/services/local-osm-regions')
    const db = new Database(':memory:')
    const praia = line('relation', 5, { admin_level: '7', name: 'Praia da Vitória' }, { type: 'Polygon', coordinates: [sq({ lat: 38.73, lng: -27.06 }, 0.03)] })
    async function* opl() {
      yield 'r7448382 Tboundary=administrative,admin_level=7 Mw9@outer,n100@admin_centre,n101@label'
      yield 'r5 Tboundary=administrative,admin_level=7 Mw9@outer,n500@label'
      yield 'r1 Tboundary=administrative,admin_level=8 Mw9@outer,n200@admin_centre'
    }
    const r = await importAdminBoundaries(db, lines(ANGRA_LINE, praia, FREGUESIA_LINE, PORTUGAL_LINE), { region: parsePoly(POLY_PT), seatScan: await scanMunicipalSeats(opl()) })
    assert.deepEqual([r.kept, r.keptWithSeat, r.keptSeatedByLabel], [2, 2, 1])
    const rows = db.prepare('SELECT relation_id, seat_type, seat_id, role FROM admin_boundary_seats ORDER BY relation_id').all()
    assert.deepEqual(rows, [
      { relation_id: 5, seat_type: 'node', seat_id: 500, role: 'label' },
      { relation_id: 7448382, seat_type: 'node', seat_id: 100, role: 'admin_centre' },
    ])
  })

  it('a database from before the seats (admin_boundaries with name_norm) is rebuilt by the import', async () => {
    const { importAdminBoundaries } = await import('../../lib/services/admin-boundaries')
    const { parsePoly } = await import('../../lib/services/local-osm-regions')
    const db = new Database(':memory:')
    db.exec('CREATE TABLE admin_boundaries (osm_id INTEGER PRIMARY KEY, admin_level INTEGER NOT NULL, name TEXT NOT NULL, name_norm TEXT NOT NULL, geometry_geojson TEXT NOT NULL, min_lat REAL, max_lat REAL, min_lng REAL, max_lng REAL)')
    const r = await importAdminBoundaries(db, lines(ANGRA_LINE, PORTUGAL_LINE), { region: parsePoly(POLY_PT) })
    assert.equal(r.kept, 1)
    const columns = (db.prepare('PRAGMA table_info(admin_boundaries)').all() as Array<{ name: string }>).map(c => c.name)
    assert.ok(!columns.includes('name_norm'))
  })

  it('the municipal level is one table by ISO 3166-1 country: PT 7, DE/US/BR 8, an unlisted country 8', async () => {
    const { municipalityAdminLevel } = await import('../../lib/services/admin-boundaries')
    assert.equal(municipalityAdminLevel('PT'), 7)
    assert.equal(municipalityAdminLevel('pt'), 7)
    assert.equal(municipalityAdminLevel('DE'), 8)
    assert.equal(municipalityAdminLevel('US'), 8)
    assert.equal(municipalityAdminLevel('BR'), 8)
    assert.equal(municipalityAdminLevel('ZZ'), 8)
  })
})

describe('BR-POI-010 — a city outside the municipal level (Austrian Statutarstadt, Wien) is a municipality', () => {
  const AT: LatLng = { lat: 47.5, lng: 14 }
  const POLY_AT = `at\n1\n${sq(AT, 1).map(([x, y]) => `   ${x}   ${y}`).join('\n')}\nEND\nEND\n`
  const poly = (o: LatLng, d: number) => ({ type: 'Polygon', coordinates: [sq(o, d)] })
  const GRAZ: LatLng = { lat: 46.8, lng: 14.6 }
  const WIEN: LatLng = { lat: 48.2, lng: 14.6 }
  const STEIERMARK: LatLng = { lat: 47.3, lng: 14.0 }
  const BEZIRK: LatLng = { lat: 46.9, lng: 13.4 }
  const at = () => lines(
    line('relation', 16239, { admin_level: '2', name: 'Österreich', 'ISO3166-1': 'AT' }, poly(AT, 2)),
    line('relation', 35183, { admin_level: '4', name: 'Steiermark' }, poly(STEIERMARK, 0.3)),
    line('relation', 1, { admin_level: '8', name: 'Gemeinde in Steiermark' }, poly(STEIERMARK, 0.05)),
    line('relation', 109166, { admin_level: '4', name: 'Wien' }, poly(WIEN, 0.1)),
    line('relation', 9, { admin_level: '9', name: 'Innere Stadt' }, poly(WIEN, 0.02)),
    // The Gemeinde shares the Bezirk's south-west corner: the same nodes on both borders, one vertex inside.
    line('relation', 2, { admin_level: '6', name: 'Bezirk Murau' }, { type: 'Polygon', coordinates: [[[13.3, 46.8], [13.3, 47.0], [13.3, 47.2], [13.7, 47.2], [13.7, 46.8], [13.5, 46.8], [13.3, 46.8]]] }),
    line('relation', 3, { admin_level: '8', name: 'Murau' }, { type: 'Polygon', coordinates: [[[13.3, 46.8], [13.3, 47.0], [13.5, 47.0], [13.5, 46.8], [13.3, 46.8]]] }),
    line('relation', 34719, { admin_level: '6', name: 'Graz' }, poly(GRAZ, 0.1)),
    // A neighbour wrapped around Graz (U-shaped): its bbox centre is inside Graz, its border is not.
    line('relation', 5, { admin_level: '8', name: 'Rum' }, { type: 'Polygon', coordinates: [[[14.45, 46.65], [14.75, 46.65], [14.75, 46.95], [14.72, 46.95], [14.72, 46.68], [14.48, 46.68], [14.48, 46.95], [14.45, 46.95], [14.45, 46.65]]] }),
  )
  // Graz is the seat of its own relation AND of the state; the Bezirk is seated at its main Gemeinde.
  const seats = new Map([
    [35183, [{ type: 'node' as const, id: 20, role: 'admin_centre' as const }]],
    [34719, [{ type: 'node' as const, id: 20, role: 'admin_centre' as const }]],
    [109166, [{ type: 'node' as const, id: 10, role: 'admin_centre' as const }]],
    [2, [{ type: 'node' as const, id: 30, role: 'admin_centre' as const }]],
    [3, [{ type: 'node' as const, id: 30, role: 'admin_centre' as const }]],
    [1, [{ type: 'node' as const, id: 40, role: 'admin_centre' as const }]],
  ])

  it('AT keeps the level-6/4 relations with no level-8 relation inside (Graz, Wien; a neighbour wrapped around is not inside), drops the ones that group Gemeinden', async () => {
    const { importAdminBoundaries } = await import('../../lib/services/admin-boundaries')
    const { parsePoly } = await import('../../lib/services/local-osm-regions')
    const db = new Database(':memory:')
    const r = await importAdminBoundaries(db, at(), { region: parsePoly(POLY_AT), seatScan: { seated: new Set(), seats } })
    assert.equal(r.level, 8)
    assert.deepEqual(r.standaloneByLevel, { 4: 1, 6: 1 })
    const ids = (db.prepare('SELECT osm_id FROM admin_boundaries ORDER BY osm_id').all() as any[]).map(x => x.osm_id)
    assert.deepEqual(ids, [1, 3, 5, 34719, 109166])
  })

  it('the seat of the city takes its own border; the seat of a state or a Bezirk never does', async () => {
    const { importAdminBoundaries, findMunicipality } = await import('../../lib/services/admin-boundaries')
    const { parsePoly } = await import('../../lib/services/local-osm-regions')
    const db = new Database(':memory:')
    await importAdminBoundaries(db, at(), { region: parsePoly(POLY_AT), seatScan: { seated: new Set(), seats } })
    assert.equal(findMunicipality(db, GRAZ, { osm_type: 'node', osm_id: 20 })?.name, 'Graz')
    assert.equal(findMunicipality(db, WIEN, { osm_type: 'node', osm_id: 10 })?.name, 'Wien')
    assert.equal(findMunicipality(db, STEIERMARK, { osm_type: 'node', osm_id: 20 }), null, 'the state seat outside Graz')
    assert.equal(findMunicipality(db, BEZIRK, { osm_type: 'node', osm_id: 30 })?.name, 'Murau', 'the Gemeinde, not the Bezirk')
  })

  it('Portugal has no standalone level: a level-6 relation without children stays out', async () => {
    const { importAdminBoundaries, municipalityAdminLevels } = await import('../../lib/services/admin-boundaries')
    const { parsePoly } = await import('../../lib/services/local-osm-regions')
    assert.deepEqual(municipalityAdminLevels('PT'), [7])
    assert.deepEqual(municipalityAdminLevels('at'), [8, 6, 4])
    const db = new Database(':memory:')
    const distrito = line('relation', 4, { admin_level: '6', name: 'Distrito' }, { type: 'Polygon', coordinates: [sq({ lat: 39, lng: -27.5 }, 0.05)] })
    const r = await importAdminBoundaries(db, lines(ANGRA_LINE, distrito, PORTUGAL_LINE), { region: parsePoly(POLY_PT) })
    assert.deepEqual([r.kept, r.standaloneByLevel], [1, {}])
  })
})

describe('BR-POI-010 — Praha is kraj and obec in one level-4 relation, and is a municipality', () => {
  const CZ: LatLng = { lat: 49.8, lng: 15.5 }
  const POLY_CZ = `cz\n1\n${sq(CZ, 1.5).map(([x, y]) => `   ${x}   ${y}`).join('\n')}\nEND\nEND\n`
  const poly = (o: LatLng, d: number) => ({ type: 'Polygon', coordinates: [sq(o, d)] })
  const PRAHA: LatLng = { lat: 50.08, lng: 14.43 }
  const BRNO: LatLng = { lat: 49.2, lng: 16.6 }
  const JMK: LatLng = { lat: 49.0, lng: 16.6 }
  const cz = () => lines(
    line('relation', 51684, { admin_level: '2', name: 'Česko', 'ISO3166-1': 'CZ' }, poly(CZ, 2)),
    line('relation', 435514, { admin_level: '4', name: 'Praha', 'ISO3166-2': 'CZ-10' }, poly(PRAHA, 0.15)),
    line('relation', 15107966, { admin_level: '9', name: 'Praha 1' }, poly(PRAHA, 0.02)),
    line('relation', 442311, { admin_level: '4', name: 'Jihomoravský kraj' }, poly(JMK, 0.5)),
    line('relation', 438171, { admin_level: '8', name: 'Brno' }, poly(BRNO, 0.1)),
  )
  const seats = new Map([
    [435514, [{ type: 'node' as const, id: 1601837931, role: 'admin_centre' as const }]],
    [438171, [{ type: 'node' as const, id: 1601523251, role: 'admin_centre' as const }]],
    [442311, [{ type: 'node' as const, id: 1601523251, role: 'admin_centre' as const }]],
  ])

  it('CZ keeps Praha (level 4, no obec inside) and Brno (8), drops the kraj that groups obce', async () => {
    const { importAdminBoundaries, findMunicipality, municipalityAdminLevels } = await import('../../lib/services/admin-boundaries')
    const { parsePoly } = await import('../../lib/services/local-osm-regions')
    assert.deepEqual(municipalityAdminLevels('CZ'), [8, 4])
    const db = new Database(':memory:')
    const r = await importAdminBoundaries(db, cz(), { region: parsePoly(POLY_CZ), seatScan: { seated: new Set(), seats } })
    assert.equal(r.level, 8)
    assert.deepEqual(r.standaloneByLevel, { 4: 1 })
    assert.equal(findMunicipality(db, PRAHA, { osm_type: 'node', osm_id: 1601837931 })?.name, 'Praha')
    assert.equal(findMunicipality(db, BRNO, { osm_type: 'node', osm_id: 1601523251 })?.name, 'Brno', 'the statutory city, not its kraj')
  })
})

describe('BR-POI-010 — the country is read from the extract, never configured', () => {
  it('the admin_level=2 relation holding the region wins over the neighbour the extract also carries', async () => {
    const { importAdminBoundaries } = await import('../../lib/services/admin-boundaries')
    const { parsePoly } = await import('../../lib/services/local-osm-regions')
    const r = await importAdminBoundaries(new Database(':memory:'), lines(SPAIN_LINE, ANGRA_LINE, PORTUGAL_LINE), { region: parsePoly(POLY_PT) })
    assert.equal(r.country, 'PT')
    assert.equal(r.countrySource, 'admin_level=2')
  })

  it('a sub-national extract without its country relation: the ISO3166-2 prefix of its subdivisions ("US-RI" → US)', async () => {
    const { importAdminBoundaries, regionCountry } = await import('../../lib/services/admin-boundaries')
    const { parsePoly } = await import('../../lib/services/local-osm-regions')
    const db = new Database(':memory:')
    const state = line('relation', 392915, { admin_level: '4', name: 'Rhode Island', 'ISO3166-2': 'US-RI' }, { type: 'Polygon', coordinates: [sq(ANGRA, 0.5)] })
    const town = line('relation', 10, { admin_level: '8', name: 'Newport' }, { type: 'Polygon', coordinates: [sq(ANGRA, 0.02)] })
    const r = await importAdminBoundaries(db, lines(state, town, ANGRA_LINE), { region: parsePoly(POLY_PT) })
    assert.deepEqual([r.country, r.countrySource, r.level, r.kept], ['US', 'ISO3166-2', 8, 1])
    assert.equal(regionCountry(db), 'US')
  })

  it('no country in the extract: municipal mode off, nothing kept, and a country from a previous import is cleared', async () => {
    const { importAdminBoundaries, regionCountry } = await import('../../lib/services/admin-boundaries')
    const { parsePoly } = await import('../../lib/services/local-osm-regions')
    const db = new Database(':memory:')
    await importAdminBoundaries(db, lines(ANGRA_LINE, PORTUGAL_LINE), { region: parsePoly(POLY_PT) })
    const r = await importAdminBoundaries(db, lines(ANGRA_LINE, FREGUESIA_LINE), { region: parsePoly(POLY_PT) })
    assert.deepEqual([r.country, r.level, r.kept], [null, null, 0])
    assert.equal(regionCountry(db), null)
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM admin_boundaries').get() as any).n, 0)
  })
})

describe('BR-POI-010 — seat check at import: a hint for the human, never a switch', () => {
  it('a relation has a seat by its own place tag or by an admin_centre/label node with place=city|town|village', async () => {
    const { scanMunicipalSeats } = await import('../../lib/services/admin-boundaries')
    const opl = [
      'n1 Tplace=town,name=Angra x-27.2 y38.6',
      'n2 Tplace=suburb,name=Sé x-27.2 y38.6',
      'n3 Tplace=village,name=Cinco%20%Ribeiras x-27.3 y38.6',
      'w9 Tboundary=administrative Nn4,n5',
      'r7 Tboundary=administrative,admin_level=7 Mw9@outer,n1@admin_centre',
      'r8 Tboundary=administrative,admin_level=8 Mw9@outer,n2@admin_centre',
      'r9 Tboundary=administrative,admin_level=8 Mw9@outer,n3@label',
      'r10 Tboundary=administrative,admin_level=9,place=village Mw9@outer',
      'r11 Tboundary=administrative,admin_level=8 Mw9@outer,n3@subarea',
    ]
    async function* plain() { yield* opl }
    assert.deepEqual([...(await scanMunicipalSeats(plain())).seated].sort((a, b) => a - b), [7, 9, 10])
  })

  it('the seat members read for the POI matching: admin_centre of any type, label only without admin_centre, whatever the tags', async () => {
    const { scanMunicipalSeats } = await import('../../lib/services/admin-boundaries')
    async function* opl() {
      yield 'n1 Tplace=town x-27.2 y38.6'
      yield 'r7 Tboundary=administrative,admin_level=7 Mw9@outer,w44@admin_centre,n1@label'
      yield 'r8 Tboundary=administrative,admin_level=7 Mw9@outer,n3@label'
      yield 'r9 Tboundary=administrative,admin_level=7 Mw9@outer,n3@subarea'
    }
    const { seats } = await scanMunicipalSeats(opl())
    assert.deepEqual(seats.get(7), [{ type: 'way', id: 44, role: 'admin_centre' }])
    assert.deepEqual(seats.get(8), [{ type: 'node', id: 3, role: 'label' }])
    assert.equal(seats.has(9), false)
  })

  it('warns when few relations at the table level have a seat and the seats sit at another level', async () => {
    const { seatLevelWarning } = await import('../../lib/services/admin-boundaries')
    const w = seatLevelWarning({ country: 'XX', level: 8, byLevel: { 7: 300, 8: 40 }, seatsByLevel: { 7: 298, 8: 3 } })
    assert.match(w ?? '', /admin_level 8 from the table for XX.*mostly at level 7/)
  })

  it('no warning when the table level is seated, even if a seated sub-municipal level outnumbers it (Portugal, measured)', async () => {
    const { seatLevelWarning } = await import('../../lib/services/admin-boundaries')
    assert.equal(seatLevelWarning({ country: 'PT', level: 7, byLevel: { 6: 18, 7: 308, 8: 3258 }, seatsByLevel: { 6: 18, 7: 308, 8: 3174 } }), null)
    assert.equal(seatLevelWarning({ country: 'PT', level: 7, byLevel: { 7: 308 }, seatsByLevel: {} }), null, 'no seat data at all')
  })
})

describe('BR-POI-010 — the POI whose OSM element is the seat of its municipality, pin inside, matches it', () => {
  it('the seat node takes the relation of Angra; a pin in the islet too; in the enclave or outside, no', async () => {
    const { LocalOSMFetcher } = await import('../../lib/services/trigger-points-google/services/local-osm-fetcher')
    const f = LocalOSMFetcher.getInstance()
    assert.equal(f.municipalityAt(ANGRA, ANGRA_SEAT)?.osmId, 7448382)
    assert.equal(f.municipalityAt(ANGRA, { osm_type: 'node', osm_id: 100 })?.osmId, 7448382, 'osm_id as number or text')
    assert.equal(f.municipalityAt(ISLET, ANGRA_SEAT)?.osmId, 7448382)
    assert.equal(f.municipalityAt({ lat: 38.68, lng: -27.24 }, ANGRA_SEAT), null, 'enclave')
    assert.equal(f.municipalityAt({ lat: 38.75, lng: -27.218 }, ANGRA_SEAT), null, 'outside')
  })

  it('the same id with another type, another element in the same place (a cable-car station), or no osm_id: no', async () => {
    const { LocalOSMFetcher } = await import('../../lib/services/trigger-points-google/services/local-osm-fetcher')
    const f = LocalOSMFetcher.getInstance()
    assert.equal(f.municipalityAt(ANGRA, { osm_type: 'way', osm_id: 100 }), null)
    assert.equal(f.municipalityAt(ANGRA, { osm_type: 'way', osm_id: 110361614 }), null)
    assert.equal(f.municipalityAt(ANGRA, {}), null)
    assert.equal(f.municipalityAt(ANGRA, { osm_type: 'node', osm_id: null }), null)
  })

  it('a name never matches: "Município de Angra do Heroísmo" without the seat element stays out', async () => {
    const { BoundaryDetector } = await import('../../lib/services/trigger-points-google/core/boundary-detector')
    stored = null
    const d = new BoundaryDetector()
    assert.equal(await d.municipalityBoundary(poi('angra', 'Município de Angra do Heroísmo', ANGRA)), null)
    assert.equal(await d.municipalityBoundary(poi('angra', 'Angra do Heroísmo', ANGRA, { osm_type: 'way', osm_id: 110361614 })), null)
  })

  it('the seat of a freguesia (level 8) never matches', async () => {
    const { LocalOSMFetcher } = await import('../../lib/services/trigger-points-google/services/local-osm-fetcher')
    assert.equal(LocalOSMFetcher.getInstance().municipalityAt(ANGRA, SE_SEAT), null)
  })

  it('a region whose import found no country: nothing changes, even with the same borders and seats on disk', async () => {
    const { LocalOSMFetcher } = await import('../../lib/services/trigger-points-google/services/local-osm-fetcher')
    assert.equal(LocalOSMFetcher.getInstance().municipalityAt(ELSEWHERE, ANGRA_SEAT), null)
  })

  it('detection: the border becomes the municipality, osm_admin, every part, not curated (the pipeline writes it)', async () => {
    stored = null
    const { BoundaryDetector } = await import('../../lib/services/trigger-points-google/core/boundary-detector')
    const r = await new BoundaryDetector().detectBoundary({ id: 'angra', name: 'Angra do Heroísmo', location: ANGRA, ...ANGRA_SEAT } as any)
    assert.equal(r.data?.source, 'osm_admin')
    assert.equal(r.data?.adminParts?.length, 2)
    assert.equal(r.data?.curated, false)
    assert.equal(r.metadata?.strategy, 'osm_admin_municipality')
  })

  it('the pipeline saves an osm_admin border with every part (MultiPolygon), any other as one Polygon', async () => {
    const { boundaryGeoJson } = await import('../../lib/services/trigger-points-google/utils/boundary-choice')
    const { BoundaryDetector } = await import('../../lib/services/trigger-points-google/core/boundary-detector')
    stored = null
    const b = (await new BoundaryDetector().municipalityBoundary({ location: ANGRA, ...ANGRA_SEAT }))!
    const g = boundaryGeoJson(b) as { type: string; coordinates: number[][][][] }
    assert.equal(g.type, 'MultiPolygon')
    assert.equal(g.coordinates.length, 2)
    for (const [ring] of g.coordinates) assert.deepEqual(ring[0], ring[ring.length - 1], 'closed')
    assert.equal(boundaryGeoJson({ coordinates: b.coordinates }).type, 'Polygon')
  })

  it('a border a person curated, not administrative, wins over the seat', async () => {
    stored = { geojson: FREGUESIA_GEOMETRY, boundary_source: 'manual_drawing', boundary_confidence: 1 }
    const { BoundaryDetector } = await import('../../lib/services/trigger-points-google/core/boundary-detector')
    assert.equal(await new BoundaryDetector().adminBoundaryOf({ id: 'angra', location: ANGRA, ...ANGRA_SEAT }), null)
    stored = null
  })
})

describe('BR-POI-010 — a municipal border reads no relief', () => {
  it('osm_admin (detected or stored): ensureDemCell is never called; any other POI still prepares its relief', async () => {
    const { CoreTriggerPointPredictor } = await import('../../lib/services/trigger-points-google/core/trigger-point-predictor')
    const predictor = new CoreTriggerPointPredictor()
    ensureDemCellCalls = 0
    stored = null
    const detected = await predictor.predictTriggerPointsComplete(poi('angra', 'Angra do Heroísmo', ANGRA, ANGRA_SEAT))
    assert.equal(detected.boundary?.source, 'osm_admin')
    stored = { geojson: ANGRA_GEOMETRY, boundary_source: 'osm_admin', boundary_confidence: 0.9 }
    const kept = await predictor.predictTriggerPointsComplete(poi('angra', 'Angra (renamed)', ANGRA))
    assert.equal(kept.boundary?.source, 'osm_admin')
    assert.equal(ensureDemCellCalls, 0)
    stored = null
    await assert.rejects(predictor.predictTriggerPointsComplete(poi('se', 'Sé Catedral', ANGRA)), /relief prepared/)
    assert.equal(ensureDemCellCalls, 1)
  })
})
