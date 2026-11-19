/**
 * The two usage reads of the dashboard Overview (#1204): monthly use split into first month and
 * returning, and use by hour and by day. Parse, transport and the mapping to chart rows live here,
 * apart from recharts, so `tests/api/dashboard-usage-1204.test.ts` holds the mapping without a DOM.
 *
 * Source of both: `drive.user_location_history`, the table of the live map (contract banco-para-cms
 * Parte 30). Days, hours and months are Brasília's, never the operator's.
 */

import { fetchDashboardRoute, type RpcResult } from '@/lib/api/dashboard-fetch'
import { addMonths, saoPauloDay } from '@/lib/engagement/months'
import { CHART_COLORS, CHART_NEUTRAL } from '@/lib/constants/chart-colors'
import type { MonthBarsRow } from '@/components/dashboard/reports/engagement/question-charts'

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

export interface HourUsage {
  hour: number
  peak_concurrent: number
  avg_unique_users: number
}

export interface DayUsage {
  /** `YYYY-MM-DD`, Brasília. */
  day: string
  unique_users: number
  peak_concurrent: number
  /** Start of the first 2-minute block with the day's peak, `-03:00`; `null` on a day with no use. */
  peak_at: string | null
}

export interface UsageByHour {
  timezone: string
  window_seconds: number
  days: number
  /** Always 24 items, hour 0 to 23 in order (the parse fills a missing hour with zeros). */
  by_hour: HourUsage[]
  by_day: DayUsage[]
}

export interface MonthUsage {
  /** `YYYY-MM`, Brasília. */
  month: string
  active_users: number
  new_users: number
  returning_users: number
}

export interface MonthlyReturningUsers {
  /** The first ping the table holds, `-03:00`; `null` when the table is empty. */
  first_ping_at: string | null
  months: MonthUsage[]
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)
const DAY = /^\d{4}-\d{2}-\d{2}$/
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

export const HOURS_PER_DAY = 24

/** Plot plus axis of the by-hour chart and of the by-day chart, px (spec §4). */
export const HOURLY_PX = 168
export const DAILY_PX = 64

/** The payload of `core.dashboard_usage_by_hour`, or `null` when it is not one. */
export function parseUsageByHour(raw: unknown): UsageByHour | null {
  if (!isObject(raw) || !Array.isArray(raw.by_hour) || !Array.isArray(raw.by_day)) return null
  const byHour = new Map<number, HourUsage>()
  for (const h of raw.by_hour) {
    if (!isObject(h)) continue
    const hour = num(h.hour)
    if (!Number.isInteger(hour) || hour < 0 || hour >= HOURS_PER_DAY) continue
    byHour.set(hour, { hour, peak_concurrent: num(h.peak_concurrent), avg_unique_users: num(h.avg_unique_users) })
  }
  const by_hour: HourUsage[] = []
  for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
    by_hour.push(byHour.get(hour) ?? { hour, peak_concurrent: 0, avg_unique_users: 0 })
  }
  const by_day: DayUsage[] = raw.by_day
    .filter((d): d is Record<string, unknown> => isObject(d) && typeof d.day === 'string' && DAY.test(d.day))
    .map((d) => ({
      day: d.day as string,
      unique_users: num(d.unique_users),
      peak_concurrent: num(d.peak_concurrent),
      peak_at: typeof d.peak_at === 'string' ? d.peak_at : null,
    }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
  return {
    timezone: typeof raw.timezone === 'string' ? raw.timezone : 'America/Sao_Paulo',
    window_seconds: num(raw.window_seconds),
    days: num(raw.days),
    by_hour,
    by_day,
  }
}

/** The payload of `core.dashboard_monthly_returning_users`, or `null` when it is not one. */
export function parseMonthlyReturningUsers(raw: unknown): MonthlyReturningUsers | null {
  if (!isObject(raw) || !Array.isArray(raw.months)) return null
  return {
    first_ping_at: typeof raw.first_ping_at === 'string' ? raw.first_ping_at : null,
    months: raw.months
      .filter((m): m is Record<string, unknown> => isObject(m) && typeof m.month === 'string' && MONTH.test(m.month))
      .map((m) => ({
        month: m.month as string,
        active_users: num(m.active_users),
        new_users: num(m.new_users),
        returning_users: num(m.returning_users),
      })),
  }
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/** The two periods of the selector (spec §4). The route accepts 1..31. */
export const USAGE_DAYS = [7, 30] as const
export type UsageDays = (typeof USAGE_DAYS)[number]

/** Months on the monthly chart and on the compact total base: the same twelve (spec §2, §3). */
export const USAGE_MONTHS = 12

async function read<T>(path: string, parse: (raw: unknown) => T | null): Promise<RpcResult<T>> {
  const res = await fetchDashboardRoute<unknown>(path).catch((e: unknown) => ({
    data: null,
    error: { message: e instanceof Error ? e.message : 'network error' },
  }))
  if (res.error) return { data: null, error: res.error }
  const data = parse(res.data)
  return data ? { data, error: null } : { data: null, error: { message: `${path} returned an unexpected payload` } }
}

export function fetchUsageByHour(days: number): Promise<RpcResult<UsageByHour>> {
  return read(`/api/dashboard/usage-by-hour?days=${days}`, parseUsageByHour)
}

export function fetchMonthlyReturningUsers(months: number = USAGE_MONTHS): Promise<RpcResult<MonthlyReturningUsers>> {
  return read(`/api/dashboard/returning-users?months=${months}`, parseMonthlyReturningUsers)
}

// ---------------------------------------------------------------------------
// Monthly use (widget A) and the compact total base (widget B)
// ---------------------------------------------------------------------------

/** The twelve months ending in the current month in Sao Paulo, oldest first. Born on the client. */
export function usageMonths(now: Date = new Date()): string[] {
  const current = saoPauloDay(now).slice(0, 7)
  const out: string[] = []
  for (let i = 0; i < USAGE_MONTHS; i++) out.push(addMonths(current, i - (USAGE_MONTHS - 1)))
  return out
}

/** Series keys of the monthly chart. */
export const MONTHLY_KEYS = { returning: 'returning_users', first: 'new_users', unsplit: 'unsplit' } as const

/**
 * The series of the monthly chart in the order `MonthBars` stacks them, bottom to top (spec §2):
 * returning blue, first month orange, and the grey of a data gap for the first measured month. The
 * white 2 px gap between segments is `MonthBars`'s (DS-A11Y-007: blue and orange measure 1.03:1).
 */
export const MONTHLY_SERIES = [
  { key: MONTHLY_KEYS.returning, color: CHART_COLORS.blue },
  { key: MONTHLY_KEYS.first, color: CHART_COLORS.orange },
  { key: MONTHLY_KEYS.unsplit, color: CHART_NEUTRAL },
] as const

/**
 * What a month of the monthly chart is:
 * - `unmeasured`: before the first ping, or a month the function did not return. No bar, never 0
 *   (DS-COMPONENTE-084 item 1);
 * - `first`: the month of `first_ping_at`. Everyone is "first month" by construction, so the split is
 *   not drawn: one grey bar with the total, read as a floor (DS-COMPONENTE-084, 2026-09-16);
 * - `split`: first month and returning, stacked.
 */
export type MonthlyState = 'unmeasured' | 'first' | 'split'

export interface MonthlyPoint {
  month: string
  state: MonthlyState
  /** The current month, still running (DS-COMPONENTE-100 item 3). */
  partial: boolean
  active: number
  first: number
  returning: number
  /** Returning over active, a whole percent; `null` when nobody used the app that month. */
  sharePct: number | null
}

/** The month of an instant, in Sao Paulo. */
export function saoPauloMonth(instant: string): string | null {
  const d = new Date(instant)
  return Number.isNaN(d.getTime()) ? null : saoPauloDay(d).slice(0, 7)
}

export function monthlyPoints(payload: MonthlyReturningUsers, months: readonly string[], now: Date = new Date()): MonthlyPoint[] {
  const current = saoPauloDay(now).slice(0, 7)
  const firstMonth = payload.first_ping_at ? saoPauloMonth(payload.first_ping_at) : null
  const byMonth = new Map(payload.months.map((m) => [m.month, m]))
  return months.map((month) => {
    const row = byMonth.get(month)
    const partial = month === current
    if (!firstMonth || month < firstMonth || !row) {
      return { month, state: 'unmeasured' as const, partial, active: 0, first: 0, returning: 0, sharePct: null }
    }
    const sharePct = row.active_users > 0 ? Math.round((row.returning_users / row.active_users) * 100) : null
    return {
      month,
      state: month === firstMonth ? ('first' as const) : ('split' as const),
      partial,
      active: row.active_users,
      first: row.new_users,
      returning: row.returning_users,
      sharePct,
    }
  })
}

/** Nothing to draw: the empty state of widget A. */
export function monthlyHasData(points: readonly MonthlyPoint[]): boolean {
  return points.some((p) => p.state !== 'unmeasured')
}

/** Whether the first measured month is on screen, so the chart explains its grey bar. */
export function firstMonthShown(points: readonly MonthlyPoint[]): boolean {
  return points.some((p) => p.state === 'first')
}

/** The last month that closed, for the summary of the chart (spec §6). */
export function lastClosedPoint(points: readonly MonthlyPoint[]): MonthlyPoint | null {
  for (let i = points.length - 1; i >= 0; i--) {
    if (!points[i].partial && points[i].state !== 'unmeasured') return points[i]
  }
  return null
}

/** The rows `MonthBars` draws, in `stack` mode, from the points. */
export function monthlyRows(
  points: readonly MonthlyPoint[],
  fmt: { label: (month: string) => string; short: (month: string) => string; unmeasured: string }
): MonthBarsRow[] {
  return points.map((p) => {
    const values: Record<string, number | null> =
      p.state === 'split'
        ? { [MONTHLY_KEYS.returning]: p.returning, [MONTHLY_KEYS.first]: p.first }
        : p.state === 'first'
          ? { [MONTHLY_KEYS.unsplit]: p.active }
          : {}
    return {
      month: p.month,
      label: fmt.label(p.month),
      short: fmt.short(p.month),
      values,
      reason: p.state === 'unmeasured' ? fmt.unmeasured : null,
      partial: p.partial,
    }
  })
}

/**
 * The cumulative base over the given months. `user_growth` starts at the first sign-up and skips a
 * month with none; a skipped month repeats the total before it, and a month before the first sign-up
 * is zero, which is true (spec §3).
 */
export function compactGrowth(series: ReadonlyArray<{ month: string; count: number }>, months: readonly string[]): Array<{ month: string; count: number }> {
  const sorted = series
    .map((s) => ({ month: String(s.month).slice(0, 7), count: num(s.count) }))
    .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0))
  let i = 0
  let carried = 0
  return months.map((month) => {
    while (i < sorted.length && sorted[i].month <= month) carried = sorted[i++].count
    return { month, count: carried }
  })
}

// ---------------------------------------------------------------------------
// Use by hour and by day (widget C)
// ---------------------------------------------------------------------------

/** 24 hours of zero: the empty state of widget C, with the selector still live. */
export function hourlyHasData(payload: UsageByHour): boolean {
  return payload.by_hour.some((h) => h.peak_concurrent > 0 || h.avg_unique_users > 0)
}

/** The hour that carries the peak value on the chart, once: the highest peak, the first on a tie. */
export function peakHour(hours: readonly HourUsage[]): HourUsage | null {
  let best: HourUsage | null = null
  for (const h of hours) if (h.peak_concurrent > 0 && (!best || h.peak_concurrent > best.peak_concurrent)) best = h
  return best
}

/** The hour with the highest average, the first on a tie, for the summary of the chart. */
export function busiestHour(hours: readonly HourUsage[]): HourUsage | null {
  let best: HourUsage | null = null
  for (const h of hours) if (h.avg_unique_users > 0 && (!best || h.avg_unique_users > best.avg_unique_users)) best = h
  return best
}

export interface DayPoint extends DayUsage {
  /** Today in Brasília: still running, drawn lighter (spec §4). */
  today: boolean
}

export function dailyPoints(payload: UsageByHour, now: Date = new Date()): DayPoint[] {
  const today = saoPauloDay(now)
  return payload.by_day.map((d) => ({ ...d, today: d.day === today }))
}
