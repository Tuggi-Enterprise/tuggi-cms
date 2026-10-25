/**
 * A strong reference outranks the Stage 1 key (operator order 2026-10-25, Nova Scotia recall: 11 of 79
 * referenced objects). BR-POI-011 item 0: a non-cebwiki article, P1435 or Wikivoyage; item 1 still keeps
 * a bare listed building out on P1435 alone.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { shouldFilterPOI, hasStrongReference, matchesEliteCategories } from '../../lib/shared/poi-filter'
import { STAGE1_REFERENCE_KEYS } from '../../scripts/refine-pbf-elite-node'
import { articleLanguages } from '../../lib/services/country-relevance'

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

  it('BR-POI-011 item 0: off-key, a military base needs historic=* or tourism=*', () => {
    const art = (name: string) => ({ name, wikidata: 'Q17', wikipedia: `en:${name}` })
    assert.equal(f({ ...art('CFB Greenwood'), landuse: 'military' }).remove, true)
    assert.equal(f({ ...art('Stadacona'), military: 'base' }).remove, true)
    assert.equal(f({ ...art('CFB Shearwater'), building: 'yes' }).remove, true)
    assert.equal(f({ ...art('Fort Anne'), landuse: 'military', historic: 'fort' }).remove, false)
  })

  it('BR-POI-011 item 0: off-key, a rail or bus station needs historic=* or tourism=*', () => {
    const art = (name: string) => ({ name, wikidata: 'Q18', wikipedia: `en:${name}` })
    assert.equal(f({ ...art('Truro station'), railway: 'station' }).remove, true)
    assert.equal(f({ ...art('Bridgewater'), railway: 'halt' }).remove, true)
    assert.equal(f({ ...art('Halifax Transit Terminal'), public_transport: 'station' }).remove, true)
    assert.equal(f({ ...art('Acadian Lines Depot'), amenity: 'bus_station' }).remove, true)
    assert.equal(f({ ...art('Windsor Station'), building: 'train_station' }).remove, true)
    assert.equal(f({ ...art('Halifax station'), railway: 'station', building: 'train_station', historic: 'railway_station' }).remove, false)
    // A listed station (P1435) enters with its article even without historic=*.
    assert.equal(f({ name: 'Via Rail Halifax Station', building: 'train_station', wikidata: 'Q3095762', wikipedia: 'en:Halifax station (Nova Scotia)' }, { heritage: true }).remove, false)
  })

  it('BR-POI-011 item 0: an article is a strong reference only when it is about this object', () => {
    // Point of entry carried the item of Hyder, Alaska; Wendy's the item of the company.
    assert.equal(f({ name: 'Point of entry', wikidata: 'Q19', wikipedia: 'en:Hyder, Alaska' }).remove, true)
    assert.equal(f({ name: "Wendy's", amenity: 'fast_food', brand: "Wendy's", 'brand:wikidata': 'Q550258', wikidata: 'Q2559267', wikipedia: "en:The Wendy's Company" }).remove, true)
    // Title with disambiguation, accents and the reverse containment still match.
    assert.equal(f({ name: 'Province House', office: 'government', wikidata: 'Q1', wikipedia: 'en:Province House (Nova Scotia)' }).remove, false)
    assert.equal(f({ name: 'Église Sainte-Marie', building: 'church', wikidata: 'Q20', wikipedia: 'fr:Eglise Sainte-Marie' }).remove, false)
    assert.equal(f({ name: 'Halifax Public Gardens Bandstand', building: 'yes', wikidata: 'Q21', wikipedia: 'en:Halifax Public Gardens' }).remove, false)
    // A mismatched article still counts with P1435 or Wikivoyage.
    assert.equal(f({ name: 'Point of entry', building: 'yes', wikidata: 'Q19', wikipedia: 'en:Hyder, Alaska' }, { heritage: true }).remove, false)
    // Its Wikivoyage page is about the other thing too: Hyder has one.
    assert.equal(f({ name: 'Point of entry', wikidata: 'Q19', wikipedia: 'en:Hyder, Alaska' }, { wikivoyage: true }).remove, true)
    assert.equal(f({ name: 'Seaport Market', building: 'yes', wikidata: 'Q3' }, { wikivoyage: true }).remove, false)
  })

  it('BR-POI-011 item 0: the article may name the object by another of its names, never by its brand', () => {
    assert.equal(f({ name: 'Armoyan Centre', old_name: 'World Trade and Convention Centre', amenity: 'public_building', building: 'yes', wikidata: 'Q8036360', wikipedia: 'en:World Trade and Convention Centre' }).remove, false)
    assert.equal(f({ name: 'BMO', official_name: 'Bank of Montreal', amenity: 'bank', brand: 'BMO', building: 'yes', wikidata: 'Q4856153', wikipedia: 'en:Bank of Montreal Building (Halifax)' }).remove, false)
    assert.equal(f({ name: 'TD', amenity: 'bank', brand: 'TD', 'brand:wikidata': 'Q1080670', building: 'yes', wikidata: 'Q7669906', wikipedia: 'en:TD Centre (Halifax, Nova Scotia)' }).remove, false)
    assert.equal(f({ name: 'TD', amenity: 'bank', brand: 'TD', 'brand:wikidata': 'Q1080670', wikidata: 'Q1080670', wikipedia: 'en:TD Canada Trust' }).remove, true)
    // A building's own item needs no name match; a bare node's does.
    assert.equal(f({ name: 'HMCS Scotian', building: 'government', wikidata: 'Q24191497', wikipedia: 'en:Pier 2, Halifax' }).remove, false)
    assert.equal(f({ name: 'HMCS Scotian', office: 'government', wikidata: 'Q24191497', wikipedia: 'en:Pier 2, Halifax' }).remove, true)
  })

  it('BR-POI-011 item 0: an article counts only in a language of the country or en', () => {
    const ca = articleLanguages('CA', 'en')
    assert.deepEqual([...ca].sort(), ['en', 'fr'])
    const islet = { name: 'Gavin Islet', place: 'island', wikidata: 'Q22631876', wikipedia: 'pl:Gavin Islet' }
    assert.equal(hasStrongReference(islet, { languages: ca }), false)
    assert.equal(hasStrongReference(islet), true)
    // The item's own title in a country language is enough, whatever language the tag picked.
    assert.equal(hasStrongReference(islet, { languages: ca, titles: { fr: 'Îlot Gavin Islet' } }), true)
    assert.equal(hasStrongReference({ ...islet, wikipedia: 'fr:Gavin Islet' }, { languages: ca }), true)
    assert.ok(articleLanguages('CZ', 'cs').includes('en'))
  })

  it('absolute noise stays out even with an article', () => {
    assert.match(f({ name: 'Famous Bench', amenity: 'bench', wikidata: 'Q10', wikipedia: 'en:Famous Bench' }).reason ?? '', /ABSOLUTE_NOISE/)
  })

  it('the refine takes wikidata and wikipedia to Stage 1', () => {
    assert.deepEqual(STAGE1_REFERENCE_KEYS, ['wikidata', 'wikipedia'])
  })
})
