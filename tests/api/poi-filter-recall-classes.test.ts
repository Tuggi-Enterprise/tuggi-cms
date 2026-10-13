/**
 * Classes the Czech Wikidata recall (2026-10-09) had to put back by hand because Stage 1
 * (lib/shared/poi-filter#CATEGORIES) never let them in: monasteries, spas, national parks, mineral
 * springs tagged as taps, and the city seat node (BR-POI-010 #4). Each passes with a reference and
 * still falls without one, where the filter already demanded fame for that tag.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { shouldFilterPOI, matchesEliteCategories, pickCategory } from '../../lib/shared/poi-filter'

const f = (properties: Record<string, string>) => shouldFilterPOI({ properties })

describe('Stage 1 reaches monastery, spa, national park, mineral spring and city', () => {
  it('amenity=monastery: referenced monastery passes, unreferenced one does not', () => {
    const p = { name: 'Klášter Kladruby', amenity: 'monastery', wikidata: 'Q1', wikipedia: 'cs:Klášter Kladruby' }
    // BR-POI-011 items 0 and 10: "always enter" is still subject to a public reference — a bare wikidata is not one.
    assert.equal(f({ name: p.name, amenity: 'monastery', wikidata: 'Q1' }).remove, true)
    assert.equal(matchesEliteCategories(p), true)
    assert.equal(f(p).remove, false)
    assert.equal(pickCategory(p), 'monastery')
    assert.equal(f({ name: 'Klášter Někde', amenity: 'monastery' }).remove, true)
  })

  it('amenity=spa: referenced spa house passes, unreferenced one does not', () => {
    const p = { name: 'Lázně III', amenity: 'spa', wikidata: 'Q2', wikipedia: 'cs:Lázně III (Karlovy Vary)' }
    assert.equal(matchesEliteCategories(p), true)
    assert.equal(f(p).remove, false)
    assert.equal(pickCategory(p), 'spa')
    assert.equal(f({ name: 'Wellness Centrum Sluníčko', amenity: 'spa' }).remove, true)
  })

  it('water_characteristic=mineral on a tap: referenced spring passes as `spring`, plain tap does not', () => {
    const p = { name: 'Vřídlo', amenity: 'drinking_water', water_characteristic: 'mineral', wikidata: 'Q3', wikipedia: 'cs:Vřídlo' }
    assert.equal(matchesEliteCategories(p), true)
    assert.equal(f(p).remove, false)
    assert.equal(pickCategory(p), 'spring')
    assert.equal(f({ name: 'Pítko u nádraží', amenity: 'drinking_water', water_characteristic: 'mineral' }).remove, true)
    assert.equal(matchesEliteCategories({ name: 'Pítko', amenity: 'drinking_water' }), false)
  })

  it('boundary=national_park: the relation passes and is categorised national_park, not nature_reserve', () => {
    const p = { name: 'Národní park Šumava', type: 'boundary', boundary: 'national_park', leisure: 'nature_reserve', wikidata: 'Q4', wikipedia: 'cs:Národní park Šumava' }
    assert.equal(matchesEliteCategories({ name: p.name, type: 'boundary', boundary: 'national_park' }), true)
    assert.equal(f(p).remove, false)
    assert.equal(pickCategory(p), 'national_park')
  })

  it('BR-POI-010: the city seat node place=city passes on its own, with or without a reference', () => {
    assert.equal(matchesEliteCategories({ name: 'Praha', place: 'city' }), true)
    assert.equal(f({ name: 'Praha', place: 'city', wikidata: 'Q1085' }).remove, false)
    assert.equal(f({ name: 'Brno', place: 'city' }).remove, false)
    assert.equal(pickCategory({ name: 'Brno', place: 'city' }), 'city')
  })
})
