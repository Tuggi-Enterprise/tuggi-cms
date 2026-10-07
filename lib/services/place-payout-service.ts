/**
 * The 10 % payout of the Com história place — reads and writes of the CMS (#903).
 *
 * Every write is a `partner.*_place_payout*` function of #900 (`places-pagamento.md` §3.5), called
 * with the service role; the functions do not gate (B1), so every route that calls this module
 * carries the admin gate. Money never leaves from here: the release goes to the `places-payout`
 * Edge Function, which owns the Asaas client (`releaseThroughEdge`).
 *
 * `null` = read refused, never an empty list: before migration `20261007160000` the tables do not
 * exist, and "nothing to pay" by error is the worst thing this screen could say.
 */

import { getSupabaseService } from '@/lib/core/supabase-client'
import { loadFxRates, loadRcEvents } from '@/lib/services/finance-service'
import {
  buildPayoutStatement,
  type NegativeCarry,
  type PaidWindow,
  type PayoutClient,
  type PayoutRow,
  type PayoutStatement,
  type PayoutStatus,
  type ReleasedPurchase,
} from '@/lib/finance/payouts'

type Row = Record<string, any>
const partner = () => getSupabaseService().schema('partner')

const LEFT_CALCULATED = ['released', 'sent', 'paid', 'failed']

function chunk<T>(ids: T[], size = 100): T[][] {
  const out: T[][] = []
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size))
  return out
}

/** The Com história acceptances of each client, with the windows in which the plan was paid or free. */
async function loadPayoutClients(): Promise<PayoutClient[] | null> {
  const accs = await partner()
    .from('place_acceptances')
    .select('id, client_id, accepted_at, place_submissions(attraction_id)')
    .eq('plan_choice', 'map_and_description')
    .limit(5000)
  if (accs.error) return null
  const acceptances = (accs.data ?? []) as Row[]
  if (!acceptances.length) return []

  const accIds = acceptances.map((a) => String(a.id))
  const attractionIds = acceptances
    .map((a) => (Array.isArray(a.place_submissions) ? a.place_submissions[0] : a.place_submissions)?.attraction_id)
    .filter((id): id is string => typeof id === 'string')

  const poiClient = new Map<string, string | null>()
  for (const batch of chunk(attractionIds)) {
    const { data, error } = await getSupabaseService().schema('core').from('attractions').select('id, partner_client_id').in('id', batch)
    if (error) return null
    for (const r of (data ?? []) as Row[]) poiClient.set(String(r.id), r.partner_client_id ?? null)
  }

  const keys = new Set<string>()
  const subsByAcc = new Map<string, Row>()
  const chargesBySub = new Map<string, Row[]>()
  for (const batch of chunk(accIds)) {
    const [k, s] = await Promise.all([
      partner().from('place_payout_pix_keys').select('acceptance_id').in('acceptance_id', batch),
      partner().from('place_subscriptions').select('id, acceptance_id, canceled_at').in('acceptance_id', batch),
    ])
    if (k.error || s.error) return null
    for (const r of (k.data ?? []) as Row[]) keys.add(String(r.acceptance_id))
    for (const r of (s.data ?? []) as Row[]) subsByAcc.set(String(r.acceptance_id), r)
  }
  const subIds = Array.from(subsByAcc.values()).map((s) => String(s.id))
  for (const batch of chunk(subIds)) {
    const { data, error } = await partner()
      .from('place_subscription_charges')
      .select('subscription_id, status, period_start, period_end')
      .in('subscription_id', batch)
      .eq('status', 'paid')
    if (error) return null
    for (const r of (data ?? []) as Row[]) {
      const list = chargesBySub.get(String(r.subscription_id)) ?? []
      list.push(r)
      chargesBySub.set(String(r.subscription_id), list)
    }
  }

  // The free month: `partner.place_trial_ends_at` is the one place that knows it (#898).
  const trialEnd = new Map<string, string | null>()
  for (const id of accIds) {
    const { data, error } = await partner().rpc('place_trial_ends_at', { p_acceptance_id: id })
    if (error) return null
    trialEnd.set(id, typeof data === 'string' ? new Date(data).toISOString() : null)
  }

  type Candidate = { acceptanceId: string; acceptedAt: string; hasKey: boolean }
  const candidates = new Map<string, Candidate[]>()
  const windows = new Map<string, PaidWindow[]>()
  for (const a of acceptances) {
    const id = String(a.id)
    const attractionId = (Array.isArray(a.place_submissions) ? a.place_submissions[0] : a.place_submissions)?.attraction_id
    // The same match as `partner.place_acceptance_is_client_contract`: the link acceptance carries
    // the client; the portal one reaches it through the published POI.
    const clients = new Set<string>(
      [a.client_id, attractionId ? poiClient.get(attractionId) : null].filter((c): c is string => typeof c === 'string')
    )
    const own: PaidWindow[] = []
    const sub = subsByAcc.get(id)
    for (const c of sub ? chargesBySub.get(String(sub.id)) ?? [] : []) {
      if (c.period_start && c.period_end) {
        own.push({ from: new Date(c.period_start).toISOString(), to: new Date(c.period_end).toISOString() })
      }
    }
    const trial = trialEnd.get(id)
    if (trial && a.accepted_at) {
      const canceled = sub?.canceled_at ? new Date(sub.canceled_at).toISOString() : null
      const to = canceled && canceled < trial ? canceled : trial
      const from = new Date(a.accepted_at).toISOString()
      if (to > from) own.push({ from, to })
    }
    for (const clientId of clients) {
      const list = candidates.get(clientId) ?? []
      list.push({ acceptanceId: id, acceptedAt: String(a.accepted_at ?? ''), hasKey: keys.has(id) })
      candidates.set(clientId, list)
      windows.set(clientId, [...(windows.get(clientId) ?? []), ...own])
    }
  }

  // The contract the payout is paid under: the one with a Pix key, then the latest (the `data`'s
  // query of #903, which mirrors `place_acceptance_is_client_contract`).
  return Array.from(candidates.entries()).map(([clientId, list]) => {
    const best = [...list].sort((x, y) => Number(y.hasKey) - Number(x.hasKey) || y.acceptedAt.localeCompare(x.acceptedAt))[0]
    return { clientId, acceptanceId: best.acceptanceId, windows: windows.get(clientId) ?? [] }
  })
}

export type PayoutInputs = {
  statement: PayoutStatement
  /** `place_payout_periods.calculated_at` was empty: this run is the month's first calculation. */
  firstCalculation: boolean
  /** Clients left out because their payout of the month is locked (left `calculated`, or carried). */
  locked: number
}

/** Everything `record_place_payout_period` needs for `periodMonth`, already as the statement. */
export async function preparePayoutPeriod(periodMonth: string): Promise<PayoutInputs | null> {
  const [clients, events, rates, period, payouts, carryItems] = await Promise.all([
    loadPayoutClients(),
    loadRcEvents(20000),
    loadFxRates(),
    partner().from('place_payout_periods').select('calculated_at').eq('period_month', periodMonth).maybeSingle(),
    partner().from('place_payouts').select('id, client_id, period_month, status, amount_cents').lte('period_month', periodMonth).neq('status', 'cancelled').limit(20000),
    partner()
      .from('place_payout_items')
      .select('carried_from_payout_id, place_payouts!place_payout_items_payout_id_fkey(period_month)')
      .eq('kind', 'carry_over')
      .is('voided_at', null)
      .limit(20000),
  ])
  if (!clients || !events || !rates || period.error || payouts.error || carryItems.error) return null

  const allPayouts = (payouts.data ?? []) as Row[]
  // A payout carried by ANOTHER month is locked; the carry of this month is redone by the recalculation.
  const carriedElsewhere = new Set<string>()
  for (const r of (carryItems.data ?? []) as Row[]) {
    const by = Array.isArray(r.place_payouts) ? r.place_payouts[0] : r.place_payouts
    if (String(by?.period_month ?? '').slice(0, 10) !== periodMonth) carriedElsewhere.add(String(r.carried_from_payout_id))
  }

  const lockedClients = new Set(
    allPayouts
      .filter((p) => String(p.period_month).slice(0, 10) === periodMonth && (p.status !== 'calculated' || carriedElsewhere.has(String(p.id))))
      .map((p) => String(p.client_id))
  )
  const carries: NegativeCarry[] = allPayouts
    .filter(
      (p) =>
        String(p.period_month).slice(0, 10) < periodMonth &&
        p.status === 'calculated' &&
        Number(p.amount_cents) < 0 &&
        !carriedElsewhere.has(String(p.id))
    )
    .map((p) => ({ payoutId: String(p.id), clientId: String(p.client_id), amountCents: Number(p.amount_cents) }))

  const earlierReleased = allPayouts
    .filter((p) => String(p.period_month).slice(0, 10) < periodMonth && LEFT_CALCULATED.includes(p.status))
  const clientOfPayout = new Map(earlierReleased.map((p) => [String(p.id), String(p.client_id)]))
  const releasedPurchases: ReleasedPurchase[] = []
  for (const batch of chunk(Array.from(clientOfPayout.keys()))) {
    const { data, error } = await partner()
      .from('place_payout_items')
      .select('payout_id, source_event_id, base_cents, commission_cents')
      .in('payout_id', batch)
      .eq('kind', 'purchase')
      .is('voided_at', null)
    if (error) return null
    for (const r of (data ?? []) as Row[]) {
      releasedPurchases.push({
        sourceEventId: String(r.source_event_id),
        clientId: clientOfPayout.get(String(r.payout_id)) as string,
        baseCents: Number(r.base_cents),
        commissionCents: Number(r.commission_cents),
      })
    }
  }

  const statement = buildPayoutStatement({
    periodMonth,
    events,
    clients: clients.filter((c) => !lockedClients.has(c.clientId)),
    rates,
    releasedPurchases,
    carries,
  })
  return { statement, firstCalculation: !period.data?.calculated_at, locked: lockedClients.size }
}

export type RecordOutcome =
  | { ok: true; payouts: { payoutId: string; clientId: string; amountCents: number; status: string }[] }
  | { ok: false; code: string | null; detail: string | null }

export async function recordPayoutPeriod(periodMonth: string, calculatedBy: string | null, statement: PayoutStatement['statement']): Promise<RecordOutcome> {
  const { data, error } = await partner().rpc('record_place_payout_period', {
    p_period_month: periodMonth,
    p_calculated_by: calculatedBy,
    p_statement: statement,
  })
  if (error) return { ok: false, code: error.code ?? null, detail: typeof error.details === 'string' ? error.details.slice(0, 64) : null }
  return {
    ok: true,
    payouts: ((data ?? []) as Row[]).map((r) => ({
      payoutId: String(r.payout_id),
      clientId: String(r.client_id),
      amountCents: Number(r.amount_cents),
      status: String(r.status),
    })),
  }
}

export type PayoutMonth = {
  periodMonth: string
  calculatedAt: string | null
  /** Last business day of the month after the period (term 5.4 deadline), `partner.last_business_day`. */
  payDeadline: string | null
  rows: PayoutRow[]
}

const nextPeriod = (p: string) =>
  p.slice(5, 7) === '12' ? `${Number(p.slice(0, 4)) + 1}-01-01` : `${p.slice(0, 4)}-${String(Number(p.slice(5, 7)) + 1).padStart(2, '0')}-01`

/** The screen of one month: every payout with its statement (admin and editor read; B2 is the partner). */
export async function loadPayoutMonth(periodMonth: string): Promise<PayoutMonth | null> {
  const [period, payouts, deadline] = await Promise.all([
    partner().from('place_payout_periods').select('calculated_at').eq('period_month', periodMonth).maybeSingle(),
    partner()
      .from('place_payouts')
      .select('id, client_id, acceptance_id, status, amount_cents, fail_reason, paid_at, partner_invoice_number, cancel_reason')
      .eq('period_month', periodMonth)
      .limit(2000),
    partner().rpc('last_business_day', { p_day: nextPeriod(periodMonth) }),
  ])
  if (period.error || payouts.error) return null
  const list = ((payouts.data ?? []) as Row[]).filter((p) => !(p.status === 'cancelled' && p.cancel_reason === 'recalculated'))
  const ids = list.map((p) => String(p.id))
  const accIds = Array.from(new Set(list.map((p) => String(p.acceptance_id))))

  const items = new Map<string, Row[]>()
  const carried = new Set<string>()
  const accs = new Map<string, Row>()
  const keys = new Map<string, string>()
  for (const batch of chunk(ids)) {
    const [it, cr] = await Promise.all([
      partner()
        .from('place_payout_items')
        .select('payout_id, kind, occurred_at, product_id, currency, gross_amount_cents, base_cents, commission_cents')
        .in('payout_id', batch)
        .is('voided_at', null)
        .order('occurred_at', { ascending: true, nullsFirst: false }),
      partner().from('place_payout_items').select('carried_from_payout_id').in('carried_from_payout_id', batch).is('voided_at', null),
    ])
    if (it.error || cr.error) return null
    for (const r of (it.data ?? []) as Row[]) items.set(String(r.payout_id), [...(items.get(String(r.payout_id)) ?? []), r])
    for (const r of (cr.data ?? []) as Row[]) carried.add(String(r.carried_from_payout_id))
  }
  for (const batch of chunk(accIds)) {
    const [a, k] = await Promise.all([
      partner().from('place_acceptances').select('id, legal_name, tax_id_normalized, place_submissions(attraction_id)').in('id', batch),
      partner().from('place_payout_pix_keys').select('acceptance_id, pix_key').in('acceptance_id', batch),
    ])
    if (a.error || k.error) return null
    for (const r of (a.data ?? []) as Row[]) accs.set(String(r.id), r)
    for (const r of (k.data ?? []) as Row[]) keys.set(String(r.acceptance_id), String(r.pix_key))
  }
  const attractionOf = (acc: Row | undefined) =>
    (Array.isArray(acc?.place_submissions) ? acc?.place_submissions[0] : acc?.place_submissions)?.attraction_id ?? null
  const poiIds = Array.from(accs.values()).map(attractionOf).filter((id): id is string => typeof id === 'string')
  const names = new Map<string, string>()
  for (const batch of chunk(poiIds)) {
    const { data } = await getSupabaseService().schema('core').from('attractions').select('id, name').in('id', batch)
    for (const r of (data ?? []) as Row[]) names.set(String(r.id), String(r.name))
  }

  const rows: PayoutRow[] = list.map((p) => {
    const acc = accs.get(String(p.acceptance_id))
    const own = items.get(String(p.id)) ?? []
    const poi = attractionOf(acc)
    return {
      id: String(p.id),
      clientId: String(p.client_id),
      acceptanceId: String(p.acceptance_id),
      placeName: (poi && names.get(poi)) || String(acc?.legal_name ?? p.client_id),
      taxId: acc?.tax_id_normalized ?? null,
      status: p.status as PayoutStatus,
      amountCents: Number(p.amount_cents),
      purchases: own.filter((i) => i.kind === 'purchase').length,
      discountsCents: own.filter((i) => i.kind !== 'purchase').reduce((sum, i) => sum + Number(i.commission_cents), 0),
      pixKey: keys.get(String(p.acceptance_id)) ?? null,
      partnerInvoiceNumber: p.partner_invoice_number ?? null,
      failReason: p.fail_reason ?? null,
      paidAt: p.paid_at ?? null,
      carried: carried.has(String(p.id)),
      items: own.map((i) => ({
        kind: i.kind,
        occurredAt: i.occurred_at ?? null,
        productId: i.product_id ?? null,
        currency: i.currency ?? null,
        grossAmountCents: typeof i.gross_amount_cents === 'number' ? i.gross_amount_cents : null,
        baseCents: Number(i.base_cents),
        commissionCents: Number(i.commission_cents),
      })),
    }
  })
  return {
    periodMonth,
    calculatedAt: period.data?.calculated_at ?? null,
    payDeadline: deadline.error ? null : String(deadline.data ?? '').slice(0, 10) || null,
    rows,
  }
}

/** Status and amount of one payout, for the release check. `null` = read refused; `undefined` = no such payout. */
export async function loadPayoutForRelease(payoutId: string): Promise<{ status: string; amountCents: number } | null | undefined> {
  const { data, error } = await partner().from('place_payouts').select('status, amount_cents').eq('id', payoutId).maybeSingle()
  if (error) return null
  return data ? { status: String(data.status), amountCents: Number(data.amount_cents) } : undefined
}

/** `partner.record_place_payout_partner_invoice`: the number of the invoice the place issued (optional, decision 10). */
export async function recordPartnerInvoice(payoutId: string, number: string): Promise<{ ok: boolean; code: string | null }> {
  const { error } = await partner().rpc('record_place_payout_partner_invoice', { p_payout_id: payoutId, p_number: number, p_file_path: null })
  return { ok: !error, code: error?.code ?? null }
}

export const PAYOUT_FUNCTION = 'places-payout'

/**
 * Calls the `places-payout` Edge Function with the CMS's own secret key (the `requireAdmin` machine
 * bypass; the function is deployed with `--no-verify-jwt`). The admin gate is the caller's.
 */
export async function callPayoutEdge(
  body: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch
): Promise<{ status: number; body: Record<string, unknown> }> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key) return { status: 503, body: { error: 'unavailable' } }
  try {
    const res = await fetchImpl(`${base}/functions/v1/${PAYOUT_FUNCTION}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    })
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    return { status: res.status, body: json }
  } catch {
    // Timeout: the transfer may have left. The row stays `released` and the pending item tells.
    return { status: 504, body: { error: 'timeout' } }
  }
}

export type CloseReply = { status: number; body: Record<string, unknown> }

/**
 * Closes (or recalculates) one month: statement → `record_place_payout_period` → on the month's
 * FIRST calculation only, the zero / negative e-mails (`places-payout` `period_closed`, decision 6;
 * the first calculation is the once-guard, so a recalculation never e-mails again).
 *
 * `skipIfCalculated` is the job's mode: a month already calculated is left alone (the admin's
 * "Apurar" recalculates on purpose). A currency without a declared BRL rate refuses the whole month
 * (422): paying a purchase as zero would be a debt that disappears.
 */
export async function closePayoutPeriod(
  periodMonth: string,
  calculatedBy: string | null,
  opts: { skipIfCalculated: boolean }
): Promise<CloseReply> {
  const prepared = await preparePayoutPeriod(periodMonth)
  if (!prepared) return { status: 503, body: { error: 'payouts_unavailable' } }
  if (opts.skipIfCalculated && !prepared.firstCalculation) return { status: 200, body: { result: 'already_calculated', period: periodMonth } }
  if (prepared.statement.missingRates.length) {
    return { status: 422, body: { error: 'missing_fx_rate', currencies: prepared.statement.missingRates } }
  }

  const recorded = await recordPayoutPeriod(periodMonth, calculatedBy, prepared.statement.statement)
  if (!recorded.ok) {
    if (recorded.code === 'TGP10') return { status: 409, body: { error: 'locked', client_id: recorded.detail } }
    if (recorded.code === 'TGP22') return { status: 422, body: { error: 'invalid', field: recorded.detail } }
    return { status: 503, body: { error: 'payouts_unavailable' } }
  }

  let emails: unknown = 'not_first'
  if (prepared.firstCalculation) {
    const sent = await callPayoutEdge({ action: 'period_closed', period_month: periodMonth })
    emails = sent.status === 200 ? sent.body : `failed_${sent.status}`
    if (sent.status !== 200) console.error('[payouts] period_closed e-mails failed', periodMonth, sent.status)
  }
  // Purchases attributed to a partner with no Com história contract (the CMS-only clients, #905;
  // or a profile pointing to a client that does not exist). Counted, never paid.
  if (prepared.statement.unattributed) console.warn('[payouts] purchases without a Com história contract', periodMonth, prepared.statement.unattributed)

  return {
    status: 200,
    body: {
      result: 'calculated',
      period: periodMonth,
      payouts: recorded.payouts.length,
      totalCents: recorded.payouts.reduce((sum, p) => sum + Math.max(0, p.amountCents), 0),
      locked: prepared.locked,
      unattributed: prepared.statement.unattributed,
      emails,
    },
  }
}
