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
