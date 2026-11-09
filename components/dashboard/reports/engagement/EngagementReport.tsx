'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Activity, BookOpen, ChevronDown, MousePointerClick, Repeat, Sparkles, Users } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'

import { WidgetCard, SectionHeader } from '@/components/dashboard/WidgetCard'
import { RankRow } from '@/components/dashboard/reports/acquisition/RankRow'
import { Ga4Badge, MonthGrid, type MonthGridCell, type MonthGridGroup } from '@/components/dashboard/reports/engagement/MonthGrid'
import { EngagementQuestions } from '@/components/dashboard/reports/engagement/EngagementQuestions'
import { CardError } from '@/components/admin/social/shared'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { DIM } from '@/components/ui/dense-table'
import { cn } from '@/lib/utils'
import {
  bankSliceEmpty,
  buildGrid,
  cellFormatters,
  formatCell,
  type Cell,
  type GridCard,
  type GridRow,
} from '@/lib/engagement/cells'
import { clickBlocks, clickColor, screenGroupColor } from '@/lib/engagement/clicks'
import { ENGAGEMENT_DICTIONARY } from '@/lib/engagement/dictionary'
import { heatStep } from '@/lib/engagement/summary'
import type { ConversionFunnel } from '@/lib/conversion/funnel'
import type { FreeMinutesHistogram } from '@/lib/engagement/free-minutes'
import type { UsageReport } from '@/lib/engagement/usage'
import type { ActiveUsersReport } from '@/lib/engagement/active-users'
import {
  ga4Filterable,
  hasFilters,
  NO_FILTERS,
  type EngagementBankReport,
  type EngagementFilters,
  type EngagementGa4Report,
  type EngagementUse,
} from '@/lib/engagement/report'

/** The use of the Details table: the guide (spec §E8 item 1, `?use=` is gone). */
const DETAIL_USE: EngagementUse = 'trip'
/** The five steps of the cohort heat map, by `heatStep` (spec §B8); Tailwind does not scan `lib/`. */
const HEAT_TONES = ['bg-emerald-50', 'bg-emerald-100', 'bg-emerald-200', 'bg-emerald-300', 'bg-emerald-400'] as const

/**
 * The Engagement and conversion report (#1094, #1101, spec-cms-relatorio-engajamento-2026-11).
 * Presentational: the page owns the URL and the queries, this owns the screen, so the CT bench
 * mounts it with a fixture. No static `recharts` here: the question blocks (#1161, #1162) load their
 * charts through `next/dynamic`; Details (block 9, spec §E8) is a closed `<details>` with the table,
 * the cohort heat map, the clicks, the dictionary and the all-time blocks.
 */
export interface EngagementReportProps {
  filters: EngagementFilters
  onFiltersChange: (filters: EngagementFilters) => void
  /** The month ruler, `YYYY-MM`, oldest first (`engagementMonths`). */
  months: string[]
  /** Today in Sao Paulo, `YYYY-MM-DD`. */
  today: string
  bank?: EngagementBankReport
  bankFailed: boolean
  onBankRetry: () => void
  ga4?: EngagementGa4Report
  ga4Failed: boolean
  onGa4Retry: () => void
  /** `?month=`, already resolved by `summaryMonthOf`: the one month of the page (#1101 §C8). */
  month: string
  onMonthChange: (month: string) => void
  /** The month of `core.dashboard_conversion_funnel`, the two funnels' source. */
  conversion?: ConversionFunnel
  conversionFailed: boolean
  onConversionRetry: () => void
  /** `core.cms_get_free_minutes_histogram` of the month (#1156); `null` = not deployed, `undefined` = loading. */
  freeMinutes?: FreeMinutesHistogram | null
  freeMinutesFailed: boolean
  onFreeMinutesRetry: () => void
  /** `drive.cms_get_usage_monthly` (#1161); a failed read (also before the migration) fails only its blocks. */
  usage?: UsageReport
  usageFailed: boolean
  onUsageRetry: () => void
  /** `drive.cms_get_active_users_monthly` (#1162), people; the GA4 half is in `ga4`. */
  active?: ActiveUsersReport
  activeFailed: boolean
  onActiveRetry: () => void
  isFetching: boolean
  /** The four all-time blocks of before (platform, top POIs, language, cities), untouched. */
  allTime?: ReactNode
}

const CARD_ICONS = { card_people_time: Users, card_frequency: Repeat, card_after_first: Sparkles } as const

/** `ago 2026`: the month and year without a preposition (spec §3). */
function monthHeader(month: string, locale: string): string {
  const parts = new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' }).formatToParts(
    new Date(`${month}-15T12:00:00Z`)
  )
  const m = parts.find((p) => p.type === 'month')?.value.replace('.', '') ?? month
  const y = parts.find((p) => p.type === 'year')?.value ?? ''
  return `${m} ${y}`
}

const monthLong = (month: string, locale: string) =>
  new Date(`${month}-15T12:00:00Z`).toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })

/** The month by name alone ("outubro"), for the answer sentences (copy §0). */
const monthName = (month: string, locale: string) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString(locale, { month: 'long', timeZone: 'UTC' })

/** The text input of a free filter: written to the URL on Enter or blur, not on every key. */
function TextFilter({
  label,
  placeholder,
  value,
  normalize,
  onCommit,
  className,
}: {
  label: string
  placeholder: string
  value: string | null
  normalize: (raw: string) => string
  onCommit: (value: string | null) => void
  className?: string
}) {
  // The call site keys this by `value`, so a value changed elsewhere (clear filters) remounts the draft.
  const [draft, setDraft] = useState(value ?? '')
  const commit = () => {
    const v = normalize(draft)
    if ((v || null) !== value) onCommit(v || null)
  }
  return (
    <label className={cn('block', className)}>
      <span className="sr-only">{label}</span>
      <input
        type="text"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
        }}
        className="block w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-bold text-gray-700 shadow-sm outline-none placeholder:font-normal placeholder:text-gray-500 focus:border-tuggi-blue focus:ring-4 focus:ring-tuggi-blue/10 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 md:w-56"
      />
    </label>
  )
}

export function EngagementReport({
  filters,
  onFiltersChange,
  months,
  today,
  bank,
  bankFailed,
  onBankRetry,
  ga4,
  ga4Failed,
  onGa4Retry,
  month,
  onMonthChange,
  conversion,
  conversionFailed,
  onConversionRetry,
  freeMinutes,
  freeMinutesFailed,
  onFreeMinutesRetry,
  usage,
  usageFailed,
  onUsageRetry,
  active,
  activeFailed,
  onActiveRetry,
  isFetching,
  allTime,
}: EngagementReportProps) {
  const use = DETAIL_USE
  const detailsRef = useRef<HTMLDetailsElement>(null)
  // Details opens by itself when the URL arrives with #detalhes or an anchor inside it (spec §E8).
  useEffect(() => {
    const hash = window.location.hash.slice(1)
    const el = detailsRef.current
    if (!hash || !el) return
    if (hash === el.id || el.querySelector(`#${CSS.escape(hash)}`)) el.open = true
  }, [])
  const t = useTranslations('Pages.Dashboard')
  const locale = useLocale()
  const k = (key: string, values?: Record<string, string | number>) => t(`reports.engagement.${key}`, values)
  const s = (key: string, values?: Record<string, string | number>) => k(`summary.${key}`, values)
  /** The friendly label of a raw GA4 name, or `null` when copy has none (`(not set)`, a name newer than the copy). */
  const nameLabel = (kind: 'buttons' | 'screens', raw: string): string | null => {
    const key = `reports.engagement.${kind}.${raw}`
    // a dot would walk into a nested key; the GA4 names are snake_case, so a dotted one has no label
    return !raw.includes('.') && t.has(key) ? t(key) : null
  }

  const fmt = useMemo(() => cellFormatters(locale), [locale])
  const dayFmt = useMemo(() => new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }), [locale])
  const day = (iso: string) => dayFmt.format(new Date(`${iso}T12:00:00Z`))

  const ga4Filtered = !ga4Filterable(filters)
  const useName = k(`use_name.${use}`)
  const current = today.slice(0, 7)

  const cards = useMemo(
    () => buildGrid({ months, today, use, bank, bankFailed, ga4, ga4Failed, ga4Filtered }),
    [months, today, use, bank, bankFailed, ga4, ga4Failed, ga4Filtered]
  )
  const emptySlice = hasFilters(filters) && !bankFailed && !!bank && bankSliceEmpty(cards)

  const cellTitle = (c: Cell, source: GridRow['source']): string | undefined => {
    switch (c.state) {
      case 'floor':
        return k('cell_floor', { date: c.due ? day(c.due) : '' })
      case 'before_source':
        return c.since ? k('cell_before_source', { date: day(c.since) }) : k('cell_before_source_none')
      case 'not_due':
        return k('cell_not_due', { date: c.due ? day(c.due) : '' })
      case 'ga4_filter':
        return k('cell_ga4_filter')
      case 'source_failed':
        return source === 'ga4' ? k('cell_ga4_failed') : k('cell_bank_failed')
      case 'missing':
        return k('cell_missing')
      case 'no_source':
        return source === 'ga4' ? k('summary.tiles.no_source_ga4') : k('summary.tiles.no_source_bank')
      default:
        return undefined
    }
  }

  const rowText = (key: string) => {
    const ret = /^ret_d(\d+)$/.exec(key)
    const retOn = /^ret_on_d(\d+)$/.exec(key)
    const second = /^second_(\d+)$/.exec(key)
    const hint = ret
      ? k('rows.ret_hint', { days: ret[1] })
      : retOn
        ? k('rows.ret_on_hint', { days: retOn[1] })
        : second
        ? k('rows.second_hint', { days: second[1] })
        : k(`rows.${key}_hint`, { use: useName })
    return { label: k(`rows.${key}`, { use: useName }), hint }
  }

  const toGroups = (card: GridCard): MonthGridGroup[] =>
    card.groups.map((g, gi) => ({
      key: g.key ?? `g${gi}`,
      label: g.key ? k(`groups.${g.key}`) : null,
      rows: g.rows.map((row) => ({
        key: row.key,
        ...rowText(row.key),
        ga4: row.source === 'ga4',
        withN: row.kind === 'rate',
        cells: row.cells.map((c): MonthGridCell => {
          const printed = formatCell(row.kind, c, fmt)
          return {
            main: printed.main,
            share: printed.share,
            n: printed.n && k('n_of', printed.n),
            floor: c.state === 'floor',
            title: cellTitle(c, row.source),
            loading: c.state === 'loading',
            muted: c.state !== 'measured' && c.state !== 'floor',
          }
        }),
      })),
    }))

  const columns = months.map((m) => ({ key: m, label: monthHeader(m, locale), untilToday: m === current ? k('until_today') : null }))

  // The cohorts (#1101 §C7): the third card whole, every rate row toned by value, in the summary.
  const afterFirst = cards.find((c) => c.key === 'card_after_first')!
  const heatGroups: MonthGridGroup[] = toGroups(afterFirst).map((g, gi) => ({
    ...g,
    rows: g.rows.map((row, ri) => {
      const def = afterFirst.groups[gi].rows[ri]
      if (def.kind !== 'rate') return row
      return {
        ...row,
        cells: row.cells.map((cell, ci) => {
          const c = def.cells[ci]
          const step = c.state === 'measured' || c.state === 'floor' ? heatStep(c.value) : null
          return { ...cell, tone: step === null ? undefined : HEAT_TONES[step] }
        }),
      }
    }),
  }))
  const questionsInput = useMemo(
    () => ({ month, months, today, bank, bankFailed, ga4, ga4Failed, ga4Filtered, usage, usageFailed, conversion, conversionFailed, active, activeFailed, filtered: hasFilters(filters) }),
    [month, months, today, bank, bankFailed, ga4, ga4Failed, ga4Filtered, usage, usageFailed, conversion, conversionFailed, active, activeFailed, filters]
  )

  const notice = (card: GridCard) => {
    const hasGa4 = card.groups.some((g) => g.rows.some((r) => r.source === 'ga4'))
    return (
      <>
        {bankFailed && <CardError onRetry={onBankRetry} message={k('bank_failed')} retryLabel={k('retry')} />}
        {hasGa4 && ga4Failed && !ga4Filtered && <CardError onRetry={onGa4Retry} message={k('ga4_failed')} retryLabel={k('retry')} />}
      </>
    )
  }
  const anyNotice = (card: GridCard) =>
    bankFailed || (ga4Failed && !ga4Filtered && card.groups.some((g) => g.rows.some((r) => r.source === 'ga4')))

  const since = bank?.data_since[use]
  const right = (card: GridCard) => {
    if (card.key === 'card_people_time') {
      // Before the data the note is drawn invisible at its own width, so the header does not grow when it arrives.
      const date = since ? day(since) : '00/00/0000'
      const text = bank && !since ? k('since_none', { use: useName }) : k('since_note', { use: useName, date })
      return <span className={`text-[11px] text-right ${DIM} ${bank ? '' : 'invisible'}`}>{text}</span>
    }
    const text = card.key === 'card_frequency' ? k('use_note', { use: useName }) : k('cohort_note')
    return <span className={`text-[11px] text-right ${DIM}`}>{text}</span>
  }

  const setFilter = <K extends keyof EngagementFilters>(key: K, value: EngagementFilters[K]) => onFiltersChange({ ...filters, [key]: value })

  return (
    <div className="cms-width p-6 lg:p-8 space-y-6 min-h-screen bg-gray-50 dark:bg-gray-950">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center">
          <Activity className="mr-3 h-8 w-8 text-tuggi-purple" aria-hidden="true" />
          {k('title')}
        </h1>
        <p className={DIM}>{k('subtitle')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="w-full md:w-auto">
          <span className="sr-only">{k('summary.month_label')}</span>
          <select
            data-testid="summary-month"
            value={month}
            onChange={(e) => onMonthChange(e.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-bold text-gray-900 shadow-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white md:w-auto"
          >
            {[...months].reverse().map((m) => (
              <option key={m} value={m}>
                {m === current ? `${monthLong(m, locale)} (${k('until_today')})` : monthLong(m, locale)}
              </option>
            ))}
          </select>
        </label>
        <div className="grid w-full grid-cols-2 gap-2 md:flex md:w-auto md:flex-wrap md:items-center md:gap-3">
          <TextFilter
            key={`source-${filters.source ?? ''}`}
            className="col-span-2 md:col-auto"
            label={k('filter_source')}
            placeholder={k('source_placeholder')}
            value={filters.source}
            normalize={(raw) => raw.trim().toLowerCase()}
            onCommit={(v) => setFilter('source', v)}
          />
          <TextFilter
            key={`country-${filters.country ?? ''}`}
            className="col-span-2 md:col-auto"
            label={k('filter_country')}
            placeholder={k('country_placeholder')}
            value={filters.country}
            normalize={(raw) => raw.trim().toUpperCase()}
            onCommit={(v) => setFilter('country', v)}
          />
          <label className="block">
            <span className="sr-only">{k('filter_platform')}</span>
            <Select
              className="pr-9"
              value={filters.platform ?? 'all'}
              onValueChange={(v) => setFilter('platform', v === 'all' ? null : (v as EngagementFilters['platform']))}
            >
              <option value="all">{`${k('filter_platform')}: ${k('filter_all')}`}</option>
              <option value="ios">{k('platform_ios')}</option>
              <option value="android">{k('platform_android')}</option>
            </Select>
          </label>
          <label className="block">
            <span className="sr-only">{k('filter_account')}</span>
            <Select
              className="pr-9"
              value={filters.account ?? 'all'}
              onValueChange={(v) => setFilter('account', v === 'all' ? null : (v as EngagementFilters['account']))}
            >
              <option value="all">{`${k('filter_account')}: ${k('filter_all')}`}</option>
              <option value="account">{k('account_account')}</option>
              <option value="anonymous">{k('account_anonymous')}</option>
            </Select>
          </label>
        </div>
        {hasFilters(filters) && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onFiltersChange(NO_FILTERS)}>
            {k('clear_filters')}
          </Button>
        )}
        {isFetching && <span className={`text-[11px] uppercase tracking-widest ${DIM}`}>{k('updating')}</span>}
      </div>

      <EngagementQuestions
        k={k}
        locale={locale}
        input={questionsInput}
        monthHeader={(m) => monthHeader(m, locale)}
        monthShort={(m) => monthHeader(m, locale).split(' ')[0]}
        monthName={(m) => monthName(m, locale)}
        day={day}
        onBankRetry={onBankRetry}
        onGa4Retry={onGa4Retry}
        onUsageRetry={onUsageRetry}
        onConversionRetry={onConversionRetry}
        onClearFilters={() => onFiltersChange(NO_FILTERS)}
        ga4BadgeHint={ga4Filtered ? k('ga4_filter_hint') : k('ga4_badge_hint')}
        freeMinutes={freeMinutes}
        freeMinutesFailed={freeMinutesFailed}
        onFreeMinutesRetry={onFreeMinutesRetry}
        onActiveRetry={onActiveRetry}
      />

      {emptySlice && (
        <div
          data-testid="engagement-empty-slice"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200"
        >
          <span>{k('empty_filtered')}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => onFiltersChange(NO_FILTERS)}>
            {k('clear_filters')}
          </Button>
        </div>
      )}

      <details
        ref={detailsRef}
        id="detalhes"
        data-testid="engagement-details"
        className="group scroll-mt-6 rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900"
      >
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0">
            <span className="block text-base font-bold text-gray-900 dark:text-white">{k('questions.block_9.title')}</span>
            <span className={`block text-[11px] leading-4 ${DIM}`}>{k('questions.block_9.base')}</span>
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform group-open:rotate-180 ${DIM}`} aria-hidden="true" />
        </summary>
        <div className="space-y-6 p-4 pt-0">
        {cards.filter((card) => card.key !== 'card_after_first').map((card) => (
          <MonthGrid
            key={card.key}
            testId={`engagement-${card.key}`}
            title={k(card.key)}
            icon={CARD_ICONS[card.key]}
            right={right(card)}
            notice={anyNotice(card) ? notice(card) : undefined}
            months={columns}
            groups={toGroups(card)}
            metricLabel={k('col_metric')}
            ga4Badge={k('ga4_badge')}
            ga4BadgeHint={ga4Filtered ? k('ga4_filter_hint') : k('ga4_badge_hint')}
          />
        ))}

        <MonthGrid
          testId="summary-cohort-heat"
          title={s('card_cohort_heat')}
          icon={Sparkles}
          right={<span className={cn('text-[11px] text-right', DIM)}>{k('cohort_note')}</span>}
          months={columns}
          groups={heatGroups}
          metricLabel={k('col_metric')}
          ga4Badge={k('ga4_badge')}
          ga4BadgeHint={ga4Filtered ? k('ga4_filter_hint') : k('ga4_badge_hint')}
          footer={
            <ul className={cn('flex flex-wrap gap-x-4 gap-y-1 text-[10px]', DIM)} data-testid="summary-heat-legend">
              {HEAT_TONES.map((tone, i) => (
                <li key={tone} className="flex items-center gap-1.5">
                  <span aria-hidden="true" className={cn('h-3 w-3 rounded-sm', tone)} />
                  {s(`scale_legend.s${i}`)}
                </li>
              ))}
            </ul>
          }
        />

        <ClicksCard
          k={k}
          nameLabel={nameLabel}
          locale={locale}
          ga4={ga4}
          ga4Failed={ga4Failed}
          ga4Filtered={ga4Filtered}
          onRetry={onGa4Retry}
          month={month}
          integer={fmt.integer}
        />

        {/* `ml-0`: the `cms-width` child rule centers a `div` with a `max-w-*` (a `p` escapes it by the preflight margin), so the legend starts at the content edge, with the note below (#1096) */}
        <div data-testid="engagement-legend" className={`text-xs max-w-3xl ml-0 space-y-1 ${DIM}`}>
          <p>{k('legend_unknown')}</p>
          <p>{k('legend_sources')}</p>
        </div>

        {allTime && (
          <>
            <p data-testid="engagement-all-time-note" className={`text-xs ${DIM}`}>{k('all_time_note')}</p>
            {allTime}
          </>
        )}
          <DictionaryCard k={k} useName={useName} />
        </div>
      </details>
    </div>
  )
}

/**
 * What each number counts, the event or table it reads, and its source (#1154, spec §D5). The term
 * and the definition are the line's own keys (`ENGAGEMENT_DICTIONARY`); GA4 wears the same badge as
 * the lines, the database goes in dim text. From `lg:` the entries line up under four column heads;
 * below it each entry stacks, so nothing scrolls sideways at 390 (§D5 item 5).
 */
function DictionaryCard({ k, useName }: { k: (key: string, values?: Record<string, string | number>) => string; useName: string }) {
  const d = (key: string) => k(`dictionary.${key}`)
  const ROW = 'lg:grid lg:grid-cols-[13rem_minmax(0,1fr)_15rem_4.5rem] lg:gap-x-6'
  return (
    <div data-testid="engagement-dictionary">
      <WidgetCard>
        <SectionHeader as="h2" title={d('title')} icon={BookOpen} className="flex-wrap gap-2" right={<span className={`text-[11px] text-right ${DIM}`}>{d('note')}</span>} />
        <div className={cn('hidden pb-2 border-b border-gray-200 dark:border-gray-800 text-[10px] font-bold uppercase tracking-widest', ROW, DIM)} aria-hidden="true">
          <span />
          <span>{d('col_definition')}</span>
          <span>{d('col_origin')}</span>
          <span>{d('col_source')}</span>
        </div>
        <dl className="divide-y divide-gray-100 dark:divide-gray-800">
          {ENGAGEMENT_DICTIONARY.map((e) => (
            <div key={e.key} data-testid={`engagement-dictionary-${e.key}`} className={cn('py-3', ROW)}>
              <dt className="text-sm font-semibold text-gray-900 dark:text-white" data-testid="engagement-dictionary-term">
                {e.terms.map((t) => k(t, { use: useName })).join(' · ')}
              </dt>
              <dd className="mt-0.5 lg:mt-0 text-xs leading-5 text-gray-700 dark:text-gray-300 first-letter:uppercase">{k(e.definition, { use: useName, ...e.values })}</dd>
              <dd className={`mt-0.5 lg:mt-0 font-mono text-[11px] leading-5 break-words ${DIM}`}>
                <span className="lg:sr-only">{d('col_origin')}: </span>
                {e.origin}
              </dd>
              <dd className="mt-0.5 lg:mt-0 text-xs leading-5" data-testid="engagement-dictionary-source">
                <span className="sr-only">{d('col_source')}: </span>
                {e.source === 'ga4' ? <Ga4Badge text={d('source_ga4')} hint={d('source_ga4_hint')} /> : <span className={DIM} title={d('source_bank_hint')}>{d('source_bank')}</span>}
              </dd>
            </div>
          ))}
        </dl>
        <div className={`mt-3 space-y-1 text-xs ${DIM}`} data-testid="engagement-dictionary-notes">
          <p>{d('note_time')}</p>
          <p>{d('note_d1')}</p>
        </div>
      </WidgetCard>
    </div>
  )
}

function ClicksCard({
  k,
  nameLabel,
  locale,
  ga4,
  ga4Failed,
  ga4Filtered,
  onRetry,
  month,
  integer,
}: {
  k: (key: string, values?: Record<string, string | number>) => string
  nameLabel: (kind: 'buttons' | 'screens', raw: string) => string | null
  locale: string
  ga4?: EngagementGa4Report
  ga4Failed: boolean
  ga4Filtered: boolean
  onRetry: () => void
  /** The page's month (#1101 §C8): the card has no selector of its own and names the month. */
  month: string
  integer: Intl.NumberFormat
}) {
  const { blocks, max } = ga4 ? clickBlocks(ga4.clicks, month) : { blocks: [], max: 0 }

  return (
    <div data-testid="engagement-card_clicks">
      <WidgetCard>
        <SectionHeader
          as="h2"
          title={k('card_clicks')}
          icon={MousePointerClick}
          className="flex-wrap gap-2"
          right={
            <span className="flex items-center gap-2">
              <Ga4Badge text={k('ga4_badge')} hint={ga4Filtered ? k('ga4_filter_hint') : k('ga4_badge_hint')} />
              <span className={`text-[11px] ${DIM}`} data-testid="engagement-clicks-month">
                {k('summary.clicks_month_of', { month: monthLong(month, locale) })}
              </span>
            </span>
          }
        />
        {ga4Filtered ? (
          <p className={`text-sm py-6 text-center ${DIM}`}>{k('ga4_filter_hint')}</p>
        ) : ga4Failed ? (
          <CardError onRetry={onRetry} message={k('ga4_failed')} retryLabel={k('retry')} />
        ) : !ga4 ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8" data-testid="engagement-clicks-loading">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="py-2.5 space-y-2">
                <div className="h-4 w-40 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
                <div className="h-1.5 w-full animate-pulse rounded-full bg-gray-100 dark:bg-gray-800" />
              </div>
            ))}
          </div>
        ) : blocks.length === 0 ? (
          <p className={`text-sm py-6 text-center ${DIM}`}>{k('clicks_empty')}</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8" data-testid="engagement-clicks">
            {blocks.map((b) => {
              const screen = nameLabel('screens', b.screen)
              const groupColor = screenGroupColor(b.screen, b.rows.map((r) => r.button))
              return (
                <div key={b.screen} className="mt-3" data-testid="engagement-click-group">
                  <p
                    title={b.screen}
                    className={cn('flex items-center gap-2 mb-1 text-[11px] font-bold text-gray-900 dark:text-white', !screen && 'font-mono')}
                  >
                    <span aria-hidden="true" data-testid="engagement-click-marker" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: groupColor }} />
                    <span className="truncate">{screen ?? b.screen}</span>
                  </p>
                  {b.rows.map((r) => {
                    const label = nameLabel('buttons', r.button)
                    return (
                      <div key={r.button} data-testid="engagement-click-row">
                        <RankRow
                          label={label ?? r.button}
                          title={r.button}
                          labelClassName={label ? undefined : 'font-mono text-xs'}
                          value={r.users}
                          display={integer.format(r.users)}
                          max={max}
                          color={clickColor(b.screen, r.button)}
                          right={<span className={`text-[11px] tabular-nums ${DIM}`}>{k('clicks_taps', { n: integer.format(r.events) })}</span>}
                        />
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}
      </WidgetCard>
    </div>
  )
}

export default EngagementReport
