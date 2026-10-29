/**
 * Clock of the CMS social analytics (#1059): every day, week and hour the screen shows or reads is
 * Brasília time, wherever the operator's browser is.
 *
 * SSOT: the zone name lives here. The Edge Function `social-collect` runs in Deno and cannot import
 * this file; its `SOCIAL_TIME_ZONE` (`supabase/functions/_shared/social-collect.ts`) cites this one,
 * and `tests/api/social-analytics.test.ts` fails when the two differ.
 *
 * Pure functions on `Intl` only: they run the same in the browser, in the route and in the test.
 */

export const SOCIAL_TIME_ZONE = 'America/Sao_Paulo'

/** Brasília has had no daylight saving time since 2019: midnight is always 03:00 UTC. */
const BRASILIA_OFFSET = '-03:00'

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: SOCIAL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** The Brasília calendar day of an instant, `YYYY-MM-DD`. */
export function brasiliaDay(instant: Date): string {
  return dayFormatter.format(instant)
}

/** Calendar arithmetic on a `YYYY-MM-DD`, free of any zone. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** ISO weekday: 1 is Monday, 7 is Sunday. */
export function isoWeekday(day: string): number {
  const w = new Date(`${day}T12:00:00Z`).getUTCDay()
  return w === 0 ? 7 : w
}

/** The Monday of the week of `day` (`weekly_insights.week_start`). */
export function mondayOf(day: string): string {
  return addDays(day, 1 - isoWeekday(day))
}

/** The instant Brasília midnight opens `day`, as the ISO string the ranking functions take. */
export function brasiliaMidnightIso(day: string): string {
  return new Date(`${day}T00:00:00${BRASILIA_OFFSET}`).toISOString()
}

/** Whole days from `from` to `to`, both included. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

/** A calendar day as a noon instant, so `Intl` in the Brasília zone prints that same day. */
export function dayAsDate(day: string): Date {
  return new Date(`${day}T12:00:00Z`)
}

/** The three periods of the overview (spec 1.1), in days. */
export const SOCIAL_PERIODS = { '4w': 28, '12w': 84, '6m': 182 } as const
export type SocialPeriod = keyof typeof SOCIAL_PERIODS
export const DEFAULT_SOCIAL_PERIOD: SocialPeriod = '4w'

export function isSocialPeriod(v: unknown): v is SocialPeriod {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(SOCIAL_PERIODS, v)
}

const clockFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: SOCIAL_TIME_ZONE,
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
})

/** Minutes since Brasília midnight at an instant. */
export function brasiliaMinutes(instant: Date): number {
  const parts = Object.fromEntries(clockFormatter.formatToParts(instant).map((p) => [p.type, p.value]))
  return (Number(parts.hour) % 24) * 60 + Number(parts.minute)
}

/**
 * The cron `social-collect` runs at 09:00 UTC, 6h in Brasília (copy `collect.*`), and writes the day
 * it ran. Half an hour of slack covers the run itself; before that, yesterday is still the newest
 * day there can be.
 */
export const COLLECT_READY_MINUTES = 6 * 60 + 30

export type CollectState = 'none' | 'failed' | 'first_day' | 'ok'

/** Copy section 5: which banner the header shows. Only our own account decides; a competitor never. */
export function collectState(collection: { first_day: string | null; last_day: string | null }, now: Date): CollectState {
  if (!collection.last_day) return 'none'
  if (collection.last_day < expectedCollectDay(now)) return 'failed'
  if (collection.first_day === collection.last_day) return 'first_day'
  return 'ok'
}

/** The newest day a healthy collection has written by `now` (a competitor older than it failed). */
export function expectedCollectDay(now: Date): string {
  const today = brasiliaDay(now)
  return brasiliaMinutes(now) >= COLLECT_READY_MINUTES ? today : addDays(today, -1)
}
