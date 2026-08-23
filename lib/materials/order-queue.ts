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
 * ONE-WAY, AND THE DATABASE AGREES. `setMaterialOrderStatus` updates only rows still
 * `requested`, so a reopen is refused by the write and not merely hidden by the screen. The
 * refusal is spelled out here as well, in `planMaterialMove`, so the operator reads WHY the card
 * snapped back instead of watching it fail in silence: an order that was fulfilled says the
 * material left, and un-saying that is not a state change, it is a second order.
 *
 * Pure: no fetch, no Supabase, no React. Proven by `tests/api/material-queue.test.ts`.
 */

import { MATERIAL_KINDS, type MaterialKind } from '@/lib/partner-form/fields'
import type {
  MaterialOrderItem,
  MaterialOrderSource,
  MaterialOrderStatus,
} from '@/lib/services/material-order-service'

/** Left to right: the queue, then the two ways it ends. Same vocabulary as the CHECK. */
export const MATERIAL_COLUMNS = ['requested', 'fulfilled', 'cancelled'] as const
export type MaterialColumnId = (typeof MATERIAL_COLUMNS)[number]

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
  status: MaterialOrderStatus
  source: MaterialOrderSource
  notes: string | null
  createdAt: string
  items: MaterialOrderItem[]
  destination: MaterialDestination
}

export type MaterialMovePlan =
  | { kind: 'act'; status: Exclude<MaterialColumnId, 'requested'> }
  /** Dropped back where it came from. Not an error, and not a request either. */
  | { kind: 'noop' }
  | { kind: 'refused'; reason: 'reopen' | 'closed' }

/**
 * What dragging a card to a column means.
 *
 * The two refusals are DIFFERENT and the operator is owed the difference: `reopen` is dragging
 * anything back to `Pedido`, `closed` is dragging an order that already ended into the other
 * ending. The first says orders do not come back; the second says this one is already over.
 */
export function planMaterialMove(
  order: Pick<MaterialQueueOrder, 'status'>,
  target: MaterialColumnId
): MaterialMovePlan {
  if (order.status === target) return { kind: 'noop' }
  if (target === 'requested') return { kind: 'refused', reason: 'reopen' }
  if (order.status !== 'requested') return { kind: 'refused', reason: 'closed' }
  return { kind: 'act', status: target }
}

/** The cards under each column, in the order they arrived (newest first, as loaded). */
export function groupByColumn(
  orders: MaterialQueueOrder[]
): Record<MaterialColumnId, MaterialQueueOrder[]> {
  const columns = {
    requested: [] as MaterialQueueOrder[],
    fulfilled: [] as MaterialQueueOrder[],
    cancelled: [] as MaterialQueueOrder[],
  }
  for (const order of orders) columns[order.status as MaterialColumnId]?.push(order)
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
  /** Orders still `requested` — what has to be printed and shipped. */
  openOrders: number
  /** Everything the open orders add up to, per kind and in total. */
  openUnits: number
  openByKind: KindTotals
  fulfilledOrders: number
  fulfilledUnits: number
  cancelledOrders: number
  /** Open orders by town, heaviest first — the shipping list. */
  destinations: DestinationTotals[]
  /**
   * Open orders with no address at all. Printed as a number and not swept into "outros": a box
   * with nowhere to go is the only line here that is a pendency rather than a quantity.
   */
  openWithoutDestination: number
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
    openOrders: 0,
    openUnits: 0,
    openByKind: emptyKinds(),
    fulfilledOrders: 0,
    fulfilledUnits: 0,
    cancelledOrders: 0,
    destinations: [],
    openWithoutDestination: 0,
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

    summary.openOrders += 1
    summary.openUnits += units
    for (const item of order.items) {
      summary.openByKind[item.kind] += item.quantity
    }

    if (order.destination.origin === 'none' || !order.destination.city) {
      summary.openWithoutDestination += 1
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
