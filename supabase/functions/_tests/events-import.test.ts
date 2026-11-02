/**
 * #1075: the weekly import of official events, `_shared/events-import.ts` and `events-import/index.ts`.
 *
 * The module runs against the SPTuris answers recorded on 2026-11-02 (`fixtures/events-import/`: the
 * list, the Formula 1 card and the Cirque du Soleil card) served by URL, an in-memory store standing
 * for `core.event_sources`, `core.import_event_upsert` and the bucket. The handler tests prove the
 * gate and the wiring to the schema `core`.
 */
import { assert, assertEquals } from './assert.ts';
import { fetchCalls, loadHandler, network, scenario } from './harness.ts';
import {
  buildDescription,
  eventDates,
  type EventPayload,
  type EventSource,
  htmlToText,
  IMAGE_BUCKET,
  type ImportDeps,
  type ImportStore,
  type KnownItem,
  localIso,
  mapCategory,
  MAX_CHAIN_LINKS,
  nextLink,
  payloadHash,
  pool,
  readLink,
  RUN_BUDGET_MS,
  runEventsImport,
  type RunStatus,
  type RunSummary,
  sourceHash,
  SPTUR_CREDIT,
  SPTUR_CREDIT_LINE,
} from '../_shared/events-import.ts';

const fixture = (name: string) =>
  JSON.parse(Deno.readTextFileSync(new URL(`./fixtures/events-import/${name}`, import.meta.url)));

const LIST = fixture('list.json') as { total: number; itens: Record<string, unknown>[] };
const F1 = fixture('card-formula-1.json') as Record<string, unknown>;
const CIRQUE = fixture('card-cirque.json') as Record<string, unknown>;
const F1_SLUG = 'formula-1-msc-cruises-grande-premio-de-sao-paulo-2026';
const CIRQUE_SLUG = 'cirque-du-soleil-alegria-in-a-new-light';

const SPTUR: EventSource = {
  id: '5e000000-0000-4000-8000-000000000001',
  name: 'SPTuris',
  adapter: 'sptur_csp',
  base_url: 'https://cidadedesaopaulo.com',
  timezone: 'America/Sao_Paulo',
};

const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4]);

interface Server {
  /** The page size the server really answers, whatever `por` asks: the walk must not trust `por`. */
  pageSize: number;
  listFails?: boolean;
  imageFails?: boolean;
  urls: string[];
  userAgents: string[];
}

/** The SPTuris API from the fixtures. A card not recorded is built from its list item, without image. */
function sptur(server: Server) {
  return (url: string, init?: RequestInit): Promise<Response> => {
    server.urls.push(url);
    server.userAgents.push(new Headers(init?.headers).get('user-agent') ?? '');
    const u = new URL(url);
    if (u.pathname === '/api/csp/eventos') {
      if (server.listFails) return Promise.reject(new TypeError('network down'));
      const page = Number(u.searchParams.get('pagina'));
      const itens = LIST.itens.slice((page - 1) * server.pageSize, page * server.pageSize);
      return Promise.resolve(Response.json({ total: LIST.total, pagina: page, por_pagina: server.pageSize, itens }));
    }
    if (u.pathname === '/api/csp/evento') {
      const slug = u.searchParams.get('slug');
      if (slug === F1_SLUG) return Promise.resolve(Response.json(F1));
      // The card sometimes comes wrapped in `dados`.
      if (slug === CIRQUE_SLUG) return Promise.resolve(Response.json({ dados: CIRQUE }));
      const item = LIST.itens.find((it) => it.slug === slug);
      if (!item) return Promise.resolve(new Response('not found', { status: 404 }));
      return Promise.resolve(Response.json({ titulo: item.titulo, local: item.local, categoria: item.categoria }));
    }
    if (u.pathname === '/api/csp/midia') {
      if (server.imageFails) return Promise.resolve(new Response('blocked', { status: 403 }));
      return Promise.resolve(new Response(WEBP, { headers: { 'content-type': 'image/webp' } }));
    }
    return Promise.resolve(new Response('', { status: 404 }));
  };
}

class MemoryStore implements ImportStore {
  sources: EventSource[] = [SPTUR];
  /** external_id -> last payload; the `source_hash` decides updated or unchanged, like the RPC. */
  events = new Map<string, EventPayload>();
  /** `core.event_source_items`: the hash and when the RPC last saw each item, by `clock`. */
  items = new Map<string, KnownItem>();
  clock: () => number = Date.now;
  calls: { externalId: string; payload: EventPayload }[] = [];
  progress: RunSummary[] = [];
  finished: { sourceId: string; status: RunStatus; summary: RunSummary }[] = [];
  uploads = new Map<string, { bytes: Uint8Array; contentType: string }>();

  activeSources() {
    return Promise.resolve(this.sources);
  }
  knownItems() {
    return Promise.resolve([...this.items.values()]);
  }
  upsertEvent(_sourceId: string, externalId: string, payload: EventPayload) {
    this.calls.push({ externalId, payload });
    const before = this.events.get(externalId);
    this.events.set(externalId, payload);
    this.items.set(externalId, {
      external_id: externalId,
      source_hash: payload.source_hash,
      last_seen_at: new Date(this.clock()).toISOString(),
    });
    const action = !before ? 'created' : before.source_hash === payload.source_hash ? 'unchanged' : 'updated';
    return Promise.resolve({ attraction_id: `attr-${externalId}`, action });
  }
  saveProgress(_sourceId: string, summary: RunSummary) {
    this.progress.push(summary);
    return Promise.resolve();
  }
  finishSource(sourceId: string, status: RunStatus, summary: RunSummary) {
    this.finished.push({ sourceId, status, summary });
    return Promise.resolve();
  }
  /** Storage that writes the object and still answers an error, as seen on 2026-11-02. */
  uploadAnswersError = false;
  uploadImage(path: string, bytes: Uint8Array, contentType: string) {
    this.uploads.set(path, { bytes, contentType });
    if (this.uploadAnswersError) return Promise.reject(new Error('upload: http_504'));
    return Promise.resolve(`http://supabase.test/storage/v1/object/public/${IMAGE_BUCKET}/${path}`);
  }
  storedImageUrl(path: string, size: number) {
    const stored = this.uploads.get(path);
    return Promise.resolve(
      stored?.bytes.length === size ? `http://supabase.test/storage/v1/object/public/${IMAGE_BUCKET}/${path}` : null,
    );
  }
}

function deps(store: MemoryStore, server: Server): ImportDeps {
  return { store, fetch: sptur(server), log: () => {} };
}

const newServer = (pageSize = 100): Server => ({ pageSize, urls: [], userAgents: [] });

// ---------------------------------------------------------------------------------------------
// Pure pieces

Deno.test('#1075 BR-EVENTO-009: dates are local midnight and 23:59:59 with the offset of that day', () => {
  assertEquals(localIso('2026-11-06', '00:00:00', 'America/Sao_Paulo'), '2026-11-06T00:00:00-03:00');
  assertEquals(localIso('2026-11-08', '23:59:59', 'America/Sao_Paulo'), '2026-11-08T23:59:59-03:00');
  // A zone with daylight saving time: the offset follows the day, not the run.
  assertEquals(localIso('2026-01-15', '00:00:00', 'America/New_York'), '2026-01-15T00:00:00-05:00');
  assertEquals(localIso('2026-07-01', '23:59:59', 'America/New_York'), '2026-07-01T23:59:59-04:00');
  assertEquals(localIso('2026-07-01', '00:00:00', 'Europe/Lisbon'), '2026-07-01T00:00:00+01:00');
  assertEquals(
    new Date(localIso('2026-11-06', '00:00:00', 'America/Sao_Paulo')).toISOString(),
    '2026-11-06T03:00:00.000Z',
  );
});

Deno.test('#1075: the first start and the last end of the agenda win; without an agenda, the list dates', () => {
  const agenda = [
    { inicio: '2026-12-05', fim: '2026-12-05', dia_todo: true },
    { inicio: '2026-12-01', fim: '2026-12-02', dia_todo: true },
  ];
  assertEquals(eventDates(agenda, {}, 'America/Sao_Paulo'), {
    starts_at: '2026-12-01T00:00:00-03:00',
    ends_at: '2026-12-05T23:59:59-03:00',
    all_day: true,
  });
  assertEquals(eventDates([], { inicio: '2026-11-10', fim: null, dia_todo: false }, 'America/Sao_Paulo'), {
    starts_at: '2026-11-10T00:00:00-03:00',
    ends_at: '2026-11-10T23:59:59-03:00',
    all_day: false,
  });
  let threw = false;
  try {
    eventDates(undefined, {}, 'America/Sao_Paulo');
  } catch {
    threw = true;
  }
  assert(threw, 'an event without any date must fail, not land on 1970');
});

Deno.test('#1075: SPTuris categories map onto EVENT_CATEGORIES of the CMS; unknown is other', () => {
  const cases: [string | undefined, string][] = [
    ['musica-show', 'music'],
    ['evento-esportivo', 'sports'],
    ['festival', 'festival'],
    ['festival-do-cafe', 'festival'],
    ['festividades', 'festival'],
    ['evento-gastronomico', 'festival'],
    ['desfile-passeata', 'festival'],
    ['teatro', 'theatre'],
    ['exposicao', 'exhibition'],
    ['negocios', 'conference'],
    ['palestras-e-encontros', 'conference'],
    ['programacao-artistica', 'other'],
    ['algo-novo', 'other'],
    [undefined, 'other'],
  ];
  for (const [slug, expected] of cases) assertEquals([slug, mapCategory(slug)], [slug, expected]);
});

Deno.test('#1075 BR-EVENTO-009 item 3: the HTML becomes paragraphs of plain text, then the credit line', () => {
  assertEquals(
    htmlToText(
      '<p><em>Alegría &ndash; In a New Light</em>, do Cirque&nbsp;du Soleil.</p>\n<p>Linha 1<br/>Linha 2 &amp; mais &#8220;x&#8221;</p><ul><li>um</li><li>dois</li></ul>',
    ),
    'Alegría – In a New Light, do Cirque du Soleil.\n\nLinha 1\nLinha 2 & mais “x”\n\n• um\n\n• dois',
  );
  const text = buildDescription(F1.descricao_html);
  assert(text.startsWith('O Fórmula 1 MSC Cruises Grande Prêmio de São Paulo 2026 promete'), text.slice(0, 80));
  assert(text.endsWith('\n\nInformações: Cidade de São Paulo (cidadedesaopaulo.com)'), text.slice(-80));
  assert(!/[<>]/.test(text), 'no tag survives');
  assertEquals(buildDescription(undefined), SPTUR_CREDIT_LINE);
});

Deno.test('#1075: the hash ignores `hoje`, which changes every day, and sees any other change', async () => {
  const base = await sourceHash(F1);
  assertEquals(await sourceHash({ ...F1, hoje: '2026-11-09' }), base);
  assert((await sourceHash({ ...F1, website: 'https://other.example' })) !== base);
  assert(/^[0-9a-f]{64}$/.test(base));
});

// ---------------------------------------------------------------------------------------------
// The run

Deno.test('#1075 BR-EVENTO-009: the Formula 1 card becomes the exact payload of import_event_upsert', async () => {
  const store = new MemoryStore();
  const server = newServer();
  await runEventsImport(deps(store, server));
  const f1 = store.calls.find((c) => c.payload.name === F1.titulo);
  assert(f1, 'the Formula 1 event reached the RPC');
  assertEquals(f1.externalId, '902');
  const path = `events/${SPTUR.id}/902/2370.webp`;
  assertEquals(f1.payload, {
    name: 'Fórmula 1 MSC Cruises Grande Prêmio de São Paulo 2026',
    description: buildDescription(F1.descricao_html),
    starts_at: '2026-11-06T00:00:00-03:00',
    ends_at: '2026-11-08T23:59:59-03:00',
    all_day: true,
    lat: -23.741457,
    lon: -46.706055,
    address: 'Av. Sen. Teotônio Vilela, 261 - Jardim Malia I, São Paulo - SP',
    website: 'https://f1saopaulo.com.br/',
    event_category: 'sports',
    tags: ['estrategico'],
    poster_url: `http://supabase.test/storage/v1/object/public/travel-app-images/${path}`,
    image_credit: 'Crédito: Divulgação',
    source_url: `https://cidadedesaopaulo.com/events/${F1_SLUG}/`,
    source_hash: payloadHash(await sourceHash(F1), true),
  });
  // BR-EVENTO-009 item 5: the image is ours; the app never reaches the source's server.
  assertEquals(store.uploads.get(path)?.contentType, 'image/webp');
  assert(server.urls.includes('https://cidadedesaopaulo.com/api/csp/midia?id=2370&v=grande'));
  assert(server.userAgents.every((ua) => ua.startsWith('Mozilla/5.0')), 'every call carries a browser User-Agent');
  // The card wrapped in `dados` is read the same way.
  const cirque = store.calls.find((c) => c.externalId === '973');
  assertEquals([cirque?.payload.event_category, cirque?.payload.ends_at], ['music', '2026-11-08T23:59:59-03:00']);
});

Deno.test('#1075: a list served 7 at a time is walked to its total, and no event is read twice', async () => {
  const store = new MemoryStore();
  const server = newServer(7);
  const [report] = await runEventsImport(deps(store, server));
  const pages = server.urls.filter((u) => u.includes('/api/csp/eventos'));
  assertEquals(pages, [1, 2, 3].map((p) => `https://cidadedesaopaulo.com/api/csp/eventos?pagina=${p}&por=100`));
  assertEquals(LIST.total, 17);
  assertEquals([report.summary.read, store.calls.length, new Set(store.calls.map((c) => c.externalId)).size], [
    17,
    17,
    17,
  ]);
  assertEquals([report.status, report.summary.created, report.summary.errors], ['ok', 17, []]);
  assertEquals(store.finished.map((f) => [f.sourceId, f.status]), [[SPTUR.id, 'ok']]);
  // A second run over the same answers creates nothing and re-uploads onto the same objects.
  const uploadsBefore = store.uploads.size;
  const [again] = await runEventsImport(deps(store, newServer(7)));
  assertEquals([again.summary.created, again.summary.unchanged, store.uploads.size], [0, 17, uploadsBefore]);
});

Deno.test('#1075: an image that fails keeps the event, with no poster, and the error in the summary', async () => {
  const store = new MemoryStore();
  const server = { ...newServer(), imageFails: true };
  const [report] = await runEventsImport(deps(store, server));
  assertEquals(report.summary.created, 17);
  const f1 = store.calls.find((c) => c.externalId === '902');
  assertEquals([f1?.payload.poster_url, f1?.payload.image_credit], [null, null]);
  assert(report.summary.errors.some((e) => e.external_id === '902' && e.message === 'image: image_http_403'));
  assertEquals(report.status, 'partial');
});

Deno.test('#1075: one broken event does not stop the run; a dead list marks the source error', async () => {
  const store = new MemoryStore();
  const original = store.upsertEvent.bind(store);
  store.upsertEvent = (sourceId, externalId, payload) =>
    externalId === '902' ? Promise.reject(new Error('rpc 23505: duplicate')) : original(sourceId, externalId, payload);
  const [report] = await runEventsImport(deps(store, newServer()));
  assertEquals([report.status, report.summary.created], ['partial', 16]);
  assertEquals(report.summary.errors, [{ external_id: '902', message: 'rpc 23505: duplicate' }]);

  const dead = new MemoryStore();
  const [down] = await runEventsImport(deps(dead, { ...newServer(), listFails: true }));
  assertEquals([down.status, down.summary.read, dead.calls.length], ['error', 0, 0]);
  assertEquals(down.summary.errors, [{ external_id: null, message: 'list: network down' }]);
  assertEquals(dead.finished.map((f) => f.status), ['error']);
});

Deno.test('#1075: an unknown adapter is an error of that source only; the next source still runs', async () => {
  const store = new MemoryStore();
  store.sources = [{ ...SPTUR, id: 'x', adapter: 'rio_smtur' }, SPTUR];
  const reports = await runEventsImport(deps(store, newServer()));
  assertEquals(reports.map((r) => r.status), ['error', 'ok']);
  assertEquals(reports[0].summary.errors, [{ external_id: null, message: 'unknown_adapter:rio_smtur' }]);
});

Deno.test('#1075 BR-EVENTO-009: an image without alt is credited to the source', async () => {
  const store = new MemoryStore();
  const server = newServer();
  const fetchF1 = sptur(server);
  const noAlt = { ...F1, imagens: [{ id: 2370, disponivel: true }] };
  await runEventsImport({
    store,
    log: () => {},
    fetch: (url, init) => url.includes(`slug=${F1_SLUG}`) ? Promise.resolve(Response.json(noAlt)) : fetchF1(url, init),
  });
  assertEquals(store.calls.find((c) => c.externalId === '902')?.payload.image_credit, SPTUR_CREDIT);
});

// ---------------------------------------------------------------------------------------------
// Time budget, links and poster retry

/** A clock that only moves when a card is fetched: each card costs `cardMs`. */
function slowCards(server: Server, cardMs: number) {
  const clock = { t: Date.parse('2026-11-02T21:51:00Z') };
  const base = sptur(server);
  const fetch = (url: string, init?: RequestInit) => {
    if (url.includes('/api/csp/evento?')) clock.t += cardMs;
    return base(url, init);
  };
  return { clock, fetch };
}

Deno.test('#1075: at the time budget no item starts; the source closes partial and asks for the next link', async () => {
  const store = new MemoryStore();
  const server = newServer();
  const { clock, fetch } = slowCards(server, 15_000);
  store.clock = () => clock.t;
  const runStartedAt = new Date(clock.t).toISOString();
  const link = { chain: 1, run_started_at: runStartedAt };
  const [report] = await runEventsImport({ store, fetch, log: () => {}, now: () => clock.t }, link);

  const done = report.summary.created;
  assert(done > 0 && done < 17, `some items, not all: ${done}`);
  assertEquals(report.summary.pending, 17 - done);
  assertEquals([report.status, store.finished.at(-1)?.status], ['partial', 'partial']);
  // No item started after the budget: the last start is under 100 s, and at most 4 were in flight.
  assert(done <= Math.ceil(RUN_BUDGET_MS / 15_000) + 4, `${done} started`);
  // The trail: one running summary per step, the last one with every finished item timed.
  assert(store.progress.length >= done, 'progress written as it goes');
  assertEquals(store.progress.at(-1)?.timings.length, done);
  assert(report.summary.timings.every((t) => t.card_ms >= 15_000), 'the card time is measured');
  assertEquals(nextLink([report], link), { chain: 2, run_started_at: runStartedAt });

  // Link 2 starts with the items link 1 did not see, and reads no card twice.
  const cardsBefore = server.urls.filter((u) => u.includes('/api/csp/evento?')).length;
  const link2 = { chain: 2, run_started_at: runStartedAt };
  const [second] = await runEventsImport({ store, fetch, log: () => {}, now: () => clock.t }, link2);
  const cardsAfter = server.urls.filter((u) => u.includes('/api/csp/evento?')).length;
  assertEquals(second.summary.already_seen, done);
  assertEquals(second.summary.chain, 2);
  assertEquals(cardsAfter - cardsBefore, Math.min(17 - done, second.summary.created));
  assertEquals(store.calls.length, done + second.summary.created);
  assertEquals(new Set(store.calls.map((c) => c.externalId)).size, store.calls.length);

  // A third link finishes the run; once nothing is pending, no next link.
  const [third] = await runEventsImport({ store, fetch, log: () => {}, now: () => clock.t }, {
    chain: 3,
    run_started_at: runStartedAt,
  });
  assertEquals([third.status, third.summary.pending, new Set(store.calls.map((c) => c.externalId)).size], [
    'ok',
    0,
    17,
  ]);
  assertEquals(nextLink([third], { chain: 3, run_started_at: runStartedAt }), null);
});

Deno.test('#1075: a run has at most 6 links, and a chained body is checked', () => {
  const pending = [{ source_id: 's', name: 'n', status: 'partial' as const, recorded: true, summary: { pending: 3 } }];
  const at = (chain: number) => nextLink(pending as never, { chain, run_started_at: 'x' });
  assertEquals(MAX_CHAIN_LINKS, 6);
  assertEquals(at(5)?.chain, 6);
  assertEquals(at(6), null);

  const now = Date.parse('2026-11-02T22:00:00Z');
  assertEquals(readLink({}, now), null);
  assertEquals(readLink(null, now), null);
  assertEquals(readLink({ chain: 2, run_started_at: '2026-11-02T21:58:00.000Z' }, now), {
    chain: 2,
    run_started_at: '2026-11-02T21:58:00.000Z',
  });
  for (
    const bad of [
      { chain: 1, run_started_at: '2026-11-02T21:58:00Z' },
      { chain: 7, run_started_at: '2026-11-02T21:58:00Z' },
      { chain: 2.5, run_started_at: '2026-11-02T21:58:00Z' },
      { chain: '2', run_started_at: '2026-11-02T21:58:00Z' },
      { chain: 2 },
      { chain: 2, run_started_at: 'yesterday' },
      { chain: 2, run_started_at: '2026-11-02T23:00:00Z' },
      { chain: 2, run_started_at: '2026-11-01T21:58:00Z' },
    ]
  ) assertEquals([bad, readLink(bad, now)], [bad, 'invalid_chain']);
});

Deno.test('#1075: four items at a time, never more', async () => {
  let running = 0;
  let peak = 0;
  const done: number[] = [];
  const started = await pool([...Array(10).keys()], 4, () => true, async (n) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 1));
    running -= 1;
    done.push(n);
  });
  assertEquals([started, peak, done.length], [10, 4, 10]);

  // The same through a whole run: the cards in flight at once never pass 4.
  const server = newServer();
  const base = sptur(server);
  let cards = 0;
  let cardPeak = 0;
  const store = new MemoryStore();
  await runEventsImport({
    store,
    log: () => {},
    fetch: async (url, init) => {
      if (!url.includes('/api/csp/evento?')) return base(url, init);
      cards += 1;
      cardPeak = Math.max(cardPeak, cards);
      await new Promise((r) => setTimeout(r, 1));
      cards -= 1;
      return base(url, init);
    },
  });
  assertEquals([cardPeak, store.calls.length], [4, 17]);
});

Deno.test('#1075 BR-EVENTO-009 item 5: an event that came in without its poster is updated when the image copies', async () => {
  const cardHash = await sourceHash(F1);
  assert(payloadHash(cardHash, true) !== payloadHash(cardHash, false));
  assert(payloadHash(cardHash, true).startsWith(cardHash));

  const store = new MemoryStore();
  const [first] = await runEventsImport(deps(store, { ...newServer(), imageFails: true }));
  assertEquals([first.summary.created, store.events.get('902')?.poster_url], [17, null]);
  assertEquals(store.events.get('902')?.source_hash, payloadHash(cardHash, false));

  const [second] = await runEventsImport(deps(store, newServer()));
  // F1 and Cirque have images; the other cards of the fixture have none and stay unchanged.
  assertEquals([second.summary.updated, second.summary.unchanged], [2, 15]);
  assert(store.events.get('902')?.poster_url?.endsWith('/902/2370.webp'), 'the poster arrived');

  // The image fails again: the RPC would write the null poster over it, so the event is not sent.
  const callsBefore = store.calls.length;
  const [third] = await runEventsImport(deps(store, { ...newServer(), imageFails: true }));
  assert(store.events.get('902')?.poster_url?.endsWith('/902/2370.webp'), 'the stored poster stays');
  assertEquals(store.calls.slice(callsBefore).some((c) => c.externalId === '902'), false);
  assert(
    third.summary.errors.some((e) =>
      e.external_id === '902' && e.message === 'image: image_http_403; stored event kept'
    ),
  );
});

Deno.test('#1075 BR-EVENTO-009 item 5: an upload that answers an error but left the whole object keeps the poster', async () => {
  const store = new MemoryStore();
  store.uploadAnswersError = true;
  const [report] = await runEventsImport(deps(store, newServer()));
  const f1 = store.events.get('902');
  assert(f1?.poster_url?.endsWith('/902/2370.webp'), 'the stored object is the poster');
  assertEquals(report.summary.errors, []);
  const timing = report.summary.timings.find((t) => t.external_id === '902');
  assertEquals(timing?.upload_error, 'upload: http_504');

  // An object that is not whole is no proof: the event goes without the poster, and the error shows.
  const partial = new MemoryStore();
  partial.uploadAnswersError = true;
  partial.storedImageUrl = () => Promise.resolve(null);
  const [failed] = await runEventsImport(deps(partial, newServer()));
  assertEquals(partial.events.get('902')?.poster_url, null);
  assert(failed.summary.errors.some((e) => e.external_id === '902' && e.message === 'image: upload: http_504'));
});

// ---------------------------------------------------------------------------------------------
// The handler

const handler = await loadHandler('events-import');
const MACHINE = 'Bearer test-service-role-key';
const userJwt = 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQifQ.c2ln';

function call(authorization: string | null, method = 'POST'): Promise<Response> {
  scenario.calls.length = 0;
  scenario.writes.length = 0;
  fetchCalls.length = 0;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (authorization !== null) headers.authorization = authorization;
  return Promise.resolve(
    handler(
      new Request('http://edge.test/events-import', { method, headers, body: method === 'POST' ? '{}' : undefined }),
    ),
  );
}

Deno.test('#1075: only our secret key gets in; anything else is 401 with nothing touched', async () => {
  for (const auth of [null, userJwt, 'Bearer sb_publishable_xyz', 'Bearer test-service-role-key-but-wrong']) {
    const res = await call(auth);
    assertEquals([auth, res.status], [auth, 401]);
    assertEquals([auth, scenario.calls, fetchCalls], [auth, [], []]);
  }
  assertEquals((await call(MACHINE, 'GET')).status, 405);
});

Deno.test('#1075: the handler reads the active sources of core, calls import_event_upsert and records last_run', async () => {
  const server = newServer();
  const recorded = sptur(server);
  network.reply = () => new Response('', { status: 500 });
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    fetchCalls.push(url);
    if (url.startsWith('http://supabase.test/storage/')) return Promise.resolve(Response.json({ Key: 'k' }));
    return recorded(url, init);
  };
  scenario.tables.event_sources = (chain: string[]) => (chain.includes('select') ? [SPTUR] : null);
  scenario.rpcs.import_event_upsert = { data: [{ attraction_id: 'a1', action: 'created' }], error: null };
  try {
    const res = await call(MACHINE);
    const body = await res.json();
    assertEquals(res.status, 200);
    assertEquals([body[0].status, body[0].summary.created, body[0].summary.errors], ['ok', 17, []]);
    assertEquals(scenario.calls.filter((c) => c === 'rpc:import_event_upsert').length, 17);
    const updates = scenario.writes.filter((w) => w.table === 'event_sources' && w.op === 'update');
    const statuses = updates.map((w) => (w.values as { last_run_status: string }).last_run_status);
    // The trail while it runs, then the final record, last.
    assert(statuses.length > 1 && statuses.slice(0, -1).every((s) => s === 'running'), statuses.join());
    const values = updates.at(-1)?.values as { last_run_status: string; last_run_summary: { read: number } };
    assertEquals([values.last_run_status, values.last_run_summary.read], ['ok', 17]);
    assert(scenario.calls.includes('from:event_source_items'), 'it reads what earlier links already saw');
    assert(
      fetchCalls.includes(`http://supabase.test/storage/v1/object/${IMAGE_BUCKET}/events/${SPTUR.id}/902/2370.webp`),
      'the image goes to the attraction image bucket',
    );
  } finally {
    globalThis.fetch = realFetch;
    delete scenario.tables.event_sources;
    delete scenario.rpcs.import_event_upsert;
    network.reply = () => new Response('{}', { status: 400 });
  }
});

Deno.test('#1075: out of time, the handler answers 200 and calls its own next link with chain and run_started_at', async () => {
  const server = newServer();
  const recorded = sptur(server);
  const sent: { url: string; body: unknown; auth: string | null }[] = [];
  const realFetch = globalThis.fetch;
  const realNow = Date.now;
  let t = realNow();
  Date.now = () => (t += 20_000);
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    fetchCalls.push(url);
    if (url.startsWith('http://supabase.test/storage/')) return Promise.resolve(Response.json({ Key: 'k' }));
    if (url.includes('/functions/v1/')) {
      sent.push({ url, body: JSON.parse(String(init?.body)), auth: new Headers(init?.headers).get('authorization') });
      return Promise.resolve(new Response('{}', { status: 202 }));
    }
    return recorded(url, init);
  };
  scenario.tables.event_sources = (chain: string[]) => (chain.includes('select') ? [SPTUR] : null);
  scenario.rpcs.import_event_upsert = { data: [{ attraction_id: 'a1', action: 'created' }], error: null };
  try {
    const res = await call(MACHINE);
    const body = await res.json();
    assertEquals([res.status, body[0].status], [200, 'partial']);
    assert(body[0].summary.pending > 0, 'items left');
    await new Promise((r) => setTimeout(r, 0));
    assertEquals(sent.length, 1);
    assertEquals(sent[0].url, 'http://supabase.test/functions/v1/events-import');
    assertEquals(sent[0].auth, MACHINE);
    const next = sent[0].body as { chain: number; run_started_at: string };
    assertEquals([next.chain, next.run_started_at], [2, body[0].summary.run_started_at]);
  } finally {
    globalThis.fetch = realFetch;
    Date.now = realNow;
    delete scenario.tables.event_sources;
    delete scenario.rpcs.import_event_upsert;
  }
});

Deno.test('#1075: a malformed chain body is 400 with nothing touched', async () => {
  scenario.calls.length = 0;
  fetchCalls.length = 0;
  const res = await handler(
    new Request('http://edge.test/events-import', {
      method: 'POST',
      headers: { authorization: MACHINE, 'content-type': 'application/json' },
      body: JSON.stringify({ chain: 99, run_started_at: new Date().toISOString() }),
    }),
  );
  assertEquals(res.status, 400);
  assertEquals([scenario.calls, fetchCalls], [[], []]);
});
