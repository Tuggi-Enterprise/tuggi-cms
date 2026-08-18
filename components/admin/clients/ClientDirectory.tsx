'use client'

/**
 * ONE LIST, where there were two.
 *
 * `/admin/clients` was anchored on `core.clients` and `/admin/partnerships` on
 * `core.partner_form_submissions`, so the same establishment was two rows in two screens with
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
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

  return (
    <div className="mx-auto w-full max-w-[100rem] px-6 py-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{t('title')}</h1>
          <p className="mt-1 text-sm text-gray-700">{t('subtitle')}</p>
        </div>
        {onCreateNew && (
          <Button type="button" variant="cta" onClick={onCreateNew}>
            {t('newClient')}
          </Button>
        )}
      </header>

      {/* The broken 72-hour promise (BR-B2B-010, item 4), counted over the WHOLE set and never
          over the filtered one: it is the count the operator clicks to REACH those rows. */}
      {late > 0 && (
        <nav className="mb-4">
          <button
            type="button"
            onClick={() => set('onlyLate', !filters.onlyLate)}
            aria-pressed={filters.onlyLate}
            className={`min-h-[24px] text-sm underline-offset-4 hover:underline ${
              filters.onlyLate ? 'font-semibold text-gray-900 underline' : 'font-medium text-primary-800'
            }`}
          >
            {p('queue.overdueCount', { count: late })}
          </button>
        </nav>
      )}

      {truncated && (
        <p role="status" className="mb-4 rounded-md border border-gray-300 p-3 text-sm text-gray-900">
          {t('truncated')}
        </p>
      )}

      <div className="flex flex-col gap-6 lg:flex-row">
        <aside className="w-full shrink-0 space-y-5 lg:w-64">
          <div>
            <Label htmlFor="directory-search">{t('searchLabel')}</Label>
            <Input
              id="directory-search"
              value={filters.search}
              placeholder={t('searchPlaceholder')}
              onChange={(event) => set('search', event.target.value)}
            />
          </div>

          {FACETS.map((key) => {
            const options = view.facets[key]
            // A dimension nobody filled in is not a filter — it is noise with a heading.
            if (options.length === 0) return null
            const selected = filters[key] as string | null

            return (
              <section key={key} aria-labelledby={`facet-${key}`}>
                <h2
                  id={`facet-${key}`}
                  className="text-xs font-semibold uppercase tracking-wide text-gray-900"
                >
                  {t(`filters.${key}`)}
                </h2>
                <ul className="mt-2 space-y-1">
                  {/*
                    THE WORKING SET, and it is the last thing `/admin/partnerships` had that this
                    list did not. A queue that shows `Publicado`, `Descartado` and `Recusado na
                    triagem` alongside what still needs doing is noise the operator learns to
                    ignore (criterion 4, DS-COPY-020, point 5). It is an option here and not the
                    default, because this is the client list too: somebody opening it to fix the
                    fiscal data of a partner already on air must still find them.
                  */}
                  {key === 'state' && (
                    <li>
                      <button
                        type="button"
                        aria-pressed={filters.state === 'in_progress'}
                        onClick={() =>
                          set('state', filters.state === 'in_progress' ? 'all' : 'in_progress')
                        }
                        className={`flex min-h-[24px] w-full items-center justify-between gap-2 text-left text-sm underline-offset-4 hover:underline ${
                          filters.state === 'in_progress'
                            ? 'font-semibold text-gray-900 underline'
                            : 'text-primary-800'
                        }`}
                      >
                        <span className="truncate">{p('queue.inProgress')}</span>
                        <span className="shrink-0 text-xs text-gray-700">{working}</span>
                      </button>
                    </li>
                  )}
                  {options.map((option) => {
                    const active = selected === option.value
                    return (
                      <li key={option.value}>
                        <button
                          type="button"
                          aria-pressed={active}
                          onClick={() =>
                            // Clearing a dimension means `null` for every one of them EXCEPT
                            // `state`, whose "no filter" value is `all` — `null` is not one of
                            // its values, and setting it matched no row at all.
                            set(
                              key as keyof DirectoryFilters,
                              (active
                                ? key === 'state'
                                  ? 'all'
                                  : null
                                : option.value) as never
                            )
                          }
                          className={`flex min-h-[24px] w-full items-center justify-between gap-2 text-left text-sm underline-offset-4 hover:underline ${
                            active ? 'font-semibold text-gray-900 underline' : 'text-primary-800'
                          }`}
                        >
                          <span className="truncate">{optionLabel(key, option.value)}</span>
                          <span className="shrink-0 text-xs text-gray-700">{option.count}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}

          <div className="flex items-center gap-2">
            <input
              id="directory-only-late"
              type="checkbox"
              checked={filters.onlyLate}
              onChange={(event) => set('onlyLate', event.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            <Label htmlFor="directory-only-late" className="mb-0">
              {t('filters.onlyLate')}
            </Label>
          </div>

          {view.filtering && (
            <Button variant="outline" className="w-full" onClick={() => onFiltersChange(EMPTY_FILTERS)}>
              {t('clear')}
            </Button>
          )}
        </aside>

        <section className="min-w-0 flex-1">
          <p className="mb-2 text-sm text-gray-700">
            {t('results', { count: view.rows.length, total: rows.length })}
          </p>

          {failed ? (
            <div className="rounded-md border border-gray-200 p-6 text-center">
              <p className="font-medium text-gray-900">{t('errorTitle')}</p>
              <Button variant="outline" className="mt-3" onClick={() => window.location.reload()}>
                {t('retry')}
              </Button>
            </div>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-gray-300 text-left text-xs uppercase tracking-wide text-gray-700">
                  <th scope="col" className="px-2 py-2">{t('columns.name')}</th>
                  <th scope="col" className="px-2 py-2">{t('columns.location')}</th>
                  <th scope="col" className="px-2 py-2">{t('columns.clientType')}</th>
                  <th scope="col" className="px-2 py-2">{t('columns.state')}</th>
                  <th scope="col" className="px-2 py-2">{t('columns.contract')}</th>
                  <th scope="col" className="px-2 py-2">{t('columns.missing')}</th>
                  <th scope="col" className="px-2 py-2">{t('columns.idle')}</th>
                  <th scope="col" className="px-2 py-2">{t('columns.triage')}</th>
                  <th scope="col" className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {loading &&
                  [0, 1, 2, 3, 4].map((index) => (
                    <tr key={`skeleton-${index}`} className="border-b border-gray-100">
                      <td className="px-2 py-3" colSpan={9}>
                        <span className="sr-only">{t('loading')}</span>
                        <span
                          className="block h-4 w-full animate-pulse rounded bg-gray-100"
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
                      <tr key={rowKey(row)} className="border-b border-gray-100 align-top">
                        <td className="px-2 py-3 text-gray-900">
                          <span className="block max-w-[20rem] truncate" title={row.name ?? ''}>
                            {name}
                          </span>
                          {row.status && (
                            <span className="block text-xs text-gray-700">
                              {t(`statusValues.${row.status}`)}
                            </span>
                          )}
                          {/*
                            A proposal nobody promoted has no registration behind it, and the
                            row says so instead of looking like a client that lost its data.

                            THE TEXT IS `text-gray-900` AND NOT `text-secondary-700`. The ramp
                            stops at `700` (#CC5200), which measures 4.16:1 on this surface —
                            below the 4.5:1 of SC 1.4.3 at 12px. The BORDER keeps the accent,
                            because a border is non-text and 4.16 clears its 3:1 (SC 1.4.11).
                            Caught by `tests/ct/partnerships-a11y.spec.tsx`, which never scanned
                            this badge while the queue's fixtures had no duplicate to render.
                          */}
                          {row.clientId === null && (
                            <span className="mt-1 inline-block rounded-full border border-secondary-700 px-1.5 py-0.5 text-xs text-gray-900">
                              {t('proposalBadge')}
                            </span>
                          )}
                          {row.duplicateCount > 0 && (
                            <span className="mt-1 inline-block rounded-full border border-secondary-700 px-1.5 py-0.5 text-xs text-gray-900">
                              {p('queue.duplicateBadge', { count: row.duplicateCount })}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-3 text-gray-800">{placeLine(row)}</td>
                        <td className="px-2 py-3 text-gray-800">{row.clientType ?? '—'}</td>
                        <td className="px-2 py-3 font-medium text-gray-900">
                          {p(`states.${row.state}`)}
                        </td>
                        <td className="px-2 py-3 text-gray-800">
                          {t(`contractValues.${row.contract}`)}
                        </td>
                        <td className="px-2 py-3 text-gray-800">{whatIsMissing(row, p)}</td>
                        <td className="px-2 py-3 text-gray-800">
                          <span>{idleFor(row.since, p)}</span>
                          <span className="block text-xs text-gray-700">{formatDate(row.since)}</span>
                        </td>
                        <td className="px-2 py-3 text-gray-900">
                          <span title={p('triage.deadlineTitle')}>{triageText(status, p)}</span>
                          {deadline && <span className="block text-xs text-gray-700">{deadline}</span>}
                        </td>
                        <td className="px-2 py-3">
                          <Link
                            href={`/${locale}${row.href}`}
                            aria-label={t('openNamed', { name })}
                            className="inline-flex min-h-[24px] items-center text-sm font-medium text-primary-800 underline underline-offset-4"
                          >
                            {t('open')}
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          )}

          {!loading && !failed && view.rows.length === 0 && (
            <div className="rounded-md border border-gray-200 p-6 text-center">
              <p className="font-medium text-gray-900">
                {view.filtering ? t('emptyFilteredTitle') : t('emptyTitle')}
              </p>
              {view.filtering && (
                <Button variant="outline" className="mt-3" onClick={() => onFiltersChange(EMPTY_FILTERS)}>
                  {t('clear')}
                </Button>
              )}
            </div>
          )}
        </section>
      </div>
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
