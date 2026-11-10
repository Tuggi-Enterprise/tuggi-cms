/**
 * The arithmetic of the acquisition funnel of the Acquisition page (#1171), in plain TS so it is
 * testable without mounting. The data is `social.acquisition_funnel(p_month)` (contract banco-para-cms
 * Parte 28); the "entered" of each store is `core.dashboard_acquisition` `platforms`.
 *
 * What this module exists to keep true (DS-COMPONENTE-084):
 *
 *   item 1  a source with no collector, or one that starts after the month, prints UNKNOWN_VALUE and
 *           never 0; a source that covers part of the month prints its number as a floor. Coverage
 *           has three states (`MeteringCoverage`), one per source, said once per card.
 *   item 2  a rate only between steps of the same store, which come from one report with one
 *           window. The base is the first step the store measures: impressions on the App Store (its
 *           "Conversion Rate"), page views on Google Play, which has no impressions. A zero or unknown
 *           base prints no rate. No rate crosses sources: GA4 installs and "entered" are hollow.
 */

import type { MeteringCoverage } from '@/lib/ranking/metering'
import { rateOf, readStepFunnel, type StepFunnelView, type StepInput, type StepReason } from '@/lib/conversion/funnel'

export type FunnelSource = 'apple_store' | 'play' | 'site_channels' | 'search_console' | 'ga4'
export const FUNNEL_SOURCES: FunnelSource[] = ['apple_store', 'play', 'site_channels', 'search_console', 'ga4']

export type StoreKey = 'app_store' | 'play_store'
export const STORES: StoreKey[] = ['app_store', 'play_store']

/** The collector job that answers for each store (contract Parte 28). */
export const STORE_JOB: Record<StoreKey, FunnelSource> = { app_store: 'apple_store', play_store: 'play' }

export type StoreSource = 'store_search' | 'store_browse' | 'web_referrer' | 'app_referrer' | 'third_party' | 'other'

/** The sources each store classifies, in the store's order. A source the store does not have is not a row. */
export const STORE_SOURCES: Record<StoreKey, StoreSource[]> = {
  app_store: ['store_search', 'store_browse', 'web_referrer', 'app_referrer', 'other'],
  play_store: ['store_search', 'store_browse', 'third_party', 'other'],
}

export interface FunnelStoreRow {
  store: StoreKey
  source: StoreSource
  impressions: number | null
  pageViews: number | null
  downloads: number | null
}

export interface FunnelInstalls {
  installsGa4: number | null
  installsStore: number | null
  uninstalls: number | null
}

export interface FunnelSiteRow {
  channel: string
  sessions: number | null
  /** The sum of each day's users: not unique people in the month (GA4 does not add up). */
  users: number | null
  clicksAppStore: number | null
  clicksPlayStore: number | null
}

export interface FunnelTerm {
  store: StoreKey
  term: string
  pageViews: number | null
  downloads: number | null
}

export interface FunnelQuery {
  query: string
  clicks: number | null
  impressions: number | null
  /** Mean position weighted by impressions, as Search Console computes it. */
  position: number | null
}

export interface AcquisitionFunnel {
  /** First day each source covers, `YYYY-MM-DD`, or `null` with no collector. */
  coverage: Record<FunnelSource, string | null>
  /** Last day with a row up to the end of the month, `YYYY-MM-DD`, or `null` with none. */
  through: Record<FunnelSource, string | null>
  site: FunnelSiteRow[]
  stores: FunnelStoreRow[]
  installs: Record<StoreKey, FunnelInstalls>
  terms: FunnelTerm[]
  queries: FunnelQuery[]
}

/** `null` stays `null`; a number or a numeric string becomes a number; anything else is no value. Zero is a value. */
function nullableNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

const day = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null)
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : [])
const isStore = (v: unknown): v is StoreKey => v === 'app_store' || v === 'play_store'
const NO_INSTALLS: FunnelInstalls = { installsGa4: null, installsStore: null, uninstalls: null }

/**
 * Reads the jsonb of `social.acquisition_funnel`. The one thing this guards is `null`: coercing it to
 * `0` would claim a source measured an empty month.
 */
export function parseAcquisitionFunnel(raw: unknown): AcquisitionFunnel {
  const r = (raw ?? {}) as Record<string, unknown>
  const cov = (r.coverage ?? {}) as Record<string, unknown>
  const thr = (r.through ?? {}) as Record<string, unknown>
  const coverage = {} as Record<FunnelSource, string | null>
  const through = {} as Record<FunnelSource, string | null>
  for (const s of FUNNEL_SOURCES) {
    coverage[s] = day(cov[s])
    through[s] = day(thr[s])
  }
  const installs: Record<StoreKey, FunnelInstalls> = { app_store: NO_INSTALLS, play_store: NO_INSTALLS }
  for (const i of list(r.installs)) {
    if (!isStore(i.store)) continue
    installs[i.store] = {
      installsGa4: nullableNumber(i.installs_ga4),
      installsStore: nullableNumber(i.installs_store),
      uninstalls: nullableNumber(i.uninstalls),
    }
  }
  return {
    coverage,
    through,
    site: list(r.site).map((x) => ({
      channel: typeof x.channel === 'string' ? x.channel : '',
      sessions: nullableNumber(x.sessions),
      users: nullableNumber(x.users),
      clicksAppStore: nullableNumber(x.clicks_app_store),
      clicksPlayStore: nullableNumber(x.clicks_play_store),
    })),
    stores: list(r.stores)
      .filter((x) => isStore(x.store))
      .map((x) => ({
        store: x.store as StoreKey,
        source: (typeof x.source === 'string' ? x.source : 'other') as StoreSource,
        impressions: nullableNumber(x.impressions),
        pageViews: nullableNumber(x.page_views),
        downloads: nullableNumber(x.downloads),
      })),
    installs,
    terms: list(r.terms)
      .filter((x) => isStore(x.store))
      .map((x) => ({
        store: x.store as StoreKey,
        term: typeof x.term === 'string' ? x.term : '',
        pageViews: nullableNumber(x.page_views),
        downloads: nullableNumber(x.downloads),
      })),
    queries: list(r.queries).map((x) => ({
      query: typeof x.query === 'string' ? x.query : '',
      clicks: nullableNumber(x.clicks),
      impressions: nullableNumber(x.impressions),
      position: nullableNumber(x.position),
    })),
  }
}

// ── Coverage ─────────────────────────────────────────────────────────────────────────────────

export interface SourceCoverage {
  state: MeteringCoverage
  /** Why the state is `none`: no collector yet, or one that starts after the month. */
  none: 'not_configured' | 'before_start' | null
  /** `covered_from` when it falls inside the month (partial) or after it (none). */
  from: string | null
  /** The last day with a row when it is before the last day of the month (partial). */
  through: string | null
  /** Covered, with no row up to the end of the month: whatever prints is a floor. */
  noRows: boolean
}

/** First and last day of the month of `month` (any day of it, `YYYY-MM-DD`). */
export function monthBounds(month: string): { first: string; last: string } {
  const y = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const mm = String(m).padStart(2, '0')
  return { first: `${y}-${mm}-01`, last: `${y}-${mm}-${String(last).padStart(2, '0')}` }
}

/**
 * The coverage of one source in the month (DS-COMPONENTE-084 item 1, three states). `full` needs
 * both ends: the source covers from the first day or before, and its last row is the last day of the
 * month. A month still open, or a source that stopped, is `partial`: its numbers are a floor.
 */
export function sourceCoverage(month: string, coveredFrom: string | null, through: string | null): SourceCoverage {
  const { first, last } = monthBounds(month)
  if (coveredFrom === null) return { state: 'none', none: 'not_configured', from: null, through: null, noRows: false }
  if (coveredFrom > last) return { state: 'none', none: 'before_start', from: coveredFrom, through: null, noRows: false }
  const from = coveredFrom > first ? coveredFrom : null
  const noRows = through === null
  const early = through !== null && through < last ? through : null
  return { state: from || early || noRows ? 'partial' : 'full', none: null, from, through: early, noRows }
}

export function funnelCoverage(f: AcquisitionFunnel, month: string): Record<FunnelSource, SourceCoverage> {
  const out = {} as Record<FunnelSource, SourceCoverage>
  for (const s of FUNNEL_SOURCES) out[s] = sourceCoverage(month, f.coverage[s], f.through[s])
  return out
}

/**
 * The stores close a day late (Apple within 3 days, Play within 7): the lag note shows while the month
 * is open or ended less than 7 days ago.
 */
export const STORE_LAG_DAYS = 7

export function showsStoreLag(month: string, today: Date): boolean {
  const { last } = monthBounds(month)
  const end = Date.parse(`${last}T00:00:00Z`) + (STORE_LAG_DAYS + 1) * 86_400_000
  return today.getTime() < end
}

// ── A. Funnel by store ───────────────────────────────────────────────────────────────────────

/** Sum of the known values; none known is `null`; an empty list is `0` (covered, no row). */
export function sumKnown(values: (number | null)[]): number | null {
  if (values.length === 0) return 0
  const known = values.filter((v): v is number => v !== null)
  return known.length === 0 ? null : known.reduce((a, v) => a + v, 0)
}

export interface StoreTotals {
  impressions: number | null
  pageViews: number | null
  downloads: number | null
}

/** The month of one store, summed over its sources; `null` when the store's source does not cover the month. */
export function storeTotals(store: StoreKey, rows: FunnelStoreRow[], coverage: SourceCoverage): StoreTotals {
  if (coverage.state === 'none') return { impressions: null, pageViews: null, downloads: null }
  const mine = rows.filter((r) => r.store === store)
  return {
    // Google Play does not report impressions: unknown, never a sum of nothing.
    impressions: store === 'play_store' ? null : sumKnown(mine.map((r) => r.impressions)),
    pageViews: sumKnown(mine.map((r) => r.pageViews)),
    downloads: sumKnown(mine.map((r) => r.downloads)),
  }
}

const noneReason = (c: SourceCoverage): StepReason => (c.none === 'before_start' ? 'before_source' : 'no_source')

function step(key: string, source: StepInput['source'], value: number | null, c: SourceCoverage): StepInput {
  if (c.state === 'none') return { key, source, value: null, reason: noneReason(c) }
  if (value === null) return { key, source, value: null, reason: 'no_source' }
  return { key, source, value, floor: c.state === 'partial' }
}

export const STORE_STEPS = ['impressions', 'page_views', 'downloads', 'installs_ga4', 'entered'] as const

/**
 * The five rows of a store: three of the store, on its ruler, and two hollow ones of other instruments
 * (GA4 `first_open` and the people who got past the Terms). `entered` is `null` while the acquisition
 * read has not answered.
 */
export function storeFunnel(
  store: StoreKey,
  f: AcquisitionFunnel,
  coverage: Record<FunnelSource, SourceCoverage>,
  entered: number | null
): StepFunnelView {
  const c = coverage[STORE_JOB[store]]
  const t = storeTotals(store, f.stores, c)
  const impressions: StepInput =
    store === 'play_store' ? { key: 'impressions', source: 'store', value: null, reason: 'not_measured' } : step('impressions', 'store', t.impressions, c)
  return readStepFunnel('store', [
    impressions,
    step('page_views', 'store', t.pageViews, c),
    step('downloads', 'store', t.downloads, c),
    step('installs_ga4', 'ga4', f.installs[store].installsGa4, coverage.ga4),
    entered === null ? { key: 'entered', source: 'bank', value: null, reason: 'loading' } : { key: 'entered', source: 'bank', value: entered },
  ])
}

export interface EnteredByStore {
  app_store: number
  play_store: number
  /** People with no system recorded: in neither store. */
  unassigned: number
}

/** "Entered" per store from `platforms`: iOS to the App Store, Android to Google Play, the rest to neither. */
export function enteredByStore(platforms: { platform: string; total: number }[]): EnteredByStore {
  const of = (p: string) => platforms.filter((x) => x.platform === p).reduce((a, x) => a + x.total, 0)
  const all = platforms.reduce((a, x) => a + x.total, 0)
  const ios = of('ios')
  const android = of('android')
  return { app_store: ios, play_store: android, unassigned: all - ios - android }
}

// ── B. Where store visits come from ──────────────────────────────────────────────────────────

export interface OriginRow {
  source: StoreSource | 'total'
  impressions: number | null
  pageViews: number | null
  downloads: number | null
  /** Downloads over impressions (App Store) or over page views (Google Play); `null` with a zero or unknown base. */
  conversion: number | null
}

/** The base of the store's conversion: the first step the store measures. */
export const conversionOf = (store: StoreKey, r: { impressions: number | null; pageViews: number | null; downloads: number | null }): number | null =>
  rateOf(r.downloads, store === 'app_store' ? r.impressions : r.pageViews)

/**
 * One row per source the store classifies, in the store's order, then the total, which is the funnel's
 * (`storeTotals`, one sum). A source of the list with no row, with coverage, is `0`; a source the store
 * does not classify adds up in `other`, so the table and the funnel never disagree.
 */
export function originTable(store: StoreKey, rows: FunnelStoreRow[], coverage: SourceCoverage): OriginRow[] {
  const known = STORE_SOURCES[store]
  const mine = rows.filter((r) => r.store === store)
  const out: OriginRow[] = known.map((source) => {
    const of = mine.filter((r) => (known.includes(r.source) ? r.source === source : source === 'other'))
    const v = {
      impressions: store === 'play_store' ? null : sumKnown(of.map((r) => r.impressions)),
      pageViews: sumKnown(of.map((r) => r.pageViews)),
      downloads: sumKnown(of.map((r) => r.downloads)),
    }
    return { source, ...v, conversion: conversionOf(store, v) }
  })
  const total = storeTotals(store, rows, coverage)
  out.push({ source: 'total', ...total, conversion: conversionOf(store, total) })
  return out
}

// ── D. Website by channel ────────────────────────────────────────────────────────────────────

/** The GA4 `sessionDefaultChannelGroup` values the screen names; any other adds up in "other". */
export const SITE_CHANNELS = ['Direct', 'Organic Search', 'Organic Social', 'AI Assistant', 'Email', 'Referral', 'Unassigned'] as const

export interface SiteChannelRow {
  /** The i18n key: the GA4 value with `_` for spaces, or `other`. */
  key: string
  /** The GA4 values in the row (several only in `other`). */
  channels: string[]
  sessions: number | null
  users: number | null
  clicksAppStore: number | null
  clicksPlayStore: number | null
}

export interface SiteTable {
  rows: SiteChannelRow[]
  /**
   * Sessions and clicks add up; `users` is always `null`: the same person arrives by two channels and on
   * two days, so a sum would count them twice.
   */
  total: { sessions: number | null; users: null; clicksAppStore: number | null; clicksPlayStore: number | null }
}

const known = (channel: string) => (SITE_CHANNELS as readonly string[]).includes(channel)

/** Channels by sessions, descending, "other" always last; a channel with no session in the month is not a row. */
export function siteTable(site: FunnelSiteRow[]): SiteTable {
  const live = site.filter((r) => r.sessions !== 0)
  const named: SiteChannelRow[] = live
    .filter((r) => known(r.channel))
    .map((r) => ({ key: r.channel.replace(/ /g, '_'), channels: [r.channel], sessions: r.sessions, users: r.users, clicksAppStore: r.clicksAppStore, clicksPlayStore: r.clicksPlayStore }))
  const rest = live.filter((r) => !known(r.channel))
  named.sort((a, b) => (b.sessions ?? -1) - (a.sessions ?? -1))
  if (rest.length > 0) {
    named.push({
      key: 'other',
      channels: rest.map((r) => r.channel || '?'),
      sessions: sumKnown(rest.map((r) => r.sessions)),
      users: sumKnown(rest.map((r) => r.users)),
      clicksAppStore: sumKnown(rest.map((r) => r.clicksAppStore)),
      clicksPlayStore: sumKnown(rest.map((r) => r.clicksPlayStore)),
    })
  }
  return {
    rows: named,
    total: {
      sessions: sumKnown(named.map((r) => r.sessions)),
      users: null,
      clicksAppStore: sumKnown(named.map((r) => r.clicksAppStore)),
      clicksPlayStore: sumKnown(named.map((r) => r.clicksPlayStore)),
    },
  }
}
