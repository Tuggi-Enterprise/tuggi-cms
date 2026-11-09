'use client'

import { useMemo, type ReactNode } from 'react'
import { Car, CreditCard, Filter, Hourglass, Repeat, Smartphone, Sparkles, Undo2, Users } from 'lucide-react'

import { WidgetCard, SectionHeader } from '@/components/dashboard/WidgetCard'
import { RankRow } from '@/components/dashboard/reports/acquisition/RankRow'
import { BranchFunnel, type BranchFunnelBranch } from '@/components/dashboard/reports/engagement/BranchFunnel'
import { FunnelBands, type FunnelBand } from '@/components/dashboard/reports/engagement/FunnelBands'
import { Ga4Badge, MonthGrid, type MonthGridGroup } from '@/components/dashboard/reports/engagement/MonthGrid'
import { StackedMonthColumns, type StackedColumn } from '@/components/dashboard/reports/engagement/StackedMonthColumns'
import { SummaryTile } from '@/components/dashboard/reports/engagement/SummaryTile'
import { CardError } from '@/components/admin/social/shared'
import { Button } from '@/components/ui/button'
import { DIM } from '@/components/ui/dense-table'
import { StatCardRow } from '@/components/ui/StatCard'
import { Sparkline } from '@/components/ui/Sparkline'
import { CHART_COLORS, CHART_NEUTRAL } from '@/lib/constants/chart-colors'
import { formatDurationOrDash } from '@/lib/format/duration'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import { cn } from '@/lib/utils'
import { rateCount, type Cell, type CellFormatters } from '@/lib/engagement/cells'
import { readPurchaseFunnel, readUseFunnel, type ConversionFunnel, type PurchaseBranch } from '@/lib/conversion/funnel'
import { readFreeMinutes, type FreeMinutesHistogram, type FreeMinutesMark } from '@/lib/engagement/free-minutes'
import { METERING_LEDGER_START } from '@/lib/ranking/metering'
import {
  BAND_KEYS,
  buildSummary,
  formatDelta,
  MODE_KEYS,
  modesSplitSince,
  newEngagedCell,
  SUPPRESSED_SEGMENT,
  UNSPLIT_SEGMENT,
  type MonthColumn,
  type SummaryInput,
  type SummaryTileData,
  type TileKey,
} from '@/lib/engagement/summary'

/**
 * The executive summary on top of the Engagement report (#1099, spec-cms-relatorio-engajamento-2026-11
 * Parte B, Parte C since #1101): the month line, four tiles, ways of use beside days of use, the use
 * funnel beside the purchase funnel, and the cohort heat map. Every number comes from
 * `lib/engagement/summary.ts` and `lib/conversion/funnel.ts`; this translates and lays out.
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
  /** `YYYY-MM-DD` as the report prints a day. */
  day: (iso: string) => string
  onBankRetry: () => void
  onGa4Retry: () => void
  ga4BadgeHint: string
  /** The cohort heat map rows, already toned by the report (`heatTone`). */
  heatGroups: MonthGridGroup[]
  heatMonths: { key: string; label: string; untilToday: string | null }[]
  curve: { closed: number; points: (number | null)[] | null }
  /** `core.dashboard_conversion_funnel` of the month, the source of both funnels (#1101). */
  conversion?: ConversionFunnel
  conversionFailed: boolean
  onConversionRetry: () => void
  /** `core.cms_get_free_minutes_histogram` of the month (#1156); `null` = not deployed, `undefined` = loading. */
  freeMinutes?: FreeMinutesHistogram | null
  freeMinutesFailed: boolean
  onFreeMinutesRetry: () => void
  /** Any filter of the bar: the funnels count the whole cohort and refuse it (§C1 item 8). */
  filtered: boolean
  onClearFilters: () => void
}

const TILE_ICONS: Record<TileKey, typeof Users> = { engaged: Users, guide_median: Car, screen_minutes: Smartphone, returned: Undo2 }

/** Modes, bottom to top (spec §B5); the grey of a month not split yet (§C4.1). */
const MODE_COLORS: Record<string, string> = {
  drive_only: CHART_COLORS.blue,
  both: CHART_COLORS.purple,
  explore_only: CHART_COLORS.orange,
  [UNSPLIT_SEGMENT]: CHART_NEUTRAL,
}

/** The two branches of the purchase funnel, the colour of their trunk part (§C6, DS-COMPONENTE-101 item 4). */
const BRANCH_COLORS = { tested: CHART_COLORS.blue, untested: CHART_COLORS.orange } as const

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

  /** The n beside the return rate (#1154): "25 of the 231 who listened in Oct", or the base alone without a rate. */
  const returnedN = (t: SummaryTileData, nBase: string) => {
    const rc = hasValue(t.point.cell) ? rateCount(t.point.cell.value as number, t.point.base) : null
    const values = { n: nBase, use: useName, month: monthHeader(t.month) }
    return rc ? s('tiles.returned_n', { ...values, count: fmt.integer.format(rc.count) }) : s('tiles.returned_n_plain', values)
  }

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
      case 'new':
        delta = { text: s('delta_none'), title: s('delta_none_hint', { month: monthLong(d.prev.month) }) }
        break
      case 'closes': {
        // day and month on the line, which truncates at 390 with the year; the whole date in the title
        const short = d.due ? new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(new Date(`${d.due}T12:00:00Z`)) : ''
        delta = { text: s('tiles.returned_closes', { date: short }), title: s('tiles.returned_closes_hint', { month: monthLong(t.month), date: d.due ? day(d.due) : '' }) }
        break
      }
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
            ? returnedN(t, nBase)
            : s(`tiles.${t.key}_n`, { n: nBase })
      n = text
    }
    const series = t.spark.map((p) => `${monthHeader(p.month)}: ${p.value === null ? UNKNOWN_VALUE : tileValue(t.key, p.value)}`).join(' · ')
    return {
      testId: `summary-tile-${t.key}`,
      icon: TILE_ICONS[t.key],
      label: s(`tiles.${t.key}`),
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
      title:
        seg.key === UNSPLIT_SEGMENT
          ? s('modes.unsplit_title', { n: countText(seg.cell) })
          : hasValue(seg.cell)
            ? s('segment_title', { segment: modeLabel(seg.key), n: countText(seg.cell) })
            : (titleOf(seg.cell, 'bank') ?? ''),
    }),
    (c) => {
      const by = Object.fromEntries(c.segments.map((x) => [x.key, countText(x.cell)]))
      if (by[UNSPLIT_SEGMENT]) return `${monthHeader(c.month)}: ${s('modes.unsplit_title', { n: by[UNSPLIT_SEGMENT] })}`
      return s('modes_sr', { month: monthHeader(c.month), drive: by.drive_only, both: by.both, explore: by.explore_only })
    }
  )
  const splitSince = modesSplitSince(input)

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

  // ── Funnels (#1101 §C5, §C6) ──
  const conv = props.conversionFailed ? undefined : props.conversion
  const convLoading = !conv && !props.conversionFailed
  const pct = (v: number | null) => (v === null ? UNKNOWN_VALUE : fmt.percent.format(v))
  const int = (v: number | null) => (v === null ? UNKNOWN_VALUE : fmt.integer.format(v))
  const u = (key: string, values?: Record<string, string | number>) => s(`use_funnel.${key}`, values)
  const pf = (key: string, values?: Record<string, string | number>) => s(`purchase_funnel.${key}`, values)
  const noBank = s('tiles.no_source_bank')
  const ledgerDay = new Date(METERING_LEDGER_START).toISOString().slice(0, 10)
  const ga4Tag = { text: k('ga4_badge'), hint: props.ga4BadgeHint }

  const engagedCell = newEngagedCell(month, input)
  const useLoading = convLoading || engagedCell.state === 'loading'
  const useView = conv ? readUseFunnel(conv, hasValue(engagedCell) ? (engagedCell.value as number) : null) : undefined

  const bandsOfUse = (f: ConversionFunnel, v: NonNullable<typeof useView>) => {
    const split = { ios: fmt.integer.format(f.installs.ios ?? 0), android: fmt.integer.format(f.installs.android ?? 0) }
    // DS-COMPONENTE-084 item 1: unknown, floor and measured print differently.
    const installsNote = v.installs === 'unknown' ? u('installs_unknown') : u(v.installs === 'floor' ? 'installs_floor' : 'installs_split', split)
    const head: FunnelBand = {
      key: 'installs',
      label: u('installs'),
      hint: u('installs_hint'),
      value: v.installs === 'unknown' ? null : f.installs.total,
      display: v.installs === 'unknown' ? UNKNOWN_VALUE : int(f.installs.total),
      note: installsNote,
      noteShort: installsNote,
      fill: 'outline',
      muted: v.installs === 'unknown',
      tag: ga4Tag,
    }
    const parts =
      v.guest === null
        ? undefined
        : [
            { key: 'account', value: f.account, fill: CHART_COLORS.blue, title: u('part_account', { n: int(f.account) }) },
            { key: 'guest', value: v.guest, fill: `${CHART_COLORS.blue}40`, title: u('part_guest', { n: int(v.guest) }) },
          ]
    const engagedReason = hasValue(engagedCell) ? undefined : titleOf(engagedCell, 'ga4')
    const engagedValue = hasValue(engagedCell) ? (engagedCell.value as number) : null
    const used = f.usedGuideOrStory
    const consumed = f.consumed1h
    const steps: FunnelBand[] = [
      {
        key: 'entered',
        label: u('entered'),
        hint: v.guest === null ? noBank : u('entered_hint'),
        value: f.entered,
        display: int(f.entered),
        // DS-COMPONENTE-084 item 2: entered = 0 prints no rate.
        note: v.rates.account === null ? UNKNOWN_VALUE : u('with_account', { n: int(f.account), pct: pct(v.rates.account) }),
        noteShort: pct(v.rates.account),
        fill: CHART_COLORS.blue,
        parts,
      },
      {
        key: 'new_engaged',
        label: u('new_engaged'),
        hint: engagedReason ?? u('new_engaged_hint'),
        value: engagedValue,
        display: int(engagedValue),
        note: engagedReason ?? u('new_engaged_sub'),
        fill: 'outline',
        muted: engagedValue === null,
        tag: ga4Tag,
      },
      {
        key: 'used',
        label: u('used'),
        hint: used === null ? noBank : u('used_hint'),
        value: used,
        display: int(used),
        // BR-COMUNICACAO-022 item 4: a function before #1100 prints "no data", never 0.
        note: used === null ? noBank : v.rates.used === null ? UNKNOWN_VALUE : u('of_entered', { pct: pct(v.rates.used) }),
        noteShort: used === null ? undefined : pct(v.rates.used),
        fill: CHART_COLORS.blue,
        muted: used === null,
      },
      {
        key: 'consumed_1h',
        label: u('consumed_1h'),
        hint: consumed === null ? noBank : v.consumed1hFloor ? `${u('consumed_1h_hint')} ${u('consumed_1h_floor', { date: day(ledgerDay) })}` : u('consumed_1h_hint'),
        value: consumed,
        display: consumed === null ? UNKNOWN_VALUE : `${v.consumed1hFloor ? '≥ ' : ''}${int(consumed)}`,
        // DS-COMPONENTE-101 item 2: a share of entered only, never of the step above.
        note: consumed === null ? noBank : v.rates.consumed1h === null ? UNKNOWN_VALUE : u('of_entered', { pct: pct(v.rates.consumed1h) }),
        noteShort: consumed === null ? undefined : pct(v.rates.consumed1h),
        fill: CHART_COLORS.blue,
        muted: consumed === null,
      },
    ]
    // The drop between instruments is a difference on the seam, never a rate (DS-COMPONENTE-084 item 2).
    const seam = v.notEntered === null ? undefined : { text: u('not_entered', { count: int(v.notEntered) }), hint: u('not_entered_hint') }
    return { head, steps, seam }
  }

  const purchaseView = conv ? readPurchaseFunnel(conv) : undefined
  const branchProps = (b: PurchaseBranch, view: NonNullable<typeof purchaseView>): BranchFunnelBranch => {
    const label = pf(b.key)
    const [ta, tb] = view.branches
    // DS-COMPONENTE-101 item 5: a branch field the source does not send prints "no data"; item 2: an empty branch has no rate.
    const rateTitle =
      b.size === null || (b.size > 0 && b.bought === null)
        ? noBank
        : b.size === 0
          ? pf('empty_branch')
          : view.smallBase
            ? pf('small_base', { a: int(ta.size), b: int(tb.size) })
            : undefined
    return {
      key: b.key,
      color: BRANCH_COLORS[b.key],
      label,
      hint: pf(`${b.key}_hint`),
      sizeNumber: int(b.size),
      sizeRest: b.size === null ? undefined : pf('size_share', { pct: pct(b.share) }),
      sizeTitle: b.size === null ? noBank : undefined,
      fill: b.rate,
      rate: pct(b.rate),
      rateMuted: b.rate === null,
      rateTitle,
      rateCaption: pf(b.key === 'tested' ? 'rate_tested' : 'rate_untested'),
      badge: view.convertsMore === b.key ? pf('converts_more') : undefined,
      counts: b.bought === null || b.notBought === null ? UNKNOWN_VALUE : pf('counts', { bought: int(b.bought), not: int(b.notBought) }),
      countsMuted: b.bought === null || b.notBought === null,
      countsTitle: b.bought === null || b.notBought === null ? noBank : undefined,
      sr: pf('sr', { branch: label, n: int(b.size), bought: int(b.bought), pct: pct(b.rate) }),
    }
  }

  const trunkParts = (view: NonNullable<typeof purchaseView>) => {
    if (!view.split) return [{ key: 'all', fraction: view.entered > 0 ? 1 : 0, color: CHART_COLORS.blue, title: pf('no_split') }]
    return view.branches.map((b) => ({
      key: b.key,
      fraction: b.share ?? 0,
      color: BRANCH_COLORS[b.key],
      title: pf(b.key === 'tested' ? 'part_tested' : 'part_untested', { n: int(b.size), pct: pct(b.share) }),
    }))
  }

  /** The body both funnel cards share for a filter or a failed read (§C10). */
  const funnelGate = () => {
    if (props.filtered) {
      return (
        <div className="flex flex-col items-start gap-3 py-4" data-testid="funnel-filtered">
          <p className="text-sm text-gray-800 dark:text-gray-200">{u('no_filters')}</p>
          <Button type="button" variant="outline" size="sm" onClick={props.onClearFilters}>
            {k('clear_filters')}
          </Button>
        </div>
      )
    }
    if (props.conversionFailed) return <CardError onRetry={props.onConversionRetry} message={u('failed')} retryLabel={k('retry')} />
    return null
  }

  const useBody = () => {
    const gate = funnelGate()
    if (gate) return gate
    if (useLoading || !conv || !useView) return <FunnelBands label={u('title')} loading heads={1} steps={4} />
    const b = bandsOfUse(conv, useView)
    return (
      <>
        <FunnelBands label={u('title')} max={useView.max} head={b.head} seam={b.seam} steps={b.steps} />
        {useView.installs === 'floor' && <p className={cn('text-[11px] mt-2', DIM)}>{u('floor_note')}</p>}
      </>
    )
  }

  // ── Saw the paywall (#1156 §D3): GA4 devices of the whole month, beside the funnel and out of it ──
  const paywallMonth = input.ga4?.months.find((m) => m.month === month)
  const paywallValue = paywallMonth?.paywallViewedUsers ?? null
  const paywallLoading = !input.ga4 && !input.ga4Failed && !input.ga4Filtered
  const paywallLine = (
    <div className="mt-4 border-t border-dashed border-gray-200 pt-3 dark:border-gray-800" data-testid="purchase-paywall">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold text-gray-900 dark:text-white" title={pf('paywall_viewed_hint')}>
          {pf('paywall_viewed')}
          <Ga4Badge text={k('ga4_badge')} hint={props.ga4BadgeHint} />
        </span>
        {paywallLoading ? (
          <span className={cn(PULSE_BLOCK, 'h-4 w-10')} data-testid="purchase-paywall-loading" />
        ) : (
          // DS-COMPONENTE-084 item 2: a device count, no rate and no comparison with the bank.
          <span
            data-testid="purchase-paywall-value"
            className={cn('text-sm font-mono font-bold tabular-nums', paywallValue === null ? DIM : 'text-gray-900 dark:text-white')}
            title={paywallValue === null ? (input.ga4Failed ? k('cell_ga4_failed') : s('tiles.no_source_ga4')) : undefined}
          >
            {paywallValue === null ? UNKNOWN_VALUE : fmt.integer.format(paywallValue)}
          </span>
        )}
      </div>
      <p className={cn('text-[11px] leading-4', DIM)}>{pf('paywall_viewed_sub')}</p>
    </div>
  )

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

  const purchaseBody = () => {
    const gate = funnelGate()
    if (gate) return gate
    if (!purchaseView) return <BranchFunnel label={pf('title')} loading />
    return (
      <>
      <BranchFunnel
        label={pf('title')}
        trunk={{
          label: pf('entered'),
          display: int(purchaseView.entered),
          parts: trunkParts(purchaseView),
          purchased: pf('purchased_line', { n: int(purchaseView.purchased), pct: pct(purchaseView.purchasedRate) }),
        }}
        branches={purchaseView.branches.map((b) => branchProps(b, purchaseView))}
      />
      {paywallLine}
      </>
    )
  }

  // ── Panel ──
  const p = summary.panel
  const panelValue = (key: keyof typeof p) => {
    const c = p[key]
    if (!hasValue(c)) return { text: UNKNOWN_VALUE, title: titleOf(c, 'bank') }
    const v = c.value as number
    return { text: key === 'bg_share' ? fmt.percent.format(v) : key === 'fg' || key === 'bg' ? formatDurationOrDash(Math.round(v)) : fmt.integer.format(v) }
  }

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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
        <div data-testid="summary-modes">
          <WidgetCard>
            <SectionHeader
              as="h2"
              title={s('card_modes')}
              icon={Car}
              className="flex-wrap gap-2"
              right={
                <span className={cn('text-[11px] text-right', DIM, !input.bank && 'invisible')} data-testid="summary-modes-note">
                  {splitSince ? s('modes_note', { month: monthHeader(splitSince) }) : s('modes_note_none')}
                </span>
              }
            />
            <StackedMonthColumns
              label={s('card_modes')}
              testId="summary-modes-columns"
              columns={modeColumns}
              axisTop={fmt.integer.format(summary.modes.top)}
              loading={!input.bank && !input.bankFailed}
              legend={[...MODE_KEYS, UNSPLIT_SEGMENT].map((key) => ({ key, label: modeLabel(key === UNSPLIT_SEGMENT ? 'unsplit' : key), color: MODE_COLORS[key] }))}
            />
            <ul className={cn('mt-3 space-y-1 text-[11px] leading-4', DIM)} data-testid="summary-modes-help">
              {MODE_KEYS.map((key) => (
                <li key={key}>
                  <span className="font-semibold text-gray-700 dark:text-gray-300">{modeLabel(key)}:</span> {s(`modes.help_${key}`)}
                </li>
              ))}
            </ul>
            <dl className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-3" data-testid="summary-modes-panel">
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
        <div className="space-y-6">
          <div data-testid="summary-use-funnel">
            <WidgetCard>
              <SectionHeader as="h2" title={u('title')} icon={Filter} className="flex-wrap gap-2" right={<span className={cn('text-[11px] text-right', DIM)}>{u('note')}</span>} />
              {useBody()}
            </WidgetCard>
          </div>

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
        </div>

        <div id="conversion" className="scroll-mt-6" data-testid="summary-purchase-funnel">
          <WidgetCard>
            <SectionHeader as="h2" title={pf('title')} icon={CreditCard} className="flex-wrap gap-2" right={<span className={cn('text-[11px] text-right', DIM)}>{pf('note')}</span>} />
            {purchaseBody()}
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
