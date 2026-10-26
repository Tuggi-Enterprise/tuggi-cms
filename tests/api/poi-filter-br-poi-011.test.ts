/**
 * BR-POI-011 at import (Czechia, 2026-10-09): what the homolog cleanup did by hand, now in
 * lib/shared/poi-filter (items 0 and 5), scripts/refine-pbf-elite-node#borderVerdict (item 6) and
 * lib/services/country-relevance (items 8–9). BR-POI-010 item 4: the seat is not cut by item 8.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { shouldFilterPOI, hasPublicReference, weakObjectReason } from '../../lib/shared/poi-filter'
import { factsOf } from '../../lib/services/wikidata-sitelinks'
import {
  tagStrength, signalStrength, percentile, lastTwelveMonths, nameInCountryLanguage, placeClass,
  VILLAGE_MIN_EN_PROSE, VILLAGE_MIN_DE_PROSE,
} from '../../lib/services/country-relevance'
import { borderVerdict } from '../../scripts/refine-pbf-elite-node'
import type { RegionPolygon } from '../../lib/services/local-osm-regions'

const f = (properties: Record<string, string>, facts?: { heritage?: boolean; wikivoyage?: boolean }) => shouldFilterPOI({ properties }, facts)
const reason = (properties: Record<string, string>) => f(properties).reason ?? ''

describe('BR-POI-011 item 0: what a public reference is', () => {
  it('a bare wikidata is not one; an article, heritage, P1435, Wikivoyage or a tourist tag is', () => {
    const pond = { name: 'Nový rybník', natural: 'water', water: 'pond', wikidata: 'Q98765432' }
    assert.equal(f(pond).remove, true)
    assert.equal(f({ ...pond, wikipedia: 'cs:Nový rybník (Třeboň)' }).remove, false)
    assert.equal(f({ ...pond, 'wikipedia:de': 'Neuer Teich' }).remove, false)
    assert.equal(f(pond, { heritage: true }).remove, false, 'Wikidata P1435')
    assert.equal(f(pond, { wikivoyage: true }).remove, false)
    assert.equal(f({ ...pond, heritage: '1' }).remove, false)
    assert.equal(hasPublicReference({ tourism: 'viewpoint' }), true)
    assert.equal(hasPublicReference({ tourism: 'artwork', wikidata: 'Q1' }), false)
  })

  it('outside the gates of the rule a bare wikidata is still fame: a square, a church, a bridge', () => {
    assert.equal(f({ name: 'Masarykovo náměstí', place: 'square', wikidata: 'Q12' }).remove, false)
    assert.equal(f({ name: 'Kostel sv. Jakuba', amenity: 'place_of_worship', religion: 'christian', wikidata: 'Q13' }).remove, false)
    assert.equal(f({ name: 'Karlův most', man_made: 'bridge', wikidata: 'Q14' }).remove, false)
  })

  it('a listed building with only P1435 still needs an article (item 1)', () => {
    assert.equal(f({ name: 'Fara', building: 'yes', heritage: '1' }, { heritage: true }).remove, true)
  })
})

describe('BR-POI-011 item 5: objects that enter by their own tag need a public reference', () => {
  const cases: Array<[string, Record<string, string>, string]> = [
    // artwork-weak, memorial-weak and chapel-weak are gone at import: item 23 lets them in (below).
    ['tree-weak', { name: 'Lípa u kostela', natural: 'tree', wikidata: 'Q4' }, 'tree-weak'],
    ['guidepost', { name: 'Rozcestí Pod Lysou', tourism: 'information', historic: 'yes', description: 'turistický rozcestník' }, 'guidepost'],
    ['ruins-weak', { name: 'Zaniklá ves Lhota', historic: 'ruins' }, 'ruins-weak'],
    ['water-weak', { name: 'Dolní Kačák', natural: 'water', wikidata: 'Q5' }, 'water-weak'],
    ['peak-weak', { name: 'Kamenný vrch', natural: 'peak', ele: '612', wikidata: 'Q6' }, 'peak-weak'],
    ['roadside-religious', { name: 'Kříž u cesty', historic: 'memorial', memorial: 'cross', wikidata: 'Q7' }, 'roadside-religious'],
    ['minor-infra', { name: 'Štola Josef', man_made: 'adit', historic: 'yes', wikidata: 'Q8' }, 'minor-infra'],
    ['commerce-sport', { name: 'ibis Praha Old Town', tourism: 'hotel', wikidata: 'Q10' }, 'commerce-sport'],
    ['commerce-sport (stadium)', { name: 'Stadion Evžena Rošického', leisure: 'stadium', wikidata: 'Q11' }, 'commerce-sport'],
    ['generic-name', { name: 'Koupaliště', leisure: 'swimming_area', historic: 'yes', wikidata: 'Q9' }, 'generic-name'],
  ]
  for (const [criterion, props, expected] of cases) {
    it(`${criterion}: without a reference it does not enter; with an article it does`, () => {
      assert.match(reason(props), new RegExp(`WEAK: ${expected}`))
      assert.equal(f({ ...props, wikipedia: `cs:${props.name}` }).remove, false)
    })
  }

  it('generic-name: a register (P1435) does not spare a name that only says what it is; an article does', () => {
    assert.match(f({ name: 'Kaple', amenity: 'place_of_worship', wikidata: 'Q15' }, { heritage: true }).reason ?? '', /generic-name/)
    assert.equal(f({ name: 'Smírčí kříž', historic: 'stone', wikipedia: 'cs:Smírčí kříž (Tuchoraz)' }).remove, false)
  })

  it('keeps the normal path for what the criteria spare', () => {
    assert.equal(weakObjectReason({ natural: 'peak', ele: '1603' }, 'Sněžka', false), null, 'a hill of 1,000 m or more')
    assert.equal(weakObjectReason({ natural: 'water', water: 'lake' }, 'Černé jezero', false), null, 'a lake is not a minor water')
    assert.equal(weakObjectReason({ amenity: 'place_of_worship' }, 'Kostel sv. Václava', false), null, 'a church is not a chapel')
    assert.equal(weakObjectReason({ amenity: 'place_of_worship' }, 'Pfarrkirche St. Martin', false), null)
    assert.equal(weakObjectReason({ historic: 'ruins' }, 'Zřícenina hradu Lichnice', false), null, 'the ruin of a castle')
    assert.equal(weakObjectReason({ historic: 'memorial' }, 'Morový sloup', false), null, 'a plague column')
    assert.equal(weakObjectReason({ tourism: 'information', information: 'office' }, 'Infocentrum', false), null)
    assert.equal(weakObjectReason({ place: 'village' }, 'Kaple', false), null, 'places are items 8 and 10')
  })
})

describe('BR-POI-011 item 6: the border, on the representative point', () => {
  // A 1° square: lon 14..15, lat 50..51. 0.00005° of latitude ≈ 5.5 m.
  const border: RegionPolygon = { outer: [[[14, 50], [15, 50], [15, 51], [14, 51], [14, 50]]], holes: [] }
  const pt = (lon: number, lat: number, properties: Record<string, string>) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties })

  it('a summit 5 m past the line with a Czech name stays (Sněžka); a Polish church 50 m past it goes', () => {
    assert.equal(borderVerdict(border, pt(14.5, 51.00005, { name: 'Sněžka / Śnieżka', natural: 'peak' }), 'cs'), 'tolerated')
    assert.equal(borderVerdict(border, pt(14.5, 51.00045, { name: 'Kościół św. Jadwigi', amenity: 'place_of_worship' }), 'cs'), 'abroad')
  })

  it('a Czech name 2 km past the line goes; inside always stays', () => {
    assert.equal(borderVerdict(border, pt(14.5, 51.02, { name: 'Smrk' }), 'cs'), 'abroad')
    assert.equal(borderVerdict(border, pt(14.5, 50.5, { name: 'Urzeitpark' }), 'cs'), 'inside')
  })

  it('an area decides by its point on surface, not by its first vertex', () => {
    const area = { type: 'Feature', properties: { name: 'Park' }, geometry: { type: 'Polygon', coordinates: [[[14.9, 50.5], [15.3, 50.5], [15.3, 50.6], [14.9, 50.6], [14.9, 50.5]]] } }
    assert.equal(borderVerdict(border, area, 'cs'), 'abroad', 'first vertex inside, most of the area outside')
  })

  it('reads the language by name:<lang>, and by Czech letters', () => {
    assert.equal(nameInCountryLanguage({ name: 'Plöckenstein / Plechý', 'name:cs': 'Plechý' }, 'cs'), true)
    assert.equal(nameInCountryLanguage({ name: 'Urzeitpark Sebnitz' }, 'cs'), false)
    assert.equal(nameInCountryLanguage({ name: 'Dreisesselberg', 'name:de': 'Dreisesselberg' }, 'de'), true)
    assert.equal(nameInCountryLanguage({ name: 'Sněžka' }, undefined), false)
  })
})

describe('BR-POI-011 items 8–9: a village needs a strong signal; BR-POI-010 item 4: the seat does not', () => {
  const none = { p1435: false, wikivoyage: false, enProse: 0, deProse: 0, pageviews: 0 }

  it('the seat and the tag signals keep it without the network', () => {
    assert.equal(tagStrength({ place: 'village' }, true), 'seat')
    assert.equal(tagStrength({ place: 'village', tourism: 'attraction' }, false), 'tourism')
    assert.equal(tagStrength({ place: 'suburb', historic: 'district' }, false), 'historic')
    assert.equal(tagStrength({ place: 'village', wikipedia: 'cs:Lhota' }, false), null, 'an article is not a signal')
  })

  it('P1435, Wikivoyage, long en/de prose or pageviews at the cut keep it; an article alone does not', () => {
    assert.equal(signalStrength({ ...none, pageviews: 99 }, 100), null)
    assert.equal(signalStrength({ ...none, pageviews: 100 }, 100), 'pageviews')
    assert.equal(signalStrength({ ...none, enProse: VILLAGE_MIN_EN_PROSE }, 100), 'en-article')
    assert.equal(signalStrength({ ...none, enProse: VILLAGE_MIN_EN_PROSE - 1, deProse: VILLAGE_MIN_DE_PROSE - 1 }, 100), null)
    assert.equal(signalStrength({ ...none, deProse: VILLAGE_MIN_DE_PROSE }, 100), 'de-article')
    assert.equal(signalStrength({ ...none, p1435: true }, 100), 'P1435')
    assert.equal(signalStrength({ ...none, wikivoyage: true }, 100), 'wikivoyage')
    assert.equal(signalStrength(undefined, 100), null)
  })

  it('the pageview cut is a percentile of the country, over the last 12 complete months', () => {
    assert.equal(percentile(Array.from({ length: 100 }, (_, i) => i + 1), 0.96), 96)
    assert.deepEqual(lastTwelveMonths(new Date(Date.UTC(2026, 9, 9))), { start: '2025100100', end: '2026093000' })
  })

  it('classifies villages and neighbourhoods, and nothing else', () => {
    assert.equal(placeClass({ place: 'hamlet' }), 'village')
    assert.equal(placeClass({ place: 'quarter' }), 'neighbourhood')
    assert.equal(placeClass({ place: 'town' }), null)
  })
})

describe('wikidata-sitelinks#factsOf', () => {
  it('reads the article, P1435, Wikivoyage and the asked titles', () => {
    const e = { sitelinks: { cswiki: { title: 'Sněžka' }, commonswiki: { title: 'C' }, dewikivoyage: { title: 'Schneekoppe' } }, claims: { P1435: [{ mainsnak: { datavalue: { value: { id: 'Q385405' } } } }] } }
    assert.deepEqual(factsOf(e, ['cs', 'en']), { article: 'cs:Sněžka', heritage: ['Q385405'], wikivoyage: true, titles: { cs: 'Sněžka' } })
    assert.deepEqual(factsOf({ sitelinks: { commonswiki: { title: 'X' } } }, []), { article: null, heritage: [], wikivoyage: false, titles: {} })
  })
})

describe('BR-POI-011 item 6: the national border is the ISO-tagged relation', () => {
  it('a member way tagged admin_level=2 exported before the relation is not the border', async () => {
    const { nationalBorderFeature } = await import('../../scripts/refine-pbf-elite-node')
    const ring = [[0, 0], [1, 0], [1, 1], [0, 0]]
    const ustica = { properties: { '@type': 'way', admin_level: '2', boundary: 'administrative' }, geometry: { type: 'MultiPolygon', coordinates: [[ring]] } }
    const italy = { properties: { '@type': 'relation', admin_level: '2', 'ISO3166-1': 'IT' }, geometry: { type: 'MultiPolygon', coordinates: [[ring], [ring]] } }
    assert.equal(nationalBorderFeature([ustica, italy], 'IT'), italy)
    assert.equal(nationalBorderFeature([ustica], 'IT'), undefined)
  })
})

describe('BR-POI-011 items 12–14 (amendment of 2026-10-18): verifiable history counts as a reference', () => {
  const plaque = { name: 'Lapide a Giuseppe Mazzini', historic: 'memorial', memorial: 'plaque' }

  it('item 12.a: a plaque with an inscription enters', () => {
    assert.equal(f({ ...plaque, inscription: 'In questa casa nacque Giuseppe Mazzini il 22 giugno 1805' }).remove, false)
  })

  it('item 12.a/12.b: memorial:text, description and the honoree tags count too', () => {
    assert.equal(f({ ...plaque, 'memorial:text': 'Qui soggiornò Giuseppe Garibaldi nel 1849' }).remove, false)
    assert.equal(f({ ...plaque, 'inscription:it': 'Qui soggiornò Giuseppe Garibaldi nel 1849' }).remove, false)
    assert.equal(f({ ...plaque, 'name:etymology:wikidata': 'Q23677' }).remove, false)
    assert.equal(f({ name: 'Monumento ai caduti di Varzi', historic: 'memorial', memorial: 'war_memorial', 'subject:wikidata': 'Q361' }).remove, false)
  })

  it('item 5: a plaque with nothing does not enter, and a bare wikidata is not history', () => {
    assert.equal(f(plaque).remove, true)
    assert.equal(f({ ...plaque, wikidata: 'Q98765432' }).remove, true)
  })

  it('item 14: a Stolperstein with an inscription does not enter; stone and ghost_bike neither', () => {
    const inscription = 'Hier wohnte Max Levi Jg. 1890 deportiert 1942 ermordet in Auschwitz'
    assert.match(f({ name: 'Stolperstein Max Levi', historic: 'memorial', memorial: 'stolperstein', inscription, 'subject:wikidata': 'Q1' }).reason ?? '', /MEMORIAL_NOISE/)
    assert.match(f({ name: 'Gedenkstein', historic: 'memorial', memorial: 'stone', inscription }).reason ?? '', /MEMORIAL_NOISE/)
    assert.match(f({ name: 'Ghost bike Anna', historic: 'memorial', memorial: 'ghost_bike', inscription }).reason ?? '', /MEMORIAL_NOISE/)
  })

  it('item 13: a plaque whose only text is a Way of the Cross station does not enter', () => {
    assert.equal(f({ ...plaque, name: 'XII Stazione', inscription: 'XII Stazione - Gesù muore in croce' }).remove, true)
  })

  it('item 13: prayer, saint, motto and generic war dead are not facts; a local year is', () => {
    assert.equal(f({ ...plaque, inscription: 'Ave Maria piena di grazia il Signore è con te' }).remove, true)
    assert.equal(f({ ...plaque, inscription: "Sant'Antonio da Padova prega per noi" }).remove, true)
    assert.equal(f({ ...plaque, inscription: 'Pace e bene' }).remove, true)
    // A war memorial enters by item 23 whatever its text; a plaque still needs the fact.
    assert.equal(f({ ...plaque, name: 'Ai caduti', inscription: 'Ai caduti della grande guerra 1915-1918' }).remove, true)
    assert.equal(f({ ...plaque, name: 'Ai caduti', inscription: 'Ai caduti di Varzi nel bombardamento del 12 marzo 1944 e ricostruito nel 1951' }).remove, false)
  })

  it('item 12 reaches the item-5 roadside objects (cross, shrine), not the other minors', () => {
    assert.equal(f({ name: 'Wegkreuz Huber', historic: 'wayside_cross', inscription: 'Errichtet 1872 von der Familie Huber nach dem Hochwasser' }).remove, false)
    assert.equal(f({ name: 'Alter Bahndamm', historic: 'railway', description: 'Trasse der 1872 eröffneten Lokalbahn' }).remove, true)
  })
})

describe('BR-POI-011 item 23 at import (operator, 2026-10-25): what a passer-by sees on the street enters on its name', () => {
  it('a named statue with no reference and no history enters', () => {
    assert.equal(f({ name: 'Samuel de Champlain', tourism: 'artwork', artwork_type: 'statue' }).remove, false)
    assert.equal(f({ name: 'Statue of Joseph Howe', historic: 'memorial', memorial: 'statue' }).remove, false)
  })

  it('a named memorial, war memorial and monument enter', () => {
    assert.equal(f({ name: 'Halifax Explosion Memorial Bell Tower', historic: 'memorial' }).remove, false)
    assert.equal(f({ name: 'Lunenburg Cenotaph', historic: 'memorial', memorial: 'war_memorial' }).remove, false)
    assert.equal(f({ name: 'Kriegerdenkmal Lavant', historic: 'memorial', memorial: 'war_memorial', wikidata: 'Q5' }).remove, false, 'item 2 yields to item 23')
    assert.equal(f({ name: 'Glooscap Monument', historic: 'monument' }).remove, false)
  })

  it('a named mural and other public art enter', () => {
    assert.equal(f({ name: 'Mi\'kmaq Heritage Mural', tourism: 'artwork', artwork_type: 'mural' }).remove, false)
    assert.equal(f({ name: 'Wave Sculpture Halifax', tourism: 'artwork', artwork_type: 'sculpture' }).remove, false)
  })

  it('a named chapel and wayside shrine enter, Protestant too', () => {
    assert.equal(f({ name: 'Hřbitovní kaple', amenity: 'place_of_worship', historic: 'yes', wikidata: 'Q3' }).remove, false)
    assert.equal(f({ name: 'Covenanter Chapel', amenity: 'place_of_worship', religion: 'christian', denomination: 'presbyterian' }).remove, false)
    assert.equal(f({ name: 'Bildstock St. Nikolaus', historic: 'wayside_shrine', wikidata: 'Q1' }).remove, false)
  })

  it('Stolperstein, stone and ghost_bike stay out (item 14)', () => {
    assert.match(reason({ name: 'Stolperstein Max Levi', historic: 'memorial', memorial: 'stolperstein' }), /MEMORIAL_NOISE/)
    assert.match(reason({ name: 'Gedenkstein Huber', historic: 'memorial', memorial: 'stone' }), /MEMORIAL_NOISE/)
    assert.match(reason({ name: 'Ghost bike Anna', historic: 'memorial', memorial: 'ghost_bike' }), /MEMORIAL_NOISE/)
  })

  it('a statue with no name stays out', () => {
    assert.equal(f({ tourism: 'artwork', artwork_type: 'statue' }).remove, true)
    assert.equal(f({ historic: 'memorial', memorial: 'statue' }).remove, true)
  })

  it('what item 23 does not name keeps items 5 and 12: a cross, a plaque with no fact, a church', () => {
    assert.equal(f({ name: 'Hubertuskreuz', historic: 'wayside_cross' }).remove, true)
    assert.match(reason({ name: 'Kříž u cesty', historic: 'memorial', memorial: 'cross', wikidata: 'Q7' }), /roadside-religious/)
    assert.equal(f({ name: 'Lapide a Giuseppe Mazzini', historic: 'memorial', memorial: 'plaque' }).remove, true)
    assert.equal(f({ name: "Kingdom Hall of Jehovah's Witnesses", amenity: 'place_of_worship', denomination: 'jehovahs_witness' }).remove, true, 'a congregation is not a chapel')
    assert.equal(weakObjectReason({ tourism: 'artwork' }, 'Socha Ležící ženy', false), null, 'not weak any more')
    assert.match(reason({ name: 'Socha', tourism: 'artwork', wikidata: 'Q1' }), /generic-name/, 'a name that only says what it is')
  })
})

describe('BR-POI-011 (Nova Scotia, 2026-10-25): the street-name cut only judges a road; "St." at the head is Saint', () => {
  it('St. Peters Canal (waterway=canal + historic) enters', () => {
    assert.equal(f({ name: 'St. Peters Canal', waterway: 'canal', historic: 'canal' }).remove, false)
    assert.equal(f({ name: 'St. Peters Canal National Historic Site', tourism: 'attraction' }).remove, false)
  })
  it('St. Ann\'s Lookoff (tourism=viewpoint) enters', () => {
    assert.equal(f({ name: "St. Ann's Lookoff", tourism: 'viewpoint' }).remove, false)
  })
  it('Main St. (highway=residential) stays out', () => {
    assert.equal(f({ name: 'Main St.', highway: 'residential' }).remove, true)
  })
  it('St. Mary\'s Church (amenity=place_of_worship) is not cut by its name', () => {
    assert.doesNotMatch(reason({ name: "St. Mary's Church", amenity: 'place_of_worship' }), /^STREET/)
  })
  it('a sight tag outranks a street suffix; a locality named like a street stays out', () => {
    assert.doesNotMatch(reason({ name: 'Memory Lane', tourism: 'museum' }), /^STREET/)
    assert.doesNotMatch(reason({ name: 'Blueberry Acres', tourism: 'attraction' }), /^STREET/)
    assert.equal(f({ name: 'Chemin des Vignes', place: 'locality' }).remove, true)
  })
})
