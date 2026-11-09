'use client'

import { useMemo } from 'react'
import { Hourglass, Repeat, Sparkles } from 'lucide-react'

import { WidgetCard, SectionHeader } from '@/components/dashboard/WidgetCard'
import { RankRow } from '@/components/dashboard/reports/acquisition/RankRow'
import { MonthGrid, type MonthGridGroup } from '@/components/dashboard/reports/engagement/MonthGrid'
import { StackedMonthColumns, type StackedColumn } from '@/components/dashboard/reports/engagement/StackedMonthColumns'
import { CardError } from '@/components/admin/social/shared'
import { Button } from '@/components/ui/button'
import { DIM } from '@/components/ui/dense-table'
import { Sparkline } from '@/components/ui/Sparkline'
import { CHART_COLORS, CHART_NEUTRAL } from '@/lib/constants/chart-colors'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import { cn } from '@/lib/utils'
import { type Cell, type CellFormatters } from '@/lib/engagement/cells'
import { readFreeMinutes, type FreeMinutesHistogram, type FreeMinutesMark } from '@/lib/engagement/free-minutes'
import { BAND_KEYS, buildSummary, SUPPRESSED_SEGMENT, type MonthColumn, type SummaryInput } from '@/lib/engagement/summary'

/**
 * What stays of the Parte B and C summary under the question blocks of #1161 until #1162 replaces it:
 * the free minutes histogram (#1156), days of use and the cohort heat map. The month line, the four
 * tiles, the modes card and the two funnels moved to `EngagementQuestions` (spec Parte E).
 */

type K = (key: string, values?: Record<string, string | number>) => string

export interface EngagementSummaryProps {
  k: K
  fmt: CellFormatters
  input: SummaryInput
  useName: string
  /** Why a cell is empty, by source; `undefined` for a measured one. */
  cellTitle: (c: Cell, source: 'bank' | 'ga4') => string | undefined
  monthHeader: (month: string) => string
  monthLong: (month: string) => string
  onBankRetry: () => void
  onGa4Retry: () => void
  ga4BadgeHint: string
  /** The cohort heat map rows, already toned by the report (`heatTone`). */
  heatGroups: MonthGridGroup[]
  heatMonths: { key: string; label: string; untilToday: string | null }[]
  curve: { closed: number; points: (number | null)[] | null }
  /** `core.cms_get_free_minutes_histogram` of the month (#1156); `null` = not deployed, `undefined` = loading. */
  freeMinutes?: FreeMinutesHistogram | null
  freeMinutesFailed: boolean
  onFreeMinutesRetry: () => void
  /** Any filter of the bar: the funnels count the whole cohort and refuse it (§C1 item 8). */
  filtered: boolean
  onClearFilters: () => void
}

/** The label of each mark of the histogram (spec §D4). */
const MARK_KEYS: Record<FreeMinutesMark, string> = { 15: 'mark_15m', 60: 'mark_1h', 180: 'mark_3h' }

/**
 * Days of use, an ordinal scale of one hue, more days darker; dark mode inverts the anchor (spec §B7).
 * The second step is `sky-700`, not the spec's `sky-600`: white 10 px bold on `sky-600` is 4.09:1 and
 * axe refuses it; on `sky-700` it is 5.9:1.
 */
const BAND_FILL: Record<string, string> = {
  d1: 'bg-sky-400 dark:bg-sky-700',
  d2: 'bg-sky-700 dark:bg-sky-500',
  d3_5: 'bg-sky-800 dark:bg-sky-300',
  d6_plus: 'bg-sky-950 dark:bg-sky-100',
}
/** The ink of the inner label on each fill. */
const BAND_INK: Record<string, string> = {
  d1: 'text-gray-900 dark:text-white',
  d2: 'text-white dark:text-gray-900',
  d3_5: 'text-white dark:text-gray-900',
  d6_plus: 'text-white dark:text-gray-900',
}

/** The five steps of the cohort heat map, by `heatStep` (spec §B8). */
export const HEAT_TONES = ['bg-emerald-50', 'bg-emerald-100', 'bg-emerald-200', 'bg-emerald-300', 'bg-emerald-400'] as const

const PULSE_BLOCK = 'rounded bg-gray-100 dark:bg-gray-800 animate-pulse'

const hasValue = (c: Cell) => (c.state === 'measured' || c.state === 'floor') && c.value !== null

export function EngagementSummary(props: EngagementSummaryProps) {
  const { k, fmt, input, useName, cellTitle, monthHeader, monthLong } = props
  const s = (key: string, values?: Record<string, string | number>) => k(`summary.${key}`, values)
  const summary = useMemo(() => buildSummary(input), [input])
  const current = input.today.slice(0, 7)
  const month = summary.month
  const ga4Down = input.ga4Failed && !input.ga4Filtered

  const titleOf = (c: Cell, source: 'bank' | 'ga4') =>
    c.state === 'no_source' ? s(source === 'bank' ? 'tiles.no_source_bank' : 'tiles.no_source_ga4') : cellTitle(c, source)

  // ── Columns ──
  const monthCols = (cols: MonthColumn[], segment: (seg: MonthColumn['segments'][number], col: MonthColumn) => StackedColumn['segments'][number], sr: (col: MonthColumn) => string): StackedColumn[] =>
    cols.map((c) => ({
      key: c.month,
      label: monthHeader(c.month),
      untilToday: c.month === current ? k('until_today') : null,
      segments: c.segments.map((seg) => segment(seg, c)),
      empty: c.empty ? { text: hasValue(c.empty) ? fmt.integer.format(c.empty.value as number) : UNKNOWN_VALUE, title: titleOf(c.empty, 'bank') } : null,
      srText: sr(c),
    }))

  const countText = (c: Cell) => (hasValue(c) ? fmt.integer.format(c.value as number) : UNKNOWN_VALUE)
  const bandLabel = (key: string) => s(`bands.${key}`)
  const freqColumns = monthCols(
    summary.frequency,
    (seg) => {
      const pct = seg.share === null ? '' : fmt.percent.format(seg.share)
      const suppressed = seg.key === SUPPRESSED_SEGMENT
      return {
        key: seg.key,
        fraction: seg.fraction,
        className: suppressed ? undefined : `${BAND_FILL[seg.key]} ${BAND_INK[seg.key]}`,
        color: suppressed ? CHART_NEUTRAL : undefined,
        inner: suppressed ? undefined : pct,
        title: suppressed
          ? k('cell_suppressed')
          : hasValue(seg.cell)
            ? s('band_title', { band: bandLabel(seg.key), n: countText(seg.cell), pct })
            : (titleOf(seg.cell, 'bank') ?? ''),
      }
    },
    (c) =>
      s('frequency_sr', {
        month: monthHeader(c.month),
        bands: c.empty
          ? countText(c.empty)
          : c.segments.map((x) => `${bandLabel(x.key)} ${x.share === null ? UNKNOWN_VALUE : fmt.percent.format(x.share)}`).join(', '),
      })
  )

  const u = (key: string, values?: Record<string, string | number>) => s(`use_funnel.${key}`, values)
  const noBank = s('tiles.no_source_bank')

  // ── Free minutes histogram (#1156 §D4) ──
  const fm = (key: string, values?: Record<string, string | number>) => s(`free_minutes.${key}`, values)
  const freeView = props.freeMinutes === undefined ? undefined : readFreeMinutes(props.freeMinutes, month)
  const freeBody = () => {
    if (props.filtered) {
      return (
        <div className="flex flex-col items-start gap-3 py-4" data-testid="free-minutes-filtered">
          <p className="text-sm text-gray-800 dark:text-gray-200">{u('no_filters')}</p>
          <Button type="button" variant="outline" size="sm" onClick={props.onClearFilters}>
            {k('clear_filters')}
          </Button>
        </div>
      )
    }
    if (props.freeMinutesFailed) return <CardError onRetry={props.onFreeMinutesRetry} message={fm('failed')} retryLabel={k('retry')} />
    if (!freeView) {
      return (
        <ul aria-label={fm('title')} aria-busy="true" data-testid="free-minutes-loading">
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="py-2.5 space-y-2">
              <div className={cn(PULSE_BLOCK, 'h-4 w-28')} />
              <div className={cn(PULSE_BLOCK, 'h-1.5 w-full rounded-full')} />
              {[0, 2, 4].includes(i) && <div className="my-1 h-4" />}
            </li>
          ))}
        </ul>
      )
    }
    if (freeView.state === 'no_source') return <p className={cn('py-4 text-sm', DIM)} data-testid="free-minutes-no-source">{noBank}</p>
    if (freeView.state === 'small_base') return <p className="py-4 text-sm text-gray-800 dark:text-gray-200" data-testid="free-minutes-small-base">{fm('base_suppressed', { month: monthLong(month) })}</p>
    const before = freeView.state === 'before_ledger'
    return (
      <ul aria-label={fm('title')} data-testid="free-minutes-rows">
        {freeView.rows.map((r) => {
          const range = fm(`buckets.${r.key}`)
          const hidden = r.people === null
          const pctText = r.share === null ? '' : fmt.percent.format(r.share)
          const title = before
            ? noBank
            : hidden
              ? k('cell_suppressed')
              : `${fm('bar_title', { range, n: fmt.integer.format(r.people as number), pct: pctText || UNKNOWN_VALUE })}${r.fromMin === 0 ? ` ${fm('b0_15_hint')}` : ''}`
          return (
            <li key={r.key} data-testid="free-minutes-row">
              <RankRow
                label={range}
                title={title}
                value={hidden ? 0 : (r.people as number)}
                display={hidden ? UNKNOWN_VALUE : fmt.integer.format(r.people as number)}
                max={freeView.max}
                color={CHART_COLORS.blue}
                muted={hidden}
                right={
                  <span className={cn('text-[11px] tabular-nums', DIM)}>
                    {hidden ? (before ? '' : fm('bucket_suppressed')) : freeView.state === 'empty' ? '' : pctText}
                  </span>
                }
              />
              {r.markAfter !== null && (
                <div aria-hidden="true" className="relative my-1 h-4" data-testid="free-minutes-mark">
                  <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-gray-300 dark:border-gray-700" />
                  <span className={cn('absolute left-0 top-0 bg-white pr-2 text-[11px] font-semibold leading-4 dark:bg-gray-900', DIM)}>{fm(MARK_KEYS[r.markAfter])}</span>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    )
  }
  const freeBaseLine = () => {
    if (!freeView || props.filtered || props.freeMinutesFailed) return null
    const text =
      freeView.state === 'measured'
        ? fm('base', { n: fmt.integer.format(freeView.base as number), month: monthLong(month) })
        : freeView.state === 'empty'
          ? fm('empty', { month: monthLong(month) })
          : null
    return text ? <p className={cn('-mt-1 mb-2 text-xs', DIM)} data-testid="free-minutes-base">{text}</p> : null
  }

  return (
    <section data-testid="engagement-summary" className="space-y-6" aria-label={s('detail_divider')}>
      {(input.bankFailed || ga4Down) && (
        <div className="space-y-2">
          {input.bankFailed && <CardError onRetry={props.onBankRetry} message={k('bank_failed')} retryLabel={k('retry')} />}
          {ga4Down && <CardError onRetry={props.onGa4Retry} message={k('ga4_failed')} retryLabel={k('retry')} />}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
        <div data-testid="summary-free-histogram">
          <WidgetCard>
            <SectionHeader
              as="h2"
              title={fm('title')}
              icon={Hourglass}
              className="flex-wrap gap-2"
              right={<span className={cn('text-[11px] text-right', DIM)} title={fm('hint')}>{fm('note')}</span>}
            />
            {freeBaseLine()}
            {freeBody()}
          </WidgetCard>
        </div>

        <div data-testid="summary-frequency">
          <WidgetCard>
            <SectionHeader as="h2" title={s('card_frequency_bars')} icon={Repeat} className="flex-wrap gap-2" right={<span className={cn('text-[11px] text-right', DIM)}>{k('use_note', { use: useName })}</span>} />
            <StackedMonthColumns
              label={s('card_frequency_bars')}
              testId="summary-frequency-columns"
              mode="share"
              columns={freqColumns}
              axisTop="100%"
              loading={!input.bank && !input.bankFailed}
              legend={BAND_KEYS.map((key) => ({ key, label: bandLabel(key), className: BAND_FILL[key] }))}
            />
          </WidgetCard>
        </div>
      </div>

      <MonthGrid
        testId="summary-cohort-heat"
        title={s('card_cohort_heat')}
        icon={Sparkles}
        right={
          <span className={cn('text-[11px] text-right', DIM)}>
            {k('cohort_note')}
            {!props.curve.points && <span className="block" data-testid="summary-curve-gate">{s('curve_gate', { n: props.curve.closed })}</span>}
          </span>
        }
        months={props.heatMonths}
        groups={props.heatGroups}
        metricLabel={k('col_metric')}
        ga4Badge={k('ga4_badge')}
        ga4BadgeHint={props.ga4BadgeHint}
        footer={
          <div className="space-y-4">
            <ul className={cn('flex flex-wrap gap-x-4 gap-y-1 text-[10px]', DIM)} data-testid="summary-heat-legend">
              {HEAT_TONES.map((tone, i) => (
                <li key={tone} className="flex items-center gap-1.5">
                  <span aria-hidden="true" className={cn('h-3 w-3 rounded-sm', tone)} />
                  {s(`scale_legend.s${i}`)}
                </li>
              ))}
            </ul>
            {props.curve.points && (
              <div className="max-w-sm" data-testid="summary-curve">
                <p className={cn('text-[11px] font-bold', DIM)}>{s('curve_title', { n: props.curve.closed })}</p>
                <div className="mt-2 h-8 w-full">
                  <Sparkline
                    points={props.curve.points}
                    title={props.curve.points.map((v, i) => `D${[1, 7, 30, 60, 90][i]}: ${v === null ? UNKNOWN_VALUE : fmt.percent.format(v)}`).join(' · ')}
                  />
                </div>
                <div className={cn('mt-1 flex justify-between text-[10px] font-bold', DIM)} aria-hidden="true">
                  {['D1', 'D7', 'D30', 'D60', 'D90'].map((d) => (
                    <span key={d}>{d}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        }
      />

      <p className={cn('text-[10px] font-bold uppercase tracking-widest', DIM)} data-testid="summary-detail-divider">
        {s('detail_divider')}
      </p>
    </section>
  )
}

export default EngagementSummary
