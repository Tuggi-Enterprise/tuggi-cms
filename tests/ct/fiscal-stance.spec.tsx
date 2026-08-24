/**
 * PAGANTE OU NÃO PAGANTE, on the tab that decides it.
 *
 * The board's cards wear the stance as a colour on their left edge; here it is a badge beside
 * the `Valor mensal do contrato` field, and the difference in FORM follows a difference in how
 * the two surfaces are read — a stacked column is scanned, a form is read field by field.
 *
 * WHAT THIS SUITE GUARDS THAT THE PURE ONE CANNOT. `tests/api/partner-plan.test.ts` proves the
 * binary rule; nothing there can prove that this tab reads it off the RIGHT SOURCE. That is the
 * mistake with teeth: `derivePartnerPlan` lets a signed `free` contract outrank the record, and
 * a badge deriving from it would print `Não pagante` over a field somebody is at that moment
 * typing `149,00` into. This tab is the registration, so the badge is `registrationMoneyKind`
 * and follows `edited` rather than `client` — the operator sees what they are about to store.
 *
 * See `playwright-ct.config.ts` for why this is a component mount and not a page navigation.
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { Wrapper } from './helpers'
import { FiscalPaymentsTab } from '@/components/admin/clients/tabs/FiscalPaymentsTab'
import type { Client } from '@/types/clients'
import ptMessages from '@/messages/pt.json'

const STANCE = ptMessages.Clients.stance
const CLIENT_ID = '11111111-1111-1111-1111-111111111111'

/** The two measured tokens, as the browser reports them. */
const PAYING_INK = 'rgb(21, 128, 61)' //  green-700 #15803D — 5.02:1 on white, 4.79:1 on green-50
const NOT_PAYING_INK = 'rgb(55, 65, 81)' // gray-700 #374151 — 10.31:1 on white

function client(overrides: Partial<Client> = {}): Client {
  return {
    id: CLIENT_ID,
    name: 'Pão do Edu',
    email: 'edu@exemplo.com.br',
    status: 'approved',
    monthly_fee_cents: null,
    is_courtesy: false,
    courtesy_reason: null,
    ...overrides,
  } as Client
}

/**
 * The tab asks `/contract` for the frozen value on mount. It is answered with `204` here: the
 * badge is about the REGISTRATION, and letting a real contract into these fixtures would be
 * testing a fact this component is not the owner of.
 */
async function mockNoContract(page: Page) {
  await page.route(`**/api/admin/clients/${CLIENT_ID}/contract`, (route) =>
    route.fulfill({ status: 204, contentType: 'application/json', body: '' })
  )
}

function mountTab(overrides: Partial<Client>, editing: boolean) {
  return (
    <Wrapper>
      <FiscalPaymentsTab
        client={client(overrides)}
        edited={{}}
        updateField={() => {}}
        canEdit={editing}
        clientId={CLIENT_ID}
      />
    </Wrapper>
  )
}

const badge = (page: Page, label: string) => page.getByText(label, { exact: true })

// ── The three registration states, in the two words the operator chose ───────────────────────

test.describe('#409 — the badge reads the registration', () => {
  test('a fee somebody typed is `Pagante`', async ({ mount, page }) => {
    await mockNoContract(page)
    await mount(mountTab({ monthly_fee_cents: 14900 }, false))

    await expect(badge(page, STANCE.paying)).toBeVisible()
    await expect(badge(page, STANCE.not_paying)).toHaveCount(0)
  })

  test('a courtesy WITH its reason is `Não pagante`', async ({ mount, page }) => {
    await mockNoContract(page)
    await mount(
      mountTab({ is_courtesy: true, courtesy_reason: 'patrocínio do festival' }, false)
    )

    await expect(badge(page, STANCE.not_paying)).toBeVisible()
  })

  /**
   * NOBODY FILLED THE RECORD IN, and the badge says `Não pagante` — which is true of the money
   * and silent about whose decision it was. The distinction is not lost: BR-B2B-017, item 6, is
   * enforced by `buildPublishPlan`, which refuses to publish this row, and the board's card
   * prints `Plano: ninguém declarou` in words. The badge is a summary, never the record.
   */
  test('a registration nobody filled in is `Não pagante`, and nothing more is claimed', async ({
    mount,
    page,
  }) => {
    await mockNoContract(page)
    await mount(mountTab({}, false))

    await expect(badge(page, STANCE.not_paying)).toBeVisible()
  })

  /**
   * ZERO IS NOT A FEE — BR-B2B-017, item 6, and the defect `registrationMoneyKind` was extracted
   * to end. Three readers each guessed the converse of `absent is NOT zero` differently, and one
   * of them published a partner announcing that billing starts at R$ 0,00. A badge reading
   * `Pagante` over a stored zero would be the fourth guess.
   */
  test('a stored zero is `Não pagante`, not a fee of nothing', async ({ mount, page }) => {
    await mockNoContract(page)
    await mount(mountTab({ monthly_fee_cents: 0 }, false))

    await expect(badge(page, STANCE.not_paying)).toBeVisible()
    await expect(badge(page, STANCE.paying)).toHaveCount(0)
  })

  /**
   * A COURTESY WITHOUT A REASON IS NOT A COURTESY. `isRecordedCourtesy` requires the reason
   * because an unexplained discount is exactly what BR-B2B-017, item 6, forbids — so this row
   * is `undeclared`, and lands in `Não pagante` for a different reason than the row above. Both
   * are `Não pagante`; only the record tells them apart, which is why the record is what the
   * operator reads and the badge is only the summary.
   */
  test('a courtesy with no reason still summarises as `Não pagante`', async ({ mount, page }) => {
    await mockNoContract(page)
    await mount(mountTab({ is_courtesy: true, courtesy_reason: null }, false))

    await expect(badge(page, STANCE.not_paying)).toBeVisible()
  })
})

// ── The colour, measured, and the word that makes it legal ───────────────────────────────────

test.describe('#409 · DS-A11Y-003 — the badge carries three channels', () => {
  test('the ink is the measured token in each stance', async ({ mount, page }) => {
    await mockNoContract(page)
    await mount(mountTab({ monthly_fee_cents: 14900 }, false))

    const paying = badge(page, STANCE.paying)
    expect(await paying.evaluate((node) => getComputedStyle(node).color)).toBe(PAYING_INK)
  })

  test('the not-paying ink is the measured token too', async ({ mount, page }) => {
    await mockNoContract(page)
    await mount(mountTab({}, false))

    const notPaying = badge(page, STANCE.not_paying)
    expect(await notPaying.evaluate((node) => getComputedStyle(node).color)).toBe(NOT_PAYING_INK)
  })

  test('the icon is decorative, so the word is the whole accessible name', async ({
    mount,
    page,
  }) => {
    await mockNoContract(page)
    await mount(mountTab({ monthly_fee_cents: 14900 }, false))

    // DS-A11Y-004: the name says the meaning, never the drawing. An `svg` that announced itself
    // would put `circle-dollar-sign` in front of the word.
    const icon = badge(page, STANCE.paying).locator('svg')
    await expect(icon).toHaveAttribute('aria-hidden', 'true')
  })

  /**
   * AXE OVER THE TAB, ASSERTING ONLY ABOUT THE BADGE — and the narrowing is stated, not hidden.
   *
   * A whole-tab `toEqual([])` is what this test wanted to be, and it cannot be yet: every
   * micro-caps label in `FiscalPaymentsTab` is `text-gray-400` (#9CA3AF), which measures 2.53:1
   * at 10px bold on white against the 4.5:1 of SC 1.4.3. That is the SAME pattern
   * `ClientDirectory`'s `Stat` already wrote down and corrected to `text-gray-500` (4.83:1) —
   * pre-existing, repo-wide across all eight tabs of the record, and not this card's to absorb
   * in passing. Reported to `design` as a finding about the pattern.
   *
   * So the assertion is the honest one: axe runs over the whole tab, and NO violation is allowed
   * to land on the badge. The day the labels are fixed, this becomes the unscoped check it
   * should have been, and deleting the filter is the whole change.
   */
  test('axe-core finds nothing wrong with the badge itself', async ({ mount, page }) => {
    await mockNoContract(page)
    await mount(mountTab({ monthly_fee_cents: 14900 }, false))
    await expect(badge(page, STANCE.paying)).toBeVisible()

    const results = await new AxeBuilder({ page })
      .include('#root')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()

    const onTheBadge = results.violations.flatMap((violation) =>
      violation.nodes
        .filter((node) => node.html.includes(STANCE.paying))
        .map((node) => `${violation.id}: ${node.failureSummary}`)
    )
    expect(onTheBadge, JSON.stringify(onTheBadge, null, 2)).toEqual([])

    // And the pre-existing debt is NAMED rather than silently tolerated: if somebody fixes the
    // `text-gray-400` labels, this line fails and the filter above comes out with it.
    const grayLabels = results.violations
      .flatMap((violation) => violation.nodes)
      .filter((node) => node.html.includes('text-gray-400'))
    expect(
      grayLabels.length,
      'os rótulos `text-gray-400` foram corrigidos — remova o filtro acima e afirme a aba inteira'
    ).toBeGreaterThan(0)
  })
})
