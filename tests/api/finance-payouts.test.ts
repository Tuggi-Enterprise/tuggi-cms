/**
 * #903 — the month's statement of the place payout (`lib/finance/payouts.ts`) and what the action
 * cell of the screen offers. BR-B2B-044 item 6, BR-MONETIZACAO-027 items 1 and 2 (v), term 5.4.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseRcEvent, withProfilePartners, type RcEvent } from '@/lib/finance/app-revenue'
import {
  PLACE_PAYOUT_RATE,
  buildPayoutStatement,
  businessDaysUntil,
  payoutAction,
  previousPeriod,
  type PayoutClient,
} from '@/lib/finance/payouts'

const SEP = '2026-09-01'
const CLIENT = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const ACC = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PAID_SEP: PayoutClient = {
  clientId: CLIENT,
  acceptanceId: ACC,
  windows: [{ from: '2026-08-20T00:00:00.000Z', to: '2026-10-20T00:00:00.000Z' }],
}

function rc(over: Record<string, unknown> = {}): RcEvent {
  const parsed = parseRcEvent({
    full_event: {
      id: 'EV-1',
      type: 'NON_RENEWING_PURCHASE',
      price: 5.83,
      store: 'APP_STORE',
      currency: 'BRL',
      product_id: 'com.tuggi.hours.10',
      app_user_id: 'user-1',
      environment: 'PRODUCTION',
      period_type: 'NORMAL',
      takehome_percentage: 0.85,
      purchased_at_ms: Date.parse('2026-09-10T15:00:00Z'),
      event_timestamp_ms: Date.parse('2026-09-10T15:00:00Z'),
      transaction_id: 'T-1',
      subscriber_attributes: {},
      price_in_purchased_currency: 29.9,
      ...over,
    },
  })
  assert.ok(parsed)
  return parsed
}

const attributed = (events: RcEvent[], partner = CLIENT) =>
  withProfilePartners(events, new Map(events.map((e) => [e.userId, partner])))

const statementOf = (over: Partial<Parameters<typeof buildPayoutStatement>[0]> = {}) =>
  buildPayoutStatement({ periodMonth: SEP, events: [], clients: [PAID_SEP], rates: [], releasedPurchases: [], carries: [], ...over })

test('BR-MONETIZACAO-027 item 2 (v): the close credits drive.profiles.partner_id, not the RevenueCat attribute', () => {
  const event = rc({ subscriber_attributes: { partner_id: { value: OTHER, updated_at_ms: 1 } } })
  const { statement } = statementOf({
    events: withProfilePartners([event], new Map([['user-1', CLIENT]])),
    clients: [PAID_SEP, { clientId: OTHER, acceptanceId: ACC, windows: PAID_SEP.windows }],
  })
  const mine = statement.find((l) => l.client_id === CLIENT)
  const other = statement.find((l) => l.client_id === OTHER)
  assert.equal(mine?.items.length, 1)
  assert.equal(other?.items.length, 0, 'the attribute of the event never decides who is paid')
})

test('BR-B2B-044 item 6 + BR-MONETIZACAO-027 item 1: 10 % of the net the Tuggi received, in BRL', () => {
  const { statement } = statementOf({ events: attributed([rc()]) })
  const [item] = statement[0].items
  const net = Math.round(2990 * 0.85)
  assert.equal(PLACE_PAYOUT_RATE, 0.1)
  assert.equal(item.kind, 'purchase')
  assert.equal(item.base_cents, net)
  assert.equal(item.commission_cents, Math.round(net * 0.1))
  assert.equal(item.source_event_id, 'EV-1')
})

test('BR-MONETIZACAO-027 item 1: a euro purchase converts by the declared rate; without one the month is refused', () => {
  const eur = rc({ currency: 'EUR', price_in_purchased_currency: 10, takehome_percentage: 0.7 })
  const rate = { currency: 'EUR', rateToBrl: 6, effectiveFrom: '2026-01-01', source: 'test' }
  const ok = statementOf({ events: attributed([eur]), rates: [rate] })
  assert.equal(ok.statement[0].items[0].base_cents, Math.round(700 * 6))
  assert.deepEqual(ok.missingRates, [])

  const missing = statementOf({ events: attributed([eur]) })
  assert.deepEqual(missing.missingRates, ['EUR'])
  assert.equal(missing.statement[0].items.length, 0)
})

test('BR-B2B-044 item 6: a purchase outside the paid or free window (plan No mapa) earns nothing', () => {
  const before = rc({ id: 'EV-OLD', purchased_at_ms: Date.parse('2026-09-02T12:00:00Z') })
  const client: PayoutClient = { ...PAID_SEP, windows: [{ from: '2026-09-05T00:00:00.000Z', to: '2026-10-05T00:00:00.000Z' }] }
  const { statement } = statementOf({ events: attributed([before, rc()]), clients: [client] })
  assert.deepEqual(statement[0].items.map((i) => i.source_event_id), ['EV-1'])
})

test('only the purchases of the month (São Paulo) count; sandbox and trials never', () => {
  const august = rc({ id: 'EV-AUG', purchased_at_ms: Date.parse('2026-09-01T02:00:00Z') }) // 31/08 23:00 in São Paulo
  const sandbox = rc({ id: 'EV-SB', environment: 'SANDBOX' })
  const trial = rc({ id: 'EV-TR', period_type: 'TRIAL' })
  const { statement } = statementOf({ events: attributed([august, sandbox, trial, rc()]) })
  assert.deepEqual(statement[0].items.map((i) => i.source_event_id), ['EV-1'])
})

test('term 5.4: a refund of a purchase already paid is offset next month by the exact amount paid', () => {
  const purchase = rc({ id: 'EV-P', purchased_at_ms: Date.parse('2026-08-25T12:00:00Z'), transaction_id: 'T-9' })
  const refund = rc({
    id: 'EV-R',
    type: 'CANCELLATION',
    cancel_reason: 'CUSTOMER_SUPPORT',
    transaction_id: 'T-9',
    price: -5.83,
    price_in_purchased_currency: -29.9,
    purchased_at_ms: Date.parse('2026-08-25T12:00:00Z'),
    event_timestamp_ms: Date.parse('2026-09-12T12:00:00Z'),
  })
  const { statement } = statementOf({
    events: attributed([purchase, refund]),
    releasedPurchases: [{ sourceEventId: 'EV-P', clientId: CLIENT, baseCents: 2542, commissionCents: 254 }],
  })
  const [offset] = statement[0].items
  assert.equal(offset.kind, 'refund_offset')
  assert.equal(offset.offsets_event_id, 'EV-P')
  assert.equal(offset.base_cents, -2542)
  assert.equal(offset.commission_cents, -254)
})

test('a purchase refunded before its month was paid does not enter the statement', () => {
  const refund = rc({ id: 'EV-R', type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT', price_in_purchased_currency: -29.9 })
  const { statement } = statementOf({ events: attributed([rc(), refund]) })
  assert.equal(statement[0].items.length, 0)
})

test('a negative month still calculated is carried whole into the next one', () => {
  const { statement } = statementOf({ carries: [{ payoutId: 'po-aug', clientId: CLIENT, amountCents: -300 }] })
  const [carry] = statement[0].items
  assert.equal(carry.kind, 'carry_over')
  assert.equal(carry.carried_from_payout_id, 'po-aug')
  assert.equal(carry.commission_cents, -300)
})

test('term 5.4: a client on the paid plan in the month gets a line even with no purchase (zero is reported)', () => {
  const gone: PayoutClient = { clientId: OTHER, acceptanceId: ACC, windows: [{ from: '2025-01-01T00:00:00.000Z', to: '2025-02-01T00:00:00.000Z' }] }
  const { statement } = statementOf({ clients: [PAID_SEP, gone] })
  assert.deepEqual(statement.map((l) => l.client_id), [CLIENT])
  assert.deepEqual(statement[0].items, [])
})

test('a partner with no Com história contract is counted, never paid (the CMS-only clients, #905)', () => {
  const r = statementOf({ events: attributed([rc()], OTHER) })
  assert.equal(r.unattributed, 1)
  assert.equal(r.statement[0].items.length, 0)
})

test('spec §8 item 1-2 (BR-B2B-044): only an admin sees Liberar, only on a positive row with a key', () => {
  const row = { status: 'calculated' as const, amountCents: 1000, pixKey: '12345678000195', carried: false }
  assert.deepEqual(payoutAction(row, true), { kind: 'release' })
  assert.deepEqual(payoutAction(row, false), { kind: 'admin_only' })
  assert.deepEqual(payoutAction({ ...row, status: 'failed' }, true), { kind: 'resend' })
  assert.deepEqual(payoutAction({ ...row, pixKey: null }, true), { kind: 'no_pix_key' })
  assert.deepEqual(payoutAction({ ...row, amountCents: -50 }, true), { kind: 'no_value', amountCents: -50 })
  assert.deepEqual(payoutAction({ ...row, amountCents: 0 }, false), { kind: 'no_value', amountCents: 0 })
  for (const status of ['released', 'sent', 'paid', 'cancelled'] as const) {
    assert.deepEqual(payoutAction({ ...row, status }, true), { kind: 'none' })
  }
})

test('the closed month before today, and the business days left to the deadline', () => {
  assert.equal(previousPeriod('2026-10-01'), '2026-09-01')
  assert.equal(previousPeriod('2026-01-15'), '2025-12-01')
  // 2026-10-26 (Mon) → 2026-10-30 (Fri): 4 weekdays left.
  assert.equal(businessDaysUntil('2026-10-26', '2026-10-30'), 4)
  assert.equal(businessDaysUntil('2026-10-30', '2026-10-30'), 0)
})
