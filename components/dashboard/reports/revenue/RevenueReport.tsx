'use client'

import { useMemo } from 'react'
import { Banknote, Coins, Layers, Receipt, ShoppingBag, Undo2 } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'

import { WidgetCard, SectionHeader } from '@/components/dashboard/WidgetCard'
import { RankRow } from '@/components/dashboard/reports/acquisition/RankRow'
import { StackedMonthColumns, type StackedColumn } from '@/components/dashboard/reports/engagement/StackedMonthColumns'
import { CardError } from '@/components/admin/social/shared'
import { CELL, DIM, NUM } from '@/components/ui/dense-table'
import { StatCard, StatCardRow } from '@/components/ui/StatCard'
import { CHART_COLORS, CHART_NEUTRAL } from '@/lib/constants/chart-colors'
import { formatMoney, formatMoneyCompact } from '@/lib/finance/money'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import { cn } from '@/lib/utils'
import {
  readRevenueMonth,
  revenueMonths,
  TIER_COLORS,
  tierOf,
  usdCents,
  type RevenueMonth,
  type RevenueReport as RevenueData,
  type TierKey,
} from '@/lib/revenue/monthly'

/**
 * The Revenue page (#1157, spec-cms-relatorio-engajamento-2026-11 §D6): four tiles of the chosen
 * month, revenue by month in stacked columns by product, and the month by product and by currency.
 * Gross revenue, before the store's commission, production only; the commission per partner is not
 * here (BR-B2B-006, #992). A `null` prints the dash with its reason and never 0 (BR-COMUNICACAO-022
 * item 4); a measured 0 prints 0.
 *
 * Presentational: the page owns `?month=` and the query, so the CT bench mounts this with a fixture.
 */
export interface RevenueReportProps {
  /** The month ruler, `YYYY-MM`, oldest first. */
  months: string[]
  /** Today in Sao Paulo, `YYYY-MM-DD`. */
  today: string
  month: string
  onMonthChange: (month: string) => void
  /** `undefined` = loading; `null` = the function is not deployed yet. */
  report?: RevenueData | null
  failed: boolean
  onRetry: () => void
}

/** The column height of a month: the fraction of the tallest month in the window. */
const fraction = (v: number, top: number) => (top > 0 ? v / top : 0)

export function RevenueReport({ months, today, month, onMonthChange, report, failed, onRetry }: RevenueReportProps) {
  const t = useTranslations('Pages.Dashboard.reports')
  const locale = useLocale()
  const r = (key: string, values?: Record<string, string | number>) => t(`revenue.${key}`, values)
  const noSource = t('engagement.summary.tiles.no_source_bank')
  const integer = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }), [locale])
  const percent = useMemo(() => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }), [locale])
  const monthLong = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const monthShort = (m: string) => {
    const parts = new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' }).formatToParts(new Date(`${m}-15T12:00:00Z`))
    return `${parts.find((p) => p.type === 'month')?.value.replace('.', '') ?? m} ${parts.find((p) => p.type === 'year')?.value ?? ''}`
  }
  const current = today.slice(0, 7)
  const usd = (v: number | null) => (v === null ? UNKNOWN_VALUE : formatMoney(usdCents(v), 'USD'))
  const int = (v: number | null) => (v === null ? UNKNOWN_VALUE : integer.format(v))
  const tierName = (tier: string, key: TierKey) => (key === 'other' ? r('tiers.other', { tier }) : r(`tiers.${key}`))

  const loading = report === undefined && !failed
  const view = report ? readRevenueMonth(report, month) : null
  const m: RevenueMonth | null = view?.month ?? null
  /** Why a number of the chosen month is empty: not deployed, a month outside the table, or a small group. */
  const reason = !report || !m || m.purchases === null ? noSource : r('suppressed')

  // ── Tiles ──
  const refunds = m?.refunds ?? null
  const refundsKnown = refunds !== null && refunds.count !== null
  const tiles = [
    { key: 'revenue', icon: Banknote, color: CHART_COLORS.green, label: r('revenue_usd'), value: usd(m?.revenueUsd ?? null), hint: m?.revenueUsd == null ? reason : r('revenue_usd_hint') },
    { key: 'purchases', icon: ShoppingBag, color: CHART_COLORS.blue, label: r('purchases'), value: int(m?.purchases ?? null), hint: m?.purchases == null ? reason : r('purchases_hint') },
    { key: 'avg_ticket', icon: Receipt, color: CHART_COLORS.purple, label: r('avg_ticket'), value: usd(m?.avgTicketUsd ?? null), hint: m?.avgTicketUsd == null ? reason : r('avg_ticket_hint') },
    {
      key: 'refunds',
      icon: Undo2,
      color: CHART_COLORS.orange,
      label: r('refunds'),
      // A floor (contract Parte 26 §4): the store does not send every refund.
      value: refundsKnown ? `≥ ${integer.format(refunds?.count as number)}` : UNKNOWN_VALUE,
      subtitle: refundsKnown ? usd(refunds?.revenueUsd ?? null) : report && m && refunds === null ? r('refunds_no_data') : undefined,
      hint: refundsKnown ? r('refunds_hint') : report && m && refunds === null ? r('refunds_no_data') : reason,
    },
  ]

  // ── Columns: revenue by month, one segment per product ──
  const span = revenueMonths(month)
  const byMonth = new Map((report?.months ?? []).map((x) => [x.month, x]))
  const top = Math.max(0, ...span.map((w) => byMonth.get(w)?.revenueUsd ?? 0))
  const legend = new Map<TierKey, string>()
  const columns: StackedColumn[] = span.map((w) => {
    const x = byMonth.get(w)
    const label = monthShort(w)
    const untilToday = w === current ? r('until_today') : null
    if (!x || x.revenueUsd === null) {
      const title = !x || x.purchases === null ? noSource : r('suppressed')
      return { key: w, label, untilToday, segments: [], empty: { text: UNKNOWN_VALUE, title }, srText: `${label}: ${UNKNOWN_VALUE}` }
    }
    const known = x.mix.filter((i) => i.revenueUsd !== null && i.revenueUsd > 0)
    const segments = known.map((i) => {
      const key = tierOf(i.tier)
      legend.set(key, tierName(i.tier, key))
      return { key: i.tier, fraction: fraction(i.revenueUsd as number, top), color: TIER_COLORS[key], title: `${tierName(i.tier, key)}: ${usd(i.revenueUsd)}` }
    })
    // the revenue of the products hidden as a small group: drawn, neutral, never left out of the column
    const rest = x.revenueUsd - known.reduce((sum, i) => sum + (i.revenueUsd as number), 0)
    if (rest > 0.005) segments.push({ key: 'suppressed', fraction: fraction(rest, top), color: CHART_NEUTRAL, title: r('suppressed') })
    return { key: w, label, untilToday, segments, empty: null, srText: `${label}: ${usd(x.revenueUsd)}` }
  })

  const body = () => {
    if (failed) return <CardError onRetry={onRetry} message={r('failed')} retryLabel={t('engagement.retry')} />
    return (
      <>
        {/* One column up to `sm:` and two up to `xl:`: a dollar amount at the card's 30 px does not fit a
            quarter of the row with the sidebar open, nor half of 390 px (its space is a no-break one). */}
        <StatCardRow columns={4} className="grid-cols-1 sm:grid-cols-2 md:grid-cols-2 xl:grid-cols-4">
          {tiles.map((tile) => (
            <div key={tile.key} title={loading ? undefined : tile.hint} data-testid={`revenue-tile-${tile.key}`}>
              <StatCard icon={tile.icon} color={tile.color} label={tile.label} value={tile.value} subtitle={tile.subtitle} isLoading={loading} glow={false} className="h-full" />
            </div>
          ))}
        </StatCardRow>

        {m && m.purchases === 0 && <p className="text-sm text-gray-800 dark:text-gray-200" data-testid="revenue-empty">{r('empty')}</p>}

        <div data-testid="revenue-by-month">
          <WidgetCard>
            <SectionHeader as="h2" title={r('revenue_usd')} icon={Banknote} className="flex-wrap gap-2" right={<span className={cn('text-[11px] text-right', DIM)}>{r('subtitle')}</span>} />
            <StackedMonthColumns
              label={r('revenue_usd')}
              testId="revenue-columns"
              columns={columns}
              // compact, no symbol: the axis column is 32 px and the card title already says US$
              axisTop={top > 0 ? formatMoneyCompact(usdCents(top)) : '0'}
              loading={loading}
              legend={[...legend.entries()].map(([key, label]) => ({ key, label, color: TIER_COLORS[key] }))}
            />
          </WidgetCard>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
          <div data-testid="revenue-mix">
            <WidgetCard>
              <SectionHeader as="h2" title={r('mix_title')} icon={Layers} />
              {!view || view.mix.length === 0 ? (
                <p className={cn('py-4 text-sm', DIM)}>{loading ? '' : m && m.purchases === 0 ? r('empty') : UNKNOWN_VALUE}</p>
              ) : (
                <ul aria-label={r('mix_title')}>
                  {view.mix.map((row) => {
                    const hidden = row.revenueUsd === null
                    const name = tierName(row.tier, row.key)
                    return (
                      <li key={row.tier} data-testid="revenue-mix-row">
                        <RankRow
                          label={name}
                          title={hidden ? r('suppressed') : row.key === 'other' ? row.tier : undefined}
                          value={hidden ? 0 : (row.revenueUsd as number)}
                          display={usd(row.revenueUsd)}
                          max={view.mixMax}
                          color={TIER_COLORS[row.key]}
                          muted={hidden}
                          right={
                            <span className={cn('text-[11px] tabular-nums', DIM)}>
                              {hidden ? '' : `${r('mix_col_purchases')} ${int(row.purchases)} · ${row.share === null ? UNKNOWN_VALUE : percent.format(row.share)}`}
                            </span>
                          }
                        />
                      </li>
                    )
                  })}
                </ul>
              )}
            </WidgetCard>
          </div>

          <div data-testid="revenue-currency">
            <WidgetCard>
              <SectionHeader as="h2" title={r('by_currency')} icon={Coins} right={<span className={cn('text-[11px] text-right', DIM)}>{r('by_currency_hint')}</span>} className="flex-wrap gap-2" />
              {/* No bar and no sum: amounts in different currencies do not compare in length (§D6 item 3). */}
              {!m || m.byCurrency.length === 0 ? (
                <p className={cn('py-4 text-sm', DIM)}>{loading ? '' : m && m.purchases === 0 ? r('empty') : UNKNOWN_VALUE}</p>
              ) : (
                <table className="w-full">
                  <caption className="sr-only">{r('by_currency')}</caption>
                  <tbody>
                    {m.byCurrency.map((c) => (
                      <tr key={c.currency} className="border-b border-gray-100 last:border-0 dark:border-gray-800" data-testid="revenue-currency-row">
                        <th scope="row" className={cn(CELL, 'text-left font-mono font-semibold')}>{c.currency}</th>
                        <td className={cn(NUM, c.amount === null && DIM)} title={c.amount === null ? r('suppressed') : undefined}>
                          {c.amount === null ? UNKNOWN_VALUE : formatMoney(usdCents(c.amount), c.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </WidgetCard>
          </div>
        </div>
      </>
    )
  }

  return (
    <div className="cms-width p-6 lg:p-8 space-y-6 min-h-screen bg-gray-50 dark:bg-gray-950" data-testid="revenue-report">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center">
            <Banknote className="mr-3 h-8 w-8 text-tuggi-purple" aria-hidden="true" />
            {r('title')}
          </h1>
          <p className={DIM}>{r('subtitle')}</p>
        </div>
        <label>
          <span className="sr-only">{r('month_label', { month: monthLong(month) })}</span>
          <select
            data-testid="revenue-month"
            value={month}
            onChange={(e) => onMonthChange(e.target.value)}
            className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm font-semibold text-gray-900 dark:text-white"
          >
            {[...months].reverse().map((x) => (
              <option key={x} value={x}>
                {x === current ? `${monthLong(x)} (${r('until_today')})` : monthLong(x)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <h2 className="text-xs font-black uppercase tracking-widest text-gray-700 dark:text-gray-300" data-testid="revenue-month-label">
        {r('month_label', { month: monthLong(month) })}
        {month === current && <span className={cn('ml-2 normal-case tracking-normal font-semibold', DIM)}>{r('until_today')}</span>}
      </h2>

      {body()}

      <p className={cn('text-xs max-w-3xl ml-0', DIM)} data-testid="revenue-note">{r('gross_note')}</p>
    </div>
  )
}

export default RevenueReport
