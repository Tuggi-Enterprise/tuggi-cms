/**
 * THE TABLE, after the board took the cards. #409.
 *
 * The two views split by what somebody is there to do, and the table is the one for LOOKING
 * SOMETHING UP: every partnership, sortable by idleness, scanned column by column. Two things
 * were missing for that, and this suite is about both.
 *
 * THE MONEY WAS NOT IN IT. `Plano` was filterable in the rail and unreadable in the rows, so
 * `quem paga em Minas?` needed the rail to narrow and then a click into each record to confirm.
 * The column that made room for it is `Tipo`, which is a facet of the rail and says nearly
 * nothing row by row.
 *
 * AND IT PRINTED EVERY ROW. One thousand `<tr>`s is the server's cap, and the browser holds all
 * of them — `loadClientDirectory` cannot paginate without leaving the rail counting a page
 * instead of the list. So the page is a slice of an array that is already here, and what this
 * suite guards is that the slice never lies: the range says what is on screen, the pager never
 * offers a page that opens empty, and narrowing a facet does not strand the operator on a page
 * number that no longer exists.
 *
 * See `playwright-ct.config.ts` for why this is a component mount and not a page navigation.
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { DirectoryHarness, Wrapper } from './helpers'
import { BOARD_ROWS_EVERY_PLAN, queueRow } from './fixtures/partnerships'
import ptMessages from '@/messages/pt.json'

const DIRECTORY = ptMessages.Clients.directory
const STANCE = ptMessages.Clients.stance
const PLAN = ptMessages.Clients.board.plan

async function mockDirectory(page: Page, body: unknown) {
  await page.route('**/api/admin/clients/directory', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  )
}

/**
 * `count` rows in one city, named by index so a page can be identified by what is in it.
 *
 * `prefix` IS NOT COSMETIC. `rowKey` is the React key of every row, so two runs sharing ids
 * render as duplicate keys: the first version of this file built `run(40)` and `run(3, 'Búzios')`
 * with the same `row-0`, and filtering to Búzios left three stale rows on screen while the range
 * correctly said `1–3 de 3`. The fixture was the bug, not the component — but the shape of the
 * failure is exactly what a real id collision would look like.
 */
function run(count: number, city = 'Santos', prefix = 'a') {
  return Array.from({ length: count }, (_, index) =>
    queueRow({
      submissionId: `${prefix}-row-${index}`,
      clientId: `${prefix}-client-${index}`,
      state: 'client_created',
      status: 'approved',
      name: `Parceiro ${String(index).padStart(3, '0')}`,
      city,
      // Ascending idleness, so `compareRows` gives a stable order the test can predict.
      since: `2026-01-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
    })
  )
}

// ── The money, in the column that replaced `Tipo` ────────────────────────────────────────────

test.describe('#409 — the table answers who pays', () => {
  test('the `Plano` column carries the badge AND the value; `Tipo` is gone', async ({
    mount,
    page,
  }) => {
    await mockDirectory(page, { rows: BOARD_ROWS_EVERY_PLAN, truncated: false })
    await mount(
      <Wrapper>
        <DirectoryHarness />
      </Wrapper>
    )

    await expect(page.getByRole('columnheader', { name: DIRECTORY.columns.plan })).toBeVisible()
    // The header it replaced. `venue` was the `clientType` of every fixture row, so its absence
    // is the assertion that the column went and not merely that the label changed.
    await expect(page.getByRole('cell', { name: 'venue' })).toHaveCount(0)

    const paying = page.getByRole('row').filter({ hasText: 'Paga por mês' })
    await expect(paying).toContainText(STANCE.paying)
    await expect(paying).toContainText('R$ 149,00')

    /*
     * AND THE FOUR THAT DO NOT BILL KEEP THEIR OWN WORDS. The badge says `Não pagante` about all
     * four, which is true of the money; the line under it is what distinguishes a courtesy
     * somebody decided from a registration nobody filled in — the second being the one
     * BR-B2B-017, item 6, refuses to publish.
     */
    const courtesy = page.getByRole('row').filter({ hasText: 'Cortesia declarada' })
    await expect(courtesy).toContainText(STANCE.not_paying)
    await expect(courtesy).toContainText(PLAN.courtesy)

    const undeclared = page.getByRole('row').filter({ hasText: 'Ninguém declarou' })
    await expect(undeclared).toContainText(STANCE.not_paying)
    await expect(undeclared).toContainText(PLAN.undeclared)
  })

  test('the same partner reads the same sentence on the board and in the table', async ({
    mount,
    page,
  }) => {
    await mockDirectory(page, { rows: BOARD_ROWS_EVERY_PLAN, truncated: false })
    await mount(
      <Wrapper>
        <DirectoryHarness />
      </Wrapper>
    )

    // `planLine` is one function reading `Clients.board.plan.*`, borrowed by the table rather
    // than copied into `Clients.directory`. A second copy is how `R$ 149,00 por mês` on a card
    // becomes `R$ 149,00/mês` in a row about the same partner.
    await expect(page.getByRole('row').filter({ hasText: 'Pediu descrição' })).toContainText(
      PLAN.requestedMapAndDescription
    )
  })
})

// ── The page, and the promises it makes ──────────────────────────────────────────────────────

test.describe('#409 — the table pages what it holds', () => {
  test('a list that fits one page has a range and no pager', async ({ mount, page }) => {
    await mockDirectory(page, { rows: run(10), truncated: false })
    await mount(
      <Wrapper>
        <DirectoryHarness />
      </Wrapper>
    )

    // A pager over one page is a control whose every button is dead.
    await expect(page.getByRole('navigation', { name: DIRECTORY.paginationLabel })).toHaveCount(0)
    await expect(page.getByText('Mostrando 1–10 de 10').first()).toBeVisible()
  })

  test('a long list slices to 25, and the range says which 25', async ({ mount, page }) => {
    await mockDirectory(page, { rows: run(60), truncated: false })
    await mount(
      <Wrapper>
        <DirectoryHarness />
      </Wrapper>
    )

    // 25 body rows plus the header row.
    await expect(page.getByRole('row')).toHaveCount(26)
    await expect(page.getByText('Mostrando 1–25 de 60').first()).toBeVisible()

    // TWO PAGERS, above and below. 25 rows is more than a laptop shows at once, and an operator
    // who read to the bottom would otherwise scroll the whole page back to reach the next one.
    await expect(page.getByRole('navigation', { name: DIRECTORY.paginationLabel })).toHaveCount(2)
  })

  test('the last page is short, and the range says so rather than promising 25', async ({
    mount,
    page,
  }) => {
    await mockDirectory(page, { rows: run(60), truncated: false })
    await mount(
      <Wrapper>
        <DirectoryHarness />
      </Wrapper>
    )

    await page.getByRole('button', { name: DIRECTORY.goToPage.replace('{page}', '3') }).first().click()
    await expect(page.getByText('Mostrando 51–60 de 60').first()).toBeVisible()
    await expect(page.getByRole('row')).toHaveCount(11)

    // The ends stop being offers when there is nowhere to go. `disabled` and not hidden: a
    // control that vanishes under the thumb is worse than one that greys out where it was.
    await expect(page.getByRole('button', { name: DIRECTORY.nextPage }).first()).toBeDisabled()
    await expect(page.getByRole('button', { name: DIRECTORY.previousPage }).first()).toBeEnabled()
  })

  /**
   * THE DEFECT THIS FORBIDS: narrowing a facet while on page 3 of a set that now has one page.
   *
   * The table would render nothing and offer no way back — an empty screen that reads as broken,
   * over a filter that actually matched rows. The page number is ANCHORED to the filters it
   * belongs to rather than reset by an effect, so the correct page renders on the first paint
   * instead of after one wrong one.
   */
  test('narrowing the list returns to page 1 instead of stranding an empty page', async ({
    mount,
    page,
  }) => {
    await mockDirectory(page, { rows: run(40).concat(run(3, 'Búzios', 'b')), truncated: false })
    await mount(
      <Wrapper>
        <DirectoryHarness />
      </Wrapper>
    )

    await page.getByRole('button', { name: DIRECTORY.goToPage.replace('{page}', '2') }).first().click()
    await expect(page.getByText('Mostrando 26–43 de 43').first()).toBeVisible()

    // Búzios has three rows — one page. The operator is on page 2.
    await page.getByRole('button', { name: /^Búzios/ }).first().click()

    await expect(page.getByText('Mostrando 1–3 de 3').first()).toBeVisible()
    await expect(page.getByRole('row')).toHaveCount(4)
    await expect(page.getByRole('navigation', { name: DIRECTORY.paginationLabel })).toHaveCount(0)
  })

  test('the current page is announced, not only tinted', async ({ mount, page }) => {
    await mockDirectory(page, { rows: run(60), truncated: false })
    await mount(
      <Wrapper>
        <DirectoryHarness />
      </Wrapper>
    )

    // DS-A11Y-003: the state is carried by `aria-current` and by the weight of the number, never
    // by the tinted surface alone.
    const first = page.getByRole('button', { name: DIRECTORY.goToPage.replace('{page}', '1') }).first()
    await expect(first).toHaveAttribute('aria-current', 'page')

    await page.getByRole('button', { name: DIRECTORY.goToPage.replace('{page}', '2') }).first().click()
    await expect(first).not.toHaveAttribute('aria-current', 'page')
  })
})

// ── axe over the shape that changed ──────────────────────────────────────────────────────────

test('#409 — axe-core over the paged table', async ({ mount, page }) => {
  await mockDirectory(page, { rows: run(60), truncated: false })
  await mount(
    <Wrapper>
      <DirectoryHarness />
    </Wrapper>
  )
  await expect(page.getByRole('navigation', { name: DIRECTORY.paginationLabel }).first()).toBeVisible()

  const results = await new AxeBuilder({ page })
    .include('#root')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
})
