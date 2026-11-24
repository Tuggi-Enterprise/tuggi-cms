/**
 * #1166: the four fixes of the design validation of the Engagement page, mounted with the October fixture
 * of contract Parte 27 (before the split by mode, no off-screen share yet, app opens partial since 28/10).
 *
 * Run with: npx playwright test -c playwright-ct.config.ts engagement-1166
 * Set ENGAGEMENT_SHOTS=<dir> to also write the 1440 and 390 captures of the whole page.
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { EngagementHarness as Screen } from './engagement-helpers'
import { ACTIVE, BANK_RETENTION, CONVERSION, FREE_MINUTES, GA4, MONTHS, TODAY, USAGE } from './engagement-fixtures'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import ptMessages from '@/messages/pt.json'

const E = ptMessages.Pages.Dashboard.reports.engagement
const Q = E.questions
const SHOTS = process.env.ENGAGEMENT_SHOTS

const full = { months: MONTHS, today: TODAY, bank: BANK_RETENTION, ga4: GA4, conversion: CONVERSION, freeMinutes: FREE_MINUTES, usage: USAGE, active: ACTIVE, allTime: true }

const chartsDrawn = async (page: Page) => {
  for (const id of ['block-5-histogram', 'block-7-lines', 'block-8-curve', 'extra_active_bank-lines', 'extra_active_ga4-lines', 'extra-permissions-bars']) {
    await expect(page.locator(`[data-testid="${id}"] svg.recharts-surface`), id).toHaveCount(1)
  }
  await expect(page.locator('[data-testid="month-bars"] svg.recharts-surface')).toHaveCount(4)
}

test('#1166 item 1: the bank trunk of the purchase funnel is not the use funnel\'s "Entrou", its base names the slice, and the GA4 badge moves from the header to the GA4 base line', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mount(<Screen {...full} />)
  const card = page.getByTestId('question-purchase_funnel')
  const trunk = card.getByTestId('purchase-trunk')
  await expect(trunk).toContainText(Q.block_7.bank_entered)
  await expect(trunk).not.toContainText(new RegExp(`^${Q.use_funnel.step_2}\\b`))
  expect(Q.block_7.bank_entered).not.toBe(Q.use_funnel.step_2)
  await expect(card.getByTestId('purchase-bank-base')).toHaveText(Q.block_7.bank_base_utc.replace('{month}', 'outubro'))
  await expect(card.locator('h2 + span')).toHaveCount(0)
  await expect(card.getByTestId('purchase-funnel-base-ga4')).toContainText(Q.purchase_funnel.base.replace('{month}', 'outubro'))
  await expect(card.getByTestId('purchase-funnel-base-ga4')).toContainText(E.ga4_badge)
  await expect(card.getByTestId('purchase-bank')).not.toContainText(E.ga4_badge)
})

test('#1166 item 2 DS-A11Y-007: block 2 before the split draws only the grey total and its legend names it', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mount(<Screen {...full} />)
  await chartsDrawn(page)
  const legend = page.getByTestId('question-block_2').getByTestId('question-legend')
  await expect(legend).toBeVisible()
  await expect(legend.getByRole('listitem')).toHaveText([E.summary.modes.unsplit])
})

test('#1166 item 3 spec E5.5 E9 BR-COMUNICACAO-022 item 4: block 3 with no month in the window draws the dashed "no data" frame at the chart height, with the reason the "App fora da tela" number carries', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mount(<Screen {...full} />)
  await chartsDrawn(page)
  const b3 = page.getByTestId('question-block_3')
  const frame = b3.getByTestId('question-no-point')
  await expect(frame).toBeVisible()
  await expect(b3.getByTestId('month-bars')).toHaveCount(0)
  await expect(b3.getByTestId('question-legend')).toHaveCount(0)
  expect((await frame.boundingBox())!.height).toBe(198)
  const off = b3.getByTestId('stat-block_3-2').getByTestId('stat-line-value').locator('span').first()
  await expect(off).toHaveText(UNKNOWN_VALUE)
  const reason = await off.getAttribute('title')
  expect(reason).toBeTruthy()
  await expect(frame).toHaveText(reason!)
  // the empty axis of the bank active people stays: its base line already explains it
  await expect(page.locator('[data-testid="extra_active_bank-lines"] svg.recharts-surface')).toHaveCount(1)
})

test('#1166 item 4 DS-COMPONENTE-084 item 2: with open_coverage partial the bank DAU/MAU prints no data with the coverage reason; DAU, WAU and MAU stay as floors', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mount(<Screen {...full} />)
  const bank = page.getByTestId('extra_active_bank')
  for (const i of [0, 1, 2]) {
    await expect(bank.getByTestId(`stat-extra_active_bank-${i}`).getByTestId('stat-line-value')).toContainText('≥ ')
    await expect(bank.getByTestId(`stat-extra_active_bank-${i}`).getByTestId('stat-floor')).toBeVisible()
  }
  const ratio = bank.getByTestId('stat-extra_active_bank-3')
  const value = ratio.getByTestId('stat-line-value').locator('span').first()
  await expect(value).toHaveText(UNKNOWN_VALUE)
  await expect(value).toHaveAttribute('title', E.cell_before_source.replace('{date}', '28/10/2026'))
  await expect(ratio.getByTestId('stat-floor')).toHaveCount(0)
  await expect(ratio).not.toContainText('%')
  // the GA4 half is GA4 over GA4 and keeps its ratio
  await expect(page.getByTestId('extra_active_ga4').getByTestId('stat-extra_active_ga4-3').getByTestId('stat-line-value')).toContainText('%')
})

for (const width of [1440, 390]) {
  test(`#1166 at ${width}: axe finds nothing in the page, and nothing scrolls sideways`, async ({ mount, page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await mount(<Screen {...full} />)
    await chartsDrawn(page)
    const result = await new AxeBuilder({ page }).include('[data-testid="engagement-questions"]').analyze()
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/engagement-1166-${width}.png`, fullPage: true })
  })
}
