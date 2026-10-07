/**
 * Elite filter (lib/shared/poi-filter#shouldFilterPOI): objects whose only "fame" is their own tag —
 * wayside crosses and shrines, ski tows and lift stations, abandoned rail beds, ponds and basins,
 * branch libraries, municipal pools — need wikipedia/wikidata/heritage. Austria import, 2026-10-07.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { shouldFilterPOI } from '../../lib/shared/poi-filter'

const f = (properties: Record<string, string>) => shouldFilterPOI({ properties })

describe('elite filter: minor objects need a hard reference', () => {
  it('drops a named wayside cross, keeps a listed one', () => {
    assert.equal(f({ name: 'Hubertuskreuz', historic: 'wayside_cross' }).remove, true)
    assert.equal(f({ name: 'Hubertuskreuz', historic: 'wayside_cross', heritage: '2' }).remove, false)
    assert.equal(f({ name: 'Bildstock St. Nikolaus', historic: 'wayside_shrine', wikidata: 'Q1' }).remove, false)
  })

  it('drops tows and lift stations, keeps gondolas and chair lifts', () => {
    assert.equal(f({ name: 'Lamark II', aerialway: 't-bar' }).remove, true)
    assert.equal(f({ name: 'Rofanseilbahn Talstation', aerialway: 'station' }).remove, true)
    assert.equal(f({ name: 'Materialseilbahn Fritzhütte', aerialway: 'goods' }).remove, true)
    assert.equal(f({ name: 'Thurntaler I', aerialway: 'gondola' }).remove, false)
    assert.equal(f({ name: 'Bergbahn Tauplitz II', aerialway: 'chair_lift' }).remove, false)
  })

  it('drops an abandoned rail bed that is a road today', () => {
    assert.equal(f({ name: 'Mondsee-Bundesstraße', historic: 'railway', railway: 'abandoned', highway: 'primary' }).remove, true)
  })

  it('drops a pond, keeps a lake', () => {
    assert.equal(f({ name: 'Fischteich Halwachs', natural: 'water', water: 'pond' }).remove, true)
    assert.equal(f({ name: 'Großer See', natural: 'water', water: 'lake' }).remove, false)
    assert.equal(f({ name: 'Speicher Kops', natural: 'water', water: 'reservoir', wikidata: 'Q2' }).remove, false)
  })

  it('drops a branch library and a municipal pool, keeps referenced ones', () => {
    assert.equal(f({ name: 'Büchereien Wien Rabenhof', amenity: 'library' }).remove, true)
    assert.equal(f({ name: 'Österreichische Nationalbibliothek', amenity: 'library', wikidata: 'Q304037' }).remove, false)
    assert.equal(f({ name: 'Freibad Sigleß', leisure: 'water_park' }).remove, true)
    assert.equal(f({ name: 'Hundezone Augarten', leisure: 'dog_park' }).remove, true)
  })
})

describe('elite filter: keys added for the Austrian capitals', () => {
  it('admits a referenced arts centre, funicular and cemetery, and drops unreferenced ones', () => {
    assert.equal(f({ name: 'OK Offenes Kulturhaus Oberösterreich', amenity: 'arts_centre', wikidata: 'Q2015640' }).remove, false)
    assert.equal(f({ name: 'Kulturzentrum Mitte', amenity: 'arts_centre' }).remove, true)
    assert.equal(f({ name: 'Festungsbahn', railway: 'funicular', wikidata: 'Q145986' }).remove, false)
    assert.equal(f({ name: 'Petersfriedhof', landuse: 'cemetery', wikidata: 'Q873904' }).remove, false)
    assert.equal(f({ name: 'Friedhof Liebing', landuse: 'cemetery' }).remove, true)
  })
})
