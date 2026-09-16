/**
 * #742 · SPEC §11 — THE SCREEN IS READ IN FIVE SECONDS, AND THE PROOF IS A NUMBER IN PIXELS.
 *
 * The delivery of 2026-09-16 passed 39 criteria of §9 and the operator reprovou it in use: *"a
 * página está feia e lenta · só precisamos ver os dados · a página tem muita explicação"*. None of
 * the 39 measured whether the scoreboard can be READ — the page was 1.840 px tall and the first
 * data row started at y ≈ 1.100 px, so on a 1440 × 900 laptop not one line of the scoreboard was
 * on screen without scrolling.
 *
 * §11.3 replaces the 39 with ONE criterion, and it is geometric on purpose: a criterion written as
 * *"it renders the N lines"* goes green with the block cut off by an inner scroller — that is
 * exactly how the calibration panel shipped with 7 of its 13 rows reachable (critério 40, revoked
 * the day it was born).
 *
 * Run with: npx playwright test -c playwright-ct.config.ts ranking-density
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Locator, Page } from '@playwright/test'
import { DashboardWrapper } from './helpers'
import { RankingPageHarness } from './ranking-helpers'
import ptMessages from '@/messages/pt.json'

const RANKING = ptMessages.Pages.Dashboard.ranking

/** The laptop the operator opens this on. The criterion is stated at this exact size. */
const LAPTOP = { width: 1440, height: 900 }

/** The narrow desktop the table may not scroll sideways at (§11.2). */
const NARROW = { width: 1280, height: 900 }

async function bottomOf(locator: Locator): Promise<number> {
  return locator.evaluate((el) => el.getBoundingClientRect().bottom)
}

/** Every element §11.3 names, in the order it stacks, with the value each one measured. */
async function measure(page: Page): Promise<Record<string, number>> {
  const table = page.locator('table').last()
  const rows = table.locator('tbody tr')
  const measurements: Record<string, number> = {
    h1: await bottomOf(page.locator('h1')),
    card_accounts: await bottomOf(
      page.getByText(RANKING.kpi.accounts_scored, { exact: true }).locator('xpath=ancestor::div[2]')
    ),
    card_ratio: await bottomOf(
      page.getByText(RANKING.kpi.ratio, { exact: true }).locator('xpath=ancestor::div[2]')
    ),
    diagnostic: await bottomOf(page.getByTestId('ranking-diagnostic')),
    chips: await bottomOf(page.locator('section header').last()),
    column_band: await bottomOf(table.locator('thead tr').last()),
  }

  const count = await rows.count()
  for (let index = 0; index < count; index += 1) {
    measurements[`row_${index + 1}`] = await bottomOf(rows.nth(index))
  }

  measurements.tfoot = await bottomOf(table.locator('tfoot tr'))
  measurements.page = await bottomOf(page.locator('body > div').first())
  return measurements
}

/**
 * THE ONE CRITERION. Nothing is touched before measuring: the chip the page is born with, the
 * columns it is born with, the period it is born with.
 */
test('#742 · spec §11.3 · DS-COMPONENTE-081: at 1440 × 900 the whole scoreboard is on screen, untouched', async ({
  mount,
  page,
}) => {
  await page.setViewportSize(LAPTOP)
  await mount(
    <DashboardWrapper>
      <RankingPageHarness />
    </DashboardWrapper>
  )

  const measurements = await measure(page)
  console.log('§11.3 measurements at 1440×900:', JSON.stringify(measurements))

  // FIVE ROWS, NOT SIXTEEN: the chip is born on `Pontuaram` (§11.2), and the eleven accounts that
  // scored nothing are one click away in `Todas 16`, never in the way of the five that are the
  // scoreboard.
  await expect(page.locator('table').last().locator('tbody tr')).toHaveCount(5)

  for (const [name, bottom] of Object.entries(measurements)) {
    if (name === 'page') continue
    expect(bottom, `${name} must end above the fold of a 1440 × 900 laptop`).toBeLessThanOrEqual(
      LAPTOP.height
    )
  }
})

/**
 * THE LESSON OF THE DEAD PANEL, APPLIED TO WHAT SURVIVED — §11.3.
 *
 * `bottom ≤ 900` alone is satisfied by a block whose own scroller hides half of it: the sticky
 * `tfoot` of a table taller than its scroller sits exactly at the scroller's edge, and the rows it
 * totals are not on screen at all.
 */
test('#742 · spec §11.3: nothing on the page scrolls inside itself, and the table scroller has nothing left to scroll', async ({
  mount,
  page,
}) => {
  await page.setViewportSize(LAPTOP)
  await mount(
    <DashboardWrapper>
      <RankingPageHarness />
    </DashboardWrapper>
  )

  const overflowing = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('div, section'))
      .filter((el) => el.scrollHeight > el.clientHeight + 1)
      .map((el) => el.className.slice(0, 60))
  )

  expect(overflowing, 'no block hides part of itself behind its own scrollbar').toEqual([])
})

/**
 * SEVEN COLUMNS FIT; TWELVE NEVER DID — §11.2. The five comparison columns are born collapsed
 * behind the `Comparações` switch, and `min-w-[1040px]` only applies with them open.
 */
test('#742 · spec §11.2 · DS-COMPONENTE-083: at 1280 px the table does not scroll sideways, and the comparisons bring the columns back', async ({
  mount,
  page,
}) => {
  await page.setViewportSize(NARROW)
  await mount(
    <DashboardWrapper>
      <RankingPageHarness />
    </DashboardWrapper>
  )

  const table = page.locator('table').last()
  const scroller = table.locator('xpath=ancestor::div[contains(@class,"custom-scrollbar")]')

  // `#`, `Pessoa`, `País explorado`, `Pontos`, `Disparos`, `Pts de km`, `Sequência`.
  await expect(table.locator('thead tr').last().locator('th')).toHaveCount(7)
  // With one group left, `PLACAR OFICIAL` over the only thing on the screen is a tautology: the
  // band does not render, and `HEAD` sticks at the top of the scroller instead of 28 px below it.
  await expect(table.locator('thead tr')).toHaveCount(1)

  const before = await scroller.evaluate((el) => el.scrollWidth - el.clientWidth)
  expect(before, 'seven columns fit a 1280 px desktop').toBeLessThanOrEqual(1)

  await page.getByTestId('ranking-comparisons').check()

  await expect(table.locator('thead tr').last().locator('th')).toHaveCount(12)
  await expect(table.locator('thead tr')).toHaveCount(2)
})
