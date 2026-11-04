'use client'

import { Fragment, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

import { WidgetCard, SectionHeader } from '@/components/dashboard/WidgetCard'
import { DenseTableScroller, DIM, HEAD_SOLO, HEAD_SOLO_NUM, NUM, ROW_HEAD } from '@/components/ui/dense-table'
import { cn } from '@/lib/utils'

/**
 * The month by metric table of the Engagement report (#1094, spec-cms-relatorio-engajamento-2026-11
 * §3). Months are columns and metrics are rows, so "are we getting better?" reads along one row.
 *
 * Presentational: every cell arrives resolved by `lib/engagement/cells.ts` and translated by the
 * report, and this computes nothing. A loading cell is a pulse in the same box, so the card has
 * the same height before and after the data.
 */

export interface MonthGridCell {
  /** The printed value, or `UNKNOWN_VALUE`. */
  main: string
  /** `countShare`: the share printed after the count. */
  share: string | null
  /** `≥` in front: the window has not closed. */
  floor: boolean
  /** Why the cell is what it is; absent for a measured value. */
  title?: string
  loading: boolean
  /** The value recedes to `DIM` (every state without a number). */
  muted: boolean
}

export interface MonthGridRow {
  key: string
  label: string
  hint: string
  ga4: boolean
  cells: MonthGridCell[]
}

export interface MonthGridGroup {
  key: string
  label: string | null
  rows: MonthGridRow[]
}

export interface MonthGridProps {
  testId: string
  title: string
  icon?: LucideIcon
  right?: ReactNode
  /** Above the table: the failure bands of the card. */
  notice?: ReactNode
  months: { key: string; label: string; untilToday: string | null }[]
  groups: MonthGridGroup[]
  metricLabel: string
  ga4Badge: string
  ga4BadgeHint: string
}

export function Ga4Badge({ text, hint }: { text: string; hint: string }) {
  return (
    <span
      title={hint}
      className={cn('ml-1.5 inline-block align-middle rounded border border-gray-400 px-1.5 text-[10px] font-mono uppercase tracking-wider', DIM)}
    >
      {text}
    </span>
  )
}

export function MonthGrid({ testId, title, icon, right, notice, months, groups, metricLabel, ga4Badge, ga4BadgeHint }: MonthGridProps) {
  return (
    <div data-testid={testId}>
      <WidgetCard padded={false}>
        <SectionHeader as="h2" title={title} icon={icon} right={right} className="flex-wrap gap-2 px-4 pt-4" />
        {notice && <div className="space-y-2 px-4 pb-3">{notice}</div>}
        <DenseTableScroller label={title} startAtEnd maxHeightClassName="">
          <table className="w-max min-w-full table-fixed border-collapse">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                <th scope="col" className={cn(HEAD_SOLO, ROW_HEAD, 'z-20 w-32 md:w-60')}>
                  <span className="sr-only">{metricLabel}</span>
                </th>
                {months.map((m) => (
                  <th key={m.key} scope="col" className={cn(HEAD_SOLO_NUM, 'w-[88px] md:w-24 align-bottom')}>
                    <span className="block whitespace-nowrap">{m.label}</span>
                    {m.untilToday && <span className="block whitespace-nowrap normal-case tracking-normal font-normal">{m.untilToday}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.key} className="border-t border-gray-100 dark:border-gray-800">
                {g.label && (
                  <tr>
                    <th scope="rowgroup" className={cn(ROW_HEAD, 'pt-3 pb-1 text-[10px] font-bold uppercase tracking-widest', DIM)}>
                      {g.label}
                    </th>
                    <td colSpan={months.length} />
                  </tr>
                )}
                {g.rows.map((row) => (
                  <tr key={row.key} data-testid={`engagement-row-${row.key}`} className="border-t border-gray-100 dark:border-gray-800">
                    <th scope="row" title={row.hint} className={cn(ROW_HEAD, 'font-semibold text-gray-900 dark:text-white')}>
                      <span className="text-xs md:text-sm leading-snug">{row.label}</span>
                      {row.ga4 && <Ga4Badge text={ga4Badge} hint={ga4BadgeHint} />}
                    </th>
                    {row.cells.map((c, i) => (
                      <td key={months[i].key} className={NUM} title={c.title} data-state={c.loading ? 'loading' : undefined}>
                        {c.loading ? (
                          <span className="inline-block h-5 w-10 py-0.5 align-top bg-clip-content animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
                        ) : (
                          <Fragment>
                            {c.floor && <span className={DIM}>≥ </span>}
                            <span className={c.muted ? DIM : undefined}>{c.main}</span>
                            {c.share && <span className={cn('text-[11px] leading-none', DIM)}> · {c.share}</span>}
                          </Fragment>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </DenseTableScroller>
      </WidgetCard>
    </div>
  )
}

export default MonthGrid
