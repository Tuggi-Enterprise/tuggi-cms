/**
 * The four filter fixes measured on the Mexico recall (data, 2026-10-22; operator order 2026-10-25):
 * R5 building=yes no longer beats the type tag, R2 place=borough|city_district reaches Stage 1,
 * R6 a cenote is not natural noise, R1 an item that declares the OSM object injects its wikidata.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { shouldFilterPOI, matchesEliteCategories, pickCategory } from '../../lib/shared/poi-filter'
import { linksFromBindings, withLinkedWikidata, referencedLinks, OSM_ID_PROPERTY } from '../../lib/services/wikidata-sitelinks'
import { SYNONYM_TO_CATEGORY } from '../../lib/shared/poi-taxonomy'

const f = (properties: Record<string, string>, facts?: { heritage?: boolean; wikivoyage?: boolean }) => shouldFilterPOI({ properties }, facts)

describe('R5: building=yes says it is a building, the type tag says what it is', () => {
  it('BR-POI-011 item 0: a tourism=museum with building=yes enters', () => {
    assert.equal(f({ name: 'Museo de Sitio de Monte Albán', tourism: 'museum', building: 'yes' }).remove, false)
    assert.equal(f({ name: 'Africville Museum', tourism: 'museum', building: 'yes' }).remove, false)
  })

  it('a plain building=yes stays out, with or without a weak type', () => {
    assert.equal(f({ name: 'Smith Block', building: 'yes' }).remove, true)
    assert.equal(f({ name: 'Old Shed', building: 'yes', tourism: 'yes' }).remove, true)
    assert.equal(f({ name: 'Riverside Community Centre', building: 'yes', amenity: 'community_centre' }).remove, true)
  })
})

describe('R2: place=borough|city_district with a reference enters Stage 1', () => {
  it('BR-POI-011 item 0: a borough with an article enters, without a reference it does not', () => {
    const p = { name: 'Coyoacán', place: 'borough', wikidata: 'Q1', wikipedia: 'es:Coyoacán' }
    assert.equal(matchesEliteCategories(p), true)
    assert.equal(f(p).remove, false)
    assert.equal(f({ name: 'San Ángel', place: 'city_district', wikidata: 'Q2' }, { wikivoyage: true }).remove, false)
    assert.equal(f({ name: 'Colonia Nueva Tres', place: 'borough' }).remove, true)
    // A bare wikidata is not a reference (item 0).
    assert.equal(f({ name: 'Distrito Cuatro Norte', place: 'city_district', wikidata: 'Q3' }).remove, true)
  })

  it('city_district lands in the borough category', () => {
    assert.equal(pickCategory({ place: 'city_district' }), 'city_district')
    assert.equal(SYNONYM_TO_CATEGORY.city_district, 'borough')
  })
})

describe('R6: a cenote is not natural noise', () => {
  it('a named cave entrance enters with a reference, a cave:type or a cenote name', () => {
    assert.equal(f({ name: 'Cenote Dos Ojos', natural: 'cave_entrance' }).remove, false)
    assert.equal(f({ name: 'Dos Ojos', natural: 'cave_entrance', 'cave:type': 'cenote' }).remove, false)
    assert.equal(f({ name: 'Gruta de Loltún', natural: 'cave_entrance', tourism: 'attraction' }).remove, false)
    assert.equal(f({ name: 'Grutas de Tolantongo', natural: 'cave_entrance' }, { wikivoyage: true }).remove, false)
  })

  it('a cave entrance without a name, or with only a name, stays out', () => {
    assert.equal(f({ natural: 'cave_entrance', 'cave:type': 'cenote' }).remove, true)
    assert.equal(f({ name: 'Cueva del Murciélago', natural: 'cave_entrance' }).remove, true)
  })
})

describe('R1: a Wikidata item that declares the OSM object gives it its wikidata', () => {
  const links = new Map<string, string>()
  linksFromBindings('relation', [{ osm: { value: '123' }, item: { value: 'http://www.wikidata.org/entity/Q10' } }], links)
  linksFromBindings('way', [{ osm: { value: '356882801' }, item: { value: 'http://www.wikidata.org/entity/Q20' } }], links)
  linksFromBindings('node', [{ osm: { value: '962125376' }, item: { value: 'http://www.wikidata.org/entity/Q1725585' } }], links)

  it('maps P402 to relation, P10689 to way, P11693 to node', () => {
    assert.deepEqual(OSM_ID_PROPERTY, { relation: 'P402', way: 'P10689', node: 'P11693' })
  })

  it('BR-POI-011 item 0: P402/P10689/P11693 inject the item, so its article reaches the filter', () => {
    const clock: any = { '@type': 'node', '@id': 962125376, name: 'Halifax Town Clock', tourism: 'attraction' }
    assert.equal(withLinkedWikidata(clock, links), true)
    assert.equal(clock.wikidata, 'Q1725585')
    const way: any = { '@type': 'way', '@id': 356882801, name: 'X' }
    const rel: any = { '@type': 'relation', '@id': 123, name: 'Y' }
    assert.equal(withLinkedWikidata(way, links) && way.wikidata, 'Q20')
    assert.equal(withLinkedWikidata(rel, links) && rel.wikidata, 'Q10')
  })

  it('the type is part of the key: node/123 is not relation/123', () => {
    const p: any = { '@type': 'node', '@id': 123, name: 'Y' }
    assert.equal(withLinkedWikidata(p, links), false)
    assert.equal(p.wikidata, undefined)
  })

  it('a name match alone injects nothing', () => {
    // Same name as the linked clock, a different object: only the declared OSM id links.
    const p: any = { '@type': 'node', '@id': 1, name: 'Halifax Town Clock', tourism: 'attraction' }
    assert.equal(withLinkedWikidata(p, links), false)
    assert.equal(p.wikidata, undefined)
  })

  it('an object two items claim is ambiguous and gets neither', () => {
    const m = new Map<string, string>()
    linksFromBindings('way', [
      { osm: { value: '7' }, item: { value: 'http://www.wikidata.org/entity/Q1' } },
      { osm: { value: '7' }, item: { value: 'http://www.wikidata.org/entity/Q2' } },
    ], m)
    const p: any = { '@type': 'way', '@id': 7, name: 'Z' }
    assert.equal(withLinkedWikidata(p, m), false)
  })

  it('BR-POI-011 item 0: only an item that is a reference is injected — a bare register item is not', () => {
    const facts = new Map([
      ['Q20', { article: 'en:Africville', heritage: [], wikivoyage: false, titles: {} }],
      ['Q10', { article: null, heritage: ['Q5'], wikivoyage: false, titles: {} }],
      ['Q1725585', { article: null, heritage: [], wikivoyage: false, titles: {} }],
    ])
    assert.deepEqual([...referencedLinks(links, facts).keys()].sort(), ['relation/123', 'way/356882801'])
  })

  it('an object that already has wikidata keeps its own', () => {
    const p: any = { '@type': 'node', '@id': 962125376, name: 'Halifax Town Clock', wikidata: 'Q99' }
    assert.equal(withLinkedWikidata(p, links), false)
    assert.equal(p.wikidata, 'Q99')
  })
})
