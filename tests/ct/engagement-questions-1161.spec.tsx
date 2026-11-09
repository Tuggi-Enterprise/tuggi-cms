/**
 * #1161: the Engagement page by questions (spec Parte E §E16), mounted with the October fixture of
 * contract Parte 27 (119 entered, 35 guide, 22 first story, 12 used 1 hour, 6 2nd trip) and the GA4
 * numbers the deployed engagement-ga4 answered on 2026-11-09.
 *
 * Run with: npx playwright test -c playwright-ct.config.ts engagement-questions
 * Set ENGAGEMENT_SHOTS=<dir> to also write the 1440 and 390 captures.
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { EngagementHarness as Screen } from './engagement-helpers'
import { BANK, CONVERSION, FREE_MINUTES, GA4, MONTHS, TODAY, USAGE } from './engagement-fixtures'
import { CHART_COLORS } from '@/lib/constants/chart-colors'
import ptMessages from '@/messages/pt.json'

const E = ptMessages.Pages.Dashboard.reports.engagement
const Q = E.questions
const SHOTS = process.env.ENGAGEMENT_SHOTS
const ORDER = ['question-block_0', 'question-use_funnel', 'question-purchase_funnel', 'question-block_1', 'question-block_2', 'question-block_3', 'question-block_4']

const full = { months: MONTHS, today: TODAY, bank: BANK, ga4: GA4, conversion: CONVERSION, freeMinutes: FREE_MINUTES, usage: USAGE }

const boxes = (page: Page) =>
  Promise.all(ORDER.map(async (id) => ({ id, box: (await page.getByTestId(id).boundingBox())! })))

/** The charts are behind next/dynamic: wait until every one has drawn its svg. */
const chartsDrawn = async (page: Page) => {
  await expect(page.getByTestId('step-funnel')).toHaveCount(2)
  // #1162: block 6 is the fifth month-bars chart
  await expect(page.getByTestId('month-bars')).toHaveCount(5)
  await expect(page.locator('[data-testid="month-bars"] svg.recharts-surface')).toHaveCount(5)
}

test('#1161 spec E16 item 1 at 1440: block 0, the two funnels side by side, then blocks 1 to 4 in pairs; nothing scrolls sideways', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mount(<Screen {...full} />)
  await chartsDrawn(page)
  const b = await boxes(page)
  // rows top to bottom: block 0, the funnels, blocks 1 and 2, blocks 3 and 4
  for (const [above, below] of [[0, 1], [1, 3], [3, 5]]) expect(b[below].box.y, `${b[below].id} under ${b[above].id}`).toBeGreaterThan(b[above].box.y)
  // pairs on one row: use | purchase, 1 | 2, 3 | 4
  for (const [l, r] of [[1, 2], [3, 4], [5, 6]]) {
    expect(Math.abs(b[l].box.y - b[r].box.y), `${b[l].id} beside ${b[r].id}`).toBeLessThan(2)
    expect(b[r].box.x).toBeGreaterThan(b[l].box.x + b[l].box.width - 1)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expect(page.locator('#conversion')).toContainText(Q.purchase_funnel.title)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/engagement-questions-1440.png`, fullPage: true })
})

test('#1161 spec E16 item 1 at 390: one column in the page order, nothing scrolls sideways', async ({ mount, page }) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await mount(<Screen {...full} />)
  await chartsDrawn(page)
  const b = await boxes(page)
  for (let i = 1; i < b.length; i++) expect(b[i].box.y, `${b[i].id} under ${b[i - 1].id}`).toBeGreaterThan(b[i - 1].box.y + b[i - 1].box.height - 1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/engagement-questions-390.png`, fullPage: true })
})

test('#1161 spec E16 item 3: every block has its question as h2, an answer sentence and the line of its base', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mount(<Screen {...full} />)
  for (const [id, title] of [
    ['question-block_1', Q.block_1.title],
    ['question-block_2', Q.block_2.title],
    ['question-block_3', Q.block_3.title],
    ['question-block_4', Q.block_4.title],
    ['question-use_funnel', Q.use_funnel.title],
    ['question-purchase_funnel', Q.purchase_funnel.title],
  ]) {
    const card = page.getByTestId(id)
    await expect(card.getByRole('heading', { level: 2 })).toHaveText(title)
    await expect(card.getByTestId('question-answer')).not.toBeEmpty()
    await expect(card.getByTestId('question-base')).not.toBeEmpty()
  }
  // block 1, built by rule from the October numbers: 32 of 119 is 27 %, against 35 % in September
  await expect(page.getByTestId('question-block_1').getByTestId('question-answer')).toHaveText('27% de quem entrou ligou o guia no primeiro dia, menos que em setembro (35%).')
  await expect(page.getByTestId('question-block_2').getByTestId('question-answer')).toContainText('44 pessoas ligaram o guia, menos que em setembro (80). Metade percorreu mais de 0,2 km com o guia ligado.')
  // the whole purchase funnel card is GA4 above the line and wears the badge in the header
  await expect(page.getByTestId('question-purchase_funnel').locator('h2 + span')).toContainText(E.ga4_badge)
})

test('#1161 spec E16 item 4 BR-USUARIO-037 item 3.j DS-COMPONENTE-084 item 2: seven steps; installs and location hollow with no percent; the biggest drop in orange with the badge and U+2212', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mount(<Screen {...full} />)
  await chartsDrawn(page)
  const card = page.getByTestId('question-use_funnel')
  const value = (k: string) => card.getByTestId(`step-funnel-value-${k}`)
  await expect(value('step_1')).toHaveText(/^450\s*GA4$/)
  await expect(value('step_3')).toHaveText(/^60\s*GA4$/)
  await expect(value('step_2')).toHaveText('119')
  await expect(value('step_4')).toHaveText('35 · 29%')
  await expect(value('step_6')).toHaveText('12 · 10%')
  // the 2nd trip of October closes on 1 December: a floor
  await expect(value('step_7')).toHaveText('≥ 6 · 5%')
  await expect(card.getByTestId('step-funnel-kept-step_1')).toHaveAttribute('fill', '#fff')
  await expect(card.getByTestId('step-funnel-kept-step_3')).toHaveAttribute('fill', '#fff')
  await expect(card.getByTestId('step-funnel-kept-step_4')).toHaveAttribute('fill', CHART_COLORS.blue)
  await expect(card.getByTestId('step-funnel-lost-step_4')).toHaveAttribute('fill', CHART_COLORS.orange)
  await expect(card.getByTestId('step-funnel-lost-step_5')).toHaveAttribute('fill', '#e5e7eb')
  await expect(card.getByTestId('funnel-biggest-drop')).toContainText('−71 pt')
  await expect(card.getByTestId('funnel-biggest-drop')).toContainText(Q.common.biggest_drop)
  await expect(card.getByTestId('question-answer')).toHaveText('A maior queda é entre Entrou e Ligou o guia: de 100% para 29% de quem entrou.')
  await expect(card.getByTestId('use-funnel-not-entered')).toHaveText('331 instalações a mais que entradas')
})

test('#1161 spec E16 item 5 DS-COMPONENTE-084 item 1: the GA4 purchase funnel has three steps over who saw it and two exits without bars; the branches stay below the line', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mount(<Screen {...full} />)
  await chartsDrawn(page)
  const card = page.getByTestId('question-purchase_funnel')
  await expect(card.getByTestId('step-funnel-value-step_1')).toHaveText('95')
  await expect(card.getByTestId('step-funnel-value-step_2')).toHaveText('2 · 2%')
  // more bought than tapped this month: no loss drawn, the gain printed with its sign
  await expect(card.getByTestId('step-funnel-value-step_3')).toHaveText('9 · 9% (+7)')
  await expect(card.getByTestId('purchase-exit_closed')).toContainText('79 · 83%')
  // GA4 never received paywall_purchase_failed: no data, not 0
  await expect(card.getByTestId('purchase-exit_failed')).toContainText('—')
  await expect(card.getByTestId('purchase-bank')).toContainText(Q.block_7.bank)
  await expect(card.getByTestId('purchase-bank').getByTestId('purchase-funnel-body')).toBeVisible()
  await expect(card.getByTestId('purchase-free-before')).toContainText('2 h 30 min')
})

test('#1161 BR-COMUNICACAO-022 item 4: with the usage function not applied yet, blocks 1, 2 and 4 say the read failed with a retry, block 3 and the rest stand', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mount(<Screen {...full} usage={undefined} usageFailed />)
  for (const id of ['question-block_1', 'question-block_2', 'question-block_4']) {
    const card = page.getByTestId(id)
    await expect(card.getByTestId('question-answer')).toContainText(Q.common.answer_failed)
    await expect(card.getByRole('button', { name: E.retry }).first()).toBeVisible()
  }
  await expect(page.getByTestId('question-block_3').getByTestId('question-answer')).toContainText('35 min')
  await expect(page.getByTestId('question-use_funnel')).toContainText(Q.common.answer_failed)
  await expect(page.getByTestId('engagement-details')).toBeVisible()
  // no number of the failed source prints as 0
  await expect(page.getByTestId('stat-block_1-1').getByTestId('stat-line-value')).toHaveText('—')
})

test('#1161 spec E5.1 DS-COMPONENTE-100: block 0 prints up to three lines, each the first sentence of its block with an arrow and a link to it', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mount(<Screen {...full} />)
  const lines = page.getByTestId('block-0-line')
  await expect(lines).toHaveCount(3)
  await expect(lines.nth(0)).toHaveAttribute('data-block', 'block_4')
  await expect(lines.nth(0).locator('a')).toHaveAttribute('href', '#block-4')
  await expect(lines.nth(1)).toContainText('44 pessoas ligaram o guia, menos que em setembro (80).')
  await expect(lines.nth(1)).not.toContainText('Metade percorreu')
})

test('#1161 spec E5.1 item 5: the current month prints no line and says when they come', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mount(<Screen {...full} month="2026-11" />)
  await expect(page.getByTestId('block-0-empty')).toHaveAttribute('data-empty', 'in_progress')
  await expect(page.getByTestId('block-0-empty')).toContainText('01/12/2026')
})

test('#1161 copy §4: the modes say "só com o guia" to the screen reader, never "no carro"', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mount(<Screen {...full} month="2026-11" />)
  const sr = page.getByTestId('question-block_2').locator('ul.sr-only li').last()
  await expect(sr).toHaveText('nov 2026: só com o guia 9, os dois 11, explorando 21')
  await expect(page.getByTestId('question-block_2')).not.toContainText('no carro')
})

for (const width of [1440, 390]) {
  test(`#1161 spec E16 item 12 at ${width}: axe finds nothing in the question blocks`, async ({ mount, page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await mount(<Screen {...full} />)
    await chartsDrawn(page)
    const result = await new AxeBuilder({ page }).include('[data-testid="engagement-questions"]').analyze()
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
  })
}

test('#1161 spec C10: under a filter the bank half of the purchase funnel refuses and clear filters gives it back; the usage blocks keep the slice, installs say GA4 has no such filter', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const asked: unknown[] = []
  await mount(<Screen {...full} filters={{ source: null, country: null, platform: 'ios', account: null }} onFiltersChange={(f) => asked.push(f)} />)
  const bank = page.getByTestId('question-purchase_funnel').getByTestId('purchase-bank')
  await expect(bank.getByTestId('purchase-trunk')).toHaveCount(0)
  await expect(bank.getByText(E.summary.use_funnel.no_filters)).toBeVisible()
  await bank.getByRole('button', { name: E.clear_filters }).click()
  await expect.poll(() => asked).toEqual([{ source: null, country: null, platform: null, account: null }])
  await expect(page.getByTestId('stat-block_1-0').getByTestId('stat-line-value')).toHaveText('—')
  await expect(page.getByTestId('stat-block_1-1').getByTestId('stat-line-value')).toHaveText('119')
})

test('#1161 BR-COMUNICACAO-022 item 4: the conversion read down puts a retry under the purchase line and leaves the GA4 steps; GA4 down leaves the bank half', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const c = await mount(<Screen {...full} conversion={undefined} conversionFailed />)
  const card = page.getByTestId('question-purchase_funnel')
  await expect(card.getByTestId('purchase-bank').getByRole('button', { name: E.retry })).toBeVisible()
  await expect(card.getByTestId('step-funnel-value-step_1')).toHaveText('95')
  await c.update(<Screen {...full} ga4={undefined} ga4Failed />)
  await expect(card.getByRole('button', { name: E.retry }).first()).toBeVisible()
  await expect(card.getByTestId('purchase-trunk')).toBeVisible()
  await expect(card.getByTestId('purchase-exit_closed')).toContainText('—')
})
