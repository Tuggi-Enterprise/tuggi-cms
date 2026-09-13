'use client'

/**
 * ONE ACCOUNT PER ROW — the scoring scoreboard of phase 1 (#741, epic #737).
 *
 * THE LINE CHECKS ITSELF BY EYE: `Pontos = (Disparos + Pts por minuto) × multiplicador`. That is
 * what makes the two facts that look like defects visible without a word of text — the minutes
 * column almost always tiny next to the triggers column (the minute axis is 8% of the
 * scoreboard), and the streak column never multiplying anything (nobody reached 7 calendar days
 * in any of the 13 weeks). Neither is the screen's error, and the screen exists for the operator
 * to see them.
 *
 * THE COMPARISON COLUMNS ARE NOT THE SCOREBOARD. `points_notable_weighted` is deferred by the
 * operator's own decision (#737, decision 2), so its group is grey while the official group
 * carries the ink, and it is never the default ordering — `DS-COMPONENTE-083` item 3. The delta
 * cell prints the REORDERING rather than two numbers to subtract, and its baseline is
 * `rank_official` and never the `#` column: `rank_notable_weighted` is computed over every
 * account, and subtracting it from a position that excludes internal accounts would compare two
 * populations (item 2).
 *
 * THREE TIME QUANTITIES, THREE NAMES, ONE GROUP — `DS-COPY-062` item 1. `Cobrado` is what the
 * meter debited, `Intervalo de sinal` is first-to-last signal, and `Diferença` is the distance
 * between them, which IS the measure of the BR-MONETIZACAO-049 divergence and which can be
 * negative. A session left open with sparse signal inflates the span without consuming any
 * balance — 4.022 minutes against 143 charged in one measured account — so the `<caption>` says
 * so before any cell is read.
 *
 * `#` IS A VALUE, NEVER THE INDEX OF THE ROW (`DS-COMPONENTE-082` item 3). Sorting by
 * `Diferença` puts somebody else on top and her `#` stays hers; renumbering would create a
 * second ruler of position on the same screen.
 */

import { Fragment, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Flame,
  Headphones,
  MapPin,
  Scale,
  Users,
} from 'lucide-react'
import {
  CELL,
  DIM,
  DenseTableScroller,
  EDGE,
  FilterChip,
  GROUP,
  HEAD,
  HEAD_NUM,
  NUM,
  SortHead,
  type SortState,
} from '@/components/ui/dense-table'
import { StatCard, StatCardRow } from '@/components/ui/StatCard'
import type { RpcError } from '@/lib/api/dashboard-fetch'
import { AppUserLink } from '@/components/dashboard/AppUserLink'
import { formatDuration, formatSignedDuration } from '@/lib/format/duration'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import { appUserLabel } from '@/lib/format/user-identity'
import { meteringCoverage } from '@/lib/ranking/metering'
import {
  aggregateRows,
  compareNullable,
  formatPoints,
  formatRatio,
  rankDelta,
  summarize,
  visibleRows,
  type PeriodOption,
  type RankingRow,
} from '@/lib/ranking/scoreboard'

const TUGGI_COLORS = {
  blue: '#00A8E8',
  purple: '#8B5CF6',
  orange: '#FF6F00',
  green: '#10B981',
  red: '#EF4444',
}

/** The eight sortable columns of spec §4.3. `#` is not one of them: it is the default order. */
type SortKey =
  | 'points_official'
  | 'trigger_points_fired'
  | 'points_from_minutes'
  | 'story_days'
  | 'points_notable_weighted'
  | 'charged_minutes'
  | 'trail_span_minutes'
  | 'metering_gap_minutes'

type ChipKey = 'all' | 'scored' | 'charged_without_trigger'

export interface RankingScoreboardProps {
  /** Rows of EXACTLY one period — the route filtered them, and nothing here re-filters by period. */
  rows: RankingRow[]
  period: PeriodOption | null
  /** The label of the selected period, as the `<select>` prints it. Used by empty and by banners. */
  periodLabel: string
  includeInternal: boolean
  /** Accounts carrying the #740 mark. `0` is the state that must warn. */
  internalAccounts: number
  isLoading: boolean
  /**
   * The failure AS IT CAME, code included. It used to be the message alone, and the screen asked
   * `message.includes('42501')` — a question a `PostgrestError` never answers, because the
   * SQLSTATE lives in `code` (#755).
   */
  error: RpcError | null
  onRetry: () => void
  onOpenSessions: (row: RankingRow) => void
}

export function RankingScoreboard({
  rows,
  period,
  periodLabel,
  includeInternal,
  internalAccounts,
  isLoading,
  error,
  onRetry,
  onOpenSessions,
}: RankingScoreboardProps) {
  const t = useTranslations('Pages.Dashboard.ranking')
  const locale = useLocale()

  const [sort, setSort] = useState<SortState<SortKey> | null>(null)
  const [chip, setChip] = useState<ChipKey>('all')
  const [expanded, setExpanded] = useState<string | null>(null)

  /** The streak belongs to the weekly cycle; in a rolling window it is `1.0` by construction. */
  const isWeek = period?.kind === 'week'
  const coverage = period ? meteringCoverage(period.start, period.end) : 'full'
  const hasMeter = coverage !== 'none'

  const shown = useMemo(() => visibleRows(rows, includeInternal), [rows, includeInternal])

  /**
   * The indicators do NOT follow the switch — contract, Parte 7: every average, ratio and
   * concentration diagnosis is computed over the accounts that are not marked. With the switch
   * off this is the same population the table shows; with it on, the rows come back and the
   * indicators stay honest, which is why the band says so in one line.
   */
  const summary = useMemo(() => summarize(aggregateRows(rows)), [rows])

  const counts = useMemo(
    () => ({
      all: shown.length,
      scored: shown.filter((row) => row.points_official > 0).length,
      charged_without_trigger: shown.filter(
        (row) => row.charged_minutes > 0 && row.trigger_points_fired === 0
      ).length,
    }),
    [shown]
  )

  const rankOf = (row: RankingRow) =>
    includeInternal ? row.rank_official : row.rank_excluding_internal

  const tableRows = useMemo(() => {
    const kept = shown.filter((row) => {
      if (chip === 'scored') return row.points_official > 0
      if (chip === 'charged_without_trigger')
        return row.charged_minutes > 0 && row.trigger_points_fired === 0
      return true
    })

    if (!sort) {
      // The default is the `#` column ascending, with the null positions last: `null` is "does
      // not rank", not "ranks worst", and the operator asked for the top when he arrived.
      return [...kept].sort((a, b) => compareNullable(rankOf(a), rankOf(b), 1))
    }

    return [...kept].sort((a, b) => compareNullable(a[sort.key], b[sort.key], sort.dir))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, chip, sort, includeInternal])

  const totals = useMemo(() => summarize(tableRows), [tableRows])

  function toggle(key: SortKey) {
    setSort((current) =>
      current?.key === key ? { key, dir: current.dir === 1 ? -1 : 1 } : { key, dir: -1 }
    )
  }

  const head = (column: SortKey, label: string, className: string) => (
    <SortHead
      column={column}
      label={label}
      className={className}
      sort={sort}
      onToggle={toggle}
      title={t('table.sort_by', { column: label })}
    />
  )

  /** A minute quantity in a period with no meter is UNKNOWN, never `0` — `DS-COMPONENTE-084`. */
  const minutes = (value: number) => (hasMeter ? formatDuration(value) : UNKNOWN_VALUE)
  const points = (value: number | null | undefined) => formatPoints(value, locale)

  const columnCount = 12 + (isWeek ? 0 : -1) + (includeInternal ? 1 : 0)

  return (
    <div className="space-y-6">
      {/* THE RULER OF THE SIX NUMBERS BELOW, AND IT LIVES GLUED TO THEM — `DS-COPY-062` item 3.
          It used to sit inside the switch block, ~200px away in the top-right corner, while the
          contradiction it explains (`Contas que pontuaram: 2` against the chip `Todas: 3`) was
          down here. A population restriction is part of the label, which means next to the
          quantity and not once somewhere on the screen.

          With the switch off it does not exist: the two populations coincide and the line would
          be noise in every normal reading of the screen. It is not a warning either — no icon,
          no coloured band, so it does not compete with the two amber ones this screen can
          raise. */}
      <div className="space-y-1.5">
        {includeInternal && (
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {t('internal.aggregates_note')}
          </p>
        )}
        <StatCardRow columns={6}>
          <StatCard
            icon={Users}
            size="compact"
            isLoading={isLoading}
            color={TUGGI_COLORS.blue}
            label={t('kpi.accounts_scored')}
            value={summary.accountsScored}
            subtitle={summary.byPlatform
              .map((entry) => `${entry.accounts} ${entry.platform}`)
              .join(' · ')}
          />
          <StatCard
            icon={Scale}
            size="compact"
            isLoading={isLoading}
            color={TUGGI_COLORS.purple}
            label={t('kpi.ratio')}
            value={hasMeter ? formatRatio(summary.triggerToMinuteRatio, locale) : UNKNOWN_VALUE}
            subtitle={
              hasMeter
                ? t('kpi.ratio_subtitle', {
                    triggers: points(summary.pointsFromTriggers),
                    minutes: points(summary.pointsFromMinutes),
                  })
                : t('kpi.no_meter')
            }
          />
          {isWeek && (
            <StatCard
              icon={Flame}
              size="compact"
              isLoading={isLoading}
              color={TUGGI_COLORS.orange}
              label={t('kpi.streak')}
              value={t('kpi.accounts', { count: summary.streakAccounts })}
              subtitle={t('kpi.streak_subtitle', { days: summary.maxStoryDays })}
            />
          )}
          <StatCard
            icon={Clock}
            size="compact"
            isLoading={isLoading}
            color={TUGGI_COLORS.red}
            label={t('kpi.charged_without_trigger')}
            value={hasMeter ? t('kpi.accounts', { count: summary.chargedWithoutTrigger }) : UNKNOWN_VALUE}
            subtitle={
              hasMeter ? t('kpi.charged_without_trigger_subtitle') : t('kpi.no_meter')
            }
          />
          {/* The caveat is PART OF THE LABEL and comes from the same key the expanded row reads —
              `DS-COPY-062` items 3 and 4. Manual listening by a paying account records no visit at
              all (two independent gates in the app), so this number measures one tier. */}
          <StatCard
            icon={Headphones}
            size="compact"
            isLoading={isLoading}
            color={TUGGI_COLORS.green}
            label={t('kpi.manual_listens')}
            value={summary.manualListens}
            subtitle={t('kpi.manual_listens_subtitle')}
          />
          {/* No percentage here, ever: `trigger_points_fired` is deduplicated by (session, POI) and
              this count is not, so the two do not form a fraction (`DS-COMPONENTE-084` item 2). */}
          <StatCard
            icon={MapPin}
            size="compact"
            isLoading={isLoading}
            color={TUGGI_COLORS.blue}
            label={t('kpi.indeterminate')}
            value={summary.visitsIndeterminate}
            subtitle={t('kpi.indeterminate_subtitle')}
          />
        </StatCardRow>
      </div>

      {/* THE STATE THAT MUST NOT PASS IN SILENCE. The switch is off and it is removing nobody:
          without this band the screen shows an unfiltered scoreboard wearing the face of a
          filtered one. A band and not a tooltip — it is a condition of the whole reading. */}
      {!includeInternal && internalAccounts === 0 && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {t('internal.none_marked')}
        </p>
      )}

      {coverage !== 'full' && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {coverage === 'none' ? t('meter.none') : t('meter.partial')}
        </p>
      )}

      {/* Error is NOT empty, and never looks like it: an empty table after a failed request is
          the screen asserting "nobody scored" when the truth is "I do not know". */}
      {error && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          <span>{error.code === '42501' ? t('error.forbidden') : t('error.title')}</span>
          <button
            type="button"
            onClick={onRetry}
            className="min-h-[24px] rounded-lg border border-red-300 px-2 py-0.5 font-semibold hover:bg-red-100 dark:border-red-800 dark:hover:bg-red-900/40"
          >
            {t('error.retry')}
          </button>
        </div>
      )}

      <section className="overflow-hidden rounded-3xl border border-gray-200 bg-white/70 shadow-2xl shadow-black/5 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-900/70">
        <header className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-5 py-4 dark:border-gray-800">
          <FilterChip active={chip === 'all'} onClick={() => setChip('all')} count={counts.all}>
            {t('filters.all')}
          </FilterChip>
          <FilterChip
            active={chip === 'scored'}
            onClick={() => setChip('scored')}
            count={counts.scored}
          >
            {t('filters.scored')}
          </FilterChip>
          <FilterChip
            active={chip === 'charged_without_trigger'}
            onClick={() => setChip('charged_without_trigger')}
            count={counts.charged_without_trigger}
          >
            {t('filters.charged_without_trigger')}
          </FilterChip>
        </header>

        <DenseTableScroller>
          <table className="w-full min-w-[1040px] border-collapse">
            {/* The caption is REAL and visible, and it comes before any cell for a screen reader:
                it holds the three readings a single column cannot sustain on its own. */}
            <caption className="px-3 py-2 text-left text-[11px] text-gray-600 dark:text-gray-400">
              {t.rich('caption.span', { b: (chunks) => <strong>{chunks}</strong> })}{' '}
              {t.rich('caption.platform', { b: (chunks) => <strong>{chunks}</strong> })}{' '}
              {/* THE POPULATION OF THE COMPARISON LIVES HERE, and not in the group label —
                  `DS-COMPONENTE-083` item 3, amended 2026-09-13. The band of groups has a fixed
                  28px and the band of column names sticks 28px below it: a label carrying
                  `(posição entre todas as contas)` wrapped and hid the thirteen column names
                  (#752). The caption is where a reading a single column cannot sustain belongs,
                  and a screen reader gets it BEFORE any cell. The declaration is mandatory —
                  without it the delta of column 9 has a baseline nobody stated (item 2). */}
              {t.rich('caption.notable', { b: (chunks) => <strong>{chunks}</strong> })}{' '}
              {t('caption.sorting')}
            </caption>
            <thead>
              <tr>
                <th
                  className={`${GROUP} text-gray-500 dark:text-gray-400`}
                  colSpan={includeInternal ? 4 : 3}
                />
                <th
                  className={`${GROUP} ${EDGE} text-primary-800 dark:text-tuggi-blue`}
                  colSpan={isWeek ? 4 : 3}
                  scope="colgroup"
                >
                  {t('group.official')}
                </th>
                {/* Grey, and the label starts with the word `Comparação`: emphasis belongs to the
                    result, and colour on a comparison is the shortest path to somebody reading
                    the weight-2 column as the score (`DS-COMPONENTE-083` item 3). */}
                <th
                  className={`${GROUP} ${EDGE} text-gray-500 dark:text-gray-400`}
                  colSpan={2}
                  scope="colgroup"
                >
                  {t('group.notable')}
                </th>
                <th
                  className={`${GROUP} ${EDGE} text-gray-500 dark:text-gray-400`}
                  colSpan={3}
                  scope="colgroup"
                >
                  {t('group.time')}
                </th>
              </tr>
              <tr>
                <th scope="col" className={`${HEAD} text-right`}>
                  {t('table.rank')}
                </th>
                {includeInternal && (
                  <th scope="col" className={`${HEAD} text-right`}>
                    {t('table.rank_excluding_internal')}
                  </th>
                )}
                <th scope="col" className={HEAD}>
                  {t('table.person')}
                </th>
                <th scope="col" className={HEAD}>
                  {t('table.platform')}
                </th>
                {head('points_official', t('table.points'), `${HEAD_NUM} ${EDGE}`)}
                {head('trigger_points_fired', t('table.triggers'), HEAD_NUM)}
                {head('points_from_minutes', t('table.points_from_minutes'), HEAD_NUM)}
                {isWeek && head('story_days', t('table.streak'), HEAD_NUM)}
                {head('points_notable_weighted', t('table.notable_points'), `${HEAD_NUM} ${EDGE}`)}
                <th scope="col" className={HEAD_NUM}>
                  {t('table.rank_delta')}
                </th>
                {head('charged_minutes', t('table.charged'), `${HEAD_NUM} ${EDGE}`)}
                {head('trail_span_minutes', t('table.trail_span'), HEAD_NUM)}
                {head('metering_gap_minutes', t('table.gap'), HEAD_NUM)}
              </tr>
            </thead>

            <tbody>
              {isLoading && <SkeletonRows columns={columnCount} />}

              {!isLoading && tableRows.length === 0 && (
                <tr>
                  <td
                    colSpan={columnCount}
                    className="px-5 py-8 text-center text-sm text-gray-600 dark:text-gray-400"
                  >
                    {chip === 'all'
                      ? t('empty.period', { period: periodLabel })
                      : t('empty.filtered', { period: periodLabel })}
                    {chip !== 'all' && (
                      <button
                        type="button"
                        onClick={() => setChip('all')}
                        className="ml-2 min-h-[24px] underline underline-offset-2 hover:text-gray-900 dark:hover:text-white"
                      >
                        {t('empty.clear')}
                      </button>
                    )}
                  </td>
                </tr>
              )}

              {!isLoading &&
                tableRows.map((row) => {
                  const isOpen = expanded === row.user_id
                  const person = appUserLabel(row)

                  return (
                    <Fragment key={row.user_id}>
                      <tr
                        className="border-t border-gray-100 hover:bg-gray-50/70 dark:border-gray-800 dark:hover:bg-gray-800/40"
                      >
                        <td className={`${NUM} pr-0`}>
                          <span className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              aria-expanded={isOpen}
                              aria-label={
                                isOpen
                                  ? t('table.collapse', { person })
                                  : t('table.expand', { person })
                              }
                              onClick={() => setExpanded(isOpen ? null : row.user_id)}
                              className="inline-flex h-6 w-6 min-h-[24px] min-w-[24px] items-center justify-center rounded text-gray-500 hover:text-gray-900 dark:hover:text-white"
                            >
                              {isOpen ? (
                                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                              )}
                            </button>
                            {rankOf(row) ?? UNKNOWN_VALUE}
                          </span>
                        </td>
                        {includeInternal && (
                          <td className={`${NUM} ${DIM}`}>
                            {row.rank_excluding_internal ?? UNKNOWN_VALUE}
                          </td>
                        )}
                        <th
                          scope="row"
                          className={`${CELL} min-w-[11rem] max-w-[16rem] truncate text-left font-medium text-gray-900 dark:text-white`}
                          title={person}
                        >
                          <AppUserLink user={row} />
                          {row.excluded_from_metrics && (
                            <span className="ml-2 rounded border border-gray-300 px-1 text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:border-gray-700 dark:text-gray-400">
                              {t('internal.badge')}
                            </span>
                          )}
                        </th>
                        <td className={CELL}>{row.platform ?? UNKNOWN_VALUE}</td>

                        {/* The only column carrying typographic weight: it is the scoreboard. */}
                        <td className={`${NUM} ${EDGE} font-semibold text-gray-900 dark:text-white`}>
                          {points(row.points_official)}
                        </td>
                        <td className={NUM}>{points(row.trigger_points_fired)}</td>
                        <td className={NUM}>
                          {hasMeter ? points(row.points_from_minutes) : UNKNOWN_VALUE}
                          <span className={`block text-[11px] ${DIM}`}>
                            {minutes(row.charged_minutes)}
                          </span>
                        </td>
                        {isWeek && (
                          <td className={NUM}>
                            {`${row.story_days} / 7`}
                            {row.has_full_week_streak && (
                              <span className={`block text-[11px] ${DIM}`}>
                                {`×${formatPoints(row.streak_multiplier, locale)}`}
                              </span>
                            )}
                          </td>
                        )}

                        <td className={`${NUM} ${EDGE} ${DIM}`}>
                          {points(row.points_notable_weighted)}
                        </td>
                        <td className={NUM}>
                          <RankDeltaCell row={row} />
                        </td>

                        <td className={`${NUM} ${EDGE}`}>{minutes(row.charged_minutes)}</td>
                        <td className={NUM}>{formatDuration(row.trail_span_minutes)}</td>
                        {/* The difference is signed in both directions and the cell is the door
                            to tab 2, where the tail of the divergence actually lives. */}
                        <td className={NUM}>
                          {hasMeter ? (
                            <button
                              type="button"
                              onClick={() => onOpenSessions(row)}
                              title={t('table.open_sessions', { person })}
                              className="min-h-[24px] underline-offset-2 hover:underline focus-visible:underline"
                            >
                              {formatSignedDuration(row.metering_gap_minutes)}
                            </button>
                          ) : (
                            UNKNOWN_VALUE
                          )}
                        </td>
                      </tr>

                      {isOpen && (
                        <tr className="bg-tuggi-blue/[.04]">
                          <td colSpan={columnCount} className="px-5 py-4">
                            <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
                              <Detail
                                label={t('row.notable_triggers')}
                                value={t('row.of_total', {
                                  count: row.trigger_points_notable,
                                  total: row.trigger_points_fired,
                                })}
                              />
                              <Detail
                                label={t('row.indeterminate')}
                                value={String(row.visits_indeterminate)}
                              />
                              {/* Same key as the indicator: one caveat, one redaction. */}
                              <Detail
                                label={t('kpi.manual_listens')}
                                value={String(row.visits_manual)}
                              />
                              <Detail
                                label={t('row.sessions_with_trail')}
                                value={String(row.sessions_with_trail)}
                              />
                              <Detail
                                label={t('row.sessions_charged')}
                                value={hasMeter ? String(row.sessions_charged) : UNKNOWN_VALUE}
                              />
                              <Detail
                                label={t('row.rank_official')}
                                value={row.rank_official == null ? UNKNOWN_VALUE : String(row.rank_official)}
                              />
                              <Detail
                                label={t('row.rank_notable')}
                                value={
                                  row.rank_notable_weighted == null
                                    ? UNKNOWN_VALUE
                                    : String(row.rank_notable_weighted)
                                }
                              />
                              <div>
                                <dt className="font-semibold text-gray-500 dark:text-gray-400">
                                  {t('row.user_id')}
                                </dt>
                                <dd className="flex items-center gap-2 font-mono text-[11px] text-gray-800 dark:text-gray-200">
                                  {row.user_id}
                                  <button
                                    type="button"
                                    onClick={() => navigator.clipboard?.writeText(row.user_id)}
                                    title={t('row.copy')}
                                    className="inline-flex h-6 w-6 min-h-[24px] min-w-[24px] items-center justify-center rounded text-gray-500 hover:text-gray-900 dark:hover:text-white"
                                  >
                                    <Copy className="h-3 w-3" aria-hidden="true" />
                                    <span className="sr-only">{t('row.copy')}</span>
                                  </button>
                                </dd>
                              </div>
                            </dl>
                            <button
                              type="button"
                              onClick={() => onOpenSessions(row)}
                              className="mt-3 min-h-[24px] text-xs font-semibold text-primary-800 underline underline-offset-2 dark:text-tuggi-blue"
                            >
                              {t('row.see_sessions')}
                            </button>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
            </tbody>

            {!isLoading && tableRows.length > 0 && (
              <tfoot className="sticky bottom-0 z-10">
                <tr className="border-t-2 border-gray-200 bg-gray-50/95 backdrop-blur dark:border-gray-700 dark:bg-gray-950/95">
                  <th
                    scope="row"
                    className={`${CELL} text-left font-bold text-gray-900 dark:text-white`}
                    colSpan={includeInternal ? 4 : 3}
                  >
                    {t('table.totals', { count: totals.rowCount })}
                  </th>
                  <td className={`${NUM} ${EDGE}`} />
                  <td className={`${NUM} font-bold`}>{points(totals.triggerPointsFired)}</td>
                  <td className={`${NUM} font-bold`}>
                    {hasMeter ? points(totals.pointsFromMinutes) : UNKNOWN_VALUE}
                  </td>
                  {isWeek && <td className={NUM} />}
                  <td className={`${NUM} ${EDGE}`} />
                  <td className={NUM} />
                  <td className={`${NUM} ${EDGE} font-bold`}>{minutes(totals.chargedMinutes)}</td>
                  <td className={`${NUM} font-bold`}>
                    {formatDuration(totals.trailSpanMinutes)}
                  </td>
                  <td className={`${NUM} font-bold`}>
                    {hasMeter ? formatSignedDuration(totals.meteringGapMinutes) : UNKNOWN_VALUE}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </DenseTableScroller>
      </section>
    </div>
  )
}

/**
 * THE REORDERING IS THE DATUM, not the two numbers — `DS-COMPONENTE-083` item 1.
 *
 * Glyph, sign and magnitude, never colour alone, and an `aria-label` saying the same thing in
 * words. With either position null there is nothing to compare and the cell is an em dash.
 */
function RankDeltaCell({ row }: { row: RankingRow }) {
  const t = useTranslations('Pages.Dashboard.ranking')
  const delta = rankDelta(row)

  if (delta === null) {
    return (
      <span role="img" className={DIM} aria-label={t('table.delta_unknown')}>
        {UNKNOWN_VALUE}
      </span>
    )
  }

  if (delta === 0) {
    return (
      <span role="img" className={DIM} aria-label={t('table.delta_same')}>
        =
      </span>
    )
  }

  const up = delta > 0
  const Icon = up ? ArrowUpRight : ArrowDownRight

  return (
    <span
      role="img"
      className={`inline-flex items-center gap-0.5 ${up ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}
      aria-label={
        up
          ? t('table.delta_up', { count: delta })
          : t('table.delta_down', { count: Math.abs(delta) })
      }
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {Math.abs(delta)}
    </span>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-semibold text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="tabular-nums text-gray-800 dark:text-gray-200">{value}</dd>
    </div>
  )
}

/** Five rows at the height of the loaded ones: a skeleton one size short is a table that jumps. */
function SkeletonRows({ columns }: { columns: number }) {
  return (
    <>
      {Array.from({ length: 5 }).map((_, index) => (
        <tr key={index} className="border-t border-gray-100 dark:border-gray-800">
          {Array.from({ length: columns }).map((__, cell) => (
            <td key={cell} className={CELL}>
              <div className="h-4 w-full animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

export default RankingScoreboard
