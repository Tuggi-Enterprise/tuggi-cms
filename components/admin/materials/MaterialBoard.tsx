'use client'

/**
 * THE BOARD OF MATERIAL ORDERS — five columns, one direction.
 *
 * WHAT MAKES IT DIFFERENT FROM THE PARTNERSHIP BOARD: there the column is derived from four
 * tables and the drag fires an act that changes a fact elsewhere; here the column IS
 * `partner.material_orders.status`, and the drag is the write. So there is no `buildBoardView`
 * and no derivation to keep honest — only `planMaterialMove`, which says what a drop means, and
 * `groupByColumn`, which puts each card under its own status.
 *
 * NO OPTIMISTIC MOVE, same reason as the other board: the card lands in the next column because
 * the list was read again. Moving it first and snapping it back on failure teaches the operator
 * to distrust the board.
 *
 * THE DASHBOARD IS PART OF THIS COMPONENT and not a sibling: it is computed from the same
 * `orders` array, so no arrangement of props can make the figures count one set and the columns
 * another.
 *
 * ── THE PAGE SITS IN THE GRID THE REST OF THE CMS SITS IN ──────────────────────────────────
 *
 * `/admin/clients`, `/places` and `/events` all draw the same shell: an 18% rail on the left,
 * sticky under the header, and 82% of content whose title bar is a rounded card that sticks to
 * the top. This screen was the one that did not — a bare `h1` on the grey background — and it
 * read as a page from another product. The shell here is that one, token for token
 * (`DirectoryFilterRail`, `ClientDirectory`), because a second set of paddings and radii would
 * be a second design system.
 *
 * BELOW `lg` THE RAIL IS NOT A RAIL — 18% of a phone is 70px. The figures panel moves above the
 * board instead, which is the same answer `DirectoryFilterRail` gives with its sheet, minus the
 * portal: there is nothing to interact with here, only numbers to read.
 */

import { useCallback, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  DndContext,
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
import { MaterialCard } from '@/components/admin/materials/MaterialCard'
import {
  MaterialDestinations,
  MaterialFigures,
} from '@/components/admin/materials/MaterialSummary'
import {
  MATERIAL_COLUMNS,
  filterQueue,
  groupByColumn,
  planMaterialMove,
  summarizeMaterialQueue,
  type MaterialColumnId,
  type MaterialMoveStatus,
  type MaterialQueueOrder,
} from '@/lib/materials/order-queue'

interface MaterialBoardProps {
  locale: string
  orders: MaterialQueueOrder[]
  loading: boolean
  failed: boolean
  truncated: boolean
  busy: boolean
  onReload: () => void
  onMove: (order: MaterialQueueOrder, status: MaterialMoveStatus) => void
}

export function MaterialBoard({
  locale,
  orders,
  loading,
  failed,
  truncated,
  busy,
  onReload,
  onMove,
}: MaterialBoardProps) {
  const t = useTranslations('Materials')
  const [term, setTerm] = useState('')
  const [dragging, setDragging] = useState<MaterialQueueOrder | null>(null)
  const [refusal, setRefusal] = useState<{ id: string; message: string } | null>(null)

  const visible = useMemo(() => filterQueue(orders, term), [orders, term])
  // The tiles count the FILTERED set, because the filter is the operator saying "this is the
  // batch I am shipping" — a total that ignores the filter would be a number for another job.
  const summary = useMemo(() => summarizeMaterialQueue(visible), [visible])
  const columns = useMemo(() => groupByColumn(visible), [visible])

  const sensors = useSensors(
    // A few pixels of travel before a drag starts, so clicking a card's button is a click.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  )

  const onDragStart = useCallback(
    (event: DragStartEvent) => {
      setRefusal(null)
      setDragging(orders.find((order) => order.id === String(event.active.id)) ?? null)
    },
    [orders]
  )

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const order = dragging
      setDragging(null)
      if (!order || !event.over) return

      const plan = planMaterialMove(order, String(event.over.id) as MaterialColumnId)
      if (plan.kind === 'act') {
        onMove(order, plan.status)
        return
      }
      if (plan.kind === 'noop') return
      setRefusal({ id: order.id, message: t(`refused.${plan.reason}`) })
    },
    [dragging, onMove, t]
  )

  if (failed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6 dark:bg-gray-950">
        <div className="text-center">
          <p className="font-medium text-gray-900 dark:text-white">{t('errorTitle')}</p>
          <Button variant="outline" className="mt-3" onClick={onReload}>
            {t('retry')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="cms-width flex min-h-screen flex-col bg-gray-50 p-4 dark:bg-gray-950 lg:p-8">
      <div className="flex flex-1 flex-col gap-6 pt-2 lg:flex-row lg:gap-8 lg:pt-6">
        {/* ── The rail: the numbers, read without moving the eye off the board ───────────── */}
        <div className="hidden w-[18%] flex-shrink-0 lg:block">
          {!loading && (
            <div className="sticky top-24">
              <MaterialFigures summary={summary} truncated={truncated} />
            </div>
          )}
        </div>

        {/* ── The queue ─────────────────────────────────────────────────────────────────── */}
        {/* `w-full` under `lg`: `18% + 82% + gap-8 + p-8` is wider than a phone, and the
            remainder was the board hanging off the right edge of the screen. */}
        <div className="w-full min-w-0 lg:w-[82%]">
          <div className="sticky top-0 z-30 mb-4 rounded-3xl border border-gray-200 bg-white/80 shadow-2xl shadow-black/5 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-900/80 lg:mb-8">
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 lg:gap-4 lg:p-4">
              <div className="lg:pl-2">
                <h1 className="text-lg font-semibold tracking-tight text-gray-900 dark:text-white lg:text-xl">
                  {t('title')}
                </h1>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">{t('subtitle')}</p>
              </div>

              <div className="flex flex-wrap items-center gap-2 lg:gap-3">
                <label htmlFor="material-search" className="sr-only">
                  {t('searchLabel')}
                </label>
                <input
                  id="material-search"
                  type="search"
                  value={term}
                  onChange={(event) => setTerm(event.target.value)}
                  placeholder={t('searchPlaceholder')}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-tuggi-blue/30 dark:border-gray-700 dark:bg-gray-800 dark:text-white sm:w-64"
                />
                <Button type="button" variant="outline" onClick={onReload} disabled={loading}>
                  {t('reload')}
                </Button>
              </div>
            </div>
          </div>

          {loading ? (
            <p role="status" className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
              {t('loading')}
            </p>
          ) : (
            <>
              {/* Below `lg` the rail is hidden, so the same panel rides above the board. */}
              <div className="mb-6 lg:hidden">
                <MaterialFigures summary={summary} truncated={truncated} />
              </div>

              {truncated && (
                <p
                  role="status"
                  className="mb-4 rounded-2xl border border-gray-200 bg-white/70 p-3 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-900/70 dark:text-gray-200"
                >
                  {t('truncated')}
                </p>
              )}

              <MaterialDestinations summary={summary} />

              <p className="mb-2 text-[11px] leading-snug text-gray-500 dark:text-gray-400">
                {t('dragHint')}
              </p>

              <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
                {/* The board scrolls sideways inside its own container; the page never does. */}
                <div className="flex gap-3 overflow-x-auto pb-4">
                  {MATERIAL_COLUMNS.map((column) => (
                    <DroppableColumn key={column} id={column} count={columns[column].length}>
                      {columns[column].map((order) => (
                        <DraggableCard
                          key={order.id}
                          order={order}
                          locale={locale}
                          busy={busy}
                          onMove={onMove}
                          refusal={refusal?.id === order.id ? refusal.message : null}
                        />
                      ))}
                      {columns[column].length === 0 && (
                        <p className="px-1 py-4 text-xs text-gray-500 dark:text-gray-400">
                          {term ? t('emptyFiltered') : t('empty')}
                        </p>
                      )}
                    </DroppableColumn>
                  ))}
                </div>
              </DndContext>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function DroppableColumn({
  id,
  count,
  children,
}: {
  id: MaterialColumnId
  count: number
  children: React.ReactNode
}) {
  const t = useTranslations('Materials')
  const s = useTranslations('Clients.profile.material.statuses')
  const { isOver, setNodeRef } = useDroppable({ id })
  const headingId = `material-column-${id}`

  return (
    <section
      aria-labelledby={headingId}
      ref={setNodeRef}
      className={`flex w-72 flex-shrink-0 flex-col rounded-3xl border bg-gray-50/60 p-3 dark:bg-gray-900/40 ${
        isOver ? 'border-primary-800 dark:border-tuggi-blue' : 'border-gray-200 dark:border-gray-800'
      }`}
    >
      <header className="mb-3 px-1">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id={headingId} className="text-sm font-semibold tracking-tight text-gray-900 dark:text-white">
            {s(id)}
          </h2>
          <span className="shrink-0 text-xs font-medium text-gray-500 dark:text-gray-400">{count}</span>
        </div>
        <p className="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">
          {t(`columnHints.${id}`)}
        </p>
      </header>

      <div className="flex flex-col gap-2">{children}</div>
    </section>
  )
}

function DraggableCard(props: {
  order: MaterialQueueOrder
  locale: string
  busy: boolean
  onMove: (order: MaterialQueueOrder, status: MaterialMoveStatus) => void
  refusal: string | null
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: props.order.id })

  // `attributes` is NOT spread whole: it carries `role="button"`, which would overwrite the
  // card's `<article>`. The keyboard sensor needs a focusable element and the role-description,
  // and those two only.
  const { tabIndex, 'aria-roledescription': roleDescription, 'aria-describedby': describedBy } =
    attributes

  return (
    <div ref={setNodeRef}>
      <MaterialCard
        order={props.order}
        locale={props.locale}
        busy={props.busy}
        onMove={props.onMove}
        dragging={isDragging}
        refusal={props.refusal}
        dragHandleProps={{
          ...listeners,
          tabIndex,
          'aria-roledescription': roleDescription,
          'aria-describedby': describedBy,
        }}
      />
    </div>
  )
}
