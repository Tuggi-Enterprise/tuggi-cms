/**
 * #742 — THE COMPOSED CYCLES, IN A BROWSER.
 *
 * Spec `docs/design/spec-placar-cms-2026-09.md`, §9 criteria 28 to 30. What is proved here is the
 * part of the entry that only a DOM answers: which columns exist and what a cell prints. The
 * arithmetic, the two instrument boundaries and the copy are in
 * `tests/api/ranking-composed-cycles.test.ts`.
 *
 * Criteria 31 to 36 measured the calibration panel, which left the screen in §11.1: the tests that
 * cited them left the suite in the same commit, as §9 requires.
 *
 * THE CLAIM AT THE CENTRE: in `month` and `year` the same column name carries a DIFFERENT
 * quantity (**BR-RANKING-005**), and the only way that does not become a misreading is the table
 * not printing, there, the columns that make up the level below. `Disparos` summed over the whole
 * month next to `Pontos` drawn only from the podium weeks are two populations on one line.
 *
 * See `playwright-ct.config.ts` for why this is a component mount and not a page navigation.
 * Run with: npx playwright test -c playwright-ct.config.ts ranking-cycles
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { DashboardWrapper } from './helpers'
import { RankingScoreboardHarness } from './ranking-helpers'
import {
  MONTH,
  MONTH_ROWS,
  YEAR,
  YEAR_ROWS,
} from './ranking-fixtures'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import { PODIUM_POINTS_FLOOR } from '@/lib/ranking/scoreboard'
import ptMessages from '@/messages/pt.json'

const RANKING = ptMessages.Pages.Dashboard.ranking

/** The second band of the head — the one carrying the column names (`dense-table.tsx`). */
const COLUMN_NAMES = 'table thead tr:nth-child(2) th'

/**
 * THE SCOREBOARD'S OWN SECTION. It stopped being ambiguous when the calibration panel left the
 * screen (§11.1) and only one dense table remains — but the locator stays, because it says WHICH
 * table the assertion is about instead of relying on there being exactly one.
 */
const scoreboardOf = (page: import('@playwright/test').Page) =>
  page.locator('section').filter({ hasText: RANKING.filters.all })

test('#742 · BR-RANKING-005: a composed cycle prints four columns and no chevron', async ({
  mount,
  page,
}) => {
  await mount(
    <DashboardWrapper>
      <RankingScoreboardHarness
        rows={MONTH_ROWS}
        period={MONTH}
        periodLabel="Setembro de 2026 · UTC"
      />
    </DashboardWrapper>
  )

  const scoreboard = scoreboardOf(page)

  // FOUR, AND ONLY FOUR — spec §4.8, `DS-COMPONENTE-089` item 3.
  await expect(scoreboard.locator(COLUMN_NAMES)).toHaveText([
    RANKING.table.rank,
    RANKING.table.person,
    RANKING.table.points,
    RANKING.table.podium_weeks,
  ])

  // The ones that have no declared meaning in a composed cycle are gone, not merely empty.
  for (const absent of [
    RANKING.table.triggers,
    RANKING.table.points_from_km,
    RANKING.table.streak,
    RANKING.table.country,
    RANKING.table.notable_points,
    RANKING.table.charged,
    RANKING.table.gap,
  ]) {
    await expect(scoreboard.locator(COLUMN_NAMES).filter({ hasText: absent })).toHaveCount(0)
  }

  // NO CHEVRON: the expanded row is made of the quantities the composed cycle does not declare,
  // so an opener onto it would put the two populations back one click away.
  await expect(page.getByRole('button', { name: /Abrir os detalhes/ })).toHaveCount(0)

  // The chip of the minute axis has no column to stand next to here.
  await expect(page.getByRole('button', { name: RANKING.filters.all })).toBeVisible()
  await expect(page.getByRole('button', { name: RANKING.filters.scored })).toBeVisible()
  await expect(
    page.getByRole('button', { name: RANKING.filters.charged_without_trigger })
  ).toHaveCount(0)
})

test('#742 · BR-RANKING-005: the composition column counts weeks in `month` and months in `year`', async ({
  mount,
  page,
}) => {
  const component = await mount(
    <DashboardWrapper>
      <RankingScoreboardHarness
        rows={MONTH_ROWS}
        period={MONTH}
        periodLabel="Setembro de 2026 · UTC"
      />
    </DashboardWrapper>
  )

  const rows = scoreboardOf(page).locator('tbody tr')

  await expect(page.getByText(RANKING.table.podium_weeks, { exact: true })).toBeVisible()
  // The three rows: 3 weeks of podium, 1, and a counter that did not come back.
  await expect(rows.first().locator('td').last()).toHaveText('3')
  // `null` PRINTS THE EM DASH AND NEVER `0` — `0` would read as "no podium", which is false: an
  // account with no podium week has no `month` row at all (contract, Parte 7).
  await expect(rows.last().locator('td').last()).toHaveText(UNKNOWN_VALUE)

  await component.update(
    <DashboardWrapper>
      <RankingScoreboardHarness rows={YEAR_ROWS} period={YEAR} periodLabel="Ano de 2026 · UTC" />
    </DashboardWrapper>
  )

  // ONE LEVEL UP THE UNIT CHANGES: summing the monthly counters would give the year's podium
  // WEEKS, which is another quantity with the same name.
  await expect(page.getByText(RANKING.table.podium_months, { exact: true })).toBeVisible()
  await expect(page.getByText(RANKING.table.podium_weeks, { exact: true })).toHaveCount(0)
})

test('#742 · BR-RANKING-003 · BR-RANKING-006: no seal in a composed cycle, and the ordinal still prints', async ({
  mount,
  page,
}) => {
  await mount(
    <DashboardWrapper>
      <RankingScoreboardHarness
        rows={MONTH_ROWS}
        period={MONTH}
        periodLabel="Setembro de 2026 · UTC"
      />
    </DashboardWrapper>
  )

  // `RankSeal` knows how to draw the three cycles and the month has a real `rank_official`. What
  // it does not have is a RULE: the seal asserts a podium, a podium has a floor, and the only
  // floor written down is the weekly one. Gold here would assert a prize band nobody defined.
  const rows = scoreboardOf(page).locator('tbody tr')

  await expect(page.getByText('1º lugar')).toHaveCount(0)
  await expect(rows.first().locator('td').first()).toHaveText('1')
  await expect(rows.nth(1).locator('td').first()).toHaveText('2')
})

test('#742 · BR-RANKING-005: the `<caption>` of a composed cycle declares what `Pontos` now sums', async ({
  mount,
  page,
}) => {
  await mount(
    <DashboardWrapper>
      <RankingScoreboardHarness
        rows={MONTH_ROWS}
        period={MONTH}
        periodLabel="Setembro de 2026 · UTC"
      />
    </DashboardWrapper>
  )

  const legend = page.getByTestId('ranking-legend')

  // The floor arrives from `PODIUM_POINTS_FLOOR` through `{floor}`: no `10` is typed into a
  // string in any of the three languages (CLAUDE.md §6).
  await expect(legend).toContainText(String(PODIUM_POINTS_FLOOR))
  await expect(legend).toContainText('pódio daquele mês')

  // And the five declarations about columns that no longer render are gone with them.
  await expect(legend).not.toContainText('País explorado')
  await expect(legend).not.toContainText('Intervalo de sinal no período')
})

/**
 * #742 · spec §9 critério 16 — THE TWO NEW SURFACES PASS `axe`.
 *
 * Both are tables and both were built out of `components/ui/dense-table.tsx`, so what is at risk
 * here is not the primitive: it is the two things this entry added ON TOP of it — a `<th
 * scope="row">` whose whole content is a `<button>` in the panel, and a composed head whose group
 * band is empty. A band with no accessible name and a row header with no text are exactly the
 * shapes `axe` catches and a human reading the screen does not.
 */
async function expectNoViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .include('#root')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()

  expect(
    results.violations,
    results.violations.map((v) => `${v.id} (${v.nodes.length}): ${v.help}`).join(' · ')
  ).toEqual([])
}

test('#742: a composed cycle passes axe, with the switch off and on', async ({ mount, page }) => {
  await mount(
    <DashboardWrapper>
      <RankingScoreboardHarness
        rows={MONTH_ROWS}
        period={MONTH}
        periodLabel="Setembro de 2026 · UTC"
      />
    </DashboardWrapper>
  )

  await expectNoViolations(page)

  // With the switch on the table grows a column (`sem internas`) and a row comes back wearing the
  // mark — a different head and a different body, so a second pass is not redundant.
  await page.getByTestId('include-internal').check()
  await expectNoViolations(page)
})
