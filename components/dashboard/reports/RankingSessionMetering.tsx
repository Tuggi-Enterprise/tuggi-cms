'use client'

/**
 * ONE SESSION PER ROW — the drill-down of the `Diferença` column (#741, tab 2).
 *
 * IT EXISTS FOR THE TAIL. The divergence of BR-MONETIZACAO-049 does not live in the median:
 * over 72 charged sessions the median gap is 2,1 minutes and the maximum is 4.802 (80 hours).
 * The default ordering is therefore the largest difference first, and it is the database that
 * sorts — the route asks for it ordered, so a ceiling would cut the part nobody came to see.
 *
 * THE THREE TIME QUANTITIES SIT IN ONE GROUP, IN THIS ORDER, EACH WITH ITS OWN NAME — this is
 * the error the view exists to prevent (`DS-COPY-062` item 1): `Cobrado` is what was debited,
 * `Guia ligado` is the guide being on (which BR-AUDIO-026 already separates from charged: a
 * zeroed balance does not switch the guide off), and `Intervalo de sinal` is an interval that is
 * neither. Splitting them across groups or naming two of them with the same word would undo the
 * whole point.
 *
 * `Encerramento` PRINTS THE RAW VALUE. The vocabulary of `interruption_reason` has two
 * authorships — the client and `close_orphaned_sessions` — and nobody closed it. Inventing a
 * pretty label for it would be asserting a taxonomy that does not exist.
 */

import { Fragment, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Copy } from 'lucide-react'
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
import { AppUserLink } from '@/components/dashboard/AppUserLink'
import type { RpcError } from '@/lib/api/dashboard-fetch'
import { formatDuration, formatSignedDuration } from '@/lib/format/duration'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import { appUserLabel } from '@/lib/format/user-identity'
import { compareNullable, visibleRows, type SessionMeteringRow } from '@/lib/ranking/scoreboard'

type SortKey =
  | 'session_start'
  | 'charged_minutes'
  | 'guide_active_minutes'
  | 'trail_span_minutes'
  | 'metering_gap_minutes'
  | 'trigger_points_fired'
  | 'trail_points'

type ChipKey = 'all' | 'charged' | 'gap_over_60'

/** The difference the chip calls large. One hour is the operator's unit, not a measured threshold. */
const WIDE_GAP_MINUTES = 60

export interface RankingSessionMeteringProps {
  rows: SessionMeteringRow[]
  /** The same switch that governs the scoreboard: the #740 mark means the same thing in both. */
  includeInternal: boolean
  isLoading: boolean
  /** The failure as it came, `code` included — the SQLSTATE is what names `42501` (#755). */
  error: RpcError | null
  onRetry: () => void
  /** Set when the operator arrived from a row of tab 1. */
  personFilter: { userId: string; label: string } | null
  onClearPerson: () => void
}

export function RankingSessionMetering({
  rows,
  includeInternal,
  isLoading,
  error,
  onRetry,
  personFilter,
  onClearPerson,
}: RankingSessionMeteringProps) {
  const t = useTranslations('Pages.Dashboard.ranking')
  const locale = useLocale()

  const [sort, setSort] = useState<SortState<SortKey> | null>(null)
  const [chip, setChip] = useState<ChipKey>('all')
  const [expanded, setExpanded] = useState<string | null>(null)

  const shown = useMemo(() => visibleRows(rows, includeInternal), [rows, includeInternal])

  const counts = useMemo(
    () => ({
      all: shown.length,
      charged: shown.filter((row) => row.charged_minutes > 0).length,
      gap_over_60: shown.filter((row) => row.metering_gap_minutes > WIDE_GAP_MINUTES).length,
    }),
    [shown]
  )

  const tableRows = useMemo(() => {
    const kept = shown.filter((row) => {
      if (chip === 'charged') return row.charged_minutes > 0
      if (chip === 'gap_over_60') return row.metering_gap_minutes > WIDE_GAP_MINUTES
      return true
    })

    if (!sort) return kept

    if (sort.key === 'session_start') {
      return [...kept].sort(
        (a, b) =>
          (new Date(a.session_start).getTime() - new Date(b.session_start).getTime()) * sort.dir
      )
    }

    // Every other key is a minute or a count; `session_start` left above by its own branch.
    const key = sort.key as Exclude<SortKey, 'session_start'>
    return [...kept].sort((a, b) => compareNullable(a[key], b[key], sort.dir))
  }, [shown, chip, sort])

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

  const stamp = (value: string | null) =>
    value == null
      ? UNKNOWN_VALUE
      : new Intl.DateTimeFormat(locale, {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'UTC',
        }).format(new Date(value))

  const columnCount = 10

  return (
    <div className="space-y-6">
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
            active={chip === 'charged'}
            onClick={() => setChip('charged')}
            count={counts.charged}
          >
            {t('filters.charged')}
          </FilterChip>
          <FilterChip
            active={chip === 'gap_over_60'}
            onClick={() => setChip('gap_over_60')}
            count={counts.gap_over_60}
          >
            {t('filters.gap_over_60')}
          </FilterChip>

          {personFilter && (
            <span className="ml-auto flex items-center gap-2 text-[11px] text-gray-600 dark:text-gray-400">
              {t('metering.filtered_by_person', { person: personFilter.label })}
              <button
                type="button"
                onClick={onClearPerson}
                className="min-h-[24px] font-semibold underline underline-offset-2 hover:text-gray-900 dark:hover:text-white"
              >
                {t('metering.clear_person')}
              </button>
            </span>
          )}
        </header>

        <DenseTableScroller>
          <table className="w-full min-w-[1040px] border-collapse">
            <caption className="px-3 py-2 text-left text-[11px] text-gray-600 dark:text-gray-400">
              {t.rich('caption.span', { b: (chunks) => <strong>{chunks}</strong> })}{' '}
              {t.rich('caption.platform', { b: (chunks) => <strong>{chunks}</strong> })}{' '}
              {t.rich('caption.closing', { b: (chunks) => <strong>{chunks}</strong> })}
            </caption>
            <thead>
              <tr>
                <th className={`${GROUP} text-gray-500 dark:text-gray-400`} colSpan={3} />
                <th
                  className={`${GROUP} ${EDGE} text-primary-800 dark:text-tuggi-blue`}
                  colSpan={4}
                  scope="colgroup"
                >
                  {t('group.session_time')}
                </th>
                <th
                  className={`${GROUP} ${EDGE} text-gray-500 dark:text-gray-400`}
                  colSpan={3}
                  scope="colgroup"
                >
                  {t('group.session')}
                </th>
              </tr>
              <tr>
                {head('session_start', t('metering.session_start'), HEAD)}
                <th scope="col" className={HEAD}>
                  {t('table.person')}
                </th>
                <th scope="col" className={HEAD}>
                  {t('table.platform')}
                </th>
                {head('charged_minutes', t('table.charged'), `${HEAD_NUM} ${EDGE}`)}
                {head('guide_active_minutes', t('metering.guide_active'), HEAD_NUM)}
                {head('trail_span_minutes', t('table.trail_span'), HEAD_NUM)}
                {head('metering_gap_minutes', t('table.gap'), HEAD_NUM)}
                {head('trigger_points_fired', t('table.triggers'), `${HEAD_NUM} ${EDGE}`)}
                {head('trail_points', t('metering.trail_points'), HEAD_NUM)}
                <th scope="col" className={HEAD}>
                  {t('metering.closing')}
                </th>
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
                    {t('empty.sessions')}
                  </td>
                </tr>
              )}

              {!isLoading &&
                tableRows.map((row) => {
                  const isOpen = expanded === row.trip_session_id
                  const person = appUserLabel(row)

                  return (
                    <Fragment key={row.trip_session_id}>
                      <tr className="border-t border-gray-100 hover:bg-gray-50/70 dark:border-gray-800 dark:hover:bg-gray-800/40">
                        <td className={`${CELL} whitespace-nowrap tabular-nums`}>
                          <button
                            type="button"
                            aria-expanded={isOpen}
                            aria-label={
                              isOpen
                                ? t('table.collapse', { person })
                                : t('table.expand', { person })
                            }
                            onClick={() => setExpanded(isOpen ? null : row.trip_session_id)}
                            className="mr-1 inline-flex h-6 w-6 min-h-[24px] min-w-[24px] items-center justify-center rounded text-gray-500 hover:text-gray-900 dark:hover:text-white"
                          >
                            {isOpen ? '−' : '+'}
                          </button>
                          {stamp(row.session_start)}
                        </td>
                        <th
                          scope="row"
                          className={`${CELL} min-w-[10rem] max-w-[16rem] truncate text-left font-medium text-gray-900 dark:text-white`}
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

                        <td className={`${NUM} ${EDGE}`}>{formatDuration(row.charged_minutes)}</td>
                        <td className={NUM}>{formatDuration(row.guide_active_minutes)}</td>
                        <td className={NUM}>{formatDuration(row.trail_span_minutes)}</td>
                        <td className={`${NUM} font-semibold`}>
                          {formatSignedDuration(row.metering_gap_minutes)}
                        </td>

                        <td className={`${NUM} ${EDGE}`}>{row.trigger_points_fired}</td>
                        <td className={NUM}>{row.trail_points}</td>
                        <td className={`${CELL} whitespace-nowrap`}>
                          {row.was_interrupted && row.interruption_reason ? (
                            <span className="font-mono text-[11px]">{row.interruption_reason}</span>
                          ) : (
                            UNKNOWN_VALUE
                          )}
                        </td>
                      </tr>

                      {isOpen && (
                        <tr className="bg-tuggi-blue/[.04]">
                          <td colSpan={columnCount} className="px-5 py-4">
                            <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
                              <div>
                                <dt className="font-semibold text-gray-500 dark:text-gray-400">
                                  {t('metering.session_id')}
                                </dt>
                                <dd className="flex items-center gap-2 font-mono text-[11px] text-gray-800 dark:text-gray-200">
                                  {row.trip_session_id}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      navigator.clipboard?.writeText(row.trip_session_id)
                                    }
                                    title={t('row.copy')}
                                    className="inline-flex h-6 w-6 min-h-[24px] min-w-[24px] items-center justify-center rounded text-gray-500 hover:text-gray-900 dark:hover:text-white"
                                  >
                                    <Copy className="h-3 w-3" aria-hidden="true" />
                                    <span className="sr-only">{t('row.copy')}</span>
                                  </button>
                                </dd>
                              </div>
                              {/* `session_end` is NOT final: the offline queue can still move it
                                  forward (BR-MONETIZACAO-049), and the contract says so. */}
                              <div>
                                <dt className="font-semibold text-gray-500 dark:text-gray-400">
                                  {t('metering.session_end')}
                                </dt>
                                <dd className="tabular-nums text-gray-800 dark:text-gray-200">
                                  {stamp(row.session_end)}
                                  <span className={`ml-2 text-[11px] ${DIM}`}>
                                    {t('metering.session_end_note')}
                                  </span>
                                </dd>
                              </div>
                              <Detail label={t('metering.first_signal')} value={stamp(row.first_signal_at)} />
                              <Detail label={t('metering.last_signal')} value={stamp(row.last_signal_at)} />
                              <Detail label={t('metering.first_charge')} value={stamp(row.first_charge_at)} />
                              <Detail label={t('metering.last_charge')} value={stamp(row.last_charge_at)} />
                            </dl>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
            </tbody>
          </table>
        </DenseTableScroller>
      </section>
    </div>
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

export default RankingSessionMetering
