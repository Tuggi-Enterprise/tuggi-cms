/**
 * The Revenue page (#1157, spec-cms-relatorio-engajamento-2026-11 §D6): the jsonb of
 * `core.cms_get_revenue_monthly(p_from, p_to)` (contract banco-para-cms Parte 26 §4), read once here.
 *
 * Gross revenue, before the store's commission, production purchases only; the commission per partner
 * is not here (BR-B2B-006, #992). Every number may be `null` and `null` stays `null`: a group of 1 to 4
 * people, or a month the table does not cover, prints "no data", never 0 (BR-COMUNICACAO-022 item 4).
 * Until the migration is applied the function answers PGRST202, and the page reads that as no source
 * (`null` report), never as an error and never as an empty month.
 *
 * Pure: no fetch, no React.
 */

import { CHART_COLORS, CHART_NEUTRAL } from '@/lib/constants/chart-colors'
import { addMonths } from '@/lib/engagement/months'

export interface RevenueCurrency {
  currency: string
  /** In the purchase's own currency; currencies are never summed. */
  amount: number | null
}

export interface RevenueMixItem {
  /** The store product id (`tuggi_hours_10`, `tuggi_unlimited_month`, ...). */
  tier: string
  purchases: number | null
  revenueUsd: number | null
}

export interface RevenueRefunds {
  count: number | null
  revenueUsd: number | null
}

export interface RevenueMonth {
  /** YYYY-MM */
  month: string
  purchases: number | null
  revenueUsd: number | null
  byCurrency: RevenueCurrency[]
  avgTicketUsd: number | null
  mix: RevenueMixItem[]
  /** `null` = the month is outside the table; `{ null, null }` = a group of 1 to 4. It is a floor (contract §4). */
  refunds: RevenueRefunds | null
}

export interface RevenueReport {
  months: RevenueMonth[]
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})

/** `null`, absent and anything that is not a finite number is `null`. Zero is a value. */
function n(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}

const MONTH = /^\d{4}-\d{2}$/

/** The jsonb of the function. A missing key is `null`, never `0`; a month without a `YYYY-MM` is dropped. */
export function parseRevenueReport(raw: unknown): RevenueReport {
  const r = obj(raw)
  const months = Array.isArray(r.months) ? r.months : []
  const out: RevenueMonth[] = []
  for (const m of months) {
    const o = obj(m)
    const month = typeof o.month === 'string' ? o.month.slice(0, 7) : ''
    if (!MONTH.test(month)) continue
    const refunds = o.refunds === null || o.refunds === undefined ? null : obj(o.refunds)
    out.push({
      month,
      purchases: n(o.purchases),
      revenueUsd: n(o.revenue_usd),
      byCurrency: (Array.isArray(o.revenue_by_currency) ? o.revenue_by_currency : [])
        .map((c) => obj(c))
        .filter((c) => typeof c.currency === 'string' && c.currency !== '')
        .map((c) => ({ currency: c.currency as string, amount: n(c.amount) })),
      avgTicketUsd: n(o.avg_ticket_usd),
      mix: (Array.isArray(o.mix) ? o.mix : [])
        .map((x) => obj(x))
        .filter((x) => typeof x.tier === 'string' && x.tier !== '')
        .map((x) => ({ tier: x.tier as string, purchases: n(x.purchases), revenueUsd: n(x.revenue_usd) })),
      refunds: refunds === null ? null : { count: n(refunds.count), revenueUsd: n(refunds.revenue_usd) },
    })
  }
  return { months: out.sort((a, b) => a.month.localeCompare(b.month)) }
}

// ── Product names and colours ────────────────────────────────────────────────────────────────

/** The i18n key of a product under `Pages.Dashboard.reports.revenue.tiers` (copy §5). */
export type TierKey = 'hours_10' | 'hours_25' | 'hours_45' | 'monthly' | 'legacy_days' | 'other'

/**
 * The store product to its name: the three passes of BR-MONETIZACAO-048 and the subscription of
 * BR-MONETIZACAO-072 (`tuggi_unlimited_month`; Google sends it as `<product>:<base plan>`). The old
 * day plans (`tuggi_24h`, `tuggi_7d`, `tuggi_30d`) go under one name; anything else keeps its raw id
 * under `other`, so revenue is never hidden under a wrong name.
 */
export function tierOf(productId: string): TierKey {
  const id = productId.split(':')[0]
  if (id === 'tuggi_hours_10') return 'hours_10'
  if (id === 'tuggi_hours_25') return 'hours_25'
  if (id === 'tuggi_hours_45') return 'hours_45'
  if (id === 'tuggi_unlimited_month') return 'monthly'
  if (/^tuggi_\d+[dh]$/.test(id)) return 'legacy_days'
  return 'other'
}

/** One colour per product, the same in the columns and the mix (spec §D6 item 2). */
export const TIER_COLORS: Record<TierKey, string> = {
  hours_10: CHART_COLORS.blue,
  hours_25: CHART_COLORS.purple,
  hours_45: CHART_COLORS.orange,
  monthly: CHART_COLORS.green,
  legacy_days: CHART_NEUTRAL,
  other: CHART_NEUTRAL,
}

// ── The month ────────────────────────────────────────────────────────────────────────────────

export interface RevenueMixRow {
  tier: string
  key: TierKey
  purchases: number | null
  revenueUsd: number | null
  /** `revenueUsd / month revenue`; `null` without a measured part or a positive total. */
  share: number | null
}

export interface RevenueMonthView {
  month: RevenueMonth | null
  /** The bar of each product is its part of the month's revenue: `max` is the month's revenue. */
  mixMax: number
  mix: RevenueMixRow[]
}

/** The month the tiles and the two lists read; `null` when the function did not send it. */
export function readRevenueMonth(report: RevenueReport, month: string): RevenueMonthView {
  const m = report.months.find((x) => x.month === month) ?? null
  const total = m?.revenueUsd ?? null
  return {
    month: m,
    mixMax: total !== null && total > 0 ? total : 0,
    mix: (m?.mix ?? []).map((x) => ({
      tier: x.tier,
      key: tierOf(x.tier),
      purchases: x.purchases,
      revenueUsd: x.revenueUsd,
      share: x.revenueUsd !== null && total !== null && total > 0 ? x.revenueUsd / total : null,
    })),
  }
}

/** Dollars as the money formatter takes them: whole cents, `null` kept. */
export function usdCents(v: number | null): number | null {
  return v === null ? null : Math.round(v * 100)
}

// ── The window ───────────────────────────────────────────────────────────────────────────────

/** Months on the page: the chosen one and the eleven before it (§D6). */
export const REVENUE_WINDOW_MONTHS = 12

/** The twelve months of the window, oldest first: one column each, so a month the function left out still has one. */
export function revenueMonths(month: string): string[] {
  return Array.from({ length: REVENUE_WINDOW_MONTHS }, (_, i) => addMonths(month, i - (REVENUE_WINDOW_MONTHS - 1)))
}

/** `p_from` and `p_to` of the function for a chosen month: the first day of the window and the last day of the month. */
export function revenueWindow(month: string): { from: string; to: string } {
  const [y, m] = addMonths(month, 1).split('-').map(Number)
  const last = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10)
  return { from: `${revenueMonths(month)[0]}-01`, to: last }
}
