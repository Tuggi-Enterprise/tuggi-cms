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
  await expect(page.getByText('0 pts de disparo · 0 pts de minuto')).toHaveCount(0)
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
  await expect(page.getByText('0 pts de disparo · 0 pts de minuto')).toBeVisible()
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
  await expect(
    page.getByText(
      RANKING.period.stamp
        .replace('{period}', 'Semana de 31/08 a 06/09 · UTC')
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
  await expect(page.getByText(/Últimos 30 dias · 3 contas no período/)).toBeVisible()
})

/**
 * #741 — `partial` USED TO BE `full` IN EVERY NUMBER. `const hasMeter = coverage !== 'none'` is a
 * two-answer question asked of a three-answer function, and the ratio is the number the operator
 * uses to decide the weight of `0,03/min`.
 */
test('#741: with the meter covering only part of the window, the ratio card prints no fraction', async ({
  mount,
  page,
}) => {
  await mount(
    <DashboardWrapper>
      <RankingScoreboardHarness period={WEEK_ACROSS_METER} periodLabel="Semana de 17/08 a 23/08 · UTC" />
    </DashboardWrapper>
  )

  await expect(page.getByText(RANKING.meter.partial)).toBeVisible()

  // A ratio always ends in `: 1`, and dividing a numerator measured over the whole window by a
  // denominator measured over part of it comes out high by the part that is missing.
  await expect(page.getByText(/: 1$/)).toHaveCount(0)
  // The subtitle is one text node with a deliberate break in it (`whitespace-pre-line`), so the
  // sentence is matched inside it, and the two totals it would have divided come first.
  await expect(page.getByText('52 pts de disparo · 4,29 pts de minuto')).toBeVisible()
  await expect(page.getByText(RANKING.kpi.ratio_partial.split('\n')[1])).toBeVisible()
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
  // The week has a streak column, so the cells are: Pontos, Disparos, Pts de minuto, Sequência,
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
 * The three declarations lived inside `DenseTableScroller`, which is `overflow-auto`: 66px tall
 * up to a 1280px viewport, and gone on the first vertical scroll while the two header bands
 * stayed glued. The one that costs money is `Intervalo de sinal` — sorting by `Diferença`, the
 * sortable column of the biggest numbers, puts `+67 h` rows on top, and a scoreboard that shows
 * them with no sentence saying an open session with sparse signal inflates the span without
 * consuming balance reads as *we are failing to charge 67 hours*.
 *
 * THE TWO HALVES ARE ONE CLAIM: a visible block the scroll cannot take away, and an `sr-only`
 * `<caption>` with the same keys in the same order, which is what a screen reader announces
 * before the first cell. Deleting either half to "clean up the duplication" brings a defect
 * back, and this test is what says so out loud.
 */
test('#741 · DS-COMPONENTE-083 item 3: the three declarations survive the scroll, and a screen reader still gets them before the first cell', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })

  await mount(
    <DashboardWrapper>
      <RankingScoreboardHarness rows={scrollingRows()} />
    </DashboardWrapper>
  )

  const facts = [RANKING.caption.span, RANKING.caption.platform, RANKING.caption.notable].map(plain)
  const legend = page.getByTestId('ranking-legend')
  const lines = legend.locator('p')

  await expect(lines).toHaveCount(3)
  for (const [index, fact] of facts.entries()) {
    await expect(lines.nth(index)).toHaveText(fact)
    // The term opens the line in bold: three sentences of the same weight are a paragraph.
    await expect(lines.nth(index).locator('strong')).toHaveCount(1)
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

  // And the same three, in the same order, for whoever does not see them — plus the sentence
  // about sorting, which the caption has always carried last.
  const caption = page.locator('table caption')
  await expect(caption).toHaveClass(/sr-only/)
  const spoken = (await caption.textContent()) ?? ''
  let cursor = -1
  for (const fact of [...facts, RANKING.caption.sorting]) {
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

test('#741: with the column gone, the `Comparação · tempo` group is on screen at 1152px', async ({
  mount,
  page,
}) => {
  // The width the design measured the cut at: `Diferença` was outside, and the gradient promises
  // "there is more", never "there are three columns of time".
  await page.setViewportSize({ width: 1152, height: 800 })

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
  // `DS-COMPONENTE-081` keeps the horizontal scroll for the widths where it is still needed.
  const overflow = await scroller.evaluate((element) => element.scrollWidth - element.clientWidth)
  expect(overflow, 'the table still overflows at the width the design measured').toBeLessThanOrEqual(2)
})
