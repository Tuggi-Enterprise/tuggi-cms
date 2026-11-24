/**
 * The Revenue page (#1157, spec-cms-relatorio-engajamento-2026-11 §D6, criterion §D8 item 4), mounted
 * with a fixture: the page needs a CMS session this bench does not have.
 *
 * Run with: npx playwright test -c playwright-ct.config.ts revenue-1157
 * Set ENGAGEMENT_SHOTS=<dir> to also write the 1440 and 390 captures.
 */

import { test, expect } from '@playwright/experimental-ct-react'
import AxeBuilder from '@axe-core/playwright'
import { RevenueHarness as Screen } from './revenue-helpers'
import { REV_MONTHS, REV_TODAY, REVENUE, REVENUE_NO_REFUNDS } from './revenue-fixtures'
import { CHART_COLORS } from '@/lib/constants/chart-colors'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import ptMessages from '@/messages/pt.json'

const R = ptMessages.Pages.Dashboard.reports.revenue
const NO_SOURCE = ptMessages.Pages.Dashboard.reports.engagement.summary.tiles.no_source_bank
const SHOTS = process.env.ENGAGEMENT_SHOTS
const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`
const full = (extra: Record<string, unknown> = {}) => <Screen months={REV_MONTHS} today={REV_TODAY} month="2026-10" report={REVENUE} {...extra} />

test('#1157 spec D8 item 4: four tiles of the month, gross revenue in US$, purchases, ticket and refunds as a floor with the amount', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 })
  await mount(full())
  await expect(page.getByTestId('revenue-month-label')).toHaveText(R.month_label.replace('{month}', 'outubro de 2026'))
  await expect(page.getByTestId('revenue-tile-revenue')).toContainText('US$ 284,69')
  await expect(page.getByTestId('revenue-tile-purchases')).toContainText('31')
  await expect(page.getByTestId('revenue-tile-avg_ticket')).toContainText('US$ 9,18')
  await expect(page.getByTestId('revenue-tile-refunds')).toContainText('≥ 6')
  await expect(page.getByTestId('revenue-tile-refunds')).toContainText('US$ 29,94')
  await expect(page.getByTestId('revenue-tile-revenue')).toHaveAttribute('title', R.revenue_usd_hint)
  await expect(page.getByTestId('revenue-note')).toHaveText(R.gross_note)
})

test('#1157 spec D8 item 4 BR-COMUNICACAO-022 item 4: refunds null prints the dash and says the database does not record them, never 0', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 })
  await mount(full({ report: REVENUE_NO_REFUNDS }))
  const tile = page.getByTestId('revenue-tile-refunds')
  await expect(tile).toContainText(UNKNOWN_VALUE)
  await expect(tile).toContainText(R.refunds_no_data)
  await expect(tile).not.toContainText(/\b0\b/)
})

test('#1157 spec D6: one column per month with a colour per product, a month outside the table is a dash, by product with its share, by currency without bars', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 })
  await mount(full())
  const oct = page.getByTestId('revenue-columns-col-2026-10')
  await expect(oct.locator('[title^="10 horas"]')).toHaveCSS('background-color', rgb(CHART_COLORS.blue))
  await expect(oct.locator('[title^="25 horas"]')).toHaveCSS('background-color', rgb(CHART_COLORS.purple))
  await expect(oct.locator('[title^="Assinatura mensal"]')).toHaveCSS('background-color', rgb(CHART_COLORS.green))
  // the hidden 45 h product is drawn as the neutral rest, never left out of the column
  await expect(oct.locator(`[title="${R.suppressed}"]`)).toHaveCount(1)
  await expect(page.getByTestId('revenue-columns-col-2026-07')).toContainText(UNKNOWN_VALUE)
  await expect(page.getByTestId('revenue-columns-col-2026-07').locator(`[title="${NO_SOURCE}"]`)).toHaveCount(1)
  const mix = page.getByTestId('revenue-mix-row')
  await expect(mix).toHaveCount(4)
  await expect(mix.nth(0)).toContainText(R.tiers.hours_10)
  await expect(mix.nth(0)).toContainText('25%')
  await expect(mix.nth(3)).toContainText(UNKNOWN_VALUE)
  const cur = page.getByTestId('revenue-currency')
  await expect(cur.getByTestId('revenue-currency-row')).toHaveCount(3)
  await expect(cur).toContainText('EUR')
  await expect(cur.locator('[class*="rounded-full"]')).toHaveCount(0)
})

test('#1157 spec D6 states: not deployed prints dashes with no source, a failure offers retry and no zero, a measured month with no purchase says so', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 })
  const c = await mount(full({ report: null }))
  await expect(page.getByTestId('revenue-tile-revenue')).toContainText(UNKNOWN_VALUE)
  await expect(page.getByTestId('revenue-tile-revenue')).toHaveAttribute('title', NO_SOURCE)
  await c.update(full({ report: undefined, failed: true }))
  await expect(page.getByText(R.failed)).toBeVisible()
  await expect(page.getByTestId('revenue-tile-revenue')).toHaveCount(0)
  await c.update(full({ month: '2026-11' }))
  await expect(page.getByTestId('revenue-empty')).toHaveText(R.empty)
  await expect(page.getByTestId('revenue-tile-purchases')).toContainText('0')
  await expect(page.getByTestId('revenue-month-label')).toContainText(R.until_today)
})

for (const width of [1440, 390]) {
  test(`#1157 spec D8 at ${width}: nothing scrolls sideways outside the month columns, axe finds nothing`, async ({ mount, page }) => {
    await page.setViewportSize({ width, height: 1200 })
    await mount(full())
    await expect(page.getByTestId('revenue-tile-revenue')).toContainText('US$')
    const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(o).toBeLessThanOrEqual(1)
    const r = await new AxeBuilder({ page }).include('[data-testid="revenue-report"]').analyze()
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/revenue-${width}.png`, fullPage: true })
  })
}
