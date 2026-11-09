/**
 * #1156 (spec-cms-relatorio-engajamento-2026-11 §D2 to §D4, criterion §D8 items 1 to 3): "consumed 1
 * hour" as the fifth step of the use funnel, "saw the paywall" under the purchase funnel's branches,
 * and the free minutes histogram under the use funnel, mounted with the report's fixtures.
 *
 * Run with: npx playwright test -c playwright-ct.config.ts engagement-1156
 * Set ENGAGEMENT_SHOTS=<dir> to also write the 1440 and 390 captures.
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { EngagementHarness as Screen } from './engagement-helpers'
import { BANK, CONVERSION, FREE_MINUTES, GA4, MONTHS, TODAY } from './engagement-fixtures'
import { CHART_COLORS } from '@/lib/constants/chart-colors'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import ptMessages from '@/messages/pt.json'

const E = ptMessages.Pages.Dashboard.reports.engagement
const S = E.summary
const U = S.use_funnel
const P = S.purchase_funnel
const FM = S.free_minutes
const SHOTS = process.env.ENGAGEMENT_SHOTS

const full = (extra: Record<string, unknown> = {}) => <Screen months={MONTHS} today={TODAY} bank={BANK} ga4={GA4} conversion={CONVERSION} freeMinutes={FREE_MINUTES} {...extra} />
const box = (page: Page, id: string) => page.getByTestId(id).evaluate((e) => { const r = e.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), width: r.width } })
const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`

test('#1156 spec D8 item 1 DS-COMPONENTE-101 item 2: Consumed 1 hour is the fifth band, blue, its rate over entered, wider than the step above when it is larger', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1400 })
  const c = await mount(full())
  const step = page.getByTestId('funnel-step-consumed_1h')
  await expect(step).toContainText(U.consumed_1h)
  // 90 of the 320 who entered: 28 %, never 90 / 250
  await expect(step).toContainText(U.of_entered.replace('{pct}', '28%'))
  await expect(page.getByTestId('funnel-band-consumed_1h')).toHaveCSS('background-color', rgb(CHART_COLORS.blue))
  await expect(step.getByText(U.consumed_1h, { exact: true }).first()).toHaveAttribute('title', U.consumed_1h_hint)
  await c.update(full({ conversion: { ...CONVERSION, usedGuideOrStory: 100, consumed1h: 200 } }))
  await expect(step).toContainText(U.of_entered.replace('{pct}', '63%'))
  // the bands ease their width for 300 ms: read once they settle
  await expect.poll(async () => (await box(page, 'funnel-band-consumed_1h')).width - (await box(page, 'funnel-band-used')).width).toBeGreaterThan(0)
})

test('#1156 spec D2 BR-COMUNICACAO-022 item 4: consumed_1h null empties the band with no source and no rate; August is a floor with its sign', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1400 })
  const c = await mount(full({ conversion: { ...CONVERSION, consumed1h: null } }))
  const step = page.getByTestId('funnel-step-consumed_1h')
  await expect(page.getByTestId('funnel-band-consumed_1h')).toHaveCount(0)
  await expect(step).toContainText(S.tiles.no_source_bank)
  await expect(step).toContainText(UNKNOWN_VALUE)
  await expect(step).not.toContainText('%')
  await c.update(full({ month: '2026-08', conversion: { ...CONVERSION, month: '2026-08', consumed1h: 40 } }))
  await expect(step).toContainText('≥ 40')
})

test('#1156 spec D8 item 2 DS-COMPONENTE-084 item 2: Saw the paywall sits under the branches with the GA4 badge and no percent anywhere; null prints the dash with its reason', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1400 })
  const c = await mount(full())
  const line = page.getByTestId('purchase-paywall')
  await expect(line).toContainText(P.paywall_viewed)
  await expect(line).toContainText(P.paywall_viewed_sub)
  await expect(page.getByTestId('purchase-paywall-value')).toHaveText('96')
  await expect(line).toContainText(E.ga4_badge)
  await expect(line).not.toContainText('%')
  const branches = await page.getByTestId('summary-purchase-funnel').getByTestId('purchase-branch-untested').evaluate((e) => e.getBoundingClientRect().bottom)
  expect((await box(page, 'purchase-paywall')).top).toBeGreaterThanOrEqual(Math.floor(branches))
  // August: GA4 did not collect the event yet
  await c.update(full({ month: '2026-08', conversion: { ...CONVERSION, month: '2026-08' } }))
  await expect(page.getByTestId('purchase-paywall-value')).toHaveText(UNKNOWN_VALUE)
  await expect(page.getByTestId('purchase-paywall-value')).toHaveAttribute('title', S.tiles.no_source_ga4)
  await c.update(full({ ga4: undefined, ga4Failed: true }))
  await expect(page.getByTestId('purchase-paywall-value')).toHaveAttribute('title', E.cell_ga4_failed)
})

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

test('#1156 spec D8 item 3 at 1440: the histogram is under the use funnel in the left column, the purchase funnel keeps id conversion on the right', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1400 })
  await mount(full())
  const use = await box(page, 'summary-use-funnel')
  const hist = await box(page, 'summary-free-histogram')
  const purchase = await box(page, 'summary-purchase-funnel')
  expect(hist.left).toBe(use.left)
  expect(hist.top).toBeGreaterThan(use.top)
  expect(purchase.left).toBeGreaterThan(use.left)
  expect(purchase.top).toBe(use.top)
  await expect(page.getByTestId('summary-purchase-funnel')).toHaveAttribute('id', 'conversion')
})

for (const width of [1440, 390]) {
  test(`#1156 spec D8 at ${width}: nothing scrolls sideways, axe finds nothing in the summary`, async ({ mount, page }) => {
    await page.setViewportSize({ width, height: 1400 })
    await mount(full())
    await expect(page.getByTestId('purchase-paywall-value')).toHaveText('96')
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
