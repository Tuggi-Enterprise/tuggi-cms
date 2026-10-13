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
    assert.equal(f({ name: 'Bildstock St. Nikolaus', historic: 'wayside_shrine', wikipedia: 'de:Bildstock St. Nikolaus' }).remove, false)
    // BR-POI-011 item 0: the register's Wikidata item alone is not a reference.
    assert.equal(f({ name: 'Bildstock St. Nikolaus', historic: 'wayside_shrine', wikidata: 'Q1' }).remove, true)
  })

  it('drops tows and lift stations, keeps referenced gondolas and chair lifts', () => {
    assert.equal(f({ name: 'Lamark II', aerialway: 't-bar' }).remove, true)
    assert.equal(f({ name: 'Rofanseilbahn Talstation', aerialway: 'station' }).remove, true)
    assert.equal(f({ name: 'Materialseilbahn Fritzhütte', aerialway: 'goods' }).remove, true)
    assert.equal(f({ name: 'Thurntaler I', aerialway: 'gondola', wikipedia: 'de:Thurntaler' }).remove, false)
    assert.equal(f({ name: 'Thurntaler I', aerialway: 'gondola', wikidata: 'Q4' }).remove, true, 'BR-POI-011 item 0')
    assert.equal(f({ name: 'Bergbahn Tauplitz II', aerialway: 'chair_lift', wikipedia: 'de:Tauplitz' }).remove, false)
  })

  it('drops an abandoned rail bed that is a road today', () => {
    assert.equal(f({ name: 'Mondsee-Bundesstraße', historic: 'railway', railway: 'abandoned', highway: 'primary' }).remove, true)
  })

  it('drops a pond, keeps a lake', () => {
    assert.equal(f({ name: 'Fischteich Halwachs', natural: 'water', water: 'pond' }).remove, true)
    assert.equal(f({ name: 'Großer See', natural: 'water', water: 'lake' }).remove, false)
    assert.equal(f({ name: 'Speicher Kops', natural: 'water', water: 'reservoir', wikipedia: 'de:Speicher Kops' }).remove, false)
    assert.equal(f({ name: 'Speicher Kops', natural: 'water', water: 'reservoir', wikidata: 'Q2' }).remove, true, 'BR-POI-011 item 0')
  })

  it('drops a branch library and a municipal pool, keeps referenced ones', () => {
    assert.equal(f({ name: 'Büchereien Wien Rabenhof', amenity: 'library' }).remove, true)
    assert.equal(f({ name: 'Österreichische Nationalbibliothek', amenity: 'library', wikidata: 'Q304037', wikipedia: 'de:Österreichische Nationalbibliothek' }).remove, false)
    assert.equal(f({ name: 'Freibad Sigleß', leisure: 'water_park' }).remove, true)
    assert.equal(f({ name: 'Hundezone Augarten', leisure: 'dog_park' }).remove, true)
  })
})

describe('elite filter: keys added for the Austrian capitals', () => {
  it('admits a referenced arts centre, funicular and cemetery, and drops unreferenced ones', () => {
    assert.equal(f({ name: 'OK Offenes Kulturhaus Oberösterreich', amenity: 'arts_centre', wikidata: 'Q2015640', wikipedia: 'de:OK Offenes Kulturhaus' }).remove, false)
    assert.equal(f({ name: 'Kulturzentrum Mitte', amenity: 'arts_centre' }).remove, true)
    assert.equal(f({ name: 'Festungsbahn', railway: 'funicular', wikidata: 'Q145986', wikipedia: 'de:Festungsbahn Salzburg' }).remove, false)
    assert.equal(f({ name: 'Petersfriedhof', landuse: 'cemetery', wikidata: 'Q873904', wikipedia: 'de:Petersfriedhof Salzburg' }).remove, false)
    assert.equal(f({ name: 'Friedhof Liebing', landuse: 'cemetery' }).remove, true)
  })
})

describe('elite filter: a description is not fame for golf courses, marinas and resorts', () => {
  it('drops them without a hard reference', () => {
    assert.equal(f({ name: 'Golfclub Montafon', leisure: 'golf_course', description: '18-Loch-Platz im Tal' }).remove, true)
    assert.equal(f({ name: 'Segelclub Ebensee', leisure: 'marina', description: 'Hafen des Segelclubs' }).remove, true)
    assert.equal(f({ name: 'Hafen Bregenz Marina', leisure: 'marina', wikipedia: 'de:Hafen Bregenz' }).remove, false)
  })
})

// Austria, operator order of 2026-10-07: noise that a tag or a register vouches for. A listed
// private house is BR-POI-004 item 4 (not open to the public); the rest is curation with no BR yet.
describe('elite filter: register-vouched noise (BR-POI-004)', () => {
  it('drops a listed building with no other tag unless it has a Wikipedia article', () => {
    assert.equal(f({ name: 'Pfarrhof', building: 'yes', heritage: '2' }).remove, true)
    // The BDA mints one Wikidata item per monument: wikidata alone is not fame here.
    assert.equal(f({ name: 'Bauernhaus', building: 'farm', heritage: '2', wikidata: 'Q37918511' }).remove, true)
    assert.equal(f({ name: 'Wohnhaus', building: 'yes', historic: 'yes' }).remove, true)
    assert.equal(f({ name: 'Schloss Goldenstein', building: 'yes', heritage: '2', wikidata: 'Q2241229', wikipedia: 'de:Schloss Goldenstein' }).remove, false)
  })

  it('keeps a listed building that carries a real category, and keeps villages', () => {
    assert.equal(f({ name: 'Burg Hochosterwitz', historic: 'castle', heritage: '2' }).remove, false)
    assert.equal(f({ name: 'Spitz', place: 'village' }).remove, false)
  })

  it('BR-POI-011 (Czechia, 2026-10-09): drops springs, cliffs, parks, gardens and neighbourhoods without a reference', () => {
    assert.equal(f({ name: 'Studánka pod lesem', natural: 'spring' }).remove, true)
    assert.equal(f({ name: 'Litovelský pramen', natural: 'spring', wikipedia: 'cs:Litovelský pramen' }).remove, false)
    assert.equal(f({ name: 'Litovelský pramen', natural: 'spring', wikidata: 'Q7' }).remove, true, 'BR-POI-011 item 0')
    assert.equal(f({ name: 'Krejčovická skála', natural: 'cliff' }).remove, true)
    assert.equal(f({ name: 'Alšova vyhlídka', natural: 'cliff', tourism: 'viewpoint' }).remove, false, 'a viewpoint keeps the normal path')
    assert.equal(f({ name: 'Pizzerie Na Hřišti', leisure: 'park' }).remove, true)
    assert.equal(f({ name: 'Stromovka', leisure: 'park', wikipedia: 'cs:Stromovka' }).remove, false)
    assert.equal(f({ name: 'růžový sad', leisure: 'garden' }).remove, true)
    assert.equal(f({ name: 'Sídliště Novodvorská', place: 'neighbourhood' }).remove, true)
    assert.equal(f({ name: 'Malá Strana', place: 'neighbourhood', wikipedia: 'cs:Malá Strana' }).remove, false)
    assert.match(f({ name: 'Studánka', natural: 'spring' }).reason ?? '', /natural=spring/)
  })

  it('drops a war memorial, a ski lift and a gallery without a public reference (BR-POI-011 items 0, 2–4)', () => {
    assert.equal(f({ name: 'Kriegerdenkmal Lavant', historic: 'memorial', memorial: 'war_memorial' }).remove, true)
    // BR-POI-011 item 0 lists the heritage tag as a reference: a listed war memorial now enters.
    assert.equal(f({ name: 'Kriegerdenkmal Lavant', historic: 'memorial', memorial: 'war_memorial', heritage: '2' }).remove, false)
    assert.equal(f({ name: 'Kriegerdenkmal Mauthausen', historic: 'memorial', memorial: 'war_memorial', wikipedia: 'de:Kriegerdenkmal Mauthausen' }).remove, false)
    assert.equal(f({ name: 'Kriegerdenkmal Mauthausen', historic: 'memorial', memorial: 'war_memorial', wikidata: 'Q5' }).remove, true, 'BR-POI-011 item 0')
    assert.equal(f({ name: 'Gaisberg Sesselbahn', aerialway: 'chair_lift' }).remove, true)
    assert.equal(f({ name: 'Gondelbahn Hahnenkamm', aerialway: 'gondola' }).remove, true)
    assert.equal(f({ name: 'Galerie Kugler', tourism: 'gallery' }).remove, true)
    assert.equal(f({ name: 'Galerie Belvedere', tourism: 'gallery', wikipedia: 'de:Belvedere (Wien)' }).remove, false)
  })
})
