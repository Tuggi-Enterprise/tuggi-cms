import type { RevenueReport } from '@/lib/revenue/monthly'

/** The fixture of the Revenue CT (#1157): August to November 2026, October the chosen month. */
export const REV_TODAY = '2026-11-09'
export const REV_MONTHS = ['2026-08', '2026-09', '2026-10', '2026-11']

export const REVENUE: RevenueReport = {
  months: [
    { month: '2026-07', purchases: null, revenueUsd: null, byCurrency: [], avgTicketUsd: null, mix: [], refunds: null },
    {
      month: '2026-08', purchases: 14, revenueUsd: 92.4, avgTicketUsd: 6.6,
      byCurrency: [{ currency: 'BRL', amount: 410.6 }],
      mix: [{ tier: 'tuggi_hours_10', purchases: 10, revenueUsd: 49.9 }, { tier: 'tuggi_hours_25', purchases: null, revenueUsd: null }],
      refunds: { count: null, revenueUsd: null },
    },
    {
      month: '2026-09', purchases: 9, revenueUsd: 55.91, avgTicketUsd: 6.21,
      byCurrency: [{ currency: 'BRL', amount: 174.4 }, { currency: 'EUR', amount: null }],
      mix: [{ tier: 'tuggi_hours_10', purchases: 6, revenueUsd: 29.94 }, { tier: 'tuggi_hours_25', purchases: null, revenueUsd: null }],
      refunds: { count: null, revenueUsd: null },
    },
    {
      month: '2026-10', purchases: 31, revenueUsd: 284.69, avgTicketUsd: 9.18,
      byCurrency: [{ currency: 'BRL', amount: 980.5 }, { currency: 'EUR', amount: 61.7 }, { currency: 'USD', amount: 39.96 }],
      mix: [
        { tier: 'tuggi_hours_10', purchases: 14, revenueUsd: 69.86 },
        { tier: 'tuggi_hours_25', purchases: 8, revenueUsd: 79.92 },
        { tier: 'tuggi_unlimited_month', purchases: 6, revenueUsd: 59.94 },
        { tier: 'tuggi_hours_45', purchases: null, revenueUsd: null },
      ],
      refunds: { count: 6, revenueUsd: 29.94 },
    },
    {
      month: '2026-11', purchases: 0, revenueUsd: 0, avgTicketUsd: null, byCurrency: [], mix: [], refunds: { count: 0, revenueUsd: 0 },
    },
  ],
}

/** October with the refunds the database does not record. */
export const REVENUE_NO_REFUNDS: RevenueReport = { months: REVENUE.months.map((m) => (m.month === '2026-10' ? { ...m, refunds: null } : m)) }
