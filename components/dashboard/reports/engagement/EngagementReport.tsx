'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { Activity, MousePointerClick, Repeat, Sparkles, Users } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'

import { ReportTabs } from '@/components/dashboard/ReportTabs'
import { WidgetCard, SectionHeader } from '@/components/dashboard/WidgetCard'
import { RankRow } from '@/components/dashboard/reports/acquisition/RankRow'
import { Ga4Badge, MonthGrid, type MonthGridCell, type MonthGridGroup } from '@/components/dashboard/reports/engagement/MonthGrid'
import { CardError } from '@/components/admin/social/shared'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { DIM } from '@/components/ui/dense-table'
import { CHART_COLORS } from '@/lib/constants/chart-colors'
import {
  bankSliceEmpty,
  buildGrid,
  cellFormatters,
  formatCell,
  type Cell,
  type GridCard,
  type GridRow,
} from '@/lib/engagement/cells'
import { clickBlocks, defaultClicksMonth } from '@/lib/engagement/clicks'
import {
  ENGAGEMENT_USES,
  ga4Filterable,
  hasFilters,
  NO_FILTERS,
  type EngagementBankReport,
  type EngagementFilters,
  type EngagementGa4Report,
  type EngagementUse,
} from '@/lib/engagement/report'

/**
 * The Engagement report (#1094, spec-cms-relatorio-engajamento-2026-11). Presentational: the page
 * owns the URL and the queries, this owns the screen, so the CT bench mounts it with a fixture.
 * No `recharts` here: the grid is a table and the clicks are `RankRow`.
 */
export interface EngagementReportProps {
  use: EngagementUse
  onUseChange: (use: EngagementUse) => void
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
  /** `null` = the latest month with a click. */
  clicksMonth: string | null
  onClicksMonthChange: (month: string) => void
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

/** The text input of a free filter: written to the URL on Enter or blur, not on every key. */
function TextFilter({
  label,
  placeholder,
  value,
  normalize,
  onCommit,
}: {
  label: string
  placeholder: string
  value: string | null
  normalize: (raw: string) => string
  onCommit: (value: string | null) => void
}) {
  // The call site keys this by `value`, so a value changed elsewhere (clear filters) remounts the draft.
  const [draft, setDraft] = useState(value ?? '')
  const commit = () => {
    const v = normalize(draft)
    if ((v || null) !== value) onCommit(v || null)
  }
  return (
    <label className="block">
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
  use,
  onUseChange,
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
  clicksMonth,
  onClicksMonthChange,
  isFetching,
  allTime,
}: EngagementReportProps) {
  const t = useTranslations('Pages.Dashboard')
  const locale = useLocale()
  const k = (key: string, values?: Record<string, string | number>) => t(`reports.engagement.${key}`, values)

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

  const cellTitle = (c: Cell, row: GridRow): string | undefined => {
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
        return row.source === 'ga4' ? k('cell_ga4_failed') : k('cell_bank_failed')
      case 'suppressed':
        return k('cell_suppressed')
      default:
        return undefined
    }
  }

  const rowText = (key: string) => {
    const ret = /^ret_d(\d+)$/.exec(key)
    const second = /^second_(\d+)$/.exec(key)
    const hint = ret
      ? k('rows.ret_hint', { days: ret[1] })
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
        cells: row.cells.map((c): MonthGridCell => {
          const printed = formatCell(row.kind, c, fmt)
          return {
            main: printed.main,
            share: printed.share,
            floor: c.state === 'floor',
            title: cellTitle(c, row),
            loading: c.state === 'loading',
            muted: c.state !== 'measured' && c.state !== 'floor',
          }
        }),
      })),
    }))

  const columns = months.map((m) => ({ key: m, label: monthHeader(m, locale), untilToday: m === current ? k('until_today') : null }))

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
        <div className="max-w-full overflow-x-auto">
          <ReportTabs
            tabs={ENGAGEMENT_USES.map((u) => ({ key: u, label: k(`use_${u}`) }))}
            active={use}
            onChange={(key) => onUseChange(key as EngagementUse)}
          />
        </div>
        <div className="grid w-full grid-cols-2 gap-2 md:flex md:w-auto md:flex-wrap md:items-center md:gap-3">
          <TextFilter
            key={`source-${filters.source ?? ''}`}
            label={k('filter_source')}
            placeholder={k('source_placeholder')}
            value={filters.source}
            normalize={(raw) => raw.trim().toLowerCase()}
            onCommit={(v) => setFilter('source', v)}
          />
          <TextFilter
            key={`country-${filters.country ?? ''}`}
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

      {cards.map((card) => (
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

      <ClicksCard
        k={k}
        locale={locale}
        months={months}
        current={current}
        ga4={ga4}
        ga4Failed={ga4Failed}
        ga4Filtered={ga4Filtered}
        onRetry={onGa4Retry}
        month={clicksMonth}
        onMonthChange={onClicksMonthChange}
        integer={fmt.integer}
      />

      <div className={`text-xs max-w-3xl space-y-1 ${DIM}`}>
        <p>{k('legend_unknown')}</p>
        <p>{k('legend_sources')}</p>
        <p>{k('legend_suppression')}</p>
      </div>

      {allTime && (
        <>
          <p className={`text-xs ${DIM}`}>{k('all_time_note')}</p>
          {allTime}
        </>
      )}
    </div>
  )
}

function ClicksCard({
  k,
  locale,
  months,
  current,
  ga4,
  ga4Failed,
  ga4Filtered,
  onRetry,
  month,
  onMonthChange,
  integer,
}: {
  k: (key: string, values?: Record<string, string | number>) => string
  locale: string
  months: string[]
  current: string
  ga4?: EngagementGa4Report
  ga4Failed: boolean
  ga4Filtered: boolean
  onRetry: () => void
  month: string | null
  onMonthChange: (month: string) => void
  integer: Intl.NumberFormat
}) {
  const selected = month && months.includes(month) ? month : defaultClicksMonth(months, ga4?.clicks)
  const { blocks, max } = ga4 ? clickBlocks(ga4.clicks, selected) : { blocks: [], max: 0 }

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
              <label className="flex items-center gap-2">
                <span className="sr-only">{k('clicks_month')}</span>
                <select
                  value={selected}
                  onChange={(e) => onMonthChange(e.target.value)}
                  className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm font-semibold text-gray-900 dark:text-white"
                >
                  {[...months].reverse().map((m) => (
                    <option key={m} value={m}>
                      {m === current ? `${monthLong(m, locale)} (${k('until_today')})` : monthLong(m, locale)}
                    </option>
                  ))}
                </select>
              </label>
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
            {blocks.map((b) => (
              <div key={b.screen} className="mt-3">
                <p className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${DIM}`}>{b.screen}</p>
                {b.rows.map((r) => (
                  <div key={r.button} data-testid="engagement-click-row">
                    <RankRow
                      label={r.button}
                      labelClassName="font-mono text-xs"
                      value={r.users}
                      display={integer.format(r.users)}
                      max={max}
                      color={CHART_COLORS.blue}
                      right={<span className={`text-[11px] tabular-nums ${DIM}`}>{k('clicks_taps', { n: integer.format(r.events) })}</span>}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </WidgetCard>
    </div>
  )
}

export default EngagementReport
