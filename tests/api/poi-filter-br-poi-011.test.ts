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
    ['artwork-weak', { name: 'Socha Ležící ženy', tourism: 'artwork', wikidata: 'Q1' }, 'artwork-weak'],
    ['memorial-weak', { name: 'Pomník Mistra Jana Husa v Lounech', historic: 'memorial', wikidata: 'Q2' }, 'memorial-weak'],
    ['chapel-weak', { name: 'Hřbitovní kaple', amenity: 'place_of_worship', historic: 'yes', wikidata: 'Q3' }, 'chapel-weak'],
    ['tree-weak', { name: 'Lípa u kostela', natural: 'tree', wikidata: 'Q4' }, 'tree-weak'],
    ['guidepost', { name: 'Rozcestí Pod Lysou', tourism: 'information', historic: 'yes', description: 'turistický rozcestník' }, 'guidepost'],
    ['ruins-weak', { name: 'Zaniklá ves Lhota', historic: 'ruins' }, 'ruins-weak'],
    ['water-weak', { name: 'Dolní Kačák', natural: 'water', wikidata: 'Q5' }, 'water-weak'],
    ['peak-weak', { name: 'Kamenný vrch', natural: 'peak', ele: '612', wikidata: 'Q6' }, 'peak-weak'],
    ['roadside-religious', { name: 'Boží muka u cesty', historic: 'memorial', wikidata: 'Q7' }, 'roadside-religious'],
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
