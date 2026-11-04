/**
 * The two payloads of the Engagement report (#1094) and its filters, typed once for the API routes
 * and the screen.
 *
 * Bank: `drive.cms_get_engagement_monthly` (contract banco-para-cms Parte 25). Every number may be
 * `null`, and `null` stays `null` here: it is "no data", never `0` (BR-COMUNICACAO-022 item 4).
 * GA4: the `engagement-ga4` Edge Function, which reads the app property. The two never form a
 * fraction (DS-COMPONENTE-084 item 2): this file has no arithmetic between them.
 */

export const ENGAGEMENT_USES = ['open', 'trip', 'audio'] as const
export type EngagementUse = (typeof ENGAGEMENT_USES)[number]
export const ENGAGEMENT_DEFAULT_USE: EngagementUse = 'audio'

export const ENGAGEMENT_PLATFORMS = ['ios', 'android'] as const
export type EngagementPlatform = (typeof ENGAGEMENT_PLATFORMS)[number]
export const ENGAGEMENT_ACCOUNTS = ['account', 'anonymous'] as const
export type EngagementAccount = (typeof ENGAGEMENT_ACCOUNTS)[number]

export interface EngagementFilters {
  /** `attribution_source`; `'none'` asks for the organic install (no source). */
  source: string | null
  /** ISO 3166-1 alpha-2, upper case, as `drive.profiles.country`. */
  country: string | null
  platform: EngagementPlatform | null
  account: EngagementAccount | null
}

export const NO_FILTERS: EngagementFilters = { source: null, country: null, platform: null, account: null }

const SOURCE = /^[a-z_]{1,40}$/
const COUNTRY = /^[A-Z]{2}$/

/**
 * The filters of a query string. Absent, empty and `all` are no filter; a value that is not one
 * of the domain is `invalid`, so the route answers 400 before the database.
 */
export function parseEngagementFilters(params: URLSearchParams): EngagementFilters | 'invalid' {
  const read = (key: string) => {
    const v = params.get(key)
    return v === null || v === '' || v === 'all' ? null : v
  }
  const source = read('source')
  const country = read('country')
  const platform = read('platform')
  const account = read('account')
  if (source !== null && !SOURCE.test(source)) return 'invalid'
  if (country !== null && !COUNTRY.test(country)) return 'invalid'
  if (platform !== null && !(ENGAGEMENT_PLATFORMS as readonly string[]).includes(platform)) return 'invalid'
  if (account !== null && !(ENGAGEMENT_ACCOUNTS as readonly string[]).includes(account)) return 'invalid'
  return {
    source,
    country,
    platform: platform as EngagementPlatform | null,
    account: account as EngagementAccount | null,
  }
}

export function hasFilters(f: EngagementFilters): boolean {
  return f.source !== null || f.country !== null || f.platform !== null || f.account !== null
}

/** GA4 knows platform and country; source and account do not exist there (spec §6, §9.4). */
export function ga4Filterable(f: EngagementFilters): boolean {
  return f.source === null && f.account === null
}

// ── Bank ─────────────────────────────────────────────────────────────────────────────────────

export type ByUse = Record<EngagementUse, number | null>
export interface DaysUsed {
  d1: number | null
  d2: number | null
  d3_5: number | null
  d6_plus: number | null
}

export interface EngagementBankMonth {
  month: string
  active: ByUse
  new: ByUse
  guide_minutes_median: number | null
  guide_minutes_p75: number | null
  days_used: Record<EngagementUse, DaysUsed>
  returned_next_month: ByUse
  activation: { audio_24h: number | null; audio_7d: number | null }
  cohort: {
    size: number | null
    retention: { d1: number | null; d7: number | null; d30: number | null; d60: number | null; d90: number | null }
    second_trip: { d30: number | null; d60: number | null; d90: number | null }
  }
}

export interface EngagementBankReport {
  /** ISO dates, or `null` when the source has no row yet. */
  data_since: Record<EngagementUse, string | null>
  months: EngagementBankMonth[]
}

/** `null` and anything that is not a finite number is `null`. Zero is a value. */
function n(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})

function byUse(v: unknown): ByUse {
  const o = obj(v)
  return { open: n(o.open), trip: n(o.trip), audio: n(o.audio) }
}

function daysUsed(v: unknown): DaysUsed {
  const o = obj(v)
  return { d1: n(o.d1), d2: n(o.d2), d3_5: n(o.d3_5), d6_plus: n(o.d6_plus) }
}

const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null)

/** The jsonb of the function. A missing key is `null`, never `0`. */
export function parseBankReport(raw: unknown): EngagementBankReport {
  const r = obj(raw)
  const since = obj(r.data_since)
  const months = Array.isArray(r.months) ? r.months : []
  return {
    data_since: { open: day(since.open), trip: day(since.trip), audio: day(since.audio) },
    months: months
      .map((m) => {
        const o = obj(m)
        const du = obj(o.days_used)
        const act = obj(o.activation)
        const c = obj(o.cohort)
        const ret = obj(c.retention)
        const sec = obj(c.second_trip)
        return {
          month: typeof o.month === 'string' ? o.month.slice(0, 7) : '',
          active: byUse(o.active),
          new: byUse(o.new),
          guide_minutes_median: n(o.guide_minutes_median),
          guide_minutes_p75: n(o.guide_minutes_p75),
          days_used: { open: daysUsed(du.open), trip: daysUsed(du.trip), audio: daysUsed(du.audio) },
          returned_next_month: byUse(o.returned_next_month),
          activation: { audio_24h: n(act.audio_24h), audio_7d: n(act.audio_7d) },
          cohort: {
            size: n(c.size),
            retention: { d1: n(ret.d1), d7: n(ret.d7), d30: n(ret.d30), d60: n(ret.d60), d90: n(ret.d90) },
            second_trip: { d30: n(sec.d30), d60: n(sec.d60), d90: n(sec.d90) },
          },
        }
      })
      .filter((m) => /^\d{4}-\d{2}$/.test(m.month)),
  }
}

// ── GA4 ──────────────────────────────────────────────────────────────────────────────────────

export interface EngagementGa4Month {
  month: string
  activeUsers: number
  engagementSeconds: number
  sessionsPerUser: number | null
}

export interface EngagementGa4Click {
  month: string
  screen: string
  button: string
  events: number
  users: number
}

export interface EngagementGa4Report {
  months: EngagementGa4Month[]
  clicks: EngagementGa4Click[]
}

/** The answer of `engagement-ga4`, or null when it is not one: the route then reports a failed read. */
export function parseGa4Report(raw: unknown): EngagementGa4Report | null {
  const r = obj(raw)
  if (!Array.isArray(r.months) || !Array.isArray(r.clicks)) return null
  const months: EngagementGa4Month[] = []
  for (const m of r.months) {
    const o = obj(m)
    const activeUsers = n(o.activeUsers)
    if (typeof o.month !== 'string' || activeUsers === null) continue
    months.push({ month: o.month, activeUsers, engagementSeconds: n(o.engagementSeconds) ?? 0, sessionsPerUser: n(o.sessionsPerUser) })
  }
  const clicks: EngagementGa4Click[] = []
  for (const c of r.clicks) {
    const o = obj(c)
    const events = n(o.events)
    const users = n(o.users)
    if (typeof o.month !== 'string' || typeof o.screen !== 'string' || typeof o.button !== 'string' || events === null || users === null) continue
    clicks.push({ month: o.month, screen: o.screen, button: o.button, events, users })
  }
  return { months, clicks }
}
