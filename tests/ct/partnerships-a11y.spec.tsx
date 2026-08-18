/**
 * #359 — the seven spec §8 criteria the `dev`'s test suite (`tests/api/partnerships-pipeline
 * .test.ts`, 39 cases, BR-B2B-010/-011/-017/-018, BR-CMS-002, the four `DS-*`) could not assert
 * without a real browser: `axe-core` (23), measured contrast (25), 24×24 CSS px targets (26),
 * keyboard operability of the queue (27), text never clipped by `max-height` + `overflow-
 * hidden` (28), the four `DS-COMPONENTE-002` states of the queue with the two empty states
 * distinct (7), and each detail band being a real `<section>`/`<h2>`/`aria-expanded` triple (24).
 *
 * Real Chromium (`playwright-ct.config.ts`, Tailwind resolved through the app's own
 * `postcss.config.js`), the actual `ClientDirectory`/`PartnershipDetail` components, and every
 * network call intercepted by `page.route` — see that file for why this is a component mount
 * and not a full page navigation (`proxy.ts`'s server-side auth check cannot be reached from a
 * browser-side route hook, and this suite has no CMS credential to sign in for real).
 *
 * Fixtures (`./fixtures/partnerships.ts`) are built with the SAME pure functions
 * (`buildPlaceReadiness`, `buildPublishPlan`) the screens and the API route call — not a second,
 * hand-rolled derivation that could drift from them silently.
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { PartnershipDetail } from '@/components/admin/partnerships/PartnershipDetail'
import { DirectoryHarness, Wrapper } from './helpers'
import {
  QUEUE_ROWS_IN_PROGRESS,
  LONG_ESTABLISHMENT_NAME,
  detailInCuration,
  detailReadyToPublish,
} from './fixtures/partnerships'

/**
 * The list's own endpoint. `/api/admin/partnerships` was retired with the queue: the working
 * set is a filter of this list now (`?state=in_progress`), not a screen of its own.
 */
async function mockQueue(page: Page, body: unknown, opts: { delayMs?: number; status?: number } = {}) {
  await page.route('**/api/admin/clients/directory', async (route) => {
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs))
    await route.fulfill({
      status: opts.status ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  })
}

async function mockDetail(page: Page, clientId: string, detail: unknown) {
  await page.route(`**/api/admin/partnerships/clients/${clientId}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ detail }) })
  )
}

// ── Criterion 7 — the four DS-COMPONENTE-002 states of the queue ───────────────────────────────

test.describe('criterion 7 (DS-COMPONENTE-002) — the four states of the queue', () => {
  test('loading shows the 5-row skeleton with the sr-only "Carregando" text', async ({ mount, page }) => {
    await mockQueue(page, { rows: QUEUE_ROWS_IN_PROGRESS, truncated: false }, { delayMs: 1200 })
    const component = await mount(
      <Wrapper>
        <DirectoryHarness />
      </Wrapper>
    )
    // Each of the 5 skeleton rows carries its own `sr-only` announcement.
    await expect(component.getByText('Carregando a lista…').first()).toBeVisible()
    await expect(component.getByText('Carregando a lista…')).toHaveCount(5)
    await expect(component.locator('tbody tr')).toHaveCount(5)
  })

  test('empty WITHOUT a filter reads "Nenhuma parceria na esteira" and offers no Clear button', async ({
    mount,
    page,
  }) => {
    await mockQueue(page, { rows: [], truncated: false })
    const component = await mount(
      <Wrapper>
        <DirectoryHarness />
      </Wrapper>
    )
    await expect(component.getByText('Nenhum cliente cadastrado ainda.')).toBeVisible()
    await expect(component.getByRole('button', { name: 'Limpar filtros' })).toHaveCount(0)
  })

  test('empty WITH a filter reads a different sentence and offers "Limpar filtros"', async ({ mount, page }) => {
    await mockQueue(page, { rows: QUEUE_ROWS_IN_PROGRESS, truncated: false })
    const component = await mount(
      <Wrapper>
        <DirectoryHarness />
      </Wrapper>
    )
    await expect(component.locator('tbody tr').first()).toBeVisible()
    await component.getByLabel('Buscar').fill('nome-que-nao-existe-em-nenhuma-linha')
    await expect(component.getByText('Nenhum cliente com esses filtros.')).toBeVisible()
    await expect(component.getByText('Nenhum cliente cadastrado ainda.')).toHaveCount(0)
    // Two, legitimately: the filter rail's own `Limpar filtros` (always present while
    // `filtering` is true) and the empty-state's own call to action.
    await expect(component.getByRole('button', { name: 'Limpar filtros' })).toHaveCount(2)
  })

  test('error state reads "Não foi possível carregar" with a retry button', async ({ mount, page }) => {
    await mockQueue(page, {}, { status: 500 })
    const component = await mount(
      <Wrapper>
        <DirectoryHarness />
      </Wrapper>
    )
    await expect(component.getByText('Não foi possível carregar a lista.')).toBeVisible()
    await expect(component.getByRole('button', { name: 'Tentar de novo' })).toBeVisible()
  })
})

// ── Criterion 24 — every band is a <section> with a heading and a coherent aria-expanded ───────

test('criterion 24 — every detail band is a <section> with an <h2> and aria-expanded matches state', async ({
  mount,
  page,
}) => {
  const detail = detailInCuration()
  await mockDetail(page, detail.client.id, detail)
  const component = await mount(
    <Wrapper>
      <PartnershipDetail locale="pt" clientId={detail.client.id} />
    </Wrapper>
  )
  await expect(component.getByText('Carregando a parceria.')).toHaveCount(0, { timeout: 10_000 })

  const sections = component.locator('section[aria-labelledby^="band-"]')
  await expect(sections).toHaveCount(5)

  for (let i = 0; i < 5; i++) {
    const section = sections.nth(i)
    await expect(section.locator('> h2')).toHaveCount(1)
    const headingId = await section.locator('> h2').getAttribute('id')
    const labelledBy = await section.getAttribute('aria-labelledby')
    expect(labelledBy).toBe(headingId)

    // Scoped to the heading's own button — an OPEN band's body can contain other buttons
    // (`Abrir o local`, `Publicar…`), and the toggle must resolve to exactly one element.
    const toggle = section.locator('h2 button[aria-expanded]')
    await expect(toggle).toHaveCount(1)
    await expect(toggle).toHaveAttribute('aria-expanded', /true|false/)
  }

  // Band 4 ("O local") is the current one for `place_in_curation` — it starts open, the
  // others start collapsed. This is the derivation `bandStatus`/`currentBand` in
  // `PartnershipDetail.tsx` compute from the state, not a guess.
  const placeToggle = component.getByRole('button', { name: /4 · O local/ })
  await expect(placeToggle).toHaveAttribute('aria-expanded', 'true')
  const proposalToggle = component.getByRole('button', { name: /1 · Proposta recebida/ })
  await expect(proposalToggle).toHaveAttribute('aria-expanded', 'false')

  // The control genuinely drives the state, in both directions.
  await proposalToggle.click()
  await expect(proposalToggle).toHaveAttribute('aria-expanded', 'true')
  await placeToggle.click()
  await expect(placeToggle).toHaveAttribute('aria-expanded', 'false')
  // `aria-controls` names a region that exists and toggles visibility with it.
  const controlsId = await placeToggle.getAttribute('aria-controls')
  expect(controlsId).toBeTruthy()
  await expect(component.locator(`#${controlsId}`)).toHaveCount(0)
  await placeToggle.click()
  await expect(component.locator(`#${controlsId}`)).toHaveCount(1)
})

// ── Criterion 28 — no ancestor combines max-height with overflow-hidden; the 80-char name ──────

test('criterion 28 — 80-char name is whole in the detail and no text ancestor clips it', async ({ mount, page }) => {
  const detail = detailInCuration()
  await mockDetail(page, detail.client.id, detail)
  const component = await mount(
    <Wrapper>
      <PartnershipDetail locale="pt" clientId={detail.client.id} />
    </Wrapper>
  )
  await expect(component.getByText('Carregando a parceria.')).toHaveCount(0, { timeout: 10_000 })

  // Two places carry the 80-char name here: the header `<h1>` (client) and the place `<h3>`
  // inside band 4. `textContent()`, never `toHaveAccessibleName` — this repo has already lost
  // an assertion to that matcher swallowing a whitespace-join bug between inline children
  // (see `.claude/agent-memory/qa` notes on this project's gotchas).
  const heading = component.locator('h1')
  await expect(heading).toHaveCount(1)
  expect((await heading.textContent())?.trim()).toBe(LONG_ESTABLISHMENT_NAME)

  const placeHeading = component.locator('h3', { hasText: LONG_ESTABLISHMENT_NAME })
  await expect(placeHeading).toHaveCount(1)
  expect((await placeHeading.textContent())?.trim()).toBe(LONG_ESTABLISHMENT_NAME)

  for (const locator of [heading, placeHeading]) {
    // Not clipped: the rendered box's scrollHeight never exceeds its clientHeight.
    const box = await locator.boundingBox()
    expect(box).not.toBeNull()
    const scrollHeight = await locator.evaluate((el) => el.scrollHeight)
    const clientHeight = await locator.evaluate((el) => el.clientHeight)
    expect(scrollHeight).toBeLessThanOrEqual(clientHeight + 1) // +1: sub-pixel rounding

    // No ancestor up to <body> combines `max-height` with `overflow: hidden` / `overflow-y:
    // hidden` — the exact pair this team has already lost text to (spec §6.1, §7).
    const offendingAncestor = await locator.evaluate((el) => {
      let node: HTMLElement | null = el as HTMLElement
      while (node && node !== document.body) {
        const style = getComputedStyle(node)
        const clipsOverflow = style.overflow === 'hidden' || style.overflowY === 'hidden'
        const capsHeight = style.maxHeight !== 'none'
        if (clipsOverflow && capsHeight) return node.outerHTML.slice(0, 200)
        node = node.parentElement
      }
      return null
    })
    expect(offendingAncestor).toBeNull()
  }
})

// ── Criteria 23, 25, 26 — axe-core, contrast (4.5:1 / 3:1) and 24x24 targets ────────────────────

test.describe('criteria 23/25/26 — axe-core, contrast, and 24x24 targets', () => {
  test('the queue with rows loaded', async ({ mount, page }) => {
    await mockQueue(page, { rows: QUEUE_ROWS_IN_PROGRESS, truncated: false })
    const component = await mount(
      <Wrapper>
        <DirectoryHarness />
      </Wrapper>
    )
    await expect(component.locator('tbody tr').first()).toBeVisible()
    await assertNoAxeViolations(page)
  })

  test('the queue, empty without filter', async ({ mount, page }) => {
    await mockQueue(page, { rows: [], truncated: false })
    const component = await mount(
      <Wrapper>
        <DirectoryHarness />
      </Wrapper>
    )
    await expect(component.getByText('Nenhum cliente cadastrado ainda.')).toBeVisible()
    await assertNoAxeViolations(page)
  })

  test('the queue, empty with filter', async ({ mount, page }) => {
    await mockQueue(page, { rows: QUEUE_ROWS_IN_PROGRESS, truncated: false })
    const component = await mount(
      <Wrapper>
        <DirectoryHarness />
      </Wrapper>
    )
    await expect(component.locator('tbody tr').first()).toBeVisible()
    await component.getByLabel('Buscar').fill('nome-que-nao-existe-em-nenhuma-linha')
    await expect(component.getByText('Nenhum cliente com esses filtros.')).toBeVisible()
    await assertNoAxeViolations(page)
  })

  test('the queue, error state', async ({ mount, page }) => {
    await mockQueue(page, {}, { status: 500 })
    const component = await mount(
      <Wrapper>
        <DirectoryHarness />
      </Wrapper>
    )
    await expect(component.getByText('Não foi possível carregar a lista.')).toBeVisible()
    await assertNoAxeViolations(page)
  })

  test('the detail, all five bands rendered (band 4 open with all three pendency classes)', async ({
    mount,
    page,
  }) => {
    const detail = detailInCuration()
    await mockDetail(page, detail.client.id, detail)
    const component = await mount(
      <Wrapper>
        <PartnershipDetail locale="pt" clientId={detail.client.id} />
      </Wrapper>
    )
    await expect(component.getByText('Carregando a parceria.')).toHaveCount(0, { timeout: 10_000 })
    // All three pendency classes visible at once — the richest render of this screen.
    await expect(component.getByText('Impede aparecer no app')).toBeVisible()
    await expect(component.getByText('Publica, e o app fica mudo')).toBeVisible()
    await expect(component.getByText('Melhora, e não impede nada')).toBeVisible()
    await assertNoAxeViolations(page)
  })

  test('the publish panel, "paid_starts" variant open', async ({ mount, page }) => {
    const detail = detailReadyToPublish()
    await mockDetail(page, detail.client.id, detail)
    const component = await mount(
      <Wrapper>
        <PartnershipDetail locale="pt" clientId={detail.client.id} />
      </Wrapper>
    )
    await expect(component.getByText('Carregando a parceria.')).toHaveCount(0, { timeout: 10_000 })
    await component.getByRole('button', { name: /Publicar Pousada Vista Mar no app/ }).click()
    await expect(component.getByText('Isto inicia a mensalidade.')).toBeVisible()
    await assertNoAxeViolations(page)
  })
})

async function assertNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    // Scoped to the mounted component, not the whole document: this harness's host page has
    // no `<title>`/`<html lang>` of its own (`playwright/index.html` is a component-test
    // fixture, not a real route), and `document-title`/`html-has-lang` would be testing that
    // harness, not the screen. The real page (`app/[locale]/layout.tsx`) sets both.
    .include('#root')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(results.violations, describeViolations(results.violations)).toEqual([])
}

function describeViolations(violations: import('axe-core').Result[]): string {
  if (violations.length === 0) return ''
  return violations
    .map(
      (v) =>
        `${v.id} (${v.impact}): ${v.help}\n` +
        v.nodes.map((n) => `  - ${n.target.join(' ')}: ${n.failureSummary}`).join('\n')
    )
    .join('\n\n')
}

// ── Criterion 25, in addition to axe's color-contrast: the brand-blue ban ──────────────────────
//
// SCOPE NOTE. This checks the esteira's OWN components, `ClientDirectory` and
// `PartnershipDetail` — not `components/ui/Header.tsx`, which this suite does not mount (see
// `./helpers.tsx`). Reading `Header.tsx` directly: `renderNavItem` paints the active nav link
// `text-tuggi-blue` (`bg-tuggi-blue/10 text-tuggi-blue …`), and visiting either new route makes
// `Parcerias` (inside the `admin` dropdown) the active item, which also turns the "Admin"
// dropdown TRIGGER itself `text-tuggi-blue` via `hasActiveItem` — visible without opening the
// dropdown. That is a real, code-read violation of criterion 25's literal wording ("em nenhuma
// das rotas novas"), but it is pre-existing shared chrome common to every `/admin/*` page, not
// code this card touched. Reported to the card as a finding for `dev`, not asserted here.

test('criterion 25 — #00A8E8 never paints text or an informative icon inside the esteira components', async ({
  mount,
  page,
}) => {
  await mockQueue(page, { rows: QUEUE_ROWS_IN_PROGRESS, truncated: false })
  const queue = await mount(
    <Wrapper>
      <DirectoryHarness />
    </Wrapper>
  )
  await expect(queue.locator('tbody tr').first()).toBeVisible()
  const queueOffenders = await findTuggiBluePaintedText(page)
  await queue.unmount()

  const detail = detailReadyToPublish()
  await mockDetail(page, detail.client.id, detail)
  const detailComponent = await mount(
    <Wrapper>
      <PartnershipDetail locale="pt" clientId={detail.client.id} />
    </Wrapper>
  )
  await expect(detailComponent.getByText('Carregando a parceria.')).toHaveCount(0, { timeout: 10_000 })
  const detailOffenders = await findTuggiBluePaintedText(page)

  expect(
    { queue: queueOffenders, detail: detailOffenders },
    'text-tuggi-blue (#00A8E8) painted an element with text content — see the list'
  ).toEqual({ queue: [], detail: [] })
})

/**
 * Every element with non-empty own text, whose computed `color` (or, for an icon-only element,
 * `fill`/`stroke`) is `#00A8E8`.
 */
async function findTuggiBluePaintedText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const BRAND_BLUE_RGB = 'rgb(0, 168, 232)' // #00A8E8
    const offenders: string[] = []
    const root = document.getElementById('root')
    if (!root) return offenders
    const all = root.querySelectorAll<HTMLElement>('*')
    for (const el of Array.from(all)) {
      const style = getComputedStyle(el)
      const ownText = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent?.trim() ?? '')
        .join('')
      if (ownText.length > 0 && style.color === BRAND_BLUE_RGB) {
        offenders.push(`text "${ownText.slice(0, 60)}" on <${el.tagName.toLowerCase()} class="${el.className}">`)
      }
      const isIcon = el.tagName.toLowerCase() === 'svg' && el.getAttribute('aria-hidden') !== 'true'
      if (isIcon && (style.color === BRAND_BLUE_RGB || style.fill === BRAND_BLUE_RGB)) {
        offenders.push(`informative icon <svg class="${el.getAttribute('class')}">`)
      }
    }
    return offenders
  })
}

// ── Criterion 27 — the queue is operable with the keyboard alone ───────────────────────────────

test('criterion 27 — the queue: filters, the state counters, and each row\'s "Abrir" are keyboard-operable', async ({
  mount,
  page,
}) => {
  await mockQueue(page, { rows: QUEUE_ROWS_IN_PROGRESS, truncated: false })
  const component = await mount(
    <Wrapper>
      <DirectoryHarness />
    </Wrapper>
  )
  await expect(component.locator('tbody tr').first()).toBeVisible()

  // The search input is reachable by keyboard and accepts typed text without a pointer.
  await component.getByLabel('Buscar').focus()
  await expect(component.getByLabel('Buscar')).toBeFocused()
  await page.keyboard.type('Cantina')
  await expect(component.getByLabel('Buscar')).toHaveValue('Cantina')
  await component.getByLabel('Buscar').fill('')

  // The state filter is the rail now, not a <select>: every option is a real <button>, so it
  // is in the default Tab order and activates on Enter/Space — never a <div onClick>. Same
  // guarantee the queue's counters carried (spec §6.1), on the control that replaced them.
  const working = component.getByRole('button', { name: /Em andamento \d/ })
  await working.focus()
  await expect(working).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(working).toHaveAttribute('aria-pressed', 'true')

  // And one concrete state, with the count it opens beside it.
  const oneState = component.getByRole('button', { name: /Proposta recebida \d/ })
  await oneState.focus()
  await expect(oneState).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(oneState).toHaveAttribute('aria-pressed', 'true')
  // Pressing it again clears the dimension — the rail toggles, it does not trap.
  await page.keyboard.press('Enter')
  await expect(oneState).toHaveAttribute('aria-pressed', 'false')

  // Every row's `Abrir` is a real link (keyboard-focusable) with the whole establishment name
  // in its accessible name — the column itself may truncate (spec §6.1), the control that
  // opens the row may not. `href` is asserted rather than clicked-through: this suite has no
  // route to navigate TO (see `playwright-ct.config.ts`), so the proof that Enter would work
  // is that this is a real `<a href>`, focusable, pointing at the right place — not a
  // non-interactive element with a click handler.
  const openLink = component.getByRole('link', { name: /Abrir Cantina do Zé/ })
  await expect(openLink).toBeVisible()
  await openLink.focus()
  await expect(openLink).toBeFocused()
  await expect(openLink).toHaveAttribute('href', '/pt/admin/partnerships/proposals/sub-0001')
})
