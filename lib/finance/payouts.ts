/**
 * The 10 % payout of the Com história place — the month's statement (#903).
 *
 * Rules: BR-B2B-044 item 6 (10 % on the paid plan, zero on the free one; a purchase counts when it
 * happened in a paid period or in the free month, by its date, not by the plan on the day of the
 * calculation; no minimum), BR-MONETIZACAO-027 item 1 (base = what the Tuggi received, net of the
 * store, in BRL) and item 2 (v) (attribution = `drive.profiles.partner_id`, first touch), term 5.4.
 * Contract: `docs/contracts/places-pagamento.md` §3.5 (`partner.record_place_payout_period`).
 *
 * NOT A SECOND CALCULATION. "What came in" and "what the Tuggi kept" are `isPaidRevenue` and
 * `netCentsOf` of `app-revenue.ts`, the same ones behind the commission screen; the partner is the
 * event's `partnerId`, which `loadRcEvents` fills from the profile for both.
 *
 * Pure: no Supabase, no fetch. Proved by `tests/api/finance-payouts.test.ts`.
 */

import { isPaidRevenue, isRefund, netCentsOf, type RcEvent } from './app-revenue'
import { convertCents, type FxRate } from './fx'
import { saoPauloDate } from './place-billing'

/**
 * BR-B2B-044 item 6: the place on Com história gets 10 % of each paid purchase of a tourist
 * attributed to it. This is NOT `core.clients.commission_rate` nor `DEFAULT_COMMISSION_RATE`
 * (`types/clients.ts`, the editable starting value of a CMS contract): the paid plan's 10 % is one
 * fixed number of the term, the same for every place.
 */
export const PLACE_PAYOUT_RATE = 0.1

/** A half-open interval `[from, to)` of ISO timestamps in which the plan was paid or free. */
export interface PaidWindow {
  from: string
  to: string
}

/** A client with a Com história contract: the acceptance the payout is paid under, and its windows. */
export interface PayoutClient {
  clientId: string
  acceptanceId: string
  windows: PaidWindow[]
}

/** A purchase already inside a payout of an EARLIER month that left `calculated`. */
export interface ReleasedPurchase {
  sourceEventId: string
  clientId: string
  baseCents: number
  commissionCents: number
}

/** The negative balance of an earlier month still `calculated` and not carried by another month. */
export interface NegativeCarry {
  payoutId: string
  clientId: string
  amountCents: number
}

export interface StatementItem {
  kind: 'purchase' | 'refund_offset' | 'carry_over'
  source_event_id: string | null
  offsets_event_id: string | null
  carried_from_payout_id: string | null
  occurred_at: string | null
  product_id: string | null
  store: string | null
  currency: string | null
  gross_amount_cents: number | null
  base_cents: number
  commission_cents: number
}

export interface StatementLine {
  client_id: string
  acceptance_id: string
  items: StatementItem[]
}

export interface PayoutStatement {
  /** `p_statement` of `partner.record_place_payout_period`. */
  statement: StatementLine[]
  /** Currencies of purchases with no declared BRL rate on their date. Not empty = do not record. */
  missingRates: string[]
  /** Paid purchases of the month whose partner has no Com história contract (or is not a client). */
  unattributed: number
}

const inWindows = (iso: string, windows: readonly PaidWindow[]): boolean =>
  windows.some((w) => iso >= w.from && iso < w.to)

/** `YYYY-MM-01` of an ISO timestamp, in São Paulo. */
const periodOf = (iso: string): string | null => {
  const day = saoPauloDate(iso)
  return day ? `${day.slice(0, 7)}-01` : null
}

/**
 * The statement of `periodMonth` (`YYYY-MM-01`, São Paulo).
 *
 * - `purchase`: a paid production purchase of the month by a user attributed to the client, inside
 *   one of the client's paid/free windows, not refunded. Base = net in BRL (declared rate of the
 *   purchase date), commission = 10 % of it.
 * - `refund_offset`: a refund of the month whose purchase is in an earlier payout that already left
 *   `calculated` (term 5.4: a refund already paid is discounted from the next payouts) — the exact
 *   negative of what that payout carried. A refund of a purchase still `calculated` is not offset:
 *   recalculating that month drops the purchase.
 * - `carry_over`: the whole negative balance of an earlier month still `calculated`.
 *
 * Every client with a window touching the month gets a line, even empty: a month at zero is
 * recorded and reported to the place (term 5.4, "informs the value every month").
 */
export function buildPayoutStatement(input: {
  periodMonth: string
  events: readonly RcEvent[]
  clients: readonly PayoutClient[]
  rates: readonly FxRate[]
  releasedPurchases: readonly ReleasedPurchase[]
  carries: readonly NegativeCarry[]
}): PayoutStatement {
  const { periodMonth } = input
  const monthStart = `${periodMonth}T03:00:00.000Z` // 00:00 in São Paulo (UTC−3, no DST since 2019)
  const nextPeriod =
    periodMonth.slice(5, 7) === '12'
      ? `${Number(periodMonth.slice(0, 4)) + 1}-01-01`
      : `${periodMonth.slice(0, 4)}-${String(Number(periodMonth.slice(5, 7)) + 1).padStart(2, '0')}-01`
  const monthEnd = `${nextPeriod}T03:00:00.000Z`

  const byClient = new Map(input.clients.map((c) => [c.clientId, c]))
  const items = new Map<string, StatementItem[]>()
  const push = (clientId: string, item: StatementItem) => {
    const list = items.get(clientId) ?? []
    list.push(item)
    items.set(clientId, list)
  }

  const seen = new Set<string>()
  const unique = input.events.filter((e) => (seen.has(e.eventId) ? false : (seen.add(e.eventId), true)))
  const refundedTransactions = new Set(unique.filter(isRefund).map((e) => e.transactionId as string))
  const missing = new Set<string>()
  let unattributed = 0

  for (const event of unique) {
    if (!isPaidRevenue(event) || !event.purchasedAt) continue
    if (periodOf(event.purchasedAt) !== periodMonth) continue
    const client = event.partnerId ? byClient.get(event.partnerId) : undefined
    if (!client) {
      if (event.partnerId) unattributed++
      continue
    }
    // BR-B2B-044 item 6: by the purchase date — a purchase on "No mapa" (before the upgrade, after
    // an unpaid period or a refunded withdrawal) does not count.
    if (!inWindows(event.purchasedAt, client.windows)) continue
    if (event.transactionId && refundedTransactions.has(event.transactionId)) continue

    const base = convertCents(netCentsOf(event), event.currency, 'BRL', input.rates, event.purchasedAt.slice(0, 10))
    if (base === null) {
      missing.add(event.currency)
      continue
    }
    push(client.clientId, {
      kind: 'purchase',
      source_event_id: event.eventId,
      offsets_event_id: null,
      carried_from_payout_id: null,
      occurred_at: event.purchasedAt,
      product_id: event.productId || null,
      store: event.store || null,
      currency: event.currency || null,
      gross_amount_cents: Math.round(event.priceLocal * 100),
      base_cents: base,
      commission_cents: Math.round(base * PLACE_PAYOUT_RATE),
    })
  }

  // Refunds of the month, against purchases a payout of an earlier month already carried out.
  const purchaseOfTransaction = new Map<string, RcEvent>()
  for (const event of unique) {
    if (isPaidRevenue(event) && event.transactionId) purchaseOfTransaction.set(event.transactionId, event)
  }
  const released = new Map(input.releasedPurchases.map((r) => [r.sourceEventId, r]))
  for (const refund of unique) {
    if (!isRefund(refund)) continue
    const at = refund.occurredAt ?? refund.purchasedAt
    if (!at || at < monthStart || at >= monthEnd) continue
    const purchase = purchaseOfTransaction.get(refund.transactionId as string)
    const paid = purchase ? released.get(purchase.eventId) : undefined
    if (!purchase || !paid || !byClient.has(paid.clientId)) continue
    push(paid.clientId, {
      kind: 'refund_offset',
      source_event_id: refund.eventId,
      offsets_event_id: purchase.eventId,
      carried_from_payout_id: null,
      occurred_at: at,
      product_id: purchase.productId || null,
      store: purchase.store || null,
      currency: purchase.currency || null,
      gross_amount_cents: -Math.round(purchase.priceLocal * 100),
      base_cents: -paid.baseCents,
      commission_cents: -paid.commissionCents,
    })
  }

  for (const carry of input.carries) {
    if (!byClient.has(carry.clientId) || !(carry.amountCents < 0)) continue
    push(carry.clientId, {
      kind: 'carry_over',
      source_event_id: null,
      offsets_event_id: null,
      carried_from_payout_id: carry.payoutId,
      occurred_at: null,
      product_id: null,
      store: null,
      currency: null,
      gross_amount_cents: null,
      base_cents: 0,
      commission_cents: carry.amountCents,
    })
  }

  const statement: StatementLine[] = []
  for (const client of input.clients) {
    const own = items.get(client.clientId) ?? []
    const active = client.windows.some((w) => w.from < monthEnd && w.to > monthStart)
    if (!own.length && !active) continue
    statement.push({ client_id: client.clientId, acceptance_id: client.acceptanceId, items: own })
  }

  return { statement, missingRates: Array.from(missing).sort(), unattributed }
}

/** The closed month before `today` (`YYYY-MM-DD`, São Paulo), as `YYYY-MM-01`. */
export function previousPeriod(today: string): string {
  const y = Number(today.slice(0, 4))
  const m = Number(today.slice(5, 7))
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`
}

/** Pay-out statuses, in the order the screen sorts them (spec §2: Falhou, A liberar, Enviado, Pago). */
export const PAYOUT_STATUS_ORDER = ['failed', 'calculated', 'released', 'sent', 'paid', 'cancelled'] as const
export type PayoutStatus = (typeof PAYOUT_STATUS_ORDER)[number]

/** One payout row of the screen (admin only sees the statement; the partner never does — B2). */
export interface PayoutRow {
  id: string
  clientId: string
  acceptanceId: string
  placeName: string
  taxId: string | null
  status: PayoutStatus
  amountCents: number
  purchases: number
  /** Sum of the negative items (refund offsets and carried balance). ≤ 0. */
  discountsCents: number
  pixKey: string | null
  partnerInvoiceNumber: string | null
  failReason: string | null
  paidAt: string | null
  /** A later month already carried this negative balance: it is locked. */
  carried: boolean
  items: {
    kind: StatementItem['kind']
    occurredAt: string | null
    productId: string | null
    currency: string | null
    grossAmountCents: number | null
    baseCents: number
    commissionCents: number
  }[]
}

/**
 * What the action cell of one row shows (spec §4, decisions 2 and 10 of the Tech Lead): only an
 * admin releases, only a `calculated` or `failed` row with a confirmed key and a positive value,
 * and the partner's invoice never blocks.
 */
export type PayoutAction =
  | { kind: 'release' }
  | { kind: 'resend' }
  | { kind: 'no_pix_key' }
  | { kind: 'no_value'; amountCents: number }
  | { kind: 'admin_only' }
  | { kind: 'none' }

export function payoutAction(row: Pick<PayoutRow, 'status' | 'amountCents' | 'pixKey' | 'carried'>, viewerIsAdmin: boolean): PayoutAction {
  if (row.status !== 'calculated' && row.status !== 'failed') return { kind: 'none' }
  if (row.amountCents <= 0 || row.carried) return { kind: 'no_value', amountCents: row.amountCents }
  if (!row.pixKey) return { kind: 'no_pix_key' }
  if (!viewerIsAdmin) return { kind: 'admin_only' }
  return row.status === 'failed' ? { kind: 'resend' } : { kind: 'release' }
}

export function sortPayoutRows<T extends Pick<PayoutRow, 'status' | 'placeName'>>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      PAYOUT_STATUS_ORDER.indexOf(a.status) - PAYOUT_STATUS_ORDER.indexOf(b.status) ||
      a.placeName.localeCompare(b.placeName)
  )
}

/** Weekdays from `today` (exclusive) to `deadline` (inclusive); holidays unknown, as in `partner.last_business_day`. */
export function businessDaysUntil(today: string, deadline: string): number {
  let count = 0
  const end = Date.parse(`${deadline}T12:00:00Z`)
  for (let t = Date.parse(`${today}T12:00:00Z`) + 86_400_000; t <= end; t += 86_400_000) {
    const day = new Date(t).getUTCDay()
    if (day !== 0 && day !== 6) count += 1
  }
  return count
}

/** Statuses still owed money after the deadline (spec §2: "Atrasado:"). */
export function isUnpaidAfter(rows: readonly Pick<PayoutRow, 'status' | 'amountCents'>[]): boolean {
  return rows.some((row) => row.amountCents > 0 && ['calculated', 'released', 'sent', 'failed'].includes(row.status))
}
