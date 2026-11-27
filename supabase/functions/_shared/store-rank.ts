// _shared/store-rank.ts
//
// Where Tuggi and the watched apps rank in the store search, per keyword and country (#1307, interface fixed on
// #1306), job `store_rank` of `social.collector_runs`, called every hour by pg_cron `social-collect-store-rank`.
// Each call reads the active keywords (`social.store_rank_keywords`) and the active apps per store
// (`social.store_rank_apps`), takes the keyword x store pairs with no row today in `social.store_rank_daily`,
// searches as many as fit in RANK_BUDGET_MS and writes one row per active app of that store and pair: `position`
// (1 = first) or null when the app is not among the `results_read` results. What a call wrote stays; the next
// call goes on from the pairs still missing. The day is Brasília's (`SOCIAL_TIME_ZONE`).
//
// Import-free: `fetch`, the clock, the pause and the database are parameters.
//
// App Store: the iTunes Search API, checked 2026-11-27 (performance-partners.apple.com/search-api):
// `term`, `country` ("The two-letter country code for the store you want to search"), `entity=software`,
// `limit` "1 to 200"; "The Search API is limited to approximately 20 calls per minute (subject to change)", so
// the calls are ITUNES_INTERVAL_MS apart. The order is the order of `results[].trackId`, the App Store id that
// `store_rank_apps.store_app_id` keeps.
//
// Play: no official API. The public search page `play.google.com/store/search?q=&c=apps&gl=&hl=` is read and the
// order is the first appearance of each package in its app links (`/store/apps/details?id=<package>`). Decision
// of the operator on #1307: the risk of reading the page is accepted. One fixed User-Agent that names us, calls
// PLAY_INTERVAL_MS apart, and the first sign of a block (429, a redirect to Google's `/sorry/` page, a captcha,
// or a 200 page with no package) stops Play for this call: nothing false is written, the job records the reason,
// and the App Store goes on. A failure of one store never hides or erases the other's rows.

export const ITUNES_SEARCH = 'https://itunes.apple.com/search';
export const PLAY_SEARCH = 'https://play.google.com/store/search';
/** The most results the iTunes Search API returns per call. */
export const ITUNES_LIMIT = 200;
/** "approximately 20 calls per minute": one call every 3 s, plus a margin. */
export const ITUNES_INTERVAL_MS = 3_100;
export const PLAY_INTERVAL_MS = 5_000;
/** A call stops starting searches this long after it began: the gateway answers 504 at 150 s. */
export const RANK_BUDGET_MS = 100_000;
export const RANK_USER_AGENT = 'TuggiStoreRank/1.0 (+https://tuggi.app)';
/** Rows of `store_rank_daily` read per page when listing what today already has (PostgREST caps a page). */
const DONE_PAGE = 1000;

export type RankStoreName = 'app_store' | 'play_store';
export const RANK_STORES: readonly RankStoreName[] = ['app_store', 'play_store'];

export interface RankKeyword {
  id: string;
  keyword: string;
  country: string;
  lang: string;
}
export interface RankApp {
  id: string;
  store: RankStoreName;
  store_app_id: string;
}
export interface RankRow {
  day: string;
  store: RankStoreName;
  keyword_id: string;
  app_id: string;
  position: number | null;
  results_read: number;
}

/** What the job reads and writes. `supabaseRankStore` is the real one; the tests keep it in memory. */
export interface RankStore {
  activeKeywords(): Promise<RankKeyword[]>;
  activeApps(): Promise<RankApp[]>;
  /** The (store, keyword) pairs that already have a row on `day`. */
  doneOn(day: string): Promise<Array<{ store: string; keyword_id: string }>>;
  /** Upsert of `social.store_rank_daily` on its primary key. */
  write(rows: RankRow[]): Promise<void>;
}

type Res = { data: unknown; error: { code?: string } | null };
function check<T>(step: string, r: Res): T {
  if (r.error) throw new Error(`store_${step}_${r.error.code ?? 'x'}`);
  return r.data as T;
}

/**
 * The store on a supabase-js client scoped to `.schema('social')` with the secret key. `supabase-js` never
 * rejects; every `{ error }` is thrown with its code.
 */
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function supabaseRankStore(social: any): RankStore {
  return {
    async activeKeywords() {
      return check<RankKeyword[]>(
        'rank_keywords',
        await social.from('store_rank_keywords').select('id, keyword, country, lang').eq('active', true).order('id'),
      ) ?? [];
    },
    async activeApps() {
      return check<RankApp[]>(
        'rank_apps',
        await social.from('store_rank_apps').select('id, store, store_app_id').eq('active', true).order('id'),
      ) ?? [];
    },
    async doneOn(day) {
      const out: Array<{ store: string; keyword_id: string }> = [];
      for (let from = 0;; from += DONE_PAGE) {
        const page = check<Array<{ store: string; keyword_id: string }>>(
          'rank_done',
          await social
            .from('store_rank_daily')
            .select('store, keyword_id')
            .eq('day', day)
            .order('store')
            .order('keyword_id')
            .order('app_id')
            .range(from, from + DONE_PAGE - 1),
        ) ?? [];
        out.push(...page);
        if (page.length < DONE_PAGE) return out;
      }
    },
    async write(rows) {
      if (rows.length === 0) return;
      check(
        'rank_write',
        await social.from('store_rank_daily').upsert(rows, { onConflict: 'day,store,keyword_id,app_id' }),
      );
    },
  };
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** The App Store ids in the order the iTunes Search API ranks them. */
export async function searchAppStore(fetchFn: FetchFn, kw: RankKeyword): Promise<string[]> {
  const q = new URLSearchParams({
    term: kw.keyword,
    country: kw.country.toLowerCase(),
    entity: 'software',
    limit: String(ITUNES_LIMIT),
  });
  let res: Response;
  try {
    res = await fetchFn(`${ITUNES_SEARCH}?${q}`, {
      headers: { 'User-Agent': RANK_USER_AGENT },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error('itunes_network');
  }
  if (!res.ok) throw new Error(`itunes_${res.status}`);
  const body = (await res.json().catch(() => null)) as { results?: Array<{ trackId?: unknown }> } | null;
  if (!body || !Array.isArray(body.results)) throw new Error('itunes_malformed');
  return body.results.map((r) => r.trackId).filter((id) => typeof id === 'number' || typeof id === 'string').map(
    String,
  );
}

const PACKAGE_LINK = /\/store\/apps\/details\?id=([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+)/g;

/** The packages of a Play search page, in the order of their first link. */
export function playPackages(html: string): string[] {
  const seen = new Set<string>();
  for (const m of html.matchAll(PACKAGE_LINK)) seen.add(m[1]);
  return [...seen];
}

/** `pt-BR` is `pt_BR` in Play's `hl`. */
const playLang = (lang: string) => lang.replace('-', '_');

/** The packages in the order Play's public search page lists them. Throws `play_blocked_*` on a block. */
export async function searchPlay(fetchFn: FetchFn, kw: RankKeyword): Promise<string[]> {
  const q = new URLSearchParams({ q: kw.keyword, c: 'apps', gl: kw.country.toUpperCase(), hl: playLang(kw.lang) });
  let res: Response;
  try {
    res = await fetchFn(`${PLAY_SEARCH}?${q}`, {
      headers: { 'User-Agent': RANK_USER_AGENT, 'Accept-Language': kw.lang },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error('play_network');
  }
  if (res.status === 429) throw new Error('play_blocked_429');
  if (res.url.includes('/sorry/')) throw new Error('play_blocked_sorry');
  if (!res.ok) throw new Error(`play_${res.status}`);
  const html = await res.text();
  const packages = playPackages(html);
  // A search for a word always lists apps: a page with none is a block, named by what it says when it says it.
  if (packages.length === 0) {
    throw new Error(/captcha|unusual traffic/i.test(html) ? 'play_blocked_captcha' : 'play_blocked_empty');
  }
  return packages;
}

export interface RankSlice {
  /** Pairs of this store today (active keywords, when the store has an active app), and those already written. */
  pairs: number;
  done_before: number;
  /** Pairs searched and written in this call, and those still missing after it. */
  read: number;
  pending: number;
  /** The first failure, which stopped this store for the call; null when none. */
  error: string | null;
}

export interface RankResult {
  day: string;
  /** `not_configured`: no active keyword, or no active app in either store. */
  state: 'read' | 'not_configured';
  app_store: RankSlice;
  play_store: RankSlice;
}

export interface RankDeps {
  store: RankStore;
  fetch: FetchFn;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  /** The Brasília day the rows belong to. */
  day: string;
  /** Epoch ms after which no new search starts. */
  deadline: number;
}

const SEARCH: Record<RankStoreName, (fetchFn: FetchFn, kw: RankKeyword) => Promise<string[]>> = {
  app_store: searchAppStore,
  play_store: searchPlay,
};
const INTERVAL: Record<RankStoreName, number> = { app_store: ITUNES_INTERVAL_MS, play_store: PLAY_INTERVAL_MS };

const emptySlice = (): RankSlice => ({ pairs: 0, done_before: 0, read: 0, pending: 0, error: null });

/** One row per app of the store: its 1-based place in the order, or null when it is not there. */
export function rankRows(
  day: string,
  store: RankStoreName,
  kw: RankKeyword,
  apps: RankApp[],
  order: string[],
): RankRow[] {
  return apps.map((app) => {
    const i = order.indexOf(app.store_app_id);
    return {
      day,
      store,
      keyword_id: kw.id,
      app_id: app.id,
      position: i >= 0 ? i + 1 : null,
      results_read: order.length,
    };
  });
}

async function runStore(
  deps: RankDeps,
  store: RankStoreName,
  pending: RankKeyword[],
  apps: RankApp[],
  slice: RankSlice,
): Promise<void> {
  const interval = INTERVAL[store];
  for (let i = 0; i < pending.length; i++) {
    if (i > 0) await deps.sleep(interval);
    if (deps.now().getTime() >= deps.deadline) break;
    try {
      const order = await SEARCH[store](deps.fetch, pending[i]);
      await deps.store.write(rankRows(deps.day, store, pending[i], apps, order));
      slice.read++;
    } catch (e) {
      slice.error = e instanceof Error ? e.message : 'unknown';
      break;
    }
  }
  slice.pending = slice.pairs - slice.done_before - slice.read;
}

export async function collectStoreRank(deps: RankDeps): Promise<RankResult> {
  const result: RankResult = { day: deps.day, state: 'read', app_store: emptySlice(), play_store: emptySlice() };
  const keywords = await deps.store.activeKeywords();
  const apps = await deps.store.activeApps();
  const appsOf = (store: RankStoreName) => apps.filter((a) => a.store === store);
  if (keywords.length === 0 || apps.length === 0) return { ...result, state: 'not_configured' };

  const done = new Set((await deps.store.doneOn(deps.day)).map((d) => `${d.store}|${d.keyword_id}`));
  // The two stores are different hosts with their own pace: they run side by side, each on its own error.
  await Promise.all(RANK_STORES.map((store) => {
    const slice = result[store];
    const storeApps = appsOf(store);
    if (storeApps.length === 0) return Promise.resolve();
    slice.pairs = keywords.length;
    const pending = keywords.filter((k) => !done.has(`${store}|${k.id}`));
    slice.done_before = keywords.length - pending.length;
    return runStore(deps, store, pending, storeApps, slice);
  }));
  return result;
}
