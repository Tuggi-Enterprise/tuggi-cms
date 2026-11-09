'use client'

import { DenseTableScroller, DIM } from '@/components/ui/dense-table'
import { cn } from '@/lib/utils'

/** Plot height of the month columns, px (spec §B5). */
export const COLUMN_PLOT_PX = 160
/** An inner label prints only on a segment this tall or taller, px (spec §B7). */
export const INNER_LABEL_MIN_PX = 18

/**
 * Stacked columns, one per month (#1099, spec §B5 and §B7): the modes card counts people on one
 * `stripTop` ruler, the frequency card splits each month into 100 %. Months are columns, as in every
 * grid of the page, so the page keeps one time axis.
 *
 * Presentational: heights arrive as fractions of the plot from `lib/engagement/summary.ts`, labels
 * translated. A `null` segment draws nothing and enters no total; its `title` says why. The 2 px gap
 * and the legend are the second channel next to colour (DS-A11Y-007). An inner label prints only
 * when the segment is `INNER_LABEL_MIN_PX` tall, never clipped. Each column is `relative`, so its
 * sr-only line stays inside the scroller: with more columns than the width holds (twelve months at
 * 390 px, #1157) an unanchored one widened the whole page.
 */

export interface StackedSegment {
  key: string
  /** Fraction of the plot height, 0 to 1. */
  fraction: number
  title: string
  /** A hex fill, or tailwind classes for the fill and its ink. */
  color?: string
  className?: string
  inner?: string
}

export interface StackedColumn {
  key: string
  label: string
  untilToday: string | null
  /** Bottom to top. */
  segments: StackedSegment[]
  /** The column has no base: prints this in place of the bar, with its reason. */
  empty?: { text: string; title?: string } | null
  srText: string
}

export interface StackedMonthColumnsProps {
  /** `count`: one ruler for every month; `share`: each column is 100 %, its gaps taken out of the plot. */
  mode?: 'count' | 'share'
  label: string
  testId: string
  columns: StackedColumn[]
  axisTop: string
  legend: { key: string; label: string; color?: string; className?: string }[]
  loading?: boolean
}

/** The surface gap between segments, px (`gap-[2px]`). */
const GAP_PX = 2

export function StackedMonthColumns({ mode = 'count', label, testId, columns, axisTop, legend, loading }: StackedMonthColumnsProps) {
  return (
    <div data-testid={testId}>
      <DenseTableScroller label={label} startAtEnd maxHeightClassName="">
        <div className="flex w-max min-w-full items-end">
          <div
            aria-hidden="true"
            className={cn('sticky left-0 z-10 flex w-8 shrink-0 flex-col justify-between self-start bg-white pr-1 text-right text-[10px] font-bold dark:bg-gray-900', DIM)}
            style={{ height: COLUMN_PLOT_PX }}
          >
            <span className="leading-none">{axisTop}</span>
            <span className="leading-none">0</span>
          </div>
          <ul role="list" className="flex items-start">
            {columns.map((c) => (
              <li key={c.key} className="relative flex w-[88px] shrink-0 flex-col items-center md:w-24" data-testid={`${testId}-col-${c.key}`}>
                <span className="sr-only">{c.srText}</span>
                <div aria-hidden="true" className="flex w-10 flex-col-reverse gap-[2px]" style={{ height: COLUMN_PLOT_PX }}>
                  {loading ? (
                    <div className="h-full w-full animate-pulse rounded-sm bg-gray-100 dark:bg-gray-800" />
                  ) : c.empty ? (
                    <span className={cn('m-auto text-sm', DIM)} title={c.empty.title} data-testid={`${testId}-empty`}>
                      {c.empty.text}
                    </span>
                  ) : (
                    c.segments
                      .filter((s) => s.fraction > 0)
                      .map((s, _i, shown) => {
                        // A share column fills the plot exactly: its gaps come out of the 160 px, not on top of them.
                        const plot = mode === 'share' ? COLUMN_PLOT_PX - GAP_PX * (shown.length - 1) : COLUMN_PLOT_PX
                        const px = s.fraction * plot
                        return (
                          <div
                            key={s.key}
                            data-testid={`${testId}-seg-${s.key}`}
                            title={s.title}
                            className={cn('flex shrink-0 items-center justify-center rounded-sm text-[10px] font-bold tabular-nums', s.className)}
                            style={{ height: px, backgroundColor: s.color }}
                          >
                            {s.inner && px >= INNER_LABEL_MIN_PX ? s.inner : null}
                          </div>
                        )
                      })
                  )}
                </div>
                <span aria-hidden="true" className={cn('mt-1 whitespace-nowrap text-[10px] font-bold uppercase', DIM)}>
                  {c.label}
                </span>
                <span aria-hidden="true" className={cn('h-4 whitespace-nowrap text-[10px]', DIM)}>
                  {c.untilToday}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </DenseTableScroller>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-700 dark:text-gray-300" data-testid={`${testId}-legend`}>
        {legend.map((l) => (
          <li key={l.key} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={cn('h-2.5 w-2.5 rounded-full', l.className)} style={{ backgroundColor: l.color }} />
            {l.label}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default StackedMonthColumns
