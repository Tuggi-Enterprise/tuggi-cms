/**
 * #890 — the portal validation is the Validação tab of the client record (BR-B2B-011: only the
 * checklist enables "Aprovar"; BR-B2B-048 item 4: the conference order; BR-B2B-049 items 7-8).
 *
 * Real Chromium, the real `ClientEditorModal` + `ValidationTab` + `ValidationDecision` +
 * `RecordShell`; the network is `page.route`. What `tests/api/validation-tab-items.test.ts` (a
 * source ruler) cannot say: that it renders, that the tabs are really disabled, that there is one
 * "Aprovar" in the DOM, that A/J/R stay out of the other tabs and that the CPF goes back behind
 * its mask when the tab is left.
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page } from '@playwright/test'
import { NextIntlClientProvider } from 'next-intl'
import ptMessages from '@/messages/pt.json'
import { ClientEditorModal } from '@/components/admin/clients/ClientEditorModal'

const NOOP = () => {}

const ACCEPTANCE = {
  termsVersion: '2026-10',
  termsHash: 'a'.repeat(64),
  acceptedAt: '2026-10-01T12:00:00Z',
  authMethod: 'otp',
  email: 'dono@padaria.com.br',
  signerName: 'Maria Souza',
  signerRole: 'Sócia',
  signerCpfMasked: '***.456.789-**',
  cpfDiffers: false,
  legalStatusDeclared: true,
  activationCommitment: { sticker: true },
  marketingConsent: true,
  planChoice: 'map_only',
  billingPeriod: null,
  voucherCode: null,
  voucherDiscountCents: null,
  totalCents: 0,
}

function review(over: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    status: 'in_review',
    answers: {
      trade_name: 'Padaria Santa Clara',
      legal_name: 'Santa Clara Alimentos LTDA',
      tax_id: '11222333000181',
      category: 'restaurant',
      city: 'Gramado',
      state: 'RS',
      plan_choice: 'free',
    },
    submittedAt: '2026-10-01T12:00:00Z',
    statusChangedAt: '2026-10-01T12:00:00Z',
    attractionId: 'attr-1',
    clientId: null,
    recordClientId: null,
    acceptance: ACCEPTANCE,
    payment: null,
    history: [],
    sameTaxId: [],
    nextInReviewId: null,
    photos: [],
    ...over,
  }
}

const CLIENT = {
  id: 'client-1',
  name: 'Padaria Antiga',
  company_name: 'Santa Clara Alimentos LTDA',
  tax_id: '11222333000181',
  city: 'Gramado',
  state: 'RS',
  status: 'pending',
  email: 'dono@padaria.com.br',
}

async function mockApi(page: Page, reviewBody: Record<string, unknown>) {
  await page.route('**/api/**', (route) => {
    const url = route.request().url()
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    if (url.includes('reveal=cpf')) return json({ cpf: '12345678909' })
    if (url.includes('/api/admin/partnerships/validation/sub-1')) return json(reviewBody)
    if (url.includes('/api/admin/clients/client-1')) return json({ client: CLIENT })
    return json({})
  })
}

const mountModal = (mount: Parameters<Parameters<typeof test>[2]>[0]['mount']) =>
  mount(
    <NextIntlClientProvider locale="pt" messages={ptMessages}>
      <ClientEditorModal isOpen mode="edit" validationId="sub-1" initialTab="validation" onClose={NOOP} />
    </NextIntlClientProvider>
  )

/** The record's tab strip is buttons inside the sidebar (`RecordTabs`), not role="tab". */
const tab = (page: Page, name: string) => page.getByRole('complementary').getByRole('button', { name, exact: true })
/** The record itself is a dialog too; this is the decision dialog (Aprovar / Pedir ajuste / Recusar). */
const decisionDialog = (page: Page) => page.getByRole('dialog', { name: /^(Aprovar|Pedir ajuste|Recusar)/ })

const approveButtons = (page: Page) => page.getByRole('button', { name: 'Aprovar', exact: true })

test.describe('#890 — pre-registration (no client yet: the common case)', () => {
  test('only the Validação tab is enabled, the others say "Disponível depois de aprovar", no save block', async ({ mount, page }) => {
    await mockApi(page, review())
    await mountModal(mount)
    await expect(page.getByRole('heading', { name: 'Padaria Santa Clara' }).first()).toBeVisible()

    await expect(tab(page, 'Validação')).toBeEnabled()
    for (const name of ['Parceria', 'Perfil', 'Fiscal & Pagamentos', 'Contrato', 'Locais']) {
      await expect(tab(page, name)).toBeDisabled()
      await expect(tab(page, name)).toHaveAttribute('title', 'Disponível depois de aprovar')
    }
    await expect(page.getByRole('button', { name: 'Salvar' })).toHaveCount(0)
  })

  test('BR-B2B-011 · exactly one "Aprovar", no client approval header, no "Abrir o cadastro do cliente", one "Abrir o local no editor"', async ({
    mount,
    page,
  }) => {
    await mockApi(page, review())
    await mountModal(mount)
    await expect(approveButtons(page)).toHaveCount(1)
    await expect(page.getByText('Abrir o cadastro do cliente')).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Abrir o local no editor' })).toHaveCount(1)
    // The checklist alone enables it: nothing ticked yet.
    await expect(approveButtons(page)).toBeDisabled()
    await expect(page.getByText(/itens? conferidos?/).first()).toBeVisible()
  })

  test('BR-B2B-048 item 4 · J opens "Pedir ajuste" on the Validação tab (focus not in a field)', async ({ mount, page }) => {
    await mockApi(page, review())
    await mountModal(mount)
    await expect(approveButtons(page)).toHaveCount(1)
    await page.keyboard.press('j')
    await expect(decisionDialog(page)).toBeVisible()
  })

  test('the status band, the company and the acceptance (login method, marketing, Copiar hash) are on the tab', async ({ mount, page }) => {
    await mockApi(page, review())
    await mountModal(mount)
    await expect(page.getByText('Empresa', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Copiar hash' })).toBeVisible()
    await expect(page.getByText('***.456.789-**').first()).toBeVisible()
  })
})

test.describe('#890 — the CNPJ already has a client', () => {
  const withClient = () => review({ recordClientId: 'client-1' })

  test('the record is the client\'s, all tabs enabled, and "Diferenças para o cadastro" lists what differs', async ({ mount, page }) => {
    await mockApi(page, withClient())
    await mountModal(mount)
    await expect(page.getByText('Diferenças para o cadastro')).toBeVisible()
    // `name` differs (conflict); `company_name`/`tax_id` are the same and stay out of the table.
    const table = page.getByRole('table').first()
    await expect(table).toContainText('Padaria Antiga')
    await expect(table).toContainText('Padaria Santa Clara')
    await expect(table).not.toContainText('Santa Clara Alimentos LTDA')
    await expect(tab(page, 'Perfil')).toBeEnabled()
  })

  test('one "Aprovar" while in_review (the submission\'s acts own the header)', async ({ mount, page }) => {
    await mockApi(page, withClient())
    await mountModal(mount)
    await expect(page.getByText('Diferenças para o cadastro')).toBeVisible()
    await expect(approveButtons(page)).toHaveCount(1)
  })

  test('A / J / R do nothing outside the Validação tab', async ({ mount, page }) => {
    await mockApi(page, withClient())
    await mountModal(mount)
    await expect(page.getByText('Diferenças para o cadastro')).toBeVisible()
    await tab(page, 'Perfil').click()
    for (const key of ['a', 'j', 'r']) await page.keyboard.press(key)
    await expect(decisionDialog(page)).toHaveCount(0)
    await tab(page, 'Validação').click()
    await page.keyboard.press('r')
    await expect(decisionDialog(page)).toBeVisible()
  })

  test('a revealed CPF goes back behind its mask when the tab is left', async ({ mount, page }) => {
    await mockApi(page, withClient())
    await mountModal(mount)
    await page.getByRole('button', { name: 'Mostrar CPF' }).click()
    await expect(page.getByText('123.456.789-09')).toBeVisible()
    await tab(page, 'Perfil').click()
    await tab(page, 'Validação').click()
    await expect(page.getByText('123.456.789-09')).toHaveCount(0)
    await expect(page.getByText('***.456.789-**').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mostrar CPF' })).toBeVisible()
  })
})
