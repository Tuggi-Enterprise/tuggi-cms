/**
 * THE FILA DE MATERIAL — every partner's order in one place, and the rule of what a drag may do.
 *
 * WHY A SCREEN OF ITS OWN, when `MaterialOrders` already shows the orders of ONE partner: the
 * question the team actually has is not "what did this partner ask for" but "how many displays
 * do we print this week, and to which addresses do they go". That question has no answer in a
 * per-partner panel — it is answered by reading seventeen panels and adding up by hand, which
 * is the same as not being answerable.
 *
 * THE COLUMN IS THE STATUS, not a derivation of it. This is the opposite of the partnership
 * board, whose column is computed from facts spread over four tables (`board-transitions`);
 * here `partner.material_orders.status` IS the column, so a card can only be where the database
 * says it is, and there is nothing to keep in step.
 *
 * FIVE COLUMNS, ONE GRAPH, ONE PLACE. `MATERIAL_TRANSITIONS` is the whole rule of what may
 * follow what — the board reads it to plan a drop, the card reads it to draw its buttons, and
 * the write reads it BACKWARDS (`statusesThatMayBecome`) to build the `WHERE` that refuses the
 * move in the database. Three surfaces, one fact: a transition added here is added everywhere,
 * and there is no second table of arrows to fall out of step.
 *
 * FORWARD ONLY, AND THE DATABASE AGREES. `setMaterialOrderStatus` updates only rows whose
 * status is a legal origin for the target, so an illegal move is refused by the write and not
 * merely hidden by the screen. The refusal is spelled out here as well, in `planMaterialMove`,
 * so the operator reads WHY the card snapped back instead of watching it fail in silence: an
 * order that was delivered says the material left, and un-saying that is not a state change, it
 * is a second order.
 *
 * Pure: no fetch, no Supabase, no React. Proven by `tests/api/material-queue.test.ts`.
 */

import type { PaymentStance } from '@/lib/clients/partner-plan'
import { MATERIAL_KINDS, type MaterialKind } from '@/lib/partner-form/fields'
import type { MaterialOrderItem, MaterialOrderSource } from '@/lib/services/material-order-service'

/**
 * Left to right: the queue, the two steps of the esteira, then the two ways it ends. Same
 * vocabulary as the CHECK, and the SSOT of it — `MATERIAL_ORDER_STATUSES` is this list.
 */
export const MATERIAL_COLUMNS = [
  'requested',
  'in_preparation',
  'dispatched',
  'fulfilled',
  'cancelled',
] as const
export type MaterialColumnId = (typeof MATERIAL_COLUMNS)[number]

/** Where an order can end, and therefore what a drag may write. `requested` is never a target. */
export type MaterialMoveStatus = Exclude<MaterialColumnId, 'requested'>

/** An order that ended. Nothing leaves these two — a reposition is another order. */
const TERMINAL_STATUSES: readonly MaterialColumnId[] = ['fulfilled', 'cancelled']

/**
 * THE GRAPH — decided with the operator on 2026-08-26.
 *
 * `in_preparation` has TWO exits and that is the point of it: material handed over at the
 * counter never rides a carrier, so `fulfilled` is reachable without passing `dispatched`.
 *
 * `dispatched` cannot be cancelled: the box is with the carrier, and cancelling it would say
 * nothing was produced when the money was already spent. What happens to a lost shipment is a
 * new order, the same as a reposition.
 */
export const MATERIAL_TRANSITIONS: Record<MaterialColumnId, readonly MaterialColumnId[]> = {
  requested: ['in_preparation', 'cancelled'],
  in_preparation: ['dispatched', 'fulfilled', 'cancelled'],
  dispatched: ['fulfilled'],
  fulfilled: [],
  cancelled: [],
}

/** Still moving: everything that has not ended. */
function isOpen(status: MaterialColumnId): boolean {
  return !TERMINAL_STATUSES.includes(status)
}

/**
 * THE GRAPH READ BACKWARDS — which statuses may still become `target`.
 *
 * This is what the `WHERE` of the update is built from, so the screen's arrows and the
 * database's refusal are literally the same list.
 */
export function statusesThatMayBecome(target: MaterialColumnId): MaterialColumnId[] {
  return MATERIAL_COLUMNS.filter((from) => MATERIAL_TRANSITIONS[from].includes(target))
}

/**
 * WHERE THE MATERIAL IS GOING, and how sure we are of it.
 *
 * `partner.material_orders` carries no address, on purpose: the display goes to the
 * establishment, and the establishment is the POI. Two pointers claim to be that POI and
 * measured on 2026-08-23 they disagreed for 10 of 10 partners (`partnership-service`,
 * `welcomeDivergence`) — so `origin` says which one answered, and `none` is printed rather than
 * guessed. An order nobody can address is the one fact this screen must not round off.
 */
export type DestinationOrigin = 'linked_place' | 'welcome_poi' | 'client_address' | 'none'

export interface MaterialDestination {
  /** `core.attractions.id`, or `null` when the address came from the client record. */
  attractionId: string | null
  /** The establishment's name, or the partner's company when only the record answered. */
  name: string | null
  city: string | null
  region: string | null
  country: string | null
  origin: DestinationOrigin
}

export interface MaterialQueueOrder {
  id: string
  clientId: string
  /** What the operator recognises the partner by — trade name, falling back to the record's. */
  clientName: string
  status: MaterialColumnId
  source: MaterialOrderSource
  notes: string | null
  createdAt: string
  items: MaterialOrderItem[]
  destination: MaterialDestination
  /**
   * Pagante ou não pagante — decided by `derivePartnerPlan` in the service, never on the card.
   *
   * It is here because the box that leaves is the same for both tiers and the conversation
   * around it is not: BR-B2B-021 gives the free tier its display for nothing, and the operator
   * packing a shipment reads who is on which side without opening a second screen.
   */
  stance: PaymentStance
}

export type MaterialMovePlan =
  | { kind: 'act'; status: MaterialMoveStatus }
  /** Dropped back where it came from. Not an error, and not a request either. */
  | { kind: 'noop' }
  | { kind: 'refused'; reason: MaterialRefusal }

/**
 * The four ways a drop is refused. They are DIFFERENT and the operator is owed the difference —
 * "this one is over" and "you skipped a step" send them to two different next acts.
 */
export type MaterialRefusal = 'reopen' | 'closed' | 'skip' | 'shipped'

const COLUMN_INDEX: Record<MaterialColumnId, number> = MATERIAL_COLUMNS.reduce(
  (index, column, position) => {
    index[column] = position
    return index
  },
  {} as Record<MaterialColumnId, number>
)

/**
 * What dragging a card to a column means.
 *
 * The order of the checks is the order of the messages, and it is deliberate: `reopen` answers
 * BEFORE `closed` when the target is `Pedido`, so dragging a delivered order back to the start
 * says orders do not come back rather than saying this one is over.
 */
export function planMaterialMove(
  order: Pick<MaterialQueueOrder, 'status'>,
  target: MaterialColumnId
): MaterialMovePlan {
  if (order.status === target) return { kind: 'noop' }
  // Nothing returns to the start, from anywhere. This is the rule the table exists for.
  if (target === 'requested') return { kind: 'refused', reason: 'reopen' }
  if (MATERIAL_TRANSITIONS[order.status].includes(target)) {
    return { kind: 'act', status: target as MaterialMoveStatus }
  }
  if (!isOpen(order.status)) return { kind: 'refused', reason: 'closed' }
  if (COLUMN_INDEX[target] < COLUMN_INDEX[order.status]) return { kind: 'refused', reason: 'reopen' }
  // The only forward move left that the graph refuses: cancelling what a carrier already has.
  if (order.status === 'dispatched' && target === 'cancelled') {
    return { kind: 'refused', reason: 'shipped' }
  }
  return { kind: 'refused', reason: 'skip' }
}

/** The cards under each column, in the order they arrived (newest first, as loaded). */
export function groupByColumn(
  orders: MaterialQueueOrder[]
): Record<MaterialColumnId, MaterialQueueOrder[]> {
  const columns = MATERIAL_COLUMNS.reduce(
    (grouped, column) => {
      grouped[column] = []
      return grouped
    },
    {} as Record<MaterialColumnId, MaterialQueueOrder[]>
  )
  for (const order of orders) columns[order.status]?.push(order)
  return columns
}

export type KindTotals = Record<MaterialKind, number>

export interface DestinationTotals {
  /** `city|region`, lowercased — what groups two spellings of the same town into one line. */
  key: string
  city: string | null
  region: string | null
  orders: number
  units: number
  byKind: KindTotals
}

export interface MaterialQueueSummary {
  /** Orders that have not left — `requested` plus `in_preparation`. The print-and-ship list. */
  pendingOrders: number
  /** Everything the pending orders add up to, per kind and in total. */
  pendingUnits: number
  pendingByKind: KindTotals
  /** Already produced and with the carrier. Counted apart: printing it again is the mistake. */
  dispatchedOrders: number
  dispatchedUnits: number
  fulfilledOrders: number
  fulfilledUnits: number
  cancelledOrders: number
  /** Pending orders by town, heaviest first — the shipping list. */
  destinations: DestinationTotals[]
  /**
   * Pending orders with no address at all. Printed as a number and not swept into "outros": a
   * box with nowhere to go is the only line here that is a pendency rather than a quantity.
   */
  pendingWithoutDestination: number
}

function emptyKinds(): KindTotals {
  return MATERIAL_KINDS.reduce((totals, kind) => {
    totals[kind] = 0
    return totals
  }, {} as KindTotals)
}

function unitsOf(order: MaterialQueueOrder): number {
  return order.items.reduce((sum, item) => sum + item.quantity, 0)
}

/**
 * The dashboard, computed from the SAME list the board renders.
 *
 * ONE READ, TWO SURFACES — the count above the columns and the cards inside them cannot
 * disagree, because there is no second query to disagree with. The alternative, a `count()` per
 * tile, is how a board ends up saying `17 abertos` over sixteen cards.
 *
 * CANCELLED COUNTS NOTHING BUT ITSELF: a cancelled order was never printed, and adding its
 * quantities to any total would inflate the only numbers here anybody spends money on.
 */
export function summarizeMaterialQueue(orders: MaterialQueueOrder[]): MaterialQueueSummary {
  const summary: MaterialQueueSummary = {
    pendingOrders: 0,
    pendingUnits: 0,
    pendingByKind: emptyKinds(),
    dispatchedOrders: 0,
    dispatchedUnits: 0,
    fulfilledOrders: 0,
    fulfilledUnits: 0,
    cancelledOrders: 0,
    destinations: [],
    pendingWithoutDestination: 0,
  }

  const byDestination = new Map<string, DestinationTotals>()

  for (const order of orders) {
    if (order.status === 'cancelled') {
      summary.cancelledOrders += 1
      continue
    }

    const units = unitsOf(order)

    if (order.status === 'fulfilled') {
      summary.fulfilledOrders += 1
      summary.fulfilledUnits += units
      continue
    }

    if (order.status === 'dispatched') {
      summary.dispatchedOrders += 1
      summary.dispatchedUnits += units
      continue
    }

    summary.pendingOrders += 1
    summary.pendingUnits += units
    for (const item of order.items) {
      summary.pendingByKind[item.kind] += item.quantity
    }

    if (order.destination.origin === 'none' || !order.destination.city) {
      summary.pendingWithoutDestination += 1
      continue
    }

    const city = order.destination.city
    const region = order.destination.region
    const key = `${city}|${region ?? ''}`.toLowerCase()
    const line = byDestination.get(key) ?? {
      key,
      city,
      region,
      orders: 0,
      units: 0,
      byKind: emptyKinds(),
    }
    line.orders += 1
    line.units += units
    for (const item of order.items) line.byKind[item.kind] += item.quantity
    byDestination.set(key, line)
  }

  // Heaviest first, and by name when two towns weigh the same — a list whose order changes
  // between two loads of the same data is a list somebody has to re-read.
  summary.destinations = Array.from(byDestination.values()).sort(
    (a, b) => b.units - a.units || (a.city ?? '').localeCompare(b.city ?? '')
  )

  return summary
}

/**
 * The text filter over the queue — partner, establishment or town, one box.
 *
 * Accent-insensitive because `Buzios` must find `Búzios`: the operator types from memory, and a
 * filter that answers "nada encontrado" to a correct name is worse than no filter.
 */
export function filterQueue(orders: MaterialQueueOrder[], term: string): MaterialQueueOrder[] {
  const needle = fold(term)
  if (!needle) return orders
  return orders.filter((order) =>
    fold(
      [order.clientName, order.destination.name, order.destination.city, order.destination.region]
        .filter(Boolean)
        .join(' ')
    ).includes(needle)
  )
}

function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}
