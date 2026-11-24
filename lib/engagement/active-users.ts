/**
 * `drive.cms_get_active_users_monthly` (contract banco-para-cms Parte 27 §5, #1160): DAU, WAU, MAU and
 * DAU/MAU of each month in people, typed once for the API route and the screen (#1162). The GA4 half
 * (devices) lives in `report.ts`; the two never meet in one fraction or one chart (DS-COMPONENTE-084
 * item 2).
 *
 * `open_coverage` says how much of the month the app opens cover: `full`, `partial` (the numbers are a
 * floor) or `none` (no opens at all, "no data"). Every number may be `null`, and `null` stays `null`
 * (BR-COMUNICACAO-022 item 4).
 */

export type OpenCoverage = 'full' | 'partial' | 'none'

export interface ActiveRuler {
  dau: number | null
  wau: number | null
  mau: number | null
  dau_mau: number | null
}

export interface ActiveUsersMonth {
  month: string
  /** Local days counted, up to today in the current month. */
  days: number | null
  /** Opened the app, started a trip or heard audio. */
  all_sources: ActiveRuler & { open_coverage: OpenCoverage | null }
  /** Trip or audio only, with the whole history. */
  trip_or_story: ActiveRuler
}

export interface ActiveUsersReport {
  data_since: { open: string | null; use: string | null }
  months: ActiveUsersMonth[]
}

function n(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null)
const ruler = (v: unknown): ActiveRuler => {
  const o = obj(v)
  return { dau: n(o.dau), wau: n(o.wau), mau: n(o.mau), dau_mau: n(o.dau_mau) }
}

/** The jsonb of the function. A missing key is `null`, never `0`; an unknown coverage is `null`. */
export function parseActiveUsersReport(raw: unknown): ActiveUsersReport {
  const r = obj(raw)
  const since = obj(r.data_since)
  const months = Array.isArray(r.months) ? r.months : []
  return {
    data_since: { open: day(since.open), use: day(since.use) },
    months: months
      .map((m): ActiveUsersMonth => {
        const o = obj(m)
        const all = obj(o.all_sources)
        const c = all.open_coverage
        return {
          month: typeof o.month === 'string' ? o.month.slice(0, 7) : '',
          days: n(o.days),
          all_sources: { ...ruler(all), open_coverage: c === 'full' || c === 'partial' || c === 'none' ? c : null },
          trip_or_story: ruler(o.trip_or_story),
        }
      })
      .filter((m) => /^\d{4}-\d{2}$/.test(m.month)),
  }
}
