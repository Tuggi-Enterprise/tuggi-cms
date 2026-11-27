/**
 * The ruler of the ASO section of the Acquisition page (#1309, design spec
 * `spec-cms-relatorio-aquisicao-aso-2026-11`): stores by country and the store search position. Plain TS,
 * testable without mounting, as `funnel.ts`. The data is the four tables of contract banco-para-cms
 * Parte 31, read directly under the admin policy, paged past the PostgREST row cap.
 *
 * What this module exists to keep true (DS-COMPONENTE-084):
 *
 *   item 1  a country with no row in a covered store is unknown, never 0 (the App Store omits small
 *           values). A pair with no reading prints unknown; "not in results" is a measured fact and
 *           prints `> results_read`. A store day with no row inside the covered range is a day not
 *           read (the store blocked), and it makes the coverage partial.
 *   item 3  the month trend of a position has a sign both ways, and it is only computed when the two
 *           readings stand on the same ruler.
 *
 * A read that stops in the middle of the pages is reported as incomplete, never drawn: a cut month
 * would print the position of the wrong day as if it were the last.
 */

import { conversionOf, monthBounds, sourceCoverage, STORES, sumKnown, type SourceCoverage, type StoreKey } from '@/lib/acquisition/funnel'

// ── Store filter ─────────────────────────────────────────────────────────────────────────────

export type StoreFilter = 'both' | StoreKey

/** `?store=` of the URL; anything else, or nothing, is both stores. */
export const parseStoreFilter = (v: string | null | undefined): StoreFilter => (v === 'app_store' || v === 'play_store' ? v : 'both')

/** The stores a filter shows, App Store first, the order of the rest of the page. */
export const visibleStores = (f: StoreFilter): StoreKey[] => (f === 'both' ? STORES : [f])

// ── Paging ───────────────────────────────────────────────────────────────────────────────────

/** The default `max-rows` of the Supabase PostgREST: one page. */
export const PAGE_SIZE = 1000
/** A guard against a server that keeps answering: 100 pages is ten times the biggest month of the spec. */
const MAX_PAGES = 100

export interface PageResult<T> {
  data: T[] | null
  error: { code?: string; message?: string } | null
  /** `count: 'exact'`: the rows the filter matches. */
  count: number | null
}

export type PagedState = 'complete' | 'incomplete' | 'failed'

export interface PagedRead<T> {
  rows: T[]
  state: PagedState
}

/**
 * Reads every page of a filtered, ordered query. Done when the rows reach the exact count; with no count,
 * when a page comes back short. A failure on the first page is `failed`; on a later one, or a page that
 * comes back empty before the count, `incomplete`: the caller shows that and draws nothing.
 */
export async function readAllPages<T>(fetchPage: (from: number, to: number) => Promise<PageResult<T>>, pageSize = PAGE_SIZE): Promise<PagedRead<T>> {
  const rows: T[] = []
  let total: number | null = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = rows.length
    let res: PageResult<T>
    try {
      res = await fetchPage(from, from + pageSize - 1)
    } catch {
      return { rows, state: page === 0 ? 'failed' : 'incomplete' }
    }
    if (res.error || !Array.isArray(res.data)) return { rows, state: page === 0 ? 'failed' : 'incomplete' }
    if (typeof res.count === 'number') total = res.count
    rows.push(...res.data)
    if (total !== null) {
      if (rows.length >= total) return { rows, state: 'complete' }
      if (res.data.length === 0) return { rows, state: 'incomplete' }
    } else if (res.data.length < pageSize) {
      return { rows, state: 'complete' }
    }
  }
  return { rows, state: 'incomplete' }
}

// ── Parsing ──────────────────────────────────────────────────────────────────────────────────

/** `null` stays `null`; zero is a value. */
function nullableNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

const day = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null)
const isStore = (v: unknown): v is StoreKey => v === 'app_store' || v === 'play_store'
const text = (v: unknown): string => (typeof v === 'string' ? v : '')
const rowsOf = (raw: unknown): Record<string, unknown>[] => (Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [])

export interface StoreCountryDay {
  day: string
  store: StoreKey
  country: string
  impressions: number | null
  pageViews: number | null
  downloads: number | null
}

export function parseStoreCountryDays(raw: unknown): StoreCountryDay[] {
  const out: StoreCountryDay[] = []
  for (const r of rowsOf(raw)) {
    const d = day(r.day)
    if (!d || !isStore(r.store) || !text(r.country)) continue
    out.push({ day: d, store: r.store, country: text(r.country), impressions: nullableNumber(r.impressions), pageViews: nullableNumber(r.page_views), downloads: nullableNumber(r.downloads) })
  }
  return out
}

export interface RankKeyword {
  id: string
  keyword: string
  country: string
  active: boolean
}

export function parseRankKeywords(raw: unknown): RankKeyword[] {
  return rowsOf(raw)
    .filter((r) => text(r.id) && text(r.country))
    .map((r) => ({ id: text(r.id), keyword: text(r.keyword), country: text(r.country), active: r.active !== false }))
}

export interface RankApp {
  id: string
  store: StoreKey
  name: string
  isOwn: boolean
}

export function parseRankApps(raw: unknown): RankApp[] {
  return rowsOf(raw)
    .filter((r) => text(r.id) && isStore(r.store))
    .map((r) => ({ id: text(r.id), store: r.store as StoreKey, name: text(r.name), isOwn: r.is_own === true }))
}

export interface RankDay {
  day: string
  store: StoreKey
  keywordId: string
  appId: string
  /** `null`: not among the `resultsRead` results the store returned. */
  position: number | null
  resultsRead: number
}

export function parseRankDays(raw: unknown): RankDay[] {
  const out: RankDay[] = []
  for (const r of rowsOf(raw)) {
    const d = day(r.day)
    const read = nullableNumber(r.results_read)
    if (!d || !isStore(r.store) || !text(r.keyword_id) || !text(r.app_id) || read === null) continue
    out.push({ day: d, store: r.store, keywordId: text(r.keyword_id), appId: text(r.app_id), position: nullableNumber(r.position), resultsRead: read })
  }
  return out
}

// ── Coverage ─────────────────────────────────────────────────────────────────────────────────

/** The first row a table has of a store, ever, and its last row up to the end of the month. */
export interface TableBounds {
  first: string | null
  last: string | null
}

/**
 * The coverage of a store in one of the new tables (spec §4). The start is the table's first row, not
 * the job's `covered_from`: the detail by country starts after the store's total, and the job's date
 * would claim a month the table does not cover. With no row yet, the job's date says whether a collector
 * exists; with neither, the store is not configured. A table whose rows all end before the month has no
 * row of the month.
 */
export function tableCoverage(month: string, jobFrom: string | null, bounds: TableBounds): SourceCoverage {
  const from = bounds.first !== null && jobFrom !== null ? (bounds.first > jobFrom ? bounds.first : jobFrom) : bounds.first ?? jobFrom
  // a last row before the month is no row of the month: "no day of this month was collected yet"
  const through = bounds.last !== null && bounds.last >= monthBounds(month).first ? bounds.last : null
  return sourceCoverage(month, from, through)
}

/** Every day from `a` to `b`, both included, `YYYY-MM-DD`. */
export function daysBetween(a: string, b: string): string[] {
  const out: string[] = []
  for (let t = Date.parse(`${a}T00:00:00Z`), end = Date.parse(`${b}T00:00:00Z`); t <= end; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10))
  return out
}

export interface RankCoverage {
  coverage: SourceCoverage
  /** Days inside the covered range of the month with no row of the store: the store blocked the read. */
  missingDays: string[]
}

/**
 * The coverage of the search position of one store, with the days not read. The collector writes no row
 * on a day the store blocks (#1307), so a day between the first and the last row with no row is a day
 * not read, and one of them is enough to make the coverage partial (DS-COMPONENTE-084 item 1).
 */
export function rankCoverage(month: string, jobFrom: string | null, bounds: TableBounds, readDays: Iterable<string>): RankCoverage {
  const base = tableCoverage(month, jobFrom, bounds)
  if (base.state === 'none' || base.noRows || bounds.last === null) return { coverage: base, missingDays: [] }
  const { first, last } = monthBounds(month)
  const start = base.from ?? first
  const end = bounds.last < last ? bounds.last : last
  if (end < start) return { coverage: base, missingDays: [] }
  const read = new Set(readDays)
  const missingDays = daysBetween(start, end).filter((d) => !read.has(d))
  return { coverage: missingDays.length > 0 ? { ...base, state: 'partial' } : base, missingDays }
}

// ── A. Stores by country ─────────────────────────────────────────────────────────────────────

export interface CountryCell {
  impressions: number | null
  pageViews: number | null
  downloads: number | null
  /** Downloads over impressions on the App Store, over page views on Play (`conversionOf`, the funnel's base). */
  conversion: number | null
  /** The store has no row of this country in the month: unknown, never 0. */
  absent: boolean
}

export interface CountryRow {
  country: string
  stores: Partial<Record<StoreKey, CountryCell>>
}

const ABSENT: CountryCell = { impressions: null, pageViews: null, downloads: null, conversion: null, absent: true }
const hasValue = (r: StoreCountryDay) => r.impressions !== null || r.pageViews !== null || r.downloads !== null

/**
 * One row per country with at least one known value in the month in one of `stores` (the visible stores
 * with coverage). A store with no row of that country is `absent`; a store's sums are `sumKnown` over its
 * days, so a field the store never filled stays `null`. Google Play has no impressions.
 */
export function countryTable(days: StoreCountryDay[], stores: StoreKey[]): CountryRow[] {
  const mine = days.filter((r) => stores.includes(r.store))
  const countries = [...new Set(mine.filter(hasValue).map((r) => r.country))]
  return countries.map((country) => {
    const cells: Partial<Record<StoreKey, CountryCell>> = {}
    for (const store of stores) {
      const of = mine.filter((r) => r.store === store && r.country === country)
      if (of.length === 0) {
        cells[store] = ABSENT
        continue
      }
      const v = {
        impressions: store === 'play_store' ? null : sumKnown(of.map((r) => r.impressions)),
        pageViews: sumKnown(of.map((r) => r.pageViews)),
        downloads: sumKnown(of.map((r) => r.downloads)),
      }
      cells[store] = { ...v, conversion: conversionOf(store, v), absent: false }
    }
    return { country, stores: cells }
  })
}

export type CountryMetric = 'impressions' | 'pageViews' | 'downloads' | 'conversion'
export type CountrySortKey = 'country' | `${StoreKey}.${CountryMetric}`

export interface Sort<K extends string> {
  key: K
  dir: 1 | -1
}

/** The default order: downloads of the first visible store, descending. */
export const defaultCountrySort = (stores: StoreKey[]): Sort<CountrySortKey> => ({ key: `${stores[0] ?? 'app_store'}.downloads`, dir: -1 })

/** Sorted copy. An unknown value goes last in both directions; ties by country name in the locale. */
export function sortCountryRows(rows: CountryRow[], sort: Sort<CountrySortKey>, nameOf: (code: string) => string, collator: Intl.Collator): CountryRow[] {
  const byName = (a: CountryRow, b: CountryRow) => collator.compare(nameOf(a.country), nameOf(b.country))
  if (sort.key === 'country') return [...rows].sort((a, b) => sort.dir * byName(a, b))
  const [store, metric] = sort.key.split('.') as [StoreKey, CountryMetric]
  const value = (r: CountryRow) => r.stores[store]?.[metric] ?? null
  return [...rows].sort((a, b) => {
    const va = value(a)
    const vb = value(b)
    if (va === null || vb === null) return va === vb ? byName(a, b) : va === null ? 1 : -1
    return va === vb ? byName(a, b) : sort.dir * (va - vb)
  })
}

/**
 * How many downloads the store's total in the funnel has beyond the sum of the countries, when it has
 * more; `null` otherwise. The copy's line says only the difference, not its cause.
 */
export function downloadsGap(funnelDownloads: number | null, rows: CountryRow[], store: StoreKey): number | null {
  if (funnelDownloads === null) return null
  const sum = sumKnown(rows.map((r) => r.stores[store]?.downloads ?? null).filter((v): v is number => v !== null))
  const gap = funnelDownloads - (sum ?? 0)
  return gap > 0 ? gap : null
}

// ── B. Search position ───────────────────────────────────────────────────────────────────────

export interface RankReading {
  day: string
  position: number | null
  resultsRead: number
}

export type RankDelta =
  | { kind: 'moved'; delta: number }
  | { kind: 'entered' }
  | { kind: 'left' }
  | { kind: 'out_both' }
  | { kind: 'unknown'; reason: 'one_read' | 'ruler' }

/**
 * The month trend of a pair, first reading against the last (spec §3.5). Positive is up (a smaller
 * position). "Not in the 50 read" and "position 120" are not on the same ruler: the app may have been at
 * 120 both days, so that pair has no trend.
 */
export function rankDelta(first: RankReading | undefined, last: RankReading | undefined): RankDelta {
  if (!first || !last || first.day === last.day) return { kind: 'unknown', reason: 'one_read' }
  const a = first.position
  const b = last.position
  if (a !== null && b !== null) return { kind: 'moved', delta: a - b }
  if (a === null && b === null) return { kind: 'out_both' }
  if (a === null) return (b as number) <= first.resultsRead ? { kind: 'entered' } : { kind: 'unknown', reason: 'ruler' }
  return a <= last.resultsRead ? { kind: 'left' } : { kind: 'unknown', reason: 'ruler' }
}

export interface RankPoint {
  day: string
  position: number | null
  /** Why there is no number: not in results (with how many were read), or no reading that day. */
  reason: { kind: 'not_found'; resultsRead: number } | { kind: 'not_read' } | null
}

export interface RankRow {
  keywordId: string
  keyword: string
  /** The last day the pair (keyword, store) was read in the month; every position of the row is of that day. */
  lastDay: string | null
  /** Our app on `lastDay`; `null` when the pair has no reading. */
  own: RankReading | null
  /** The pair's last reading is older than the store's last day read: the store blocked it since. */
  stale: boolean
  delta: RankDelta
  /** Competitor id to its reading on `lastDay`; absent is no reading. */
  competitors: Record<string, RankReading>
  series: RankPoint[]
  daysFound: number
  daysRead: number
  daysMissing: number
}

export interface RankBlock {
  store: StoreKey
  ownApp: RankApp | null
  /** At most `MAX_COMPETITORS`, the one that takes most of the search of the country first. */
  competitors: RankApp[]
  rows: RankRow[]
  /** The last day with any row of the store in the month. */
  lastStoreDay: string | null
  /** Keywords read, and in how many our app showed up and was in the top 10, on each pair's last reading. */
  read: number
  found: number
  top10: number
}

export const MAX_COMPETITORS = 8
export const TOP = 10

/**
 * The block of one store for one country: `keywords` are the country's, `days` the month's rows of those
 * keywords. A row per keyword that is active or was read in the month; a competitor column per app of the
 * store with a row in the month, ordered by in how many keywords it showed up on the last reading.
 */
export function rankBlock(store: StoreKey, keywords: RankKeyword[], apps: RankApp[], days: RankDay[], collator: Intl.Collator): RankBlock {
  const mine = days.filter((d) => d.store === store)
  const ownApp = apps.find((a) => a.store === store && a.isOwn) ?? null
  const storeDays = [...new Set(mine.map((d) => d.day))].sort()
  const lastStoreDay = storeDays[storeDays.length - 1] ?? null
  const firstStoreDay = storeDays[0] ?? null
  const range = firstStoreDay && lastStoreDay ? daysBetween(firstStoreDay, lastStoreDay) : []
  const read = (d: RankDay): RankReading => ({ day: d.day, position: d.position, resultsRead: d.resultsRead })

  const rows: RankRow[] = []
  for (const k of keywords) {
    const pair = mine.filter((d) => d.keywordId === k.id)
    if (pair.length === 0 && !k.active) continue
    const lastDay = pair.reduce<string | null>((m, d) => (m === null || d.day > m ? d.day : m), null)
    const ownDays = pair.filter((d) => ownApp !== null && d.appId === ownApp.id).sort((a, b) => (a.day < b.day ? -1 : 1))
    const ownLast = ownDays.find((d) => d.day === lastDay)
    const competitors: Record<string, RankReading> = {}
    for (const d of pair) if (d.day === lastDay && d.appId !== ownApp?.id) competitors[d.appId] = read(d)
    const byDay = new Map(ownDays.map((d) => [d.day, d]))
    const series: RankPoint[] = range.map((day) => {
      const d = byDay.get(day)
      if (!d) return { day, position: null, reason: { kind: 'not_read' } }
      return d.position === null ? { day, position: null, reason: { kind: 'not_found', resultsRead: d.resultsRead } } : { day, position: d.position, reason: null }
    })
    const first = ownDays[0]
    const last = ownDays[ownDays.length - 1]
    rows.push({
      keywordId: k.id,
      keyword: k.keyword,
      lastDay,
      own: ownLast ? read(ownLast) : null,
      stale: lastDay !== null && lastStoreDay !== null && lastDay < lastStoreDay,
      delta: rankDelta(first && read(first), last && read(last)),
      competitors,
      series,
      daysFound: ownDays.filter((d) => d.position !== null).length,
      daysRead: ownDays.length,
      daysMissing: series.filter((p) => p.reason?.kind === 'not_read').length,
    })
  }

  const withRows = new Set(mine.map((d) => d.appId))
  const showsUp = (appId: string) => rows.filter((r) => r.competitors[appId]?.position != null).length
  const competitors = apps
    .filter((a) => a.store === store && !a.isOwn && withRows.has(a.id))
    .map((a) => ({ a, n: showsUp(a.id) }))
    .sort((x, y) => y.n - x.n || collator.compare(x.a.name, y.a.name))
    .slice(0, MAX_COMPETITORS)
    .map((x) => x.a)

  const readRows = rows.filter((r) => r.lastDay !== null)
  return {
    store,
    ownApp,
    competitors,
    rows: sortRankRows(rows, null, collator),
    lastStoreDay,
    read: readRows.length,
    found: readRows.filter((r) => r.own?.position != null).length,
    top10: readRows.filter((r) => r.own?.position != null && (r.own.position as number) <= TOP).length,
  }
}

export type RankSortKey = 'keyword' | 'position' | 'trend'

/** 0: our app has a position; 1: read, not in results; 2: no reading in the month. */
const rankGroup = (r: RankRow) => (r.own?.position != null ? 0 : r.lastDay !== null ? 1 : 2)

const TREND_EDGE = 1_000_000
/** A number to order the trend by: up is bigger; entered above any move, left below; no trend is `null`. */
const trendValue = (d: RankDelta): number | null => (d.kind === 'moved' ? d.delta : d.kind === 'entered' ? TREND_EDGE : d.kind === 'left' ? -TREND_EDGE : null)

/**
 * Sorted copy (spec §3.3). `null` is the default: by our position ascending, then the keywords where we
 * were not in results, then the ones not read; ties by keyword in the locale. The rows with no value of
 * the chosen column go last in both directions.
 */
export function sortRankRows(rows: RankRow[], sort: Sort<RankSortKey> | null, collator: Intl.Collator): RankRow[] {
  const byKeyword = (a: RankRow, b: RankRow) => collator.compare(a.keyword, b.keyword)
  if (sort?.key === 'keyword') return [...rows].sort((a, b) => sort.dir * byKeyword(a, b))
  if (sort?.key === 'trend') {
    return [...rows].sort((a, b) => {
      const va = trendValue(a.delta)
      const vb = trendValue(b.delta)
      if (va === null || vb === null) return va === vb ? byKeyword(a, b) : va === null ? 1 : -1
      return va === vb ? byKeyword(a, b) : sort.dir * (va - vb)
    })
  }
  const dir = sort?.dir ?? 1
  return [...rows].sort((a, b) => {
    const ga = rankGroup(a)
    const gb = rankGroup(b)
    if (ga !== gb) return ga - gb
    if (ga === 0 && a.own?.position !== b.own?.position) return dir * ((a.own?.position as number) - (b.own?.position as number))
    return byKeyword(a, b)
  })
}

/** The countries of the keyword list, by name in the locale. */
export function rankCountries(keywords: RankKeyword[], nameOf: (code: string) => string, collator: Intl.Collator): string[] {
  return [...new Set(keywords.map((k) => k.country))].sort((a, b) => collator.compare(nameOf(a), nameOf(b)))
}

/** `?country=` when given (even one with no keyword: the screen says so); else Brazil; else the first. */
export function pickCountry(param: string | null | undefined, options: string[]): string | null {
  if (param && /^[A-Z]{2}$/.test(param)) return param
  return options.includes('BR') ? 'BR' : options[0] ?? null
}

/** The top of the reversed y axis: the highest position read in the month, up to the next ten, at least 10. */
export function rankAxisTop(series: RankPoint[]): number {
  const max = Math.max(0, ...series.map((p) => p.position ?? 0))
  return Math.max(TOP, Math.ceil(max / 10) * 10)
}
