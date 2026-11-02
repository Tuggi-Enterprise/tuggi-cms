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
export const FETCH_TIMEOUT_MS = 20_000;
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

export interface RunSummary {
  read: number;
  created: number;
  updated: number;
  unchanged: number;
  linked: number;
  skipped_deleted: number;
  errors: RunError[];
}

export type RunStatus = 'ok' | 'partial' | 'error';

export interface ImportStore {
  activeSources(): Promise<EventSource[]>;
  upsertEvent(sourceId: string, externalId: string, payload: EventPayload): Promise<unknown>;
  finishSource(sourceId: string, status: RunStatus, summary: RunSummary): Promise<void>;
  /** Uploads with upsert and answers the public URL. */
  uploadImage(path: string, bytes: Uint8Array, contentType: string): Promise<string>;
}

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface ImportDeps {
  store: ImportStore;
  fetch: Fetch;
  log: (line: string) => void;
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

function sourceFetch(deps: ImportDeps, url: string): Promise<Response> {
  return deps.fetch(url, {
    headers: { 'User-Agent': BROWSER_USER_AGENT, Accept: 'application/json, image/*' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
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
): Promise<string> {
  const res = await sourceFetch(
    deps,
    `${trimBase(source.base_url)}/api/csp/midia?id=${encodeURIComponent(imageId)}&v=grande`,
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
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length === 0) throw new Error('image_empty');
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('image_too_large');
  return await deps.store.uploadImage(imagePath(source.id, externalId, imageId, contentType), bytes, contentType);
}

/** One list item to the payload of `core.import_event_upsert`. Image failures land in `errors`. */
export async function buildPayload(
  deps: ImportDeps,
  source: EventSource,
  item: ListItem,
  errors: RunError[],
): Promise<EventPayload> {
  const externalId = String(item.id);
  const card = await readCard(deps, source.base_url, item.slug);
  const dates = eventDates(card.agenda, item, source.timezone);
  const images = Array.isArray(card.imagens) ? (card.imagens as Record<string, unknown>[]) : [];
  const first = images[0];
  let posterUrl: string | null = null;
  let credit: string | null = null;
  if (first && first.id !== undefined && first.id !== null && first.disponivel !== false) {
    try {
      posterUrl = await copyImage(deps, source, externalId, String(first.id));
      // BR-EVENTO-009, edge case: an image without a credit is credited to the source.
      credit = str(first.alt) ?? SPTUR_CREDIT;
    } catch (error) {
      errors.push({ external_id: externalId, message: `image: ${messageOf(error)}` });
    }
  }
  const categoria = card.categoria as { slug?: unknown } | undefined;
  const tags = Array.isArray(card.tags)
    ? (card.tags as { slug?: unknown }[]).map((t) => str(t?.slug)).filter((s): s is string => s !== null)
    : [];
  const name = str(card.titulo) ?? str(item.titulo);
  if (!name) throw new Error('missing_title');
  return {
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
    source_hash: await sourceHash(card),
  };
}

// ---------------------------------------------------------------------------------------------
// The run

export function messageOf(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : 'unknown';
  return raw.slice(0, 300);
}

export function emptySummary(): RunSummary {
  return { read: 0, created: 0, updated: 0, unchanged: 0, linked: 0, skipped_deleted: 0, errors: [] };
}

/** What `import_event_upsert` answers: the row, or a one-row array of it. */
export function readAction(data: unknown): ImportAction {
  const row = Array.isArray(data) ? data[0] : data;
  const action = (row as { action?: unknown } | null)?.action;
  if (typeof action === 'string' && (ACTIONS as readonly string[]).includes(action)) return action as ImportAction;
  throw new Error('rpc_unexpected_answer');
}

export async function importSource(
  deps: ImportDeps,
  source: EventSource,
): Promise<{ status: RunStatus; summary: RunSummary }> {
  const summary = emptySummary();
  if (source.adapter !== 'sptur_csp') {
    summary.errors.push({ external_id: null, message: `unknown_adapter:${source.adapter}` });
    return { status: 'error', summary };
  }
  if (!/^https:\/\//.test(source.base_url ?? '')) {
    summary.errors.push({ external_id: null, message: 'invalid_base_url' });
    return { status: 'error', summary };
  }
  let items: ListItem[];
  try {
    items = await readList(deps, source.base_url);
  } catch (error) {
    summary.errors.push({ external_id: null, message: `list: ${messageOf(error)}` });
    return { status: 'error', summary };
  }
  summary.read = items.length;
  for (const item of items) {
    const externalId = String(item.id);
    try {
      const payload = await buildPayload(deps, source, item, summary.errors);
      const action = readAction(await deps.store.upsertEvent(source.id, externalId, payload));
      summary[action] += 1;
    } catch (error) {
      summary.errors.push({ external_id: externalId, message: messageOf(error) });
    }
  }
  return { status: summary.errors.length ? 'partial' : 'ok', summary };
}

export async function runEventsImport(deps: ImportDeps): Promise<SourceReport[]> {
  const sources = await deps.store.activeSources();
  const reports: SourceReport[] = [];
  for (const source of sources) {
    const { status, summary } = await importSource(deps, source);
    let recorded = true;
    try {
      await deps.store.finishSource(source.id, status, summary);
    } catch (error) {
      recorded = false;
      deps.log(`[events-import] ${source.id} last_run not recorded: ${messageOf(error)}`);
    }
    const { errors, ...counts } = summary;
    deps.log(`[events-import] ${source.id} ${status} ${JSON.stringify({ ...counts, errors: errors.length })}`);
    reports.push({ source_id: source.id, name: source.name, status, summary, recorded });
  }
  return reports;
}
