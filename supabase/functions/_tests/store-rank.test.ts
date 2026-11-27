/**
 * #1307: the store search position tracker, `_shared/store-rank.ts`, and the `store_rank` job. The iTunes answer
 * keeps the shape of a real one (2026-11-27, term "guia de viagem", BR) trimmed to four results; the Play pages
 * keep the link markup of the real search page of the same day, trimmed to a few apps.
 */
import { assert, assertEquals } from './assert.ts';
import {
  collectStoreRank,
  ITUNES_INTERVAL_MS,
  ITUNES_SEARCH,
  PLAY_INTERVAL_MS,
  PLAY_SEARCH,
  playPackages,
  RANK_BUDGET_MS,
  RANK_USER_AGENT,
  type RankApp,
  type RankKeyword,
  type RankRow,
  type RankStore,
  searchAppStore,
  searchPlay,
} from '../_shared/store-rank.ts';
import { runStoreRankCollect, type SocialStore } from '../_shared/social-collect.ts';

const fixture = (name: string) => Deno.readTextFileSync(new URL(`./fixtures/store-rank/${name}`, import.meta.url));
const NOW = new Date('2026-11-27T12:13:00Z');
const DAY = '2026-11-27';

const KW_GUIA: RankKeyword = { id: 'k1', keyword: 'guia de viagem', country: 'BR', lang: 'pt-BR' };
const KW_AUDIO: RankKeyword = { id: 'k2', keyword: 'audio guia', country: 'BR', lang: 'pt-BR' };
const KW_TOUR: RankKeyword = { id: 'k3', keyword: 'tour guide', country: 'US', lang: 'en' };
const APPS: RankApp[] = [
  { id: 'a-own-ios', store: 'app_store', store_app_id: '6744379818' },
  { id: 'a-civitatis', store: 'app_store', store_app_id: '1209079115' },
  { id: 'a-own-play', store: 'play_store', store_app_id: 'com.tuggidrive.app' },
  { id: 'a-wanderlog', store: 'play_store', store_app_id: 'com.wanderlog.android' },
];

interface Answers {
  itunes?: (url: URL) => Response;
  play?: (url: URL) => Response;
}

function rig(answers: Answers = {}) {
  const calls: Array<{ url: string; ua: string | null }> = [];
  const fetchFn = (url: string, init?: RequestInit) => {
    calls.push({ url, ua: new Headers(init?.headers).get('user-agent') });
    const u = new URL(url);
    if (url.startsWith(ITUNES_SEARCH)) {
      return Promise.resolve(answers.itunes?.(u) ?? new Response(fixture('itunes-search.json'), { status: 200 }));
    }
    if (url.startsWith(PLAY_SEARCH)) {
      return Promise.resolve(answers.play?.(u) ?? new Response(fixture('play-search.html'), { status: 200 }));
    }
    return Promise.resolve(new Response('{}', { status: 400 }));
  };
  return { calls, fetch: fetchFn };
}

/** The four tables in memory; `doneOn` reads what `write` kept, as the real table would. */
function rankStore(keywords: RankKeyword[], apps: RankApp[] = APPS) {
  const rows = new Map<string, RankRow>();
  const store: RankStore = {
    activeKeywords: () => Promise.resolve(keywords),
    activeApps: () => Promise.resolve(apps),
    doneOn: (day) => Promise.resolve([...rows.values()].filter((r) => r.day === day)),
    write: (written) => {
      for (const r of written) rows.set(`${r.day}|${r.store}|${r.keyword_id}|${r.app_id}`, r);
      return Promise.resolve();
    },
  };
  return { store, rows };
}

/** A clock that only a pause moves, and the pauses asked. */
function clock(start = NOW.getTime()) {
  let t = start;
  const pauses: number[] = [];
  return {
    now: () => new Date(t),
    sleep: (ms: number) => {
      pauses.push(ms);
      t += ms;
      return Promise.resolve();
    },
    pauses,
  };
}

const position = (rows: Map<string, RankRow>, store: string, kw: string, app: string) => {
  const r = rows.get(`${DAY}|${store}|${kw}|${app}`);
  return r && [r.position, r.results_read];
};

Deno.test('#1307: the Play order is the first link of each package; a second link to the same app does not count', () => {
  assertEquals(playPackages(fixture('play-search.html')), [
    'com.tripadvisor.tripadvisor',
    'com.getyourguide.android',
    'com.wanderlog.android',
    'com.tuggidrive.app',
    'io.lambus.app',
  ]);
});

Deno.test('#1307: the App Store search asks the documented parameters and keeps the order of trackId', async () => {
  const r = rig();
  assertEquals(await searchAppStore(r.fetch, KW_GUIA), ['1466065511', '1209079115', '6744379818', '382411090']);
  const u = new URL(r.calls[0].url);
  assertEquals(
    [
      u.searchParams.get('term'),
      u.searchParams.get('country'),
      u.searchParams.get('entity'),
      u.searchParams.get('limit'),
    ],
    ['guia de viagem', 'br', 'software', '200'],
  );
  assertEquals(r.calls[0].ua, RANK_USER_AGENT);
});

Deno.test('#1307: the Play search asks the public page by country and language with our User-Agent', async () => {
  const r = rig();
  await searchPlay(r.fetch, KW_GUIA);
  const u = new URL(r.calls[0].url);
  assertEquals(
    [
      u.origin + u.pathname,
      u.searchParams.get('q'),
      u.searchParams.get('c'),
      u.searchParams.get('gl'),
      u.searchParams.get('hl'),
    ],
    [PLAY_SEARCH, 'guia de viagem', 'apps', 'BR', 'pt_BR'],
  );
  assertEquals(r.calls[0].ua, RANK_USER_AGENT);
});

Deno.test('#1307: a Play block is named and never read as a ranking: 429, the sorry page, a captcha, a page with no app', async () => {
  const sorry = new Response('<html>sorry</html>', { status: 200 });
  Object.defineProperty(sorry, 'url', {
    value: 'https://www.google.com/sorry/index?continue=https://play.google.com/',
  });
  const cases: Array<[string, Response]> = [
    ['play_blocked_429', new Response('Too Many Requests', { status: 429 })],
    ['play_blocked_sorry', sorry],
    ['play_blocked_captcha', new Response(fixture('play-captcha.html'), { status: 200 })],
    ['play_blocked_empty', new Response(fixture('play-empty.html'), { status: 200 })],
    ['play_503', new Response('', { status: 503 })],
  ];
  for (const [code, res] of cases) {
    let got = '';
    try {
      await searchPlay(() => Promise.resolve(res), KW_GUIA);
    } catch (e) {
      got = (e as Error).message;
    }
    assertEquals(got, code);
  }
});

Deno.test('#1307: one row per active app of the store and pair, position 1-based or null when the app is not in the results', async () => {
  const { store, rows } = rankStore([KW_GUIA]);
  const c = clock();
  const r = rig({ play: () => new Response(fixture('play-search-without-tuggi.html'), { status: 200 }) });
  const result = await collectStoreRank({
    store,
    fetch: r.fetch,
    now: c.now,
    sleep: c.sleep,
    day: DAY,
    deadline: NOW.getTime() + RANK_BUDGET_MS,
  });
  assertEquals(result, {
    day: DAY,
    state: 'read',
    app_store: { pairs: 1, done_before: 0, read: 1, pending: 0, error: null },
    play_store: { pairs: 1, done_before: 0, read: 1, pending: 0, error: null },
  });
  assertEquals(rows.size, 4);
  assertEquals(position(rows, 'app_store', 'k1', 'a-own-ios'), [3, 4]);
  assertEquals(position(rows, 'app_store', 'k1', 'a-civitatis'), [2, 4]);
  // Neither Play app is on this page: null, with the two results that were read.
  assertEquals(position(rows, 'play_store', 'k1', 'a-own-play'), [null, 2]);
  assertEquals(position(rows, 'play_store', 'k1', 'a-wanderlog'), [null, 2]);
});

Deno.test('#1307: an App Store search with no result writes null positions over zero results read', async () => {
  const { store, rows } = rankStore([KW_TOUR], APPS.filter((a) => a.store === 'app_store'));
  const c = clock();
  const r = rig({ itunes: () => new Response(fixture('itunes-search-empty.json'), { status: 200 }) });
  await collectStoreRank({
    store,
    fetch: r.fetch,
    now: c.now,
    sleep: c.sleep,
    day: DAY,
    deadline: NOW.getTime() + RANK_BUDGET_MS,
  });
  assertEquals(position(rows, 'app_store', 'k3', 'a-own-ios'), [null, 0]);
});

Deno.test('#1307: the calls of each store keep their pace, the App Store under 20 a minute', async () => {
  const { store } = rankStore([KW_GUIA, KW_AUDIO, KW_TOUR], APPS.filter((a) => a.store === 'app_store'));
  const c = clock();
  await collectStoreRank({
    store,
    fetch: rig().fetch,
    now: c.now,
    sleep: c.sleep,
    day: DAY,
    deadline: NOW.getTime() + RANK_BUDGET_MS,
  });
  assertEquals(c.pauses, [ITUNES_INTERVAL_MS, ITUNES_INTERVAL_MS]);
  assert(60_000 / ITUNES_INTERVAL_MS < 20, 'App Store pace above the documented limit');
  assert(PLAY_INTERVAL_MS >= ITUNES_INTERVAL_MS, 'Play faster than the App Store');
});

Deno.test('#1307: a call takes the slice that fits its budget, and the next call reads only the pairs still missing', async () => {
  const keywords = [KW_GUIA, KW_AUDIO, KW_TOUR];
  const { store, rows } = rankStore(keywords, APPS.filter((a) => a.store === 'app_store'));
  const first = clock();
  // Room for two searches: the third would start at the deadline.
  const r1 = rig();
  const a = await collectStoreRank({
    store,
    fetch: r1.fetch,
    now: first.now,
    sleep: first.sleep,
    day: DAY,
    deadline: NOW.getTime() + 2 * ITUNES_INTERVAL_MS,
  });
  assertEquals(a.app_store, { pairs: 3, done_before: 0, read: 2, pending: 1, error: null });
  assertEquals([r1.calls.length, rows.size], [2, 4]);

  const later = clock(NOW.getTime() + 3_600_000);
  const r2 = rig();
  const b = await collectStoreRank({
    store,
    fetch: r2.fetch,
    now: later.now,
    sleep: later.sleep,
    day: DAY,
    deadline: NOW.getTime() + 3_600_000 + RANK_BUDGET_MS,
  });
  assertEquals(b.app_store, { pairs: 3, done_before: 2, read: 1, pending: 0, error: null });
  assertEquals(r2.calls.map((x) => new URL(x.url).searchParams.get('term')), ['tour guide']);
  assertEquals(rows.size, 6);
  // A third call the same day has nothing left and asks nothing.
  const r3 = rig();
  const c = await collectStoreRank({
    store,
    fetch: r3.fetch,
    now: later.now,
    sleep: later.sleep,
    day: DAY,
    deadline: Infinity,
  });
  assertEquals([c.app_store.read, c.app_store.pending, r3.calls.length], [0, 0, 0]);
});

// ------------------------------------------------------------------------------------------------
// The `store_rank` job: `collector_runs` through the social store

function socialStore() {
  const runs = new Map<string, Record<string, unknown>>();
  const s = {
    upsert: (table: string, rows: Record<string, unknown>[], onConflict: string) => {
      assertEquals([table, onConflict], ['collector_runs', 'job']);
      for (const row of rows) runs.set(String(row.job), { ...(runs.get(String(row.job)) ?? {}), ...row });
      return Promise.resolve();
    },
    coveredFrom: (job: string) => Promise.resolve((runs.get(job)?.covered_from as string | undefined) ?? null),
  } as unknown as SocialStore;
  return { s, runs };
}

Deno.test('#1307: without an active keyword the job is not_configured and asks no store', async () => {
  const { s, runs } = socialStore();
  const r = rig();
  const c = clock();
  const result = await runStoreRankCollect({
    store: s,
    rank: rankStore([]).store,
    fetch: r.fetch,
    now: c.now,
    log: () => {},
    sleep: c.sleep,
  });
  assertEquals([result?.state, runs.get('store_rank')?.status, runs.get('store_rank')?.covered_from, r.calls.length], [
    'not_configured',
    'not_configured',
    undefined,
    0,
  ]);
});

Deno.test('#1307: Play blocked stops Play only; the App Store rows are written, the job is error with both slices, covered_from is today', async () => {
  const { s, runs } = socialStore();
  const { store, rows } = rankStore([KW_GUIA, KW_AUDIO]);
  const c = clock();
  const logs: string[] = [];
  const r = rig({ play: () => new Response(fixture('play-captcha.html'), { status: 200 }) });
  const result = await runStoreRankCollect({
    store: s,
    rank: store,
    fetch: r.fetch,
    now: c.now,
    log: (l) => logs.push(l),
    sleep: c.sleep,
  });
  assertEquals(result?.app_store, { pairs: 2, done_before: 0, read: 2, pending: 0, error: null });
  assertEquals(result?.play_store, { pairs: 2, done_before: 0, read: 0, pending: 2, error: 'play_blocked_captcha' });
  // One Play call, then Play stops for this run: no second request on a blocked page.
  assertEquals(r.calls.filter((x) => x.url.startsWith(PLAY_SEARCH)).length, 1);
  assertEquals([...rows.values()].map((x) => x.store).sort(), ['app_store', 'app_store', 'app_store', 'app_store']);
  const run = runs.get('store_rank');
  assertEquals([run?.status, run?.covered_from], ['error', DAY]);
  assertEquals(JSON.parse(String(run?.detail)).play_store.error, 'play_blocked_captcha');
  assertEquals(JSON.parse(String(run?.detail)).app_store.read, 2);
  assert(logs.some((l) => l.includes('play_store: play_blocked_captcha')), logs.join(' / '));
});

Deno.test('#1307: covered_from keeps the first day written; a later run that writes nothing does not touch it', async () => {
  const { s, runs } = socialStore();
  runs.set('store_rank', { job: 'store_rank', status: 'ok', covered_from: '2026-11-20' });
  const { store } = rankStore([KW_GUIA], APPS.filter((a) => a.store === 'app_store'));
  const c = clock();
  await runStoreRankCollect({ store: s, rank: store, fetch: rig().fetch, now: c.now, log: () => {}, sleep: c.sleep });
  assertEquals([runs.get('store_rank')?.status, runs.get('store_rank')?.covered_from], ['ok', '2026-11-20']);
  const refused = rig({ itunes: () => new Response('', { status: 403 }) });
  const { store: fresh } = rankStore([KW_AUDIO], APPS.filter((a) => a.store === 'app_store'));
  await runStoreRankCollect({ store: s, rank: fresh, fetch: refused.fetch, now: c.now, log: () => {}, sleep: c.sleep });
  const run = runs.get('store_rank');
  assertEquals([run?.status, run?.covered_from, JSON.parse(String(run?.detail)).app_store.error], [
    'error',
    '2026-11-20',
    'itunes_403',
  ]);
});
