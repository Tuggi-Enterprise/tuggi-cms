'use client'

/**
 * One column of the board — a heading, a count, and the cards under it.
 *
 * A TERMINAL COLUMN IS NOT A DEPOSIT, AND IT IS NOT A CLOSED DRAWER EITHER. `Publicado` and
 * `Encerrados` are outcomes, not work: left open they grow without bound, and a board whose two
 * widest columns are things nobody has to do again stops being read. They used to come
 * COLLAPSED, which solved that by making the last month of delivered work invisible — an
 * operator who had just published a place could not find it on the board at all.
 *
 * They now come OPEN, windowed to `TERMINAL_PAGE`, with `Ver mais` growing the column in place.
 * The rest of the archive still has a link out to the table, because scrolling two hundred
 * outcomes five at a time is not looking something up.
 *
 * THE COUNT IS A FLOOR WHEN THE LIST WAS TRUNCATED. `loadClientDirectory` caps at 1000 rows
 * ordered newest first, so what falls off the end are the OLDEST — exactly what fills these two
 * columns. Printing `142` for a set that was cut is the class of defect that made `{n} com a
 * triagem vencida` open an empty table: a number that reads as a fact and is a lower bound.
 */

import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import {
  TERMINAL_PAGE,
  isTerminalColumn,
  type BoardColumnId,
  type BoardColumnView,
} from '@/lib/clients/board-transitions'

interface BoardColumnProps {
  column: BoardColumnView
  /** Whether the whole set was cut by the server's caps — the count becomes `≥ n`. */
  truncated: boolean
  filtering: boolean
  /** Grows this column's window by one page. Only terminal columns ever window. */
  onRevealMore: (column: BoardColumnId) => void
  /** Where `Ver todos` goes: the table, filtered to this column's states. */
  seeAllHref: (state: string) => string
  children: React.ReactNode
  /** Handed in by the drag layer; absent while the board is a plain list of columns. */
  dropRef?: (node: HTMLElement | null) => void
  dropActive?: boolean
  /**
   * WHETHER THIS COLUMN IS ONE OF MANY SIDE BY SIDE, or the only one on screen.
   *
   * `stacked` is what a phone renders: the column picker above has already chosen WHICH column,
   * so this one takes the full width instead of holding a 288px lane in a horizontal scroller.
   * A `w-72` lane inside a 390px viewport is the shape that made the board unusable on a phone —
   * the cards clip, and the horizontal scroll competes with the vertical one for the same finger.
   */
  stacked?: boolean
}

export function BoardColumn({
  column,
  truncated,
  filtering,
  onRevealMore,
  seeAllHref,
  children,
  dropRef,
  dropActive,
  stacked,
}: BoardColumnProps) {
  const t = useTranslations('Clients.board')
  const terminal = isTerminalColumn(column.id)
  const headingId = `board-column-${column.id}`
  const count = truncated ? t('countTruncated', { count: column.total }) : String(column.total)

  return (
    <section
      aria-labelledby={headingId}
      ref={dropRef}
      className={`flex flex-col rounded-3xl border bg-gray-50/60 p-3 dark:bg-gray-900/40 ${
        stacked ? 'w-full' : 'w-72 flex-shrink-0'
      } ${
        dropActive
          ? 'border-primary-800 dark:border-tuggi-blue'
          : 'border-gray-200 dark:border-gray-800'
      }`}
    >
      <header className="mb-3 px-1">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id={headingId} className="text-sm font-semibold tracking-tight text-gray-900 dark:text-white">
            {t(`columns.${column.id}`)}
          </h2>
          <span className="shrink-0 text-xs font-medium text-gray-500 dark:text-gray-400">{count}</span>
        </div>
        <p className="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">
          {t(`columnHints.${column.id}`)}
        </p>
      </header>

      {/* HOW MUCH OF THE COLUMN IS ON SCREEN, and it only appears where a window exists. A
          working column shows everything it has, and printing `5 de 5` over it would be a
          fraction that never moves. */}
      {terminal && column.overflow > 0 && (
        <p className="mb-2 px-1 text-[11px] text-gray-500 dark:text-gray-400">
          {t('windowCount', { shown: column.rows.length, total: column.total })}
        </p>
      )}

      <div id={`${headingId}-body`} className="flex flex-col gap-2">
        {children}

        {column.total === 0 && (
          <p className="px-1 py-4 text-xs text-gray-500 dark:text-gray-400">
            {filtering ? t('emptyFiltered') : t('empty')}
          </p>
        )}

        {/*
          `Ver mais` GROWS THIS COLUMN, and it is a button rather than the link it replaced.
          The old control sent the operator to the table for the eleventh row of `Publicado`,
          which is a different screen, a different layout and a lost scroll position for one more
          card. The label carries the NUMBER it will add, so it is not a promise of an unknown
          amount — and it adds `TERMINAL_PAGE` or whatever is left, whichever is smaller.
        */}
        {column.overflow > 0 && (
          <button
            type="button"
            onClick={() => onRevealMore(column.id)}
            aria-controls={`${headingId}-body`}
            className="mt-1 flex min-h-[44px] w-full items-center justify-center gap-1 rounded-xl border border-gray-200 px-2 text-xs font-medium text-primary-800 transition-colors hover:bg-primary-800/5 dark:border-gray-700 dark:text-tuggi-blue lg:min-h-[32px]"
          >
            <ChevronDown className="h-3 w-3" aria-hidden="true" />
            {t('revealMore', { count: Math.min(TERMINAL_PAGE, column.overflow) })}
          </button>
        )}

        {/* The whole archive still has a door out, and the two doors of `Encerrados` are two
            links: `discarded` and `refused_at_triage` are different outcomes, and merging them
            into one filter value would need a vocabulary `parseFilters` does not have. */}
        {terminal && column.total > 0 && (
          <div className="flex flex-col gap-1 px-1 pt-1">
            {column.id === 'closed' ? (
              <>
                <Link href={seeAllHref('discarded')} className={SEE_ALL}>
                  {t('seeAllDiscarded', { count: column.total })}
                </Link>
                <Link href={seeAllHref('refused_at_triage')} className={SEE_ALL}>
                  {t('seeAllRefused', { count: column.total })}
                </Link>
              </>
            ) : (
              <Link href={seeAllHref('published')} className={SEE_ALL}>
                {t('seeAll', { count: column.total })}
              </Link>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

const SEE_ALL =
  'inline-flex min-h-[44px] items-center text-[11px] font-medium text-primary-800 underline underline-offset-4 dark:text-tuggi-blue lg:min-h-[24px]'
