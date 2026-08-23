'use client'

/**
 * THE BOARD — the same list as the table, in the shape of the work.
 *
 * TWO VIEWS OVER ONE READ, and the split is by what somebody is there to do. The table is for
 * looking things up: every partnership, nine columns, seven filters, sortable by idleness. The
 * board is for getting through the queue: where is each one stuck, and what is the next act.
 * They share `useClientDirectory`, `buildDirectoryView` and the facet rail, so a filter narrows
 * both the same way and a count in the rail opens the same rows in either.
 *
 * THE COLUMN IS DERIVED, NEVER STORED — see `lib/clients/board-transitions`. Dragging fires an
 * ACT, and the card lands in the next column because the fact changed and the list was read
 * again. There is no optimistic move: moving the card before the write comes back and snapping
 * it back on failure teaches the operator to distrust the board, and the board's whole claim is
 * that it cannot be out of step with the database.
 *
 * THE ALERT BAND IS ABOVE THE COLUMNS and is not one of them. DS-COPY-020, point 5: a refusal
 * decided and not communicated is owed to somebody outside the company, and it outranks
 * everything the pipeline knows about itself, `Publicado` included.
 */

import { useCallback, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { Button } from '@/components/ui/button'
import { DirectoryFilterRail } from '@/components/admin/clients/DirectoryFilterRail'
import { BoardCard, deriveTriageOf } from '@/components/admin/clients/board/BoardCard'
import { BoardColumn } from '@/components/admin/clients/board/BoardColumn'
import {
  buildBoardView,
  columnOf,
  planTransition,
  type BoardAct,
  type BoardColumnId,
  type TransitionPlan,
} from '@/lib/clients/board-transitions'
import {
  EMPTY_FILTERS,
  applyFilters,
  inProgressCount,
  overdueCount,
  type DirectoryFilters,
} from '@/lib/clients/directory-filter'
import { rowKey } from '@/components/admin/clients/board/row-text'
import type { ClientDirectoryRow } from '@/lib/services/partnership-service'
import type { TriageStatus } from '@/lib/partnerships/triage'

const NOT_STARTED: TriageStatus = { kind: 'not_started' }

interface ClientBoardProps {
  locale: string
  filters: DirectoryFilters
  onFiltersChange: (next: DirectoryFilters) => void
  onCreateNew?: () => void
  rows: ClientDirectoryRow[]
  truncated: boolean
  loading: boolean
  failed: boolean
  /** What a card's act does. The board decides WHICH act; the host performs it. */
  onAct: (row: ClientDirectoryRow, act: BoardAct) => void
  viewSwitch?: React.ReactNode
}

export function ClientBoard({
  locale,
  filters,
  onFiltersChange,
  onCreateNew,
  rows,
  truncated,
  loading,
  failed,
  onAct,
  viewSwitch,
}: ClientBoardProps) {
  const t = useTranslations('Clients.board')
  const c = useTranslations('Clients.directory')
  const p = useTranslations('Partnerships')

  const [expanded, setExpanded] = useState<BoardColumnId[]>([])

  const board = useMemo(
    () => buildBoardView(rows, filters, { expanded }),
    [rows, filters, expanded]
  )
  const late = useMemo(() => overdueCount(rows), [rows])
  const working = useMemo(() => inProgressCount(rows), [rows])
  const triage = useMemo(() => deriveTriageOf(rows), [rows])

  const toggleColumn = useCallback((column: BoardColumnId) => {
    setExpanded((current) =>
      current.indexOf(column) >= 0
        ? current.filter((candidate) => candidate !== column)
        : current.concat(column)
    )
  }, [])

  /**
   * WHAT A DROP DOES, and it is `planTransition` and nothing else.
   *
   * The rule of every edge lives in the pure module, which is where it is proven; this decides
   * only what to SAY when the plan is not an act. No optimistic move: the card stays where it
   * is until the list is read again, because the column is derived from the database and the
   * board's whole claim is that it cannot be out of step with it.
   */
  const [dragging, setDragging] = useState<ClientDirectoryRow | null>(null)
  const [refusal, setRefusal] = useState<{ key: string; message: string } | null>(null)

  const sensors = useSensors(
    // A few pixels of travel before a drag starts, so clicking `Abrir` on a card is a click.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  )

  const explain = useCallback(
    (plan: TransitionPlan, row: ClientDirectoryRow, to: BoardColumnId): string => {
      if (plan.kind === 'backwards') return t('backwards')
      if (plan.kind === 'not_adjacent') return t('notAdjacent', { column: t(`columns.${plan.nextColumn}`) })
      if (plan.kind === 'blocked') {
        return t(`blocked.${plan.reason}`, { count: row.places.blocking })
      }
      return t('dropInvalid', { column: t(`columns.${to}`) })
    },
    [t]
  )

  const onDragStart = useCallback(
    (event: DragStartEvent) => {
      const key = String(event.active.id)
      setRefusal(null)
      setDragging(rows.find((row) => rowKey(row) === key) ?? null)
    },
    [rows]
  )

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const row = dragging
      setDragging(null)
      if (!row || !event.over) return

      const to = String(event.over.id) as BoardColumnId
      const from = columnOf(row.state)
      if (!from) return

      const plan = planTransition(row, from, to)
      if (plan.kind === 'act') {
        onAct(row, plan.act)
        return
      }
      if (plan.kind === 'noop') return
      setRefusal({ key: rowKey(row), message: explain(plan, row, to) })
    },
    [dragging, explain, onAct]
  )

  /**
   * `Ver todos` goes to the TABLE, filtered to that state — the board hands the archive to the
   * surface built for looking things up rather than growing a column nobody scrolls. It drops
   * `view`, which is what switches to the table (the board is the default).
   */
  const seeAllHref = useCallback(
    (state: string) => {
      const params = applyFilters(new URLSearchParams(), {
        ...filters,
        state: state as DirectoryFilters['state'],
      })
      params.set('view', 'table')
      return `/${locale}/admin/clients?${params.toString()}`
    },
    [filters, locale]
  )

  if (failed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6 dark:bg-gray-950">
        <div className="text-center">
          <p className="font-medium text-gray-900 dark:text-white">{c('errorTitle')}</p>
          <Button variant="outline" className="mt-3" onClick={() => window.location.reload()}>
            {c('retry')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 p-6 dark:bg-gray-950 lg:p-8">
      <div className="flex flex-1 gap-8 pt-6">
        <DirectoryFilterRail
          view={board.directory}
          filters={filters}
          onFiltersChange={onFiltersChange}
          working={working}
        />

        <div className="w-[82%] min-w-0">
          <div className="sticky top-0 z-30 mb-6 rounded-3xl border border-gray-200 bg-white/80 shadow-2xl shadow-black/5 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-900/80">
            <div className="flex flex-wrap items-center justify-between gap-4 p-4">
              <div className="flex flex-wrap items-center gap-8 pl-2">
                <div>
                  <h1 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-white">
                    {c('title')}
                  </h1>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{t('dragHint')}</p>
                </div>

                <div className="h-8 w-px bg-gray-200 dark:bg-gray-800" aria-hidden="true" />

                <span className="text-sm text-gray-900 dark:text-gray-200">
                  {c('results', { count: board.directory.rows.length, total: rows.length })}
                </span>

                {/* Counted over the WHOLE set and never over the filtered one: it is the count
                    the operator clicks to REACH those rows (BR-B2B-010, item 4). */}
                {late > 0 && (
                  <button
                    type="button"
                    onClick={() => onFiltersChange({ ...filters, onlyLate: !filters.onlyLate })}
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
                    {c('newClient')}
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
              {c('truncated')}
            </p>
          )}

          {/* ── The band that outranks the board ─────────────────────────────────────────── */}
          {board.alert.length > 0 && (
            <section
              aria-labelledby="board-alert"
              className="mb-6 rounded-3xl border border-secondary-700 bg-white p-4 dark:bg-gray-900"
            >
              <h2 id="board-alert" className="text-sm font-semibold text-gray-900 dark:text-white">
                {t('alertTitle')}
              </h2>
              <p className="mt-1 text-xs text-gray-800 dark:text-gray-300">{t('alertBody')}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {board.alert.map((row) => (
                  <div key={rowKey(row)} className="w-72">
                    <BoardCard
                      row={row}
                      column="curation"
                      locale={locale}
                      triage={triage.get(rowKey(row)) ?? NOT_STARTED}
                      onAct={onAct}
                    />
                  </div>
                ))}
              </div>
            </section>
          )}

          {loading ? (
            <p role="status" className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
              {c('loading')}
            </p>
          ) : (
            <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
              {/* The board scrolls sideways inside its own container; the page never does. */}
              <div className="flex gap-3 overflow-x-auto pb-4">
                {board.columns.map((column) => (
                  <DroppableColumn
                    key={column.id}
                    column={column}
                    truncated={truncated}
                    filtering={board.directory.filtering}
                    onToggle={toggleColumn}
                    seeAllHref={seeAllHref}
                  >
                    {column.rows.map((row) => (
                      <DraggableCard
                        key={rowKey(row)}
                        row={row}
                        column={column.id}
                        locale={locale}
                        triage={triage.get(rowKey(row)) ?? NOT_STARTED}
                        onAct={onAct}
                        refusal={refusal?.key === rowKey(row) ? refusal.message : null}
                      />
                    ))}
                  </DroppableColumn>
                ))}
              </div>

              {/* What follows the pointer. A copy, so the card in the column keeps its place —
                  the original only dims, because nothing has moved yet. */}
              <DragOverlay>
                {dragging && (
                  <div className="w-72 rotate-1">
                    <BoardCard
                      row={dragging}
                      column={columnOf(dragging.state) ?? 'client'}
                      locale={locale}
                      triage={triage.get(rowKey(dragging)) ?? NOT_STARTED}
                      onAct={onAct}
                    />
                  </div>
                )}
              </DragOverlay>
            </DndContext>
          )}

          {!loading && board.directory.rows.length === 0 && (
            <div className="p-8 text-center">
              <p className="font-medium text-gray-900 dark:text-white">
                {board.directory.filtering ? c('emptyFilteredTitle') : c('emptyTitle')}
              </p>
              {board.directory.filtering && (
                <Button variant="outline" className="mt-3" onClick={() => onFiltersChange(EMPTY_FILTERS)}>
                  {c('clear')}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * The drag layer, kept OUT of `BoardCard` and `BoardColumn` on purpose.
 *
 * Those two render without `@dnd-kit` at all — which is what lets `tests/ct` mount the board
 * without a pointer, and what would let the library be swapped without touching a line of the
 * card's markup or its accessible names. The gesture is an affordance layered on top; the
 * button inside the card is the path that always exists (WCAG 2.2 SC 2.5.7).
 */
function DraggableCard({
  row,
  column,
  locale,
  triage,
  onAct,
  refusal,
}: {
  row: ClientDirectoryRow
  column: BoardColumnId
  locale: string
  triage: TriageStatus
  onAct: (row: ClientDirectoryRow, act: BoardAct) => void
  refusal: string | null
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: rowKey(row) })

  // `attributes` is NOT spread whole: it carries `role="button"`, which would overwrite the
  // card's `<article>` and turn every row of the board into a button with a name and no
  // structure. What the keyboard sensor actually needs is a focusable element and the
  // role-description that tells the operator it can be moved — those two, and nothing else.
  const { tabIndex, 'aria-roledescription': roleDescription, 'aria-describedby': describedBy } =
    attributes

  return (
    <div ref={setNodeRef}>
      <BoardCard
        row={row}
        column={column}
        locale={locale}
        triage={triage}
        onAct={onAct}
        dragHandleProps={{
          ...listeners,
          tabIndex,
          'aria-roledescription': roleDescription,
          'aria-describedby': describedBy,
        }}
        dragging={isDragging}
      />
      {/* Why the card came back. `role="status"` so it is announced rather than only seen —
          a drag that silently reverts reads as a broken screen. */}
      {refusal && (
        <p
          role="status"
          className="mt-1 rounded-xl border border-secondary-700 px-2 py-1 text-[11px] text-gray-900 dark:text-gray-200"
        >
          {refusal}
        </p>
      )}
    </div>
  )
}

function DroppableColumn(props: React.ComponentProps<typeof BoardColumn>) {
  const { isOver, setNodeRef } = useDroppable({ id: props.column.id })
  return (
    <BoardColumn
      {...props}
      dropRef={setNodeRef}
      dropActive={isOver}
    />
  )
}
