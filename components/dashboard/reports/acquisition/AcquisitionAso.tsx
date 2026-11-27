'use client'

/**
 * Stores by country and the store search position on the Acquisition page (#1309, design spec
 * `spec-cms-relatorio-aquisicao-aso-2026-11`). A, impressions, page views and downloads of each store by
 * the country of the store account; B, where our app and its competitors rank for each tracked keyword.
 * Each card has its own read and its own error: a failure in one leaves the other and the funnel intact.
 *
 * Every number and rule is decided in `lib/acquisition/aso.ts` (DS-COMPONENTE-084: unknown never prints
 * 0, a partial store prints a floor, "not in results" is `> results_read`, a trend has a sign both
 * ways); this only draws. The tables are the dense table of `components/ui/dense-table`
 * (DS-COMPONENTE-081), the country name and flag are DS-COMPONENTE-086.
 */

import { Fragment, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { ArrowDown, ArrowUp, ChevronRight, Globe, Search } from 'lucide-react'

import { WidgetCard, SectionHeader } from '@/components/dashboard/WidgetCard'
import { CardError } from '@/components/admin/social/shared'
import { StatLine } from '@/components/dashboard/reports/engagement/StatLine'
import { CountryFlag, countryName } from '@/components/ui/CountryFlag'
import { DIM, DenseTableScroller, EDGE, FilterChip, GROUP, HEAD, HEAD_NUM, HEAD_SOLO, HEAD_SOLO_NUM, NUM, ROW_HEAD, SortHead } from '@/components/ui/dense-table'
import { Count, CoverageLines, EMPTY, ROW_LINE, SkeletonRows, useAcquisitionFmt, type AcqT, type Fmt } from '@/components/dashboard/reports/acquisition/coverage'
import type { LinesRow } from '@/components/dashboard/reports/engagement/question-charts'
import { CHART_COLORS } from '@/lib/constants/chart-colors'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import { cn } from '@/lib/utils'
import { useAcquisitionFunnel, useStoreCountries, useStoreRank, useStoreRankSetup } from '@/lib/hooks/use-acquisition'
import { funnelCoverage, monthBounds, showsStoreLag, STORE_JOB, storeTotals, type StoreKey } from '@/lib/acquisition/funnel'
import {
  countryTable,
  defaultCountrySort,
  downloadsGap,
  parseStoreFilter,
  pickCountry,
  rankAxisTop,
  rankBlock,
  rankCountries,
  rankCoverage,
  sortCountryRows,
  sortRankRows,
  tableCoverage,
  visibleStores,
  type CountryMetric,
  type CountryRow,
  type CountrySortKey,
  type RankBlock,
  type RankCoverage,
  type RankDelta,
  type RankReading,
  type RankRow,
  type RankSortKey,
  type Sort,
  type StoreFilter,
} from '@/lib/acquisition/aso'

const QuestionLines = dynamic(() => import('@/components/dashboard/reports/engagement/QuestionLines').then((m) => m.QuestionLines), {
  ssr: false,
  loading: () => <div className="h-40 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />,
})

/** The region of our app in the search table: a tonal band, `/5` because `DIM` over `/8` falls under 4.5:1. */
const BAND = 'bg-tuggi-blue/5 dark:bg-tuggi-blue/10'
const NOTE = cn('text-[11px] leading-4', DIM)
const UP = 'text-emerald-700 dark:text-emerald-400'
const DOWN = 'text-red-700 dark:text-red-400'
/** More than this many dates and the missing-days line gives the count instead of the list. */
const MAX_LISTED_DAYS = 5
const CHART_PX = 160

const METRICS: Record<StoreKey, CountryMetric[]> = {
  app_store: ['impressions', 'pageViews', 'downloads', 'conversion'],
  // Google Play does not report impressions: a whole column of unknowns is noise, the caption says why once.
  play_store: ['pageViews', 'downloads', 'conversion'],
}
const METRIC_LABEL: Record<CountryMetric, string> = {
  impressions: 'store_countries.col_impressions',
  pageViews: 'store_countries.col_page_views',
  downloads: 'store_countries.col_downloads',
  conversion: 'sources.col_conversion',
}

const todayUtc = () => new Date().toISOString().slice(0, 10)

// ── A. Stores by country ─────────────────────────────────────────────────────────────────────

function CountryValue({ cell, metric, floor, t, fmt }: { cell: CountryRow['stores'][StoreKey]; metric: CountryMetric; floor: boolean; t: AcqT; fmt: Fmt }) {
  if (!cell || cell.absent) return <span className={DIM} title={t('store_countries.absent_hint')}>{UNKNOWN_VALUE}</span>
  const v = cell[metric]
  // numerator and base come from the same job in the same window: a partial store still prints its rate
  if (metric === 'conversion') return v === null ? <span className={DIM}>{UNKNOWN_VALUE}</span> : <>{fmt.pct(v)}</>
  return <Count v={v} floor={floor} fmt={fmt} />
}

function CountryCard({ month, stores, t, fmt }: { month: string; stores: StoreKey[]; t: AcqT; fmt: Fmt }) {
  const locale = useLocale()
  const query = useStoreCountries(month)
  const funnel = useAcquisitionFunnel(month)
  const [sort, setSort] = useState<Sort<CountrySortKey> | null>(null)
  const data = query.data

  const coverage = useMemo(
    () => (data ? Object.fromEntries(stores.map((s) => [s, tableCoverage(month, data.jobFrom[s], data.bounds[s])])) as Record<StoreKey, ReturnType<typeof tableCoverage>> : undefined),
    [data, stores, month]
  )
  const covered = coverage ? stores.filter((s) => coverage[s].state !== 'none') : []
  const nameOf = (code: string) => countryName(code, locale) ?? code
  const collator = useMemo(() => new Intl.Collator(locale), [locale])
  const rows = data && data.state === 'complete' && covered.length > 0 ? countryTable(data.days, covered) : undefined
  const active = sort ?? defaultCountrySort(covered)
  const sorted = rows ? sortCountryRows(rows, active, nameOf, collator) : undefined
  const toggle = (key: CountrySortKey) => setSort({ key, dir: active.key === key ? (active.dir === 1 ? -1 : 1) : key === 'country' ? 1 : -1 })
  const two = covered.length === 2

  const funnelCov = funnel.data ? funnelCoverage(funnel.data, month) : undefined
  const gaps = rows && funnel.data && funnelCov
    ? covered.map((s) => ({ s, gap: downloadsGap(storeTotals(s, funnel.data.stores, funnelCov[STORE_JOB[s]]).downloads, rows, s) })).filter((g) => g.gap !== null)
    : []

  return (
    <WidgetCard>
      <div data-testid="store-countries">
        <SectionHeader title={t('store_countries.title')} icon={Globe} />
        <p className={cn('-mt-2 mb-3', NOTE)}>{t('store_countries.subtitle')}</p>
        {query.isError ? (
          <CardError onRetry={() => void query.refetch()} message={t('store_countries.failed')} />
        ) : data?.state === 'incomplete' ? (
          <CardError onRetry={() => void query.refetch()} message={t('store_section.read_incomplete')} />
        ) : !data || !coverage ? (
          <SkeletonRows n={8} />
        ) : (
          <>
            <CoverageLines
              items={stores.map((s) => ({ source: STORE_JOB[s], c: coverage[s] }))}
              t={t}
              fmt={fmt}
              extra={stores.includes('play_store') ? <p data-testid="countries-play-no-impressions">{t('stores.play_no_impressions')}</p> : undefined}
            />
            {covered.length > 0 && showsStoreLag(month, new Date()) && <p className={cn('-mt-2 mb-3', NOTE)}>{t('coverage.lag')}</p>}
            {sorted && sorted.length === 0 && covered.some((s) => !coverage[s].noRows) && <p className={EMPTY}>{t('store_countries.empty')}</p>}
            {sorted && sorted.length > 0 && (
              <DenseTableScroller label={t('store_countries.title')}>
                <table className="relative w-full border-collapse" data-testid="store-countries-table">
                  <thead>
                    {two && (
                      <tr>
                        <td className={cn(GROUP, 'left-0 z-30')} />
                        {covered.map((s, i) => (
                          <th key={s} scope="colgroup" colSpan={METRICS[s].length} className={cn(GROUP, 'text-gray-700 dark:text-gray-300', i > 0 && EDGE)}>
                            {t(`store_names.${s}`)}
                          </th>
                        ))}
                      </tr>
                    )}
                    <tr>
                      <SortHead column="country" label={t('store_countries.col_country')} title={t('store_countries.col_country')} className={cn(two ? HEAD : HEAD_SOLO, 'left-0 z-20')} sort={active} onToggle={toggle} />
                      {covered.flatMap((s, i) =>
                        METRICS[s].map((m, j) => (
                          <SortHead
                            key={`${s}.${m}`}
                            column={`${s}.${m}` as CountrySortKey}
                            label={t(METRIC_LABEL[m])}
                            title={m === 'conversion' ? t('store_countries.conversion_hint') : two ? `${t(`store_names.${s}`)} · ${t(METRIC_LABEL[m])}` : t(METRIC_LABEL[m])}
                            className={cn(two ? HEAD_NUM : HEAD_SOLO_NUM, i > 0 && j === 0 && EDGE)}
                            sort={active}
                            onToggle={toggle}
                          />
                        ))
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((r) => (
                      <tr key={r.country} className={ROW_LINE} data-testid={`country-${r.country}`}>
                        <th scope="row" className={cn(ROW_HEAD, 'text-sm font-normal text-gray-800 dark:text-gray-200')}>
                          {/* the flag is inline-flex, so the ellipsis has to reach the name inside it */}
                          <div className="flex max-w-[120px] lg:max-w-[160px] [&>span>span:last-child]:min-w-0 [&>span>span:last-child]:truncate [&>span]:min-w-0">
                            <CountryFlag code={r.country} withName />
                          </div>
                        </th>
                        {covered.flatMap((s, i) =>
                          METRICS[s].map((m, j) => (
                            <td key={`${s}.${m}`} className={cn(NUM, i > 0 && j === 0 && EDGE)} data-testid={`country-${r.country}-${s}-${m}`}>
                              <CountryValue cell={r.stores[s]} metric={m} floor={coverage[s].state === 'partial'} t={t} fmt={fmt} />
                            </td>
                          ))
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </DenseTableScroller>
            )}
            {gaps.map(({ s, gap }) => (
              <p key={s} className={cn('mt-2', NOTE)} data-testid={`countries-gap-${s}`}>
                {`${t(`store_names.${s}`)}: ${t('store_countries.sum_below_total', { count: gap as number })}`}
              </p>
            ))}
          </>
        )}
      </div>
    </WidgetCard>
  )
}

// ── B. Search position ───────────────────────────────────────────────────────────────────────

function Position({ r, staleDay, t, fmt }: { r: RankReading | null; staleDay?: string | null; t: AcqT; fmt: Fmt }) {
  if (!r) return <span className={DIM} title={t('store_rank.not_read_hint')}>{UNKNOWN_VALUE}</span>
  if (r.position === null) {
    const hint = t('store_rank.not_found_hint', { count: fmt.int(r.resultsRead) })
    return (
      <span className={DIM} title={hint}>
        <span aria-hidden="true">{`> ${fmt.int(r.resultsRead)}`}</span>
        <span className="sr-only">{`${t('store_rank.not_found')}: ${hint}`}</span>
      </span>
    )
  }
  return (
    <span title={t('store_rank.as_of', { date: fmt.day(r.day) })} className={r.position <= 10 ? 'font-semibold' : undefined}>
      {fmt.int(r.position)}
      {staleDay && <span className={cn('text-[11px] font-normal', DIM)}>{` · ${fmt.day(staleDay)}`}</span>}
    </span>
  )
}

function Trend({ d, read, t }: { d: RankDelta; read: boolean; t: AcqT }) {
  const box = 'inline-flex items-center justify-end gap-0.5'
  const icon = 'h-3 w-3 shrink-0'
  if (d.kind === 'moved') {
    if (d.delta === 0) return <span className={DIM} title={t('store_rank.trend_same')}><span aria-hidden="true">0</span><span className="sr-only">{t('store_rank.trend_same')}</span></span>
    const up = d.delta > 0
    const words = t(up ? 'store_rank.trend_up' : 'store_rank.trend_down', { count: Math.abs(d.delta) })
    const Icon = up ? ArrowUp : ArrowDown
    return (
      <span className={cn(box, up ? UP : DOWN)} title={words}>
        <Icon className={icon} aria-hidden="true" />
        <span aria-hidden="true">{`${up ? '+' : '−'}${Math.abs(d.delta)}`}</span>
        <span className="sr-only">{words}</span>
      </span>
    )
  }
  if (d.kind === 'entered') return <span className={cn(box, UP)}><ArrowUp className={icon} aria-hidden="true" />{t('store_rank.trend_appeared')}</span>
  if (d.kind === 'left') return <span className={cn(box, DOWN)}><ArrowDown className={icon} aria-hidden="true" />{t('store_rank.trend_dropped')}</span>
  if (d.kind === 'out_both') return <span className={DIM}>{t('store_rank.trend_absent')}</span>
  const title = d.reason === 'ruler' ? t('store_rank.trend_ruler_hint') : read ? t('store_rank.trend_single') : t('store_rank.not_read_hint')
  return (
    <span className={DIM} title={title}>
      <span aria-hidden="true">{UNKNOWN_VALUE}</span>
      <span className="sr-only">{title}</span>
    </span>
  )
}

function RankDetail({ row, appName, t, fmt }: { row: RankRow; appName: string; t: AcqT; fmt: Fmt }) {
  const lines: LinesRow[] = row.series.map((p) => {
    const dd = p.day.slice(8, 10)
    return {
      key: p.day,
      label: fmt.day(p.day),
      // every day at 390 would print 30 ticks in 300 px: one in five
      short: Number(dd) % 5 === 0 || dd === '01' ? dd : '',
      values: { pos: p.position },
      reason: p.reason === null ? null : p.reason.kind === 'not_found' ? t('store_rank.not_found_hint', { count: fmt.int(p.reason.resultsRead) }) : t('store_rank.not_read_hint'),
    }
  })
  return (
    <div className="sticky left-0 max-w-[calc(100vw-5rem)] py-2">
      <QuestionLines
        label={t('store_rank.chart_label', { app: appName, keyword: row.keyword })}
        rows={lines}
        series={[{ key: 'pos', label: appName, color: CHART_COLORS.blue }]}
        height={CHART_PX}
        format={(v) => fmt.int(v)}
        yDomain={[1, rankAxisTop(row.series)]}
        reversed
        testId={`rank-chart-${row.keywordId}`}
      />
      <p className={cn('mt-1', NOTE)} data-testid="rank-days">
        {t('store_rank.days', { found: row.daysFound, read: row.daysRead, missing: row.daysMissing, date: row.lastDay ? fmt.day(row.lastDay) : UNKNOWN_VALUE })}
      </p>
    </div>
  )
}

/** `open` is the one open row of the whole card, `store:keyword`: one at a time across both blocks. */
function RankTable({ block, open, onOpen, t, fmt }: { block: RankBlock; open: string | null; onOpen: (id: string | null) => void; t: AcqT; fmt: Fmt }) {
  const locale = useLocale()
  const collator = useMemo(() => new Intl.Collator(locale), [locale])
  const [sort, setSort] = useState<Sort<RankSortKey> | null>(null)
  const rows = sort ? sortRankRows(block.rows, sort, collator) : block.rows
  const toggle = (key: RankSortKey) => setSort((s) => ({ key, dir: s?.key === key ? (s.dir === 1 ? -1 : 1) : key === 'trend' ? -1 : 1 }))
  const appName = block.ownApp?.name || 'Tuggi'
  const cols = 3 + block.competitors.length
  return (
    <DenseTableScroller maxHeightClassName="">
      {/* `relative`: the `sr-only` spans of the cells are absolute, and without a positioned table their box
          is outside the scroller, which then does not clip them and the page scrolls sideways at 390 */}
      <table className="relative w-full border-collapse" data-testid={`rank-table-${block.store}`}>
        <thead>
          <tr>
            <SortHead column="keyword" label={t('store_rank.col_keyword')} title={t('store_rank.col_keyword')} className={cn(HEAD_SOLO, 'left-0 z-20')} sort={sort} onToggle={toggle} />
            <SortHead column="position" label={appName} title={t('store_rank.position_hint')} className={cn(HEAD_SOLO_NUM, BAND, 'font-bold text-gray-900 dark:text-white')} sort={sort} onToggle={toggle} />
            <SortHead column="trend" label={t('store_rank.col_trend')} title={t('store_rank.trend_hint')} className={cn(HEAD_SOLO_NUM, BAND)} sort={sort} onToggle={toggle} />
            {block.competitors.map((a) => (
              <th key={a.id} scope="col" className={HEAD_SOLO_NUM} title={a.name}>
                <span className="inline-block max-w-[96px] truncate align-bottom">{a.name}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const rowId = `${block.store}:${r.keywordId}`
            const isOpen = open === rowId
            const detailId = `rank-detail-${block.store}-${r.keywordId}`
            return (
              <Fragment key={r.keywordId}>
                <tr className={ROW_LINE} data-testid={`rank-row-${r.keywordId}`}>
                  <th scope="row" className={cn(ROW_HEAD, 'p-0 text-sm font-normal text-gray-800 dark:text-gray-200')}>
                    <button
                      type="button"
                      onClick={() => onOpen(isOpen ? null : rowId)}
                      aria-expanded={isOpen}
                      aria-controls={isOpen ? detailId : undefined}
                      title={r.keyword}
                      className="flex min-h-[40px] w-full items-center gap-1.5 px-3 text-left"
                    >
                      <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 transition-transform', isOpen && 'rotate-90')} aria-hidden="true" />
                      <span className="max-w-[90px] truncate lg:max-w-[180px]">{r.keyword}</span>
                    </button>
                  </th>
                  <td className={cn(NUM, BAND)} data-testid="rank-own">
                    <Position r={r.own} staleDay={r.stale ? r.lastDay : null} t={t} fmt={fmt} />
                  </td>
                  <td className={cn(NUM, BAND)} data-testid="rank-trend" data-kind={r.delta.kind}>
                    <Trend d={r.delta} read={r.daysRead > 0} t={t} />
                  </td>
                  {block.competitors.map((a) => (
                    <td key={a.id} className={NUM} data-testid={`rank-app-${a.id}`}>
                      <Position r={r.lastDay ? r.competitors[a.id] ?? null : null} t={t} fmt={fmt} />
                    </td>
                  ))}
                </tr>
                {isOpen && (
                  <tr id={detailId} className={ROW_LINE}>
                    <td colSpan={cols} className="px-3">
                      <RankDetail row={r} appName={appName} t={t} fmt={fmt} />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </DenseTableScroller>
  )
}

function RankStore({ block, cov, month, first, open, onOpen, t, fmt }: { block: RankBlock; cov: RankCoverage; month: string; first: boolean; open: string | null; onOpen: (id: string | null) => void; t: AcqT; fmt: Fmt }) {
  const store = block.store
  const source = t(`coverage.source.${STORE_JOB[store]}`)
  const missing = cov.missingDays
  const note =
    missing.length === 0
      ? undefined
      : {
          text: missing.length > MAX_LISTED_DAYS ? t('store_rank.missing_days_count', { source, count: missing.length }) : t('store_rank.missing_days', { source, dates: missing.map(fmt.day).join(', ') }),
          title: t('store_rank.missing_days_hint'),
          testId: `rank-missing-${store}`,
        }
  const today = todayUtc()
  const { first: monthFirst, last: monthLast } = monthBounds(month)
  const todayFailed = cov.coverage.state !== 'none' && today >= monthFirst && today <= monthLast && (block.lastStoreDay === null || block.lastStoreDay < today)
  const c = cov.coverage
  return (
    <div data-testid={`rank-${store}`}>
      <h4 className={cn('mb-2 text-sm font-semibold text-gray-900 dark:text-white', !first && 'mt-5')}>{t(`store_names.${store}`)}</h4>
      <CoverageLines
        items={[{ source: 'store_rank', c, note }]}
        t={t}
        fmt={fmt}
        extra={todayFailed && !c.noRows ? <p data-testid={`rank-today-${store}`}>{t('store_rank.missing_today', { source })}</p> : undefined}
      />
      {c.state !== 'none' && !c.noRows && (
        <>
          <div className="mb-3 grid grid-cols-2 gap-4">
            <StatLine
              testId={`rank-found-${store}`}
              label={t('store_rank.stat_found')}
              hint={t('store_rank.stat_found_hint')}
              loading={false}
              value={block.read === 0 ? UNKNOWN_VALUE : t('store_rank.stat_found_value', { found: fmt.int(block.found), total: fmt.int(block.read) })}
              valueMuted={block.read === 0}
            />
            <StatLine
              testId={`rank-top10-${store}`}
              label={t('store_rank.stat_top10')}
              loading={false}
              value={block.read === 0 ? UNKNOWN_VALUE : fmt.int(block.top10)}
              valueMuted={block.read === 0}
            />
          </div>
          <RankTable block={block} open={open} onOpen={onOpen} t={t} fmt={fmt} />
        </>
      )}
    </div>
  )
}

function RankCard({ month, stores, country, onCountry, t, fmt }: { month: string; stores: StoreKey[]; country: string | null; onCountry: (c: string) => void; t: AcqT; fmt: Fmt }) {
  const locale = useLocale()
  const collator = useMemo(() => new Intl.Collator(locale), [locale])
  const nameOf = (code: string) => countryName(code, locale) ?? code
  const setup = useStoreRankSetup()
  const [open, setOpen] = useState<string | null>(null)
  const s = setup.data
  const options = s ? rankCountries(s.keywords, nameOf, collator) : []
  const selected = pickCountry(country, options)
  const keywords = s && selected ? s.keywords.filter((k) => k.country === selected) : undefined
  const query = useStoreRank(month, selected, keywords?.map((k) => k.id))
  const notConfigured = !!s && (s.jobFrom === null || !s.keywords.some((k) => k.active))
  const selectOptions = selected && !options.includes(selected) ? [...options, selected] : options

  const data = query.data
  const blocks =
    data && keywords && data.state === 'complete'
      ? stores.map((store) => {
          const block = rankBlock(store, keywords, s?.apps ?? [], data.days, collator)
          const readDays = data.days.filter((d) => d.store === store).map((d) => d.day)
          return { block, cov: rankCoverage(month, s?.jobFrom ?? null, data.bounds[store], readDays) }
        })
      : undefined

  return (
    <WidgetCard>
      <div data-testid="store-rank">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <SectionHeader title={t('store_rank.title')} icon={Search} className="mb-0" />
          {!notConfigured && selectOptions.length > 0 && (
            <label className="flex w-full items-center sm:w-auto">
              <span className="sr-only">{t('store_rank.filter_country')}</span>
              <select
                value={selected ?? ''}
                onChange={(e) => onCountry(e.target.value)}
                data-testid="rank-country"
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900 sm:w-auto dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              >
                {selectOptions.map((c) => (
                  <option key={c} value={c}>
                    {nameOf(c)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <p className={cn('-mt-2 mb-3', NOTE)}>{t('store_rank.subtitle')}</p>
        {setup.isError || query.isError ? (
          <CardError onRetry={() => void (setup.isError ? setup.refetch() : query.refetch())} message={t('store_rank.failed')} />
        ) : data?.state === 'incomplete' ? (
          <CardError onRetry={() => void query.refetch()} message={t('store_section.read_incomplete')} />
        ) : notConfigured ? (
          <p className={EMPTY} data-testid="rank-not-configured">{t('store_rank.empty_not_configured')}</p>
        ) : s && keywords && keywords.length === 0 ? (
          <p className={EMPTY} data-testid="rank-empty-country">{t('store_rank.empty_country', { country: selected ? nameOf(selected) : UNKNOWN_VALUE })}</p>
        ) : !blocks ? (
          <SkeletonRows n={8} />
        ) : (
          blocks.map(({ block, cov }, i) => <RankStore key={block.store} block={block} cov={cov} month={month} first={i === 0} open={open} onOpen={setOpen} t={t} fmt={fmt} />)
        )}
      </div>
    </WidgetCard>
  )
}

// ── The section ──────────────────────────────────────────────────────────────────────────────

const FILTERS: StoreFilter[] = ['both', 'app_store', 'play_store']

export function AcquisitionAso({ month }: { month: string }) {
  const tr = useTranslations('Pages.Dashboard.reports')
  const t: AcqT = (key, values) => tr(`acquisition.${key}`, values)
  const fmt = useAcquisitionFmt()
  const router = useRouter()
  const params = useSearchParams()
  const [store, setStore] = useState<StoreFilter>(() => parseStoreFilter(params.get('store')))
  const [country, setCountry] = useState<string | null>(() => params.get('country'))
  const stores = useMemo(() => visibleStores(store), [store])

  const writeParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(Array.from(params.entries()))
    if (value) next.set(key, value)
    else next.delete(key)
    router.replace(`?${next.toString()}`, { scroll: false })
  }
  const onStore = (f: StoreFilter) => {
    setStore(f)
    writeParam('store', f === 'both' ? null : f)
  }
  const onCountry = (c: string) => {
    setCountry(c)
    writeParam('country', c)
  }

  return (
    <section aria-labelledby="acquisition-aso-title" className="space-y-5 border-t border-gray-200 pt-6 dark:border-gray-800" data-testid="acquisition-aso">
      <div>
        <h2 id="acquisition-aso-title" className="text-lg font-bold text-gray-900 dark:text-white">
          {t('store_section.title')}
        </h2>
        <p className={cn('text-xs', DIM)}>{t('store_section.subtitle')}</p>
      </div>
      <div role="group" aria-label={t('store_countries.filter_store')} className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <FilterChip key={f} active={store === f} onClick={() => onStore(f)}>
            {f === 'both' ? t('store_rank.filter_store_all') : t(`store_names.${f}`)}
          </FilterChip>
        ))}
      </div>
      <CountryCard month={month} stores={stores} t={t} fmt={fmt} />
      <RankCard month={month} stores={stores} country={country} onCountry={onCountry} t={t} fmt={fmt} />
    </section>
  )
}

export default AcquisitionAso
