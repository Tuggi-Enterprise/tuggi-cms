/**
 * #1054 (BR-B2B-060, support edge case): "Cancelar plano" on the Locais tab of the client record,
 * spec `docs/design/spec-cancelamento-places-2026-10.md` §9.6. Mounted as a component (see
 * `playwright-ct.config.ts`), the routes faked with `page.route`; captures go to `test-results/1054/`.
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { Wrapper } from './helpers'
import { PlacesHarness } from './place-plan-cancel-helpers'
import { detailInCuration } from './fixtures/partnerships'
import ptMessages from '@/messages/pt.json'
import type { ClientPortalRecord } from '@/lib/services/portal-submission-review-service'

const T = ptMessages.Partnerships.cancelPlan
const CLIENT_ID = 'client-0005'
const detail = detailInCuration()
const PLACE = detail.places[0].readiness.place
const NAME = PLACE.name

// Only the fields the tab reads; the rest of the acceptance is not on this screen.
const record = (payment: Record<string, unknown> | null, planChoice = 'map_and_description'): ClientPortalRecord => ({
  submissionId: 'sub-1',
  status: 'live',
  attractionId: PLACE.attractionId,
  submittedAt: '2026-10-03T12:00:00Z',
  acceptance: { planChoice },
  payment: payment && {
    status: 'paid',
    paidAt: '2026-10-04T15:00:00Z',
    refundedAt: null,
    paymentMethod: 'card',
    paidThrough: '2026-11-20T15:00:00Z',
    canceledAt: null,
    renewalAmountCents: 9900,
    providerSubscriptionId: 'sub_123',
    externalReference: null,
    ...payment,
  },
}) as unknown as ClientPortalRecord

type Calls = { quote: number; cancel: unknown[] }

async function routes(page: Page, opts: { quoteStatus?: number[]; cancel?: { status: number; body: unknown } } = {}): Promise<Calls> {
  const calls: Calls = { quote: 0, cancel: [] }
  await page.route(`**/api/admin/partnerships/clients/${CLIENT_ID}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ detail }) })
  )
  await page.route(`**/api/admin/clients/${CLIENT_ID}/plan-cancel**`, (route) => {
    const req = route.request()
    if (req.method() === 'GET') {
      const status = opts.quoteStatus?.[calls.quote] ?? 200
      calls.quote++
      return route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(
          status === 200
            ? { plans: [{ plan: 'experience', state: 'active', ends_on: '2026-11-20', fee_cents: 0, charge_on: null }], fee_cents: 0 }
            : { error: 'unavailable' }
        ),
      })
    }
    calls.cancel.push(req.postDataJSON())
    const c = opts.cancel ?? { status: 200, body: { result: 'canceled', plans: [{ plan: 'experience', ends_on: '2026-11-20', outcome: 'applied' }], provider: 'ok' } }
    return route.fulfill({ status: c.status, contentType: 'application/json', body: JSON.stringify(c.body) })
  })
  return calls
}

async function axeClean(page: Page) {
  const results = await new AxeBuilder({ page }).include('#root').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
}

test('#1054 §9.6 item 1: a Presença place keeps the tab as today, no plan line and no button', async ({ mount, page }) => {
  await routes(page)
  const c = await mount(
    <Wrapper>
      <PlacesHarness clientId={CLIENT_ID} client={{ monthly_fee_cents: 0, is_courtesy: false, legacy_plans: [] }} records={[record({}, 'map_only')]} />
    </Wrapper>
  )
  await expect(c.getByText(NAME)).toBeVisible()
  await expect(c.getByRole('button', { name: T.action })).toHaveCount(0)
})

test('#1054 §9.6 items 2, 3, 5 and 7: Experiência active, the box with focus on the title, confirm, the line says cancelled (1440)', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const calls = await routes(page)
  const c = await mount(
    <Wrapper>
      <div className="bg-gray-50/50 p-8">
        <PlacesHarness clientId={CLIENT_ID} client={{ monthly_fee_cents: null, is_courtesy: false, legacy_plans: [] }} records={[record({})]} />
      </div>
    </Wrapper>
  )
  const open = c.getByRole('button', { name: T.action })
  await expect(open).toBeVisible()
  await page.screenshot({ path: 'test-results/1054/linha-com-botao-1440.png', fullPage: true })
  await axeClean(page)

  await open.click()
  const title = c.getByText(T.confirmTitle.replace('{place}', NAME))
  await expect(title).toBeFocused()
  await expect(c.getByText(T.planPortal.replace('{value}', 'R$ 99,00'))).toBeVisible()
  await expect(c.getByText(T.effectLater.replace('{date}', '20/11/2026'))).toBeVisible()
  const confirm = c.getByRole('button', { name: T.confirmAction })
  await expect(confirm).toBeEnabled()
  await page.screenshot({ path: 'test-results/1054/caixa-aberta-1440.png', fullPage: true })
  await axeClean(page)

  await confirm.click()
  await expect(c.getByText(T.canceledStatus.replace('{date}', '20/11/2026'))).toBeVisible()
  await expect(c.getByRole('button', { name: T.action })).toHaveCount(0)
  expect(calls.cancel).toEqual([{ attractionId: PLACE.attractionId, expectedFeeCents: 0 }])
  await page.screenshot({ path: 'test-results/1054/cancelado-1440.png', fullPage: true })
})

test('#1054 §9.6 item 4: the quote fails, the final button stays off, Tentar de novo asks again', async ({ mount, page }) => {
  const calls = await routes(page, { quoteStatus: [502, 200] })
  const c = await mount(
    <Wrapper>
      <PlacesHarness clientId={CLIENT_ID} client={null} records={[record({})]} />
    </Wrapper>
  )
  await c.getByRole('button', { name: T.action }).click()
  await expect(c.getByRole('alert')).toContainText(T.failed)
  await expect(c.getByRole('button', { name: T.confirmAction })).toBeDisabled()
  await c.getByRole('button', { name: ptMessages.Partnerships.clientPlaces.retry }).click()
  await expect(c.getByRole('button', { name: T.confirmAction })).toBeEnabled()
  expect(calls.quote).toBe(2)
})

test('#1054 §9.6 item 6: the cancel fails, the box stays open with the alert and the button active', async ({ mount, page }) => {
  await routes(page, { cancel: { status: 502, body: { error: 'unavailable' } } })
  const c = await mount(
    <Wrapper>
      <PlacesHarness clientId={CLIENT_ID} client={null} records={[record({})]} />
    </Wrapper>
  )
  await c.getByRole('button', { name: T.action }).click()
  await c.getByRole('button', { name: T.confirmAction }).click()
  await expect(c.getByRole('alert')).toContainText(T.failed)
  await expect(c.getByRole('button', { name: T.confirmAction })).toBeEnabled()
})

test('#1054: Asaas did not confirm, the line says cancelled AND the operator reads what to do', async ({ mount, page }) => {
  await routes(page, { cancel: { status: 200, body: { result: 'canceled', plans: [{ plan: 'legacy', ends_on: null, outcome: 'applied' }], provider: 'failed' } } })
  const c = await mount(
    <Wrapper>
      <PlacesHarness clientId={CLIENT_ID} client={{ monthly_fee_cents: 10000, is_courtesy: false, legacy_plans: [] }} records={[]} />
    </Wrapper>
  )
  await c.getByRole('button', { name: T.action }).click()
  await expect(c.getByText(T.planLegacy.replace('{value}', 'R$ 100,00'))).toBeVisible()
  await c.getByRole('button', { name: T.confirmAction }).click()
  await expect(c.getByText(T.canceledStatusToday)).toBeVisible()
  await expect(c.getByRole('alert')).toContainText(T.asaasFailed)
})
