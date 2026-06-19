/**
 * LOCATION NORMALIZE — SINGLE SOURCE OF TRUTH (canonical country / state)
 *
 * Turns the raw, inconsistent `country` / `state` signal that lands on
 * `core.attractions` (OSM `addr:country` ISO codes, Nominatim local names,
 * Google formatted_address fragments, hand-typed CMS values…) into ONE
 * canonical naming standard shared by every consumer:
 *
 *   - country: common English name, Title Case  → "Brazil", "United States",
 *     "Italy", "Spain"  (NOT ISO "BR"/"US", NOT local "Brasil"/"Italia").
 *   - state:   per-country canonical (matches the coverage map's Natural Earth
 *     names): PT-accented for Brazil ("São Paulo"), English for Italy/USA
 *     ("Tuscany"/"California"), local for Spain ("Catalunya"), suffix-free
 *     for the Andean/department countries, etc.
 *
 * Used by (every WRITE path + the dropdowns, so values never drift again):
 *   1. lib/services/osm-importer-service.ts      (OSM ingestion)
 *   2. lib/services/poi-import-service.ts         (Google Places import)
 *   3. scripts/import-geojson-homolog.ts          (GeoJSON CLI import)
 *   4. components/poi-management/tabs/DetailsTab   (CMS manual edit — on save)
 *   5. CMS country/state dropdowns                (CANONICAL_COUNTRIES list)
 *   6. supabase/migrations/…normalise-country-state…  (one-time backfill — same rules)
 *
 * This is the TS twin of the 19 SQL backfill batches: same mappings, one place.
 * The coverage map (tuggi-enterprise update-coverage.mjs) keeps its OWN
 * normaliser that bridges these canonical names to the TopoJSON `admin`/`name`
 * (e.g. "United States" → "United States of America") — do not fold that in here.
 *
 * Pure module: no Supabase / Next / Node deps (runs in scripts, services, and
 * potentially a Deno edge function). Mirrors lib/shared/poi-taxonomy.ts.
 */

/** lowercase + strip accents + collapse whitespace. The lookup key for every map. */
export function slug(s: string | null | undefined): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTRY
// ════════════════════════════════════════════════════════════════════════════

/** slug(alias) → canonical English country name. Covers ISO-2, local + English. */
const COUNTRY_ALIASES: Record<string, string> = {
  // South America
  ar: 'Argentina', argentina: 'Argentina',
  br: 'Brazil', brasil: 'Brazil', brazil: 'Brazil',
  uy: 'Uruguay', uruguai: 'Uruguay', uruguay: 'Uruguay',
  py: 'Paraguay', paraguai: 'Paraguay', paraguay: 'Paraguay',
  pe: 'Peru', peru: 'Peru',
  bo: 'Bolivia', bolivia: 'Bolivia',
  cl: 'Chile', chile: 'Chile',
  co: 'Colombia', colombia: 'Colombia',
  ve: 'Venezuela', venezuela: 'Venezuela',
  ec: 'Ecuador', ecuador: 'Ecuador', equador: 'Ecuador',
  gf: 'French Guiana', 'french guiana': 'French Guiana', guyane: 'French Guiana',
  'guyane francaise': 'French Guiana', 'guiana francesa': 'French Guiana',
  gy: 'Guyana', guyana: 'Guyana', guiana: 'Guyana',
  sr: 'Suriname', suriname: 'Suriname',
  // North America
  us: 'United States', usa: 'United States', 'united states': 'United States',
  'united states of america': 'United States', eua: 'United States',
  'estados unidos': 'United States', 'estados unidos da america': 'United States',
  ca: 'Canada', canada: 'Canada',
  mx: 'Mexico', mexico: 'Mexico', mexique: 'Mexico',
  // Central America & Caribbean
  pa: 'Panama', panama: 'Panama',
  bz: 'Belize', belize: 'Belize',
  gt: 'Guatemala', guatemala: 'Guatemala',
  hn: 'Honduras', honduras: 'Honduras',
  sv: 'El Salvador', 'el salvador': 'El Salvador',
  ni: 'Nicaragua', nicaragua: 'Nicaragua',
  cr: 'Costa Rica', 'costa rica': 'Costa Rica',
  cu: 'Cuba', cuba: 'Cuba',
  do: 'Dominican Republic', 'dominican republic': 'Dominican Republic', 'republica dominicana': 'Dominican Republic',
  jm: 'Jamaica', jamaica: 'Jamaica',
  ht: 'Haiti', haiti: 'Haiti',
  bs: 'Bahamas', bahamas: 'Bahamas', 'the bahamas': 'Bahamas',
  pr: 'Puerto Rico', 'puerto rico': 'Puerto Rico',
  // Europe
  pt: 'Portugal', portugal: 'Portugal',
  es: 'Spain', spain: 'Spain', espana: 'Spain', espanha: 'Spain', espagne: 'Spain',
  it: 'Italy', italy: 'Italy', italia: 'Italy', italie: 'Italy',
  fr: 'France', france: 'France', franca: 'France', frankreich: 'France',
  de: 'Germany', germany: 'Germany', alemanha: 'Germany', deutschland: 'Germany', allemagne: 'Germany',
  gb: 'United Kingdom', uk: 'United Kingdom', 'reino unido': 'United Kingdom',
  england: 'United Kingdom', 'great britain': 'United Kingdom', 'gra-bretanha': 'United Kingdom',
  ch: 'Switzerland', switzerland: 'Switzerland', suica: 'Switzerland', suiza: 'Switzerland',
  schweiz: 'Switzerland', suisse: 'Switzerland',
  at: 'Austria', austria: 'Austria', osterreich: 'Austria',
  nl: 'Netherlands', netherlands: 'Netherlands', holanda: 'Netherlands', nederland: 'Netherlands',
  'paises baixos': 'Netherlands',
  be: 'Belgium', belgium: 'Belgium', belgica: 'Belgium', belgique: 'Belgium', belgie: 'Belgium',
  se: 'Sweden', sweden: 'Sweden', suecia: 'Sweden', sverige: 'Sweden',
  no: 'Norway', norway: 'Norway', noruega: 'Norway', norge: 'Norway',
  dk: 'Denmark', denmark: 'Denmark', dinamarca: 'Denmark', danmark: 'Denmark',
  fi: 'Finland', finland: 'Finland', finlandia: 'Finland', suomi: 'Finland',
  pl: 'Poland', poland: 'Poland', polonia: 'Poland', polska: 'Poland',
  ro: 'Romania', romania: 'Romania', romenia: 'Romania',
  hu: 'Hungary', hungary: 'Hungary', hungria: 'Hungary', magyarorszag: 'Hungary',
  cz: 'Czechia', czechia: 'Czechia', 'czech republic': 'Czechia', 'republica tcheca': 'Czechia', tschechien: 'Czechia',
  hr: 'Croatia', croatia: 'Croatia', croacia: 'Croatia', hrvatska: 'Croatia',
  gr: 'Greece', greece: 'Greece', grecia: 'Greece', grece: 'Greece',
  va: 'Vatican', vatican: 'Vatican', vaticano: 'Vatican', 'santa se': 'Vatican', 'holy see': 'Vatican',
  // Rest of world
  jp: 'Japan', japan: 'Japan', japao: 'Japan', japon: 'Japan',
  cn: 'China', china: 'China', 'republica popular da china': 'China',
  au: 'Australia', australia: 'Australia',
  nz: 'New Zealand', 'new zealand': 'New Zealand', 'nova zelandia': 'New Zealand',
  in: 'India', india: 'India',
  za: 'South Africa', 'south africa': 'South Africa', 'africa do sul': 'South Africa', 'afrique du sud': 'South Africa',
  ma: 'Morocco', morocco: 'Morocco', marrocos: 'Morocco', maroc: 'Morocco',
  eg: 'Egypt', egypt: 'Egypt', egipto: 'Egypt', egypte: 'Egypt',
  tr: 'Turkey', turkey: 'Turkey', turquia: 'Turkey', turkiye: 'Turkey',
  th: 'Thailand', thailand: 'Thailand', tailandia: 'Thailand',
  // Micro-states / others present in the data
  si: 'Slovenia', slovenia: 'Slovenia', eslovenia: 'Slovenia',
  sm: 'San Marino', 'san marino': 'San Marino',
  ad: 'Andorra', andorra: 'Andorra',
  tt: 'Trinidad and Tobago', 'trinidad and tobago': 'Trinidad and Tobago',
  ru: 'Russia', russia: 'Russia', russie: 'Russia', russland: 'Russia',
  bq: 'Bonaire, Saint Eustatius and Saba', 'bonaire, saint eustatius and saba': 'Bonaire, Saint Eustatius and Saba',
  li: 'Liechtenstein', liechtenstein: 'Liechtenstein',
  mc: 'Monaco', monaco: 'Monaco',
  lu: 'Luxembourg', luxembourg: 'Luxembourg', luxemburgo: 'Luxembourg',
  ie: 'Ireland', ireland: 'Ireland', irlanda: 'Ireland',
}

/** Distinct canonical countries, sorted — feed CMS dropdowns from this, not DISTINCT(DB). */
export const CANONICAL_COUNTRIES: string[] = Array.from(
  new Set(Object.values(COUNTRY_ALIASES)),
).sort((a, b) => a.localeCompare(b))

/**
 * Canonicalise a country value. Unknown values are returned trimmed (never
 * dropped) so we don't lose data — only known aliases get rewritten.
 */
export function normalizeCountry(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const cleaned = String(raw).replace(/[\r\n]+/g, ' ').trim()
  if (!cleaned) return null
  return COUNTRY_ALIASES[slug(cleaned)] ?? cleaned
}

// ════════════════════════════════════════════════════════════════════════════
// STATE  (country-aware)
// ════════════════════════════════════════════════════════════════════════════

/** Meta-regions / non-mappable buckets → state becomes null. */
const META_REGION_SLUGS = new Set([
  'sudeste', 'nordeste', 'norte', 'sul', 'centro-oeste', 'centro oeste',
  'regiao sudeste', 'regiao nordeste', 'regiao norte', 'regiao sul',
  'regiao centro-oeste', 'regiao', 'leste', 'oeste', 'region', 'regions',
])

/** Admin suffixes stripped globally (Territory intentionally excluded → "Northern Territory"). */
const SUFFIX_RE = /\s+(Department|Departamento|Province|Provincia|District|Distrito|Region|Región|Oblast|Prefecture|State|County|Governorate)$/i

// ── Per-country slug→canonical maps ──────────────────────────────────────────

const ITALY: Record<string, string> = {
  lombardia: 'Lombardy', lombardy: 'Lombardy',
  piemonte: 'Piedmont', piedmont: 'Piedmont',
  toscana: 'Tuscany', tuscany: 'Tuscany',
  sicilia: 'Sicily', sicily: 'Sicily',
  sardegna: 'Sardinia', sardinia: 'Sardinia',
  puglia: 'Apulia', apulia: 'Apulia',
  marche: 'The Marches', 'the marches': 'The Marches',
  "valle d'aosta": 'Aosta Valley', "vallee d'aoste": 'Aosta Valley', 'aosta valley': 'Aosta Valley',
  'trentino-alto adige': 'Trentino-Alto Adige/Südtirol', 'alto adige': 'Trentino-Alto Adige/Südtirol',
  trentino: 'Trentino-Alto Adige/Südtirol', sudtirol: 'Trentino-Alto Adige/Südtirol',
  'friuli-venezia giulia': 'Friuli Venezia Giulia', 'friuli venezia giulia': 'Friuli Venezia Giulia',
  basilicate: 'Basilicata', basilicata: 'Basilicata',
}

const SPAIN: Record<string, string> = {
  madrid: 'Comunidad de Madrid', 'comunidad de madrid': 'Comunidad de Madrid',
  'region de madrid': 'Comunidad de Madrid',
  cataluna: 'Catalunya', catalonia: 'Catalunya', catalunya: 'Catalunya',
  'pais vasco': 'Euskadi', 'basque country': 'Euskadi', basque: 'Euskadi', euskadi: 'Euskadi',
  aragon: 'Aragón',
  'islas baleares': 'Illes Balears', baleares: 'Illes Balears', 'balearic islands': 'Illes Balears',
  'illes balears': 'Illes Balears',
  'region de murcia': 'Región de Murcia',
  asturias: 'Asturias / Asturies', 'principado de asturias': 'Asturias / Asturies',
  'comunidad valenciana': 'Comunitat Valenciana', valencia: 'Comunitat Valenciana',
  'c. valenciana': 'Comunitat Valenciana', 'comunitat valenciana': 'Comunitat Valenciana',
  'islas canarias': 'Canarias', canarias: 'Canarias',
  andalucia: 'Andalucía',
  'castilla y leon': 'Castilla y León', 'castilla leon': 'Castilla y León',
  'castilla la mancha': 'Castilla-La Mancha', 'castilla-la mancha': 'Castilla-La Mancha',
}

const BRAZIL: Record<string, string> = {
  para: 'Pará', parana: 'Paraná', ceara: 'Ceará', goias: 'Goiás',
  maranhao: 'Maranhão', piaui: 'Piauí', paraiba: 'Paraíba',
  'espirito santo': 'Espírito Santo', amapa: 'Amapá', rondonia: 'Rondônia',
  roraima: 'Roraima', 'sao paulo': 'São Paulo',
  'rio grande do norte': 'Rio Grande do Norte', 'rio grande do sul': 'Rio Grande do Sul',
  // Distrito Federal (Brasília) — incl. English form & the "Federal" mangle recovery
  'distrito federal': 'Distrito Federal', 'federal district': 'Distrito Federal',
  brasilia: 'Distrito Federal', federal: 'Distrito Federal',
  // UF (2-letter abbreviations) → full accented name
  ac: 'Acre', al: 'Alagoas', ap: 'Amapá', am: 'Amazonas', ba: 'Bahia', ce: 'Ceará',
  df: 'Distrito Federal', es: 'Espírito Santo', go: 'Goiás', ma: 'Maranhão',
  mt: 'Mato Grosso', ms: 'Mato Grosso do Sul', mg: 'Minas Gerais', pa: 'Pará',
  pb: 'Paraíba', pr: 'Paraná', pe: 'Pernambuco', pi: 'Piauí', rj: 'Rio de Janeiro',
  rn: 'Rio Grande do Norte', rs: 'Rio Grande do Sul', ro: 'Rondônia', rr: 'Roraima',
  sc: 'Santa Catarina', sp: 'São Paulo', se: 'Sergipe', to: 'Tocantins',
}

const ARGENTINA: Record<string, string> = {
  'ciudad autonoma de buenos aires': 'Ciudad de Buenos Aires', caba: 'Ciudad de Buenos Aires',
  'buenos aires f.d.': 'Ciudad de Buenos Aires', 'buenos aires f.d': 'Ciudad de Buenos Aires',
  'buenos aires fd': 'Ciudad de Buenos Aires', 'ciudad de buenos aires': 'Ciudad de Buenos Aires',
  cordoba: 'Córdoba', tucuman: 'Tucumán', neuquen: 'Neuquén',
  'rio negro': 'Río Negro', 'entre rios': 'Entre Ríos',
}

const PORTUGAL: Record<string, string> = {
  evora: 'Évora', setubal: 'Setúbal', 'viana do castelo': 'Viana do Castelo', braganca: 'Bragança',
}

const CANADA: Record<string, string> = { quebec: 'Québec' }

const URUGUAY: Record<string, string> = {
  paysandu: 'Paysandú', tacuarembo: 'Tacuarembó', 'rio negro': 'Río Negro', 'san jose': 'San José',
}

const PERU: Record<string, string> = {
  cuzco: 'Cusco', cusco: 'Cusco', ancash: 'Áncash', apurimac: 'Apurímac',
  junin: 'Junín', 'san martin': 'San Martín', huanuco: 'Huánuco',
}

const PARAGUAY: Record<string, string> = {
  boqueron: 'Boquerón', 'alto parana': 'Alto Paraná', itapua: 'Itapúa',
  neembucu: 'Ñeembucú', asuncion: 'Asunción', concepcion: 'Concepción',
  caaguazu: 'Caaguazú', caazapa: 'Caazapá', paraguari: 'Paraguarí',
  guaira: 'Guairá', canindeyu: 'Canindeyú',
}

const BOLIVIA: Record<string, string> = { beni: 'El Beni', 'el beni': 'El Beni' }

const VENEZUELA: Record<string, string> = {
  'distrito federal': 'Distrito Capital', 'distrito capital': 'Distrito Capital',
  df: 'Distrito Capital', caracas: 'Distrito Capital',
  tachira: 'Táchira', merida: 'Mérida', falcon: 'Falcón', guarico: 'Guárico',
  anzoategui: 'Anzoátegui', bolivar: 'Bolívar', portuguesa: 'Portuguesa',
}

const COLOMBIA: Record<string, string> = {
  bolivar: 'Bolívar', cordoba: 'Córdoba', choco: 'Chocó', boyaca: 'Boyacá',
  narino: 'Nariño', quindio: 'Quindío', vaupes: 'Vaupés', guainia: 'Guainía',
  bogota: 'Bogota', 'bogota d.c.': 'Bogota', 'distrito capital': 'Bogota',
}

const FRANCE: Record<string, string> = {
  'rhone-alpes': 'Auvergne-Rhône-Alpes', auvergne: 'Auvergne-Rhône-Alpes',
  'auvergne-rhone-alpes': 'Auvergne-Rhône-Alpes',
  'midi-pyrenees': 'Occitanie', 'languedoc-roussillon': 'Occitanie', 'languedoc roussillon': 'Occitanie',
  occitanie: 'Occitanie',
  'nord-pas-de-calais': 'Hauts-de-France', 'nord-pas de calais': 'Hauts-de-France', picardie: 'Hauts-de-France',
  'hauts-de-france': 'Hauts-de-France',
  'haute-normandie': 'Normandie', 'haute normandie': 'Normandie',
  'basse-normandie': 'Normandie', 'basse normandie': 'Normandie', normandie: 'Normandie',
  'champagne-ardenne': 'Grand Est', 'champagne ardenne': 'Grand Est', alsace: 'Grand Est',
  lorraine: 'Grand Est', 'grand est': 'Grand Est',
  'poitou-charentes': 'Nouvelle-Aquitaine', 'poitou charentes': 'Nouvelle-Aquitaine',
  limousin: 'Nouvelle-Aquitaine', aquitaine: 'Nouvelle-Aquitaine', 'nouvelle-aquitaine': 'Nouvelle-Aquitaine',
  bourgogne: 'Bourgogne-Franche-Comté', 'franche-comte': 'Bourgogne-Franche-Comté',
  'franche comte': 'Bourgogne-Franche-Comté', 'bourgogne-franche-comte': 'Bourgogne-Franche-Comté',
  centre: 'Centre-Val de Loire', 'centre-val de loire': 'Centre-Val de Loire',
  'ile-de-france': 'Île-de-France', 'ile de france': 'Île-de-France',
  'provence-alpes-cote d\'azur': 'Provence-Alpes-Côte d\'Azur',
  'provence alpes cote d\'azur': 'Provence-Alpes-Côte d\'Azur', paca: 'Provence-Alpes-Côte d\'Azur',
}

const SWITZERLAND: Record<string, string> = {
  grisons: 'Graubünden', grigioni: 'Graubünden', graubuenden: 'Graubünden', graubunden: 'Graubünden',
  zurich: 'Zürich', geneve: 'Genève', genf: 'Genève', geneva: 'Genève',
  vaud: 'Vaud', valais: 'Valais', wallis: 'Valais', bern: 'Bern', berne: 'Bern',
  ticino: 'Ticino', tessin: 'Ticino',
  basel: 'Basel-Stadt', 'basel-stadt': 'Basel-Stadt', 'bale-ville': 'Basel-Stadt',
  baselland: 'Basel-Landschaft', 'basel-landschaft': 'Basel-Landschaft', 'bale-campagne': 'Basel-Landschaft',
  'st. gallen': 'Sankt Gallen', 'st gallen': 'Sankt Gallen', 'saint-gall': 'Sankt Gallen', 'san gallo': 'Sankt Gallen',
  lucerne: 'Luzern', luzern: 'Luzern', neuchatel: 'Neuchâtel',
  fribourg: 'Fribourg', freiburg: 'Fribourg', aargau: 'Aargau', argovie: 'Aargau',
  thurgau: 'Thurgau', thurgovie: 'Thurgau', solothurn: 'Solothurn', soleure: 'Solothurn',
}

const VATICAN: Record<string, string> = {
  'vatican city': 'Vatican', 'citta del vaticano': 'Vatican',
  'cidade do vaticano': 'Vatican', 'cite du vatican': 'Vatican', vatican: 'Vatican',
}

/** US 2-letter abbreviations + common typos/aliases → full English state name. */
const US_STATES: Record<string, string> = {
  al: 'Alabama', ak: 'Alaska', az: 'Arizona', ar: 'Arkansas', ca: 'California',
  co: 'Colorado', ct: 'Connecticut', de: 'Delaware', fl: 'Florida', ga: 'Georgia',
  hi: 'Hawaii', id: 'Idaho', il: 'Illinois', in: 'Indiana', ia: 'Iowa', ks: 'Kansas',
  ky: 'Kentucky', la: 'Louisiana', me: 'Maine', md: 'Maryland', ma: 'Massachusetts',
  mi: 'Michigan', mn: 'Minnesota', ms: 'Mississippi', mo: 'Missouri', mt: 'Montana',
  ne: 'Nebraska', nv: 'Nevada', nh: 'New Hampshire', nj: 'New Jersey', nm: 'New Mexico',
  ny: 'New York', nc: 'North Carolina', nd: 'North Dakota', oh: 'Ohio', ok: 'Oklahoma',
  or: 'Oregon', pa: 'Pennsylvania', ri: 'Rhode Island', sc: 'South Carolina',
  sd: 'South Dakota', tn: 'Tennessee', tx: 'Texas', ut: 'Utah', vt: 'Vermont',
  va: 'Virginia', wa: 'Washington', wv: 'West Virginia', wi: 'Wisconsin', wy: 'Wyoming',
  mississipi: 'Mississippi', dc: 'District of Columbia', 'washington dc': 'District of Columbia',
  'washington d.c.': 'District of Columbia', 'washington, d.c.': 'District of Columbia',
}

const STATE_MAPS: Record<string, Record<string, string>> = {
  Italy: ITALY, Spain: SPAIN, Brazil: BRAZIL, Argentina: ARGENTINA,
  Portugal: PORTUGAL, Canada: CANADA, Uruguay: URUGUAY, Peru: PERU,
  Paraguay: PARAGUAY, Bolivia: BOLIVIA, Venezuela: VENEZUELA, Colombia: COLOMBIA,
  France: FRANCE, Switzerland: SWITZERLAND, Vatican: VATICAN,
}

/** Strip a leading Spanish "Región/Estado …" administrative prefix (Chile/Venezuela). */
function stripAdminPrefix(s: string): string {
  return s
    .replace(/^Regi[oó]n\s+(Metropolitana\s+|del\s+|de\s+la\s+|de\s+los\s+|de\s+)?/i, '')
    .replace(/^Estado\s+(del\s+|de\s+la\s+|de\s+los\s+|de\s+)?/i, '')
    .trim()
}

/**
 * Canonicalise a state value for the given (already raw) country.
 * Returns null for meta-regions, state==country, or empties (parity with the
 * SQL backfill). Unknown states are returned trimmed/suffix-free, never dropped.
 */
export function normalizeState(
  rawCountry: string | null | undefined,
  rawState: string | null | undefined,
): string | null {
  if (rawState == null) return null
  let s = String(rawState).replace(/[\r\n]+/g, ' ').trim()
  if (!s) return null

  const country = normalizeCountry(rawCountry)
  const sl = slug(s)

  // Meta-regions / state==country → drop.
  if (META_REGION_SLUGS.has(sl)) return null
  if (country && sl === slug(country)) return null

  // Chile: prefix-strip then map (handles "Región de Antofagasta" etc.).
  if (country === 'Chile') return normalizeChile(s)

  // Country-specific exact maps.
  const map = country ? STATE_MAPS[country] : undefined
  if (map && map[sl]) return map[sl]

  if (country === 'United States') {
    if (US_STATES[sl]) return US_STATES[sl]
    return s // already a full name
  }

  // Venezuela: strip "Estado de…" then re-check the map.
  if (country === 'Venezuela') {
    const stripped = stripAdminPrefix(s)
    if (VENEZUELA[slug(stripped)]) return VENEZUELA[slug(stripped)]
    s = stripped
  }

  // Ecuador: drop hyphens in compound province names.
  if (country === 'Ecuador') s = s.replace(/-/g, ' ').trim()

  // Generic admin-suffix strip (Lima Province / Tierra del Fuego preserved).
  if (!/^lima province$/i.test(s) && !/^tierra del fuego$/i.test(s)) {
    const stripped = s.replace(SUFFIX_RE, '').trim()
    if (stripped) {
      // re-check the country map after stripping the suffix
      if (map && map[slug(stripped)]) return map[slug(stripped)]
      s = stripped
    }
  }

  return s.trim() || null
}

/** The 16 Chilean regions → canonical (Natural Earth) name. Keyed by core token. */
const CHILE: Record<string, string> = {
  'arica y parinacota': 'Arica y Parinacota',
  tarapaca: 'Tarapacá',
  antofagasta: 'Antofagasta',
  atacama: 'Atacama',
  coquimbo: 'Coquimbo',
  valparaiso: 'Valparaíso',
  santiago: 'Región Metropolitana de Santiago', metropolitana: 'Región Metropolitana de Santiago',
  'santiago metropolitan': 'Región Metropolitana de Santiago', 'metropolitan region': 'Región Metropolitana de Santiago',
  "libertador general bernardo o'higgins": "Libertador General Bernardo O'Higgins",
  "o'higgins": "Libertador General Bernardo O'Higgins", "o'higgins region": "Libertador General Bernardo O'Higgins",
  maule: 'Maule',
  nuble: 'Ñuble',
  biobio: 'Bío-Bío', 'bio-bio': 'Bío-Bío', 'bio bio': 'Bío-Bío',
  araucania: 'La Araucanía', 'la araucania': 'La Araucanía',
  'los rios': 'Los Ríos', rios: 'Los Ríos',
  'los lagos': 'Los Lagos', lagos: 'Los Lagos',
  aysen: 'Aisén del General Carlos Ibáñez del Campo', aisen: 'Aisén del General Carlos Ibáñez del Campo',
  'aisen del general carlos ibanez del campo': 'Aisén del General Carlos Ibáñez del Campo',
  magallanes: 'Magallanes y Antártica Chilena',
  'magallanes y antartica chilena': 'Magallanes y Antártica Chilena',
  'magallanes y de la antartica chilena': 'Magallanes y Antártica Chilena',
}

function normalizeChile(raw: string): string | null {
  // "Región Metropolitana de Santiago" is itself canonical — never strip it.
  if (/^regi[oó]n metropolitana de santiago$/i.test(slug(raw))) return 'Región Metropolitana de Santiago'
  // Drop a trailing " Region"/" Región" (English/Spanish) and a leading "Región (de/del/…)".
  const core = stripAdminPrefix(raw).replace(/\s+regi[oó]n$/i, '').trim()
  return CHILE[slug(core)] ?? CHILE[slug(raw)] ?? core.trim() ?? null
}

/** Convenience: normalise both fields together. */
export function normalizeLocation(
  country: string | null | undefined,
  state: string | null | undefined,
): { country: string | null; state: string | null } {
  let c = normalizeCountry(country)
  let s = normalizeState(country, state)
  // French Guiana POIs are sometimes filed under France (state "Guyane").
  // Reclassify to the standalone territory — matches the existing DB convention
  // (country "French Guiana", state "Guyane").
  if (c === 'France' && s && slug(s) === 'guyane') { c = 'French Guiana'; s = 'Guyane' }
  return { country: c, state: s }
}
