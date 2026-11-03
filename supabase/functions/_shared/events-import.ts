// _shared/events-import.ts
//
// The weekly import of events from official tourism sources (#1075, #1077, BR-EVENTO-009). One source
// is a row of `core.event_sources`; its `adapter` names the reader: `sptur_csp`, the API behind
// https://cidadedesaopaulo.com/calendario-de-eventos/ (SPTuris, city of São Paulo), here; the generic
// `opendatasoft`, `ckan`, `file` and `jsonld`, driven by the row's `config`, in `events-sources.ts`.
//
// Import-free: the database, the bucket and `fetch` are parameters, so the Deno tests drive it with
// recorded SPTuris answers and no network. `events-import/index.ts` wires the real clients.
//
// The SPTuris API, read on 2026-11-02 (no key; it sits behind Cloudflare, so a browser User-Agent):
// - list: GET /api/csp/eventos?pagina=N&por=100 -> { total, pagina, por_pagina, hoje, itens[] }. The
//   size parameter is `por`; `por_pagina` is ignored and the page falls back to 20. The page may be
//   smaller than asked, so the walk stops on `total` or on an empty page, never on the size asked.
// - card: GET /api/csp/evento?slug=<slug> -> the event, sometimes wrapped in `dados`. Its `hoje` is
//   today's date and changes every day: it stays out of `source_hash`, or every run is an update.
// - image: GET /api/csp/midia?id=<id>&v=grande -> image/webp. The credit is the image's `alt`.
// - public page: /events/<slug>/ (the SPA route `path:"/events/:slug/"` of its bundle).

import { htmlToText, localIso } from './events-text.ts';
import {
  discoverPages,
  extractEvent,
  GENERIC_ADAPTERS,
  type GeocodeAnswer,
  geocoder,
  type Geocoding,
  type MappedEvent,
  mapRecord,
  passesFilter,
  readRecords,
  type Rec,
  type SourceConfig,
} from './events-sources.ts';

/** BR-EVENTO-009 item 3: the credit line that closes every description copied from the SPTuris. */
export const SPTUR_CREDIT = 'Cidade de São Paulo (cidadedesaopaulo.com)';
export const SPTUR_CREDIT_LINE = `Informações: ${SPTUR_CREDIT}`;
/** The bucket the CMS already serves attraction images from (`PUBLIC_IMAGE_BUCKET` in the CMS). */
export const IMAGE_BUCKET = 'travel-app-images';
export const PAGE_SIZE = 100;
/** A runaway `total` must not keep the function walking until the platform kills it. */
export const MAX_PAGES = 50;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = ['image/webp', 'image/jpeg', 'image/png'];
/** The list and the card. */
export const FETCH_TIMEOUT_MS = 20_000;
/** The image, body included: a slow poster must not hold the event. */
export const IMAGE_FETCH_TIMEOUT_MS = 8_000;
/** The upload of one poster to our bucket. */
export const UPLOAD_TIMEOUT_MS = 15_000;
/**
 * No item starts after this much of a link: the platform answers the caller at 150 s and kills the
 * worker, and the items in flight still need their card, image, upload and RPC.
 */
export const RUN_BUDGET_MS = 100_000;
/** Items processed at the same time. */
export const CONCURRENCY = 4;
/** A run is at most this many links (calls of the function), the first included. */
export const MAX_CHAIN_LINKS = 6;
/** The per-item timings kept in `last_run_summary`, the latest ones, so the jsonb does not grow. */
export const MAX_TIMINGS = 30;
/** The errors kept in the summary of a generic source (a feed of thousands can fail item by item). */
export const MAX_ERRORS = 50;
/** A whole browser User-Agent: tourism sites answer 403 to a short one (Manchester, #1076). */
export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/** `EVENT_CATEGORIES` of `components/event-management/EventFormModal.tsx`, the CMS's closed list. */
export type EventCategory =
  | 'music'
  | 'sports'
  | 'festival'
  | 'theatre'
  | 'exhibition'
  | 'kids'
  | 'conference'
  | 'fair'
  | 'other';

const SPTUR_CATEGORY: Record<string, EventCategory> = {
  'musica-show': 'music',
  'evento-esportivo': 'sports',
  'festival': 'festival',
  'festival-do-cafe': 'festival',
  'festividades': 'festival',
  'evento-gastronomico': 'festival',
  'desfile-passeata': 'festival',
  'teatro': 'theatre',
  'exposicao': 'exhibition',
  'negocios': 'conference',
  'palestras-e-encontros': 'conference',
  'programacao-artistica': 'other',
};

export function mapCategory(slug: unknown): EventCategory {
  return (typeof slug === 'string' && SPTUR_CATEGORY[slug]) || 'other';
}

export interface EventSource {
  id: string;
  name: string;
  adapter: string;
  base_url: string;
  timezone: string;
  /** The city, state and country of the row (BR-EVENTO-009 item 7); the generic readers geocode in them. */
  city?: string;
  state?: string | null;
  country?: string;
  /** BR-EVENTO-009 item 3: "Informações: <órgão> (<domínio>)", the last line of every description. */
  credit?: string;
  config?: SourceConfig | null;
}

export type ImportAction = 'created' | 'updated' | 'unchanged' | 'linked' | 'skipped_deleted';
const ACTIONS: readonly ImportAction[] = ['created', 'updated', 'unchanged', 'linked', 'skipped_deleted'];

/** The keys of `p_payload` of `core.import_event_upsert`, exactly. */
export interface EventPayload {
  name: string;
  description: string;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  lat: number | null;
  lon: number | null;
  address: string | null;
  website: string | null;
  event_category: EventCategory;
  tags: string[];
  poster_url: string | null;
  image_credit: string | null;
  source_url: string;
  source_hash: string;
  /** `config.language` of the source; absent = pt-br in the RPC (the SPTuris sends none). */
  language?: string;
  /** Only when the source says it; a string here is 22023 in the RPC. */
  is_free?: boolean;
}

export interface RunError {
  external_id: string | null;
  message: string;
}

/** Milliseconds of each step of one item; `image_error` when the poster was not copied. */
export interface ItemTiming {
  external_id: string;
  card_ms: number;
  image_ms: number;
  upload_ms: number;
  rpc_ms: number;
  image_error?: string;
  /** The upload answered an error, yet the object was there, whole: the poster was kept. */
  upload_error?: string;
  /** The stored poster was the same image of the source: no fetch, no upload. */
  poster_reused?: boolean;
}

export interface RunSummary {
  /** The link of the run this summary is from (1 = the cron or the manual call). */
  chain: number;
  run_started_at: string;
  read: number;
  /** Items an earlier link of this run already upserted (`last_seen_at` after `run_started_at`). */
  already_seen: number;
  /** Items left for the next link because the time budget ran out. */
  pending: number;
  created: number;
  updated: number;
  unchanged: number;
  linked: number;
  skipped_deleted: number;
  /** Items that did not go to the RPC, by reason (ended, missing data, geocoding): not errors. */
  skipped: number;
  skipped_reasons: Record<string, number>;
  errors: RunError[];
  /** `<external_id>:<step>` of the items being processed when the summary was written. */
  in_flight: string[];
  timings: ItemTiming[];
}

export type RunStatus = 'ok' | 'partial' | 'error';

/** What `core.event_source_items` knows of one item of a source, and the poster its event carries. */
export interface KnownItem {
  external_id: string;
  source_hash: string;
  last_seen_at: string;
  /** `image_url` of the linked attraction, which the RPC writes with `poster_url`; null when none. */
  poster_url: string | null;
}

export interface ImportStore {
  activeSources(): Promise<EventSource[]>;
  /** Every item of the source, all pages of it. */
  knownItems(sourceId: string): Promise<KnownItem[]>;
  upsertEvent(sourceId: string, externalId: string, payload: EventPayload): Promise<unknown>;
  /** `last_run_status 'running'` and the summary so far: the trail when the platform kills the worker. */
  saveProgress(sourceId: string, summary: RunSummary): Promise<void>;
  finishSource(sourceId: string, status: RunStatus, summary: RunSummary): Promise<void>;
  /** Uploads with upsert and answers the public URL. */
  uploadImage(path: string, bytes: Uint8Array, contentType: string): Promise<string>;
  /** The public URL of `path` when the bucket serves it with exactly `size` bytes; null otherwise. */
  storedImageUrl(path: string, size: number): Promise<string | null>;
}

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface ImportDeps {
  store: ImportStore;
  fetch: Fetch;
  log: (line: string) => void;
  /** The clock of the time budget; `Date.now` when absent. */
  now?: () => number;
  /** BR-EVENTO-009 item 8: the cache, the quota and the Places API. Absent = geocoding off. */
  geocoding?: Geocoding;
  /** Why geocoding is off, for the summary (a missing secret, by name). */
  geocodingOff?: string;
}

/** Which link of a run this call is. */
export interface RunLink {
  chain: number;
  run_started_at: string;
  /** Generic sources this run already finished: later links do not read them again. */
  done?: string[];
  /** Per generic source, the last item key an earlier link started; the next one goes on after it. */
  after?: Record<string, string>;
  /** A run of this one source (a manual call with `source_id`), carried along the links. */
  only?: string;
}

export interface SourceReport {
  source_id: string;
  name: string;
  status: RunStatus;
  summary: RunSummary;
  /** False when `last_run_*` could not be written: the run happened, its record did not. */
  recorded: boolean;
  /** A generic source: it goes on by `cursor`, not by `last_seen_at`. */
  generic?: boolean;
  /** The last item key this link started, when items are left. */
  cursor?: string;
}

// ---------------------------------------------------------------------------------------------
// Text

export { decodeEntities, htmlToText, localIso } from './events-text.ts';

/** BR-EVENTO-009 item 3: the source's text as it is, then the credit line of the source as its own paragraph. */
export function buildDescription(html: unknown, creditLine: string = SPTUR_CREDIT_LINE): string {
  const body = typeof html === 'string' ? htmlToText(html) : '';
  return body ? `${body}\n\n${creditLine}` : creditLine;
}

// ---------------------------------------------------------------------------------------------
// Dates

const DAY = /^(\d{4})-(\d{2})-(\d{2})/;

interface AgendaEntry {
  inicio?: unknown;
  fim?: unknown;
  dia_todo?: unknown;
}

const dayOf = (v: unknown): string | null => (typeof v === 'string' && DAY.test(v) ? v.slice(0, 10) : null);

/** First `inicio` at 00:00 and last `fim` at 23:59:59, local; without an agenda, the list's dates. */
export function eventDates(
  agenda: unknown,
  fallback: { inicio?: unknown; fim?: unknown; dia_todo?: unknown },
  timeZone: string,
): { starts_at: string; ends_at: string | null; all_day: boolean } {
  const entries = Array.isArray(agenda) ? (agenda as AgendaEntry[]).filter((e) => dayOf(e?.inicio)) : [];
  const from = entries.length ? entries : [fallback];
  const starts = from.map((e) => dayOf(e.inicio)).filter((d): d is string => d !== null).sort();
  const ends = from.map((e) => dayOf(e.fim) ?? dayOf(e.inicio)).filter((d): d is string => d !== null).sort();
  if (!starts.length) throw new Error('missing_start_date');
  const allDay = entries.length ? entries.every((e) => e.dia_todo === true) : fallback.dia_todo === true;
  return {
    starts_at: localIso(starts[0], '00:00:00', timeZone),
    ends_at: ends.length ? localIso(ends[ends.length - 1], '23:59:59', timeZone) : null,
    all_day: allDay,
  };
}

// ---------------------------------------------------------------------------------------------
// The SPTuris reader

export interface ListItem {
  id: number | string;
  titulo?: string;
  slug: string;
  local?: string;
  inicio?: string;
  fim?: string;
  dia_todo?: boolean;
  categoria?: { slug?: string };
}

type Card = Record<string, unknown>;

function sourceFetch(deps: ImportDeps, url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  return deps.fetch(url, {
    headers: { 'User-Agent': BROWSER_USER_AGENT, Accept: 'application/json, image/*' },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function getJson(deps: ImportDeps, url: string): Promise<unknown> {
  const res = await sourceFetch(deps, url);
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`http_${res.status}`);
  }
  return await res.json();
}

const trimBase = (base: string) => base.replace(/\/+$/, '');

/** Every item of the list, page by page, until `total` is covered or a page comes back empty. */
export async function readList(deps: ImportDeps, baseUrl: string): Promise<ListItem[]> {
  const items: ListItem[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await getJson(deps, `${trimBase(baseUrl)}/api/csp/eventos?pagina=${page}&por=${PAGE_SIZE}`) as {
      total?: unknown;
      itens?: unknown;
    };
    if (!body || !Array.isArray(body.itens)) throw new Error('list_malformed');
    const fresh = (body.itens as ListItem[]).filter((it) => it && it.slug && !seen.has(String(it.id)));
    for (const it of fresh) {
      seen.add(String(it.id));
      items.push(it);
    }
    const total = typeof body.total === 'number' ? body.total : 0;
    if (fresh.length === 0 || items.length >= total) return items;
  }
  return items;
}

async function readCard(deps: ImportDeps, baseUrl: string, slug: string): Promise<Card> {
  const body = await getJson(deps, `${trimBase(baseUrl)}/api/csp/evento?slug=${encodeURIComponent(slug)}`) as Card;
  const card = (body && typeof body.dados === 'object' && body.dados !== null ? body.dados : body) as Card;
  if (!card || typeof card !== 'object' || Array.isArray(card)) throw new Error('card_malformed');
  return card;
}

/** sha256 hex of the card as received, without `hoje` (today's date, different on every run). */
export async function sourceHash(card: Card): Promise<string> {
  const { hoje: _today, ...stable } = card;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(stable)));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The `source_hash` sent to the RPC: the card's, plus whether the poster was copied. An event that
 * came in without its poster differs from the same card with it, so the next run updates it.
 */
export function payloadHash(cardHash: string, posterCopied: boolean): string {
  return `${cardHash}|${posterCopied ? 'img' : 'noimg'}`;
}

const POSTER_COPIED = '|img';

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

const safePart = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_');
const imageStem = (sourceId: string, externalId: string, imageId: string) =>
  `events/${safePart(sourceId)}/${safePart(externalId)}/${safePart(imageId)}`;

/** `events/<source id>/<external id>/<image id>.<ext>`: the same image lands on the same object. */
const imageExt = (contentType: string) =>
  contentType.includes('png') ? 'png' : contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : 'webp';

export function imagePath(sourceId: string, externalId: string, imageId: string, contentType: string): string {
  return `${imageStem(sourceId, externalId, imageId)}.${imageExt(contentType)}`;
}

/**
 * The poster already stored for this very image of the source, or null. It counts only when the last
 * run copied it (`|img`) and the stored URL is our object of this image id: then the image is not
 * fetched nor uploaded again. A new event, an image changed at the source or a `|noimg` copies.
 */
export function reusablePoster(
  known: KnownItem | undefined,
  sourceId: string,
  externalId: string,
  imageId: string,
): string | null {
  const url = known?.poster_url;
  if (!url || !known.source_hash.endsWith(POSTER_COPIED)) return null;
  const object = `/${IMAGE_BUCKET}/${imageStem(sourceId, externalId, imageId)}.`;
  const at = url.lastIndexOf(object);
  if (at < 0) return null;
  return ['webp', 'jpg', 'png'].includes(url.slice(at + object.length)) ? url : null;
}

/** Copies the first image of the card to our bucket (BR-EVENTO-009 item 5) and answers its public URL. */
async function copyImage(
  deps: ImportDeps,
  source: EventSource,
  externalId: string,
  imageId: string,
  timing: ItemTiming,
  onStep: (step: 'upload') => void,
): Promise<string> {
  return await copyImageFrom(
    deps,
    `${trimBase(source.base_url)}/api/csp/midia?id=${encodeURIComponent(imageId)}&v=grande`,
    imageStem(source.id, externalId, imageId),
    timing,
    onStep,
  );
}

/**
 * Copies the image at `url` to our bucket as `<stem>.<ext>` (BR-EVENTO-009 item 5) and answers its
 * public URL: closed list of types, size refused before buffering, upload confirmed by the object.
 */
async function copyImageFrom(
  deps: ImportDeps,
  url: string,
  stem: string,
  timing: ItemTiming,
  onStep: (step: 'upload') => void,
): Promise<string> {
  const now = deps.now ?? Date.now;
  const started = now();
  const res = await sourceFetch(deps, url, IMAGE_FETCH_TIMEOUT_MS);
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`image_http_${res.status}`);
  }
  const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  // Closed list: the bucket is public and has no MIME lock, so an SVG from a compromised source
  // would be served from our origin.
  if (!ALLOWED_IMAGE_TYPES.includes(contentType)) {
    await res.body?.cancel();
    throw new Error('image_not_an_image');
  }
  // Refuse by the declared size before buffering, so a huge body cannot exhaust the function memory.
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > MAX_IMAGE_BYTES) {
    await res.body?.cancel();
    throw new Error('image_too_large');
  }
  // The timeout signal also covers the body: a poster that trickles in is cut at the same mark.
  const bytes = new Uint8Array(await res.arrayBuffer());
  timing.image_ms = now() - started;
  if (bytes.length === 0) throw new Error('image_empty');
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('image_too_large');
  onStep('upload');
  const uploadStarted = now();
  const path = `${stem}.${imageExt(contentType)}`;
  try {
    return await deps.store.uploadImage(path, bytes, contentType);
  } catch (error) {
    // Storage was seen on 2026-11-02 writing the object in a second and answering 504 at 60 s. The
    // object is the proof of success, not the answer: served whole, it is the poster.
    const stored = await deps.store.storedImageUrl(path, bytes.length).catch(() => null);
    if (!stored) throw error;
    timing.upload_error = messageOf(error);
    return stored;
  } finally {
    timing.upload_ms = now() - uploadStarted;
  }
}

/** One list item to the payload of `core.import_event_upsert`, and the image failure if there was one. */
export async function buildPayload(
  deps: ImportDeps,
  source: EventSource,
  item: ListItem,
  timing: ItemTiming,
  onStep: (step: 'image' | 'upload') => void = () => {},
  known?: KnownItem,
): Promise<{ payload: EventPayload; imageError: string | null }> {
  const now = deps.now ?? Date.now;
  const externalId = String(item.id);
  const cardStarted = now();
  const card = await readCard(deps, source.base_url, item.slug);
  timing.card_ms = now() - cardStarted;
  const dates = eventDates(card.agenda, item, source.timezone);
  const images = Array.isArray(card.imagens) ? (card.imagens as Record<string, unknown>[]) : [];
  const first = images[0];
  let posterUrl: string | null = null;
  let credit: string | null = null;
  let imageError: string | null = null;
  if (first && first.id !== undefined && first.id !== null && first.disponivel !== false) {
    const imageId = String(first.id);
    const imageStarted = now();
    try {
      posterUrl = reusablePoster(known, source.id, externalId, imageId);
      if (posterUrl) {
        timing.poster_reused = true;
      } else {
        onStep('image');
        posterUrl = await copyImage(deps, source, externalId, imageId, timing, onStep);
      }
      // BR-EVENTO-009, edge case: an image without a credit is credited to the source.
      credit = str(first.alt) ?? SPTUR_CREDIT;
    } catch (error) {
      if (!timing.image_ms) timing.image_ms = now() - imageStarted;
      imageError = messageOf(error);
      timing.image_error = imageError;
    }
  }
  const categoria = card.categoria as { slug?: unknown } | undefined;
  const tags = Array.isArray(card.tags)
    ? (card.tags as { slug?: unknown }[]).map((t) => str(t?.slug)).filter((s): s is string => s !== null)
    : [];
  const name = str(card.titulo) ?? str(item.titulo);
  if (!name) throw new Error('missing_title');
  const payload: EventPayload = {
    name,
    description: buildDescription(card.descricao_html),
    ...dates,
    lat: num(card.lat),
    lon: num(card.lon),
    address: str(card.logradouro) ?? str(card.local) ?? str(item.local),
    website: str(card.website),
    event_category: mapCategory(categoria?.slug ?? item.categoria?.slug),
    tags,
    poster_url: posterUrl,
    image_credit: credit,
    source_url: `${trimBase(source.base_url)}/events/${encodeURIComponent(item.slug)}/`,
    source_hash: payloadHash(await sourceHash(card), posterUrl !== null),
  };
  return { payload, imageError };
}

// ---------------------------------------------------------------------------------------------
// The run

export function messageOf(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : 'unknown';
  return raw.slice(0, 300);
}

export function emptySummary(link: RunLink = { chain: 1, run_started_at: '' }): RunSummary {
  return {
    chain: link.chain,
    run_started_at: link.run_started_at,
    read: 0,
    already_seen: 0,
    pending: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    linked: 0,
    skipped_deleted: 0,
    skipped: 0,
    skipped_reasons: {},
    errors: [],
    in_flight: [],
    timings: [],
  };
}

/** What `import_event_upsert` answers: the row, or a one-row array of it. */
export function readAction(data: unknown): ImportAction {
  const row = Array.isArray(data) ? data[0] : data;
  const action = (row as { action?: unknown } | null)?.action;
  if (typeof action === 'string' && (ACTIONS as readonly string[]).includes(action)) return action as ImportAction;
  throw new Error('rpc_unexpected_answer');
}

/**
 * Runs `work` over `items`, `size` at a time, starting an item only while `mayStart()` holds.
 * Answers how many were started.
 */
export async function pool<T>(
  items: T[],
  size: number,
  mayStart: () => boolean,
  work: (item: T) => Promise<void>,
): Promise<number> {
  let next = 0;
  const worker = async () => {
    while (next < items.length && mayStart()) await work(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return next;
}

/**
 * Writes the summary as it goes, one write at a time; a write asked while another is in flight is
 * folded into the next one, which always carries the latest state. `flush` waits for the last.
 */
function progressWriter(deps: ImportDeps, source: EventSource, summary: RunSummary) {
  let writing: Promise<void> | null = null;
  let dirty = false;
  const run = async () => {
    while (dirty) {
      dirty = false;
      try {
        await deps.store.saveProgress(source.id, structuredClone(summary));
      } catch (error) {
        deps.log(`[events-import] ${source.id} progress not recorded: ${messageOf(error)}`);
      }
    }
    writing = null;
  };
  return {
    mark() {
      dirty = true;
      if (!writing) writing = run();
    },
    async flush() {
      while (writing) await writing;
    },
  };
}

export interface SourceRun {
  status: RunStatus;
  summary: RunSummary;
  /** Generic sources only: the last item key started, when items are left. */
  cursor?: string;
}

export function importSource(
  deps: ImportDeps,
  source: EventSource,
  link: RunLink = { chain: 1, run_started_at: new Date((deps.now ?? Date.now)()).toISOString() },
  deadline = (deps.now ?? Date.now)() + RUN_BUDGET_MS,
): Promise<SourceRun> {
  if (source.adapter === 'sptur_csp') return importSptur(deps, source, link, deadline);
  if (GENERIC_ADAPTERS.includes(source.adapter)) return importGeneric(deps, source, link, deadline);
  const summary = emptySummary(link);
  summary.errors.push({ external_id: null, message: `unknown_adapter:${source.adapter}` });
  return Promise.resolve({ status: 'error', summary });
}

/** The SPTuris run (#1075), unchanged: the list, then the card of each item. */
async function importSptur(
  deps: ImportDeps,
  source: EventSource,
  link: RunLink,
  deadline: number,
): Promise<SourceRun> {
  const now = deps.now ?? Date.now;
  const summary = emptySummary(link);
  if (!/^https:\/\//.test(source.base_url ?? '')) {
    summary.errors.push({ external_id: null, message: 'invalid_base_url' });
    return { status: 'error', summary };
  }
  let items: ListItem[];
  let known: Map<string, KnownItem>;
  try {
    items = await readList(deps, source.base_url);
  } catch (error) {
    summary.errors.push({ external_id: null, message: `list: ${messageOf(error)}` });
    return { status: 'error', summary };
  }
  try {
    known = new Map((await deps.store.knownItems(source.id)).map((k) => [k.external_id, k]));
  } catch (error) {
    summary.errors.push({ external_id: null, message: `known_items: ${messageOf(error)}` });
    return { status: 'error', summary };
  }
  summary.read = items.length;
  // An earlier link of this run already upserted these: this link starts with the ones it did not.
  const startedAt = Date.parse(link.run_started_at);
  const todo = items.filter((item) => {
    const seen = known.get(String(item.id));
    return !(seen && Date.parse(seen.last_seen_at) > startedAt);
  });
  summary.already_seen = items.length - todo.length;

  const progress = progressWriter(deps, source, summary);
  const inFlight = new Map<string, string>();
  const step = (externalId: string, name: string) => {
    inFlight.set(externalId, name);
    summary.in_flight = [...inFlight].map(([id, s]) => `${id}:${s}`);
    progress.mark();
  };

  const started = await pool(todo, CONCURRENCY, () => now() < deadline, async (item) => {
    const externalId = String(item.id);
    const timing: ItemTiming = { external_id: externalId, card_ms: 0, image_ms: 0, upload_ms: 0, rpc_ms: 0 };
    step(externalId, 'card');
    try {
      const before = known.get(externalId);
      const { payload, imageError } = await buildPayload(
        deps,
        source,
        item,
        timing,
        (s) => step(externalId, s),
        before,
      );
      if (imageError && before?.source_hash.endsWith(POSTER_COPIED)) {
        // The RPC writes poster_url as sent, null included: an event that has its poster keeps it,
        // and keeps the version before this run, until the image copies again.
        summary.errors.push({ external_id: externalId, message: `image: ${imageError}; stored event kept` });
      } else {
        if (imageError) summary.errors.push({ external_id: externalId, message: `image: ${imageError}` });
        step(externalId, 'rpc');
        const rpcStarted = now();
        const answer = await deps.store.upsertEvent(source.id, externalId, payload);
        timing.rpc_ms = now() - rpcStarted;
        summary[readAction(answer)] += 1;
      }
    } catch (error) {
      summary.errors.push({ external_id: externalId, message: messageOf(error) });
    } finally {
      inFlight.delete(externalId);
      summary.in_flight = [...inFlight].map(([id, s]) => `${id}:${s}`);
      summary.timings.push(timing);
      if (summary.timings.length > MAX_TIMINGS) summary.timings.shift();
      progress.mark();
    }
  });
  await progress.flush();
  summary.pending = todo.length - started;
  return { status: summary.pending > 0 || summary.errors.length ? 'partial' : 'ok', summary };
}

// ---------------------------------------------------------------------------------------------
// The generic run (#1077)

/** One item of a generic source: a record already mapped, or a jsonld page still to read. */
interface GenericItem {
  key: string;
  record?: Rec;
  event?: MappedEvent;
}

const skip = (summary: RunSummary, reason: string) => {
  summary.skipped += 1;
  summary.skipped_reasons[reason] = (summary.skipped_reasons[reason] ?? 0) + 1;
};

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A text getter with the browser User-Agent; `http_<status>` on an answer that is not ok. */
export function textGetter(deps: ImportDeps) {
  return async (url: string): Promise<string> => {
    const res = await deps.fetch(url, {
      headers: {
        'User-Agent': BROWSER_USER_AGENT,
        Accept: 'application/json, application/geo+json, text/csv, text/html, application/xml;q=0.9, */*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`http_${res.status}`);
    }
    return await res.text();
  };
}

/** The items of a generic source: records filtered and mapped, or the page URLs of a jsonld source. */
async function planGeneric(deps: ImportDeps, source: EventSource, summary: RunSummary): Promise<GenericItem[]> {
  const get = textGetter(deps);
  const nowMs = (deps.now ?? Date.now)();
  if (source.adapter === 'jsonld') {
    const pages = await discoverPages((source.config?.fetch ?? {}) as Rec, get);
    summary.read = pages.length;
    return pages.map((key) => ({ key }));
  }
  const records = await readRecords(source, get);
  summary.read = records.length;
  const items = new Map<string, GenericItem>();
  for (const record of records) {
    // BR-EVENTO-009 item 7: what the fetch could not narrow to the city is dropped here.
    if (!passesFilter(record, source.config?.filter)) {
      skip(summary, 'filtered');
      continue;
    }
    const mapped = mapRecord(source, record, nowMs);
    if ('skip' in mapped) {
      skip(summary, mapped.skip);
      continue;
    }
    if (items.has(mapped.event.external_id)) {
      skip(summary, 'duplicate');
      continue;
    }
    items.set(mapped.event.external_id, { key: mapped.event.external_id, record, event: mapped.event });
  }
  return [...items.values()];
}

type GenericBuild = { payload: EventPayload; imageError: string | null } | { skip: string };

/** One generic item to the payload of `core.import_event_upsert`, or the reason it does not go. */
async function buildGenericPayload(
  deps: ImportDeps,
  source: EventSource,
  item: GenericItem,
  timing: ItemTiming,
  onStep: (step: 'page' | 'geocode' | 'image' | 'upload') => void,
  known: KnownItem | undefined,
  geocode: ((address: string | null, city: string, country: string) => Promise<GeocodeAnswer>) | null,
): Promise<GenericBuild> {
  const now = deps.now ?? Date.now;
  let record = item.record;
  let event = item.event;
  if (!record || !event) {
    // jsonld: the page is the item; its first schema.org Event is the record.
    onStep('page');
    const pageStarted = now();
    const html = await textGetter(deps)(item.key);
    timing.card_ms = now() - pageStarted;
    const node = extractEvent(html);
    if (!node) return { skip: 'no_event_jsonld' };
    if (!passesFilter(node, source.config?.filter, item.key)) return { skip: 'filtered' };
    const mapped = mapRecord(source, node, now(), item.key);
    if ('skip' in mapped) return mapped;
    record = node;
    // The page URL is the key the run walks by, so it is the external id too.
    event = { ...mapped.event, external_id: item.key };
  }
  const sourceUrl = event.url;
  if (!sourceUrl) return { skip: 'missing_url' };
  const recordHash = await sourceHash(record);

  // BR-EVENTO-009 item 8: no coordinate at the source, the one of the published address. An item
  // already stored and unchanged keeps the coordinate it has (null lat/lon leaves it, D8 of #1075).
  let lat = event.lat;
  let lon = event.lon;
  const unchanged = known !== undefined && known.source_hash.split('|')[0] === recordHash;
  if (lat === null && !unchanged) {
    if (!geocode) return { skip: 'geocode_off' };
    onStep('geocode');
    const answer = await geocode(event.address, source.city ?? '', source.country ?? '');
    if ('skip' in answer) return answer;
    lat = answer.lat;
    lon = answer.lon;
  }

  let posterUrl: string | null = null;
  let credit: string | null = null;
  let imageError: string | null = null;
  const creditLine = source.credit ?? SPTUR_CREDIT_LINE;
  if (event.image) {
    const imageId = (await sha256Hex(event.image)).slice(0, 16);
    const imageStarted = now();
    try {
      posterUrl = reusablePoster(known, source.id, event.external_id, imageId);
      if (posterUrl) {
        timing.poster_reused = true;
      } else {
        onStep('image');
        posterUrl = await copyImageFrom(
          deps,
          event.image,
          imageStem(source.id, event.external_id, imageId),
          timing,
          onStep,
        );
      }
      // BR-EVENTO-009, edge case: an image without a credit is credited to the source, in the line of item 3.
      credit = event.image_credit ?? creditLine;
    } catch (error) {
      if (!timing.image_ms) timing.image_ms = now() - imageStarted;
      imageError = messageOf(error);
      timing.image_error = imageError;
    }
  }

  const payload: EventPayload = {
    name: event.name,
    description: buildDescription(event.description, creditLine),
    starts_at: event.starts_at,
    ends_at: event.ends_at,
    all_day: event.all_day,
    lat,
    lon,
    address: event.address,
    website: null,
    event_category: event.category,
    tags: [],
    poster_url: posterUrl,
    image_credit: credit,
    source_url: sourceUrl,
    source_hash: payloadHash(recordHash, posterUrl !== null),
  };
  if (source.config?.language) payload.language = source.config.language;
  if (event.is_free !== undefined) payload.is_free = event.is_free;
  return { payload, imageError };
}

async function importGeneric(
  deps: ImportDeps,
  source: EventSource,
  link: RunLink,
  deadline: number,
): Promise<SourceRun> {
  const now = deps.now ?? Date.now;
  const summary = emptySummary(link);
  const after = link.after?.[source.id];
  // Out of time before this source started: nothing read, the next link starts it.
  if (now() >= deadline) {
    summary.pending = 1;
    summary.errors.push({ external_id: null, message: 'not_started: time budget spent by earlier sources' });
    return { status: 'partial', summary, cursor: after };
  }
  if (!source.config?.fetch) {
    summary.errors.push({ external_id: null, message: 'config_missing:fetch' });
    return { status: 'error', summary };
  }
  let items: GenericItem[];
  let known: Map<string, KnownItem>;
  try {
    items = await planGeneric(deps, source, summary);
  } catch (error) {
    summary.errors.push({ external_id: null, message: `list: ${messageOf(error)}` });
    return { status: 'error', summary };
  }
  try {
    known = new Map((await deps.store.knownItems(source.id)).map((k) => [k.external_id, k]));
  } catch (error) {
    summary.errors.push({ external_id: null, message: `known_items: ${messageOf(error)}` });
    return { status: 'error', summary };
  }
  // The keys in one order, so a later link goes on after the last key this one started.
  items.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  const startedAt = Date.parse(link.run_started_at);
  const todo = items.filter((item) => {
    if (after !== undefined && item.key <= after) return false;
    const seen = known.get(item.key);
    return !(seen && Date.parse(seen.last_seen_at) > startedAt);
  });
  summary.already_seen = items.length - todo.length;

  const geocode = deps.geocoding ? geocoder(deps.geocoding, now) : null;
  if (!geocode && deps.geocodingOff) {
    summary.errors.push({ external_id: null, message: `geocoding off: ${deps.geocodingOff}` });
  }

  const progress = progressWriter(deps, source, summary);
  const inFlight = new Map<string, string>();
  const step = (key: string, name: string) => {
    inFlight.set(key, name);
    summary.in_flight = [...inFlight].map(([id, s]) => `${id}:${s}`);
    progress.mark();
  };

  const started = await pool(todo, CONCURRENCY, () => now() < deadline, async (item) => {
    const timing: ItemTiming = { external_id: item.key, card_ms: 0, image_ms: 0, upload_ms: 0, rpc_ms: 0 };
    step(item.key, 'start');
    try {
      const before = known.get(item.key);
      const built = await buildGenericPayload(deps, source, item, timing, (s) => step(item.key, s), before, geocode);
      if ('skip' in built) {
        skip(summary, built.skip);
      } else if (built.imageError && before?.source_hash.endsWith(POSTER_COPIED)) {
        summary.errors.push({ external_id: item.key, message: `image: ${built.imageError}; stored event kept` });
      } else {
        if (built.imageError) summary.errors.push({ external_id: item.key, message: `image: ${built.imageError}` });
        step(item.key, 'rpc');
        const rpcStarted = now();
        const answer = await deps.store.upsertEvent(source.id, item.key, built.payload);
        timing.rpc_ms = now() - rpcStarted;
        summary[readAction(answer)] += 1;
      }
    } catch (error) {
      summary.errors.push({ external_id: item.key, message: messageOf(error) });
    } finally {
      inFlight.delete(item.key);
      summary.in_flight = [...inFlight].map(([id, s]) => `${id}:${s}`);
      summary.timings.push(timing);
      if (summary.timings.length > MAX_TIMINGS) summary.timings.shift();
      progress.mark();
    }
  });
  await progress.flush();
  summary.pending = todo.length - started;
  // A long run keeps only the first errors, so the summary stays small.
  if (summary.errors.length > MAX_ERRORS) summary.errors.splice(MAX_ERRORS);
  return {
    status: summary.pending > 0 || summary.errors.length ? 'partial' : 'ok',
    summary,
    cursor: summary.pending > 0 && started > 0 ? todo[started - 1].key : (summary.pending > 0 ? after : undefined),
  };
}

export async function runEventsImport(deps: ImportDeps, link?: RunLink): Promise<SourceReport[]> {
  const now = deps.now ?? Date.now;
  const deadline = now() + RUN_BUDGET_MS;
  const thisLink = link ?? { chain: 1, run_started_at: new Date(now()).toISOString() };
  const sources = await deps.store.activeSources();
  const reports: SourceReport[] = [];
  for (const source of sources) {
    // A generic source an earlier link of this run finished is not read again.
    if (thisLink.done?.includes(source.id)) continue;
    if (thisLink.only && source.id !== thisLink.only) continue;
    const { status, summary, cursor } = await importSource(deps, source, thisLink, deadline);
    let recorded = true;
    try {
      await deps.store.finishSource(source.id, status, summary);
    } catch (error) {
      recorded = false;
      deps.log(`[events-import] ${source.id} last_run not recorded: ${messageOf(error)}`);
    }
    const { errors, timings: _timings, in_flight: _inFlight, ...counts } = summary;
    deps.log(`[events-import] ${source.id} ${status} ${JSON.stringify({ ...counts, errors: errors.length })}`);
    const report: SourceReport = { source_id: source.id, name: source.name, status, summary, recorded };
    if (GENERIC_ADAPTERS.includes(source.adapter)) {
      report.generic = true;
      if (cursor !== undefined) report.cursor = cursor;
    }
    reports.push(report);
  }
  return reports;
}

/** The link to call next: when some source ran out of time and the run has links left. */
export function nextLink(reports: SourceReport[], link: RunLink): RunLink | null {
  if (!reports.some((r) => r.summary.pending > 0)) return null;
  if (link.chain >= MAX_CHAIN_LINKS) return null;
  const next: RunLink = { chain: link.chain + 1, run_started_at: link.run_started_at };
  const done = [
    ...(link.done ?? []),
    ...reports.filter((r) => r.generic && r.summary.pending === 0).map((r) => r.source_id),
  ];
  const after: Record<string, string> = {};
  for (const r of reports) {
    if (r.generic && r.summary.pending > 0 && r.cursor !== undefined) after[r.source_id] = r.cursor;
  }
  if (link.only) next.only = link.only;
  if (done.length) next.done = done;
  if (Object.keys(after).length) next.after = after;
  return next;
}

const MAX_LINK_SOURCES = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const MAX_CURSOR_LENGTH = 2048;

/** The body of a chained call, checked: `null` when absent (first link), an error code when malformed. */
export function readLink(body: unknown, nowMs: number): RunLink | null | 'invalid_chain' {
  const b = (body ?? {}) as {
    chain?: unknown;
    run_started_at?: unknown;
    done?: unknown;
    after?: unknown;
    only?: unknown;
  };
  if (b.chain === undefined && b.run_started_at === undefined) return null;
  const chain = b.chain;
  const startedAt = typeof b.run_started_at === 'string' ? Date.parse(b.run_started_at) : NaN;
  const valid = typeof chain === 'number' && Number.isInteger(chain) && chain >= 2 && chain <= MAX_CHAIN_LINKS &&
    Number.isFinite(startedAt) && startedAt <= nowMs && nowMs - startedAt <= MAX_CHAIN_LINKS * 5 * 60_000;
  if (!valid) return 'invalid_chain';
  const link: RunLink = { chain: chain as number, run_started_at: new Date(startedAt).toISOString() };
  const id = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 64;
  if (b.only !== undefined) {
    if (!isUuid(b.only)) return 'invalid_chain';
    link.only = b.only as string;
  }
  if (b.done !== undefined) {
    if (!Array.isArray(b.done) || b.done.length > MAX_LINK_SOURCES || !b.done.every(id)) return 'invalid_chain';
    link.done = b.done as string[];
  }
  if (b.after !== undefined) {
    if (!b.after || typeof b.after !== 'object' || Array.isArray(b.after)) return 'invalid_chain';
    const entries = Object.entries(b.after as Record<string, unknown>);
    const ok = entries.length <= MAX_LINK_SOURCES &&
      entries.every(([k, v]) => id(k) && typeof v === 'string' && v.length > 0 && v.length <= MAX_CURSOR_LENGTH);
    if (!ok) return 'invalid_chain';
    link.after = Object.fromEntries(entries) as Record<string, string>;
  }
  return link;
}
