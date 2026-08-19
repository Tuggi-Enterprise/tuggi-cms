/**
 * The promotional material a partner asked for — `partner.material_orders` and its lines.
 *
 * WHY THIS EXISTS AT ALL: the partner answers three quantities on the public proposal, the
 * promotion turns them into an order, and until this module there was nowhere the team could
 * read it. Data nobody reads is the mirror image of code nobody calls (CLAUDE.md §6) — it
 * claims the product does something it does not.
 *
 * WRITES GO THROUGH THE FUNCTION, NEVER THROUGH TWO INSERTS. `partner.create_material_order` is
 * the only creation path, and that is enforced by the database and not by convention: it puts
 * the order and its lines in one act, drops a quantity that is absent or `<= 0`, refuses an
 * order with no line at all, and returns the order that already exists when a proposal is
 * promoted twice. Two REST calls could not be any of those things — PostgREST gives no
 * transaction across two requests.
 *
 * The vocabulary of `kind` is `MATERIAL_KINDS`, the same three ids the CHECK carries and the
 * same three the proposal derives its answer keys from.
 */

import { getSupabaseService } from '@/lib/core/supabase-client'
import { MATERIAL_KINDS, type MaterialKind } from '@/lib/partner-form/fields'

const SCHEMA = 'partner'
const ORDERS = 'material_orders'

function service() {
  return getSupabaseService().schema(SCHEMA)
}

/** `requested` is where every order starts; the other two are how it ends. */
export const MATERIAL_ORDER_STATUSES = ['requested', 'fulfilled', 'cancelled'] as const
export type MaterialOrderStatus = (typeof MATERIAL_ORDER_STATUSES)[number]

/** Where the order came from. `proposal` is the partner's own answer; `cms` is the team's. */
export const MATERIAL_ORDER_SOURCES = ['proposal', 'cms'] as const
export type MaterialOrderSource = (typeof MATERIAL_ORDER_SOURCES)[number]

export interface MaterialOrderItem {
  kind: MaterialKind
  quantity: number
}

export interface MaterialOrder {
  id: string
  status: MaterialOrderStatus
  source: MaterialOrderSource
  submissionId: string | null
  notes: string | null
  createdAt: string
  items: MaterialOrderItem[]
}

interface OrderRow {
  id: string
  status: string
  source: string
  submission_id: string | null
  notes: string | null
  created_at: string
  material_order_items: { kind: string; quantity: number }[] | null
}

/**
 * Every order of one partner, newest first.
 *
 * The lines come in the SAME query, embedded — a second round trip per order would turn a list
 * of five orders into six requests, and the embed is what `material_order_items_kind_uk` already
 * indexes by (`order_id` is its first column).
 *
 * The lines are re-sorted into `MATERIAL_KINDS` order and not left in whatever order the
 * database returned. The screen lists sticker, table, counter every time, because a list whose
 * order changes between two partners is a list somebody has to re-read.
 */
export async function loadMaterialOrders(clientId: string): Promise<MaterialOrder[]> {
  const { data, error } = await service()
    .from(ORDERS)
    .select('id, status, source, submission_id, notes, created_at, material_order_items(kind, quantity)')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })

  if (error || !data) return []

  return (data as OrderRow[]).map((row) => ({
    id: row.id,
    status: row.status as MaterialOrderStatus,
    source: row.source as MaterialOrderSource,
    submissionId: row.submission_id,
    notes: row.notes,
    createdAt: row.created_at,
    items: sortedItems(row.material_order_items ?? []),
  }))
}

function sortedItems(rows: { kind: string; quantity: number }[]): MaterialOrderItem[] {
  return MATERIAL_KINDS.flatMap((kind) => {
    const row = rows.find((candidate) => candidate.kind === kind)
    return row ? [{ kind, quantity: row.quantity }] : []
  })
}

export type CreateOrderOutcome =
  | { ok: true; orderId: string }
  | { ok: false; reason: 'empty' | 'write_failed' }

/**
 * Registers an order the team is placing by hand — a reposition, or the material of a partner
 * who was registered before the proposal asked the question.
 *
 * `source: 'cms'` and no `submission_id`: the uniqueness that keeps a promotion from producing
 * two orders is keyed on the submission, so an order with none is free to be the second, third
 * and fourth of the same partner. That is what a reposition is.
 */
export async function createMaterialOrder(input: {
  clientId: string
  items: Partial<Record<MaterialKind, number>>
  notes?: string | null
  createdBy?: string | null
}): Promise<CreateOrderOutcome> {
  const items: Record<string, number> = {}
  for (const kind of MATERIAL_KINDS) {
    const quantity = input.items[kind]
    if (typeof quantity === 'number' && Number.isInteger(quantity) && quantity > 0) {
      items[kind] = quantity
    }
  }
  // Answered here as well as in the database, and that is not duplication of the rule: the
  // CHECK is what GUARANTEES it, this is what turns it into a message instead of a 500.
  if (Object.keys(items).length === 0) return { ok: false, reason: 'empty' }

  const { data, error } = await service().rpc('create_material_order', {
    p_client_id: input.clientId,
    p_items: items,
    p_source: 'cms',
    p_notes: input.notes ?? null,
    p_created_by: input.createdBy ?? null,
  })

  if (error || typeof data !== 'string') return { ok: false, reason: 'write_failed' }
  return { ok: true, orderId: data }
}

/**
 * Moves an order to `fulfilled` or `cancelled`.
 *
 * There is no path back to `requested`, and no path out of a closed order: reopening a
 * fulfilled order would say the material was un-shipped. A partner who needs more asks for
 * another order, which is the whole reason this is a table and not three columns.
 */
export async function setMaterialOrderStatus(
  orderId: string,
  status: Exclude<MaterialOrderStatus, 'requested'>
): Promise<boolean> {
  const { data, error } = await service()
    .from(ORDERS)
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', orderId)
    .eq('status', 'requested')
    .select('id')

  return !error && Array.isArray(data) && data.length > 0
}
