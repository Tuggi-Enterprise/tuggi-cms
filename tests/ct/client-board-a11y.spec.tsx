/**
 * The board (#409) in a real browser — the assertions the pure suite
 * (`tests/api/client-board-transitions.test.ts`) cannot make: `axe-core` over every state,
 * the columns as real landmarks, the collapse of the terminal ones, the measured contrast, and
 * the one requirement the drag creates — that nothing is reachable ONLY by dragging
 * (WCAG 2.2 SC 2.5.7).
 *
 * Same setup as `partnerships-a11y.spec.tsx`: real Chromium, the app's own Tailwind, the actual
 * `ClientBoard`, and the directory endpoint intercepted with `page.route`. See
 * `playwright-ct.config.ts` for why this is a component mount and not a page navigation.
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { BoardHarness, Wrapper } from './helpers'
import { BOARD_ROWS_EVERY_COLUMN, BOARD_ROWS_EVERY_PLAN, queueRow } from './fixtures/partnerships'
import { BOARD_COLUMNS, TERMINAL_COLUMNS, TERMINAL_PAGE } from '@/lib/clients/board-transitions'
import { EMPTY_FILTERS } from '@/lib/clients/directory-filter'
import ptMessages from '@/messages/pt.json'

const BOARD = ptMessages.Clients.board

async function mockDirectory(page: Page, body: unknown, opts: { status?: number } = {}) {
  await page.route('**/api/admin/clients/directory', (route) =>
    route.fulfill({
      status: opts.status ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  )
}

async function axeClean(page: Page) {
  const results = await new AxeBuilder({ page })
    // Scoped to the mounted component: this harness's host page has no `<title>`/`<html lang>`
    // of its own, and those two would be testing the harness rather than the screen. The real
    // page (`app/[locale]/layout.tsx`) sets both.
    .include('#root')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
}

// ── axe-core over the three states ───────────────────────────────────────────────────────────

test.describe('#409 — axe-core over every state of the board', () => {
  test('loaded, with every column and the alert band', async ({ mount, page }) => {
    await mockDirectory(page, { rows: BOARD_ROWS_EVERY_COLUMN, truncated: false })
    await mount(
      <Wrapper>
        <BoardHarness />
      </Wrapper>
    )
    await expect(page.getByRole('heading', { name: BOARD.columns.proposal })).toBeVisible()
    await axeClean(page)
  })

  test('empty', async ({ mount, page }) => {
    await mockDirectory(page, { rows: [], truncated: false })
    await mount(
      <Wrapper>
        <BoardHarness />
      </Wrapper>
    )
    await expect(page.getByText(BOARD.empty).first()).toBeVisible()
    await axeClean(page)
  })

  test('error', async ({ mount, page }) => {
    await mockDirectory(page, {}, { status: 500 })
    await mount(
      <Wrapper>
        <BoardHarness />
      </Wrapper>
    )
    await expect(page.getByText(ptMessages.Clients.directory.errorTitle)).toBeVisible()
    await axeClean(page)
  })
})

// ── The columns are landmarks, not divs with big text ────────────────────────────────────────

test('#409 · DS-A11Y-003 — every column is a <section> with an <h2> and a count in text', async ({
  mount,
  page,
}) => {
  await mockDirectory(page, { rows: BOARD_ROWS_EVERY_COLUMN, truncated: false })
  await mount(
    <Wrapper>
      <BoardHarness />
    </Wrapper>
  )

  for (const id of BOARD_COLUMNS) {
    const label = BOARD.columns[id as keyof typeof BOARD.columns]
    const heading = page.getByRole('heading', { level: 2, name: label })
    await expect(heading, `${id} must be an <h2>`).toBeVisible()
    // The section is labelled BY that heading — a `<section>` with no accessible name is not a
    // landmark, which is the difference between a screen reader listing eight columns and one.
    await expect(page.getByRole('region', { name: label })).toBeVisible()
  }
})

test('#409 — a card carries its state in words, so the column is never the only carrier', async ({
  mount,
  page,
}) => {
  await mockDirectory(page, { rows: BOARD_ROWS_EVERY_COLUMN, truncated: false })
  await mount(
    <Wrapper>
      <BoardHarness />
    </Wrapper>
  )

  const card = page.getByRole('article', { name: 'Padaria Boa Vista' })
  await expect(card).toContainText(ptMessages.Partnerships.states.contract_sent)
  await expect(card).toContainText(ptMessages.Partnerships.nextSteps.contract_sent)
})

test('#409 — every figure on a card is named: `Parado há` and `Triagem`, never three bare numbers', async ({
  mount,
  page,
}) => {
  await mockDirectory(page, { rows: BOARD_ROWS_EVERY_COLUMN, truncated: false })
  await mount(
    <Wrapper>
      <BoardHarness />
    </Wrapper>
  )

  // The table carries these under column headings; a card has none, and the first cut stacked
  // `82 dias`, `venceu há 79 dias` and `04/06, 22h15` with nothing to say which was which.
  const card = page.getByRole('article', { name: 'Bar do Mirante' })
  await expect(card).toContainText('Parado há')
  await expect(card).toContainText('Triagem:')
})

test('#409 — a registration with no city does not print a placeholder on a line of its own', async ({
  mount,
  page,
}) => {
  await mockDirectory(page, {
    rows: [
      { ...BOARD_ROWS_EVERY_COLUMN[0], name: 'Sem endereço', city: null, region: null, country: null },
    ],
    truncated: false,
  })
  await mount(
    <Wrapper>
      <BoardHarness />
    </Wrapper>
  )

  const card = page.getByRole('article', { name: 'Sem endereço' })
  await expect(card).toBeVisible()
  // `—` is only worth a line when its absence is news, and here it is not.
  await expect(card).not.toContainText('—')
})

test('#409 — the card says who pays AND who said so', async ({ mount, page }) => {
  await mockDirectory(page, { rows: BOARD_ROWS_EVERY_PLAN, truncated: false })
  await mount(
    <Wrapper>
      <BoardHarness />
    </Wrapper>
  )

  const PLAN = BOARD.plan

  // A proposal nobody priced answers with the REQUEST, and never with a value.
  const asked = page.getByRole('article', { name: 'Pediu descrição' })
  await expect(asked).toContainText(PLAN.requestedMapAndDescription)
  await expect(asked).not.toContainText('R$')

  // The registration: the value, and where it came from.
  const paid = page.getByRole('article', { name: 'Paga por mês' })
  await expect(paid).toContainText('R$ 149,00')
  await expect(paid).toContainText(PLAN.fromRegistration)

  // A courtesy prints its REASON rather than the source: an unexplained discount is the thing
  // BR-B2B-017 item 6 forbids, so the reason is the more useful line.
  const courtesy = page.getByRole('article', { name: 'Cortesia declarada' })
  await expect(courtesy).toContainText(PLAN.courtesy)
  await expect(courtesy).toContainText('patrocínio do festival')

  // Undeclared is a STATE and is shown, because it is what refuses the publication.
  await expect(page.getByRole('article', { name: 'Ninguém declarou' })).toContainText(
    PLAN.undeclared
  )

  // And a registration edited after the contract was signed says so.
  const drifted = page.getByRole('article', { name: 'Contrato divergente' })
  await expect(drifted).toContainText(PLAN.free)
  await expect(drifted).toContainText(PLAN.fromContract)
  await expect(drifted).toContainText(PLAN.divergesFree)
})

test('#409 — the rail filters by what decides the money, and a proposal is not counted', async ({
  mount,
  page,
}) => {
  await mockDirectory(page, { rows: BOARD_ROWS_EVERY_PLAN, truncated: false })
  await mount(
    <Wrapper>
      <BoardHarness />
    </Wrapper>
  )

  const rail = page.getByRole('region', { name: ptMessages.Clients.directory.filters.plan })
  const VALUES = ptMessages.Clients.directory.planValues

  // Three registrations, one of each — and the proposal answers nothing, so no option counts it.
  for (const [label, count] of [[VALUES.paid, 2], [VALUES.courtesy, 1], [VALUES.undeclared, 1]] as const) {
    await expect(rail.getByRole('button', { name: new RegExp(`^${label}`) })).toContainText(
      String(count)
    )
  }

  // Clicking one narrows the board to it.
  await rail.getByRole('button', { name: new RegExp(`^${VALUES.undeclared}`) }).click()
  await expect(page.getByRole('article', { name: 'Ninguém declarou' })).toBeVisible()
  await expect(page.getByRole('article', { name: 'Paga por mês' })).toHaveCount(0)
})

// ── The terminal columns ─────────────────────────────────────────────────────────────────────

/**
 * WHAT THIS TEST REPLACED. Until 2026-08-24 it asserted that `Publicado` and `Encerrados` come
 * SHUT, with `aria-expanded="false"` on a toggle. That was a faithful test of a screen with a
 * real defect: the last month of delivered work was invisible on the board, and an operator who
 * had just published a place had to leave for the table to see it. The reason the collapse
 * existed survives — an unbounded `Publicado` swamps the seven columns beside it — and the
 * window is the answer to it that does not hide anything.
 */
test('#409 — Publicado opens on its first page and says how much it is not showing', async ({
  mount,
  page,
}) => {
  await mockDirectory(page, { rows: BOARD_ROWS_EVERY_COLUMN, truncated: false })
  await mount(
    <Wrapper>
      <BoardHarness />
    </Wrapper>
  )

  // No click, no toggle: the card of a published place is on the board from the first paint.
  const published = page.getByRole('region', { name: BOARD.columns.published })
  await expect(published.getByRole('article', { name: 'Café da Praça' })).toBeVisible()

  // And a terminal column that fits inside one page offers no `Ver mais` at all — a button that
  // adds nothing is a button that teaches the operator the control does nothing.
  for (const id of TERMINAL_COLUMNS) {
    const label = BOARD.columns[id as keyof typeof BOARD.columns]
    const region = page.getByRole('region', { name: label })
    await expect(region.getByRole('button', { name: /Ver mais/ })).toHaveCount(0)
  }
})

test('#409 — `Ver mais` grows the column in place, a page at a time', async ({ mount, page }) => {
  // Twelve published rows against a page of five: two taps to reach the end, and the button is
  // gone on the third.
  const many = Array.from({ length: 12 }, (_, index) =>
    queueRow({
      submissionId: `pub-${index}`,
      clientId: `client-pub-${index}`,
      state: 'published',
      status: 'approved',
      name: `Publicado ${index}`,
      since: `2026-08-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    })
  )
  await mockDirectory(page, { rows: many, truncated: false })
  await mount(
    <Wrapper>
      <BoardHarness />
    </Wrapper>
  )

  const published = page.getByRole('region', { name: BOARD.columns.published })
  await expect(published.getByRole('article')).toHaveCount(TERMINAL_PAGE)
  await expect(published).toContainText('5 de 12')

  await published.getByRole('button', { name: /Ver mais/ }).click()
  await expect(published.getByRole('article')).toHaveCount(TERMINAL_PAGE * 2)
  await expect(published).toContainText('10 de 12')

  /*
   * THE LAST PAGE IS SHORT, and the label said so before it was clicked: `Ver mais 2`, not
   * `Ver mais 5`. A control that promises five and delivers two is the small lie that makes an
   * operator stop trusting the count beside it.
   */
  await expect(published.getByRole('button', { name: 'Ver mais 2' })).toBeVisible()
  await published.getByRole('button', { name: 'Ver mais 2' }).click()
  await expect(published.getByRole('article')).toHaveCount(12)
  await expect(published.getByRole('button', { name: /Ver mais/ })).toHaveCount(0)
})

test('#409 — the board says how many cards it is painting, above the columns', async ({
  mount,
  page,
}) => {
  const many = Array.from({ length: 12 }, (_, index) =>
    queueRow({
      submissionId: `pub-${index}`,
      clientId: `client-pub-${index}`,
      state: 'published',
      status: 'approved',
      name: `Publicado ${index}`,
      since: `2026-08-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    })
  )
  await mockDirectory(page, { rows: many, truncated: false })
  await mount(
    <Wrapper>
      <BoardHarness />
    </Wrapper>
  )

  // Five of twelve painted, and the line owns up to it. Before this existed the header said
  // `12 de 12` while the columns rendered five, and nothing on screen named the difference.
  await expect(page.getByText('5 de 12 parcerias visíveis no quadro')).toBeVisible()

  await page
    .getByRole('region', { name: BOARD.columns.published })
    .getByRole('button', { name: /Ver mais/ })
    .click()
  await expect(page.getByText('10 de 12 parcerias visíveis no quadro')).toBeVisible()
})

test('#409 — a truncated set turns every column count into a floor, not a fact', async ({
  mount,
  page,
}) => {
  await mockDirectory(page, { rows: BOARD_ROWS_EVERY_COLUMN, truncated: true })
  await mount(
    <Wrapper>
      <BoardHarness />
    </Wrapper>
  )

  const proposal = page.getByRole('region', { name: BOARD.columns.proposal })
  // `≥ 1`, never `1`: what the server's cap dropped are the OLDEST rows, which is exactly what
  // fills these columns. A number that reads as a fact and is a lower bound is the defect that
  // made `{n} com a triagem vencida` open an empty table.
  await expect(proposal).toContainText('≥')
})

// ── The alert band outranks the board ────────────────────────────────────────────────────────

test('#409 · DS-COPY-020 point 5 — the uncommunicated refusal is above the columns, not in one', async ({
  mount,
  page,
}) => {
  await mockDirectory(page, { rows: BOARD_ROWS_EVERY_COLUMN, truncated: false })
  await mount(
    <Wrapper>
      <BoardHarness />
    </Wrapper>
  )

  const band = page.getByRole('region', { name: BOARD.alertTitle })
  await expect(band).toBeVisible()
  await expect(band.getByRole('article', { name: 'Bar do Mirante' })).toBeVisible()

  // And it is in NO column — not even `Publicado`, which its places would otherwise reach.
  for (const id of BOARD_COLUMNS) {
    const label = BOARD.columns[id as keyof typeof BOARD.columns]
    await expect(
      page.getByRole('region', { name: label }).getByRole('article', { name: 'Bar do Mirante' })
    ).toHaveCount(0)
  }
})

// ── SC 2.5.7 — the drag is a shortcut, never the only path ───────────────────────────────────

test('#409 · WCAG 2.2 SC 2.5.7 — every act on a card is reachable by keyboard, without dragging', async ({
  mount,
  page,
}) => {
  await mockDirectory(page, { rows: BOARD_ROWS_EVERY_COLUMN, truncated: false })
  await mount(
    <Wrapper>
      <BoardHarness />
    </Wrapper>
  )

  // The proposal's next act, as a button on the card itself.
  const card = page.getByRole('article', { name: 'Cantina do Zé' })
  const act = card.getByRole('button', { name: BOARD.acts.record_conference })
  await expect(act).toBeVisible()
  await act.focus()
  await expect(act).toBeFocused()

  // `Contrato enviado` is the one column whose act is the partner's, so its card offers none —
  // and must not offer a button that does nothing (BR-B2B-026, item 5).
  const waiting = page.getByRole('article', { name: 'Padaria Boa Vista' })
  await expect(waiting.getByRole('button')).toHaveCount(0)
})

// ── Criterion 25, carried over: the brand blue never paints a word ───────────────────────────

test('#409 · SC 1.4.3 — #00A8E8 never paints text or an informative icon on the board', async ({
  mount,
  page,
}) => {
  await mockDirectory(page, { rows: BOARD_ROWS_EVERY_COLUMN, truncated: false })
  await mount(
    <Wrapper>
      <BoardHarness />
    </Wrapper>
  )

  // 2.70:1 on white — below the 4.5:1 of SC 1.4.3. It is the token that works at night and
  // fails in daylight, and this suite runs in the light theme.
  const offenders = await page.evaluate(() => {
    const bad: string[] = []
    for (const node of Array.from(document.querySelectorAll('*'))) {
      const style = getComputedStyle(node)
      if (style.color !== 'rgb(0, 168, 232)') continue
      if (node.getAttribute('aria-hidden') === 'true') continue
      const text = (node.textContent ?? '').trim()
      if (text.length > 0) bad.push(`${node.tagName}: ${text.slice(0, 40)}`)
    }
    return bad
  })
  expect(offenders).toEqual([])
})

// ── Paga ou não paga, as a colour on the card's left edge ────────────────────────────────────

/** The two measured tokens, as the browser reports them. */
const PAYING_STRIPE = 'rgb(5, 150, 105)' //  emerald-600 #059669 — 3.77:1 on white, 3.61:1 on gray-50
const NOT_PAYING_STRIPE = 'rgb(55, 65, 81)' // gray-700 #374151 — 10.31:1 on white, 9.86:1 on gray-50

async function stripeOf(page: Page, name: string): Promise<string> {
  return page
    .getByRole('article', { name })
    .evaluate((node) => getComputedStyle(node).borderLeftColor)
}

test('#409 — the left edge separates who bills from who does not', async ({ mount, page }) => {
  await mockDirectory(page, { rows: BOARD_ROWS_EVERY_PLAN, truncated: false })
  await mount(
    <Wrapper>
      <BoardHarness />
    </Wrapper>
  )

  // The one member of `paying`: a registration with a fee somebody typed.
  expect(await stripeOf(page, 'Paga por mês')).toBe(PAYING_STRIPE)

  /*
   * AND THE EDGE IS ACTUALLY 4px WHILE THE OTHER THREE STAY AT 1px.
   *
   * `border border-l-4` are two utilities of equal specificity, so which one wins the left edge
   * is decided by the ORDER Tailwind emits them in — not by the order they appear in the class
   * string. That is a fact about the framework, not about this card, and it is the kind of thing
   * an upgrade changes silently: the colour test above would stay green with a 1px edge nobody
   * can see from across a column.
   */
  const widths = await page
    .getByRole('article', { name: 'Paga por mês' })
    .evaluate((node) => {
      const style = getComputedStyle(node)
      return { left: style.borderLeftWidth, top: style.borderTopWidth }
    })
  expect(widths).toEqual({ left: '4px', top: '1px' })

  /*
   * AND THE FOUR THAT ARE NOT, each for a different reason, which is exactly why the WORD stays
   * on the card. `Cortesia declarada` is a decision; `Ninguém declarou` is a pendency that
   * refuses the publication; `Pediu descrição` is a proposal nobody priced; `Contrato
   * divergente` signed a free tier over a record still carrying `R$ 149,00`. The colour says
   * only "nothing is being billed", and it is the plan line that says which of the four.
   */
  for (const name of [
    'Cortesia declarada',
    'Ninguém declarou',
    'Pediu descrição',
    'Contrato divergente',
  ]) {
    expect(await stripeOf(page, name), name).toBe(NOT_PAYING_STRIPE)
  }
})

test('#409 · DS-A11Y-003 — the stripe never carries the money on its own', async ({
  mount,
  page,
}) => {
  await mockDirectory(page, { rows: BOARD_ROWS_EVERY_PLAN, truncated: false })
  await mount(
    <Wrapper>
      <BoardHarness />
    </Wrapper>
  )

  /*
   * THE ASSERTION IS THAT REMOVING THE COLOUR CHANGES NOTHING AN OPERATOR CAN READ.
   *
   * DS-A11Y-003 asks for two channels, and the second one here is not an icon or a badge — it is
   * the plan line the card already carried before the stripe existed. So the test states it as a
   * property of the TEXT: every card, in either stance, names its own money in words. A future
   * change that moved the money onto the stripe alone — dropping `planLine` to save a line on a
   * phone, say — turns this red while the colour test above stays green.
   */
  const PLAN = BOARD.plan

  await expect(page.getByRole('article', { name: 'Paga por mês' })).toContainText('R$ 149,00')
  await expect(page.getByRole('article', { name: 'Cortesia declarada' })).toContainText(PLAN.courtesy)
  await expect(page.getByRole('article', { name: 'Ninguém declarou' })).toContainText(PLAN.undeclared)
  await expect(page.getByRole('article', { name: 'Contrato divergente' })).toContainText(PLAN.free)

  // And the stripe itself announces nothing: it is a border on the `<article>`, so there is no
  // element whose accessible name is `pagante` or `não pagante` competing with the line above.
  await expect(page.getByText(/^N[ãa]o pagante$/i)).toHaveCount(0)
  await expect(page.getByText(/^Pagante$/i)).toHaveCount(0)
})

/**
 * WHY THE FRONT DOOR MAY NOT CARRY `state=in_progress`, stated as a rendering rather than as a
 * comment.
 *
 * The nav link carried it until 2026-08-24, for a reason written when this screen was a flat
 * list: `Publicado`, `Descartado` and `Recusado na triagem` mixed into a queue are noise the
 * operator learns to ignore. On a BOARD that premise dissolves — each outcome has its own
 * column, so nothing is confused with work — and the filter's effect is what this test paints:
 * two columns that exist, carry a heading and a hint, and can never hold a card.
 *
 * `tests/api/client-board-surface.test.ts` is what actually guards the link. This is the
 * evidence for why that guard is there, and it fails the day somebody makes `in_progress`
 * include a terminal state, which would make both this and that test wrong together.
 */
test('#409 — the working-set filter empties the terminal columns, which is why no link carries it', async ({
  mount,
  page,
}) => {
  const rows = BOARD_ROWS_EVERY_COLUMN.concat(
    queueRow({
      submissionId: 'pub-1',
      clientId: 'client-pub-1',
      state: 'published',
      status: 'approved',
      name: 'Já está no ar',
    })
  )
  await mockDirectory(page, { rows, truncated: false })
  await mount(
    <Wrapper>
      <BoardHarness initial={{ ...EMPTY_FILTERS, state: 'in_progress' }} />
    </Wrapper>
  )

  const published = page.getByRole('region', { name: BOARD.columns.published })
  await expect(published.getByRole('article')).toHaveCount(0)
  await expect(published).toContainText(BOARD.emptyFiltered)
})

/** The other half of the pair: with no filter — what the link gives now — the row is on the board. */
test('#409 — unfiltered, a published partnership is a card on the board', async ({
  mount,
  page,
}) => {
  const rows = BOARD_ROWS_EVERY_COLUMN.concat(
    queueRow({
      submissionId: 'pub-1',
      clientId: 'client-pub-1',
      state: 'published',
      status: 'approved',
      name: 'Já está no ar',
    })
  )
  await mockDirectory(page, { rows, truncated: false })
  await mount(
    <Wrapper>
      <BoardHarness />
    </Wrapper>
  )

  await expect(
    page.getByRole('region', { name: BOARD.columns.published }).getByRole('article', {
      name: 'Já está no ar',
    })
  ).toBeVisible()
})
