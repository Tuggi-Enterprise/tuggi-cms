/**
 * THE PUSH COMPOSER, in a real browser.
 *
 * These five assertions are the ones a source scan cannot make: whether a request LEFT before
 * the operator confirmed, whether an error reached the DOM instead of a modal `alert`, what the
 * payload actually carried, whether the screen speaks the operator's language, and what
 * `axe-core` finds in the tree the operator receives.
 *
 * WHY A SESSION COOKIE IS SEEDED. `NotificationService._callFunctionEndpoint` asks
 * `supabase.auth.getSession()` for a token before it fetches, and with no session it throws
 * `Not authenticated` — which would make the "the Edge Function's 400 reaches the DOM" case
 * assert on the wrong error. The cookie is the one `@supabase/ssr` writes itself
 * (`sb-<ref>-auth-token`, `base64-` + base64url JSON); no request carrying it is ever made for
 * real, because every one of them is intercepted.
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page, BrowserContext } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import ptMessages from '@/messages/pt.json'
import { PushComposerHarness } from './marketing-push-helpers'

const PUSH = ptMessages.Pages.Notifications
const AUDIENCE = ptMessages.Pages.Marketing.Audience

const CT_ORIGIN = 'http://localhost:3100'
const SUPABASE_REF = 'ct-fixture'

function base64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function seedSession(context: BrowserContext) {
  const now = Math.floor(Date.now() / 1000)
  const session = {
    access_token: 'ct-access-token',
    refresh_token: 'ct-refresh-token',
    token_type: 'bearer',
    expires_in: 31_536_000,
    expires_at: now + 31_536_000,
    user: {
      id: '00000000-0000-0000-0000-000000000001',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'ct@tuggi.app',
      app_metadata: {},
      user_metadata: {},
      created_at: new Date(now * 1000).toISOString(),
    },
  }
  await context.addCookies([
    {
      name: `sb-${SUPABASE_REF}-auth-token`,
      value: `base64-${base64url(JSON.stringify(session))}`,
      url: CT_ORIGIN,
    },
  ])
}

/** Every read the screen makes on mount, so nothing reaches a real host. */
async function mockReads(page: Page, opts: { role?: string; estimate?: number } = {}) {
  await page.route('**/api/auth/check', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: { role: opts.role ?? 'admin', enabledModules: [] } }),
    })
  )
  await page.route('**/rest/v1/rpc/estimate_notification_audience', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: String(opts.estimate ?? 1234) })
  )
  await page.route('**/rest/v1/subscription_tiers**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
}

/** Records every call to the Edge Function and answers it. */
async function mockSend(page: Page, opts: { status?: number; body?: string } = {}) {
  const calls: any[] = []
  await page.route('**/functions/v1/firebase-push-notification/**', async (route) => {
    calls.push(JSON.parse(route.request().postData() || '{}'))
    await route.fulfill({
      status: opts.status ?? 200,
      contentType: 'application/json',
      body: opts.body ?? JSON.stringify({
        success: true,
        // The shape a localized broadcast answers with: one entry per pass.
        passes: [{ language: 'pt', recipients: 904, success: 900, failure: 4, status: 'sent' }],
        result: { success: 900, failure: 4 },
      }),
    })
  })
  return calls
}

/**
 * `window.alert` is what this screen must NEVER open again — it blocks the tab, cannot be
 * copied, and disappears. Two nets: the browser-level dialog event (a real `alert` would fire
 * it) and a counter installed over `window.alert` once the page exists.
 */
function watchNativeDialogs(page: Page) {
  const opened: string[] = []
  page.on('dialog', async (d) => {
    opened.push(d.message())
    await d.dismiss()
  })
  return opened
}

async function countAlerts(page: Page) {
  await page.evaluate(() => {
    ;(window as any).__alerts = []
    window.alert = (msg?: any) => { (window as any).__alerts.push(String(msg)) }
  })
}

/** Fills the minimum a send needs: campaign key, title and body in the default language. */
async function composeMinimum(page: Page) {
  await page.getByLabel(PUSH.content.campaign_type_label).fill('promo_verao_2026')
  await page.getByLabel(PUSH.content.label_title, { exact: true }).fill('Uma oferta para você')
  await page.getByLabel(PUSH.content.label_body, { exact: true }).fill('Toque para ver o que preparamos hoje.')
}

let nativeDialogs: string[] = []

test.beforeEach(async ({ context, page }) => {
  await seedSession(context)
  nativeDialogs = watchNativeDialogs(page)
})

/**
 * DS-COMPONENTE-013 — confirmation of an irreversible act. The act here is irreversible in the
 * strongest sense the product has: `core.broadcast_persist_inbox` writes a row into every
 * recipient's inbox and nothing removes it.
 */
test('DS-COMPONENTE-013: the send button opens the confirmation and sends nothing', async ({ mount, page }) => {
  await mockReads(page)
  const calls = await mockSend(page)
  await mount(<PushComposerHarness />)

  await composeMinimum(page)
  await page.getByRole('button', { name: PUSH.actions.send_now }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText(PUSH.confirm.irreversible)).toBeVisible()
  // No filter was picked, and the dialog says so in those words.
  await expect(dialog.getByTestId('confirm-whole-base')).toHaveText(PUSH.confirm.whole_base)
  await expect(dialog.getByTestId('confirm-estimate')).toContainText('1.234')

  expect(calls).toHaveLength(0)
})

/** The gate: confirm stays shut until the operator types the number of recipients. */
test('DS-COMPONENTE-013: confirm unlocks only when the recipient count is typed', async ({ mount, page }) => {
  await mockReads(page)
  const calls = await mockSend(page)
  await mount(<PushComposerHarness />)

  await composeMinimum(page)
  await page.getByRole('button', { name: PUSH.actions.send_now }).click()

  const dialog = page.getByRole('dialog')
  const confirm = dialog.getByRole('button', { name: /Enviar para/ })
  await expect(confirm).toBeDisabled()

  await dialog.getByRole('textbox').fill('99')
  await expect(confirm).toBeDisabled()
  expect(calls).toHaveLength(0)

  await dialog.getByRole('textbox').fill('1234')
  await expect(confirm).toBeEnabled()
  await confirm.click()

  await expect.poll(() => calls.length).toBe(1)
})

/**
 * `priority: high` is a setting Firebase punishes when it is used as a default — the official
 * guidance ("Set and manage Android message priority") reserves it for messages that produce
 * user interaction, and the penalty lands on the app instance, not on the campaign.
 */
test('a broadcast leaves with priority normal and a campaign key in data.type', async ({ mount, page }) => {
  await mockReads(page)
  const calls = await mockSend(page)
  await mount(<PushComposerHarness />)

  await composeMinimum(page)
  await page.getByRole('button', { name: PUSH.actions.send_now }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox').fill('1234')
  await dialog.getByRole('button', { name: /Enviar para/ }).click()

  await expect.poll(() => calls.length).toBe(1)
  expect(calls[0].priority).toBe('normal')
  // `generic` is a bucket, not a variant — docs/contracts/notificacoes.md §2.3.
  expect(calls[0].notification.data.type).toBe('promo_verao_2026')
  // No `language` is sent: the Edge Function narrows it per pass, and pinning one here would
  // aim every pass at the same slice.
  expect(calls[0].filters.language).toBeUndefined()
  expect(Object.keys(calls[0].localized)).toEqual(['pt'])
})

/**
 * The Edge Function's own words reach the screen. `alert(t('alerts.error_send'))` used to
 * replace them with "there was an error", which is the sentence that cannot be acted on.
 */
test('an Edge Function 400 reaches the DOM, and window.alert is never called', async ({ mount, page }) => {
  await mockReads(page)
  await mockSend(page, { status: 400, body: JSON.stringify({ error: 'FCM_PAYLOAD_REJECTED: image must be https' }) })
  await mount(<PushComposerHarness />)
  await countAlerts(page)

  await composeMinimum(page)
  await page.getByRole('button', { name: PUSH.actions.send_now }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox').fill('1234')
  await dialog.getByRole('button', { name: /Enviar para/ }).click()

  await expect(page.getByRole('alert')).toContainText('FCM_PAYLOAD_REJECTED')
  expect(await page.evaluate(() => (window as any).__alerts)).toEqual([])
  expect(nativeDialogs).toEqual([])
})

/**
 * The estimate is the whole basis of the typed gate: with no number there is no number to type,
 * and the send must not be reachable by another route.
 */
test('a failing audience estimate blocks the confirmation', async ({ mount, page }) => {
  await mockReads(page)
  await page.route('**/rest/v1/rpc/estimate_notification_audience', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'invalid input syntax for type uuid: "pro"', code: '22P02' }),
    })
  )
  const calls = await mockSend(page)
  await mount(<PushComposerHarness />)

  await composeMinimum(page)
  await page.getByRole('button', { name: PUSH.actions.send_now }).click()

  const dialog = page.getByRole('dialog')
  // The literal PostgREST sentence, which is the diagnosis. A generic "there was an error"
  // is what this screen used to print in its place.
  await expect(dialog.getByRole('alert')).toContainText('invalid input syntax for type uuid')
  await expect(dialog.getByRole('textbox')).toBeDisabled()
  await expect(dialog.getByRole('button', { name: /Enviar para/ })).toBeDisabled()
  expect(calls).toHaveLength(0)
})

/**
 * BR-IDIOMA-001 item 3 — the app's interface catalogue is five languages, and the composer now
 * carries one title/body per language instead of a single string. The FAN-OUT is the Edge
 * Function's (one narrowed pass per key of `localized`, one log row each); what this asserts is
 * that the composer hands over every language it composed, in ONE call.
 */
test('BR-IDIOMA-001: two composed languages travel as one localized payload', async ({ mount, page }) => {
  await mockReads(page, { estimate: 500 })
  const calls = await mockSend(page, {
    body: JSON.stringify({
      success: true,
      passes: [
        { language: 'pt', recipients: 500, success: 498, failure: 2, status: 'sent' },
        { language: 'en', recipients: 500, success: 500, failure: 0, status: 'sent' },
      ],
    }),
  })
  await mount(<PushComposerHarness />)

  await composeMinimum(page)
  await page.getByLabel(PUSH.content.editing_language).selectOption('en')
  await page.getByLabel(PUSH.content.label_title, { exact: true }).fill('An offer for you')
  await page.getByLabel(PUSH.content.label_body, { exact: true }).fill('Tap to see what we prepared today.')

  await page.getByRole('button', { name: PUSH.actions.send_now }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByTestId('confirm-language-pt')).toBeVisible()
  await expect(dialog.getByTestId('confirm-language-en')).toBeVisible()
  // Two languages, 500 each — the number to type is the sum, not the audience card's figure.
  await dialog.getByRole('textbox').fill('1000')
  await dialog.getByRole('button', { name: /Enviar para/ }).click()

  await expect.poll(() => calls.length).toBe(1)
  expect(Object.keys(calls[0].localized).sort()).toEqual(['en', 'pt'])
  expect(calls[0].localized.pt.title).toBe('Uma oferta para você')
  expect(calls[0].localized.en.title).toBe('An offer for you')
  // 498 + 500 accepted, 2 refused — the banner reports the sum of the passes.
  await expect(page.getByRole('status')).toContainText('998')
})

/** The advanced card is closed and below the content — priority is not the start of the work. */
test('high priority is off by default and lives in a closed disclosure', async ({ mount, page }) => {
  await mockReads(page)
  await mount(<PushComposerHarness />)

  const disclosure = page.locator('details')
  await expect(disclosure).toHaveJSProperty('open', false)

  // ...and it sits BELOW the content card, which is what the operator came to fill in.
  const contentComesFirst = await page.evaluate(() => {
    const details = document.querySelector('details')!
    const heading = Array.from(document.querySelectorAll('h2')).find((h) =>
      h.textContent?.includes('Conte\u00fado da notifica\u00e7\u00e3o')
    )!
    return Boolean(heading.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING)
  })
  expect(contentComesFirst).toBe(true)

  await disclosure.locator('summary').click()
  const priority = page.getByRole('checkbox', { name: PUSH.advanced.label_priority })
  await expect(priority).toBeVisible()
  await expect(priority).toHaveAttribute('data-state', 'unchecked')
})

/** The preview clamps to what the tray shows, and says that the cut is real. */
test('the preview clamps title to 1 line and body to 2, and admits the cut', async ({ mount, page }) => {
  await mockReads(page)
  await mount(<PushComposerHarness />)

  await expect(page.getByTestId('preview-title')).toHaveClass(/line-clamp-1/)
  await expect(page.getByTestId('preview-body')).toHaveClass(/line-clamp-2/)
  await expect(page.getByText(PUSH.preview.truncated)).toBeVisible()
})

/**
 * The CMS is translated to three locales and this screen was the one still answering in
 * English. The literals below are the exact ones the screen used to print.
 */
test('mounted in pt, none of the old English literals survive', async ({ mount, page }) => {
  await mockReads(page)
  await mount(<PushComposerHarness />)
  await page.getByText(PUSH.advanced.title).click()

  const text = await page.evaluate(() => document.body.innerText)
  for (const literal of [
    'Advanced Settings',
    'Notification Content',
    'Scheduling Settings',
    'Real-time Preview',
    'Send Now',
    'Target Audience',
    'Push Base',
    'All Users',
    'No Name',
    'No Platform',
    'more clients',
  ]) {
    expect(text, `English literal still on screen: ${literal}`).not.toContain(literal)
  }
  // And the Portuguese it should be printing instead is really there.
  expect(text).toContain(PUSH.content.title)
  expect(text).toContain(AUDIENCE.title)
})

/** No `critical` violation in the tree the operator gets — `button-name` was one. */
test('axe-core reports no critical violation on the composer', async ({ mount, page }) => {
  await mockReads(page)
  await mount(<PushComposerHarness />)
  await composeMinimum(page)
  await page.getByText(PUSH.advanced.title).click()

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()

  const critical = results.violations.filter((v) => v.impact === 'critical')
  expect(critical.map((v) => `${v.id}: ${v.nodes.length} node(s)`)).toEqual([])
})

/** The dialog is a dialog: named, modal, and it closes on Escape (DS-A11Y-013). */
test('DS-A11Y-013: the confirmation dialog is modal, named, and Escape closes it', async ({ mount, page }) => {
  await mockReads(page)
  await mount(<PushComposerHarness />)
  await composeMinimum(page)
  await page.getByRole('button', { name: PUSH.actions.send_now }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toHaveAttribute('aria-modal', 'true')
  await expect(dialog).toContainText(PUSH.confirm.title)

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(results.violations.filter((v) => v.impact === 'critical')).toEqual([])

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})
