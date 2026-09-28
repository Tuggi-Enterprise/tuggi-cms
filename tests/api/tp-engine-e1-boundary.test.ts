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
import { calculatePolygonAreaInM2 } from '../../lib/services/trigger-points-google/utils/calculations'

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

describe('INV-E1c — the element holding the pin is chosen by identity and geometry, never by type (BR-AUDIO-010)', () => {
  it('an element carrying the POI name wins over a smaller unnamed one (Praia da Reserva took a 248 m² kiosk)', () => {
    const beach = { type: 'relation', id: 1, tags: { natural: 'beach', name: 'Praia da Reserva' }, geometry: square(300) }
    const kiosk = { type: 'way', id: 2, tags: { building: 'yes', amenity: 'fast_food' }, geometry: square(8) }
    const r = choice.chooseContainingBoundary(PIN, { name: 'Praia da Reserva ' }, [kiosk, beach])
    assert.equal(r.chosen?.element.id, 1)
  })

  it('the element carrying the POI name need not hold the pin, only be plausible (pin on the promenade, off the sand)', () => {
    const beach = { type: 'way', id: 20, tags: { name: 'Praia da Reserva' }, geometry: square(100, { lat: PIN.lat - 130 * M_LAT, lng: PIN.lng }) }
    const kiosk = { type: 'way', id: 21, tags: {}, geometry: square(8) }
    assert.equal(choice.chooseContainingBoundary(PIN, { name: 'Praia da Reserva' }, [kiosk, beach]).chosen?.element.id, 20)
    const farBeach = { ...beach, geometry: square(100, { lat: PIN.lat - 900 * M_LAT, lng: PIN.lng }) }
    assert.equal(choice.chooseContainingBoundary(PIN, { name: 'Praia da Reserva' }, [kiosk, farBeach]).chosen?.element.id, 21)
  })

  it('a named element of another name is the ground under the POI, and so is every unnamed one holding it', () => {
    const city = { type: 'relation', id: 3, tags: { boundary: 'administrative', name: 'Rio de Janeiro' }, geometry: square(5000) }
    const park = { type: 'way', id: 4, tags: { name: 'Parque Nacional da Tijuca' }, geometry: square(900) }
    const bigUnnamed = { type: 'way', id: 5, tags: { landuse: 'forest' }, geometry: square(1200) }
    const smallUnnamed = { type: 'way', id: 6, tags: { natural: 'bare_rock' }, geometry: square(60) }
    const r = choice.chooseContainingBoundary(PIN, { name: 'Mirante Dona Marta' }, [city, park, bigUnnamed, smallUnnamed])
    assert.equal(r.chosen?.element.id, 6)
    assert.ok(r.rejected.some(x => x.element === 'relation/3' && x.reason === choice.NAMED_GROUND_REASON))
    assert.ok(r.rejected.some(x => x.element === 'way/5' && /holds the named ground/.test(x.reason)))
  })

  it('the tags of the element never decide: a place relation with the POI name is its border, one with another name is not', () => {
    const rel = { type: 'relation', id: 7, tags: { boundary: 'administrative', admin_level: '10', name: 'Maracanã' }, geometry: square(800) }
    assert.equal(choice.chooseContainingBoundary(PIN, { name: 'maracana' }, [rel]).chosen?.element.id, 7)
    assert.equal(choice.chooseContainingBoundary(PIN, { name: 'Estádio do Maracanã' }, [rel]).chosen, undefined)
  })

  it('a POI with its own node id takes only an element carrying its name (a bust does not take the square)', () => {
    const square_ = { type: 'way', id: 8, tags: {}, geometry: square(30) }
    const r = choice.chooseContainingBoundary(PIN, { name: 'Busto X', namedOnly: true }, [square_])
    assert.equal(r.chosen, undefined)
    assert.match(r.rejected[0].reason, /own node id/)
    const church = { type: 'way', id: 9, tags: { name: 'Igreja X' }, geometry: square(20) }
    assert.equal(choice.chooseContainingBoundary(PIN, { name: 'Igreja X', namedOnly: true }, [square_, church]).chosen?.element.id, 9)
  })

  it('BR-POI-009, INV-E1c: a built element of akin name holding the pin is the border (Igreja Matriz ~ "Paróquia … Martiz", Cabo Frio); a square of akin name is not built', () => {
    const church = { type: 'way', id: 40, tags: { name: 'Paróquia Nossa Senhora da Assunção Martiz' }, geometry: square(15) }
    const plaza = { type: 'way', id: 41, tags: { name: 'Praça Nossa Senhora da Assunção' }, geometry: square(60) }
    const poi = 'Igreja Matriz da Nossa Senhora da Assunção'
    assert.ok(choice.akinPoiName(church.tags, poi))
    assert.ok(!choice.akinPoiName({ name: 'Maracanã' }, 'Estádio do Maracanã'), 'one shared word is not an identity')
    assert.ok(!choice.akinPoiName({ name: 'Rua Nossa Senhora de Copacabana' }, poi))
    // the buildings layer covers the church (900 m²), not the square (14,400 m²)
    const churchBuilt = (ring: LatLng[]) => calculatePolygonAreaInM2(ring) < 2_000
    assert.equal(choice.chooseContainingBoundary(PIN, { name: poi, isBuilt: churchBuilt }, [plaza, church]).chosen?.element.id, 40)
    assert.equal(choice.chooseContainingBoundary(PIN, { name: poi, isBuilt: churchBuilt }, [plaza]).chosen, undefined, 'the square alone is ground')
    assert.equal(choice.chooseContainingBoundary(PIN, { name: poi, isBuilt: () => false }, [plaza, church]).chosen, undefined,
      'not built: the akin element is the ground, as before')
    assert.equal(choice.chooseContainingBoundary(PIN, { name: poi, namedOnly: true, isBuilt: () => true }, [church]).chosen, undefined,
      'a curated node id keeps its own identity: exact name only')
  })

  it('INV-E1a/c (#786): `short_name` and `;` lists are the element\'s names — the stadium is the Maracanã, and the smallest of the identity wins', () => {
    const stadium = { type: 'relation', id: 30, tags: { name: 'Estádio Jornalista Mário Filho', short_name: 'Maracanã' }, geometry: square(150, { lat: PIN.lat + 170 * M_LAT, lng: PIN.lng }) }
    const hood = { type: 'relation', id: 31, tags: { boundary: 'administrative', name: 'Maracanã' }, geometry: square(700) }
    assert.equal(choice.chooseContainingBoundary(PIN, { name: 'Maracanã', namedOnly: true }, [hood, stadium]).chosen?.element.id, 30,
      'the pin is 20 m off the stadium, on the street: plausible, and smaller than the neighbourhood')
    assert.ok(choice.carriesPoiName({ alt_name: 'Estádio do Maracanã;Maracanã' }, 'maracana'))
  })

  it('only what holds the pin counts; a closed road is no area; the smallest unnamed polygon wins', () => {
    const roundabout = { type: 'way', id: 10, tags: { highway: 'primary' }, geometry: square(20) }
    const nearby = { type: 'way', id: 11, tags: {}, geometry: square(40, { lat: PIN.lat + 300 * M_LAT, lng: PIN.lng }) }
    const plaza = { type: 'way', id: 12, tags: { leisure: 'park' }, geometry: square(40) }
    const district = { type: 'way', id: 13, tags: { landuse: 'residential' }, geometry: square(400) }
    const r = choice.chooseContainingBoundary(PIN, { name: 'X' }, [roundabout, nearby, district, plaza])
    assert.equal(r.chosen?.element.id, 12)
  })

  it('multipolygon read by its outer ring (Pão de Açúcar: summit in the hole of the rock)', () => {
    const rock = { type: 'relation', id: 14, tags: { name: 'Pão de Açúcar' }, geometry: [...square(400), ...square(60)] }
    const r = choice.chooseContainingBoundary(PIN, { name: 'Pão de Açúcar' }, [rock])
    assert.ok(r.chosen!.areaM2 > 600_000, `outer ring, not the hole: ${r.chosen!.areaM2} m²`)
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

  it('INV-E1a: an open curated way is a line — the ways of the same identity joined end to end, as a corridor (Ponte Rio-Niterói)', () => {
    const at = (m: number) => ({ lat: PIN.lat, lon: PIN.lng + m * M_LNG })
    const start = { id: 1, tags: { highway: 'motorway', name: 'Ponte Rio-Niterói' }, geometry: [at(0), at(100)] }
    const ways = [
      { id: 2, tags: { highway: 'motorway', official_name: 'Ponte Rio-Niterói' }, geometry: [at(100), at(300)] },
      { id: 3, tags: { highway: 'motorway', name: 'Ponte Rio-Niterói' }, geometry: [at(-200), at(0)].reverse() },
      { id: 4, tags: { highway: 'motorway', name: 'Avenida Brasil' }, geometry: [at(300), at(900)] },
      { id: 5, tags: { highway: 'motorway_link', name: 'Ponte Rio-Niterói' }, geometry: [at(300), at(700)] },
    ]
    const line = choice.chainSameIdentity(start, ways)
    const xs = line.map(p => Math.round((p.lng - PIN.lng) / M_LNG))
    assert.deepEqual([Math.min(...xs), Math.max(...xs)], [-200, 300], 'another name or another via kind does not join')
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

describe('INV-E1a/c — a typed id gives way to a smaller element of the POI identity (BR-AUDIO-010, #786)', () => {
  const ring = (half: number) => square(half).map(p => ({ lat: p.lat, lng: p.lon }))
  const run = async (narrower: { success: boolean; data?: unknown }) => {
    const { BoundaryDetector } = await import('../../lib/services/trigger-points-google/core/boundary-detector')
    const d = new BoundaryDetector() as any
    const asked: unknown[] = []
    d.detectOSMBoundaryByID = async () => ({ success: true, data: { coordinates: ring(700), synthetic: false, source: 'osm' } })
    d.detectContainingBoundary = async (...args: unknown[]) => { asked.push(args[2]); return narrower }
    d.withClassification = async (b: unknown) => b
    const r = await d.detectBoundary({ id: 'x', name: 'Maracanã', osm_id: 5520332, osm_type: 'relation', location: PIN })
    return { r, asked }
  }

  it('the neighbourhood id (Maracanã) gives way to the stadium carrying the name', async () => {
    const { r, asked } = await run({ success: true, data: { coordinates: ring(150), synthetic: false, source: 'osm' } })
    assert.equal(asked.length, 1)
    assert.ok(Math.abs((asked[0] as number) - calculatePolygonAreaInM2(ring(700))) < 1, 'only smaller than the typed border')
    assert.equal(r.data.coordinates.length, ring(150).length)
    assert.ok(calculatePolygonAreaInM2(r.data.coordinates) < 100_000)
  })

  it('no smaller element of the identity: the typed border stays', async () => {
    const { r } = await run({ success: false })
    assert.ok(calculatePolygonAreaInM2(r.data.coordinates) > 1_000_000)
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
