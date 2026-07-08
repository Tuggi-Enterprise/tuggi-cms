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

/** lowercase + strip accents + drop dots/commas + collapse whitespace. Lookup key for every map. */
export function slug(s: string | null | undefined): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.,]/g, '')
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
  bs: 'The Bahamas', bahamas: 'The Bahamas', 'the bahamas': 'The Bahamas', 'bahamas islands': 'The Bahamas',
  pr: 'Puerto Rico', 'puerto rico': 'Puerto Rico',
  tc: 'Turks and Caicos Islands', 'turks and caicos islands': 'Turks and Caicos Islands',
  ag: 'Antigua and Barbuda', 'antigua and barbuda': 'Antigua and Barbuda',
  bb: 'Barbados', barbados: 'Barbados',
  lc: 'Saint Lucia', 'saint lucia': 'Saint Lucia',
  gd: 'Grenada', grenada: 'Grenada',
  vc: 'Saint Vincent and the Grenadines', 'saint vincent and the grenadines': 'Saint Vincent and the Grenadines',
  dm: 'Dominica', dominica: 'Dominica',
  kn: 'Saint Kitts and Nevis', 'saint kitts and nevis': 'Saint Kitts and Nevis',
  ky: 'Cayman Islands', 'cayman islands': 'Cayman Islands',
  aw: 'Aruba', aruba: 'Aruba',
  cw: 'Curaçao', curacao: 'Curaçao',
  bm: 'Bermuda', bermuda: 'Bermuda',
  ai: 'Anguilla', anguilla: 'Anguilla',
  vg: 'British Virgin Islands', 'british virgin islands': 'British Virgin Islands',
  vi: 'United States Virgin Islands', 'united states virgin islands': 'United States Virgin Islands',
  gp: 'Guadeloupe', guadeloupe: 'Guadeloupe',
  mq: 'Martinique', martinique: 'Martinique',
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
const SUFFIX_RE = /\s+(Department|Departamento|Province|Provincia|District|Distrito|Region|Región|Oblast|Prefecture|State|County|Governorate|Parish|Comarca)$/i

// ── Per-country slug→canonical maps ──────────────────────────────────────────

const ITALY: Record<string, string> = {
  // ── 20 regions (English Natural Earth) + IT/local variants ──
  lombardia: 'Lombardy', lombardy: 'Lombardy',
  piemonte: 'Piedmont', piedmont: 'Piedmont',
  toscana: 'Tuscany', tuscany: 'Tuscany',
  sicilia: 'Sicily', sicily: 'Sicily',
  sardegna: 'Sardinia', sardinia: 'Sardinia',
  puglia: 'Apulia', apulia: 'Apulia',
  marche: 'The Marches', 'the marches': 'The Marches',
  "valle d'aosta": 'Aosta Valley', "vallee d'aoste": 'Aosta Valley', 'aosta valley': 'Aosta Valley',
  'trentino-alto adige': 'Trentino-Alto Adige/Südtirol', 'trentino alto adige': 'Trentino-Alto Adige/Südtirol',
  'alto adige': 'Trentino-Alto Adige/Südtirol',
  trentino: 'Trentino-Alto Adige/Südtirol', sudtirol: 'Trentino-Alto Adige/Südtirol',
  'friuli-venezia giulia': 'Friuli Venezia Giulia', 'friuli venezia giulia': 'Friuli Venezia Giulia',
  basilicate: 'Basilicata', basilicata: 'Basilicata',
  veneto: 'Veneto', lazio: 'Lazio', campania: 'Campania', liguria: 'Liguria',
  'emilia-romagna': 'Emilia-Romagna', 'emilia romagna': 'Emilia-Romagna',
  abruzzo: 'Abruzzo', calabria: 'Calabria', umbria: 'Umbria', molise: 'Molise',
  // ── Provinces → parent region (full names, from the coverage map) ──
  bologna: 'Emilia-Romagna', modena: 'Emilia-Romagna', parma: 'Emilia-Romagna',
  "reggio nell'emilia": 'Emilia-Romagna', ravenna: 'Emilia-Romagna', rimini: 'Emilia-Romagna',
  ferrara: 'Emilia-Romagna', 'forli-cesena': 'Emilia-Romagna', 'forli cesena': 'Emilia-Romagna', piacenza: 'Emilia-Romagna',
  genova: 'Liguria', 'la spezia': 'Liguria', savona: 'Liguria', imperia: 'Liguria',
  trento: 'Trentino-Alto Adige/Südtirol', bolzano: 'Trentino-Alto Adige/Südtirol', bozen: 'Trentino-Alto Adige/Südtirol',
  milano: 'Lombardy', bergamo: 'Lombardy', brescia: 'Lombardy', como: 'Lombardy', lecco: 'Lombardy',
  lodi: 'Lombardy', mantova: 'Lombardy', 'monza e brianza': 'Lombardy', pavia: 'Lombardy',
  sondrio: 'Lombardy', varese: 'Lombardy', cremona: 'Lombardy',
  venezia: 'Veneto', verona: 'Veneto', padova: 'Veneto', vicenza: 'Veneto',
  treviso: 'Veneto', teviso: 'Veneto', rovigo: 'Veneto', belluno: 'Veneto',
  torino: 'Piedmont', alessandria: 'Piedmont', asti: 'Piedmont', biella: 'Piedmont',
  cuneo: 'Piedmont', novara: 'Piedmont', 'verbano-cusio-ossola': 'Piedmont', 'verbano cusio ossola': 'Piedmont', vercelli: 'Piedmont',
  trieste: 'Friuli Venezia Giulia', udine: 'Friuli Venezia Giulia', pordenone: 'Friuli Venezia Giulia', gorizia: 'Friuli Venezia Giulia',
  firenze: 'Tuscany', pisa: 'Tuscany', siena: 'Tuscany', arezzo: 'Tuscany', grosseto: 'Tuscany',
  livorno: 'Tuscany', lucca: 'Tuscany', 'massa-carrara': 'Tuscany', pistoia: 'Tuscany', prato: 'Tuscany',
  roma: 'Lazio', rome: 'Lazio', viterbo: 'Lazio', frosinone: 'Lazio', latina: 'Lazio', rieti: 'Lazio',
  napoli: 'Campania', salerno: 'Campania', caserta: 'Campania', avellino: 'Campania', benevento: 'Campania',
  palermo: 'Sicily', catania: 'Sicily', messina: 'Sicily', siracusa: 'Sicily', agrigento: 'Sicily',
  trapani: 'Sicily', ragusa: 'Sicily', caltanissetta: 'Sicily', enna: 'Sicily',
  cagliari: 'Sardinia', sassari: 'Sardinia', nuoro: 'Sardinia', oristano: 'Sardinia', 'sud sardegna': 'Sardinia',
  bari: 'Apulia', lecce: 'Apulia', taranto: 'Apulia', foggia: 'Apulia', brindisi: 'Apulia',
  'barletta-andria-trani': 'Apulia', bat: 'Apulia',
  ancona: 'The Marches', macerata: 'The Marches', 'pesaro e urbino': 'The Marches', fermo: 'The Marches', 'ascoli piceno': 'The Marches',
  aosta: 'Aosta Valley',
  potenza: 'Basilicata', 'provincia di potenza': 'Basilicata', matera: 'Basilicata',
  catanzaro: 'Calabria', cosenza: 'Calabria', 'reggio di calabria': 'Calabria', 'vibo valentia': 'Calabria', crotone: 'Calabria',
  "l'aquila": 'Abruzzo', chieti: 'Abruzzo', pescara: 'Abruzzo', teramo: 'Abruzzo',
  perugia: 'Umbria', terni: 'Umbria',
  campobasso: 'Molise', isernia: 'Molise',
  // ── 2-letter ISTAT province codes (present in the data) ──
  le: 'Apulia', ta: 'Apulia', fg: 'Apulia', ba: 'Apulia', br: 'Apulia',
  ge: 'Liguria', sp: 'Liguria', sv: 'Liguria',
  bo: 'Emilia-Romagna', mo: 'Emilia-Romagna', ra: 'Emilia-Romagna', fe: 'Emilia-Romagna', pr: 'Emilia-Romagna',
  tn: 'Trentino-Alto Adige/Südtirol', bz: 'Trentino-Alto Adige/Südtirol',
  rm: 'Lazio', vt: 'Lazio', fr: 'Lazio', lt: 'Lazio', ri: 'Lazio',
  pa: 'Sicily', ct: 'Sicily', me: 'Sicily', ag: 'Sicily', en: 'Sicily', tp: 'Sicily', rg: 'Sicily',
  gr: 'Tuscany', si: 'Tuscany', pt: 'Tuscany', li: 'Tuscany', ar: 'Tuscany', pi: 'Tuscany',
  aq: 'Abruzzo', ch: 'Abruzzo', pe: 'Abruzzo', te: 'Abruzzo',
  cs: 'Calabria', cz: 'Calabria', kr: 'Calabria', vv: 'Calabria',
  'it-cs': 'Calabria',
  mi: 'Lombardy', bg: 'Lombardy', bs: 'Lombardy',
  ve: 'Veneto', vr: 'Veneto', pd: 'Veneto', vi: 'Veneto', tv: 'Veneto',
  to: 'Piedmont', na: 'Campania', sa: 'Campania', ud: 'Friuli Venezia Giulia', go: 'Friuli Venezia Giulia',
  pg: 'Umbria', an: 'The Marches', mc: 'The Marches',
}

const SPAIN: Record<string, string> = {
  // Canonical values follow the DB/CMS standard (migration batches 26/28): Castilian
  // short forms (Madrid / País Vasco / Asturias / Murcia). NOTE: the marketing coverage
  // map (tuggi-enterprise CoverageMap.tsx) labels these communities Euskadi / Comunidad
  // de Madrid / "Asturias / Asturies" — a display-only difference; that map colours by
  // point-in-polygon on coordinates, not this state string, so the two never need to match.
  madrid: 'Madrid', 'comunidad de madrid': 'Madrid', 'region de madrid': 'Madrid',
  cataluna: 'Catalunya', catalonia: 'Catalunya', catalunya: 'Catalunya',
  // Catalan provinces → community (keep community-level granularity)
  barcelona: 'Catalunya', tarragona: 'Catalunya', lleida: 'Catalunya', girona: 'Catalunya', gerona: 'Catalunya',
  'pais vasco': 'País Vasco', 'basque country': 'País Vasco', basque: 'País Vasco', euskadi: 'País Vasco',
  aragon: 'Aragón',
  'islas baleares': 'Illes Balears', baleares: 'Illes Balears', 'balearic islands': 'Illes Balears',
  'illes balears': 'Illes Balears',
  murcia: 'Murcia', 'region de murcia': 'Murcia',
  asturias: 'Asturias', 'principado de asturias': 'Asturias', 'asturias / asturies': 'Asturias',
  'comunidad valenciana': 'Comunitat Valenciana', valencia: 'Comunitat Valenciana',
  'c valenciana': 'Comunitat Valenciana', 'comunitat valenciana': 'Comunitat Valenciana',
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

const CANADA: Record<string, string> = {
  on: 'Ontario', qc: 'Québec', pq: 'Québec', quebec: 'Québec', 'province of quebec': 'Québec',
  bc: 'British Columbia', ab: 'Alberta', mb: 'Manitoba', sk: 'Saskatchewan',
  ns: 'Nova Scotia', nb: 'New Brunswick',
  nl: 'Newfoundland and Labrador', nf: 'Newfoundland and Labrador',
  newfoundland: 'Newfoundland and Labrador', 'newfoundland & labrador': 'Newfoundland and Labrador',
  pe: 'Prince Edward Island', pei: 'Prince Edward Island',
  nt: 'Northwest Territories', yt: 'Yukon', yk: 'Yukon', nu: 'Nunavut',
}

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
  bogota: 'Bogota', 'bogota dc': 'Bogota', 'distrito capital': 'Bogota',
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

// ── Central America & Caribbean (batches 20/21) ──────────────────────────────
const NICARAGUA: Record<string, string> = {
  'north caribbean coast': 'Atlántico Norte', 'atlantico norte': 'Atlántico Norte',
  raan: 'Atlántico Norte', 'region autonoma del atlantico norte': 'Atlántico Norte',
  'south caribbean coast': 'Atlántico Sur', 'atlantico sur': 'Atlántico Sur',
  raas: 'Atlántico Sur', 'region autonoma del atlantico sur': 'Atlántico Sur',
  leon: 'León', esteli: 'Estelí', 'rio san juan': 'Río San Juan',
}

const HONDURAS: Record<string, string> = {
  'bay islands': 'Islas de la Bahía', 'islas de la bahia': 'Islas de la Bahía',
  'francisco morazan': 'Francisco Morazán', cortes: 'Cortés', atlantida: 'Atlántida',
  'santa barbara': 'Santa Bárbara', copan: 'Copán', colon: 'Colón',
  'el paraiso': 'El Paraíso', intibuca: 'Intibucá', 'gracias a dios': 'Gracias a Dios',
}

const EL_SALVADOR: Record<string, string> = {
  ahuachapan: 'Ahuachapán', cabanas: 'Cabañas', morazan: 'Morazán',
  usulutan: 'Usulután', 'la union': 'La Unión', cuscatlan: 'Cuscatlán',
}

const GUATEMALA: Record<string, string> = {
  quetzaltenango: 'Quezaltenango', quezaltenango: 'Quezaltenango',
  suchitepequez: 'Suchitepéquez', quiche: 'Quiché', peten: 'Petén', solola: 'Sololá',
  totonicapan: 'Totonicapán', sacatepequez: 'Sacatepéquez',
  guatemala: 'Guatemala', // Guatemala Department — legitimately shares the country name
}

const PANAMA: Record<string, string> = {
  'bocas del toro': 'Bocas del Toro', chiriqui: 'Chiriquí', cocle: 'Coclé',
  colon: 'Colón', darien: 'Darién', herrera: 'Herrera', 'los santos': 'Los Santos',
  veraguas: 'Veraguas',
  // Panamá province (2014 split "Panamá Oeste" not in Natural Earth → merge)
  panama: 'Panamá', 'panama oeste': 'Panamá', 'panama oeste province': 'Panamá',
  // Comarcas (indigenous regions)
  'ngobe-bugle': 'Ngöbe Buglé', 'ngobe bugle': 'Ngöbe Buglé',
  'kuna yala': 'Kuna Yala', 'comarca kuna yala': 'Kuna Yala', 'san blas': 'Kuna Yala', 'guna yala': 'Kuna Yala',
  embera: 'Emberá', 'comarca embera': 'Emberá',
}

const COSTA_RICA: Record<string, string> = {
  'san jose': 'San José', limon: 'Limón',
}

const CUBA: Record<string, string> = {
  havana: 'Ciudad de la Habana', 'la habana': 'Ciudad de la Habana', habana: 'Ciudad de la Habana',
  camaguey: 'Camagüey', guantanamo: 'Guantánamo', holguin: 'Holguín',
  'sancti spiritus': 'Sancti Spíritus', 'pinar del rio': 'Pinar del Río',
}

const DOMINICAN_REPUBLIC: Record<string, string> = {
  nacional: 'Distrito Nacional', 'distrito nacional': 'Distrito Nacional', 'national district': 'Distrito Nacional',
  'maria trinidad sanchez': 'María Trinidad Sánchez', 'sanchez ramirez': 'Sánchez Ramírez',
  'san cristobal': 'San Cristóbal', 'san jose de ocoa': 'San José de Ocoa',
  'san pedro de macoris': 'San Pedro de Macorís', 'santiago rodriguez': 'Santiago Rodríguez',
  'la vega': 'La Vega', 'el seibo': 'El Seibo', valverde: 'Valverde',
}

const HAITI: Record<string, string> = {
  artibonite: "L'Artibonite", "l'artibonite": "L'Artibonite",
  ouest: 'Ouest', nord: 'Nord', sud: 'Sud',
  'nord-est': 'Nord-Est', 'nord est': 'Nord-Est', northeast: 'Nord-Est',
  'nord-ouest': 'Nord-Ouest', 'nord ouest': 'Nord-Ouest', northwest: 'Nord-Ouest',
  'sud-est': 'Sud-Est', 'sud est': 'Sud-Est', southeast: 'Sud-Est',
  'grande anse': "Grand'Anse", "grande'anse": "Grand'Anse", "grand'anse": "Grand'Anse",
  centre: 'Centre', center: 'Centre', central: 'Centre', nippes: 'Nippes',
}

const JAMAICA: Record<string, string> = {
  'st andrew': 'Saint Andrew', 'saint andrew': 'Saint Andrew',
  'st ann': 'Saint Ann', 'saint ann': 'Saint Ann',
  'st catherine': 'Saint Catherine', 'saint catherine': 'Saint Catherine',
  'st elizabeth': 'Saint Elizabeth', 'saint elizabeth': 'Saint Elizabeth',
  'st james': 'Saint James', 'saint james': 'Saint James',
  'st mary': 'Saint Mary', 'saint mary': 'Saint Mary',
  'st thomas': 'Saint Thomas', 'saint thomas': 'Saint Thomas',
}

const BELIZE: Record<string, string> = {
  'southern district': 'Stann Creek', southern: 'Stann Creek', 'stann creek': 'Stann Creek',
  belize: 'Belize', // Belize District — legitimately shares the country name
}

const AUSTRIA: Record<string, string> = {
  tyrol: 'Tirol', 'north tyrol': 'Tirol', tirol: 'Tirol',
  vienna: 'Wien', wien: 'Wien', styria: 'Steiermark', steiermark: 'Steiermark',
  'lower austria': 'Niederösterreich', niederosterreich: 'Niederösterreich',
  'upper austria': 'Oberösterreich', oberosterreich: 'Oberösterreich',
  carinthia: 'Kärnten', karnten: 'Kärnten',
  salzburg: 'Salzburg', vorarlberg: 'Vorarlberg', burgenland: 'Burgenland',
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
  Nicaragua: NICARAGUA, Honduras: HONDURAS, 'El Salvador': EL_SALVADOR,
  Guatemala: GUATEMALA, Panama: PANAMA, 'Costa Rica': COSTA_RICA,
  Cuba: CUBA, 'Dominican Republic': DOMINICAN_REPUBLIC, Haiti: HAITI,
  Jamaica: JAMAICA, Belize: BELIZE, Austria: AUSTRIA,
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
  rawCity?: string | null | undefined,
): string | null {
  if (rawState == null) return null
  let s = String(rawState).replace(/[\r\n]+/g, ' ').trim()
  if (!s) return null

  const country = normalizeCountry(rawCountry)
  const sl = slug(s)
  const map = country ? STATE_MAPS[country] : undefined

  // Explicit country-specific mapping wins first — e.g. Panama's "Panamá"
  // province legitimately equals the country name and must NOT be dropped.
  if (map && map[sl]) return map[sl]

  // City-dependent countries get full control (nation/province → council/county).
  if (country === 'Ireland') return normalizeIreland(s, rawCity)
  if (country === 'United Kingdom') return normalizeUK(s, rawCity)

  // Meta-regions / state==country / purely-numeric junk (postal codes) → drop.
  if (META_REGION_SLUGS.has(sl)) return null
  if (country && sl === slug(country)) return null
  if (/^\d+$/.test(s)) return null

  // Chile: prefix-strip then map (handles "Región de Antofagasta" etc.).
  if (country === 'Chile') return normalizeChile(s)

  if (country === 'United States') {
    if (US_STATES[sl]) return US_STATES[sl]
    return s // already a full name
  }

  if (country === 'Canada') {
    if (/nunavut/i.test(s)) return 'Nunavut'          // "ᓄᓇᕗᑦ Nunavut" syllabics prefix
    if (sl === 'mi') return null                       // US Michigan misclassified under Canada
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

/** Title-case for promoted city→region names (map matching is case-insensitive). */
function titleCase(s: string): string {
  return s.trim().toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase())
}

// ── IRELAND (batch 23) — county-level, city-aware Dublin/Tipperary splits ────
const IRELAND_SIMPLE: Record<string, string> = {
  laois: 'Laoighis', laoigh: 'Laoighis', laoighis: 'Laoighis', laoigis: 'Laoighis', laouis: 'Laoighis',
  limerick: 'Limerick', 'limerick city': 'Limerick',
  cork: 'Cork', 'cork city': 'Cork', galway: 'Galway', 'galway city': 'Galway',
  waterford: 'Waterford', 'waterford city': 'Waterford',
  'dun laoghaire-rathdown': 'Dún Laoghaire–Rathdown', 'dun laoghaire rathdown': 'Dún Laoghaire–Rathdown', dlr: 'Dún Laoghaire–Rathdown',
}
const TIPP_SOUTH = new Set(['clonmel', 'cahir', 'cashel', 'tipperary', 'carrick-on-suir', 'fethard', 'thurles', 'roscrea'])
const DUB_FINGAL = new Set(['swords', 'balbriggan', 'malahide', 'donabate', 'rush', 'lusk', 'skerries', 'howth', 'blanchardstown', 'mulhuddart'])
const DUB_DLR = new Set(['dun laoghaire', 'rathdown', 'blackrock', 'stillorgan', 'dundrum', 'glenageary', 'dalkey', 'killiney', 'foxrock'])
const DUB_SOUTH = new Set(['tallaght', 'clondalkin', 'lucan', 'rathcoole', 'saggart', 'newcastle', 'clonskeagh', 'terenure', 'rathfarnham'])

function normalizeIreland(state: string, city?: string | null): string | null {
  const bare = state.replace(/^(County|Co\.?)\s+/i, '').trim()
  const sl = slug(bare)
  const cl = slug(city)
  if (sl === 'tipperary') return TIPP_SOUTH.has(cl) ? 'South Tipperary' : 'North Tipperary'
  if (sl === 'dublin' || sl === 'dublin city') {
    if (DUB_FINGAL.has(cl)) return 'Fingal'
    if (DUB_DLR.has(cl)) return 'Dún Laoghaire–Rathdown'
    if (DUB_SOUTH.has(cl)) return 'South Dublin'
    return 'Dublin'
  }
  return IRELAND_SIMPLE[sl] ?? bare.trim() ?? null
}

// ── UNITED KINGDOM (batch 24) — promote city→council; nation-level → null ────
const UK_NATIONS = new Set(['england', 'scotland', 'wales', 'northern ireland', 'great britain', 'gb', 'uk', 'britain'])
const UK_COUNCILS = new Set([
  // Scotland
  'aberdeen', 'aberdeenshire', 'angus', 'argyll and bute', 'clackmannanshire', 'dumfries and galloway',
  'dundee', 'east ayrshire', 'east dunbartonshire', 'east lothian', 'east renfrewshire', 'edinburgh',
  'eilean siar', 'falkirk', 'fife', 'glasgow', 'highland', 'inverclyde', 'midlothian', 'moray',
  'north ayrshire', 'north lanarkshire', 'orkney', 'renfrewshire', 'scottish borders', 'shetland islands',
  'south ayrshire', 'south lanarkshire', 'stirling', 'west dunbartonshire', 'west lothian', 'perthshire and kinross',
  // Wales
  'anglesey', 'blaenau gwent', 'bridgend', 'caerphilly', 'cardiff', 'carmarthenshire', 'ceredigion', 'conwy',
  'denbighshire', 'flintshire', 'gwynedd', 'merthyr tydfil', 'monmouthshire', 'neath port talbot', 'newport',
  'pembrokeshire', 'powys', 'rhondda cynon taff', 'swansea', 'torfaen', 'vale of glamorgan', 'wrexham',
  // Northern Ireland
  'antrim', 'ards', 'armagh', 'ballymena', 'ballymoney', 'banbridge', 'belfast', 'carrickfergus', 'castlereagh',
  'coleraine', 'craigavon', 'derry', 'down', 'dungannon', 'fermanagh', 'larne', 'limavady', 'lisburn',
  'magherafelt', 'moyle', 'newry and mourne', 'newtownabbey', 'north down', 'omagh', 'strabane', 'mid ulster',
  // England
  'barnsley', 'bath and north east somerset', 'bedford', 'birmingham', 'blackburn with darwen', 'blackpool',
  'bolton', 'bournemouth', 'bracknell forest', 'bradford', 'brighton and hove', 'bristol', 'buckinghamshire',
  'bury', 'calderdale', 'cambridgeshire', 'cheshire east', 'cheshire west and chester', 'cornwall', 'coventry',
  'cumbria', 'darlington', 'derby', 'derbyshire', 'devon', 'doncaster', 'dorset', 'dudley', 'durham',
  'east riding of yorkshire', 'east sussex', 'essex', 'gateshead', 'gloucestershire', 'hampshire', 'hartlepool',
  'herefordshire', 'hertfordshire', 'isle of wight', 'isles of scilly', 'kent', 'kirklees', 'knowsley',
  'lancashire', 'leeds', 'leicester', 'leicestershire', 'lincolnshire', 'liverpool', 'luton', 'manchester',
  'medway', 'merseyside', 'middlesbrough', 'milton keynes', 'newcastle upon tyne', 'norfolk',
  'north east lincolnshire', 'north lincolnshire', 'north somerset', 'north tyneside', 'north yorkshire',
  'northamptonshire', 'northumberland', 'nottingham', 'nottinghamshire', 'oldham', 'oxfordshire', 'peterborough',
  'plymouth', 'poole', 'portsmouth', 'reading', 'redcar and cleveland', 'rochdale', 'rotherham', 'rutland',
  'salford', 'sandwell', 'sefton', 'sheffield', 'shropshire', 'slough', 'solihull', 'somerset',
  'south gloucestershire', 'south tyneside', 'southampton', 'southend-on-sea', 'staffordshire', 'stockport',
  'stockton-on-tees', 'stoke-on-trent', 'suffolk', 'sunderland', 'surrey', 'swindon', 'tameside',
  'telford and wrekin', 'thurrock', 'torbay', 'trafford', 'wakefield', 'walsall', 'warrington', 'warwickshire',
  'west berkshire', 'west sussex', 'wigan', 'wiltshire', 'wokingham', 'wolverhampton', 'worcestershire', 'york',
])
const LONDON_BOROUGHS = new Set([
  'barking and dagenham', 'barnet', 'bexley', 'brent', 'bromley', 'camden', 'croydon', 'ealing', 'enfield',
  'greenwich', 'hackney', 'hammersmith and fulham', 'haringey', 'harrow', 'havering', 'hillingdon', 'hounslow',
  'islington', 'kensington and chelsea', 'kingston upon thames', 'lambeth', 'lewisham', 'merton', 'newham',
  'redbridge', 'richmond upon thames', 'southwark', 'sutton', 'tower hamlets', 'waltham forest', 'wandsworth', 'westminster',
])
const YORK_NORTH = new Set(['york', 'harrogate', 'scarborough', 'northallerton', 'richmond', 'skipton', 'thirsk', 'pickering', 'whitby', 'ripon', 'knaresborough', 'boroughbridge', 'settle'])
const YORK_EAST = new Set(['beverley', 'hull', 'bridlington', 'hornsea', 'driffield', 'goole', 'market weighton', 'pocklington'])
const YORK_WEST = new Set(['leeds', 'bradford', 'wakefield', 'huddersfield', 'halifax', 'dewsbury', 'batley', 'morley', 'keighley', 'castleford', 'pontefract'])

function normalizeUK(state: string, city?: string | null): string | null {
  const sl = slug(state)
  const cl = slug(city)
  // City→council special remaps (city name ≠ council name)
  if (cl === 'perth' && (sl === 'scotland' || sl === 'perth' || sl === 'perth and kinross' || sl === 'perthshire and kinross')) return 'Perthshire and Kinross'
  if (['inverness', 'fort william', 'aviemore', 'nairn'].includes(cl) && (sl === 'scotland' || sl === 'highland' || sl === 'highlands')) return 'Highland'
  if (['paisley', 'renfrew', 'johnstone'].includes(cl) && (sl === 'scotland' || sl === 'renfrewshire')) return 'Renfrewshire'
  if (['st andrews', 'saint andrews', 'kirkcaldy', 'dunfermline', 'glenrothes'].includes(cl) && (sl === 'scotland' || sl === 'fife')) return 'Fife'
  if (sl === 'hull' || sl === 'kingston upon hull') return 'Kingston upon Hull'
  if (['newcastle', 'newcastle upon tyne'].includes(sl) && ['newcastle', 'newcastle upon tyne', 'gosforth', 'jesmond', 'byker', 'walker'].includes(cl)) return 'Newcastle upon Tyne'
  // Yorkshire → riding by city
  if (['yorkshire', 'yorks', 'north yorkshire', 'north yorks', 'east riding of yorkshire', 'east yorkshire', 'east riding', 'west yorkshire'].includes(sl)) {
    if (YORK_EAST.has(cl)) return 'East Riding of Yorkshire'
    if (YORK_WEST.has(cl)) return 'West Yorkshire'
    if (sl === 'west yorkshire') return 'West Yorkshire'
    if (sl === 'east riding of yorkshire' || sl === 'east yorkshire' || sl === 'east riding') return 'East Riding of Yorkshire'
    return 'North Yorkshire' // North list + default
  }
  // London boroughs (city = borough name)
  if ((sl === 'london' || sl === 'greater london' || sl === 'england') && LONDON_BOROUGHS.has(cl)) return titleCase(city!)
  if ((sl === 'london' || sl === 'greater london') && cl === 'london') return 'Westminster'
  // Nation-level: promote city→council if recognised; else KEEP the nation
  // (England/Scotland/Wales/NI) so it stays a useful filter. gb/uk/britain noise → null.
  if (UK_NATIONS.has(sl)) {
    if (UK_COUNCILS.has(cl)) return titleCase(city!)
    return UK_NATION_NAMES[sl] ?? null
  }
  return state.trim() || null // already a council
}
const UK_NATION_NAMES: Record<string, string> = {
  england: 'England', scotland: 'Scotland', wales: 'Wales', 'northern ireland': 'Northern Ireland',
}

/** Convenience: normalise both fields together. `city` helps city-dependent
 *  countries (UK/Ireland) resolve nation/province → council/county. */
export function normalizeLocation(
  country: string | null | undefined,
  state: string | null | undefined,
  city?: string | null | undefined,
): { country: string | null; state: string | null } {
  let c = normalizeCountry(country)
  let s = normalizeState(country, state, city)
  // French Guiana POIs are sometimes filed under France (state "Guyane").
  // Reclassify to the standalone territory — matches the existing DB convention
  // (country "French Guiana", state "Guyane").
  if (c === 'France' && s && slug(s) === 'guyane') { c = 'French Guiana'; s = 'Guyane' }
  return { country: c, state: s }
}
