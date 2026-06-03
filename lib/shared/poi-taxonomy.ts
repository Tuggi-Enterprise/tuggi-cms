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
  park: 'parks', garden: 'parks', nature_reserve: 'parks',
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
  // --- lodging ---
  hotel: 'lodging',
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
  village_green: 'park', greenfield: 'park', national_park: 'park',
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
  // lodging
  hotel: 'hotel', hostel: 'hotel', guest_house: 'hotel', motel: 'hotel', resort: 'hotel',
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
const NAME_HEURISTICS: Array<[RegExp, string]> = [
  // built / man-made first — an "Airport" / "Bridge" name wins over a "Bay" token
  [/\bhistoric district\b/, 'historic_site'],
  [/\b(airport|airfield|airpark)\b/, 'airport'],
  [/\bbridge\b/, 'bridge'],
  [/\blighthouse\b/, 'lighthouse'],
  [/\b(church|chapel|cathedral|basilica|temple|mosque|synagogue)\b/, 'church'],
  [/\bmuseum\b/, 'museum'],
  [/\bcemetery\b/, 'cemetery'],
  // water
  [/\b(lake|pond|reservoir)\b/, 'lake'],
  [/\b(creek|brook|bayou|river|stream)\b/, 'river'],
  [/\b(falls|waterfall)\b/, 'waterfall'],
  [/\bsprings?\b/, 'spring'],
  [/\bbeach\b/, 'beach'],
  [/\b(bay|cove|inlet|harbor|harbour)\b/, 'bay'],
  // relief / nature
  [/\b(mountain|mount|mt\.?|peak|summit)\b/, 'peak'],
  [/\b(hill|knob|butte|mound)\b/, 'hill'],
  [/\bmesa\b/, 'plateau'],
  [/\bridge\b/, 'ridge'],
  [/\b(canyon|gorge|valley)\b/, 'valley'],
  [/\b(cave|cavern|grotto)\b/, 'cave'],
  [/\b(cliff|bluff|palisade)\b/, 'cliff'],
  [/\b(forest|woods|woodland)\b/, 'forest'],
  [/\b(island|isle|cay)\b/, 'island'],
  [/\b(park|gardens?)\b/, 'park'],
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
  | 'osm_category'
  | 'flattened'
  | 'osm_tags_reparse'
  | 'name_heuristic'
  | 'key_fallback'
  | 'unmapped'
  | 'excluded_street'

export interface ClassifyResult {
  primary_category: string | null
  category_group: CategoryGroup | null
  categories: string[]
  matched_by: MatchedBy
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
// Order matters: most specific / highest-signal first.
const COLUMN_PRIORITY = [
  'natural_water', 'waterway', 'man_made', 'leisure', 'monument_type',
  'artwork_type', 'park_type', 'amenity', 'place', 'building', 'shop', 'landuse',
] as const

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

function makeResult(category: string, matched_by: MatchedBy): ClassifyResult {
  const group = SPECIFIC_TO_GROUP[category] ?? null
  return { primary_category: category, category_group: group, categories: [category], matched_by, excluded: false }
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
    return { primary_category: leaf, category_group: group, categories: [leaf], matched_by: 'key_fallback', excluded: false }
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

  // (4) name heuristics (last resort, only when no structured signal)
  if (name) {
    const nameLower = name.toLowerCase()
    for (const [re, cat] of NAME_HEURISTICS) {
      if (re.test(nameLower)) return makeResult(cat, 'name_heuristic')
    }
  }

  // (4.5) bare/leaked OSM key with no value — assign the key's sensible default
  // (e.g. osm_category='historic' -> historic_site). Low confidence, auditable.
  const keyDefault = GENERIC_KEY_DEFAULT[oc ?? ''] ?? GENERIC_KEY_DEFAULT[norm(tags?.class) ?? '']
  if (keyDefault) {
    const r = makeResult(keyDefault, 'key_fallback')
    return r
  }

  // (5) street/road handling: exclude plain streets, KEEP notable ones
  const streetLike =
    oc === 'highway' ||
    norm(tags?.class) === 'highway' ||
    isStreetLike(name)
  if (streetLike) {
    if (isNotable(input)) return makeResult('road', 'flattened')
    return { primary_category: null, category_group: null, categories: [], matched_by: 'excluded_street', excluded: true }
  }

  // (6) nothing matched — leave for review, never invent a category
  return { primary_category: null, category_group: null, categories: [], matched_by: 'unmapped', excluded: false }
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
