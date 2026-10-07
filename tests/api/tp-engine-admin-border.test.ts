/**
 * Municipal border mode — BR-POI-009, exception decided by the operator on 2026-10-07.
 *
 * A POI whose stored border is an OSM administrative boundary (`boundary_source = 'osm_admin'`)
 * gets one TP on each main road crossing the border, ~150 m inside, radius 150 m; small and
 * private ways carry none, and a dual carriageway is one entry.
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
    const tps = e.adminBorderTriggerPoints('poi', [MUNICIPALITY], ROADS)
    assert.equal(tps.length, 2, tps.map(t => t.street.id).join(', '))
    assert.deepEqual(tps.map(t => t.street.type).sort(), ['motorway', 'trunk'])
  })

  it('each TP stands inside the border, ~150 m from it along the road, radius 150 m', async () => {
    const e = await engine()
    for (const tp of e.adminBorderTriggerPoints('poi', [MUNICIPALITY], ROADS)) {
      assert.ok(e.isPointInPolygon(tp.location, MUNICIPALITY), `${tp.street.id} inside`)
      const d = e.edgeM(tp.location, MUNICIPALITY)
      assert.ok(Math.abs(d - e.ADMIN_BORDER_TP_INSET_M) <= 5, `${tp.street.id}: ${d.toFixed(1)} m from the border`)
      assert.equal(tp.radius, 150)
      assert.equal(tp.type, 'primary')
    }
  })

  it('the TP walks on across a way split near the border, and points inward', async () => {
    const e = await engine()
    const mw = e.adminBorderTriggerPoints('poi', [MUNICIPALITY], ROADS).find(t => t.street.type === 'motorway')!
    assert.equal(mw.street.id, 'motorway_a', 'the crossing is on the way outside the split')
    assert.ok(Math.abs(mw.expectedBearing - 90) < 2, `bearing ${mw.expectedBearing}`)
  })

  it('of a dual carriageway, the inbound carriageway keeps the TP; TPs of a POI stay ≥ 300 m apart', async () => {
    const e = await engine()
    const tps = e.adminBorderTriggerPoints('poi', [MUNICIPALITY], ROADS)
    const trunk = tps.find(t => t.street.type === 'trunk')!
    assert.equal(trunk.street.id, 'trunk_in')
    assert.ok(Math.abs(trunk.expectedBearing - 270) < 2, `bearing ${trunk.expectedBearing}`)
    for (const a of tps) for (const b of tps) {
      if (a !== b) assert.ok(e.calculateDistance(a.location, b.location) >= e.ADMIN_BORDER_TP_MIN_SPACING_M)
    }
  })

  it('every polygon part counts: a road entering an island part gets its TP there', async () => {
    const e = await engine()
    const islandCentre = at(8_000, 0)
    const island = square(800, islandCentre)
    const road = way('island_primary', 'primary', [at(-1_500, 0, islandCentre), at(0, 0, islandCentre)])
    const tps = e.adminBorderTriggerPoints('poi', [MUNICIPALITY, island], [...ROADS, road])
    const tp = tps.find(t => t.street.id === 'island_primary')
    assert.ok(tp && e.isPointInPolygon(tp.location, island))
    assert.equal(tps.length, 3)
  })

  it('a road leaving the municipality again before the inset gives no TP', async () => {
    const e = await engine()
    const clip = way('corner', 'primary', [at(-HALF - 200, HALF - 50), at(-HALF + 50, HALF - 50), at(-HALF + 50, HALF + 200)])
    assert.equal(e.adminBorderTriggerPoints('poi', [MUNICIPALITY], [clip]).length, 0)
  })

  it('a road weaving along the border (crossing it every ~400 m) gives no TP: it skirts, it does not enter', async () => {
    const e = await engine()
    const zig = [-1_200, -800, -400, 0, 400, 800, 1_200].map((n, i) => at(-HALF + (i % 2 ? 40 : -40), n))
    assert.equal(e.adminBorderTriggerPoints('poi', [MUNICIPALITY], [way('skirting', 'primary', zig)]).length, 0)
  })

  it('only the main road types carry a TP; every other border source leaves the mode off', async () => {
    const e = await engine()
    assert.deepEqual([...e.ADMIN_BORDER_ROAD_TYPES].sort(), [
      'motorway', 'motorway_link', 'primary', 'primary_link', 'secondary', 'secondary_link',
      'tertiary', 'tertiary_link', 'trunk', 'trunk_link'].sort())
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
    const tps = e.adminBorderTriggerPoints('poi', [MUNICIPALITY, island], [...ROADS, road])
    const admin = applyTpPostConditions(tps, C, { source: 'osm_admin', coordinates: MUNICIPALITY, adminParts: [MUNICIPALITY, island] })
    assert.equal(admin.kept.length, 3)
    const normal = applyTpPostConditions(tps, C, { source: 'osm', coordinates: MUNICIPALITY })
    assert.ok(normal.dropped.some(d => d.reason === 'inside_poi'), 'the normal engine is unchanged')
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
