/**
 * `axe-core` over the newsletter screen — the three `critical` violations it was measured with,
 * and the confirmation dialog that did not exist when it was measured.
 *
 *  · `select-name` (5 nodes): every `<select>` of `AudienceFilter` plus the two language pickers
 *    of `NewsletterManager` had a `Label` with no `htmlFor` and a `Select` with no `id`, so a
 *    screen reader announced five unnamed comboboxes on one screen.
 *  · `label`: the `<input type="datetime-local">` of the schedule had NO label at all, visual or
 *    otherwise — and neither did the campaign name, the subject or the preheader.
 *  · `heading-order`: the page's `h1` jumped straight to the `h3` of every `CardTitle`.
 *
 * SCOPED TO `#root`, like every other a11y suite here: `playwright/index.html` is a component
 * fixture, not a route, and has no `<title>` or `<html lang>` of its own. Those two are set by
 * `app/[locale]/layout.tsx` on the real page.
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { NewsletterManager } from '@/components/marketing/newsletter/NewsletterManager'
import { Wrapper } from './marketing-newsletter-helpers'
import { mockAll, AUDIENCE, NEWSLETTER } from './marketing-newsletter-fixtures'

async function scan(page: Page) {
  return new AxeBuilder({ page })
    .include('#root')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
}

/** No `critical` violation anywhere on the mounted screen. */
async function expectNoCritical(page: Page) {
  const results = await scan(page)
  const critical = results.violations.filter((v) => v.impact === 'critical')
  expect(
    critical,
    critical.map((v) => `${v.id} (${v.nodes.length}): ${v.help}`).join(' · ')
  ).toEqual([])
}

test('the composer has no critical violation', async ({ mount, page }) => {
  await mockAll(page, { estimate: 12873 })
  const component = await mount(
    <Wrapper>
      <NewsletterManager />
    </Wrapper>
  )
  await expect(component.getByText(AUDIENCE.targeted)).toBeVisible()
  await expectNoCritical(page)
})

test('the three measured rules are clean by name', async ({ mount, page }) => {
  await mockAll(page, { estimate: 12873 })
  const component = await mount(
    <Wrapper>
      <NewsletterManager />
    </Wrapper>
  )
  await expect(component.getByText(AUDIENCE.targeted)).toBeVisible()

  const results = await scan(page)
  const ids = results.violations.map((v) => v.id)
  // Named one by one rather than only as a count: a suite that says "no critical" goes green if
  // the rule stops running, and these three were measured on this exact screen.
  for (const rule of ['select-name', 'label', 'heading-order']) {
    expect(ids, JSON.stringify(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.length })))).not.toContain(rule)
  }
})

test('the confirmation dialog has no critical violation', async ({ mount, page }) => {
  await mockAll(page, { estimate: 12873 })
  const component = await mount(
    <Wrapper>
      <NewsletterManager />
    </Wrapper>
  )
  await component.getByLabel(NEWSLETTER.compose.subject).fill('Três lugares novos em Búzios')
  await component.getByRole('button', { name: NEWSLETTER.blocks.types.text }).click()
  const send = component.getByRole('button', { name: NEWSLETTER.compose.sendNow })
  await expect(send).toBeEnabled({ timeout: 10_000 })
  await send.click()

  await expect(page.getByRole('dialog')).toBeVisible()
  await expectNoCritical(page)
})
