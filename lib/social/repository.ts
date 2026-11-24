/**
 * Reads and writes of the CMS social analytics (#1059) on the schema `social`.
 *
 * Every read and the two writes run on the client `withAuth` hands over, bound to the operator's
 * session, so the RLS of `social.*` (`core.is_caller_platform_admin()`) is the second gate after
 * `withAuth`. The only `service_role` use is `lookupInstagram`, which carries our secret key to the
 * Edge Function `social-collect`: the Meta token lives in that function's secrets and never here.
 *
 * The engagement formulas of our account and of the comparative table are the database's
 * (`social.own_media_ranking`, `social.account_engagement`). One formula lives here, by decision of
 * the Tech Lead on #1064: the interactions per follower of each competitor post (`competitorPostRates`),
 * which the comparison by market and the "fora da curva" seal read, the ruler of
 * `social.competitor_top_posts` rewritten in TypeScript so no function is added to the database.
 *
 * `supabase-js` never rejects: every `{ error }` is read and thrown as a `SocialDbError`, which the
 * routes answer as 500 with the SQLSTATE in the log and nothing else.
 */

import { NextResponse } from 'next/server'
import { getSupabaseService } from '@/lib/core/supabase-client'
import { ACCOUNT_WINDOW_DAYS, MARKET_WINDOW_DAYS, MIN_POSTS, OUTLIER_FACTOR, OUTLIER_MIN_POSTS } from './constants'
import { MARKETS, THEME_KEYS, formatKey, isMarket, type FormatKey, type Market } from './labels'
import {
  SOCIAL_PERIODS,
  addDays,
  brasiliaDay,
  isoWeekday,
  brasiliaMidnightIso,
  daysBetween,
  mondayOf,
  type SocialPeriod,
} from './time'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = any

export const SOCIAL_COLLECT_FUNCTION = 'social-collect'

export class SocialDbError extends Error {
  constructor(
    readonly step: string,
    readonly code: string | undefined
  ) {
    super(`social ${step} failed (${code ?? 'no code'})`)
  }
}

function check<T>(step: string, result: { data: T; error: { code?: string } | null }): T {
  if (result.error) throw new SocialDbError(step, result.error.code)
  return result.data
}

/** 500 with the SQLSTATE in the log and no row, id or username in it. */
export function socialFailure(step: string, err: unknown): NextResponse {
  const code = err instanceof SocialDbError ? err.code : undefined
  console.error(`[social] ${step} failed:`, code ?? (err instanceof Error ? err.message : 'unknown'))
  return NextResponse.json({ error: { code: 'server_error' } }, { status: 500 })
}

const social = (supabase: Client) => supabase.schema('social')

/** A number of the database, or null. `numeric` may arrive as a string; anything else is no value. */
function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

/** The CMS compiles to a lib without `Array.prototype.at`. */
const lastOf = <T>(list: T[]): T | undefined => list[list.length - 1]

/** The median of the database's rulers (`percentile_cont(0.5)`): the mean of the two middles. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** PostgREST answers at most 1000 rows per request (the project's `max_rows`): longer reads page by `range`. */
const PAGE_ROWS = 1000

async function allRows(
  step: string,
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { code?: string } | null }>
): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = []
  for (let from = 0; ; from += PAGE_ROWS) {
    const rows = (check<unknown>(step, await page(from, from + PAGE_ROWS - 1)) as Array<Record<string, unknown>> | null) ?? []
    out.push(...rows)
    if (rows.length < PAGE_ROWS) return out
  }
}

/** How many posts of a list fall on each Brasília day. */
function postsPerDay(rows: Array<Record<string, unknown>>): (day: string) => number {
  const byDay = new Map<string, number>()
  for (const r of rows) {
    if (typeof r.posted_at !== 'string') continue
    const day = brasiliaDay(new Date(r.posted_at))
    byDay.set(day, (byDay.get(day) ?? 0) + 1)
  }
  return (day) => byDay.get(day) ?? 0
}

// ---------------------------------------------------------------------------------------------
// Shared reads

export interface OwnAccount {
  id: string
  username: string
}

export async function ownAccount(supabase: Client): Promise<OwnAccount | null> {
  return check<OwnAccount | null>(
    'own_account',
    await social(supabase).from('watched_accounts').select('id, username').eq('is_own', true).maybeSingle()
  )
}

/** First and last day of `account_daily` for our account: the freshness line of the header. */
export async function collectionDays(
  supabase: Client,
  own: OwnAccount | null
): Promise<{ first_day: string | null; last_day: string | null }> {
  if (!own) return { first_day: null, last_day: null }
  const edge = async (ascending: boolean) => {
    const rows = check<Array<{ day: string }> | null>(
      'collection_days',
      await social(supabase)
        .from('account_daily')
        .select('day')
        .eq('account_id', own.id)
        .order('day', { ascending })
        .limit(1)
    )
    return rows?.[0]?.day ?? null
  }
  const [first_day, last_day] = await Promise.all([edge(true), edge(false)])
  return { first_day, last_day }
}

// ---------------------------------------------------------------------------------------------
// Overview

export interface SocialRecommendation {
  title: string
  why: string
  evidence: string
}

export interface RankingRow {
  dimension: 'format' | 'theme' | 'weekday' | 'slot'
  /** Null for a format bucket of a post Meta sent without `media_type` (the screen calls it Outro). */
  bucket: string | null
  posts: number
  rate: number | null
}

export const FUNNEL_SERIES = [
  'profile_views',
  'website_clicks',
  'ig_site_sessions',
  'store_clicks',
  'installs_ios',
  'installs_android',
] as const
export type FunnelSeries = (typeof FUNNEL_SERIES)[number]

export interface FunnelPost {
  format: FormatKey
  caption: string | null
}

export type FunnelDay = { day: string; posts: FunnelPost[] } & Record<FunnelSeries, number | null>

export type FunnelTotals = Record<FunnelSeries | 'posts', number | null>

/** Days of the window with a value, per series; `installs` counts a day with iOS or Android. */
export type FunnelMeasured = Record<FunnelSeries | 'installs', number>

/**
 * The row of four (#1061, R1.1), from `social.overview_indicators`: every number is the database's.
 * `followers_since` is the day the 7-day delta starts to exist, when it does not yet.
 */
export interface OverviewIndicators {
  followers: number | null
  followers_7d_delta: number | null
  followers_since: string | null
  reach_sum: number | null
  reach_posts: number
  engagement_median: number | null
  engagement_posts: number
}

/** One campaign token of the period (#1062, R2.3), from `social.campaign_totals`. */
export interface CampaignRow {
  campaign: string
  clicks_app_store: number
  clicks_play_store: number
  /** Null while the Apple report does not cover the period (never 0 for "unknown"). */
  downloads_ios: number | null
}

export interface AudienceItem {
  label: string
  count: number
  /** `follower_count / followers` of the database; null without the day's followers. */
  share: number | null
}

/** The latest weekly `follower_demographics` snapshot (#1062, R2.5). */
export interface AudienceSnapshot {
  day: string
  followers: number | null
  city: AudienceItem[]
  country: AudienceItem[]
  age: AudienceItem[]
  gender: AudienceItem[]
}

/** The five largest cities and countries; age and gender come whole (spec R2.5). */
export const AUDIENCE_TOP = 5
/** Under this, Meta does not answer `follower_demographics` (User Insights reference, v26.0). */
export const AUDIENCE_MIN_FOLLOWERS = 100

/**
 * One day of the account's growth (#1063, spec G8). `total` is the followers at the end of the day,
 * rebuilt from `account_daily` and the day's moves; `follows`, `unfollows` and `net` are Meta's
 * `follows_and_unfollows`, null when not measured (never 0, DS-COMPONENTE-084). `posts` is always a
 * count: `social.media` keeps every post of our account.
 */
export interface GrowthDay {
  day: string
  total: number | null
  follows: number | null
  unfollows: number | null
  net: number | null
  posts: number
}

/** The whole history, not the period: `days` empty until the first day with follows and unfollows. */
export interface AccountGrowth {
  from: string
  to: string
  days: GrowthDay[]
  /** Days of the series with a measured net, for the floor of the net total (spec G4). */
  measured: { net: number }
}

/** `GET /api/admin/social/growth?account=` (#1064, spec M8 item 2): the chart of any active account. */
export type AccountGrowthPayload = AccountGrowth & {
  kind: 'own' | 'competitor'
  account: { id: string; username: string }
}

export interface OverviewPayload {
  today: string
  period: SocialPeriod
  collection: { first_day: string | null; last_day: string | null }
  indicators: OverviewIndicators
  campaigns: CampaignRow[]
  /**
   * False while GA4 refuses `customEvent:store` (the collector's daily run says so): the clicks by
   * store are unknown, not zero.
   */
  clicks_by_store: boolean
  apple: { configured: boolean; first_day: string | null }
  audience: AudienceSnapshot | null
  audience_reason: 'below_100' | 'not_collected' | null
  recommendations: {
    week_start: string
    model: string | null
    items: SocialRecommendation[]
  } | null
  ranking: { since: string; rows: RankingRow[] }
  funnel: {
    from: string
    to: string
    days: FunnelDay[]
    totals: FunnelTotals
    previous: FunnelTotals
    /** Coverage of each series in the window and in the previous one (DS-COMPONENTE-084). */
    measured: FunnelMeasured
    previous_measured: FunnelMeasured
  }
  growth: AccountGrowth
}

export interface CollectorRun {
  job: 'daily' | 'stories' | 'audience' | 'apple'
  last_run_at: string
  status: 'ok' | 'error' | 'not_configured'
  detail: string | null
  covered_from: string | null
}

async function collectorRuns(supabase: Client): Promise<Map<string, CollectorRun>> {
  const rows =
    check<CollectorRun[] | null>(
      'collector_runs',
      await social(supabase).from('collector_runs').select('job, last_run_at, status, detail, covered_from')
    ) ?? []
  return new Map(rows.map((r) => [r.job, r]))
}

/** Whether the last daily run read the clicks by store: its detail says `no_store_dimension` otherwise. */
export function clicksByStore(daily: CollectorRun | undefined): boolean {
  return !(daily?.detail ?? '').includes('"store_clicks":"no_store_dimension"')
}

/** `social.latest_audience` rows grouped by breakdown; cities and countries cut to the top five. */
export function groupAudience(rows: Array<Record<string, unknown>>): AudienceSnapshot | null {
  if (rows.length === 0) return null
  const of = (b: string, top?: number) => {
    const list = rows
      .filter((r) => r.breakdown === b)
      .map((r) => ({
        label: String(r.label),
        count: num(r.follower_count) ?? 0,
        share: num(r.share),
      }))
    return top ? list.slice(0, top) : list
  }
  return {
    day: String(rows[0].week_start),
    followers: num(rows[0].followers),
    city: of('city', AUDIENCE_TOP),
    country: of('country', AUDIENCE_TOP),
    age: of('age'),
    gender: of('gender'),
  }
}

/** The window of a period: `days` whole days ending yesterday, and the same length right before. */
export function periodWindow(today: string, period: SocialPeriod) {
  const days = SOCIAL_PERIODS[period]
  const to = addDays(today, -1)
  const from = addDays(today, -days)
  return {
    from,
    to,
    prevFrom: addDays(from, -days),
    prevTo: addDays(from, -1),
  }
}

function firstLine(caption: unknown): string | null {
  if (typeof caption !== 'string') return null
  const line = caption
    .split('\n')
    .find((l) => l.trim().length > 0)
    ?.trim()
  return line ? line.slice(0, 120) : null
}

/** The sum of a series over a set of days; null when no day of it has a value (never zero). */
export function sumSeries(days: Array<Record<string, unknown>>, key: string): number | null {
  let total: number | null = null
  for (const d of days) {
    const v = num(d[key])
    if (v !== null) total = (total ?? 0) + v
  }
  return total
}

/** How many days of a window carry a value, per series (a null day was not measured). */
export function measuredDays(days: FunnelDay[]): FunnelMeasured {
  const m = { installs: 0 } as FunnelMeasured
  for (const k of FUNNEL_SERIES) m[k] = days.filter((d) => d[k] !== null).length
  m.installs = days.filter((d) => d.installs_ios !== null || d.installs_android !== null).length
  return m
}

/**
 * The growth series (#1063). The axis runs from the first day with a total or a net to yesterday.
 * The total walks back from the newest reading: total(d - 1) = total(d) - net(d). A reading of
 * `account_daily` is real and wins over the walk; the reading of day D is taken by the 6h run, so
 * it stands for the end of D - 1. A null net stops the walk before it: the days before have no
 * total until the next older reading. No net at all is an empty series, never a row of zeros.
 */
export function buildGrowth(input: {
  today: string
  moves: Array<Record<string, unknown>>
  readings: Array<Record<string, unknown>>
  postsOn: (day: string) => number
}): AccountGrowth {
  const to = addDays(input.today, -1)
  const moves = new Map<string, { follows: number; unfollows: number }>()
  for (const r of input.moves) {
    const follows = num(r.follows)
    const unfollows = num(r.unfollows)
    if (follows !== null && unfollows !== null && String(r.day) <= to) moves.set(String(r.day), { follows, unfollows })
  }
  const anchors = new Map<string, number>()
  for (const r of input.readings) {
    const v = num(r.followers_count)
    const day = addDays(String(r.day), -1)
    if (v !== null && day <= to) anchors.set(day, v)
  }
  if (moves.size === 0) return { from: to, to, days: [], measured: { net: 0 } }
  const from = [...moves.keys(), ...anchors.keys()].sort()[0]
  const days: GrowthDay[] = daysBetween(from, to).map((day) => {
    const m = moves.get(day)
    return {
      day,
      total: null,
      follows: m?.follows ?? null,
      unfollows: m?.unfollows ?? null,
      net: m ? m.follows - m.unfollows : null,
      posts: input.postsOn(day),
    }
  })
  for (let i = days.length - 1; i >= 0; i--) {
    const anchor = anchors.get(days[i].day)
    const next = days[i + 1]
    days[i].total = anchor ?? (next && next.total !== null && next.net !== null ? next.total - next.net : null)
  }
  return {
    from,
    to,
    days,
    measured: { net: days.filter((d) => d.net !== null).length },
  }
}

/**
 * The growth of a competitor (#1064, spec M2 and M8 item 2). Meta gives a third party only the
 * followers of the moment, so `total` is the `followers_count` of each `account_daily` day, `net` is
 * the difference to the day before (null when one of the two is missing), and gains and losses are
 * always null. The axis runs from the first day with a total to the last day collected: nothing is
 * drawn before the collection kept a number (spec G4).
 */
export function buildCompetitorGrowth(input: {
  today: string
  readings: Array<Record<string, unknown>>
  postsOn: (day: string) => number
}): AccountGrowth {
  const totals = new Map<string, number>()
  let to: string | null = null
  for (const r of input.readings) {
    const day = String(r.day)
    if (day > input.today) continue
    const v = num(r.followers_count)
    if (v !== null) totals.set(day, v)
    if (to === null || day > to) to = day
  }
  if (totals.size === 0 || to === null)
    return {
      from: input.today,
      to: input.today,
      days: [],
      measured: { net: 0 },
    }
  const from = [...totals.keys()].sort()[0]
  const days: GrowthDay[] = daysBetween(from, to).map((day) => {
    const total = totals.get(day) ?? null
    const before = totals.get(addDays(day, -1)) ?? null
    return {
      day,
      total,
      follows: null,
      unfollows: null,
      net: total !== null && before !== null ? total - before : null,
      posts: input.postsOn(day),
    }
  })
  return {
    from,
    to,
    days,
    measured: { net: days.filter((d) => d.net !== null).length },
  }
}

/**
 * The growth chart of one active account (#1064, M8 item 2), or null when the id is not an active
 * account (404). Ours is `buildGrowth` over the same three reads as the overview, so the two charts
 * draw the same series; a competitor is `buildCompetitorGrowth`.
 */
export async function readAccountGrowth(
  supabase: Client,
  id: string,
  now = new Date()
): Promise<AccountGrowthPayload | null> {
  const today = brasiliaDay(now)
  const account = check<{
    id: string
    username: string
    is_own: boolean
    active: boolean
  } | null>(
    'growth_account',
    await social(supabase).from('watched_accounts').select('id, username, is_own, active').eq('id', id).maybeSingle()
  )
  if (!account || !account.active) return null
  const head = { account: { id: account.id, username: account.username } }
  const readings =
    check<Array<Record<string, unknown>> | null>(
      'growth_readings',
      await social(supabase)
        .from('account_daily')
        .select('day, followers_count')
        .eq('account_id', account.id)
        .order('day')
    ) ?? []
  if (account.is_own) {
    const [moves, media] = await Promise.all([
      social(supabase).from('funnel_daily').select('day, follows, unfollows').not('follows', 'is', null).order('day'),
      social(supabase).from('media').select('posted_at').eq('account_id', account.id).order('posted_at'),
    ])
    const growth = buildGrowth({
      today,
      moves: check<Array<Record<string, unknown>> | null>('growth_moves', moves) ?? [],
      readings,
      postsOn: postsPerDay(check<Array<Record<string, unknown>> | null>('growth_media', media) ?? []),
    })
    return { ...growth, kind: 'own', ...head }
  }
  const first = readings.find((r) => num(r.followers_count) !== null)
  const media = first
    ? await allRows('growth_media', (from, to) =>
        social(supabase)
          .from('media')
          .select('id, posted_at')
          .eq('account_id', account.id)
          .gte('posted_at', brasiliaMidnightIso(String(first.day)))
          .order('id')
          .range(from, to)
      )
    : []
  return {
    ...buildCompetitorGrowth({ today, readings, postsOn: postsPerDay(media) }),
    kind: 'competitor',
    ...head,
  }
}

export async function readOverview(supabase: Client, period: SocialPeriod, now = new Date()): Promise<OverviewPayload> {
  const today = brasiliaDay(now)
  const { from, to, prevFrom, prevTo } = periodWindow(today, period)
  const own = await ownAccount(supabase)

  const [
    collection,
    weekly,
    ranking,
    funnelRows,
    mediaRows,
    indicatorRows,
    campaignRows,
    runs,
    audienceRows,
    moveRows,
    readingRows,
  ] = await Promise.all([
    collectionDays(supabase, own),
    social(supabase)
      .from('weekly_insights')
      .select('week_start, recommendations, model')
      .order('week_start', { ascending: false })
      .limit(1),
    social(supabase).rpc('own_media_ranking', {
      p_since: brasiliaMidnightIso(from),
    }),
    social(supabase)
      .from('funnel_daily')
      .select(`day, ${FUNNEL_SERIES.join(', ')}`)
      .gte('day', prevFrom)
      .lte('day', to)
      .order('day'),
    // The whole history of our posts: the funnel reads its two windows, the growth chart every day.
    own
      ? social(supabase)
          .from('media')
          .select('media_type, media_product_type, caption, posted_at')
          .eq('account_id', own.id)
          .order('posted_at')
      : Promise.resolve({ data: [], error: null }),
    social(supabase).rpc('overview_indicators', {
      p_since: brasiliaMidnightIso(from),
    }),
    social(supabase).rpc('campaign_totals', { p_from: from, p_to: to }),
    collectorRuns(supabase),
    social(supabase).rpc('latest_audience'),
    social(supabase).from('funnel_daily').select('day, follows, unfollows').not('follows', 'is', null).order('day'),
    own
      ? social(supabase).from('account_daily').select('day, followers_count').eq('account_id', own.id).order('day')
      : Promise.resolve({ data: [], error: null }),
  ])
  const ind = (check<Array<Record<string, unknown>> | null>('indicators', indicatorRows) ?? [])[0] ?? {}

  const weeklyRows = check<Array<Record<string, unknown>> | null>('weekly', weekly) ?? []
  const latest = weeklyRows[0]
  const items = Array.isArray(latest?.recommendations)
    ? (latest.recommendations as unknown[])
        .filter((r): r is SocialRecommendation => {
          const o = r as Record<string, unknown>
          return !!o && typeof o.title === 'string' && typeof o.why === 'string' && typeof o.evidence === 'string'
        })
        .slice(0, 3)
    : []

  const rankingRows = (check<Array<Record<string, unknown>> | null>('ranking', ranking) ?? []).map((r) => ({
    dimension: String(r.dimension) as RankingRow['dimension'],
    bucket: r.bucket === null || r.bucket === undefined ? null : String(r.bucket),
    posts: Number(r.posts) || 0,
    rate: num(r.rate),
  }))

  const funnel = check<Array<Record<string, unknown>> | null>('funnel', funnelRows) ?? []
  const media = check<Array<Record<string, unknown>> | null>('funnel_media', mediaRows) ?? []
  const postsByDay = new Map<string, FunnelPost[]>()
  for (const m of media) {
    if (typeof m.posted_at !== 'string') continue
    const day = brasiliaDay(new Date(m.posted_at))
    const list = postsByDay.get(day) ?? []
    list.push({
      format: formatKey((m.media_type as string) ?? null, (m.media_product_type as string) ?? null),
      caption: firstLine(m.caption),
    })
    postsByDay.set(day, list)
  }
  const funnelByDay = new Map(funnel.map((r) => [String(r.day), r]))
  const series = (from_: string, to_: string): FunnelDay[] =>
    daysBetween(from_, to_).map((day) => {
      const r = funnelByDay.get(day) ?? {}
      const row = { day, posts: postsByDay.get(day) ?? [] } as FunnelDay
      for (const k of FUNNEL_SERIES) row[k] = num((r as Record<string, unknown>)[k])
      return row
    })
  const totals = (days: FunnelDay[]): FunnelTotals => {
    const t = {
      posts: days.reduce((n, d) => n + d.posts.length, 0),
    } as FunnelTotals
    for (const k of FUNNEL_SERIES) t[k] = sumSeries(days, k)
    return t
  }
  const days = series(from, to)
  const previousDays = series(prevFrom, prevTo)
  const campaigns = (check<Array<Record<string, unknown>> | null>('campaigns', campaignRows) ?? []).map((r) => ({
    campaign: String(r.campaign),
    clicks_app_store: num(r.clicks_app_store) ?? 0,
    clicks_play_store: num(r.clicks_play_store) ?? 0,
    downloads_ios: num(r.downloads_ios),
  }))
  const apple = runs.get('apple')
  const audience = groupAudience(check<Array<Record<string, unknown>> | null>('audience', audienceRows) ?? [])
  const followers = num(ind.followers)
  const growth = buildGrowth({
    today,
    moves: check<Array<Record<string, unknown>> | null>('growth_moves', moveRows) ?? [],
    readings: check<Array<Record<string, unknown>> | null>('growth_readings', readingRows) ?? [],
    postsOn: (day) => postsByDay.get(day)?.length ?? 0,
  })

  return {
    today,
    period,
    collection,
    indicators: {
      followers: num(ind.followers),
      followers_7d_delta: num(ind.followers_7d_delta),
      followers_since:
        num(ind.followers_7d_delta) === null && collection.first_day ? addDays(collection.first_day, 7) : null,
      reach_sum: num(ind.reach_sum),
      reach_posts: num(ind.reach_posts) ?? 0,
      engagement_median: num(ind.engagement_median),
      engagement_posts: num(ind.engagement_posts) ?? 0,
    },
    campaigns,
    clicks_by_store: clicksByStore(runs.get('daily')),
    apple: {
      configured: !!apple && apple.status !== 'not_configured',
      first_day: apple?.status === 'ok' ? (apple.covered_from ?? null) : null,
    },
    audience,
    audience_reason: audience
      ? null
      : followers !== null && followers < AUDIENCE_MIN_FOLLOWERS
        ? 'below_100'
        : 'not_collected',
    recommendations: latest
      ? {
          week_start: String(latest.week_start),
          model: (latest.model as string) ?? null,
          items,
        }
      : null,
    ranking: { since: from, rows: rankingRows },
    funnel: {
      from,
      to,
      days,
      totals: totals(days),
      previous: totals(previousDays),
      measured: measuredDays(days),
      previous_measured: measuredDays(previousDays),
    },
    growth,
  }
}

// ---------------------------------------------------------------------------------------------
// Our posts

export const POST_METRICS = [
  'reach',
  'likes',
  'comments',
  'saved',
  'shares',
  'profile_visits',
  'follows',
  'views',
] as const
/** Reel watch time, kept in milliseconds by the collector and served in whole seconds (#1062, R2.4). */
export const WATCH_METRICS = [
  ['reels_avg_watch_time_s', 'reels_avg_watch_time_ms'],
  ['reels_total_watch_time_s', 'reels_total_watch_time_ms'],
] as const
export type PostMetric = (typeof POST_METRICS)[number] | (typeof WATCH_METRICS)[number][0]

/** Milliseconds to whole seconds; null stays null. */
export const msToSeconds = (ms: number | null): number | null => (ms === null ? null : Math.round(ms / 1000))

export interface SocialPostRow {
  id: string
  posted_at: string | null
  caption: string | null
  media_type: string | null
  media_product_type: string | null
  theme: string | null
  permalink: string | null
  metrics: Record<PostMetric, number | null> | null
}

/** Our posts, newest first, each with the LAST `media_metrics` row (a snapshot, not a sum). */
export interface PostsPayload {
  collection: { first_day: string | null; last_day: string | null }
  posts: SocialPostRow[]
}

export async function readPosts(supabase: Client): Promise<PostsPayload> {
  const own = await ownAccount(supabase)
  if (!own) return { collection: { first_day: null, last_day: null }, posts: [] }
  const [collection, result] = await Promise.all([
    collectionDays(supabase, own),
    social(supabase)
      .from('media')
      .select(
        `id, posted_at, caption, media_type, media_product_type, theme, permalink, media_metrics(day, ${[
          ...POST_METRICS,
          ...WATCH_METRICS.map(([, ms]) => ms),
        ].join(', ')})`
      )
      .eq('account_id', own.id)
      .order('posted_at', { ascending: false })
      .order('day', { referencedTable: 'media_metrics', ascending: false })
      .limit(1, { referencedTable: 'media_metrics' }),
  ])
  const rows = check<Array<Record<string, unknown>> | null>('posts', result) ?? []
  return {
    collection,
    posts: rows.map((r) => {
      const m = Array.isArray(r.media_metrics) ? (r.media_metrics[0] as Record<string, unknown> | undefined) : undefined
      const metrics = m
        ? (Object.fromEntries([
            ...POST_METRICS.map((k) => [k, num(m[k])]),
            ...WATCH_METRICS.map(([s, ms]) => [s, msToSeconds(num(m[ms]))]),
          ]) as Record<PostMetric, number | null>)
        : null
      return {
        id: String(r.id),
        posted_at: (r.posted_at as string) ?? null,
        caption: (r.caption as string) ?? null,
        media_type: (r.media_type as string) ?? null,
        media_product_type: (r.media_product_type as string) ?? null,
        theme: (r.theme as string) ?? null,
        permalink: (r.permalink as string) ?? null,
        metrics,
      }
    }),
  }
}

// ---------------------------------------------------------------------------------------------
// The competitors' best posts of a week (#1062, R2.1)

export interface CompetitorPostRow {
  username: string
  posted_at: string | null
  permalink: string | null
  media_type: string | null
  media_product_type: string | null
  theme: string
  caption_first_line: string | null
  hashtags: string[]
  likes: number | null
  comments: number | null
  followers_on_day: number | null
  rate: number | null
  /** #1064 M8 item 4: the seal, the account's median over every collected post, and how many. */
  outlier: boolean
  account_median: number | null
  account_posts: number
}

export interface OutlierRule {
  factor: number
  min_posts: number
}

export interface CompetitorPostsPayload {
  today: string
  week_start: string
  week_end: string
  /** The week is still running: the numbers are until today. */
  partial: boolean
  /** The four closed weeks, newest first, then the current one (the order of the select). */
  weeks: string[]
  /** Active competitors: with none the card does not show. */
  tracked: number
  rows: CompetitorPostRow[]
  outlier_rule: OutlierRule
}

/** How many closed weeks the select offers, before the current one (spec R2.1). */
export const COMPETITOR_WEEKS = 4

/** The closed weeks newest first, then the running one; the default is the first (the last closed). */
export function competitorWeeks(today: string): string[] {
  const current = mondayOf(today)
  return [...Array.from({ length: COMPETITOR_WEEKS }, (_, i) => addDays(current, -7 * (i + 1))), current]
}

/**
 * One competitor post with its interactions per follower (#1064): the ruler of
 * `social.competitor_top_posts`, the last `media_metrics` row, likes plus comments over the non-null
 * `followers_count` of the `account_daily` day closest to the post day in Brasília (the earlier wins a
 * tie). A post with both counters null is not a post of the ruler; no followers, or 0, is a null rate.
 */
export interface CompetitorPostRate {
  id: string
  account_id: string
  posted_at: string
  /** The `RankingRow` encoding: `REELS`, `IMAGE`, `CAROUSEL_ALBUM`, or null for anything else. */
  format: string | null
  theme: string
  /** ISO weekday in Brasília, 1 = Monday. */
  weekday: number
  rate: number | null
}

/** A calendar day as a whole number of days, to measure gaps without walking them. */
const dayNumber = (day: string): number => Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000)

const FORMAT_BUCKET: Record<FormatKey, string | null> = {
  image: 'IMAGE',
  carousel: 'CAROUSEL_ALBUM',
  reels: 'REELS',
  other: null,
}

/** The pure half of `competitorPostRates`, over the rows PostgREST answered. */
export function rateCompetitorPosts(
  media: Array<Record<string, unknown>>,
  daily: Array<Record<string, unknown>>
): CompetitorPostRate[] {
  const followers = new Map<string, Array<{ day: string; n: number }>>()
  for (const d of daily) {
    const n = num(d.followers_count)
    if (n === null) continue
    const list = followers.get(String(d.account_id)) ?? []
    list.push({ day: String(d.day), n })
    followers.set(String(d.account_id), list)
  }
  const closest = (accountId: string, day: string): number | null => {
    let best: { gap: number; day: string; n: number } | null = null
    for (const f of followers.get(accountId) ?? []) {
      const gap = Math.abs(dayNumber(f.day) - dayNumber(day))
      if (!best || gap < best.gap || (gap === best.gap && f.day < best.day)) best = { gap, day: f.day, n: f.n }
    }
    return best ? best.n : null
  }
  const out: CompetitorPostRate[] = []
  for (const m of media) {
    if (typeof m.posted_at !== 'string') continue
    const metrics = Array.isArray(m.media_metrics)
      ? (m.media_metrics[0] as Record<string, unknown> | undefined)
      : undefined
    const likes = num(metrics?.likes)
    const comments = num(metrics?.comments)
    if (likes === null && comments === null) continue
    const day = brasiliaDay(new Date(m.posted_at))
    const base = closest(String(m.account_id), day)
    out.push({
      id: String(m.id),
      account_id: String(m.account_id),
      posted_at: m.posted_at,
      format: FORMAT_BUCKET[formatKey((m.media_type as string) ?? null, (m.media_product_type as string) ?? null)],
      theme: typeof m.theme === 'string' ? m.theme : 'pending',
      weekday: isoWeekday(day),
      rate: base ? ((likes ?? 0) + (comments ?? 0)) / base : null,
    })
  }
  return out
}

/** Every post of these accounts (since `sinceIso`, when given) with its rate, paged past 1000 rows. */
export async function competitorPostRates(
  supabase: Client,
  accountIds: string[],
  sinceIso: string | null
): Promise<CompetitorPostRate[]> {
  if (accountIds.length === 0) return []
  const [media, daily] = await Promise.all([
    allRows('rates_media', (from, to) => {
      let q = social(supabase)
        .from('media')
        .select('id, account_id, posted_at, media_type, media_product_type, theme, media_metrics(day, likes, comments)')
        .in('account_id', accountIds)
        .not('posted_at', 'is', null)
      if (sinceIso) q = q.gte('posted_at', sinceIso)
      return q
        .order('id')
        .order('day', { referencedTable: 'media_metrics', ascending: false })
        .limit(1, { referencedTable: 'media_metrics' })
        .range(from, to)
    }),
    allRows('rates_daily', (from, to) =>
      social(supabase)
        .from('account_daily')
        .select('account_id, day, followers_count')
        .in('account_id', accountIds)
        .not('followers_count', 'is', null)
        .order('account_id')
        .order('day')
        .range(from, to)
    ),
  ])
  return rateCompetitorPosts(media, daily)
}

/** The seal (#1064): above `OUTLIER_FACTOR` times the account's median, with `OUTLIER_MIN_POSTS` posts. */
export function isOutlier(rate: number | null, accountMedian: number | null, accountPosts: number): boolean {
  if (rate === null || accountMedian === null || accountPosts < OUTLIER_MIN_POSTS) return false
  return rate > OUTLIER_FACTOR * accountMedian
}

export async function readCompetitorPosts(
  supabase: Client,
  week: string | null,
  now = new Date()
): Promise<CompetitorPostsPayload | null> {
  const today = brasiliaDay(now)
  const weeks = competitorWeeks(today)
  const weekStart = week ?? weeks[0]
  if (!weeks.includes(weekStart)) return null
  const [tracked, rows] = await Promise.all([
    social(supabase).from('watched_accounts').select('id, username').eq('active', true).eq('is_own', false),
    social(supabase).rpc('competitor_top_posts', { p_week_start: weekStart }),
  ])
  const trackedRows = check<Array<{ id: string; username: string }> | null>('competitor_count', tracked) ?? []
  const topRows = check<Array<Record<string, unknown>> | null>('competitor_posts', rows) ?? []
  // The account medians run only when the week has a post to seal: every post of every competitor.
  const rated =
    topRows.length > 0
      ? await competitorPostRates(
          supabase,
          trackedRows.map((a) => a.id),
          null
        )
      : []
  const byAccount = new Map<string, number[]>()
  for (const p of rated) {
    if (p.rate === null) continue
    const list = byAccount.get(p.account_id) ?? []
    list.push(p.rate)
    byAccount.set(p.account_id, list)
  }
  const idOf = new Map(trackedRows.map((a) => [a.username, a.id]))
  return {
    today,
    week_start: weekStart,
    week_end: addDays(weekStart, 6),
    partial: weekStart === mondayOf(today),
    weeks,
    tracked: trackedRows.length,
    outlier_rule: { factor: OUTLIER_FACTOR, min_posts: OUTLIER_MIN_POSTS },
    rows: topRows.map((r) => {
      const rates = byAccount.get(idOf.get(String(r.username)) ?? '') ?? []
      const accountMedian = median(rates)
      return {
        username: String(r.username),
        posted_at: (r.posted_at as string) ?? null,
        permalink: (r.permalink as string) ?? null,
        media_type: (r.media_type as string) ?? null,
        media_product_type: (r.media_product_type as string) ?? null,
        theme: typeof r.theme === 'string' ? r.theme : 'pending',
        caption_first_line: (r.caption_first_line as string) ?? null,
        hashtags: Array.isArray(r.hashtags) ? (r.hashtags as unknown[]).map(String) : [],
        likes: num(r.likes),
        comments: num(r.comments),
        followers_on_day: num(r.followers_on_day),
        rate: num(r.rate),
        outlier: isOutlier(num(r.rate), accountMedian, rates.length),
        account_median: accountMedian,
        account_posts: rates.length,
      }
    }),
  }
}

// ---------------------------------------------------------------------------------------------
// What works in each market (#1064, spec M3)

export type MarketDimension = 'format' | 'theme' | 'weekday'
export type MarketReason = 'no_account' | 'no_posts' | 'few_posts' | 'no_followers'

export interface MarketRow {
  dimension: MarketDimension
  bucket: string | null
  market: Market
  posts: number
  rate: number | null
  reason: MarketReason | null
}

export interface MarketsPayload {
  today: string
  window_days: number
  since: string
  markets: Record<Market, { accounts: number }>
  /** Active competitors without a market: out of the comparison. */
  unassigned: number
  rows: MarketRow[]
}

const FORMAT_ORDER: Array<string | null> = ['IMAGE', 'CAROUSEL_ALBUM', 'REELS']

/**
 * The dense matrix of M8 item 3: one row per dimension, group and market, even empty. The order of
 * the groups is fixed (image, carousel, reel and Outro only when a post needs it; `THEME_KEYS`, then a
 * value outside the map, then "pending"; Monday to Sunday). Per group, the median of the rates, with
 * the floor `MIN_POSTS` on the posts of the group; the reason says why a cell has no number.
 */
export function buildMarketRows(
  posts: Array<CompetitorPostRate & { market: Market }>,
  accounts: Record<Market, { accounts: number }>
): MarketRow[] {
  const formats = [...FORMAT_ORDER, ...(posts.some((p) => p.format === null) ? [null] : [])]
  const known = new Set<string>(THEME_KEYS)
  const extra = [...new Set(posts.map((p) => p.theme).filter((t) => !known.has(t) && t !== 'pending'))].sort()
  const themes = [...THEME_KEYS, ...extra, ...(posts.some((p) => p.theme === 'pending') ? ['pending'] : [])]
  const weekdays = ['1', '2', '3', '4', '5', '6', '7']
  const groups: Array<[MarketDimension, Array<string | null>, (p: CompetitorPostRate) => string | null]> = [
    ['format', formats, (p) => p.format],
    ['theme', themes, (p) => p.theme],
    ['weekday', weekdays, (p) => String(p.weekday)],
  ]
  const rows: MarketRow[] = []
  for (const [dimension, buckets, of] of groups) {
    for (const bucket of buckets) {
      for (const market of MARKETS) {
        if (accounts[market].accounts === 0) {
          rows.push({
            dimension,
            bucket,
            market,
            posts: 0,
            rate: null,
            reason: 'no_account',
          })
          continue
        }
        const group = posts.filter((p) => p.market === market && of(p) === bucket)
        const rates = group.map((p) => p.rate).filter((r): r is number => r !== null)
        const reason: MarketReason | null =
          group.length === 0
            ? 'no_posts'
            : group.length < MIN_POSTS
              ? 'few_posts'
              : rates.length === 0
                ? 'no_followers'
                : null
        rows.push({
          dimension,
          bucket,
          market,
          posts: group.length,
          rate: reason ? null : median(rates),
          reason,
        })
      }
    }
  }
  return rows
}

export async function readMarkets(supabase: Client, now = new Date()): Promise<MarketsPayload> {
  const today = brasiliaDay(now)
  const since = addDays(today, -MARKET_WINDOW_DAYS)
  const rows =
    check<Array<{ id: string; market: unknown }> | null>(
      'markets_accounts',
      await social(supabase).from('watched_accounts').select('id, market').eq('active', true).eq('is_own', false)
    ) ?? []
  const marketOf = new Map<string, Market>()
  for (const r of rows) if (isMarket(r.market)) marketOf.set(r.id, r.market)
  const markets = Object.fromEntries(
    MARKETS.map((m) => [m, { accounts: [...marketOf.values()].filter((v) => v === m).length }])
  ) as Record<Market, { accounts: number }>
  const rated = await competitorPostRates(supabase, [...marketOf.keys()], brasiliaMidnightIso(since))
  return {
    today,
    window_days: MARKET_WINDOW_DAYS,
    since,
    markets,
    unassigned: rows.length - marketOf.size,
    rows: buildMarketRows(
      rated.map((p) => ({
        ...p,
        market: marketOf.get(p.account_id) as Market,
      })),
      markets
    ),
  }
}

// ---------------------------------------------------------------------------------------------
// Stories (#1062, R2.6)

export const STORY_METRICS = [
  'reach',
  'views',
  'replies',
  'tap_forward',
  'tap_back',
  'tap_exit',
  'swipe_forward',
] as const
export type StoryMetric = (typeof STORY_METRICS)[number]

export interface StoryRow extends Record<StoryMetric, number | null> {
  id: string
  posted_at: string | null
  media_type: string | null
  permalink: string | null
  collected_at: string | null
  /** `tap_exit / reach` of the database; null with no reach. */
  exit_rate: number | null
}

export interface StoriesPayload {
  /** When the hourly job last ran; null when it never did (no `collector_runs` row). */
  collection: { last_run_at: string | null }
  stories: StoryRow[]
}

export const STORY_DAYS_DEFAULT = 14
export const STORY_DAYS_MAX = 30

export async function readStories(supabase: Client, days: number): Promise<StoriesPayload> {
  const [runs, result] = await Promise.all([
    collectorRuns(supabase),
    social(supabase).rpc('recent_stories', { p_days: days }),
  ])
  return {
    collection: { last_run_at: runs.get('stories')?.last_run_at ?? null },
    stories: (check<Array<Record<string, unknown>> | null>('stories', result) ?? []).map((r) => {
      const row = {
        id: String(r.id),
        posted_at: (r.posted_at as string) ?? null,
        media_type: (r.media_type as string) ?? null,
        permalink: (r.permalink as string) ?? null,
        collected_at: (r.collected_at as string) ?? null,
        exit_rate: num(r.exit_rate),
      } as StoryRow
      for (const k of STORY_METRICS) row[k] = num(r[k])
      return row
    }),
  }
}

// ---------------------------------------------------------------------------------------------
// Accounts

export interface Growth {
  delta: number
  ratio: number | null
}

export interface SocialAccountRow {
  id: string
  username: string
  is_own: boolean
  /** #1064: the market the operator marked; null keeps the account out of the comparison. Never ours. */
  market: Market | null
  followers: number | null
  last_day: string | null
  growth_7d: Growth | null
  growth_30d: Growth | null
  /** The day the 7 and 30-day growth start to exist, when they do not yet. */
  growth_7d_from: string | null
  growth_30d_from: string | null
  engagement: number | null
  /** Posts of the last 30 days per format, and their count. */
  mix: Record<FormatKey, number>
  posts_30d: number
  last_post: string | null
}

const GROWTH_WINDOW_DAYS = 40
const LAST_POST_WINDOW_DAYS = 90

/** Followers now against the latest day at least `span` days before; null without that day. */
export function growthOver(
  series: Array<{ day: string; followers_count: number | null }>,
  span: number
): Growth | null {
  const known = series.filter((s) => s.followers_count !== null)
  const last = lastOf(known)
  if (!last) return null
  const base = lastOf(known.filter((s) => s.day <= addDays(last.day, -span)))
  if (!base) return null
  const delta = (last.followers_count as number) - (base.followers_count as number)
  return {
    delta,
    ratio: base.followers_count ? delta / (base.followers_count as number) : null,
  }
}

export interface AccountsPayload {
  today: string
  collection: { first_day: string | null; last_day: string | null }
  accounts: SocialAccountRow[]
}

export async function readAccounts(supabase: Client, now = new Date()): Promise<AccountsPayload> {
  const today = brasiliaDay(now)
  const collection = await collectionDays(supabase, await ownAccount(supabase))
  const accounts =
    check<Array<{
      id: string
      username: string
      is_own: boolean
      market: unknown
    }> | null>(
      'accounts',
      await social(supabase).from('watched_accounts').select('id, username, is_own, market').eq('active', true)
    ) ?? []
  if (accounts.length === 0) return { today, collection, accounts: [] }
  const ids = accounts.map((a) => a.id)

  const [daily, media, engagement] = await Promise.all([
    social(supabase)
      .from('account_daily')
      .select('account_id, day, followers_count')
      .in('account_id', ids)
      .gte('day', addDays(today, -GROWTH_WINDOW_DAYS))
      .order('day'),
    social(supabase)
      .from('media')
      .select('account_id, media_type, media_product_type, posted_at')
      .in('account_id', ids)
      .gte('posted_at', brasiliaMidnightIso(addDays(today, -LAST_POST_WINDOW_DAYS))),
    social(supabase).rpc('account_engagement', {
      p_since: brasiliaMidnightIso(addDays(today, -ACCOUNT_WINDOW_DAYS)),
    }),
  ])
  const dailyRows =
    check<Array<{
      account_id: string
      day: string
      followers_count: number | null
    }> | null>('daily', daily) ?? []
  const mediaRows = check<Array<Record<string, unknown>> | null>('accounts_media', media) ?? []
  const rates = new Map(
    (check<Array<Record<string, unknown>> | null>('engagement', engagement) ?? []).map((r) => [
      String(r.account_id),
      num(r.rate),
    ])
  )
  const mixSince = brasiliaMidnightIso(addDays(today, -ACCOUNT_WINDOW_DAYS))

  return {
    today,
    collection,
    accounts: accounts.map((a) => {
      const series = dailyRows.filter((d) => d.account_id === a.id)
      const first = series[0]?.day ?? null
      const last = lastOf(series) ?? null
      const own = mediaRows.filter((m) => m.account_id === a.id && typeof m.posted_at === 'string')
      const recent = own.filter((m) => (m.posted_at as string) >= mixSince)
      const mix: Record<FormatKey, number> = {
        carousel: 0,
        reels: 0,
        image: 0,
        other: 0,
      }
      for (const m of recent)
        mix[formatKey((m.media_type as string) ?? null, (m.media_product_type as string) ?? null)] += 1
      const lastPost = lastOf(own.map((m) => m.posted_at as string).sort()) ?? null
      const growth_7d = growthOver(series, 7)
      const growth_30d = growthOver(series, 30)
      const from = (span: number) => addDays(first ?? today, span)
      return {
        id: a.id,
        username: a.username,
        is_own: a.is_own,
        market: isMarket(a.market) ? a.market : null,
        followers: last?.followers_count ?? null,
        last_day: last?.day ?? null,
        growth_7d,
        growth_30d,
        growth_7d_from: growth_7d ? null : from(7),
        growth_30d_from: growth_30d ? null : from(30),
        engagement: rates.get(a.id) ?? null,
        mix,
        posts_30d: recent.length,
        last_post: lastPost,
      }
    }),
  }
}

// ---------------------------------------------------------------------------------------------
// Adding and removing an account

export type LookupResult =
  | { ok: true; ig_user_id: string | null; followers_count: number | null }
  | { ok: false; reason: 'not_found' | 'meta_error' }

/**
 * Business Discovery through `social-collect` (`{"action":"lookup"}`), with the CMS server's secret
 * key, which the function's gate accepts (`isOwnSecretKey`, `cms_secret_key`). Any answer that is
 * not the documented envelope is `meta_error`: nothing is written on a doubt.
 */
export async function lookupInstagram(username: string): Promise<LookupResult> {
  // supabase-js 2.116 sends an `sb_secret_` key only in `apikey`, never as Bearer, and the function's
  // gate reads `Authorization`: without this header every lookup answered 401 (#1064, 2026-10-30).
  const key = process.env.SUPABASE_SECRET_KEY
  if (!key) return { ok: false, reason: 'meta_error' }
  try {
    const { data, error } = await getSupabaseService().functions.invoke(SOCIAL_COLLECT_FUNCTION, {
      body: { action: 'lookup', username },
      headers: { Authorization: `Bearer ${key}` },
    })
    if (error || !data || typeof data !== 'object') return { ok: false, reason: 'meta_error' }
    const d = data as Record<string, unknown>
    if (d.ok === true) {
      return {
        ok: true,
        ig_user_id: typeof d.ig_user_id === 'string' ? d.ig_user_id : null,
        followers_count: typeof d.followers_count === 'number' ? d.followers_count : null,
      }
    }
    return {
      ok: false,
      reason: d.reason === 'not_found' ? 'not_found' : 'meta_error',
    }
  } catch {
    return { ok: false, reason: 'meta_error' }
  }
}

export type AddAccountOutcome =
  | {
      kind: 'added'
      account: {
        id: string
        username: string
        market: Market | null
        followers: number | null
        reactivated: boolean
      }
    }
  | {
      kind: 'refused'
      status: number
      code: 'invalid' | 'own_account' | 'duplicate' | 'not_found' | 'meta_error'
      id?: string
    }

export async function addAccount(
  supabase: Client,
  username: string,
  market: Market | null = null,
  lookup: (u: string) => Promise<LookupResult> = lookupInstagram
): Promise<AddAccountOutcome> {
  const existing = check<{
    id: string
    is_own: boolean
    active: boolean
  } | null>(
    'add_read',
    await social(supabase).from('watched_accounts').select('id, is_own, active').eq('username', username).maybeSingle()
  )
  if (existing?.is_own) return { kind: 'refused', status: 409, code: 'own_account' }
  if (existing?.active) return { kind: 'refused', status: 409, code: 'duplicate', id: existing.id }

  const found = await lookup(username)
  if (!found.ok) {
    return found.reason === 'not_found'
      ? { kind: 'refused', status: 422, code: 'not_found' }
      : { kind: 'refused', status: 502, code: 'meta_error' }
  }

  const write = existing
    ? social(supabase)
        .from('watched_accounts')
        .update({
          active: true,
          market,
          ...(found.ig_user_id ? { ig_user_id: found.ig_user_id } : {}),
        })
        .eq('id', existing.id)
        .select('id, username, market')
        .single()
    : social(supabase)
        .from('watched_accounts')
        .insert({ username, ig_user_id: found.ig_user_id, market })
        .select('id, username, market')
        .single()
  const result = await write
  if (result.error?.code === '23505') return { kind: 'refused', status: 409, code: 'duplicate' }
  const row = check<{ id: string; username: string; market: unknown }>('add_write', result)
  return {
    kind: 'added',
    account: {
      id: row.id,
      username: row.username,
      market: isMarket(row.market) ? row.market : null,
      followers: found.followers_count,
      reactivated: !!existing,
    },
  }
}

export type SetMarketOutcome =
  | {
      kind: 'saved'
      account: { id: string; username: string; market: Market | null }
    }
  | { kind: 'not_found' }
  | { kind: 'own_account' }

/**
 * Marks the market of an active competitor (#1064, M1). Our own account never gets one (decision of
 * the Tech Lead): the comparison is between competitors, and the route answers 400.
 */
export async function setAccountMarket(supabase: Client, id: string, market: Market | null): Promise<SetMarketOutcome> {
  const existing = check<{
    id: string
    is_own: boolean
    active: boolean
  } | null>(
    'market_read',
    await social(supabase).from('watched_accounts').select('id, is_own, active').eq('id', id).maybeSingle()
  )
  if (!existing || !existing.active) return { kind: 'not_found' }
  if (existing.is_own) return { kind: 'own_account' }
  const row = check<{ id: string; username: string; market: unknown } | null>(
    'market_write',
    await social(supabase)
      .from('watched_accounts')
      .update({ market })
      .eq('id', id)
      .eq('is_own', false)
      .eq('active', true)
      .select('id, username, market')
      .maybeSingle()
  )
  if (!row) return { kind: 'not_found' }
  return {
    kind: 'saved',
    account: {
      id: row.id,
      username: row.username,
      market: isMarket(row.market) ? row.market : null,
    },
  }
}

/** `active = false`, never DELETE: the history stays and comes back when the account is added again. */
export async function deactivateAccount(supabase: Client, id: string): Promise<boolean> {
  const rows = check<Array<{ id: string }> | null>(
    'deactivate',
    await social(supabase)
      .from('watched_accounts')
      .update({ active: false })
      .eq('id', id)
      .eq('is_own', false)
      .eq('active', true)
      .select('id')
  )
  return (rows ?? []).length > 0
}
