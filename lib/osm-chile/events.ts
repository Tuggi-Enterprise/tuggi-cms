/**
 * #1203: the curated events of Santiago (11/11/2026 to 31/03/2027) as records of the `file` adapter
 * of the weekly import, so the write goes through the import itself (`runEventsImport`, the RPC
 * core.import_event_upsert, the geocoding cache, the poster copy) and not through a second path.
 *
 * Kept free of `supabase/functions/` imports on purpose: those files import with the `.ts`
 * extension and would break the type-check of the repo. The script loads them at run time.
 *
 * BR-EVENTO-009: the text of the source as it is, its image, and its credit. One source row per
 * city (`event_sources_country_city_key`), so the text credit of a city lists every agenda of that
 * city; the poster carries the exact one of each event (item 5, "o crédito gravado é o nome da
 * fonte, no formato do crédito do item 3").
 * BR-EVENTO-001 item 3: the host POI is linked by the curation in the CMS; `suggestHost` only
 * proposes one for the curator, it never writes.
 */
import { isSimilarName } from './matching'

export const EVENTS_TIMEZONE = 'America/Santiago'
export const EVENTS_COUNTRY = 'Chile'
/** core.event_import_languages() code of the source texts. */
export const EVENTS_LANGUAGE = 'es-es'
/** Where the script reads the curated list; also `config.fetch.url` of the source rows it owns. */
export const CURATED_FILE = 'output/chile-1203/santiago-eventos.json'
export const CURATED_ADAPTER = 'file'
export const CURATED_SOURCE_PREFIX = 'Curadoria #1203'

export interface CuratedOccurrence {
  start: string
  end?: string | null
}

/** One entry of santiago-eventos.json. `venue_room` and `notes` are read but not written. */
export interface CuratedEvent {
  title: string
  description: string | null
  start: string
  end: string | null
  occurrences: CuratedOccurrence[]
  all_day: boolean
  venue_name: string | null
  venue_address: string | null
  city: string
  lat: number | null
  lon: number | null
  image_url: string | null
  source_name: string
  source_url: string
}

const isIso = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v))
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const coordinate = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** The list, entry by entry: a malformed entry is reported with its index and left out, never guessed. */
export function parseCuratedEvents(raw: unknown): { events: CuratedEvent[]; errors: string[] } {
  if (!Array.isArray(raw)) return { events: [], errors: ['the file is not a list'] }
  const events: CuratedEvent[] = []
  const errors: string[] = []
  raw.forEach((r: Record<string, unknown> | null, i) => {
    const title = text(r?.title)
    const sourceUrl = text(r?.source_url)
    const city = text(r?.city)
    const sourceName = text(r?.source_name)
    const missing = [
      !title && 'title', !sourceUrl && 'source_url', !city && 'city', !sourceName && 'source_name',
      !isIso(r?.start) && 'start', r?.end != null && !isIso(r?.end) && 'end',
    ].filter(Boolean)
    if (missing.length) {
      errors.push(`#${i}: ${missing.join(', ')} missing or invalid`)
      return
    }
    if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) {
      errors.push(`#${i}: source_url is not http(s)`)
      return
    }
    const occurrences = (Array.isArray(r?.occurrences) ? r!.occurrences as CuratedOccurrence[] : [])
      .filter(o => isIso(o?.start))
      .map(o => ({ start: o.start, end: isIso(o.end) ? o.end : null }))
    events.push({
      title: title!,
      description: typeof r?.description === 'string' ? r.description : null,
      start: r!.start as string,
      end: isIso(r?.end) ? r!.end as string : null,
      occurrences,
      all_day: r?.all_day === true,
      venue_name: text(r?.venue_name),
      venue_address: text(r?.venue_address),
      city: city!,
      lat: coordinate(r?.lat),
      lon: coordinate(r?.lon),
      image_url: text(r?.image_url),
      source_name: sourceName!,
      source_url: sourceUrl!,
    })
  })
  return { events, errors }
}

/** One event per source_url (the external id of the import): the first entry wins. */
export function dedupeBySourceUrl(events: CuratedEvent[]): { kept: CuratedEvent[]; duplicates: CuratedEvent[] } {
  const seen = new Set<string>()
  const kept: CuratedEvent[] = []
  const duplicates: CuratedEvent[] = []
  for (const e of events) {
    if (seen.has(e.source_url)) duplicates.push(e)
    else { seen.add(e.source_url); kept.push(e) }
  }
  return { kept, duplicates }
}

/**
 * Over before today in Santiago: the end (or the start, without an end) is earlier than
 * `todayStartMs`, the first instant of today in EVENTS_TIMEZONE. Same rule as `mapRecord` of the
 * import ("ended"), so the dry run and the run agree.
 */
export function isPast(e: CuratedEvent, todayStartMs: number): boolean {
  return Date.parse(e.end ?? e.start) < todayStartMs
}

/**
 * The start the event is stored with. The database keeps one start and one end per event, so a
 * run of performances is stored from the first one still on (its day is today or later) to `end`:
 * the rule of the Mapas Culturais reader, "the first one still on wins". No occurrence still on:
 * `start`, and the event is past anyway.
 */
export function effectiveStart(e: CuratedEvent, todayStartMs: number): string {
  const list = [...e.occurrences].sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
  const upcoming = list.find(o => Date.parse(o.end ?? o.start) >= todayStartMs)
  return upcoming ? upcoming.start : e.start
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>()

/** YYYY-MM-DD of an instant in timeZone (an ISO in another offset still lands on the local day). */
export function localDayOf(iso: string, timeZone = EVENTS_TIMEZONE): string {
  let f = dayFormatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    dayFormatters.set(timeZone, f)
  }
  return f.format(new Date(iso))
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * The source text, plain, to the HTML the import converts back with `htmlToText`. Without this the
 * import collapses every line break and the paragraphs of the source run together (item 3: the
 * text as it is). Paragraph = blank line, line = `\n`.
 */
export function textToHtml(t: string | null): string | null {
  if (!t || !t.trim()) return null
  return t.replace(/\r\n?/g, '\n').split(/\n\s*\n/)
    .map(p => p.trim()).filter(Boolean)
    .map(p => `<p>${p.split('\n').map(l => escapeHtml(l.trim())).join('<br>')}</p>`)
    .join('')
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** BR-EVENTO-009 item 3 format, "Informações: <órgão> (<domínio>)", for one event. */
export function eventCredit(e: CuratedEvent): string {
  return `Informações: ${e.source_name} (${hostOf(e.source_url)})`
}

/** The credit of a city's source row: every agenda of the city, the busiest first. */
export function cityCredit(events: CuratedEvent[]): string {
  const count = new Map<string, { n: number; host: string; first: number }>()
  events.forEach((e, i) => {
    const c = count.get(e.source_name)
    if (c) c.n += 1
    else count.set(e.source_name, { n: 1, host: hostOf(e.source_url), first: i })
  })
  const parts = [...count.entries()]
    .sort((a, b) => b[1].n - a[1].n || a[1].first - b[1].first)
    .map(([name, c]) => `${name} (${c.host})`)
  return `Informações: ${parts.join('; ')}`
}

const DAY_MS = 24 * 60 * 60 * 1000
/** An all-day event this long is an exhibition season, not a festival weekend. */
const SEASON_DAYS = 7

/**
 * `config.category.rules` of the curated rows. mapCategoryByRules folds case and accents and the
 * first needle contained in `category_hint` wins, so festival comes before the venue rules.
 */
export const CATEGORY_RULES: [string, string][] = [
  ['festival', 'festival'], ['lollapalooza', 'festival'], ['creamfields', 'festival'], ['fauna primavera', 'festival'],
  ['rockodromo', 'festival'], ['santiago rocks', 'festival'],
  ['exposicion', 'exhibition'], ['exhibicion', 'exhibition'], ['bienal', 'exhibition'], ['museo', 'exhibition'],
  ['concierto', 'music'], ['sinfoni', 'music'], ['ciclo', 'music'], ['disco', 'music'], ['arena', 'music'], ['estadio', 'music'],
  ['ballet', 'theatre'], ['cascanueces', 'theatre'], ['teatro', 'theatre'], ['gabriela mistral', 'theatre'],
]

/** Title, venue and, for an all-day run of a week or more, the word that makes it an exhibition. */
export function categoryHint(e: CuratedEvent): string {
  const long = e.all_day && e.end !== null && Date.parse(e.end) - Date.parse(e.start) >= SEASON_DAYS * DAY_MS
  return [e.title, e.venue_name, long ? 'exposicion' : null].filter(Boolean).join(' | ')
}

/** "venue, address" without saying the venue twice; the venue alone when the source has no address. */
export function eventAddress(e: CuratedEvent): string | null {
  const venue = e.venue_name
  const address = e.venue_address
  if (venue && address) return address.toLowerCase().includes(venue.toLowerCase()) ? address : `${venue}, ${address}`
  return venue ?? address
}

/** The record the `file` reader hands to `mapRecord`, through `curatedSourceConfig().fields`. */
export interface CuratedRecord {
  external_id: string
  title: string
  description_html: string | null
  starts_at: string
  ends_at: string | null
  address: string | null
  lat: number | null
  lon: number | null
  image: string | null
  image_credit: string
  url: string
  city: string
  category_hint: string
}

/**
 * The event as a record. An all-day event goes as dates only, so the import stores it all day from
 * 00:00 to 23:59:59 in the source zone; a timed one keeps its offset.
 */
export function toRecord(e: CuratedEvent, todayStartMs: number): CuratedRecord {
  const start = effectiveStart(e, todayStartMs)
  return {
    external_id: e.source_url,
    title: e.title,
    description_html: textToHtml(e.description),
    starts_at: e.all_day ? localDayOf(start) : start,
    ends_at: e.end ? (e.all_day ? localDayOf(e.end) : e.end) : null,
    address: eventAddress(e),
    lat: e.lat,
    lon: e.lon,
    image: e.image_url,
    image_credit: eventCredit(e),
    url: e.source_url,
    city: e.city,
    category_hint: categoryHint(e),
  }
}

/** `config` of a curated source row; passes event_sources_config_check (fetch, fields.name, fields.starts_at, language). */
export function curatedSourceConfig(city: string) {
  return {
    version: 1,
    language: EVENTS_LANGUAGE,
    fetch: { url: CURATED_FILE },
    filter: [{ field: 'city', op: 'eq' as const, value: city }],
    fields: {
      external_id: 'external_id',
      name: 'title',
      description: 'description_html',
      starts_at: 'starts_at',
      ends_at: 'ends_at',
      address: 'address',
      lat: 'lat',
      lon: 'lon',
      image: 'image',
      image_credit: 'image_credit',
      url: 'url',
      category: 'category_hint',
    },
    category: { rules: CATEGORY_RULES, default: 'other' },
  }
}

/** A row of core.event_sources the run would own; `owned` false = another source holds the city. */
export function isCuratedSource(row: { adapter?: unknown; config?: unknown } | null): boolean {
  const cfg = row?.config as { fetch?: { url?: unknown } } | null | undefined
  return row?.adapter === CURATED_ADAPTER && cfg?.fetch?.url === CURATED_FILE
}

export interface HostCandidate {
  id: string
  name: string
  city: string | null
  approved: boolean | null
}

/**
 * The POI a curator could link as host (BR-EVENTO-001): same city, similar name to the venue,
 * approved first. Same city because "Teatro Municipal de Santiago" and "Teatro Municipal de
 * Valparaíso" are similar names. Only a suggestion: item 3 keeps the link manual.
 */
export function suggestHost(e: CuratedEvent, pois: HostCandidate[]): HostCandidate | null {
  const venue = e.venue_name
  if (!venue) return null
  const similar = pois.filter(p => p.city === e.city && isSimilarName(venue, p.name))
  return [...similar].sort((a, b) => Number(!a.approved) - Number(!b.approved))[0] ?? null
}
