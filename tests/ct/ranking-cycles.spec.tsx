/**
 * #742 — THE COMPOSED CYCLES AND THE CALIBRATION PANEL, IN A BROWSER.
 *
 * Spec `docs/design/spec-placar-cms-2026-09.md`, §9 criteria 28 to 36. What is proved here is the
 * part of the entry that only a DOM answers: which columns exist, what a cell prints, and that a
 * click on the panel changes the selected period. The arithmetic, the two instrument boundaries
 * and the copy are in `tests/api/ranking-composed-cycles.test.ts`.
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
  CALIBRATION,
  CALIBRATION_WEEKS,
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
 * THE SCOREBOARD'S OWN SECTION, and it has to be said out loud: since #742 there are TWO dense
 * tables on this screen and the calibration panel renders FIRST, so a bare `tbody tr` reaches the
 * panel's thirteen weeks and not the scoreboard's rows. The filter chips exist only in the
 * scoreboard's header, which is what tells the two apart.
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

// ── The calibration panel ──────────────────────────────────────────────────────────────────

test('#742 · DS-COMPONENTE-084 item 2: the panel prints the 13 weeks, tags the eight floors and totals the five measured', async ({
  mount,
  page,
}) => {
  await mount(
    <DashboardWrapper>
      <RankingScoreboardHarness calibration={CALIBRATION} />
    </DashboardWrapper>
  )

  const panel = page.getByTestId('ranking-km-calibration')
  await expect(panel).toBeVisible()

  // THE WHOLE HORIZON, whatever period is selected — the question the panel answers is about the
  // axis and not about the week the operator happens to be reading.
  await expect(panel.locator('tbody tr')).toHaveCount(CALIBRATION_WEEKS.length)

  // Eight of the thirteen are below `ENTITLEMENT_LEDGER_START`, and the floor is marked ON the
  // value rather than instead of it: the instrument is incomplete, not absent.
  await expect(panel.getByText(RANKING.calibration.floor, { exact: true })).toHaveCount(8)

  // A floor week answers neither the share nor the counterfactual.
  const firstWeek = panel.locator('tbody tr').first()
  await expect(firstWeek.locator('td').nth(2)).toHaveText(UNKNOWN_VALUE)
  await expect(firstWeek.locator('td').nth(3)).toHaveText(UNKNOWN_VALUE)

  // And the footer says how many weeks it summed — it does NOT match the 25,6 % of the contract,
  // and that is the correct behaviour (spec §9 critério 34).
  await expect(panel.locator('tfoot')).toContainText('5 semanas com instrumento')
})

test('#742 · DS-COMPONENTE-083 item 2: `1º sem o km` says `=`, or names who would have won', async ({
  mount,
  page,
}) => {
  await mount(
    <DashboardWrapper>
      <RankingScoreboardHarness calibration={CALIBRATION} />
    </DashboardWrapper>
  )

  const panel = page.getByTestId('ranking-km-calibration')

  // THE WEEK WHERE THE KM DECIDED THE WINNER. Officially `quiet-tapir` leads it (13 against 12)
  // because the kilometre carried her; without that axis `hoppy-otter` leads on history alone
  // (10 against 8), and the cell names HIM — the counterfactual, not the champion.
  await expect(panel.getByText('hoppy-otter', { exact: true })).toHaveCount(1)
  await expect(panel.getByLabel(RANKING.calibration.winner_unchanged)).toHaveCount(4)
})

test('#742: the panel never follows the internal-account switch', async ({ mount, page }) => {
  await mount(
    <DashboardWrapper>
      <RankingScoreboardHarness calibration={CALIBRATION} />
    </DashboardWrapper>
  )

  const panel = page.getByTestId('ranking-km-calibration')
  const totals = panel.locator('tfoot')
  const before = await totals.textContent()

  await page.getByTestId('include-internal').check()

  // The internal account holds a thousand points per week in the fixture: if the panel ever
  // followed the switch, every number in this footer would move at once (spec §2.2).
  await expect(totals).toHaveText(before ?? '')
})

test('#742: clicking a week of the panel selects that week', async ({ mount, page }) => {
  await mount(
    <DashboardWrapper>
      <RankingScoreboardHarness calibration={CALIBRATION} />
    </DashboardWrapper>
  )

  const panel = page.getByTestId('ranking-km-calibration')
  await panel.locator('tbody tr').last().getByRole('button').click()

  // The panel is a way INTO the scoreboard, and a period change travels through the state the
  // `<select>` reads and through the URL — never through a third path of its own.
  await expect(page.getByTestId('selected-week')).toHaveText(
    CALIBRATION_WEEKS[CALIBRATION_WEEKS.length - 1].start
  )
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

test('#742: the calibration panel passes axe', async ({ mount, page }) => {
  await mount(
    <DashboardWrapper>
      <RankingScoreboardHarness calibration={CALIBRATION} />
    </DashboardWrapper>
  )

  await expectNoViolations(page)
})

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
