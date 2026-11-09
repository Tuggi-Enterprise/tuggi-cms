'use client'

import { useMemo, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { ArrowDown, ArrowUp, Gauge } from 'lucide-react'

import { BranchFunnel, type BranchFunnelBranch } from '@/components/dashboard/reports/engagement/BranchFunnel'
import { Ga4Badge } from '@/components/dashboard/reports/engagement/MonthGrid'
import { QuestionCard, type QuestionLegendItem } from '@/components/dashboard/reports/engagement/QuestionCard'
import { STAT_BADGE, StatLine } from '@/components/dashboard/reports/engagement/StatLine'
import { MONTH_BARS_PX, stepFunnelHeight, type MonthBarsRow, type MonthBarsSeries, type StepFunnelRow } from '@/components/dashboard/reports/engagement/question-charts'
import { CardError } from '@/components/admin/social/shared'
import { Button } from '@/components/ui/button'
import { DIM } from '@/components/ui/dense-table'
import { CHART_COLORS, CHART_NEUTRAL } from '@/lib/constants/chart-colors'
import { formatDuration } from '@/lib/format/duration'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import { cn } from '@/lib/utils'
import type { Cell } from '@/lib/engagement/cells'
import { answerOf, firstSentence, type Answer, type AnswerValue } from '@/lib/engagement/answers'
import { buildBlocks, buildPaywallFunnel, buildUseFunnel, chartMonths, freeBeforeCell, type QuestionBlock, type QuestionsInput, type Stat, type StatKind } from '@/lib/engagement/blocks'
import { pickHeadlines } from '@/lib/engagement/headlines'
import { addMonths } from '@/lib/engagement/months'
import { formatDelta, SUMMARY_MIN_BASE, type TileDelta } from '@/lib/engagement/summary'
import { readPurchaseFunnel, type FunnelStep, type PurchaseBranch, type StepFunnelView } from '@/lib/conversion/funnel'

/**
 * Block 0, the two funnels and the question blocks 1 to 4 of the Engagement page (#1161, spec Parte E
 * §E2 to §E6). Every number comes from `lib/engagement/blocks.ts`, every sentence from `answers.ts`,
 * the three lines on top from `headlines.ts`; this translates and lays out. The charts are recharts,
 * each module behind `next/dynamic` with a skeleton of the final height, so the page does not jump.
 */

// recharts out of the initial JS (spec §E1 item 4): the whole chart module, never a `Bar`.
const MonthBars = dynamic(() => import('@/components/dashboard/reports/engagement/MonthBars').then((m) => m.MonthBars), {
  ssr: false,
  loading: () => <div className="animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" style={{ height: MONTH_BARS_PX }} />,
})
const StepFunnel = dynamic(() => import('@/components/dashboard/reports/engagement/StepFunnel').then((m) => m.StepFunnel), {
  ssr: false,
  loading: () => <div className="animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" style={{ height: stepFunnelHeight(7) }} />,
})

type K = (key: string, values?: Record<string, string | number>) => string

export interface EngagementQuestionsProps {
  k: K
  locale: string
  input: QuestionsInput
  monthHeader: (month: string) => string
  monthShort: (month: string) => string
  /** The month by name, without the year ("outubro"), for the sentences (copy §0). */
  monthName: (month: string) => string
  day: (iso: string) => string
  onBankRetry: () => void
  onGa4Retry: () => void
  onUsageRetry: () => void
  onConversionRetry: () => void
  onClearFilters: () => void
  ga4BadgeHint: string
}

/** Series colours (spec §E4). */
const FIRST_DAY_COLORS: Record<string, string> = {
  guide: CHART_COLORS.blue,
  story_only: CHART_COLORS.purple,
  explore_only: CHART_COLORS.orange,
  nothing: CHART_NEUTRAL,
  rest: '#d6d3d1',
}
const FIRST_DAY_LABELS: Record<string, string> = {
  guide: 'questions.block_1.day_guide',
  story_only: 'questions.block_1.day_story',
  explore_only: 'questions.block_1.day_map',
  nothing: 'questions.block_1.day_nothing',
  rest: 'questions.block_1.day_rest',
}
const MODE_COLORS: Record<string, string> = { drive_only: CHART_COLORS.blue, both: CHART_COLORS.purple, explore_only: CHART_COLORS.orange, trip_total: CHART_NEUTRAL }
const MODE_LABELS: Record<string, string> = { drive_only: 'summary.modes.drive_only', both: 'summary.modes.both', explore_only: 'summary.modes.explore_only', trip_total: 'summary.modes.unsplit' }
const SCREEN_COLORS: Record<string, string> = { on_screen: CHART_COLORS.blue, off_screen: `${CHART_COLORS.blue}40` }
const SCREEN_LABELS: Record<string, string> = { on_screen: 'questions.block_3.on_screen', off_screen: 'questions.block_3.off_screen' }
/** Ordinal, faster darker (spec §E4). */
const MOVEMENT_COLORS: Record<string, string> = { vehicle: '#082f49', walking: '#0369a1', stopped: '#38bdf8' }
const MOVEMENT_LABELS: Record<string, string> = { vehicle: 'questions.block_4.vehicle', walking: 'questions.block_4.walking', stopped: 'questions.block_4.stopped' }
const BRANCH_COLORS = { tested: CHART_COLORS.blue, untested: CHART_COLORS.orange } as const
const BLOCK_TITLES: Record<QuestionBlock['key'], string> = {
  block_1: 'questions.block_1.title',
  block_2: 'questions.block_2.title',
  block_3: 'questions.block_3.title',
  block_4: 'questions.block_4.title',
}

const has = (c: Cell) => (c.state === 'measured' || c.state === 'floor') && c.value !== null

export function EngagementQuestions(props: EngagementQuestionsProps) {
  const { k, locale, input, monthHeader, monthShort, monthName, day } = props
  const s = (key: string, values?: Record<string, string | number>) => k(`summary.${key}`, values)
  const q = (key: string, values?: Record<string, string | number>) => k(`questions.${key}`, values)
  const month = input.month
  const prevMonth = addMonths(month, -1)

  const fmt = useMemo(
    () => ({
      int: new Intl.NumberFormat(locale),
      pct: new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }),
      dec: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }),
    }),
    [locale]
  )
  const minutes = (v: number) => (v > 0 && v < 1 ? `${fmt.dec.format(v)} min` : formatDuration(Math.round(v)))
  const byKind = (kind: StatKind, v: number) => (kind === 'count' ? fmt.int.format(v) : kind === 'rate' ? fmt.pct.format(v) : kind === 'minutes' ? minutes(v) : fmt.dec.format(v))
  const valueText = (a: AnswerValue): string =>
    a.kind === 'pct' ? fmt.pct.format(a.value) : a.kind === 'int' ? fmt.int.format(a.value) : a.kind === 'minutes' ? minutes(a.value) : a.kind === 'km' ? fmt.dec.format(a.value) : monthName(a.value)

  const blocks = useMemo(() => buildBlocks(input), [input])
  const useFunnel = useMemo(() => buildUseFunnel(input), [input])
  const paywall = useMemo(() => buildPaywallFunnel(input), [input])

  const ga4Badge = <Ga4Badge text={k('ga4_badge')} hint={props.ga4BadgeHint} />
  const reasonTitle = (c: Cell, source: 'bank' | 'ga4'): string | undefined => {
    switch (c.state) {
      case 'before_source':
        return source === 'ga4' ? s('tiles.no_source_ga4') : c.since ? k('cell_before_source', { date: day(c.since) }) : k('cell_before_source_none')
      case 'ga4_filter':
        return source === 'ga4' ? k('cell_ga4_filter') : q('common.no_filter_source')
      case 'source_failed':
        return source === 'ga4' ? k('cell_ga4_failed') : k('cell_bank_failed')
      case 'no_source':
        return source === 'ga4' ? s('tiles.no_source_ga4') : s('tiles.no_source_bank')
      case 'floor':
        return q('common.floor_hint')
      default:
        return undefined
    }
  }

  const renderAnswer = (a: Answer | null): string | null => {
    if (!a) return null
    const values: Record<string, string | number> = {}
    // an integer goes as a number, so the plural of the copy chooses its form
    for (const [key, v] of Object.entries(a.values)) values[key] = v.kind === 'int' ? v.value : valueText(v)
    const cmp = a.cmp
      ? k(a.cmp.key, { prev: a.cmp.prev ? byKind(a.cmp.prev.kind, a.cmp.prev.value) : UNKNOWN_VALUE, prev_month: monthName(a.cmp.prevMonth) })
      : ''
    const text = k(a.key, { ...values, cmp })
    return a.floor ? `${text} ${q('common.floor_sentence')}` : text
  }

  const deltaOf = (d: TileDelta | null): { state: TileDelta['state']; text: string; title?: string } | null => {
    if (!d) return null
    const signed = formatDelta(d, locale, (n) => s('delta_pt', { n }))
    const bases = { n_prev: d.prev.base === null ? UNKNOWN_VALUE : fmt.int.format(d.prev.base), n_curr: d.curr.base === null ? UNKNOWN_VALUE : fmt.int.format(d.curr.base) }
    switch (d.state) {
      case 'up':
      case 'down':
        return { state: d.state, text: s('delta_vs', { delta: signed ?? '', month: monthShort(d.prev.month) }) }
      case 'flat':
        return { state: d.state, text: s('delta_flat') }
      case 'small_base':
        return { state: d.state, text: signed ?? '', title: s('delta_small_base', bases) }
      case 'partial':
        return { state: d.state, text: k('until_today'), title: s('delta_partial') }
      case 'new':
        return { state: d.state, text: s('delta_none'), title: s('delta_none_hint', { month: monthName(d.prev.month) }) }
      default:
        return null
    }
  }

  const statLine = (st: Stat, i: number, blockKey: string): ReactNode => {
    const c = st.cell
    const shown = has(c)
    const prefix = c.state === 'floor' && shown ? '≥ ' : ''
    const sign = st.signed && shown ? ((c.value as number) > 0 ? '+' : (c.value as number) < 0 ? '−' : '') : ''
    const value = shown ? `${prefix}${sign}${byKind(st.kind, Math.abs(st.signed ? (c.value as number) : (c.value as number)))}` : UNKNOWN_VALUE
    const badges = (
      <>
        {shown && st.small && (
          <span className={cn(STAT_BADGE, DIM)} title={q('common.sample_hint', { min: SUMMARY_MIN_BASE })} data-testid="stat-sample">
            {q('common.sample_badge')}
          </span>
        )}
        {c.state === 'floor' && (
          <span className={cn(STAT_BADGE, DIM)} title={st.hint && c.value === null ? k(st.hint) : q('common.floor_hint')} data-testid="stat-floor">
            {q('common.floor_badge')}
          </span>
        )}
      </>
    )
    return (
      <StatLine
        key={st.key}
        testId={`stat-${blockKey}-${i}`}
        label={k(st.key)}
        hint={st.hint ? k(st.hint) : undefined}
        labelBadge={st.source === 'ga4' ? ga4Badge : undefined}
        loading={c.state === 'loading'}
        value={value}
        valueMuted={!shown}
        valueTitle={shown ? undefined : reasonTitle(c, st.source)}
        pct={shown && st.pct !== null ? fmt.pct.format(st.pct) : null}
        denominator={st.pctOf ? k(st.pctOf) : null}
        badges={badges}
        delta={shown ? deltaOf(st.delta) : null}
      />
    )
  }

  // ── Charts ──
  const chartOf = (b: QuestionBlock, colors: Record<string, string>, labels: Record<string, string>, mode: 'expand' | 'stack' | 'group', format: (v: number) => string, axis: (v: number) => string) => {
    const series: MonthBarsSeries[] = b.series.map((key) => ({ key, label: k(labels[key]), color: colors[key] }))
    const rows: MonthBarsRow[] = b.chart.map((r) => ({
      month: r.month,
      label: monthHeader(r.month),
      short: monthShort(r.month),
      values: r.values,
      reason: r.reason ? (reasonTitle({ state: r.reason, value: null, share: null, since: null, due: null }, 'bank') ?? UNKNOWN_VALUE) : null,
    }))
    const legend: QuestionLegendItem[] = series.filter((x) => b.chart.some((r) => r.values[x.key] !== undefined && r.values[x.key] !== null)).map((x) => ({ key: x.key, label: x.label, color: x.color }))
    const chart = <MonthBars label={k(BLOCK_TITLES[b.key])} rows={rows} series={series} mode={mode} format={format} axis={axis} />
    return { chart, legend }
  }

  const failedChart = (retry: () => void) => (
    <div style={{ height: MONTH_BARS_PX }} className="flex items-center">
      <CardError onRetry={retry} message={q('common.answer_failed')} retryLabel={k('retry')} />
    </div>
  )

  const share = (v: number) => fmt.pct.format(v)
  const shareAxis = (v: number) => fmt.pct.format(v)
  const countAxis = (v: number) => fmt.int.format(v)

  const blockCard = (b: QuestionBlock, opts: { colors: Record<string, string>; labels: Record<string, string>; mode: 'expand' | 'stack' | 'group'; format: (v: number) => string; axis: (v: number) => string; retry: () => void; hint?: string; extra?: ReactNode }) => {
    const answer = answerOf(b, month)
    const text = b.status === 'loading' ? undefined : renderAnswer(answer)
    const { chart, legend } = chartOf(b, opts.colors, opts.labels, opts.mode, opts.format, opts.axis)
    const noSource = b.status === 'no_source' && b.key === 'block_4'
    return (
      <QuestionCard
        key={b.key}
        id={b.key.replace('_', '-')}
        testId={`question-${b.key}`}
        title={k(BLOCK_TITLES[b.key])}
        answer={
          text === undefined ? undefined : text === null ? null : (
            <>
              {text}
              {answer?.retry && (
                <Button type="button" variant="outline" size="sm" className="ml-2" onClick={opts.retry}>
                  {k('retry')}
                </Button>
              )}
            </>
          )
        }
        base={q(`${b.key}.base`, { month: monthName(month) })}
        stats={b.stats.map((st, i) => statLine(st, i, b.key))}
        chart={
          b.status === 'failed' ? (
            failedChart(opts.retry)
          ) : noSource ? (
            <div style={{ height: MONTH_BARS_PX }} className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 px-6 text-center dark:border-gray-700" data-testid="question-no-source">
              <Gauge className={cn('h-5 w-5', DIM)} aria-hidden="true" />
              <span className={cn('text-sm', DIM)}>{q('block_4.answer_no_source')}</span>
            </div>
          ) : (
            chart
          )
        }
        legend={b.status === 'failed' || noSource ? undefined : legend}
        hint={opts.hint}
      >
        {opts.extra}
      </QuestionCard>
    )
  }

  const [b1, b2, b3, b4] = blocks
  const b4Coverage = b4.facts.coverage
  const retryUsage = props.onUsageRetry

  // ── Block 0 ──
  const headlines = useMemo(() => pickHeadlines(blocks, month, input.today), [blocks, month, input.today])
  const anyLoading = blocks.some((b) => b.status === 'loading')
  const block0 = (
    <QuestionCard
      id="block-0"
      testId="question-block_0"
      title={q('block_0.title')}
      base={headlines.lines.length > 0 ? q('block_0.base', { prev_month: monthName(prevMonth) }) : undefined}
      answer={anyLoading ? undefined : null}
    >
      {!anyLoading && (
        <ol className="mt-3 space-y-2" data-testid="block-0-lines">
          {headlines.lines.length === 0 ? (
            <li className="text-sm leading-5 text-gray-900 dark:text-white" data-testid="block-0-empty" data-empty={headlines.empty ?? ''}>
              {headlines.empty === 'in_progress'
                ? q('block_0.in_progress', { date: headlines.closesOn ? day(headlines.closesOn) : '', prev_month: monthName(prevMonth) })
                : headlines.empty === 'no_previous'
                  ? q('block_0.no_previous', { prev_month: monthName(prevMonth) })
                  : headlines.empty === 'sample'
                    ? q('block_0.sample', { min: SUMMARY_MIN_BASE })
                    : q('block_0.steady', { prev_month: monthName(prevMonth) })}
            </li>
          ) : (
            headlines.lines.map((line) => {
              const b = blocks.find((x) => x.key === line.block)!
              const sentence = firstSentence(renderAnswer(answerOf(b, month)) ?? '')
              const Icon = line.direction === 'up' ? ArrowUp : ArrowDown
              return (
                <li key={line.block} className="flex flex-wrap items-start gap-x-2 gap-y-0.5 text-sm leading-5 text-gray-900 dark:text-white" data-testid="block-0-line" data-block={line.block}>
                  <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', line.direction === 'up' ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400')} aria-hidden="true" />
                  <span className="min-w-0 flex-1 basis-[calc(100%-1.5rem)] lg:basis-0">{sentence}</span>
                  {/* under the sentence at 390, where the question would push the page sideways; on its right from lg */}
                  <a href={`#${line.block.replace('_', '-')}`} className="ml-6 lg:ml-0 lg:shrink-0 text-primary-800 underline-offset-2 hover:underline dark:text-sky-300">
                    {q('block_0.go_to', { block: k(BLOCK_TITLES[line.block]) })}
                  </a>
                </li>
              )
            })
          )}
        </ol>
      )}
    </QuestionCard>
  )

  // ── Funnels ──
  const stepRows = (view: StepFunnelView, labelOf: (key: string) => string, valueOf: (st: FunnelStep) => string): StepFunnelRow[] => {
    // the first full step is the base: its 100 % is not printed (spec §E6.1 step 2)
    const first = view.steps.find((x) => !x.hollow)?.key
    return view.steps.map((st) => {
      const known = st.value !== null
      const text = known ? `${st.state === 'floor' ? '≥ ' : ''}${fmt.int.format(st.value as number)}` : UNKNOWN_VALUE
      const base = known && st.rate !== null && st.key !== first && !st.hollow ? `${text} · ${fmt.pct.format(st.rate)}` : text
      // a step larger than the one before draws no loss and prints the gain with its sign (spec §E6)
      const display = st.gain ? `${base} (+${fmt.int.format(st.gain)})` : base
      const reason = st.reason === 'filter' ? k('cell_ga4_filter') : st.reason === 'source_failed' ? (st.source === 'ga4' ? k('cell_ga4_failed') : k('cell_bank_failed')) : st.reason ? (st.source === 'ga4' ? s('tiles.no_source_ga4') : s('tiles.no_source_bank')) : ''
      return {
        key: st.key,
        label: labelOf(st.key),
        hollow: st.hollow,
        kept: st.value ?? 0,
        lost: st.lost ?? 0,
        highlight: view.biggestDrop?.to === st.key,
        display,
        muted: !known,
        title: `${labelOf(st.key)}: ${known ? valueOf(st) : `${UNKNOWN_VALUE} ${reason}`}${st.due ? ` ${k('cell_floor', { date: day(st.due) })}` : ''}`,
      }
    })
  }

  const dropLine = (view: StepFunnelView, labelOf: (key: string) => string) =>
    view.biggestDrop && (
      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs font-semibold text-gray-900 dark:text-white" data-testid="funnel-biggest-drop">
        <span className="tabular-nums">−{fmt.int.format(view.biggestDrop.points)} pt</span>
        <span className={cn(STAT_BADGE, 'border-orange-500 text-orange-800 dark:text-orange-300')}>{q('common.biggest_drop')}</span>
        <span className={DIM}>
          {labelOf(view.biggestDrop.from)} → {labelOf(view.biggestDrop.to)}
        </span>
      </p>
    )

  const dropAnswer = (view: StepFunnelView, key: string, labelOf: (key: string) => string) => {
    const d = view.biggestDrop
    if (!d) return null
    const from = view.steps.find((x) => x.key === d.from)!
    const to = view.steps.find((x) => x.key === d.to)!
    return q(key, { from: labelOf(d.from), to: labelOf(d.to), pct_from: fmt.pct.format(from.rate ?? 0), pct_to: fmt.pct.format(to.rate ?? 0) })
  }

  const useLabel = (key: string) => q(`use_funnel.${key}`)
  const useLoading = !input.usage && !input.usageFailed
  const installs = useFunnel.steps[0]
  const entered = useFunnel.steps[1]
  const gap = installs.value !== null && entered.value !== null && installs.value >= entered.value ? installs.value - entered.value : null
  const useCard = (
    <QuestionCard
      id="use-funnel"
      testId="question-use_funnel"
      title={q('use_funnel.title')}
      answer={useLoading ? undefined : dropAnswer(useFunnel, 'use_funnel.answer', useLabel)}
      base={q('use_funnel.base', { month: monthName(month) })}
      hint={q('use_funnel.hint')}
    >
      <div className="mt-4">
        {useLoading ? (
          <div className="animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" style={{ height: stepFunnelHeight(7) }} data-testid="use-funnel-loading" />
        ) : (
          <StepFunnel
            label={q('use_funnel.title')}
            ga4={k('ga4_badge')}
            max={useFunnel.max}
            rows={stepRows(useFunnel, useLabel, (st) => (st.rate === null || st.hollow ? fmt.int.format(st.value as number) : q('block_1.value', { n: st.value as number, pct: fmt.pct.format(st.rate) })))}
          />
        )}
        {input.usageFailed && <CardError onRetry={retryUsage} message={q('common.answer_failed')} retryLabel={k('retry')} />}
        {dropLine(useFunnel, useLabel)}
        {gap !== null && (
          <p className={cn('mt-1 text-[11px] leading-4', DIM)} title={q('block_1.difference_hint')} data-testid="use-funnel-not-entered">
            {q('block_1.difference', { n: gap })}
          </p>
        )}
      </div>
    </QuestionCard>
  )

  // Purchase funnel: GA4 above, the bank's branches below, never one chart across both (spec §E6.2).
  const payLabel = (key: string) => q(`purchase_funnel.${key}`)
  const payLoading = !input.ga4 && !input.ga4Failed && !input.ga4Filtered
  const viewed = paywall.view.steps[0].value
  const exitRow = (key: 'exit_closed' | 'exit_failed', c: Cell) => (
    <li key={key} className="flex justify-between gap-3" title={q(`purchase_funnel.${key}_hint`)} data-testid={`purchase-${key}`}>
      <span className="text-gray-800 dark:text-gray-200">{q(`purchase_funnel.${key}`)}</span>
      <span className={cn('font-mono font-bold tabular-nums', has(c) ? 'text-gray-900 dark:text-white' : DIM)} title={has(c) ? undefined : reasonTitle(c, 'ga4')}>
        {has(c) ? (viewed !== null && viewed > 0 ? `${fmt.int.format(c.value as number)} · ${share((c.value as number) / viewed)}` : fmt.int.format(c.value as number)) : UNKNOWN_VALUE}
      </span>
    </li>
  )

  const conv = props.input.conversionFailed ? undefined : input.conversion
  const purchaseView = conv ? readPurchaseFunnel(conv) : undefined
  const pf = (key: string, values?: Record<string, string | number>) => s(`purchase_funnel.${key}`, values)
  const int = (v: number | null) => (v === null ? UNKNOWN_VALUE : fmt.int.format(v))
  const pct = (v: number | null) => (v === null ? UNKNOWN_VALUE : fmt.pct.format(v))
  const noBank = s('tiles.no_source_bank')
  const branchProps = (b: PurchaseBranch, view: NonNullable<typeof purchaseView>): BranchFunnelBranch => {
    const label = pf(b.key)
    const [ta, tb] = view.branches
    // DS-COMPONENTE-101 item 5: a branch field the source does not send prints "no data"; item 2: an empty branch has no rate.
    const rateTitle =
      b.size === null || (b.size > 0 && b.bought === null) ? noBank : b.size === 0 ? pf('empty_branch') : view.smallBase ? pf('small_base', { a: int(ta.size), b: int(tb.size) }) : undefined
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
  const freeBefore = freeBeforeCell(input)
  const bankHalf = () => {
    // The conversion read has no filter: under one it refuses, and says how to get it back (§C10).
    if (input.filtered) {
      return (
        <div className="flex flex-col items-start gap-3 py-4" data-testid="funnel-filtered">
          <p className="text-sm text-gray-800 dark:text-gray-200">{s('use_funnel.no_filters')}</p>
          <Button type="button" variant="outline" size="sm" onClick={props.onClearFilters}>
            {k('clear_filters')}
          </Button>
        </div>
      )
    }
    if (input.conversionFailed) return <CardError onRetry={props.onConversionRetry} message={s('use_funnel.failed')} retryLabel={k('retry')} />
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
        {has(freeBefore) && (
          <p className="mt-2 flex justify-between gap-3 text-xs" title={q('block_7.free_before_hint')} data-testid="purchase-free-before">
            <span className="text-gray-800 dark:text-gray-200">{q('block_7.free_before')}</span>
            <span className="whitespace-nowrap font-mono font-bold tabular-nums text-gray-900 dark:text-white">{minutes(freeBefore.value as number)}</span>
          </p>
        )}
      </>
    )
  }

  const purchaseCard = (
    <div id="conversion" className="scroll-mt-6 min-w-0">
      <QuestionCard
        id="purchase-funnel"
        testId="question-purchase_funnel"
        title={q('purchase_funnel.title')}
        badges={ga4Badge}
        answer={payLoading ? undefined : dropAnswer(paywall.view, 'purchase_funnel.answer', payLabel)}
        base={q('purchase_funnel.base', { month: monthName(month) })}
      >
        <div className="mt-4">
          {payLoading ? (
            <div className="animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" style={{ height: stepFunnelHeight(3) }} data-testid="purchase-funnel-loading" />
          ) : input.ga4Failed && !input.ga4Filtered ? (
            <CardError onRetry={props.onGa4Retry} message={k('ga4_failed')} retryLabel={k('retry')} />
          ) : (
            <StepFunnel
              label={q('purchase_funnel.title')}
              ga4={k('ga4_badge')}
              max={paywall.view.max}
              rows={stepRows(paywall.view, payLabel, (st) => (st.rate === null ? fmt.int.format(st.value as number) : q('purchase_funnel.value', { n: st.value as number, pct: fmt.pct.format(st.rate) })))}
            />
          )}
          {dropLine(paywall.view, payLabel)}
          <ul className="mt-2 space-y-1 text-xs" title={q('purchase_funnel.exits_hint')} data-testid="purchase-exits">
            {exitRow('exit_closed', paywall.closed)}
            {exitRow('exit_failed', paywall.failed)}
          </ul>
        </div>
        <div className="mt-4 border-t border-dashed border-gray-200 pt-4 dark:border-gray-800" data-testid="purchase-bank">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">{q('block_7.bank')}</p>
          <p className={cn('mb-2 text-[11px] leading-4', DIM)}>{q('block_7.bank_base', { month: monthName(month) })}</p>
          {bankHalf()}
        </div>
      </QuestionCard>
    </div>
  )

  return (
    <div className="space-y-6" data-testid="engagement-questions">
      {block0}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
        {useCard}
        {purchaseCard}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
        {blockCard(b1, { colors: FIRST_DAY_COLORS, labels: FIRST_DAY_LABELS, mode: 'expand', format: (v) => fmt.int.format(v), axis: shareAxis, retry: retryUsage, hint: q('block_1.first_day_hint') })}
        {blockCard(b2, {
          colors: MODE_COLORS,
          labels: MODE_LABELS,
          mode: 'stack',
          format: (v) => fmt.int.format(v),
          axis: countAxis,
          retry: input.bankFailed ? props.onBankRetry : retryUsage,
          extra: (
            <ul className="sr-only">
              {chartMonths(month).map((m) => {
                const r = b2.chart.find((x) => x.month === m)
                const v = (key: string) => (r?.values[key] === undefined || r.values[key] === null ? UNKNOWN_VALUE : fmt.int.format(r.values[key] as number))
                return <li key={m}>{s('modes_sr', { month: monthHeader(m), drive: v('drive_only'), both: v('both'), explore: v('explore_only') })}</li>
              })}
            </ul>
          ),
        })}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
        {blockCard(b3, { colors: SCREEN_COLORS, labels: SCREEN_LABELS, mode: 'expand', format: share, axis: shareAxis, retry: props.onBankRetry, hint: q('block_3.screen_hint') })}
        {blockCard(b4, {
          colors: MOVEMENT_COLORS,
          labels: MOVEMENT_LABELS,
          mode: 'group',
          format: minutes,
          // minutes on the axis without the unit: the legend and the numbers above carry it
          axis: countAxis,
          retry: retryUsage,
          hint: q('block_4.hint_buckets'),
          extra: has(b4Coverage) ? (
            <p className={cn('mt-2 text-[11px] leading-4', DIM)} data-testid="block-4-coverage">
              {q('block_4.coverage', { pct: fmt.pct.format(b4Coverage.value as number) })}
            </p>
          ) : null,
        })}
      </div>
    </div>
  )
}

export default EngagementQuestions
