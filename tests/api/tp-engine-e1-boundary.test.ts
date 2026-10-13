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
import { calculatePolygonAreaInM2, isPointInPolygon } from '../../lib/services/trigger-points-google/utils/calculations'

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

describe('INV-E1c — an element is the POI border only when an id ties them, never by name (BR-AUDIO-010, operator 2026-10-11)', () => {
  it('BR-AUDIO-010: a node without wikidata beside a polygon of its name takes nothing — the caller draws the point circle (spring "Morava")', () => {
    const region = { type: 'relation', id: 20275185, tags: { boundary: 'historic', name: 'Morava', wikidata: 'Q43266' }, geometry: square(5000) }
    const sameName = { type: 'way', id: 11, tags: { name: 'Morava' }, geometry: square(20) }
    const r = choice.chooseContainingBoundary(PIN, { nodeId: 288804870 }, [region, sameName])
    assert.equal(r.chosen, undefined)
    assert.deepEqual(r.rejected.map(x => x.reason), [choice.NO_ID_LINK_REASON, choice.NO_ID_LINK_REASON])
  })

  it('BR-AUDIO-010: a node with the wikidata of a polygon takes it; another wikidata of the same name is refused (Morava Q179251 vs Moravia Q43266)', () => {
    const region = { type: 'relation', id: 20275185, tags: { boundary: 'historic', name: 'Morava', wikidata: 'Q43266' }, geometry: square(5000) }
    const own = { type: 'way', id: 11, tags: { name: 'Pramen Moravy', wikidata: 'Q179251' }, geometry: square(20) }
    const r = choice.chooseContainingBoundary(PIN, { wikidata: 'Q179251', nodeId: 288804870 }, [region, own])
    assert.equal(r.chosen?.element.id, 11, 'the tie is the wikidata, whatever the name')
    assert.ok(r.rejected.some(x => x.element === 'relation/20275185' && x.reason === choice.NO_ID_LINK_REASON))
  })

  it('BR-AUDIO-010: an unnamed or other-named polygon under the pin is the ground, never the POI', () => {
    const plaza = { type: 'way', id: 12, tags: { leisure: 'park' }, geometry: square(40) }
    const building = { type: 'way', id: 13, tags: { building: 'yes', name: 'Kostel X' }, geometry: square(15) }
    assert.equal(choice.chooseContainingBoundary(PIN, { wikidata: 'Q1', nodeId: 5 }, [plaza, building]).chosen, undefined)
    assert.equal(choice.chooseContainingBoundary(PIN, {}, [plaza, building]).chosen, undefined, 'no id at all: nothing ties')
  })

  it('BR-AUDIO-010: of the tied elements the smallest wins; one off the pin counts only while plausible (pin on the street, 20 m off its building)', () => {
    const site = { type: 'relation', id: 30, tags: { wikidata: 'Q8' }, geometry: square(300) }
    const nearBuilding = { type: 'way', id: 31, tags: { building: 'church', wikidata: 'Q8' }, geometry: square(15, { lat: PIN.lat + 35 * M_LAT, lng: PIN.lng }) }
    assert.equal(choice.chooseContainingBoundary(PIN, { wikidata: 'Q8' }, [site, nearBuilding]).chosen?.element.id, 31)
    const far = { ...nearBuilding, geometry: square(15, { lat: PIN.lat + 2000 * M_LAT, lng: PIN.lng }) }
    const r = choice.chooseContainingBoundary(PIN, { wikidata: 'Q8' }, [far])
    assert.equal(r.chosen, undefined)
    assert.match(r.rejected[0].reason, /far from its edge/)
  })

  it('BR-AUDIO-010: a node that is a member of a relation is tied to it; as its label or admin_centre it is not', () => {
    const rel = (role: string) => ({ type: 'relation', id: 40, tags: { type: 'multipolygon', name: 'Area' }, geometry: square(60),
      members: [{ type: 'node', ref: 777, role }, { type: 'way', ref: 1, role: 'outer' }] })
    assert.equal(choice.chooseContainingBoundary(PIN, { nodeId: 777 }, [rel('')]).chosen?.element.id, 40)
    assert.equal(choice.chooseContainingBoundary(PIN, { nodeId: 777 }, [rel('label')]).chosen, undefined)
    assert.equal(choice.chooseContainingBoundary(PIN, { nodeId: 777 }, [rel('admin_centre')]).chosen, undefined)
    assert.equal(choice.chooseContainingBoundary(PIN, { nodeId: 778 }, [rel('')]).chosen, undefined, 'another node is not a member')
  })

  it('a closed road is no area, even tied', () => {
    const roundabout = { type: 'way', id: 10, tags: { highway: 'primary', wikidata: 'Q9' }, geometry: square(20) }
    assert.equal(choice.chooseContainingBoundary(PIN, { wikidata: 'Q9' }, [roundabout]).chosen, undefined)
  })

  it('multipolygon read by its outer ring (Pão de Açúcar: summit in the hole of the rock)', () => {
    const rock = { type: 'relation', id: 14, tags: { name: 'Pão de Açúcar', wikidata: 'Q7' }, geometry: [...square(400), ...square(60)] }
    const r = choice.chooseContainingBoundary(PIN, { wikidata: 'Q7' }, [rock])
    assert.ok(r.chosen!.areaM2 > 600_000, `outer ring, not the hole: ${r.chosen!.areaM2} m²`)
  })

  it('splitRings splits rings stored in sequence; a single ring comes back whole', () => {
    const pts = [...square(10), ...square(5)].map(p => ({ lat: p.lat, lng: p.lon }))
    assert.deepEqual(choice.splitRings(pts).map(r => r.length), [5, 5])
    assert.equal(choice.splitRings(pts.slice(0, 5)).length, 1)
  })

  it('INV-E11b: outerRings reads a building relation with parts far apart as separate rings, holes dropped (Weitra, relation 2374229)', () => {
    const far = { lat: PIN.lat + 0.1, lng: PIN.lng + 0.1 } // ~14 km away, like Weitra's 5 houses
    const ll = (r: Array<{ lat: number; lon: number }>) => r.map(p => ({ lat: p.lat, lng: p.lon }))
    const parts = choice.outerRings([...ll(square(10)), ...ll(square(10, far)), ...ll(square(4))])
    assert.equal(parts.length, 2, 'two houses, the courtyard is a hole')
    for (const r of parts) assert.ok(calculatePolygonAreaInM2(r) < 1_000, 'no ring spans the gap between the houses')
    // A point between the houses is inside no building any more.
    const between = { lat: PIN.lat + 0.05, lng: PIN.lng + 0.05 }
    assert.ok(parts.every(r => !isPointInPolygon(between, r)))
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

  it('INV-E1a: an open curated way is a line — the ways tied to it by id joined end to end, as a corridor (Ponte Rio-Niterói)', () => {
    const at = (m: number) => ({ lat: PIN.lat, lon: PIN.lng + m * M_LNG })
    const start = { id: 1, tags: { highway: 'motorway', name: 'Ponte Rio-Niterói', wikidata: 'Q1' }, geometry: [at(0), at(100)] }
    // What `sameIdentityWaysQuery` returns: only ways tied by id, whatever their name.
    const tied = [
      { id: 2, tags: { highway: 'motorway', wikidata: 'Q1' }, geometry: [at(100), at(300)] },
      { id: 3, tags: { highway: 'motorway', name: 'Ponte' }, geometry: [at(-200), at(0)].reverse() },
      { id: 5, tags: { highway: 'motorway_link', wikidata: 'Q1' }, geometry: [at(300), at(700)] },
    ]
    const line = choice.chainSameIdentity(start, tied)
    const xs = line.map(p => Math.round((p.lng - PIN.lng) / M_LNG))
    assert.deepEqual([Math.min(...xs), Math.max(...xs)], [-200, 300], 'another via kind does not join')
    const ring = choice.corridorRing(line, choice.LINE_CORRIDOR_HALF_WIDTH_M)
    assert.deepEqual(ring[0], ring[ring.length - 1])
    const area = calculatePolygonAreaInM2(ring)
    assert.ok(Math.abs(area / (500 * 2 * choice.LINE_CORRIDOR_HALF_WIDTH_M) - 1) < 0.1, `${area} m²`)
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
      const r = await d.detectOSMBoundaryByID('5520332', 'relation', { id: 'x', name: 'Maracanã', type: 'point_of_interest', location: PIN })
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

describe('INV-E1a/c — a way or relation POI is its own geometry, never another element (BR-AUDIO-010, operator 2026-10-11)', () => {
  const ring = (half: number) => square(half).map(p => ({ lat: p.lat, lng: p.lon }))
  const run = async (osmType: string, byId: { success: boolean; data?: unknown; error?: string }) => {
    const { BoundaryDetector } = await import('../../lib/services/trigger-points-google/core/boundary-detector')
    const d = new BoundaryDetector() as any
    const asked: string[] = []
    d.detectOSMBoundaryByID = async () => byId
    d.detectContainingBoundary = async () => { asked.push('contains'); return { success: true, data: { coordinates: ring(150), synthetic: false, source: 'osm' } } }
    d.withClassification = async (b: unknown) => b
    const r = await d.detectBoundary({ name: 'Maracanã', osm_id: 5520332, osm_type: osmType, location: PIN })
    return { r, asked }
  }

  it('BR-AUDIO-010: the relation keeps its own ring; no element at the pin is asked (Maracanã id = neighbourhood, #786 undone)', async () => {
    const { r, asked } = await run('relation', { success: true, data: { coordinates: ring(700), synthetic: false, source: 'osm' } })
    assert.deepEqual(asked, [])
    assert.ok(calculatePolygonAreaInM2(r.data.coordinates) > 1_000_000)
  })

  it('BR-AUDIO-010: a way whose own geometry is refused falls to the point circle, never to another element', async () => {
    const { r, asked } = await run('way', { success: false, error: 'Curated osm_id boundary is implausible (pin outside, > 500 m from the edge)' })
    assert.deepEqual(asked, [])
    assert.equal(r.data.synthetic, true)
    assert.equal(r.data.source, 'synthetic')
  })

  it('BR-AUDIO-010: a node asks for an element tied to it', async () => {
    const circle = { success: true, data: { coordinates: ring(10), synthetic: true, source: 'osm', osmTags: { wikidata: 'Q1' } } }
    const { r, asked } = await run('node', circle)
    assert.deepEqual(asked, ['contains'])
    assert.equal(r.data.synthetic, false)
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
    d.withClassification = async (b: unknown) => b
    const r = await d.detectBoundary({ id: 'x', name: 'x', osm_id: 1, osm_type: 'node', location: PIN })
    assert.deepEqual(calls, ['id', 'contains'])
    assert.equal(r.data.source, 'synthetic')
    assert.equal(r.data.synthetic, true)
  })

  it('a POI without id and without a tied element leaves as the point circle: there is no name search (operator, 2026-10-11)', async () => {
    const { BoundaryDetector } = await import('../../lib/services/trigger-points-google/core/boundary-detector')
    const d = new BoundaryDetector() as any
    d.detectContainingBoundary = async () => ({ success: false })
    d.withClassification = async (b: unknown) => b
    const r = await d.detectBoundary({ name: 'x', location: PIN })
    assert.equal(r.data.source, 'synthetic')
    assert.equal(r.data.synthetic, true)
    assert.ok(calculatePolygonAreaInM2(r.data.coordinates) < 400, 'the 10 m pin circle')
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

describe('INV-E1a — a stored border is judged like a curated id (BR-POI-009, BR-AUDIO-010, #779)', () => {
  const lngLat = (half: number, c: LatLng = PIN) => square(half, c).map(p => [p.lon, p.lat])
  const run = async () => {
    const { BoundaryDetector } = await import('../../lib/services/trigger-points-google/core/boundary-detector')
    const d = new BoundaryDetector() as any
    d.detectContainingBoundary = async () => ({ success: false })
    d.detectOSMBoundary = async () => ({ success: false })
    d.withClassification = async (b: unknown) => b
    return d.detectBoundary({ id: 'x', name: 'x', location: PIN })
  }

  it('BR-POI-009: a stored polygon with the pin 1.9 km outside is refused for the pin circle (Monumento dos Combatentes da FAB)', async () => {
    // Source not recorded: a stored `osm` border without an id is dropped before (BR-POI-010).
    dbRow = { geojson: { type: 'Polygon', coordinates: [lngLat(1600, { lat: PIN.lat, lng: PIN.lng + 3500 * M_LNG })] }, boundary_source: null }
    const r = await run()
    assert.equal(r.metadata.strategy, 'estimated_fallback')
    assert.equal(r.data.synthetic, true)
    assert.ok(r.data.area_m2 < 1_000, `${r.data.area_m2} m²`)
    assert.ok(r.data.rejected.some((x: { element: string }) => x.element === 'database'))
  })

  it('BR-POI-009: a stored `estimated` border is an old guess, not a footprint (Escultura Encontro das Águas, 0.83 ha)', async () => {
    const circle = Array.from({ length: 17 }, (_, i) => [
      PIN.lng + 51 * M_LNG * Math.sin(((i % 16) / 16) * 2 * Math.PI),
      PIN.lat + 51 * M_LAT * Math.cos(((i % 16) / 16) * 2 * Math.PI),
    ])
    dbRow = { geojson: { type: 'Polygon', coordinates: [circle] }, boundary_source: 'estimated' }
    const r = await run()
    assert.equal(r.data.source, 'synthetic')
    assert.ok(r.data.area_m2 < 1_000, `${r.data.area_m2} m²`)
  })

  it('a stored polygon of no recorded source, holding the pin, is still the border', async () => {
    dbRow = { geojson: { type: 'Polygon', coordinates: [lngLat(80)] }, boundary_source: null }
    const r = await run()
    assert.equal(r.metadata.strategy, 'database_fallback')
    assert.equal(r.data.source, 'unknown')
  })

  it('#779: a corrected border (confidence 1, or manual) wins over a detection and is marked curated', async () => {
    const { BoundaryDetector } = await import('../../lib/services/trigger-points-google/core/boundary-detector')
    const d = new BoundaryDetector() as any
    d.detectContainingBoundary = async () => ({ success: true, data: { type: 'polygon', coordinates: square(300).map(p => ({ lat: p.lat, lng: p.lon })), area_m2: 360_000 } })
    d.withClassification = async (b: unknown) => b
    for (const row of [
      { geojson: { type: 'Polygon', coordinates: [lngLat(80)] }, boundary_source: 'osm', boundary_confidence: 1 },
      { geojson: { type: 'Polygon', coordinates: [lngLat(80)] }, boundary_source: 'manual' },
    ]) {
      dbRow = row
      const r = await d.detectBoundary({ id: 'x', name: 'x', location: PIN })
      assert.equal(r.metadata.strategy, 'curated_stored')
      assert.equal(r.data.curated, true)
      assert.equal(r.data.source, row.boundary_source)
    }
    // The detector's own writes (0.9 osm) stay re-detectable.
    dbRow = { geojson: { type: 'Polygon', coordinates: [lngLat(80)] }, boundary_source: 'osm', boundary_confidence: 0.9 }
    assert.notEqual((await d.detectBoundary({ id: 'x', name: 'x', location: PIN })).metadata.strategy, 'curated_stored')
  })
})

describe('#779 — the relief footprint is for a natural landform only (BR-POI-009)', () => {
  it('a peak or a bare viewpoint takes the slope; a church, a station or a built viewpoint does not', async () => {
    const { isNaturalLandform } = await import('../../lib/shared/poi-taxonomy')
    for (const c of ['peak', 'hill', 'mountain', 'viewpoint']) assert.equal(isNaturalLandform(c), true, c)
    for (const c of ['church', 'station', 'theatre', 'artwork', 'house', 'amusement_park', null]) assert.equal(isNaturalLandform(c), false, String(c))
    assert.equal(isNaturalLandform('viewpoint', { tourism: 'viewpoint', man_made: 'tower' }), false)
    assert.equal(isNaturalLandform(null, { natural: 'peak' }), true)
  })
})

describe('INV-E1a — the ways of a line POI are tied to it by id, never by name (BR-AUDIO-010, operator 2026-10-11)', () => {
  it('BR-AUDIO-010: the query asks for the same wikidata and for the waterway or bridge relation, no name', () => {
    const q = choice.sameIdentityWaysQuery(674849609, 'Q123', 30_000)
    assert.match(q, /way\(674849609\)->\.a;/)
    assert.ok(q.includes('way(around.a:30000)["wikidata"="Q123"];'), q)
    assert.ok(q.includes('rel(bw.a)["type"~"^(waterway|bridge)$"]->.r;'), q)
    assert.ok(q.includes('way(r.r)(around.a:30000);'), q)
    assert.doesNotMatch(q, /name/)
    assert.doesNotMatch(choice.sameIdentityWaysQuery(1, 'Q1"];way(1);', 10), /way\(around\.a:10\)\["wikidata"/, 'only a QID enters the query')
  })

  describe('local OSM DB first, Overpass only where it has no answer (operator 2026-10-13, 2026-10-05)', () => {
    const at = (m: number) => ({ lat: PIN.lat, lon: PIN.lng + m * M_LNG })
    const bridge = { type: 'way', id: 1, tags: { highway: 'motorway', bridge: 'yes', wikidata: 'Q1' }, geometry: [at(0), at(100)] }
    const wall = { type: 'way', id: 3, tags: { barrier: 'city_wall', historic: 'citywalls' }, geometry: [at(0), at(100)] }
    const sibling = { type: 'way', id: 2, tags: { highway: 'motorway', wikidata: 'Q1' }, geometry: [at(100), at(300)] }
    const LONG = 300 * 2 * 0.9 // a corridor of 300 m, at least 90% of it

    /**
     * `sameIdentityCorridor(element)` with `local` as the DB's wikidata answer (null = no region),
     * `relation` as its relation answer (null = region predating the relation table) and a mocked fetch.
     */
    async function corridor(element: unknown, local: unknown[] | null, overpass: unknown[] = [], relation: unknown[] | null = null) {
      const { BoundaryDetector } = await import('../../lib/services/trigger-points-google/core/boundary-detector')
      const { LocalOSMFetcher } = await import('../../lib/services/trigger-points-google/services/local-osm-fetcher')
      const fetcher = LocalOSMFetcher.getInstance() as any
      const restore = { byWikidata: fetcher.fetchWaysByWikidata, byRelation: fetcher.fetchWaysByIdentityRelation, regions: fetcher.regionList, fetch: globalThis.fetch }
      const bodies: string[] = []
      fetcher.fetchWaysByWikidata = () => local
      fetcher.fetchWaysByIdentityRelation = () => relation
      fetcher.regionList = () => (local ? [{ name: 'test', covers: () => true }] : [])
      globalThis.fetch = (async (_url: string, init: { body: string }) => {
        bodies.push(init.body)
        return new Response(JSON.stringify({ elements: overpass }), { status: 200 })
      }) as typeof fetch
      try {
        const ring = await (new BoundaryDetector() as any).sameIdentityCorridor(element)
        return { bodies, area: calculatePolygonAreaInM2(ring) }
      } finally {
        fetcher.fetchWaysByWikidata = restore.byWikidata
        fetcher.fetchWaysByIdentityRelation = restore.byRelation
        fetcher.regionList = restore.regions
        globalThis.fetch = restore.fetch
      }
    }

    it('BR-AUDIO-010: with the local DB holding ways of the wikidata, Overpass is never called', async () => {
      const r = await corridor(bridge, [bridge, sibling])
      assert.equal(r.bodies.length, 0)
      assert.ok(r.area > LONG * choice.LINE_CORRIDOR_HALF_WIDTH_M, `the sibling joins the corridor: ${r.area} m²`)
    })

    it('BR-AUDIO-010: a line that is no bridge nor waterway, under the local DB, never calls Overpass (Mura civiche, way 698912710)', async () => {
      const r = await corridor(wall, [])
      assert.equal(r.bodies.length, 0)
      assert.ok(r.area > 0, 'the segment alone is the corridor')
    })

    it('BR-AUDIO-010: a bridge whose region has the relation table takes the members from it, Overpass never called', async () => {
      const r = await corridor(bridge, [bridge], [], [sibling])
      assert.equal(r.bodies.length, 0)
      assert.ok(r.area > LONG * choice.LINE_CORRIDOR_HALF_WIDTH_M, `${r.area} m²`)
      const none = await corridor(bridge, [bridge], [], [])
      assert.equal(none.bodies.length, 0, 'an empty answer from the table is "no relation", not "not imported"')
    })

    it('BR-AUDIO-010: a bridge with no other way of its wikidata, in a region predating the relation table, asks Overpass the relation half only', async () => {
      const r = await corridor(bridge, [bridge], [sibling])
      assert.equal(r.bodies.length, 1)
      assert.doesNotMatch(r.bodies[0], /wikidata/)
      assert.match(r.bodies[0], /rel\(bw\.a\)/)
      assert.ok(r.area > LONG * choice.LINE_CORRIDOR_HALF_WIDTH_M, `${r.area} m²`)
    })

    it('BR-AUDIO-010: no local region falls back to the whole Overpass query, never to an error', async () => {
      const r = await corridor(wall, null, [])
      assert.equal(r.bodies.length, 1)
      assert.match(r.bodies[0], /rel\(bw\.a\)/)
      const b = await corridor(bridge, null, [sibling])
      assert.match(b.bodies[0], /\["wikidata"="Q1"\]/)
      assert.ok(b.area > LONG * choice.LINE_CORRIDOR_HALF_WIDTH_M)
    })

    describe('on a real region database (the relation table present or absent)', () => {
      const plain = { type: 'way', id: 11, tags: { highway: 'motorway', bridge: 'yes' }, geometry: [at(0), at(100)] }
      const feature = (w: { id: number; tags: object; geometry: Array<{ lat: number; lon: number }> }) =>
        JSON.stringify({ type: 'Feature', geometry: { type: 'LineString', coordinates: w.geometry.map(p => [p.lon, p.lat]) }, properties: { '@type': 'way', '@id': w.id, ...w.tags } })
      /** A region DB holding the bridge way 11 and the way 12 continuing it; `relations` = OPL lines, undefined = no table. */
      async function regionDb(relations?: string[]) {
        const os = await import('node:os'), fs = await import('node:fs'), path = await import('node:path')
        const { Readable } = await import('node:stream')
        const { OSMLocalDataService } = await import('../../lib/services/osm-local-data-service')
        const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tp-e1-rel-')), 'test.db')
        const svc = new OSMLocalDataService(dbPath)
        await svc.importGeoJSONSeq(Readable.from([[feature(plain), feature({ id: 12, tags: { highway: 'motorway' }, geometry: [at(100), at(300)] })].join('\n')]))
        if (relations) await svc.importIdentityRelations((async function* () { yield* relations })())
        svc.close()
        return dbPath
      }
      async function onRegion(dbPath: string) {
        const { BoundaryDetector } = await import('../../lib/services/trigger-points-google/core/boundary-detector')
        const { LocalOSMFetcher } = await import('../../lib/services/trigger-points-google/services/local-osm-fetcher')
        const fetcher = LocalOSMFetcher.getInstance() as any
        const restore = { regions: fetcher.regions, fetch: globalThis.fetch }
        const handle = { name: 'test', covers: () => true, dbPath, db: null as any, rtree: { pois: false, streets: false, buildings: false } }
        fetcher.regions = [handle]
        const bodies: string[] = []
        globalThis.fetch = (async (_url: string, init: { body: string }) => {
          bodies.push(init.body)
          return new Response(JSON.stringify({ elements: [] }), { status: 200 })
        }) as typeof fetch
        try {
          const ring = await (new BoundaryDetector() as any).sameIdentityCorridor(plain)
          return { bodies, area: calculatePolygonAreaInM2(ring) }
        } finally {
          handle.db?.close()
          fetcher.regions = restore.regions
          globalThis.fetch = restore.fetch
        }
      }

      it('BR-AUDIO-010: the bridge relation in the table ties way 12 to the corridor without calling Overpass', async () => {
        const r = await onRegion(await regionDb(['n1 Tname=x', 'r900 Ttype=bridge,man_made=bridge Mw11@across,w12@across,w99@outline', 'r901 Ttype=route,route=bus Mw11@']))
        assert.equal(r.bodies.length, 0)
        assert.ok(r.area > LONG * choice.LINE_CORRIDOR_HALF_WIDTH_M, `${r.area} m²`)
      })

      it('BR-AUDIO-010: the table present with no relation for the way means no relation: Overpass is not called', async () => {
        const r = await onRegion(await regionDb(['r901 Ttype=route,route=bus Mw11@,w12@']))
        assert.equal(r.bodies.length, 0)
        assert.ok(r.area > 0 && r.area < LONG * choice.LINE_CORRIDOR_HALF_WIDTH_M, 'a bus route ties nothing: the segment alone')
      })

      it('BR-AUDIO-010: a region imported before the table asks Overpass the relation half (transition)', async () => {
        const r = await onRegion(await regionDb())
        assert.equal(r.bodies.length, 1)
        assert.match(r.bodies[0], /rel\(bw\.a\)/)
      })
    })

    it('mayHaveIdentityRelation: waterway and bridge ways only', () => {
      assert.equal(choice.mayHaveIdentityRelation({ waterway: 'river' }), true)
      assert.equal(choice.mayHaveIdentityRelation({ highway: 'primary', bridge: 'viaduct' }), true)
      assert.equal(choice.mayHaveIdentityRelation({ highway: 'primary', bridge: 'no' }), false)
      assert.equal(choice.mayHaveIdentityRelation({ barrier: 'city_wall' }), false)
      assert.equal(choice.mayHaveIdentityRelation(undefined), false)
    })
  })
})

describe('INV-E1a — with storedReference, a detection of another footprint gives way to the stored border (BR-AUDIO-010, #779)', () => {
  const lngLat = (half: number) => square(half).map(p => [p.lon, p.lat])
  const ring = (half: number) => square(half).map(p => ({ lat: p.lat, lng: p.lon }))
  const run = async (detectedHalf: number, storedReference: boolean) => {
    const { BoundaryDetector } = await import('../../lib/services/trigger-points-google/core/boundary-detector')
    const d = new BoundaryDetector() as any
    d.detectContainingBoundary = async () => ({ success: true, data: { type: 'polygon', coordinates: ring(detectedHalf), area_m2: calculatePolygonAreaInM2(ring(detectedHalf)) } })
    d.withClassification = async (b: unknown) => b
    return d.detectBoundary({ id: 'x', name: 'x', location: PIN }, { storedReference })
  }

  it('BR-AUDIO-010: the pitch inside the park is not the park (Parque Chácara do Jockey, 0.54 ha against 16.8 ha)', async () => {
    dbRow = { geojson: { type: 'Polygon', coordinates: [lngLat(200)] }, boundary_source: null }
    const r = await run(37, true)
    assert.equal(r.metadata.strategy, 'database_fallback')
    assert.equal(r.data.source, 'unknown')
    assert.ok(r.data.area_m2 > 150_000, `${r.data.area_m2} m²`)
    assert.ok(r.data.rejected.some((x: { element: string }) => x.element === 'osm'))
  })

  it('BR-AUDIO-010: a stored point circle wins over the neighbour element (Catedral da Sé took the building beside it)', async () => {
    const circle = Array.from({ length: 33 }, (_, i) => [
      PIN.lng + 10 * M_LNG * Math.sin(((i % 32) / 32) * 2 * Math.PI),
      PIN.lat + 10 * M_LAT * Math.cos(((i % 32) / 32) * 2 * Math.PI),
    ])
    dbRow = { geojson: { type: 'Polygon', coordinates: [circle] }, boundary_source: 'synthetic' }
    const r = await run(18, true)
    assert.equal(r.data.source, 'synthetic')
    assert.ok(r.data.area_m2 < 400, `${r.data.area_m2} m²`)
  })

  it('BR-AUDIO-010: a stored point circle wins over a building of the same area (Casa do Sertanista, 385 m² against 334 m²)', async () => {
    dbRow = { geojson: { type: 'Polygon', coordinates: [Array.from({ length: 33 }, (_, i) => [
      PIN.lng + 10.3 * M_LNG * Math.sin(((i % 32) / 32) * 2 * Math.PI),
      PIN.lat + 10.3 * M_LAT * Math.cos(((i % 32) / 32) * 2 * Math.PI),
    ])] }, boundary_source: 'synthetic' }
    const r = await run(10, true)
    assert.equal(r.metadata.strategy, 'database_fallback')
    assert.equal(r.data.synthetic, true)
  })

  it('a detection of the stored footprint is kept as detected, and without the option nothing changes', async () => {
    dbRow = { geojson: { type: 'Polygon', coordinates: [lngLat(41)] }, boundary_source: null }
    assert.equal((await run(40, true)).metadata.strategy, 'osm_priority')
    dbRow = { geojson: { type: 'Polygon', coordinates: [lngLat(200)] }, boundary_source: null }
    assert.equal((await run(37, false)).metadata.strategy, 'osm_priority')
  })
})
