/**
 * The executive summary of the Engagement and conversion report (#1099, #1101,
 * spec-cms-relatorio-engajamento-2026-11 Parte B criterion §B15 and Parte C criterion §C16), mounted
 * with the fixtures of the report.
 *
 * Run with: npx playwright test -c playwright-ct.config.ts engagement-summary
 * Set ENGAGEMENT_SHOTS=<dir> to also write the 1440 and 390 captures of the summary.
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page } from '@playwright/test'
import { EngagementHarness as Screen, SparklineHarness } from './engagement-helpers'
import { BANK, CONVERSION, CONVERSION_OLD, FREE_MINUTES, GA4, MONTHS, TODAY } from './engagement-fixtures'
import AxeBuilder from '@axe-core/playwright'
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
const P = E.summary.purchase_funnel
const full = (extra: Record<string, unknown> = {}) => <Screen months={MONTHS} today={TODAY} bank={BANK_OPEN} ga4={GA4_ENGAGED} conversion={CONVERSION} freeMinutes={FREE_MINUTES} {...extra} />
const width = (page: Page, id: string) => page.getByTestId(id).evaluate((e) => e.getBoundingClientRect().width)

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

test('#1101 spec C16 item 6 DS-COMPONENTE-101: trunk parts split Entered, each branch bar is its rate, both rates in the same class, the branch that converts more has the badge', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 })
  await mount(full())
  const f = page.getByTestId('question-purchase_funnel')
  const trunk = await f.getByTestId('purchase-trunk').locator('[aria-hidden="true"]').first().evaluate((e) => e.getBoundingClientRect().width)
  const tested = await width(page, 'purchase-trunk-part-tested')
  const untested = await width(page, 'purchase-trunk-part-untested')
  expect(Math.abs(tested - (trunk - 2) * (120 / 320))).toBeLessThanOrEqual(1)
  expect(Math.abs(untested - (trunk - 2) * (200 / 320))).toBeLessThanOrEqual(1)
  await expect(f.getByTestId('purchase-trunk-part-tested')).toHaveCSS('background-color', rgb(CHART_COLORS.blue))
  await expect(f.getByTestId('purchase-trunk-part-untested')).toHaveCSS('background-color', rgb(CHART_COLORS.orange))
  await expect(f.getByTestId('purchase-trunk')).toContainText(P.purchased_line.replace('{n}', '38').replace('{pct}', '12%'))
  for (const [key, rate, color] of [['tested', 30 / 120, CHART_COLORS.blue], ['untested', 8 / 200, CHART_COLORS.orange]] as const) {
    const branch = f.getByTestId(`purchase-branch-${key}`)
    const track = await branch.getByTestId(`purchase-branch-fill-${key}`).evaluate((e) => (e.parentElement as HTMLElement).getBoundingClientRect().width)
    const fill = await width(page, `purchase-branch-fill-${key}`)
    expect(Math.abs(fill - Math.max(4, rate * track))).toBeLessThanOrEqual(1)
    await expect(branch).toHaveCSS('border-top-color', rgb(color))
  }
  const cls = async (k: string) => f.getByTestId(`purchase-rate-${k}`).getAttribute('class')
  expect(await cls('tested')).toBe(await cls('untested'))
  await expect(f.getByTestId('purchase-rate-tested')).toHaveText('25%')
  await expect(f.getByTestId('purchase-rate-untested')).toHaveText('4%')
  await expect(f.getByTestId('purchase-branch-tested').getByTestId('funnel-badge')).toHaveText(P.converts_more)
  await expect(f.getByTestId('purchase-branch-untested').getByTestId('funnel-badge')).toHaveCount(0)
  await expect(f.getByTestId('purchase-branch-tested')).toContainText(P.counts.replace('{bought}', '30').replace('{not}', '90'))
})

test('#1101 DS-COMPONENTE-101 items 3 and 5: a base under 30 prints no badge and says so on the rate; without the #1100 fields the trunk keeps Entered and Bought in one part', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 })
  const c = await mount(full({ conversion: { ...CONVERSION, entered: 50, testedFree: 29, purchasedAfterFree: 10, purchasedWithoutFree: 1, purchased: 11 } }))
  const f = page.getByTestId('question-purchase_funnel')
  await expect(f.getByTestId('funnel-badge')).toHaveCount(0)
  await expect(f.getByTestId('purchase-rate-tested')).toHaveAttribute('title', P.small_base.replace('{a}', '29').replace('{b}', '21'))
  await c.update(full({ conversion: CONVERSION_OLD }))
  await expect(f.getByTestId('purchase-trunk-part-all')).toHaveAttribute('title', P.no_split)
  await expect(f.getByTestId('purchase-trunk')).toContainText('320')
  await expect(f.getByTestId('purchase-trunk')).toContainText(P.purchased_line.replace('{n}', '38').replace('{pct}', '12%'))
  for (const key of ['tested', 'untested']) {
    await expect(f.getByTestId(`purchase-rate-${key}`)).toHaveText('\u2014')
    await expect(f.getByTestId(`purchase-rate-${key}`)).toHaveAttribute('title', S.tiles.no_source_bank)
    await expect(f.getByTestId(`purchase-branch-fill-${key}`)).toHaveCount(0)
  }
  await expect(f.getByTestId('purchase-branch-tested').locator('p').filter({ hasText: /^0$/ })).toHaveCount(0)
})

test('#1101 spec C16 item 8: the cohorts block is the whole third card, every measured rate toned, the cohort size not; the detail drops the card', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 })
  await mount(full())
  const heat = page.getByTestId('summary-cohort-heat')
  await expect(heat.getByText(E.groups.g_activation, { exact: true })).toBeVisible()
  await expect(heat.getByText(E.groups.g_cohort, { exact: true })).toBeVisible()
  const rows = await heat.locator('tbody tr[data-testid^="engagement-row-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))
  expect(rows).toEqual(['audio_24h', 'audio_7d', 'cohort_size', 'ret_d1', 'ret_d7', 'ret_d30', 'ret_d60', 'ret_d90', 'ret_on_d1', 'ret_on_d7', 'ret_on_d30', 'second_30', 'second_60', 'second_90'].map((k) => `engagement-row-${k}`))
  await expect(heat.locator('[data-testid="engagement-row-ret_d1"] td').nth(0)).toHaveClass(/bg-emerald-300/)
  for (const td of await heat.locator('[data-testid="engagement-row-cohort_size"] td').all()) await expect(td).not.toHaveClass(/bg-emerald/)
  await expect(heat.locator('[data-testid="engagement-row-ret_d30"] td').nth(2)).not.toHaveClass(/bg-emerald/)
  await expect(page.getByTestId('engagement-card_after_first')).toHaveCount(0)
  await expect(heat.getByTestId('summary-heat-legend').locator('li')).toHaveCount(5)
  await expect(heat.getByTestId('summary-curve-gate')).toHaveText(S.curve_gate.replace('{n}', '2'))
})

for (const w of [1440, 390]) {
  test(`#1101 spec C16 item 12 at ${w}: axe finds nothing in the summary with both funnels`, async ({ mount, page }) => {
    await page.setViewportSize({ width: w, height: 1200 })
    await mount(full())
    await expect(page.getByTestId('purchase-trunk')).toBeVisible()
    const r = await new AxeBuilder({ page }).include('[data-testid="engagement-summary"]').analyze()
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/engagement-c-${w}.png`, fullPage: true })
  })
}
