/**
 * E1 — border (docs/arquitetura/cms/motor-de-tp.md, INV-E1a/b/c; BR-AUDIO-010).
 *
 * Unit, literal data: which element holding the pin may be the border (INV-E1c), the drawn
 * circle marked `synthetic` on every path (INV-E1b), and the stored synthetic border read back
 * as synthetic. The shapes mimic the four cases measured in wave -h: Maracanã/Manguinhos
 * (neighbourhood node), Pão de Açúcar (rock with a hole at the summit), Monumento Árvore de
 * Natal (large polygon nearby) and Busto Mazzini (circle with source=osm).
 */
import { describe, it, mock, before } from 'node:test'
import assert from 'node:assert/strict'

type LatLng = { lat: number; lng: number }
const PIN: LatLng = { lat: -22.95, lng: -43.15 }
const M_LAT = 1 / 111_320
const M_LNG = 1 / (111_320 * Math.cos((PIN.lat * Math.PI) / 180))

/** Closed square ring of `half` metres around `c`, in Overpass shape ({lat, lon}). */
function square(half: number, c: LatLng = PIN) {
  const pts = [[-1, -1], [-1, 1], [1, 1], [1, -1], [-1, -1]]
  return pts.map(([a, b]) => ({ lat: c.lat + a * half * M_LAT, lon: c.lng + b * half * M_LNG }))
}

let choice: typeof import('../../lib/services/trigger-points-google/utils/boundary-choice')
let dbRow: { geojson: unknown; boundary_source: string | null }

before(async () => {
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabase: () => ({
        schema: () => ({
          rpc: async () => ({ data: dbRow.geojson, error: null }),
          from: () => ({
            select: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: { boundary_source: dbRow.boundary_source }, error: null }) }),
            }),
          }),
        }),
      }),
    },
  })
  choice = await import('../../lib/services/trigger-points-google/utils/boundary-choice')
})

describe('INV-E1c — the element holding the pin must fit the kind of POI (BR-AUDIO-010)', () => {
  it('a place/neighbourhood is no border for a POI that is not a place; it is for a place category', () => {
    const suburb = { type: 'relation', id: 1, tags: { place: 'suburb' }, geometry: square(800) }
    const stadiumPoi = choice.chooseContainingBoundary(PIN, { category: 'point_of_interest', tags: {} }, [suburb])
    assert.equal(stadiumPoi.chosen, undefined)
    assert.match(stadiumPoi.rejected[0].reason, /not a place/)
    const neighbourhoodPoi = choice.chooseContainingBoundary(PIN, { category: 'neighborhood', tags: {} }, [suburb])
    assert.equal(neighbourhoodPoi.chosen?.element.id, 1)
  })

  it('an administrative boundary never becomes an attraction border', () => {
    const city = { type: 'relation', id: 2, tags: { boundary: 'administrative', admin_level: '8' }, geometry: square(5000) }
    const r = choice.chooseContainingBoundary(PIN, { category: null, tags: { tourism: 'museum' } }, [city])
    assert.equal(r.chosen, undefined)
    assert.equal(r.rejected.length, 1)
  })

  it('a peak takes the natural=* landform holding the summit, never the summit park; multipolygon read by its outer ring', () => {
    // bare_rock with a (vegetated) hole at the summit: outer 400 m, inner 60 m, rings in sequence as in the local DB.
    const rock = { type: 'relation', id: 3, tags: { natural: 'bare_rock' }, geometry: [...square(400), ...square(60)] }
    const summitPark = { type: 'relation', id: 4, tags: { leisure: 'park' }, geometry: square(50) }
    const r = choice.chooseContainingBoundary(PIN, { tags: { natural: 'peak' } }, [summitPark, rock])
    assert.equal(r.chosen?.element.id, 3)
    assert.ok(r.chosen!.areaM2 > 600_000, `outer ring, not the hole: ${r.chosen!.areaM2} m²`)
    assert.ok(r.rejected.some(x => x.element === 'relation/4' && /natural/.test(x.reason)))
  })

  it('a peak does not take the forest of the whole massif (above RELIEF_MAX_AREA_M2)', () => {
    const massifWood = { type: 'relation', id: 12, tags: { natural: 'wood' }, geometry: square(3000) } // 36 km²
    const r = choice.chooseContainingBoundary(PIN, { tags: { natural: 'peak' } }, [massifWood])
    assert.equal(r.chosen, undefined)
    assert.match(r.rejected[0].reason, /massif/)
  })

  it('a bust, statue or monument inherits neither an area polygon nor a large one (reason in the trace)', () => {
    const school = { type: 'way', id: 5, tags: { amenity: 'school' }, geometry: square(120) } // ~57,600 m²
    const square_ = { type: 'way', id: 6, tags: { leisure: 'park' }, geometry: square(30) }
    const pedestal = { type: 'way', id: 7, tags: { building: 'yes', amenity: 'place_of_worship' }, geometry: square(4) }
    const bust = { tourism: 'artwork', artwork_type: 'sculpture' }
    const noFit = choice.chooseContainingBoundary(PIN, { tags: bust }, [school, square_])
    assert.equal(noFit.chosen, undefined)
    assert.ok(noFit.rejected.some(x => x.element === 'way/5' && new RegExp(`${choice.POINT_FEATURE_MAX_AREA_M2}`).test(x.reason)))
    assert.ok(noFit.rejected.some(x => x.element === 'way/6' && /area polygon/.test(x.reason)))
    const monument = choice.chooseContainingBoundary(PIN, { tags: { class: 'man_made', type: 'monument' } }, [school, pedestal])
    assert.equal(monument.chosen?.element.id, 7)
  })

  it('only what holds the pin counts; a closed road is no area; the smallest fitting polygon wins', () => {
    const roundabout = { type: 'way', id: 8, tags: { highway: 'primary' }, geometry: square(20) }
    const nearby = { type: 'way', id: 9, tags: { leisure: 'park' }, geometry: square(40, { lat: PIN.lat + 300 * M_LAT, lng: PIN.lng }) }
    const plaza = { type: 'way', id: 10, tags: { leisure: 'park' }, geometry: square(40) }
    const district = { type: 'way', id: 11, tags: { landuse: 'residential' }, geometry: square(400) }
    const r = choice.chooseContainingBoundary(PIN, { tags: {} }, [roundabout, nearby, district, plaza])
    assert.equal(r.chosen?.element.id, 10)
    assert.deepEqual(r.rejected, [])
  })

  it('splitRings splits rings stored in sequence; a single ring comes back whole', () => {
    const pts = [...square(10), ...square(5)].map(p => ({ lat: p.lat, lng: p.lon }))
    assert.deepEqual(choice.splitRings(pts).map(r => r.length), [5, 5])
    assert.equal(choice.splitRings(pts.slice(0, 5)).length, 1)
  })
})

describe('INV-E1a — a relation id from Overpass becomes its outer ring, not a circle (BR-AUDIO-010)', () => {
  /** The square's four sides as open ways, the way Overpass hands the Maracanã relation 5520332. */
  function openSides(half: number, c: LatLng = PIN) {
    const r = square(half, c)
    return [0, 1, 2, 3].map(i => ({ type: 'way', role: 'outer', geometry: [r[i], r[i + 1]] }))
  }

  it('joins open outer ways end to end, reversing the ones drawn backwards', () => {
    const [a, b, c, d] = openSides(300)
    const rings = choice.assembleOuterRings([
      a, { ...c, geometry: [...c.geometry].reverse() }, d, b, { type: 'node', role: 'label', geometry: null },
    ])
    assert.equal(rings.length, 1)
    assert.equal(rings[0].length, 5)
    assert.deepEqual(rings[0][0], rings[0][4])
  })

  it('a chain that never closes gives no ring (incomplete relation)', () => {
    const [a, b, c] = openSides(300)
    assert.deepEqual(choice.assembleOuterRings([a, b, c]), [])
  })

  it('two outer rings: the footprint is the one holding the pin', () => {
    const far = { lat: PIN.lat + 5000 * M_LAT, lng: PIN.lng }
    const rings = choice.assembleOuterRings([...openSides(2000, far), ...openSides(300)])
    assert.equal(rings.length, 2)
    const ring = choice.footprintRing(rings, PIN)!
    assert.ok(Math.abs(ring[0].lat - PIN.lat) < 400 * M_LAT, 'the small ring at the pin, not the larger one away')
  })

  it('detectOSMBoundaryByID asks Overpass for members (`out geom`) and returns the ring as a non-synthetic border', async () => {
    const { BoundaryDetector } = await import('../../lib/services/trigger-points-google/core/boundary-detector')
    const { LocalOSMFetcher } = await import('../../lib/services/trigger-points-google/services/local-osm-fetcher')
    const local = LocalOSMFetcher.getInstance() as any
    const restore = { byId: local.fetchElementById, around: local.fetchAsOverpassData }
    local.fetchElementById = () => null
    local.fetchAsOverpassData = () => null
    const d = new BoundaryDetector() as any
    const queries: string[] = []
    d.retryOSMQuery = async (q: string) => {
      queries.push(q)
      if (queries.length > 1) return { ok: false, status: 503, json: async () => ({ elements: [] }) }
      return { ok: true, json: async () => ({ elements: [{ type: 'relation', id: 5520332,
        tags: { boundary: 'administrative', admin_level: '10', name: 'Maracanã' }, members: openSides(600) }] }) }
    }
    d.elevationService = { getElevation: async () => null }
    try {
      const r = await d.detectOSMBoundaryByID('5520332', 'relation', { id: 'x', name: 'Maracanã', type: 'neighborhood', location: PIN })
      assert.match(queries[0], /relation\(5520332\);\s*out geom;/)
      assert.equal(r.success, true)
      assert.notEqual(r.data.synthetic, true)
      assert.equal(r.data.coordinates.length, 5)
    } finally {
      local.fetchElementById = restore.byId
      local.fetchAsOverpassData = restore.around
    }
  })
})

describe('INV-E1b — a drawn circle leaves with source=synthetic on every path (BR-AUDIO-010)', () => {
  it('an OSM node (10 m circle) leaves synthetic with source=synthetic, and the area search runs before it', async () => {
    const { BoundaryDetector } = await import('../../lib/services/trigger-points-google/core/boundary-detector')
    const d = new BoundaryDetector() as any
    const circle = Array.from({ length: 16 }, (_, i) => ({
      lat: PIN.lat + 10 * M_LAT * Math.cos((i / 16) * 2 * Math.PI),
      lng: PIN.lng + 10 * M_LNG * Math.sin((i / 16) * 2 * Math.PI),
    }))
    const calls: string[] = []
    d.detectOSMBoundaryByID = async () => { calls.push('id'); return { success: true, data: { coordinates: circle, synthetic: true, source: 'osm', osmTags: { tourism: 'artwork' } } } }
    d.detectContainingBoundary = async () => { calls.push('contains'); return { success: false } }
    d.detectOSMBoundary = async () => { calls.push('name'); return { success: false } }
    d.withClassification = async (b: unknown) => b
    const r = await d.detectBoundary({ id: 'x', name: 'x', osm_id: 1, osm_type: 'node', location: PIN })
    assert.deepEqual(calls, ['id', 'contains'], 'with a node id the name search does not run')
    assert.equal(r.data.source, 'synthetic')
    assert.equal(r.data.synthetic, true)
  })

  it('INV-E1c: an id that is a place label skips the area-under-the-pin search; the name search still runs', async () => {
    const { BoundaryDetector } = await import('../../lib/services/trigger-points-google/core/boundary-detector')
    const d = new BoundaryDetector() as any
    const calls: string[] = []
    d.detectOSMBoundaryByID = async () => { calls.push('id'); return { success: false, metadata: { idIsPlace: true } } }
    d.detectContainingBoundary = async () => { calls.push('contains'); return { success: false } }
    d.detectOSMBoundary = async () => { calls.push('name'); return { success: false } }
    d.fetchBoundaryFromDatabase = async () => ({ success: false })
    d.createEstimatedBoundary = async () => ({ coordinates: [], synthetic: true })
    d.withClassification = async (b: unknown) => b
    await d.detectBoundary({ id: 'x', name: 'x', osm_id: 1, osm_type: 'node', location: PIN })
    assert.deepEqual(calls, ['id', 'name'])
  })

  it('a circle from the name search (Nominatim point) also leaves synthetic', async () => {
    const { BoundaryDetector } = await import('../../lib/services/trigger-points-google/core/boundary-detector')
    const d = new BoundaryDetector() as any
    const circle50 = Array.from({ length: 17 }, (_, i) => ({
      lat: PIN.lat + 50 * M_LAT * Math.cos(((i % 16) / 16) * 2 * Math.PI),
      lng: PIN.lng + 50 * M_LNG * Math.sin(((i % 16) / 16) * 2 * Math.PI),
    }))
    d.detectContainingBoundary = async () => ({ success: false })
    d.detectOSMBoundary = async () => ({ success: true, data: { coordinates: circle50, source: 'osm' } })
    d.withClassification = async (b: unknown) => b
    const r = await d.detectBoundary({ id: 'x', name: 'x', location: PIN })
    assert.equal(r.data.source, 'synthetic')
    assert.equal(r.data.synthetic, true)
  })

  it('a stored synthetic border reads back as synthetic, not as a source; manual stays manual', async () => {
    const { BoundaryDetector } = await import('../../lib/services/trigger-points-google/core/boundary-detector')
    const ring = Array.from({ length: 17 }, (_, i) => [
      PIN.lng + 10 * M_LNG * Math.sin(((i % 16) / 16) * 2 * Math.PI),
      PIN.lat + 10 * M_LAT * Math.cos(((i % 16) / 16) * 2 * Math.PI),
    ])
    dbRow = { geojson: { type: 'Polygon', coordinates: [ring] }, boundary_source: 'osm' }
    const saved = await new BoundaryDetector().fetchBoundaryFromDatabase('x')
    assert.equal(saved.data?.source, 'synthetic')
    assert.equal(saved.data?.synthetic, true)
    dbRow = { geojson: { type: 'Polygon', coordinates: [ring] }, boundary_source: 'manual' }
    const manual = await new BoundaryDetector().fetchBoundaryFromDatabase('x')
    assert.equal(manual.data?.source, 'manual')
  })
})
