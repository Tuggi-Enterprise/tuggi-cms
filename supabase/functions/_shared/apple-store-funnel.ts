// _shared/apple-store-funnel.ts
//
// The App Store side of the acquisition funnel (#1168, interface fixed on #1167): how often the store
// showed Tuggi, how many opened its product page, how many downloaded it for the first time, per day and
// Source Type, into `social.store_listing_daily`; and how many installs and deletes per day into
// `social.store_installs_daily`. Same ONGOING request, same key and same helpers as `apple-downloads.ts`.
//
// Import-free: `fetch`, the clock and the database are parameters. Checked 2026-11-09 against the
// official documentation (developer.apple.com/documentation/analytics-reports: app-store-discovery-and-
// engagement, app-download, app-installs). The report `name` in the API carries the level suffix
// ("Some reports have two content levels, Standard or Detailed, which the report's name reflects with a
// suffix"); the installs report is titled "App Store Installations and Deletions" in the documentation.
// No real segment was read when this was written: if the first one differs from the names below, the
// file wins, and the fixtures of `_tests/apple-store-funnel.test.ts` follow it.

import {
  type AppleConfig,
  asc,
  ASC_HOST,
  ascToken,
  dailyInstances,
  dataOf,
  type FetchFn,
  instanceFiles,
  ongoingRequest,
  reportRows,
  rereadSince,
} from './apple-downloads.ts';

/** The three Standard reports, by the `name` App Store Connect lists them under. */
export const STORE_REPORTS = {
  discovery: 'App Store Discovery and Engagement Standard',
  downloads: 'App Store Downloads Standard',
  installs: 'App Store Installation and Deletion Standard',
} as const;
export type StoreReport = keyof typeof STORE_REPORTS;

export type StoreSource = 'store_search' | 'store_browse' | 'web_referrer' | 'app_referrer' | 'other';

/**
 * Apple `Source Type` to `social.store_listing_daily.source`, the one place it is decided. The label as
 * it came goes to `source_raw`. App Clip, Notification, Unavailable, Institutional purchase and any
 * label Apple adds later are `other`.
 *
 * Which Apple field feeds each column (decision on #1168: Unique Counts for the discovery measures, the
 * base of the Conversion Rate of App Store Connect, downloads over unique impressions):
 *   impressions  Discovery and Engagement, `Unique Counts` of Event = Impression
 *   page_views   Discovery and Engagement, `Unique Counts` of Event = Page view and Page Type = Product page
 *   downloads    App Store Downloads, `Counts` of Download Type = First-time Download
 *   installs     Installations and Deletions, `Counts` of Event = Install
 *   uninstalls   Installations and Deletions, `Counts` of Event = Delete
 * Unique Counts are summed over the other columns of the file (Device, Territory, Platform Version,
 * Engagement Type): one person in two rows counts twice, so the sum is a ceiling of unique people.
 */
const SOURCES: Record<string, StoreSource> = {
  'app store search': 'store_search',
  'app store browse': 'store_browse',
  'web referrer': 'web_referrer',
  'app referrer': 'app_referrer',
};
export const storeSource = (raw: string): StoreSource => SOURCES[raw.trim().toLowerCase()] ?? 'other';

const lower = (v: string | undefined) => (v ?? '').trim().toLowerCase();
const count = (v: string | undefined) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
};

export interface DiscoveryRow {
  day: string;
  source_raw: string;
  impressions: number;
  page_views: number;
}
export interface DownloadsRow {
  day: string;
  source_raw: string;
  downloads: number;
}
export interface InstallsRow {
  day: string;
  installs: number;
  uninstalls: number;
}
interface Parsed<T> {
  rows: T[];
  days: string[];
}

/** Sums by key; every row of the file seen under a key opens it at zero, so a key without the event is 0. */
function sumBy<T extends object>(
  rows: Array<Record<string, string>>,
  key: (f: Record<string, string>) => string,
  open: (f: Record<string, string>) => T,
  add: (acc: T, f: Record<string, string>) => void,
): Parsed<T> {
  const sums = new Map<string, T>();
  const days = new Set<string>();
  for (const f of rows) {
    days.add(f.Date);
    const k = key(f);
    const acc = sums.get(k) ?? open(f);
    add(acc, f);
    sums.set(k, acc);
  }
  return { rows: [...sums.values()], days: [...days].sort() };
}

const byDaySource = (f: Record<string, string>) => `${f.Date}|${f['Source Type']}`;

export function parseDiscovery(text: string): Parsed<DiscoveryRow> {
  return sumBy(
    reportRows(text, ['Event', 'Page Type', 'Source Type', 'Unique Counts']),
    byDaySource,
    (f) => ({ day: f.Date, source_raw: f['Source Type'], impressions: 0, page_views: 0 }),
    (acc, f) => {
      const event = lower(f.Event);
      if (event === 'impression') acc.impressions += count(f['Unique Counts']);
      else if (event === 'page view' && lower(f['Page Type']) === 'product page') {
        acc.page_views += count(f['Unique Counts']);
      }
    },
  );
}

export function parseStoreDownloads(text: string): Parsed<DownloadsRow> {
  return sumBy(
    reportRows(text, ['Download Type', 'Source Type', 'Counts']),
    byDaySource,
    (f) => ({ day: f.Date, source_raw: f['Source Type'], downloads: 0 }),
    (acc, f) => {
      if (lower(f['Download Type']) === 'first-time download') acc.downloads += count(f.Counts);
    },
  );
}

export function parseInstalls(text: string): Parsed<InstallsRow> {
  return sumBy(
    reportRows(text, ['Event', 'Counts']),
    (f) => f.Date,
    (f) => ({ day: f.Date, installs: 0, uninstalls: 0 }),
    (acc, f) => {
      const event = lower(f.Event);
      if (event === 'install') acc.installs += count(f.Counts);
      else if (event === 'delete') acc.uninstalls += count(f.Counts);
    },
  );
}

/** A row of `social.store_listing_daily`. A measure left out is not touched by the upsert. */
export interface ListingRow {
  day: string;
  store: 'app_store';
  source: StoreSource;
  source_raw: string;
  impressions?: number;
  page_views?: number;
  downloads?: number;
}
export interface InstallsWrite extends InstallsRow {
  store: 'app_store';
}

export interface StoreFunnelResult {
  /** `pending`: the request lists no report yet (Apple generates them 1 to 2 days after the request). */
  state: 'read' | 'pending';
  /** Per report: read, not listed by the request, or refused (the message is in `errors`). */
  reports: Record<StoreReport, 'read' | 'missing' | 'failed' | 'skipped'>;
  /** One line per report that was not read, with Apple's words; the job is `error` when there is any. */
  errors: string[];
  instances: number;
  listing_rows: number;
  installs_rows: number;
  /** The first day any read file covered, or null when none did. */
  first_day: string | null;
}

export interface StoreFunnelDeps {
  config: AppleConfig;
  fetch: FetchFn;
  now: () => Date;
  /** Upsert of `social.store_listing_daily` on `(day, store, source_raw)`; one call per set of columns. */
  writeListing: (rows: ListingRow[]) => Promise<void>;
  /** Upsert of `social.store_installs_daily` on `(day, store)`. */
  writeInstalls: (rows: InstallsWrite[]) => Promise<void>;
  /** The `covered_from` of the `apple_store` job: null on the first run, which then reads every instance. */
  coveredFrom: string | null;
}

/** Every report the request lists, following `links.next`. */
async function listReports(fetchFn: FetchFn, token: string, requestId: string) {
  const found = new Map<string, string>();
  let path: string | null = `/v1/analyticsReportRequests/${requestId}/reports?limit=200`;
  for (let page = 0; path && page < 10; page++) {
    const body: Record<string, unknown> = await asc(fetchFn, token, path);
    for (const r of dataOf(body)) {
      const name = r.attributes?.name;
      if (typeof name === 'string' && typeof r.id === 'string') found.set(name, r.id);
    }
    const next = (body.links as { next?: unknown } | undefined)?.next;
    path = typeof next === 'string' && next.startsWith(ASC_HOST) ? next.slice(ASC_HOST.length) : null;
  }
  return found;
}

export async function collectAppleStoreFunnel(deps: StoreFunnelDeps): Promise<StoreFunnelResult> {
  const now = deps.now();
  const token = await ascToken(deps.config, Math.floor(now.getTime() / 1000));
  const requestId = await ongoingRequest(deps.fetch, token);
  const listed = await listReports(deps.fetch, token, requestId);
  const result: StoreFunnelResult = {
    state: 'read',
    reports: { discovery: 'skipped', downloads: 'skipped', installs: 'skipped' },
    errors: [],
    instances: 0,
    listing_rows: 0,
    installs_rows: 0,
    first_day: null,
  };
  if (listed.size === 0) return { ...result, state: 'pending' };

  const since = rereadSince(now, deps.coveredFrom);
  const covered: Record<StoreReport, Set<string>> = { discovery: new Set(), downloads: new Set(), installs: new Set() };
  const listing = new Map<string, ListingRow>();
  const installs = new Map<string, InstallsWrite>();
  const listingRow = (day: string, raw: string): ListingRow => {
    const k = `${day}|${raw}`;
    const row = listing.get(k) ?? { day, store: 'app_store', source: storeSource(raw), source_raw: raw };
    listing.set(k, row);
    return row;
  };

  // Instances oldest first within each report; a later instance overwrites the (day, source) it carries.
  const apply: Record<StoreReport, (text: string) => string[]> = {
    discovery: (text) => {
      const p = parseDiscovery(text);
      for (const r of p.rows) {
        Object.assign(listingRow(r.day, r.source_raw), { impressions: r.impressions, page_views: r.page_views });
      }
      return p.days;
    },
    downloads: (text) => {
      const p = parseStoreDownloads(text);
      for (const r of p.rows) listingRow(r.day, r.source_raw).downloads = r.downloads;
      return p.days;
    },
    installs: (text) => {
      const p = parseInstalls(text);
      for (const r of p.rows) installs.set(r.day, { ...r, store: 'app_store' });
      return p.days;
    },
  };

  for (const key of Object.keys(STORE_REPORTS) as StoreReport[]) {
    const name = STORE_REPORTS[key];
    const reportId = listed.get(name);
    if (!reportId) {
      result.reports[key] = 'missing';
      result.errors.push(`${name}: apple_report_missing`);
      continue;
    }
    try {
      // Read the whole report before applying it: a refusal halfway leaves none of its rows in memory.
      const files: string[] = [];
      for (const instance of await dailyInstances(deps.fetch, token, reportId, since)) {
        files.push(...(await instanceFiles(deps.fetch, token, instance.id)));
        result.instances += 1;
      }
      for (const text of files) for (const day of apply[key](text)) covered[key].add(day);
      result.reports[key] = 'read';
    } catch (e) {
      result.reports[key] = 'failed';
      result.errors.push(`${name}: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  }

  // A day a report covers with no row for a source seen by the other report is a measured zero, not null.
  for (const row of listing.values()) {
    if (covered.discovery.has(row.day)) {
      row.impressions ??= 0;
      row.page_views ??= 0;
    }
    if (covered.downloads.has(row.day)) row.downloads ??= 0;
  }
  // Every row of one upsert carries the same columns, so the rows go grouped by the measures they hold.
  const groups = new Map<string, ListingRow[]>();
  for (const row of listing.values()) {
    const held = (['impressions', 'page_views', 'downloads'] as const).filter((c) => row[c] !== undefined);
    const out: ListingRow = { day: row.day, store: row.store, source: row.source, source_raw: row.source_raw };
    for (const c of held) out[c] = row[c];
    const shape = held.join(',');
    groups.set(shape, [...(groups.get(shape) ?? []), out]);
  }
  for (const rows of groups.values()) await deps.writeListing(rows);
  if (installs.size > 0) await deps.writeInstalls([...installs.values()]);

  result.listing_rows = listing.size;
  result.installs_rows = installs.size;
  const days = [...covered.discovery, ...covered.downloads, ...covered.installs].sort();
  result.first_day = days[0] ?? null;
  return result;
}
