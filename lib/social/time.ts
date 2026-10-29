/**
 * Clock of the social agenda (#1058): every date the screen shows, every month it reads and every
 * instant it writes is Brasília time, wherever the operator's browser is.
 *
 * SSOT: the zone name lives here and nowhere else. The calendar, the list, the editor and the
 * write routes read it from this module, so the screen never spells the string twice.
 *
 * Pure functions on `Intl` only: they run the same in the browser, in the route and in the test.
 */

export const SOCIAL_TIME_ZONE = 'America/Sao_Paulo'

/** The cron that publishes runs every 5 minutes: the editor offers no minute it cannot honour. */
export const SCHEDULE_STEP_MINUTES = 5

/** Earliest time the editor accepts: one whole cron tick of slack after now (spec 3.5). */
export const SCHEDULE_MIN_LEAD_MINUTES = 10

export interface WallTime {
  year: number
  month: number // 1..12
  day: number
  hour: number
  minute: number
}

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: SOCIAL_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

/** The Brasília wall clock at an instant. */
export function wallTimeAt(instant: Date): WallTime {
  const parts: Record<string, number> = {}
  for (const part of partsFormatter.formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value)
  }
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour % 24, minute: parts.minute }
}

/** Milliseconds the zone is ahead of UTC at an instant (negative for Brasília). */
function zoneOffsetMs(instant: Date): number {
  const w = wallTimeAt(instant)
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute)
  const truncated = instant.getTime() - (instant.getTime() % 60000)
  return asUtc - truncated
}

/** The instant a Brasília wall clock reading names. Re-reads the offset once, in case a rule changes it. */
export function wallTimeToInstant(w: WallTime): Date {
  const guess = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute)
  let instant = guess - zoneOffsetMs(new Date(guess))
  const second = zoneOffsetMs(new Date(instant))
  instant = guess - second
  return new Date(instant)
}

const pad = (n: number) => (n < 10 ? `0${n}` : String(n))

/** `AAAA-MM`, the value of `?month=`. */
export function monthKeyOf(w: Pick<WallTime, 'year' | 'month'>): string {
  return `${w.year}-${pad(w.month)}`
}

/** `AAAA-MM-DD` of the Brasília day. */
export function dayKeyOf(w: Pick<WallTime, 'year' | 'month' | 'day'>): string {
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`
}

/** Parses `?month=`; anything else is `null`, and the caller falls back to the current month. */
export function parseMonthKey(raw: string | null | undefined): { year: number; month: number } | null {
  const match = raw ? /^(\d{4})-(\d{2})$/.exec(raw) : null
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  return month >= 1 && month <= 12 ? { year, month } : null
}

/** Parses `AAAA-MM-DD` (the `?date=` of the editor). */
export function parseDayKey(raw: string | null | undefined): { year: number; month: number; day: number } | null {
  const match = raw ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw) : null
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const probe = new Date(Date.UTC(year, month - 1, day))
  return probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day ? { year, month, day } : null
}

export function shiftMonth(m: { year: number; month: number }, delta: number): { year: number; month: number } {
  const index = m.year * 12 + (m.month - 1) + delta
  return { year: Math.floor(index / 12), month: (index % 12) + 1 }
}

/** First instant of the month and first instant of the next one, both at Brasília midnight. `[start, end)`. */
export function monthBounds(m: { year: number; month: number }): { start: string; end: string } {
  const next = shiftMonth(m, 1)
  return {
    start: wallTimeToInstant({ year: m.year, month: m.month, day: 1, hour: 0, minute: 0 }).toISOString(),
    end: wallTimeToInstant({ year: next.year, month: next.month, day: 1, hour: 0, minute: 0 }).toISOString(),
  }
}

/**
 * The weeks of the month grid, each a list of seven `AAAA-MM-DD`. The week starts on MONDAY, the
 * same week the push rule uses (BR-COMUNICACAO-019, item 4.1).
 */
export function calendarWeeks(m: { year: number; month: number }): string[][] {
  const first = new Date(Date.UTC(m.year, m.month - 1, 1))
  const lead = (first.getUTCDay() + 6) % 7 // Monday = 0
  const daysInMonth = new Date(Date.UTC(m.year, m.month, 0)).getUTCDate()
  const cells = Math.ceil((lead + daysInMonth) / 7) * 7
  const weeks: string[][] = []
  for (let i = 0; i < cells; i++) {
    const d = new Date(Date.UTC(m.year, m.month - 1, 1 - lead + i))
    if (i % 7 === 0) weeks.push([])
    weeks[weeks.length - 1].push(dayKeyOf({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }))
  }
  return weeks
}

/** Value of `<input type="datetime-local">` for a wall clock reading. */
export function toInputValue(w: WallTime): string {
  return `${dayKeyOf(w)}T${pad(w.hour)}:${pad(w.minute)}`
}

/** Reads `<input type="datetime-local">` as Brasília time. */
export function parseInputValue(raw: string | null | undefined): WallTime | null {
  const match = raw ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(raw) : null
  if (!match) return null
  const [year, month, day, hour, minute] = match.slice(1).map(Number)
  if (!parseDayKey(`${match[1]}-${match[2]}-${match[3]}`) || hour > 23 || minute > 59) return null
  return { year, month, day, hour, minute }
}

/**
 * The earliest instant the editor accepts: now, cut to the minute (the field has no seconds), plus
 * `SCHEDULE_MIN_LEAD_MINUTES`. 9 minutes ahead is refused, 10 is accepted (spec 8.8).
 */
export function minScheduleInstant(now: Date): Date {
  const minute = now.getTime() - (now.getTime() % 60000)
  return new Date(minute + SCHEDULE_MIN_LEAD_MINUTES * 60000)
}

/** `min` of the field: `minScheduleInstant` rounded UP to the step, as a Brasília wall clock. */
export function minScheduleWallTime(now: Date): WallTime {
  const step = SCHEDULE_STEP_MINUTES * 60000
  return wallTimeAt(new Date(Math.ceil(minScheduleInstant(now).getTime() / step) * step))
}

/** `31/10/2026 18:00`: the one display format of the screen (copy, "Formato de data"). */
const displayFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: SOCIAL_TIME_ZONE,
  dateStyle: 'short',
  timeStyle: 'short',
})

export function formatDateTime(iso: string): string {
  return displayFormatter.format(new Date(iso))
}

const timeFormatter = new Intl.DateTimeFormat('pt-BR', { timeZone: SOCIAL_TIME_ZONE, hour: '2-digit', minute: '2-digit' })

export function formatTime(iso: string): string {
  return timeFormatter.format(new Date(iso))
}

/** `novembro de 2026`. Built on a UTC noon so no zone can push it into another month. */
export function formatMonth(m: { year: number; month: number }): string {
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(m.year, m.month - 1, 15, 12))
  )
}

/** Short weekday names, Monday first. */
export function weekdayLabels(): string[] {
  const f = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' })
  // 2026-01-05 is a Monday.
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(Date.UTC(2026, 0, 5 + i, 12))))
}

/** `31/10/2026` of a day key, for accessible names. */
export function formatDayKey(key: string): string {
  const d = parseDayKey(key)
  return d ? `${pad(d.day)}/${pad(d.month)}/${d.year}` : key
}
