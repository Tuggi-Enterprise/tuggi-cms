// #1203 items 5 and 6: the pure parts of scripts/santiago-routes.ts and scripts/santiago-events.ts,
// on fixtures (no network, no database). The events part also runs the weekly import itself
// (runEventsImport) with a fake store, to prove the curated records go through it as intended.
import { before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  ROUTES_VISIBILITY, SANTIAGO_ROUTES, type EnrichedWaypoint, type PoiCandidate, type RouteStop,
  buildWaypoints, matchStop, planRoute,
} from '../../lib/osm-chile/routes'
import {
  type CuratedEvent, CURATED_FILE, cityCredit, curatedSourceConfig, dedupeBySourceUrl, effectiveStart, eventCredit,
  isCuratedSource, isPast, localDayOf, parseCuratedEvents, suggestHost, textToHtml, toRecord,
} from '../../lib/osm-chile/events'
import { normalizeState } from '../../lib/shared/location-normalize'

// ~1 m of latitude in degrees.
const M = 1 / 111_195
const STOP: RouteStop = { name: 'Museo Chileno de Arte Precolombino', lat: -33.43902, lng: -70.6522, altNames: ['Museo de Arte Precolombino'] }
const poi = (id: string, name: string, northM: number, approved = true): PoiCandidate =>
  ({ id, name, approved, lat: STOP.lat + northM * M, lng: STOP.lng })

describe('#1203 stop to POI', () => {
  it('links a POI with a similar name 150 m away', () => {
    assert.equal(matchStop(STOP, [poi('a', 'Museo de Arte Precolombino', 150)])?.id, 'a')
  })
  it('does not link the same name 260 m away (radius 200 m)', () => {
    assert.equal(matchStop(STOP, [poi('a', 'Museo de Arte Precolombino', 260)]), null)
  })
  it('does not link the nearest POI when its name is another (the Rio rule would)', () => {
    assert.equal(matchStop(STOP, [poi('b', 'Estatua de Pedro de Valdivia', 20)]), null)
  })
  it('of two similar names, links the nearest', () => {
    assert.equal(matchStop(STOP, [poi('far', 'Museo Precolombino', 180), poi('near', 'Museo Chileno de Arte Precolombino', 40)])?.id, 'near')
  })
  it('a stop with no POI stays generic with its own name; a linked one carries the POI id and name', () => {
    const w = buildWaypoints([STOP, { name: 'Bolsa', lat: -33.44, lng: -70.65 }], [poi('a', 'Museo de Arte Precolombino', 10), null], null, () => 'x')
    assert.deepEqual([w[0].metadata.attraction_id, w[0].metadata.is_generic, w[0].metadata.name], ['a', false, 'Museo de Arte Precolombino'])
    assert.deepEqual([w[1].metadata.attraction_id, w[1].metadata.is_generic, w[1].metadata.name], [null, true, 'Bolsa'])
  })
})

describe('#1203 route idempotency', () => {
  const stops = SANTIAGO_ROUTES[0].stops
  const noMatch = stops.map(() => null)

  // The script's three outcomes over an in-memory table: create, update the links, leave alone.
  function run(table: Array<{ id: string; waypoints: EnrichedWaypoint[] }>, matches: Array<PoiCandidate | null>, force = false) {
    const existing = table[0] ?? null
    const waypoints = buildWaypoints(stops, matches, existing?.waypoints ?? null)
    const plan = planRoute(existing, stops, waypoints, force)
    if (plan.action === 'create' || plan.action === 'recreate') table.splice(0, table.length, { id: `r${Math.random()}`, waypoints })
    if (plan.action === 'update_links') table[0].waypoints = waypoints
    return plan
  }

  it('the second run creates nothing and changes nothing', () => {
    const table: Array<{ id: string; waypoints: EnrichedWaypoint[] }> = []
    assert.equal(run(table, noMatch).action, 'create')
    const first = JSON.stringify(table)
    assert.equal(run(table, noMatch).action, 'unchanged')
    assert.equal(table.length, 1)
    assert.equal(JSON.stringify(table), first)
  })

  it('a run after the missing-POI script links the new POI in place, keeping the waypoint ids', () => {
    const table: Array<{ id: string; waypoints: EnrichedWaypoint[] }> = []
    run(table, noMatch)
    const ids = table[0].waypoints.map(w => w.id)
    const routeId = table[0].id
    const later = stops.map((s, i) => (i === 3 ? { id: 'new-poi', name: s.name, approved: false, lat: s.lat, lng: s.lng } : null))
    const plan = run(table, later)
    assert.deepEqual(plan, { action: 'update_links', routeId, changed: [3] })
    assert.equal(table.length, 1)
    assert.equal(table[0].waypoints[3].metadata.attraction_id, 'new-poi')
    assert.deepEqual(table[0].waypoints.map(w => w.id), ids)
  })

  it('a route whose stops were edited in the CMS is left alone; --force recreates', () => {
    const table: Array<{ id: string; waypoints: EnrichedWaypoint[] }> = []
    run(table, noMatch)
    table[0].waypoints = table[0].waypoints.slice(1)
    assert.equal(run(table, noMatch).action, 'edited_in_cms')
    assert.equal(run(table, noMatch, true).action, 'recreate')
    assert.equal(table[0].waypoints.length, stops.length)
  })
})

describe('#1203 the six routes', () => {
  it('BR-ROTA-003: they go public, so the discovery shows them', () => {
    assert.equal(ROUTES_VISIBILITY, 'public')
  })
  it('six routes with distinct keys; the walk one is the only walk', () => {
    assert.equal(SANTIAGO_ROUTES.length, 6)
    assert.equal(new Set(SANTIAGO_ROUTES.map(r => r.key)).size, 6)
    assert.deepEqual(SANTIAGO_ROUTES.filter(r => r.travelMode === 'walk').map(r => r.key), ['santiago-centro-historico-a-pe'])
  })
  it('BR-ROTA-001: no text says the guide adapts to the mode or the speed; no dash, no superlative', () => {
    for (const r of SANTIAGO_ROUTES) {
      const t = `${r.name} ${r.description}`
      assert.doesNotMatch(t, /ajust|adapt|calibr|velocidade|melhor|imperd|incr[ií]vel|[—–]/i, r.key)
    }
  })
  it('the región spelling is the CMS one', () => {
    assert.equal(normalizeState('Chile', 'Región Metropolitana de Santiago'), 'Región Metropolitana de Santiago')
    assert.equal(normalizeState('Chile', 'Región de Valparaíso'), 'Valparaíso')
  })
})

// 2026-11-11 12:00 in Santiago (-03:00 in November).
const NOW = Date.parse('2026-11-11T12:00:00-03:00')
const TODAY = Date.parse('2026-11-11T00:00:00-03:00')

const event = (over: Partial<CuratedEvent> = {}): CuratedEvent => ({
  title: 'Doña Rosita [anotada]',
  description: 'Primer párrafo de la fuente.\n\nSegundo párrafo, con <b> y & tal cual.',
  start: '2026-11-10T20:00:00-03:00',
  end: '2026-11-15T19:00:00-03:00',
  occurrences: [
    { start: '2026-11-10T20:00:00-03:00' },
    { start: '2026-11-12T20:00:00-03:00' },
    { start: '2026-11-13T20:00:00-03:00' },
  ],
  all_day: false,
  venue_name: 'Centro Cultural Gabriela Mistral (GAM)',
  venue_address: 'Av. Libertador Bernardo O\'Higgins 227, Santiago',
  city: 'Santiago',
  lat: null,
  lon: null,
  image_url: 'https://gam.cl/img/rosita.jpg',
  source_name: 'Centro Cultural Gabriela Mistral (GAM)',
  source_url: 'https://gam.cl/teatro/dona-rosita/',
  ...over,
})

const EXHIBIT = event({
  title: 'Pepo: antes y después de Condorito', all_day: true, occurrences: [],
  start: '2026-12-02T00:00:00-03:00', end: '2027-03-28T23:59:00-03:00', source_url: 'https://gam.cl/expo/pepo/',
})
const PAST = event({ title: 'Ya pasó', start: '2026-11-01T20:00:00-03:00', end: '2026-11-10T22:00:00-03:00', occurrences: [], source_url: 'https://gam.cl/x/' })

describe('#1203 curated events to import records', () => {
  it('a run of performances is stored from the first one still on (occurrences)', () => {
    assert.equal(effectiveStart(event(), TODAY), '2026-11-12T20:00:00-03:00')
    assert.equal(effectiveStart(event({ occurrences: [] }), TODAY), '2026-11-10T20:00:00-03:00')
  })
  it('a performance earlier today still counts as on', () => {
    assert.equal(effectiveStart(event({ occurrences: [{ start: '2026-11-11T10:00:00-03:00' }, { start: '2026-11-12T10:00:00-03:00' }] }), TODAY),
      '2026-11-11T10:00:00-03:00')
  })
  it('the day of an all-day event is the Santiago day, whatever the offset of the ISO', () => {
    assert.equal(localDayOf('2026-11-12T02:00:00Z'), '2026-11-11')
    assert.equal(localDayOf('2026-12-02T00:00:00-03:00'), '2026-12-02')
  })
  it('all-day goes as dates, timed keeps its offset', () => {
    const r = toRecord(EXHIBIT, TODAY)
    assert.deepEqual([r.starts_at, r.ends_at], ['2026-12-02', '2027-03-28'])
    const t = toRecord(event(), TODAY)
    assert.deepEqual([t.starts_at, t.ends_at], ['2026-11-12T20:00:00-03:00', '2026-11-15T19:00:00-03:00'])
  })
  it('an event over before today is past; one ending today is not', () => {
    assert.equal(isPast(PAST, TODAY), true)
    assert.equal(isPast(event({ end: '2026-11-11T09:00:00-03:00' }), TODAY), false)
  })
  it('one event per source_url, the first wins', () => {
    const { kept, duplicates } = dedupeBySourceUrl([event(), event({ title: 'copia' }), EXHIBIT])
    assert.deepEqual(kept.map(e => e.title), ['Doña Rosita [anotada]', EXHIBIT.title])
    assert.equal(duplicates.length, 1)
  })
  it('a malformed entry is refused by index, never guessed', () => {
    const { events, errors } = parseCuratedEvents([{ ...event(), start: 'mañana' }, { ...event(), source_url: 'ftp://x' }, event()])
    assert.equal(events.length, 1)
    assert.equal(errors.length, 2)
    assert.match(errors[0], /^#0: start/)
  })
  it('BR-EVENTO-009 item 3: credit "Informações: <órgão> (<domínio>)"; the city row lists its agendas, busiest first', () => {
    assert.equal(eventCredit(event()), 'Informações: Centro Cultural Gabriela Mistral (GAM) (gam.cl)')
    const mnba = event({ source_name: 'Museo Nacional de Bellas Artes', source_url: 'https://www.mnba.gob.cl/cartelera/x' })
    assert.equal(cityCredit([mnba, event(), event({ source_url: 'https://gam.cl/y' })]),
      'Informações: Centro Cultural Gabriela Mistral (GAM) (gam.cl); Museo Nacional de Bellas Artes (mnba.gob.cl)')
  })
  it('the source rows the script owns are told apart from a real weekly source', () => {
    assert.equal(isCuratedSource({ adapter: 'file', config: curatedSourceConfig('Santiago') }), true)
    assert.equal(isCuratedSource({ adapter: 'file', config: { fetch: { url: 'https://datos.example/agenda.json' } } }), false)
  })
})

describe('#1203 host suggestion (BR-EVENTO-001: proposed to the curator, never written)', () => {
  const gam = { id: 'gam', name: 'Centro Cultural Gabriela Mistral', city: 'Santiago', approved: true }
  it('suggests the POI with the venue name in the same city', () => {
    assert.equal(suggestHost(event(), [gam])?.id, 'gam')
  })
  it('a similar name in another city is not the host', () => {
    const tm = event({ venue_name: 'Teatro Municipal de Santiago' })
    assert.equal(suggestHost(tm, [{ id: 'v', name: 'Teatro Municipal de Valparaíso', city: 'Valparaíso', approved: true }]), null)
  })
  it('an approved POI comes before a not approved one', () => {
    assert.equal(suggestHost(event(), [{ ...gam, id: 'draft', approved: false }, gam])?.id, 'gam')
  })
})

describe('#1203 the curated records through the weekly import (BR-EVENTO-009)', () => {
  type Payload = Record<string, unknown>
  let htmlToText: (h: string) => string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let imp: any

  before(async () => {
    const base = resolve(import.meta.dirname, '../../supabase/functions/_shared')
    htmlToText = (await import(pathToFileURL(resolve(base, 'events-text.ts')).href)).htmlToText
    imp = await import(pathToFileURL(resolve(base, 'events-import.ts')).href)
  })

  it('item 3: the paragraphs of the source survive the HTML round trip of the import', () => {
    const src = event().description!
    assert.equal(htmlToText(textToHtml(src)!), src)
  })

  async function importOnce() {
    const records = [event(), event({ title: 'copia' }), EXHIBIT, PAST].map(e => toRecord(e, TODAY))
    const upserts: Array<{ externalId: string; payload: Payload }> = []
    const source = {
      id: '00000000-0000-0000-0000-000000001203', name: 'Curadoria #1203 (Santiago)', adapter: 'file', base_url: CURATED_FILE,
      timezone: 'America/Santiago', city: 'Santiago', state: 'Región Metropolitana de Santiago', country: 'Chile',
      credit: cityCredit([event()]), config: curatedSourceConfig('Santiago'),
    }
    const store = {
      activeSources: async () => [source],
      runningSources: async () => [],
      knownItems: async () => [],
      upsertEvent: async (_s: string, externalId: string, payload: Payload) => { upserts.push({ externalId, payload }); return { action: 'created' } },
      saveProgress: async () => {},
      finishSource: async () => {},
      uploadImage: async (p: string) => `https://cdn.test/travel-app-images/${p}`,
      storedImageUrl: async () => null,
    }
    const fetch = async (url: string) => {
      if (url === CURATED_FILE) return new Response(JSON.stringify(records), { status: 200 })
      if (url.startsWith('https://gam.cl/img/') || url.startsWith('https://gam.cl/')) {
        return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': '3' } })
      }
      return new Response('', { status: 404 })
    }
    const geocoding = {
      cached: async () => ({ lat: -33.4392, lon: -70.6397, queried_at: new Date(NOW).toISOString() }),
      save: async () => {}, takeQuota: async () => true, search: async () => null,
    }
    const reports = await imp.runEventsImport({ store, fetch, log: () => {}, now: () => NOW, geocoding }, { chain: 1, run_started_at: new Date(NOW).toISOString() })
    return { upserts, summary: reports[0].summary }
  }

  it('dedups by source_url, drops the past event, and writes the rest once', async () => {
    const { upserts, summary } = await importOnce()
    assert.deepEqual(upserts.map(u => u.externalId).sort(), ['https://gam.cl/expo/pepo/', 'https://gam.cl/teatro/dona-rosita/'])
    assert.equal(summary.skipped_reasons.duplicate, 1)
    assert.equal(summary.skipped_reasons.ended, 1)
    assert.equal(summary.errors.length, 0)
  })

  it('the payload: first performance still on, all-day in the Santiago day, source text, poster copied with the event credit, language es-es', async () => {
    const { upserts } = await importOnce()
    const rosita = upserts.find(u => u.externalId === 'https://gam.cl/teatro/dona-rosita/')!.payload
    assert.equal(rosita.starts_at, '2026-11-12T20:00:00-03:00')
    assert.equal(rosita.ends_at, '2026-11-15T19:00:00-03:00')
    assert.equal(rosita.all_day, false)
    assert.equal(rosita.description, event().description)
    assert.equal(rosita.image_credit, 'Informações: Centro Cultural Gabriela Mistral (GAM) (gam.cl)')
    assert.match(String(rosita.poster_url), /^https:\/\/cdn\.test\/travel-app-images\/events\//)
    assert.equal(rosita.language, 'es-es')
    assert.equal(rosita.source_url, 'https://gam.cl/teatro/dona-rosita/')
    assert.deepEqual([rosita.lat, rosita.lon], [-33.4392, -70.6397])
    assert.equal(rosita.event_category, 'theatre')
    const pepo = upserts.find(u => u.externalId === 'https://gam.cl/expo/pepo/')!.payload
    assert.deepEqual([pepo.starts_at, pepo.ends_at, pepo.all_day], ['2026-12-02T00:00:00-03:00', '2027-03-28T23:59:59-03:00', true])
    assert.equal(pepo.event_category, 'exhibition')
  })
})
