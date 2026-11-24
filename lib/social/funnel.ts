/**
 * Pure rules of the funnel strips (#1059, spec 2.3), apart from the chart so the Node tests reach them
 * without recharts.
 *
 * - Each strip has its own Y domain, from 0 to `stripTop` of its own data: a strip never borrows the
 *   scale of the strip above, and no bar can leave its strip.
 * - A total over a window is only a total when every day of the window was measured. With part of
 *   the window measured, it is a floor and says over how many days (DS-COMPONENTE-084 item 1); with
 *   either window partial, no change against the previous period is printed (item 2).
 */

import { mondayOf } from './time'

/** Rungs of a "nice" axis top inside each power of ten. */
const RUNGS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]

/** The smallest nice integer at or above the largest value; 1 for a strip of zeros or nulls. */
export function stripTop(values: Array<number | null | undefined>): number {
  let max = 0
  for (const v of values) if (typeof v === 'number' && Number.isFinite(v) && v > max) max = v
  if (max <= 1) return 1
  const power = 10 ** Math.floor(Math.log10(max))
  for (const r of RUNGS) {
    const top = r * power
    if (top >= max && Number.isInteger(top)) return top
  }
  return Math.ceil(max)
}

export type Coverage = 'full' | 'partial' | 'none'

/** How much of a window of `days` days has a measured value. */
export function coverageOf(measured: number, days: number): Coverage {
  if (measured <= 0 || days <= 0) return 'none'
  return measured >= days ? 'full' : 'partial'
}

/**
 * The change of a total against the previous window of the same length, or null when it must not be
 * printed: a window not fully measured, or a previous total of zero (no ratio over zero).
 */
export function changeRatio(
  now: number | null,
  before: number | null,
  coverage: { now: Coverage; before: Coverage }
): number | null {
  if (now === null || before === null || before === 0) return null
  if (coverage.now !== 'full' || coverage.before !== 'full') return null
  return (now - before) / before
}

const INSTAGRAM_HOST = 'https://www.instagram.com/'

/** The post link only when it is Instagram's own host: the value comes from an API, not from us. */
export function safePermalink(url: string | null | undefined): string | null {
  return typeof url === 'string' && url.startsWith(INSTAGRAM_HOST) ? url : null
}

/**
 * The Y domain of the growth line (#1063, spec G1): from a floor to a ceiling, not from zero, or a
 * curve from 600 to 712 in 96 px is a flat line. The step is the power of ten of the spread (1 when
 * flat); floor and ceiling are its multiples around the values, a step apart at least.
 */
export function lineDomain(values: Array<number | null | undefined>): [number, number] {
  const list = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (list.length === 0) return [0, 1]
  const min = Math.min(...list)
  const max = Math.max(...list)
  const step = max === min ? 1 : 10 ** Math.floor(Math.log10(max - min))
  const floor = Math.floor(min / step) * step
  const ceiling = Math.ceil(max / step) * step
  return floor === ceiling ? [floor - step, ceiling + step] : [floor, ceiling]
}

/** A bucket of the day axis: one day, or the days of a week from Monday. */
export interface DayBucket<T extends { day: string }> {
  x: string
  days: T[]
}

/**
 * Days, or weeks from Monday in Brasília when the caller says so: the funnel groups on six months,
 * the growth chart above `GROWTH_WEEKLY_FROM_DAYS`. One grouping for both cards.
 */
export function bucketize<T extends { day: string }>(days: T[], weekly: boolean): DayBucket<T>[] {
  if (!weekly) return days.map((d) => ({ x: d.day, days: [d] }))
  const weeks = new Map<string, T[]>()
  for (const d of days) {
    const w = mondayOf(d.day)
    weeks.set(w, [...(weeks.get(w) ?? []), d])
  }
  return [...weeks].map(([x, list]) => ({ x, days: list }))
}
