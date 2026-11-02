'use client'

import { useMemo } from 'react'
import { Funnel, LogIn, UserCheck, Hourglass, CreditCard } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'

import { StatCard, StatCardRow } from '@/components/ui/StatCard'
import { WidgetCard, SectionHeader } from '@/components/dashboard/WidgetCard'
import { FunnelBands, type FunnelBand } from '@/components/dashboard/reports/conversion/FunnelBands'
import { CardError } from '@/components/admin/social/shared'
import { DIM } from '@/components/ui/dense-table'
import { CHART_COLORS } from '@/lib/constants/chart-colors'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import { readFunnel, type ConversionFunnel, type FunnelView } from '@/lib/conversion/funnel'

/**
 * The Conversion report (#1068, spec-cms-relatorio-conversao-2026-11). Presentational: the page
 * owns the URL and the query, this owns the screen, so the CT bench mounts it with a fixture.
 *
 * No `recharts` here: the funnel is `FunnelBands`, five bands on one ruler painted in CSS (#1069).
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

/**
 * One colour per step, read by the tile AND the band of the same step so the two never diverge
 * (spec section 7.2). Installs has no tile and no colour: its band is hollow, another instrument.
 */
const STEP_COLORS = {
  entered: CHART_COLORS.blue,
  account: CHART_COLORS.purple,
  used_hours: CHART_COLORS.orange,
  purchased: CHART_COLORS.green,
} as const

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

  const tiles = [
    { key: 'entered', icon: LogIn, color: STEP_COLORS.entered, ...tile(f?.entered, null, k('entered_sub')) },
    { key: 'account', icon: UserCheck, color: STEP_COLORS.account, ...tile(f?.account, view?.rates.account) },
    { key: 'used_hours', icon: Hourglass, color: STEP_COLORS.used_hours, ...tile(f?.usedHours, view?.rates.usedHours) },
    { key: 'purchased', icon: CreditCard, color: STEP_COLORS.purchased, ...tile(f?.purchased, view?.rates.purchased) },
  ]

  const installsSub = () => {
    if (!f || !view) return undefined
    if (view.installs === 'unknown') return k('installs_unknown')
    const split = { ios: integer.format(f.installs.ios ?? 0), android: integer.format(f.installs.android ?? 0) }
    // DS-COMPONENTE-084 item 1: an incomplete register prints the value marked as a floor.
    return view.installs === 'floor' ? k('installs_floor', split) : k('installs_split', split)
  }

  /** Steps 3 to 5 are each a share of Entered, in any order (BR-USUARIO-037 3.j): no rate between them. */
  const steps = (fn: ConversionFunnel, v: FunnelView): FunnelBand[] => {
    const step = (key: keyof typeof STEP_COLORS, value: number, rate: number | null): FunnelBand => ({
      key,
      label: k(`steps.${key}`),
      hint: k(`steps.${key}_hint`),
      value,
      display: integer.format(value),
      // DS-COMPONENTE-084 item 2: entered = 0 prints no rate.
      note: rate == null ? UNKNOWN_VALUE : key === 'entered' ? percent.format(rate) : k('of_entered', { pct: decimal.format(rate * 100) }),
      noteShort: rate == null ? UNKNOWN_VALUE : percent.format(rate),
      fill: STEP_COLORS[key],
    })
    return [
      step('entered', fn.entered, fn.entered > 0 ? 1 : null),
      step('account', fn.account, v.rates.account),
      step('used_hours', fn.usedHours, v.rates.usedHours),
      step('purchased', fn.purchased, v.rates.purchased),
    ]
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
          <div data-testid="conversion-funnel-body">
            <FunnelBands label={k('funnel_title')} loading />
          </div>
        ) : (
          <div data-testid="conversion-funnel-body">
            <FunnelBands
              label={k('funnel_title')}
              max={view.max}
              head={{
                key: 'installs',
                label: k('steps.installs'),
                hint: k('steps.installs_hint'),
                value: view.installs === 'unknown' ? null : f.installs.total,
                display: view.installs === 'unknown' ? UNKNOWN_VALUE : integer.format(f.installs.total ?? 0),
                note: installsSub(),
                noteShort: installsSub(),
                fill: 'outline',
                muted: view.installs === 'unknown',
              }}
              // The drop between instruments is a difference on the seam, never a rate (DS-COMPONENTE-084 item 2).
              seam={
                view.notEntered == null
                  ? undefined
                  : { text: k('not_entered', { count: integer.format(view.notEntered) }), hint: k('not_entered_hint') }
              }
              steps={steps(f, view)}
            />
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
