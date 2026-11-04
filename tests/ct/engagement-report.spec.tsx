/**
 * The Engagement report (#1094, spec-cms-relatorio-engajamento-2026-11 §3, §5, §6 and §11), mounted
 * with fixtures.
 *
 * Mounts `EngagementReport` and not the page: the page only owns the URL and the queries, and the
 * proxy needs a CMS session this bench does not have (see `playwright-ct.config.ts`).
 *
 * Run with: npx playwright test -c playwright-ct.config.ts engagement-report
 * Set ENGAGEMENT_SHOTS=<dir> to also write the 1440 and 390 captures.
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import fs from 'fs'
import path from 'path'
import { EngagementHarness as Screen } from './engagement-helpers'
import { BANK, GA4, MONTHS, MONTHS_11, TODAY } from './engagement-fixtures'
import ptMessages from '@/messages/pt.json'

const E = ptMessages.Pages.Dashboard.reports.engagement
const SHOTS = process.env.ENGAGEMENT_SHOTS
const CARDS = ['card_people_time', 'card_frequency', 'card_after_first']

/** The cell of a row in one month column (1 = first month). */
const cellOf = (page: Page, row: string, column: number) =>
  page.locator(`[data-testid="engagement-row-${row}"] td`).nth(column - 1)

async function cardHeights(page: Page) {
  return page.evaluate((keys: string[]) => keys.map((k: string) => document.querySelector(`[data-testid="engagement-${k}"]`)!.getBoundingClientRect().height), CARDS)
}

for (const width of [1440, 390]) {
  test(`spec §11 items 1, 3 and 9 at ${width}: the months of the ruler in the three cards, the skeleton keeps every height`, async ({ mount, page }) => {
    await page.setViewportSize({ width, height: 1000 })
    const loading = await mount(<Screen months={MONTHS} today={TODAY} />)
    await expect(page.locator('[data-state="loading"]').first()).toBeVisible()
    const before = await cardHeights(page)
    await loading.unmount()

    await mount(<Screen months={MONTHS} today={TODAY} bank={BANK} ga4={GA4} />)
    await expect(page.getByRole('heading', { level: 1, name: E.title })).toBeVisible()
    await expect(page.getByText('Export')).toHaveCount(0)
    for (const k of CARDS) {
      const heads = page.locator(`[data-testid="engagement-${k}"] thead th[scope="col"]`)
      await expect(heads).toHaveCount(MONTHS.length + 1)
      await expect(heads.last()).toContainText(E.until_today)
    }
    // the GA4 badge on the four GA4 rows only
    await expect(page.locator('tbody th[scope="row"]').filter({ hasText: E.ga4_badge })).toHaveCount(3)
    await expect(page.locator('[data-state="loading"]')).toHaveCount(0)
    const after = await cardHeights(page)
    for (let i = 0; i < CARDS.length; i++) expect(Math.abs(after[i] - before[i]), CARDS[i]).toBeLessThanOrEqual(1)

    const o = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }))
    expect(o.s).toBeLessThanOrEqual(o.c + 1)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/engagement-${width}.png`, fullPage: true })
  })
}

test('spec §11 item 4 BR-COMUNICACAO-022 item 4: suppressed and before-source print the dash with different titles, and no null prints 0', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  // The database sends null for a month before data_since (contract Parte 25): August of audio here.
  const bank = {
    data_since: { ...BANK.data_since, audio: '2026-09-02' },
    months: BANK.months.map((m) => (m.month === '2026-08' ? { ...m, active: { ...m.active, audio: null } } : m)),
  }
  await mount(<Screen months={MONTHS} today={TODAY} bank={bank} ga4={GA4} />)
  // August: audio before its source; d6_plus null too, but the reason that wins is the source.
  const active = cellOf(page, 'active_by', 1)
  await expect(active).toHaveText('—')
  await expect(active).toHaveAttribute('title', E.cell_before_source.replace('{date}', '02/09/2026'))
  await expect(page.locator('td').filter({ hasText: /^0$/ })).toHaveCount(0)
})

test('spec §11 item 4: a null band in a measured month is suppressed', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mount(<Screen months={MONTHS} today={TODAY} bank={BANK} ga4={GA4} />)
  const d6 = cellOf(page, 'days_6_plus', 1)
  await expect(d6).toHaveText('—')
  await expect(d6).toHaveAttribute('title', E.cell_suppressed)
  await expect(cellOf(page, 'days_1', 1)).toHaveText('131 · 64%')
})

test('spec §11 item 5: last month return prints a floor with a number, and D90 of a young cohort is not due', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mount(<Screen months={MONTHS} today={TODAY} bank={BANK} ga4={GA4} />)
  const oct = cellOf(page, 'returned_next', 3)
  await expect(oct).toHaveText('≥ 9%')
  await expect(oct).toHaveAttribute('title', E.cell_floor.replace('{date}', '01/12/2026'))
  const d90 = cellOf(page, 'ret_d90', 2)
  await expect(d90).toHaveAttribute('title', E.cell_not_due.replace('{date}', '30/12/2026'))
})

test('spec §11 item 7: under a source filter the GA4 rows say GA4 has no such filter, and the clicks card says why', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mount(<Screen months={MONTHS} today={TODAY} bank={BANK} filters={{ source: 'none', country: null, platform: null, account: null }} />)
  await expect(cellOf(page, 'active_ga4', 1)).toHaveAttribute('title', E.cell_ga4_filter)
  await expect(cellOf(page, 'active_by', 1)).toHaveText('204')
  await expect(page.getByTestId('engagement-card_clicks').getByText(E.ga4_filter_hint, { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: E.clear_filters })).toBeVisible()
})

test('spec §11 item 8: bank down and GA4 down keep the table, mark their own cells and offer a retry per card', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mount(<Screen months={MONTHS} today={TODAY} bankFailed ga4Failed />)
  await expect(cellOf(page, 'active_by', 1)).toHaveAttribute('title', E.cell_bank_failed)
  await expect(cellOf(page, 'active_ga4', 1)).toHaveAttribute('title', E.cell_ga4_failed)
  await expect(page.getByText(E.bank_failed, { exact: true })).toHaveCount(3)
  // two grid cards with GA4 rows, plus the clicks card
  await expect(page.getByText(E.ga4_failed, { exact: true })).toHaveCount(3)
  await expect(page.locator('td').filter({ hasText: /^0$/ })).toHaveCount(0)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/engagement-1440-failed.png`, fullPage: true })
})

test('spec §6: an empty slice says so above the cards, with clear filters', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const empty = { data_since: BANK.data_since, months: MONTHS.map((month) => ({ ...BANK.months[0], month, active: { open: null, trip: null, audio: null }, new: { open: null, trip: null, audio: null }, guide_minutes_median: null, guide_minutes_p75: null, days_used: { open: BANK.months[0].days_used.open, trip: BANK.months[0].days_used.open, audio: BANK.months[0].days_used.open }, returned_next_month: { open: null, trip: null, audio: null }, cohort: { size: null, retention: { d1: null, d7: null, d30: null, d60: null, d90: null }, second_trip: { d30: null, d60: null, d90: null } } })) }
  await mount(<Screen months={MONTHS} today={TODAY} bank={empty} ga4={GA4} filters={{ source: null, country: 'PT', platform: null, account: null }} />)
  await expect(page.getByTestId('engagement-empty-slice')).toContainText(E.empty_filtered)
})

test('spec §11 item 12: clicks of one month by screen, people on the bar, taps beside, the widest bar is the column', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mount(<Screen months={MONTHS} today={TODAY} bank={BANK} ga4={GA4} />)
  const card = page.getByTestId('engagement-card_clicks')
  await expect(card.getByRole('combobox')).toHaveValue('2026-10')
  await expect(card.getByTestId('engagement-click-row')).toHaveCount(5)
  await expect(card.getByText('301 toques')).toBeVisible()
  const first = card.getByTestId('engagement-click-row').first()
  const bar = await first.evaluate((el) => {
    const track = el.querySelector('.h-1\\.5') as HTMLElement
    return { track: track.getBoundingClientRect().width, fill: (track.firstElementChild as HTMLElement).getBoundingClientRect().width }
  })
  expect(Math.abs(bar.fill - bar.track)).toBeLessThanOrEqual(1)
})

test('spec §11 items 10 and 11 at 390: each table scrolls, opens at the latest month, and the first column stays put', async ({ mount, page }) => {
  await page.setViewportSize({ width: 390, height: 1000 })
  await mount(<Screen months={MONTHS_11} today={TODAY} bank={BANK} ga4={GA4} />)
  const box = page.getByRole('region', { name: E.card_people_time })
  await expect(box).toHaveAttribute('tabindex', '0')
  const state = await box.evaluate((el) => ({ left: el.scrollLeft, max: el.scrollWidth - el.clientWidth }))
  expect(state.max).toBeGreaterThan(0)
  expect(Math.abs(state.left - state.max)).toBeLessThanOrEqual(2)
  const head = page.locator('[data-testid="engagement-row-active_by"] th')
  const x1 = (await head.boundingBox())!.x
  await box.evaluate((el) => { el.scrollLeft = 0 })
  const x2 = (await head.boundingBox())!.x
  expect(Math.abs(x1 - x2)).toBeLessThanOrEqual(1)
  await expect(page.locator('caption')).toHaveCount(3)
})

test('spec §11 item 11 at 1440: eleven months fit without scrolling, and axe finds nothing', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mount(<Screen months={MONTHS_11} today={TODAY} bank={BANK} ga4={GA4} />)
  for (const k of CARDS) {
    const r = await page.locator(`[data-testid="engagement-${k}"] [role="region"]`).evaluate((el) => el.scrollWidth - el.clientWidth)
    expect(r, k).toBeLessThanOrEqual(1)
  }
  const results = await new AxeBuilder({ page }).include('#root').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  expect(results.violations, JSON.stringify(results.violations.map((v) => v.id))).toEqual([])
})

/** Route imports, walked from the page through `@/` and relative paths. */
function routeImports(entry: string, seen = new Set<string>(), pkgs = new Set<string>()) {
  if (seen.has(entry)) return pkgs
  seen.add(entry)
  const src = fs.readFileSync(entry, 'utf8')
  for (const m of src.matchAll(/^\s*import\s+(?!type\b)[^'"]*['"]([^'"]+)['"]/gm)) {
    const spec = m[1]
    const local = spec.startsWith('@/') ? path.resolve(spec.slice(2)) : spec.startsWith('.') ? path.resolve(path.dirname(entry), spec) : null
    if (!local) { pkgs.add(spec); continue }
    const file = ['', '.tsx', '.ts', '/index.tsx', '/index.ts'].map((e) => local + e).find((f) => fs.existsSync(f) && fs.statSync(f).isFile())
    if (file) routeImports(file, seen, pkgs)
  }
  return pkgs
}

test('spec §11 item 14: no static recharts import on the route (the all-time donut stays behind next/dynamic)', async () => {
  const pkgs = routeImports(path.resolve('app/[locale]/dashboard/reports/engagement/page.tsx'))
  expect([...pkgs].filter((p) => p.startsWith('recharts'))).toEqual([])
})
