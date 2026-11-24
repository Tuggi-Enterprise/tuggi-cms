/**
 * The push report (#1070, BR-COMUNICACAO-022), mounted with a fixture report: "Aceito" replaces the
 * received column, the week table sums by Monday in Sao Paulo days, and time to open prints "sem
 * dado" where the database sends nothing.
 *
 * Run with: npx playwright test -c playwright-ct.config.ts push-report
 * Set PUSH_REPORT_SHOTS=<dir> to also write the 1440 and 390 captures.
 */

import { test, expect } from '@playwright/experimental-ct-react'
import path from 'path'
import { PushReportHarness as Screen } from './push-report-helpers'
import ptMessages from '@/messages/pt.json'

const P = ptMessages.Pages.Dashboard.push
const SHOTS = process.env.PUSH_REPORT_SHOTS

const REVENUE = { opened_pushes: 0, opened_buyers: 0, opened_revenue_usd: 0, not_opened_pushes: 0, not_opened_buyers: 0, not_opened_revenue_usd: 0 }
const send = (over: Record<string, unknown>) => ({
  send_key: 'direct:hours_credited:2026-10-20', channel: 'direct', type: 'hours_credited', piece: null, day: '2026-10-20',
  title: 'x', distinct_titles: 1, first_sent_at: '2026-10-20T12:00:00Z', last_sent_at: '2026-10-20T12:00:00Z',
  sent: 10, delivered: 1, opened: 3, not_delivered: null, open_rate: 0.3, influenced_opens: null,
  action_pushes: null, action_opened_pushes: null, revenue: REVENUE, base_cost: { push_off: null, uninstalled: null },
  variants: null, median_minutes_to_open: null,
  ...over,
})
const REPORT = {
  period: { from: '2026-10-20T03:00:00Z', to: '2026-11-03T03:00:00Z', type: null, time_zone: 'America/Sao_Paulo' },
  windows: { action_hours: 24, revenue_days: 7, base_cost_hours: 48, sources_since: '2026-10-28T20:15:00Z' },
  devices: { active_tokens: 240, people_with_active_token: 220, uninstalls: 3, push_enabled_people: 189 },
  sends: [
    send({ send_key: 'weekly:thursday_local:2026-10-30', channel: 'weekly', type: 'weekly_thursday_local', piece: 'thursday_local', day: '2026-10-30', sent: 189, delivered: 2, opened: 21, not_delivered: 4, influenced_opens: 9, base_cost: { push_off: 1, uninstalled: 0 }, median_minutes_to_open: 185 }),
    send({ send_key: 'direct:hours_credited:2026-11-02', day: '2026-11-02', sent: 12, delivered: 0, opened: 2, not_delivered: 2, influenced_opens: 1, base_cost: { push_off: 0, uninstalled: 0 }, median_minutes_to_open: 0.4 }),
    send({ send_key: 'direct:hours_credited:2026-10-21', day: '2026-10-21', sent: 8, delivered: 1, opened: 1 }),
  ],
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/dashboard/push?**', (route) => route.fulfill({ json: { data: REPORT } }))
})

for (const width of [1440, 390]) {
  test(`#1070 BR-COMUNICACAO-022 at ${width}: Aceito, the week table and time to open`, async ({ mount, page }) => {
    await page.setViewportSize({ width, height: 1400 })
    const c = await mount(<Screen />)
    const weeks = c.getByRole('region', { name: P.weeks.title })
    await expect(weeks.getByRole('row')).toHaveCount(4)

    // Week of 2026-10-26: weekly 189 accepted as sent; week of 2026-11-02: 12 - 2.
    const rowOf = (date: string) => weeks.getByRole('row').filter({ hasText: date })
    await expect(rowOf('02/11/2026')).toContainText('10')
    await expect(rowOf('26/10/2026')).toContainText('189')
    // Week of 2026-10-19: one old direct send without not_delivered, Aceito is sem dado.
    await expect(rowOf('19/10/2026').getByTitle(P.no_data).first()).toBeVisible()

    const sends = c.getByRole('region', { name: P.sends.title })
    await expect(sends.getByRole('columnheader', { name: P.funnel.accepted })).toBeVisible()
    await expect(sends.getByRole('columnheader', { name: P.sends.time_to_open })).toBeVisible()
    await expect(c.getByText('Recebidos', { exact: true })).toHaveCount(0)
    await expect(sends).toContainText('3 h 05 min')
    await expect(sends).toContainText('< 1 min')

    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `push-report-${width}.png`), fullPage: true })
  })
}
