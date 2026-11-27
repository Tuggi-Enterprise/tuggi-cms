/**
 * #1169: the Google Play side of the acquisition funnel, `_shared/play-reports.ts`, and the `play` job of the daily
 * run. The files in `fixtures/play/` were written in UTF-16 (one of them big-endian) from the column lists of the
 * Play Console help (answer 6135870, checked 2026-11-27), not downloaded: the first real run confirms the names.
 * The bucket has October and November 2026; the run on 2026-12-02 finds no December file yet.
 */
import { assert, assertEquals } from './assert.ts';
import { GOOGLE_TOKEN_URL } from '../_shared/ga4-data.ts';
import {
  collectPlayReports,
  decodeReport,
  parseCountry,
  parseInstallsOverview,
  parseTrafficSource,
  PLAY_PACKAGE,
  type PlayConfig,
  playConfig,
  type PlayCountryRow,
  type PlayInstallsRow,
  type PlayListingRow,
  playObject,
  playSource,
  type PlayTermRow,
  STORAGE_API,
  STORAGE_READ_SCOPE,
} from '../_shared/play-reports.ts';
import { countryCode } from '../_shared/store-country.ts';
import { type CollectDeps, runSocialCollect, type SocialStore, type SocialTable } from '../_shared/social-collect.ts';

const NOW = new Date('2026-12-02T09:00:00Z');
const BUCKET = 'pubsite_prod_6104368218805404962';
const EMAIL = 'google-play-validator@tuggi-app.iam.gserviceaccount.com';
const TOKEN = 'ya29.test-storage-token';
const bytes = (name: string) => Deno.readFileSync(new URL(`./fixtures/play/${name}`, import.meta.url));
const text = (object: string) => decodeReport(bytes(object.split('/').at(-1)!));

async function config(): Promise<PlayConfig> {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const b64 = btoa(String.fromCharCode(...der)).replace(/(.{64})/g, '$1\n');
  return {
    bucket: BUCKET,
    account: { clientEmail: EMAIL, privateKey: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----` },
  };
}

/** What the bucket holds: the six fixture files, by object name. */
const OBJECTS = [
  playObject('traffic_source', '202610'),
  playObject('country', '202610'),
  playObject('installs', '202610'),
  playObject('traffic_source', '202611'),
  playObject('country', '202611'),
  playObject('installs', '202611'),
];

interface RigOptions {
  /** An object Google refuses, with its answer. */
  refuse?: { object: string; status: number; body: unknown };
}

/** Google's token endpoint and the Cloud Storage JSON API, recorded. The installs listing comes in two pages. */
function rig(opts: RigOptions = {}) {
  const calls: Array<{ url: string; auth: string | null; body: string | null }> = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const fetchFn = (url: string, init?: RequestInit) => {
    calls.push({
      url,
      auth: new Headers(init?.headers).get('authorization'),
      body: typeof init?.body === 'string' ? init.body : null,
    });
    if (url === GOOGLE_TOKEN_URL) return Promise.resolve(json({ access_token: TOKEN, expires_in: 3600 }));
    const u = new URL(url);
    const base = `/storage/v1/b/${BUCKET}/o`;
    if (u.pathname === base) {
      const prefix = u.searchParams.get('prefix') ?? '';
      const items = OBJECTS.filter((o) => o.startsWith(prefix)).map((name) => ({ name }));
      if (prefix.startsWith('stats/installs/')) {
        if (u.searchParams.get('pageToken') === 'p2') return Promise.resolve(json({ items: items.slice(1) }));
        return Promise.resolve(json({ items: items.slice(0, 1), nextPageToken: 'p2' }));
      }
      return Promise.resolve(json({ items }));
    }
    if (u.pathname.startsWith(`${base}/`) && u.searchParams.get('alt') === 'media') {
      const object = decodeURIComponent(u.pathname.slice(base.length + 1));
      if (opts.refuse?.object === object) return Promise.resolve(json(opts.refuse.body, opts.refuse.status));
      if (!OBJECTS.includes(object)) {
        return Promise.resolve(json({ error: { code: 404, message: 'No such object' } }, 404));
      }
      return Promise.resolve(new Response(bytes(object.split('/').at(-1)!), { status: 200 }));
    }
    return Promise.resolve(json({}, 400));
  };
  return { calls, fetch: fetchFn };
}

function sink() {
  const listing: PlayListingRow[] = [];
  const terms: PlayTermRow[] = [];
  const countries: PlayCountryRow[] = [];
  const installs: PlayInstallsRow[] = [];
  const writers = {
    writeListing: (rows: PlayListingRow[]) => (listing.push(...rows), Promise.resolve()),
    writeTerms: (rows: PlayTermRow[]) => (terms.push(...rows), Promise.resolve()),
    writeCountry: (rows: PlayCountryRow[]) => (countries.push(...rows), Promise.resolve()),
    writeInstalls: (rows: PlayInstallsRow[]) => (installs.push(...rows), Promise.resolve()),
  };
  return { listing, terms, countries, installs, writers };
}

const objectsRead = (calls: Array<{ url: string }>) =>
  calls
    .filter((c) => c.url.includes('alt=media'))
    .map((c) => decodeURIComponent(new URL(c.url).pathname.split('/o/')[1]).split('/').at(-1));

Deno.test('#1169: the reports decode from UTF-16 little and big endian, without a BOM, and from UTF-8', () => {
  const header = 'Date,Package name';
  const le = new Uint8Array([0xff, 0xfe, ...Array.from(header).flatMap((c) => [c.charCodeAt(0), 0])]);
  const be = new Uint8Array([0xfe, 0xff, ...Array.from(header).flatMap((c) => [0, c.charCodeAt(0)])]);
  const bare = new Uint8Array(Array.from(header).flatMap((c) => [c.charCodeAt(0), 0]));
  for (const b of [le, be, bare, new TextEncoder().encode(header)]) assertEquals(decodeReport(b), header);
  assert(text(playObject('country', '202610')).startsWith('Date,Package name,Country'), 'big-endian fixture');
});

Deno.test('#1169: Traffic source maps to the funnel sources in one place; Other and anything new is other', () => {
  const cases: Array<[string, string]> = [
    ['Google Play search', 'store_search'],
    ['Google Play explore', 'store_browse'],
    ['Third-party referrals', 'third_party'],
    [' google play SEARCH ', 'store_search'],
    ['Other', 'other'],
    ['Google Play Instant', 'other'],
    ['', 'other'],
  ];
  for (const [raw, source] of cases) assertEquals(playSource(raw), source, raw);
});

Deno.test('#1169: traffic source sums visitors and acquisitions per day and source, and per search term over the month', () => {
  const p = parseTrafficSource(text(playObject('traffic_source', '202611')), '202611');
  const by = Object.fromEntries(
    p.listing.map((r) => [`${r.day}|${r.source_raw}`, [r.source, r.impressions, r.page_views, r.downloads]]),
  );
  // The other package's 100 stay out; the two UTM rows of the referrals are one source; impressions stay null.
  assertEquals(by, {
    '2026-11-01|Google Play search': ['store_search', null, 20, 6],
    '2026-11-01|Google Play explore': ['store_browse', null, 5, 1],
    '2026-11-01|Third-party referrals': ['third_party', null, 5, 3],
    '2026-11-01|Other': ['other', null, 1, 0],
    '2026-11-02|Google Play search': ['store_search', null, 7, 2],
  });
  assert(p.listing.every((r) => r.store === 'play_store'));
  // A quoted term with a comma is one term; the "Other" bucket of terms below Google's threshold is kept as it came.
  assertEquals(
    p.terms.map((t) => [t.month, t.store, t.term, t.page_views, t.downloads]),
    [
      ['2026-11-01', 'play_store', 'guia de viagem', 17, 5],
      ['2026-11-01', 'play_store', 'audio guia, rio', 4, 1],
      ['2026-11-01', 'play_store', 'Other', 6, 2],
    ],
  );
  assertEquals(p.days, ['2026-11-01', '2026-11-02']);
});

Deno.test('#1169: country rows land as ISO alpha-2 and a label that is not a country is dropped and named', () => {
  const p = parseCountry(text(playObject('country', '202611')));
  assertEquals(p.rows.map((r) => [r.day, r.country, r.impressions, r.page_views, r.downloads]), [
    ['2026-11-01', 'BR', null, 30, 7],
    ['2026-11-01', 'PT', null, 4, 1],
    ['2026-11-02', 'BR', null, 8, 2],
  ]);
  assertEquals(p.unmapped, ['Unknown']);
  assertEquals([countryCode('br'), countryCode('BRA'), countryCode('XKS'), countryCode('Brasil'), countryCode('')], [
    'BR',
    'BR',
    'XK',
    null,
    null,
  ]);
});

Deno.test('#1169: installs take Install and Uninstall events, and the documented daily device columns when they are absent', () => {
  assertEquals(parseInstallsOverview(text(playObject('installs', '202611'))).rows, [
    { day: '2026-11-01', store: 'play_store', installs: 5, uninstalls: 2 },
    { day: '2026-11-02', store: 'play_store', installs: 3, uninstalls: 0 },
  ]);
  assertEquals(parseInstallsOverview(text(playObject('installs', '202610'))).rows, [
    { day: '2026-10-31', store: 'play_store', installs: 6, uninstalls: 2 },
  ]);
});

Deno.test('#1169: a file without a required column is refused with the columns it has', () => {
  let refused = '';
  try {
    parseTrafficSource('Date,Package name,Source,Visitors\r\n2026-11-01,com.tuggidrive.app,x,1\r\n', '202611');
  } catch (e) {
    refused = (e as Error).message;
  }
  assertEquals(refused, 'play_report_columns traffic_source (found: Date, Package name, Source, Visitors)');
});

Deno.test('#1169: the secrets are the Play account of the CMS and the bucket name; any missing is not configured', () => {
  const env: Record<string, string> = {
    PLAY_REPORTS_BUCKET: ` gs://${BUCKET}/stats/ `,
    GOOGLE_SERVICE_ACCOUNT_EMAIL: EMAIL,
    GOOGLE_SERVICE_ACCOUNT_KEY: '-----BEGIN PRIVATE KEY-----\\nAAAA\\n-----END PRIVATE KEY-----',
    GA4_SERVICE_ACCOUNT_JSON: '{"client_email":"other@x.iam.gserviceaccount.com"}',
  };
  const cfg = playConfig((n) => env[n]);
  assertEquals(cfg, {
    bucket: BUCKET,
    account: { clientEmail: EMAIL, privateKey: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----' },
  });
  for (const missing of ['PLAY_REPORTS_BUCKET', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_SERVICE_ACCOUNT_KEY']) {
    assertEquals(playConfig((n) => (n === missing ? undefined : env[n])), null, missing);
  }
});

Deno.test('#1169: the first run lists the bucket and reads every month newest first; a month with no file is missing', async () => {
  const r = rig();
  const out = sink();
  const result = await collectPlayReports({
    config: await config(),
    fetch: r.fetch,
    now: () => NOW,
    deadline: NOW.getTime() + 60_000,
    coveredFrom: null,
    ...out.writers,
  });
  assertEquals(result, {
    months: { read: 2, missing: ['202612'], left: 0 },
    files: 6,
    listing_rows: 6,
    term_rows: 4,
    country_rows: 4,
    installs_rows: 3,
    unmapped_countries: ['Unknown'],
    errors: [],
    first_day: '2026-10-31',
  });
  assertEquals(objectsRead(r.calls), [
    `store_performance_${PLAY_PACKAGE}_202612_traffic_source.csv`,
    `store_performance_${PLAY_PACKAGE}_202612_country.csv`,
    `installs_${PLAY_PACKAGE}_202612_overview.csv`,
    `store_performance_${PLAY_PACKAGE}_202611_traffic_source.csv`,
    `store_performance_${PLAY_PACKAGE}_202611_country.csv`,
    `installs_${PLAY_PACKAGE}_202611_overview.csv`,
    `store_performance_${PLAY_PACKAGE}_202610_traffic_source.csv`,
    `store_performance_${PLAY_PACKAGE}_202610_country.csv`,
    `installs_${PLAY_PACKAGE}_202610_overview.csv`,
  ]);
  assert(r.calls.some((c) => c.url.includes('pageToken=p2')), 'second page of the installs listing not read');
  assertEquals(out.terms.find((t) => t.month === '2026-10-01'), {
    month: '2026-10-01',
    store: 'play_store',
    term: 'guia de viagem',
    page_views: 2,
    downloads: 1,
  });
  assertEquals(out.countries.find((c) => c.day === '2026-10-31')?.country, 'BR');

  // One token, drawn once, for the read-only storage scope only, never the purchase validation's androidpublisher.
  const tokenCalls = r.calls.filter((c) => c.url === GOOGLE_TOKEN_URL);
  assertEquals(tokenCalls.length, 1);
  const assertion = new URLSearchParams(tokenCalls[0].body ?? '').get('assertion') ?? '';
  const claims = JSON.parse(atob(assertion.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  assertEquals([claims.scope, claims.iss, claims.aud], [STORAGE_READ_SCOPE, EMAIL, GOOGLE_TOKEN_URL]);
  // The bearer goes to Cloud Storage only.
  for (const c of r.calls.filter((x) => x.url !== GOOGLE_TOKEN_URL)) {
    assert(c.url.startsWith(`${STORAGE_API}/b/${BUCKET}/o`), c.url);
    assertEquals(c.auth, `Bearer ${TOKEN}`);
  }
});

Deno.test('#1169: after the first run only the current and the previous month are read', async () => {
  const r = rig();
  const result = await collectPlayReports({
    config: await config(),
    fetch: r.fetch,
    now: () => NOW,
    deadline: NOW.getTime() + 60_000,
    coveredFrom: '2026-10-31',
    ...sink().writers,
  });
  assertEquals([result.months, result.first_day], [{ read: 1, missing: ['202612'], left: 0 }, '2026-11-01']);
  assert(!objectsRead(r.calls).some((n) => n?.includes('202610')), 'October read again');
});

Deno.test('#1169: past the time budget no month is started, and the months left are counted', async () => {
  const r = rig();
  const result = await collectPlayReports({
    config: await config(),
    fetch: r.fetch,
    now: () => NOW,
    deadline: NOW.getTime(),
    coveredFrom: null,
    ...sink().writers,
  });
  assertEquals([result.months, result.files], [{ read: 0, missing: [], left: 3 }, 0]);
});

// ------------------------------------------------------------------------------------------------
// The `play` job of the daily run, everything else of the run switched off

const PK: Partial<Record<SocialTable, string[]>> = {
  collector_runs: ['job'],
  store_listing_daily: ['day', 'store', 'source_raw'],
  store_search_terms_monthly: ['month', 'store', 'term'],
  store_country_daily: ['day', 'store', 'country'],
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
  return { s, tables, run: (job: string) => tables.collector_runs?.get(job) };
}

const deps = (s: SocialStore, play: CollectDeps['play'], logs: string[] = []): CollectDeps => ({
  store: s,
  meta: { igUserId: 'x', get: () => Promise.reject(new Error('no meta here')) },
  ga4: null,
  gemini: null,
  now: () => NOW,
  log: (l) => logs.push(l),
  play,
});

Deno.test('#1169: without the secrets play is not_configured, with no call', async () => {
  const { s, run } = store();
  const r = rig();
  const report = await runSocialCollect(deps(s, { config: null, fetch: r.fetch }));
  assertEquals([report.play, run('play')?.status, r.calls.length], ['not_configured', 'not_configured', 0]);
});

Deno.test("#1169: a full run writes the four tables and covered_from; a later refusal keeps them and names Google's words", async () => {
  const cfg = await config();
  const { s, tables, run } = store();
  const report = await runSocialCollect(deps(s, { config: cfg, fetch: rig().fetch }));
  assertEquals(report.play, 'read');
  assertEquals([run('play')?.status, run('play')?.covered_from], ['ok', '2026-10-31']);
  assertEquals(
    [
      tables.store_listing_daily.size,
      tables.store_search_terms_monthly.size,
      tables.store_country_daily.size,
      tables.store_installs_daily.size,
    ],
    [6, 4, 4, 3],
  );
  assertEquals(tables.store_listing_daily.get('2026-11-01|play_store|Google Play search'), {
    day: '2026-11-01',
    store: 'play_store',
    source: 'store_search',
    source_raw: 'Google Play search',
    impressions: null,
    page_views: 20,
    downloads: 6,
  });
  assertEquals(tables.store_country_daily.get('2026-11-01|play_store|BR'), {
    day: '2026-11-01',
    store: 'play_store',
    country: 'BR',
    impressions: null,
    page_views: 30,
    downloads: 7,
  });

  // Google refuses the November country file, with a sentence that names the service account.
  const logs: string[] = [];
  const refuse = {
    object: playObject('country', '202611'),
    status: 403,
    body: {
      error: {
        code: 403,
        message: `${EMAIL} does not have storage.objects.get access to the Google Cloud Storage object.`,
        errors: [{ reason: 'forbidden' }],
      },
    },
  };
  const partial = await runSocialCollect(deps(s, { config: cfg, fetch: rig({ refuse }).fetch }, logs));
  assertEquals(partial.play, 'partial');
  const row = run('play');
  assertEquals([row?.status, row?.covered_from], ['error', '2026-10-31']);
  assert(
    String(row?.detail).startsWith(
      'country 202611: play_object_403 forbidden: [email] does not have storage.objects.get access',
    ),
    String(row?.detail),
  );
  // The other November files were written again; the country rows of the first run are still there.
  assertEquals(tables.store_country_daily.get('2026-11-01|play_store|BR')?.page_views, 30);
  const seen = logs.join('\n') + JSON.stringify(row);
  assert(
    !seen.includes(EMAIL) && !seen.includes(TOKEN) && !seen.includes(cfg.account.privateKey.split('\n')[1]),
    'a secret leaked',
  );
});

Deno.test('#1169: a refused first run keeps covered_from empty and stops before the older months', async () => {
  const { s, run } = store();
  const r = rig({
    refuse: {
      object: playObject('traffic_source', '202611'),
      status: 500,
      body: { error: { code: 500, message: 'Backend Error' } },
    },
  });
  const report = await runSocialCollect(deps(s, { config: await config(), fetch: r.fetch }));
  // December had nothing; November wrote two files and refused one, so it is not a covered month yet.
  assertEquals(report.play, 'partial');
  assertEquals([run('play')?.status, run('play')?.covered_from], ['error', null]);
  assert(!objectsRead(r.calls).some((n) => n?.includes('202610')), 'October read past a refusal');
});

Deno.test('#1169: Google refusing the token records error with its words and the run goes on', async () => {
  const { s, run } = store();
  const fetchFn = (url: string) =>
    Promise.resolve(
      url === GOOGLE_TOKEN_URL
        ? new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }), {
          status: 400,
        })
        : new Response('{}', { status: 400 }),
    );
  const report = await runSocialCollect(deps(s, { config: await config(), fetch: fetchFn }));
  assertEquals(report.play, 'failed');
  assertEquals([run('play')?.status, run('play')?.detail], [
    'error',
    'play_token_400 invalid_grant: Invalid JWT Signature.',
  ]);
  assertEquals(run('daily')?.status, 'ok');
});

Deno.test('#1169: a key that does not import is named, never forwarded', async () => {
  const { s, run } = store();
  const cfg: PlayConfig = {
    bucket: BUCKET,
    account: { clientEmail: EMAIL, privateKey: '-----BEGIN PRIVATE KEY-----\nnot a key\n-----END PRIVATE KEY-----' },
  };
  const report = await runSocialCollect(deps(s, { config: cfg, fetch: rig().fetch }));
  assertEquals([report.play, run('play')?.detail], ['failed', 'play_token_failed']);
});
