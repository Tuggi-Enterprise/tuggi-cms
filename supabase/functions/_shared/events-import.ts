// _shared/events-import.ts
//
// The weekly import of events from official tourism sources (#1075, BR-EVENTO-009). One source is a
// row of `core.event_sources`; its `adapter` names the reader. The only reader today is `sptur_csp`,
// the API behind https://cidadedesaopaulo.com/calendario-de-eventos/ (SPTuris, city of São Paulo).
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
export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

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
  errors: RunError[];
  /** `<external_id>:<step>` of the items being processed when the summary was written. */
  in_flight: string[];
  timings: ItemTiming[];
}

export type RunStatus = 'ok' | 'partial' | 'error';

/** What `core.event_source_items` knows of one item of a source. */
export interface KnownItem {
  external_id: string;
  source_hash: string;
  last_seen_at: string;
}

export interface ImportStore {
  activeSources(): Promise<EventSource[]>;
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
}

/** Which link of a run this call is. */
export interface RunLink {
  chain: number;
  run_started_at: string;
}

export interface SourceReport {
  source_id: string;
  name: string;
  status: RunStatus;
  summary: RunSummary;
  /** False when `last_run_*` could not be written: the run happened, its record did not. */
  recorded: boolean;
}

// ---------------------------------------------------------------------------------------------
// Text

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  ordm: 'º',
  ordf: 'ª',
  deg: '°',
  copy: '©',
  reg: '®',
  middot: '·',
  bull: '•',
  euro: '€',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

const BLOCK_TAG = /<\/?(p|div|h[1-6]|ul|ol|li|blockquote|section|article|table|tr)\b[^>]*>/gi;

/** HTML to plain text: one paragraph per block, `\n` for `<br>`, no tag, entities decoded. */
export function htmlToText(html: string): string {
  const marked = html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\u0001')
    .replace(/<li\b[^>]*>/gi, '\u0002• ')
    .replace(BLOCK_TAG, '\u0002')
    .replace(/<[^>]*>/g, '');
  return decodeEntities(marked)
    .split('\u0002')
    .map((block) =>
      block
        .split('\u0001')
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter((line) => line.length > 0)
        .join('\n')
    )
    .filter((block) => block.length > 0)
    .join('\n\n');
}

/** BR-EVENTO-009 item 3: the source's text as it is, then the credit line as its own paragraph. */
export function buildDescription(html: unknown): string {
  const body = typeof html === 'string' ? htmlToText(html) : '';
  return body ? `${body}\n\n${SPTUR_CREDIT_LINE}` : SPTUR_CREDIT_LINE;
}

// ---------------------------------------------------------------------------------------------
// Dates

const DAY = /^(\d{4})-(\d{2})-(\d{2})/;

/** Offset of `timeZone` at the instant `ms`, in minutes east of UTC. */
function offsetMinutes(timeZone: string, ms: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/**
 * The local wall time `day` + `time` in `timeZone`, as ISO 8601 with that zone's offset on that day
 * (`2026-11-06T00:00:00-03:00`). Throws on a value that does not start with a YYYY-MM-DD day.
 */
export function localIso(day: string, time: '00:00:00' | '23:59:59', timeZone: string): string {
  const m = DAY.exec(day);
  if (!m) throw new Error(`invalid_date:${day}`);
  const [h, mi, s] = time.split(':').map(Number);
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), h, mi, s);
  // The offset at the wall time read as UTC is a guess; read it again at the instant it points to.
  const first = offsetMinutes(timeZone, wall);
  const offset = offsetMinutes(timeZone, wall - first * 60_000);
  return `${m[1]}-${m[2]}-${m[3]}T${time}${formatOffset(offset)}`;
}

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

/** `events/<source id>/<external id>/<image id>.<ext>`: the same image lands on the same object. */
export function imagePath(sourceId: string, externalId: string, imageId: string, contentType: string): string {
  const ext = contentType.includes('png')
    ? 'png'
    : contentType.includes('jpeg') || contentType.includes('jpg')
    ? 'jpg'
    : 'webp';
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `events/${safe(sourceId)}/${safe(externalId)}/${safe(imageId)}.${ext}`;
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
  const now = deps.now ?? Date.now;
  const started = now();
  const res = await sourceFetch(
    deps,
    `${trimBase(source.base_url)}/api/csp/midia?id=${encodeURIComponent(imageId)}&v=grande`,
    IMAGE_FETCH_TIMEOUT_MS,
  );
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
  const path = imagePath(source.id, externalId, imageId, contentType);
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
    const imageStarted = now();
    try {
      onStep('image');
      posterUrl = await copyImage(deps, source, externalId, String(first.id), timing, onStep);
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

export async function importSource(
  deps: ImportDeps,
  source: EventSource,
  link: RunLink = { chain: 1, run_started_at: new Date((deps.now ?? Date.now)()).toISOString() },
  deadline = (deps.now ?? Date.now)() + RUN_BUDGET_MS,
): Promise<{ status: RunStatus; summary: RunSummary }> {
  const now = deps.now ?? Date.now;
  const summary = emptySummary(link);
  if (source.adapter !== 'sptur_csp') {
    summary.errors.push({ external_id: null, message: `unknown_adapter:${source.adapter}` });
    return { status: 'error', summary };
  }
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
      const { payload, imageError } = await buildPayload(deps, source, item, timing, (s) => step(externalId, s));
      const before = known.get(externalId);
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

export async function runEventsImport(deps: ImportDeps, link?: RunLink): Promise<SourceReport[]> {
  const now = deps.now ?? Date.now;
  const deadline = now() + RUN_BUDGET_MS;
  const thisLink = link ?? { chain: 1, run_started_at: new Date(now()).toISOString() };
  const sources = await deps.store.activeSources();
  const reports: SourceReport[] = [];
  for (const source of sources) {
    const { status, summary } = await importSource(deps, source, thisLink, deadline);
    let recorded = true;
    try {
      await deps.store.finishSource(source.id, status, summary);
    } catch (error) {
      recorded = false;
      deps.log(`[events-import] ${source.id} last_run not recorded: ${messageOf(error)}`);
    }
    const { errors, timings: _timings, in_flight: _inFlight, ...counts } = summary;
    deps.log(`[events-import] ${source.id} ${status} ${JSON.stringify({ ...counts, errors: errors.length })}`);
    reports.push({ source_id: source.id, name: source.name, status, summary, recorded });
  }
  return reports;
}

/** The link to call next: when some source ran out of time and the run has links left. */
export function nextLink(reports: SourceReport[], link: RunLink): RunLink | null {
  if (!reports.some((r) => r.summary.pending > 0)) return null;
  if (link.chain >= MAX_CHAIN_LINKS) return null;
  return { chain: link.chain + 1, run_started_at: link.run_started_at };
}

/** The body of a chained call, checked: `null` when absent (first link), an error code when malformed. */
export function readLink(body: unknown, nowMs: number): RunLink | null | 'invalid_chain' {
  const b = (body ?? {}) as { chain?: unknown; run_started_at?: unknown };
  if (b.chain === undefined && b.run_started_at === undefined) return null;
  const chain = b.chain;
  const startedAt = typeof b.run_started_at === 'string' ? Date.parse(b.run_started_at) : NaN;
  const valid = typeof chain === 'number' && Number.isInteger(chain) && chain >= 2 && chain <= MAX_CHAIN_LINKS &&
    Number.isFinite(startedAt) && startedAt <= nowMs && nowMs - startedAt <= MAX_CHAIN_LINKS * 5 * 60_000;
  return valid ? { chain: chain as number, run_started_at: new Date(startedAt).toISOString() } : 'invalid_chain';
}
