/**
 * THE NICKNAME IS THE DOOR — #659, and it has to be a door a keyboard can open.
 *
 * Two of the six surfaces that print a tourist opened the file from an `onClick` on the
 * `<tr>`; the other four printed dead text. A row with a click handler has no role, is not in
 * the tab order and announces nothing — so "it already worked" meant "it worked for a mouse".
 * What this suite asserts is the part a static scan cannot: that the label is a real control,
 * that Enter opens it, that the dialog says it is a dialog, and that closing puts the operator
 * back on the row he came from instead of at the top of a 500-row report.
 *
 * **`0` and an em dash are different sentences** — **BR-MONETIZACAO-046**, and the reason the
 * hours block exists at all. `core.dashboard_user_detail` gains its nine hour columns in a
 * migration that lands after this code, and `formatDuration(null)` answers `0 min`. On screen
 * `0 min` is "this person consumed nothing"; the truth is "the column is not there yet". The
 * second test pair is the difference between those two.
 *
 * **The name and the e-mail never reach the DOM** — **BR-USUARIO-042**. The pre-migration RPC
 * still answers with both columns, so the payload here carries them on purpose: what is being
 * proven is that `toUserDetail` drops them at the door, not that somebody remembered to leave
 * them out of the JSX.
 *
 * See `playwright-ct.config.ts` for why this is a component mount and not a page navigation.
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page } from '@playwright/test'
import { AppUserLinkHarness, DashboardWrapper } from './helpers'
import ptMessages from '@/messages/pt.json'

const MODAL = ptMessages.Pages.AppUsers.modal
const PANEL = ptMessages.Pages.AppUsers.credit.panel
const GRANTS = ptMessages.Pages.AppUsers.credit.grants
const LABELS = ptMessages.Pages.Dashboard.labels
const COMMON = ptMessages.Common.labels

const NICKNAME = 'hoppy-otter'
const USER_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

/**
 * The row as the RPC answers it TODAY: the two columns BR-USUARIO-042 removes are still in the
 * payload, and none of the nine hour columns exist yet. Both halves are deliberate.
 */
const PRE_MIGRATION_ROW = {
  user_id: USER_ID,
  nickname: NICKNAME,
  full_name: 'Joana Ribeiro da Silva',
  email: 'joana.ribeiro@example.com',
  country: 'BR',
  language: 'pt',
  driver_type: 'tourist',
  last_platform: 'ios',
  last_device_model: 'iPhone 15',
  last_app_version: '2.4.0',
  subscription_tier_display_name: null,
  subscription_provider: null,
  is_premium: false,
  login_count: 12,
  last_sign_in_at: '2026-08-30T10:00:00Z',
  created_at: '2026-05-01T10:00:00Z',
  onboarding_completed: true,
  trip_count: 4,
  total_km: 210.4,
  poi_visits_count: 31,
  last_trip_at: '2026-08-29T10:00:00Z',
  unique_cities_visited: 3,
  subscription_history: [],
  client_id: null,
  linked_client: null,
}

/** The same row after the migration: the nine columns are there and the two are gone. */
const POST_MIGRATION_ROW = {
  ...PRE_MIGRATION_ROW,
  full_name: undefined,
  email: undefined,
  state: 'metered',
  balance_minutes: 150,
  minutes_granted_total: 600,
  minutes_consumed_total: 450,
  has_purchase: true,
  last_grant_source: 'purchase',
  last_grant_at: '2026-08-20T10:00:00Z',
  last_purchase_product_id: 'tuggi_hours_10',
  ends_at: null,
}

async function mockDetail(page: Page, row: Record<string, unknown>) {
  await page.route('**/rest/v1/rpc/dashboard_user_detail', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([row]) })
  )
  // Not an admin: the credit panel answers 403, which is a STATE and not a failure. It is also
  // the operator for whom the hours block is the only place the hours exist.
  await page.route('**/api/auth/check', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { role: 'viewer' } }) })
  )
  await page.route('**/api/admin/users/**', (route) =>
    route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'forbidden' }) })
  )
}

test.describe('BR-USUARIO-042 — the nickname is the identifier, and the door', () => {
  test('the label is a button, not dead text, and it carries the nickname as its name', async ({ mount, page }) => {
    await mockDetail(page, POST_MIGRATION_ROW)
    await mount(<DashboardWrapper><AppUserLinkHarness /></DashboardWrapper>)

    const trigger = page.getByRole('button', { name: NICKNAME })
    await expect(trigger).toBeVisible()
    // The nickname IS the accessible name. An `aria-label` here would make the operator hear
    // something other than what he reads, which is how the identifier quietly grows a second.
    await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
  })

  test('a keyboard opens the file, and Esc gives the row back', async ({ mount, page }) => {
    await mockDetail(page, POST_MIGRATION_ROW)
    await mount(<DashboardWrapper><AppUserLinkHarness /></DashboardWrapper>)

    const trigger = page.getByRole('button', { name: NICKNAME })

    // Tab order: the harness puts a button on each side, so reaching the label by keyboard is
    // a claim about the label and not about it being the only control on the page.
    await page.getByRole('button', { name: 'antes' }).focus()
    await page.keyboard.press('Tab')
    await expect(trigger).toBeFocused()

    await page.keyboard.press('Enter')

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('aria-modal', 'true')
    await expect(dialog.getByRole('heading', { name: new RegExp(NICKNAME) })).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
  })

  test('with no nickname the label is the truncated user_id, and it opens the same file', async ({ mount, page }) => {
    await mockDetail(page, { ...POST_MIGRATION_ROW, nickname: null })
    await mount(<DashboardWrapper><AppUserLinkHarness nickname={null} /></DashboardWrapper>)

    // Eight characters, from the front — `USER_ID_LABEL_CHARS`, the rule's item 2.
    await page.getByRole('button', { name: 'a1b2c3d4' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
  })

  test('the payload still carries the name and the e-mail; the screen never does', async ({ mount, page }) => {
    await mockDetail(page, PRE_MIGRATION_ROW)
    await mount(<DashboardWrapper><AppUserLinkHarness /></DashboardWrapper>)

    await page.getByRole('button', { name: NICKNAME }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    const rendered = await dialog.innerText()
    expect(rendered).toContain(NICKNAME)
    expect(rendered).not.toContain('Joana')
    expect(rendered).not.toContain('joana.ribeiro@example.com')
    // Not even a fragment: the local part of an address is the same personal datum, cut
    // smaller (the rule's item 2, and the fallback it exists to close).
    expect(rendered).not.toContain('joana.ribeiro')
  })
})

test.describe('BR-MONETIZACAO-046 — the hours come resolved, and absent is not zero', () => {
  test('with the nine columns the block states balance, both totals, origin and purchase', async ({ mount, page }) => {
    await mockDetail(page, POST_MIGRATION_ROW)
    await mount(<DashboardWrapper><AppUserLinkHarness /></DashboardWrapper>)

    await page.getByRole('button', { name: NICKNAME }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText(MODAL.hours)).toBeVisible()

    const rendered = await dialog.innerText()
    // The state is the database's answer, never recomputed here.
    expect(rendered).toContain(PANEL.state_metered)
    expect(rendered).toContain('2 h 30 min')  // balance_minutes: 150
    expect(rendered).toContain('10 h')        // minutes_granted_total: 600
    expect(rendered).toContain('7 h 30 min')  // minutes_consumed_total: 450
    expect(rendered).toContain(GRANTS.source_purchase)
    expect(rendered).toContain(COMMON.yes)
  })

  test('without the columns the block is empty, and there is no 0 min anywhere', async ({ mount, page }) => {
    await mockDetail(page, PRE_MIGRATION_ROW)
    await mount(<DashboardWrapper><AppUserLinkHarness /></DashboardWrapper>)

    await page.getByRole('button', { name: NICKNAME }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText(MODAL.hours)).toBeVisible()
    await expect(dialog.getByText(LABELS.no_paid_access_data)).toBeVisible()

    const rendered = await dialog.innerText()
    // The whole assertion of this card's degradation clause. `0 min` would say "consumed
    // nothing"; `Não` would say "never bought". Neither is a fact anybody has yet.
    expect(rendered).not.toContain('0 min')
    expect(rendered).not.toContain(PANEL.state_free)
  })
})
