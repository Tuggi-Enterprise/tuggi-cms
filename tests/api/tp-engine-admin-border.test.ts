/**
 * Municipal border mode — BR-POI-009, exception decided by the operator on 2026-10-07.
 *
 * A POI whose stored border is an OSM administrative boundary (`boundary_source = 'osm_admin'`)
 * gets one TP on each main road crossing the border, ~150 m inside, radius 150 m; small and
 * private ways carry none, and a dual carriageway is one entry. Every TP faces the POI pin
 * (BR-POI-010, operator 2026-10-07), whatever the road's direction.
 */
import { describe, it, mock, before } from 'node:test'
import assert from 'node:assert/strict'
import type { StreetData } from '../../lib/services/trigger-points-google/types/interfaces'

type LatLng = { lat: number; lng: number }
const C: LatLng = { lat: 38.65, lng: -27.22 }
const M_LAT = 1 / 111_320
const M_LNG = 1 / (111_320 * Math.cos((C.lat * Math.PI) / 180))
/** Point `eastM` east and `northM` north of `o`. */
const at = (eastM: number, northM: number, o: LatLng = C): LatLng => ({ lat: o.lat + northM * M_LAT, lng: o.lng + eastM * M_LNG })
/** Ring of a square of `half` metres around `o`. */
const square = (half: number, o: LatLng = C): LatLng[] => [at(-half, -half, o), at(-half, half, o), at(half, half, o), at(half, -half, o)]
const way = (id: string, type: string, pts: LatLng[], tags: Record<string, unknown> = {}): StreetData =>
  ({ id, type, name: id, coordinates: pts, accessibility: 'public', confidence: 0.9, tags } as StreetData)

const HALF = 1_500
const MUNICIPALITY = square(HALF)

async function engine() {
  const mod = await import('../../lib/services/trigger-points-google/utils/admin-border-tps')
  const calc = await import('../../lib/services/trigger-points-google/utils/calculations')
  const edgeM = (p: LatLng, ring: LatLng[]) =>
    Math.min(...ring.map((a, i) => calc.calculateDistanceToLineSegment(p, a, ring[(i + 1) % ring.length])))
  return { ...mod, ...calc, edgeM }
}

/**
 * Motorway entering from the west (split into two ways 20 m inside the border, as OSM splits at a
 * tag change), residential entering from the north, and a dual carriageway of trunk entering from
 * the east: the inbound carriageway runs west, the outbound one runs east 30 m south of it.
 */
const ROADS: StreetData[] = [
  way('motorway_a', 'motorway', [at(-HALF - 1_000, 600), at(-HALF + 20, 600)]),
  way('motorway_b', 'motorway', [at(-HALF + 20, 600), at(-200, 600)]),
  way('residential', 'residential', [at(0, HALF + 800), at(0, HALF - 600)]),
  way('trunk_in', 'trunk', [at(HALF + 1_000, -600), at(200, -600)], { oneway: 'yes' }),
  way('trunk_out', 'trunk', [at(200, -630), at(HALF + 1_000, -630)], { oneway: 'yes' }),
]

describe('BR-POI-009 — municipal border: one TP per main road entering the municipality', () => {
  it('3 roads cross the border → 2 TPs: residential skipped, dual carriageway deduplicated', async () => {
    const e = await engine()
    const tps = e.adminBorderTriggerPoints('poi', C, [MUNICIPALITY], ROADS)
    assert.equal(tps.length, 2, tps.map(t => t.street.id).join(', '))
    assert.deepEqual(tps.map(t => t.street.type).sort(), ['motorway', 'trunk'])
  })

  it('BR-POI-010: an island municipality is entered by ferry — the route crossing its coast carries the TP (Vila do Corvo)', async () => {
    const e = await engine()
    const ferry = way('f1', 'ferry', [at(0, -HALF - 3_000), at(0, -HALF + 600)])
    const tps = e.adminBorderTriggerPoints('poi', C, [MUNICIPALITY], [ferry])
    assert.equal(tps.length, 1)
    assert.equal(tps[0].street.type, 'ferry')
  })

  it('BR-POI-010: a ferry ending at the pier 20 m off the coast gets one TP out at sea, ~300 m along the route, facing the pin', async () => {
    const e = await engine()
    // Route from the south, bending once, ending 20 m south of the coast (the polygon follows the coastline).
    const ferry = way('f_corvo', 'ferry', [at(-2_000, -HALF - 5_000), at(0, -HALF - 1_000), at(0, -HALF - 20)])
    const tps = e.adminBorderTriggerPoints('poi', C, [MUNICIPALITY], [ferry])
    assert.equal(tps.length, 1)
    const tp = tps[0]
    assert.equal(tp.generationMethod, e.ADMIN_BORDER_SEA_METHOD)
    assert.ok(!e.isPointInPolygon(tp.location, MUNICIPALITY), 'out at sea')
    const d = e.edgeM(tp.location, MUNICIPALITY)
    assert.ok(Math.abs(d - 320) <= 5, `${d.toFixed(1)} m from the border`)
    assert.ok(Math.abs(tp.distance - d) <= 1, 'distance carries the edge distance')
    assert.ok(Math.abs(tp.expectedBearing) < 1 || Math.abs(tp.expectedBearing - 360) < 1, `bearing ${tp.expectedBearing}: north, to the pin`)
    assert.equal(tp.radius, 150)
  })

  it('BR-POI-010: two ferry routes ending at the same pier are two arrivals, a split route is one (Santa Cruz da Graciosa)', async () => {
    const e = await engine()
    const pier = at(0, -HALF - 20)
    const fromWest = way('Velas – Graciosa', 'ferry', [at(-6_000, -HALF - 3_000), pier])
    const fromEast = way('Graciosa – Praia da Vitória', 'ferry', [at(6_000, -HALF - 3_000), pier])
    assert.equal(e.adminBorderTriggerPoints('poi', C, [MUNICIPALITY], [fromWest, fromEast]).length, 2)
    // the same route split by OSM in two ways at a node out at sea: the node is not a pier
    const a = way('Linha', 'ferry', [at(0, -HALF - 6_000), at(0, -HALF - 2_000)])
    const b = way('Linha', 'ferry', [at(0, -HALF - 2_000), pier])
    assert.equal(e.adminBorderTriggerPoints('poi', C, [MUNICIPALITY], [a, b]).length, 1)
  })

  it('BR-POI-010: a ferry ending far from the coast (the other island) gives no sea TP', async () => {
    const e = await engine()
    const ferry = way('f_far', 'ferry', [at(0, -HALF - 5_000), at(0, -HALF - 400)])
    assert.equal(e.adminBorderTriggerPoints('poi', C, [MUNICIPALITY], [ferry]).length, 0)
  })

  it('each TP stands inside the border, ~150 m from it along the road, radius 150 m', async () => {
    const e = await engine()
    for (const tp of e.adminBorderTriggerPoints('poi', C, [MUNICIPALITY], ROADS)) {
      assert.ok(e.isPointInPolygon(tp.location, MUNICIPALITY), `${tp.street.id} inside`)
      const d = e.edgeM(tp.location, MUNICIPALITY)
      assert.ok(Math.abs(d - e.ADMIN_BORDER_TP_INSET_M) <= 5, `${tp.street.id}: ${d.toFixed(1)} m from the border`)
      assert.equal(tp.radius, 150)
      assert.equal(tp.type, 'primary')
    }
  })

  it('the TP walks on across a way split near the border', async () => {
    const e = await engine()
    const mw = e.adminBorderTriggerPoints('poi', C, [MUNICIPALITY], ROADS).find(t => t.street.type === 'motorway')!
    assert.equal(mw.street.id, 'motorway_a', 'the crossing is on the way outside the split')
    assert.ok(e.calculateDistance(mw.location, at(-HALF + 150, 600)) <= 5, 'on the road, 150 m in')
  })

  it('BR-POI-010: every road TP faces the POI pin (±1°), not the road — a reversed oneway included', async () => {
    const e = await engine()
    const pin = at(400, 300) // off the polygon centre, as a town pin usually is
    // oneway drawn against the entry (OSM error, or the outbound carriageway alone): bearing still to the pin
    const reversed = way('reversed', 'primary', [at(0, -HALF + 600), at(0, -HALF - 1_000)], { oneway: 'yes' })
    const tps = e.adminBorderTriggerPoints('poi', pin, [MUNICIPALITY], [...ROADS, reversed])
    assert.equal(tps.length, 3)
    for (const tp of tps) {
      const want = e.calculateBearing(tp.location, pin)
      const diff = Math.abs(((tp.expectedBearing - want + 540) % 360) - 180)
      assert.ok(diff <= 1, `${tp.street.id}: bearing ${tp.expectedBearing.toFixed(1)}, pin at ${want.toFixed(1)}`)
    }
    // the motorway runs east at y=600 but the pin is south-east of its TP
    const mw = tps.find(t => t.street.type === 'motorway')!
    assert.ok(mw.expectedBearing > 95 && mw.expectedBearing < 180, `bearing ${mw.expectedBearing}`)
  })

  it('BR-POI-010: the sea TP faces the pin, not the ferry route', async () => {
    const e = await engine()
    const pin = at(-800, 900)
    // route from the south-east, ending 20 m off the south coast
    const ferry = way('f_sea', 'ferry', [at(4_000, -HALF - 4_000), at(0, -HALF - 20)])
    const [tp] = e.adminBorderTriggerPoints('poi', pin, [MUNICIPALITY], [ferry])
    assert.equal(tp.generationMethod, e.ADMIN_BORDER_SEA_METHOD)
    const want = e.calculateBearing(tp.location, pin)
    assert.ok(Math.abs(((tp.expectedBearing - want + 540) % 360) - 180) <= 1, `bearing ${tp.expectedBearing}, pin at ${want}`)
    const toPier = e.calculateBearing(tp.location, at(0, -HALF - 20))
    assert.ok(Math.abs(tp.expectedBearing - toPier) > 10, `the route heading (${toPier.toFixed(1)}) is not what is stored`)
  })

  it('of a dual carriageway, the inbound carriageway keeps the TP; TPs of a POI stay ≥ 300 m apart', async () => {
    const e = await engine()
    const tps = e.adminBorderTriggerPoints('poi', C, [MUNICIPALITY], ROADS)
    const trunk = tps.find(t => t.street.type === 'trunk')!
    assert.equal(trunk.street.id, 'trunk_in')
    for (const a of tps) for (const b of tps) {
      if (a !== b) assert.ok(e.calculateDistance(a.location, b.location) >= e.ADMIN_BORDER_TP_MIN_SPACING_M)
    }
  })

  it('every polygon part counts: a road entering an island part gets its TP there', async () => {
    const e = await engine()
    const islandCentre = at(8_000, 0)
    const island = square(800, islandCentre)
    const road = way('island_primary', 'primary', [at(-1_500, 0, islandCentre), at(0, 0, islandCentre)])
    const tps = e.adminBorderTriggerPoints('poi', C, [MUNICIPALITY, island], [...ROADS, road])
    const tp = tps.find(t => t.street.id === 'island_primary')
    assert.ok(tp && e.isPointInPolygon(tp.location, island))
    assert.equal(tps.length, 3)
  })

  it('a road leaving the municipality again before the inset gives no TP', async () => {
    const e = await engine()
    const clip = way('corner', 'primary', [at(-HALF - 200, HALF - 50), at(-HALF + 50, HALF - 50), at(-HALF + 50, HALF + 200)])
    assert.equal(e.adminBorderTriggerPoints('poi', C, [MUNICIPALITY], [clip]).length, 0)
  })

  it('a road weaving along the border (crossing it every ~400 m) gives no TP: it skirts, it does not enter', async () => {
    const e = await engine()
    const zig = [-1_200, -800, -400, 0, 400, 800, 1_200].map((n, i) => at(-HALF + (i % 2 ? 40 : -40), n))
    assert.equal(e.adminBorderTriggerPoints('poi', C, [MUNICIPALITY], [way('skirting', 'primary', zig)]).length, 0)
  })

  it('BR-POI-010: a road crossing a river border and following the bank before turning inland still enters (Aljezur, EN 120 at the Seixe)', async () => {
    const e = await engine()
    // Crosses the north border, runs 60 m inside along it for 250 m, then turns south.
    const bank = way('en120', 'primary', [at(-300, HALF + 500), at(-300, HALF - 60), at(-50, HALF - 60), at(-50, 0)])
    const tps = e.adminBorderTriggerPoints('poi', C, [MUNICIPALITY], [bank])
    assert.equal(tps.length, 1)
    assert.ok(e.edgeM(tps[0].location, MUNICIPALITY) >= e.ADMIN_BORDER_TP_MIN_EDGE_M, 'the TP slides inward until the road has entered')
    assert.ok(e.calculateDistance(tps[0].location, at(-300, HALF)) <= e.ADMIN_BORDER_ENTRY_PROBE_M, 'never farther than the probe')
  })

  it('BR-POI-010: a road running along the border past the probe, never that deep, gives no TP', async () => {
    const e = await engine()
    const along = way('along', 'primary', [at(-1_200, HALF + 500), at(-1_200, HALF - 40), at(1_200, HALF - 40), at(1_200, HALF + 500)])
    assert.equal(e.adminBorderTriggerPoints('poi', C, [MUNICIPALITY], [along]).length, 0)
  })

  it('BR-POI-010: only the main road types and ferries carry a TP; every other border source leaves the mode off', async () => {
    const e = await engine()
    assert.deepEqual([...e.ADMIN_BORDER_ROAD_TYPES].sort(), [
      'motorway', 'motorway_link', 'primary', 'primary_link', 'secondary', 'secondary_link',
      'tertiary', 'tertiary_link', 'trunk', 'trunk_link', 'ferry'].sort())
    for (const source of ['osm', 'manual', 'manual_drawing', 'synthetic', 'estimated', 'dem_relief', 'unknown'] as const) {
      assert.equal(e.isAdminBorder({ source }), false, source)
    }
    assert.equal(e.isAdminBorder({ source: 'osm_admin' }), true)
  })
})

describe('BR-POI-009 — E11 keeps the municipal TP inside its border (save and dry-run alike)', () => {
  it('osm_admin: TPs inside any part are kept; the normal border drops the same TPs as inside the POI', async () => {
    const e = await engine()
    const { applyTpPostConditions } = await import('../../lib/services/trigger-points-google/utils/tp-selection')
    const island = square(800, at(8_000, 0))
    const road = way('island_primary', 'primary', [at(-1_500, 0, at(8_000, 0)), at(0, 0, at(8_000, 0))])
    const tps = e.adminBorderTriggerPoints('poi', C, [MUNICIPALITY, island], [...ROADS, road])
    const admin = applyTpPostConditions(tps, C, { source: 'osm_admin', coordinates: MUNICIPALITY, adminParts: [MUNICIPALITY, island] })
    assert.equal(admin.kept.length, 3)
    const normal = applyTpPostConditions(tps, C, { source: 'osm', coordinates: MUNICIPALITY })
    assert.ok(normal.dropped.some(d => d.reason === 'inside_poi'), 'the normal engine is unchanged')
  })

  it('BR-POI-010: osm_admin keeps the ferry sea TP outside the border; a road TP outside is still dropped', async () => {
    const e = await engine()
    const { applyTpPostConditions } = await import('../../lib/services/trigger-points-google/utils/tp-selection')
    const ferry = way('f_corvo', 'ferry', [at(0, -HALF - 5_000), at(0, -HALF - 20)])
    const [sea] = e.adminBorderTriggerPoints('poi', C, [MUNICIPALITY], [ferry])
    const road = { ...sea, id: 'road_out', generationMethod: 'local_osm' as const }
    const farSea = { ...sea, id: 'sea_far', location: at(0, -HALF - 1_500) }
    const r = applyTpPostConditions([sea, road, farSea], C, { source: 'osm_admin', coordinates: MUNICIPALITY, adminParts: [MUNICIPALITY] })
    assert.deepEqual(r.kept.map(t => t.id), [sea.id])
    assert.deepEqual(r.dropped.map(d => d.tp.id).sort(), ['road_out', 'sea_far'])
  })
})

// ---- the stored border, read back by `fetchBoundaryFromDatabase` ----

let dbRow: { geojson: unknown; boundary_source: string | null; boundary_confidence: number | null }

before(() => {
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabase: () => ({
        schema: () => ({
          rpc: async () => ({ data: dbRow.geojson, error: null }),
          from: () => ({
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    boundary_source: dbRow.boundary_source,
                    boundary_confidence: dbRow.boundary_confidence,
                    boundary_area_m2: 99_000_000,
                    latitude: C.lat,
                    longitude: C.lng,
                  },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    },
  })
})

const toGeo = (r: LatLng[]) => [[...r, r[0]].map(p => [p.lng, p.lat])]
const MULTI = { type: 'MultiPolygon', coordinates: [toGeo(MUNICIPALITY), toGeo(square(800, at(8_000, 0)))] }

async function read() {
  const { BoundaryDetector } = await import('../../lib/services/trigger-points-google/core/boundary-detector')
  const r = await new BoundaryDetector().fetchBoundaryFromDatabase('x')
  assert.equal(r.success, true, r.error ?? '')
  return r.data!
}

describe('BR-POI-009 — a stored osm_admin border keeps the mode on (detection by name: BR-POI-010, admin-boundaries.test)', () => {
  it('osm_admin: every part travels as adminParts, the border is curated (never written over by the batch)', async () => {
    dbRow = { geojson: MULTI, boundary_source: 'osm_admin', boundary_confidence: 0.9 }
    const b = await read()
    assert.equal(b.source, 'osm_admin')
    assert.equal(b.adminParts?.length, 2)
    assert.equal(b.curated, true)
  })

  it('any other source: no adminParts, curation unchanged — the normal engine', async () => {
    dbRow = { geojson: MULTI, boundary_source: 'osm', boundary_confidence: 0.9 }
    const b = await read()
    assert.equal(b.source, 'osm')
    assert.equal(b.adminParts, undefined)
    assert.equal(b.curated, false)
  })
})
