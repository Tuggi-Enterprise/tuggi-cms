/**
 * #1059: the social collector, `_shared/social-collect.ts` and `social-collect/index.ts`.
 *
 * The module runs against an in-memory `social` schema that keeps one row per primary key, so a
 * second run on the same day is measured by row counts, and against recorded Graph API and GA4
 * answers served by URL. The handler tests prove the gate: our secret key only, 503 without the
 * Meta token, and the lookup the CMS calls before it adds an account.
 */
import { assert, assertEquals } from './assert.ts';
import { fetchCalls, loadHandler, network, scenario } from './harness.ts';
import {
  checkRecommendations,
  type CollectDeps,
  type Gemini,
  lookupAccount,
  type Meta,
  metaClient,
  type PostForPrompt,
  runSocialCollect,
  type SocialStore,
  type SocialTable,
  THEME_HINTS,
  type WatchedAccount,
} from '../_shared/social-collect.ts';

const OWN: WatchedAccount = { id: 'a0000000-0000-4000-8000-000000000001', username: 'tuggi_app', ig_user_id: null, is_own: true };
const RIVAL: WatchedAccount = { id: 'a0000000-0000-4000-8000-000000000002', username: 'izitravel', ig_user_id: null, is_own: false };
const BROKEN: WatchedAccount = { id: 'a0000000-0000-4000-8000-000000000003', username: 'autioapp', ig_user_id: null, is_own: false };
const TOKEN = 'EAAG-test-page-token-never-logged';
const IG_USER = '17841400000000000';
/** Monday 2026-11-02, 09:00 UTC = 06:00 in Brasília, the cron's minute. */
const MONDAY = new Date('2026-11-02T09:00:00Z');
const TUESDAY = new Date('2026-11-03T09:00:00Z');

const PK: Record<SocialTable, string[]> = {
  account_daily: ['account_id', 'day'],
  media: ['id'],
  media_metrics: ['media_id', 'day'],
  funnel_daily: ['day'],
  weekly_insights: ['week_start'],
};

/** The schema `social` in memory: upsert merges the columns it carries into the row of its key. */
class MemoryStore implements SocialStore {
  tables: Record<SocialTable, Map<string, Record<string, unknown>>> = {
    account_daily: new Map(),
    media: new Map(),
    media_metrics: new Map(),
    funnel_daily: new Map(),
    weekly_insights: new Map(),
  };
  igIds: Record<string, string> = {};
  rpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];

  constructor(readonly accounts: WatchedAccount[]) {}

  activeAccounts() {
    return Promise.resolve(this.accounts.map((a) => ({ ...a, ig_user_id: this.igIds[a.id] ?? a.ig_user_id })));
  }
  setIgUserId(accountId: string, igUserId: string) {
    this.igIds[accountId] = igUserId;
    return Promise.resolve();
  }
  upsert(table: SocialTable, rows: Record<string, unknown>[], onConflict: string) {
    assertEquals(onConflict, PK[table].join(','));
    const keys = JSON.stringify(Object.keys(rows[0] ?? {}));
    for (const row of rows) {
      assertEquals(JSON.stringify(Object.keys(row)), keys);
      const k = PK[table].map((c) => String(row[c])).join('|');
      this.tables[table].set(k, { ...(this.tables[table].get(k) ?? {}), ...row });
    }
    return Promise.resolve();
  }
  untaggedMedia(accountId: string, limit: number) {
    return Promise.resolve(
      [...this.tables.media.values()]
        .filter((m) => m.account_id === accountId && !m.theme)
        .slice(0, limit)
        .map((m) => ({ id: String(m.id), caption: (m.caption as string) ?? null })),
    );
  }
  setTheme(mediaId: string, theme: string, model: string) {
    const row = this.tables.media.get(mediaId);
    if (row) Object.assign(row, { theme, theme_model: model });
    return Promise.resolve();
  }
  hasWeekly(weekStart: string) {
    return Promise.resolve(this.tables.weekly_insights.has(weekStart));
  }
  rpc(fn: 'own_media_ranking' | 'account_engagement', args: Record<string, unknown>) {
    this.rpcs.push({ fn, args });
    if (fn === 'own_media_ranking') {
      return Promise.resolve([{ dimension: 'format', bucket: 'CAROUSEL_ALBUM', posts: 3, rate: 0.072 }]);
    }
    return Promise.resolve([
      { account_id: OWN.id, posts: 4, rate: 0.021 },
      { account_id: RIVAL.id, posts: 2, rate: null },
    ]);
  }
  ownPostsSince(accountId: string): Promise<PostForPrompt[]> {
    return Promise.resolve(
      [...this.tables.media.values()]
        .filter((m) => m.account_id === accountId)
        .map((m) => ({
          posted_at: m.posted_at as string,
          media_type: m.media_type as string,
          media_product_type: m.media_product_type as string,
          theme: (m.theme as string) ?? null,
          metrics: (this.tables.media_metrics.get(`${m.id}|2026-11-02`) as Record<string, number | null>) ?? null,
        })),
    );
  }
  funnelSince() {
    return Promise.resolve([...this.tables.funnel_daily.values()]);
  }
  followersSince() {
    return Promise.resolve(
      [...this.tables.account_daily.values()].map((r) => ({
        account_id: String(r.account_id),
        day: String(r.day),
        followers_count: r.followers_count as number | null,
      })),
    );
  }
  count(table: SocialTable) {
    return this.tables[table].size;
  }
}

const ownMedia = [
  { id: 'm1', media_type: 'CAROUSEL_ALBUM', media_product_type: 'FEED', caption: 'Búzios em 5 paradas', permalink: 'https://www.instagram.com/p/m1/', timestamp: '2026-10-30T21:00:00+0000', like_count: 40, comments_count: 3 },
  { id: 'm2', media_type: 'VIDEO', media_product_type: 'REELS', caption: 'A história da ponte', permalink: 'https://www.instagram.com/reel/m2/', timestamp: '2026-10-28T15:00:00+0000', like_count: 90, comments_count: 8 },
  { id: 'm3', media_type: 'IMAGE', media_product_type: 'FEED', caption: 'Nosso time gravando', permalink: 'https://www.instagram.com/p/m3/', timestamp: '2026-10-20T12:00:00+0000', like_count: 12, comments_count: 0 },
];

const insight = (pairs: Record<string, number>) => ({
  data: Object.entries(pairs).map(([name, value]) => ({ name, period: 'lifetime', values: [{ value }] })),
});

const metaError = (status: number, code: number, subcode?: number) =>
  new Response(JSON.stringify({ error: { message: 'x', type: 'OAuthException', code, error_subcode: subcode } }), { status });

/** The Graph API, recorded. `m3` refuses the full FEED list once (code 100), like a type mismatch. */
function graph(url: URL): Response {
  const path = url.pathname.replace('/v26.0/', '');
  const fields = url.searchParams.get('fields') ?? '';
  const metric = url.searchParams.get('metric') ?? '';
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  if (path === IG_USER && fields.startsWith('business_discovery.username(izitravel)')) {
    return ok({
      business_discovery: {
        id: '17841499999999999',
        followers_count: 51234,
        media_count: 800,
        media: { data: [{ id: 'c1', media_type: 'VIDEO', caption: 'Roma', permalink: 'https://www.instagram.com/reel/c1/', timestamp: '2026-10-29T10:00:00+0000', comments_count: 4 }] },
      },
    });
  }
  if (path === IG_USER && fields.startsWith('business_discovery.username(autioapp)')) return metaError(500, 2);
  if (path === IG_USER && fields.startsWith('business_discovery.username(ghost)')) return metaError(400, 110, 2207013);
  if (path === IG_USER) return ok({ id: IG_USER, username: 'tuggi_app', followers_count: 1520, media_count: 3 });
  if (path === `${IG_USER}/media`) return ok({ data: ownMedia, paging: { cursors: { before: 'b', after: 'a' } } });
  if (path === `${IG_USER}/insights`) {
    return metric === 'profile_views' ? ok({ data: [{ name: 'profile_views', total_value: { value: 37 } }] }) : metaError(400, 100);
  }
  if (path === 'm1/insights') return ok(insight({ reach: 1000, saved: 20, shares: 5, views: 3000, profile_visits: 9, follows: 2, likes: 41, comments: 3 }));
  if (path === 'm2/insights') return ok(insight({ reach: 4000, saved: 30, shares: 50, views: 9000, likes: 90, comments: 8 }));
  if (path === 'm3/insights') {
    return metric.includes('profile_visits') ? metaError(400, 100) : ok(insight({ reach: 300, saved: 1, shares: 0, likes: 12, comments: 0 }));
  }
  return new Response('{}', { status: 404 });
}

interface Rig {
  deps: CollectDeps;
  store: MemoryStore;
  urls: string[];
  headers: Array<Record<string, string>>;
  logs: string[];
  prompts: string[];
}

function rig(opts: { now?: Date; geminiAnswers?: string[]; appAccess?: boolean; accounts?: WatchedAccount[] } = {}): Rig {
  const store = new MemoryStore(opts.accounts ?? [OWN, RIVAL, BROKEN]);
  const urls: string[] = [];
  const headers: Array<Record<string, string>> = [];
  const logs: string[] = [];
  const prompts: string[] = [];
  const meta = metaClient({
    fetch: (url, init) => {
      urls.push(url);
      headers.push((init?.headers ?? {}) as Record<string, string>);
      return Promise.resolve(graph(new URL(url)));
    },
    token: TOKEN,
    igUserId: IG_USER,
  });
  const answers = [...(opts.geminiAnswers ?? [])];
  const gemini: Gemini = (prompt) => {
    prompts.push(prompt);
    if (prompt.startsWith('Classifique')) {
      return Promise.resolve({ text: '```json\n{"m1": "cidade", "m2": "curiosidade", "m3": "bastidor", "zz": "cidade"}\n```', model: 'gemini-2.5-flash-lite' });
    }
    return Promise.resolve({ text: answers.shift() ?? '[]', model: 'gemini-2.5-flash-lite' });
  };
  const ga4 = (propertyId: string) => (body: Record<string, unknown>) => {
    if (propertyId === '491146217') {
      if (opts.appAccess === false) return Promise.reject(new Error('ga4_report_403'));
      return Promise.resolve({
        rows: [
          { dimensionValues: [{ value: '20261101' }, { value: 'iOS' }], metricValues: [{ value: '4' }] },
          { dimensionValues: [{ value: '20261101' }, { value: 'Android' }], metricValues: [{ value: '7' }] },
          { dimensionValues: [{ value: '20261101' }, { value: 'web' }], metricValues: [{ value: '99' }] },
        ],
      });
    }
    assertEquals((body.dimensionFilter as { filter: { fieldName: string } }).filter.fieldName, 'sessionSource');
    return Promise.resolve({ rows: [{ dimensionValues: [{ value: '20261031' }], metricValues: [{ value: '12' }] }] });
  };
  return {
    deps: { store, meta, ga4, gemini, now: () => opts.now ?? MONDAY, log: (l) => logs.push(l) },
    store,
    urls,
    headers,
    logs,
    prompts,
  };
}

const GOOD_RECS = JSON.stringify([
  { title: 'Repetir o carrossel de cidade na sexta às 18h', why: 'Foi o formato com mais salvos no mês.', evidence: 'Os 3 carrosséis tiveram 7,2% de interações por alcance em 4 semanas; a média foi 3,1%.' },
  { title: 'Trocar a imagem de bastidor por reels', why: 'A imagem rendeu menos que os outros formatos.', evidence: 'A imagem do dia 20 teve 4% por alcance; o reels do dia 28 teve 4,5%.' },
]);

Deno.test('#1059: the daily run writes our account, a competitor, the funnel, the themes and the week', async () => {
  const r = rig({ geminiAnswers: [GOOD_RECS] });
  const report = await runSocialCollect(r.deps);

  assertEquals(report.day, '2026-11-02');
  assertEquals(report.accounts, { ok: ['tuggi_app', 'izitravel'], failed: ['autioapp'] });
  assertEquals(r.store.tables.account_daily.get(`${OWN.id}|2026-11-02`), { account_id: OWN.id, day: '2026-11-02', followers_count: 1520, media_count: 3 });
  assertEquals(r.store.tables.account_daily.get(`${RIVAL.id}|2026-11-02`)?.followers_count, 51234);
  assertEquals(r.store.igIds, { [OWN.id]: IG_USER, [RIVAL.id]: '17841499999999999' });
  assertEquals(r.store.count('media'), 4);

  // A reel is never asked for profile_visits or follows; it stores null, not zero.
  const reel = r.store.tables.media_metrics.get('m2|2026-11-02');
  assertEquals([reel?.reach, reel?.shares, reel?.profile_visits, reel?.follows], [4000, 50, null, null]);
  assert(r.urls.some((u) => u.includes('/m2/insights') && !u.includes('profile_visits')), 'reel asked for a FEED metric');
  // A refused metric list degrades to the base list; the missing ones are null.
  const image = r.store.tables.media_metrics.get('m3|2026-11-02');
  assertEquals([image?.reach, image?.views, image?.profile_visits, image?.likes], [300, null, null, 12]);
  // A competitor has likes and comments only; a hidden like count stays null.
  assertEquals(r.store.tables.media_metrics.get('c1|2026-11-02'), {
    media_id: 'c1', day: '2026-11-02', likes: null, comments: 4, reach: null, saved: null, shares: null, views: null, profile_visits: null, follows: null,
  });

  // Funnel: yesterday's profile views; website_clicks refused by Meta is null and logged.
  assertEquals(r.store.tables.funnel_daily.get('2026-11-01'), {
    day: '2026-11-01', profile_views: 37, website_clicks: null, ig_site_sessions: 0, installs_ios: 4, installs_android: 7,
  });
  assertEquals(r.store.tables.funnel_daily.get('2026-10-31')?.ig_site_sessions, 12);
  assertEquals(report.funnel, { meta: 'partial', site: 'ok', app: 'ok' });

  // Themes: the three own posts, never the competitor's, never an id the model made up.
  assertEquals(report.themes, 3);
  assertEquals(r.store.tables.media.get('m3')?.theme, 'bastidor');
  assertEquals(r.store.tables.media.get('m3')?.theme_model, 'gemini-2.5-flash-lite');
  assertEquals(r.store.tables.media.get('c1')?.theme, undefined);
  for (const hint of Object.values(THEME_HINTS)) assert(r.prompts[0].includes(hint), `theme prompt lacks ${hint}`);

  // The week: Monday, from the two ranking functions, checked and written once.
  assertEquals(report.weekly, 'written');
  assertEquals(r.store.rpcs.map((c) => c.fn).sort(), ['account_engagement', 'own_media_ranking']);
  assertEquals(r.store.rpcs[0].args, { p_since: '2026-10-05T03:00:00.000Z' });
  const week = r.store.tables.weekly_insights.get('2026-11-02');
  assertEquals((week?.recommendations as unknown[]).length, 2);
  assertEquals(week?.model, 'gemini-2.5-flash-lite');
  assert(r.prompts[1].startsWith('Você escreve, toda segunda-feira'), 'weekly prompt is not copy section 6');
  assert(r.prompts[1].includes('Com menos de 3 posts na janela'), '{min} not resolved');
});

Deno.test('#1059: a second run on the same day adds no row, and the week is not asked again', async () => {
  const r = rig({ geminiAnswers: [GOOD_RECS, GOOD_RECS] });
  await runSocialCollect(r.deps);
  const before = Object.fromEntries(Object.entries(r.store.tables).map(([t, m]) => [t, m.size]));
  const prompts = r.prompts.length;
  const second = await runSocialCollect(r.deps);
  const after = Object.fromEntries(Object.entries(r.store.tables).map(([t, m]) => [t, m.size]));
  assertEquals(after, before);
  assertEquals(second.weekly, 'exists');
  assertEquals(second.themes, 0);
  assertEquals(r.prompts.length, prompts);
  // The theme of the first run survives the media upsert of the second.
  assertEquals(r.store.tables.media.get('m1')?.theme, 'cidade');
});

Deno.test('#1059: off Monday there is no recommendation unless forced; a bad answer is asked once more, then dropped', async () => {
  const tuesday = rig({ now: TUESDAY });
  assertEquals((await runSocialCollect(tuesday.deps)).weekly, 'not_monday');
  assertEquals(tuesday.store.count('weekly_insights'), 0);

  const dash = JSON.stringify([{ title: 'Postar reels — sempre', why: 'Rende.', evidence: 'Teve 4% em 4 semanas.' }]);
  const forced = rig({ now: TUESDAY, geminiAnswers: [dash, 'não sei'] });
  forced.deps.forceWeekly = true;
  assertEquals((await runSocialCollect(forced.deps)).weekly, 'rejected');
  assertEquals(forced.store.count('weekly_insights'), 0);
  assertEquals(forced.prompts.filter((p) => p.startsWith('Você escreve')).length, 2);

  const retried = rig({ now: TUESDAY, geminiAnswers: [dash, GOOD_RECS] });
  retried.deps.forceWeekly = true;
  assertEquals((await runSocialCollect(retried.deps)).weekly, 'written');
  assert(retried.store.tables.weekly_insights.has('2026-11-02'), 'week_start is not the Monday');
});

Deno.test('#1059: without access to the app property, installs are null (never zero) and the run says so', async () => {
  const r = rig({ appAccess: false, geminiAnswers: [GOOD_RECS] });
  const report = await runSocialCollect(r.deps);
  assertEquals(report.funnel.app, 'no_access');
  const row = r.store.tables.funnel_daily.get('2026-11-01');
  assertEquals([row?.installs_ios, row?.installs_android, row?.ig_site_sessions], [null, null, 0]);
  assert(r.logs.some((l) => l.includes('ga4 app no_access')), 'no log line for the missing access');
});

Deno.test('#1059: the token travels in the header only and no log line carries it', async () => {
  const r = rig({ geminiAnswers: [GOOD_RECS] });
  await runSocialCollect(r.deps);
  assert(r.urls.length > 0);
  for (const u of r.urls) assert(!u.includes(TOKEN) && !u.includes('access_token'), `token in ${u}`);
  for (const h of r.headers) assertEquals(h.Authorization, `Bearer ${TOKEN}`);
  for (const l of r.logs) assert(!l.includes(TOKEN), `token in log: ${l}`);
  assert(r.logs.some((l) => l.includes('@autioapp failed: meta_500_2')), 'the failed account is not logged');
});

Deno.test('#1059: lookup answers the followers, not_found for a missing or personal account, meta_error otherwise', async () => {
  const meta: Meta = rig().deps.meta;
  assertEquals(await lookupAccount(meta, 'izitravel'), { ok: true, ig_user_id: '17841499999999999', followers_count: 51234 });
  assertEquals(await lookupAccount(meta, 'ghost'), { ok: false, reason: 'not_found' });
  assertEquals(await lookupAccount(meta, 'autioapp'), { ok: false, reason: 'meta_error' });
  for (const bad of ['', 'Tuggi_App', '@tuggi', 'nome com espaço', 'a'.repeat(31), 42]) {
    assertEquals(await lookupAccount(meta, bad), { ok: false, reason: 'invalid' });
  }
});

Deno.test('#1059 copy section 6: the mechanical check refuses every listed rule', () => {
  const ok = { title: 'Repetir o carrossel de cidade', why: 'Rendeu mais salvos.', evidence: 'Teve 7,2% em 4 semanas.' };
  assertEquals(checkRecommendations([ok]), [ok]);
  assertEquals(checkRecommendations([]), []);
  const bad = [
    { ...ok, why: 'Rende – muito.' },
    { ...ok, why: 'Rende muito!' },
    { ...ok, why: 'Rende muito \u{1F680}' },
    { ...ok, title: 'Usar #viagem' },
    { ...ok, why: 'Vale notar que rendeu.' },
    { ...ok, why: 'Em resumo, rendeu.' },
    { ...ok, why: 'No fim do dia, rendeu.' },
    { ...ok, evidence: 'Teve mais salvos.' },
    { ...ok, title: 'x'.repeat(61) },
    { ...ok, evidence: `1${'x'.repeat(160)}` },
    { ...ok, why: 3 },
  ];
  for (const b of bad) assertEquals([b, checkRecommendations([b])], [b, null]);
  assertEquals(checkRecommendations([ok, ok, ok, ok]), null);
  assertEquals(checkRecommendations({ title: 'x' }), null);
});

// ---------------------------------------------------------------------------------------------
// The handler

const handler = await loadHandler('social-collect');

function call(authorization: string | null, body: unknown = {}, method = 'POST'): Promise<Response> {
  scenario.calls.length = 0;
  scenario.writes.length = 0;
  fetchCalls.length = 0;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (authorization !== null) headers.authorization = authorization;
  return Promise.resolve(
    handler(new Request('http://edge.test/social-collect', { method, headers, body: method === 'POST' ? JSON.stringify(body) : undefined })),
  );
}

const MACHINE = 'Bearer test-service-role-key';
const userJwt = 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQifQ.c2ln';

Deno.test('#1059: only our secret key gets in; a user JWT, the publishable key or nothing is 401 with nothing touched', async () => {
  Deno.env.set('META_PAGE_TOKEN', TOKEN);
  Deno.env.set('META_IG_USER_ID', IG_USER);
  for (const auth of [null, userJwt, 'Bearer sb_publishable_xyz', 'test-service-role-key-but-wrong']) {
    const res = await call(auth, { action: 'lookup', username: 'izitravel' });
    assertEquals([auth, res.status], [auth, 401]);
    assertEquals([auth, scenario.calls, fetchCalls], [auth, [], []]);
  }
  assertEquals((await call(MACHINE, undefined, 'GET')).status, 405);
  assertEquals((await call(MACHINE, { action: 'drop' })).status, 400);
});

Deno.test('#1059: without the Meta token the function answers 503 and writes nothing', async () => {
  Deno.env.delete('META_PAGE_TOKEN');
  Deno.env.set('META_IG_USER_ID', IG_USER);
  for (const body of [{}, { action: 'lookup', username: 'izitravel' }]) {
    const res = await call(MACHINE, body);
    assertEquals(res.status, 503);
    assertEquals(await res.json(), { error: 'meta_not_configured' });
    assertEquals([scenario.calls, scenario.writes, fetchCalls], [[], [], []]);
  }
});

Deno.test('#1059: the lookup through the handler reaches Business Discovery only, and never the database', async () => {
  Deno.env.set('META_PAGE_TOKEN', TOKEN);
  Deno.env.set('META_IG_USER_ID', IG_USER);
  network.reply = (url) => graph(new URL(url));
  const found = await call(MACHINE, { action: 'lookup', username: 'izitravel' });
  assertEquals([found.status, await found.json()], [200, { ok: true, ig_user_id: '17841499999999999', followers_count: 51234 }]);
  assertEquals(scenario.calls, []);
  assertEquals(fetchCalls.length, 1);
  assert(fetchCalls[0].startsWith(`https://graph.facebook.com/v26.0/${IG_USER}?fields=business_discovery.username%28izitravel%29`));
  const missing = await call(MACHINE, { action: 'lookup', username: 'ghost' });
  assertEquals([missing.status, await missing.json()], [200, { ok: false, reason: 'not_found' }]);
  const invalid = await call(MACHINE, { action: 'lookup', username: 'Nome Com Espaço' });
  assertEquals([invalid.status, fetchCalls.length], [400, 0]);
  network.reply = () => new Response('{}', { status: 400 });
});

Deno.test('#1059: the daily run through the handler reads the active accounts of the schema social and upserts', async () => {
  Deno.env.set('META_PAGE_TOKEN', TOKEN);
  Deno.env.set('META_IG_USER_ID', IG_USER);
  network.reply = (url) => graph(new URL(url));
  scenario.tables.watched_accounts = [{ ...OWN }];
  const res = await call(MACHINE, {});
  assertEquals(res.status, 200);
  const report = await res.json();
  assertEquals(report.accounts, { ok: ['tuggi_app'], failed: [] });
  const upserts = scenario.writes.filter((w) => w.op === 'upsert').map((w) => w.table);
  assert(['account_daily', 'media', 'media_metrics', 'funnel_daily'].every((t) => upserts.includes(t)), upserts.join());
  assert(!scenario.writes.some((w) => w.op === 'insert'), 'a plain insert would duplicate on the second run');
  delete scenario.tables.watched_accounts;
  network.reply = () => new Response('{}', { status: 400 });
});
