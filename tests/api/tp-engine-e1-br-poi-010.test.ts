/**
 * E1 — a border is never borrowed (BR-POI-010, #779; operator, 2026-10-07).
 *
 * 1. manual border: never touched; 2. stored `osm` + live own id: the id's geometry;
 * 3. stored `osm` + no id or id gone: point, never the stored border back;
 * 4. a municipality only by the seat mode, never by name nor by the own id;
 * 5. an open way is never a polygon.
 * Cases measured in Minas Gerais, comment 6041645980 of #779.
 */
import { describe, it, mock, before } from 'node:test'
import assert from 'node:assert/strict'

type LatLng = { lat: number; lng: number }
const PIN: LatLng = { lat: -19.2, lng: -43.9 }
const M_LAT = 1 / 111_320
const M_LNG = 1 / (111_320 * Math.cos((PIN.lat * Math.PI) / 180))

function square(half: number, c: LatLng = PIN) {
  return [[-1, -1], [-1, 1], [1, 1], [1, -1], [-1, -1]].map(([a, b]) => ({ lat: c.lat + a * half * M_LAT, lon: c.lng + b * half * M_LNG }))
}
const lngLat = (half: number) => square(half).map(p => [p.lon, p.lat])

let choice: typeof import('../../lib/services/trigger-points-google/utils/boundary-choice')
let dbRow: { geojson: unknown; boundary_source: string | null; boundary_confidence?: number }

before(async () => {
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabase: () => ({
        schema: () => ({
          rpc: async () => ({ data: dbRow.geojson, error: null }),
          from: () => ({
            select: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: { boundary_source: dbRow.boundary_source, boundary_confidence: dbRow.boundary_confidence ?? null }, error: null }) }),
            }),
          }),
        }),
      }),
    },
  })
  choice = await import('../../lib/services/trigger-points-google/utils/boundary-choice')
})

/** The detector with the network cut: `ownId` is what the local DB / Overpass give for the POI's id. */
async function detect(poi: Record<string, unknown>, ownId: { elements: unknown[] } | 'unreachable' | null) {
  const { BoundaryDetector } = await import('../../lib/services/trigger-points-google/core/boundary-detector')
  const { LocalOSMFetcher } = await import('../../lib/services/trigger-points-google/services/local-osm-fetcher')
  const local = LocalOSMFetcher.getInstance() as any
  const restore = { byId: local.fetchElementById, around: local.fetchAsOverpassData }
  local.fetchElementById = () => null
  local.fetchAsOverpassData = () => null
  const d = new BoundaryDetector() as any
  const used: string[] = []
  d.municipalityBoundary = async () => null
  d.retryOSMQuery = async () => {
    if (ownId === 'unreachable') throw new Error('OSM query failed: 504')
    return { ok: true, json: async () => ownId ?? { elements: [] } }
  }
  d.detectContainingBoundary = async () => { used.push('containing'); return { success: false } }
  d.detectOSMBoundary = async () => { used.push('name'); return { success: false } }
  d.withClassification = async (b: unknown) => b
  d.elevationService = { getElevation: async () => null }
  try {
    const r = await d.detectBoundary({ id: 'x', name: 'x', location: PIN, ...poi }, { storedReference: true })
    return { r, used }
  } finally {
    local.fetchElementById = restore.byId
    local.fetchAsOverpassData = restore.around
  }
}

describe('BR-POI-010 — the stored border is never borrowed (#779)', () => {
  it('BR-POI-010 rule 3: Cachoeira das 27 Voltas (7258719a-358e-4d13-9473-04ef98d66f57), no osm_id, stored osm 7 km² → point', async () => {
    dbRow = { geojson: { type: 'Polygon', coordinates: [lngLat(1330)] }, boundary_source: 'osm', boundary_confidence: 0.9 }
    const { r, used } = await detect({ id: '7258719a-358e-4d13-9473-04ef98d66f57', name: 'Cachoeira das 27 Voltas' }, null)
    assert.equal(r.metadata.strategy, 'point_stored_osm_dropped')
    assert.equal(r.data.synthetic, true)
    assert.ok(r.data.area_m2 < 1_000, `${r.data.area_m2} m²`)
    assert.deepEqual(used, [])
  })

  it('BR-POI-010 rule 3: Capela Santa Quitéria (b1740ee6-2350-562f-a852-6536b5651324), way 243587436 gone from OSM, stored osm 30 km² → point', async () => {
    dbRow = { geojson: { type: 'Polygon', coordinates: [lngLat(2740)] }, boundary_source: 'osm', boundary_confidence: 0.9 }
    const { r } = await detect({ id: 'b1740ee6-2350-562f-a852-6536b5651324', name: 'Capela Santa Quitéria', osm_type: 'way', osm_id: 243587436 }, { elements: [] })
    assert.equal(r.metadata.strategy, 'point_stored_osm_dropped')
    assert.equal(r.data.synthetic, true)
    assert.ok(r.data.area_m2 < 1_000, `${r.data.area_m2} m²`)
  })

  it('BR-POI-010 rule 3: OSM unreachable for the id — the POI fails the run, the stored osm border is not reused', async () => {
    dbRow = { geojson: { type: 'Polygon', coordinates: [lngLat(2740)] }, boundary_source: 'osm' }
    const { r } = await detect({ osm_type: 'way', osm_id: 243587436 }, 'unreachable')
    assert.equal(r.success, false)
  })

  it('BR-POI-010 rule 4: Bom Despacho, own way 936775250 is place=town and the POI is not the seat → point', async () => {
    dbRow = { geojson: { type: 'Polygon', coordinates: [lngLat(2300)] }, boundary_source: 'osm' }
    const town = { type: 'way', id: 936775250, tags: { place: 'town', name: 'Bom Despacho' }, geometry: square(2300) }
    const { r, used } = await detect({ name: 'Bom Despacho', osm_type: 'way', osm_id: 936775250 }, { elements: [town] })
    assert.equal(r.metadata.strategy, 'point_municipal_id')
    assert.equal(r.data.synthetic, true)
    assert.deepEqual(used, [])
  })

  it('BR-POI-010 rule 1: a manual border stays intact, even with the own id gone', async () => {
    for (const source of ['manual', 'manual_drawing']) {
      dbRow = { geojson: { type: 'Polygon', coordinates: [lngLat(500)] }, boundary_source: source }
      const { r } = await detect({ osm_type: 'way', osm_id: 1 }, { elements: [] })
      assert.equal(r.metadata.strategy, 'curated_stored', source)
      assert.equal(r.data.source, source)
      assert.ok(r.data.area_m2 > 900_000)
    }
  })

  it('BR-POI-010 rule 2: a live own id replaces the stored osm border; storedReference never brings it back', async () => {
    dbRow = { geojson: { type: 'Polygon', coordinates: [lngLat(2000)] }, boundary_source: 'osm' }
    const lake = { type: 'way', id: 11379206, tags: { natural: 'water', name: 'Lagoa Formosa' }, geometry: square(100) }
    const { r } = await detect({ name: 'Lagoa Formosa', osm_type: 'way', osm_id: 11379206 }, { elements: [lake] })
    assert.equal(r.metadata.strategy, 'osm_priority')
    assert.ok(r.data.area_m2 < 50_000, `${r.data.area_m2} m²`)
  })
})

describe('BR-POI-010 — a municipality is never the border by name (#779)', () => {
  const lake = { type: 'relation', id: 11379206, tags: { natural: 'water', name: 'Lagoa Formosa' }, geometry: square(110) }
  const municipality = { type: 'relation', id: 315134, tags: { boundary: 'administrative', admin_level: '8', name: 'Lagoa Formosa' }, geometry: square(14500) }

  it('BR-POI-010 rule 4: Lagoa Formosa keeps relation 11379206, never the municipality 315134', () => {
    assert.equal(choice.chooseContainingBoundary(PIN, { name: 'Lagoa Formosa' }, [municipality, lake]).chosen?.element.id, 11379206)
    const alone = choice.chooseContainingBoundary(PIN, { name: 'Lagoa Formosa' }, [municipality])
    assert.equal(alone.chosen, undefined)
    assert.ok(alone.rejected.some(x => x.element === 'relation/315134' && /BR-POI-010/.test(x.reason)))
  })

  it('BR-POI-010: municipality = admin_level ≤ 8 or place=city/town; a neighbourhood (admin_level 10) is not one', () => {
    for (const t of [{ boundary: 'administrative', admin_level: '8' }, { boundary: 'administrative', admin_level: '4' }, { boundary: 'administrative' }, { place: 'city' }, { place: 'town' }]) {
      assert.equal(choice.isMunicipalElement(t), true, JSON.stringify(t))
    }
    for (const t of [{ boundary: 'administrative', admin_level: '10' }, { place: 'suburb' }, { natural: 'water' }, undefined]) {
      assert.equal(choice.isMunicipalElement(t), false, JSON.stringify(t))
    }
  })
})

describe('BR-POI-010 rule 5 — an open way is never a polygon (#779)', () => {
  // A river passing 50 m from the pin, named as the POI: the Itaobim church took its 265 km².
  const river = [0, 1, 2, 3, 4].map(i => ({ lat: PIN.lat + (i - 2) * 500 * M_LAT, lon: PIN.lng + 50 * M_LNG + (i % 2) * 300 * M_LNG }))

  it('BR-POI-010: an open way or an open relation is never chosen, even carrying the POI name', () => {
    for (const type of ['way', 'relation']) {
      const r = choice.chooseContainingBoundary(PIN, { name: 'Rio Jequitinhonha' }, [{ type, id: 1390692330, tags: { waterway: 'river', name: 'Rio Jequitinhonha' }, geometry: river }])
      assert.equal(r.chosen, undefined, type)
    }
    assert.deepEqual(choice.outerRing(river.map(p => ({ lat: p.lat, lng: p.lon })), PIN), [])
  })

  it('BR-POI-010: a stored LineString is no border', async () => {
    const { BoundaryDetector } = await import('../../lib/services/trigger-points-google/core/boundary-detector')
    dbRow = { geojson: { type: 'LineString', coordinates: river.map(p => [p.lon, p.lat]) }, boundary_source: null }
    assert.equal((await new BoundaryDetector().fetchBoundaryFromDatabase('x')).success, false)
  })
})

describe('BR-POI-010 — boundaryFate, the decision table', () => {
  it('BR-POI-010: rules 1–4 and the network failure', () => {
    const f = (source: string | null, ownId: Parameters<typeof choice.boundaryFate>[1], curated = false) => choice.boundaryFate({ source, curated }, ownId)
    assert.deepEqual(f('manual', 'gone', true), { fate: 'keep', rule: 1 })
    assert.deepEqual(f('osm', 'municipal'), { fate: 'point', rule: 4 })
    assert.deepEqual(f(null, 'municipal'), { fate: 'point', rule: 4 })
    assert.deepEqual(f('osm', 'found'), { fate: 'own_id', rule: 2 })
    assert.deepEqual(f('osm', 'none'), { fate: 'point', rule: 3 })
    assert.deepEqual(f('osm', 'gone'), { fate: 'point', rule: 3 })
    assert.deepEqual(f('osm', 'unknown'), { fate: 'retry', rule: 3 })
    assert.deepEqual(f(null, 'none'), { fate: 'detect', rule: null })
    assert.deepEqual(f('synthetic', 'gone'), { fate: 'detect', rule: null })
    assert.deepEqual(choice.boundaryFate(undefined, 'none'), { fate: 'detect', rule: null })
  })
})
