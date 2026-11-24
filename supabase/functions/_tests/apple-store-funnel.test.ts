/**
 * #1168: the App Store side of the acquisition funnel, `_shared/apple-store-funnel.ts`, and the
 * `apple_store` job of the daily run. The segments in `fixtures/apple-store/` were written from the field
 * lists of the official documentation (2026-11-09), not downloaded: the first real collection confirms them.
 * Two daily instances per report; the later one (processed 2026-11-08) corrects 2026-11-06.
 */
import { assert, assertEquals } from './assert.ts';
import { APPLE_APP_ID, APPLE_REPORT_NAME, type AppleConfig, ASC_HOST } from '../_shared/apple-downloads.ts';
import {
  collectAppleStoreFunnel,
  type InstallsWrite,
  type ListingRow,
  parseDiscovery,
  parseInstalls,
  missingHint,
  parseStoreDownloads,
  STORE_REPORT_CATEGORIES,
  STORE_REPORTS,
  storeSource,
} from '../_shared/apple-store-funnel.ts';
import { type CollectDeps, runSocialCollect, type SocialStore, type SocialTable } from '../_shared/social-collect.ts';

const NOW = new Date('2026-11-09T09:00:00Z');
const fixture = (name: string) => Deno.readTextFileSync(new URL(`./fixtures/apple-store/${name}.tsv`, import.meta.url));

async function config(): Promise<AppleConfig> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const b64 = btoa(String.fromCharCode(...der)).replace(/(.{64})/g, '$1\n');
  return {
    keyId: 'TESTKEYID9',
    issuerId: '11111111-2222-4333-8444-555555555555',
    privateKey: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----`,
  };
}

async function gzip(text: string): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([new TextEncoder().encode(text)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const REPORT_IDS: Record<string, string> = {
  [STORE_REPORTS.discovery]: 'rep-discovery',
  [STORE_REPORTS.downloads]: 'rep-downloads',
  [STORE_REPORTS.installs]: 'rep-installs',
  [APPLE_REPORT_NAME]: 'rep-detailed',
};

/** The `category` App Store Connect gives each report, as the API lists it. */
const CATEGORIES: Record<string, string> = {
  [STORE_REPORTS.discovery]: 'APP_STORE_ENGAGEMENT',
  [STORE_REPORTS.downloads]: 'COMMERCE',
  [STORE_REPORTS.installs]: 'APP_USAGE',
  [APPLE_REPORT_NAME]: 'COMMERCE',
  'App Store Purchases Standard': 'COMMERCE',
  'App Sessions Standard': 'APP_USAGE',
};

interface RigOptions {
  /** Names the request lists; default the three Standard reports plus the Detailed one of #1062. */
  names?: string[];
  /** An answer by path prefix: Apple refusing that call. */
  refuse?: { path: string; status: number; body: unknown };
}

/** App Store Connect, recorded. The report list comes in two pages, joined by `links.next`. */
function rig(opts: RigOptions = {}) {
  const calls: Array<{ url: string; method: string; auth: string | null }> = [];
  const names = opts.names ?? Object.keys(REPORT_IDS);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const fetchFn = async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', auth: new Headers(init?.headers).get('authorization') });
    const u = new URL(url);
    if (opts.refuse && u.pathname.startsWith(opts.refuse.path)) return json(opts.refuse.body, opts.refuse.status);
    if (u.host === 'segments.example.com') {
      const name = u.pathname.slice(1);
      // One file gzip (as Apple sends them), the others plain: the reader takes both.
      return new Response(name === 'discovery-i1' ? await gzip(fixture(name)) : fixture(name), { status: 200 });
    }
    if (u.pathname === `/v1/apps/${APPLE_APP_ID}/analyticsReportRequests`) {
      return json({ data: [{ id: 'req-1', attributes: { accessType: 'ONGOING', stoppedDueToInactivity: false } }] });
    }
    if (u.pathname === '/v1/analyticsReportRequests/req-1/reports') {
      const all = names.map((name) => ({
        id: REPORT_IDS[name] ?? `rep-${name}`,
        attributes: { name, category: CATEGORIES[name] ?? 'FRAMEWORK_USAGE' },
      }));
      const half = Math.ceil(all.length / 2);
      if (u.searchParams.get('cursor') === '2') return json({ data: all.slice(half) });
      if (u.searchParams.has('filter[name]')) {
        return json({ data: all.filter((r) => r.attributes.name === u.searchParams.get('filter[name]')) });
      }
      return json({
        data: all.slice(0, half),
        links: all.length > half
          ? { next: `${ASC_HOST}/v1/analyticsReportRequests/req-1/reports?limit=200&cursor=2` }
          : {},
      });
    }
    const inst = /^\/v1\/analyticsReports\/rep-(\w+)\/instances$/.exec(u.pathname);
    if (inst) {
      if (inst[1] === 'detailed') return json({ data: [] });
      return json({
        data: [
          { id: `${inst[1]}-i2`, attributes: { granularity: 'DAILY', processingDate: '2026-11-08' } },
          { id: `${inst[1]}-i1`, attributes: { granularity: 'DAILY', processingDate: '2026-11-07' } },
        ],
      });
    }
    const seg = /^\/v1\/analyticsReportInstances\/([\w-]+)\/segments$/.exec(u.pathname);
    if (seg) {
      return json({ data: [{ id: `s-${seg[1]}`, attributes: { url: `https://segments.example.com/${seg[1]}` } }] });
    }
    return json({}, 404);
  };
  return { calls, fetch: fetchFn };
}

const EXPECTED_LISTING: Record<string, Partial<ListingRow>> = {
  '2026-11-05|App Store search': { source: 'store_search', impressions: 45, page_views: 12, downloads: 8 },
  '2026-11-05|App Store browse': { source: 'store_browse', impressions: 20, page_views: 0, downloads: 0 },
  '2026-11-05|Web referrer': { source: 'web_referrer', impressions: 0, page_views: 7, downloads: 4 },
  '2026-11-05|Siri Suggestions': { source: 'other', impressions: 4, page_views: 0, downloads: 0 },
  '2026-11-06|App Store search': { source: 'store_search', impressions: 33, page_views: 10, downloads: 6 },
  '2026-11-06|App referrer': { source: 'app_referrer', impressions: 0, page_views: 0, downloads: 1 },
  '2026-11-07|App Store search': { source: 'store_search', impressions: 25, page_views: 0, downloads: 4 },
  '2026-11-07|Notification': { source: 'other', impressions: 2, page_views: 0, downloads: 0 },
};

const measures = (r: Record<string, unknown> | undefined) =>
  r && { source: r.source, impressions: r.impressions, page_views: r.page_views, downloads: r.downloads };

Deno.test('#1168: Source Type maps to the five sources in one place; anything else is other', () => {
  const cases: Array<[string, string]> = [
    ['App Store search', 'store_search'],
    ['App Store browse', 'store_browse'],
    ['Web referrer', 'web_referrer'],
    ['App referrer', 'app_referrer'],
    ['app store SEARCH ', 'store_search'],
    ['App Clip', 'other'],
    ['Notification', 'other'],
    ['Unavailable', 'other'],
    ['Institutional purchase', 'other'],
    ['Siri Suggestions', 'other'],
    ['', 'other'],
  ];
  for (const [raw, source] of cases) assertEquals(storeSource(raw), source, raw);
});

Deno.test('#1168: discovery sums Unique Counts of impressions and of product page views, per day and Source Type', () => {
  const p = parseDiscovery(fixture('discovery-i1'));
  assertEquals(p.days, ['2026-11-05', '2026-11-06']);
  const by = Object.fromEntries(p.rows.map((r) => [`${r.day}|${r.source_raw}`, [r.impressions, r.page_views]]));
  // Unique Counts, not Counts (43 + 8); Developer page views and taps stay out; the other app's 1000 too.
  assertEquals(by, {
    '2026-11-05|App Store search': [45, 12],
    '2026-11-05|App Store browse': [20, 0],
    '2026-11-05|Web referrer': [0, 7],
    '2026-11-05|Siri Suggestions': [4, 0],
    '2026-11-06|App Store search': [30, 9],
  });
  let refused = '';
  try {
    parseDiscovery('Date\tEvent\tPage Type\tSource Type\tCounts\n2026-11-05\tImpression\tNo page\tApp Store search\t3');
  } catch (e) {
    refused = (e as Error).message;
  }
  assertEquals(refused, 'apple_report_columns');
});

Deno.test('#1168: downloads keep First-time Download Counts only; a source with only redownloads is 0', () => {
  const p = parseStoreDownloads(fixture('downloads-i1'));
  const by = Object.fromEntries(p.rows.map((r) => [`${r.day}|${r.source_raw}`, r.downloads]));
  assertEquals(by, {
    '2026-11-05|App Store search': 8,
    '2026-11-05|Web referrer': 4,
    '2026-11-05|App Store browse': 0,
    '2026-11-06|App Store search': 5,
    '2026-11-06|App referrer': 1,
  });
});

Deno.test('#1168: installs count Install and Delete events per day, whatever the download type', () => {
  assertEquals(parseInstalls(fixture('installs-i1')).rows, [
    { day: '2026-11-05', installs: 7, uninstalls: 1 },
    { day: '2026-11-06', installs: 4, uninstalls: 0 },
  ]);
});

Deno.test('#1168: the three reports merge per (day, source_raw), the later instance corrects a day, a measured absence is 0', async () => {
  const cfg = await config();
  const r = rig();
  const listing: ListingRow[] = [];
  const installs: InstallsWrite[] = [];
  const shapes: string[] = [];
  const result = await collectAppleStoreFunnel({
    config: cfg,
    fetch: r.fetch,
    now: () => NOW,
    coveredFrom: null,
    writeListing: (rows) => {
      // One upsert carries one set of columns.
      shapes.push(...new Set(rows.map((x) => Object.keys(x).join(','))));
      listing.push(...rows);
      return Promise.resolve();
    },
    writeInstalls: (rows) => (installs.push(...rows), Promise.resolve()),
  });
  assertEquals(result, {
    state: 'read',
    reports: { discovery: 'read', downloads: 'read', installs: 'read' },
    errors: [],
    instances: 6,
    listing_rows: 8,
    installs_rows: 3,
    first_day: '2026-11-05',
  });
  assertEquals(shapes.length, 1);
  const by = Object.fromEntries(
    listing.map((x) => [`${x.day}|${x.source_raw}`, measures(x as unknown as Record<string, unknown>)]),
  );
  assertEquals(Object.keys(by).sort(), Object.keys(EXPECTED_LISTING).sort());
  for (const [k, v] of Object.entries(EXPECTED_LISTING)) assertEquals(by[k], v, k);
  assert(listing.every((x) => x.store === 'app_store'));
  assertEquals(installs, [
    { day: '2026-11-05', installs: 7, uninstalls: 1, store: 'app_store' },
    { day: '2026-11-06', installs: 5, uninstalls: 2, store: 'app_store' },
    { day: '2026-11-07', installs: 3, uninstalls: 0, store: 'app_store' },
  ]);
  // The live request is reused, the second page of reports was followed, and no token went to a file URL.
  assertEquals(r.calls.filter((c) => c.method === 'POST').length, 0);
  assert(r.calls.some((c) => c.url.includes('cursor=2')), 'second page of reports not read');
  for (const c of r.calls) {
    assertEquals([c.url, c.auth?.startsWith('Bearer ') ?? false], [c.url, !c.url.includes('segments.example.com')]);
  }
});

Deno.test('#1168: a request with no report yet is pending and writes nothing', async () => {
  let writes = 0;
  const result = await collectAppleStoreFunnel({
    config: await config(),
    fetch: rig({ names: [] }).fetch,
    now: () => NOW,
    coveredFrom: null,
    writeListing: () => (writes++, Promise.resolve()),
    writeInstalls: () => (writes++, Promise.resolve()),
  });
  assertEquals([result.state, result.first_day, writes], ['pending', null, 0]);
});

Deno.test('#1168: after the first run only the last 14 days of instances are read again', async () => {
  const r = rig();
  await collectAppleStoreFunnel({
    config: await config(),
    fetch: r.fetch,
    now: () => new Date('2026-11-22T09:00:00Z'),
    coveredFrom: '2026-11-05',
    writeListing: () => Promise.resolve(),
    writeInstalls: () => Promise.resolve(),
  });
  // Since 2026-11-08: i2 (processed 2026-11-08) is read, i1 (2026-11-07) is not.
  const segments = r.calls.filter((c) => c.url.endsWith('/segments')).map((c) => c.url.split('/').at(-2));
  assertEquals(segments, ['discovery-i2', 'downloads-i2', 'installs-i2']);
});

// ------------------------------------------------------------------------------------------------
// The `apple_store` job of the daily run, everything else of the run switched off

const PK: Partial<Record<SocialTable, string[]>> = {
  collector_runs: ['job'],
  apple_downloads_daily: ['day', 'campaign'],
  store_listing_daily: ['day', 'store', 'source_raw'],
  store_installs_daily: ['day', 'store'],
};

function store() {
  const tables: Record<string, Map<string, Record<string, unknown>>> = {};
  const s: SocialStore = {
    activeAccounts: () => Promise.resolve([]),
    setIgUserId: () => Promise.resolve(),
    upsert: (table, rows, onConflict) => {
      assertEquals(onConflict, PK[table]?.join(','), table);
      tables[table] ??= new Map();
      const shape = JSON.stringify(Object.keys(rows[0] ?? {}));
      for (const row of rows) {
        assertEquals(JSON.stringify(Object.keys(row)), shape, `${table} rows of one upsert differ`);
        const k = onConflict.split(',').map((c) => String(row[c])).join('|');
        // What PostgREST does on conflict: only the columns the row carries are updated.
        tables[table].set(k, { ...(tables[table].get(k) ?? {}), ...row });
      }
      return Promise.resolve();
    },
    untaggedMedia: () => Promise.resolve([]),
    setTheme: () => Promise.resolve(),
    hasWeekly: () => Promise.resolve(true),
    hasAudience: () => Promise.resolve(true),
    coveredFrom: (job) =>
      Promise.resolve((tables.collector_runs?.get(job)?.covered_from as string | undefined) ?? null),
    lastDay: () => Promise.resolve(null),
    rpc: () => Promise.resolve([]),
    ownPostsSince: () => Promise.resolve([]),
    funnelSince: () => Promise.resolve([]),
    firstPostDay: () => Promise.resolve(null),
    followersSince: () => Promise.resolve([]),
    mediaCount: () => Promise.resolve(0),
  };
  const run = (job: string) => tables.collector_runs?.get(job);
  return { s, tables, run };
}

const deps = (s: SocialStore, apple: CollectDeps['apple'], logs: string[] = [], now = NOW): CollectDeps => ({
  store: s,
  meta: { igUserId: 'x', get: () => Promise.reject(new Error('no meta here')) },
  ga4: null,
  gemini: null,
  now: () => now,
  log: (l) => logs.push(l),
  apple,
});

Deno.test('#1168: without the Apple secrets apple_store is not_configured, with no call', async () => {
  const { s, run } = store();
  const r = rig();
  const report = await runSocialCollect(deps(s, { config: null, fetch: r.fetch }));
  assertEquals([report.apple_store, run('apple_store')?.status, r.calls.length], [
    'not_configured',
    'not_configured',
    0,
  ]);
});

Deno.test('#1168: a full run writes both tables and covered_from; a later refused report keeps the other columns and coverage', async () => {
  const cfg = await config();
  const { s, tables, run } = store();
  const first: string[] = [];
  const report = await runSocialCollect(deps(s, { config: cfg, fetch: rig().fetch }, first));
  assertEquals([report.apple_store, report.apple], ['read', 'read'], first.join(' / '));
  assertEquals([run('apple_store')?.status, run('apple_store')?.covered_from], ['ok', '2026-11-05']);
  assertEquals(tables.store_listing_daily.size, 8);
  assertEquals(
    measures(tables.store_listing_daily.get('2026-11-06|app_store|App Store search')),
    EXPECTED_LISTING['2026-11-06|App Store search'],
  );
  assertEquals(tables.store_installs_daily.get('2026-11-06|app_store'), {
    day: '2026-11-06',
    installs: 5,
    uninstalls: 2,
    store: 'app_store',
  });

  // Next day Apple refuses the downloads report, with a detail that (against all odds) names the key id.
  const logs: string[] = [];
  const refuse = {
    path: '/v1/analyticsReports/rep-downloads/instances',
    status: 403,
    body: {
      errors: [{
        status: '403',
        code: 'FORBIDDEN_ERROR',
        title: 'Forbidden',
        detail: `The API key ${cfg.keyId} in use does not allow this request`,
      }],
    },
  };
  const partial = await runSocialCollect(
    deps(s, { config: cfg, fetch: rig({ refuse }).fetch }, logs, new Date('2026-11-10T09:00:00Z')),
  );
  assertEquals(partial.apple_store, 'partial');
  const row = run('apple_store');
  assertEquals([row?.status, row?.covered_from], ['error', '2026-11-05']);
  assert(
    String(row?.detail).includes(
      'App Downloads Standard: apple_403 FORBIDDEN_ERROR: The API key [redacted] in use',
    ),
    String(row?.detail),
  );
  // Discovery rewrote its columns; the downloads the first run wrote are still there.
  assertEquals(
    measures(tables.store_listing_daily.get('2026-11-06|app_store|App Store search')),
    EXPECTED_LISTING['2026-11-06|App Store search'],
  );
  // The campaign job of #1062 ran on its own and is not touched by this refusal.
  assertEquals(run('apple')?.status, 'ok');
  const seen = logs.join('\n') + JSON.stringify(row);
  assert(
    !seen.includes(cfg.keyId) && !seen.includes(cfg.issuerId) && !seen.includes(cfg.privateKey.split('\n')[1]),
    'a secret leaked',
  );
});

Deno.test('#1168: Apple refusing everything records error with its words, keeps covered_from, and the run goes on', async () => {
  const cfg = await config();
  const { s, tables, run } = store();
  tables.collector_runs = new Map([['apple_store', { job: 'apple_store', status: 'ok', covered_from: '2026-11-01' }]]);
  const refuse = {
    path: '/v1/',
    status: 401,
    body: {
      errors: [{
        status: '401',
        code: 'NOT_AUTHORIZED',
        title: 'Authentication credentials are missing or invalid.',
        detail: 'Provide a properly configured and signed bearer token, and make sure that it has not expired.',
      }],
    },
  };
  const report = await runSocialCollect(deps(s, { config: cfg, fetch: rig({ refuse }).fetch }));
  assertEquals([report.apple_store, report.apple], ['failed', 'failed']);
  assertEquals(run('apple_store'), {
    job: 'apple_store',
    status: 'error',
    covered_from: '2026-11-01',
    last_run_at: NOW.toISOString(),
    detail:
      'apple_401 NOT_AUTHORIZED: Provide a properly configured and signed bearer token, and make sure that it has not expired.',
  });
  assertEquals(tables.store_listing_daily, undefined);
  // The daily row still closes the run.
  assertEquals(run('daily')?.status, 'ok');
});

Deno.test('#1168: a report the request does not list is an error naming it and what its category lists; the other two are written', async () => {
  const { s, tables, run } = store();
  const names = [
    STORE_REPORTS.discovery,
    STORE_REPORTS.installs,
    APPLE_REPORT_NAME,
    'App Store Purchases Standard',
    'App Sessions Standard',
  ];
  const report = await runSocialCollect(deps(s, { config: await config(), fetch: rig({ names }).fetch }));
  assertEquals(report.apple_store, 'partial');
  // Only names of the downloads category (COMMERCE), never an id, a key or a report of another category.
  assertEquals([run('apple_store')?.status, run('apple_store')?.detail], [
    'error',
    'App Downloads Standard: apple_report_missing (COMMERCE: App Downloads Detailed, App Store Purchases Standard)',
  ]);
  assertEquals(run('apple_store')?.covered_from, '2026-11-05');
  // Without the downloads report the column stays out of the upsert (null in the table), never 0.
  assertEquals(measures(tables.store_listing_daily.get('2026-11-05|app_store|App Store search')), {
    source: 'store_search',
    impressions: 45,
    page_views: 12,
    downloads: undefined,
  });
  assertEquals(tables.store_installs_daily.size, 3);
});

Deno.test('#1168: the names adopted for the API, and the hint of a missing report by category, none, or every name', () => {
  assertEquals(STORE_REPORTS, {
    discovery: 'App Store Discovery and Engagement Standard',
    downloads: 'App Downloads Standard',
    installs: 'App Store Installation and Deletion Standard',
  });
  assertEquals(APPLE_REPORT_NAME, 'App Downloads Detailed');
  assertEquals(STORE_REPORT_CATEGORIES.downloads, 'COMMERCE');
  const typed = new Map([
    ['App Sessions Standard', { category: 'APP_USAGE' }],
    ['App Store Installation and Deletion Standard', { category: 'APP_USAGE' }],
    ['App Downloads Detailed', { category: 'COMMERCE' }],
  ]);
  assertEquals(missingHint(typed, 'APP_USAGE'), 'APP_USAGE: App Sessions Standard, App Store Installation and Deletion Standard');
  assertEquals(missingHint(typed, 'APP_STORE_ENGAGEMENT'), 'APP_STORE_ENGAGEMENT: none');
  // A listing that carries no category names every report, so the hint is never empty by our filter.
  const untyped = new Map([['B report', { category: null }], ['A report', { category: null }]]);
  assertEquals(missingHint(untyped, 'COMMERCE'), 'listed: A report, B report');
});
