// _shared/events-sources.ts
//
// The generic readers of the events import (#1077, BR-EVENTO-009): opendatasoft, ckan, file, jsonld,
// and since #1089 wp_rest (WordPress REST) and mapas_culturais (the Mapas Culturais API). Each turns one row of `core.event_sources` into records, and every record goes through the
// same field map of `config.fields` (the grammar is COMMENT ON COLUMN core.event_sources.config,
// migration 20261103120000). Pure apart from the `get` it receives, so the Deno tests drive it with
// answers recorded from the real sources.

import { decodeEntities, htmlToText, localIso, offsetMinutes } from './events-text.ts';

/** `EVENT_CATEGORIES` of `components/event-management/EventFormModal.tsx`, what import_event_upsert accepts. */
export const CMS_CATEGORIES = [
  'music',
  'sports',
  'festival',
  'theatre',
  'exhibition',
  'kids',
  'conference',
  'fair',
  'other',
] as const;
export type CmsCategory = typeof CMS_CATEGORIES[number];

export type FieldSpec =
  | string
  | FieldSpec[]
  | { join: FieldSpec[]; sep?: string }
  | { template: string }
  | { date: FieldSpec }
  | { path: FieldSpec; free_values: string[] };

export interface SourceFilter {
  field: FieldSpec;
  op: 'eq' | 'in' | 'not_in';
  value: unknown;
  /** Compare lower case: the Mapas Culturais of Ceará writes the same city "Fortaleza" and "FORTALEZA" (#1089). */
  ignore_case?: boolean;
}

export interface SourceConfig {
  version?: number;
  language?: string;
  fetch?: Record<string, unknown>;
  filter?: SourceFilter[];
  fields?: Record<string, FieldSpec>;
  category?: { rules?: [string, string][]; default?: string };
}

export type Rec = Record<string, unknown>;

/** What the generic readers need of a source row. */
export interface GenericSource {
  adapter: string;
  timezone: string;
  config?: SourceConfig | null;
}

/** Reads a URL and answers its body as text; throws `http_<status> <host>` on an answer that is not ok. */
export type GetText = (url: string) => Promise<string>;

/** No reader walks more pages than this, whatever the source says its total is. */
export const MAX_READER_PAGES = 400;
/** ODS v2.1 refuses `offset + limit` above 10,000 on `/records`. */
export const ODS_MAX_WINDOW = 10_000;
export const MAX_SITEMAPS = 50;
export const MAX_PAGE_URLS = 5_000;

// ---------------------------------------------------------------------------------------------
// Values

/** Placeholders the open-data portals write for an empty cell (Montreal "nan", Barcelona "None"). */
const EMPTY_TOKENS = new Set(['', 'nan', 'null', 'none', 'undefined']);

/** Trimmed, BOM removed, empty and placeholder values as `undefined`. */
export function clean(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') {
    const v = value.replace(/﻿/g, '').trim();
    return EMPTY_TOKENS.has(v.toLowerCase()) ? undefined : v;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const items = value.map(clean).filter((v) => v !== undefined);
    return items.length ? items : undefined;
  }
  return value;
}

/** `a.b.0.c`: object keys and array indexes. */
export function getPath(record: unknown, path: string): unknown {
  let cur: unknown = record;
  for (const seg of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      if (!/^\d+$/.test(seg)) return undefined;
      cur = cur[Number(seg)];
    } else if (typeof cur === 'object') {
      cur = (cur as Rec)[seg];
    } else {
      return undefined;
    }
  }
  return cur;
}

export const PAGE_URL = '$page_url';

export function textOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

/** The value a field spec points to in `record`, or `undefined`. */
export function resolveSpec(record: Rec, spec: FieldSpec | undefined, pageUrl?: string): unknown {
  if (spec === undefined || spec === null) return undefined;
  if (typeof spec === 'string') return spec === PAGE_URL ? clean(pageUrl) : clean(getPath(record, spec));
  if (Array.isArray(spec)) {
    for (const option of spec) {
      const v = resolveSpec(record, option, pageUrl);
      if (v !== undefined) return v;
    }
    return undefined;
  }
  if ('join' in spec) {
    const parts = spec.join
      .map((p) => textOf(resolveSpec(record, p, pageUrl)))
      .filter((p): p is string => p !== undefined && p !== '');
    return parts.length ? parts.join(spec.sep ?? ', ') : undefined;
  }
  if ('template' in spec) {
    let missing = false;
    const out = spec.template.replace(/\{([^}]+)\}/g, (_whole, path: string) => {
      const v = textOf(resolveSpec(record, path.trim(), pageUrl));
      if (v === undefined) missing = true;
      return v === undefined ? '' : encodeURIComponent(v).replace(/%2F/gi, '/');
    });
    return missing ? undefined : out;
  }
  if ('date' in spec) {
    // The day of a timestamp that only means a day (Málaga writes "21/11/2026 00:00:00" for every
    // event, #1084): what comes before the time, so the event is all day in the source zone.
    const v = textOf(resolveSpec(record, spec.date, pageUrl));
    return v === undefined ? undefined : clean(v.split(/[T ]/)[0]);
  }
  if ('path' in spec) return resolveSpec(record, spec.path, pageUrl);
  return undefined;
}

const textField = (record: Rec, spec: FieldSpec | undefined, pageUrl?: string): string | null => {
  const v = textOf(resolveSpec(record, spec, pageUrl));
  return v === undefined || v === '' ? null : v;
};

/** `is_free` only when the source says it: a boolean as is, or the value compared with `free_values`. */
export function resolveIsFree(record: Rec, spec: FieldSpec | undefined, pageUrl?: string): boolean | undefined {
  if (spec === undefined) return undefined;
  const v = resolveSpec(record, spec, pageUrl);
  if (v === undefined) return undefined;
  if (typeof spec === 'object' && !Array.isArray(spec) && 'free_values' in spec) {
    const text = textOf(v)?.toLowerCase().trim();
    if (text === undefined) return undefined;
    return spec.free_values.map((f) => String(f).toLowerCase().trim()).includes(text);
  }
  return typeof v === 'boolean' ? v : undefined;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/** A coordinate pair, or nulls: half a pair, (0,0) and out-of-range count as missing. */
export function coordinates(lat: unknown, lon: unknown): { lat: number | null; lon: number | null } {
  const a = num(lat);
  const b = num(lon);
  if (a === null || b === null || (a === 0 && b === 0) || Math.abs(a) > 90 || Math.abs(b) > 180) {
    return { lat: null, lon: null };
  }
  return { lat: a, lon: b };
}

// ---------------------------------------------------------------------------------------------
// Category

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Every value of the category field, lists and `;` or `|` separated text flattened. */
function categoryValues(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v.flatMap(categoryValues);
  const text = textOf(v);
  return text === undefined ? [] : text.split(/[;|]/).map((s) => s.trim()).filter(Boolean);
}

/** The first rule whose needle any value contains, accents and case ignored; else the default, else other. */
export function mapCategoryByRules(value: unknown, category: SourceConfig['category']): CmsCategory {
  const values = categoryValues(value).map(fold);
  for (const rule of category?.rules ?? []) {
    const [needle, target] = rule;
    if (typeof needle !== 'string' || !needle) continue;
    if (values.some((v) => v.includes(fold(needle)))) {
      return (CMS_CATEGORIES as readonly string[]).includes(target) ? target as CmsCategory : 'other';
    }
  }
  const fallback = category?.default;
  return fallback && (CMS_CATEGORIES as readonly string[]).includes(fallback) ? fallback as CmsCategory : 'other';
}

// ---------------------------------------------------------------------------------------------
// Dates

const WHEN = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;

export interface When {
  day: string;
  /** ISO 8601 with offset; for a date alone, the local midnight. */
  iso: string;
  dateOnly: boolean;
}

/**
 * A source date: `YYYY-MM-DD`, with a time (`T` or space, seconds and fraction optional) and an
 * optional offset, `DD/MM/YYYY` when the CSV says so, or `YYYYMMDD` (the ACF date field of WordPress,
 * Destino POA, #1089). Without an offset it is the local time of `timeZone`. Anything else is null.
 */
export function parseWhen(value: unknown, timeZone: string, dateFormat?: string): When | null {
  let text = textOf(clean(value));
  if (text === undefined) return null;
  const compact = /^(\d{4})(\d{2})(\d{2})(\s.*)?$/.exec(text);
  if (compact) text = `${compact[1]}-${compact[2]}-${compact[3]}${compact[4] ?? ''}`;
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(.*)$/.exec(text);
  if (dmy && (dateFormat ?? 'DD/MM/YYYY').toUpperCase().startsWith('DD/MM')) {
    text = `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}${dmy[4].replace(/^\s+/, ' ')}`.trim();
  }
  const m = WHEN.exec(text);
  if (!m) return null;
  const day = `${m[1]}-${m[2]}-${m[3]}`;
  if (m[4] === undefined) return { day, iso: localIso(day, '00:00:00', timeZone), dateOnly: true };
  const time = `${m[4]}:${m[5]}:${m[6] ?? '00'}`;
  if (m[7] === undefined) return { day, iso: localIso(day, time, timeZone), dateOnly: false };
  const offset = m[7].toUpperCase() === 'Z'
    ? '+00:00'
    : m[7].includes(':')
    ? m[7]
    : `${m[7].slice(0, 3)}:${m[7].slice(3)}`;
  return { day, iso: `${day}T${time}${offset}`, dateOnly: false };
}

/** Today in `timeZone`, as YYYY-MM-DD. */
export function localDay(timeZone: string, nowMs: number): string {
  const shifted = new Date(nowMs + offsetMinutes(timeZone, nowMs) * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/** The first instant of today in `timeZone`: what ends before it is over. */
export function startOfToday(timeZone: string, nowMs: number): number {
  return Date.parse(localIso(localDay(timeZone, nowMs), '00:00:00', timeZone));
}

/** `YYYYMMDDhhmmss` (Salzburg's `?date=`), the local wall time of the source. */
function whenFromQuery(pageUrl: string | undefined, rule: unknown, timeZone: string): When | null {
  const r = rule as { param?: unknown } | undefined;
  if (!pageUrl || !r || typeof r.param !== 'string') return null;
  let raw: string | null = null;
  try {
    raw = new URL(pageUrl).searchParams.get(r.param);
  } catch {
    return null;
  }
  const m = raw ? /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?$/.exec(raw) : null;
  if (!m) return null;
  const day = `${m[1]}-${m[2]}-${m[3]}`;
  return { day, iso: localIso(day, `${m[4]}:${m[5]}:${m[6] ?? '00'}`, timeZone), dateOnly: false };
}

// ---------------------------------------------------------------------------------------------
// Records to events

export interface MappedEvent {
  external_id: string;
  name: string;
  /** The source text, HTML or plain, not yet converted. */
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  lat: number | null;
  lon: number | null;
  address: string | null;
  image: string | null;
  image_credit: string | null;
  url: string | null;
  is_free: boolean | undefined;
  category: CmsCategory;
}

export type MapResult = { event: MappedEvent } | { skip: string };

/** An http(s) link; a host written without the scheme (Málaga: "www.cultura.malaga.eu") gets https; else null. */
export function linkOf(value: string | null): string | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+(?:[/?#]\S*)?$/i.test(value) ? `https://${value}` : null;
}

/** `config.filter`, applied to a record after the fetch: false = the record is not the source's. */
export function passesFilter(record: Rec, filters: SourceFilter[] | undefined, pageUrl?: string): boolean {
  for (const f of filters ?? []) {
    const fold = (x: string) => (f.ignore_case ? x.toLowerCase() : x);
    const raw = textOf(resolveSpec(record, f.field, pageUrl));
    const v = raw === undefined ? undefined : fold(raw);
    const list = (Array.isArray(f.value) ? f.value : [f.value]).map((x) => fold(String(x)));
    if (f.op === 'eq' && v !== fold(String(f.value))) return false;
    if (f.op === 'in' && (v === undefined || !list.includes(v))) return false;
    if (f.op === 'not_in' && v !== undefined && list.includes(v)) return false;
  }
  return true;
}

/**
 * One record to the event it describes, through `config.fields`. BR-EVENTO-009: only an event that
 * has not ended yet (end, or start when there is no end, today or later in the source zone).
 */
export function mapRecord(source: GenericSource, record: Rec, nowMs: number, pageUrl?: string): MapResult {
  const cfg = source.config ?? {};
  const fields = cfg.fields ?? {};
  const fetchCfg = (cfg.fetch ?? {}) as Rec;
  const csv = (fetchCfg.csv ?? {}) as Rec;
  const dateFormat = typeof csv.date_format === 'string' ? csv.date_format : undefined;

  const url = linkOf(textField(record, fields.url, pageUrl)) ?? (pageUrl ?? null);
  const externalId = textField(record, fields.external_id, pageUrl) ?? url;
  if (!externalId) return { skip: 'missing_external_id' };
  // A title can come with markup (Málaga writes "<b>...</b>"): it is text, on one line.
  const rawName = textField(record, fields.name, pageUrl);
  const name = rawName ? htmlToText(rawName).replace(/\s+/g, ' ').trim() : '';
  if (!name) return { skip: 'missing_name' };

  const start = whenFromQuery(pageUrl, fetchCfg.start_from_query, source.timezone) ??
    parseWhen(resolveSpec(record, fields.starts_at, pageUrl), source.timezone, dateFormat);
  if (!start) return { skip: 'missing_start' };
  const end = parseWhen(resolveSpec(record, fields.ends_at, pageUrl), source.timezone, dateFormat);
  const allDay = start.dateOnly && (!end || end.dateOnly);
  const endsAt = end
    ? (end.dateOnly ? localIso(end.day, '23:59:59', source.timezone) : end.iso)
    : (start.dateOnly ? localIso(start.day, '23:59:59', source.timezone) : null);
  if (Date.parse(endsAt ?? start.iso) < startOfToday(source.timezone, nowMs)) return { skip: 'ended' };
  if (endsAt && Date.parse(endsAt) < Date.parse(start.iso)) return { skip: 'ends_before_start' };

  const { lat, lon } = coordinates(resolveSpec(record, fields.lat, pageUrl), resolveSpec(record, fields.lon, pageUrl));
  const image = textField(record, fields.image, pageUrl);
  return {
    event: {
      external_id: externalId,
      name,
      description: textField(record, fields.description, pageUrl),
      starts_at: start.iso,
      ends_at: endsAt,
      all_day: allDay,
      lat,
      lon,
      address: textField(record, fields.address, pageUrl),
      image: image && /^https?:\/\//i.test(image) ? image : null,
      image_credit: textField(record, fields.image_credit, pageUrl),
      url,
      is_free: resolveIsFree(record, fields.is_free, pageUrl),
      category: mapCategoryByRules(resolveSpec(record, fields.category, pageUrl), cfg.category),
    },
  };
}

/** HTML of the source to plain text (BR-EVENTO-009 item 3), or empty. */
export const sourceText = (html: string | null): string => (html ? htmlToText(html) : '');

// ---------------------------------------------------------------------------------------------
// Readers that answer records

const str = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`config_missing:${name}`);
  return v.trim();
};

const pageSizeOf = (v: unknown, max: number) => {
  const n = typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : 100;
  return Math.min(n, max);
};

const getJson = async (get: GetText, url: string): Promise<unknown> => JSON.parse(await get(url));

/** ODS Explore v2.1 `/catalog/datasets/<dataset>/records`, page by page (limit at most 100). */
export async function readOpendatasoft(cfg: Rec, get: GetText): Promise<Rec[]> {
  const endpoint = str(cfg.endpoint, 'fetch.endpoint').replace(/\/+$/, '');
  const dataset = str(cfg.dataset, 'fetch.dataset');
  const limit = pageSizeOf(cfg.page_size, 100);
  const out: Rec[] = [];
  for (let page = 0, offset = 0; page < MAX_READER_PAGES && offset + limit <= ODS_MAX_WINDOW; page++) {
    const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (typeof cfg.where === 'string' && cfg.where) q.set('where', cfg.where);
    if (typeof cfg.order_by === 'string' && cfg.order_by) q.set('order_by', cfg.order_by);
    const body = await getJson(get, `${endpoint}/catalog/datasets/${encodeURIComponent(dataset)}/records?${q}`) as {
      total_count?: unknown;
      results?: unknown;
    };
    if (!body || !Array.isArray(body.results)) throw new Error('ods_malformed');
    out.push(...(body.results as Rec[]));
    offset += body.results.length;
    const total = typeof body.total_count === 'number' ? body.total_count : 0;
    if (body.results.length === 0 || offset >= total) break;
  }
  return out;
}

/** CKAN `datastore_search` page by page, or a GeoJSON resource whose features carry the fields. */
export async function readCkan(cfg: Rec, get: GetText): Promise<Rec[]> {
  if (cfg.mode === 'resource') {
    const body = await getJson(get, str(cfg.url, 'fetch.url')) as { features?: unknown };
    if (!body || !Array.isArray(body.features)) throw new Error('geojson_malformed');
    return (body.features as { properties?: Rec }[]).map((f) => f?.properties ?? {});
  }
  const endpoint = str(cfg.endpoint, 'fetch.endpoint');
  const resourceId = str(cfg.resource_id, 'fetch.resource_id');
  const limit = pageSizeOf(cfg.page_size, 1000);
  const out: Rec[] = [];
  for (let page = 0, offset = 0; page < MAX_READER_PAGES; page++) {
    const q = new URLSearchParams({ resource_id: resourceId, limit: String(limit), offset: String(offset) });
    if (typeof cfg.sort === 'string' && cfg.sort) q.set('sort', cfg.sort);
    const body = await getJson(get, `${endpoint}?${q}`) as {
      success?: unknown;
      result?: { total?: unknown; records?: unknown };
    };
    if (!body || body.success !== true || !Array.isArray(body.result?.records)) throw new Error('ckan_malformed');
    const records = body.result.records as Rec[];
    out.push(...records);
    offset += records.length;
    const total = typeof body.result.total === 'number' ? body.result.total : 0;
    if (records.length === 0 || offset >= total) break;
  }
  return out;
}

/** RFC 4180 CSV with any one-character separator: quotes, doubled quotes and line breaks inside quotes. */
export function parseCsv(text: string, separator = ','): Rec[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === '') {
      quoted = true;
    } else if (c === separator) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ''])));
}

/** One JSON or CSV file. */
export async function readFile(cfg: Rec, get: GetText): Promise<Rec[]> {
  const text = await get(str(cfg.url, 'fetch.url'));
  if (cfg.format === 'csv') {
    const csv = (cfg.csv ?? {}) as Rec;
    const sep = typeof csv.separator === 'string' && csv.separator.length === 1 ? csv.separator : ',';
    return parseCsv(text, sep);
  }
  const body = JSON.parse(text.replace(/^﻿/, ''));
  const records = typeof cfg.records_path === 'string' && cfg.records_path ? getPath(body, cfg.records_path) : body;
  if (!Array.isArray(records)) throw new Error('file_records_not_a_list');
  return records as Rec[];
}

// ---------------------------------------------------------------------------------------------
// jsonld: page discovery and the schema.org Event of a page

const decodeXml = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");

const pattern = (v: unknown): RegExp => new RegExp(str(v, 'fetch.link_pattern'));

/** The page URLs of a jsonld source: `<loc>` of its sitemaps (an index is followed), or links of a listing. */
export async function discoverPages(cfg: Rec, get: GetText): Promise<string[]> {
  const re = pattern(cfg.link_pattern);
  const found = new Set<string>();
  if (cfg.discovery === 'listing') {
    const listing = str(cfg.listing_url, 'fetch.listing_url');
    const param = typeof cfg.page_param === 'string' && cfg.page_param ? cfg.page_param : null;
    const maxPages = typeof cfg.max_pages === 'number' && cfg.max_pages > 0 ? Math.min(cfg.max_pages, 100) : 1;
    for (let page = 1; page <= maxPages; page++) {
      const u = new URL(listing);
      if (param && page > 1) u.searchParams.set(param, String(page));
      const html = await get(u.toString());
      const before = found.size;
      for (const m of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
        const href = decodeXml(m[1]);
        if (re.test(href)) found.add(new URL(href, listing).toString());
      }
      if (!param || found.size === before || found.size >= MAX_PAGE_URLS) break;
    }
    return [...found];
  }
  const queue = Array.isArray(cfg.sitemap_urls)
    ? cfg.sitemap_urls.filter((u): u is string => typeof u === 'string')
    : [];
  if (!queue.length) throw new Error('config_missing:fetch.sitemap_urls');
  for (let read = 0; queue.length && read < MAX_SITEMAPS; read++) {
    const xml = await get(queue.shift() as string);
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decodeXml(m[1]));
    if (/<sitemapindex\b/i.test(xml)) {
      queue.push(...locs);
      continue;
    }
    for (const loc of locs) if (re.test(loc)) found.add(loc);
    if (found.size >= MAX_PAGE_URLS) break;
  }
  return [...found].slice(0, MAX_PAGE_URLS);
}

const isEventType = (t: unknown): boolean =>
  typeof t === 'string' ? /(^|[/#:])\w*Event$/.test(t) : Array.isArray(t) && t.some(isEventType);

function findEvent(node: unknown, depth = 0): Rec | null {
  if (!node || typeof node !== 'object' || depth > 4) return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findEvent(n, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  const rec = node as Rec;
  if (isEventType(rec['@type'])) return rec;
  return rec['@graph'] ? findEvent(rec['@graph'], depth + 1) : null;
}

/**
 * The first schema.org Event of the page's JSON-LD. A node without `startDate` whose sessions are in
 * `subEvent` (Wien Erleben, read 2026-11-02) takes the first start and the last end of them.
 */
export function extractEvent(html: string): Rec | null {
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const event = findEvent(parsed);
    if (!event) continue;
    if (!event.startDate && Array.isArray(event.subEvent)) {
      const subs = (event.subEvent as Rec[]).filter((s) => typeof s?.startDate === 'string');
      const by = (key: 'startDate' | 'endDate') =>
        subs.map((s) => s[key]).filter((v): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v)))
          .sort((a, b) => Date.parse(a) - Date.parse(b));
      const starts = by('startDate');
      const ends = by('endDate');
      if (starts.length) return { ...event, startDate: starts[0], endDate: ends[ends.length - 1] ?? event.endDate };
    }
    return event;
  }
  return null;
}


// ---------------------------------------------------------------------------------------------
// wp_rest (#1089): a WordPress custom post type through /wp-json/wp/v2, fields from ACF

const MAX_WP_INCLUDE = 100;

/**
 * `_embedded['wp:term']` as `{ <taxonomy>: [names] }`, names as text (WordPress writes `&amp;`), so a
 * category spec reads `_terms.<taxonomy>` like any other path.
 */
function wpTerms(record: Rec): Record<string, string[]> {
  const groups = getPath(record, '_embedded.wp:term');
  const out: Record<string, string[]> = {};
  for (const group of Array.isArray(groups) ? groups : []) {
    for (const term of Array.isArray(group) ? group as Rec[] : []) {
      const taxonomy = textOf(term?.taxonomy);
      const name = textOf(term?.name);
      if (!taxonomy || !name) continue;
      (out[taxonomy] ??= []).push(decodeEntities(name).trim());
    }
  }
  return out;
}

/**
 * WordPress REST, page by page: `<endpoint>?per_page=<n>&page=<p>&_embed=<embed>`. The walk ends on a
 * page smaller than asked, or on the 400 WordPress answers past the last page (`rest_post_invalid_page_number`,
 * read 2026-11-03), which only ends it after page 1. `relations` fetch the posts an ACF relation field points to
 * (`{path, endpoint, as}`, ids by `include`, 100 a request) and put the first one under `as`, its title as text.
 */
export async function readWpRest(cfg: Rec, get: GetText): Promise<Rec[]> {
  const endpoint = str(cfg.endpoint, 'fetch.endpoint');
  const perPage = pageSizeOf(cfg.page_size, 100);
  const embed = Array.isArray(cfg.embed) ? cfg.embed.filter((e): e is string => typeof e === 'string') : [];
  const out: Rec[] = [];
  for (let page = 1; page <= MAX_READER_PAGES; page++) {
    const u = new URL(endpoint);
    u.searchParams.set('per_page', String(perPage));
    u.searchParams.set('page', String(page));
    if (embed.length) u.searchParams.set('_embed', embed.join(','));
    let body: unknown;
    try {
      body = await getJson(get, u.toString());
    } catch (error) {
      if (page > 1 && error instanceof Error && error.message.startsWith('http_400 ')) break;
      throw error;
    }
    if (!Array.isArray(body)) throw new Error('wp_rest_malformed');
    out.push(...(body as Rec[]));
    if (body.length < perPage) break;
  }
  for (const record of out) record._terms = wpTerms(record);

  const relations = Array.isArray(cfg.relations) ? cfg.relations as Rec[] : [];
  for (const rel of relations) {
    const path = str(rel.path, 'fetch.relations.path');
    const alias = str(rel.as, 'fetch.relations.as');
    const relEndpoint = str(rel.endpoint, 'fetch.relations.endpoint');
    const idsOf = (record: Rec) =>
      [getPath(record, path)].flat().map((v) => textOf(v)).filter((v): v is string => !!v && /^\d+$/.test(v));
    const ids = [...new Set(out.flatMap(idsOf))];
    const byId = new Map<string, Rec>();
    for (let i = 0; i < ids.length; i += MAX_WP_INCLUDE) {
      const u = new URL(relEndpoint);
      u.searchParams.set('include', ids.slice(i, i + MAX_WP_INCLUDE).join(','));
      u.searchParams.set('per_page', String(MAX_WP_INCLUDE));
      const posts = await getJson(get, u.toString());
      if (!Array.isArray(posts)) throw new Error('wp_rest_malformed');
      for (const post of posts as Rec[]) {
        const title = textOf(getPath(post, 'title.rendered'));
        byId.set(String(post.id), { ...post, title: htmlToText(title ?? '') });
      }
    }
    for (const record of out) {
      const first = idsOf(record).map((id) => byId.get(id)).find(Boolean);
      if (first) record[alias] = first;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// mapas_culturais (#1089): the API of the Mapas Culturais platform (Ceará, Sergipe, Pará...)

const DAY_MS = 24 * 60 * 60 * 1000;

/** "Rua X, , Centro, Fortaleza, undefined, CE, 60025-000": the empty and "undefined" parts out. */
function cleanAddress(value: unknown): unknown {
  const text = textOf(value);
  if (text === undefined) return value;
  return text.split(',').map((p) => p.trim()).filter((p) => p && p.toLowerCase() !== 'undefined').join(', ');
}

/**
 * `<endpoint>?@from=<today>&@to=<today + days_ahead>&@select=<select>&@files=<files>`, one request
 * (`event/findByLocation`; `eventOccurrence/find` answers 500, read 2026-11-03). One record per occurrence,
 * `{...event, occurrence}`, in date order: the city filter of item 7 is per occurrence, and with the
 * external id of the event the first one still on wins (the others are `duplicate`).
 */
export async function readMapasCulturais(cfg: Rec, get: GetText, timeZone: string, nowMs: number): Promise<Rec[]> {
  const endpoint = str(cfg.endpoint, 'fetch.endpoint');
  const days = typeof cfg.days_ahead === 'number' && cfg.days_ahead > 0 ? Math.min(cfg.days_ahead, 730) : 365;
  const u = new URL(endpoint);
  u.searchParams.set('@from', localDay(timeZone, nowMs));
  u.searchParams.set('@to', localDay(timeZone, nowMs + days * DAY_MS));
  u.searchParams.set('@select', str(cfg.select, 'fetch.select'));
  if (typeof cfg.files === 'string' && cfg.files) u.searchParams.set('@files', cfg.files);
  const body = await getJson(get, u.toString());
  if (!Array.isArray(body)) throw new Error('mapas_culturais_malformed');
  const out: Rec[] = [];
  for (const event of body as Rec[]) {
    const { occurrences, ...rest } = event ?? {};
    const list = (Array.isArray(occurrences) ? occurrences as Rec[] : [])
      .filter((o) => o && typeof o === 'object')
      .map((o) => {
        const space = (o.space ?? null) as Rec | null;
        const rule = (o.rule ?? {}) as Rec;
        // 00:00 to 00:00 is how the form saves a day without hours (ADECE, 2026-12-09): a whole day, not midnight.
        const noHours = rule.startsAt === '00:00' && (rule.endsAt === '00:00' || !rule.endsAt);
        return {
          ...o,
          rule: noHours ? { ...rule, startsAt: undefined, endsAt: undefined } : rule,
          space: space ? { ...space, endereco: cleanAddress(space.endereco) } : space,
        };
      });
    const key = (o: Rec) => `${textOf(getPath(o, 'rule.startsOn')) ?? ''} ${textOf(getPath(o, 'rule.startsAt')) ?? ''}`;
    list.sort((a, b) => key(a).localeCompare(key(b)));
    for (const occurrence of list) out.push({ ...rest, occurrence });
  }
  return out;
}

/** The records of a record-based adapter (every generic one but jsonld). */
export function readRecords(source: GenericSource, get: GetText, nowMs: number = Date.now()): Promise<Rec[]> {
  const cfg = (source.config?.fetch ?? {}) as Rec;
  if (source.adapter === 'opendatasoft') return readOpendatasoft(cfg, get);
  if (source.adapter === 'ckan') return readCkan(cfg, get);
  if (source.adapter === 'file') return readFile(cfg, get);
  if (source.adapter === 'wp_rest') return readWpRest(cfg, get);
  if (source.adapter === 'mapas_culturais') return readMapasCulturais(cfg, get, source.timezone, nowMs);
  return Promise.reject(new Error(`unknown_adapter:${source.adapter}`));
}

export const GENERIC_ADAPTERS = ['opendatasoft', 'ckan', 'file', 'jsonld', 'wp_rest', 'mapas_culturais'];

// ---------------------------------------------------------------------------------------------
// Geocoding (BR-EVENTO-009 item 8)

/** A cache row that did not resolve is good until the next weekly import, not longer. */
export const GEOCODE_UNRESOLVED_TTL_MS = 6 * 24 * 60 * 60 * 1000;
/** Google Maps Platform terms, Places API: latitude and longitude kept at most 30 calendar days. */
export const GEOCODE_RESOLVED_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** `core.event_geocode_cache.address_key`: lower, trimmed, single-spaced "<address>, <city>, <country>". */
export function addressKey(address: string, city: string, country: string): string {
  return `${address}, ${city}, ${country}`.toLowerCase().replace(/\s+/g, ' ').trim();
}

export interface GeocodeCacheRow {
  lat: number | null;
  lon: number | null;
  queried_at: string;
}

/** `hit` and `unresolved` answer from the cache; `query` asks Google again (and takes quota). */
export function cacheVerdict(row: GeocodeCacheRow | null, nowMs: number): 'hit' | 'unresolved' | 'query' {
  if (!row) return 'query';
  const age = nowMs - Date.parse(row.queried_at);
  if (!Number.isFinite(age)) return 'query';
  if (row.lat !== null && row.lon !== null) return age <= GEOCODE_RESOLVED_TTL_MS ? 'hit' : 'query';
  return age <= GEOCODE_UNRESOLVED_TTL_MS ? 'unresolved' : 'query';
}

/** What the geocoder needs from the database and from Google. */
export interface Geocoding {
  cached(key: string): Promise<GeocodeCacheRow | null>;
  save(key: string, lat: number | null, lon: number | null): Promise<void>;
  /** `core.event_geocode_take_quota()`: true = this query is allowed this month. */
  takeQuota(): Promise<boolean>;
  /** Places API (New) `places:searchText`: the first place's location, or null when none. */
  search(text: string): Promise<{ lat: number; lon: number } | null>;
}

export type GeocodeAnswer =
  | { lat: number; lon: number; from: 'cache' | 'google' }
  | { skip: 'geocode_no_address' | 'geocode_unresolved' | 'geocode_quota' | 'geocode_not_found' };

/**
 * The coordinate of an address: the cache first, then one Places query, each one taken from the
 * monthly quota first. The answer, found or not, goes back to the cache. `inFlight` makes two events
 * of the same address in one run ask once.
 */
export function geocoder(geo: Geocoding, nowMs: () => number) {
  const inFlight = new Map<string, Promise<GeocodeAnswer>>();
  const resolve = async (key: string, text: string): Promise<GeocodeAnswer> => {
    const row = await geo.cached(key);
    const verdict = cacheVerdict(row, nowMs());
    if (verdict === 'hit') return { lat: row!.lat as number, lon: row!.lon as number, from: 'cache' };
    if (verdict === 'unresolved') return { skip: 'geocode_unresolved' };
    if (!(await geo.takeQuota())) return { skip: 'geocode_quota' };
    const found = await geo.search(text);
    const pair = found ? coordinates(found.lat, found.lon) : { lat: null, lon: null };
    await geo.save(key, pair.lat, pair.lon);
    return pair.lat !== null && pair.lon !== null
      ? { lat: pair.lat, lon: pair.lon, from: 'google' }
      : { skip: 'geocode_not_found' };
  };
  return (address: string | null, city: string, country: string): Promise<GeocodeAnswer> => {
    if (!address) return Promise.resolve({ skip: 'geocode_no_address' });
    const key = addressKey(address, city, country);
    let answer = inFlight.get(key);
    if (!answer) {
      answer = resolve(key, `${address}, ${city}, ${country}`);
      inFlight.set(key, answer);
      // A failure is not remembered: the next event of that address tries again.
      answer.catch(() => inFlight.delete(key));
    }
    return answer;
  };
}
