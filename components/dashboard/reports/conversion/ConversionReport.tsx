'use client'

import { useMemo } from 'react'
import { Funnel, LogIn, UserCheck, Hourglass, CreditCard } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'

import { StatCard, StatCardRow } from '@/components/ui/StatCard'
import { WidgetCard, SectionHeader } from '@/components/dashboard/WidgetCard'
import { RankRow } from '@/components/dashboard/reports/acquisition/RankRow'
import { CardError } from '@/components/admin/social/shared'
import { DIM } from '@/components/ui/dense-table'
import { CHART_COLORS } from '@/lib/constants/chart-colors'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import { readFunnel, type ConversionFunnel } from '@/lib/conversion/funnel'

/**
 * The Conversion report (#1068, spec-cms-relatorio-conversao-2026-11). Presentational: the page
 * owns the URL and the query, this owns the screen, so the CT bench mounts it with a fixture.
 *
 * No `recharts` here: the funnel is five `RankRow` on one ruler, painted in CSS.
 */
export interface ConversionReportProps {
  month: string
  months: string[]
  onMonthChange: (month: string) => void
  funnel?: ConversionFunnel
  isLoading: boolean
  isFetching: boolean
  isError: boolean
  onRetry: () => void
}

const monthLabel = (iso: string, locale: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })

/** A `RankRow` worth of height: `py-2.5` + 20px line + `mb-1.5` + 6px bar = 52px. */
function RowSkeleton() {
  return (
    <div className="py-2.5">
      <div className="h-8 rounded-md bg-gray-100 dark:bg-gray-800 animate-pulse" />
    </div>
  )
}

const SEPARATOR = 'mt-3 pt-3 border-t border-dashed border-gray-200 dark:border-gray-800'
const ROWS = 'divide-y divide-gray-100 dark:divide-gray-800'

export function ConversionReport({
  month,
  months,
  onMonthChange,
  funnel,
  isLoading,
  isFetching,
  isError,
  onRetry,
}: ConversionReportProps) {
  const t = useTranslations('Pages.Dashboard')
  const locale = useLocale()
  const k = (key: string, values?: Record<string, string | number>) => t(`reports.conversion.${key}`, values)

  const percent = useMemo(() => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }), [locale])
  // `of_entered` carries its own `%`, so the tile gets the bare number at one decimal: 1 purchase in
  // 300 is 0,3, and rounding to an integer would print the 0 the page exists not to hide.
  const decimal = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }), [locale])
  const integer = useMemo(() => new Intl.NumberFormat(locale), [locale])

  const f = isError ? undefined : funnel
  const view = f ? readFunnel(f) : undefined

  /** Error prints no zero: UNKNOWN_VALUE and "no data", as the Push report's `tile()`. */
  const tile = (value: number | undefined, rate: number | null | undefined, sub?: string) => {
    if (isError || value === undefined) return { value: UNKNOWN_VALUE, subtitle: isError ? k('no_data') : undefined }
    if (sub) return { value: integer.format(value), subtitle: sub }
    // DS-COMPONENTE-084 item 2: entered = 0 prints no rate.
    return {
      value: integer.format(value),
      subtitle: rate == null ? undefined : k('of_entered', { pct: decimal.format(rate * 100) }),
    }
  }

  const rateRight = (rate: number | null | undefined) => (
    <span className={`text-[11px] tabular-nums ${DIM}`}>{rate == null ? UNKNOWN_VALUE : percent.format(rate)}</span>
  )

  const tiles = [
    { key: 'entered', icon: LogIn, color: CHART_COLORS.blue, ...tile(f?.entered, null, k('entered_sub')) },
    { key: 'account', icon: UserCheck, color: CHART_COLORS.purple, ...tile(f?.account, view?.rates.account) },
    { key: 'used_hours', icon: Hourglass, color: CHART_COLORS.orange, ...tile(f?.usedHours, view?.rates.usedHours) },
    { key: 'purchased', icon: CreditCard, color: CHART_COLORS.green, ...tile(f?.purchased, view?.rates.purchased) },
  ]

  const installsSub = () => {
    if (!f || !view) return undefined
    if (view.installs === 'unknown') return k('installs_unknown')
    const split = { ios: integer.format(f.installs.ios ?? 0), android: integer.format(f.installs.android ?? 0) }
    // DS-COMPONENTE-084 item 1: an incomplete register prints the value marked as a floor.
    return view.installs === 'floor' ? k('installs_floor', split) : k('installs_split', split)
  }

  return (
    <div className="cms-width p-6 lg:p-8 space-y-6 min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center">
            <Funnel className="mr-3 h-8 w-8 text-tuggi-purple" aria-hidden="true" />
            {k('title')}
          </h1>
          <p className={DIM}>{k('subtitle')}</p>
        </div>

        <label className="flex items-center gap-2">
          <span className="sr-only">{k('month')}</span>
          <select
            value={month}
            onChange={(e) => onMonthChange(e.target.value)}
            className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm font-semibold text-gray-900 dark:text-white"
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m, locale)}
              </option>
            ))}
          </select>
          {isFetching && !isLoading && (
            <span className={`text-[11px] uppercase tracking-widest ${DIM}`}>{k('updating')}</span>
          )}
        </label>
      </div>

      <StatCardRow columns={4}>
        {tiles.map((x) => (
          <div key={x.key} title={k(`steps.${x.key}_hint`)} data-testid={`conversion-tile-${x.key}`}>
            <StatCard
              icon={x.icon}
              label={k(`steps.${x.key}`)}
              value={x.value}
              subtitle={x.subtitle}
              color={x.color}
              isLoading={isLoading}
            />
          </div>
        ))}
      </StatCardRow>

      <div data-testid="conversion-funnel">
      <WidgetCard>
        <SectionHeader
          as="h2"
          title={k('funnel_title')}
          icon={Funnel}
          right={<span className={`text-[11px] text-right ${DIM}`}>{k('note_installs')}</span>}
          className="flex-wrap gap-2"
        />

        {isError ? (
          <CardError onRetry={onRetry} message={k('load_failed')} retryLabel={k('retry')} />
        ) : isLoading || !f || !view ? (
          <div aria-busy="true" data-testid="conversion-funnel-body">
            <RowSkeleton />
            <div className={`${SEPARATOR} ${ROWS}`}>
              <RowSkeleton />
              <RowSkeleton />
              <RowSkeleton />
              <RowSkeleton />
            </div>
          </div>
        ) : (
          <div data-testid="conversion-funnel-body">
            {view.installs === 'unknown' ? (
              <RankRow label={k('steps.installs')} sub={installsSub()} value={0} display={UNKNOWN_VALUE}
                max={view.max} color={CHART_COLORS.blue} muted />
            ) : (
              <RankRow label={k('steps.installs')} sub={installsSub()} value={f.installs.total ?? 0}
                display={integer.format(f.installs.total ?? 0)} max={view.max} color={CHART_COLORS.blue} />
            )}

            {/* A different instrument below the line: GA4 counts devices, Entered counts people. */}
            <div className={`${SEPARATOR} ${ROWS}`}>
              <RankRow
                label={k('steps.entered')}
                sub={view.notEntered == null ? undefined : k('not_entered', { count: integer.format(view.notEntered) })}
                value={f.entered}
                display={integer.format(f.entered)}
                max={view.max}
                color={CHART_COLORS.blue}
                right={rateRight(f.entered > 0 ? 1 : null)}
              />
              <RankRow label={k('steps.account')} value={f.account} display={integer.format(f.account)}
                max={view.max} color={CHART_COLORS.blue} right={rateRight(view.rates.account)} />
              <RankRow label={k('steps.used_hours')} value={f.usedHours} display={integer.format(f.usedHours)}
                max={view.max} color={CHART_COLORS.blue} right={rateRight(view.rates.usedHours)} />
              <RankRow label={k('steps.purchased')} value={f.purchased} display={integer.format(f.purchased)}
                max={view.max} color={CHART_COLORS.blue} right={rateRight(view.rates.purchased)} />
            </div>

            {view.installs === 'floor' && <p className={`text-[11px] mt-2 ${DIM}`}>{k('floor_note')}</p>}
          </div>
        )}
      </WidgetCard>
      </div>

      <p className={`text-xs max-w-3xl ${DIM}`}>
        {k('steps.entered_hint')} {k('note_cohort')}
      </p>
    </div>
  )
}

export default ConversionReport
