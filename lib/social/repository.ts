/**
 * Reads and writes of the CMS social analytics (#1059) on the schema `social`.
 *
 * Every read and the two writes run on the client `withAuth` hands over, bound to the operator's
 * session, so the RLS of `social.*` (`core.is_caller_platform_admin()`) is the second gate after
 * `withAuth`. The only `service_role` use is `lookupInstagram`, which carries our secret key to the
 * Edge Function `social-collect`: the Meta token lives in that function's secrets and never here.
 *
 * The engagement formulas are the database's (`social.own_media_ranking`,
 * `social.account_engagement`); nothing here divides likes by reach or by followers.
 *
 * `supabase-js` never rejects: every `{ error }` is read and thrown as a `SocialDbError`, which the
 * routes answer as 500 with the SQLSTATE in the log and nothing else.
 */

import { NextResponse } from 'next/server'
import { getSupabaseService } from '@/lib/core/supabase-client'
import { ACCOUNT_WINDOW_DAYS } from './constants'
import { formatKey, type FormatKey } from './labels'
import {
  SOCIAL_PERIODS,
  addDays,
  brasiliaDay,
  brasiliaMidnightIso,
  daysBetween,
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
      await social(supabase).from('account_daily').select('day').eq('account_id', own.id).order('day', { ascending }).limit(1)
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

export const FUNNEL_SERIES = ['profile_views', 'website_clicks', 'ig_site_sessions', 'installs_ios', 'installs_android'] as const
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

export interface OverviewPayload {
  today: string
  period: SocialPeriod
  collection: { first_day: string | null; last_day: string | null }
  indicators: OverviewIndicators
  recommendations: { week_start: string; model: string | null; items: SocialRecommendation[] } | null
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
}

/** The window of a period: `days` whole days ending yesterday, and the same length right before. */
export function periodWindow(today: string, period: SocialPeriod) {
  const days = SOCIAL_PERIODS[period]
  const to = addDays(today, -1)
  const from = addDays(today, -days)
  return { from, to, prevFrom: addDays(from, -days), prevTo: addDays(from, -1) }
}

function firstLine(caption: unknown): string | null {
  if (typeof caption !== 'string') return null
  const line = caption.split('\n').find((l) => l.trim().length > 0)?.trim()
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

export async function readOverview(supabase: Client, period: SocialPeriod, now = new Date()): Promise<OverviewPayload> {
  const today = brasiliaDay(now)
  const { from, to, prevFrom, prevTo } = periodWindow(today, period)
  const own = await ownAccount(supabase)

  const [collection, weekly, ranking, funnelRows, mediaRows, indicatorRows] = await Promise.all([
    collectionDays(supabase, own),
    social(supabase)
      .from('weekly_insights')
      .select('week_start, recommendations, model')
      .order('week_start', { ascending: false })
      .limit(1),
    social(supabase).rpc('own_media_ranking', { p_since: brasiliaMidnightIso(from) }),
    social(supabase)
      .from('funnel_daily')
      .select('day, profile_views, website_clicks, ig_site_sessions, installs_ios, installs_android')
      .gte('day', prevFrom)
      .lte('day', to)
      .order('day'),
    own
      ? social(supabase)
          .from('media')
          .select('media_type, media_product_type, caption, posted_at')
          .eq('account_id', own.id)
          .gte('posted_at', brasiliaMidnightIso(prevFrom))
          .order('posted_at')
      : Promise.resolve({ data: [], error: null }),
    social(supabase).rpc('overview_indicators', { p_since: brasiliaMidnightIso(from) }),
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
    list.push({ format: formatKey((m.media_type as string) ?? null, (m.media_product_type as string) ?? null), caption: firstLine(m.caption) })
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
    const t = { posts: days.reduce((n, d) => n + d.posts.length, 0) } as FunnelTotals
    for (const k of FUNNEL_SERIES) t[k] = sumSeries(days, k)
    return t
  }
  const days = series(from, to)
  const previousDays = series(prevFrom, prevTo)

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
    recommendations: latest
      ? { week_start: String(latest.week_start), model: (latest.model as string) ?? null, items }
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
  }
}

// ---------------------------------------------------------------------------------------------
// Our posts

export const POST_METRICS = ['reach', 'likes', 'comments', 'saved', 'shares', 'profile_visits', 'follows'] as const
export type PostMetric = (typeof POST_METRICS)[number]

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
        `id, posted_at, caption, media_type, media_product_type, theme, permalink, media_metrics(day, ${POST_METRICS.join(', ')})`
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
        ? (Object.fromEntries(POST_METRICS.map((k) => [k, num(m[k])])) as Record<PostMetric, number | null>)
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
// Accounts

export interface Growth {
  delta: number
  ratio: number | null
}

export interface SocialAccountRow {
  id: string
  username: string
  is_own: boolean
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
export function growthOver(series: Array<{ day: string; followers_count: number | null }>, span: number): Growth | null {
  const known = series.filter((s) => s.followers_count !== null)
  const last = lastOf(known)
  if (!last) return null
  const base = lastOf(known.filter((s) => s.day <= addDays(last.day, -span)))
  if (!base) return null
  const delta = (last.followers_count as number) - (base.followers_count as number)
  return { delta, ratio: base.followers_count ? delta / (base.followers_count as number) : null }
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
    check<Array<{ id: string; username: string; is_own: boolean }> | null>(
      'accounts',
      await social(supabase).from('watched_accounts').select('id, username, is_own').eq('active', true)
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
    social(supabase).rpc('account_engagement', { p_since: brasiliaMidnightIso(addDays(today, -ACCOUNT_WINDOW_DAYS)) }),
  ])
  const dailyRows = check<Array<{ account_id: string; day: string; followers_count: number | null }> | null>('daily', daily) ?? []
  const mediaRows = check<Array<Record<string, unknown>> | null>('accounts_media', media) ?? []
  const rates = new Map(
    (check<Array<Record<string, unknown>> | null>('engagement', engagement) ?? []).map((r) => [String(r.account_id), num(r.rate)])
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
      const mix: Record<FormatKey, number> = { carousel: 0, reels: 0, image: 0, other: 0 }
      for (const m of recent) mix[formatKey((m.media_type as string) ?? null, (m.media_product_type as string) ?? null)] += 1
      const lastPost = lastOf(own.map((m) => m.posted_at as string).sort()) ?? null
      const growth_7d = growthOver(series, 7)
      const growth_30d = growthOver(series, 30)
      const from = (span: number) => addDays(first ?? today, span)
      return {
        id: a.id,
        username: a.username,
        is_own: a.is_own,
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
  try {
    const { data, error } = await getSupabaseService().functions.invoke(SOCIAL_COLLECT_FUNCTION, {
      body: { action: 'lookup', username },
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
    return { ok: false, reason: d.reason === 'not_found' ? 'not_found' : 'meta_error' }
  } catch {
    return { ok: false, reason: 'meta_error' }
  }
}

export type AddAccountOutcome =
  | { kind: 'added'; account: { id: string; username: string; followers: number | null; reactivated: boolean } }
  | { kind: 'refused'; status: number; code: 'invalid' | 'own_account' | 'duplicate' | 'not_found' | 'meta_error'; id?: string }

export async function addAccount(
  supabase: Client,
  username: string,
  lookup: (u: string) => Promise<LookupResult> = lookupInstagram
): Promise<AddAccountOutcome> {
  const existing = check<{ id: string; is_own: boolean; active: boolean } | null>(
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
        .update({ active: true, ...(found.ig_user_id ? { ig_user_id: found.ig_user_id } : {}) })
        .eq('id', existing.id)
        .select('id, username')
        .single()
    : social(supabase)
        .from('watched_accounts')
        .insert({ username, ig_user_id: found.ig_user_id })
        .select('id, username')
        .single()
  const result = await write
  if (result.error?.code === '23505') return { kind: 'refused', status: 409, code: 'duplicate' }
  const row = check<{ id: string; username: string }>('add_write', result)
  return {
    kind: 'added',
    account: { id: row.id, username: row.username, followers: found.followers_count, reactivated: !!existing },
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
