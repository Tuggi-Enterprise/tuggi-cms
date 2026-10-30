// _shared/social-collect.ts
//
// The daily collector of the CMS social analytics (#1059): our Instagram account through the Graph
// API, the competitors through Business Discovery, the site and app funnel through GA4, the theme of
// each new post and, on Mondays, the three recommendations of the week through Gemini. Everything
// lands in the schema `social` (migration 20261029150000) by upsert on the primary key, so a second
// run on the same day rewrites the same rows instead of adding new ones.
//
// Import-free except `ga4-data.ts` and `apple-downloads.ts` (both import-free): the database, `fetch`, Gemini and the clock
// are parameters, so the Deno tests drive it with recorded answers and no network.
//
// Graph API v26.0, checked 2026-10-29 against the official reference:
// - media insights: reach, saved, shares, views, likes, comments for FEED and REELS; profile_visits
//   and follows only for FEED (a reel answers an error for them). impressions and plays are gone.
// - account insights: profile_views and website_clicks lost their time series on 2025-01-08 and are
//   not in the v26.0 table; they are still asked one day at a time with metric_type=total_value. A
//   refusal or an empty answer writes nothing (the day stays null, never 0) and is logged once per
//   run with the Meta error code; only a 0 Meta answered is written as 0. profile_links_taps is NOT
//   the bio link (it counts the contact buttons), so it is not a substitute.
// - "User Metrics data is stored for up to 90 days" (Insights guide), so the account funnel reaches
//   back 90 days at most; GA4 aggregated reports have no such limit and go back to the first post.
// - Business Discovery paginates with cursors only, and the token travels in the Authorization
//   header: a URL with `access_token=` would leak it to any log that prints a failed fetch.
//
// #1062, checked 2026-10-29 against the v26.0 references (Media Insights, User Insights, User Stories):
// - reels: ig_reels_avg_watch_time and ig_reels_video_view_total_time ("in development"), REELS only.
//   The reference states no unit; Meta answers milliseconds, kept as is in the `_ms` columns.
// - stories: GET {ig-user-id}/stories lists the live ones ("Stories are only available for 24
//   hours"), and "Story media metrics are only available for 24 hours", so the hourly job keeps the
//   latest reading. reach, views and replies in one call; navigation alone, because the breakdown
//   story_navigation_action_type is "Only compatible with the navigation metric". The breakdown table
//   lists the values in upper case and the sample answers lower case: they are lowered here.
// - audience: follower_demographics, period=lifetime, metric_type=total_value, a timeframe is required
//   (this_week, the snapshot of the week), one breakdown per call (age, city, country, gender). Only
//   the top 45 are returned, and nothing below 100 followers.
// - GA4 (Data API schema): sessionCampaignName is a standard dimension; customEvent:store fails the
//   whole request while `store` is not registered as an event-scoped custom dimension of the property,
//   so the report is asked again without it and only the clicks by store stay unknown.
//
// #1063, checked 2026-10-30 against the v26.0 User Insights reference: follows_and_unfollows is
// period=day, metric_type=total_value, breakdown follow_type, and is not returned under 100 followers.
// It rides the same 90-day walk as the account funnel and lands in funnel_daily.follows/unfollows.

import { GA4_APP_PROPERTY_ID, GA4_ROW_LIMIT, GA4_SITE_PROPERTY_ID } from './ga4-data.ts';
import { type AppleConfig, collectAppleDownloads } from './apple-downloads.ts';

/** Same value as `SOCIAL_TIME_ZONE` in the CMS (`lib/social/time.ts`): every day here is Brasília. */
export const SOCIAL_TIME_ZONE = 'America/Sao_Paulo';
/** Brasília has had no daylight saving time since 2019: midnight is always 03:00 UTC. */
const BRASILIA_OFFSET = '-03:00';
export const DEFAULT_GRAPH_VERSION = 'v26.0';
export const GRAPH_HOST = 'https://graph.facebook.com';
/** Instagram's own username rule, and the CHECK of `social.watched_accounts.username`. */
export const USERNAME_PATTERN = /^[a-z0-9._]{1,30}$/;
/** The newest posts of our account whose insights are read every day (spec section 3 footer). */
export const INSIGHT_POSTS = 90;
/** How many recent posts of a competitor Business Discovery brings (card #1059). */
export const COMPETITOR_MEDIA_LIMIT = 50;
/** Pages of 50 of our own media the collector walks at most, a guard against a runaway cursor. */
export const OWN_MEDIA_MAX_PAGES = 20;
/** Below this, a group has no rate and the week gets no recommendation (copy `few_posts_hint`). */
export const MIN_POSTS = 3;
/** The window the weekly recommendation reads: four weeks, the default period of the screen. */
export const WEEKLY_WINDOW_DAYS = 28;
/** GA4 and Meta process up to 48 h late, so the last three days are read again every run. */
export const GA4_LOOKBACK_DAYS = 3;
/** Meta keeps account metrics for 90 days (Insights guide, checked 2026-10-29). */
export const META_FUNNEL_MAX_DAYS = 90;
/**
 * The funnel history reaches back to our first post, and at least two six-month periods (the
 * screen's longest comparison) when the first post is more recent than that.
 */
export const FUNNEL_HISTORY_DAYS = 360;
/** `sessionSource` that means "came from Instagram": ig, instagram, or any instagram.com host. */
export const IG_SESSION_SOURCE_PATTERN = '(ig|instagram|([a-z0-9-]+\\.)*instagram\\.com)';
export const INSIGHT_CONCURRENCY = 5;

export const THEMES = ['cidade', 'curiosidade', 'produto', 'bastidor', 'outro'] as const;
export type Theme = (typeof THEMES)[number];

/**
 * The definition of each theme, word for word the `Pages.Social.theme.*_hint` of `messages/pt.json`
 * (copy section 2.2: the screen and the model talk about the same "bastidor"). A CMS test compares
 * the two, so a change in the copy fails until this follows.
 */
export const THEME_HINTS: Record<Theme, string> = {
  cidade: 'Um destino, um lugar, um roteiro.',
  curiosidade: 'Um fato ou uma história que surpreende.',
  produto: 'O app, os planos, uma função.',
  bastidor: 'O time, uma gravação, um parceiro.',
  outro: 'O que não cabe nos quatro.',
};

const FEED_METRICS = ['reach', 'saved', 'shares', 'views', 'profile_visits', 'follows', 'likes', 'comments'];
const REELS_METRICS = ['reach', 'saved', 'shares', 'views', 'likes', 'comments'];
const REELS_WATCH_METRICS = [...REELS_METRICS, 'ig_reels_avg_watch_time', 'ig_reels_video_view_total_time'];
const STORY_METRICS = ['reach', 'views', 'replies'];
const STORY_BASE_METRICS = ['reach', 'replies'];
const STORY_FIELDS = 'id,media_type,permalink,timestamp';
/** The four story navigation actions, lower case (`social.stories` columns). */
export const STORY_ACTIONS = ['tap_forward', 'tap_back', 'tap_exit', 'swipe_forward'] as const;
export const AUDIENCE_BREAKDOWNS = ['city', 'country', 'age', 'gender'] as const;
export const AUDIENCE_TIMEFRAME = 'this_week';
/** The site event of a store button (#1060), with `store` = app_store | play_store. */
export const STORE_CLICK_EVENT = 'click_store';
export const STORE_IDS = ['app_store', 'play_store'] as const;
const BASE_METRICS = ['reach', 'saved', 'shares', 'likes', 'comments'];
const MEDIA_FIELDS = 'id,media_type,media_product_type,caption,permalink,timestamp,like_count,comments_count';
const BD_MEDIA_FIELDS = 'id,media_type,media_product_type,caption,permalink,timestamp,like_count,comments_count';
const BD_MEDIA_FIELDS_SAFE = 'id,media_type,caption,permalink,timestamp,like_count,comments_count';

// ----------------------------------------------------------------------------------------------
// Days in Brasília

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: SOCIAL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The Brasília calendar day of an instant, `YYYY-MM-DD`. */
export function brasiliaDay(instant: Date): string {
  return dayFormatter.format(instant);
}

/** Calendar arithmetic on a `YYYY-MM-DD`, free of any zone. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday of a calendar day: 1 is Monday, 7 is Sunday. */
export function isoWeekday(day: string): number {
  const w = new Date(`${day}T12:00:00Z`).getUTCDay();
  return w === 0 ? 7 : w;
}

/** The Monday of the week of `day` (`weekly_insights.week_start`, BR-COMUNICACAO-019 item 4.1). */
export function mondayOf(day: string): string {
  return addDays(day, 1 - isoWeekday(day));
}

/** Unix seconds of Brasília midnight opening `day`. */
export function brasiliaMidnight(day: string): number {
  return Math.floor(Date.parse(`${day}T00:00:00${BRASILIA_OFFSET}`) / 1000);
}

// ----------------------------------------------------------------------------------------------
// The Graph API

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** A refusal of the Graph API: HTTP status and Meta's numeric codes, never its message. */
export class MetaError extends Error {
  constructor(
    readonly status: number,
    readonly code: number | null,
    readonly subcode: number | null,
  ) {
    super(`meta_${status}_${code ?? 'x'}_${subcode ?? 'x'}`);
  }
}

export interface Meta {
  igUserId: string;
  get(path: string, params: Record<string, string>): Promise<Record<string, unknown>>;
}

export function metaClient(opts: { fetch: FetchFn; token: string; igUserId: string; version?: string }): Meta {
  const version = (opts.version || DEFAULT_GRAPH_VERSION).trim();
  return {
    igUserId: opts.igUserId,
    async get(path, params) {
      const url = new URL(`${GRAPH_HOST}/${version}/${path}`);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      let res: Response;
      try {
        res = await opts.fetch(url.toString(), {
          headers: { Authorization: `Bearer ${opts.token}` },
          signal: AbortSignal.timeout(20_000),
        });
      } catch {
        // Network failure or timeout. The thrown error may carry the URL; it is dropped here.
        throw new MetaError(0, null, null);
      }
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      const err = body?.error as { code?: unknown; error_subcode?: unknown } | undefined;
      if (!res.ok || err || !body) {
        throw new MetaError(
          res.status,
          typeof err?.code === 'number' ? err.code : null,
          typeof err?.error_subcode === 'number' ? err.error_subcode : null,
        );
      }
      return body;
    },
  };
}

/** Business Discovery's "Cannot find User": the username does not exist OR is a personal account. */
export function isNotFound(e: unknown): boolean {
  return e instanceof MetaError && (e.code === 110 || e.subcode === 2207013);
}

/** Meta's answer to a field it does not know for this node (code 100, "Invalid parameter"). */
function isInvalidParameter(e: unknown): boolean {
  return e instanceof MetaError && e.code === 100;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

export type LookupResult =
  | { ok: true; ig_user_id: string | null; followers_count: number | null }
  | { ok: false; reason: 'invalid' | 'not_found' | 'meta_error' };

/** `{"action":"lookup"}`: the CMS checks a username on Business Discovery before it adds the account. */
export async function lookupAccount(meta: Meta, username: unknown): Promise<LookupResult> {
  if (typeof username !== 'string' || !USERNAME_PATTERN.test(username)) return { ok: false, reason: 'invalid' };
  try {
    const body = await meta.get(meta.igUserId, {
      fields: `business_discovery.username(${username}){id,followers_count,media_count}`,
    });
    const bd = body.business_discovery as Record<string, unknown> | undefined;
    if (!bd) return { ok: false, reason: 'not_found' };
    return { ok: true, ig_user_id: str(bd.id), followers_count: num(bd.followers_count) };
  } catch (e) {
    return { ok: false, reason: isNotFound(e) ? 'not_found' : 'meta_error' };
  }
}

// ----------------------------------------------------------------------------------------------
// The database

export interface WatchedAccount {
  id: string;
  username: string;
  ig_user_id: string | null;
  is_own: boolean;
}

export type SocialTable =
  | 'account_daily'
  | 'media'
  | 'media_metrics'
  | 'funnel_daily'
  | 'weekly_insights'
  | 'store_clicks_daily'
  | 'audience_weekly'
  | 'stories'
  | 'collector_runs'
  | 'apple_downloads_daily';

/** The jobs of `social.collector_runs` (one row per job, the last run wins). */
export type CollectorJob = 'daily' | 'stories' | 'audience' | 'apple';
export type CollectorStatus = 'ok' | 'error' | 'not_configured';

export interface PostForPrompt {
  posted_at: string | null;
  media_type: string | null;
  media_product_type: string | null;
  theme: string | null;
  metrics: Record<string, number | null> | null;
}

/** What the collector reads and writes. `supabaseStore` is the real one; the tests keep it in memory. */
export interface SocialStore {
  activeAccounts(): Promise<WatchedAccount[]>;
  setIgUserId(accountId: string, igUserId: string): Promise<void>;
  /** Upsert on the primary key. Every row of one call carries the same columns. */
  upsert(table: SocialTable, rows: Record<string, unknown>[], onConflict: string): Promise<void>;
  untaggedMedia(accountId: string, limit: number): Promise<Array<{ id: string; caption: string | null }>>;
  setTheme(mediaId: string, theme: Theme, model: string): Promise<void>;
  hasWeekly(weekStart: string): Promise<boolean>;
  /** Whether `audience_weekly` has the snapshot of the week starting `weekStart`. */
  hasAudience(weekStart: string): Promise<boolean>;
  /** The `covered_from` the Apple job recorded, or null. */
  appleCoveredFrom(): Promise<string | null>;
  rpc(fn: 'own_media_ranking' | 'account_engagement', args: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  ownPostsSince(accountId: string, sinceIso: string): Promise<PostForPrompt[]>;
  funnelSince(day: string): Promise<Record<string, unknown>[]>;
  /** The Brasília day of our oldest post, or null without posts. */
  firstPostDay(accountId: string): Promise<string | null>;
  followersSince(day: string): Promise<Array<{ account_id: string; day: string; followers_count: number | null }>>;
}

export class StoreError extends Error {
  constructor(
    readonly step: string,
    readonly code: string | undefined,
  ) {
    super(`store_${step}_${code ?? 'x'}`);
  }
}

type Res = { data: unknown; error: { code?: string } | null };

function check<T>(step: string, r: Res): T {
  if (r.error) throw new StoreError(step, r.error.code);
  return r.data as T;
}

/**
 * The store on a supabase-js client already scoped to `.schema('social')` and keyed with the secret
 * key. Typed structurally: importing the client's types would bring the esm.sh URL into this module.
 * `supabase-js` never rejects; every `{ error }` is read and thrown as a `StoreError`.
 */
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function supabaseStore(social: any): SocialStore {
  return {
    async activeAccounts() {
      return check<WatchedAccount[]>(
        'accounts',
        await social.from('watched_accounts').select('id, username, ig_user_id, is_own').eq('active', true),
      ) ?? [];
    },
    async setIgUserId(accountId, igUserId) {
      check('ig_user_id', await social.from('watched_accounts').update({ ig_user_id: igUserId }).eq('id', accountId));
    },
    async upsert(table, rows, onConflict) {
      if (rows.length === 0) return;
      check(`upsert_${table}`, await social.from(table).upsert(rows, { onConflict }));
    },
    async untaggedMedia(accountId, limit) {
      return check<Array<{ id: string; caption: string | null }>>(
        'untagged',
        await social
          .from('media')
          .select('id, caption')
          .eq('account_id', accountId)
          .is('theme', null)
          .order('posted_at', { ascending: false })
          .limit(limit),
      ) ?? [];
    },
    async setTheme(mediaId, theme, model) {
      check('theme', await social.from('media').update({ theme, theme_model: model }).eq('id', mediaId));
    },
    async hasWeekly(weekStart) {
      const rows = check<unknown[]>(
        'weekly_read',
        await social.from('weekly_insights').select('week_start').eq('week_start', weekStart).limit(1),
      );
      return Array.isArray(rows) && rows.length > 0;
    },
    async hasAudience(weekStart) {
      const rows = check<unknown[]>(
        'audience_read',
        await social.from('audience_weekly').select('week_start').eq('week_start', weekStart).limit(1),
      );
      return Array.isArray(rows) && rows.length > 0;
    },
    async appleCoveredFrom() {
      const rows = check<Array<{ covered_from: string | null }>>(
        'apple_coverage',
        await social.from('collector_runs').select('covered_from').eq('job', 'apple').limit(1),
      ) ?? [];
      return rows[0]?.covered_from ?? null;
    },
    async rpc(fn, args) {
      return check<Record<string, unknown>[]>(`rpc_${fn}`, await social.rpc(fn, args)) ?? [];
    },
    async ownPostsSince(accountId, sinceIso) {
      const rows = check<Array<Record<string, unknown>>>(
        'own_posts',
        await social
          .from('media')
          .select(
            'posted_at, media_type, media_product_type, theme, media_metrics(day, reach, likes, comments, saved, shares, views, profile_visits, follows)',
          )
          .eq('account_id', accountId)
          .gte('posted_at', sinceIso)
          .order('posted_at', { ascending: false })
          .order('day', { referencedTable: 'media_metrics', ascending: false })
          .limit(1, { referencedTable: 'media_metrics' }),
      ) ?? [];
      return rows.map((r) => {
        const m = Array.isArray(r.media_metrics) ? (r.media_metrics[0] as Record<string, number | null>) : null;
        return {
          posted_at: (r.posted_at as string) ?? null,
          media_type: (r.media_type as string) ?? null,
          media_product_type: (r.media_product_type as string) ?? null,
          theme: (r.theme as string) ?? null,
          metrics: m,
        };
      });
    },
    async funnelSince(day) {
      return check<Record<string, unknown>[]>(
        'funnel_read',
        await social
          .from('funnel_daily')
          .select('day, profile_views, website_clicks, follows, unfollows, ig_site_sessions, store_clicks, installs_ios, installs_android')
          .gte('day', day)
          .order('day'),
      ) ?? [];
    },
    async firstPostDay(accountId) {
      const rows = check<Array<{ posted_at: string | null }>>(
        'first_post',
        await social
          .from('media')
          .select('posted_at')
          .eq('account_id', accountId)
          .not('posted_at', 'is', null)
          .order('posted_at', { ascending: true })
          .limit(1),
      ) ?? [];
      const at = rows[0]?.posted_at;
      return at ? brasiliaDay(new Date(at)) : null;
    },
    async followersSince(day) {
      return check<Array<{ account_id: string; day: string; followers_count: number | null }>>(
        'followers_read',
        await social.from('account_daily').select('account_id, day, followers_count').gte('day', day).order('day'),
      ) ?? [];
    },
  };
}

// ----------------------------------------------------------------------------------------------
// Collection

export interface Gemini {
  (prompt: string): Promise<{ text: string; model: string }>;
}

/** Any GA4 `runReport` body against one property (`ga4Runner` of `ga4-data.ts`). */
export type Ga4Run = (body: Record<string, unknown>) => Promise<unknown>;

export interface CollectDeps {
  store: SocialStore;
  meta: Meta;
  /** Per property id; null when `GA4_SERVICE_ACCOUNT_JSON` is absent. */
  ga4: ((propertyId: string) => Ga4Run) | null;
  /** Null when `GEMINI_API_KEY` is absent: themes and the weekly recommendation are skipped. */
  gemini: Gemini | null;
  now: () => Date;
  log: (line: string) => void;
  forceWeekly?: boolean;
  /**
   * The App Store Connect side (#1062). `config` null: the secrets are missing and the job records
   * `not_configured`. Absent: the run does not touch Apple at all (the stories job, the tests of #1059).
   */
  apple?: { config: AppleConfig | null; fetch: FetchFn };
}

export interface CollectReport {
  day: string;
  accounts: { ok: string[]; failed: string[] };
  media: number;
  metrics: number;
  funnel: {
    meta: 'ok' | 'partial' | 'failed' | 'skipped';
    site: 'ok' | 'failed' | 'no_credentials';
    /** `no_store_dimension`: the total per day and campaign is known, the store is not (see header). */
    store_clicks: 'ok' | 'no_store_dimension' | 'failed' | 'no_credentials';
    app: 'ok' | 'no_access' | 'failed' | 'no_credentials';
  };
  audience: 'written' | 'exists' | 'empty' | 'failed' | 'skipped';
  apple: 'read' | 'pending' | 'not_configured' | 'failed' | 'skipped';
  themes: number;
  weekly: 'written' | 'exists' | 'not_monday' | 'few_posts' | 'rejected' | 'failed' | 'no_model';
}

type MediaNode = Record<string, unknown>;

function mediaRow(node: MediaNode, accountId: string): Record<string, unknown> {
  return {
    id: String(node.id),
    account_id: accountId,
    media_type: str(node.media_type),
    media_product_type: str(node.media_product_type),
    caption: typeof node.caption === 'string' ? node.caption : null,
    permalink: str(node.permalink),
    posted_at: str(node.timestamp),
  };
}

/** One value per metric name from a media insights answer; a missing metric stays null. */
export function insightValues(body: Record<string, unknown>): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  const data = Array.isArray(body.data) ? body.data : [];
  for (const item of data as Array<Record<string, unknown>>) {
    const name = str(item.name);
    if (!name) continue;
    const values = item.values as Array<{ value?: unknown }> | undefined;
    const total = item.total_value as { value?: unknown } | undefined;
    out[name] = num(values?.[0]?.value) ?? num(total?.value);
  }
  return out;
}

const METRIC_COLUMNS = ['likes', 'comments', 'reach', 'saved', 'shares', 'views', 'profile_visits', 'follows'] as const;
/** Reel watch time: Meta's metric name and the `media_metrics` column that keeps it, in milliseconds. */
const WATCH_COLUMNS = [
  ['ig_reels_avg_watch_time', 'reels_avg_watch_time_ms'],
  ['ig_reels_video_view_total_time', 'reels_total_watch_time_ms'],
] as const;

/**
 * The insights of one own post, degrading to fewer metrics when Meta refuses one for that type. A
 * reel asks the watch time first; the total is "in development", so a refusal retries without both.
 */
async function ownInsights(meta: Meta, node: MediaNode, day: string): Promise<Record<string, unknown>> {
  const reels = node.media_product_type === 'REELS';
  const attempts = reels ? [REELS_WATCH_METRICS, REELS_METRICS, BASE_METRICS] : [FEED_METRICS, BASE_METRICS];
  let values: Record<string, number | null> = {};
  for (const metrics of attempts) {
    try {
      values = insightValues(await meta.get(`${node.id}/insights`, { metric: metrics.join(',') }));
      break;
    } catch (e) {
      if (!isInvalidParameter(e)) break;
    }
  }
  const row: Record<string, unknown> = { media_id: String(node.id), day };
  for (const c of METRIC_COLUMNS) row[c] = values[c] ?? null;
  for (const [metric, column] of WATCH_COLUMNS) row[column] = values[metric] ?? null;
  // The media object carries the counters too: they fill likes and comments when insights did not.
  row.likes = row.likes ?? num(node.like_count);
  row.comments = row.comments ?? num(node.comments_count);
  return row;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function collectOwn(deps: CollectDeps, account: WatchedAccount, today: string): Promise<{ media: number; metrics: number }> {
  const { meta, store } = deps;
  const profile = await meta.get(meta.igUserId, { fields: 'id,username,followers_count,media_count' });
  if (str(profile.id) && profile.id !== account.ig_user_id) await store.setIgUserId(account.id, String(profile.id));
  await store.upsert(
    'account_daily',
    [{ account_id: account.id, day: today, followers_count: num(profile.followers_count), media_count: num(profile.media_count) }],
    'account_id,day',
  );

  const nodes: MediaNode[] = [];
  let after: string | null = null;
  for (let page = 0; page < OWN_MEDIA_MAX_PAGES; page++) {
    const params: Record<string, string> = { fields: MEDIA_FIELDS, limit: '50' };
    if (after) params.after = after;
    const body = await meta.get(`${meta.igUserId}/media`, params);
    const data = Array.isArray(body.data) ? (body.data as MediaNode[]) : [];
    nodes.push(...data.filter((n) => str(n.id)));
    const paging = body.paging as { cursors?: { after?: unknown }; next?: unknown } | undefined;
    after = str(paging?.cursors?.after);
    if (!after || !paging?.next || data.length === 0) break;
  }
  await store.upsert('media', nodes.map((n) => mediaRow(n, account.id)), 'id');

  const recent = [...nodes]
    .sort((a, b) => String(b.timestamp ?? '').localeCompare(String(a.timestamp ?? '')))
    .slice(0, INSIGHT_POSTS);
  const metrics = await mapLimit(recent, INSIGHT_CONCURRENCY, (n) => ownInsights(meta, n, today));
  await store.upsert('media_metrics', metrics, 'media_id,day');
  return { media: nodes.length, metrics: metrics.length };
}

async function businessDiscovery(meta: Meta, username: string): Promise<Record<string, unknown>> {
  const fields = (mediaFields: string) =>
    `business_discovery.username(${username}){id,followers_count,media_count,media.limit(${COMPETITOR_MEDIA_LIMIT}){${mediaFields}}}`;
  try {
    return await meta.get(meta.igUserId, { fields: fields(BD_MEDIA_FIELDS) });
  } catch (e) {
    // `media_product_type` is not in the Business Discovery examples; if Meta refuses it, ask without.
    if (!isInvalidParameter(e)) throw e;
    return await meta.get(meta.igUserId, { fields: fields(BD_MEDIA_FIELDS_SAFE) });
  }
}

async function collectCompetitor(deps: CollectDeps, account: WatchedAccount, today: string): Promise<{ media: number; metrics: number }> {
  const { meta, store } = deps;
  const body = await businessDiscovery(meta, account.username);
  const bd = body.business_discovery as Record<string, unknown> | undefined;
  if (!bd) throw new MetaError(200, null, null);
  if (str(bd.id) && bd.id !== account.ig_user_id) await store.setIgUserId(account.id, String(bd.id));
  await store.upsert(
    'account_daily',
    [{ account_id: account.id, day: today, followers_count: num(bd.followers_count), media_count: num(bd.media_count) }],
    'account_id,day',
  );
  const media = ((bd.media as { data?: unknown } | undefined)?.data ?? []) as MediaNode[];
  const nodes = media.filter((n) => str(n.id));
  await store.upsert('media', nodes.map((n) => mediaRow(n, account.id)), 'id');
  const metrics = nodes.map((n) => {
    const row: Record<string, unknown> = { media_id: String(n.id), day: today };
    for (const c of METRIC_COLUMNS) row[c] = null;
    for (const [, column] of WATCH_COLUMNS) row[column] = null;
    row.likes = num(n.like_count);
    row.comments = num(n.comments_count);
    return row;
  });
  await store.upsert('media_metrics', metrics, 'media_id,day');
  return { media: nodes.length, metrics: metrics.length };
}

type FunnelRows = Map<string, Record<string, unknown>>;

/** A day not collected yet for these columns: no row, or every one of them still null. */
function blank(rows: FunnelRows, day: string, columns: string[]): boolean {
  const row = rows.get(day);
  return !row || columns.every((c) => row[c] === null || row[c] === undefined);
}

type AccountMetric = { kind: 'value'; row: Record<string, number> } | { kind: 'empty' } | { kind: 'refused'; reason: string };

type InsightItem = Record<string, unknown> | null;

/** The single number of an account metric: `total_value.value`, or the first `values` entry. */
function singleValue(column: string) {
  return (item: InsightItem): Record<string, number> | null => {
    const value = num((item?.total_value as { value?: unknown } | undefined)?.value) ??
      num((item?.values as Array<{ value?: unknown }> | undefined)?.[0]?.value);
    return value === null ? null : { [column]: value };
  };
}

/**
 * Which `follow_type` value is a follow and which an unfollow (#1063). The reference lists FOLLOWER,
 * NON_FOLLOWER and UNKNOWN and says nothing more; the account's own answer settled it on 2026-10-30:
 * FOLLOWER 57 and NON_FOLLOWER 6 on 2026-10-28, FOLLOWER 74 and NON_FOLLOWER 5 on 2026-10-27, while
 * `followers_count` grew from 699 to 738 between two daily runs. UNKNOWN is neither, and is left out.
 */
export const FOLLOW_TYPE = { follows: 'FOLLOWER', unfollows: 'NON_FOLLOWER' } as const;

/**
 * Follows and unfollows of one day from a `follows_and_unfollows` answer broken down by
 * `follow_type`. No result at all (Meta answers the breakdown with no `results` while the day is not
 * settled) is no value: the day stays null. With results, a type Meta did not list is 0, because Meta
 * lists only what happened (seen on the story navigation breakdown).
 */
export function followMoves(item: InsightItem): { follows: number; unfollows: number } | null {
  const total = item?.total_value as { breakdowns?: unknown } | undefined;
  const breakdowns = Array.isArray(total?.breakdowns) ? (total.breakdowns as Array<Record<string, unknown>>) : [];
  const counts = new Map<string, number>();
  for (const b of breakdowns) {
    const keys = Array.isArray(b.dimension_keys) ? (b.dimension_keys as unknown[]).map(String) : [];
    const at = keys.indexOf('follow_type');
    if (at < 0) continue;
    for (const r of (Array.isArray(b.results) ? b.results : []) as Array<Record<string, unknown>>) {
      const values = Array.isArray(r.dimension_values) ? (r.dimension_values as unknown[]).map(String) : [];
      const value = num(r.value);
      if (values[at] && value !== null) counts.set(values[at].toUpperCase(), value);
    }
  }
  if (counts.size === 0) return null;
  return { follows: counts.get(FOLLOW_TYPE.follows) ?? 0, unfollows: counts.get(FOLLOW_TYPE.unfollows) ?? 0 };
}

interface AccountFunnelMetric {
  metric: string;
  /** The `funnel_daily` columns this metric writes; a day is asked again while all of them are null. */
  columns: string[];
  params?: Record<string, string>;
  parse: (item: InsightItem) => Record<string, number> | null;
}

/**
 * The account metrics, in walks of their own: the funnel pair, and the follows and unfollows of the
 * growth chart (#1063). Each walk stops on its own refusals, so a metric Meta refuses never cuts the
 * backfill of another.
 */
const ACCOUNT_METRIC_WALKS: AccountFunnelMetric[][] = [
  [
    { metric: 'profile_views', columns: ['profile_views'], parse: singleValue('profile_views') },
    { metric: 'website_clicks', columns: ['website_clicks'], parse: singleValue('website_clicks') },
  ],
  [{ metric: 'follows_and_unfollows', columns: ['follows', 'unfollows'], params: { breakdown: 'follow_type' }, parse: followMoves }],
];

/** One account metric for one Brasília day. Only a number Meta answered is a value. */
async function accountMetric(meta: Meta, m: AccountFunnelMetric, day: string): Promise<AccountMetric> {
  try {
    const body = await meta.get(`${meta.igUserId}/insights`, {
      metric: m.metric,
      period: 'day',
      metric_type: 'total_value',
      ...m.params,
      since: String(brasiliaMidnight(day)),
      until: String(brasiliaMidnight(addDays(day, 1))),
    });
    const row = m.parse((Array.isArray(body.data) ? body.data[0] : null) as InsightItem);
    return row === null ? { kind: 'empty' } : { kind: 'value', row };
  } catch (e) {
    return { kind: 'refused', reason: reason(e) };
  }
}

/**
 * Profile views, bio link taps and follows and unfollows, one day at a time, newest first: the last
 * three days always (Meta settles late), and every older day of the last 90 a metric has not
 * collected yet (each metric asks only its own missing days). Each walk stops at the first group of
 * days where Meta refused every metric of the walk on some day: past retention, or the metric is
 * gone, and asking further back would only repeat the refusal. Each metric is upserted on its own,
 * so a refusal never overwrites another metric, nor a value an earlier run collected.
 */
async function collectMetaFunnel(deps: CollectDeps, today: string, rows: FunnelRows): Promise<CollectReport['funnel']['meta']> {
  let asked = 0;
  let refused = 0;
  for (const walk of ACCOUNT_METRIC_WALKS) {
    const done = await walkAccountMetrics(deps, today, rows, walk);
    asked += done.asked;
    refused += done.refused;
  }
  return refused === 0 ? 'ok' : refused === asked ? 'failed' : 'partial';
}

async function walkAccountMetrics(
  deps: CollectDeps,
  today: string,
  rows: FunnelRows,
  walk: AccountFunnelMetric[],
): Promise<{ asked: number; refused: number }> {
  const recentFrom = addDays(today, -GA4_LOOKBACK_DAYS);
  const wanted = (d: string) => walk.filter((m) => d >= recentFrom || blank(rows, d, m.columns));
  const days = daysBetween(addDays(today, -META_FUNNEL_MAX_DAYS), addDays(today, -1))
    .filter((d) => wanted(d).length > 0)
    .reverse();
  const written = new Map<string, Array<Record<string, unknown>>>(walk.map((m) => [m.metric, []]));
  const refusals: Record<string, { count: number; reason: string }> = {};
  let asked = 0;
  let refused = 0;
  for (let i = 0; i < days.length; i += INSIGHT_CONCURRENCY) {
    const chunk = days.slice(i, i + INSIGHT_CONCURRENCY);
    const answers = await Promise.all(
      chunk.map(async (day) => {
        const metrics = wanted(day);
        return { day, metrics, got: await Promise.all(metrics.map((m) => accountMetric(deps.meta, m, day))) };
      }),
    );
    let exhausted = false;
    for (const { day, metrics, got } of answers) {
      got.forEach((answer, j) => {
        const metric = metrics[j].metric;
        asked += 1;
        if (answer.kind === 'value') written.get(metric)!.push({ day, ...answer.row });
        if (answer.kind === 'refused') {
          refused += 1;
          refusals[metric] = { count: (refusals[metric]?.count ?? 0) + 1, reason: refusals[metric]?.reason ?? answer.reason };
        }
      });
      if (got.every((a) => a.kind === 'refused')) exhausted = true;
    }
    if (exhausted) break;
  }
  for (const [metric, list] of Object.entries(refusals)) {
    deps.log(`[social-collect] account insight ${metric} refused on ${list.count} day(s): ${list.reason}`);
  }
  for (const m of walk) await deps.store.upsert('funnel_daily', written.get(m.metric)!, 'day');
  return { asked, refused };
}

const ga4Day = (v: unknown): string | null =>
  typeof v === 'string' && /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : null;

type Ga4RowRaw = { dimensionValues?: Array<{ value?: unknown }>; metricValues?: Array<{ value?: unknown }> };

function ga4RowsOf(body: unknown): Ga4RowRaw[] {
  const rows = body && typeof body === 'object' ? (body as { rows?: unknown }).rows : undefined;
  return Array.isArray(rows) ? (rows as Ga4RowRaw[]) : [];
}

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Days the property recorded anyone at all: only on these is a missing Instagram row a measured 0. */
export function activeDaysBody(from: string, to: string): Record<string, unknown> {
  return {
    dateRanges: [{ startDate: from, endDate: to }],
    dimensions: [{ name: 'date' }],
    metrics: [{ name: 'activeUsers' }],
    limit: String(GA4_ROW_LIMIT),
  };
}

export function siteSessionsBody(from: string, to: string): Record<string, unknown> {
  return {
    dateRanges: [{ startDate: from, endDate: to }],
    dimensions: [{ name: 'date' }],
    metrics: [{ name: 'sessions' }],
    dimensionFilter: {
      filter: {
        fieldName: 'sessionSource',
        stringFilter: { matchType: 'FULL_REGEXP', value: IG_SESSION_SOURCE_PATTERN, caseSensitive: false },
      },
    },
    limit: String(GA4_ROW_LIMIT),
  };
}

/**
 * `click_store` from Instagram per day and campaign, and per store while `customEvent:store` exists
 * (`withStore`). The campaign is the session's (`sessionCampaignName`), the token the visit came with.
 */
export function storeClicksBody(from: string, to: string, withStore: boolean): Record<string, unknown> {
  return {
    dateRanges: [{ startDate: from, endDate: to }],
    dimensions: [
      { name: 'date' },
      { name: 'sessionCampaignName' },
      ...(withStore ? [{ name: 'customEvent:store' }] : []),
    ],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: {
      andGroup: {
        expressions: [
          { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: STORE_CLICK_EVENT } } },
          {
            filter: {
              fieldName: 'sessionSource',
              stringFilter: { matchType: 'FULL_REGEXP', value: IG_SESSION_SOURCE_PATTERN, caseSensitive: false },
            },
          },
        ],
      },
    },
    limit: String(GA4_ROW_LIMIT),
  };
}

/**
 * A campaign token someone wrote in a link, not one of GA4's placeholders: `(not set)`, `(direct)`,
 * `(organic)`, `(referral)` and any other value in parentheses are not campaigns.
 */
export function isCampaignToken(v: string): boolean {
  const t = v.trim();
  return t.length > 0 && !(t.startsWith('(') && t.endsWith(')'));
}

export function appInstallsBody(from: string, to: string): Record<string, unknown> {
  return {
    dateRanges: [{ startDate: from, endDate: to }],
    dimensions: [{ name: 'date' }, { name: 'platform' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'first_open' } } },
    limit: String(GA4_ROW_LIMIT),
  };
}

/** The days a GA4 property answered anyone, from an `activeDaysBody` report. */
function activeDays(body: unknown): Set<string> {
  const out = new Set<string>();
  for (const r of ga4RowsOf(body)) {
    const day = ga4Day(r.dimensionValues?.[0]?.value);
    if (day && Number(r.metricValues?.[0]?.value) > 0) out.add(day);
  }
  return out;
}

/**
 * The first day to ask GA4 for: the oldest day since `start` not collected yet for these columns,
 * or the last three days when nothing older is missing. One report covers the whole range. A day
 * GA4 never measured stays blank and is asked again on every run, inside that same single report.
 */
function ga4From(rows: FunnelRows, start: string, today: string, columns: string[]): string {
  const recentFrom = addDays(today, -GA4_LOOKBACK_DAYS);
  if (start >= recentFrom) return recentFrom;
  return daysBetween(start, addDays(recentFrom, -1)).find((d) => blank(rows, d, columns)) ?? recentFrom;
}

/**
 * Instagram sessions on the site and app installs per day, from `start` (the funnel history) when
 * a day is missing, or the last three days otherwise. A day the property recorded nobody at all is
 * not written: it stays null, not 0 (before the property existed, say). A failed report writes
 * nothing, so a 403 never erases what an earlier run collected.
 */
async function collectGa4(
  deps: CollectDeps,
  today: string,
  rows: FunnelRows,
  start: string,
): Promise<Pick<CollectReport['funnel'], 'site' | 'store_clicks' | 'app'>> {
  if (!deps.ga4) return { site: 'no_credentials', store_clicks: 'no_credentials', app: 'no_credentials' };
  const to = addDays(today, -1);
  const result: Pick<CollectReport['funnel'], 'site' | 'store_clicks' | 'app'> = {
    site: 'ok',
    store_clicks: 'ok',
    app: 'ok',
  };

  try {
    const from = ga4From(rows, start, today, ['ig_site_sessions']);
    const run = deps.ga4(GA4_SITE_PROPERTY_ID);
    const [active, sessions] = await Promise.all([run(activeDaysBody(from, to)), run(siteSessionsBody(from, to))]);
    const live = activeDays(active);
    const counts = new Map<string, number>();
    for (const r of ga4RowsOf(sessions)) {
      const day = ga4Day(r.dimensionValues?.[0]?.value);
      const v = Number(r.metricValues?.[0]?.value);
      if (day && Number.isFinite(v)) counts.set(day, (counts.get(day) ?? 0) + Math.trunc(v));
    }
    const days = daysBetween(from, to).filter((d) => live.has(d) || counts.has(d));
    await deps.store.upsert('funnel_daily', days.map((day) => ({ day, ig_site_sessions: counts.get(day) ?? 0 })), 'day');
  } catch (e) {
    result.site = 'failed';
    deps.log(`[social-collect] ga4 site failed: ${reason(e)}`);
  }

  try {
    result.store_clicks = await collectStoreClicks(deps, deps.ga4(GA4_SITE_PROPERTY_ID), rows, start, today);
  } catch (e) {
    result.store_clicks = 'failed';
    deps.log(`[social-collect] ga4 store clicks failed: ${reason(e)}`);
  }

  try {
    const from = ga4From(rows, start, today, ['installs_ios', 'installs_android']);
    const run = deps.ga4(GA4_APP_PROPERTY_ID);
    const [active, installs] = await Promise.all([run(activeDaysBody(from, to)), run(appInstallsBody(from, to))]);
    const live = activeDays(active);
    const ios = new Map<string, number>();
    const android = new Map<string, number>();
    for (const r of ga4RowsOf(installs)) {
      const day = ga4Day(r.dimensionValues?.[0]?.value);
      const platform = String(r.dimensionValues?.[1]?.value ?? '').toLowerCase();
      const v = Number(r.metricValues?.[0]?.value);
      const target = platform === 'ios' ? ios : platform === 'android' ? android : null;
      if (day && target && Number.isFinite(v)) target.set(day, (target.get(day) ?? 0) + Math.trunc(v));
    }
    const days = daysBetween(from, to).filter((d) => live.has(d) || ios.has(d) || android.has(d));
    await deps.store.upsert(
      'funnel_daily',
      days.map((day) => ({ day, installs_ios: ios.get(day) ?? 0, installs_android: android.get(day) ?? 0 })),
      'day',
    );
  } catch (e) {
    const msg = reason(e);
    // ga4_report_403: the service account was not granted the app property. Nothing is written.
    result.app = msg === 'ga4_report_403' ? 'no_access' : 'failed';
    deps.log(`[social-collect] ga4 app ${result.app}: ${msg}`);
  }
  return result;
}

/**
 * Store clicks from Instagram (#1062, R2.2 and R2.3): the day's total into `funnel_daily.store_clicks`
 * (a day the site recorded anyone and no click is a measured 0, as the sessions), and each campaign
 * token by store into `store_clicks_daily`. While `customEvent:store` is not registered GA4 refuses
 * the report; it is asked again without the store, the totals still land, and no row by store is
 * written (the CMS prints those columns as unknown, never as zero).
 */
async function collectStoreClicks(
  deps: CollectDeps,
  run: Ga4Run,
  rows: FunnelRows,
  start: string,
  today: string,
): Promise<CollectReport['funnel']['store_clicks']> {
  const from = ga4From(rows, start, today, ['store_clicks']);
  const to = addDays(today, -1);
  let withStore = true;
  let report: unknown;
  try {
    report = await run(storeClicksBody(from, to, true));
  } catch (e) {
    if (reason(e) !== 'ga4_report_400') throw e;
    withStore = false;
    deps.log('[social-collect] ga4 refused customEvent:store; store clicks without the store');
    report = await run(storeClicksBody(from, to, false));
  }
  const live = activeDays(await run(activeDaysBody(from, to)));
  const totals = new Map<string, number>();
  const byStore = new Map<string, Record<string, unknown>>();
  for (const r of ga4RowsOf(report)) {
    const day = ga4Day(r.dimensionValues?.[0]?.value);
    const campaign = String(r.dimensionValues?.[1]?.value ?? '').trim();
    const store = String(r.dimensionValues?.[2]?.value ?? '');
    const v = Number(r.metricValues?.[0]?.value);
    if (!day || !Number.isFinite(v)) continue;
    totals.set(day, (totals.get(day) ?? 0) + Math.trunc(v));
    if (!withStore || !isCampaignToken(campaign) || !(STORE_IDS as readonly string[]).includes(store)) continue;
    const k = `${day}|${campaign}|${store}`;
    const prev = (byStore.get(k)?.clicks as number | undefined) ?? 0;
    byStore.set(k, { day, campaign, store, clicks: prev + Math.trunc(v) });
  }
  const days = daysBetween(from, to).filter((d) => live.has(d) || totals.has(d));
  await deps.store.upsert('funnel_daily', days.map((day) => ({ day, store_clicks: totals.get(day) ?? 0 })), 'day');
  await deps.store.upsert('store_clicks_daily', [...byStore.values()], 'day,campaign,store');
  return withStore ? 'ok' : 'no_store_dimension';
}

// ----------------------------------------------------------------------------------------------
// Audience and stories (#1062)

/**
 * One `follower_demographics` answer as `[label, count]`: the result whose dimension key is the
 * breakdown (the key list may carry `timeframe` first). Nothing answered is an empty list.
 */
export function demographicRows(body: Record<string, unknown>, breakdown: string): Array<[string, number]> {
  const item = (Array.isArray(body.data) ? body.data[0] : null) as Record<string, unknown> | null;
  const total = item?.total_value as { breakdowns?: unknown } | undefined;
  const breakdowns = Array.isArray(total?.breakdowns) ? (total.breakdowns as Array<Record<string, unknown>>) : [];
  const out: Array<[string, number]> = [];
  for (const b of breakdowns) {
    const keys = Array.isArray(b.dimension_keys) ? (b.dimension_keys as unknown[]).map(String) : [];
    const at = keys.indexOf(breakdown);
    for (const r of (Array.isArray(b.results) ? b.results : []) as Array<Record<string, unknown>>) {
      const values = Array.isArray(r.dimension_values) ? (r.dimension_values as unknown[]).map(String) : [];
      const label = values[at >= 0 ? at : values.length - 1];
      const count = num(r.value);
      if (label && count !== null) out.push([label, count]);
    }
  }
  return out;
}

/**
 * The week's audience snapshot of our account, once per week (Monday in Brasília). Written only
 * when all four breakdowns answered: a refusal leaves the week empty and the next daily run asks
 * again. Four empty answers are the account under 100 followers, and write nothing.
 */
async function collectAudience(deps: CollectDeps, today: string): Promise<CollectReport['audience']> {
  const weekStart = mondayOf(today);
  if (await deps.store.hasAudience(weekStart)) return 'exists';
  const rows: Record<string, unknown>[] = [];
  for (const breakdown of AUDIENCE_BREAKDOWNS) {
    const body = await deps.meta.get(`${deps.meta.igUserId}/insights`, {
      metric: 'follower_demographics',
      period: 'lifetime',
      metric_type: 'total_value',
      timeframe: AUDIENCE_TIMEFRAME,
      breakdown,
    });
    for (const [label, count] of demographicRows(body, breakdown)) {
      rows.push({ week_start: weekStart, breakdown, label, follower_count: count });
    }
  }
  if (rows.length === 0) return 'empty';
  await deps.store.upsert('audience_weekly', rows, 'week_start,breakdown,label');
  return 'written';
}

/**
 * The four navigation actions of one story, lowered. Meta lists only the actions that happened: when
 * the listed ones add up to the total it answered, an unlisted action is a measured 0 (the reference
 * sample: the results sum to the total). Otherwise an unlisted action stays null, unknown.
 */
export function navigationValues(body: Record<string, unknown>): Record<string, number | null> {
  const out: Record<string, number | null> = Object.fromEntries(STORY_ACTIONS.map((a) => [a, null]));
  const item = (Array.isArray(body.data) ? body.data[0] : null) as Record<string, unknown> | null;
  const total = item?.total_value as { value?: unknown; breakdowns?: unknown } | undefined;
  let listed = 0;
  for (const b of (Array.isArray(total?.breakdowns) ? total.breakdowns : []) as Array<Record<string, unknown>>) {
    for (const r of (Array.isArray(b.results) ? b.results : []) as Array<Record<string, unknown>>) {
      const action = String((r.dimension_values as unknown[] | undefined)?.[0] ?? '').toLowerCase();
      const value = num(r.value);
      if (!(STORY_ACTIONS as readonly string[]).includes(action) || value === null) continue;
      out[action] = value;
      listed += value;
    }
  }
  if (num(total?.value) === listed) for (const a of STORY_ACTIONS) out[a] = out[a] ?? 0;
  return out;
}

export interface StoriesReport {
  stories: number;
  read: number;
  failed: number;
}

/**
 * `{"job":"stories"}`, hourly: the live stories of our account and their insights, the latest
 * reading overwriting the earlier one. A story whose insights all failed is not written, so a
 * refusal never erases a good reading; a story whose navigation alone failed keeps the earlier
 * navigation (the row is written without those columns).
 */
export async function collectStories(deps: Pick<CollectDeps, 'store' | 'meta' | 'log'>): Promise<StoriesReport> {
  const { meta, store } = deps;
  const own = (await store.activeAccounts()).find((a) => a.is_own);
  if (!own) throw new Error('no_own_account');
  const listed = await meta.get(`${meta.igUserId}/stories`, { fields: STORY_FIELDS });
  const nodes = (Array.isArray(listed.data) ? (listed.data as MediaNode[]) : []).filter((n) => str(n.id));
  const report: StoriesReport = { stories: nodes.length, read: 0, failed: 0 };
  const readings = await mapLimit(nodes, INSIGHT_CONCURRENCY, async (n) => {
    let values: Record<string, number | null> | null = null;
    for (const metrics of [STORY_METRICS, STORY_BASE_METRICS]) {
      try {
        values = insightValues(await meta.get(`${n.id}/insights`, { metric: metrics.join(',') }));
        break;
      } catch (e) {
        if (!isInvalidParameter(e)) break;
      }
    }
    let nav: Record<string, number | null> | null = null;
    try {
      nav = navigationValues(
        await meta.get(`${n.id}/insights`, {
          metric: 'navigation',
          breakdown: 'story_navigation_action_type',
          metric_type: 'total_value',
        }),
      );
    } catch (e) {
      deps.log(`[social-collect] story navigation refused: ${reason(e)}`);
    }
    return { n, values, nav };
  });
  const full: Record<string, unknown>[] = [];
  const withoutNav: Record<string, unknown>[] = [];
  for (const { n, values, nav } of readings) {
    if (!values && !nav) {
      report.failed += 1;
      continue;
    }
    report.read += 1;
    const row: Record<string, unknown> = {
      id: String(n.id),
      account_id: own.id,
      media_type: str(n.media_type),
      permalink: str(n.permalink),
      posted_at: str(n.timestamp),
      reach: values?.reach ?? null,
      views: values?.views ?? null,
      replies: values?.replies ?? null,
    };
    if (nav) full.push({ ...row, ...nav });
    else withoutNav.push(row);
  }
  await store.upsert('stories', full, 'id');
  await store.upsert('stories', withoutNav, 'id');
  return report;
}

/** One row of `social.collector_runs` per job: when it last ran, how it ended, and a short detail. */
export async function recordRun(
  deps: Pick<CollectDeps, 'store' | 'now' | 'log'>,
  job: CollectorJob,
  status: CollectorStatus,
  detail: string | null,
  extra: Record<string, unknown> = {},
): Promise<void> {
  try {
    await deps.store.upsert(
      'collector_runs',
      [{ job, last_run_at: deps.now().toISOString(), status, detail: detail ? detail.slice(0, 500) : null, ...extra }],
      'job',
    );
  } catch (e) {
    // The run's own result is already written; a lost bookkeeping row is logged, never fatal.
    deps.log(`[social-collect] collector_runs ${job} failed: ${reason(e)}`);
  }
}

/**
 * The Apple job of the daily run: `not_configured` without the secrets (no error, no call), otherwise
 * the downloads by campaign and the first covered day, which only moves back (`covered_from`).
 */
async function runAppleCollect(
  deps: CollectDeps,
  apple: NonNullable<CollectDeps['apple']>,
): Promise<CollectReport['apple']> {
  if (!apple.config) {
    await recordRun(deps, 'apple', 'not_configured', null);
    return 'not_configured';
  }
  try {
    const coveredFrom = await deps.store.appleCoveredFrom();
    const result = await collectAppleDownloads({
      config: apple.config,
      fetch: apple.fetch,
      now: deps.now,
      coveredFrom,
      write: (rows) => deps.store.upsert('apple_downloads_daily', rows as unknown as Record<string, unknown>[], 'day,campaign'),
    });
    const first = [coveredFrom, result.first_day].filter((d): d is string => !!d).sort()[0] ?? null;
    await recordRun(deps, 'apple', 'ok', JSON.stringify(result), { covered_from: first });
    return result.state;
  } catch (e) {
    deps.log(`[social-collect] apple failed: ${reason(e)}`);
    await recordRun(deps, 'apple', 'error', reason(e));
    return 'failed';
  }
}

/** The hourly stories job, with its `collector_runs` row whatever happens. */
export async function runStoriesCollect(deps: CollectDeps): Promise<StoriesReport | null> {
  try {
    const report = await collectStories(deps);
    await recordRun(deps, 'stories', report.failed > 0 && report.read === 0 ? 'error' : 'ok', JSON.stringify(report));
    return report;
  } catch (e) {
    deps.log(`[social-collect] stories failed: ${reason(e)}`);
    await recordRun(deps, 'stories', 'error', reason(e));
    return null;
  }
}

// ----------------------------------------------------------------------------------------------
// Gemini: themes and the weekly recommendation

/** The JSON a model answered, without the Markdown fence some models wrap it in. */
export function extractJson(text: string, open: '[' | '{'): unknown {
  const close = open === '[' ? ']' : '}';
  const start = text.indexOf(open);
  const end = text.lastIndexOf(close);
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function themePrompt(posts: Array<{ id: string; caption: string | null }>): string {
  const lines = THEMES.map((t) => `- ${t}: ${THEME_HINTS[t]}`).join('\n');
  const data = posts.map((p) => ({ id: p.id, legenda: (p.caption ?? '').slice(0, 600) }));
  return [
    'Classifique cada post do Instagram da conta @tuggi_app em exatamente um tema, pela legenda.',
    'O Tuggi é um app de guia de áudio para quem viaja de carro.',
    'Temas:',
    lines,
    'Responda só com JSON, um objeto que liga o id de cada post ao tema, por exemplo {"123": "cidade"}.',
    'Use só os cinco temas acima, escritos como estão. Legenda vazia ou que não cabe em nenhum é "outro".',
    'Posts:',
    JSON.stringify(data),
  ].join('\n');
}

async function classifyThemes(deps: CollectDeps, own: WatchedAccount): Promise<number> {
  if (!deps.gemini) return 0;
  const posts = await deps.store.untaggedMedia(own.id, 100);
  if (posts.length === 0) return 0;
  const { text, model } = await deps.gemini(themePrompt(posts));
  const parsed = extractJson(text, '{');
  if (!parsed || typeof parsed !== 'object') {
    deps.log('[social-collect] theme answer was not JSON');
    return 0;
  }
  const known = new Set(posts.map((p) => p.id));
  let written = 0;
  for (const [id, theme] of Object.entries(parsed as Record<string, unknown>)) {
    if (!known.has(id) || !(THEMES as readonly string[]).includes(String(theme))) continue;
    await deps.store.setTheme(id, theme as Theme, model);
    written += 1;
  }
  return written;
}

/**
 * The instruction of the weekly recommendation, copy section 6 word for word
 * (`docs/design/copy/cms-redes-sociais-analise-2026-10.md`), with `{min}` resolved.
 */
export const WEEKLY_PROMPT = `Você escreve, toda segunda-feira, três sugestões de post para a conta @tuggi_app no Instagram. Quem lê é a pessoa
que cuida das redes da Tuggi, em português do Brasil. Ela decide o post da semana em um minuto, lendo três cartões.

O Tuggi é um app de guia de áudio para quem viaja de carro: ao passar perto de um lugar, o app conta a história dele.
As contas acompanhadas são concorrentes e perfis de viagem.

Dados: o JSON abaixo traz os posts da conta com as métricas de cada um (alcance, curtidas, comentários, salvos,
compartilhamentos, visitas ao perfil, seguidores ganhos), o formato (carrossel, reels, imagem), o tema (cidade,
curiosidade, produto, bastidor, outro), o dia da semana e a hora em Brasília; o funil por dia (visitas ao perfil,
cliques no link da bio, sessões do Instagram no site, instalações iOS e Android); e os concorrentes (seguidores,
crescimento, posts por semana, formatos). Use só esses números. Nunca invente, arredonde para cima nem some o que não
está lá.

Responda só com JSON, um array de até três objetos, nesta forma:
[{"title": "...", "why": "...", "evidence": "..."}]

- title: a ação, em até 60 caracteres, começando pelo verbo. Exemplo: "Repetir o carrossel de cidade na terça às 18h".
- why: uma ou duas frases, até 160 caracteres, dizendo o que a pessoa ganha fazendo isso.
- evidence: uma frase, até 160 caracteres, com pelo menos um número tirado dos dados e o período a que ele se refere,
  comparado com uma base (a média da conta, a semana anterior ou um concorrente).

Como escrever:
- Português do Brasil, frase de gente: sujeito, verbo, complemento. Uma ideia por frase. Trate a leitora por você.
- Número em algarismo, com vírgula decimal (6,1%) e ponto de milhar (12.400).
- Diga o concreto: formato, tema, dia, hora, número. Nada de "conteúdo de valor", "engajamento orgânico",
  "estratégia", "presença digital".
- Se algo rendeu menos, pode sugerir parar ou trocar. Vale tanto quanto sugerir mais.
- Se os dados sustentam menos de três sugestões, devolva menos. Com menos de ${MIN_POSTS} posts na janela, devolva [].
- Descreva o que os dados mostram. Não prometa o que vai acontecer.

O que não pode aparecer:
- Travessão ou meia-risca (U+2014 e U+2013). Use vírgula, ponto ou parêntese.
- Exclamação, emoji, hashtag, pergunta retórica, negrito, lista dentro do campo.
- Adjetivo sem número: incrível, poderoso, estratégico, relevante, impactante, essencial, imperdível.
- Verbo de propaganda: alavancar, potencializar, impulsionar, desbloquear, mergulhar, explorar o poder de.
- Fórmula: "não é X, é Y", "vale notar", "vale ressaltar", "vale lembrar", "em resumo", "no fim do dia",
  "lembre-se", "dica:", três adjetivos seguidos.
- Sugestão que serviria para qualquer conta: "poste com constância", "use reels", "interaja com os seguidores".
- Inglês onde há palavra em português: alcance, não reach; salvos, não saves; seguidores, não followers. Reels,
  Instagram, carrossel e bio ficam como são.

Bom:
{"title": "Repetir o carrossel de cidade na terça às 18h", "why": "É o formato e o horário que mais trouxeram
salvamento e visita ao perfil este mês.", "evidence": "Os 3 carrosséis de cidade de terça tiveram 7,2% de
interações por alcance nos últimos 30 dias; a média dos outros 14 posts foi 3,1%."}

Ruim, e por quê:
{"title": "Aposte em conteúdo de valor sobre destinos!", "why": "Conteúdos sobre cidades geram engajamento orgânico
e fortalecem a presença digital da marca.", "evidence": "Os posts de cidade performaram muito bem."}
Exclamação, jargão sem número, evidência sem número e sem período, e serviria para qualquer conta.`;

export interface Recommendation {
  title: string;
  why: string;
  evidence: string;
}

const DASHES = /[–—]/;
const PICTOGRAPH = /\p{Extended_Pictographic}/u;
const FORMULAS = [/\bvale (notar|ressaltar|lembrar)\b/i, /\bem resumo\b/i, /\bno fim do dia\b/i];

/**
 * Copy section 6, the mechanical check before `weekly_insights` is written: null when the answer
 * breaks any rule, the clean array otherwise.
 */
export function checkRecommendations(raw: unknown): Recommendation[] | null {
  if (!Array.isArray(raw) || raw.length > 3) return null;
  const out: Recommendation[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const { title, why, evidence } = item as Record<string, unknown>;
    if (typeof title !== 'string' || typeof why !== 'string' || typeof evidence !== 'string') return null;
    const fields = [title.trim(), why.trim(), evidence.trim()];
    if (fields.some((f) => f.length === 0)) return null;
    for (const f of fields) {
      if (DASHES.test(f) || f.includes('!') || f.includes('#') || PICTOGRAPH.test(f)) return null;
      if (FORMULAS.some((re) => re.test(f))) return null;
    }
    if (!/\d/.test(fields[2])) return null;
    if (fields[0].length > 60 || fields[1].length > 160 || fields[2].length > 160) return null;
    out.push({ title: fields[0], why: fields[1], evidence: fields[2] });
  }
  return out;
}

const weekdayFormatter = new Intl.DateTimeFormat('pt-BR', { timeZone: SOCIAL_TIME_ZONE, weekday: 'long' });
const hourFormatter = new Intl.DateTimeFormat('en-US', { timeZone: SOCIAL_TIME_ZONE, hour: 'numeric', hourCycle: 'h23' });

/** Format word of the prompt, the same map the screen uses (copy section 2.2). */
export function formatWord(mediaType: string | null, productType: string | null): string {
  if (mediaType === 'CAROUSEL_ALBUM') return 'carrossel';
  if (mediaType === 'IMAGE') return 'imagem';
  if (mediaType === 'VIDEO' && (productType === 'REELS' || productType === null)) return 'reels';
  if (productType === 'REELS') return 'reels';
  return 'outro';
}

async function weeklyData(deps: CollectDeps, own: WatchedAccount, accounts: WatchedAccount[], today: string) {
  const sinceDay = addDays(today, -WEEKLY_WINDOW_DAYS);
  const sinceIso = new Date(brasiliaMidnight(sinceDay) * 1000).toISOString();
  const [ranking, engagement, posts, funnel, followers] = await Promise.all([
    deps.store.rpc('own_media_ranking', { p_since: sinceIso }),
    deps.store.rpc('account_engagement', { p_since: sinceIso }),
    deps.store.ownPostsSince(own.id, sinceIso),
    deps.store.funnelSince(sinceDay),
    deps.store.followersSince(sinceDay),
  ]);
  const byId = new Map(accounts.map((a) => [a.id, a.username]));
  const competitors = engagement.map((e) => {
    const series = followers.filter((f) => f.account_id === e.account_id && f.followers_count !== null);
    const last = series.at(-1);
    const weekAgo = series.filter((f) => last && f.day <= addDays(last.day, -7)).at(-1);
    return {
      conta: byId.get(String(e.account_id)) ?? null,
      nossa: e.account_id === own.id,
      seguidores: last?.followers_count ?? null,
      crescimento_7_dias: last && weekAgo ? (last.followers_count ?? 0) - (weekAgo.followers_count ?? 0) : null,
      posts_na_janela: e.posts ?? null,
      interacoes_por_seguidor: e.rate ?? null,
    };
  });
  return {
    janela: { de: sinceDay, ate: addDays(today, -1), fuso: SOCIAL_TIME_ZONE },
    ranking_interacoes_por_alcance: ranking,
    posts: posts.map((p) => {
      const at = p.posted_at ? new Date(p.posted_at) : null;
      return {
        data: at ? brasiliaDay(at) : null,
        dia_da_semana: at ? weekdayFormatter.format(at) : null,
        hora: at ? Number(hourFormatter.format(at)) % 24 : null,
        formato: formatWord(p.media_type, p.media_product_type),
        tema: p.theme,
        metricas: p.metrics
          ? {
            alcance: p.metrics.reach,
            curtidas: p.metrics.likes,
            comentarios: p.metrics.comments,
            salvos: p.metrics.saved,
            compartilhamentos: p.metrics.shares,
            visitas_ao_perfil: p.metrics.profile_visits,
            seguidores_ganhos: p.metrics.follows,
          }
          : null,
      };
    }),
    funil: funnel,
    concorrentes: competitors,
  };
}

async function weeklyInsights(
  deps: CollectDeps,
  own: WatchedAccount,
  accounts: WatchedAccount[],
  today: string,
): Promise<CollectReport['weekly']> {
  if (!deps.forceWeekly && isoWeekday(today) !== 1) return 'not_monday';
  if (!deps.gemini) return 'no_model';
  const weekStart = mondayOf(today);
  if (!deps.forceWeekly && (await deps.store.hasWeekly(weekStart))) return 'exists';
  const data = await weeklyData(deps, own, accounts, today);
  if (data.posts.length < MIN_POSTS) return 'few_posts';
  const prompt = `${WEEKLY_PROMPT}\n\n${JSON.stringify(data)}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { text, model } = await deps.gemini(prompt);
    const recs = checkRecommendations(extractJson(text, '['));
    if (recs) {
      await deps.store.upsert('weekly_insights', [{ week_start: weekStart, recommendations: recs, model }], 'week_start');
      return 'written';
    }
    deps.log(`[social-collect] weekly answer refused by the copy check (attempt ${attempt + 1})`);
  }
  return 'rejected';
}

const reason = (e: unknown) => (e instanceof Error ? e.message : 'unknown');

/** The whole daily run. One account that fails is logged and skipped; the others go on. */
export async function runSocialCollect(deps: CollectDeps): Promise<CollectReport> {
  const today = brasiliaDay(deps.now());
  const report: CollectReport = {
    day: today,
    accounts: { ok: [], failed: [] },
    media: 0,
    metrics: 0,
    funnel: { meta: 'skipped', site: 'no_credentials', store_clicks: 'no_credentials', app: 'no_credentials' },
    audience: 'skipped',
    apple: 'skipped',
    themes: 0,
    weekly: 'not_monday',
  };

  const accounts = await deps.store.activeAccounts();
  const own = accounts.find((a) => a.is_own) ?? null;

  for (const account of accounts) {
    try {
      const done = account.is_own
        ? await collectOwn(deps, account, today)
        : await collectCompetitor(deps, account, today);
      report.media += done.media;
      report.metrics += done.metrics;
      report.accounts.ok.push(account.username);
    } catch (e) {
      report.accounts.failed.push(account.username);
      deps.log(`[social-collect] account @${account.username} failed: ${reason(e)}`);
    }
  }

  // The funnel fills whatever history is missing, so the first run (or one after a gap) backfills.
  let start = addDays(today, -FUNNEL_HISTORY_DAYS);
  const rows: FunnelRows = new Map();
  try {
    const firstPost = own ? await deps.store.firstPostDay(own.id) : null;
    if (firstPost && firstPost < start) start = firstPost;
    for (const r of await deps.store.funnelSince(start)) rows.set(String(r.day), r);
  } catch (e) {
    // Unread history reads as missing: the run asks for all of it again, and the upsert is idempotent.
    deps.log(`[social-collect] funnel history read failed: ${reason(e)}`);
  }
  if (own) {
    try {
      report.funnel.meta = await collectMetaFunnel(deps, today, rows);
    } catch (e) {
      report.funnel.meta = 'failed';
      deps.log(`[social-collect] funnel write failed: ${reason(e)}`);
    }
  }
  const ga4 = await collectGa4(deps, today, rows, start);
  report.funnel.site = ga4.site;
  report.funnel.store_clicks = ga4.store_clicks;
  report.funnel.app = ga4.app;

  if (own) {
    try {
      report.audience = await collectAudience(deps, today);
    } catch (e) {
      report.audience = 'failed';
      deps.log(`[social-collect] audience failed: ${reason(e)}`);
    }
    if (report.audience !== 'exists') {
      await recordRun(deps, 'audience', report.audience === 'failed' ? 'error' : 'ok', report.audience);
    }
  }
  if (deps.apple) report.apple = await runAppleCollect(deps, deps.apple);

  if (own) {
    try {
      report.themes = await classifyThemes(deps, own);
    } catch (e) {
      deps.log(`[social-collect] themes failed: ${reason(e)}`);
    }
    try {
      report.weekly = await weeklyInsights(deps, own, accounts, today);
    } catch (e) {
      report.weekly = 'failed';
      deps.log(`[social-collect] weekly failed: ${reason(e)}`);
    }
  }
  const failed = report.accounts.failed.length > 0 && report.accounts.ok.length === 0;
  await recordRun(deps, 'daily', failed ? 'error' : 'ok', JSON.stringify({ funnel: report.funnel, accounts_failed: report.accounts.failed.length }));
  return report;
}
