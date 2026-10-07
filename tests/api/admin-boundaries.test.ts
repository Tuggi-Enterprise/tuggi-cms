/**
 * BR-POI-010 — municipal borders from the local OSM: the region's country is read from the extract,
 * the municipal admin_level comes from one table by country (Portugal: 7, default 8), and the
 * borders are imported whole and inside the region's `.poly`; a POI named after the municipality
 * its pin stands in takes that border as `osm_admin`, and an `osm_admin` POI reads no relief.
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
const poi = (id: string, name: string, location: LatLng) => ({ id, name, location, type: 'attraction', country: 'Portugal', city: 'Angra do Heroísmo' }) as any
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
    await db.importAdminBoundaries(lines(...ll), { region: parsePoly(polyText) })
    db.close()
    // Rows on disk in both, whatever the import kept: the lookup must refuse the freguesia by its
    // level, and `zz` (no country) by the missing country, not by absence.
    const raw = new Database(path.join(dir, `${region}.db`))
    const bbox = [at.lat - 1, at.lat + 1, at.lng - 1, at.lng + 1]
    raw.prepare(`INSERT OR REPLACE INTO admin_boundaries VALUES (7448382, 7, 'Angra do Heroísmo', 'angra do heroismo', ?, ?, ?, ?, ?)`).run(JSON.stringify(shift(ANGRA_GEOMETRY)), ...bbox)
    raw.prepare(`INSERT OR REPLACE INTO admin_boundaries VALUES (1, 8, 'Sé', 'se', ?, ?, ?, ?, ?)`).run(JSON.stringify(shift(FREGUESIA_GEOMETRY)), ...bbox)
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
    assert.deepEqual(r, { country: 'PT', countrySource: 'admin_level=2', level: 7, byLevel: { 7: 1, 8: 1 }, seatsByLevel: {}, kept: 1, outsideRegion: 1 })
    const rows = db.prepare('SELECT osm_id, admin_level, name, geometry_geojson FROM admin_boundaries').all() as any[]
    assert.equal(rows.length, 1)
    assert.equal(rows[0].osm_id, 7448382)
    assert.deepEqual(JSON.parse(rows[0].geometry_geojson), ANGRA_GEOMETRY, 'MultiPolygon with its hole, untouched')
    assert.equal(regionCountry(db), 'PT', 'the country is written into the region database for the reader')
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
    assert.deepEqual([...await scanMunicipalSeats(plain())].sort((a, b) => a - b), [7, 9, 10])
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

describe('BR-POI-010 — a POI named after its municipality, with the pin inside, matches it', () => {
  it('"Município de"/"Concelho de" are dropped, accents and case ignored; "Câmara Municipal de" is the town hall', async () => {
    const { normalizeMunicipalityName: n } = await import('../../lib/services/admin-boundaries')
    assert.equal(n('Município de Angra do Heroísmo'), n('Angra do Heroísmo'))
    assert.equal(n('Concelho da Horta'), 'horta')
    assert.equal(n('MUNICIPIO DO PORTO'), 'porto')
    assert.notEqual(n('Câmara Municipal de Lisboa'), n('Lisboa'))
  })

  it('"Município de Angra do Heroísmo" takes the relation of Angra; a pin in the islet too; in the enclave or outside, no', async () => {
    const { LocalOSMFetcher } = await import('../../lib/services/trigger-points-google/services/local-osm-fetcher')
    const f = LocalOSMFetcher.getInstance()
    assert.equal(f.municipalityAt(ANGRA, 'Município de Angra do Heroísmo')?.osmId, 7448382)
    assert.equal(f.municipalityAt(ISLET, 'Município de Angra do Heroísmo')?.osmId, 7448382)
    assert.equal(f.municipalityAt({ lat: 38.68, lng: -27.24 }, 'Município de Angra do Heroísmo'), null, 'enclave')
    assert.equal(f.municipalityAt({ lat: 38.75, lng: -27.218 }, 'Município de Angra do Heroísmo'), null, 'outside')
  })

  it('a freguesia (level 8) never matches, nor a POI not named after the municipality', async () => {
    const { LocalOSMFetcher } = await import('../../lib/services/trigger-points-google/services/local-osm-fetcher')
    const f = LocalOSMFetcher.getInstance()
    assert.equal(f.municipalityAt(ANGRA, 'Sé'), null)
    assert.equal(f.municipalityAt(ANGRA, 'Sé Catedral de Angra do Heroísmo'), null)
  })

  it('a region whose import found no country: nothing changes, even with the same borders on disk', async () => {
    const { LocalOSMFetcher } = await import('../../lib/services/trigger-points-google/services/local-osm-fetcher')
    assert.equal(LocalOSMFetcher.getInstance().municipalityAt(ELSEWHERE, 'Angra do Heroísmo'), null)
  })

  it('detection: the border becomes the municipality, osm_admin, every part, not curated (the pipeline writes it)', async () => {
    stored = null
    const { BoundaryDetector } = await import('../../lib/services/trigger-points-google/core/boundary-detector')
    const r = await new BoundaryDetector().detectBoundary({ id: 'angra', name: 'Município de Angra do Heroísmo', location: ANGRA } as any)
    assert.equal(r.data?.source, 'osm_admin')
    assert.equal(r.data?.adminParts?.length, 2)
    assert.equal(r.data?.curated, false)
    assert.equal(r.metadata?.strategy, 'osm_admin_municipality')
  })

  it('the pipeline saves an osm_admin border with every part (MultiPolygon), any other as one Polygon', async () => {
    const { boundaryGeoJson } = await import('../../lib/services/trigger-points-google/utils/boundary-choice')
    const { BoundaryDetector } = await import('../../lib/services/trigger-points-google/core/boundary-detector')
    stored = null
    const b = (await new BoundaryDetector().municipalityBoundary({ name: 'Angra do Heroísmo', location: ANGRA }))!
    const g = boundaryGeoJson(b) as { type: string; coordinates: number[][][][] }
    assert.equal(g.type, 'MultiPolygon')
    assert.equal(g.coordinates.length, 2)
    for (const [ring] of g.coordinates) assert.deepEqual(ring[0], ring[ring.length - 1], 'closed')
    assert.equal(boundaryGeoJson({ coordinates: b.coordinates }).type, 'Polygon')
  })

  it('a border a person curated, not administrative, wins over the name', async () => {
    stored = { geojson: FREGUESIA_GEOMETRY, boundary_source: 'manual_drawing', boundary_confidence: 1 }
    const { BoundaryDetector } = await import('../../lib/services/trigger-points-google/core/boundary-detector')
    assert.equal(await new BoundaryDetector().adminBoundaryOf({ id: 'angra', name: 'Município de Angra do Heroísmo', location: ANGRA }), null)
    stored = null
  })
})

describe('BR-POI-010 — a municipal border reads no relief', () => {
  it('osm_admin (detected or stored): ensureDemCell is never called; any other POI still prepares its relief', async () => {
    const { CoreTriggerPointPredictor } = await import('../../lib/services/trigger-points-google/core/trigger-point-predictor')
    const predictor = new CoreTriggerPointPredictor()
    ensureDemCellCalls = 0
    stored = null
    const detected = await predictor.predictTriggerPointsComplete(poi('angra', 'Município de Angra do Heroísmo', ANGRA))
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
