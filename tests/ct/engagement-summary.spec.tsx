/**
 * The executive summary of the Engagement report (#1099, spec-cms-relatorio-engajamento-2026-11
 * Parte B, criterion §B15), mounted with the fixtures of the report.
 *
 * Run with: npx playwright test -c playwright-ct.config.ts engagement-summary
 * Set ENGAGEMENT_SHOTS=<dir> to also write the 1440 and 390 captures of the summary.
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page } from '@playwright/test'
import { EngagementHarness as Screen, SparklineHarness } from './engagement-helpers'
import { BANK, GA4, MONTHS, TODAY } from './engagement-fixtures'
import { CHART_COLORS, CHART_NEUTRAL } from '@/lib/constants/chart-colors'
import ptMessages from '@/messages/pt.json'

const E = ptMessages.Pages.Dashboard.reports.engagement
const S = E.summary
const SHOTS = process.env.ENGAGEMENT_SHOTS

/** October's return window is open, so the database sends null (contract Parte 25). */
const BANK_OPEN = { ...BANK, months: BANK.months.map((m) => (m.month === '2026-10' ? { ...m, returned_next_month: { open: null, trip: null, audio: null } } : m)) }
/** GA4 as the function answers after #1099. */
const GA4_ENGAGED = GA4

const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`
const tileHeights = (page: Page) =>
  page.locator('[data-testid^="summary-tile-"][data-testid$="engaged"], [data-testid="summary-tile-guide_median"], [data-testid="summary-tile-screen_minutes"], [data-testid="summary-tile-returned"]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)))

for (const width of [1440, 390]) {
  test(`spec B15 item 2 at ${width}: four tiles keep their height before and after the data, icons in the brand blue`, async ({ mount, page }) => {
    await page.setViewportSize({ width, height: 1200 })
    const loading = await mount(<Screen months={MONTHS} today={TODAY} />)
    await expect(page.getByTestId('summary-tile-loading')).toHaveCount(4)
    const before = await tileHeights(page)
    await loading.update(<Screen months={MONTHS} today={TODAY} bank={BANK_OPEN} ga4={GA4_ENGAGED} />)
    await expect(page.getByTestId('summary-tile-loading')).toHaveCount(0)
    const after = await tileHeights(page)
    expect(before).toHaveLength(4)
    expect(after).toEqual(before)
    for (const icon of await page.getByTestId('summary-tile-icon').all()) await expect(icon).toHaveCSS('color', rgb(CHART_COLORS.blue))
    if (SHOTS) await page.getByTestId('engagement-summary').screenshot({ path: `${SHOTS}/engagement-summary-${width}.png` })
  })
}

test('spec B15 items 1 and 3 DS-COMPONENTE-100: October by default, last closed month; arrows in green and red with icon; the current month prints until today and no arrow', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 })
  const c = await mount(<Screen months={MONTHS} today={TODAY} bank={BANK_OPEN} ga4={GA4_ENGAGED} />)
  await expect(page.getByTestId('summary-month')).toHaveValue('2026-10')
  await expect(page.getByTestId('summary-month').locator('option[value="2026-11"]')).toHaveText(`novembro de 2026 (${E.until_today})`)
  await expect(page.getByText(S.closed, { exact: true })).toBeVisible()
  const engaged = page.getByTestId('summary-tile-engaged')
  await expect(engaged.getByTestId('summary-delta-icon-up')).toBeVisible()
  await expect(engaged.getByTestId('summary-tile-delta')).toHaveClass(/text-green-700/)
  await expect(engaged.getByTestId('summary-tile-delta')).toHaveText('+8% vs set')
  const ret = page.getByTestId('summary-tile-returned')
  await expect(ret.getByTestId('summary-tile-month')).toHaveText('set 2026')
  await expect(ret.getByTestId('summary-tile-delta')).toHaveText('−1 pt vs ago')
  await expect(ret.getByTestId('summary-tile-delta')).toHaveClass(/text-red-700/)

  await c.update(<Screen months={MONTHS} today={TODAY} bank={BANK_OPEN} ga4={GA4_ENGAGED} summaryMonth="2026-11" />)
  await expect(page.locator('[data-testid^="summary-delta-icon-"]')).toHaveCount(0)
  for (const d of await page.getByTestId('summary-tile-delta').all()) await expect(d).toHaveText(E.until_today)
})

test('spec B15 item 6: six right-aligned slots, a gap opens two paths, the accent disc has r 4 and a white ring, the title lists the values', async ({ mount, page }) => {
  const c = await mount(<SparklineHarness points={[null, null, 160, 142, 98, 29]} />)
  const path = page.getByTestId('sparkline-path')
  await expect(path).toHaveCount(1)
  await expect(path).toHaveAttribute('data-points', '4')
  await expect(path).toHaveAttribute('data-start', '2')
  const disc = page.getByTestId('sparkline-accent')
  await expect(disc).toHaveAttribute('r', '4')
  await expect(disc).toHaveCSS('stroke', 'rgb(255, 255, 255)')
  await expect(page.locator('svg[role="img"] > title')).toHaveText('null · null · 160 · 142 · 98 · 29')
  await c.update(<SparklineHarness points={[10, 12, null, 14, 15, 16]} />)
  await expect(page.getByTestId('sparkline-path')).toHaveCount(2)
})

test('spec B15 item 7: modes columns on the ruler, opened at the end, heights value over stripTop times 160, a 2 px gap, three legend items, six panel values', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 })
  await mount(<Screen months={MONTHS} today={TODAY} bank={BANK_OPEN} ga4={GA4_ENGAGED} />)
  const card = page.getByTestId('summary-modes')
  await expect(card.locator('li[data-testid^="summary-modes-columns-col-"]')).toHaveCount(4)
  // November: 9, 11, 21 of stripTop(41) = 50
  for (const [key, v] of [['drive_only', 9], ['both', 11], ['explore_only', 21]] as const) {
    const h = await card.getByTestId(`summary-modes-columns-seg-${key}`).evaluate((e) => e.getBoundingClientRect().height)
    expect(Math.abs(h - (v / 50) * 160)).toBeLessThanOrEqual(1)
  }
  await expect(card.getByTestId('summary-modes-columns-seg-drive_only')).toHaveCSS('background-color', rgb(CHART_COLORS.blue))
  const gap = await card.getByTestId('summary-modes-columns-seg-drive_only').evaluate((e) => {
    const a = e.getBoundingClientRect()
    const b = (e.nextElementSibling as HTMLElement).getBoundingClientRect()
    return a.top - b.bottom
  })
  expect(Math.abs(gap - 2)).toBeLessThanOrEqual(0.5)
  // contract Parte 25: before data_since.open the three groups are null and nothing is drawn
  await expect(card.getByTestId('summary-modes-columns-col-2026-09').locator('[data-testid^="summary-modes-columns-seg-"]')).toHaveCount(0)
  await expect(card.getByTestId('summary-modes-columns-col-2026-09')).toContainText('no carro \u2014, os dois \u2014, explorando \u2014')
  await expect(card.getByTestId('summary-modes-columns-legend').locator('li')).toHaveCount(3)
  await expect(card.getByTestId('summary-modes-columns-legend')).not.toContainText(/\d/)
  await expect(card.getByTestId('summary-modes-panel').locator('dd')).toHaveCount(6)
})

test('spec B15 item 8: two hollow bands above the seam, two filled below, max of four, a rate only inside each instrument, one biggest drop', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 })
  await mount(<Screen months={MONTHS} today={TODAY} bank={BANK_OPEN} ga4={GA4_ENGAGED} summaryMonth="2026-09" />)
  const f = page.getByTestId('summary-funnel')
  await expect(f.getByTestId('funnel-band-opened')).toHaveClass(/border-dashed/)
  await expect(f.getByTestId('funnel-band-engaged')).toHaveClass(/border-dashed/)
  await expect(f.getByTestId('funnel-band-used')).toHaveCSS('background-color', rgb(CHART_COLORS.blue))
  await expect(f.getByTestId('funnel-seam')).toHaveText('')
  const w = async (k: string) => f.getByTestId(`funnel-band-${k}`).evaluate((e) => e.getBoundingClientRect().width)
  const col = await f.getByTestId('funnel-band-col-opened').evaluate((e) => e.getBoundingClientRect().width)
  expect(Math.abs((await w('opened')) - col)).toBeLessThanOrEqual(1)
  await expect(f.getByTestId('funnel-step-engaged')).toContainText('54% de quem abriu')
  await expect(f.getByTestId('funnel-step-returned')).toContainText('11% de quem ouviu áudio')
  await expect(f.getByTestId('funnel-badge')).toHaveCount(2) // the md and the short layout of the same band
  await expect(f.getByTestId('funnel-step-returned').getByTestId('funnel-badge').first()).toHaveText(S.biggest_drop)
})

test('spec B15 item 8: with one rate measured no badge', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 })
  await mount(<Screen months={MONTHS} today={TODAY} bank={BANK_OPEN} ga4={GA4_ENGAGED} />)
  await expect(page.getByTestId('summary-funnel').getByTestId('funnel-badge')).toHaveCount(0)
  await expect(page.getByTestId('summary-funnel').getByTestId('funnel-step-returned')).toContainText('fecha')
})

test('spec B15 item 9: a column sums 100 %, the suppressed band is neutral with its title, inner label only on 18 px, sky from light to dark', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 })
  await mount(<Screen months={MONTHS} today={TODAY} bank={BANK_OPEN} ga4={GA4_ENGAGED} />)
  const card = page.getByTestId('summary-frequency')
  const aug = card.getByTestId('summary-frequency-columns-col-2026-08')
  // August of audio: d6_plus null with active 204 known: 204 − (131 + 40 + 26) = 7 people
  const rest = aug.getByTestId('summary-frequency-columns-seg-suppressed')
  await expect(rest).toHaveCSS('background-color', rgb(CHART_NEUTRAL))
  await expect(rest).toHaveAttribute('title', E.cell_suppressed)
  // the segments and the 2 px gaps between them fill the 160 px plot exactly
  const plot = await aug.locator('[data-testid^="summary-frequency-columns-seg-"]').evaluateAll((els) => els.reduce((s, e) => s + e.getBoundingClientRect().height, 0) + 2 * (els.length - 1))
  expect(Math.abs(plot - 160)).toBeLessThanOrEqual(1)
  await expect(aug.getByTestId('summary-frequency-columns-seg-d1')).toHaveClass(/bg-sky-400/)
  await expect(aug.getByTestId('summary-frequency-columns-seg-d3_5')).toHaveClass(/bg-sky-800/)
  // 7 of 204 is 5.5 px: no inner label
  await expect(rest).toHaveText('')
  await expect(aug.getByTestId('summary-frequency-columns-seg-d1')).toHaveText('64%')
})

test('spec B15 item 10: four toned rows, a null cell without tone, five legend squares, the curve gate with two closed cohorts', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 })
  await mount(<Screen months={MONTHS} today={TODAY} bank={BANK_OPEN} ga4={GA4_ENGAGED} />)
  const heat = page.getByTestId('summary-cohort-heat')
  await expect(heat.locator('tbody tr[data-testid^="engagement-row-"]')).toHaveCount(4)
  const d1Aug = heat.locator('[data-testid="engagement-row-ret_d1"] td').nth(0)
  await expect(d1Aug).toHaveClass(/bg-emerald-300/)
  const d30Oct = heat.locator('[data-testid="engagement-row-ret_d30"] td').nth(2)
  await expect(d30Oct).not.toHaveClass(/bg-emerald/)
  await expect(heat.getByTestId('summary-heat-legend').locator('li')).toHaveCount(5)
  await expect(heat.getByTestId('summary-curve')).toHaveCount(0)
  await expect(heat.getByTestId('summary-curve-gate')).toHaveText(S.curve_gate.replace('{n}', '2'))
})

test('spec B15 item 11: bank down marks tiles 2 and 4, GA4 down tiles 1 and 3 and the heads; a source filter empties the GA4 heads and keeps modes and frequency', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 })
  const c = await mount(<Screen months={MONTHS} today={TODAY} bankFailed ga4={GA4_ENGAGED} />)
  const summary = page.getByTestId('engagement-summary')
  await expect(summary.getByText(E.bank_failed, { exact: true })).toHaveCount(1)
  for (const t of ['guide_median', 'returned']) await expect(page.getByTestId(`summary-tile-${t}`).locator('p').first()).toHaveAttribute('title', E.cell_bank_failed)
  await expect(page.getByTestId('summary-tile-engaged').locator('p').first()).toHaveText('189')

  await c.update(<Screen months={MONTHS} today={TODAY} bank={BANK_OPEN} ga4Failed />)
  await expect(summary.getByText(E.ga4_failed, { exact: true })).toHaveCount(1)
  for (const t of ['engaged', 'screen_minutes']) await expect(page.getByTestId(`summary-tile-${t}`).locator('p').first()).toHaveAttribute('title', E.cell_ga4_failed)
  await expect(page.getByTestId('summary-funnel').getByTestId('funnel-step-opened')).toContainText(E.cell_ga4_failed)

  await c.update(<Screen months={MONTHS} today={TODAY} bank={BANK_OPEN} filters={{ source: 'none', country: null, platform: null, account: null }} />)
  for (const t of ['engaged', 'screen_minutes']) await expect(page.getByTestId(`summary-tile-${t}`).locator('p').first()).toHaveAttribute('title', E.cell_ga4_filter)
  await expect(page.getByTestId('summary-funnel').getByTestId('funnel-step-engaged')).toContainText(E.cell_ga4_filter)
  await expect(page.getByTestId('summary-modes-columns-seg-drive_only')).toBeVisible()
  await expect(page.getByTestId('summary-frequency-columns-col-2026-08').getByTestId('summary-frequency-columns-seg-d1')).toBeVisible()
  // BR-COMUNICACAO-022 item 4: no value prints 0 from a null (the axis ticks are not values)
  await expect(summary.locator('dd, [data-testid^="summary-tile-"] p, [data-testid^="funnel-step-"] span').filter({ hasText: /^0$/ })).toHaveCount(0)
})
