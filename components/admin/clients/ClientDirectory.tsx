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

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { Filter, RotateCcw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatDate } from '@/components/admin/partner-proposals/format'
import { daysUntil } from '@/lib/partner-form/regularity'
import { deriveTriageStatus, type TriageStatus } from '@/lib/partnerships/triage'
import { triageDeadlineText, triageText } from '@/components/admin/partnerships/triage-text'
import {
  EMPTY_FILTERS,
  buildDirectoryView,
  inProgressCount,
  overdueCount,
  type DirectoryFilters,
  type FacetKey,
} from '@/lib/clients/directory-filter'
import type { ClientDirectoryRow } from '@/lib/services/partnership-service'

/** What a row with no clock reads as — one constant, so the count and the cell agree. */
const NOT_STARTED: TriageStatus = { kind: 'not_started' }

/** The rail, in the order an operator narrows: where, then who, then how far along. */
const FACETS: FacetKey[] = ['country', 'region', 'city', 'clientType', 'status', 'contract', 'state']

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
}

export function ClientDirectory({
  locale,
  filters,
  onFiltersChange,
  onCreateNew,
}: ClientDirectoryProps) {
  const t = useTranslations('Clients.directory')
  const p = useTranslations('Partnerships')

  const [rows, setRows] = useState<ClientDirectoryRow[]>([])
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const fetchRows = useCallback(async () => {
    const response = await fetch('/api/admin/clients/directory')
    if (!response.ok) return null
    return (await response.json()) as { rows: ClientDirectoryRow[]; truncated: boolean }
  }, [])

  useEffect(() => {
    let active = true
    void fetchRows()
      .then((payload) => {
        if (!active) return
        if (payload) {
          setRows(payload.rows)
          setTruncated(payload.truncated)
        } else {
          setFailed(true)
        }
        setLoading(false)
      })
      .catch(() => {
        if (!active) return
        setFailed(true)
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [fetchRows])

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

  /** The label of one facet value — the vocabulary is the pipeline's, not this screen's. */
  function optionLabel(key: FacetKey, value: string): string {
    if (key === 'state') return p(`states.${value}`)
    if (key === 'contract') return t(`contractValues.${value}`)
    if (key === 'status') return t(`statusValues.${value}`)
    return value
  }

  const clearControl = view.filtering ? (
    <button
      type="button"
      onClick={() => onFiltersChange(EMPTY_FILTERS)}
      aria-label={t('clear')}
      title={t('clear')}
      className="rounded-lg p-2 text-gray-400 transition-all hover:bg-primary-800/5 hover:text-primary-800"
    >
      <RotateCcw className="h-4 w-4" aria-hidden="true" />
    </button>
  ) : null

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 p-6 dark:bg-gray-950 lg:p-8">
      <div className="flex flex-1 gap-8 pt-6">
        {/* ── The rail ──────────────────────────────────────────────────────────────────── */}
        <div className="w-[18%] flex-shrink-0">
          <div className="sticky top-24 rounded-3xl border border-gray-200 bg-white/70 shadow-2xl shadow-black/5 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-900/70">
            <div className="p-6">
              <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {/* The chip is a SURFACE tint and the icon inside it is decorative — the
                      heading beside it carries the meaning, so it is `aria-hidden` and exempt
                      from SC 1.4.11. That is what lets the brand blue stay here while never
                      painting a word. */}
                  <div className="rounded-xl bg-tuggi-blue/10 p-2">
                    <Filter className="h-5 w-5 text-tuggi-blue" aria-hidden="true" />
                  </div>
                  <h2 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-white">
                    {t('filtersTitle')}
                  </h2>
                </div>
                {clearControl}
              </div>

              <div className="mb-6">
                <label htmlFor="directory-search" className="sr-only">
                  {t('searchLabel')}
                </label>
                <div className="group relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <Search
                      className="h-4 w-4 text-gray-400 transition-colors group-focus-within:text-primary-800"
                      aria-hidden="true"
                    />
                  </div>
                  <input
                    id="directory-search"
                    type="text"
                    value={filters.search}
                    placeholder={t('searchPlaceholder')}
                    onChange={(event) => set('search', event.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50/50 py-3 pl-10 pr-4 text-sm outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-primary-800 dark:border-gray-700 dark:bg-gray-800/50 dark:text-white"
                  />
                </div>
              </div>

              <div className="space-y-5">
                {FACETS.map((key) => {
                  const options = view.facets[key]
                  // A dimension nobody filled in is not a filter — it is noise with a heading.
                  if (options.length === 0) return null
                  const selected = filters[key] as string | null

                  return (
                    <section key={key} aria-labelledby={`facet-${key}`}>
                      <h3
                        id={`facet-${key}`}
                        className="mb-3 px-1 text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400"
                      >
                        {t(`filters.${key}`)}
                      </h3>
                      <ul className="space-y-1">
                        {/*
                          THE WORKING SET, and it is the one thing `/admin/partnerships` had that
                          this list did not. A list that shows `Publicado`, `Descartado` and
                          `Recusado na triagem` alongside what still needs doing is noise the
                          operator learns to ignore (criterion 4, DS-COPY-020, point 5). An
                          option and not the default: this is the client list too, and somebody
                          fixing the fiscal data of a partner already on air must find them.
                        */}
                        {key === 'state' && (
                          <li>
                            <FacetOptionButton
                              label={p('queue.inProgress')}
                              count={working}
                              active={filters.state === 'in_progress'}
                              onToggle={() =>
                                set('state', filters.state === 'in_progress' ? 'all' : 'in_progress')
                              }
                            />
                          </li>
                        )}
                        {options.map((option) => (
                          <li key={option.value}>
                            <FacetOptionButton
                              label={optionLabel(key, option.value)}
                              count={option.count}
                              active={selected === option.value}
                              onToggle={() =>
                                // Clearing a dimension means `null` for every one of them EXCEPT
                                // `state`, whose "no filter" value is `all` — `null` is not one
                                // of its values, and setting it matched no row at all.
                                set(
                                  key as keyof DirectoryFilters,
                                  (selected === option.value
                                    ? key === 'state'
                                      ? 'all'
                                      : null
                                    : option.value) as never
                                )
                              }
                            />
                          </li>
                        ))}
                      </ul>
                    </section>
                  )
                })}

                <div className="border-t border-gray-100 pt-4 dark:border-gray-800">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={filters.onlyLate}
                      onChange={(event) => set('onlyLate', event.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-primary-800 focus:ring-primary-800"
                    />
                    <span className="text-sm text-gray-900 dark:text-gray-200">
                      {t('filters.onlyLate')}
                    </span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>

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

              {onCreateNew && (
                <Button type="button" variant="cta" onClick={onCreateNew}>
                  {t('newClient')}
                </Button>
              )}
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
 * One option of the rail: the label, and the count it would open.
 *
 * `text-primary-800` on light and `text-tuggi-blue` on dark, which is not an inconsistency —
 * it is the same measurement read on two surfaces. The brand blue is 2.70:1 on white and fails
 * SC 1.4.3; on `gray-900` it is 6.57:1 and passes comfortably. The token that fails as ink in
 * daylight is the one that works at night.
 */
function FacetOptionButton({
  label,
  count,
  active,
  onToggle,
}: {
  label: string
  count: number
  active: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onToggle}
      className={`flex min-h-[24px] w-full items-center justify-between gap-2 rounded-lg px-1 py-1 text-left text-sm underline-offset-4 transition-colors hover:underline ${
        active
          ? 'font-semibold text-gray-900 underline dark:text-white'
          : 'text-primary-800 dark:text-tuggi-blue'
      }`}
    >
      <span className="truncate">{label}</span>
      <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">{count}</span>
    </button>
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

/** A row is a client, or a proposal that is not one yet — one of the two ids is always there. */
function rowKey(row: ClientDirectoryRow): string {
  return row.clientId ?? row.submissionId ?? ''
}

function placeLine(row: ClientDirectoryRow): string {
  const parts = [row.city, row.region, row.country].filter(Boolean)
  return parts.length > 0 ? parts.join(' / ') : '—'
}

/**
 * The `O que falta` column — the next step, or the pendency counts of the LEAST ADVANCED place
 * plus the proportion. Never the sum across places: summing hides which one is stuck
 * (DS-COMPONENTE-020, 2nd edge case). Same rule the queue applies, same keys.
 */
function whatIsMissing(row: ClientDirectoryRow, p: ReturnType<typeof useTranslations>): string {
  // The act owed to somebody OUTSIDE the company wins the column (DS-COPY-020, points 2 and 5).
  if (row.state === 'refusal_not_communicated') return p('nextSteps.refusal_not_communicated')

  const parts: string[] = []
  if (row.places.total > 1) {
    parts.push(p('queue.placesProgress', { published: row.places.published, total: row.places.total }))
  }
  if (row.places.blocking > 0) parts.push(p('queue.missingBlocking', { count: row.places.blocking }))
  if (row.places.silencing > 0) parts.push(p('queue.missingSilencing', { count: row.places.silencing }))

  if (parts.length > 0) return parts.join(p('queue.missingSeparator'))
  return p(`nextSteps.${row.state}`)
}

/** `Parado há`, counted on the calendar day by the one function that counts days here. */
function idleFor(since: string | null, p: ReturnType<typeof useTranslations>): string {
  if (!since) return p('queue.idleUnknown')
  const days = daysUntil(since)
  if (days === null) return p('queue.idleUnknown')
  return p('queue.idleDays', { count: Math.max(0, -days) })
}
