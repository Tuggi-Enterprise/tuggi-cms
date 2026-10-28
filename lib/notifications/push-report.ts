/**
 * The CMS push report (BR-COMUNICACAO-019 3.m.9, #1051): `/dashboard/reports/push` and the received
 * and opened numbers of `/admin/weekly-push`. Read only through `drive.cms_get_push_report`,
 * `drive.cms_get_push_send_people` and `drive.cms_get_weekly_push_engagement`
 * (db-tuggiApp 20261028160000, docs/contracts/notificacoes.md §13), all service_role behind
 * `withAuth({ roles: ['admin'] })`.
 *
 * NULL means "no source" and prints as "sem dado", never as 0 (DS-COMPONENTE-084). The database
 * decides which numbers are NULL; this module only keeps them NULL through the sums.
 */

/** One page of the people of a send (spec 1.5). The function accepts 1 to 200. */
export const PUSH_PEOPLE_PAGE_SIZE = 50

/** The function refuses a period longer than this (22023); the route refuses it first. */
export const PUSH_REPORT_MAX_DAYS = 400

/**
 * The day of a direct or broadcast send is a calendar day in `drive.push_time_zone(NULL)`, the
 * `default_time_zone` of `drive.unrequested_push_policy()`: America/Sao_Paulo, which has had no
 * daylight saving since 2019. The period the operator picks is read in the same zone.
 */
const REPORT_UTC_OFFSET = '-03:00'

/** The presets of the period select (copy: `filters.period_*`). */
export const PUSH_REPORT_PERIODS = { '7d': 7, '30d': 30, '90d': 90 } as const
export type PushReportPeriod = keyof typeof PUSH_REPORT_PERIODS
export const PUSH_REPORT_DEFAULT_PERIOD: PushReportPeriod = '30d'

export type PushChannel = 'weekly' | 'direct' | 'broadcast'

export interface PushRevenue {
  opened_pushes: number
  opened_buyers: number
  opened_revenue_usd: number | null
  not_opened_pushes: number
  not_opened_buyers: number
  not_opened_revenue_usd: number | null
}

export interface PushVariantCounts {
  variant: string | null
  sent: number
  delivered: number | null
  opened: number
  not_delivered: number | null
  action_pushes: number | null
  action_opened_pushes: number | null
}

export interface PushReportSend {
  send_key: string
  channel: PushChannel
  type: string
  piece: string | null
  day: string
  title: string | null
  distinct_titles: number
  first_sent_at: string
  last_sent_at: string
  sent: number
  delivered: number | null
  opened: number
  not_delivered: number | null
  open_rate: number | null
  influenced_opens: number | null
  action_pushes: number | null
  action_opened_pushes: number | null
  revenue: PushRevenue
  base_cost: { push_off: number | null; uninstalled: number | null }
  variants: PushVariantCounts[] | null
}

export interface PushReport {
  period: { from: string; to: string; type: string | null; time_zone: string }
  windows: {
    action_hours: number
    revenue_days: number
    base_cost_hours: number
    /**
     * From db-tuggiApp 20261028170000 (contract §13.1, #1052): influenced opens, push off,
     * uninstalled and the not delivered of a direct push only have a source for sends from this
     * moment on; older sends keep `null`. Absent while that migration is not applied.
     */
    sources_since?: string | null
    /** Days `drive.app_opens` is kept: an older send reads `influenced_opens` as `null` again. */
    app_open_retention_days?: number | null
  }
  /**
   * `inactive_tokens_changed` comes back too and is dropped by the route: it is the last write on
   * the token, not the day of the uninstall (decision D5 of the migration), so no screen shows it.
   */
  devices: { active_tokens: number; people_with_active_token: number; uninstalls: number | null }
  sends: PushReportSend[]
}

export interface PushPerson {
  user_id: string
  nickname: string | null
  sent_at: string
  delivered_at: string | null
  read_at: string | null
}

export interface PushPeoplePage {
  people: PushPerson[]
  total: number
}

export interface WeeklyPushEngagementSend {
  piece: string
  local_date: string
  sent: number
  delivered: number | null
  opened: number
  not_delivered: number | null
  open_rate: number | null
}

export interface WeeklyPushEngagement {
  summary: {
    weeks: number
    from_local_date: string
    sent: number
    delivered: number | null
    opened: number
    open_rate: number | null
  }
  sends: WeeklyPushEngagementSend[]
}

// ── Arguments the routes accept ──────────────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
/** The shape `drive.cms_get_push_send_people` accepts; anything else is 22023 there and 400 here. */
const SEND_KEY = /^(weekly|direct|broadcast):([^:\s]+):(\d{4}-\d{2}-\d{2})$/

function isCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/**
 * `from` and `to` as calendar days, both included, to the half-open `[p_from, p_to)` of the
 * function. `null` when either is missing, malformed, reversed or longer than the cap.
 */
export function pushReportRange(from: string | null, to: string | null): { p_from: string; p_to: string } | null {
  if (!from || !to || !isCalendarDate(from) || !isCalendarDate(to) || from > to) return null
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1
  if (days > PUSH_REPORT_MAX_DAYS) return null
  const end = new Date(`${to}T00:00:00Z`)
  end.setUTCDate(end.getUTCDate() + 1)
  return {
    p_from: `${from}T00:00:00${REPORT_UTC_OFFSET}`,
    p_to: `${end.toISOString().slice(0, 10)}T00:00:00${REPORT_UTC_OFFSET}`,
  }
}

/**
 * The send key of a list of people. Broadcast is refused: its rows carry no per person delivery,
 * and the screen offers no list for it (spec 1.4).
 */
export function isPeopleSendKey(value: string | null): value is string {
  if (!value) return false
  const match = SEND_KEY.exec(value)
  return match !== null && match[1] !== 'broadcast' && isCalendarDate(match[3])
}

/** `?page=` as a non-negative integer, `null` when malformed. Absent is the first page. */
export function pushPeoplePage(value: string | null): number | null {
  if (value === null || value === '') return 0
  if (!/^\d{1,6}$/.test(value)) return null
  return Number(value)
}

/** The calendar day `days - 1` before `today`, so the preset includes today. */
export function presetRange(period: PushReportPeriod, today: Date = new Date()): { from: string; to: string } {
  const local = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const start = new Date(today)
  start.setDate(start.getDate() - (PUSH_REPORT_PERIODS[period] - 1))
  return { from: local(start), to: local(today) }
}

/**
 * The calendar day of `windows.sources_since` in the report zone, for "Medido desde". The
 * contract says ISO date; a timestamp is read in the zone of the report so the day matches the
 * day column. `null` when absent or unreadable, and then the screen shows no line.
 */
export function sourcesSinceDay(value: string | null | undefined, timeZone = 'America/Sao_Paulo'): string | null {
  if (!value) return null
  if (ISO_DATE.test(value)) return isCalendarDate(value) ? value : null
  const instant = new Date(value)
  if (Number.isNaN(instant.getTime())) return null
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant)
}

// ── Sums that keep "no source" apart from zero ───────────────────────────────────────────

/** Sum of the measured values; `null` when none of them was measured. */
export function sumMeasured(values: ReadonlyArray<number | null | undefined>): number | null {
  let total: number | null = null
  for (const value of values) if (value != null) total = (total ?? 0) + value
  return total
}

/**
 * Whether a send counts in the open rate. Broadcast is out: its opened is only a read in the
 * Correio, never the tap, and it has no delivery (spec 3, contract §2.4).
 */
export function hasPersonMeasure(send: Pick<PushReportSend, 'channel'>): boolean {
  return send.channel !== 'broadcast'
}

export interface PushFunnel {
  sent: number
  delivered: number | null
  opened: number | null
  not_delivered: number | null
  /** Sent pushes that have a per person measure: the denominator of the rate. */
  measured_sent: number
  open_rate: number | null
  opened_revenue_usd: number | null
}

/** The summary tiles of the report from the sends on screen (after the type filter). */
export function pushFunnel(sends: readonly PushReportSend[]): PushFunnel {
  const measured = sends.filter(hasPersonMeasure)
  const measuredSent = measured.reduce((n, s) => n + s.sent, 0)
  const opened = sumMeasured(measured.map((s) => s.opened))
  return {
    sent: sends.reduce((n, s) => n + s.sent, 0),
    delivered: sumMeasured(measured.map((s) => s.delivered)),
    opened,
    not_delivered: sumMeasured(sends.map((s) => s.not_delivered)),
    measured_sent: measuredSent,
    open_rate: measuredSent > 0 && opened != null ? opened / measuredSent : null,
    opened_revenue_usd: sumMeasured(measured.map((s) => s.revenue.opened_revenue_usd)),
  }
}

/** The type chips: one per `data.type` with sends in the period, by number of sends. */
export function pushTypeCounts(sends: readonly PushReportSend[]): Array<{ type: string; sends: number }> {
  const counts = new Map<string, number>()
  for (const send of sends) counts.set(send.type, (counts.get(send.type) ?? 0) + 1)
  return [...counts.entries()]
    .map(([type, n]) => ({ type, sends: n }))
    .sort((a, b) => b.sends - a.sends || a.type.localeCompare(b.type))
}
