/**
 * WHAT NOW STANDS BETWEEN A CLICK AND 921 INBOXES.
 *
 * Six campaigns had already gone out when this branch opened, the two largest with
 * `audience_filters: {}` — the whole base — and nothing on the screen said so. These are the
 * assertions that the same click cannot happen again, in a real Chromium with the app's own CSS
 * and every request intercepted (`playwright-ct.config.ts` records why this is a mount and not a
 * navigation).
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Locator, Page } from '@playwright/test'
import { NewsletterManager } from '@/components/marketing/newsletter/NewsletterManager'
import { Wrapper } from './marketing-newsletter-helpers'
import { mockAll, AUDIENCE, NEWSLETTER, SCHEDULED_CAMPAIGN } from './marketing-newsletter-fixtures'

const ESTIMATE = 12873

/** The composer filled to the point where sending is legitimate: a subject and one block. */
async function fillComposer(component: Locator) {
  await component.getByLabel(NEWSLETTER.compose.name).fill('Novidades de setembro')
  await component.getByLabel(NEWSLETTER.compose.subject).fill('Três lugares novos em Búzios')
  await component.getByRole('button', { name: NEWSLETTER.blocks.types.text }).click()
  await component.getByPlaceholder(NEWSLETTER.blocks.textPlaceholder).fill('Olá, viajante.')
}

/** Waits for the debounced estimate to land, which is what unlocks the two send buttons. */
async function waitForEstimate(component: Locator) {
  await expect(component.getByText(`${AUDIENCE.targeted}`)).toBeVisible()
  await expect(component.getByRole('button', { name: NEWSLETTER.compose.sendNow })).toBeEnabled({
    timeout: 10_000,
  })
}

const dialog = (page: Page) => page.getByRole('dialog')

test.describe('the send gate', () => {
  test('the send button is disabled with an empty subject', async ({ mount, page }) => {
    await mockAll(page, { estimate: ESTIMATE })
    const component = await mount(
      <Wrapper>
        <NewsletterManager />
      </Wrapper>
    )

    const send = component.getByRole('button', { name: NEWSLETTER.compose.sendNow })
    // The estimate arrives and the button STAYS disabled — the audience is not what is missing.
    await expect(component.getByText(AUDIENCE.targeted)).toBeVisible()
    await expect(send).toBeDisabled()
    await expect(component.getByText(NEWSLETTER.compose.requiresSubject)).toBeVisible()

    // A subject alone is not enough either: an e-mail with no block arrives blank.
    await component.getByLabel(NEWSLETTER.compose.subject).fill('Assunto sozinho')
    await expect(send).toBeDisabled()

    await component.getByRole('button', { name: NEWSLETTER.blocks.types.text }).click()
    await expect(send).toBeEnabled()
  })

  test('nothing reaches /send before the confirmation', async ({ mount, page }) => {
    const calls = await mockAll(page, { estimate: ESTIMATE })
    const component = await mount(
      <Wrapper>
        <NewsletterManager />
      </Wrapper>
    )
    await fillComposer(component)
    await waitForEstimate(component)

    await component.getByRole('button', { name: NEWSLETTER.compose.sendNow }).click()
    await expect(dialog(page)).toBeVisible()

    // The dialog is open and NOTHING has left. The old screen had already fired by now.
    expect(calls.send).toBe(0)
    expect(calls.campaignPost).toBe(0)

    // And the confirm button is dead until the operator types the number, which is the only
    // proof available that the number was read.
    const confirm = dialog(page).getByRole('button', { name: NEWSLETTER.confirm.send })
    await expect(confirm).toBeDisabled()

    await dialog(page).getByLabel(/12.873/).fill('12873')
    await expect(confirm).toBeEnabled()
  })

  test('the dialog says "base inteira" when no filter is active', async ({ mount, page }) => {
    await mockAll(page, { estimate: ESTIMATE })
    const component = await mount(
      <Wrapper>
        <NewsletterManager />
      </Wrapper>
    )
    await fillComposer(component)
    await waitForEstimate(component)
    await component.getByRole('button', { name: NEWSLETTER.compose.sendNow }).click()

    await expect(dialog(page).getByText(NEWSLETTER.confirm.wholeBase)).toBeVisible()
    // The number is in the dialog, formatted for the screen's locale and not the browser's.
    await expect(dialog(page).getByText('12.873', { exact: true })).toBeVisible()
  })

  test('a zero audience cannot be confirmed', async ({ mount, page }) => {
    await mockAll(page, { estimate: 0 })
    const component = await mount(
      <Wrapper>
        <NewsletterManager />
      </Wrapper>
    )
    await fillComposer(component)
    // The button never enables: nobody matches, so there is nothing to send.
    await expect(component.getByText(AUDIENCE.targeted)).toBeVisible()
    await expect(component.getByRole('button', { name: NEWSLETTER.compose.sendNow })).toBeDisabled()
  })
})

test.describe('the campaign record', () => {
  test('scheduling twice writes ONE campaign', async ({ mount, page }) => {
    const calls = await mockAll(page, { estimate: ESTIMATE })
    const component = await mount(
      <Wrapper>
        <NewsletterManager />
      </Wrapper>
    )
    await fillComposer(component)
    await waitForEstimate(component)
    await component.getByLabel(NEWSLETTER.compose.scheduleLabel).fill('2030-01-01T10:00')

    const schedule = component.getByRole('button', { name: NEWSLETTER.compose.schedule })
    await expect(schedule).toBeEnabled()

    await schedule.click()
    await expect(dialog(page)).toBeVisible()
    await dialog(page).getByLabel(/12.873/).fill('12873')
    const confirmSchedule = dialog(page).getByRole('button', { name: NEWSLETTER.confirm.schedule })

    await confirmSchedule.click()
    await expect.poll(() => calls.campaignPost).toBe(1)

    // The second confirmation, on the same campaign. This is the reclique the operator makes
    // when the first one looks like it did nothing.
    await expect(confirmSchedule).toBeEnabled()
    await confirmSchedule.click()
    await expect.poll(() => calls.campaignPatch).toBe(1)

    /*
     * THE WHOLE POINT: `persist()` called `createCampaign` EVERY time, so scheduling twice was
     * two campaign rows and a base that receives the newsletter twice. One create, then updates.
     *
     * The Edge Function itself is out of reach in a component mount — `_callFunctionEndpoint`
     * asks `supabase.auth.getSession()` first and this harness has no session, so `schedule`
     * throws before any fetch. That is not what this test owns: the defect lived in `persist()`,
     * which runs BEFORE the call, and the campaign table is where it left its mark.
     */
    expect(calls.campaignPost).toBe(1)
    expect(calls.campaignPatch).toBe(1)
  })
})

test.describe('a broken estimate is not an unknown estimate', () => {
  test('a 400 from the RPC shows the message and disables the send', async ({ mount, page }) => {
    await mockAll(page, {
      estimateError: {
        status: 400,
        body: {
          code: '22P02',
          message: 'invalid input syntax for type uuid: "pro"',
          details: null,
          hint: null,
        },
      },
    })
    const component = await mount(
      <Wrapper>
        <NewsletterManager />
      </Wrapper>
    )
    await fillComposer(component)

    // The literal PostgREST sentence — this is the one that stayed invisible for months behind
    // an `UNKNOWN`, and it is the whole diagnosis of the `'pro'`-into-a-uuid-column defect.
    await expect(component.getByText('invalid input syntax for type uuid: "pro"')).toBeVisible()
    await expect(component.getByText(AUDIENCE.error.title)).toBeVisible()
    await expect(component.getByText('UNKNOWN')).toHaveCount(0)
    await expect(component.getByRole('button', { name: NEWSLETTER.compose.sendNow })).toBeDisabled()
  })
})

test.describe('the screen is in one language', () => {
  test('mounted in pt, no English literal survives', async ({ mount, page }) => {
    await mockAll(page, { estimate: ESTIMATE })
    const component = await mount(
      <Wrapper>
        <NewsletterManager />
      </Wrapper>
    )
    await expect(component.getByText(AUDIENCE.title, { exact: true })).toBeVisible()

    /**
     * The eight literals the audience card hardcoded. `PUSH BASE` is the one that matters most:
     * it was not only English, it was the WRONG BASE — the newsletter swapped `estimateFn` and
     * left the label behind (CLAUDE.md §6, a name that lies).
     */
    for (const literal of [
      'Target Audience',
      'PUSH BASE',
      'Push Base',
      'TARGETED',
      'Subscription Tier',
      'Every User',
      'Any Language',
      'Active Users Only',
      'RECIPIENTS',
      'CALCULATING',
      'All Platforms',
    ]) {
      await expect(component.getByText(literal, { exact: false })).toHaveCount(0)
    }

    // And the replacement for the label that lied is on screen, naming the right base.
    await expect(component.getByText(AUDIENCE.emailBase)).toBeVisible()
    await expect(component.getByText(AUDIENCE.onboarding.label)).toBeVisible()
  })
})

test.describe('BR-USUARIO-043 item 5b — what the screen refuses, and says so', () => {
  test('the refusal is written on the screen, not only in the rule', async ({ mount, page }) => {
    await mockAll(page, { estimate: ESTIMATE })
    const component = await mount(
      <Wrapper>
        <NewsletterManager />
      </Wrapper>
    )
    /*
     * The survey in `drive.profiles` exists to decide what to produce, and item 5b does not
     * authorize campaign targeting — `core.build_audience_filter` raises TGU43 (400) for either
     * demographic key. The request comes back every month because the refusal lived only in a
     * document nobody opens mid-send. It is on the screen now, and this is what keeps it there.
     */
    await expect(component.getByText(AUDIENCE.demographicsBlocked)).toBeVisible()
  })

  test('every tier option carries a uuid, never a name', async ({ mount, page }) => {
    await mockAll(page, { estimate: ESTIMATE })
    const component = await mount(
      <Wrapper>
        <NewsletterManager />
      </Wrapper>
    )
    const tier = component.getByLabel(AUDIENCE.tier.label)
    await expect(tier.getByRole('option', { name: 'Premium' })).toBeAttached()

    /*
     * `<SelectItem value="pro">Premium Plan</SelectItem>` sat next to a uuid, and
     * `(p_filters->>'subscription_tier_id')::uuid` answered 22P02 to it: THE PAYING SEGMENT
     * NEVER WORKED, in push or in e-mail. Every value that is not the "all" sentinel is a uuid
     * now, and the list comes from `drive.subscription_tiers`.
     */
    const values = await tier.locator('option').evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value)
    )
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    expect(values.filter((v) => v !== 'all').every((v) => uuid.test(v)), values.join(',')).toBe(true)
  })
})

test.describe('the scheduled queue is the only undo this module has', () => {
  test('cancelling writes status=cancelled and never DELETEs', async ({ mount, page }) => {
    const calls = await mockAll(page, { estimate: ESTIMATE, campaigns: [SCHEDULED_CAMPAIGN] })
    const component = await mount(
      <Wrapper>
        <NewsletterManager />
      </Wrapper>
    )
    await component.getByRole('button', { name: NEWSLETTER.tabs.history }).click()

    // The scheduled section, with the audience the campaign was SAVED with — and it was saved
    // with no filter, so the queue says so before anybody has to open the record.
    await expect(component.getByRole('heading', { name: NEWSLETTER.history.scheduledTitle })).toBeVisible()
    await expect(component.getByText(SCHEDULED_CAMPAIGN.name)).toBeVisible()
    await expect(component.getByText(NEWSLETTER.history.wholeBase)).toBeVisible()

    await component.getByRole('button', { name: NEWSLETTER.history.cancel }).click()
    await expect.poll(() => calls.campaignPatch).toBe(1)

    expect(calls.patchBodies[0]).toEqual({ status: 'cancelled' })
    // CLAUDE.md §3: a row that disappears takes with it what was going to be sent and who
    // stopped it. `deleteCampaign` exists and this screen must never be what calls it.
    expect(calls.campaignDelete).toBe(0)
    await expect(component.getByText(NEWSLETTER.status.cancelled)).toBeVisible()
  })
})
