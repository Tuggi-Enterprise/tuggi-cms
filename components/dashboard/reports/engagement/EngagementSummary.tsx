'use client'

import { useMemo, type ReactNode } from 'react'
import { Car, Filter, Repeat, Smartphone, Sparkles, Undo2, Users } from 'lucide-react'

import { WidgetCard, SectionHeader } from '@/components/dashboard/WidgetCard'
import { FunnelBands, type FunnelBand } from '@/components/dashboard/reports/conversion/FunnelBands'
import { Ga4Badge, MonthGrid, type MonthGridGroup } from '@/components/dashboard/reports/engagement/MonthGrid'
import { StackedMonthColumns, type StackedColumn } from '@/components/dashboard/reports/engagement/StackedMonthColumns'
import { SummaryTile } from '@/components/dashboard/reports/engagement/SummaryTile'
import { CardError } from '@/components/admin/social/shared'
import { DIM } from '@/components/ui/dense-table'
import { StatCardRow } from '@/components/ui/StatCard'
import { Sparkline } from '@/components/ui/Sparkline'
import { CHART_COLORS, CHART_NEUTRAL } from '@/lib/constants/chart-colors'
import { formatDurationOrDash } from '@/lib/format/duration'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import { cn } from '@/lib/utils'
import type { Cell, CellFormatters } from '@/lib/engagement/cells'
import {
  BAND_KEYS,
  buildSummary,
  formatDelta,
  MODE_KEYS,
  SUPPRESSED_SEGMENT,
  type MonthColumn,
  type SummaryInput,
  type SummaryTileData,
  type TileKey,
} from '@/lib/engagement/summary'

/**
 * The executive summary on top of the Engagement report (#1099, spec-cms-relatorio-engajamento-2026-11
 * Parte B): the month line, four tiles, ways of use, the month funnel, days of use and the cohort
 * heat map. Every number comes from `lib/engagement/summary.ts`; this translates and lays out.
 */

type K = (key: string, values?: Record<string, string | number>) => string

export interface EngagementSummaryProps {
  k: K
  locale: string
  fmt: CellFormatters
  input: SummaryInput
  useName: string
  onMonthChange: (month: string) => void
  /** Why a cell is empty, by source; `undefined` for a measured one. */
  cellTitle: (c: Cell, source: 'bank' | 'ga4') => string | undefined
  monthHeader: (month: string) => string
  /** `set`: the month alone, for the change line of a tile, which has no room for the year at 390. */
  monthShort: (month: string) => string
  monthLong: (month: string) => string
  day: (iso: string) => string
  onBankRetry: () => void
  onGa4Retry: () => void
  ga4BadgeHint: string
  /** The cohort heat map rows, already toned by the report (`heatTone`). */
  heatGroups: MonthGridGroup[]
  heatMonths: { key: string; label: string; untilToday: string | null }[]
  curve: { closed: number; points: (number | null)[] | null }
}

const TILE_ICONS: Record<TileKey, typeof Users> = { engaged: Users, guide_median: Car, screen_minutes: Smartphone, returned: Undo2 }

/** Modes, bottom to top (spec §B5). */
const MODE_COLORS: Record<string, string> = { drive_only: CHART_COLORS.blue, both: CHART_COLORS.purple, explore_only: CHART_COLORS.orange }

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

const hasValue = (c: Cell) => (c.state === 'measured' || c.state === 'floor') && c.value !== null

export function EngagementSummary(props: EngagementSummaryProps) {
  const { k, locale, fmt, input, useName, cellTitle, monthHeader, monthShort, monthLong, day } = props
  const s = (key: string, values?: Record<string, string | number>) => k(`summary.${key}`, values)
  const summary = useMemo(() => buildSummary(input), [input])
  const current = input.today.slice(0, 7)
  const month = summary.month
  const ga4Down = input.ga4Failed && !input.ga4Filtered

  const titleOf = (c: Cell, source: 'bank' | 'ga4') =>
    c.state === 'no_source' ? s(source === 'bank' ? 'tiles.no_source_bank' : 'tiles.no_source_ga4') : cellTitle(c, source)

  const tileValue = (key: TileKey, v: number) =>
    key === 'engaged' ? fmt.integer.format(v) : key === 'returned' ? fmt.percent.format(v) : formatDurationOrDash(Math.round(v))

  const printed = (t: SummaryTileData, c: Cell) => (hasValue(c) ? `${c.state === 'floor' ? '≥ ' : ''}${tileValue(t.key, c.value as number)}` : UNKNOWN_VALUE)

  const tileProps = (t: SummaryTileData) => {
    const d = t.delta
    const signed = formatDelta(d, locale, (n) => s('delta_pt', { n }))
    const bases = { n_prev: d.prev.base === null ? UNKNOWN_VALUE : fmt.integer.format(d.prev.base), n_curr: d.curr.base === null ? UNKNOWN_VALUE : fmt.integer.format(d.curr.base) }
    const hint = s('delta_hint', { prev: printed(t, d.prev.cell), curr: printed(t, d.curr.cell), ...bases })
    let delta: { text: string; title?: string }
    switch (d.state) {
      case 'up':
      case 'down':
        delta = { text: s('delta_vs', { delta: signed ?? '', month: monthShort(d.prev.month) }), title: hint }
        break
      case 'flat':
        delta = { text: s('delta_flat'), title: hint }
        break
      case 'small_base':
        delta = { text: signed ?? '', title: s('delta_small_base', bases) }
        break
      case 'partial':
        delta = { text: k('until_today'), title: s('delta_partial') }
        break
      default: {
        const missing = hasValue(d.curr.cell) ? d.prev.cell : d.curr.cell
        delta = { text: UNKNOWN_VALUE, title: titleOf(missing, t.source) }
      }
    }
    const nBase = t.point.base === null ? null : fmt.integer.format(t.point.base)
    const badge = t.source === 'ga4' ? <Ga4Badge text={k('ga4_badge')} hint={props.ga4BadgeHint} /> : null
    let n: ReactNode = null
    if (nBase !== null) {
      const text =
        t.key === 'engaged'
          ? t.share !== null
            ? s('tiles.engaged_n', { pct: fmt.percent.format(t.share), n: nBase })
            : s('tiles.engaged_n_plain', { n: nBase })
          : t.key === 'returned'
            ? s('tiles.returned_n', { n: nBase, use: useName, month: monthHeader(t.month) })
            : s(`tiles.${t.key}_n`, { n: nBase })
      n = text
    }
    const series = t.spark.map((p) => `${monthHeader(p.month)}: ${p.value === null ? UNKNOWN_VALUE : tileValue(t.key, p.value)}`).join(' · ')
    return {
      testId: `summary-tile-${t.key}`,
      icon: TILE_ICONS[t.key],
      label: s(`tiles.${t.key}`),
      monthTag: t.month !== month ? monthHeader(t.month) : null,
      // the return tile may fall back to an older month and name it (DS-COMPONENTE-100 item 4)
      reserveMonthTag: t.key === 'returned',
      loading: t.point.cell.state === 'loading',
      value: printed(t, t.point.cell),
      valueMuted: !hasValue(t.point.cell),
      valueTitle: t.over ? s('tiles.engaged_over') : t.key === 'engaged' && hasValue(t.point.cell) ? s('tiles.engaged_hint') : titleOf(t.point.cell, t.source),
      delta: { state: d.state, ...delta },
      spark: { points: t.spark.map((p) => p.value), title: series },
      n: (
        <>
          {n}
          {badge}
        </>
      ),
    }
  }

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
  const modeLabel = (key: string) => s(`modes.${key}`)
  const modeColumns = monthCols(
    summary.modes.columns,
    (seg) => ({
      key: seg.key,
      fraction: seg.fraction,
      color: MODE_COLORS[seg.key],
      title: hasValue(seg.cell) ? s('segment_title', { segment: modeLabel(seg.key), n: countText(seg.cell) }) : (titleOf(seg.cell, 'bank') ?? ''),
    }),
    (c) => {
      const by = Object.fromEntries(c.segments.map((x) => [x.key, countText(x.cell)]))
      return s('modes_sr', { month: monthHeader(c.month), drive: by.drive_only, both: by.both, explore: by.explore_only })
    }
  )

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

  // ── Funnel ──
  const f = summary.funnel
  const funnelLoading = f.steps.some((x) => x.cell.state === 'loading')
  const band = (key: (typeof f.steps)[number]['key']): FunnelBand => {
    const step = f.steps.find((x) => x.key === key)!
    const value = step.value
    const display = value === null ? UNKNOWN_VALUE : fmt.integer.format(value)
    const reason = value === null ? titleOf(step.cell, step.source) : undefined
    const pct = step.rate === null ? null : fmt.percent.format(step.rate)
    let note: string | undefined
    let noteShort: string | undefined
    // Below md the reason has no room beside the label: the dash stays, the label's title says why.
    if (reason) note = reason
    else if (key === 'opened') note = noteShort = s('steps.opened_sub')
    else if (key === 'used') note = noteShort = s('steps.used_sub')
    else if (pct) {
      note = s(key === 'engaged' ? 'of_opened' : 'of_used', { pct, use: useName })
      noteShort = pct
    }
    const labels = {
      opened: s('steps.opened'),
      engaged: s('steps.engaged'),
      used: useName.charAt(0).toLocaleUpperCase(locale) + useName.slice(1),
      returned: s('steps.returned'),
    }
    return {
      key,
      label: labels[key],
      hint: reason ?? (key === 'engaged' ? s('tiles.engaged_hint') : labels[key]),
      value,
      display,
      note,
      noteShort,
      fill: step.source === 'ga4' ? 'outline' : CHART_COLORS.blue,
      muted: value === null,
      badge: f.biggestDrop === key ? s('biggest_drop') : undefined,
    }
  }

  // ── Panel ──
  const p = summary.panel
  const panelValue = (key: keyof typeof p) => {
    const c = p[key]
    if (!hasValue(c)) return { text: UNKNOWN_VALUE, title: titleOf(c, 'bank') }
    const v = c.value as number
    return { text: key === 'bg_share' ? fmt.percent.format(v) : key === 'fg' || key === 'bg' ? formatDurationOrDash(Math.round(v)) : fmt.integer.format(v) }
  }
  const openSince = input.bank?.data_since.open

  return (
    <section data-testid="engagement-summary" className="space-y-6" aria-labelledby="engagement-summary-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="engagement-summary-title" className="text-xs font-black uppercase tracking-widest text-gray-700 dark:text-gray-300">
          {s('title', { month: monthLong(month) })}
        </h2>
        <span className="flex flex-wrap items-center gap-2">
          <label>
            <span className="sr-only">{s('month_label')}</span>
            <select
              data-testid="summary-month"
              value={month}
              onChange={(e) => props.onMonthChange(e.target.value)}
              className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm font-semibold text-gray-900 dark:text-white"
            >
              {[...input.months].reverse().map((m) => (
                <option key={m} value={m}>
                  {m === current ? `${monthLong(m)} (${k('until_today')})` : monthLong(m)}
                </option>
              ))}
            </select>
          </label>
          <span className={cn('text-[11px]', DIM)}>{month === current ? k('until_today') : s('closed')}</span>
        </span>
      </div>

      {(input.bankFailed || ga4Down) && (
        <div className="space-y-2">
          {input.bankFailed && <CardError onRetry={props.onBankRetry} message={k('bank_failed')} retryLabel={k('retry')} />}
          {ga4Down && <CardError onRetry={props.onGa4Retry} message={k('ga4_failed')} retryLabel={k('retry')} />}
        </div>
      )}

      <StatCardRow columns={4}>
        {summary.tiles.map((t) => (
          <SummaryTile key={t.key} {...tileProps(t)} />
        ))}
      </StatCardRow>

      <div data-testid="summary-modes">
        <WidgetCard>
          <SectionHeader
            as="h2"
            title={s('card_modes')}
            icon={Car}
            className="flex-wrap gap-2"
            right={<span className={cn('text-[11px] text-right', DIM, !openSince && 'invisible')}>{s('modes_note', { date: openSince ? day(openSince) : '00/00/0000' })}</span>}
          />
          <div className="space-y-4 lg:grid lg:grid-cols-[1fr_280px] lg:gap-6 lg:space-y-0">
            <StackedMonthColumns
              label={s('card_modes')}
              testId="summary-modes-columns"
              columns={modeColumns}
              axisTop={fmt.integer.format(summary.modes.top)}
              loading={!input.bank && !input.bankFailed}
              legend={MODE_KEYS.map((key) => ({ key, label: modeLabel(key), color: MODE_COLORS[key] }))}
            />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 self-start" data-testid="summary-modes-panel">
              {(['drive_only', 'explore_only', 'both', 'fg', 'bg', 'bg_share'] as const).map((key) => {
                const v = panelValue(key)
                return (
                  <div key={key}>
                    <dt className={cn('text-[10px] font-bold uppercase tracking-widest', DIM)}>{modeLabel(key)}</dt>
                    <dd className={cn('text-lg font-black tabular-nums', v.title ? DIM : 'text-gray-900 dark:text-white')} title={v.title}>
                      {v.text}
                    </dd>
                  </div>
                )
              })}
            </dl>
          </div>
        </WidgetCard>
      </div>

      <div data-testid="summary-funnel">
        <WidgetCard>
          <SectionHeader as="h2" title={s('card_funnel')} icon={Filter} className="flex-wrap gap-2" right={<span className={cn('text-[11px] text-right', DIM)}>{s('funnel_note')}</span>} />
          {funnelLoading ? (
            <FunnelBands label={s('card_funnel')} loading heads={2} steps={2} />
          ) : (
            <FunnelBands label={s('card_funnel')} max={f.max} head={[band('opened'), band('engaged')]} steps={[band('used'), band('returned')]} />
          )}
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
