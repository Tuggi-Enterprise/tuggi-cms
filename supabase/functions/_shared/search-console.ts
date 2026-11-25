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
//
// #1294 (BR-B2B-068 item 8.a): the same job reads, after the searches, the partner pages by date and page
// (`collectPartnerSearchConsole`), into `partner.search_console_daily` (contract `metricas-do-parceiro.md` §6).
// "contains" is case-insensitive in the filter; `page` is the full URL Google indexed.
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

/** #1294: what a partner page path carries; Search Console's `contains` is case-insensitive. */
export const PARTNER_PAGE_MARKER = '/@';

/** #1294: the same read by date and page, only the pages under `tuggi.app/@`. */
export function partnerPagesBody(from: string, to: string, startRow: number): Record<string, unknown> {
  return {
    ...searchAnalyticsBody(from, to, startRow),
    dimensions: ['date', 'page'],
    dimensionFilterGroups: [
      { groupType: 'and', filters: [{ dimension: 'page', operator: 'contains', expression: PARTNER_PAGE_MARKER }] },
    ],
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

  const { from, to } = readWindow(deps.today, deps.lastDay);
  result.from = from;
  result.to = to;

  // Every page first: a refusal on page three leaves nothing half written. Keys are unique per answer and
  // pages do not overlap; the map only keeps one upsert from touching the same key twice (PostgREST refuses).
  const byKey = new Map<string, SearchConsoleRow>();
  for (const body of await everyPage(deps.api, property, (startRow) => searchAnalyticsBody(from, to, startRow))) {
    for (const r of searchConsoleRows(body)) byKey.set(`${r.day}|${r.query}`, r);
  }
  const out = [...byKey.values()];
  if (out.length > 0) await deps.write(out);
  result.rows = out.length;
  result.first_day = out.map((r) => r.day).sort()[0] ?? null;
  return result;
}

/**
 * From the oldest of the last stored day and the last five days, through yesterday; sixteen months back on
 * an empty table. Both reads of the job use it, each with the last day of its own table.
 */
function readWindow(today: string, lastDay: string | null): { from: string; to: string } {
  const to = addDays(today, -1);
  const recent = addDays(today, -SEARCH_CONSOLE_LOOKBACK_DAYS);
  const from = lastDay === null
    ? monthsBefore(today, SEARCH_CONSOLE_HISTORY_MONTHS)
    : lastDay < recent
    ? lastDay
    : recent;
  return { from, to };
}

/** Every answer of one read, page after page, until a page comes back short. */
async function everyPage(
  api: SearchConsoleApi,
  property: string,
  bodyAt: (startRow: number) => Record<string, unknown>,
): Promise<unknown[]> {
  const answers: unknown[] = [];
  for (let page = 0, startRow = 0; page < MAX_PAGES; page++, startRow += SEARCH_CONSOLE_ROW_LIMIT) {
    const body = await api.query(property, bodyAt(startRow));
    answers.push(body);
    const rows = body && typeof body === 'object' ? (body as { rows?: unknown }).rows : undefined;
    if (!Array.isArray(rows) || rows.length < SEARCH_CONSOLE_ROW_LIMIT) break;
  }
  return answers;
}

/**
 * The client whose job reads both the searches and the partner pages: one `sites.list` for the run, so both
 * reads pick the same property and a refused list refuses both.
 */
export function sharingSites(api: SearchConsoleApi): SearchConsoleApi {
  let sites: Promise<SiteEntry[]> | null = null;
  return { sites: () => (sites ??= api.sites()), query: (siteUrl, body) => api.query(siteUrl, body) };
}

// ----------------------------------------------------------------------------------------------
// #1294, BR-B2B-068 item 8.a: the Google searches that showed `tuggi.app/@nome`, per partner and day

/** The hosts of the partner page; a `/@` on another host of the domain property is not one. */
const PARTNER_PAGE_HOSTS = new Set([SEARCH_CONSOLE_DOMAIN, `www.${SEARCH_CONSOLE_DOMAIN}`]);
/**
 * `/@nome`, or `/<locale>/@nome` (the site serves `/@nome` without a locale; a prefixed one is read the same),
 * the `@` raw or encoded. The name is the first segment after it, as the site's middleware reads it.
 */
const PARTNER_PAGE_PATH = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:@|%40)([^/?#]+)/i;
/** The characters of an @ and of a client slug (`docs/contracts/identidade-publica.md`, "Formato"), and the site's cap. */
const PARTNER_NAME = /^[A-Za-z0-9._-]{1,64}$/;
/** `partner.search_console_daily.page`, `CHECK` 1 to 2048. */
export const PARTNER_PAGE_MAX_LENGTH = 2048;

/** The name a Search Console page is the partner page of, without the `@`, or null when it is not one. */
export function partnerNameOf(page: string): string | null {
  let url: URL;
  try {
    url = new URL(page, `https://${SEARCH_CONSOLE_DOMAIN}`);
  } catch {
    return null;
  }
  if (!PARTNER_PAGE_HOSTS.has(url.hostname.toLowerCase())) return null;
  const m = PARTNER_PAGE_PATH.exec(url.pathname);
  if (!m) return null;
  let name: string;
  try {
    name = decodeURIComponent(m[1]);
  } catch {
    return null;
  }
  return PARTNER_NAME.test(name) ? name : null;
}

/**
 * What `partner.resolve_public_page` answered, read as the site reads it (`tuggi-enterprise`
 * `src/lib/public-page.ts` `parsePublicPage`): a page names its client, a redirect names the current @ (an
 * old @ of the same account, or another spelling), anything else has no partner. An answer of another shape
 * throws: a contract change read as "no partner" would drop every day silently.
 */
export function pageOwnerOf(answer: unknown): { clientId: string } | { redirect: string } | null {
  const a = answer && typeof answer === 'object' ? (answer as Record<string, unknown>) : null;
  if (a?.state === 'not_found') return null;
  if (a?.state === 'page' && typeof a.client_id === 'string' && a.client_id) return { clientId: a.client_id };
  if (a?.state === 'redirect' && typeof a.to === 'string' && a.to) return { redirect: a.to };
  throw new Error(`resolve_public_page_unexpected_${String(a?.state)}`);
}

/** A row of `partner.search_console_daily`. */
export interface PartnerSearchRow {
  client_id: string;
  day: string;
  page: string;
  impressions: number;
  clicks: number;
}

/** A measure of `partner.search_console_daily`: `integer >= 0`, the API's double rounded; anything else is no row. */
const measure = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null;

export interface PartnerSearchResult {
  state: 'read' | 'no_property';
  from: string | null;
  to: string | null;
  /** Distinct pages Search Console answered under `/@`. */
  pages: number;
  /** Of those, the pages with no partner today (no page, a name that is not one, another host): skipped. */
  unmatched: number;
  /** Rows dropped for a bad day or measure, or a page over 2048 characters. */
  invalid: number;
  rows: number;
  clients: number;
  first_day: string | null;
}

export interface PartnerSearchDeps {
  /** The job's client, already `sharingSites`: the property is the one the searches read. */
  api: SearchConsoleApi;
  today: string;
  /** The latest day already in `partner.search_console_daily`, or null on the first run. */
  lastDay: string | null;
  /** `partner.resolve_public_page(p_name)`, the one resolver of the page, raw. */
  resolve: (name: string) => Promise<unknown>;
  /** Upsert of `partner.search_console_daily` on `(client_id, day, page)`, called once; the caller chunks. */
  write: (rows: PartnerSearchRow[]) => Promise<void>;
}

/**
 * The partner pages read like the searches (same property, window and pages) and tied to the partner by
 * the one resolver the page itself uses, so a click lands on the client the visit counter credits. The
 * day ties to the @ the page has when it is read: a day is read again for five days, then stays. An old @
 * of an account with a page redirects to the current one (`drive.retired_nicknames`, kept for good), so its
 * days go to the same partner. Every page is resolved before anything is written.
 */
export async function collectPartnerSearchConsole(deps: PartnerSearchDeps): Promise<PartnerSearchResult> {
  const property = pickProperty(await deps.api.sites());
  const result: PartnerSearchResult = {
    state: 'read',
    from: null,
    to: null,
    pages: 0,
    unmatched: 0,
    invalid: 0,
    rows: 0,
    clients: 0,
    first_day: null,
  };
  if (!property) return { ...result, state: 'no_property' };

  const { from, to } = readWindow(deps.today, deps.lastDay);
  result.from = from;
  result.to = to;

  const raw: Array<{ day: string; page: string; impressions: number; clicks: number }> = [];
  const pages = new Set<string>();
  for (const body of await everyPage(deps.api, property, (startRow) => partnerPagesBody(from, to, startRow))) {
    const rows = body && typeof body === 'object' ? (body as { rows?: unknown }).rows : undefined;
    for (const r of Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : []) {
      const [day, page] = Array.isArray(r?.keys) ? r.keys : [];
      if (typeof page === 'string' && page) pages.add(page);
      const impressions = measure(r?.impressions);
      const clicks = measure(r?.clicks);
      if (
        typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || typeof page !== 'string' || !page ||
        page.length > PARTNER_PAGE_MAX_LENGTH || impressions === null || clicks === null
      ) {
        result.invalid += 1;
        continue;
      }
      raw.push({ day, page, impressions, clicks });
    }
  }
  result.pages = pages.size;

  // One resolve per name, one redirect followed at most.
  const owners = new Map<string, string | null>();
  const ownerOf = async (name: string): Promise<string | null> => {
    if (owners.has(name)) return owners.get(name) ?? null;
    let owner = pageOwnerOf(await deps.resolve(name));
    if (owner && 'redirect' in owner) {
      const next = pageOwnerOf(await deps.resolve(owner.redirect));
      owner = next && 'clientId' in next ? next : null;
    }
    const clientId = owner && 'clientId' in owner ? owner.clientId : null;
    owners.set(name, clientId);
    return clientId;
  };
  const clientOfPage = new Map<string, string | null>();
  for (const page of pages) {
    const name = partnerNameOf(page);
    clientOfPage.set(page, name ? await ownerOf(name) : null);
  }
  result.unmatched = [...clientOfPage.values()].filter((c) => c === null).length;

  const byKey = new Map<string, PartnerSearchRow>();
  for (const r of raw) {
    const clientId = clientOfPage.get(r.page);
    if (clientId) byKey.set(`${clientId}|${r.day}|${r.page}`, { client_id: clientId, ...r });
  }
  const out = [...byKey.values()];
  if (out.length > 0) await deps.write(out);
  result.rows = out.length;
  result.clients = new Set(out.map((r) => r.client_id)).size;
  result.first_day = out.map((r) => r.day).sort()[0] ?? null;
  return result;
}
