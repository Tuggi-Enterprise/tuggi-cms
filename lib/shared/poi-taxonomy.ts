/**
 * POI TAXONOMY - SINGLE SOURCE OF TRUTH (Canonical categories)
 *
 * Maps the raw/scattered OSM signal on `core.attractions` into a clean,
 * COUNTRY-AGNOSTIC taxonomy: a specific `primary_category` (e.g. `lake`,
 * `church`, `bridge`) inside one of 9 macro `category_group`s, plus an
 * `importance_score` / `is_notable` flag for "historic & important".
 *
 * Used by:
 *   1. scripts/backfill-poi-categories.ts   (one-time + ongoing cleanup)
 *   2. lib/services/osm-service-simple.ts   (ingestion pipeline — new imports)
 *   3. scripts/analyze-category-coverage.ts (QA / coverage report)
 *
 * Design notes (why this never gets "hostage" to new OSM values):
 *   - Categories derive from OSM's GLOBAL tagging schema, not from any country.
 *   - Two-level fallback: a value we don't recognize but whose KEY we do (e.g.
 *     `natural=<new>`) still lands in the key's macro group (`nature`) carrying
 *     its raw value — it never becomes UNKNOWN. Only rows with NO OSM key at all
 *     stay `unmapped` (those are data lost in the flatten, recovered by name).
 *   - The dictionary below is DATA, not logic. Extending coverage = adding keys.
 *
 * Pure module: no Supabase / Next / Node deps so it can run in scripts, the
 * pipeline, and (potentially) a Deno edge function. Mirrors lib/shared/poi-filter.ts.
 */

import { FILTER_CONFIG } from './poi-filter'

export type CategoryGroup =
  | 'nature'
  | 'water'
  | 'parks'
  | 'culture'
  | 'religious'
  | 'civic'
  | 'leisure'
  | 'infrastructure'
  | 'lodging'
  | 'place'

/** Canonical specific category -> macro group. The 9 groups, ~50 specifics. */
export const SPECIFIC_TO_GROUP: Record<string, CategoryGroup> = {
  // --- nature (landforms / vegetation) ---
  mountain: 'nature', hill: 'nature', peak: 'nature', volcano: 'nature',
  ridge: 'nature', saddle: 'nature', valley: 'nature', canyon: 'nature',
  plateau: 'nature', cliff: 'nature', cave: 'nature', glacier: 'nature',
  forest: 'nature', island: 'nature', desert: 'nature',
  dune: 'nature', rock_formation: 'nature', peninsula: 'nature', viewpoint: 'nature',
  // --- parks / green space (parks, gardens, protected reserves) ---
  park: 'parks', garden: 'parks', nature_reserve: 'parks', national_park: 'parks',
  // --- water (granular: subtipos distintos p/ filtro fino) ---
  lake: 'water', pond: 'water', reservoir: 'water', lagoon: 'water',
  basin: 'water', oxbow: 'water', moat: 'water',
  river: 'water', stream: 'water', canal: 'water', waterfall: 'water',
  spring: 'water', hot_spring: 'water', geyser: 'water', water_body: 'water',
  beach: 'water', coast: 'water', cape: 'water', bay: 'water',
  wetland: 'water', fountain: 'water',
  // --- culture (museums, art, monuments, history) ---
  museum: 'culture', gallery: 'culture', artwork: 'culture', monument: 'culture',
  memorial: 'culture', historic_site: 'culture', archaeological_site: 'culture',
  theatre: 'culture', library: 'culture', attraction: 'culture',
  cemetery: 'culture',
  // --- religious (granular: igreja/catedral/capela/mesquita/templo/sinagoga/mosteiro/santuário) ---
  church: 'religious', cathedral: 'religious', chapel: 'religious', mosque: 'religious',
  temple: 'religious', synagogue: 'religious', monastery: 'religious', shrine: 'religious',
  // --- civic ---
  civic: 'civic', townhall: 'civic', courthouse: 'civic', marketplace: 'civic',
  education: 'civic', square: 'civic',
  // --- leisure / recreation ---
  sports: 'leisure', stadium: 'leisure',
  zoo: 'leisure', amusement_park: 'leisure', playground: 'leisure',
  picnic_site: 'leisure', campsite: 'leisure',
  // --- infrastructure / man-made landmarks ---
  bridge: 'infrastructure', tower: 'infrastructure', lighthouse: 'infrastructure',
  airport: 'infrastructure', windmill: 'infrastructure', pier: 'infrastructure',
  dam: 'infrastructure', aerialway: 'infrastructure', road: 'infrastructure',
  marina: 'infrastructure',
  // --- lodging (hotéis + abrigos/refúgios de montanha) ---
  hotel: 'lodging', mountain_hut: 'lodging', chalet: 'lodging', apartment: 'lodging',
  // --- place (administrative / settlement) ---
  city: 'place', town: 'place', village: 'place', suburb: 'place',
  neighbourhood: 'place', hamlet: 'place', locality: 'place', borough: 'place',
  quarter: 'place',
}

/** Ordered macro groups (UI order). The authoritative set of `category_group`. */
export const CATEGORY_GROUPS: CategoryGroup[] = [
  'nature', 'water', 'parks', 'culture', 'religious',
  'civic', 'leisure', 'infrastructure', 'lodging', 'place',
]

/**
 * Inverse of SPECIFIC_TO_GROUP: macro group -> its canonical specific categories.
 * THIS IS THE CONTRACT for the app filter UI and the search RPC: the app renders
 * the checkboxes from here, and the RPC excludes the chosen `primary_category` /
 * `category_group` values stored on core.attractions. Single source of truth —
 * if a category exists here, it's a valid filter value, and vice-versa.
 * (Rare long-tail values stored as `other_<group>` roll up under their group.)
 */
export const GROUP_CATEGORIES: Record<CategoryGroup, string[]> = (() => {
  const out = Object.fromEntries(CATEGORY_GROUPS.map(g => [g, [] as string[]])) as Record<CategoryGroup, string[]>
  for (const [cat, g] of Object.entries(SPECIFIC_TO_GROUP)) out[g].push(cat)
  return out
})()

/**
 * Raw OSM value (or name-heuristic token) -> canonical specific category.
 * Keys are lowercase. This is the bulk of the dictionary — extend freely.
 */
export const SYNONYM_TO_CATEGORY: Record<string, string> = {
  // water bodies (usually water=* qualifying natural=water) — subtipos distintos
  water: 'water_body', lake: 'lake', pond: 'pond', reservoir: 'reservoir',
  lagoon: 'lagoon', basin: 'basin', oxbow: 'oxbow', moat: 'moat', wastewater: 'water_body',
  // running water (waterway=*) — river/stream distintos; afluentes pequenos -> stream
  river: 'river', stream: 'stream', brook: 'stream', creek: 'stream',
  canal: 'canal', rapids: 'stream', riverbank: 'river', tidal_channel: 'stream', ditch: 'stream',
  waterfall: 'waterfall',
  // springs
  spring: 'spring', hot_spring: 'hot_spring', geyser: 'geyser',
  // coast / shore
  beach: 'beach', shoal: 'beach', sand: 'beach',
  bay: 'bay', cape: 'coast', coastline: 'coast', headland: 'coast',
  strait: 'coast', isthmus: 'coast', shingle: 'coast',
  // wetlands
  wetland: 'wetland', marsh: 'wetland', swamp: 'wetland', mud: 'wetland', bog: 'wetland',
  // mountains / relief
  peak: 'peak', summit: 'peak', volcano: 'volcano', crater: 'volcano',
  ridge: 'ridge', arete: 'ridge', saddle: 'saddle', col: 'saddle',
  mountain_pass: 'saddle', mountain_range: 'mountain', massif: 'mountain', hill: 'hill',
  valley: 'valley', gorge: 'valley', gully: 'valley', dale: 'valley', canyon: 'canyon',
  plateau: 'plateau', mesa: 'plateau',
  cliff: 'cliff', bare_rock: 'cliff', rock: 'cliff', stone: 'cliff', scree: 'cliff',
  arch: 'rock_formation', stack: 'rock_formation', hoodoo: 'rock_formation',
  cave: 'cave', cave_entrance: 'cave', sinkhole: 'cave',
  glacier: 'glacier', divide: 'ridge',
  desert: 'desert', dune: 'dune',
  // vegetation
  wood: 'forest', forest: 'forest', tree: 'forest', tree_row: 'forest',
  scrub: 'forest', heath: 'forest', grassland: 'forest', tundra: 'forest', trees: 'forest',
  // protected nature
  nature_reserve: 'nature_reserve', protected_area: 'nature_reserve',
  conservation: 'nature_reserve', bird_hide: 'nature_reserve', wildlife_hide: 'nature_reserve',
  // islands
  island: 'island', islet: 'island', archipelago: 'island', reef: 'island', key: 'island',
  // parks / gardens
  park: 'park', recreation_ground: 'park', dog_park: 'park', common: 'park',
  village_green: 'park', greenfield: 'park', national_park: 'national_park', provincial_park: 'national_park',
  garden: 'garden', botanical_garden: 'garden',
  square: 'square',
  // sports / recreation
  stadium: 'stadium', sports_centre: 'sports', sports_hall: 'sports', pitch: 'sports',
  track: 'sports', golf_course: 'sports', miniature_golf: 'sports', swimming_pool: 'sports',
  water_park: 'amusement_park', fitness_centre: 'sports', horse_riding: 'sports',
  ice_rink: 'sports', disc_golf_course: 'sports',
  playground: 'playground',
  amusement_park: 'amusement_park', theme_park: 'amusement_park',
  zoo: 'zoo', aquarium: 'zoo', wildlife_park: 'zoo',
  picnic_site: 'picnic_site', firepit: 'picnic_site',
  camp_site: 'campsite', caravan_site: 'campsite', camp_pitch: 'campsite',
  // museums / art / culture
  museum: 'museum', gallery: 'gallery', art_gallery: 'gallery',
  artwork: 'artwork', sculpture: 'artwork', statue: 'artwork', mural: 'artwork',
  attraction: 'attraction', viewpoint: 'viewpoint', panorama: 'viewpoint',
  theatre: 'theatre', arts_centre: 'theatre', cinema: 'theatre',
  music_venue: 'theatre', concert_hall: 'theatre',
  library: 'library',
  // monuments / memorials
  monument: 'monument', obelisk: 'monument', column: 'monument',
  memorial: 'memorial', war_memorial: 'memorial', boundary_stone: 'memorial',
  milestone: 'memorial', cross: 'memorial', stolperstein: 'memorial', plaque: 'memorial',
  // historic sites
  castle: 'historic_site', fort: 'historic_site', fortress: 'historic_site',
  city_gate: 'historic_site', citywalls: 'historic_site', ruins: 'historic_site',
  ruin: 'historic_site', tomb: 'historic_site', manor: 'historic_site',
  battlefield: 'historic_site', heritage: 'historic_site', mine: 'historic_site',
  mineshaft: 'historic_site', adit: 'historic_site', wreck: 'historic_site',
  locomotive: 'historic_site', aircraft: 'historic_site', ship: 'historic_site',
  tank: 'historic_site', cannon: 'historic_site', wayside_shrine: 'historic_site',
  archaeological_site: 'archaeological_site',
  // cemeteries
  cemetery: 'cemetery', grave_yard: 'cemetery', graveyard: 'cemetery',
  // religious — place_of_worship genérico vira 'church'; tipos explícitos ficam distintos
  place_of_worship: 'church', church: 'church', cathedral: 'cathedral', chapel: 'chapel',
  basilica: 'cathedral', mosque: 'mosque', temple: 'temple', synagogue: 'synagogue',
  monastery: 'monastery', shrine: 'shrine', wayside_cross: 'shrine',
  // civic / public
  townhall: 'townhall', courthouse: 'courthouse', public_building: 'civic',
  government: 'civic', register_office: 'civic', community_centre: 'civic',
  marketplace: 'marketplace', market: 'marketplace',
  university: 'education', college: 'education', school: 'education', kindergarten: 'education',
  // infrastructure / man-made landmarks
  bridge: 'bridge', aqueduct: 'bridge', viaduct: 'bridge',
  tower: 'tower', communications_tower: 'tower', telescope: 'tower',
  observatory: 'tower', chimney: 'tower', water_tower: 'tower', mast: 'tower',
  lighthouse: 'lighthouse', beacon: 'lighthouse',
  windmill: 'windmill', watermill: 'windmill',
  marina: 'marina', harbour: 'marina',
  pier: 'pier', breakwater: 'pier', groyne: 'pier', jetty: 'pier',
  dam: 'dam', weir: 'dam',
  aerodrome: 'airport', airport: 'airport', airfield: 'airport', helipad: 'airport',
  chair_lift: 'aerialway', cable_car: 'aerialway', gondola: 'aerialway',
  rope_tow: 'aerialway', magic_carpet: 'aerialway', zip_line: 'aerialway', drag_lift: 'aerialway',
  fountain: 'fountain',
  // lodging — hotéis e abrigos de montanha (huts/refúgios) e aluguel de temporada
  hotel: 'hotel', hostel: 'hotel', guest_house: 'hotel', motel: 'hotel', resort: 'hotel',
  alpine_hut: 'mountain_hut', wilderness_hut: 'mountain_hut', mountain_hut: 'mountain_hut',
  refuge: 'mountain_hut', refugio: 'mountain_hut', hut: 'mountain_hut',
  chalet: 'chalet', apartment: 'apartment',
  // place (administrative / settlement)
  city: 'city', town: 'town', village: 'village', suburb: 'suburb',
  neighbourhood: 'neighbourhood', neighborhood: 'neighbourhood', hamlet: 'hamlet',
  locality: 'locality', borough: 'borough', quarter: 'quarter', municipality: 'city',
}

/**
 * Bare OSM keys that leaked into `osm_category` as if they were values
 * (e.g. `leisure`, `natural`, `yes`). These carry no specific signal and must
 * be ignored so we fall through to the real value elsewhere.
 */
export const GENERIC_VALUES = new Set<string>([
  'leisure', 'natural', 'tourism', 'amenity', 'historic', 'building', 'yes', 'no',
  'highway', 'boundary', 'landuse', 'waterway', 'place', 'man_made', 'shop',
  'public_transport', 'railway', 'way', 'node', 'relation', 'multipolygon', 'route',
  'geological', 'aeroway', 'office', 'craft', 'emergency', 'power', 'barrier',
])

/**
 * OSM top-level key -> macro group, for the 2-level fallback: a value we don't
 * recognize but whose key we do still gets a group (carrying its raw value).
 * Only keys with an unambiguous group are listed (amenity/building/shop/landuse
 * are too broad to guess, so an unmapped value there stays `unmapped`).
 */
export const KEY_TO_GROUP: Record<string, CategoryGroup> = {
  natural: 'nature', geological: 'nature',
  waterway: 'water', water: 'water',
  leisure: 'leisure',
  historic: 'culture', tourism: 'culture',
  man_made: 'infrastructure', aeroway: 'infrastructure', aerialway: 'infrastructure',
  place: 'place',
}

/**
 * Name-token heuristics (LAST RESORT, English). Applied only when no structured
 * OSM signal exists. Word-boundary matched against the lowercased name. Each
 * entry: [regex, canonical category]. Order matters (first match wins).
 */
// Multilingual (EN/PT/ES/IT/FR), accent-insensitive — matched against the
// deburred lowercased name (see deburr()). LAST RESORT only. Order matters:
// built/man-made first so e.g. "...Airport"/"...Ponte" wins over a water token.
const NAME_HEURISTICS: Array<[RegExp, string]> = [
  [/\bhistoric district\b/, 'historic_site'],
  // built / man-made
  [/\b(airport|airfield|airpark|aeroporto|aerodromo|aeropuerto|aeroport)\b/, 'airport'],
  [/\b(bridge|ponte|puente|pont)\b/, 'bridge'],
  [/\b(lighthouse|farol|faro|phare)\b/, 'lighthouse'],
  [/\b(tower|torre|campanile|beffroi|belfry)\b/, 'tower'],
  // religioso: catedral/basílica e abadia/mosteiro ANTES da igreja genérica (senão viram 'church')
  [/\b(cathedrale|cattedrale|catedral|duomo|basilique|basilica)\b/, 'cathedral'],
  [/\b(abbaye|abbey|abadia|abbazia|prieure|priory|monastere|monasterio|monestir|monastery|convento|convent)\b/, 'monastery'],
  [/\b(church|chapel|chapelle|cappella|capilla|parroquia|temple|mosque|synagogue|igreja|capela|ermita|ermida|eremo|pieve|santuario|santuari|iglesia|chiesa|eglise|esglesia|collegiale)\b/, 'church'],
  [/\b(museum|museu|museo|musee)\b/, 'museum'],
  [/\b(cemetery|cemiterio|cementerio|cimetiere|cimitero)\b/, 'cemetery'],
  [/\b(theatre|theater|teatro|anfiteatro)\b/, 'theatre'],
  [/\b(library|biblioteca|bibliotheque)\b/, 'library'],
  [/\b(monumento|monument)\b/, 'monument'],
  [/\b(memorial)\b/, 'memorial'],
  [/\b(estadio|stadium|stadio|arena|ginasio|autodromo)\b/, 'stadium'],
  [/\b(mercadao|mercado municipal|mercado central|mercat)\b/, 'marketplace'],
  [/\b(chafariz)\b/, 'fountain'],
  // sítios arqueológicos (dolmen/menhir/oppidum…) e fortificações/aquedutos
  [/\b(dolmen|menhir|tumulus|cromlech|oppidum|cairn|nuraghe)\b/, 'archaeological_site'],
  // fortificações + palácios/solares/sobrados (casarões históricos PT-BR)
  [/\b(fort|fortress|fortaleza|forte|castle|castelo|castillo|castell|castello|rocca|chateau|chateaux|citadelle|donjon|manoir|manor|palacio|palazzo|palais|solar|sobrado|hacienda|pelourinho|ruinas?|ruins)\b/, 'historic_site'],
  [/\b(aqueduc|aqueduct|acueducto|acquedotto)\b/, 'bridge'],
  [/\b(viewpoint|mirante|mirador|belvedere|belvedere)\b/, 'viewpoint'],
  // water
  [/\b(lake|pond|reservoir|lagoa|lago|laguna|lac)\b/, 'lake'],
  [/\b(represa|acude|reservatorio|embalse|barragem)\b/, 'reservoir'],
  [/\b(falls|waterfall|cachoeira|catarata|cascata|cascada|cascade|salto|chute)\b/, 'waterfall'],
  [/\b(creek|brook|bayou|river|stream|rio|riacho|corrego|igarape|ribeira|ribeirao|arroio|arroyo|riviere|fiume)\b/, 'river'],
  [/\b(spring|springs|nascente|fonte|fuente)\b/, 'spring'],
  [/\b(beach|praia|prainha|playa|plage|spiaggia|cala|calanque)\b/, 'beach'],
  [/\b(bay|cove|inlet|harbor|harbour|baia|enseada|bahia|baie)\b/, 'bay'],
  // relief / nature
  [/\b(mountain|mount|mt|peak|summit|morro|serra|pico|monte|cerro|colina|montagne|montana)\b/, 'peak'],
  [/\b(hill|knob|butte|mound|outeiro)\b/, 'hill'],
  [/\bmesa\b/, 'plateau'],
  [/\bridge\b/, 'ridge'],
  [/\b(canyon|canion|gorge|valley|vale|valle|vallee)\b/, 'valley'],
  [/\b(cave|cavern|grotto|gruta|caverna|cueva|grotte|grotta|gouffre|cenote)\b/, 'cave'],
  [/\b(cliff|bluff|palisade|penhasco|falesia|farallon|falaise)\b/, 'cliff'],
  [/\b(forest|woods|woodland|mata|floresta|bosque|selva|foret|bosco)\b/, 'forest'],
  [/\b(island|isle|cay|ilha|isla|ile|isola)\b/, 'island'],
  [/\b(national park|provincial park|parc national|parc provincial|state park)\b/, 'national_park'],
  [/\b(park|gardens?|parque|jardim|jardin|jardins|giardino)\b/, 'park'],
  [/\b(square|praca|plaza|piazza)\b/, 'square'],
]

/**
 * Default specific category for a bare/leaked OSM KEY when no value survives.
 * Low-confidence (matched_by='key_fallback') but sensible: a row tagged only
 * `historic`/`tourism`/`waterway` is overwhelmingly a historic site / attraction
 * / watercourse. `natural` is left out (too ambiguous between land and water).
 */
const GENERIC_KEY_DEFAULT: Record<string, string> = {
  historic: 'historic_site',
  tourism: 'attraction',
  waterway: 'river',
  leisure: 'park',
}

export interface ClassifyInput {
  osm_category?: string | null
  // flattened OSM columns on core.attractions
  amenity?: string | null
  leisure?: string | null
  natural_water?: string | null
  waterway?: string | null
  man_made?: string | null
  building?: string | null
  place?: string | null
  landuse?: string | null
  shop?: string | null
  park_type?: string | null
  monument_type?: string | null
  artwork_type?: string | null
  information?: string | null
  type?: string | null
  // raw OSM / Nominatim tags
  osm_tags?: Record<string, any> | null
  name?: string | null
  // importance signals
  is_historic?: boolean | null
  is_touristic?: boolean | null
  wikidata?: string | null
  wikipedia?: string | null
  heritage_status?: string | null
  unesco_status?: string | null
  importance_level?: string | null
  landmark_level?: number | string | null
}

export type MatchedBy =
  | 'osm_category'      // real OSM value (high confidence)
  | 'flattened'        // real flattened-column value (high)
  | 'osm_tags_reparse' // real tag recovered from osm_tags / Nominatim class+type (high)
  | 'key_fallback'     // known OSM key, unknown value -> group guaranteed (high)
  | 'name_heuristic'   // inferred from the name only (LOW confidence)
  | 'key_default'      // bare/leaked key with no value -> guessed default (LOW)
  | 'unmapped'         // no signal at all (deferred)
  | 'excluded_street'  // street/road -> excluded as non-POI

/**
 * confidence:
 *   'high' = OSM data guarantees the category/group (Phase 1 — safe to write)
 *   'low'  = inferred/guessed (name, bare-key default, name-based street) — Phase 2 review
 */
export interface ClassifyResult {
  primary_category: string | null
  category_group: CategoryGroup | null
  categories: string[]
  matched_by: MatchedBy
  confidence: 'high' | 'low'
  excluded: boolean
}

/** Flattened column name -> the OSM key it represents (for the key fallback). */
const COLUMN_KEY: Record<string, string> = {
  amenity: 'amenity',
  leisure: 'leisure',
  natural_water: 'water',
  waterway: 'waterway',
  man_made: 'man_made',
  building: 'building',
  place: 'place',
  landuse: 'landuse',
  shop: 'shop',
}
// Order matters: most specific / highest-signal first. `amenity` BEFORE `man_made`
// so e.g. a church with a tower (amenity=place_of_worship + man_made=tower) is a
// church, not a tower.
const COLUMN_PRIORITY = [
  'natural_water', 'waterway', 'amenity', 'leisure', 'monument_type',
  'artwork_type', 'park_type', 'man_made', 'place', 'building', 'shop', 'landuse',
] as const

/** Lowercase + strip diacritics, so PT/ES/FR/IT name tokens match unaccented. */
function deburr(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function norm(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim().toLowerCase()
  if (!s) return null
  // multi-value tags (`a;b`) -> take the first
  return s.split(';')[0].trim() || null
}

const ROAD_NAME_RE = /\b(highway|freeway|turnpike|parkway|expressway|byway|interstate)\b/

function isStreetLike(name: string | null): boolean {
  if (!name) return false
  const nameLower = name.toLowerCase()
  return (
    FILTER_CONFIG.STREET_KEYWORDS.PREFIXES.some(p => nameLower.startsWith(p)) ||
    FILTER_CONFIG.STREET_KEYWORDS.SUFFIXES.some(s => nameLower.endsWith(s)) ||
    ROAD_NAME_RE.test(nameLower)
  )
}

function makeResult(category: string, matched_by: MatchedBy, confidence: 'high' | 'low' = 'high'): ClassifyResult {
  const group = SPECIFIC_TO_GROUP[category] ?? null
  return { primary_category: category, category_group: group, categories: [category], matched_by, confidence, excluded: false }
}

/**
 * A "clean leaf" is a single OSM-style token we're happy to keep as a category
 * even if it isn't in the dictionary (e.g. `axe_throwing`, `t-bar`). Anything
 * with spaces, `#`, `:`, free-text or absurd length is junk and gets collapsed
 * to `other_<group>` so the long tail stays clean.
 */
function isCleanLeaf(v: string): boolean {
  return /^[a-z][a-z0-9_-]{0,28}$/.test(v)
}

/** A value found under a known key: map via dictionary, else key-fallback. */
function resolveKeyed(value: string | null, key: string, matched_by: MatchedBy): ClassifyResult | null {
  const v = norm(value)
  if (!v || v === 'yes' || v === 'no' || GENERIC_VALUES.has(v)) return null
  const mapped = SYNONYM_TO_CATEGORY[v]
  if (mapped) return makeResult(mapped, matched_by)
  // 2-level fallback: unknown value, known key -> keep clean raw value in the
  // key's group; collapse obvious junk/free-text to other_<group>.
  const group = KEY_TO_GROUP[key]
  if (group) {
    const leaf = isCleanLeaf(v) ? v : `other_${group}`
    return { primary_category: leaf, category_group: group, categories: [leaf], matched_by: 'key_fallback', confidence: 'high', excluded: false }
  }
  return null
}

/**
 * Classify one attraction row into a canonical category + macro group.
 * Deterministic priority — see module header for the rationale.
 */
export function classify(input: ClassifyInput): ClassifyResult {
  const name = input.name ?? null

  // (1) osm_category direct value (no key context -> dictionary only)
  const oc = norm(input.osm_category)
  if (oc && oc !== 'yes' && !GENERIC_VALUES.has(oc)) {
    const mapped = SYNONYM_TO_CATEGORY[oc]
    if (mapped) return makeResult(mapped, 'osm_category')
  }

  // (2) flattened columns, by priority, each with a known key
  for (const col of COLUMN_PRIORITY) {
    const key = COLUMN_KEY[col] ?? col
    const res = resolveKeyed((input as any)[col], key, 'flattened')
    if (res) return res
  }

  // (3) reparse osm_tags JSONB
  const tags = input.osm_tags
  if (tags && typeof tags === 'object') {
    // 3a. Nominatim class/type pair: value=type, key=class
    const nomRes = resolveKeyed(tags.type, norm(tags.class) ?? '', 'osm_tags_reparse')
    if (nomRes) return nomRes
    // 3b. raw OSM keys that may survive in the JSONB even if columns were nulled.
    // `water`/`waterway` before `natural` so water=lake wins over natural=water.
    const rawKeys = ['tourism', 'historic', 'water', 'waterway', 'natural', 'leisure', 'amenity', 'man_made', 'aeroway', 'aerialway', 'place', 'shop', 'landuse', 'building']
    for (const key of rawKeys) {
      const res = resolveKeyed(tags[key], key, 'osm_tags_reparse')
      if (res) return res
    }
  }

  // --- below here is LOW confidence (Phase 2): guesses, not OSM-guaranteed ---

  // (4.5) bare/leaked OSM key with no value — guess the key's sensible default
  // (e.g. osm_category='historic' -> historic_site). Runs BEFORE name heuristics
  // because a real (if bare) OSM key beats a name guess.
  const tagHighway = oc === 'highway' || norm(tags?.class) === 'highway'
  const keyDefault = GENERIC_KEY_DEFAULT[oc ?? ''] ?? GENERIC_KEY_DEFAULT[norm(tags?.class) ?? '']
  if (keyDefault && !tagHighway) {
    return makeResult(keyDefault, 'key_default', 'low')
  }

  // (5a) street/road by TAG (highway) — high-confidence exclusion
  if (tagHighway) {
    if (isNotable(input)) return makeResult('road', 'osm_tags_reparse', 'high')
    return { primary_category: null, category_group: null, categories: [], matched_by: 'excluded_street', confidence: 'high', excluded: true }
  }

  // (6) name heuristics (last resort, only when no structured signal).
  // Deburred so PT/ES/FR/IT tokens match regardless of accents.
  if (name) {
    const nameNorm = deburr(name)
    for (const [re, cat] of NAME_HEURISTICS) {
      if (re.test(nameNorm)) return makeResult(cat, 'name_heuristic', 'low')
    }
  }

  // (5b) street/road by NAME only — low-confidence exclusion
  if (isStreetLike(name)) {
    if (isNotable(input)) return makeResult('road', 'name_heuristic', 'low')
    return { primary_category: null, category_group: null, categories: [], matched_by: 'excluded_street', confidence: 'low', excluded: true }
  }

  // (7) nothing matched — leave for Phase 2 review, never invent a category
  return { primary_category: null, category_group: null, categories: [], matched_by: 'unmapped', confidence: 'low', excluded: false }
}

/**
 * Combined importance 0..100 from every "historic & important" signal.
 * A strong external reference (wikidata) or national-level importance puts a
 * row over the notability threshold on its own.
 */
export function importanceScore(input: ClassifyInput): number {
  let score = 0
  if (input.wikidata) score += 30
  if (input.wikipedia) score += 25

  const heritage = norm(input.heritage_status)
  if (heritage && heritage !== 'no' && heritage !== 'none') score += 20

  const unesco = norm(input.unesco_status)
  if (unesco && unesco !== 'no' && unesco !== 'none') score += 30

  if (input.is_historic === true) score += 10
  if (input.is_touristic === true) score += 5

  switch (norm(input.importance_level)) {
    case 'international': case 'global': case 'world': score += 30; break
    case 'national': case 'country': score += 20; break
    case 'regional': case 'state': score += 10; break
    // local / unknown -> +0
  }

  const lvl = typeof input.landmark_level === 'string' ? parseInt(input.landmark_level, 10) : input.landmark_level
  if (typeof lvl === 'number' && !Number.isNaN(lvl)) score += Math.min(Math.max(lvl, 0), 10)

  return Math.min(score, 100)
}

/** Notability threshold (tunable). */
export const NOTABLE_THRESHOLD = 30

export function isNotable(input: ClassifyInput): boolean {
  return importanceScore(input) >= NOTABLE_THRESHOLD
}

// ============================================================================
// PRIORITY LEVEL (1 Padrão Tuggi · 2 Complementar · 3 Adicional)
// Segmentação curada para FILTRO no app + PRIORIDADE de disparo (1 > 2 > 3).
// Separado da taxonomia — deriva dela + importância. Curadoria manual prevalece.
// IMPORTANTE: manter estas listas em sincronia com o UPDATE SQL retroativo.
// ============================================================================

/** Categorias intrinsecamente "imperdíveis" (nível 1), mesmo sem wikidata. */
export const LEVEL_1_CATEGORIES = new Set<string>([
  'museum', 'monument', 'historic_site', 'archaeological_site',
  'cathedral', 'monastery', 'mosque', 'temple', 'synagogue',
  'viewpoint', 'waterfall', 'volcano', 'glacier', 'canyon', 'cave',
  'beach', 'lighthouse',
  // parque nacional/provincial = destino turístico must-see (Banff, Jasper, Algonquin)
  'national_park',
  // tourism=attraction = "atração turística" por definição (ex.: Cristo Redentor
  // sem wikidata no banco). Famoso não pode ficar oculto no nível 2.
  'attraction',
])

/**
 * Categorias de média importância (nível 2). `memorial` desceu do nível 1 pra cá:
 * o grosso são Monuments aux Morts / placas de vila — landmark cívico complementar,
 * não "must-see". Um memorial nacional (heritage/wikidata) ainda sobe pra 1/2.
 */
export const LEVEL_2_CATEGORIES = new Set<string>([
  'artwork', 'gallery', 'theatre', 'library', 'bridge', 'tower', 'windmill',
  'stadium', 'zoo', 'amusement_park', 'marketplace', 'fountain',
  'cemetery', 'pier', 'memorial',
  // igrejas/capelas (mesmo sem wikidata) e corpos d'água nomeados = complementar,
  // não devem cair no nível 3 (Adicional) por não terem referência externa.
  'church', 'chapel', 'lake', 'pond', 'reservoir', 'lagoon',
  // natureza/água "destino" (curadoria seletiva — NÃO promovemos park/garden/spring/
  // hill/cliff genéricos, que são o long tail de baixa relevância = praças de vila,
  // fontes, cerros menores). Um pico/lago/rio/baía nomeado é ponto de interesse.
  'nature_reserve', 'mountain', 'peak', 'river', 'bay',
])

/**
 * Nível 1/2/3 a partir da categoria canônica + sinais de importância.
 *
 * Nível 1 (Padrão Tuggi / must-see): patrimônio oficial (UNESCO/heritage) OU
 * importância alta (importance_score≥40: wikidata+wikipedia, nacional/internacional)
 * OU categoria intrinsecamente imperdível.
 * Nível 2 (Complementar): referência externa (wikidata) — promove igreja/pico notável
 * que a categoria sozinha deixaria no fundo — OU categoria de média importância.
 * Nível 3 (Adicional): o resto.
 *
 * ⚠️ `is_historic` NÃO promove mais sozinho: o OSM `historic=*` inclui cruzeiros
 * (calvaires/shrine), placas e marcos de km/fronteira (memorial) e linhas sem
 * categoria — que inflavam o "must-see" com micro-marcos rurais. Um sítio/edifício
 * histórico de verdade sobe pela CATEGORIA (historic_site, museum…) ou pelo heritage.
 */
export function priorityLevel(primaryCategory: string | null, input: ClassifyInput): 1 | 2 | 3 {
  const heritage = norm(input.heritage_status)
  const hasHeritage = !!(heritage && heritage !== 'no' && heritage !== 'none')
  const unesco = norm(input.unesco_status)
  const hasUnesco = !!(unesco && unesco !== 'no' && unesco !== 'none')

  // (1) patrimônio oficial ou importância alta → nível 1
  if (hasUnesco || hasHeritage || importanceScore(input) >= 40) return 1

  // (2) categorias intrinsecamente imperdíveis → nível 1
  const cat = norm(primaryCategory)
  if (cat && LEVEL_1_CATEGORIES.has(cat)) return 1

  // (3) referência externa (wikidata) → pelo menos nível 2 (igrejas/picos notáveis)
  if (input.wikidata) return 2

  // (4) categorias de média importância → nível 2
  if (cat && LEVEL_2_CATEGORIES.has(cat)) return 2

  return 3
}
