/**
 * santiago-events.ts (#1203, item 6). The curated events of Santiago, 11/11/2026 to 31/03/2027,
 * from the official agendas of the venues (GAM, Teatro Municipal, Centro Cultural La Moneda, MNBA...).
 *
 * The write is the weekly import's, not a second one (BR-EVENTO-009): each city gets a source row of
 * core.event_sources with the `file` adapter, inactive so the Monday run never reads it, and the
 * script calls `runEventsImport` of supabase/functions/_shared/events-import.ts with a store wired
 * here the way events-import/index.ts wires it. So the RPC core.import_event_upsert decides
 * create/update/link (item 6), the event goes on the air approved (item 1), the description is the
 * source text (item 3), the poster is copied to our bucket with its credit (item 5), and an event
 * without coordinates is geocoded through core.event_geocode_cache and the monthly quota (item 8).
 * Dedup key: source_url, the external id of the item. Events over before today are left out.
 *
 * Host POI (BR-EVENTO-001 item 3, and BR-EVENTO-009 "a importação não escolhe anfitrião"): the
 * script never links one. It lists, in the csv, the POI with the venue's name in the same city, for
 * the curator to link in the CMS (Anfitrião in the event form).
 *
 * Input: output/chile-1203/santiago-eventos.json (gitignored). Logs carry no personal data: the
 * list holds public agenda entries only.
 *
 * Usage (from tuggi-cms/):
 *   npx tsx --env-file=.env scripts/santiago-events.ts              # dry run (default)
 *   npx tsx --env-file=.env scripts/santiago-events.ts --apply      # writes
 */
import fs from 'node:fs'
import path from 'node:path'
import { createCoreDb, type CoreDb } from '../lib/osm-chile/catalogue'
import { writeCsv } from '../lib/osm-chile/osm-sources'
import { normalizeState } from '../lib/shared/location-normalize'
import {
  CURATED_ADAPTER, CURATED_FILE, CURATED_SOURCE_PREFIX, EVENTS_COUNTRY, EVENTS_TIMEZONE, type CuratedEvent, type HostCandidate,
  cityCredit, curatedSourceConfig, dedupeBySourceUrl, isCuratedSource, isPast, parseCuratedEvents, suggestHost, toRecord,
} from '../lib/osm-chile/events'
import {
  IMAGE_BUCKET, IMAGE_FETCH_TIMEOUT_MS, UPLOAD_TIMEOUT_MS, messageOf, nextLink, runEventsImport,
  type EventSource, type ImportStore, type KnownItem, type RunLink, type SourceReport,
} from '../supabase/functions/_shared/events-import.ts'
import { addressKey, startOfToday, type Geocoding } from '../supabase/functions/_shared/events-sources.ts'

const APPLY = process.argv.includes('--apply') && !process.argv.includes('--dry-run')

/** Raw OSM región of each comuna of the list; normalizeState gives the CMS spelling. A city outside it is refused. */
const CITY_REGION_RAW: Record<string, string> = {
  Santiago: 'Región Metropolitana de Santiago',
  Providencia: 'Región Metropolitana de Santiago',
  Vitacura: 'Región Metropolitana de Santiago',
  'La Florida': 'Región Metropolitana de Santiago',
  Huechuraba: 'Región Metropolitana de Santiago',
  'Las Condes': 'Región Metropolitana de Santiago',
  Independencia: 'Región Metropolitana de Santiago',
  Valparaíso: 'Región de Valparaíso',
  'Viña del Mar': 'Región de Valparaíso',
}

// The same three constants as events-import/index.ts: the Places key the CMS already uses, the endpoint, the timeout.
const PLACES_KEY_ENV = 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY'
const PLACES_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText'
const GEOCODE_TIMEOUT_MS = 10_000
const PAGE = 1000
const SOURCE_COLUMNS = 'id, name, adapter, base_url, timezone, city, state, country, credit, config, is_active'

interface SourceRow extends EventSource { is_active: boolean }

function env(name: string): string {
  return (process.env[name] ?? '').trim()
}

function readCurated(): CuratedEvent[] {
  const file = path.resolve(process.cwd(), CURATED_FILE)
  if (!fs.existsSync(file)) throw new Error(`${CURATED_FILE} not found: copy santiago-eventos.json there first`)
  const { events, errors } = parseCuratedEvents(JSON.parse(fs.readFileSync(file, 'utf8')))
  if (errors.length) {
    errors.forEach(e => console.error(`  invalid entry ${e}`))
    throw new Error(`${errors.length} invalid entries in ${CURATED_FILE}; fix the file, nothing was written`)
  }
  return events
}

async function chileSources(db: CoreDb, cities: string[]): Promise<SourceRow[]> {
  const { data, error } = await db.from('event_sources').select(SOURCE_COLUMNS).eq('country', EVENTS_COUNTRY).in('city', cities)
  if (error) throw new Error(`event_sources: ${error.code ?? ''} ${error.message}`)
  return (data ?? []) as SourceRow[]
}

async function knownItems(db: CoreDb, sourceId: string): Promise<Array<KnownItem & { attraction_id: string | null }>> {
  const out: Array<KnownItem & { attraction_id: string | null }> = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from('event_source_items')
      .select('external_id, source_hash, last_seen_at, attraction_id, attractions(image_url)')
      .eq('source_id', sourceId).order('external_id').range(from, from + PAGE - 1)
    if (error) throw new Error(`event_source_items: ${error.code ?? ''} ${error.message}`)
    const rows = (data ?? []) as Array<Record<string, unknown>>
    for (const r of rows) {
      const a = Array.isArray(r.attractions) ? r.attractions[0] : r.attractions
      out.push({
        external_id: r.external_id as string,
        source_hash: r.source_hash as string,
        last_seen_at: r.last_seen_at as string,
        attraction_id: (r.attraction_id as string | null) ?? null,
        poster_url: ((a as { image_url?: string | null } | null)?.image_url) ?? null,
      })
    }
    if (rows.length < PAGE) return out
  }
}

async function cachedAddresses(db: CoreDb, keys: string[]): Promise<Map<string, { lat: number | null; queried_at: string }>> {
  const out = new Map<string, { lat: number | null; queried_at: string }>()
  for (let i = 0; i < keys.length; i += 100) {
    const { data, error } = await db.from('event_geocode_cache').select('address_key, lat, queried_at').in('address_key', keys.slice(i, i + 100))
    if (error) throw new Error(`event_geocode_cache: ${error.code ?? ''} ${error.message}`)
    for (const r of (data ?? []) as Array<{ address_key: string; lat: number | null; queried_at: string }>) out.set(r.address_key, r)
  }
  return out
}

/** POIs of the cities, for the host suggestion. Keyset on id. */
async function poisOfCities(db: CoreDb, cities: string[]): Promise<HostCandidate[]> {
  const out: HostCandidate[] = []
  let last = '00000000-0000-0000-0000-000000000000'
  for (;;) {
    const { data, error } = await db.from('attractions').select('id, name, city, approved')
      .eq('entity_kind', 'poi').eq('country', EVENTS_COUNTRY).in('city', cities)
      .gt('id', last).order('id').limit(PAGE)
    if (error) throw new Error(`attractions: ${error.code ?? ''} ${error.message}`)
    const rows = (data ?? []) as HostCandidate[]
    out.push(...rows)
    if (rows.length < PAGE) return out
    last = rows[rows.length - 1].id
  }
}

/** The store of events-import/index.ts, on supabase-js under Node, limited to the curated rows. */
function curatedStore(db: CoreDb, sources: () => EventSource[]): ImportStore {
  const url = env('NEXT_PUBLIC_SUPABASE_URL') || env('SUPABASE_URL')
  const key = env('SUPABASE_SECRET_KEY') || env('SUPABASE_SERVICE_ROLE_KEY')
  const publicUrl = (p: string) => db.storage.from(IMAGE_BUCKET).getPublicUrl(p).data.publicUrl
  return {
    async activeSources() { return sources() },
    // The sweep of stalled runs belongs to the Monday run; this script closes only its own rows.
    async runningSources() { return [] },
    async knownItems(sourceId) { return knownItems(db, sourceId) },
    async upsertEvent(sourceId, externalId, payload) {
      const { data, error } = await db.rpc('import_event_upsert', { p_source_id: sourceId, p_external_id: externalId, p_payload: payload })
      if (error) throw new Error(`rpc ${error.code ?? 'unknown'}: ${error.message ?? ''}`)
      return data
    },
    async saveProgress(sourceId, summary) {
      const { error } = await db.from('event_sources').update({ last_run_status: 'running', last_run_summary: summary }).eq('id', sourceId)
      if (error) throw new Error(`event_sources progress: ${error.code ?? 'unknown'}`)
    },
    async finishSource(sourceId, status, summary) {
      const { error } = await db.from('event_sources')
        .update({ last_run_at: new Date().toISOString(), last_run_status: status, last_run_summary: summary }).eq('id', sourceId)
      if (error) throw new Error(`event_sources update: ${error.code ?? 'unknown'}`)
    },
    async uploadImage(p, bytes, contentType) {
      const res = await fetch(`${url}/storage/v1/object/${IMAGE_BUCKET}/${p}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': contentType, 'x-upsert': 'true' },
        body: bytes,
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      })
      await res.body?.cancel()
      if (!res.ok) throw new Error(`upload: http_${res.status}`)
      return publicUrl(p)
    },
    async storedImageUrl(p, size) {
      const u = publicUrl(p)
      const res = await fetch(u, { method: 'HEAD', signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS) })
      await res.body?.cancel()
      return res.ok && Number(res.headers.get('content-length')) === size ? u : null
    },
  }
}

/** The geocoding of events-import/index.ts: cache, monthly quota, Places searchText. */
function geocoding(db: CoreDb): Geocoding | undefined {
  const placesKey = env(PLACES_KEY_ENV)
  if (!placesKey) return undefined
  return {
    async cached(k) {
      const { data, error } = await db.from('event_geocode_cache').select('lat, lon, queried_at').eq('address_key', k).maybeSingle()
      if (error) throw new Error(`event_geocode_cache: ${error.code ?? 'unknown'}`)
      return (data ?? null) as { lat: number | null; lon: number | null; queried_at: string } | null
    },
    async save(k, lat, lon) {
      const { error } = await db.from('event_geocode_cache')
        .upsert({ address_key: k, lat, lon, queried_at: new Date().toISOString() }, { onConflict: 'address_key' })
      if (error) throw new Error(`event_geocode_cache write: ${error.code ?? 'unknown'}`)
    },
    async takeQuota() {
      const { data, error } = await db.rpc('event_geocode_take_quota')
      if (error) throw new Error(`event_geocode_take_quota: ${error.code ?? 'unknown'}`)
      return data === true
    },
    async search(t) {
      const res = await fetch(PLACES_SEARCH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': placesKey, 'X-Goog-FieldMask': 'places.location' },
        body: JSON.stringify({ textQuery: t.slice(0, 300), pageSize: 1 }),
        signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS),
      })
      if (!res.ok) {
        await res.body?.cancel()
        throw new Error(`places: http_${res.status}`)
      }
      const body = await res.json() as { places?: { location?: { latitude?: number; longitude?: number } }[] }
      const loc = body.places?.[0]?.location
      return typeof loc?.latitude === 'number' && typeof loc?.longitude === 'number' ? { lat: loc.latitude, lon: loc.longitude } : null
    },
  }
}

async function main() {
  const db = createCoreDb()
  const nowMs = Date.now()
  const todayStart = startOfToday(EVENTS_TIMEZONE, nowMs)

  const all = readCurated()
  const { kept, duplicates } = dedupeBySourceUrl(all)
  const past = kept.filter(e => isPast(e, todayStart))
  const unknownCity = kept.filter(e => !isPast(e, todayStart) && !CITY_REGION_RAW[e.city])
  const events = kept.filter(e => !isPast(e, todayStart) && CITY_REGION_RAW[e.city])
  console.log(`\n${APPLY ? '[APPLY]' : '[DRY RUN]'} ${all.length} entries in ${CURATED_FILE}`)
  console.log(`  duplicate source_url: ${duplicates.length}${duplicates.map(d => `\n    ${d.source_url}`).join('')}`)
  console.log(`  over before today (left out): ${past.length}${past.map(e => `\n    ${e.title} (${e.end ?? e.start})`).join('')}`)
  console.log(`  city outside the list (left out): ${unknownCity.length}${unknownCity.map(e => `\n    ${e.title} (${e.city})`).join('')}`)

  const byCity = new Map<string, CuratedEvent[]>()
  for (const e of events) byCity.set(e.city, [...(byCity.get(e.city) ?? []), e])
  const cities = [...byCity.keys()]
  const existing = await chileSources(db, cities)

  // One source row per city (event_sources_country_city_key). Ours: reuse. Someone else's: the city stays out (BR-EVENTO-009 item 7).
  const plans = cities.map(city => {
    const row = existing.find(r => r.city === city) ?? null
    const wanted = {
      name: `${CURATED_SOURCE_PREFIX} (${city})`,
      adapter: CURATED_ADAPTER,
      base_url: CURATED_FILE,
      city,
      state: normalizeState(EVENTS_COUNTRY, CITY_REGION_RAW[city]),
      country: EVENTS_COUNTRY,
      timezone: EVENTS_TIMEZONE,
      is_active: false,
      credit: cityCredit(byCity.get(city)!),
      config: curatedSourceConfig(city),
    }
    const action: 'create' | 'reuse' | 'foreign' = !row ? 'create' : isCuratedSource(row) ? 'reuse' : 'foreign'
    return { city, row, wanted, action }
  })
  console.log('\nSource rows (inactive: the Monday run never reads them):')
  for (const p of plans) console.log(`  ${p.city}: ${p.action}${p.action === 'foreign' ? ` (held by "${p.row!.name}", its events stay out)` : ''} | ${p.wanted.state} | ${p.wanted.credit}`)

  const known = new Map<string, { attraction_id: string | null }>()
  for (const p of plans) if (p.row && p.action === 'reuse') for (const k of await knownItems(db, p.row.id)) known.set(k.external_id, k)
  const goes = events.filter(e => plans.find(p => p.city === e.city)!.action !== 'foreign')

  const records = goes.map(e => toRecord(e, todayStart))
  const needGeo = records.filter(r => r.lat === null && !known.has(r.external_id))
  const cache = await cachedAddresses(db, needGeo.filter(r => r.address).map(r => addressKey(r.address!, r.city, EVENTS_COUNTRY)))
  const pois = await poisOfCities(db, cities)

  const rows = goes.map((e, i) => {
    const r = records[i]
    const k = known.get(r.external_id)
    const state = !k ? 'new' : k.attraction_id ? 'known' : 'deleted by curation (not recreated)'
    const geoKey = r.address ? addressKey(r.address, r.city, EVENTS_COUNTRY) : null
    const geo = r.lat !== null ? 'source' : k ? 'stored' : !geoKey ? 'no address' : cache.get(geoKey)?.lat != null ? 'cache' : 'Places query'
    const host = suggestHost(e, pois)
    return { e, r, state, geo, host }
  })
  console.log(`\nEvents that go to the import: ${rows.length}`)
  for (const x of rows) {
    console.log(`  ${x.r.starts_at.slice(0, 16)} | ${x.e.city} | ${x.e.title.slice(0, 50)} | ${x.state} | geo: ${x.geo}${x.host ? ` | host to link: ${x.host.name}${x.host.approved ? '' : ' (not approved)'}` : ''}`)
  }
  const hosts = rows.filter(x => x.host)
  const csv = writeCsv('events-plan.csv',
    ['source_url', 'title', 'city', 'starts_at', 'ends_at', 'state', 'geocoding', 'host_poi_id', 'host_poi_name', 'host_approved'],
    rows.map(x => [x.e.source_url, x.e.title, x.e.city, x.r.starts_at, x.r.ends_at, x.state, x.geo, x.host?.id, x.host?.name, x.host?.approved]))
  console.log(`\n  host suggestions for the curator (BR-EVENTO-001, link in the CMS): ${hosts.length}; csv: ${csv}`)
  const geo = geocoding(db)
  if (!geo) console.log(`  warning: ${PLACES_KEY_ENV} missing in .env; events without coordinates will be skipped as geocode_off`)

  if (!APPLY) { console.log('\nDry run: nothing written. Add --apply to write.\n'); return }

  // 1. Source rows.
  const owned: string[] = []
  for (const p of plans) {
    if (p.action === 'foreign') continue
    if (p.action === 'create') {
      const { data, error } = await db.from('event_sources').insert(p.wanted).select('id').single()
      if (error) throw new Error(`event_sources insert ${p.city}: ${error.code ?? ''} ${error.message}`)
      owned.push((data as { id: string }).id)
    } else {
      const { error } = await db.from('event_sources')
        .update({ name: p.wanted.name, state: p.wanted.state, credit: p.wanted.credit, config: p.wanted.config, is_active: false })
        .eq('id', p.row!.id)
      if (error) throw new Error(`event_sources update ${p.city}: ${error.code ?? ''} ${error.message}`)
      owned.push(p.row!.id)
    }
  }
  const { data: srcData, error: srcError } = await db.from('event_sources').select(SOURCE_COLUMNS).in('id', owned)
  if (srcError) throw new Error(`event_sources re-read: ${srcError.message}`)
  const sources = (srcData ?? []) as SourceRow[]
  if (sources.length !== owned.length || sources.some(s => !isCuratedSource(s) || s.is_active)) {
    throw new Error('the source rows did not land as written; nothing imported')
  }

  // 2. The import, link after link until nothing is pending (each link has the 100 s budget of the function).
  const body = JSON.stringify(records)
  const deps = {
    store: curatedStore(db, () => sources),
    fetch: (u: string, init?: RequestInit) =>
      u === CURATED_FILE ? Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })) : fetch(u, init),
    log: (l: string) => console.log(l),
    geocoding: geo,
    geocodingOff: geo ? undefined : `${PLACES_KEY_ENV} missing in .env`,
  }
  let link: RunLink | null = { chain: 1, run_started_at: new Date().toISOString() }
  const reports: SourceReport[] = []
  while (link) {
    const got = await runEventsImport(deps, link)
    reports.push(...got)
    link = nextLink(got, link)
  }

  // 3. Re-read: the item rows are the proof, not the summaries.
  const totals = { created: 0, updated: 0, unchanged: 0, linked: 0, skipped_deleted: 0, skipped: 0 }
  const reasons: Record<string, number> = {}
  const errors: string[] = []
  for (const r of reports) {
    for (const k of Object.keys(totals) as Array<keyof typeof totals>) totals[k] += r.summary[k]
    for (const [k, v] of Object.entries(r.summary.skipped_reasons)) reasons[k] = (reasons[k] ?? 0) + v
    r.summary.errors.forEach(e => errors.push(`${r.name}: ${e.external_id ?? '-'} ${e.message}`))
  }
  let stored = 0
  const wanted = new Set(records.map(r => r.external_id))
  for (const s of sources) stored += (await knownItems(db, s.id)).filter(k => k.attraction_id && wanted.has(k.external_id)).length
  console.log(`\nImport: ${JSON.stringify(totals)} skipped by reason ${JSON.stringify(reasons)}`)
  console.log(`Re-read: ${stored}/${records.length} events of the list exist in core.event_source_items with an attraction.`)
  if (errors.length) {
    console.error(`${errors.length} errors:`)
    errors.slice(0, 30).forEach(e => console.error(`  ${e}`))
    process.exit(1)
  }
}

main().then(() => process.exit(0)).catch(e => { console.error('FATAL', messageOf(e)); process.exit(1) })
