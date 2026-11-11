// #1203: the pure parts of the Chile/Santiago scripts, on fixtures (no network, no database).
// Región and comuna by point in polygon, lugar versus attraction by OSM tag, and the "missing"
// rule (150 m and a similar name).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  type AdminAreas, type RawAdminArea, buildAdminAreas, isChileCountry, isInSantiagoArea, planAdminFix, resolveAdminArea,
} from '../../lib/osm-chile/admin-areas'
import { catalogueTags, classifyPlaceOrAttraction, isAttractionCandidate } from '../../lib/osm-chile/osm-tags'
import { CatalogueMatcher, distanceToPolylineM, isSimilarName } from '../../lib/osm-chile/matching'
import { normalizeState } from '../../lib/shared/location-normalize'

const box = (minLat: number, maxLat: number, minLng: number, maxLng: number): [number, number][][] =>
  [[[minLng, minLat], [maxLng, minLat], [maxLng, maxLat], [minLng, maxLat], [minLng, minLat]]]

// Rough shapes, enough to tell the comunas apart. Santiago and Providencia share the -70.63 border.
const RAW: RawAdminArea[] = [
  { osmId: 198848, level: 4, name: 'Región Metropolitana de Santiago', geometry: { type: 'Polygon', coordinates: box(-34.3, -32.9, -71.3, -69.8) } },
  { osmId: 198847, level: 4, name: 'Región de Valparaíso', geometry: { type: 'Polygon', coordinates: box(-33.9, -32.0, -71.75, -71.3) } },
  { osmId: 1, level: 8, name: 'Santiago', geometry: { type: 'Polygon', coordinates: box(-33.48, -33.42, -70.69, -70.63) } },
  { osmId: 2, level: 8, name: 'Providencia', geometry: { type: 'Polygon', coordinates: box(-33.45, -33.41, -70.63, -70.58) } },
  {
    osmId: 3, level: 8, name: 'Viña del Mar',
    geometry: { type: 'MultiPolygon', coordinates: [box(-33.06, -32.95, -71.57, -71.48), box(-33.10, -33.08, -71.60, -71.58)] },
  },
]
const AREAS: AdminAreas = buildAdminAreas(RAW)

const PROVIDENCIA = { lat: -33.4264, lng: -70.6150 }
const PLAZA_DE_ARMAS = { lat: -33.4378, lng: -70.6504 }
const VINA = { lat: -33.0245, lng: -71.5518 }
const PACIFIC = { lat: -33.0, lng: -71.9 }

describe('#1203 región and comuna by point in polygon', () => {
  it('a point in Providencia gets the comuna Providencia, not Santiago', () => {
    const r = resolveAdminArea(PROVIDENCIA, AREAS)
    assert.equal(r.city, 'Providencia')
    assert.equal(r.state, 'Región Metropolitana de Santiago')
  })

  it('Plaza de Armas gets the comuna Santiago', () => {
    const r = resolveAdminArea(PLAZA_DE_ARMAS, AREAS)
    assert.equal(r.city, 'Santiago')
    assert.equal(r.state, 'Región Metropolitana de Santiago')
  })

  it('Viña del Mar resolves inside a MultiPolygon and the state is the canonical Valparaíso', () => {
    const r = resolveAdminArea(VINA, AREAS)
    assert.equal(r.city, 'Viña del Mar')
    assert.equal(r.state, 'Valparaíso')
  })

  it('a point in the sea is outside every polygon and is not changed', () => {
    const r = resolveAdminArea(PACIFIC, AREAS)
    assert.equal(r.state, null)
    assert.equal(r.city, null)
    assert.deepEqual(planAdminFix({ state: 'Antofagasta', city: 'Valparaíso' }, r), { status: 'outside' })
  })

  it('a hole in a polygon is outside it', () => {
    const holed = buildAdminAreas([{ osmId: 9, level: 8, name: 'Ring', geometry: { type: 'Polygon', coordinates: [
      box(-34, -33, -71, -70)[0], box(-33.6, -33.4, -70.6, -70.4)[0],
    ] } }])
    assert.equal(resolveAdminArea({ lat: -33.5, lng: -70.5 }, holed).city, null)
    assert.equal(resolveAdminArea({ lat: -33.8, lng: -70.8 }, holed).city, 'Ring')
  })

  it('plans only the fields that differ, and nothing on a second run', () => {
    const r = resolveAdminArea(PROVIDENCIA, AREAS)
    assert.deepEqual(planAdminFix({ state: 'Antofagasta', city: 'Santiago' }, r),
      { status: 'change', changes: { state: 'Región Metropolitana de Santiago', city: 'Providencia' } })
    assert.deepEqual(planAdminFix({ state: 'Región Metropolitana de Santiago', city: 'Santiago' }, r),
      { status: 'change', changes: { city: 'Providencia' } })
    assert.deepEqual(planAdminFix({ state: r.state, city: r.city }, r), { status: 'unchanged' })
  })

  it('the 16 OSM región names map to a canonical state that is stable under a second normalisation', () => {
    const osmNames = [
      'Región de Arica y Parinacota', 'Región de Tarapacá', 'Región de Antofagasta', 'Región de Atacama',
      'Región de Coquimbo', 'Región de Valparaíso', 'Región Metropolitana de Santiago',
      "Región del Libertador General Bernardo O'Higgins", 'Región del Maule', 'Región de Ñuble',
      'Región del Biobío', 'Región de la Araucanía', 'Región de Los Ríos', 'Región de Los Lagos',
      'Región Aysén del General Carlos Ibáñez del Campo', 'Región de Magallanes y de la Antártica Chilena',
    ]
    const canon = osmNames.map(n => normalizeState('Chile', n))
    assert.equal(new Set(canon).size, 16)
    for (const c of canon) {
      assert.ok(c)
      // POICreationService normalises again on insert; the value must survive it unchanged.
      assert.equal(normalizeState('Chile', c), c)
    }
  })

  it('the Santiago area is a 150 km circle: Valparaíso in, Talca out', () => {
    assert.ok(isInSantiagoArea({ lat: -33.0472, lng: -71.6127 }))
    assert.ok(!isInSantiagoArea({ lat: -35.4264, lng: -71.6554 }))
  })

  it('reads the country spellings of Chile', () => {
    for (const c of ['Chile', 'CL', 'chile', 'República de Chile']) assert.ok(isChileCountry(c), c)
    for (const c of ['Argentina', '', null]) assert.ok(!isChileCountry(c), String(c))
  })
})

describe('#1203 lugar or attraction by OSM tag (BR-POI-006: only entity_kind changes, by tag)', () => {
  it('a plain hotel becomes place', () => {
    const v = classifyPlaceOrAttraction({ tourism: 'hotel', name: 'Hotel Plaza San Francisco' }, ['hotel'])
    assert.equal(v.decision, 'place')
    assert.equal(v.kind, 'lodging')
  })

  it('a historic hotel is doubtful and stays poi', () => {
    const v = classifyPlaceOrAttraction({ tourism: 'hotel', historic: 'building', heritage: '2', name: 'Hotel Palacio Astoreca' }, ['hotel'])
    assert.equal(v.decision, 'doubtful')
  })

  it('the Mercado Central stays poi even with shops and restaurants inside', () => {
    const v = classifyPlaceOrAttraction({ amenity: 'marketplace', tourism: 'attraction', shop: 'seafood', heritage: '2', name: 'Mercado Central' }, ['marketplace'])
    assert.equal(v.decision, 'poi')
    const bare = classifyPlaceOrAttraction({ amenity: 'marketplace', shop: 'seafood', name: 'Mercado Central' }, ['marketplace'])
    assert.equal(bare.decision, 'poi')
  })

  it('a museum with a café stays poi', () => {
    assert.equal(classifyPlaceOrAttraction({ tourism: 'museum', amenity: 'cafe' }, ['museum']).decision, 'poi')
  })

  it('restaurants, cafés, bars, pubs, fast food, shops and malls become place', () => {
    for (const tags of <Array<Record<string, string>>>[{ amenity: 'restaurant' }, { amenity: 'cafe' }, { amenity: 'bar' }, { amenity: 'pub' }, { amenity: 'fast_food' }, { shop: 'clothes' }, { shop: 'mall' }]) {
      assert.equal(classifyPlaceOrAttraction(tags, [null]).decision, 'place', JSON.stringify(tags))
    }
    for (const tourism of ['hostel', 'guest_house', 'apartment', 'motel']) {
      assert.equal(classifyPlaceOrAttraction({ tourism }, [null]).decision, 'place', tourism)
    }
  })

  it('OSM says restaurant but the cadastro category says museum: doubtful', () => {
    assert.equal(classifyPlaceOrAttraction({ amenity: 'restaurant' }, ['museum']).decision, 'doubtful')
  })

  it('without an OSM tag the category alone never converts', () => {
    assert.equal(classifyPlaceOrAttraction(null, ['hotel']).decision, 'doubtful')
    assert.equal(classifyPlaceOrAttraction(null, ['church']).decision, 'poi')
  })

  it('reads the flattened OSM columns of the cadastro when osm_tags lacks them', () => {
    assert.deepEqual(catalogueTags({ osm_tags: { name: 'X' }, amenity: 'restaurant' }), { name: 'X', amenity: 'restaurant' })
    assert.equal(catalogueTags({ osm_tags: { name: 'X' } }), null)
  })
})

describe('#1203 missing POI: 150 m and a similar name', () => {
  const at = (lat: number, lng: number, dNorthM: number) => ({ lat: lat + dNorthM / 111_320, lng })
  const base = { lat: -33.4378, lng: -70.6504 }
  const candidate = { name: 'Catedral Metropolitana de Santiago', ...base, osmType: 'way' as const, osmId: 42 }

  it('a cadastro at 100 m with a similar name means present', () => {
    const m = new CatalogueMatcher([{ id: 'a', name: 'Catedral Metropolitana', ...at(base.lat, base.lng, 100), osmType: null, osmId: null }])
    assert.equal(m.match(candidate)?.by, 'name_and_distance')
  })

  it('the same name at 200 m means missing', () => {
    const m = new CatalogueMatcher([{ id: 'a', name: 'Catedral Metropolitana de Santiago', ...at(base.lat, base.lng, 200), osmType: null, osmId: null }])
    assert.equal(m.match(candidate), null)
  })

  it('another name at 50 m means missing', () => {
    const m = new CatalogueMatcher([{ id: 'a', name: 'Plaza de Armas', ...at(base.lat, base.lng, 50), osmType: null, osmId: null }])
    assert.equal(m.match(candidate), null)
  })

  it('the same OSM id or Wikidata item means present at any distance', () => {
    const far = at(base.lat, base.lng, 5000)
    assert.equal(new CatalogueMatcher([{ id: 'a', name: 'Otro', ...far, osmType: 'way', osmId: '42' }]).match(candidate)?.by, 'osm_id')
    assert.equal(new CatalogueMatcher([{ id: 'a', name: 'Otro', ...far, osmType: null, osmId: null, wikidata: 'Q1' }])
      .match({ ...candidate, wikidata: 'Q1' })?.by, 'wikidata')
  })

  it('names compare without accents, case or punctuation, and by whole-word containment', () => {
    assert.ok(isSimilarName('Cerro Santa Lucía', 'cerro santa lucia'))
    assert.ok(isSimilarName('Mercado Central', 'Mercado Central de Santiago'))
    assert.ok(isSimilarName('Museo Nacional de Bellas Artes', 'Museo de Bellas Artes'))
    assert.ok(!isSimilarName('Iglesia de San Francisco', 'Palacio de La Moneda'))
    assert.ok(!isSimilarName('Bar', 'Barrio Bellavista'))
  })

  it('attraction candidates need a name; a park needs size or a reference', () => {
    assert.ok(isAttractionCandidate({ tourism: 'museum', name: 'Museo' }, null))
    assert.ok(!isAttractionCandidate({ tourism: 'museum' }, null))
    assert.ok(isAttractionCandidate({ natural: 'peak', name: 'Cerro El Plomo' }, null))
    assert.ok(!isAttractionCandidate({ natural: 'tree', name: 'Árbol' }, null))
    assert.ok(!isAttractionCandidate({ leisure: 'park', name: 'Plaza chica' }, 2_000))
    assert.ok(isAttractionCandidate({ leisure: 'park', name: 'Parque Forestal' }, 300_000))
    assert.ok(isAttractionCandidate({ leisure: 'park', name: 'Parque', wikidata: 'Q2' }, null))
    assert.ok(!isAttractionCandidate({ tourism: 'hotel', name: 'Hotel' }, null))
  })

  it('the corridor band is measured to the routed line', () => {
    const line = [{ lat: -33.0, lng: -71.0 }, { lat: -33.0, lng: -70.9 }]
    const d = distanceToPolylineM({ lat: -33.0 + 1000 / 111_320, lng: -70.95 }, line)
    assert.ok(Math.abs(d - 1000) < 5, String(d))
  })
})
