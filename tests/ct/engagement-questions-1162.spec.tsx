/**
 * #1162: blocks 5 to 8, the three signal cards and Details (spec Parte E §E16), mounted with the October
 * fixture of contract Parte 27 and the GA4 numbers the deployed engagement-ga4 answered on 2026-11-09.
 *
 * Run with: npx playwright test -c playwright-ct.config.ts engagement-questions-1162
 * Set ENGAGEMENT_SHOTS=<dir> to also write the 1440 and 390 captures of the whole page.
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { EngagementHarness as Screen } from './engagement-helpers'
import { ACTIVE, BANK_RETENTION, CONVERSION, FREE_MINUTES, GA4, MONTHS, TODAY, USAGE } from './engagement-fixtures'
import ptMessages from '@/messages/pt.json'

const E = ptMessages.Pages.Dashboard.reports.engagement
const Q = E.questions
const SHOTS = process.env.ENGAGEMENT_SHOTS
const ORDER = [
  'question-block_0',
  'question-use_funnel',
  'question-purchase_funnel',
  'question-block_1',
  'question-block_2',
  'question-block_3',
  'question-block_4',
  'question-block_5',
  'question-block_6',
  'question-block_7',
  'question-block_8',
  'question-extra_active',
  'question-extra_permissions',
  'question-extra_where',
  'engagement-details',
]

const full = { months: MONTHS, today: TODAY, bank: BANK_RETENTION, ga4: GA4, conversion: CONVERSION, freeMinutes: FREE_MINUTES, usage: USAGE, active: ACTIVE, allTime: true }

/** Every chart is behind next/dynamic: wait until each has drawn its svg. */
const chartsDrawn = async (page: Page) => {
  for (const id of ['block-5-histogram', 'block-7-lines', 'block-8-curve', 'extra_active_bank-lines', 'extra_active_ga4-lines', 'extra-permissions-bars']) {
    await expect(page.locator(`[data-testid="${id}"] svg.recharts-surface`), id).toHaveCount(1)
  }
  // block 3 has no point in October's window and draws the "no data" frame (#1166)
  await expect(page.locator('[data-testid="month-bars"] svg.recharts-surface')).toHaveCount(4)
}

for (const width of [1440, 390]) {
  test(`#1162 spec E16 item 1 at ${width}: the order is block 0, the funnels, blocks 1 to 8, active, permissions, where, Details closed; nothing scrolls sideways`, async ({ mount, page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await mount(<Screen {...full} />)
    await chartsDrawn(page)
    const boxes = await Promise.all(ORDER.map(async (id) => ({ id, box: (await page.getByTestId(id).boundingBox())! })))
    for (let i = 1; i < boxes.length; i++) {
      const [a, b] = [boxes[i - 1], boxes[i]]
      // a pair shares a row at 1440 (the right one starts at the same height); otherwise the next one is lower
      expect(b.box.y + 1, `${b.id} after ${a.id}`).toBeGreaterThanOrEqual(a.box.y)
    }
    if (width === 1440) {
      for (const [l, r] of [['question-block_5', 'question-block_6'], ['question-block_7', 'question-block_8'], ['question-extra_permissions', 'question-extra_where']]) {
        const [bl, br] = [boxes.find((x) => x.id === l)!.box, boxes.find((x) => x.id === r)!.box]
        expect(Math.abs(bl.y - br.y), `${l} beside ${r}`).toBeLessThan(2)
        expect(br.x).toBeGreaterThan(bl.x + bl.width - 1)
      }
    }
    await expect(page.getByTestId('engagement-details')).not.toHaveAttribute('open', '')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/engagement-1162-${width}.png`, fullPage: true })
  })
}

test('#1162 spec E16 item 2: no ?use= selector on the page; the four filters and the month stay', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mount(<Screen {...full} />)
  await expect(page.getByRole('tab')).toHaveCount(0)
  for (const label of [E.use_open, E.use_trip, E.use_audio]) await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0)
  await expect(page.getByTestId('summary-month')).toBeVisible()
  await expect(page.getByPlaceholder(E.source_placeholder)).toBeVisible()
})

test('#1162 spec E16 item 8 DS-COMPONENTE-084 item 1: block 5 prints "did not use" apart from the bars, six buckets with n · pct of who used, three dashed marks', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mount(<Screen {...full} />)
  await chartsDrawn(page)
  // 95 of the 118 of the cohort, apart from the bars (decision of the Tech Lead)
  await expect(page.getByTestId('block-5-not-used')).toHaveText(`${Q.block_5.hist_not_used}: 95 · 81%`)
  await expect(page.getByTestId('block-5-histogram-value-b0_15')).toHaveText('5 · 22%')
  await expect(page.getByTestId('block-5-histogram-value-b60_120')).toHaveText('6 · 26%')
  await expect(page.locator('[data-testid="block-5-histogram"] .recharts-reference-line')).toHaveCount(3)
  await expect(page.locator('[data-testid="block-5-histogram"] .recharts-bar-rectangle')).toHaveCount(6)
  await expect(page.getByTestId('question-block_5').getByTestId('question-answer')).toContainText('30 min')
})

test('#1162 spec E16 item 3 DS-COMPONENTE-084 item 2: block 7 is GA4 alone (badge, base by GA4), two rate lines; block 8 draws the cohort and the market dashed, with the market note', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mount(<Screen {...full} />)
  await chartsDrawn(page)
  const b7 = page.getByTestId('question-block_7')
  await expect(b7.getByText(E.ga4_badge, { exact: true }).first()).toBeVisible()
  await expect(b7.getByTestId('question-base')).toContainText('GA4')
  await expect(b7.locator('.recharts-line')).toHaveCount(2)
  const b8 = page.getByTestId('question-block_8')
  await expect(b8.locator('.recharts-line')).toHaveCount(2)
  await expect(b8.locator('.recharts-line path[stroke-dasharray="4 4"]')).toHaveCount(1)
  await expect(b8.getByTestId('block-8-market')).toContainText('18%')
  await expect(b8.getByTestId('block-8-market')).toContainText(Q.block_8.market_note)
  // the open 2nd trip says when it closes
  await expect(b8.getByTestId('question-answer')).toContainText('01/12/2026')
})

test('#1162 spec E7.5 DS-COMPONENTE-084 items 1 and 2: active has two halves, people and devices, each with its own chart and the 18% market line; October\'s partial opens print as a floor', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mount(<Screen {...full} />)
  await chartsDrawn(page)
  const bank = page.getByTestId('extra_active_bank')
  await expect(bank.getByTestId('stat-extra_active_bank-0').getByTestId('stat-line-value')).toContainText('≥ 4')
  await expect(bank.getByTestId('stat-floor').first()).toBeVisible()
  await expect(page.getByTestId('extra_active_ga4').getByText(E.ga4_badge, { exact: true }).first()).toBeVisible()
  for (const id of ['extra_active_bank-lines', 'extra_active_ga4-lines']) {
    await expect(page.locator(`[data-testid="${id}"] .recharts-reference-line`)).toHaveCount(1)
    await expect(page.locator(`[data-testid="${id}"] .recharts-line`)).toHaveCount(1)
  }
})

test('#1162 spec E7.2 and E7.4: permissions print allowed of asked with the share; where lists five cities and links to Geography', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mount(<Screen {...full} />)
  await chartsDrawn(page)
  await expect(page.getByTestId('extra-permissions-bars-value-location')).toHaveText('60 de 61 · 98%')
  await expect(page.getByTestId('extra-where-by-trips').locator('li')).toHaveCount(5)
  await expect(page.getByTestId('extra-where-by-no-story').locator('li')).toHaveCount(3)
  await expect(page.getByTestId('extra-where-link')).toHaveAttribute('href', '/pt/dashboard/reports/geography')
})

test('#1162 spec E8: Details is closed, opens by its summary, and holds the month table, the cohort heat map, the clicks and the dictionary', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mount(<Screen {...full} />)
  const details = page.getByTestId('engagement-details')
  await expect(page.getByTestId('summary-cohort-heat')).toBeHidden()
  await details.locator('summary').click()
  await expect(details).toHaveAttribute('open', '')
  for (const id of ['engagement-card_people_time', 'summary-cohort-heat', 'engagement-card_clicks', 'engagement-dictionary']) await expect(details.getByTestId(id)).toBeVisible()
})

test('#1162 spec E8: the URL with #detalhes opens Details on arrival', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mount(<Screen {...full} detailsOpen />)
  await expect(page.getByTestId('engagement-details')).toHaveAttribute('open', '')
})

for (const width of [1440, 390]) {
  test(`#1162 spec E16 item 12 at ${width}: axe finds nothing in the blocks, the signals and Details open`, async ({ mount, page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await mount(<Screen {...full} detailsOpen />)
    await chartsDrawn(page)
    const result = await new AxeBuilder({ page }).include('[data-testid="engagement-questions"]').include('[data-testid="engagement-details"]').analyze()
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
  })
}
