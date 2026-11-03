/**
 * #1077: the four generic readers of the events import (`_shared/events-sources.ts`) and the generic
 * run of `_shared/events-import.ts`, BR-EVENTO-009.
 *
 * Every reader runs against answers recorded with curl on 2026-11-02 (`fixtures/events-import/`):
 * Paris (opendatasoft), Lyon (OpenAgenda on opendatasoft), Barcelona (ckan datastore), Montréal (ckan
 * GeoJSON), Madrid (file, JSON), Québec (file, CSV), Amsterdam and Wien (jsonld). The fixtures are
 * the real answers cut to a few records; the Amsterdam page keeps only its JSON-LD scripts. The source
 * rows are the seed of migration 20261103120000 (`sources-20261103120000.json`), so a config the
 * readers cannot follow fails here.
 *
 * Run: deno test --allow-env --allow-read --import-map=supabase/functions/_tests/import_map.json \
 *   supabase/functions/_tests/events-readers.test.ts
 */
import { assert, assertEquals } from './assert.ts';
import {
  BROWSER_USER_AGENT,
  type EventPayload,
  type EventSource,
  IMAGE_BUCKET,
  type ImportDeps,
  importSource,
  type ImportStore,
  type KnownItem,
  nextLink,
  readLink,
  runEventsImport,
  type RunLink,
  type RunStatus,
  type RunSummary,
  SPTUR_CREDIT_LINE,
} from '../_shared/events-import.ts';
import {
  addressKey,
  cacheVerdict,
  type GeocodeCacheRow,
  type Geocoding,
  mapCategoryByRules,
  parseCsv,
  parseWhen,
} from '../_shared/events-sources.ts';

const FIXTURES = new URL('./fixtures/events-import/', import.meta.url);
const text = (name: string) => Deno.readTextFileSync(new URL(name, FIXTURES));
const json = (name: string) => JSON.parse(text(name));

/** 2026-11-02 22:00 UTC, the day the fixtures were recorded. */
const NOW = Date.parse('2026-11-02T22:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const SEED = json('sources-20261103120000.json') as Omit<EventSource, 'id'>[];
const source = (city: string, id: string): EventSource => {
  const row = SEED.find((s) => s.city === city);
  if (!row) throw new Error(`no seed row for ${city}`);
  return { id, ...row };
};

const PARIS = source('Paris', '1d000000-0000-4000-8000-000000000001');
const LYON = source('Lyon', '1d000000-0000-4000-8000-000000000002');
const BARCELONA = source('Barcelona', '1d000000-0000-4000-8000-000000000003');
const MONTREAL = source('Montréal', '1d000000-0000-4000-8000-000000000004');
const MADRID = source('Madrid', '1d000000-0000-4000-8000-000000000005');
const QUEBEC = source('Québec', '1d000000-0000-4000-8000-000000000006');
const AMSTERDAM = source('Amsterdam', '1d000000-0000-4000-8000-000000000007');
const WIEN = source('Wien', '1d000000-0000-4000-8000-000000000008');
/** #1083: the Montréal row read through `datastore_search`, the config the data applies (`sources-1083.json`). */
const MONTREAL_DATASTORE: EventSource = {
  id: '1d000000-0000-4000-8000-000000000014',
  ...(json('sources-1083.json') as Omit<EventSource, 'id'>[])[0],
};

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

class Store implements ImportStore {
  sources: EventSource[] = [];
  events = new Map<string, EventPayload>();
  items = new Map<string, KnownItem>();
  calls: { sourceId: string; externalId: string; payload: EventPayload }[] = [];
  finished: { sourceId: string; status: RunStatus; summary: RunSummary }[] = [];
  clock = () => NOW;
  activeSources() {
    return Promise.resolve(this.sources);
  }
  knownItems() {
    return Promise.resolve(
      [...this.items.values()].map((k) => ({ ...k, poster_url: this.events.get(k.external_id)?.poster_url ?? null })),
    );
  }
  upsertEvent(sourceId: string, externalId: string, payload: EventPayload) {
    this.calls.push({ sourceId, externalId, payload });
    const before = this.events.get(externalId);
    const action = !before ? 'created' : before.source_hash === payload.source_hash ? 'unchanged' : 'updated';
    if (action !== 'unchanged') this.events.set(externalId, payload);
    this.items.set(externalId, {
      external_id: externalId,
      source_hash: payload.source_hash,
      last_seen_at: new Date(this.clock()).toISOString(),
      poster_url: null,
    });
    return Promise.resolve({ action });
  }
  saveProgress() {
    return Promise.resolve();
  }
  finishSource(sourceId: string, status: RunStatus, summary: RunSummary) {
    this.finished.push({ sourceId, status, summary });
    return Promise.resolve();
  }
  uploadImage(path: string) {
    return Promise.resolve(`http://supabase.test/storage/v1/object/public/${IMAGE_BUCKET}/${path}`);
  }
  storedImageUrl() {
    return Promise.resolve(null);
  }
}

interface Net {
  urls: string[];
  userAgents: string[];
  /** ODS and CKAN page size the fake server really answers. */
  pageSize: number;
}

const page = <T>(list: T[], offset: number, size: number) => list.slice(offset, offset + size);

/** The recorded sources, served by URL. Anything not recorded is a 404. */
function sources(net: Net) {
  const paris = json('ods-paris.json').results as unknown[];
  const lyon = json('ods-lyon.json').results as unknown[];
  const bcn = json('ckan-barcelona.json').result.records as unknown[];
  const mtl = json('ckan-montreal-datastore.json').result.records as unknown[];
  return (url: string, init?: RequestInit): Promise<Response> => {
    net.urls.push(url);
    net.userAgents.push(new Headers(init?.headers).get('user-agent') ?? '');
    const u = new URL(url);
    const offset = Number(u.searchParams.get('offset') ?? 0);
    if (u.host === 'opendata.paris.fr') {
      return Promise.resolve(Response.json({ total_count: paris.length, results: page(paris, offset, net.pageSize) }));
    }
    if (u.host === 'public.opendatasoft.com') {
      return Promise.resolve(Response.json({ total_count: lyon.length, results: page(lyon, offset, net.pageSize) }));
    }
    if (u.host === 'opendata-ajuntament.barcelona.cat') {
      return Promise.resolve(
        Response.json({ success: true, result: { total: bcn.length, records: page(bcn, offset, net.pageSize) } }),
      );
    }
    if (u.host === 'donnees.montreal.ca' && u.pathname === '/api/3/action/datastore_search') {
      return Promise.resolve(
        Response.json({ success: true, result: { total: mtl.length, records: page(mtl, offset, net.pageSize) } }),
      );
    }
    if (u.host === 'donnees.montreal.ca') return Promise.resolve(new Response(text('ckan-montreal.geojson')));
    if (u.host === 'datos.madrid.es') return Promise.resolve(new Response(text('file-madrid.json')));
    if (u.host === 'www.donneesquebec.ca') return Promise.resolve(new Response(text('file-quebec.csv')));
    if (url === 'https://www.iamsterdam.com/sitemap/events.xml') {
      return Promise.resolve(new Response(text('jsonld-amsterdam-sitemap.xml')));
    }
    if (url === 'https://www.iamsterdam.com/en/whats-on/calendar/theatre-and-stage/stage/midterm-madness') {
      return Promise.resolve(new Response(text('jsonld-amsterdam-midterm-madness.html')));
    }
    if (url === 'https://www.wien.gv.at/sitemaps/events.xml') {
      return Promise.resolve(
        new Response(
          '<urlset><url><loc>https://www.wien.gv.at/veranstaltungen/liesinger-weihnachtskunstmarkt</loc></url>' +
            '<url><loc>https://www.wien.gv.at/veranstaltungen/liesinger-weihnachtskunstmarkt.json</loc></url></urlset>',
        ),
      );
    }
    if (url === 'https://www.wien.gv.at/veranstaltungen/liesinger-weihnachtskunstmarkt') {
      return Promise.resolve(new Response(text('jsonld-wien-liesinger-weihnachtskunstmarkt.html')));
    }
    if (/\.(jpe?g|webp|png)$/i.test(u.pathname)) {
      return Promise.resolve(new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } }));
    }
    return Promise.resolve(new Response('not found', { status: 404 }));
  };
}

/** The cache, the quota and the Places API in memory. */
class Geo implements Geocoding {
  rows = new Map<string, GeocodeCacheRow>();
  quota = 3;
  searches: string[] = [];
  answer: { lat: number; lon: number } | null = { lat: 52.3769, lon: 4.9219 };
  cached(key: string) {
    return Promise.resolve(this.rows.get(key) ?? null);
  }
  save(key: string, lat: number | null, lon: number | null) {
    this.rows.set(key, { lat, lon, queried_at: new Date(NOW).toISOString() });
    return Promise.resolve();
  }
  takeQuota() {
    if (this.quota <= 0) return Promise.resolve(false);
    this.quota -= 1;
    return Promise.resolve(true);
  }
  search(q: string) {
    this.searches.push(q);
    return Promise.resolve(this.answer);
  }
}

function setup(geo?: Geo) {
  const store = new Store();
  const net: Net = { urls: [], userAgents: [], pageSize: 2 };
  const deps: ImportDeps = { store, fetch: sources(net), log: () => {}, now: () => NOW, geocoding: geo };
  return { store, net, deps };
}

const link = (): RunLink => ({ chain: 1, run_started_at: new Date(NOW - 1000).toISOString() });
const byName = (store: Store, prefix: string) => store.calls.find((c) => c.payload.name.startsWith(prefix))?.payload;

// ---------------------------------------------------------------------------------------------

Deno.test('#1077 BR-EVENTO-009 item 3: opendatasoft (Paris) pages to its total, text as is, credit line last, French', async () => {
  const { store, net, deps } = setup();
  const run = await importSource(deps, PARIS, link());
  assertEquals([run.status, run.summary.read, run.summary.created], ['ok', 3, 3]);
  // Pages of 2 for 3 records: the walk goes by offset to the total.
  const pages = net.urls.filter((u) => u.includes('/records?'));
  assertEquals(pages.length, 2);
  const first = new URL(pages[0]);
  assertEquals(first.pathname, '/api/explore/v2.1/catalog/datasets/que-faire-a-paris-/records');
  assertEquals(first.searchParams.get('where'), 'date_end >= now() and date_start is not null');
  assertEquals(new URL(pages[1]).searchParams.get('offset'), '2');

  const banksy = byName(store, "L'exposition permanente du musée Banksy")!;
  assertEquals(banksy.language, 'fr-fr');
  assertEquals(banksy.is_free, false);
  assertEquals(banksy.event_category, 'exhibition');
  assertEquals([banksy.lat, banksy.lon], [48.8746500149717, 2.34165597816076]);
  assertEquals(banksy.starts_at, '2019-06-01T00:00:00+00:00');
  assertEquals(banksy.address, 'Musée Banksy, 44 rue du Faubourg Montmartre, 75009, Paris');
  assertEquals(
    banksy.source_url,
    'https://www.paris.fr/evenements/l-exposition-permanente-du-musee-banksy-sur-le-plus-mysterieux-des-graffeurs-51551',
  );
  // BR-EVENTO-009 item 3: HTML to text, no tag left, and since #1082 no credit line in the text.
  assert(!/<[a-z]/i.test(banksy.description), 'no HTML left');
  assert(banksy.description.startsWith('Ouvert depuis juin 2019'), banksy.description.slice(0, 40));
  assert(!banksy.description.includes('Informações:'), `credit line in the text: ${banksy.description.slice(-60)}`);
  // BR-EVENTO-009 item 5: the cover copied to our bucket, with the credit the source gives.
  assert(
    banksy.poster_url!.startsWith(
      `http://supabase.test/storage/v1/object/public/${IMAGE_BUCKET}/events/${PARIS.id}/51551/`,
    ),
  );
  assertEquals(banksy.image_credit, 'Mairie de Paris');
  assert(banksy.source_hash.endsWith('|img'));
});

Deno.test('#1077 BR-EVENTO-009 item 5: OpenAgenda (Lyon) without a credit takes the source line; without image, no poster', async () => {
  const { store, deps } = setup();
  const lyon = json('ods-lyon.json').results as Record<string, unknown>[];
  const noCredit = lyon.find((r) => r.image && !r.imagecredits)!;
  const run = await importSource(deps, LYON, link());
  assertEquals(run.summary.created, 3);
  const ev = store.calls.find((c) => c.externalId === String(noCredit.uid))!.payload;
  assertEquals(ev.image_credit, 'Informações: OpenAgenda (openagenda.com)');

  // The same records with the image gone: the event still goes, with no poster.
  const { store: s2, deps: d2 } = setup();
  d2.fetch = (url, init) =>
    /img\.openagenda/.test(url) ? Promise.resolve(new Response('', { status: 404 })) : deps.fetch(url, init);
  const run2 = await importSource(d2, LYON, link());
  assertEquals(run2.summary.created, 3);
  assert(s2.calls.every((c) => c.payload.poster_url === null && c.payload.image_credit === null));
  assert(s2.calls.every((c) => c.payload.source_hash.endsWith('|noimg')));
});

Deno.test('#1077 BR-EVENTO-009: ckan datastore (Barcelona), BOM out of the id, local time with the Madrid offset', async () => {
  const { store, net, deps } = setup();
  const run = await importSource(deps, BARCELONA, link());
  assertEquals(run.summary.read, 3);
  assert(net.urls[0].includes('resource_id=877ccf66-9106-4ae2-be51-95a9f6469e4c'), net.urls[0]);
  assert(net.urls[0].includes('sort=modified+desc'), net.urls[0]);
  const talk = store.calls.find((c) => c.payload.name === "Xerrada 'Primers auxilis per a gent gran'")!;
  assertEquals(talk.externalId, '99400789830');
  assertEquals(talk.payload.starts_at, '2026-11-26T12:00:00+01:00');
  assertEquals(talk.payload.language, 'ca-es');
  assertEquals(talk.payload.source_url, 'https://guia.barcelona.cat/ca/detall/-/99400789830');
  assertEquals([talk.payload.lat, talk.payload.lon], [41.41236403095899, 2.1457730218797497]);
  // No description at the source: no description (#1082), the credit is not a text of its own.
  assertEquals(talk.payload.description, '');
});

Deno.test('#1077 BR-EVENTO-009 item 7: ckan GeoJSON (Montréal) drops the council and the ended; free from cout', async () => {
  const { store, deps } = setup();
  const run = await importSource(deps, MONTREAL, link());
  assertEquals(run.summary.read, 4);
  assertEquals(run.summary.skipped_reasons, { ended: 1, filtered: 1 });
  assertEquals(run.summary.created, 2);
  const expo = byName(store, 'Dans l’œil du lièvre')!;
  assertEquals([expo.is_free, expo.all_day, expo.event_category], [true, true, 'exhibition']);
  assertEquals([expo.starts_at, expo.ends_at], ['2025-06-25T00:00:00-04:00', '2027-06-25T23:59:59-04:00']);
  // "nan" is how the portal writes an empty cell: no address made of it.
  assertEquals(expo.address, null);
  assertEquals(byName(store, 'Spectacle en rodage')!.is_free, false);
});

Deno.test('#1083 BR-EVENTO-009 item 7: ckan datastore (Montréal) reads the same events the GeoJSON download gave', async () => {
  const { store, net, deps } = setup();
  net.pageSize = 3;
  const run = await importSource(deps, MONTREAL_DATASTORE, link());
  // Two pages of the API, not the /download/ path the production run was refused on.
  assert(net.urls.every((u) => u.startsWith('https://donnees.montreal.ca/api/3/action/datastore_search?')));
  assertEquals(net.urls.filter((u) => u.includes('datastore_search')).length, 2);
  assert(net.urls[0].includes('resource_id=6decf611-6f11-4f34-bb36-324d804c9bad') && net.urls[0].includes('sort=_id'));
  assertEquals(run.summary.read, 4);
  assertEquals(run.summary.skipped_reasons, { ended: 1, filtered: 1 });
  assertEquals(run.summary.created, 2);
  const expo = byName(store, 'Dans l’œil du lièvre')!;
  assertEquals([expo.is_free, expo.all_day, expo.event_category], [true, true, 'exhibition']);
  assertEquals([expo.starts_at, expo.ends_at], ['2025-06-25T00:00:00-04:00', '2027-06-25T23:59:59-04:00']);
  // The datastore writes the coordinate as text; it is the same point.
  assertEquals([expo.lat, expo.lon], [45.553583493785, -73.539622314344]);
  assertEquals(expo.address, null);
  assertEquals(byName(store, 'Spectacle en rodage')!.is_free, false);
});

Deno.test('#1083: a refused download says which host refused, the portal or the bucket it redirects to', async () => {
  const { deps } = setup();
  deps.fetch = () => {
    const res = new Response('Forbidden', { status: 403 });
    Object.defineProperty(res, 'url', { value: 'https://montreal-prod.storage.googleapis.com/resources/x.geojson' });
    return Promise.resolve(res);
  };
  const run = await importSource(deps, MONTREAL, link());
  assertEquals(run.status, 'error');
  assertEquals(run.summary.errors[0].message, 'list: http_403 montreal-prod.storage.googleapis.com');
  deps.fetch = () => Promise.resolve(new Response('Forbidden', { status: 403 }));
  const direct = await importSource(deps, MONTREAL, link());
  assertEquals(direct.summary.errors[0].message, 'list: http_403 donnees.montreal.ca');
});

Deno.test('#1077 BR-EVENTO-009 item 8: file JSON (Madrid), free from 1/0; no coordinate and no address stays out', async () => {
  const geo = new Geo();
  const { store, deps } = setup(geo);
  const run = await importSource(deps, MADRID, link());
  assertEquals([run.summary.read, run.summary.created, run.summary.skipped_reasons], [4, 3, { geocode_no_address: 1 }]);
  const museo = byName(store, '25 años del Museo de San Isidro')!;
  assertEquals([museo.is_free, museo.language, museo.all_day], [true, 'es-es', false]);
  assertEquals(museo.ends_at, '2027-01-31T23:59:00+01:00');
  assertEquals(byName(store, '1927. Lorca')!.is_free, false);
  assert(!byName(store, 'Actividades mensuales'), 'the event with neither coordinate nor address did not go');
  assertEquals(geo.searches.length, 0);
});

Deno.test('#1077 BR-EVENTO-009 item 8: geocoded once, then from the cache; no quota or no answer leaves the event out', async () => {
  const geo = new Geo();
  const { deps } = setup(geo);
  const run = await importSource(deps, AMSTERDAM, link());
  assertEquals([run.summary.created, geo.searches.length, geo.quota], [1, 1, 2]);
  // A new run of a new event at the same address: the cache answers, no quota, no Google.
  const { deps: d2 } = setup(geo);
  await importSource(d2, AMSTERDAM, link());
  assertEquals([geo.searches.length, geo.quota], [1, 2]);

  const empty = new Geo();
  empty.quota = 0;
  const { store: s3, deps: d3 } = setup(empty);
  const run3 = await importSource(d3, AMSTERDAM, link());
  assertEquals([run3.summary.created, run3.summary.skipped_reasons, empty.searches.length], [
    0,
    { geocode_quota: 1 },
    0,
  ]);
  assertEquals(s3.calls.length, 0);

  const notFound = new Geo();
  notFound.answer = null;
  const { deps: d4 } = setup(notFound);
  assertEquals((await importSource(d4, AMSTERDAM, link())).summary.skipped_reasons, { geocode_not_found: 1 });
  // The miss is cached as unresolved: a run within 6 days does not ask again, and the event waits.
  const { deps: d5 } = setup(notFound);
  const run5 = await importSource(d5, AMSTERDAM, link());
  assertEquals([run5.summary.skipped_reasons, notFound.searches.length], [{ geocode_unresolved: 1 }, 1]);
});

Deno.test('#1077 BR-EVENTO-009 item 8: geocoding off is a skip with the reason, never an event without coordinate', async () => {
  const { store, deps } = setup();
  deps.geocodingOff = 'secret NEXT_PUBLIC_GOOGLE_MAPS_API_KEY missing';
  const run = await importSource(deps, AMSTERDAM, link());
  assertEquals(run.summary.skipped_reasons, { geocode_off: 1 });
  assert(run.summary.errors.some((e) => e.message.includes('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY')));
  assertEquals(store.calls.length, 0);
});

Deno.test('#1077 BR-EVENTO-009 item 8: the cache keeps a coordinate 30 days and a miss until the next weekly import', () => {
  const at = (days: number, lat: number | null) => ({
    lat,
    lon: lat === null ? null : 1,
    queried_at: new Date(NOW - days * DAY_MS).toISOString(),
  });
  assertEquals(cacheVerdict(null, NOW), 'query');
  assertEquals(cacheVerdict(at(29, 1), NOW), 'hit');
  assertEquals(cacheVerdict(at(31, 1), NOW), 'query');
  assertEquals(cacheVerdict(at(5, null), NOW), 'unresolved');
  assertEquals(cacheVerdict(at(7, null), NOW), 'query');
  assertEquals(
    addressKey('  Teatro  Español,  CALLE PRINCIPE 25 ', 'Madrid', 'Spain'),
    'teatro español, calle principe 25 , madrid, spain',
  );
});

Deno.test('#1077 BR-EVENTO-009 item 7: file CSV (Québec) with ";", BOM and DD/MM/YYYY keeps only the city, current', async () => {
  const { store, deps } = setup();
  const run = await importSource(deps, QUEBEC, link());
  assertEquals(run.summary.read, 4);
  assertEquals(run.summary.skipped_reasons, { ended: 1, filtered: 1 });
  const livre = store.calls.find((c) => c.externalId === 'EVENMTOV500OMY')!.payload;
  assertEquals(livre.name, 'Salon international du livre de Québec');
  assertEquals(livre.all_day, true);
  assertEquals(livre.event_category, 'fair');
  assertEquals(livre.ends_at, '2027-04-11T23:59:59-04:00');
  const pentathlon = store.calls.find((c) => c.externalId === 'EVENMTOV500OGN')!.payload;
  assertEquals(pentathlon.event_category, 'sports');
  assert(pentathlon.lon! < -71 && pentathlon.lon! > -72, 'the longitude " -71..." is trimmed');
});

Deno.test('#1077 BR-EVENTO-009: jsonld by sitemap (Amsterdam), the link pattern, a whole browser UA, the page Event', async () => {
  const geo = new Geo();
  const { store, net, deps } = setup(geo);
  const run = await importSource(deps, AMSTERDAM, link());
  // 3 EN pages of the sitemap match; the Dutch /uit/ one does not. Two EN pages are not recorded (404).
  assertEquals(run.summary.read, 3);
  assertEquals(run.summary.errors.filter((e) => e.message === 'http_404 www.iamsterdam.com').length, 2);
  assert(net.userAgents.every((ua) => ua === BROWSER_USER_AGENT), 'every call carries the browser User-Agent');
  assert(/Chrome\/\d+\.\d+\.\d+\.\d+ Safari/.test(BROWSER_USER_AGENT));
  const ev = byName(store, 'Midterm Madness')!;
  assertEquals([ev.starts_at, ev.ends_at, ev.language], [
    '2026-11-06T19:30:00+00:00',
    '2026-11-06T23:00:00+00:00',
    'en-us',
  ]);
  assertEquals(ev.address, 'Pakhuis De Zwijger, Piet Heinkade 179-181, 1019 HC');
  // keywords "Stage" matches no rule of the seed: other (a ["stage", "theatre"] rule is for the data side).
  assertEquals(ev.event_category, 'other');
  assert(ev.poster_url!.includes(`/events/${AMSTERDAM.id}/`), 'the image array gives the poster');
  // The seed config has no lat/lon for Amsterdam, so the address was geocoded.
  assertEquals(geo.searches, ['Pakhuis De Zwijger, Piet Heinkade 179-181, 1019 HC, Amsterdam, Netherlands']);
  assertEquals(
    store.calls[0].externalId,
    'https://www.iamsterdam.com/en/whats-on/calendar/theatre-and-stage/stage/midterm-madness',
  );
});

Deno.test('#1077 BR-EVENTO-009: jsonld (Wien Erleben) takes the dates of subEvent and the coordinate of geos', async () => {
  const { store, deps } = setup();
  const run = await importSource(deps, WIEN, link());
  assertEquals([run.summary.read, run.summary.created], [1, 1]);
  const ev = store.calls[0].payload;
  assertEquals(ev.name, 'Liesinger Weihnachtskunstmarkt');
  assertEquals([ev.starts_at, ev.ends_at], ['2026-11-27T19:00:00+01:00', '2026-11-29T17:00:00+01:00']);
  assertEquals([ev.lat, ev.lon], [48.134641833869146, 16.28270199842222]);
  assertEquals([ev.language, ev.poster_url], ['de-de', null]);
  assert(ev.description.length > 0 && !ev.description.includes('Informações:'), ev.description.slice(-60));
});

Deno.test('#1077: a second run of the same records is unchanged, and fetches no image again', async () => {
  const { store, net, deps } = setup();
  await importSource(deps, PARIS, link());
  const imagesFirst = net.urls.filter((u) => u.includes('cdn.paris.fr')).length;
  const run2 = await importSource(deps, PARIS, { chain: 1, run_started_at: new Date(NOW + 1000).toISOString() });
  assertEquals([run2.summary.unchanged, run2.summary.created], [3, 0]);
  // The store fake answers the poster of each item, so the second run reuses it.
  assertEquals(net.urls.filter((u) => u.includes('cdn.paris.fr')).length, imagesFirst);
  assertEquals(store.calls.length, 6);
});

Deno.test('#1082 BR-EVENTO-009 item 3: the credit is out of the hash, so taking it off the text updates no event', async () => {
  // The hash of an item is the record of the source, never the description built from it: a run after #1082
  // over records stored before it, or with another credit line in the source row, is unchanged.
  const { store, deps } = setup();
  await importSource(deps, PARIS, link());
  const other = { ...PARIS, credit: 'Informações: Outra fonte (example.org)' };
  const run2 = await importSource(deps, other, { chain: 1, run_started_at: new Date(NOW + 1000).toISOString() });
  assertEquals([run2.summary.unchanged, run2.summary.updated, run2.summary.created], [3, 0, 0]);
  const [first, second] = [store.calls.slice(0, 3), store.calls.slice(3)];
  assertEquals(second.map((c) => c.payload.source_hash), first.map((c) => c.payload.source_hash));
  assertEquals(second.map((c) => c.payload.description), first.map((c) => c.payload.description));
});

Deno.test('#1077: a generic source goes on after the last key started; done sources are not read again', async () => {
  const { store, deps } = setup();
  store.sources = [MADRID, PARIS];
  let t = NOW;
  deps.now = () => t;
  // Ten real Paris records under ten ids; each image costs the whole budget, so a link starts the four it opened with.
  const [banksy] = json('ods-paris.json').results as Record<string, unknown>[];
  const ten = Array.from({ length: 10 }, (_, i) => ({ ...banksy, id: `9${i}`, title: `${banksy.title} ${i}` }));
  const base = deps.fetch;
  deps.fetch = (url, init) => {
    if (url.includes('opendata.paris.fr')) {
      const offset = Number(new URL(url).searchParams.get('offset') ?? 0);
      return Promise.resolve(Response.json({ total_count: 10, results: ten.slice(offset, offset + 100) }));
    }
    if (url.includes('cdn.paris.fr')) t += 100_000;
    return base(url, init);
  };
  const first = link();
  const reports = await runEventsImport(deps, first);
  const madrid = reports.find((r) => r.source_id === MADRID.id)!;
  const paris = reports.find((r) => r.source_id === PARIS.id)!;
  assertEquals([madrid.summary.pending, madrid.generic], [0, true]);
  assertEquals([paris.summary.created, paris.summary.pending, paris.cursor], [4, 6, '93']);
  const next = nextLink(reports, first)!;
  assertEquals(next.done, [MADRID.id]);
  assertEquals(next.after, { [PARIS.id]: '93' });
  // The body the function sends itself is the body it accepts.
  assertEquals(readLink(JSON.parse(JSON.stringify(next)), t), next);

  const reports2 = await runEventsImport(deps, next);
  assertEquals(reports2.map((r) => r.source_id), [PARIS.id]);
  assertEquals([reports2[0].summary.created, reports2[0].cursor], [4, '97']);
  const parisCalls = store.calls.filter((c) => c.sourceId === PARIS.id).map((c) => c.externalId);
  assertEquals(parisCalls.sort(), ['90', '91', '92', '93', '94', '95', '96', '97']);
});

Deno.test('#1077: a manual run of one source runs that one, and its links keep it', async () => {
  const { store, deps } = setup();
  store.sources = [PARIS, MONTREAL];
  const reports = await runEventsImport(deps, { ...link(), only: MONTREAL.id });
  assertEquals(reports.map((r) => r.source_id), [MONTREAL.id]);
  const now = NOW;
  assertEquals(readLink({ chain: 2, run_started_at: new Date(now - 1000).toISOString(), only: MONTREAL.id }, now), {
    chain: 2,
    run_started_at: new Date(now - 1000).toISOString(),
    only: MONTREAL.id,
  });
  for (
    const bad of [
      { only: 'paris' },
      { done: 'x' },
      { done: [1] },
      { after: [] },
      { after: { [PARIS.id]: '' } },
    ]
  ) {
    const body = { chain: 2, run_started_at: new Date(now - 1000).toISOString(), ...bad };
    assertEquals([bad, readLink(body, now)], [bad, 'invalid_chain']);
  }
});

Deno.test('#1077: categories by rule order, accents and case ignored, unknown target is other', () => {
  const rules = PARIS.config!.category;
  assertEquals(mapCategoryByRules('Expo;Art contemporain', rules), 'exhibition');
  assertEquals(mapCategoryByRules(['Théâtre'], rules), 'theatre');
  assertEquals(mapCategoryByRules('Festival|Concert', rules), 'festival');
  assertEquals(mapCategoryByRules(undefined, rules), 'other');
  assertEquals(mapCategoryByRules('x', { rules: [['x', 'party']] }), 'other');
});

Deno.test('#1077: source dates, with and without offset, and the CSV of the Québec portal', () => {
  assertEquals(parseWhen('2027-01-27 18:00:00.0', 'Europe/Madrid'), {
    day: '2027-01-27',
    iso: '2027-01-27T18:00:00+01:00',
    dateOnly: false,
  });
  assertEquals(parseWhen('2026-11-07T22:00:00Z', 'Europe/Amsterdam')?.iso, '2026-11-07T22:00:00+00:00');
  assertEquals(parseWhen('12/04/2027', 'America/Toronto', 'DD/MM/YYYY')?.day, '2027-04-12');
  assertEquals(parseWhen('nan', 'America/Toronto'), null);
  assertEquals(parseCsv('﻿a;b\r\n"x;1";"say ""hi"""\r\n', ';'), [{ a: 'x;1', b: 'say "hi"' }]);
});

Deno.test('#1077: the SPTuris keeps its credit line and sends no language and no is_free', () => {
  assertEquals(SPTUR_CREDIT_LINE, 'Informações: Cidade de São Paulo (cidadedesaopaulo.com)');
});
