/**
 * #870 — the portal validation inside the record frame (BR-B2B-049 items 7-8: approving creates
 * the POI and the client and publishes nothing; the way out is the client record, places tab).
 *
 * Real Chromium, the real `ValidationReview` + `ValidationDecision` + `RecordShell`, network
 * intercepted by `page.route`. What `tests/api/validation-record-frame.test.ts` cannot say: that
 * the header does not overlap the plan line with a two-line title, and where the focus lands.
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page } from '@playwright/test'
import { NextIntlClientProvider } from 'next-intl'
import { ValidationReview } from '@/components/admin/partner-proposals/ValidationReview'
import ptMessages from '@/messages/pt.json'

const SUBMISSION = 'sub-870'

function review(overrides: Record<string, unknown> = {}) {
  return {
    id: SUBMISSION,
    status: 'in_review',
    answers: {
      trade_name: 'Padaria Santa Clara do Vale Encantado e Filhos de Todos os Santos',
      category: 'restaurant',
      city: 'Gramado',
      state: 'RS',
      plan_choice: 'free',
    },
    submittedAt: '2026-10-01T12:00:00Z',
    statusChangedAt: '2026-10-01T12:00:00Z',
    attractionId: null,
    clientId: null,
    acceptance: null,
    payment: null,
    history: [],
    sameTaxId: [],
    nextInReviewId: null,
    photos: [],
    ...overrides,
  }
}

async function mockReview(page: Page, state: { current: Record<string, unknown> }, approveTo?: Record<string, unknown>) {
  await page.route(`**/api/admin/partnerships/validation/${SUBMISSION}`, async (route) => {
    if (route.request().method() === 'POST') {
      if (approveTo) state.current = approveTo
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ attractionId: 'attr-1' }),
      })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state.current) })
  })
}

function mountReview(mount: Parameters<Parameters<typeof test>[2]>[0]['mount'], returnTo: string | null = null) {
  return mount(
    <NextIntlClientProvider
      locale="pt"
      messages={{ PartnerValidation: ptMessages.PartnerValidation, PartnerForm: ptMessages.PartnerForm }}
    >
      <ValidationReview locale="pt" submissionId={SUBMISSION} returnTo={returnTo} />
    </NextIntlClientProvider>
  )
}

test.describe('#870 — decision aside after the decision (BR-B2B-049 items 7-8)', () => {
  test('BR-B2B-049: approved opens with the client shortcut as primary, to the places tab of the right client, no click needed', async ({
    mount,
    page,
  }) => {
    await mockReview(page, {
      current: review({ status: 'approved', clientId: 'client-9', attractionId: 'attr-1', nextInReviewId: 'sub-next' }),
    })
    const component = await mountReview(mount, '/admin/clients?view=table&state=in_validation')
    const primary = component.getByRole('link', { name: 'Abrir o cadastro do cliente' })
    await expect(primary).toBeVisible()
    const href = (await primary.getAttribute('href'))!
    const url = new URL(href, 'https://cms.test')
    expect(url.pathname).toBe('/pt/admin/clients')
    expect(url.searchParams.get('clientId')).toBe('client-9')
    expect(url.searchParams.get('tab')).toBe('places')
    // The board's filters ride along.
    expect(url.searchParams.get('view')).toBe('table')
    expect(url.searchParams.get('state')).toBe('in_validation')
    await expect(component.getByRole('link', { name: 'Abrir o local no editor' })).toBeVisible()
    await expect(component.getByRole('link', { name: 'Próximo da fila' })).toBeVisible()
    await expect(component.getByText('Voltar à fila')).toHaveCount(0)
    await expect(component.getByText('A fila está vazia.')).toHaveCount(0)
  })

  test('BR-B2B-049: live shows the same shortcuts; no next in line, no "Próximo da fila"', async ({ mount, page }) => {
    await mockReview(page, {
      current: review({ status: 'live', clientId: 'client-9', attractionId: 'attr-1', nextInReviewId: null }),
    })
    const component = await mountReview(mount)
    await expect(component.getByRole('link', { name: 'Abrir o cadastro do cliente' })).toBeVisible()
    await expect(component.getByRole('link', { name: 'Abrir o local no editor' })).toBeVisible()
    await expect(component.getByRole('link', { name: 'Próximo da fila' })).toHaveCount(0)
    await expect(component.getByText('Voltar à fila')).toHaveCount(0)
  })

  test('BR-B2B-049: without clientId (read failed) only the client shortcut disappears', async ({ mount, page }) => {
    await mockReview(page, {
      current: review({ status: 'approved', clientId: null, attractionId: 'attr-1', nextInReviewId: 'sub-next' }),
    })
    const component = await mountReview(mount)
    await expect(component.getByRole('link', { name: 'Abrir o local no editor' })).toBeVisible()
    await expect(component.getByRole('link', { name: 'Abrir o cadastro do cliente' })).toHaveCount(0)
    await expect(component.getByRole('link', { name: 'Próximo da fila' })).toBeVisible()
  })

  test('BR-B2B-049 item 7: free approval moves the focus to "Abrir o cadastro do cliente" and says the boundary is still missing', async ({
    mount,
    page,
  }) => {
    const state = { current: review() }
    await mockReview(page, state, review({ status: 'approved', clientId: 'client-9', attractionId: 'attr-1' }))
    const component = await mountReview(mount)
    for (const box of await component.getByRole('checkbox').all()) await box.check()
    await component.getByRole('button', { name: 'Aprovar', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Aprovar', exact: true }).click()
    const primary = component.getByRole('link', { name: 'Abrir o cadastro do cliente' })
    await expect(primary).toBeFocused()
    await expect(component.getByRole('status')).toContainText('Falta desenhar o boundary e publicar.')
    await expect(component.getByRole('status')).not.toContainText('já está no app')
  })

  test('BR-B2B-049 item 8: paid approval says narration, boundary and publication are missing', async ({ mount, page }) => {
    const paid = { ...review().answers, plan_choice: 'map_and_description', story: 'Uma história curta.' }
    const state = { current: review({ answers: paid }) }
    await mockReview(page, state, review({ answers: paid, status: 'approved', clientId: 'client-9', attractionId: 'attr-1' }))
    const component = await mountReview(mount)
    for (const box of await component.getByRole('checkbox').all()) await box.check()
    await component.getByRole('button', { name: 'Aprovar', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Aprovar', exact: true }).click()
    await expect(component.getByRole('status')).toContainText('Faltam a narração, o boundary e a publicação.')
    await expect(component.getByRole('link', { name: 'Abrir o cadastro do cliente' })).toBeFocused()
  })
})

test.describe('#870 — the frame', () => {
  test('the "X" goes back to the board with its filters, and the old "← Fila de validação" link is gone', async ({
    mount,
    page,
  }) => {
    await mockReview(page, { current: review() })
    const component = await mountReview(mount, '/admin/clients?view=table&state=in_validation')
    const close = component.getByRole('link', { name: 'Voltar ao quadro' })
    await expect(close).toHaveAttribute('href', '/pt/admin/clients?view=table&state=in_validation')
    await expect(component.getByText('← Fila de validação')).toHaveCount(0)
  })

  test('a two-line title at 1280 px does not cover the plan line, scrolled or not (no sticky)', async ({ mount, page }) => {
    await page.setViewportSize({ width: 1280, height: 600 })
    await mockReview(page, { current: review() })
    const component = await mountReview(mount)
    const plan = component.getByRole('complementary').getByRole('paragraph').first()
    await expect(plan).toBeVisible()
    const header = component.locator('h1').locator('xpath=ancestor::div[contains(@class,"border-b")][1]')
    const box = async (l: typeof plan) => (await l.boundingBox())!
    const h = await box(header)
    const p = await box(plan)
    expect(p.y).toBeGreaterThanOrEqual(h.y + h.height - 0.5)
    // Scroll the main column: the header stays put and the decision column is still below it.
    await component.locator('div.overflow-y-auto').first().evaluate((el) => el.scrollTo(0, 10_000))
    const h2 = await box(header)
    const p2 = await box(plan)
    expect(h2.y).toBeCloseTo(h.y, 0)
    expect(p2.y).toBeGreaterThanOrEqual(h2.y + h2.height - 0.5)
    // Nothing in the screen is `sticky`.
    expect(await component.locator('.sticky').count()).toBe(0)
  })
})
