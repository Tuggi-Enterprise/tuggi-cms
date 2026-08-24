/**
 * `/admin/clients` ON A PHONE — the assertion the desktop suite structurally cannot make.
 *
 * The partnership pipeline is worked from a phone: the form is filled in at an event, the
 * documents are checked on the spot, the contract goes out and the QR is pulled down for
 * printing, all before anybody is back at a desk. On 2026-08-24 none of that was possible —
 * the rail was `w-[18%]` and the list `w-[82%]` at every width, so on a 390px screen the two
 * of them plus `gap-8` plus `p-6` came to more than the viewport and the board hung off the
 * right edge. The screenshot that opened the card is exactly that arithmetic.
 *
 * WHAT THIS SUITE ACTUALLY GUARDS IS ONE NUMBER: `scrollWidth <= clientWidth` on the document.
 * Every other assertion here is about a specific control, and controls get redesigned; that
 * inequality is the defect itself, and it is the one a future `w-[82%]` would break again
 * within a commit. It is checked in each of the states the operator passes through, because
 * the rail was not the only fixed width in the tree — the alert band's cards were `w-72`, and
 * a sheet or a drawer can reintroduce the overflow after the page itself is clean.
 *
 * IT IS ITS OWN PROJECT AND NOT A `setViewportSize` — see `playwright-ct.config.ts`. The board
 * chooses its tree from `matchMedia` AT MOUNT (`@dnd-kit` mounts on a monitor and not on a
 * phone), so a resize after mounting would test the desktop tree at a phone's width, which is
 * a state no operator is ever in.
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { BoardHarness, DirectoryHarness, Wrapper } from './helpers'
import { ClientQrCode } from '@/components/admin/clients/shared/ClientQrCode'
import { ClientEditorModal } from '@/components/admin/clients/ClientEditorModal'
import { BOARD_ROWS_EVERY_COLUMN } from './fixtures/partnerships'
import ptMessages from '@/messages/pt.json'

const BOARD = ptMessages.Clients.board
const DIRECTORY = ptMessages.Clients.directory
const QR = ptMessages.Clients.profile.qr
const TABS = ptMessages.Clients.editor.tabs

async function mockDirectory(page: Page, body: unknown) {
  await page.route('**/api/admin/clients/directory', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  )
}

/**
 * THE ONE ASSERTION THIS FILE EXISTS FOR.
 *
 * `documentElement` and not a container: a child with its own `overflow-x-auto` — the directory
 * table, the column picker, the comparison table of `PromotionPanel` — is ALLOWED to be wider
 * than the screen, because it scrolls inside itself and the page does not move. What is never
 * allowed is the document scrolling sideways, which is what puts half the board past the edge
 * with no way back other than pinch-zooming out.
 *
 * The 1px of slack absorbs sub-pixel rounding of percentage widths on a fractional device pixel
 * ratio; anything real is off by tens of pixels, never by one.
 */
async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement
    return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth }
  })
  expect(
    overflow.scrollWidth,
    `a página rola de lado: scrollWidth ${overflow.scrollWidth} > clientWidth ${overflow.clientWidth}`
  ).toBeLessThanOrEqual(overflow.clientWidth + 1)
}

async function axeClean(page: Page) {
  const results = await new AxeBuilder({ page })
    .include('#root')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
}

// ── The page never scrolls sideways ──────────────────────────────────────────────────────────

test.describe('#409 — a 390px screen does not scroll sideways', () => {
  test('the board, loaded, with every column and the alert band', async ({ mount, page }) => {
    await mockDirectory(page, { rows: BOARD_ROWS_EVERY_COLUMN, truncated: false })
    await mount(
      <Wrapper>
        <BoardHarness />
      </Wrapper>
    )
    await expect(page.getByRole('heading', { name: BOARD.columns.proposal })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })

  test('the table', async ({ mount, page }) => {
    await mockDirectory(page, { rows: BOARD_ROWS_EVERY_COLUMN, truncated: false })
    await mount(
      <Wrapper>
        <DirectoryHarness />
      </Wrapper>
    )
    await expect(page.getByRole('heading', { name: DIRECTORY.title })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })

  test('the board with the filter sheet open', async ({ mount, page }) => {
    await mockDirectory(page, { rows: BOARD_ROWS_EVERY_COLUMN, truncated: false })
    await mount(
      <Wrapper>
        <BoardHarness />
      </Wrapper>
    )
    await page.getByRole('button', { name: DIRECTORY.filtersTitle, exact: true }).click()
    await expect(page.getByRole('dialog', { name: DIRECTORY.filtersTitle })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})

// ── The rail is a sheet, and the sheet is the same rail ──────────────────────────────────────

test.describe('#409 — the facets on a phone', () => {
  test('the rail is not on screen; the button that opens it is', async ({ mount, page }) => {
    await mockDirectory(page, { rows: BOARD_ROWS_EVERY_COLUMN, truncated: false })
    await mount(
      <Wrapper>
        <BoardHarness />
      </Wrapper>
    )

    // The search field is the rail's, and it exists in the DOM twice — once hidden in the rail,
    // once in the sheet. Neither is VISIBLE until the sheet opens, which is the claim.
    await expect(page.getByPlaceholder(DIRECTORY.searchPlaceholder)).toHaveCount(1)
    await expect(page.getByRole('button', { name: DIRECTORY.filtersTitle, exact: true })).toBeVisible()
  })

  test('a facet chosen in the sheet narrows the board behind it', async ({ mount, page }) => {
    await mockDirectory(page, { rows: BOARD_ROWS_EVERY_COLUMN, truncated: false })
    await mount(
      <Wrapper>
        <BoardHarness />
      </Wrapper>
    )

    await page.getByRole('button', { name: DIRECTORY.filtersTitle, exact: true }).click()
    const sheet = page.getByRole('dialog', { name: DIRECTORY.filtersTitle })
    await expect(sheet).toBeVisible()

    // `Em andamento` is the working set — the one facet option that exists whatever the fixture
    // holds, because `DirectoryFilterRail` renders it unconditionally above `state`.
    const working = sheet.getByRole('button', { name: /Em andamento/ })
    await working.click()
    await expect(working).toHaveAttribute('aria-pressed', 'true')

    // The trigger now carries the count, which is the whole reason it carries one: with the
    // sheet closed, this is the only thing on screen that says a filter is on.
    await sheet.getByRole('button', { name: /^Ver \d+ parceiro/ }).click()
    await expect(sheet).toBeHidden()
    await expect(page.getByRole('button', { name: /Filtros: \d+ ativ/ })).toBeVisible()
  })

  test('Esc closes the sheet', async ({ mount, page }) => {
    await mockDirectory(page, { rows: BOARD_ROWS_EVERY_COLUMN, truncated: false })
    await mount(
      <Wrapper>
        <BoardHarness />
      </Wrapper>
    )
    await page.getByRole('button', { name: DIRECTORY.filtersTitle, exact: true }).click()
    await expect(page.getByRole('dialog', { name: DIRECTORY.filtersTitle })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: DIRECTORY.filtersTitle })).toBeHidden()
  })
})

// ── One column at a time, and every act still reachable ──────────────────────────────────────

test.describe('#409 — the columns on a phone', () => {
  test('one column is shown, and the picker names all eight with their counts', async ({
    mount,
    page,
  }) => {
    await mockDirectory(page, { rows: BOARD_ROWS_EVERY_COLUMN, truncated: false })
    await mount(
      <Wrapper>
        <BoardHarness />
      </Wrapper>
    )

    const picker = page.getByRole('tablist', { name: BOARD.columnPickerLabel })
    await expect(picker.getByRole('tab')).toHaveCount(8)

    // Exactly one column heading is on screen. On a monitor all eight are; that difference is
    // the change, and it is what the picker exists to compensate for.
    const headings = page.getByRole('heading', {
      name: new RegExp(Object.values(BOARD.columns).join('|')),
    })
    await expect(headings).toHaveCount(1)
    await expect(page.getByRole('heading', { name: BOARD.columns.proposal })).toBeVisible()
  })

  test('tapping a chip swaps which column is shown', async ({ mount, page }) => {
    await mockDirectory(page, { rows: BOARD_ROWS_EVERY_COLUMN, truncated: false })
    await mount(
      <Wrapper>
        <BoardHarness />
      </Wrapper>
    )

    const picker = page.getByRole('tablist', { name: BOARD.columnPickerLabel })
    await picker.getByRole('tab', { name: new RegExp(BOARD.columns.contract_signed) }).click()

    await expect(page.getByRole('heading', { name: BOARD.columns.contract_signed })).toBeVisible()
    await expect(page.getByRole('heading', { name: BOARD.columns.proposal })).toBeHidden()
    await expectNoHorizontalOverflow(page)
  })

  test('the act of a card is a button, with no drag anywhere (SC 2.5.7)', async ({
    mount,
    page,
  }) => {
    await mockDirectory(page, { rows: BOARD_ROWS_EVERY_COLUMN, truncated: false })
    await mount(
      <Wrapper>
        <BoardHarness />
      </Wrapper>
    )

    // `@dnd-kit` never mounted, so nothing on this screen announces itself as draggable — and
    // the hint says so too, instead of telling a thumb to drag. What replaces it is the act
    // button the card has always carried.
    await expect(page.getByText(BOARD.dragHint)).toHaveCount(0)
    await expect(page.getByText(BOARD.tapHint)).toBeVisible()
    await expect(page.locator('[aria-roledescription]')).toHaveCount(0)

    await expect(
      page.getByRole('button', { name: BOARD.acts.record_conference }).first()
    ).toBeVisible()
  })
})

// ── axe-core, at the width the work is actually done ─────────────────────────────────────────

test.describe('#409 — axe-core at 390px', () => {
  test('the board', async ({ mount, page }) => {
    await mockDirectory(page, { rows: BOARD_ROWS_EVERY_COLUMN, truncated: false })
    await mount(
      <Wrapper>
        <BoardHarness />
      </Wrapper>
    )
    await expect(page.getByRole('heading', { name: BOARD.columns.proposal })).toBeVisible()
    await axeClean(page)
  })

  test('the board with the filter sheet open', async ({ mount, page }) => {
    await mockDirectory(page, { rows: BOARD_ROWS_EVERY_COLUMN, truncated: false })
    await mount(
      <Wrapper>
        <BoardHarness />
      </Wrapper>
    )
    await page.getByRole('button', { name: DIRECTORY.filtersTitle, exact: true }).click()
    await expect(page.getByRole('dialog', { name: DIRECTORY.filtersTitle })).toBeVisible()
    await axeClean(page)
  })

  test('the table', async ({ mount, page }) => {
    await mockDirectory(page, { rows: BOARD_ROWS_EVERY_COLUMN, truncated: false })
    await mount(
      <Wrapper>
        <DirectoryHarness />
      </Wrapper>
    )
    await expect(page.getByRole('heading', { name: DIRECTORY.title })).toBeVisible()
    await axeClean(page)
  })
})

// ── The QR, which is the reason the phone is out of the pocket ───────────────────────────────

/**
 * `Baixar o QR para impressão` is half of what this screen is opened on a phone to do, and the
 * card that holds it was `p-8` around a 220px canvas inside a drawer that was itself padded —
 * enough to push the card past the screen. The QR itself is NOT allowed to shrink: fewer
 * rendered pixels per module is how a printed QR stops scanning, so the padding gives way and
 * the canvas does not.
 */
test.describe('#409 — the QR card at 390px', () => {
  test('the card fits the screen and the canvas keeps its 220px', async ({ mount, page }) => {
    await mount(
      <Wrapper>
        <ClientQrCode clientId="11111111-1111-1111-1111-111111111111" slug="pao-do-edu" />
      </Wrapper>
    )

    await expect(page.getByRole('heading', { name: QR.title })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    const canvas = page.locator('canvas')
    await expect(canvas).toBeVisible()
    const box = await canvas.boundingBox()
    expect(box?.width).toBeGreaterThanOrEqual(220)
  })

  test('a device with no file share sheet still gets the download', async ({ mount, page }) => {
    await mount(
      <Wrapper>
        <ClientQrCode clientId="11111111-1111-1111-1111-111111111111" slug="pao-do-edu" />
      </Wrapper>
    )

    // Headless Chromium exposes no `navigator.canShare` for files, which is the branch every
    // desktop browser also takes: the share button is absent and the download is the primary
    // act. The path out of this card exists at every capability level — that is the assertion.
    await expect(page.getByRole('button', { name: QR.share })).toHaveCount(0)
    await expect(page.getByRole('button', { name: QR.downloadPng })).toBeVisible()
  })
})

// ── The record itself, which is where the conference actually happens ────────────────────────

const CLIENT_ID = '11111111-1111-1111-1111-111111111111'

/**
 * THE DRAWER WAS THE WORST OF THE THREE, and the least visible in a screenshot of the board.
 *
 * `w-[85vw]` with a `w-72` sidebar inside it left roughly 43px for the record on a 390px screen
 * — the panel the operator opens to check a partner's documents, generate the contract and pull
 * the QR down. Everything below is one claim: the record is on screen, its tabs are reachable,
 * and `Salvar` is where a thumb is, not at the bottom of a sidebar that no longer exists.
 */
async function mockClient(page: Page) {
  await page.route(`**/api/admin/clients/${CLIENT_ID}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        client: {
          id: CLIENT_ID,
          name: 'Pão do Edu',
          email: 'edu@exemplo.com.br',
          slug: 'pao-do-edu',
          status: 'pending',
          client_type: 'restaurante',
          country: 'Brazil',
        },
      }),
    })
  )
}

test.describe('#409 — the record drawer at 390px', () => {
  test('the record fills the screen and does not scroll sideways', async ({ mount, page }) => {
    await mockClient(page)
    await mount(
      <Wrapper>
        <ClientEditorModal clientId={CLIENT_ID} isOpen mode="edit" onClose={() => {}} />
      </Wrapper>
    )

    await expect(page.getByRole('heading', { name: 'Pão do Edu' })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    // 85vw of a 390px screen is 331px, and the 288px sidebar inside it left 43px for the
    // record. The drawer takes the whole width now; this is that number, asserted.
    const drawer = page.locator('.animate-in').first()
    const box = await drawer.boundingBox()
    expect(box?.width).toBeGreaterThanOrEqual(389)
  })

  test('the partner name has real width in the header', async ({ mount, page }) => {
    await mockClient(page)
    await mount(
      <Wrapper>
        <ClientEditorModal clientId={CLIENT_ID} isOpen mode="edit" onClose={() => {}} />
      </Wrapper>
    )

    /*
     * THE REGRESSION THIS GUARDS measured `width: 0`, not "a bit tight".
     *
     * The name group was `min-w-0` with no `flex-1`, beside a `shrink-0` group carrying the
     * status badge, `Aprovar` and `Recusar`. Those three fill a 390px bar on their own, so the
     * name collapsed to nothing and the operator was editing a record with no name on it —
     * while `toBeVisible()` is the assertion that catches it, the number is what says how bad
     * it was. 120px is well under what the name needs and well over zero.
     */
    const name = page.getByRole('heading', { name: 'Pão do Edu' })
    await expect(name).toBeVisible()
    const box = await name.boundingBox()
    expect(box?.width ?? 0).toBeGreaterThan(120)
  })

  test('the tabs are a strip, not a sidebar, and switching one works', async ({ mount, page }) => {
    await mockClient(page)
    await mount(
      <Wrapper>
        <ClientEditorModal clientId={CLIENT_ID} isOpen mode="edit" onClose={() => {}} />
      </Wrapper>
    )

    const strip = page.getByRole('navigation', { name: TABS.configuration })
    await expect(strip).toBeVisible()

    // One list rendered twice: the desktop `<aside>` is in the DOM but hidden, so each tab
    // resolves to exactly one VISIBLE control. A second copy of the list would break this.
    const profile = strip.getByRole('button', { name: TABS.profile })
    await expect(profile).toHaveCount(1)
    await profile.click()
    await expect(profile).toHaveAttribute('aria-current', 'page')
    await expectNoHorizontalOverflow(page)
  })

  test('Salvar is pinned to the bottom of the screen, not to a sidebar', async ({ mount, page }) => {
    await mockClient(page)
    await mount(
      <Wrapper>
        <ClientEditorModal clientId={CLIENT_ID} isOpen mode="edit" onClose={() => {}} />
      </Wrapper>
    )

    const save = page.getByRole('button', { name: ptMessages.Clients.editor.save })
    await expect(save).toHaveCount(1)
    await expect(save).toBeInViewport()

    // Pinned means: still on screen after the panel behind it has been scrolled. This is the
    // assertion that a `mt-auto` inside a scrolling column would fail.
    await page.mouse.wheel(0, 2000)
    await expect(save).toBeInViewport()
  })
})
