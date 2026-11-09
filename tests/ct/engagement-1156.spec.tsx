/**
 * #1156 (spec-cms-relatorio-engajamento-2026-11 §D2 to §D4, criterion §D8 items 1 to 3): "consumed 1
 * hour" as the fifth step of the use funnel, "saw the paywall" under the purchase funnel's branches,
 * and the free minutes histogram under the use funnel, mounted with the report's fixtures.
 *
 * Run with: npx playwright test -c playwright-ct.config.ts engagement-1156
 * Set ENGAGEMENT_SHOTS=<dir> to also write the 1440 and 390 captures.
 */

import { test, expect } from '@playwright/experimental-ct-react'
import AxeBuilder from '@axe-core/playwright'
import { EngagementHarness as Screen } from './engagement-helpers'
import { BANK, CONVERSION, FREE_MINUTES, GA4, MONTHS, TODAY } from './engagement-fixtures'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import ptMessages from '@/messages/pt.json'

const E = ptMessages.Pages.Dashboard.reports.engagement
const S = E.summary
const U = S.use_funnel
const FM = S.free_minutes
const SHOTS = process.env.ENGAGEMENT_SHOTS

const full = (extra: Record<string, unknown> = {}) => <Screen months={MONTHS} today={TODAY} bank={BANK} ga4={GA4} conversion={CONVERSION} freeMinutes={FREE_MINUTES} {...extra} />

test('#1156 spec D8 item 3 DS-COMPONENTE-084 item 1: six bucket rows and three marks on the borders of to_min, n in the head, a hidden bucket prints the dash and the others their share', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1400 })
  await mount(full())
  const card = page.getByTestId('summary-free-histogram')
  await expect(card.getByRole('heading', { name: FM.title })).toBeVisible()
  await expect(card.getByTestId('free-minutes-row')).toHaveCount(6)
  await expect(card.getByTestId('free-minutes-mark')).toHaveText([FM.mark_15m, FM.mark_1h, FM.mark_3h])
  await expect(card.getByTestId('free-minutes-base')).toHaveText(FM.base.replace('{n}', '320').replace('{month}', 'outubro de 2026'))
  const rows = card.getByTestId('free-minutes-row')
  await expect(rows.nth(0)).toContainText(FM.buckets.b0_15)
  await expect(rows.nth(0)).toContainText('47%')
  await expect(rows.nth(2)).toContainText(UNKNOWN_VALUE)
  await expect(rows.nth(2)).toContainText(FM.bucket_suppressed)
  await expect(rows.nth(2)).not.toContainText('%')
  await expect(rows.nth(3)).toContainText('22%')
  await expect(rows.nth(5)).toContainText(FM.buckets.b180_plus)
  // the marks sit after 15 min, 1 h and 3 h
  const order = await card.locator('[data-testid="free-minutes-rows"] > li').evaluateAll((els) => els.map((e) => (e.querySelector('[data-testid="free-minutes-mark"]')?.textContent ?? '')))
  expect(order).toEqual([FM.mark_15m, '', FM.mark_1h, '', FM.mark_3h, ''])
})

test('#1156 spec D4 states: small base says so, not deployed says no source, failure offers retry, a filter refuses it like the funnels', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1400 })
  const c = await mount(full({ freeMinutes: { ...FREE_MINUTES, base: null } }))
  const card = page.getByTestId('summary-free-histogram')
  await expect(card.getByTestId('free-minutes-small-base')).toHaveText(FM.base_suppressed.replace('{month}', 'outubro de 2026'))
  await expect(card.getByTestId('free-minutes-row')).toHaveCount(0)
  await c.update(full({ freeMinutes: null }))
  await expect(card.getByTestId('free-minutes-no-source')).toHaveText(S.tiles.no_source_bank)
  await expect(card).not.toContainText(/\b0\b/)
  await c.update(full({ freeMinutes: undefined, freeMinutesFailed: true }))
  await expect(card).toContainText(FM.failed)
  await expect(card.getByRole('button', { name: E.retry })).toBeVisible()
  await c.update(full({ filters: { source: 'partner', country: null, platform: null, account: null } }))
  await expect(card.getByTestId('free-minutes-filtered')).toContainText(U.no_filters)
})

for (const width of [1440, 390]) {
  test(`#1156 spec D8 at ${width}: nothing scrolls sideways, axe finds nothing in the summary`, async ({ mount, page }) => {
    await page.setViewportSize({ width, height: 1400 })
    await mount(full())
    await expect(page.getByTestId('free-minutes-rows')).toBeVisible()
    const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(o).toBeLessThanOrEqual(1)
    const r = await new AxeBuilder({ page }).include('[data-testid="engagement-summary"]').analyze()
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
    if (SHOTS) {
      await page.getByTestId('engagement-summary').screenshot({ path: `${SHOTS}/engagement-summary-1156-${width}.png` })
      await page.screenshot({ path: `${SHOTS}/engagement-1156-${width}-pagina.png`, fullPage: true })
    }
  })
}
