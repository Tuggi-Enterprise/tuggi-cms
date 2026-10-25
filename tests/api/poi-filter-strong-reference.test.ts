/**
 * A strong reference outranks the Stage 1 key (operator order 2026-10-25, Nova Scotia recall: 11 of 79
 * referenced objects). BR-POI-011 item 0: a non-cebwiki article, P1435 or Wikivoyage; item 1 still keeps
 * a bare listed building out on P1435 alone.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { shouldFilterPOI, hasStrongReference, matchesEliteCategories } from '../../lib/shared/poi-filter'
import { STAGE1_REFERENCE_KEYS } from '../../scripts/refine-pbf-elite-node'

const f = (properties: Record<string, string>, facts?: { heritage?: boolean; wikivoyage?: boolean }) => shouldFilterPOI({ properties }, facts)

describe('BR-POI-011 item 0: a strong reference outranks the category key', () => {
  it('office=government with an article enters; with a bare wikidata it does not', () => {
    const p = { name: 'Province House', office: 'government', building: 'public', wikidata: 'Q1' }
    assert.equal(matchesEliteCategories(p), false)
    assert.equal(f({ ...p, wikipedia: 'en:Province House (Nova Scotia)' }).remove, false)
    assert.equal(f(p).remove, true)
  })

  it('building=yes with an article enters; with P1435 alone it stays out (item 1)', () => {
    const p = { name: 'Halifax Club', building: 'yes', wikidata: 'Q2' }
    assert.equal(f({ ...p, wikipedia: 'en:Halifax Club' }).remove, false)
    assert.match(f(p, { heritage: true }).reason ?? '', /BARE_HERITAGE/)
  })

  it('a Wikivoyage listing lets an untyped building in', () => {
    assert.equal(f({ name: 'Halifax Seaport Farmers Market', building: 'yes', wikidata: 'Q3' }, { wikivoyage: true }).remove, false)
  })

  it('a cebwiki-only article is not a reference', () => {
    const p = { name: 'Some Hill Building', building: 'yes', wikidata: 'Q4', wikipedia: 'ceb:Some Hill Building' }
    assert.equal(hasStrongReference(p), false)
    assert.equal(f(p).remove, true)
    assert.equal(f({ name: 'Other', office: 'government', 'wikipedia:ceb': 'Other' }).remove, true)
  })

  it('boundary=national_park and boundary=protected_area with an article enter', () => {
    assert.equal(f({ name: 'Kejimkujik National Park', boundary: 'national_park', wikidata: 'Q5', wikipedia: 'en:Kejimkujik National Park' }).remove, false)
    assert.equal(f({ name: 'Cape Breton Highlands National Park', boundary: 'protected_area', protect_class: '2', wikidata: 'Q6', wikipedia: 'en:Cape Breton Highlands National Park' }).remove, false)
  })

  it('a hotel with an article enters', () => {
    assert.equal(f({ name: 'Château Frontenac', tourism: 'hotel', building: 'hotel', wikidata: 'Q7', wikipedia: 'en:Château Frontenac' }).remove, false)
  })

  it('a common road and an admin boundary stay out even with an article', () => {
    assert.equal(f({ name: 'Spring Garden Road', highway: 'secondary', wikidata: 'Q8', wikipedia: 'en:Spring Garden Road' }).remove, true)
    assert.equal(f({ name: 'Halifax County', boundary: 'administrative', admin_level: '6', type: 'boundary', wikidata: 'Q9', wikipedia: 'en:Halifax County' }).remove, true)
  })

  it('BR-POI-011 item 0: off-key, a boundary with an article enters only as a park', () => {
    const art = (name: string) => ({ name, wikidata: 'Q11', wikipedia: `en:${name}` })
    assert.equal(f({ ...art('Millbrook First Nation'), boundary: 'aboriginal_lands' }).remove, true)
    assert.equal(f({ ...art('Halifax West'), boundary: 'political' }).remove, true)
    assert.equal(f({ ...art('Kejimkujik National Park'), boundary: 'national_park' }).remove, false)
  })

  it('BR-POI-011 item 0: off-key, a school or a hospital with an article needs historic=* or tourism=*', () => {
    const p = { name: 'Citadel High School', amenity: 'school', building: 'school', wikidata: 'Q12', wikipedia: 'en:Citadel High School' }
    assert.equal(f(p).remove, true)
    assert.equal(f({ name: 'Acadia University', amenity: 'university', wikidata: 'Q13', wikipedia: 'en:Acadia University' }).remove, true)
    assert.equal(f({ name: 'Victoria General', amenity: 'hospital', wikidata: 'Q14', wikipedia: 'en:Victoria General Hospital' }).remove, true)
    assert.equal(f({ ...p, historic: 'building' }).remove, false)
  })

  it('BR-POI-011 item 0: off-key, an industrial park and a pipeline stay out even with an article', () => {
    assert.equal(f({ name: 'Burnside Industrial Park', landuse: 'industrial', wikidata: 'Q15', wikipedia: 'en:Burnside Industrial Park' }).remove, true)
    assert.equal(f({ name: 'Maritimes Pipeline', man_made: 'pipeline', wikidata: 'Q16', wikipedia: 'en:Maritimes Pipeline' }).remove, true)
  })

  it('absolute noise stays out even with an article', () => {
    assert.match(f({ name: 'Famous Bench', amenity: 'bench', wikidata: 'Q10', wikipedia: 'en:Famous Bench' }).reason ?? '', /ABSOLUTE_NOISE/)
  })

  it('the refine takes wikidata and wikipedia to Stage 1', () => {
    assert.deepEqual(STAGE1_REFERENCE_KEYS, ['wikidata', 'wikipedia'])
  })
})
