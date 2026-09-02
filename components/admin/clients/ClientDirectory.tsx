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

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DirectoryFilterRail,
  DirectoryFilterSheet,
} from '@/components/admin/clients/DirectoryFilterRail'
import { formatDate } from '@/components/admin/partner-proposals/format'
import { idleFor, placeLine, planLine, rowKey, whatIsMissing } from '@/components/admin/clients/board/row-text'
import { derivePartnerPlan, paymentStance } from '@/lib/clients/partner-plan'
import { PaymentStanceBadge } from '@/components/admin/clients/shared/PaymentStanceBadge'
import { deriveTriageStatus, type TriageStatus } from '@/lib/partnerships/triage'
import { triageDeadlineText, triageText } from '@/components/admin/partnerships/triage-text'
import {
  EMPTY_FILTERS,
  applyFilters,
  buildDirectoryView,
  pageWindow,
  inProgressCount,
  overdueCount,
  type DirectoryFilters,
} from '@/lib/clients/directory-filter'
import type { ClientDirectoryRow } from '@/lib/services/partnership-service'

/** What a row with no clock reads as — one constant, so the count and the cell agree. */
const NOT_STARTED: TriageStatus = { kind: 'not_started' }

/**
 * How many rows a page holds.
 *
 * TWENTY-FIVE because this table is read by scanning a column top to bottom, and a page that
 * does not fit a monitor turns paging into scrolling-plus-paging — two navigations for one list.
 * It is also small enough that the eight `<td>`s per row do not make the first paint the slow
 * part of switching a facet.
 */
const PAGE_SIZE = 25

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
  // `planLine` was written for the card and reads `Clients.board.plan.*`. The table borrows the
  // translator rather than a second copy of the sentences: `R$ 149,00 por mês` must not be
  // phrased one way on a card and another in a row about the same partner.
  const b = useTranslations('Clients.board')

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

  /**
   * ── THE PAGE, AND WHY IT IS CLIENT-SIDE ────────────────────────────────────────────────────
   *
   * `/api/admin/clients/directory` returns the WHOLE set — it has to, because the facet counts
   * in the rail are computed over the same rows the table renders, and a server that paginated
   * would leave the rail counting a page instead of the list. So the browser already holds every
   * row, and asking the database for a page would be a round trip that fetches nothing new.
   *
   * IT IS DERIVED FROM THE FILTERS, NOT RESET BY AN EFFECT. Narrowing to four rows while sitting
   * on page 3 shows an empty table that reads as a broken screen, so the page has to return to 1
   * — and doing that in a `useEffect` means one render of the wrong page first, plus the
   * cascading-render the linter (correctly) warns about. Instead the page number REMEMBERS which
   * filters it belongs to: the moment they change, it is no longer this page's number and 1 is
   * what renders. The key is `applyFilters`, which is already the canonical serialisation of a
   * filter set — the one the URL uses — so nothing here can disagree with the address bar.
   */
  const filterKey = useMemo(
    () => applyFilters(new URLSearchParams(), filters).toString(),
    [filters]
  )
  const [anchored, setAnchored] = useState({ key: filterKey, page: 1 })
  const pageCount = Math.max(1, Math.ceil(view.rows.length / PAGE_SIZE))
  // Clamped as well as anchored: `Ver mais` is not the only way to leave a page behind — an act
  // on the last row of the last page removes it from the set while the page number stays.
  const page = Math.min(anchored.key === filterKey ? anchored.page : 1, pageCount)
  const goTo = (next: number) => setAnchored({ key: filterKey, page: next })

  const pageRows = useMemo(
    () => view.rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [view.rows, page]
  )

  return (
    <div className="cms-width flex min-h-screen flex-col bg-gray-50 p-4 dark:bg-gray-950 lg:p-8">
      <div className="flex flex-1 flex-col gap-6 pt-2 lg:flex-row lg:gap-8 lg:pt-6">
        <DirectoryFilterRail
          view={view}
          filters={filters}
          onFiltersChange={onFiltersChange}
          working={working}
        />

        {/* ── The list ──────────────────────────────────────────────────────────────────── */}
        {/* `w-full` under `lg`: `18% + 82% + gap-8 + p-6` is wider than a phone, and the
            remainder was the board and the table hanging off the right edge of the screen. */}
        <div className="w-full min-w-0 lg:w-[82%]">
          <div className="sticky top-0 z-30 mb-4 rounded-3xl border border-gray-200 bg-white/80 shadow-2xl shadow-black/5 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-900/80 lg:mb-8">
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 lg:gap-4 lg:p-4">
              <div className="flex flex-wrap items-center gap-3 lg:gap-8 lg:pl-2">
                <div>
                  <h1 className="text-lg font-semibold tracking-tight text-gray-900 dark:text-white lg:text-xl">
                    {t('title')}
                  </h1>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{t('subtitle')}</p>
                </div>

                <div className="hidden h-8 w-px bg-gray-200 dark:bg-gray-800 lg:block" aria-hidden="true" />

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

              <div className="flex flex-wrap items-center gap-2 lg:gap-3">
                <DirectoryFilterSheet
                  view={view}
                  filters={filters}
                  onFiltersChange={onFiltersChange}
                  working={working}
                />
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

          {!loading && !failed && view.rows.length > 0 && (
            <Pager
              page={page}
              pageCount={pageCount}
              total={view.rows.length}
              onGo={goTo}
              t={t}
              className="mb-3"
            />
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
                      <th scope="col" className="px-4 py-3">{t('columns.state')}</th>
                      {/* WHO PAYS, in the column that replaced `Tipo`. The type of establishment
                          is a facet of the rail and says almost nothing row by row; the money is
                          what this table was reopened to answer. */}
                      <th scope="col" className="px-4 py-3">{t('columns.plan')}</th>
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
                      pageRows.map((row) => {
                        const status = triage.get(rowKey(row)) ?? NOT_STARTED
                        const deadline = triageDeadlineText(status)
                        const name = row.name || t('noName')
                        const plan = derivePartnerPlan(row)

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
                            <td className="px-4 py-4 font-medium text-gray-900 dark:text-white">
                              {p(`states.${row.state}`)}
                            </td>
                            {/*
                              THE BADGE AND THE VALUE, in that order, and both of them.
                              
                              The badge is the summary somebody scanning the column sees without
                              reading; the line under it is the record — `R$ 149,00 por mês`,
                              `Cortesia`, `Plano: ninguém declarou`. The badge alone would flatten
                              a pendency into an answer, which is the one thing the two-colour
                              reading is not allowed to do (DS-A11Y-003, and BR-B2B-017 item 6,
                              which refuses to publish an undeclared registration).

                              SINCE 2026-08-26 THE BADGE IS A SYMBOL and carries no word, so this
                              line stopped being a complement and became the only text in the
                              cell. Removing it would leave the column answering `paga?` with a
                              drawing and nothing else — and `ninguém declarou` is precisely the
                              state a drawing cannot say.
                            */}
                            <td className="px-4 py-4">
                              <PaymentStanceBadge stance={paymentStance(plan.kind)} />
                              <span className="mt-1 block text-xs text-gray-800 dark:text-gray-300">
                                {planLine(row, b)}
                              </span>
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

          {/* TWICE, ABOVE AND BELOW, and it is not decoration. Twenty-five rows is more than a
              laptop shows at once, so an operator who reached the bottom would have to scroll
              back past the whole page to reach the next one. */}
          {!loading && !failed && view.rows.length > 0 && (
            <Pager
              page={page}
              pageCount={pageCount}
              total={view.rows.length}
              onGo={goTo}
              t={t}
              className="mt-3"
            />
          )}
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

/**
 * The pager — the range in words, and the numbers that move it.
 *
 * NO ROUND TRIP HAPPENS HERE. `/api/admin/clients/directory` already returned every row, because
 * the facet counts in the rail have to be computed over the same set the table renders; a
 * server-side page would leave the rail counting a page. So this control slices an array the
 * browser already holds, and paging is instant by construction rather than by caching.
 *
 * THE RANGE IS TEXT AND COMES FIRST, because it is the answer to the question the numbers only
 * imply: `Mostrando 26–36 de 36` says both where you are and how much there is, and it is the
 * part that survives being read by somebody who cannot see which button is pressed.
 *
 * `aria-current="page"` AND NOT COLOUR ALONE on the active number (DS-A11Y-003), and the
 * disabled ends are `disabled` rather than hidden — a control that appears and disappears under
 * the thumb is worse than one that greys out where it always was.
 */
function Pager({
  page,
  pageCount,
  total,
  onGo,
  t,
  className,
}: {
  page: number
  pageCount: number
  total: number
  onGo: (page: number) => void
  t: ReturnType<typeof useTranslations<'Clients.directory'>>
  className?: string
}) {
  const from = (page - 1) * PAGE_SIZE + 1
  const to = Math.min(page * PAGE_SIZE, total)

  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 px-1 ${className ?? ''}`}>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {t('showingRange', { from, to, total })}
      </p>

      {/* One page is not a pager. Printing `‹ 1 ›` over a list that fits would be a control
          whose every button is dead. */}
      {pageCount > 1 && (
        <nav aria-label={t('paginationLabel')} className="flex items-center gap-1">
          <PageStep
            label={t('previousPage')}
            disabled={page <= 1}
            onClick={() => onGo(page - 1)}
            chevron={<ChevronLeft className="h-4 w-4" aria-hidden="true" />}
          />

          {pageWindow(page, pageCount).map((value, index) =>
            value === null ? (
              <span
                key={`gap-${index}`}
                aria-hidden="true"
                className="px-1 text-xs text-gray-400 dark:text-gray-500"
              >
                …
              </span>
            ) : (
              <button
                key={value}
                type="button"
                onClick={() => onGo(value)}
                aria-current={value === page ? 'page' : undefined}
                aria-label={t('goToPage', { page: value })}
                className={`min-h-[44px] min-w-[44px] rounded-xl px-2 text-sm transition-colors lg:min-h-[32px] lg:min-w-[32px] ${
                  value === page
                    ? 'bg-primary-800/10 font-semibold text-gray-900 dark:bg-tuggi-blue/10 dark:text-white'
                    : 'text-primary-800 hover:bg-gray-100 dark:text-tuggi-blue dark:hover:bg-gray-800'
                }`}
              >
                {value}
              </button>
            )
          )}

          <PageStep
            label={t('nextPage')}
            disabled={page >= pageCount}
            onClick={() => onGo(page + 1)}
            chevron={<ChevronRight className="h-4 w-4" aria-hidden="true" />}
          />
        </nav>
      )}
    </div>
  )
}

/** One end of the pager. The chevron is decorative; `aria-label` carries the whole meaning. */
function PageStep({
  label,
  disabled,
  onClick,
  chevron,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  chevron: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-primary-800 transition-colors hover:bg-gray-100 disabled:opacity-40 dark:text-tuggi-blue dark:hover:bg-gray-800 lg:min-h-[32px] lg:min-w-[32px]"
    >
      {chevron}
    </button>
  )
}
