/**
 * POI FILTER - SINGLE SOURCE OF TRUTH (Elite Filter)
 * 
 * This file contains the authoritative "Elite" filtering logic used across:
 * 1. PBF Refinement Scripts (Deno)
 * 2. Supabase Edge Functions (Deno)
 * 3. CMS Importer Service (Node.js)
 * 4. Overpass Capture Logic
 */

export interface POIFilterResult {
  remove: boolean;
  reason?: string;
}

export const CATEGORIES = [
  "tourism",
  "historic",
  "natural",
  "leisure",
  "amenity=theatre",
  "amenity=place_of_worship",
  "amenity=marketplace",
  "amenity=townhall",
  "amenity=courthouse",
  "amenity=library",
  "man_made=lighthouse",
  "man_made=windmill",
  "man_made=tower",
  "man_made=water_tower",
  "aeroway=aerodrome",
  "aerialway",
  // A cascata no OSM é waterway=waterfall, não natural=waterfall (zero ocorrências na Islândia,
  // 447 nomeadas no primeiro tag). Sem `waterway` aqui o Stage 1 do osmium descartava a categoria
  // inteira antes de o filtro elite ver qualquer coisa — Seljalandsfoss inclusive.
  "waterway=waterfall",
  // Campos de lava nomeados (Eldhraun, Berserkjahraun): feição de paisagem própria da Islândia,
  // sob a chave `geological`, que nenhuma outra categoria alcança.
  "geological=volcanic_lava_field",
  // Passos de montanha (Fimmvörðuháls, Námaskarð): topônimos de travessia, sempre com nome
  // próprio e frequentemente com wiki — nenhuma outra chave os alcança.
  "mountain_pass",
  // Pontes-marco (Ölfusárbrú, Borgarfjarðarbrú). Só passavam por acidente, quando alguém
  // também as marcava com tourism=attraction.
  "man_made=bridge",
  // Barragens e corredeiras nomeadas; `waterway` já entra aqui pelas cascatas.
  "waterway=dam",
  "waterway=rapids",
  "historic=city_gate",
  "historic=fort",
  "historic=castle",
  "heritage",
  "place=suburb",
  "place=neighbourhood",
  "place=town",
  "place=village",
  "place=square",
  // Austrian capitals (2026-10-07) were missing OK Linz, the Festspielhaus St. Pölten, the
  // Festungsbahn and the Petersfriedhof: none of these keys reached Stage 1. They pass only with
  // wikipedia/wikidata/heritage (isMinorWithoutReference).
  "amenity=arts_centre",
  "railway=funicular",
  "landuse=cemetery",
  "amenity=grave_yard",
  // Czechia (2026-10-09): the Wikidata recall found whole classes cut at Stage 1 — 50 of 70
  // monasteries (Kladruby, Teplá), the spa houses, the 4 national parks, 32 of 194 Karlovy Vary /
  // Mariánské Lázně springs tagged only amenity=drinking_water + water_characteristic=mineral —
  // and 12 cities (Praha, Brno) whose seat node is place=city (BR-POI-010 #4). Each still needs
  // fame further down (RESTRICTED_UTILITY monastery, TAG_BLOCKLIST spa/drinking_water/type=boundary).
  "amenity=monastery",
  "amenity=spa",
  "water_characteristic=mineral",
  "boundary=national_park",
  "place=city",
  // Mexico recall (2026-10-22): Coyoacán, San Ángel and the alcaldías are place=borough|city_district,
  // which no key reached. They pass only with a public reference (MINOR_PLACE).
  "place=borough",
  "place=city_district"
];

/**
 * Stage 1 (osmium tags-filter) keeps referenced objects on purpose — a way's nodes and a matched
 * relation's member ways — because without them osmium export cannot build the geometry. Those
 * referenced objects reach Stage 3 carrying their own tags (roads, rails, gates) and match none of
 * CATEGORIES: 31,161 rows of the German import (2026-08-14) came in that way, 24.5k of them plain
 * `highway=secondary/primary/tertiary` road ways. This gate restores the Stage 1 intent.
 */
export function matchesEliteCategories(props: any): boolean {
  return CATEGORIES.some(expr => {
    const [key, value] = expr.split('=');
    if (!props[key]) return false;
    if (!value) return true;
    return String(props[key]).split(';').some(v => v.trim() === value);
  });
}

// Street furniture tagged `tourism=information`. It is already in TAG_BLOCKLIST, but OSM info
// boards almost always carry `description` (12,667 of 12,962 in Germany), and description alone
// sets isFamous, which bypasses the blocklist. `office`/`visitor_centre` stay out: those are real.
export const INFO_FURNITURE = ['board', 'map', 'guidepost', 'route_marker', 'audioguide', 'terminal', 'tactile_model'];

// Memorial subtypes that are markers, not destinations, cut with no condition (BR-POI-011 item 14): a
// Stolperstein is a 10cm brass cobblestone (41k in Germany alone), dozens per block, each the story of a
// person and not of the place. Each victim has their own Wikidata item and an inscription, so neither
// the wikidata guard nor item 12 applies here. A plaque is not here: it enters by item 12.
export const MEMORIAL_NOISE = ['stolperstein', 'stone', 'ghost_bike'];

// ---- BR-POI-011 item 12: verifiable history also counts as a reference for the objects of items 2 and 5 ----
// Only what the tags show (12.a, and the tag half of 12.b). Out of this filter because they need a
// lookup: 12.b "name matched to a person or event" and 12.c (facts on the object's own Wikidata item).

/** Item 13: text that fits any place — prayer, Way of the Cross, biblical episode. Never a fact. */
const DEVOTIONAL_TEXT = /\b(via crucis|kreuzweg|stazione|statio|station [ivxl\d]+|ave maria|pater noster|padre nostro|vater unser|ora pro nobis|prega per noi|requiem|gloria patri|gegrüßet|gelobt sei|lodato sia|sia lodato|deo gratias|in hoc signo|inri|ecce homo|ave crux|crux ave|spes unica|miserere|agnus dei|ave regina|salve regina|o crux|gesù (cade|incontra|muore|è|e'|viene)|jesus (fällt|begegnet|stirbt|wird)|annunciazione|natività|crocifissione|deposizione|ultima cena|verkündigung|kreuzigung|abendmahl)\b/i;
/** Item 13: a saint's name, the war dead in general. A fact only with a local year. */
const SAINT_TEXT = /\b(san|santa|santo|sant'|s\.|ss\.|st\.|hl\.|heilige[rn]?|madonna|beata|maria|sv\.|svat[ýáé])\s/i;
const WAR_TEXT = /\b(caduti|guerra|gefallenen|weltkrieg|krieg|war\b|guerre|morts|padlým|válk)/i;
const WORLD_WAR_YEAR = /^(191[4-8]|19(39|4[0-5]))$/;
const YEAR = /\b(1[0-9]{3}|20[0-9]{2})\b/g;
/** Below this, a text without any year is a motto or a label ("Pace", "Gedenktafel"), not a fact. */
const MIN_UNDATED_FACT_WORDS = 5;

function isSubstantiveText(raw: unknown): boolean {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (text.length < 6 || /^(yes|no)$/i.test(text) || DEVOTIONAL_TEXT.test(text)) return false;
  const years = text.match(YEAR) ?? [];
  if ((SAINT_TEXT.test(text) || WAR_TEXT.test(text)) && !years.some(y => !WORLD_WAR_YEAR.test(y))) return false;
  return years.length > 0 || text.split(' ').length >= MIN_UNDATED_FACT_WORDS;
}

/** The objects item 12 names: memorial, plaque, war memorial, public art, statue, chapel, shrine, cross. */
function isHistoryObject(props: any): boolean {
  return ['memorial', 'monument', 'wayside_cross', 'wayside_shrine', 'wayside_chapel', 'tree_shrine'].includes(String(props.historic))
    || props.tourism === 'artwork' || props.amenity === 'place_of_worship'
    || ['chapel', 'wayside_shrine'].includes(String(props.building)) || props.memorial === 'cross';
}

/**
 * BR-POI-011 item 12 (tags only): an item-12 object with ≥ 1 substantive fact from its own text
 * (12.a: inscription, inscription:*, memorial:text, description — item 13 filters the generic ones)
 * or its honoree (12.b: name:etymology:wikidata, subject:wikidata). Stolperstein never gets here (item 14).
 */
export function hasVerifiableHistory(props: any): boolean {
  if (!isHistoryObject(props)) return false;
  if (props['name:etymology:wikidata'] || props['subject:wikidata']) return true;
  return Object.keys(props)
    .filter(k => k === 'inscription' || k.startsWith('inscription:') || k === 'memorial:text' || k === 'description')
    .some(k => isSubstantiveText(props[k]));
}

// Objects whose own tag is the only "fame" they carry, so isFamous lets every one of them through.
// Austria (2026-10-07): 7,617 wayside crosses and shrines (historic=* counts as fame), ~700 ski
// tows, lift stations and goods ropeways (the whole `aerialway` key is a Stage 1 category), 585
// abandoned rail beds (half of them roads today), ~1,000 ponds, reservoirs and basins, ~380 branch
// libraries and ~200 municipal pools. Each one stays only with wikipedia/wikidata/heritage.
export const MINOR_HISTORIC = ['wayside_cross', 'wayside_shrine', 'tree_shrine', 'railway'];
export const TOURIST_AERIALWAYS = ['cable_car', 'gondola', 'chair_lift', 'mixed_lift', 'funicular'];
export const MINOR_WATER = ['pond', 'reservoir', 'basin', 'wastewater', 'fishpond', 'canal', 'lock', 'harbour', 'moat', 'groundwater', 'river', 'stream', 'ditch', 'drain'];
export const MINOR_AMENITY = ['library', 'arts_centre', 'grave_yard'];
// golf_course and marina sat in RESTRICTED_UTILITY, where any description counts as fame: 169 golf
// courses and 116 yacht-club harbours of Austria passed that way. resort: one holiday-flat park as 26 ways.
// Czechia (2026-10-09): ~2,060 neighbourhood parks and ~400 gardens with no reference, a park as
// "Pizzerie Na Hřišti" among them.
export const MINOR_LEISURE = ['water_park', 'dog_park', 'tanning_salon', 'ice_rink', 'sports_hall', 'indoor_play', 'firepit', 'disc_golf_course', 'track', 'miniature_golf', 'golf_course', 'marina', 'resort', 'park', 'garden'];
// Czechia (2026-10-09), without any reference: 1,887 springs (studánky), ~660 cliffs, ~310 valleys,
// ~290 wetlands, ~190 grasslands (model airfields, ski slopes), ~160 bare rocks, 88 bays of reservoirs.
export const MINOR_NATURAL = ['spring', 'cliff', 'valley', 'wetland', 'grassland', 'bare_rock', 'bay'];
// Czechia (2026-10-09): ~1,300 neighbourhoods (housing estates, street corners) with no reference.
// borough/city_district (Mexico, 2026-10-22) are not in item 5: they enter Stage 1 only to bring the
// referenced ones (item 0), so an unreferenced one goes the same way.
export const MINOR_PLACE = ['neighbourhood', 'borough', 'city_district'];

/**
 * What the object's Wikidata item says, resolved by the caller (lib/services/wikidata-sitelinks#wikidataFacts).
 * The article itself travels as the `wikipedia` tag, which the caller fills from the sitelinks.
 */
export interface ReferenceFacts {
  /** Wikidata P1435 (heritage designation). */
  heritage?: boolean
  /** A Wikivoyage page. */
  wikivoyage?: boolean
  /** The item's Wikipedia titles by language (sitelinks), for the languages the caller asked. */
  titles?: Record<string, string>
  /**
   * Article languages that count for the country being imported — its own and `en`
   * (country-relevance#articleLanguages). Absent: any language counts.
   */
  languages?: readonly string[]
}

export const REFERENCE_TOURISM = ['attraction', 'museum', 'viewpoint'];

/**
 * BR-POI-011 item 0 — public reference: a Wikipedia article in any language (tag `wikipedia` or
 * `wikipedia:<lang>`, filled from the Wikidata sitelinks by the caller), a heritage tag, Wikidata
 * P1435, a Wikivoyage page, or tourism=attraction|museum|viewpoint. `wikidata` alone is NOT one:
 * the Czech water register minted an item for each of 9,758 ponds (2026-10-09).
 */
export function hasPublicReference(props: any, facts?: ReferenceFacts): boolean {
  return hasWikipediaArticle(props)
    || !!props.heritage || !!props.listed_status || !!props['ref:bic'] || !!props.unesco
    || REFERENCE_TOURISM.includes(String(props.tourism))
    || !!facts?.heritage || !!facts?.wikivoyage;
}

/**
 * A Wikipedia article written by people: tag `wikipedia` or `wikipedia:<lang>`, except cebwiki, which
 * Lsjbot generated from the geonames dump (BR-POI-011 item 0; Nova Scotia 2026-10-25: 4,196 of 4,529
 * Wikidata matches were cebwiki only). The sitelink side is lib/services/wikidata-sitelinks#NOT_AN_ARTICLE.
 */
export function hasWikipediaArticle(props: any): boolean {
  return Object.keys(props).some(k => (k === 'wikipedia' || k.startsWith('wikipedia:')) && !!props[k]
    && k !== 'wikipedia:ceb' && !/^ceb:/i.test(String(props[k])));
}

/**
 * BR-POI-011 item 0, the part that outranks the Stage 1 key (operator, 2026-10-25): an article, P1435 or
 * Wikivoyage lets an object in even when no key of CATEGORIES matches it — Province House
 * (office=government + building=public), a historic building tagged only building=*, a hotel, a
 * boundary=protected_area park. A bare `wikidata` is not one. A road (`highway=*`) stays out whatever
 * its reference: the street is never a POI (poi-taxonomy `excluded_street`). So does what
 * offKeyWithoutVisit names.
 */
export function hasStrongReference(props: any, facts?: ReferenceFacts): boolean {
  if (props.highway || offKeyWithoutVisit(props, facts)) return false;
  if (facts?.heritage) return true;
  const article = articleSubject(props, facts);
  // The Wikivoyage page of an item whose article is about something else is about that thing too.
  return article === 'this' || (article === 'none' && !!facts?.wikivoyage);
}

/** Lowercase, no diacritics, no disambiguation "(…)", punctuation as spaces, padded for word matching. */
const normalizeTitle = (s: string) => ` ${s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/\(.*?\)/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
const CORPORATE_WORDS = / (the|company|co|inc|corporation|corp|group|limited|ltd|restaurants?|international|holdings) /g;
const NAME_KEYS = ['name', 'old_name', 'alt_name', 'official_name', 'short_name', 'building:name'];

/**
 * Whom the object's article is about (Tech Lead, 2026-10-25, Nova Scotia gains). `this`: its title
 * contains one of the object's names or the reverse — "Point of entry" tagged with the item of Hyder,
 * Alaska is not. Only articles in a language of the country or `en` count (`facts.languages`; Gavin
 * Islet had only plwiki); none left is `none`. The article of the object's brand is `other`: Wendy's
 * carried the item of The Wendy's Company, whose title contains the name; the TD Centre is not TD.
 * A building (`building=*`) needs no name match.
 */
function articleSubject(props: any, facts?: ReferenceFacts): 'this' | 'other' | 'none' {
  const articles: [string, string][] = Object.entries(facts?.titles ?? {});
  for (const [k, v] of Object.entries(props)) {
    if (k !== 'wikipedia' && !k.startsWith('wikipedia:')) continue;
    const m = /^([a-z-]+):(.+)$/.exec(String(v));
    const lang = k === 'wikipedia' ? m?.[1] : k.slice('wikipedia:'.length);
    if (lang) articles.push([lang, m && m[1] === lang ? m[2] : String(v)]);
  }
  const counted = articles.filter(([lang]) => lang !== 'ceb' && (!facts?.languages || facts.languages.includes(lang)));
  if (!counted.length) return 'none';
  if (props['brand:wikidata'] && props['brand:wikidata'] === props.wikidata) return 'other';
  const brand = props.brand ? normalizeTitle(String(props.brand)) : null;
  const names = [...NAME_KEYS, ...(facts?.languages ?? []).map(l => `name:${l}`)]
    .flatMap(k => String(props[k] ?? '').split(';')).map(normalizeTitle).filter(n => n.trim());
  const own = counted.map(([, title]) => normalizeTitle(title))
    .filter(t => t.trim() && !(brand && t.replace(CORPORATE_WORDS, ' ').replace(CORPORATE_WORDS, ' ').replace(/ +/g, ' ') === brand));
  // A mapped footprint's own item is the building, even under another name: HMCS Scotian is
  // en:Pier 2, Halifax; the Oval Pavillion, en:Emera Oval.
  if (own.length && props.building && props.building !== 'no') return 'this';
  return own.some(t => names.some(n => t.includes(n) || n.includes(t))) ? 'this' : 'other';
}

const VISITABLE_BOUNDARIES = ['national_park', 'protected_area'];
const SCHOOL_AMENITIES = ['school', 'college', 'university', 'kindergarten'];

/**
 * Off-key objects whose article describes an institution or a territory, not a place to visit
 * (Tech Lead, 2026-10-25, Nova Scotia gains): any boundary but a park — administrative (the town is
 * the place=* node, BR-POI-010), aboriginal_lands, political —, an industrial or business park, a
 * pipeline, and a school, a hospital, a military base (CFB) or a rail/bus station unless historic=* or
 * tourism=* is on the object — a listed station with an article still enters. Only the
 * hasStrongReference path: an object a CATEGORIES key lets in is not judged here.
 */
function offKeyWithoutVisit(props: any, facts?: ReferenceFacts): boolean {
  if (props.boundary && !VISITABLE_BOUNDARIES.includes(String(props.boundary))) return true;
  if (props.man_made === 'pipeline' || props.landuse === 'industrial' || props.industrial) return true;
  const institution = SCHOOL_AMENITIES.includes(String(props.amenity)) || props.amenity === 'hospital'
    || ['school', 'university', 'hospital'].includes(String(props.building));
  // A base and a station: the article is about the unit or the line (Nova Scotia gains, 2026-10-25).
  const military = props.landuse === 'military' || !!props.military || /\bCFB\b/.test(String(props.name ?? ''));
  const station = ['station', 'halt'].includes(String(props.railway)) || props.public_transport === 'station'
    || props.amenity === 'bus_station' || props.building === 'train_station';
  if (station && facts?.heritage) return false; // a listed station (P1435) with its article still enters
  return (institution || military || station) && !props.historic && !props.tourism;
}

/** The MINOR_* gate: true when the object enters only by one of those tags and has no public reference (BR-POI-011 item 0). */
export function isMinorWithoutReference(props: any, hasHardReference: boolean): boolean {
  if (hasHardReference) return false;
  if (MINOR_HISTORIC.includes(String(props.historic))) return !hasVerifiableHistory(props) && !isStreetVisible(props);
  // Only when the lift is the reason it got in: a lift that is also tourism=* or historic=* keeps the normal path.
  if (props.aerialway && !props.tourism && !props.historic && !TOURIST_AERIALWAYS.includes(String(props.aerialway))) return true;
  if (props.natural === 'water' && MINOR_WATER.includes(String(props.water))) return true;
  if (!props.tourism && !props.historic && (props.railway === 'funicular' || props.landuse === 'cemetery')) return true;
  if (!props.tourism && !props.historic && (MINOR_AMENITY.includes(String(props.amenity)) || MINOR_LEISURE.includes(String(props.leisure)))) return true;
  // pickCategory order: a natural=* or place=* object is minor only when no earlier key got it in.
  if (!props.tourism && !props.historic && !props.leisure && MINOR_NATURAL.includes(String(props.natural))) return true;
  if (!props.tourism && !props.historic && !props.leisure && !props.natural && !props.amenity && MINOR_PLACE.includes(String(props.place))) return true;
  return false;
}

const EMPTY_TAG_VALUES = new Set(['yes', 'no', 'true', 'false']);

/**
 * The category is the OSM key that got the object past Stage 1, in the priority order of
 * CATEGORIES. Two traps this walks around:
 *  - Keys admitted only by the tail of CATEGORIES (man_made, waterway, geological, aeroway, place)
 *    were absent here, so lighthouses, waterfalls, towns and aerodromes landed with a null
 *    category: 458 of Iceland's 2,747 POIs, and the same in the German, Dutch and Swiss imports.
 *  - `tourism=yes` / `historic=yes` carry no category at all, yet sit at the head of the order and
 *    used to win: the waterfall Rjúkandi (tourism=yes + waterway=waterfall) came in as "yes".
 *    Skipping the empty values lets the describing tag through.
 * undefined means the object got in only by `heritage` or by an empty `historic`/`tourism`: a
 * listed building with no other tag.
 */
export function pickCategory(props: any): string | undefined {
  // A national park relation usually also carries leisure=nature_reserve; the park is the more
  // specific class (lib/shared/poi-taxonomy keeps national_park apart from nature_reserve).
  if (props.boundary === 'national_park') return 'national_park';
  // Mineral spring tagged as a tap: the homolog files them as `spring`, as natural=spring would be.
  if (props.water_characteristic === 'mineral' && props.amenity === 'drinking_water'
    && !props.tourism && !props.historic && !props.leisure && !props.natural) return 'spring';
  const ordered = [
    props.tourism, props.historic, props.leisure, props.natural, props.amenity,
    props.aerialway, props.man_made, props.waterway, props.geological, props.aeroway, props.place,
  ];
  const found = ordered.find(v => v && !EMPTY_TAG_VALUES.has(String(v).toLowerCase()));
  if (found) return found;
  // Boolean-flag categories: the key itself names the category, so skipping the empty value
  // would leave nothing (mountain_pass=yes -> "mountain_pass").
  if (props.mountain_pass) return 'mountain_pass';
  // Stage 1 keys outside the list above (CATEGORIES): take the value.
  if (props.railway === 'funicular') return 'funicular';
  if (props.landuse === 'cemetery') return 'cemetery';
  if (isScenicRoad(props)) return 'scenic_road';
  return undefined;
}

/**
 * A scenic road relation (Großglockner-Hochalpenstraße, Nockalmstraße): one POI for the whole road,
 * built by lib/services/osm-scenic-roads. Its member ways stay out, as every road does.
 */
export function isScenicRoad(props: any): boolean {
  return props.type === 'route' && props.route === 'road' && props.scenic === 'yes';
}

// Ski-area lifts. A cable car (Pendelbahn) and a funicular stay out: those are the summit rides.
export const SKI_LIFTS = ['chair_lift', 'gondola', 'mixed_lift'];

/**
 * Noise that a tag or a register vouches for, and a tourist does not. Austria (2026-10-07):
 *  - listed buildings with no other tag (Pfarrhof, Bauernhaus, Wohnhaus): 2,129, every one with
 *    heritage=2 from the BDA. The register also mints one Wikidata item per monument (1,402 in the
 *    Q37M-Q38M range alone), so `wikidata` vouches for nothing here: only an encyclopedia article
 *    does — the `wikipedia` tag, which refine-pbf-elite-node fills from the Wikidata sitelinks
 *    before this runs (lib/services/wikidata-sitelinks). 1,807 had no article;
 *  - war memorials: 409 of 590 with no wikipedia/wikidata;
 *  - ski-area chair lifts and gondolas: 399 of 520;
 *  - tourism=gallery, almost always an art dealer or a studio: 261 of 273.
 */
export function touristNoiseReason(props: any, hasReference: boolean = hasPublicReference(props), wikivoyage = false): string | null {
  // Item 1: P1435/heritage alone do not keep a bare building; a Wikivoyage listing does (item 0 via hasStrongReference).
  if (!hasWikipediaArticle(props) && !pickCategory(props) && !wikivoyage) return 'BARE_HERITAGE: listed building with no Wikipedia article';
  // BR-POI-011 items 3–4: "without a reference" in the sense of item 0 — a bare wikidata is not one.
  // Item 2 (war memorial) yields at import to item 23: a war memorial is a memorial (isStreetVisible).
  if (hasReference) return null;
  if (SKI_LIFTS.includes(String(props.aerialway)) && !props.tourism && !props.historic) return `SKI_LIFT: aerialway=${props.aerialway} without a public reference`;
  if (props.tourism === 'gallery') return 'GALLERY: commercial gallery without a public reference';
  return null;
}

// ---- BR-POI-011 item 5, the part the Czech homolog cleanup found by hand (2026-10-09) ----
// Ruins, generic names, non-roadside chapels and commerce/sport are in the cleanup, not yet in the text of item 5.
// Each one passes the older gates because its own tag counts as fame (historic=*, a description) or
// because a register minted a Wikidata item for it. CZ homolog, removed after import: 1,285 artworks,
// 2,690 memorials/statues, 783 chapels, 190 trees, 252 trail signs, 703 ruins, 429 waters, 305 hills
// below 1,000 m, 1,032 roadside crosses and shrines, 561 dams/adits/airfields, 242 generic names.

/** BR-POI-011 item 5: a hill below this height enters only with a public reference. */
export const MINOR_PEAK_MAX_ELE_M = 1000;
/** Bodies of water that are not "minor" (item 5 names pond, reservoir, basin "and the other minor waters"). */
export const MAJOR_WATER = ['lake', 'lagoon'];
const ROADSIDE_HISTORIC = ['wayside_cross', 'wayside_shrine', 'wayside_chapel', 'tree_shrine'];
const COMMERCE_TOURISM = ['hotel', 'guest_house', 'hostel', 'motel', 'apartment', 'camp_site', 'caravan_site', 'chalet'];
const COMMERCE_AMENITY = ['restaurant', 'cafe', 'bar', 'pub', 'fast_food', 'biergarten'];
const SPORT_VENUES = ['stadium', 'sports_centre', 'pitch', 'playground', 'fitness_centre'];
const MEMORIAL_HISTORIC = ['memorial', 'monument', 'stone', 'tomb'];
// Names that say "church", not "chapel": Czech names lead with the kind (Kostel sv. Václava), other
// languages often compound it (Pfarrkirche). A place_of_worship that is none of these is a chapel.
const CHURCH_NAME = /^(kostel|chrám|katedrála|bazilika|klášter|synagoga|sbor|modlitebna|evangelický|husův)|kirche|church|cathedral|église|eglise|chiesa|duomo|iglesia|igreja|catedral|kościół|kosciol|bazylika|katedra|münster|synagog|kloster|abbey|monastery/i;
// Czech small religious objects named by kind (Boží muka, Kaplička, Smírčí kříž, Socha sv. Floriána).
const ROADSIDE_RELIGIOUS_NAME = /^(kaple|kaplička|kaplice|boží muka|božích muk|kříž|křížek|smírčí kříž|zvonice|zvonička|výklenková kaple|kalvárie|mariánský sloup|socha sv|sv\.|svat[ýáé]|panna maria|jan nepomucký)/i;
// A ruin is kept when it is the ruin of a sight (castle, fort, monastery, church, lookout tower).
const RUIN_OF_A_SIGHT = /(hrad|hrád|tvrz|zámek|zámeč|klášter|kostel|kaple|castle|burg|schloss|kloster|kirche|rozhledn)/i;
// Plague / Marian / Trinity column on a town square: a staple of Czech old towns, often only in cs-wiki by name.
const PLAGUE_COLUMN = /(morový|mariánský|trojiční|nejsvětější trojice).*sloup|sloup.*(nejsvětější trojice|panny marie)/i;
/**
 * Names that only say what the object is. Czech (2026-10-09) — the filter has no country context, and
 * the words do not collide with names in other languages; the next country's language goes here.
 */
export const GENERIC_NAMES = new Set([
  'kaple', 'kaplička', 'kříž', 'křížek', 'pomník', 'památník', 'boží muka', 'socha', 'busta', 'hrob', 'hráz',
  'hráz rybníka', 'fara', 'zvonice', 'zvonička', 'pomník padlým', 'pomník obětem', 'pomník obětem války',
  'pomník obětem 1. světové války', 'pomník padlým v 1. světové válce', 'pomník obětem světových válek',
  'obětem světových válek', 'obecní úřad', 'městský úřad', 'městská knihovna', 'místní knihovna',
  'obecní knihovna', 'okresní soud', 'venkovská usedlost', 'měšťanský dům', 'památný strom', 'smírčí kříž',
  'mlýn', 'studánka', 'pramen', 'památná lípa', 'lípa', 'dub', 'pamětní deska', 'kamenný kříž', 'litinový kříž',
  'stadion', 'zimní stadion', 'hřiště', 'koupaliště', 'kříž s kristem',
]);

const STREET_VISIBLE_HISTORIC = ['memorial', 'monument', 'wayside_shrine', 'wayside_chapel'];
// A place_of_worship is a chapel only when its name says so. Without the word it is a congregation:
// Nova Scotia (2026-10-25), 103 of 115 such "chapels" were Kingdom Halls, parishes and Bible fellowships.
const CHAPEL_NAME = /chapel|kapel|kapl[eiy]|cappell|capill|capel/i;

/**
 * BR-POI-011 item 23, at import (operator, 2026-10-25: "vamos deixar passar as estátuas"): what a
 * passer-by sees on the street — memorial (a war memorial too), statue, monument, mural and other public
 * art, wayside shrine, chapel — enters on its name alone: "são coisas que as pessoas podem ver na rua e
 * ter curiosidade", and the description draws on the surroundings. Items 2, 5, 12 and 13 no longer bar
 * these. Still out: Stolperstein, `stone`, `ghost_bike` (item 14, MEMORIAL_NOISE runs first), a nameless
 * one (shouldFilterPOI), and what item 23 does not name — a cross (`wayside_cross`, `memorial=cross`) and
 * a plaque (`memorial=plaque`, which item 5 lists apart from the memorial; it enters by item 12).
 */
export function isStreetVisible(props: any): boolean {
  const memorialType = String(props.memorial || props['memorial:type'] || '');
  if (MEMORIAL_NOISE.includes(memorialType) || ['cross', 'plaque'].includes(memorialType)) return false;
  if (STREET_VISIBLE_HISTORIC.includes(String(props.historic)) || props.tourism === 'artwork') return true;
  if (['chapel', 'wayside_shrine'].includes(String(props.building))) return true;
  return props.amenity === 'place_of_worship' && CHAPEL_NAME.test(String(props.name ?? ''));
}

/**
 * BR-POI-011 item 5: the object entered by one of these tags and has no public reference (item 0) —
 * returns which one, or null. Places are out of scope (items 8 and 10, BR-POI-010).
 */
export function weakObjectReason(props: any, name: string, hasReference: boolean): string | null {
  if (props.place) return null;
  // A name that only says what it is ("Kaple", "Smírčí kříž") gives the audio nothing to tell, even when a
  // register vouches for the object (P1435): only an article or a heritage tag spares it. CZ homolog: 242.
  if (GENERIC_NAMES.has(name.toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim())
    && !props.wikipedia && !Object.keys(props).some(k => k.startsWith('wikipedia:')) && !props.heritage) return 'generic-name';
  if (hasReference || hasVerifiableHistory(props) || isStreetVisible(props)) return null;
  if (['zoo', 'theme_park'].includes(String(props.tourism)) || PLAGUE_COLUMN.test(name)) return null;
  const historic = String(props.historic || '');
  const isChurch = props.building === 'church' || CHURCH_NAME.test(name);
  if (!isChurch && (ROADSIDE_HISTORIC.includes(historic) || ['chapel', 'wayside_shrine'].includes(String(props.building))
    || props.memorial === 'cross'
    || ((props.amenity === 'place_of_worship' || ['memorial', 'monument', 'stone'].includes(historic)) && ROADSIDE_RELIGIOUS_NAME.test(name)))) return 'roadside-religious';
  if (MEMORIAL_HISTORIC.includes(historic)) return 'memorial-weak';
  if (props.tourism === 'artwork') return 'artwork-weak';
  if (props.amenity === 'place_of_worship' && !isChurch) return 'chapel-weak';
  if (props.natural === 'tree') return 'tree-weak';
  if (props.tourism === 'information' && !['office', 'visitor_centre', 'tourist_office'].includes(String(props.information))) return 'guidepost';
  if (historic === 'ruins' && !RUIN_OF_A_SIGHT.test(name)) return 'ruins-weak';
  if (props.natural === 'water' && !MAJOR_WATER.includes(String(props.water))) return 'water-weak';
  if (props.natural === 'peak' && !(parseFloat(props.ele) >= MINOR_PEAK_MAX_ELE_M)) return 'peak-weak';
  if (props.waterway === 'dam' || ['adit', 'mineshaft'].includes(String(props.man_made)) || ['mine', 'mine_shaft', 'district'].includes(historic)
    || props.boundary === 'religious_administration' || props.aeroway === 'aerodrome') return 'minor-infra';
  // Lodging, food, shops and sport venues are commerce, not a sight; a chain hotel carries a wikidata
  // (ibis, Motel One). A historic one stays (Grandhotel Pupp has its article anyway). CZ homolog: 413.
  if (!historic && (COMMERCE_TOURISM.includes(String(props.tourism)) || COMMERCE_AMENITY.includes(String(props.amenity)) || !!props.shop
    || SPORT_VENUES.includes(String(props.leisure)) || props.highway === 'bus_stop' || props.public_transport === 'platform')) return 'commerce-sport';
  // Item 10: monastery, spa, national park and mineral spring "always enter", subject to item 0.
  if (['monastery', 'spa'].includes(String(props.amenity)) || props.boundary === 'national_park' || props.water_characteristic === 'mineral') return 'always-enter-unreferenced';
  return null;
}

export const FILTER_CONFIG = {
  // Categories that are completely blocked unless they are famous (Wiki/Wikidata)
  TAG_BLOCKLIST: [
    'bench', 'waste_basket', 'trash_can', 'telephone', 'bicycle_parking', 
    'parking', 'path', 'track', 'fence', 'wall', 'hedge', 'pole', 'post',
    'surveillance', 'vending_machine', 'atm', 'recycling', 'toilets', 
    'outdoor_seating', 'waste_disposal', 'picnic_table', 'steps',
    'resort', 'beach_resort',
    'supermarket', 'convenience', 'bakery', 'laundry', 'dry_cleaning',
    'hairdresser', 'beauty', 'dentist', 'veterinary', 'car_repair', 'car_wash',
    'fuel', 'bank', 'pharmacy', 'atm', 'fast_food', 'food_court',
    'restaurant', 'cafe', 'pub', 'bar', 'ice_cream', 'nightclub', 'dance', 'studio',
    'fitness_centre', 'sports_centre', 'swimming_pool', 'camp_site', 'love_hotel',
    'car_rental', 'bicycle_rental', 'fishing', 'public_bath', 'cinema', 'theatre',
    'information', 'waymark', 'guidepost', 'board', 'map', 'signpost', 'notice',
    'chalet', 'events_venue', 'theme_park', 'picnic_site', 'horse_riding',
    'school', 'university', 'college', 'kindergarten', 'childcare', 'language_school', 'driving_school',
    'playground', 'pitch', 'fitness_station', 'sports_centre_legacy',
    'hospital', 'clinic', 'doctors', 'social_facility', 'community_centre', 'social_centre',
    'police', 'fire_station', 'post_office', 'government', 'office', 'courthouse', 'townhall_legacy', 
    'public_building', 'industrial', 'works', 'wastewater_plant', 'power_plant', 'pumping_station', 
    'prison', 'jail', 'bus_station', 'taxi', 'ferry_terminal', 'airport', 'station', 'stop_position', 
    'bus_stop', 'survey_point', 'funeral_hall', 'dojo', 'slipway', 'pipeline', 'monitoring_station',
    'common', 'vehicle_inspection', 'boundary', 'storage_tank', 'bridge',
    'drinking_water', 'bureau_de_change', 'bbq', 'bandstand',
    'wayside_cross', 'wayside_shrine', 'flagpole', 'service', 'military', 'quarry',
    'studio', 'tunnel', 'mast', 'boundary_stone', 'crematorium', 'reservoir_covered',
    'reservoir', 'water_tower', 'bridge', 'gate', 'fence', 'pole', 'post', 'wall', 'hedge',
    'brothel', 'nursing_home', 'animal_breeding', 'internet_cafe', 'recreation_ground', 'shelter',
    'tree', 'tree_row', 'scrub', 'wood', 'peak', 'volcano', 'cave_entrance', 'rock', 'stone', 'islet',
    'music_school', 'charity', 'social_centre', 'dormitory', 'nursery', 'prep_school', 'animal_shelter',
    'caravan_site', 'bowling_alley', 'charging_station', 'antenna', 'stripclub', 'animal_boarding',
    'coworking_space', 'clock', 'shipping_company', 'waste_transfer_station', 'emergency_service',
    'wilderness_hut', 'hunting_stand', 'communications_tower', 'mast',
    'breakwater', 'wreck', 'amusement_arcade', 'dancing_school', 'mineshaft', 
    'bicycle_repair_station', 'mortuary', 'parking_entrance', 'water_point',
    'advertising', 'traffic_signals', 'bollard', 'pitch', 'cross', 'parking_space',
    'Matadouro', 'container_terminal', 'embankment', 'water_works', 'boundary', 'multipolygon',
    'conference_centre', 'exhibition_centre', 'rescue_station', 'escape_game', 'route', 'indoor',
    'car_pooling', 'district', 'club', 'pista_de_Kart', 'enforcement', 'farm', 'training_school',
    'gate', 'Fepam', 'kindergarden', 'sport', 'crane', 'spa', 'hangar', 'watering_place',
    'trail_riding_station', 'comun', 'canteen', 'watershed', 'building', 'NDB', 'institutional',
    'site', 'propriedade_particular_-_local_fechado', 'motorcycle_rental', 'Creche', 'stone',
    'events_centre', 'dispõem_de_quadras_de_futebol_para_lazer.', '*', 'no', 'office',
    'house', 'sauna', 'dressing_room', 'courtyard', 'kiln', 'antenna', 'mast', 'ticket_validator',
    'auditorium', 'casino', 'register_office', 'miniature_golf', 'boat_rental', 'street_cabinet',
    'driver_training', 'water_tap', 'payment_centre', 'compressed_air', 'public_bookcase', 'cabin',
    'morgue', 'clearcut', 'goods_conveyor', 'adult_gaming_centre', 'summer_camp', 'Presídio',
    'camp_pitch', 'karaoke_box', 'archive', 'trampoline_park', 'railway', 'cutline', 'training',
    'swimming_area', 'sanitary_dump_station', 'money_transfer', 'lavoir', 'dam', 'substation',
    'pet', 'ship', 'canteen', 'no', 'watershed', 'greenhouse', 'sailing_club', 'cannon_modern',
    'store', 'stock_exchange', 'vacant', 'audiologist', 'post_box', 'bunker_silo', 'gallows',
    'event_center', 'company', 'governament', 'toy_library', 'pastry', 'travel agency', 'civic',
    'protected_area', 'animal_training', 'dive_centre', 'gambling', 'stage', 'wood store',
    'fixme', 'place_of_mourning', 'veterinary_pharmacy', 'internet_service_provider', 'piscina',
    'submarine_cable', 'pat', 'dyke', 'piste:halfpipe', 'gantry',
    'motorcycle_parking', 'dog_toilet', 'motorcycle_taxi',
    'yes', 'building', 'way', 'node'
  ],

  // Categories that ONLY pass if they are explicitly historical (Even with Wiki)
  RESTRICTED_UTILITY_TAGS: [
    'school', 'university', 'college', 'kindergarten', 'childcare',
    'hospital', 'clinic', 'doctors', 'social_facility', 'community_centre', 'social_centre',
    'police', 'fire_station', 'post_office', 'government', 'office', 'courthouse', 'townhall_legacy',
    'townhall', 'marketplace', // prefeituras/mercados comuns não são POI turístico (Mairie/Marché genéricos) — passam só com historic/heritage/wiki/descrição ou via exemção nomeada (isGovernmentExemption/isMajorMarket)
    'public_building', 'bureau_de_change', 'bank', 'pharmacy', 'atm',
    'research_institute', 'golf_course', 'sports_centre', 'monastery',
    'church', 'tomb', 'biergarten', 'village_hall', 'hotel', 'watermill', 'alpine_hut', 
    'guest_house', 'hostel', 'fort', 'battlefield', 'manor', 'windmill', 'bathing_place', 
    'masonic_lodge', 'quilombo', 'heritage', 'protected_building', 'culture_center', 
    'Casa_da_Memória', 'Casa_Histórica', 'railway_station', 'square', 'hackerspace',
    'território_de_práticas_ancestrais_afrogaúchas', 'Araucária_Centenária'
  ],

  // Terms in the name that indicate urban junk or infrastructure
  NAME_BLOCKLIST: [
    "secretaria", "departamento", "sede comunal", "delegación",
    "clínica", "clinica", "odontologia", "escola", "colégio", "colegio",
    "banco", "caixa", "atm", "lotérica", "loterica", "correio", "post office",
    "academia", "fitness", "crossfit", "estacionamento", "parking",
    "edifício", "edificio", "condomínio", "condominio", "residencial",
    "lotissement", "résidence", "residence ", // FR — loteamentos/condomínios (entram como place=neighbourhood)
    "urbanización", "urbanització", "polígono industrial", "polígon industrial", "polígono empresarial", // ES — loteamentos/zonas
    "farmácia", "drogaria", "pharmacy", "oxxo", "7-eleven",
    "mercado", "supermercado", "panificadora", "padaria", "lavanderia",
    "auto center", "borracharia", "oficina",
    "estação tubo", "estacao tubo", "ponto de ônibus", "ponto de onibus",
    "parada de ", "terminal de ", "agência ", "agencia ",
    "centro de saúde", "centro de saude", "posto de saúde", "posto de saude",
    "posto policial", "delegacia", "fórum", "forum",
    "câmara municipal", "camara municipal", "vereadores",
    "path continues", "trailhead", "waymark", "guidepost", "route map", "notice board", "information board", "signpost"
  ],

  RELIGIOUS_BRANDS: [
    "universal do reino", "igreja universal", "mundial do poder",
    "internacional da graça", "deus é amor", "renascer em cristo",
    "bola de neve", "assembléia de deus", "testemunhas de jeová",
    "salão do reino", "congregacao cristã", "congregacao crista",
    "adventista", "iasd", "sétimo dia", "setimo dia"
  ],

  ACCOMMODATION_TYPES: [
    "hotel", "motel", "guest_house", "hostel", "apartment", "chalet", "alpine_hut",
    // camp_site/caravan_site já estavam no TAG_BLOCKLIST, mas lá uma `description` qualquer conta
    // como fama e os liberava: os 38 campings da Islândia passaram todos por uma descrição
    // boilerplate ("part of the Icelandic Camping Card Project"). Aqui valem a mesma regra dos
    // hotéis — só entram com wikipedia/wikidata/heritage/historic.
    "camp_site", "caravan_site"
  ],

  GENERIC_PARK_NAMES: [
    "praça", "praca", "pça", "pça.", "largo", "jardim", "praceta", "rotunda", // PT
    "plaza", "plazoleta", "paseo", "alameda", "parque de ", // ES
    "piazza", "piazzale", // IT
    "square", "plaza", "garden", "park of " // EN
  ],

  STREET_KEYWORDS: {
    PREFIXES: [
      "rua ", "avenida ", "av. ", "travessa ", "viela ", "alameda ", "rodovia ", "estrada ", "beira mar ", "beiramar ", // PT
      "calle ", "avenida ", "av. ", "paseo ", "camino ", "carretera ", // ES (castelhano)
      // ES regional — vazavam por só ter castelhano: catalão/galego/asturiano/basco
      "carrer ", "avinguda ", "passeig ", "camí ", "carreró ", "ronda ", "travessera ", "travessia ", // CAT
      "rúa ", "camiño ", "corredoira ", "travesía ", // GAL
      "camín ", // AST
      "kale ", "kalea ", "etorbidea ", "errepidea ", // EUS
      "acceso ", "accés ", // acesso/via de acesso
      "via ", "viale ", "corso ", "strada ", // IT
      // IT extra — endereços/vias que vazavam (via/viale/corso já cobertos acima)
      "contrada ", "rione ", "vicolo ", "salita ", "calata ", "fondamenta ", "traversa ", "largo ", "piazzale ", "ciclovia ", // IT
      // FR — "rue"/"route"/"chemin" respondem por ~24k de ruído sem esses prefixos (boulevard/avenue já cobertos pelo EN)
      "rue ", "route ", "chemin ", "ruelle ", "impasse ", "voie ", "quai ", "cours ", "sentier ", "passage ", "allée ", "allee ", "promenade ", "chaussée ", "chaussee ", "faubourg ", "montée ", "montee ", "rond-point ", "ancienne route ", // FR
      "street ", "avenue ", "st. ", "ave. ", "road ", "rd. ", "lane ", "way ", "drive ", "dr. ", "boulevard ", "blvd. ", "highway " // EN
    ],
    SUFFIXES: [
      " street", " avenue", " st.", " ave", " road", " rd.", " lane", " way", " drive", " dr.", " boulevard", " blvd.", // EN
      // EN/UK/IE tipos residenciais que vazavam (o tipo vem no fim: "Baker Close", "X Terrace")
      " close", " court", " crescent", " terrace", " grove", " mews", " row", " rise", " parade", " estate", " roundabout", " cottages", " wharf", // EN/UK/IE
      // US — subdivisões/loteamentos (o clássico naming americano); famosos (wikidata) são preservados
      " estates", " subdivision", " acres", " meadows", " oaks", " crossing", " pointe", " addition", " villas", " landing", " farms", " run", " heights", " hills", " shores", " glen" // US
    ],
    // DE — a rua alemã é composto colado ("Bahnhofstraße"), então nem PREFIXES nem SUFFIXES (que
    // todos começam com espaço) pegavam: 32.055 linhas no import da Alemanha. "platz" fica de fora
    // de propósito — praça é POI e `place=square` é categoria mantida.
    COMPOUND_SUFFIXES: [
      "straße", "strasse", "str.", "gasse", "allee", "damm", "ufer", "chaussee",
      "weg", "pfad", "steig", "stieg", "twiete", "zeile", "siedlung"
    ]
  },

  SINGLE_WORD_WHITELIST: [
    "masp", "pinacoteca", "copan", "catavento", "maracanã", "corcovado", "obelisco", "obelisk", "panteon", "panteão", "louvre", "prado"
  ]
};

// Marcos sem valor turístico (cippi de fronteira, marcos de km, pontos geodésicos).
// historic=boundary_stone marca hasHistoric=true, então o TAG_BLOCKLIST normal não pega.
export const MARKER_NOISE_TAGS = ['boundary_stone', 'milestone', 'survey_point', 'geodesic', 'distance_marker'];

// A cenote is a cave entrance, and every one was NATURAL_NOISE without wikidata (Mexico 2026-10-22:
// Dos Ojos, X-Kekén). A named one enters with a reference, a `cave:type` or a cenote name.
const CENOTE_NAME = /\bcenotes?\b/i;
function isNotableCave(props: any, name: string, hasReference: boolean): boolean {
  return hasReference || !!props['cave:type'] || CENOTE_NAME.test(name);
}
/**
 * Centered filtering logic.
 * Handles both "tags" (Overpass) and "properties" (GeoJSON) formats.
 */
export function shouldFilterPOI(poi: any, facts?: ReferenceFacts): POIFilterResult {
  const props = poi.properties || poi.tags || {};
  const name = (props.name || "").trim();
  const nameLower = name.toLowerCase();

  const hasWikipedia = hasWikipediaArticle(props);
  const hasHistoric = !!props.historic;
  const hasHeritage = !!props.heritage || !!props.listed_status || !!props['ref:bic'] || !!props.unesco;
  // BR-POI-011 item 0 governs the gates of that rule (hasHardReference). Outside them a bare wikidata
  // still counts as fame: squares, churches, bridges, caves, town halls (Czechia 2026-10-09: 237 + 84 +
  // 43 + 36 + 21 kept by the operator's cleanup, none of them in BR-POI-011).
  const hasWikidata = !!props.wikidata;
  // P1435 and Wikivoyage count wherever wikidata does; the article is filled into `wikipedia` by the
  // caller.
  const hasReferenceFacts = !!facts?.heritage || !!facts?.wikivoyage;
  const hasDescription = !!(props.description && props.description.trim().length > 5);
  
  let isFamous = hasWikipedia || hasHeritage || hasHistoric || hasWikidata || hasReferenceFacts || hasDescription;
  const hasReference = hasWikipedia || hasWikidata || hasReferenceFacts;

  // --- 1. BASIC FILTERS ---
  if (!name || name.length < 2) return { remove: true, reason: "Strict: Local sem nome" };

  // Hard reference for structural noise: BR-POI-011 item 0 (article, heritage, P1435, Wikivoyage,
  // tourism=attraction|museum|viewpoint). hasHistoric does not count: historic=boundary_stone would
  // let every border stone through. Bare wikidata does not count either (item 0).
  const hasHardReference = hasPublicReference(props, facts);

  // Nome sem nenhuma letra (ex.: "16", "1/31", "1797", "40-193-0001-29") = ruído de OSM
  // (cippi de fronteira, marcos de km, anos/códigos soltos). Mantém só se referenciado.
  if (!/[A-Za-zÀ-ÿ]/.test(name) && !hasHardReference) {
    return { remove: true, reason: `NUMERIC_NAME: Nome sem contexto ('${name}')` };
  }

  // Marcos sem valor turístico (cippi de fronteira, marcos de km, pontos geodésicos).
  // historic=boundary_stone marca hasHistoric=true, então o TAG_BLOCKLIST normal não pega.
  const isMarkerNoise = [props.historic, props.man_made, props.highway, props.marker]
    .some(v => v && MARKER_NOISE_TAGS.includes(String(v)));
  if (isMarkerNoise && !hasHardReference) {
    return { remove: true, reason: `MARKER_NOISE: Marco sem valor (${props.historic || props.man_made || props.highway || props.marker})` };
  }

  if (isScenicRoad(props)) return { remove: false };

  if (props.route || props.type === "route") {
    return { remove: true, reason: "Category: Rota/Trajeto (não é um ponto fixo)" };
  }

  // An object Stage 1 brought only as a referenced member (road, rail, gate, entrance) — unless its
  // strong reference outranks the key (hasStrongReference; the refine takes wikidata/wikipedia to Stage 1).
  if (!matchesEliteCategories(props) && !hasStrongReference(props, facts)) {
    return { remove: true, reason: "OFF_CATEGORY: não casa nenhuma categoria do Stage 1" };
  }

  if (props.tourism === "information" && INFO_FURNITURE.includes(String(props.information)) && !hasHardReference) {
    return { remove: true, reason: `INFO_FURNITURE: tourism=information/${props.information}` };
  }

  const memorialType = String(props.memorial || props["memorial:type"] || "");
  if (MEMORIAL_NOISE.includes(memorialType)) {
    return { remove: true, reason: `MEMORIAL_NOISE: memorial=${memorialType}` };
  }

  if (isMinorWithoutReference(props, hasHardReference)) {
    return { remove: true, reason: `MINOR: ${props.railway === "funicular" ? "railway=funicular" : props.landuse === "cemetery" ? "landuse=cemetery" : props.historic ? 'historic=' + props.historic : props.aerialway ? 'aerialway=' + props.aerialway : props.water ? 'water=' + props.water : props.amenity ? 'amenity=' + props.amenity : props.leisure ? 'leisure=' + props.leisure : props.natural ? 'natural=' + props.natural : 'place=' + props.place} sem wiki/heritage` };
  }

  const noise = touristNoiseReason(props, hasHardReference, !!facts?.wikivoyage);
  if (noise) return { remove: true, reason: noise };

  const weak = weakObjectReason(props, name, hasHardReference);
  if (weak) return { remove: true, reason: `WEAK: ${weak} without a public reference (BR-POI-011 item 5)` };

  // --- 2. ELITE EXCEPTIONS (Full exemption if recognized landmark) ---
  const isCulturalExemption = (
    props.tourism === "museum" || 
    !!props.museum ||
    props.amenity === "theatre" || 
    props.amenity === "arts_centre" ||
    props.tourism === "gallery" ||
    (props.tourism === "information" && (props.information === "office" || props.information === "visitor_centre")) ||
    props.historic === "city_gate" ||
    props.historic === "castle" ||
    props.historic === "fort" ||
    nameLower.includes("mercado municipal") ||
    nameLower.includes("mercat municipal") ||
    nameLower.includes("museu municipal") ||
    nameLower.includes("mercado central") ||
    nameLower.includes("mercat central") ||
    nameLower.includes("lonja de la seda") ||
    nameLower.includes("llotja de la seda") ||
    nameLower.includes("torres de serranos") ||
    nameLower.includes("torres de quart")
  );

  const isGovernmentExemption = (
    (props.amenity === "townhall" || props.building === "public") &&
    (nameLower.startsWith("prefeitura") || nameLower.includes("paço municipal") || nameLower.includes("paco municipal") || nameLower.includes("ayuntamiento"))
  );

  const isTransportLandmark = (
    props.aerialway === "chair_lift" || 
    props.aerialway === "cable_car" || 
    props.aerialway === "gondola" ||
    (props.railway === "station" && (props.historic || hasWikipedia))
  );

  const isMajorMarket = props.amenity === "marketplace" && ["municipal", "mercadão", "mercadao", "market hall", "público", "publico", "paco", "paço", "mercado de", "mercado da", "mercado do", "central"].some(t => nameLower.includes(t));

  const isEliteSquare = (props.amenity === "plaza" || props.place === "square") && 
    ["mayor", "real", "ayuntamiento", "virgen", "constitucion", "pau", "reina", "seu"].some(t => nameLower.includes(t));

  // Landmarks explicitamente nomeados (Prefeitura/Paço Municipal/Ayuntamiento, Mercado
  // Municipal/Mercadão, Plaza Mayor/Real…) são mantidos mesmo sem descrição — o nome já é o
  // sinal. Preserva BR/ES agora que townhall/marketplace entraram no RESTRICTED_UTILITY;
  // "Mairie"/"Marché" genéricos (FR) não casam essas exemções e caem no filtro.
  if (isGovernmentExemption || isMajorMarket || isEliteSquare) {
    isFamous = true;
  }

  if (isCulturalExemption || isTransportLandmark || hasHeritage) {
    if (hasDescription && !props.description.includes('http')) {
      isFamous = true;
    }
  }

  // --- 2.5 NAME BLOCKLIST (Technical Noise) ---
  const name_check = props.name || props['name:pt'] || props['name:en'] || props['name:es'];
  if (name_check) {
    const nameLower = name_check.toLowerCase();
    const NAME_BLOCKLIST = ['mojón', 'pilón', 'vértice geodésico', 'hito quilométrico', 'hito de parada', 'poste informativo', 'cartel informativo'];
    
    // Check if name STARTS with any blocklist term (to be safe with things like 'Pilón de la Fuente' if it were important, though usually it's not)
    // Or if it's an exact match for common noise
    if (NAME_BLOCKLIST.some(term => nameLower.includes(term))) {
       // Exceptions: keep if it has wikipedia/wikidata
       if (!hasWikipedia && !hasWikidata && !hasHeritage) {
         return { remove: true, reason: `NAME_BLOCKLIST: Nome técnico irrelevante ('${name_check}')` };
       }
    }
  }

  // --- 3. TAG_BLOCKLIST (CRITICAL) ---
  const tagKeys = ['amenity', 'tourism', 'leisure', 'man_made', 'historic', 'highway', 'public_transport', 'place', 'office', 'shop', 'building', 'natural', 'landuse', 'type', 'class'];
  
  for (const key of tagKeys) {
    if (!props[key]) continue;
    const individualTags = String(props[key]).split(';');
    for (const t of individualTags) {
      const tagValue = t.trim();

      // building=yes says it is a building, not what it is: when a type tag got the object in, that tag
      // decides (Mexico 2026-10-22: Museo de Sitio de Monte Albán, 103 museums cut by building=yes).
      if (key === 'building' && tagValue === 'yes' && pickCategory(props)) continue;
      if (key === 'natural' && tagValue === 'cave_entrance' && isNotableCave(props, name, hasHardReference || hasWikidata)) continue;
      
      // Block ALL shops by default for Elite filter, unless it's a major landmark (handled by isCulturalExemption)
      if (key === 'shop' && !isFamous) {
        return { remove: true, reason: "SHOP: Comércio genérico" };
      }

      if (FILTER_CONFIG.TAG_BLOCKLIST.includes(tagValue)) {
        // Absolute noise is always removed
        const absoluteNoise = ['bench', 'waste_basket', 'trash_can', 'telephone', 'bicycle_parking', 'vending_machine', 'atm', 'surveillance', 'post_box', 'playground', 'pitch', 'fitness_station'];
        if (absoluteNoise.includes(tagValue)) {
          return { remove: true, reason: `ABSOLUTE_NOISE: ${key}=${tagValue}` };
        }

        // For natural features like peaks, trees, caves, etc., we require Wikipedia/Wikidata/Heritage.
        // A simple description is not enough for these categories.
        const naturalNoise = ['peak', 'volcano', 'tree', 'tree_row', 'scrub', 'wood', 'cave_entrance', 'rock', 'stone', 'islet'];
        if (naturalNoise.includes(tagValue)) {
           if (!hasWikipedia && !hasWikidata && !hasHeritage && !hasHistoric) {
             return { remove: true, reason: `NATURAL_NOISE: ${key}=${tagValue} sem fama global` };
           }
        }

        if (!isFamous) {
          return { remove: true, reason: `TAG_BLOCKLIST: ${key}=${tagValue}` };
        }
      }
    }
  }

  // --- 4. NAME_BLOCKLIST ---
  if (!isFamous) {
    for (const term of FILTER_CONFIG.NAME_BLOCKLIST) {
      if (nameLower.includes(term)) {
        return { remove: true, reason: `NAME_BLOCKLIST: Termo proibido '${term}'` };
      }
    }
  }

  // --- 5. RESTRICTED_UTILITY_TAGS ---
  const isUtility = tagKeys.some(key => {
    if (!props[key]) return false;
    const individualTags = String(props[key]).split(';');
    return individualTags.some(t => FILTER_CONFIG.RESTRICTED_UTILITY_TAGS.includes(t.trim()));
  });

  if (isUtility && !isFamous) {
    return { remove: true, reason: "RESTRICTED_UTILITY: Requer tag historic/heritage ou wiki/descrição para passar" };
  }

  // --- 6. RELIGION AND ACCOMMODATION ---
  if (props.amenity === "place_of_worship") {
    const denomination = (props.denomination || "").toLowerCase();
    const isCatholic = ["catholic", "roman_catholic"].includes(denomination);
    
    if (FILTER_CONFIG.RELIGIOUS_BRANDS.some((b) => nameLower.includes(b))) {
      if (!isFamous) return { remove: true, reason: "RELIGIOUS_BRAND: Marca religiosa genérica" };
    }

    // A chapel is street-visible (BR-POI-011 item 23); this gate is for the local church congregations.
    if (!isCatholic && !isFamous && !hasHistoric && !isStreetVisible(props)) {
       return { remove: true, reason: "Category: Religião local sem relevância histórica" };
    }
  }

  if (FILTER_CONFIG.ACCOMMODATION_TYPES.includes(props.tourism)) {
    if (props.tourism === "apartment") return { remove: true, reason: "ACCOMMODATION: Apartamento" };
    // For Elite, accommodation requires Wikipedia, Wikidata or Heritage. Description alone is not enough for hotels.
    if (!hasWikipedia && !hasWikidata && !hasHeritage && !hasHistoric) {
      return { remove: true, reason: "ACCOMMODATION: Hotel/Pousada sem relevância histórica ou fama global" };
    }
  }

  // --- 7. BOUNDARIES AND INFRASTRUCTURE ---
  if (props.boundary === "administrative") {
    const level = parseInt(props.admin_level || "0");
    if (level > 8) return { remove: true, reason: "BOUNDARY: Distrito/Bairro menor" };
  }

  if (nameLower.startsWith("residência") || nameLower.startsWith("residencia")) {
    if (!isFamous && props.tourism !== "museum") {
      return { remove: true, reason: "RESIDENTIAL: Residência privada sem fama" };
    }
  }

  // --- 8. ICONIC NEIGHBOURHOODS, TOWNS AND SQUARES ---
  if (["city", "suburb", "neighbourhood", "town", "village", "square"].includes(props.place)) {
    // If it's a neighborhood/suburb/square, we keep it if it has a name and some importance 
    // or if it's explicitly famous. We are more lenient here to keep urban context.
    if (!name || name.length < 3) return { remove: true, reason: "PLACE: Nome muito curto" };
    return { remove: false };
  }

  if (["tower", "water_tower"].includes(props.man_made) && !isFamous && !props.tourism && !props.historic && !hasReference) {
    return { remove: true, reason: "INFRASTRUCTURE: Torre/Caixa d'água sem valor" };
  }

  // Generic Park Names check - more aggressive for Elite filter
  const isGenericParkName = FILTER_CONFIG.GENERIC_PARK_NAMES.some(p => nameLower.startsWith(p));
  const isParkCategory = props.leisure === "park" || props.amenity === "plaza" || props.place === "square";
  
  if (isGenericParkName && isParkCategory && !isFamous) {
    return { remove: true, reason: "PARK: Praça/Largo genérico sem fama ou histórico" };
  }

  // Generic Street Names check - streets should not be POIs unless they are landmarks
  const isGenericStreet = 
    FILTER_CONFIG.STREET_KEYWORDS.PREFIXES.some(p => nameLower.startsWith(p)) ||
    FILTER_CONFIG.STREET_KEYWORDS.SUFFIXES.some(s => nameLower.endsWith(s)) ||
    FILTER_CONFIG.STREET_KEYWORDS.COMPOUND_SUFFIXES.some(s => nameLower.endsWith(s));
    
  if (isGenericStreet && !isFamous) {
    return { remove: true, reason: "STREET: Rua/Avenida/Street genérica sem fama ou histórico" };
  }

  // Single word names - Strict block
  const words = name.split(/\s+/).filter((w: string) => w.length > 0);
  if (words.length === 1 && !isFamous && !FILTER_CONFIG.SINGLE_WORD_WHITELIST.includes(nameLower) && !isCulturalExemption) {
    return { remove: true, reason: "STRICT: Nome de palavra única sem referência" };
  }

  return { remove: false };
}
