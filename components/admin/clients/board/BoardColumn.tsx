'use client'

/**
 * One column of the board — a heading, a count, and the cards under it.
 *
 * A TERMINAL COLUMN IS NOT A DEPOSIT. `Publicado` and `Encerrados` are outcomes, not work: left
 * open they grow without bound, and a board whose two widest columns are things nobody has to
 * do again stops being read. They come collapsed, carrying their count; opened, they show the
 * most recent `TERMINAL_WINDOW` and hand the rest to the table, which is the surface built for
 * looking things up.
 *
 * THE COUNT IS A FLOOR WHEN THE LIST WAS TRUNCATED. `loadClientDirectory` caps at 1000 rows
 * ordered newest first, so what falls off the end are the OLDEST — exactly what fills these two
 * columns. Printing `142` for a set that was cut is the class of defect that made `{n} com a
 * triagem vencida` open an empty table: a number that reads as a fact and is a lower bound.
 */

import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { isTerminalColumn, type BoardColumnId, type BoardColumnView } from '@/lib/clients/board-transitions'

interface BoardColumnProps {
  column: BoardColumnView
  /** Whether the whole set was cut by the server's caps — the count becomes `≥ n`. */
  truncated: boolean
  filtering: boolean
  onToggle: (column: BoardColumnId) => void
  /** Where `Ver todos` goes: the table, filtered to this column's states. */
  seeAllHref: (state: string) => string
  children: React.ReactNode
  /** Handed in by the drag layer; absent while the board is a plain list of columns. */
  dropRef?: (node: HTMLElement | null) => void
  dropActive?: boolean
}

export function BoardColumn({
  column,
  truncated,
  filtering,
  onToggle,
  seeAllHref,
  children,
  dropRef,
  dropActive,
}: BoardColumnProps) {
  const t = useTranslations('Clients.board')
  const terminal = isTerminalColumn(column.id)
  const headingId = `board-column-${column.id}`
  const count = truncated ? t('countTruncated', { count: column.total }) : String(column.total)

  return (
    <section
      aria-labelledby={headingId}
      ref={dropRef}
      className={`flex w-72 flex-shrink-0 flex-col rounded-3xl border bg-gray-50/60 p-3 dark:bg-gray-900/40 ${
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

      {terminal && (
        <button
          type="button"
          onClick={() => onToggle(column.id)}
          aria-expanded={!column.collapsed}
          aria-controls={`${headingId}-body`}
          className="mb-2 flex min-h-[24px] items-center gap-1 rounded-lg px-1 text-xs font-medium text-primary-800 underline-offset-4 hover:underline dark:text-tuggi-blue"
        >
          {column.collapsed ? (
            <ChevronRight className="h-3 w-3" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-3 w-3" aria-hidden="true" />
          )}
          {column.collapsed ? t('expand') : t('collapse')}
        </button>
      )}

      <div id={`${headingId}-body`} className="flex flex-col gap-2">
        {children}

        {column.total === 0 && (
          <p className="px-1 py-4 text-xs text-gray-500 dark:text-gray-400">
            {filtering ? t('emptyFiltered') : t('empty')}
          </p>
        )}

        {/* What the window left out goes to the table, and the two doors of `Encerrados` are two
            links: `discarded` and `refused_at_triage` are different outcomes, and merging them
            into one filter value would need a vocabulary `parseFilters` does not have. */}
        {column.overflow > 0 && !column.collapsed && (
          <p className="px-1 pt-1 text-[11px] text-gray-500 dark:text-gray-400">
            {t('overflow', { count: column.overflow })}
          </p>
        )}

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
  'min-h-[24px] text-[11px] font-medium text-primary-800 underline underline-offset-4 dark:text-tuggi-blue'
