/**
 * #1170: the site channels and the Google searches of the acquisition funnel, the jobs `site_channels` and
 * `search_console` of the daily run (`_shared/social-collect.ts`, `_shared/search-console.ts`) and the Google
 * error kept for `collector_runs.detail` (`_shared/ga4-data.ts`). The answers in `fixtures/google/` follow the
 * documented shapes (Data API v1beta runReport, Search Console v3, google.rpc.Status), written 2026-11-09,
 * not downloaded: the first real collection confirms them. Null is "not measured", never 0 (DS-COMPONENTE-084
 * item 1, contract `banco-para-cms.md` Parte 28).
 */
import { assert, assertEquals } from './assert.ts';
import {
  GA4_SCOPE,
  ga4Runner,
  GOOGLE_TOKEN_URL,
  GoogleApiError,
  googleApiError,
  googleErrorDetail,
  type ServiceAccount,
} from '../_shared/ga4-data.ts';
import {
  collectSearchConsole,
  monthsBefore,
  pickProperty,
  SEARCH_CONSOLE_ROW_LIMIT,
  SEARCH_CONSOLE_SCOPE,
  type SearchConsoleApi,
  searchConsoleClient,
  searchConsoleRows,
  type SiteEntry,
} from '../_shared/search-console.ts';
import {
  type CollectDeps,
  type Ga4Run,
  runSocialCollect,
  type SocialStore,
  type SocialTable,
  STORE_DIMENSION_SINCE,
} from '../_shared/social-collect.ts';

const NOW = new Date('2026-11-09T09:00:00Z');
const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(Deno.readTextFileSync(new URL(`./fixtures/google/${name}.json`, import.meta.url)));
const answer = (name: string, status: number) => new Response(JSON.stringify(fixture(name)), { status });

// ------------------------------------------------------------------------------------------------
// The Google error

Deno.test('#1170: a SERVICE_DISABLED refusal keeps the code, the status, the reason and the sentence', async () => {
  const e = await googleApiError('search_console', answer('error-403-service-disabled', 403));
  assert(e instanceof GoogleApiError);
  assertEquals(e.message, 'search_console_403');
  assertEquals([e.google.status, e.google.reason], ['PERMISSION_DENIED', 'SERVICE_DISABLED']);
  assert(
    googleErrorDetail(e).startsWith(
      'search_console_403 PERMISSION_DENIED SERVICE_DISABLED: Google Search Console API has not been used in project',
    ),
    googleErrorDetail(e),
  );
});

Deno.test('#1170: a missing grant reads as forbidden, the GA4 code stays the one callers compare, no e-mail', async () => {
  const user = await googleApiError('search_console', answer('error-403-permission', 403));
  assert(googleErrorDetail(user).startsWith('search_console_403 PERMISSION_DENIED forbidden: User does not have'));

  const ga4 = await googleApiError('ga4_report', answer('error-403-ga4-property', 403));
  // The site and app collectors of #1059 compare the message: it is still the bare code.
  assertEquals(ga4.message, 'ga4_report_403');
  const detail = googleErrorDetail(ga4);
  assert(detail.includes('PERMISSION_DENIED: User does not have sufficient permissions for this property'), detail);
  assert(!detail.includes('iam.gserviceaccount.com') && detail.includes('[email]'), detail);

  const token = await googleApiError(
    'search_console_token',
    new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }), {
      status: 400,
    }),
  );
  assertEquals(googleErrorDetail(token), 'search_console_token_400 invalid_grant: Invalid JWT Signature.');
  const opaque = await googleApiError('ga4_report', new Response('<html>502</html>', { status: 502 }));
  assertEquals(googleErrorDetail(opaque), 'ga4_report_502');
});

// ------------------------------------------------------------------------------------------------
// Search Console, the pure parts

Deno.test('#1170: the property is sc-domain:tuggi.app when listed, else the https apex, never an unverified entry', () => {
  const sites = fixture('search-console-sites').siteEntry as Array<{ siteUrl: string; permissionLevel: string }>;
  assertEquals(pickProperty(sites), 'sc-domain:tuggi.app');
  assertEquals(pickProperty(sites.filter((s) => !s.siteUrl.startsWith('sc-domain:'))), 'https://tuggi.app/');
  assertEquals(
    pickProperty([
      { siteUrl: 'http://tuggi.app/', permissionLevel: 'siteOwner' },
      { siteUrl: 'https://www.tuggi.app/', permissionLevel: 'siteOwner' },
    ]),
    'http://tuggi.app/',
  );
  assertEquals(pickProperty([{ siteUrl: 'sc-domain:tuggi.app', permissionLevel: 'siteUnverifiedUser' }]), null);
  assertEquals(pickProperty([{ siteUrl: 'sc-domain:reserveon.com.br', permissionLevel: 'siteOwner' }]), null);
  assertEquals(pickProperty([]), null);
});

Deno.test('#1170: rows keep day and query, round the position, and a bad measure is null, never 0', () => {
  const rows = searchConsoleRows(fixture('search-console-query'));
  assertEquals(rows[0], {
    day: '2026-11-03',
    query: 'o que fazer em búzios',
    clicks: 2,
    impressions: 40,
    position: 7.46,
  });
  assertEquals(rows.length, 4);
  assertEquals(
    searchConsoleRows({
      rows: [
        { keys: ['2026-11-03', 'x'], clicks: -1, impressions: 'many', position: 0 },
        { keys: ['20261103', 'no iso date'], clicks: 1, impressions: 1, position: 1 },
        { keys: ['2026-11-03'], clicks: 1, impressions: 1, position: 1 },
      ],
    }),
    [{ day: '2026-11-03', query: 'x', clicks: null, impressions: null, position: null }],
  );
  // An answer with no rows (every query anonymized, or no search at all) is an empty read, not an error.
  assertEquals(searchConsoleRows({ responseAggregationType: 'byProperty' }), []);
});

Deno.test('#1170: sixteen months back is a calendar shift clamped to the month end', () => {
  assertEquals(monthsBefore('2026-11-09', 16), '2025-07-09');
  assertEquals(monthsBefore('2026-03-31', 1), '2026-02-28');
  assertEquals(monthsBefore('2026-01-15', 13), '2024-12-15');
});

function fakeApi(opts: { sites?: unknown; pages?: unknown[]; refuse?: GoogleApiError } = {}) {
  const queries: Array<{ siteUrl: string; body: Record<string, unknown> }> = [];
  const api: SearchConsoleApi = {
    sites: () => {
      if (opts.refuse) return Promise.reject(opts.refuse);
      const entries = (opts.sites ?? fixture('search-console-sites')) as { siteEntry?: SiteEntry[] };
      return Promise.resolve(entries.siteEntry ?? []);
    },
    query: (siteUrl, body) => {
      queries.push({ siteUrl, body });
      const pages = opts.pages ?? [fixture('search-console-query')];
      return Promise.resolve(pages[queries.length - 1] ?? { rows: [] });
    },
  };
  return { api, queries };
}

Deno.test('#1170: a full page asks the next one, and every row goes to one write after the last page', async () => {
  const full = {
    rows: Array.from({ length: SEARCH_CONSOLE_ROW_LIMIT }, (_, i) => ({
      keys: ['2026-11-01', `q${i}`],
      clicks: 0,
      impressions: 1,
      position: 9,
    })),
  };
  const { api, queries } = fakeApi({ pages: [full, fixture('search-console-query')] });
  const writes: number[] = [];
  const result = await collectSearchConsole({
    api,
    today: '2026-11-09',
    lastDay: '2026-11-05',
    write: (rows) => (writes.push(rows.length), Promise.resolve()),
  });
  assertEquals(queries.map((q) => q.body.startRow), [0, SEARCH_CONSOLE_ROW_LIMIT]);
  assertEquals(writes, [SEARCH_CONSOLE_ROW_LIMIT + 4]);
  // The last five days are read again, through yesterday, by date and query, web search only.
  assertEquals(
    [queries[0].body.startDate, queries[0].body.endDate, queries[0].body.dimensions, queries[0].body.type],
    ['2026-11-04', '2026-11-08', ['date', 'query'], 'web'],
  );
  assertEquals([result.rows, result.first_day], [SEARCH_CONSOLE_ROW_LIMIT + 4, '2026-11-01']);
});

// ------------------------------------------------------------------------------------------------
// The clients: one token per scope, the property in the path, the token only in the header

async function serviceAccount(): Promise<ServiceAccount> {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const b64 = btoa(String.fromCharCode(...der)).replace(/(.{64})/g, '$1\n');
  return {
    clientEmail: 'collector@tuggi-test.iam.gserviceaccount.com',
    privateKey: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`,
  };
}

const claimsOf = (assertion: string) => JSON.parse(atob(assertion.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));

Deno.test('#1170: Search Console draws its own token on webmasters.readonly; GA4 keeps analytics.readonly', async () => {
  const sa = await serviceAccount();
  const calls: Array<{ url: string; auth: string | null }> = [];
  const fetchFn = (url: string, init: RequestInit) => {
    calls.push({ url, auth: new Headers(init.headers).get('authorization') });
    if (url === GOOGLE_TOKEN_URL) {
      const assertion = new URLSearchParams(String(init.body)).get('assertion') ?? '';
      const scope = claimsOf(assertion).scope;
      const token = scope === SEARCH_CONSOLE_SCOPE ? 'ya29.sc' : scope === GA4_SCOPE ? 'ya29.ga4' : 'wrong';
      return Promise.resolve(new Response(JSON.stringify({ access_token: token }), { status: 200 }));
    }
    if (url.endsWith('/webmasters/v3/sites')) return Promise.resolve(answer('search-console-sites', 200));
    if (url.includes('/searchAnalytics/query')) return Promise.resolve(answer('error-403-permission', 403));
    return Promise.resolve(answer('ga4-site-channels', 200));
  };
  const sc = searchConsoleClient(sa, fetchFn, () => NOW.getTime());
  const ga4 = ga4Runner(sa, '494999879', fetchFn, () => NOW.getTime());
  assertEquals((await sc.sites()).length, 3);
  await ga4({});
  let refused: unknown = null;
  await sc.query('sc-domain:tuggi.app', { startDate: '2026-11-01' }).catch((e) => (refused = e));
  assertEquals(googleErrorDetail(refused).split(':')[0], 'search_console_403 PERMISSION_DENIED forbidden');

  const queryCall = calls.find((c) => c.url.includes('/searchAnalytics/query'));
  assertEquals(
    queryCall?.url,
    'https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Atuggi.app/searchAnalytics/query',
  );
  assertEquals(queryCall?.auth, 'Bearer ya29.sc');
  assertEquals(calls.find((c) => c.url.includes('analyticsdata'))?.auth, 'Bearer ya29.ga4');
  // One token per client, reused for its calls; no token in any URL.
  assertEquals(calls.filter((c) => c.url === GOOGLE_TOKEN_URL).length, 2);
  assert(calls.every((c) => !c.url.includes('ya29')));
});

// ------------------------------------------------------------------------------------------------
// The two jobs of the daily run, everything else of the run switched off

const PK: Partial<Record<SocialTable, string>> = {
  collector_runs: 'job',
  site_channel_daily: 'day,channel',
  search_console_daily: 'day,query',
};

function store() {
  const tables: Record<string, Map<string, Record<string, unknown>>> = {};
  const s: SocialStore = {
    activeAccounts: () => Promise.resolve([]),
    setIgUserId: () => Promise.resolve(),
    upsert: (table, rows, onConflict) => {
      assertEquals(onConflict, PK[table], table);
      tables[table] ??= new Map();
      const shape = JSON.stringify(Object.keys(rows[0] ?? {}));
      for (const row of rows) {
        assertEquals(JSON.stringify(Object.keys(row)), shape, `${table} rows of one upsert differ`);
        for (const [k, v] of Object.entries(row)) {
          // The CHECKs of Parte 28: a negative measure is 23514.
          if (typeof v === 'number') assert(v >= 0, `${table}.${k} negative`);
        }
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
    lastDay: (table) =>
      Promise.resolve([...(tables[table]?.values() ?? [])].map((r) => String(r.day)).sort().at(-1) ?? null),
    rpc: () => Promise.resolve([]),
    ownPostsSince: () => Promise.resolve([]),
    funnelSince: () => Promise.resolve([]),
    firstPostDay: () => Promise.resolve(null),
    followersSince: () => Promise.resolve([]),
    mediaCount: () => Promise.resolve(0),
  };
  return { s, tables, run: (job: string) => tables.collector_runs?.get(job) };
}

const deps = (
  s: SocialStore,
  acquisition: CollectDeps['acquisition'],
  logs: string[] = [],
  now = NOW,
): CollectDeps => ({
  store: s,
  meta: { igUserId: 'x', get: () => Promise.reject(new Error('no meta here')) },
  ga4: null,
  gemini: null,
  now: () => now,
  log: (l) => logs.push(l),
  acquisition,
});

type Ga4Call = { dims: string[]; from: string; to: string };

/** The site property, recorded: sessions by channel, and clicks by channel and store unless refused. */
function siteGa4(opts: { refuseClicks?: GoogleApiError; refuseAll?: GoogleApiError } = {}) {
  const calls: Ga4Call[] = [];
  const run: Ga4Run = (body) => {
    const dims = (body.dimensions as Array<{ name: string }>).map((d) => d.name);
    const range = (body.dateRanges as Array<{ startDate: string; endDate: string }>)[0];
    calls.push({ dims, from: range.startDate, to: range.endDate });
    if (opts.refuseAll) return Promise.reject(opts.refuseAll);
    if (!dims.includes('customEvent:store')) return Promise.resolve(fixture('ga4-site-channels'));
    assertEquals(JSON.stringify(body.dimensionFilter).includes('"value":"click_store"'), true);
    if (opts.refuseClicks) return Promise.reject(opts.refuseClicks);
    return Promise.resolve(fixture('ga4-channel-clicks'));
  };
  return { run, calls };
}

const refusal = (code: string, file: string, status: number) => googleApiError(code, answer(file, status));

Deno.test('#1170: site_channels writes sessions and users per channel; clicks before the store dimension are null, after it a measured 0', async () => {
  const { s, tables, run } = store();
  const ga4 = siteGa4();
  const report = await runSocialCollect(deps(s, { siteGa4: ga4.run, searchConsole: null }));
  assertEquals(report.site_channels, 'read');
  const row = (k: string) => tables.site_channel_daily.get(k);
  // Before 2026-10-29 GA4 has no store for a click: unknown, not zero.
  assertEquals(row('2026-10-27|Direct'), {
    day: '2026-10-27',
    channel: 'Direct',
    sessions: 9,
    users: 7,
    clicks_app_store: null,
    clicks_play_store: null,
  });
  assertEquals(STORE_DIMENSION_SINCE, '2026-10-29');
  assertEquals([row('2026-10-29|Direct')?.clicks_app_store, row('2026-10-29|Direct')?.clicks_play_store], [2, 1]);
  // A channel with sessions and no click on a measured day is 0; a click with no store is in neither column.
  assertEquals([
    row('2026-10-29|Organic Social')?.clicks_app_store,
    row('2026-10-29|Organic Social')?.clicks_play_store,
  ], [0, 0]);
  assertEquals([
    row('2026-10-30|Organic Search')?.clicks_app_store,
    row('2026-10-30|Organic Search')?.clicks_play_store,
  ], [1, 0]);
  assertEquals([row('2026-10-30|Email')?.clicks_app_store, row('2026-10-30|Email')?.clicks_play_store], [0, 0]);
  assertEquals(tables.site_channel_daily.size, 6);
  // First run: a year back for sessions; clicks only from the day the store exists; through yesterday.
  assertEquals(ga4.calls, [
    { dims: ['date', 'sessionDefaultChannelGroup'], from: '2025-11-14', to: '2026-11-08' },
    { dims: ['date', 'sessionDefaultChannelGroup', 'customEvent:store'], from: '2026-10-29', to: '2026-11-08' },
  ]);
  assertEquals([run('site_channels')?.status, run('site_channels')?.covered_from], ['ok', '2026-10-27']);
  assertEquals(run('search_console')?.status, 'not_configured');

  // Next run reads again from the last stored day (older than the last three days), not the whole year.
  const next = siteGa4();
  await runSocialCollect(deps(s, { siteGa4: next.run, searchConsole: null }, [], new Date('2026-11-10T09:00:00Z')));
  assertEquals(next.calls.map((c) => c.from), ['2026-10-30', '2026-10-30']);
  assertEquals(run('site_channels')?.covered_from, '2026-10-27');
});

Deno.test("#1170: a refused clicks report writes the sessions, keeps the clicks already there and records Google's words", async () => {
  const { s, tables, run } = store();
  await runSocialCollect(deps(s, { siteGa4: siteGa4().run, searchConsole: null }));
  const logs: string[] = [];
  const refuseClicks = await googleApiError(
    'ga4_report',
    new Response(
      JSON.stringify({
        error: { code: 400, message: 'Field customEvent:store is not a valid dimension.', status: 'INVALID_ARGUMENT' },
      }),
      { status: 400 },
    ),
  );
  const report = await runSocialCollect(
    deps(s, { siteGa4: siteGa4({ refuseClicks }).run, searchConsole: null }, logs, new Date('2026-11-10T09:00:00Z')),
  );
  assertEquals(report.site_channels, 'partial');
  assertEquals(tables.site_channel_daily.get('2026-10-29|Direct')?.clicks_app_store, 2);
  const row = run('site_channels');
  assertEquals([row?.status, row?.covered_from], ['error', '2026-10-27']);
  assert(
    String(row?.detail).includes('ga4_report_400 INVALID_ARGUMENT: Field customEvent:store is not a valid dimension.'),
    String(row?.detail),
  );
  assert(logs.some((l) => l.includes('site_channels clicks refused')), logs.join('\n'));
});

Deno.test('#1170: GA4 refusing the site writes nothing, keeps covered_from, and the Search Console job still runs', async () => {
  const { s, tables, run } = store();
  tables.collector_runs = new Map([['site_channels', {
    job: 'site_channels',
    status: 'ok',
    covered_from: '2026-01-02',
  }]]);
  const refuseAll = await refusal('ga4_report', 'error-403-ga4-property', 403);
  const sc = fakeApi();
  const report = await runSocialCollect(deps(s, { siteGa4: siteGa4({ refuseAll }).run, searchConsole: sc.api }));
  assertEquals([report.site_channels, report.search_console], ['failed', 'read']);
  assertEquals(tables.site_channel_daily, undefined);
  const row = run('site_channels');
  assertEquals([row?.status, row?.covered_from], ['error', '2026-01-02']);
  assert(
    String(row?.detail).startsWith('ga4_report_403 PERMISSION_DENIED: User does not have sufficient'),
    String(row?.detail),
  );
  assertEquals(run('daily')?.status, 'ok');
});

Deno.test('#1170: search_console writes per day and query from sc-domain, sixteen months on the first run, covered_from the first day', async () => {
  const { s, tables, run } = store();
  const sc = fakeApi();
  const report = await runSocialCollect(deps(s, { siteGa4: null, searchConsole: sc.api }));
  assertEquals([report.search_console, report.site_channels], ['read', 'not_configured']);
  assertEquals(sc.queries[0].siteUrl, 'sc-domain:tuggi.app');
  assertEquals([sc.queries[0].body.startDate, sc.queries[0].body.endDate], ['2025-07-09', '2026-11-08']);
  assertEquals(tables.search_console_daily.get('2026-11-04|audio guia arraial do cabo'), {
    day: '2026-11-04',
    query: 'audio guia arraial do cabo',
    clicks: 0,
    impressions: 12,
    position: 23.25,
  });
  assertEquals(tables.search_console_daily.size, 4);
  const row = run('search_console');
  assertEquals([row?.status, row?.covered_from], ['ok', '2026-11-03']);
  assert(JSON.parse(String(row?.detail)).property === 'sc-domain:tuggi.app');

  // Next day: from the last stored day or five days back, whichever is older.
  const again = fakeApi();
  await runSocialCollect(deps(s, { siteGa4: null, searchConsole: again.api }, [], new Date('2026-11-10T09:00:00Z')));
  assertEquals(again.queries[0].body.startDate, '2026-11-05');
});

Deno.test('#1170: Search Console API off records SERVICE_DISABLED, keeps covered_from, and writes nothing', async () => {
  const { s, tables, run } = store();
  tables.collector_runs = new Map([['search_console', {
    job: 'search_console',
    status: 'ok',
    covered_from: '2025-08-01',
  }]]);
  const logs: string[] = [];
  const refuse = await refusal('search_console', 'error-403-service-disabled', 403);
  const report = await runSocialCollect(
    deps(s, { siteGa4: siteGa4().run, searchConsole: fakeApi({ refuse }).api }, logs),
  );
  assertEquals([report.search_console, report.site_channels], ['failed', 'read']);
  assertEquals(tables.search_console_daily, undefined);
  const row = run('search_console');
  assertEquals([row?.status, row?.covered_from], ['error', '2025-08-01']);
  assert(
    String(row?.detail).startsWith('search_console_403 PERMISSION_DENIED SERVICE_DISABLED: '),
    String(row?.detail),
  );
  assert(logs.some((l) => l.includes('search_console failed: search_console_403')), logs.join('\n'));
});

Deno.test('#1170: an account not added in Search Console lists no property: no_property, an error row that says so', async () => {
  const { s, run } = store();
  const sc = fakeApi({ sites: {} });
  const report = await runSocialCollect(deps(s, { siteGa4: null, searchConsole: sc.api }));
  assertEquals(report.search_console, 'no_property');
  assertEquals(sc.queries.length, 0);
  const row = run('search_console');
  assertEquals([row?.status, row?.covered_from], ['error', null]);
  assertEquals(row?.detail, 'search_console_no_property: sites.list listed 0 site(s), none on tuggi.app');
});

Deno.test('#1170: without the service account both jobs are not_configured; without acquisition deps neither runs', async () => {
  const a = store();
  const report = await runSocialCollect(deps(a.s, { siteGa4: null, searchConsole: null }));
  assertEquals([report.site_channels, report.search_console], ['not_configured', 'not_configured']);
  assertEquals([a.run('site_channels')?.status, a.run('search_console')?.status], ['not_configured', 'not_configured']);

  const b = store();
  const none = await runSocialCollect(deps(b.s, undefined));
  assertEquals([none.site_channels, none.search_console], ['skipped', 'skipped']);
  assertEquals([b.run('site_channels'), b.run('search_console')], [undefined, undefined]);
});
