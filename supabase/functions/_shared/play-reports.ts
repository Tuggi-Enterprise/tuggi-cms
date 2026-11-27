// _shared/play-reports.ts
//
// The Google Play side of the acquisition funnel (#1169, interface fixed on #1167 and #1306): the monthly
// reports Play writes into the developer's Cloud Storage bucket, read with the Cloud Storage JSON API, job
// `play` of `social.collector_runs`:
//   stats/store_performance/store_performance_<package>_<yyyyMM>_traffic_source.csv
//     per day and Traffic source into `social.store_listing_daily` (visitors to `page_views`, acquisitions to
//     `downloads`, `impressions` null: Play does not measure it), and per Search term, summed over the month,
//     into `social.store_search_terms_monthly`;
//   stats/store_performance/store_performance_<package>_<yyyyMM>_country.csv
//     per day and Country into `social.store_country_daily`, the same two measures;
//   stats/installs/installs_<package>_<yyyyMM>_overview.csv
//     per day, installs and uninstalls into `social.store_installs_daily`.
//
// Import-free except `ga4-data.ts` (the service account token), `events-sources.ts` (the CSV reader) and
// `store-country.ts`, all import-free: `fetch`, the clock and the database are parameters.
//
// Checked 2026-11-27 against the official documentation:
// - Play Console help, "Download and export monthly reports" (support.google.com/googleplay/android-developer/
//   answer/6135870): the file names above; monthly CSV files, "convert the CSV files from UTF-16 to UTF-8"; a cell
//   with a comma, tab, newline or double quote is double-quoted; Traffic source, Search term, UTM source and UTM
//   campaign "Can be `Other` if this value does not reach certain minimum thresholds"; access by a service
//   account invited in Users and permissions with "View app information" at the Global level and the scope
//   `https://www.googleapis.com/auth/devstorage.read_only`.
// - Columns, from the same page: store performance by traffic source `Date, Package name, Traffic source, Search
//   term, UTM source, UTM campaign, Store listing acquisitions, Store listing visitors, Store listing conversion
//   rate`; by country the same with `Country`; installs `Date, Package Name, ..., Daily Device Installs, Daily
//   Device Uninstalls, ...`. The files Play writes today also carry `Install events` and `Uninstall events`
//   (#1169 card), taken first when present. NO REAL FILE WAS READ YET: the fixture of the tests is written from
//   the page, the names confirm on the first run. Header names are compared without case, and a file that lacks
//   a required column is recorded as `play_report_columns` with the columns it has, so the detail of that run
//   shows the right names.
// - Cloud Storage JSON API v1: `GET https://storage.googleapis.com/storage/v1/b/<bucket>/o?prefix=` lists
//   `items[]` "ordered lexicographically by name", with `nextPageToken` for the next `pageToken`;
//   `GET .../o/<object>?alt=media` returns the object data, the name URL-encoded as one path segment. A missing
//   object answers 404: a month with no file is `missing`, not an error.
//
// The credential is the Play account of the CMS (`GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_SERVICE_ACCOUNT_KEY`,
// the pair `validate-google-purchase` reads), drawn into a token of its own with the read-only storage scope only,
// never the token of the purchase validation. No log line, error or detail carries the key, the e-mail or the
// token: Google's words go through `googleErrorDetail`, which strips e-mails and access tokens.
//
// History: the first run (no `covered_from`) reads every month the bucket lists; later runs read the current
// and the previous month, plus any listed month older than `covered_from` (a first run cut by the time budget
// goes on there). Months are read newest first and a refusal stops the older ones, so `covered_from` never
// skips a month that was not read.

import { parseCsv } from './events-sources.ts';
import {
  googleAccessToken,
  GoogleApiError,
  googleApiError,
  googleErrorDetail,
  type ServiceAccount,
} from './ga4-data.ts';
import { countryCode } from './store-country.ts';

/** `applicationId` of `tuggi-drive-v2/android/app/build.gradle`. */
export const PLAY_PACKAGE = 'com.tuggidrive.app';
export const PLAY_ENV = {
  bucket: 'PLAY_REPORTS_BUCKET',
  email: 'GOOGLE_SERVICE_ACCOUNT_EMAIL',
  key: 'GOOGLE_SERVICE_ACCOUNT_KEY',
} as const;
export const STORAGE_READ_SCOPE = 'https://www.googleapis.com/auth/devstorage.read_only';
export const STORAGE_API = 'https://storage.googleapis.com/storage/v1';
/** Pages of 1000 objects listed at most per prefix, a guard against a runaway token. */
const LIST_MAX_PAGES = 20;

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface PlayConfig {
  bucket: string;
  account: ServiceAccount;
}

/**
 * The bucket and the service account, or null when any secret is missing: the job is then `not_configured`.
 * The bucket is the name only; a pasted `gs://<bucket>/...` is cut to the name.
 */
export function playConfig(get: (name: string) => string | undefined): PlayConfig | null {
  const bucket = (get(PLAY_ENV.bucket) ?? '').trim().replace(/^gs:\/\//, '').split('/')[0];
  const clientEmail = (get(PLAY_ENV.email) ?? '').trim();
  const privateKey = (get(PLAY_ENV.key) ?? '').replace(/\\n/g, '\n').trim();
  return bucket && clientEmail && privateKey ? { bucket, account: { clientEmail, privateKey } } : null;
}

export type PlayFile = 'traffic_source' | 'country' | 'installs';
export const PLAY_FILES: readonly PlayFile[] = ['traffic_source', 'country', 'installs'];

export function playObject(file: PlayFile, month: string): string {
  return file === 'installs'
    ? `stats/installs/installs_${PLAY_PACKAGE}_${month}_overview.csv`
    : `stats/store_performance/store_performance_${PLAY_PACKAGE}_${month}_${file}.csv`;
}

/** UTF-16 by its byte order mark (Play writes UTF-16), UTF-16LE when an ASCII header shows a zero second byte, else UTF-8. */
export function decodeReport(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  if (bytes.length > 1 && bytes[0] !== 0 && bytes[1] === 0) return new TextDecoder('utf-16le').decode(bytes);
  return new TextDecoder().decode(bytes);
}

export type PlaySource = 'store_search' | 'store_browse' | 'third_party' | 'other';

/** Play `Traffic source` to `social.store_listing_daily.source`, the one place it is decided; `Other` and anything new is `other`. */
const SOURCES: Record<string, PlaySource> = {
  'google play search': 'store_search',
  'google play explore': 'store_browse',
  'third-party referrals': 'third_party',
};
export const playSource = (raw: string): PlaySource => SOURCES[raw.trim().toLowerCase()] ?? 'other';

/** Required columns of each file, each with the names it may come under (compared without case). */
const COLUMNS = {
  date: ['Date'],
  visitors: ['Store listing visitors'],
  acquisitions: ['Store listing acquisitions'],
  source: ['Traffic source'],
  term: ['Search term'],
  country: ['Country', 'Country / Region', 'Country/Region'],
  installs: ['Install events', 'Daily Device Installs'],
  uninstalls: ['Uninstall events', 'Daily Device Uninstalls'],
} as const;
type Column = keyof typeof COLUMNS;
const REQUIRED: Record<PlayFile, Column[]> = {
  traffic_source: ['date', 'source', 'term', 'visitors', 'acquisitions'],
  country: ['date', 'country', 'visitors', 'acquisitions'],
  installs: ['date', 'installs', 'uninstalls'],
};

/** The rows of one file by our column keys. Throws `play_report_columns` with the header it found. */
export function playRows(file: PlayFile, text: string): Array<Record<Column | 'package', string>> {
  const records = parseCsv(text);
  if (records.length === 0) return [];
  const head = Object.keys(records[0]);
  const find = (names: readonly string[]) =>
    names.map((n) => head.find((h) => h.toLowerCase() === n.toLowerCase())).find((h) => h !== undefined);
  const columns = new Map<Column, string>();
  for (const c of REQUIRED[file]) {
    const h = find(COLUMNS[c]);
    if (!h) throw new Error(`play_report_columns ${file} (found: ${head.join(', ')})`.slice(0, 300));
    columns.set(c, h);
  }
  const pkg = find(['Package name']);
  const out: Array<Record<Column | 'package', string>> = [];
  for (const r of records) {
    const row = { package: pkg ? String(r[pkg] ?? '').trim() : '' } as Record<Column | 'package', string>;
    for (const [c, h] of columns) row[c] = String(r[h] ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue;
    if (row.package && row.package !== PLAY_PACKAGE) continue;
    out.push(row);
  }
  return out;
}

/** A measure: blank or not a number is null (not measured), never 0. */
const measure = (v: string): number | null => {
  if (v === '') return null;
  const n = Number(v.replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
};
const plus = (a: number | null | undefined, b: number | null): number | null =>
  a == null && b === null ? null : (a ?? 0) + (b ?? 0);

export interface PlayListingRow {
  day: string;
  store: 'play_store';
  source: PlaySource;
  source_raw: string;
  impressions: null;
  page_views: number | null;
  downloads: number | null;
}
export interface PlayTermRow {
  month: string;
  store: 'play_store';
  term: string;
  page_views: number | null;
  downloads: number | null;
}
export interface PlayCountryRow {
  day: string;
  store: 'play_store';
  country: string;
  impressions: null;
  page_views: number | null;
  downloads: number | null;
}
export interface PlayInstallsRow {
  day: string;
  store: 'play_store';
  installs: number | null;
  uninstalls: number | null;
}

/** `yyyyMM` to the first day of the month, `yyyy-MM-01`. */
const monthDay = (month: string) => `${month.slice(0, 4)}-${month.slice(4)}-01`;

export function parseTrafficSource(
  text: string,
  month: string,
): { listing: PlayListingRow[]; terms: PlayTermRow[]; days: string[] } {
  const listing = new Map<string, PlayListingRow>();
  const terms = new Map<string, PlayTermRow>();
  const days = new Set<string>();
  for (const r of playRows('traffic_source', text)) {
    days.add(r.date);
    const k = `${r.date}|${r.source}`;
    const row = listing.get(k) ??
      {
        day: r.date,
        store: 'play_store',
        source: playSource(r.source),
        source_raw: r.source,
        impressions: null,
        page_views: null,
        downloads: null,
      };
    row.page_views = plus(row.page_views, measure(r.visitors));
    row.downloads = plus(row.downloads, measure(r.acquisitions));
    listing.set(k, row);
    if (!r.term) continue;
    const t = terms.get(r.term) ??
      { month: monthDay(month), store: 'play_store', term: r.term, page_views: null, downloads: null };
    t.page_views = plus(t.page_views, measure(r.visitors));
    t.downloads = plus(t.downloads, measure(r.acquisitions));
    terms.set(r.term, t);
  }
  return { listing: [...listing.values()], terms: [...terms.values()], days: [...days].sort() };
}

export function parseCountry(text: string): { rows: PlayCountryRow[]; days: string[]; unmapped: string[] } {
  const rows = new Map<string, PlayCountryRow>();
  const days = new Set<string>();
  const unmapped = new Set<string>();
  for (const r of playRows('country', text)) {
    days.add(r.date);
    const country = countryCode(r.country);
    if (!country) {
      unmapped.add(r.country);
      continue;
    }
    const k = `${r.date}|${country}`;
    const row = rows.get(k) ??
      { day: r.date, store: 'play_store', country, impressions: null, page_views: null, downloads: null };
    row.page_views = plus(row.page_views, measure(r.visitors));
    row.downloads = plus(row.downloads, measure(r.acquisitions));
    rows.set(k, row);
  }
  return { rows: [...rows.values()], days: [...days].sort(), unmapped: [...unmapped].sort() };
}

export function parseInstallsOverview(text: string): { rows: PlayInstallsRow[]; days: string[] } {
  const rows = new Map<string, PlayInstallsRow>();
  for (const r of playRows('installs', text)) {
    const row = rows.get(r.date) ?? { day: r.date, store: 'play_store', installs: null, uninstalls: null };
    row.installs = plus(row.installs, measure(r.installs));
    row.uninstalls = plus(row.uninstalls, measure(r.uninstalls));
    rows.set(r.date, row);
  }
  return { rows: [...rows.values()], days: [...rows.keys()].sort() };
}

export interface PlayResult {
  /** Months with at least one file read; months the bucket has no file for; months left for the time budget. */
  months: { read: number; missing: string[]; left: number };
  files: number;
  listing_rows: number;
  term_rows: number;
  country_rows: number;
  installs_rows: number;
  /** Country labels that are not a country code (`store-country.ts`), dropped. */
  unmapped_countries: string[];
  /** One line per file refused or unreadable; the job is `error` when there is any. */
  errors: string[];
  /** The first day any read file covered, or null when none did. */
  first_day: string | null;
}

export interface PlayDeps {
  config: PlayConfig;
  fetch: FetchFn;
  now: () => Date;
  /** Epoch ms after which no new month is started. */
  deadline: number;
  /** The `covered_from` of the `play` job: null on the first run, which reads every listed month. */
  coveredFrom: string | null;
  /** Upsert of `social.store_listing_daily` on `(day, store, source_raw)`. */
  writeListing: (rows: PlayListingRow[]) => Promise<void>;
  /** Upsert of `social.store_search_terms_monthly` on `(month, store, term)`. */
  writeTerms: (rows: PlayTermRow[]) => Promise<void>;
  /** Upsert of `social.store_country_daily` on `(day, store, country)`. */
  writeCountry: (rows: PlayCountryRow[]) => Promise<void>;
  /** Upsert of `social.store_installs_daily` on `(day, store)`. */
  writeInstalls: (rows: PlayInstallsRow[]) => Promise<void>;
}

/** `yyyyMM` of a date, and of the month before it. */
const monthOf = (d: Date) => d.toISOString().slice(0, 7).replace('-', '');
function previousMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(4));
  return m === 1 ? `${y - 1}12` : `${y}${String(m - 1).padStart(2, '0')}`;
}

const MONTH_IN_NAME = /_(\d{6})_(traffic_source|country|overview)\.csv$/;

/** Every `yyyyMM` the bucket has a report of ours for, by listing the two prefixes. */
async function listedMonths(deps: PlayDeps, token: () => Promise<string>): Promise<Set<string>> {
  const months = new Set<string>();
  const prefixes = [
    `stats/store_performance/store_performance_${PLAY_PACKAGE}_`,
    `stats/installs/installs_${PLAY_PACKAGE}_`,
  ];
  for (const prefix of prefixes) {
    let pageToken: string | null = null;
    for (let page = 0; page < LIST_MAX_PAGES; page++) {
      const q = new URLSearchParams({ prefix, fields: 'items(name),nextPageToken' });
      if (pageToken) q.set('pageToken', pageToken);
      const res = await deps.fetch(`${STORAGE_API}/b/${encodeURIComponent(deps.config.bucket)}/o?${q}`, {
        headers: { Authorization: `Bearer ${await token()}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw await googleApiError('play_list', res);
      const body = (await res.json().catch(() => null)) as {
        items?: Array<{ name?: unknown }>;
        nextPageToken?: unknown;
      } | null;
      for (const item of body?.items ?? []) {
        const m = typeof item.name === 'string' ? MONTH_IN_NAME.exec(item.name) : null;
        if (m) months.add(m[1]);
      }
      pageToken = typeof body?.nextPageToken === 'string' ? body.nextPageToken : null;
      if (!pageToken) break;
    }
  }
  return months;
}

/** One object's text, or null when the bucket has no such object (404). */
async function download(deps: PlayDeps, token: () => Promise<string>, name: string): Promise<string | null> {
  const url = `${STORAGE_API}/b/${encodeURIComponent(deps.config.bucket)}/o/${encodeURIComponent(name)}?alt=media`;
  const res = await deps.fetch(url, {
    headers: { Authorization: `Bearer ${await token()}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw await googleApiError('play_object', res);
  return decodeReport(new Uint8Array(await res.arrayBuffer()));
}

export async function collectPlayReports(deps: PlayDeps): Promise<PlayResult> {
  const draw = googleAccessToken(
    deps.config.account,
    STORAGE_READ_SCOPE,
    'play',
    deps.fetch,
    () => deps.now().getTime(),
  );
  // A key that does not import throws WebCrypto's own error: it is named here, never forwarded.
  const token = () =>
    draw().catch((e) => {
      throw e instanceof GoogleApiError ? e : new Error('play_token_failed');
    });
  const result: PlayResult = {
    months: { read: 0, missing: [], left: 0 },
    files: 0,
    listing_rows: 0,
    term_rows: 0,
    country_rows: 0,
    installs_rows: 0,
    unmapped_countries: [],
    errors: [],
    first_day: null,
  };

  const current = monthOf(deps.now());
  const listed = await listedMonths(deps, token);
  const coveredMonth = deps.coveredFrom ? deps.coveredFrom.slice(0, 7).replace('-', '') : null;
  const wanted = new Set([current, previousMonth(current)]);
  for (const m of listed) if (!coveredMonth || m < coveredMonth) wanted.add(m);
  const months = [...wanted].sort().reverse();

  const unmapped = new Set<string>();
  const days: string[] = [];
  for (let i = 0; i < months.length; i++) {
    const month = months[i];
    if (deps.now().getTime() >= deps.deadline) {
      result.months.left = months.length - i;
      break;
    }
    let found = 0;
    let refused = false;
    const monthDays: string[] = [];
    for (const file of PLAY_FILES) {
      try {
        const text = await download(deps, token, playObject(file, month));
        if (text === null) continue;
        found++;
        if (file === 'traffic_source') {
          const p = parseTrafficSource(text, month);
          await deps.writeListing(p.listing);
          await deps.writeTerms(p.terms);
          result.listing_rows += p.listing.length;
          result.term_rows += p.terms.length;
          monthDays.push(...p.days);
        } else if (file === 'country') {
          const p = parseCountry(text);
          await deps.writeCountry(p.rows);
          result.country_rows += p.rows.length;
          p.unmapped.forEach((u) => unmapped.add(u));
          monthDays.push(...p.days);
        } else {
          const p = parseInstallsOverview(text);
          await deps.writeInstalls(p.rows);
          result.installs_rows += p.rows.length;
          monthDays.push(...p.days);
        }
        result.files++;
      } catch (e) {
        refused = true;
        result.errors.push(`${file} ${month}: ${googleErrorDetail(e)}`);
      }
    }
    if (found > 0) result.months.read++;
    else if (!refused) result.months.missing.push(month);
    if (refused) {
      // This month and the older ones wait for the next run: covered_from must not move past a month not
      // read whole, so its days do not count and the next run (it is older than covered_from) reads it again.
      result.months.left = months.length - i - 1;
      break;
    }
    days.push(...monthDays);
  }
  result.unmapped_countries = [...unmapped].sort().slice(0, 20);
  result.first_day = days.sort()[0] ?? null;
  return result;
}
