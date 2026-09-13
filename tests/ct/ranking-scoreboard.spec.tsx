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
import { ROWS, WEEK_BEFORE_METER, scrollingRows } from './ranking-fixtures'
import ptMessages from '@/messages/pt.json'
import esMessages from '@/messages/es.json'

const RANKING = ptMessages.Pages.Dashboard.ranking

/** `h-7` in `components/ui/dense-table.tsx`, and the `top-7` of the band below depends on it. */
const GROUP_BAND_PX = 28

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

// ── The two sticky bands, measured ────────────────────────────────────────────────────────

/**
 * #752 — `DS-COMPONENTE-081` CLAUSE 2, AND IT ONLY EXISTS IN A BROWSER.
 *
 * `h-7` on a table cell is a MINIMUM, not a ceiling: a group label that wraps pushes the band of
 * groups down and leaves the band of column names glued where it was — underneath it, because
 * `GROUP` is `z-20` and `HEAD` is `z-10`. Measured before the fix, at 1280 × 800 with the table
 * scrolled: 38px in `pt` and 74px in `es` with the switch ON, against the 28px the second band
 * sticks to. In `es` the thirteen column names disappeared whole, on a screen that exists to
 * compare columns.
 *
 * The test runs in the two languages ON PURPOSE. `pt` alone goes green while it is broken — the
 * 10px of overlap there happen to eat the `py-2.5` of `HEAD` and nothing gets cut — so a
 * measurement taken only in the language of the office proves nothing about the defect.
 *
 * `DS-COMPONENTE-083` item 3 is the other half: the population of the comparison moved out of
 * the group label and into the `<caption>`, which is what keeps the label one line long.
 */
for (const locale of ['pt', 'es'] as const) {
  const file = locale === 'es' ? esMessages : ptMessages

  test(`DS-COMPONENTE-081 clause 2: in ${locale}, with the switch on and the table scrolled, the band of groups measures ${GROUP_BAND_PX}px and covers no column name`, async ({
    mount,
    page,
  }) => {
    // The size the design measured at. The two bands are a geometry, and geometry has a width.
    await page.setViewportSize({ width: 1280, height: 800 })

    await mount(
      <DashboardWrapper locale={locale}>
        <RankingScoreboardHarness rows={scrollingRows()} />
      </DashboardWrapper>
    )

    // The switch ON is the worst case: it adds the `sem internas` column and the widest header.
    await page.getByTestId('include-internal').check()

    const scroller = page.locator('.custom-scrollbar')
    await scroller.evaluate((element) => {
      element.scrollTop = 400
    })
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0)

    const groups = page.locator('thead tr').first()
    const columns = page.locator('thead tr').nth(1)
    const groupBox = (await groups.boundingBox())!
    const columnBox = (await columns.boundingBox())!

    expect(Math.round(groupBox.height), `${locale}: the band of groups grew past its own ceiling`).toBe(
      GROUP_BAND_PX
    )
    // `top-7` is only correct while the band above measures exactly 28px: below that the second
    // band is not late, it is UNDERNEATH.
    expect(
      Math.round(columnBox.y - groupBox.y),
      `${locale}: the band of column names starts inside the band of groups`
    ).toBeGreaterThanOrEqual(GROUP_BAND_PX)

    // And the proof the operator would accept: whatever the browser paints at the centre of the
    // `#` header IS the `#` header. `toBeInViewport` would pass on a covered cell.
    const rank = page.getByRole('columnheader', { name: file.Pages.Dashboard.ranking.table.rank, exact: true })
    await expect(rank).toBeInViewport()
    const covered = await rank.evaluate((element) => {
      const box = element.getBoundingClientRect()
      const painted = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
      return !element.contains(painted)
    })
    expect(covered, `${locale}: the band of groups is painted over the name of the column`).toBe(
      false
    )
  })
}

// ── The ruler, next to the numbers it rules ───────────────────────────────────────────────

/**
 * #753 — `DS-COPY-062` item 3: a population restriction is part of the LABEL.
 *
 * With the switch on, the card `Contas que pontuaram` says 2 while the chip `Todas` right below
 * says 3 — the indicators keep ignoring internal accounts (contract, Parte 7) and the table does
 * not. The line that explains it used to live in the switch block, ~200px away in the top-right
 * corner; the contradiction is here, so the explanation is here.
 */
test('#753: the line about the indicators is the sibling immediately above the six cards, and only with the switch on', async ({
  mount,
  page,
}) => {
  await mount(
    <DashboardWrapper>
      <RankingScoreboardHarness />
    </DashboardWrapper>
  )

  const note = page.getByText(RANKING.internal.aggregates_note, { exact: true })

  // Off, the two populations coincide and the line would be noise in every normal reading.
  await expect(note).toHaveCount(0)

  await page.getByTestId('include-internal').check()
  await expect(note).toHaveCount(1)

  const neighbour = await note.evaluate((element) => ({
    text: element.nextElementSibling?.textContent ?? '',
    gap:
      (element.nextElementSibling?.getBoundingClientRect().top ?? 0) -
      element.getBoundingClientRect().bottom,
  }))

  expect(neighbour.text).toContain(RANKING.kpi.accounts_scored)
  expect(neighbour.gap, 'the ruler is glued to the numbers it rules').toBeLessThanOrEqual(24)
})

// ── The refusal that has a phrase ─────────────────────────────────────────────────────────

/**
 * #755 — the phrase that names `42501` had no way of appearing: the screen asked
 * `message.includes('42501')` and a `PostgrestError` keeps the SQLSTATE in `code`. Both
 * branches are tested because neither was reachable before.
 */
test('#755: `42501` gets the phrase that names the cause, and any other code gets the generic one', async ({
  mount,
  page,
}) => {
  const component = await mount(
    <DashboardWrapper>
      <RankingScoreboardHarness
        error={{ message: 'permission denied for view ranking_scoreboard', code: '42501' }}
      />
    </DashboardWrapper>
  )

  await expect(page.getByText(RANKING.error.forbidden)).toBeVisible()
  await expect(page.getByText(RANKING.error.title)).toHaveCount(0)

  // A timeout is not a grant problem, and telling the operator to go fix a grant would send him
  // to the wrong place — the generic phrase is the honest one.
  await component.update(
    <DashboardWrapper>
      <RankingScoreboardHarness error={{ message: 'canceling statement due to statement timeout', code: '57014' }} />
    </DashboardWrapper>
  )

  await expect(page.getByText(RANKING.error.title)).toBeVisible()
  await expect(page.getByText(RANKING.error.forbidden)).toHaveCount(0)
})
