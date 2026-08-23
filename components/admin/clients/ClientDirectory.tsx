'use client'

/**
 * ONE LIST, where there were two.
 *
 * `/admin/clients` was anchored on `partner.clients` and `/admin/partnerships` on
 * `partner.partner_form_submissions`, so the same establishment was two rows in two screens with
 * two vocabularies — and neither could answer `quais parceiros de Minas ainda não assinaram o
 * contrato?`, because half of that lived in the other screen. The spine here is the union, and
 * the rail is what makes the union worth having.
 *
 * A TABLE AND NOT CARDS, for the reason the queue already wrote down: this is read by somebody
 * who does it all day and scans by column, and "clean" here almost always means "slow". Its
 * palette is the sober one — `text-primary-800` (#00719F, 5.44:1) and never `text-tuggi-blue`
 * (#00A8E8, 2.70:1, which fails SC 1.4.3).
 *
 * EVERY STATE IS TEXT (DS-A11Y-003): the pipeline state, the contract, the triage clock. None
 * of them is distinguishable by colour or by icon alone.
 *
 * THE FACETS COME FROM THE ROWS. `país`, `estado` and `cidade` are free text in the
 * registration, and on 2026-08-17 only 3 of 11 rows carried a country — a dropdown of 200
 * countries over 3 usable values costs more to read than the list it filters. A dimension with
 * nothing to choose from does not render, and every option carries the count it opens. That
 * count comes from the same predicate the table applies, which is the guarantee
 * `lib/clients/directory-filter` exists to hold.
 *
 * THE PARTNERSHIP VOCABULARY IS PORTUGUESE-ONLY (#408, spec §2) and the rest of this screen is
 * translated, so the two namespaces travel together: `Clients.directory` in the operator's
 * locale, `Partnerships` overlaid in Portuguese by the tab's own provider.
 */

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { DirectoryFilterRail } from '@/components/admin/clients/DirectoryFilterRail'
import { formatDate } from '@/components/admin/partner-proposals/format'
import { idleFor, placeLine, rowKey, whatIsMissing } from '@/components/admin/clients/board/row-text'
import { deriveTriageStatus, type TriageStatus } from '@/lib/partnerships/triage'
import { triageDeadlineText, triageText } from '@/components/admin/partnerships/triage-text'
import {
  EMPTY_FILTERS,
  buildDirectoryView,
  inProgressCount,
  overdueCount,
  type DirectoryFilters,
} from '@/lib/clients/directory-filter'
import type { ClientDirectoryRow } from '@/lib/services/partnership-service'

/** What a row with no clock reads as — one constant, so the count and the cell agree. */
const NOT_STARTED: TriageStatus = { kind: 'not_started' }

interface ClientDirectoryProps {
  locale: string
  /**
   * THE FILTERS ARE THE URL'S, and this component does not know that.
   *
   * The host reads and writes them (`parseFilters` / `applyFilters`), which is what makes
   * `Minas, sem contrato` a link somebody can send. Keeping `useSearchParams` out of here also
   * keeps the screen mountable in `tests/ct`, where there is no Next app router to provide one
   * — the same reason `tests/ct/helpers.tsx` leaves `Header` out.
   */
  filters: DirectoryFilters
  onFiltersChange: (next: DirectoryFilters) => void
  onCreateNew?: () => void
  /**
   * THE ROWS COME FROM THE HOST, and so does the board's copy of them: `useClientDirectory` is
   * one read for both views, so switching between them does not re-fetch and an act on a card
   * invalidates the table behind it.
   */
  rows: ClientDirectoryRow[]
  truncated: boolean
  loading: boolean
  failed: boolean
  /** The Quadro/Tabela control, rendered by the host so both views carry the same one. */
  viewSwitch?: React.ReactNode
}

export function ClientDirectory({
  locale,
  filters,
  onFiltersChange,
  onCreateNew,
  rows,
  truncated,
  loading,
  failed,
  viewSwitch,
}: ClientDirectoryProps) {
  const t = useTranslations('Clients.directory')
  const p = useTranslations('Partnerships')

  const view = useMemo(() => buildDirectoryView(rows, filters), [rows, filters])
  const late = useMemo(() => overdueCount(rows), [rows])
  const working = useMemo(() => inProgressCount(rows), [rows])

  /**
   * The clock of every row, derived ONCE from one `now`. Two rows approved in the same minute
   * must not disagree about the deadline because they rendered milliseconds apart.
   */
  const triage = useMemo(() => {
    const now = new Date()
    const map = new Map<string, TriageStatus>()
    for (const row of rows) map.set(rowKey(row), deriveTriageStatus(row.triage, now))
    return map
  }, [rows])

  function set<K extends keyof DirectoryFilters>(key: K, value: DirectoryFilters[K]) {
    onFiltersChange({ ...filters, [key]: value })
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 p-6 dark:bg-gray-950 lg:p-8">
      <div className="flex flex-1 gap-8 pt-6">
        <DirectoryFilterRail
          view={view}
          filters={filters}
          onFiltersChange={onFiltersChange}
          working={working}
        />

        {/* ── The list ──────────────────────────────────────────────────────────────────── */}
        <div className="w-[82%] min-w-0">
          <div className="sticky top-0 z-30 mb-8 rounded-3xl border border-gray-200 bg-white/80 shadow-2xl shadow-black/5 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-900/80">
            <div className="flex flex-wrap items-center justify-between gap-4 p-4">
              <div className="flex flex-wrap items-center gap-8 pl-2">
                <div>
                  <h1 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-white">
                    {t('title')}
                  </h1>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{t('subtitle')}</p>
                </div>

                <div className="h-8 w-px bg-gray-200 dark:bg-gray-800" aria-hidden="true" />

                <Stat label={t('columns.name')} value={t('results', { count: view.rows.length, total: rows.length })} />

                {/* The broken 72-hour promise (BR-B2B-010, item 4), counted over the WHOLE set
                    and never over the filtered one: it is the count the operator clicks to
                    REACH those rows. */}
                {late > 0 && (
                  <button
                    type="button"
                    onClick={() => set('onlyLate', !filters.onlyLate)}
                    aria-pressed={filters.onlyLate}
                    className={`min-h-[24px] text-sm underline-offset-4 hover:underline ${
                      filters.onlyLate
                        ? 'font-semibold text-gray-900 underline dark:text-white'
                        : 'font-medium text-primary-800 dark:text-tuggi-blue'
                    }`}
                  >
                    {p('queue.overdueCount', { count: late })}
                  </button>
                )}
              </div>

              <div className="flex items-center gap-3">
                {viewSwitch}
                {onCreateNew && (
                  <Button type="button" variant="cta" onClick={onCreateNew}>
                    {t('newClient')}
                  </Button>
                )}
              </div>
            </div>
          </div>

          {truncated && (
            <p
              role="status"
              className="mb-4 rounded-2xl border border-gray-200 bg-white/70 p-3 text-sm text-gray-900 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-900/70 dark:text-gray-200"
            >
              {t('truncated')}
            </p>
          )}

          <div className="overflow-hidden rounded-3xl border border-gray-200 bg-white/70 shadow-2xl shadow-black/5 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-900/70">
            {failed ? (
              <div className="p-8 text-center">
                <p className="font-medium text-gray-900 dark:text-white">{t('errorTitle')}</p>
                <Button variant="outline" className="mt-3" onClick={() => window.location.reload()}>
                  {t('retry')}
                </Button>
              </div>
            ) : (
              // Nine columns on a commercial team's monitor: the card scrolls its own table
              // rather than the page scrolling sideways.
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-[10px] uppercase tracking-widest text-gray-500 dark:border-gray-800 dark:text-gray-400">
                      <th scope="col" className="px-4 py-3">{t('columns.name')}</th>
                      <th scope="col" className="px-4 py-3">{t('columns.location')}</th>
                      <th scope="col" className="px-4 py-3">{t('columns.clientType')}</th>
                      <th scope="col" className="px-4 py-3">{t('columns.state')}</th>
                      <th scope="col" className="px-4 py-3">{t('columns.contract')}</th>
                      <th scope="col" className="px-4 py-3">{t('columns.missing')}</th>
                      <th scope="col" className="px-4 py-3">{t('columns.idle')}</th>
                      <th scope="col" className="px-4 py-3">{t('columns.triage')}</th>
                      <th scope="col" className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {loading &&
                      [0, 1, 2, 3, 4].map((index) => (
                        <tr key={`skeleton-${index}`} className="border-b border-gray-100 dark:border-gray-800">
                          <td className="px-4 py-4" colSpan={9}>
                            <span className="sr-only">{t('loading')}</span>
                            <span
                              className="block h-4 w-full animate-pulse rounded bg-gray-100 dark:bg-gray-800"
                              aria-hidden="true"
                            />
                          </td>
                        </tr>
                      ))}

                    {!loading &&
                      view.rows.map((row) => {
                        const status = triage.get(rowKey(row)) ?? NOT_STARTED
                        const deadline = triageDeadlineText(status)
                        const name = row.name || t('noName')

                        return (
                          <tr
                            key={rowKey(row)}
                            className="border-b border-gray-100 align-top transition-colors last:border-0 hover:bg-gray-50/60 dark:border-gray-800 dark:hover:bg-gray-800/40"
                          >
                            <td className="px-4 py-4 text-gray-900 dark:text-white">
                              <span className="block max-w-[20rem] truncate font-medium" title={row.name ?? ''}>
                                {name}
                              </span>
                              {row.status && (
                                <span className="block text-xs text-gray-500 dark:text-gray-400">
                                  {t(`statusValues.${row.status}`)}
                                </span>
                              )}
                              {/*
                                A proposal nobody promoted has no registration behind it, and the
                                row says so instead of looking like a client that lost its data.

                                THE TEXT IS `text-gray-900` AND NOT `text-secondary-700`. The
                                ramp stops at `700` (#CC5200), which measures 4.16:1 on this
                                surface — below the 4.5:1 of SC 1.4.3 at 12px. The BORDER keeps
                                the accent: a border is non-text and 4.16 clears its 3:1
                                (SC 1.4.11). Caught by `tests/ct/partnerships-a11y.spec.tsx`.
                              */}
                              {row.clientId === null && (
                                <span className="mt-1 inline-block rounded-full border border-secondary-700 px-2 py-0.5 text-xs text-gray-900 dark:text-gray-200">
                                  {t('proposalBadge')}
                                </span>
                              )}
                              {row.duplicateCount > 0 && (
                                <span className="mt-1 inline-block rounded-full border border-secondary-700 px-2 py-0.5 text-xs text-gray-900 dark:text-gray-200">
                                  {p('queue.duplicateBadge', { count: row.duplicateCount })}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-4 text-gray-800 dark:text-gray-300">{placeLine(row)}</td>
                            <td className="px-4 py-4 text-gray-800 dark:text-gray-300">{row.clientType ?? '—'}</td>
                            <td className="px-4 py-4 font-medium text-gray-900 dark:text-white">
                              {p(`states.${row.state}`)}
                            </td>
                            <td className="px-4 py-4 text-gray-800 dark:text-gray-300">
                              {t(`contractValues.${row.contract}`)}
                            </td>
                            <td className="px-4 py-4 text-gray-800 dark:text-gray-300">{whatIsMissing(row, p)}</td>
                            <td className="px-4 py-4 text-gray-800 dark:text-gray-300">
                              <span>{idleFor(row.since, p)}</span>
                              <span className="block text-xs text-gray-500 dark:text-gray-400">
                                {formatDate(row.since)}
                              </span>
                            </td>
                            <td className="px-4 py-4 text-gray-900 dark:text-gray-200">
                              <span title={p('triage.deadlineTitle')}>{triageText(status, p)}</span>
                              {deadline && (
                                <span className="block text-xs text-gray-500 dark:text-gray-400">{deadline}</span>
                              )}
                            </td>
                            <td className="px-4 py-4">
                              <Link
                                href={`/${locale}${row.href}`}
                                aria-label={t('openNamed', { name })}
                                className="inline-flex min-h-[24px] items-center text-sm font-medium text-primary-800 underline underline-offset-4 dark:text-tuggi-blue"
                              >
                                {t('open')}
                              </Link>
                            </td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
              </div>
            )}

            {!loading && !failed && view.rows.length === 0 && (
              <div className="p-8 text-center">
                <p className="font-medium text-gray-900 dark:text-white">
                  {view.filtering ? t('emptyFilteredTitle') : t('emptyTitle')}
                </p>
                {view.filtering && (
                  <Button variant="outline" className="mt-3" onClick={() => onFiltersChange(EMPTY_FILTERS)}>
                    {t('clear')}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * A figure in the sticky bar, in the shape `/pois` uses: micro-caps label over the value.
 *
 * WITH ONE CORRECTION TO THE PATTERN. `/pois` paints these labels `text-gray-400` (#9CA3AF),
 * which measures 2.51:1 at 10px bold on the panel — SC 1.4.3 asks 4.5:1, and 10px is not large
 * text under any reading. `text-gray-500` (#6B7280) is 4.83:1 and is the same label at the same
 * weight. Caught by `axe-core` in `tests/ct/partnerships-a11y.spec.tsx` the moment this screen
 * adopted the idiom; reported to `design` as a finding about the pattern, not about this file.
 */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="mb-1 text-[10px] font-bold uppercase leading-none tracking-widest text-gray-500 dark:text-gray-400">
        {label}
      </span>
      <span className="text-lg font-bold leading-none text-gray-900 dark:text-white">{value}</span>
    </div>
  )
}
