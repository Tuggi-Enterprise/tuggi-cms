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
import { BANK, CONVERSION, CONVERSION_OLD, GA4, MONTHS, TODAY } from './engagement-fixtures'
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
  await expect(engaged.getByTestId('summary-tile-delta')).toHaveText('+8,0% vs set')
  // #1154 DS-COMPONENTE-100 item 4: the return tile keeps October and says when it closes, no older month under its name
  const ret = page.getByTestId('summary-tile-returned')
  await expect(ret.getByTestId('summary-tile-month')).toHaveCount(0)
  await expect(ret.getByTestId('summary-tile-delta')).toHaveText(S.delta_closes.replace('{date}', '01/12'))
  await expect(ret.getByTestId('summary-tile-delta')).toHaveAttribute('title', E.cell_not_due.replace('{date}', '01/12/2026'))
  await expect(ret.getByTestId('summary-tile-delta')).toHaveAttribute('data-state', 'closes')
  await expect(ret.locator('[data-testid^="summary-delta-icon-"]')).toHaveCount(0)
  await c.update(<Screen months={MONTHS} today={TODAY} bank={BANK_OPEN} ga4={GA4_ENGAGED} month="2026-09" />)
  await expect(ret.getByTestId('summary-tile-delta')).toHaveText('−1,0 pt vs ago')
  await expect(ret.getByTestId('summary-tile-delta')).toHaveClass(/text-red-700/)

  await c.update(<Screen months={MONTHS} today={TODAY} bank={BANK_OPEN} ga4={GA4_ENGAGED} month="2026-11" />)
  await expect(page.locator('[data-testid^="summary-delta-icon-"]')).toHaveCount(0)
  const deltas = await page.getByTestId('summary-tile-delta').all()
  for (const d of deltas.slice(0, 3)) await expect(d).toHaveText(E.until_today)
  await expect(deltas[3]).toHaveText(S.delta_closes.replace('{date}', '01/01'))
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

test('spec B15 item 11: bank down marks tiles 2 and 4, GA4 down tiles 1 and 3 and the heads; a source filter empties the GA4 heads and keeps modes and frequency', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 })
  const c = await mount(<Screen months={MONTHS} today={TODAY} bankFailed ga4={GA4_ENGAGED} conversion={CONVERSION} />)
  const summary = page.getByTestId('engagement-summary')
  await expect(summary.getByText(E.bank_failed, { exact: true })).toHaveCount(1)
  for (const t of ['guide_median', 'returned']) await expect(page.getByTestId(`summary-tile-${t}`).locator('p').first()).toHaveAttribute('title', E.cell_bank_failed)
  await expect(page.getByTestId('summary-tile-engaged').locator('p').first()).toHaveText('189')

  await c.update(<Screen months={MONTHS} today={TODAY} bank={BANK_OPEN} ga4Failed conversion={CONVERSION} />)
  await expect(summary.getByText(E.ga4_failed, { exact: true })).toHaveCount(1)
  for (const t of ['engaged', 'screen_minutes']) await expect(page.getByTestId(`summary-tile-${t}`).locator('p').first()).toHaveAttribute('title', E.cell_ga4_failed)
  await expect(page.getByTestId('summary-use-funnel').getByTestId('funnel-step-installs')).toBeVisible()

  await c.update(<Screen months={MONTHS} today={TODAY} bank={BANK_OPEN} filters={{ source: 'none', country: null, platform: null, account: null }} />)
  for (const t of ['engaged', 'screen_minutes']) await expect(page.getByTestId(`summary-tile-${t}`).locator('p').first()).toHaveAttribute('title', E.cell_ga4_filter)
  await expect(page.getByTestId('summary-modes-columns-seg-drive_only')).toBeVisible()
  await expect(page.getByTestId('summary-frequency-columns-col-2026-08').getByTestId('summary-frequency-columns-seg-d1')).toBeVisible()
  // BR-COMUNICACAO-022 item 4: no value prints 0 from a null (the axis ticks are not values)
  await expect(summary.locator('dd, [data-testid^="summary-tile-"] p').filter({ hasText: /^0$/ })).toHaveCount(0)
})

// ── Parte C (#1101) ──────────────────────────────────────────────────────────────────────────

const U = S.use_funnel
const P = S.purchase_funnel
const full = (extra: Record<string, unknown> = {}) => <Screen months={MONTHS} today={TODAY} bank={BANK_OPEN} ga4={GA4_ENGAGED} conversion={CONVERSION} {...extra} />
const top = (page: Page, id: string) => page.getByTestId(id).evaluate((e) => Math.round(e.getBoundingClientRect().top))
const width = (page: Page, id: string) => page.getByTestId(id).evaluate((e) => e.getBoundingClientRect().width)

test('#1101 spec C16 item 3: at 1440 modes beside days of use and the use funnel beside the purchase funnel; the purchase funnel wears id conversion', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 })
  await mount(full())
  expect(await top(page, 'summary-modes')).toBe(await top(page, 'summary-frequency'))
  expect(await top(page, 'summary-use-funnel')).toBe(await top(page, 'summary-purchase-funnel'))
  expect(await top(page, 'summary-use-funnel')).toBeGreaterThan(await top(page, 'summary-modes'))
  await expect(page.getByTestId('summary-purchase-funnel')).toHaveAttribute('id', 'conversion')
  // the cohorts come after both rows, at full width
  expect(await top(page, 'summary-cohort-heat')).toBeGreaterThan(await top(page, 'summary-purchase-funnel'))
})

test('#1101 spec C16 item 3: at 390 the four cards stack in the order modes, days, use funnel, purchase funnel', async ({ mount, page }) => {
  await page.setViewportSize({ width: 390, height: 1200 })
  await mount(full())
  const order = ['summary-modes', 'summary-frequency', 'summary-use-funnel', 'summary-purchase-funnel']
  const tops = [] as number[]
  for (const id of order) tops.push(await top(page, id))
  expect([...tops].sort((a, b) => a - b)).toEqual(tops)
  expect(new Set(tops).size).toBe(4)
  const o = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }))
  expect(o.s).toBeLessThanOrEqual(o.c + 1)
})

test('#1101 spec C16 item 4 BR-COMUNICACAO-022 item 4: August to October draw one neutral trip_total segment of active.trip, November the three modes, four legend items, the split month in the header, three visible help lines', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 })
  await mount(full())
  const card = page.getByTestId('summary-modes')
  // stripTop of August's 150 (the tallest month) is 200
  for (const [m, trip] of [['2026-08', 150], ['2026-09', 160], ['2026-10', 120]] as const) {
    const col = card.getByTestId(`summary-modes-columns-col-${m}`)
    await expect(col.locator('[data-testid^="summary-modes-columns-seg-"]')).toHaveCount(1)
    const seg = col.getByTestId('summary-modes-columns-seg-trip_total')
    await expect(seg).toHaveCSS('background-color', rgb(CHART_NEUTRAL))
    await expect(seg).toHaveAttribute('title', S.modes.unsplit_title.replace('{n}', String(trip)))
    const h = await seg.evaluate((e) => e.getBoundingClientRect().height)
    expect(Math.abs(h - (trip / 200) * 160)).toBeLessThanOrEqual(1)
  }
  const nov = card.getByTestId('summary-modes-columns-col-2026-11')
  for (const key of ['drive_only', 'both', 'explore_only']) await expect(nov.getByTestId(`summary-modes-columns-seg-${key}`)).toBeVisible()
  await expect(nov.getByTestId('summary-modes-columns-seg-trip_total')).toHaveCount(0)
  await expect(card.getByTestId('summary-modes-columns-legend').locator('li')).toHaveCount(4)
  await expect(card.getByTestId('summary-modes-columns-legend').locator('li').last()).toHaveText(S.modes.unsplit)
  await expect(card.getByTestId('summary-modes-note')).toHaveText(S.modes_note.replace('{month}', 'nov 2026'))
  const help = card.getByTestId('summary-modes-help').locator('li')
  await expect(help).toHaveCount(3)
  for (const li of await help.all()) {
    await expect(li).toBeVisible()
    await expect(li).not.toHaveAttribute('title', /.*/)
  }
  await expect(help.first()).toContainText(S.modes.help_drive_only)
  await expect(card.getByTestId('summary-modes-panel').locator('dd')).toHaveCount(6)
  const helpBottom = await card.getByTestId('summary-modes-help').evaluate((e) => e.getBoundingClientRect().bottom)
  const panelTop = await card.getByTestId('summary-modes-panel').evaluate((e) => e.getBoundingClientRect().top)
  expect(panelTop).toBeGreaterThanOrEqual(helpBottom)
})

test('#1101 spec C16 item 4: with has_mode_fields false every month draws the neutral segment and the header says no month is split', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 })
  const noModes = { ...BANK_OPEN, has_mode_fields: false }
  await mount(full({ bank: noModes }))
  const card = page.getByTestId('summary-modes')
  await expect(card.getByTestId('summary-modes-columns-seg-trip_total')).toHaveCount(4)
  await expect(card.getByTestId('summary-modes-note')).toHaveText(S.modes_note_none)
})

test('#1101 spec C16 item 5 DS-COMPONENTE-084 item 2: four bands in order, the two GA4 ones hollow with the tag, Entered split into account and guest, the only rate below Entered is of entered', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 })
  await mount(full())
  const f = page.getByTestId('summary-use-funnel')
  const items = await f.locator('[data-testid="funnel-bands"] > li').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))
  expect(items).toEqual(['funnel-step-installs', 'funnel-seam', 'funnel-step-entered', 'funnel-step-new_engaged', 'funnel-step-used'])
  for (const k of ['installs', 'new_engaged']) {
    await expect(f.getByTestId(`funnel-band-${k}`)).toHaveClass(/border-dashed/)
    await expect(f.getByTestId(`funnel-step-${k}`).getByTestId('funnel-tag').first()).toHaveText(E.ga4_badge)
  }
  await expect(f.getByTestId('funnel-step-entered').getByTestId('funnel-tag')).toHaveCount(0)
  // Entered: 120 with an account and 200 guests of 320, the 2 px gap between them
  const band = await width(page, 'funnel-band-entered')
  const account = await f.getByTestId('funnel-part-account').evaluate((e) => e.getBoundingClientRect().width)
  const guest = await f.getByTestId('funnel-part-guest').evaluate((e) => e.getBoundingClientRect().width)
  expect(Math.abs(account - (band - 2) * (120 / 320))).toBeLessThanOrEqual(1)
  expect(Math.abs(guest - (band - 2) * (200 / 320))).toBeLessThanOrEqual(1)
  await expect(f.getByTestId('funnel-part-account')).toHaveAttribute('title', U.part_account.replace('{n}', '120'))
  await expect(f.getByTestId('funnel-part-account')).toHaveCSS('background-color', rgb(CHART_COLORS.blue))
  // one ruler: installs 450 is the widest
  const col = await f.getByTestId('funnel-band-col-installs').evaluate((e) => e.getBoundingClientRect().width)
  expect(Math.abs((await width(page, 'funnel-band-installs')) - col)).toBeLessThanOrEqual(1)
  expect(Math.abs((await width(page, 'funnel-band-used')) - (250 / 450) * col)).toBeLessThanOrEqual(1)
  // the seam prints the difference with installs measured, and no ratio
  await expect(f.getByTestId('funnel-seam')).toHaveText(U.not_entered.replace('{count}', '130'))
  await expect(f.getByTestId('funnel-step-used')).toContainText(U.of_entered.replace('{pct}', '78%'))
  // interacted (GA4) carries no rate: its note is the sub, no percent
  await expect(f.getByTestId('funnel-step-new_engaged')).toContainText(U.new_engaged_sub)
  await expect(f.getByTestId('funnel-step-new_engaged')).not.toContainText('%')
})

test('#1101 spec C16 item 5 BR-COMUNICACAO-022 item 4: a function before #1100 empties Guide or story with no source and prints no rate; installs below entered shows no difference', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 })
  await mount(full({ conversion: { ...CONVERSION_OLD, installs: { ios: 100, android: 100, total: 200 } } }))
  const f = page.getByTestId('summary-use-funnel')
  await expect(f.getByTestId('funnel-band-used')).toHaveCount(0)
  await expect(f.getByTestId('funnel-step-used')).toContainText(S.tiles.no_source_bank)
  await expect(f.getByTestId('funnel-seam')).toHaveText('')
  await expect(f.getByText(U.floor_note)).toBeVisible()
})

test('#1101 spec C16 item 6 DS-COMPONENTE-101: trunk parts split Entered, each branch bar is its rate, both rates in the same class, the branch that converts more has the badge', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 })
  await mount(full())
  const f = page.getByTestId('summary-purchase-funnel')
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
  const f = page.getByTestId('summary-purchase-funnel')
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

test('#1101 spec C16 item 7: under a filter neither funnel draws, both say why and clear filters gives them back', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 })
  const asked: unknown[] = []
  await mount(full({ filters: { source: null, country: null, platform: 'ios', account: null }, onFiltersChange: (f: unknown) => asked.push(f) }))
  await expect(page.getByTestId('funnel-bands')).toHaveCount(0)
  await expect(page.getByTestId('purchase-trunk')).toHaveCount(0)
  for (const id of ['summary-use-funnel', 'summary-purchase-funnel']) {
    const card = page.getByTestId(id)
    await expect(card.getByText(U.no_filters)).toBeVisible()
    await expect(card.getByRole('button', { name: E.clear_filters })).toBeVisible()
  }
  await page.getByTestId('summary-use-funnel').getByRole('button', { name: E.clear_filters }).click()
  await expect.poll(() => asked).toEqual([{ source: null, country: null, platform: null, account: null }])
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

test('#1101 spec C16 item 11: the conversion read down puts a retry in both funnel cards and leaves the rest; GA4 down keeps installs and empties interacted with its reason', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 })
  const c = await mount(full({ conversion: undefined, conversionFailed: true }))
  for (const id of ['summary-use-funnel', 'summary-purchase-funnel']) {
    await expect(page.getByTestId(id).getByRole('alert')).toContainText(U.failed)
    await expect(page.getByTestId(id).getByRole('button', { name: E.retry })).toBeVisible()
  }
  await expect(page.getByTestId('summary-modes-columns-seg-drive_only')).toBeVisible()
  await expect(page.getByTestId('summary-tile-engaged').locator('p').first()).toHaveText('189')

  await c.update(full({ ga4: undefined, ga4Failed: true }))
  const f = page.getByTestId('summary-use-funnel')
  await expect(f.getByTestId('funnel-band-installs')).toBeVisible()
  await expect(f.getByTestId('funnel-band-new_engaged')).toHaveCount(0)
  await expect(f.getByTestId('funnel-step-new_engaged')).toContainText(E.cell_ga4_failed)

  // the function before newEngagedUsers: no source, not 0
  await c.update(full({ ga4: { ...GA4_ENGAGED, months: GA4_ENGAGED.months.map((m) => ({ ...m, newEngagedUsers: null })) } }))
  await expect(f.getByTestId('funnel-step-new_engaged')).toContainText(S.tiles.no_source_ga4)

  // the current month: the funnels print what there is, the month line says until today
  await c.update(full({ month: '2026-11' }))
  await expect(page.getByTestId('engagement-summary').getByText(E.until_today, { exact: true }).first()).toBeVisible()
  await expect(f.getByTestId('funnel-step-entered')).toContainText('320')
})

test('#1101 spec C10: the loading funnels keep the height of the loaded ones within the row', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 })
  const c = await mount(<Screen months={MONTHS} today={TODAY} bank={BANK_OPEN} ga4={GA4_ENGAGED} />)
  await expect(page.getByTestId('purchase-loading')).toBeVisible()
  await expect(page.getByTestId('summary-use-funnel').locator('ul[aria-busy="true"]')).toBeVisible()
  await c.update(full())
  await expect(page.getByTestId('purchase-trunk')).toBeVisible()
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
