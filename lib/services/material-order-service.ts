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
import { derivePartnerPlan, paymentStance, type PaymentStance } from '@/lib/clients/partner-plan'
import type { ContractTier } from '@/lib/contract/snapshot'
import { MATERIAL_KINDS, type MaterialKind } from '@/lib/partner-form/fields'
import {
  MATERIAL_COLUMNS,
  statusesThatMayBecome,
  type MaterialColumnId,
  type MaterialDestination,
  type MaterialMoveStatus,
  type MaterialQueueOrder,
} from '@/lib/materials/order-queue'

const SCHEMA = 'partner'
const ORDERS = 'material_orders'

function service() {
  return getSupabaseService().schema(SCHEMA)
}

/**
 * `requested` is where every order starts, `in_preparation` and `dispatched` are the esteira,
 * and the last two are how it ends.
 *
 * NOT A SECOND LIST: this IS `MATERIAL_COLUMNS`, re-exported under the name the service and the
 * CHECK use. The column on the board is the status in the row, so two lists would be two
 * vocabularies of the same fact — the class of defect that made a board show a column nobody
 * could ever land in.
 */
export const MATERIAL_ORDER_STATUSES = MATERIAL_COLUMNS
export type MaterialOrderStatus = MaterialColumnId

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
 * Advances an order along the esteira — `in_preparation`, `dispatched`, `fulfilled`, `cancelled`.
 *
 * THE GUARD IS THE GRAPH, NOT A CONSTANT. `statusesThatMayBecome` reads `MATERIAL_TRANSITIONS`
 * backwards, so the `WHERE` of this update is the same arrows the board draws. An order that is
 * not a legal origin for `status` matches no row and the write reports it — the screen is not
 * the guarantee, and a second tab that already advanced the order cannot be overwritten by this
 * one.
 *
 * There is no path back to `requested` and no path out of a terminal status: reopening a
 * delivered order would say the material was un-shipped. A partner who needs more asks for
 * another order, which is the whole reason this is a table and not three columns.
 */
export async function setMaterialOrderStatus(
  orderId: string,
  status: MaterialMoveStatus
): Promise<boolean> {
  const { data, error } = await service()
    .from(ORDERS)
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', orderId)
    .in('status', statusesThatMayBecome(status))
    .select('id')

  return !error && Array.isArray(data) && data.length > 0
}

/**
 * EVERY PARTNER'S ORDER, for the queue screen — `/admin/materials`.
 *
 * WHY THIS IS NOT `loadMaterialOrders` WITHOUT THE FILTER: the per-partner panel is read inside
 * a record that already says who the partner is and where they are. A cross-client card carries
 * neither, and an order that says `30 adesivos` with no name and no town is not shippable.
 *
 * THREE READS AND NOT AN EMBED, and the reason is the schema line: the orders are in `partner`,
 * the establishment is `core.attractions`, and PostgREST does not embed across schemas. So the
 * ids are collected and the two other tables are read once each — three round trips for the
 * whole board, not three per card.
 *
 * THE ADDRESS IS RESOLVED, NOT PICKED. `core.attractions.partner_client_id` and
 * `partner.clients.welcome_poi_id` are two independent claims about the same establishment and
 * they disagreed for 10 of 10 partners on 2026-08-23 (see `welcomeDivergence`). The linked place
 * wins because it is the one the pipeline publishes; the welcome POI answers when nothing is
 * linked; the client's own city answers when neither does; and when even that is empty the
 * destination says `none` instead of inventing one.
 */
export async function loadMaterialOrderQueue(cap = 500): Promise<MaterialQueueOrder[]> {
  const { data, error } = await service()
    .from(ORDERS)
    .select(
      'id, client_id, status, source, submission_id, notes, created_at, material_order_items(kind, quantity)'
    )
    .order('created_at', { ascending: false })
    .limit(cap)

  if (error || !data) return []

  const rows = data as (OrderRow & { client_id: string })[]
  const clientIds = Array.from(new Set(rows.map((row) => row.client_id)))
  if (clientIds.length === 0) return []

  const clients = await loadOrderClients(clientIds)
  const places = await loadOrderPlaces(clientIds, clients)
  const tiers = await loadOrderContractTiers(clientIds)

  return rows.map((row) => {
    const client = clients.get(row.client_id)
    return {
      id: row.id,
      clientId: row.client_id,
      clientName: client?.name ?? client?.companyName ?? row.client_id,
      status: row.status as MaterialOrderStatus,
      source: row.source as MaterialOrderSource,
      notes: row.notes,
      createdAt: row.created_at,
      items: sortedItems(row.material_order_items ?? []),
      destination: places.get(row.client_id) ?? NO_DESTINATION,
      stance: stanceOf(client, tiers.get(row.client_id) ?? null),
    }
  })
}

/**
 * PAGANTE OU NÃO PAGANTE, decided once here so the card only draws the symbol.
 *
 * IT IS `derivePartnerPlan`, NOT A COMPARISON OF ITS OWN. Three different people answer "is this
 * one paid?" and that module is where the order between them lives (contract over registration
 * over proposal); a `monthlyFeeCents > 0` written here would be the fourth copy, and the one
 * that calls a zeroed fee a payer.
 *
 * `planChoice` IS DELIBERATELY NOT READ, and this is the one shortcut in the call. It would cost
 * a fifth round trip — the promoted submission, per client — and it cannot change the ANSWER:
 * the choice only ever separates `free` from `undeclared`, and `paymentStance` folds both into
 * `not_paying`. Only `paid` is `paying`, and `paid` never comes from the form.
 */
function stanceOf(client: OrderClient | undefined, contractTier: ContractTier | null): PaymentStance {
  const plan = derivePartnerPlan({
    clientId: client?.id ?? null,
    fee: {
      monthlyFeeCents: client?.monthlyFeeCents ?? null,
      isCourtesy: client?.isCourtesy ?? false,
      courtesyReason: client?.courtesyReason ?? null,
    },
    planChoice: null,
    contractTier,
  })
  return paymentStance(plan.kind)
}

/**
 * The tier of each partner's LIVE contract — the one that was not superseded.
 *
 * One read for the whole board, newest first: the first row seen for a client is the live one,
 * the same rule `loadLiveContracts` follows in the partnership pipeline. A partner with no
 * contract answers `null`, which is what tells `derivePartnerPlan` to fall back to the record.
 */
async function loadOrderContractTiers(ids: string[]): Promise<Map<string, ContractTier | null>> {
  const tiers = new Map<string, ContractTier | null>()
  const { data } = await service()
    .from('partner_contracts')
    .select('client_id, tier, created_at')
    .in('client_id', ids)
    .is('superseded_by', null)
    .order('created_at', { ascending: false })

  for (const row of (data ?? []) as { client_id: string; tier: string | null }[]) {
    if (!row.client_id || tiers.has(row.client_id)) continue
    tiers.set(row.client_id, row.tier === 'free' || row.tier === 'paid' ? row.tier : null)
  }
  return tiers
}

const NO_DESTINATION: MaterialDestination = {
  attractionId: null,
  name: null,
  city: null,
  region: null,
  country: null,
  origin: 'none',
}

interface OrderClient {
  id: string
  name: string | null
  companyName: string | null
  city: string | null
  state: string | null
  country: string | null
  welcomePoiId: string | null
  /** The three money columns of the record. Absent is NOT zero — BR-B2B-017, item 6. */
  monthlyFeeCents: number | null
  isCourtesy: boolean
  courtesyReason: string | null
}

async function loadOrderClients(ids: string[]): Promise<Map<string, OrderClient>> {
  const { data } = await service()
    .from('clients')
    .select(
      'id, name, company_name, city, state, country, welcome_poi_id, monthly_fee_cents, is_courtesy, courtesy_reason'
    )
    .in('id', ids)

  const clients = new Map<string, OrderClient>()
  for (const row of (data ?? []) as Record<string, string | number | boolean | null>[]) {
    if (typeof row.id !== 'string') continue
    clients.set(row.id, {
      id: row.id,
      name: row.name as string | null,
      companyName: row.company_name as string | null,
      city: row.city as string | null,
      state: row.state as string | null,
      country: row.country as string | null,
      welcomePoiId: row.welcome_poi_id as string | null,
      monthlyFeeCents: typeof row.monthly_fee_cents === 'number' ? row.monthly_fee_cents : null,
      isCourtesy: row.is_courtesy === true,
      courtesyReason: (row.courtesy_reason as string | null) ?? null,
    })
  }
  return clients
}

/**
 * One address per partner, from the best claim available.
 *
 * Only two reads no matter how many partners: the places linked TO these clients, and the
 * welcome POIs of the ones that came back without a linked place.
 */
async function loadOrderPlaces(
  clientIds: string[],
  clients: Map<string, OrderClient>
): Promise<Map<string, MaterialDestination>> {
  const core = getSupabaseService().schema('core')
  const destinations = new Map<string, MaterialDestination>()

  const { data: linked } = await core
    .from('attractions')
    .select('id, name, city, state, country, partner_client_id')
    .in('partner_client_id', clientIds)

  for (const row of (linked ?? []) as Record<string, string | null>[]) {
    const clientId = row.partner_client_id
    // The first linked place wins and the rest are not read: BR-B2B-033 is 1 client : N places,
    // and the material goes to the establishment the partnership was opened for.
    if (!clientId || destinations.has(clientId)) continue
    destinations.set(clientId, {
      attractionId: row.id,
      name: row.name,
      city: row.city,
      region: row.state,
      country: row.country,
      origin: 'linked_place',
    })
  }

  const welcomeByClient = new Map<string, string>()
  for (const clientId of clientIds) {
    const client = clients.get(clientId)
    if (!client?.welcomePoiId || destinations.has(clientId)) continue
    welcomeByClient.set(clientId, client.welcomePoiId)
  }

  if (welcomeByClient.size > 0) {
    const { data: welcome } = await core
      .from('attractions')
      .select('id, name, city, state, country')
      .in('id', Array.from(welcomeByClient.values()))

    const byId = new Map<string, Record<string, string | null>>()
    for (const row of (welcome ?? []) as Record<string, string | null>[]) {
      if (row.id) byId.set(row.id, row)
    }
    for (const [clientId, poiId] of welcomeByClient) {
      const row = byId.get(poiId)
      // A pointer at a row nobody can read is a dangling id, not an address.
      if (!row) continue
      destinations.set(clientId, {
        attractionId: row.id,
        name: row.name,
        city: row.city,
        region: row.state,
        country: row.country,
        origin: 'welcome_poi',
      })
    }
  }

  for (const clientId of clientIds) {
    if (destinations.has(clientId)) continue
    const client = clients.get(clientId)
    if (!client?.city) continue
    destinations.set(clientId, {
      attractionId: null,
      name: client.companyName ?? client.name,
      city: client.city,
      region: client.state,
      country: client.country,
      origin: 'client_address',
    })
  }

  return destinations
}
