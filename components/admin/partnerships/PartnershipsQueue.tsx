'use client'

/**
 * The pipeline queue — one screen where the proposal, the client, the contract and the place
 * are the same row.
 *
 * IT REPLACES `ProposalsTab`, and the two things worth keeping came with it: the filter rail
 * and the `+{n} com o mesmo CNPJ` badge. `/admin/partner-proposals` (the list) is gone —
 * absorbed, not duplicated, because a screen with no route is an orphan (CLAUDE.md §6).
 *
 * A TABLE AND NOT CARDS. This is a work queue read by somebody who does it all day and scans
 * by column; "clean" here almost always means "slow". Its palette is the sober one of
 * `components/admin/partner-proposals/` — `text-primary-800` (#00719F, 5.44:1) for text and
 * informative icons, never `text-tuggi-blue` (#00A8E8, 2.70:1, which fails SC 1.4.3).
 *
 * THE STATE IS TEXT, always (DS-A11Y-003 and criterion 2): nothing on this screen is
 * distinguishable by colour or by icon alone. THE `Triagem` COLUMN INCLUDED — it is the 72-hour
 * promise of BR-B2B-010, item 4, and `venceu há 2 dias` in red would be the same information for
 * nobody who cannot see red.
 *
 * THE COLUMN ARRIVED WITH #377, once the outcome of the triage had a place to live
 * (`core.partner_triage_refusals`). While it did not, a refused partnership would have shown as
 * overdue forever and the column would have become noise the operator learns to ignore — which
 * is why spec §9, question 3, held it back. The ordering follows from it: the overdue rows first,
 * then the longest idle, because a broken promise outranks a slow one.
 *
 * `{n} com a triagem vencida` AND THE DEFAULT FILTER CANNOT DISAGREE, and that is not a property
 * of this component — it is `derivePipelineState` putting `Recusa não comunicada` in
 * `IN_PROGRESS_STATES` (DS-COPY-020, point 5). The counter scans `rows` and the table renders
 * `filtered`; while the refusal was terminal from the DECISION, clicking `1 com a triagem vencida`
 * opened `Nenhuma parceria com esse filtro`. The guarantee is asserted over the two pure modules
 * in `tests/api/partnership-triage.test.ts`, never by making the counter read the filtered list.
 */

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatDate } from '@/components/admin/partner-proposals/format'
import { daysUntil } from '@/lib/partner-form/regularity'
import { deriveTriageStatus, isTriageOverdue, type TriageStatus } from '@/lib/partnerships/triage'
import { triageDeadlineText, triageText } from './triage-text'
import {
  IN_PROGRESS_STATES,
  PIPELINE_STATES,
  type PipelineState,
} from '@/lib/partnerships/pipeline'
import type { PartnershipQueueRow } from '@/lib/services/partnership-service'

type StateFilter = 'in_progress' | 'all' | PipelineState

/**
 * What a row with no clock reads as. One constant and not five inline literals: the counter, the
 * filter, the two sides of the sort and the cell have to fall back to the SAME status, or the
 * count and the table start disagreeing about a row nobody approved yet.
 */
const NOT_STARTED: TriageStatus = { kind: 'not_started' }

export function PartnershipsQueue({ locale }: { locale: string }) {
  const t = useTranslations('Partnerships')

  const [rows, setRows] = useState<PartnershipQueueRow[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState<StateFilter>('in_progress')
  const [onlyLate, setOnlyLate] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setFailed(false)
      try {
        const response = await fetch('/api/admin/partnerships')
        const payload = response.ok ? await response.json() : null
        if (cancelled) return
        if (payload && Array.isArray(payload.partnerships)) {
          setRows(payload.partnerships as PartnershipQueueRow[])
        } else {
          setFailed(true)
        }
      } catch {
        if (!cancelled) setFailed(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const counts = useMemo(() => {
    const map = new Map<PipelineState, number>()
    for (const row of rows) map.set(row.state, (map.get(row.state) ?? 0) + 1)
    return map
  }, [rows])

  /**
   * The clock of every row, derived ONCE from one `now`.
   *
   * One instant for the whole table and not `new Date()` per cell: two rows approved at the same
   * minute must not disagree about the deadline because they rendered milliseconds apart, and the
   * counter above the table has to count exactly the rows the column marks.
   */
  const triage = useMemo(() => {
    const now = new Date()
    const map = new Map<string, TriageStatus>()
    for (const row of rows) map.set(row.submissionId, deriveTriageStatus(row.triage, now))
    return map
  }, [rows])

  const overdueCount = useMemo(
    () => rows.filter((row) => isTriageOverdue(triage.get(row.submissionId) ?? NOT_STARTED)).length,
    [rows, triage]
  )

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return rows
      .filter((row) => {
        // The default is `Em andamento`, and a terminal state only shows up when it is asked
        // for by name (criterion 4).
        if (stateFilter === 'in_progress' && IN_PROGRESS_STATES.indexOf(row.state) < 0) return false
        if (stateFilter !== 'in_progress' && stateFilter !== 'all' && row.state !== stateFilter) {
          return false
        }
        if (onlyLate && !isTriageOverdue(triage.get(row.submissionId) ?? NOT_STARTED)) {
          return false
        }
        if (!needle) return true
        return (
          (row.tradeName ?? '').toLowerCase().indexOf(needle) >= 0 ||
          (row.taxId ?? '').toLowerCase().indexOf(needle) >= 0 ||
          (row.city ?? '').toLowerCase().indexOf(needle) >= 0
        )
      })
      // Overdue triage first (spec §6.1), then longest idle: a broken 72-hour promise outranks a
      // row nobody has touched, and among equals the one waiting the longest comes first.
      .sort((a, b) => {
        const lateA = isTriageOverdue(triage.get(a.submissionId) ?? NOT_STARTED)
        const lateB = isTriageOverdue(triage.get(b.submissionId) ?? NOT_STARTED)
        if (lateA !== lateB) return lateA ? -1 : 1
        return (a.since ?? '').localeCompare(b.since ?? '')
      })
  }, [rows, search, stateFilter, onlyLate, triage])

  const filtering = search.trim() !== '' || stateFilter !== 'in_progress' || onlyLate

  function clearFilters() {
    setSearch('')
    setStateFilter('in_progress')
    setOnlyLate(false)
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-6">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold text-gray-900">{t('title')}</h1>
        <p className="mt-1 text-sm text-gray-700">{t('subtitle')}</p>
      </header>

      {/* The count per state, in text, each one a filter. Never a colour-coded strip. */}
      <nav aria-label={t('queue.countsLabel')} className="mb-4 flex flex-wrap gap-x-4 gap-y-2">
        {PIPELINE_STATES.map((state) => (
          <button
            key={state}
            type="button"
            onClick={() => setStateFilter(state)}
            aria-pressed={stateFilter === state}
            className={`min-h-[24px] text-sm underline-offset-4 hover:underline ${
              stateFilter === state ? 'font-semibold text-gray-900 underline' : 'text-primary-800'
            }`}
          >
            {t('queue.countOne', { label: t(`states.${state}`), count: counts.get(state) ?? 0 })}
          </button>
        ))}
        {/* Spec §6.1: `3 com a triagem vencida`, in text and never a red strip — it is the count
            of the rows whose 72-hour promise (BR-B2B-010, item 4) is already broken. Clicking it
            filters, exactly like the counters beside it. */}
        {overdueCount > 0 && (
          <button
            type="button"
            onClick={() => setOnlyLate(true)}
            aria-pressed={onlyLate}
            className={`min-h-[24px] text-sm underline-offset-4 hover:underline ${
              onlyLate ? 'font-semibold text-gray-900 underline' : 'font-medium text-primary-800'
            }`}
          >
            {t('queue.overdueCount', { count: overdueCount })}
          </button>
        )}
      </nav>

      <div className="flex flex-col gap-6 lg:flex-row">
        <aside className="w-full shrink-0 space-y-4 lg:w-64">
          <div>
            <Label htmlFor="partnership-search">{t('queue.searchLabel')}</Label>
            <Input
              id="partnership-search"
              value={search}
              placeholder={t('queue.searchPlaceholder')}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="partnership-state">{t('queue.stateLabel')}</Label>
            <select
              id="partnership-state"
              value={stateFilter}
              onChange={(event) => setStateFilter(event.target.value as StateFilter)}
              className="mt-1 block w-full rounded-md border border-input bg-white px-3 py-2 text-sm text-gray-900"
            >
              <option value="in_progress">{t('queue.inProgress')}</option>
              <option value="all">{t('queue.allStates')}</option>
              {PIPELINE_STATES.map((state) => (
                <option key={state} value={state}>
                  {t(`states.${state}`)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="partnership-only-late"
              type="checkbox"
              checked={onlyLate}
              onChange={(event) => setOnlyLate(event.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            <Label htmlFor="partnership-only-late" className="mb-0">
              {t('queue.onlyLate')}
            </Label>
          </div>

          {filtering && (
            <Button variant="outline" className="w-full" onClick={clearFilters}>
              {t('queue.clearFilters')}
            </Button>
          )}
        </aside>

        <section className="min-w-0 flex-1">
          {failed ? (
            <div className="rounded-md border border-gray-200 p-6 text-center">
              <p className="font-medium text-gray-900">{t('queue.errorTitle')}</p>
              <Button variant="outline" className="mt-3" onClick={() => window.location.reload()}>
                {t('queue.retry')}
              </Button>
            </div>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-gray-300 text-left text-xs uppercase tracking-wide text-gray-700">
                  <th scope="col" className="px-2 py-2">{t('queue.columns.establishment')}</th>
                  <th scope="col" className="px-2 py-2">{t('queue.columns.city')}</th>
                  <th scope="col" className="px-2 py-2">{t('queue.columns.state')}</th>
                  <th scope="col" className="px-2 py-2">{t('queue.columns.missing')}</th>
                  <th scope="col" className="px-2 py-2">{t('queue.columns.idle')}</th>
                  <th scope="col" className="px-2 py-2">{t('queue.columns.triage')}</th>
                  <th scope="col" className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {loading &&
                  [0, 1, 2, 3, 4].map((row) => (
                    <tr key={`skeleton-${row}`} className="border-b border-gray-100">
                      <td className="px-2 py-3" colSpan={7}>
                        <span className="sr-only">{t('queue.loading')}</span>
                        <span
                          className="block h-4 w-full animate-pulse rounded bg-gray-100"
                          aria-hidden="true"
                        />
                      </td>
                    </tr>
                  ))}

                {!loading &&
                  filtered.map((row) => {
                    const status = triage.get(row.submissionId) ?? NOT_STARTED
                    const deadlineLine = triageDeadlineText(status)

                    return (
                    <tr key={row.submissionId} className="border-b border-gray-100 align-top">
                      <td className="px-2 py-3 text-gray-900">
                        {/* Truncates in the column and carries the whole name in the accessible
                            label; the detail never truncates. */}
                        <span className="block max-w-[22rem] truncate" title={row.tradeName ?? ''}>
                          {row.tradeName || t('queue.noTradeName')}
                        </span>
                        {row.duplicateCount > 0 && (
                          <span className="mt-1 inline-block rounded-full border border-secondary-700 px-1.5 py-0.5 text-xs text-secondary-700">
                            {t('queue.duplicateBadge', { count: row.duplicateCount })}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-3 text-gray-800">
                        {row.city ? `${row.city}${row.region ? `/${row.region}` : ''}` : '—'}
                      </td>
                      <td className="px-2 py-3 font-medium text-gray-900">
                        {t(`states.${row.state}`)}
                      </td>
                      <td className="px-2 py-3 text-gray-800">{whatIsMissing(row, t)}</td>
                      <td className="px-2 py-3 text-gray-800">
                        <span title={formatDate(row.since)}>{idleFor(row.since, t)}</span>
                        <span className="block text-xs text-gray-700">{formatDate(row.since)}</span>
                      </td>
                      {/* Two lines, exactly like `Parado há` next door: the relative counter the
                          operator acts on, and under it the instant that was promised to the
                          partner (DS-COPY-025, point 5). The instant is never left only in the
                          `title` — that attribute does not reach the keyboard. */}
                      <td className="px-2 py-3 text-gray-900">
                        <span title={t('triage.deadlineTitle')}>{triageText(status, t)}</span>
                        {deadlineLine && (
                          <span className="block text-xs text-gray-700">{deadlineLine}</span>
                        )}
                      </td>
                      <td className="px-2 py-3">
                        <Link
                          href={`/${locale}${row.href}`}
                          aria-label={t('queue.openNamed', {
                            name: row.tradeName || t('queue.noTradeName'),
                          })}
                          className="inline-flex min-h-[24px] items-center text-sm font-medium text-primary-800 underline underline-offset-4"
                        >
                          {t('queue.open')}
                        </Link>
                      </td>
                    </tr>
                    )
                  })}
              </tbody>
            </table>
          )}

          {!loading && !failed && filtered.length === 0 && (
            <div className="rounded-md border border-gray-200 p-6 text-center">
              {filtering ? (
                <>
                  <p className="font-medium text-gray-900">{t('queue.emptyFilteredTitle')}</p>
                  <Button variant="outline" className="mt-3" onClick={clearFilters}>
                    {t('queue.clearFilters')}
                  </Button>
                </>
              ) : (
                <>
                  <p className="font-medium text-gray-900">{t('queue.emptyTitle')}</p>
                  <p className="mx-auto mt-1 max-w-lg text-sm text-gray-800">
                    {t('queue.emptyBody')}
                  </p>
                </>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

/**
 * The `O que falta` column — the next step, or the pendency counts of the LEAST ADVANCED place
 * plus the proportion. Never the sum across places: summing hides which of the three is stuck
 * (DS-COMPONENTE-020, 2nd edge case).
 */
function whatIsMissing(
  row: PartnershipQueueRow,
  t: ReturnType<typeof useTranslations>
): string {
  // The act owed to somebody OUTSIDE the company wins the column (DS-COPY-020, points 2 and 5).
  // A refused place keeps its curation pendencies — no description, no audio — and printing
  // `2 pendências que bloqueiam` there would answer a question nobody is asking: the work of this
  // row is to tell the partner, and only after that does the place go back to being work.
  if (row.state === 'refusal_not_communicated') return t('nextSteps.refusal_not_communicated')

  const parts: string[] = []

  if (row.places.total > 1) {
    parts.push(
      t('queue.placesProgress', { published: row.places.published, total: row.places.total })
    )
  }
  if (row.places.blocking > 0) {
    parts.push(t('queue.missingBlocking', { count: row.places.blocking }))
  }
  if (row.places.silencing > 0) {
    parts.push(t('queue.missingSilencing', { count: row.places.silencing }))
  }

  if (parts.length > 0) return parts.join(t('queue.missingSeparator'))
  return t(`nextSteps.${row.state}`)
}

/** `Parado há`, counted on the calendar day by the one function that counts days here. */
function idleFor(since: string | null, t: ReturnType<typeof useTranslations>): string {
  if (!since) return t('queue.idleUnknown')
  const days = daysUntil(since)
  if (days === null) return t('queue.idleUnknown')
  return t('queue.idleDays', { count: Math.max(0, -days) })
}
