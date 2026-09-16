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
import { ROWS, WEEK_ACROSS_METER, WEEK_BEFORE_METER, scrollingRows } from './ranking-fixtures'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import ptMessages from '@/messages/pt.json'
import esMessages from '@/messages/es.json'
import enMessages from '@/messages/en.json'

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

// ── The read that did not happen, and the one that happened and came back empty ───────────

/**
 * #741, SEEN IN THE FIELD — the read failed and everything above the red band kept counting.
 *
 * The views were not applied yet, the route answered an error, and the screen printed six
 * indicators at `0`, three chips at `0` and the amber band describing the population of a read
 * that never happened. `DS-COMPONENTE-084` item 1 at the level of the screen: `0` is a
 * measurement, and a failed read made none.
 *
 * THE TWO TESTS ARE ONE CLAIM, and neither half alone states it: the failure prints `—` and no
 * count, AND a read that came back with nothing still prints `0` and still raises the band —
 * because that `0` is the answer. A suite with only the first half passes on a screen that
 * stopped counting altogether.
 */
test('DS-COMPONENTE-084 item 1 · DS-COPY-062: a failed read prints `—` and counts nothing', async ({
  mount,
  page,
}) => {
  await mount(
    <DashboardWrapper>
      <RankingScoreboardHarness
        rows={[]}
        internalAccounts={0}
        error={{ message: 'relation "core.ranking_scoreboard" does not exist', code: '42P01' }}
      />
    </DashboardWrapper>
  )

  // The band that IS right stays right: it is what the whole screen now hangs on.
  await expect(page.getByText(RANKING.error.title)).toBeVisible()
  await expect(page.getByRole('button', { name: RANKING.error.retry })).toBeVisible()

  // The six indicators of a week — the five fixed ones plus the streak. Not one of them `0`,
  // and no subtitle either: `0 pts · 0 pts` is a reading of a reading.
  await expect(page.getByText(UNKNOWN_VALUE, { exact: true })).toHaveCount(6)
  await expect(page.getByText('0 pts de disparo · 0 pts de km')).toHaveCount(0)
  await expect(page.getByText(RANKING.kpi.manual_listens_subtitle)).toHaveCount(0)
  await expect(page.getByText(RANKING.kpi.charged_without_trigger_subtitle)).toHaveCount(0)

  // The chip keeps the filter — it is the operator's, not the server's — and drops the number:
  // its accessible name becomes the label alone, with nothing after it.
  for (const label of [RANKING.filters.all, RANKING.filters.scored]) {
    await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: `${label} 0`, exact: true })).toHaveCount(0)
  }

  // Two sentences describe the RESULT of the internal filter, and with no read they describe
  // nothing: `internalAccounts` is `0` for want of an answer, not for want of a marked account.
  await expect(page.getByText(RANKING.internal.none_marked)).toHaveCount(0)
  await page.getByTestId('include-internal').check()
  await expect(page.getByText(RANKING.internal.aggregates_note)).toHaveCount(0)
})

test('DS-COMPONENTE-084 item 1: a read that answered nothing keeps its `0`, and its band', async ({
  mount,
  page,
}) => {
  await mount(
    <DashboardWrapper>
      <RankingScoreboardHarness rows={[]} internalAccounts={0} error={null} />
    </DashboardWrapper>
  )

  await expect(page.getByText(RANKING.error.title)).toHaveCount(0)

  // Nobody scored in the week IS a measurement, and the indicators say so.
  await expect(page.getByRole('button', { name: `${RANKING.filters.all} 0`, exact: true })).toBeVisible()
  await expect(page.getByText('0 pts de disparo · 0 pts de km')).toBeVisible()
  await expect(page.getByText(RANKING.kpi.manual_listens_subtitle)).toBeVisible()

  // The one dash a successful empty read prints: the ratio, whose denominator is zero
  // (`DS-COMPONENTE-084` item 2 — never `∞`, never `0`).
  await expect(page.getByText(UNKNOWN_VALUE, { exact: true })).toHaveCount(1)

  // And the band still has a read to be a condition of.
  await expect(page.getByText(RANKING.internal.none_marked)).toBeVisible()
})

// ── The period the numbers belong to ──────────────────────────────────────────────────────

/**
 * #741 — THE SCREEN STAMPS WHAT THE QUERY ANSWERED.
 *
 * The `<select>` is the only place a period appeared, and a control the operator has just
 * operated reads as *what I asked for*, never as *what I got*. `ScoreboardPayload.period` — the
 * period the route actually served — was read nowhere on the screen.
 */
test('#741: the stamp above the cards prints the served period and how many accounts it holds', async ({
  mount,
  page,
}) => {
  await mount(
    <DashboardWrapper>
      <RankingScoreboardHarness />
    </DashboardWrapper>
  )

  // Three accounts came back for the period; the switch is off and two of them render, which is
  // exactly why the stamp counts the READ and the line below it says the indicators do not.
  // #742 · DS-COMPONENTE-089 item 2: the stamp gained a third segment, the NATURE of the window
  // served — a week is competition, a rolling window is calibration, and the operator cannot read
  // one as the other.
  await expect(
    page.getByText(
      RANKING.period.stamp
        .replace('{period}', 'Semana de 31/08 a 06/09 · UTC')
        .replace('{nature}', RANKING.period.nature_competition)
        .replace(/\{count.*\}/, '3 contas no período')
    )
  ).toBeVisible()

  await expect(page.getByText(RANKING.period.served_differs.slice(0, 12))).toHaveCount(0)
})

test('#741: a period other than the one asked for raises a band, and the stamp names the one served', async ({
  mount,
  page,
}) => {
  await mount(
    <DashboardWrapper>
      <RankingScoreboardHarness
        periodLabel="Semana de 17/08 a 23/08 · UTC"
        selection={{ kind: 'week', start: '2026-08-17T00:00:00+00:00' }}
        served={{ period: { kind: 'rolling_30d', start: null }, label: 'Últimos 30 dias' }}
      />
    </DashboardWrapper>
  )

  // The route falls back silently on an unusable parameter; the screen is where that stops being
  // silent — and the numbers below belong to the period it fell back to.
  await expect(
    page.getByText(
      RANKING.period.served_differs
        .replace('{pedido}', 'Semana de 17/08 a 23/08 · UTC')
        .replace('{servido}', 'Últimos 30 dias')
    )
  ).toBeVisible()
  // And the nature is the SERVED one too: the fallback landed on a calibration window, and the
  // stamp says so next to the numbers that came out of it.
  await expect(
    page.getByText(
      new RegExp(`Últimos 30 dias · ${RANKING.period.nature_calibration} · 3 contas no período`)
    )
  ).toBeVisible()
})

/**
 * #749 · BR-RANKING-004 — THE METER STOPPED BEING A CONDITION OF THE SCORE, AND STAYED ONE OF THE
 * TIME COLUMNS.
 *
 * This card used to divide trigger points by MINUTE points, so a window the ledger covers only in
 * part could not carry a fraction at all. Since `20260916130000` the denominator is the kilometre
 * axis, which the view computes for every period it serves: the fraction is printed, and the
 * amber band still warns — about `Cobrado`, `Intervalo` and `Diferença`, which are what the
 * ledger's boundary was always about.
 */
test('#749: with the meter covering only part of the window, the score ratio is printed and the band still warns', async ({
  mount,
  page,
}) => {
  await mount(
    <DashboardWrapper>
      <RankingScoreboardHarness period={WEEK_ACROSS_METER} periodLabel="Semana de 17/08 a 23/08 · UTC" />
    </DashboardWrapper>
  )

  await expect(page.getByText(RANKING.meter.partial)).toBeVisible()

  // 52 pts of trigger over 4,29 pts of km — the two parcels of `points_official`, one ruler.
  await expect(page.getByText('12,1 : 1')).toBeVisible()
  await expect(page.getByText('52 pts de disparo · 4,29 pts de km')).toBeVisible()
})

test('#741: the footer totals the two point columns, and leaves the two that do not sum empty', async ({
  mount,
  page,
}) => {
  await mount(
    <DashboardWrapper>
      <RankingScoreboardHarness />
    </DashboardWrapper>
  )

  // 49,29 + 7 over the two rows the filter leaves: the answer to *does the weight 2 change the
  // total?* (65 against 56,29) now exists on the screen that exists to ask it.
  // The week has a streak column, so the cells are: Pontos, Disparos, Pts de km, Sequência,
  // Pts peso 2, Δ vs. oficial, Cobrado, Intervalo, Diferença.
  const cells = page.locator('tfoot td')
  await expect(cells.nth(0)).toHaveText('56,29')
  await expect(cells.nth(4)).toHaveText('65')

  // The delta is a permutation of sum zero and the streak is a fraction of seven days.
  await expect(cells.nth(3)).toHaveText('')
  await expect(cells.nth(5)).toHaveText('')
})

/**
 * #741 — A WEEK OUTSIDE THE HORIZON IS NOT AN EMPTY WEEK. The view serves the 13 most recent
 * weeks and rolls every Monday; the URL is made to be pasted, so a link saved months ago lands
 * here and got told *nobody scored* — a measurement over a period nobody looked at.
 */
test('#741: a week older than the horizon says so, instead of answering that nobody scored', async ({
  mount,
  page,
}) => {
  await mount(
    <DashboardWrapper>
      <RankingScoreboardHarness
        rows={[]}
        period={null}
        periodLabel="Semana de 05/01 a 11/01 · UTC"
        selection={{ kind: 'week', start: '2026-01-05T00:00:00+00:00' }}
        served={{ period: { kind: 'week', start: '2026-01-05T00:00:00+00:00' }, label: 'Semana de 05/01 a 11/01 · UTC' }}
      />
    </DashboardWrapper>
  )

  await expect(page.getByText(RANKING.empty.out_of_horizon)).toBeVisible()
  await expect(
    page.getByText(RANKING.empty.period.replace('{period}', 'Semana de 05/01 a 11/01 · UTC'))
  ).toHaveCount(0)

  // And the meter is answered from the selection, which describes the week on its own: January
  // is before the ledger, so the minute axis is unknown — not `full` for want of an option.
  await expect(page.getByText(RANKING.meter.none)).toBeVisible()
})

// ── The declaration, where the cells are read ─────────────────────────────────────────────

/** The three facts arrive as ICU with `<b>` in them; on screen the bold is a `<strong>`. */
const plain = (text: string) => text.replace(/<\/?b>/g, '')

/**
 * #741 — `DS-COMPONENTE-083` ITEM 3, AND WHY A `<caption>` ALONE WAS NOT ENOUGH.
 *
 * The declarations lived inside `DenseTableScroller`, which is `overflow-auto`: 66px tall up to a
 * 1280px viewport, and gone on the first vertical scroll while the two header bands stayed glued.
 * The one that costs money is `Intervalo de sinal no período` — sorting by `Diferença`, the
 * sortable column of the biggest numbers, puts `+67 h` rows on top, and a scoreboard that shows
 * them with no sentence saying an open session with sparse signal inflates the span without
 * consuming balance reads as *we are failing to charge 67 hours*.
 *
 * THE LAST OF THEM IS `caption.sorting`, AND IT IS THE ONE THAT ALMOST STAYED HIDDEN. — *sorting the table does not recompute positions and
 * points* — stayed in the `sr-only` caption alone when the block was extracted, which put the
 * only sentence about the interaction out of reach of whoever performs it. It is the sentence
 * that blocks the likeliest wrong conclusion from a click on a column head: `#` is a value and
 * does not renumber (`DS-COMPONENTE-082` item 3).
 *
 * THE TWO HALVES ARE ONE CLAIM: a visible block the scroll cannot take away, and an `sr-only`
 * `<caption>` with the same keys in the same order, which is what a screen reader announces
 * before the first cell. Deleting either half to "clean up the duplication" brings a defect
 * back, and this test is what says so out loud.
 */
test('#741 · DS-COMPONENTE-083 item 3 · DS-COMPONENTE-082 item 3: the six declarations survive the scroll, and a screen reader still gets them before the first cell', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })

  await mount(
    <DashboardWrapper>
      <RankingScoreboardHarness rows={scrollingRows()} />
    </DashboardWrapper>
  )

  // The span declaration is the one of the CLIPPED column — `caption.span` describes a whole
  // session and belongs to `RankingSessionMetering`, where the row is the session.
  const defined = [
    RANKING.caption.span_in_period,
    RANKING.caption.platform,
    // Third since #741's country column: it is what stops `País explorado` next to a person's
    // name from being read as residence or nationality (`DS-COMPONENTE-086` item 5).
    RANKING.caption.country,
    // Fifth since the kilometre axis (**BR-RANKING-004**): `Pts de km` is not every kilometre —
    // 17,2% of the kilometre driven with the guide on had no entitlement and is not in it — and
    // on a screen that decides a prize the number alone reads as the distance of the trip.
    RANKING.caption.km,
    RANKING.caption.notable,
  ].map(plain)
  // The sixth defines no term, so it carries no `<b>` and gets no `<strong>`.
  const facts = [...defined, RANKING.caption.sorting]
  const legend = page.getByTestId('ranking-legend')
  const lines = legend.locator('p')

  await expect(lines).toHaveCount(6)
  for (const [index, fact] of facts.entries()) {
    await expect(lines.nth(index)).toHaveText(fact)
    // The term opens the line in bold: sentences of the same weight are a paragraph.
    await expect(lines.nth(index).locator('strong')).toHaveCount(index < defined.length ? 1 : 0)
  }

  // It is ABOVE the scroller, which is the whole point: what moves is the body.
  const scroller = page.locator('.custom-scrollbar')
  const before = (await legend.boundingBox())!
  const viewport = (await scroller.boundingBox())!
  expect(Math.round(before.y + before.height)).toBeLessThanOrEqual(Math.round(viewport.y) + 1)

  await scroller.evaluate((element) => {
    element.scrollTop = 400
  })
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)

  const after = (await legend.boundingBox())!
  expect(Math.round(after.y), 'the block moved with the body it is supposed to outlive').toBe(
    Math.round(before.y)
  )
  await expect(legend).toBeInViewport()

  // And the same six, in the same order, for whoever does not see them — the sentence about
  // sorting last, which is where the caption has always carried it.
  const caption = page.locator('table caption')
  await expect(caption).toHaveClass(/sr-only/)
  const spoken = (await caption.textContent()) ?? ''
  let cursor = -1
  for (const fact of facts) {
    const at = spoken.indexOf(fact)
    expect(at, `the caption no longer declares "${fact.slice(0, 28)}…"`).toBeGreaterThan(cursor)
    cursor = at
  }
})

/**
 * #741 — THE COLUMN THAT COST THE TIME GROUP ITS PLACE ON SCREEN.
 *
 * `Plataforma` spent ~110px on the width of its own header, not on its data (`android`/`ios`),
 * and below ~1200px it pushed `Diferença` — and with it the whole `Comparação · tempo` group —
 * past the right edge, where the operator has no way of knowing the group exists. The fact keeps
 * two homes on the screen: the `Contas que pontuaram` card and the expanded row.
 */
test('#741: `Plataforma` is no longer a column, and the fact is in the expanded row', async ({
  mount,
  page,
}) => {
  await mount(
    <DashboardWrapper>
      <RankingScoreboardHarness />
    </DashboardWrapper>
  )

  await expect(
    page.getByRole('columnheader', { name: RANKING.table.platform, exact: true })
  ).toHaveCount(0)

  const first = page.locator('tbody tr').first()
  await expect(first).toContainText('hoppy-otter')
  await expect(first.locator('td').filter({ hasText: 'ios' })).toHaveCount(0)

  await first.getByRole('button', { name: /Abrir os detalhes/ }).click()

  const details = page.locator('tbody tr').nth(1)
  await expect(details.getByText(RANKING.table.platform, { exact: true })).toBeVisible()
  await expect(details.getByText('ios', { exact: true })).toBeVisible()
})

/**
 * AND THE WIDTH THIS PROMISE HOLDS AT MOVED WITH #741's COUNTRY COLUMN — 1152px → 1280px.
 *
 * This test was written at 1152px, in the window between `Plataforma` leaving the table and
 * `País explorado` entering it. Measured in this harness, same fixture: the table's natural
 * width was 1267px with `Plataforma`, 1162px with neither, and 1260px with the country column —
 * so the group is on screen from ~1182px up, not from 1152px. That is the spec's own arithmetic
 * and not a surprise: §4.7 grants the new column "part of what `Plataforma` freed, and less than
 * `Plataforma` occupied", and says in the same paragraph that the `Comparação · tempo` group
 * "already falls off below ~1200px, and it is what pays for any excess".
 *
 * 1280px is the viewport criteria 19 and 24 are both measured at, so the guarantee is asserted
 * where the design states it. What the move does NOT do is make the assertion weaker in kind:
 * the claim is still that the last column of the time group is fully on screen, and that a
 * gradient promising "there is more" is never covering three whole columns of time.
 */
test('#741: with `Plataforma` gone and `País explorado` in, the `Comparação · tempo` group is on screen at 1280px', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })

  await mount(
    <DashboardWrapper>
      <RankingScoreboardHarness />
    </DashboardWrapper>
  )

  const scroller = page.locator('.custom-scrollbar')
  const gap = page.getByRole('columnheader', { name: RANKING.table.gap, exact: true })
  const column = (await gap.boundingBox())!
  const viewport = (await scroller.boundingBox())!

  expect(
    Math.round(column.x + column.width),
    'the last column of the time group is past the right edge'
  ).toBeLessThanOrEqual(Math.round(viewport.x + viewport.width))

  // The mechanism, and the reason the gradient is honest here: nothing is left to the right.
  // `DS-COMPONENTE-081` keeps the horizontal scroll for the widths where it is still needed —
  // and with the switch ON it is needed again at this very viewport, which is the trade §4.7
  // priced and accepted.
  const overflow = await scroller.evaluate((element) => element.scrollWidth - element.clientWidth)
  expect(overflow, 'the table still overflows at the width the design measured').toBeLessThanOrEqual(2)
})

/**
 * #741 · `DS-COMPONENTE-086` — THE COLUMN OF COUNTRY, AND THE THREE ROUTES TO THE NAME.
 *
 * The arithmetic of the flag and the guard in front of `Intl.DisplayNames` are proved without a
 * browser in `tests/api/ranking-country-flag.test.ts`. What only a browser answers is the claim
 * of criterion 23: the glyph is NOT the carrier of the name. So the assertions below are about
 * text nodes and about the accessibility tree — never about the emoji rendering, which is exactly
 * the thing a Windows machine does not do and which the design accepted (item 2).
 */
test('#741 · DS-COMPONENTE-086 item 2: the name reaches the sr-only node and the title, and the flag is hidden', async ({
  mount,
  page,
}) => {
  await mount(
    <DashboardWrapper>
      <RankingScoreboardHarness />
    </DashboardWrapper>
  )

  await expect(
    page.getByRole('columnheader', { name: RANKING.table.country, exact: true })
  ).toBeVisible()

  const first = page.locator('tbody tr').first()
  const cell = first.locator('td').filter({ hasText: 'Brasil' }).first()

  // The pointer got what the operator asked for.
  await expect(cell.locator('span[title="Brasil"]')).toHaveCount(1)
  // The screen reader gets the name as text, and the glyph is out of the tree — otherwise it
  // announces the country twice.
  await expect(cell.locator('.sr-only')).toHaveText('Brasil')
  await expect(cell.locator('[aria-hidden="true"]')).toHaveCount(1)
  // And nothing in the cell is a tab stop (item 3).
  await expect(cell.locator('[tabindex], button, a')).toHaveCount(0)
  // The hidden node holds the flag ALONE: concatenated to the name it would be announced as
  // "flag of Brazil, Brazil" — the thing `aria-hidden` is here to prevent.
  const flag = String.fromCodePoint(0x1f1e7, 0x1f1f7)
  await expect(cell.locator('[aria-hidden="true"]')).toHaveText(flag)
})

test('#741 · DS-COMPONENTE-086 item 6: an account whose country does not resolve prints the em dash', async ({
  mount,
  page,
}) => {
  await mount(
    <DashboardWrapper>
      <RankingScoreboardHarness />
    </DashboardWrapper>
  )

  // `quiet-tapir` entered the period with no visit carrying a recognizable country: `null` is
  // "does not resolve", and this table spells "zero" a different way everywhere else.
  const tapir = page.locator('tbody tr').filter({ hasText: 'quiet-tapir' }).first()
  // With the switch off the row is `<td>#</td><th>Pessoa</th><td>País explorado</td>…`, so the
  // country cell is the second `td` — asserting by position is what proves it is THIS column
  // printing the dash and not some other one that happens to have none.
  const country = tapir.locator('td').nth(1)
  await expect(country).toHaveText(UNKNOWN_VALUE)
  await expect(country.locator('[title], [aria-hidden="true"]')).toHaveCount(0)
})

test('#741 · DS-COMPONENTE-086 item 3: the expanded row carries the name in full, for the keyboard', async ({
  mount,
  page,
}) => {
  await mount(
    <DashboardWrapper>
      <RankingScoreboardHarness />
    </DashboardWrapper>
  )

  const first = page.locator('tbody tr').first()
  await first.getByRole('button', { name: /Abrir os detalhes/ }).click()

  const details = page.locator('tbody tr').nth(1)
  // Same key as the column header — one quantity, one redaction (`DS-COPY-062` item 4).
  await expect(details.getByText(RANKING.table.country, { exact: true })).toBeVisible()
  // The name in full, as a text node of the row: this is the route that does not need a pointer
  // and does not need the font to paint a flag.
  await expect(details.getByText('Brasil', { exact: true })).toBeVisible()
})

/**
 * #741 — CRITÉRIO 24: THE COLUMN FITS THE BUDGET IT WAS GIVEN, IN THE THREE LANGUAGES.
 *
 * WHAT THE SPEC ASKS AND WHAT THIS HARNESS CAN ANSWER ARE TWO DIFFERENT RULERS, and the
 * difference is a font. Spec §9, critério 24 sets an ABSOLUTE ceiling — natural width ≤ 1131px
 * at 1280px with the switch on — measured by the design on the real screen, which ships
 * `Inter` through `next/font` (`app/[locale]/layout.tsx`). A component mount has no Next font
 * pipeline and no network, so it paints in the browser's default sans and every header is a few
 * per cent wider. Measured here, in one session, same fixture, same viewport, switch on:
 *
 * | state | pt | es | en |
 * | :-- | --: | --: | --: |
 * | with `Plataforma` (51cac9e^) | 1267 | 1244 | 1267 |
 * | `Plataforma` out (e43f080) | 1162 | 1139 | 1162 |
 * | with `País explorado` (this commit) | 1260 | 1236 | 1256 |
 *
 * The baseline ALONE is 1162 in `pt`, above the spec's ceiling with no country column in the
 * table at all — so asserting 1131 here would not measure this commit, it would measure the
 * absence of Inter. What IS font-independent is the budget the spec actually granted the column
 * (§4.7): it spends part of what `Plataforma` freed and LESS than `Plataforma` occupied. That is
 * what these two assertions pin, and they fail the moment the column starts costing more than
 * the one it replaced — which is the failure critério 24 exists to prevent. The absolute number
 * is reported back to the `design` with these measurements.
 */

/** What `Plataforma` occupied, measured at 51cac9e^ in the three languages: 105px. */
const PLATFORM_COLUMN_PX = 105
/** And the width of the whole table while it still did — the ceiling the column inherits. */
const WIDTH_WITH_PLATFORM_PX = { pt: 1267, es: 1244, en: 1267 } as const

for (const locale of ['pt', 'es', 'en'] as const) {
  const file = locale === 'es' ? esMessages : locale === 'en' ? enMessages : ptMessages

  test(`#741 · DS-COMPONENTE-086 · critério 24: in ${locale}, the country column costs less than the one it replaced`, async ({
    mount,
    page,
  }) => {
    // The viewport of critério 19 and of critério 24, and the switch ON is the worst case: it
    // adds the `sem internas` column.
    await page.setViewportSize({ width: 1280, height: 800 })

    await mount(
      <DashboardWrapper locale={locale}>
        <RankingScoreboardHarness />
      </DashboardWrapper>
    )

    await page.getByTestId('include-internal').check()

    // THE NATURAL WIDTH IS NOT `scrollWidth`. The table is `w-full`, so inside a viewport wider
    // than its content it stretches and `scrollWidth` answers the width of the CONTAINER. What
    // the design calls natural is the width the table refuses to go below, which is what the
    // scroller has to carry: squeeze the host and read the table back.
    const natural = await page.locator('table').evaluate((element) => {
      const table = element as HTMLElement
      const host = element.closest('.custom-scrollbar')!.parentElement as HTMLElement
      const previousHost = host.style.width
      const previousTable = table.style.width
      host.style.width = '320px'
      table.style.width = 'min-content'
      const width = table.getBoundingClientRect().width
      host.style.width = previousHost
      table.style.width = previousTable
      return width
    })

    expect(
      Math.round(natural),
      `${locale}: the table is wider than it was WITH \`Plataforma\` — the column is spending more than it was given`
    ).toBeLessThanOrEqual(WIDTH_WITH_PLATFORM_PX[locale])

    const header = page.getByRole('columnheader', {
      name: file.Pages.Dashboard.ranking.table.country,
      exact: true,
    })
    const column = (await header.boundingBox())!

    expect(
      Math.round(column.width),
      `${locale}: the header stopped wrapping, or the cell stopped being one glyph`
    ).toBeLessThanOrEqual(PLATFORM_COLUMN_PX)
  })
}
