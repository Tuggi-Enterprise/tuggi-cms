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
import {
  DirectoryFilterRail,
  DirectoryFilterSheet,
} from '@/components/admin/clients/DirectoryFilterRail'
import { BoardCard, deriveTriageOf } from '@/components/admin/clients/board/BoardCard'
import { BoardColumn } from '@/components/admin/clients/board/BoardColumn'
import {
  TERMINAL_PAGE,
  buildBoardView,
  columnOf,
  planTransition,
  type BoardAct,
  type BoardColumnId,
  type BoardColumnView,
  type TransitionPlan,
} from '@/lib/clients/board-transitions'
import { useIsDesktop } from '@/lib/hooks/use-media-query'
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

  /**
   * HOW FAR DOWN EACH TERMINAL COLUMN HAS BEEN OPENED, which used to be `which ones are open`.
   *
   * The collapse it replaced is described in `TERMINAL_PAGE`: it kept the board readable by
   * hiding the last month of delivered work, and an operator who had just published a place
   * could not see it on the board at all. Now every column shows its first page and this counter
   * is what `Ver mais` grows.
   *
   * COMPONENT STATE AND NOT THE URL, like `phoneColumn` and unlike every filter here. A filter is
   * a claim about WHICH partnerships matter and is worth sending to somebody; how far somebody
   * has scrolled into the archive is not, and putting it in the address bar would give
   * `Limpar filtros` two more keys to reason about for nothing.
   */
  const [shown, setShown] = useState<Partial<Record<BoardColumnId, number>>>({})

  /**
   * WHICH COLUMN A PHONE SHOWS, and why the board is not simply narrower there.
   *
   * Eight 288px lanes in a horizontal scroller is a shape that works with a mouse wheel and a
   * 2560px monitor. On a 390px screen it puts one and a third columns on screen, and the sideways
   * scroll it needs is the same gesture the operator uses to go back a page — so the board reads
   * as broken before it reads as full. Below `lg` the columns become a picker and one list: the
   * heading, the hint and the count all survive, because `BoardColumn` renders unchanged and only
   * its width differs.
   *
   * IT IS COMPONENT STATE AND NOT A URL PARAMETER, unlike every filter on this screen. A filter
   * is a claim about WHICH partnerships matter and is worth sending to somebody; which lane a
   * thumb is currently on is not. Putting it in the address bar would also mean `Limpar filtros`
   * had one more key to reason about, for nothing.
   */
  const [phoneColumn, setPhoneColumn] = useState<BoardColumnId>('proposal')
  const desktop = useIsDesktop()

  const board = useMemo(
    () => buildBoardView(rows, filters, { shown }),
    [rows, filters, shown]
  )
  /**
   * How many cards the columns are actually painting, alert band included.
   *
   * DERIVED FROM THE VIEW and never counted a second way: it is the sum of what `buildBoardView`
   * decided to render, so a change to the windowing rule moves this figure with it. A count that
   * re-implemented the window here is exactly how `{n} com a triagem vencida` once opened an
   * empty table.
   */
  const painted = useMemo(
    () => board.columns.reduce((sum, column) => sum + column.rows.length, 0) + board.alert.length,
    [board]
  )
  const late = useMemo(() => overdueCount(rows), [rows])
  const working = useMemo(() => inProgressCount(rows), [rows])
  const triage = useMemo(() => deriveTriageOf(rows), [rows])

  const revealMore = useCallback((column: BoardColumnId) => {
    setShown((current) => ({
      ...current,
      // The floor is `TERMINAL_PAGE` in `buildBoardView` too, so a column nobody has touched and
      // one sitting at its first page grow by the same amount from the same number.
      [column]: Math.max(TERMINAL_PAGE, current[column] ?? 0) + TERMINAL_PAGE,
    }))
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
    <div className="flex min-h-screen flex-col bg-gray-50 p-4 dark:bg-gray-950 lg:p-8">
      <div className="flex flex-1 flex-col gap-6 pt-2 lg:flex-row lg:gap-8 lg:pt-6">
        <DirectoryFilterRail
          view={board.directory}
          filters={filters}
          onFiltersChange={onFiltersChange}
          working={working}
        />

        {/* `w-full` under `lg`, and the old percentage above it. `18% + 82% + gap-8 + p-6` came
            to more than a phone has, which is what pushed the whole board past the right edge. */}
        <div className="w-full min-w-0 lg:w-[82%]">
          <div className="sticky top-0 z-30 mb-4 rounded-3xl border border-gray-200 bg-white/80 shadow-2xl shadow-black/5 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-900/80 lg:mb-6">
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 lg:gap-4 lg:p-4">
              <div className="flex flex-wrap items-center gap-3 lg:gap-8 lg:pl-2">
                <div>
                  <h1 className="text-lg font-semibold tracking-tight text-gray-900 dark:text-white lg:text-xl">
                    {c('title')}
                  </h1>
                  {/* `Arraste para a próxima coluna` is a lie on a touch screen, where there is
                      no drag to offer. The hint names the path that exists at each width. */}
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">
                    {desktop ? t('dragHint') : t('tapHint')}
                  </p>
                </div>

                <div className="hidden h-8 w-px bg-gray-200 dark:bg-gray-800 lg:block" aria-hidden="true" />

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

              <div className="flex flex-wrap items-center gap-2 lg:gap-3">
                <DirectoryFilterSheet
                  view={board.directory}
                  filters={filters}
                  onFiltersChange={onFiltersChange}
                  working={working}
                />
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
                  <div key={rowKey(row)} className="w-full lg:w-72">
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

          {/*
            HOW MUCH OF THE BOARD IS ON SCREEN, above the columns.
            
            THREE NUMBERS LIVE ON THIS SCREEN AND THEY ANSWER THREE QUESTIONS. The header's
            `21 de 36` is `passou o filtro` de `existe`; a column's `5 de 14` is that column's
            window; and this line is the board's own: how many cards are painted, out of
            everything the filter let through. Before it existed the header said `21` while the
            columns rendered fewer, because `Publicado` and `Encerrados` came shut — and nothing
            on the screen owned up to the difference.
            
            IT IS THE LOADED SET IT SPEAKS OF, not the database. When `truncated` is true the
            server cut the list before it arrived, and the banner right above says so; this line
            stays honest by never claiming to count rows the browser does not hold.
            
            `lg:block` — ON A PHONE THIS WOULD BE THE FOURTH NUMBER of the same family on a 390px
            screen, and the wrong one. Only one column renders there, so `painted` counts cards
            that are not on screen; what IS on screen is already carried twice, by the picker
            chips (every column's total) and by the column's own `5 de 14`.
          */}
          {!loading && (
            <p className="mb-3 hidden px-1 text-xs text-gray-500 dark:text-gray-400 lg:block">
              {painted < board.directory.rows.length
                ? t('boardTotalWindowed', { shown: painted, total: board.directory.rows.length })
                : t('boardTotal', { total: board.directory.rows.length })}
            </p>
          )}

          {loading ? (
            <p role="status" className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
              {c('loading')}
            </p>
          ) : (
            /*
             * TWO TREES, AND `@dnd-kit` MOUNTS IN ONLY ONE OF THEM.
             *
             * Not a matter of taste: `PointerSensor` claims the touch events it needs to tell a
             * drag from a scroll, and on a phone the finger that would start a drag is the one
             * scrolling the column. Rendering the drag tree and hiding it with `hidden` would
             * mount those sensors anyway, so the split is at the component and not in CSS —
             * which is what `useIsDesktop` exists for. Nothing is lost: `BoardCard` already
             * carries every act as a button, because WCAG 2.2 SC 2.5.7 demanded that of the
             * desktop board too.
             */
            desktop ? (
              <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
                {/*
                  The board scrolls sideways inside its own container; the page never does.
                  
                  `tabIndex` AND A NAME, BECAUSE A SCROLL BOX MUST BE REACHABLE BY KEYBOARD.
                  WCAG 2.1.1: a region that scrolls has to be scrollable without a pointer, which
                  means it is focusable or it contains something focusable. It used to contain
                  something focusable by accident — every terminal column carried an `Abrir`
                  toggle, so even an empty board had two buttons in it. Replacing the collapse
                  with `Ver mais`, which only exists when a column overflows, left the empty board
                  with nothing to tab to and the columns unreachable by arrow key. Caught by
                  `axe-core` on the empty state, which is the only state where it showed.
                */}
                <div
                  role="group"
                  aria-label={t('columnsLabel')}
                  tabIndex={0}
                  className="flex gap-3 overflow-x-auto pb-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-800"
                >
                  {board.columns.map((column) => (
                    <DroppableColumn
                      key={column.id}
                      column={column}
                      truncated={truncated}
                      filtering={board.directory.filtering}
                      onRevealMore={revealMore}
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
            ) : (
              <div className="pb-4">
                <ColumnPicker
                  columns={board.columns}
                  selected={phoneColumn}
                  truncated={truncated}
                  onSelect={setPhoneColumn}
                />

                {board.columns
                  .filter((column) => column.id === phoneColumn)
                  .map((column) => (
                    <BoardColumn
                      key={column.id}
                      column={column}
                      truncated={truncated}
                      filtering={board.directory.filtering}
                      onRevealMore={revealMore}
                      seeAllHref={seeAllHref}
                      stacked
                    >
                      {column.rows.map((row) => (
                        <BoardCard
                          key={rowKey(row)}
                          row={row}
                          column={column.id}
                          locale={locale}
                          triage={triage.get(rowKey(row)) ?? NOT_STARTED}
                          onAct={onAct}
                        />
                      ))}
                    </BoardColumn>
                  ))}
              </div>
            )
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

/**
 * The phone's way through the eight columns — a strip of chips, each carrying its count.
 *
 * THE COUNT IS ON THE CHIP because that is the whole board a phone can hold at once. On a
 * monitor the eight headings are read in one glance and the shape of the queue comes for free —
 * `5 na proposta, 1 no contrato` is visible without touching anything. Collapse that to one
 * column and the operator loses the overview, not just the columns: they would have to tap
 * through all eight to learn where the work is. The chips give the overview back.
 *
 * `≥ n` FOR A TRUNCATED SET, the same way `BoardColumn` prints it. `loadClientDirectory` caps at
 * 1000 rows newest first, so a cut set loses the OLDEST rows — exactly what fills `Publicado`
 * and `Encerrados`. A chip reading `142` for a number that is a floor is the defect that made
 * `{n} com a triagem vencida` open an empty table.
 *
 * `overflow-x-auto` HERE IS FINE where it was not for the columns themselves: this strip is one
 * row tall, so a sideways drag on it cannot be mistaken for the vertical scroll of a long list.
 */
function ColumnPicker({
  columns,
  selected,
  truncated,
  onSelect,
}: {
  columns: BoardColumnView[]
  selected: BoardColumnId
  truncated: boolean
  onSelect: (column: BoardColumnId) => void
}) {
  const t = useTranslations('Clients.board')

  return (
    <div
      role="tablist"
      aria-label={t('columnPickerLabel')}
      className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-2"
    >
      {columns.map((column) => {
        const active = column.id === selected
        const count = truncated ? t('countTruncated', { count: column.total }) : String(column.total)

        return (
          <button
            key={column.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(column.id)}
            /*
             * `whitespace-nowrap` and a real 44px target. The selected chip is carried by
             * WEIGHT and by a border, never by colour alone (DS-A11Y-003) — and `aria-selected`
             * says it out loud, which is what a screen reader reads instead of the border.
             */
            className={`inline-flex min-h-[44px] shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border px-3 py-2 text-sm transition-colors ${
              active
                ? 'border-primary-800 bg-primary-800/10 font-semibold text-gray-900 dark:border-tuggi-blue dark:bg-tuggi-blue/10 dark:text-white'
                : 'border-gray-200 text-primary-800 dark:border-gray-700 dark:text-tuggi-blue'
            }`}
          >
            {t(`columns.${column.id}`)}
            <span className="text-xs text-gray-500 dark:text-gray-400">{count}</span>
          </button>
        )
      })}
    </div>
  )
}
