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
 * `orders` array, so no arrangement of props can make the tiles count one set and the columns
 * another.
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
import { MaterialSummary } from '@/components/admin/materials/MaterialSummary'
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
    <div className="flex min-h-screen flex-col bg-gray-50 p-6 dark:bg-gray-950 lg:p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-white">
            {t('title')}
          </h1>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">{t('dragHint')}</p>
        </div>

        <div className="flex items-center gap-3">
          <label htmlFor="material-search" className="sr-only">
            {t('searchLabel')}
          </label>
          <input
            id="material-search"
            type="search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={t('searchPlaceholder')}
            className="w-64 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-tuggi-blue/30 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
          />
          <Button type="button" variant="outline" onClick={onReload} disabled={loading}>
            {t('reload')}
          </Button>
        </div>
      </div>

      {loading ? (
        <p role="status" className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
          {t('loading')}
        </p>
      ) : (
        <>
          <MaterialSummary summary={summary} truncated={truncated} />

          {truncated && (
            <p
              role="status"
              className="mb-4 rounded-2xl border border-gray-200 bg-white/70 p-3 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-900/70 dark:text-gray-200"
            >
              {t('truncated')}
            </p>
          )}

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
