// _shared/search-console.ts
//
// The Google searches that showed tuggi.app (#1170, interface fixed on #1167): clicks, impressions and average
// position per day and query, into `social.search_console_daily`. Same service account as GA4
// (`GA4_SERVICE_ACCOUNT_JSON`), its own token on the read-only Search Console scope.
//
// Search Console API v3, checked 2026-11-09 against the official reference (developers.google.com/webmaster-tools):
// - `GET /webmasters/v3/sites` lists the properties the account was granted, `siteEntry[]` with `siteUrl`
//   (`https://tuggi.app/` for a URL prefix, `sc-domain:tuggi.app` for a domain) and `permissionLevel`
//   (`siteOwner`, `siteFullUser`, `siteRestrictedUser`, `siteUnverifiedUser`). An account nobody added
//   gets an empty list, not a 403: that is `no_property` here.
// - `POST /webmasters/v3/sites/{siteUrl}/searchAnalytics/query`, `siteUrl` URL-encoded; `startDate` and
//   `endDate` in Pacific time, so `day` is Google's Pacific day; `rowLimit` 1 to 25 000 with `startRow` to
//   page; `dataState` defaults to `final`, so the last two or three days come later and the last five days
//   are read again every run. Rows `keys` in the order of `dimensions`, `clicks` and `impressions` as
//   doubles, `position` the average. "Dates without data are omitted when grouping by date."
// - A query Google anonymizes for privacy is left out of a report grouped by query (Search Console help,
//   "Performance report"): its clicks are missing from the rows, and that is not an error.
// - Search Console keeps 16 months, so the first run reads 16 months.
//
// Import-free except `ga4-data.ts` (import-free): `fetch`, the clock and the database are parameters.

import { googleAccessToken, googleApiError, type ServiceAccount } from './ga4-data.ts';

export const SEARCH_CONSOLE_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
export const SEARCH_CONSOLE_API = 'https://www.googleapis.com/webmasters/v3';
/** The domain property, preferred when the account was granted it: it covers every host and protocol. */
export const SEARCH_CONSOLE_DOMAIN = 'tuggi.app';
/** Google publishes with a delay, so these last days are read again every run. */
export const SEARCH_CONSOLE_LOOKBACK_DAYS = 5;
/** How far back Search Console keeps data: what the first run reads. */
export const SEARCH_CONSOLE_HISTORY_MONTHS = 16;
/** The API's maximum page. */
export const SEARCH_CONSOLE_ROW_LIMIT = 25_000;
/** A guard against a runaway page loop: 40 pages of 25 000 rows. */
const MAX_PAGES = 40;

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface SiteEntry {
  siteUrl: string;
  permissionLevel: string;
}

/** The two calls the job makes; both throw `GoogleApiError` (`search_console_<status>`) on a refusal. */
export interface SearchConsoleApi {
  sites(): Promise<SiteEntry[]>;
  query(siteUrl: string, body: Record<string, unknown>): Promise<unknown>;
}

export function searchConsoleClient(
  sa: ServiceAccount,
  fetchFn: FetchFn,
  now: () => number = Date.now,
): SearchConsoleApi {
  const accessToken = googleAccessToken(sa, SEARCH_CONSOLE_SCOPE, 'search_console', fetchFn, now);
  const call = async (path: string, init: RequestInit) => {
    const res = await fetchFn(`${SEARCH_CONSOLE_API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw await googleApiError('search_console', res);
    return await res.json();
  };
  return {
    async sites() {
      const body = (await call('/sites', { method: 'GET' })) as { siteEntry?: unknown } | null;
      const entries = Array.isArray(body?.siteEntry) ? (body.siteEntry as Array<Record<string, unknown>>) : [];
      return entries
        .filter((e) => typeof e?.siteUrl === 'string')
        .map((e) => ({ siteUrl: String(e.siteUrl), permissionLevel: String(e.permissionLevel ?? '') }));
    },
    query: (siteUrl, body) =>
      call(`/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  };
}

/**
 * The property to read: `sc-domain:tuggi.app` when listed, else a URL prefix on tuggi.app (the apex before
 * `www`, https before http). An unverified entry has no data and is skipped; null when nothing is left.
 */
export function pickProperty(entries: SiteEntry[]): string | null {
  const usable = entries.filter((e) => e.permissionLevel !== 'siteUnverifiedUser');
  if (usable.some((e) => e.siteUrl === `sc-domain:${SEARCH_CONSOLE_DOMAIN}`)) {
    return `sc-domain:${SEARCH_CONSOLE_DOMAIN}`;
  }
  const rank = (url: string) => {
    try {
      const u = new URL(url);
      const host = u.hostname === SEARCH_CONSOLE_DOMAIN ? 0 : u.hostname === `www.${SEARCH_CONSOLE_DOMAIN}` ? 2 : -1;
      return host < 0 ? -1 : host + (u.protocol === 'https:' ? 0 : 1);
    } catch {
      return -1;
    }
  };
  const ranked = usable.map((e) => ({ url: e.siteUrl, rank: rank(e.siteUrl) })).filter((e) => e.rank >= 0);
  ranked.sort((a, b) => a.rank - b.rank);
  return ranked[0]?.url ?? null;
}

export function searchAnalyticsBody(from: string, to: string, startRow: number): Record<string, unknown> {
  return {
    startDate: from,
    endDate: to,
    dimensions: ['date', 'query'],
    type: 'web',
    rowLimit: SEARCH_CONSOLE_ROW_LIMIT,
    startRow,
  };
}

/** A row of `social.search_console_daily`. */
export interface SearchConsoleRow {
  day: string;
  query: string;
  clicks: number | null;
  impressions: number | null;
  position: number | null;
}

const count = (v: unknown): number | null => {
  const n = Number(v);
  return typeof v === 'number' && Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
};
/** `numeric(6,2)` with `CHECK (position > 0)`: a missing or non-positive position is null, never 0. */
const position = (v: unknown): number | null => {
  const n = Math.round(Number(v) * 100) / 100;
  return typeof v === 'number' && Number.isFinite(n) && n > 0 && n < 10_000 ? n : null;
};

/** `rows[]` of one answer; a row without a date or a query (none should come) is dropped. */
export function searchConsoleRows(body: unknown): SearchConsoleRow[] {
  const rows = body && typeof body === 'object' ? (body as { rows?: unknown }).rows : undefined;
  if (!Array.isArray(rows)) return [];
  const out: SearchConsoleRow[] = [];
  for (const r of rows as Array<Record<string, unknown>>) {
    const keys = Array.isArray(r?.keys) ? r.keys : [];
    const [day, query] = keys;
    if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || typeof query !== 'string' || !query) continue;
    out.push({
      day,
      query,
      clicks: count(r.clicks),
      impressions: count(r.impressions),
      position: position(r.position),
    });
  }
  return out;
}

/** `day` moved by whole calendar months, clamped to the month's last day (Mar 31 minus one month is Feb 28). */
export function monthsBefore(day: string, months: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 - months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}

const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export interface SearchConsoleResult {
  state: 'read' | 'no_property';
  /** The property read, or null without one. */
  property: string | null;
  /** How many properties `sites.list` answered: 0 means the account was not added in Search Console. */
  listed: number;
  from: string | null;
  to: string | null;
  rows: number;
  /** The first day any row carried, or null when none did. */
  first_day: string | null;
}

export interface SearchConsoleDeps {
  api: SearchConsoleApi;
  /** Today in Brasília, `YYYY-MM-DD`; the job reads up to yesterday. */
  today: string;
  /** The latest day already in `search_console_daily`, or null when it is empty (the first run reads 16 months). */
  lastDay: string | null;
  /** Upsert of `social.search_console_daily` on `(day, query)`, called once with every row; the caller chunks. */
  write: (rows: SearchConsoleRow[]) => Promise<void>;
}

/**
 * Reads from the oldest of the last stored day and the last five days, through yesterday, every page, and
 * writes every row. A refusal throws before anything is written, so a 403 never erases an earlier run.
 */
export async function collectSearchConsole(deps: SearchConsoleDeps): Promise<SearchConsoleResult> {
  const sites = await deps.api.sites();
  const property = pickProperty(sites);
  const result: SearchConsoleResult = {
    state: 'read',
    property,
    listed: sites.length,
    from: null,
    to: null,
    rows: 0,
    first_day: null,
  };
  if (!property) return { ...result, state: 'no_property' };

  const to = addDays(deps.today, -1);
  const recent = addDays(deps.today, -SEARCH_CONSOLE_LOOKBACK_DAYS);
  const from = deps.lastDay === null
    ? monthsBefore(deps.today, SEARCH_CONSOLE_HISTORY_MONTHS)
    : deps.lastDay < recent
    ? deps.lastDay
    : recent;
  result.from = from;
  result.to = to;

  // Every page first: a refusal on page three leaves nothing half written. Keys are unique per answer and
  // pages do not overlap; the map only keeps one upsert from touching the same key twice (PostgREST refuses).
  const byKey = new Map<string, SearchConsoleRow>();
  for (let page = 0, startRow = 0; page < MAX_PAGES; page++, startRow += SEARCH_CONSOLE_ROW_LIMIT) {
    const rows = searchConsoleRows(await deps.api.query(property, searchAnalyticsBody(from, to, startRow)));
    for (const r of rows) byKey.set(`${r.day}|${r.query}`, r);
    if (rows.length < SEARCH_CONSOLE_ROW_LIMIT) break;
  }
  const out = [...byKey.values()];
  if (out.length > 0) await deps.write(out);
  result.rows = out.length;
  result.first_day = out.map((r) => r.day).sort()[0] ?? null;
  return result;
}
