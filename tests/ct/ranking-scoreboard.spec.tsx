/**
 * THE SCOREBOARD, IN A BROWSER — #741.
 *
 * Four claims of the card cannot be answered by reading source, because they are about what the
 * operator gets on screen without touching anything:
 *
 * 1. the internal-account filter is ON by default, and the marked row is not there;
 * 2. the `#` column reads the position that EXCLUDES internal accounts while the filter is on,
 *    and it does not renumber when another column sorts the table (`DS-COMPONENTE-082` item 3);
 * 3. a negative difference prints with its sign, not as `0 min`;
 * 4. a period before the meter prints `—` in the minute columns and raises a band.
 *
 * See `playwright-ct.config.ts` for why this is a component mount and not a page navigation.
 * Run with: npx playwright test -c playwright-ct.config.ts ranking-scoreboard
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { DashboardWrapper } from './helpers'
import { RankingScoreboardHarness } from './ranking-helpers'
import { ROWS, WEEK_BEFORE_METER } from './ranking-fixtures'
import ptMessages from '@/messages/pt.json'

const RANKING = ptMessages.Pages.Dashboard.ranking

test('#740: the marked account does not render, and the switch brings it back', async ({
  mount,
  page,
}) => {
  await mount(
    <DashboardWrapper>
      <RankingScoreboardHarness />
    </DashboardWrapper>
  )

  // `exact`, because the chevron of the same row is named `Abrir os detalhes de <person>` and a
  // substring match would count the row twice.
  // Without this filter the first thing the operator sees is himself in first place.
  await expect(page.getByRole('button', { name: 'tuggi-operator', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'hoppy-otter', exact: true })).toHaveCount(1)

  await page.getByTestId('include-internal').check()

  await expect(page.getByRole('button', { name: 'tuggi-operator', exact: true })).toHaveCount(1)
  // "Does not count" is not "does not play": the row comes back wearing the mark.
  await expect(page.getByText(RANKING.internal.badge, { exact: true })).toHaveCount(1)
})

test('#740: with zero accounts marked, the band that says the filter removes nobody', async ({
  mount,
  page,
}) => {
  await mount(
    <DashboardWrapper>
      <RankingScoreboardHarness rows={ROWS.slice(1)} internalAccounts={0} />
    </DashboardWrapper>
  )

  // The state in which the screen most easily lies: a scoreboard that is not filtered wearing
  // the face of one that is.
  await expect(page.getByText(RANKING.internal.none_marked)).toBeVisible()
})

test('#740: the band is absent when the mark is actually removing somebody', async ({
  mount,
  page,
}) => {
  await mount(
    <DashboardWrapper>
      <RankingScoreboardHarness />
    </DashboardWrapper>
  )

  await expect(page.getByText(RANKING.internal.none_marked)).toHaveCount(0)
})

test('DS-COMPONENTE-082 item 3: `#` is a value, and sorting does not renumber it', async ({
  mount,
  page,
}) => {
  await mount(
    <DashboardWrapper>
      <RankingScoreboardHarness />
    </DashboardWrapper>
  )

  const firstCell = (rowIndex: number) =>
    page.locator('tbody tr').nth(rowIndex).locator('td').first()

  // Filter on: the column reads `rank_excluding_internal` — 1 and 2, not the 2 and 3 of
  // `rank_official`.
  await expect(firstCell(0)).toContainText('1')
  await expect(firstCell(1)).toContainText('2')

  // Sorting by the difference puts the other account on top, and her position stays hers.
  await page.getByRole('button', { name: RANKING.table.gap }).click()
  await expect(firstCell(0)).toContainText('1')
  await expect(page.locator('tbody tr').first()).toContainText('hoppy-otter')
})

test('DS-COMPONENTE-084 item 3: a negative difference keeps its sign', async ({ mount, page }) => {
  await mount(
    <DashboardWrapper>
      <RankingScoreboardHarness />
    </DashboardWrapper>
  )

  // `formatDuration(-12)` would print `0 min` and erase the one fact the column exists for.
  await expect(page.getByRole('button', { name: '−12 min' })).toBeVisible()
  await expect(page.getByRole('button', { name: '+2 h 5 min' })).toHaveCount(0)
})

test('DS-COMPONENTE-084 item 1: a period before the meter prints an em dash, never a zero', async ({
  mount,
  page,
}) => {
  await mount(
    <DashboardWrapper>
      <RankingScoreboardHarness period={WEEK_BEFORE_METER} internalAccounts={1} />
    </DashboardWrapper>
  )

  await expect(page.getByText(RANKING.meter.none)).toBeVisible()

  // The three minute columns of the first rendered row: points from minutes, charged, and the
  // difference. `0 min` there would assert a measurement nobody made.
  const cells = page.locator('tbody tr').first().locator('td')
  await expect(cells.filter({ hasText: '0 min' })).toHaveCount(0)
  await expect(page.getByText('—').first()).toBeVisible()
})

test('DS-COMPONENTE-083 item 1: the weight-2 comparison prints the reordering in words too', async ({
  mount,
  page,
}) => {
  await mount(
    <DashboardWrapper>
      <RankingScoreboardHarness />
    </DashboardWrapper>
  )

  // `hoppy-otter` is 2nd officially and 4th by the notable weight: two positions DOWN, and the
  // baseline is `rank_official` — never the `#` column, which says 1 for her.
  await expect(
    page.getByLabel(RANKING.table.delta_down.replace('{count}', '2'))
  ).toBeVisible()
})

/**
 * `axe` over the mounted table — what a source scan cannot answer, because it only exists after
 * the CSS resolves. Scoped to `#root` for the reason `finance-a11y.spec.tsx` already records:
 * `playwright/index.html` is a component fixture and has neither `<title>` nor `<html lang>`,
 * and measuring the harness is not measuring the screen.
 */
async function expectAxeClean(page: Page) {
  const results = await new AxeBuilder({ page })
    .include('#root')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()

  expect(
    results.violations,
    results.violations.map((v) => `${v.id} (${v.nodes.length}): ${v.help}`).join(' · ')
  ).toEqual([])
}

test('the table passes axe with the internal filter on and off', async ({ mount, page }) => {
  await mount(
    <DashboardWrapper>
      <RankingScoreboardHarness />
    </DashboardWrapper>
  )

  await expectAxeClean(page)

  // The switch adds a column, a badge and a second position per row — three more chances.
  await page.getByTestId('include-internal').check()
  await expectAxeClean(page)
})

test('the expanded row passes axe too', async ({ mount, page }) => {
  await mount(
    <DashboardWrapper>
      <RankingScoreboardHarness />
    </DashboardWrapper>
  )

  await page.getByRole('button', { name: /Abrir os detalhes/ }).first().click()
  await expectAxeClean(page)
})
