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

/** People of the month in three groups that do not overlap (#1098); `null` before `data_since.open`. */
export interface EngagementModes {
  drive_only: number | null
  explore_only: number | null
  both: number | null
}

export interface EngagementBankMonth {
  month: string
  active: ByUse
  new: ByUse
  guide_minutes_median: number | null
  guide_minutes_p75: number | null
  modes: EngagementModes
  guide_foreground_minutes_median: number | null
  guide_background_minutes_median: number | null
  /** Share of guide time with the app in the background (not only screen off), 0 to 1. */
  guide_background_share: number | null
  days_used: Record<EngagementUse, DaysUsed>
  returned_next_month: ByUse
  activation: { audio_24h: number | null; audio_7d: number | null }
  cohort: {
    size: number | null
    /** Another trip on a local day 1 to N after the first one (D9 of migration 20261104120000): "returned by day N". */
    retention: { d1: number | null; d7: number | null; d30: number | null; d60: number | null; d90: number | null }
    /** Another trip on local day N itself (#1155): "returned on day N"; `null` as in `retention`. */
    retention_on: { d1: number | null; d7: number | null; d30: number | null }
    second_trip: { d30: number | null; d60: number | null; d90: number | null }
  }
}

export interface EngagementBankReport {
  /** ISO dates, or `null` when the source has no row yet. */
  data_since: Record<EngagementUse, string | null>
  months: EngagementBankMonth[]
  /**
   * The function sends the keys of #1098 (`modes` and the foreground and background times). Until
   * migration 20261104140000 is applied they are absent, and the screen says "the database does not
   * send this yet" instead of a reason that is not the real one.
   */
  has_mode_fields: boolean
  /** The function sends `cohort.retention_on` (#1155). Until then its rows say "no data", never 0. */
  has_retention_on: boolean
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
    has_mode_fields: months.some((m) => 'modes' in obj(m)),
    has_retention_on: months.some((m) => 'retention_on' in obj(obj(m).cohort)),
    data_since: { open: day(since.open), trip: day(since.trip), audio: day(since.audio) },
    months: months
      .map((m) => {
        const o = obj(m)
        const du = obj(o.days_used)
        const act = obj(o.activation)
        const c = obj(o.cohort)
        const ret = obj(c.retention)
        const on = obj(c.retention_on)
        const sec = obj(c.second_trip)
        const modes = obj(o.modes)
        return {
          month: typeof o.month === 'string' ? o.month.slice(0, 7) : '',
          active: byUse(o.active),
          new: byUse(o.new),
          guide_minutes_median: n(o.guide_minutes_median),
          guide_minutes_p75: n(o.guide_minutes_p75),
          modes: { drive_only: n(modes.drive_only), explore_only: n(modes.explore_only), both: n(modes.both) },
          guide_foreground_minutes_median: n(o.guide_foreground_minutes_median),
          guide_background_minutes_median: n(o.guide_background_minutes_median),
          guide_background_share: n(o.guide_background_share),
          days_used: { open: daysUsed(du.open), trip: daysUsed(du.trip), audio: daysUsed(du.audio) },
          returned_next_month: byUse(o.returned_next_month),
          activation: { audio_24h: n(act.audio_24h), audio_7d: n(act.audio_7d) },
          cohort: {
            size: n(c.size),
            retention: { d1: n(ret.d1), d7: n(ret.d7), d30: n(ret.d30), d60: n(ret.d60), d90: n(ret.d90) },
            retention_on: { d1: n(on.d1), d7: n(on.d7), d30: n(on.d30) },
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
  /** People with an engaged event (#1099); `null` when the function deployed does not send it yet. */
  engagedUsers: number | null
  /** Of those, the month's cohort by first session (#1101, spec §C15.1); `null` until the function sends it. */
  newEngagedUsers: number | null
  /**
   * Devices with a `paywall_viewed` in the month (#1156): all of the month, not the cohort, and a
   * device is not a person, so it never forms a fraction with the database (DS-COMPONENTE-084 item 2).
   * `null` before the event was collected, or from a function before #1156.
   */
  paywallViewedUsers: number | null
  /**
   * The other paywall events (#1161), devices, by the rule of `paywallViewedUsers`: `null` before GA4
   * received the event, or from a function before #1161.
   */
  paywallDismissedUsers: number | null
  paywallPlanTappedUsers: number | null
  paywallPurchaseFailedUsers: number | null
  paywallConvertedUsers: number | null
  /** Devices that answered each system permission (#1161); `null` before the first answer of the type, or not sent. */
  permissions: Record<Ga4PermissionType, Ga4PermissionMonth | null>
  /** Daily active windows averaged over the month (#1161), devices; `null` when not sent. */
  active1DayAvg: number | null
  active7DayAvg: number | null
  active28DayAvg: number | null
  /** Story events (#1161), events and not devices; `null` before the event or when not sent. */
  storyStarts: number | null
  storyCompletes: number | null
  storyCompletesNatural: number | null
}

export const GA4_PERMISSION_TYPES = ['location', 'motion', 'notifications'] as const
export type Ga4PermissionType = (typeof GA4_PERMISSION_TYPES)[number]
/** `asked` with any status, `allowed` with `granted` or `limited`: distinct devices of one GA4 event. */
export interface Ga4PermissionMonth {
  asked: number
  allowed: number
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
  /** The first month whose story ends carry `completion` (#1161); `null` with none, or from an older function. */
  storyCompletionSince: string | null
}

function permissionsOf(v: unknown): Record<Ga4PermissionType, Ga4PermissionMonth | null> {
  const o = obj(v)
  const out = {} as Record<Ga4PermissionType, Ga4PermissionMonth | null>
  for (const type of GA4_PERMISSION_TYPES) {
    const p = obj(o[type])
    const asked = n(p.asked)
    const allowed = n(p.allowed)
    out[type] = asked === null || allowed === null ? null : { asked, allowed }
  }
  return out
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
    months.push({
      month: o.month,
      activeUsers,
      engagementSeconds: n(o.engagementSeconds) ?? 0,
      sessionsPerUser: n(o.sessionsPerUser),
      engagedUsers: n(o.engagedUsers),
      newEngagedUsers: n(o.newEngagedUsers),
      paywallViewedUsers: n(o.paywallViewedUsers),
      paywallDismissedUsers: n(o.paywallDismissedUsers),
      paywallPlanTappedUsers: n(o.paywallPlanTappedUsers),
      paywallPurchaseFailedUsers: n(o.paywallPurchaseFailedUsers),
      paywallConvertedUsers: n(o.paywallConvertedUsers),
      permissions: permissionsOf(o.permissions),
      active1DayAvg: n(o.active1DayAvg),
      active7DayAvg: n(o.active7DayAvg),
      active28DayAvg: n(o.active28DayAvg),
      storyStarts: n(o.storyStarts),
      storyCompletes: n(o.storyCompletes),
      storyCompletesNatural: n(o.storyCompletesNatural),
    })
  }
  const clicks: EngagementGa4Click[] = []
  for (const c of r.clicks) {
    const o = obj(c)
    const events = n(o.events)
    const users = n(o.users)
    if (typeof o.month !== 'string' || typeof o.screen !== 'string' || typeof o.button !== 'string' || events === null || users === null) continue
    clicks.push({ month: o.month, screen: o.screen, button: o.button, events, users })
  }
  const since = typeof r.storyCompletionSince === 'string' && /^\d{4}-\d{2}$/.test(r.storyCompletionSince) ? r.storyCompletionSince : null
  return { months, clicks, storyCompletionSince: since }
}
