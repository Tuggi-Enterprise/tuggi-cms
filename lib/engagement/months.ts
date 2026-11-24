/**
 * The month ruler of the Engagement report (#1094, spec-cms-relatorio-engajamento-2026-11 §3).
 *
 * The columns do not come from the database: they are every month from `ENGAGEMENT_FIRST_MONTH`
 * to the current month in Sao Paulo, so the skeleton already draws the right number of columns and
 * a month the database did not return is a column of "no data". The API route reads the same list
 * for `p_from` and `p_to`, so the screen and the query never disagree on the period.
 */

export const ENGAGEMENT_FIRST_MONTH = '2026-08'
export const ENGAGEMENT_TIME_ZONE = 'America/Sao_Paulo'
/** Brazil has had no daylight saving since 2019: a fixed offset is the zone's (the Push report reads the same). */
const ENGAGEMENT_UTC_OFFSET = '-03:00'
/**
 * The database refuses a period longer than 400 days (contract banco-para-cms Parte 25, `22023`).
 * Thirteen months is at most 397 days, so the ruler keeps the latest thirteen.
 */
export const ENGAGEMENT_MAX_MONTHS = 13

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/

export function isMonth(value: unknown): value is string {
  return typeof value === 'string' && MONTH.test(value)
}

/** Today in Sao Paulo, `YYYY-MM-DD`. */
export function saoPauloDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ENGAGEMENT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** `YYYY-MM` plus `n` months (n may be negative). */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  const total = y * 12 + (m - 1) + n
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

/** `YYYY-MM-DD` plus `n` days, in calendar arithmetic. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Every month from the first one to the current month in Sao Paulo, oldest first, at most thirteen. */
export function engagementMonths(now: Date = new Date()): string[] {
  const current = saoPauloDay(now).slice(0, 7)
  const out: string[] = []
  for (let m = ENGAGEMENT_FIRST_MONTH; m <= current; m = addMonths(m, 1)) out.push(m)
  if (out.length === 0) out.push(current)
  return out.slice(-ENGAGEMENT_MAX_MONTHS)
}

/** The half-open `[p_from, p_to)` of the database over a month list: first day of the first, first day after the last. */
export function engagementRange(months: readonly string[]): { p_from: string; p_to: string } {
  const first = months[0]
  const after = addMonths(months[months.length - 1], 1)
  return { p_from: `${first}-01T00:00:00${ENGAGEMENT_UTC_OFFSET}`, p_to: `${after}-01T00:00:00${ENGAGEMENT_UTC_OFFSET}` }
}

const OLD_CONVERSION_MONTH = /^(\d{4}-(0[1-9]|1[0-2]))-\d{2}$/

/**
 * Where `/dashboard/reports/conversion` goes since #1101 (spec §C8.3): the purchase funnel of the
 * Engagement page. The old page's `?month=YYYY-MM-DD` becomes `?month=YYYY-MM`; anything else is
 * dropped and the page falls to its default month.
 */
export function conversionRedirectTarget(locale: string, month: unknown): string {
  const m = typeof month === 'string' ? OLD_CONVERSION_MONTH.exec(month) : null
  return `/${locale}/dashboard/reports/engagement${m ? `?month=${m[1]}` : ''}#conversion`
}
