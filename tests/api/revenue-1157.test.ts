/**
 * #1157: the Revenue page (spec-cms-relatorio-engajamento-2026-11 §D6, contract banco-para-cms Parte 26
 * §4). Gross revenue by month, the parse that never turns a hidden or absent number into 0, the
 * product names, the window of twelve months, and the function not deployed yet as "no data".
 *
 * Run with: npm run test:api
 */

import { test, before, mock } from 'node:test'
import assert from 'node:assert/strict'

import { parseRevenueReport, readRevenueMonth, revenueMonths, revenueWindow, tierOf, TIER_COLORS, usdCents } from '../../lib/revenue/monthly'
import { CHART_COLORS, CHART_NEUTRAL } from '../../lib/constants/chart-colors'
import { resolveAccess } from '../../lib/navigation/access'

/** The example of the contract, September. */
const SEPT = {
  month: '2026-09',
  purchases: 9,
  revenue_usd: 55.91,
  revenue_by_currency: [{ currency: 'BRL', amount: 174.4 }, { currency: 'EUR', amount: null }],
  avg_ticket_usd: 6.21,
  mix: [{ tier: 'tuggi_hours_10', purchases: 6, revenue_usd: 29.94 }, { tier: 'tuggi_hours_25', purchases: null, revenue_usd: null }],
  refunds: { count: null, revenue_usd: null },
}

test('#1157 spec D6 happy path: the month reads purchases, gross revenue, ticket, currencies and products; each product is its part of the month', () => {
  const report = parseRevenueReport({ months: [SEPT] })
  const v = readRevenueMonth(report, '2026-09')
  assert.equal(v.month?.purchases, 9)
  assert.equal(v.month?.revenueUsd, 55.91)
  assert.equal(v.month?.avgTicketUsd, 6.21)
  assert.deepEqual(v.month?.byCurrency, [{ currency: 'BRL', amount: 174.4 }, { currency: 'EUR', amount: null }])
  assert.equal(v.mixMax, 55.91)
  assert.equal(v.mix[0].share, 29.94 / 55.91)
  assert.equal(v.mix[0].key, 'hours_10')
  assert.equal(usdCents(55.91), 5591)
})

test('#1157 spec D8 item 4 BR-COMUNICACAO-022 item 4: refunds null is "no data", never 0; a small group stays null in each key; a measured 0 stays 0', () => {
  const outside = parseRevenueReport({ months: [{ month: '2026-07', purchases: null, revenue_usd: null, revenue_by_currency: [], avg_ticket_usd: null, mix: [], refunds: null }] })
  assert.equal(outside.months[0].refunds, null)
  assert.equal(outside.months[0].purchases, null)
  assert.equal(outside.months[0].revenueUsd, null)
  const absent = parseRevenueReport({ months: [{ month: '2026-08' }] })
  assert.equal(absent.months[0].refunds, null)
  assert.equal(absent.months[0].avgTicketUsd, null)
  const small = parseRevenueReport({ months: [SEPT] }).months[0]
  assert.deepEqual(small.refunds, { count: null, revenueUsd: null })
  assert.equal(small.mix[1].purchases, null)
  assert.equal(readRevenueMonth(parseRevenueReport({ months: [SEPT] }), '2026-09').mix[1].share, null)
  const zero = parseRevenueReport({ months: [{ month: '2026-10', purchases: 0, revenue_usd: 0, revenue_by_currency: [], avg_ticket_usd: null, mix: [], refunds: { count: 0, revenue_usd: 0 } }] }).months[0]
  assert.deepEqual(zero.refunds, { count: 0, revenueUsd: 0 })
  assert.equal(zero.purchases, 0)
  assert.equal(readRevenueMonth(parseRevenueReport({ months: [] }), '2026-10').month, null)
})

test('#1157 BR-MONETIZACAO-048 BR-MONETIZACAO-072: the three passes and the subscription by product id, old day plans under one name, anything else kept as other; one colour each', () => {
  assert.equal(tierOf('tuggi_hours_10'), 'hours_10')
  assert.equal(tierOf('tuggi_hours_25'), 'hours_25')
  assert.equal(tierOf('tuggi_hours_45'), 'hours_45')
  assert.equal(tierOf('tuggi_unlimited_month'), 'monthly')
  assert.equal(tierOf('tuggi_unlimited_month:monthly'), 'monthly')
  assert.equal(tierOf('tuggi_30d'), 'legacy_days')
  assert.equal(tierOf('tuggi_24h'), 'legacy_days')
  assert.equal(tierOf('premium_annual'), 'other')
  assert.deepEqual([TIER_COLORS.hours_10, TIER_COLORS.hours_25, TIER_COLORS.hours_45, TIER_COLORS.monthly], [CHART_COLORS.blue, CHART_COLORS.purple, CHART_COLORS.orange, CHART_COLORS.green])
  assert.equal(TIER_COLORS.other, CHART_NEUTRAL)
})

test('#1157 spec D6: the window is the chosen month and the eleven before it, from the first day to the last day of the month', () => {
  assert.deepEqual(revenueWindow('2026-10'), { from: '2025-11-01', to: '2026-10-31' })
  assert.deepEqual(revenueWindow('2027-02'), { from: '2026-03-01', to: '2027-02-28' })
  const ms = revenueMonths('2026-10')
  assert.equal(ms.length, 12)
  assert.equal(ms[0], '2025-11')
  assert.equal(ms[11], '2026-10')
})

test('#1157 spec D8 item 4: the page is admin only, as every report', () => {
  assert.equal(resolveAccess('/dashboard/reports/revenue', { role: 'admin' }).kind, 'allow')
  for (const role of ['editor', 'viewer', 'client']) assert.notEqual(resolveAccess('/dashboard/reports/revenue', { role }).kind, 'allow', role)
})

// ── The function not deployed yet ───────────────────────────────────────────────────────────

let answer: { data: unknown; error: { code: string; message: string } | null }
const calls: { fn: string; args: unknown }[] = []
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let service: any

before(async () => {
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseClient: () => ({
        schema: () => ({
          rpc: async (fn: string, args: unknown) => {
            calls.push({ fn, args })
            return answer
          },
        }),
      }),
    },
  })
  service = (await import('../../lib/services/revenue-service')).revenueService
})

test('#1157 BR-COMUNICACAO-022 item 4 contract Parte 26: PGRST202 is no data, any other error a failed read, and the call asks the twelve months', async () => {
  answer = { data: null, error: { code: 'PGRST202', message: 'Could not find the function core.cms_get_revenue_monthly' } }
  assert.deepEqual(await service.get('2026-10'), { success: true, data: null })
  assert.deepEqual(calls[calls.length - 1], { fn: 'cms_get_revenue_monthly', args: { p_from: '2025-11-01', p_to: '2026-10-31' } })
  answer = { data: null, error: { code: '42501', message: 'not admin' } }
  assert.deepEqual(await service.get('2026-10'), { success: false, error: 'not admin' })
  answer = { data: { months: [SEPT] }, error: null }
  const ok = await service.get('2026-10')
  assert.equal(ok.data.months[0].revenueUsd, 55.91)
})
