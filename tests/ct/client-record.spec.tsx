/**
 * #875 — one read per record across the tabs; #871 — the portal record in `ContractTab` and
 * `FiscalPaymentsTab`.
 *
 * Real Chromium, the real components behind `RecordCacheProvider`; the endpoints are `page.route`
 * stand-ins that count requests. See `playwright-ct.config.ts` for why this is a mount and not a
 * page navigation.
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page } from '@playwright/test'
import { Wrapper } from './helpers'
import { BareContractTab, BareFiscalTab, RecordHarness } from './client-record-helpers'
import { contractState, detailInCuration } from './fixtures/partnerships'

const CLIENT_ID = 'client-0005'

const ACCEPTANCE = {
  termsVersion: '2026-10',
  termsHash: 'abcdef0123456789abcdef0123456789',
  acceptedAt: '2026-10-03T15:00:00Z',
  authMethod: 'otp',
  email: 'ze@bardoze.com.br',
  signerName: 'Zé da Silva',
  signerRole: 'Sócio',
  signerCpfMasked: '•••.•••.247-••',
  cpfDiffers: false,
  legalStatusDeclared: true,
  activationCommitment: { sticker: true, social: true },
  marketingConsent: false,
  planChoice: 'map_and_description',
  billingPeriod: 3,
  voucherCode: null,
  voucherDiscountCents: null,
  totalCents: 29700,
}

const PAYMENT = {
  status: 'paid',
  paidAt: '2026-10-04T15:00:00Z',
  refundedAt: null,
  paymentMethod: 'card',
  paidThrough: '2027-01-04T15:00:00Z',
  canceledAt: null,
  renewalAmountCents: 29700,
  providerSubscriptionId: 'sub_123',
  externalReference: 'com_historia_3m:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
}

const record = (overrides: Record<string, unknown> = {}) => ({
  submissionId: 'sub-1',
  status: 'approved',
  attractionId: 'attr-1',
  submittedAt: '2026-10-03T12:00:00Z',
  acceptance: ACCEPTANCE,
  payment: PAYMENT,
  ...overrides,
})

/** The route's answer; the old (pre-portal) shape is `origin: 'direct', portal: []`. */
function contractAnswer(extra: Record<string, unknown>) {
  const base = contractState() as Record<string, unknown>
  return { ...base, ...extra }
}

const counts = { detail: 0, contract: 0 }

async function mockEndpoints(page: Page, contractBody: unknown, options: { contractStatus?: number } = {}) {
  counts.detail = 0
  counts.contract = 0
  const detail = detailInCuration()
  await page.route(`**/api/admin/partnerships/clients/${CLIENT_ID}`, (route) => {
    counts.detail++
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ detail }) })
  })
  await page.route(`**/api/admin/clients/${CLIENT_ID}/contract`, (route) => {
    counts.contract++
    return route.fulfill({
      status: options.contractStatus ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(contractBody),
    })
  })
}

// ── #875: the cache ────────────────────────────────────────────────────────────────────────

test.describe('#875 — one read of the detail and one of the contract across the tabs', () => {
  test('Partnership → Contract → Fiscal → Contract → Partnership: 1 detail read and 1 contract read', async ({
    mount,
    page,
  }) => {
    await mockEndpoints(page, contractAnswer({ origin: 'direct', portal: [] }))
    const component = await mount(
      <Wrapper>
        <RecordHarness clientId={CLIENT_ID} />
      </Wrapper>
    )
    await expect(component.getByText('Carregando a parceria.')).toHaveCount(0, { timeout: 10_000 })

    await component.getByRole('button', { name: 'tab-contract' }).click()
    await expect(component.getByText('Origem do cadastro')).toBeVisible()
    await component.getByRole('button', { name: 'tab-fiscal' }).click()
    await expect(component.getByText('Assinatura no Asaas')).toHaveCount(0) // the old case: no portal subscription (#910 §9 keeps the card for the fee)
    await component.getByRole('button', { name: 'tab-contract' }).click()
    await expect(component.getByText('Origem do cadastro')).toBeVisible()
    await component.getByRole('button', { name: 'tab-partnership' }).click()
    await expect(component.getByText('Carregando a parceria.')).toHaveCount(0, { timeout: 10_000 })

    expect(counts.detail).toBe(1)
    expect(counts.contract).toBe(1)
  })

  test('dropping the cache (what a save or an approval does) makes the next tab read again', async ({ mount, page }) => {
    await mockEndpoints(page, contractAnswer({ origin: 'direct', portal: [] }))
    const component = await mount(
      <Wrapper>
        <RecordHarness clientId={CLIENT_ID} initial="contract" />
      </Wrapper>
    )
    await expect(component.getByText('Origem do cadastro')).toBeVisible()
    expect(counts.contract).toBe(1)

    await component.getByRole('button', { name: 'drop-cache' }).click()
    await component.getByRole('button', { name: 'tab-fiscal' }).click()
    await expect.poll(() => counts.contract).toBe(2)
    // and the neighbour of the fresh read shares it
    await component.getByRole('button', { name: 'tab-contract' }).click()
    await expect(component.getByText('Origem do cadastro')).toBeVisible()
    expect(counts.contract).toBe(2)
  })

  test('a failed read is not remembered: the next tab tries again', async ({ mount, page }) => {
    await mockEndpoints(page, { error: 'boom' }, { contractStatus: 500 })
    const component = await mount(
      <Wrapper>
        <RecordHarness clientId={CLIENT_ID} initial="contract" />
      </Wrapper>
    )
    await expect(component.getByText('Não foi possível carregar o estado do contrato.')).toBeVisible()
    expect(counts.contract).toBe(1)
    await component.getByRole('button', { name: 'tab-fiscal' }).click()
    await expect.poll(() => counts.contract).toBe(2)
  })

  test('outside a provider a tab still reads (plain fetch fallback)', async ({ mount, page }) => {
    await mockEndpoints(page, contractAnswer({ origin: 'direct', portal: [] }))
    const component = await mount(
      <Wrapper>
        <BareContractTab clientId={CLIENT_ID} />
      </Wrapper>
    )
    await expect(component.getByText('Origem do cadastro')).toBeVisible()
    expect(counts.contract).toBe(1)
  })
})

// ── #871: ContractTab ──────────────────────────────────────────────────────────────────────

test.describe('#871 — ContractTab', () => {
  test('BR-B2B-047: a portal client shows origin, term version, date, hash and the masked signer', async ({ mount, page }) => {
    await mockEndpoints(page, contractAnswer({ origin: 'portal', portal: [record()], contract: null, acceptance: null }))
    const component = await mount(
      <Wrapper>
        <BareContractTab clientId={CLIENT_ID} />
      </Wrapper>
    )
    await expect(component.getByText('Portal Locais')).toBeVisible()
    await expect(component.getByRole('heading', { name: 'Aceite eletrônico' })).toBeVisible()
    await expect(component.getByText('Termo 2026-10 · aceito em 03/10/2026')).toBeVisible()
    await expect(component.getByText(ACCEPTANCE.termsHash)).toBeVisible()
    // BR-B2B-043 item 1: the mask is what is in the DOM, and the whole number is nowhere.
    await expect(component.getByText('Zé da Silva · Sócio · CPF •••.•••.247-••')).toBeVisible()
    await expect(component.getByText('Declarou CNPJ ativo e alvará vigente')).toBeVisible()
    await expect(component.getByText('Adesivo, Redes')).toBeVisible()
    expect(await component.innerText()).not.toMatch(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/)
    // The generated-contract summary does not appear for a portal client with no contract.
    await expect(component.getByText('Contrato de parceria')).toHaveCount(0)
  })

  test('the old case: a client outside the portal shows origin and the generated-contract summary, no acceptance', async ({
    mount,
    page,
  }) => {
    await mockEndpoints(page, contractAnswer({ origin: 'proposal', portal: [] }))
    const component = await mount(
      <Wrapper>
        <BareContractTab clientId={CLIENT_ID} />
      </Wrapper>
    )
    await expect(component.getByText('Proposta (fluxo antigo)')).toBeVisible()
    await expect(component.getByText('Contrato de parceria')).toBeVisible()
    await expect(component.getByText('Aceite eletrônico')).toHaveCount(0)
  })

  test('a portal submission without acceptance says so, and a failed portal read says it could not read', async ({
    mount,
    page,
  }) => {
    await mockEndpoints(page, contractAnswer({ origin: 'portal', portal: [record({ acceptance: null, payment: null })] }))
    let component = await mount(
      <Wrapper>
        <BareContractTab clientId={CLIENT_ID} />
      </Wrapper>
    )
    await expect(component.getByText('O aceite deste envio não foi encontrado.')).toBeVisible()
    await component.unmount()

    await mockEndpoints(page, contractAnswer({ origin: 'unknown', portal: null }))
    component = await mount(
      <Wrapper>
        <BareContractTab clientId={CLIENT_ID} />
      </Wrapper>
    )
    await expect(component.getByText('Não foi possível ler a origem.')).toBeVisible()
    await expect(component.getByText('Não foi possível carregar os dados do portal.')).toBeVisible()
  })
})

// ── #871: FiscalPaymentsTab ────────────────────────────────────────────────────────────────

test.describe('#871 — FiscalPaymentsTab', () => {
  test('BR-B2B-046: a paid portal plan shows plan, period, values, status, next due date and the references', async ({
    mount,
    page,
  }) => {
    await mockEndpoints(page, contractAnswer({ origin: 'portal', portal: [record()] }))
    const component = await mount(
      <Wrapper>
        <BareFiscalTab clientId={CLIENT_ID} />
      </Wrapper>
    )
    await expect(component.getByText('Com história · 3 meses')).toBeVisible()
    await expect(component.getByText(/R\$\s297,00 no 1º período · R\$\s297,00 na renovação/)).toBeVisible()
    await expect(component.getByText('Pago · Pago em 04/10/2026')).toBeVisible()
    await expect(component.getByText('04/01/2027', { exact: true })).toBeVisible()
    await expect(component.getByText(`com_historia_3m:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee · sub_123`)).toBeVisible()
  })

  test('BR-B2B-046: renewal turned off keeps the paid-through date and says the renewal is off', async ({ mount, page }) => {
    await mockEndpoints(
      page,
      contractAnswer({ origin: 'portal', portal: [record({ payment: { ...PAYMENT, canceledAt: '2026-11-01T12:00:00Z' } })] })
    )
    const component = await mount(
      <Wrapper>
        <BareFiscalTab clientId={CLIENT_ID} />
      </Wrapper>
    )
    await expect(component.getByText('Renovação desligada · vale até 04/01/2027')).toBeVisible()
  })

  test('BR-B2B-046: a refunded plan shows the refund date and no next due date', async ({ mount, page }) => {
    await mockEndpoints(
      page,
      contractAnswer({
        origin: 'portal',
        portal: [record({ payment: { ...PAYMENT, status: 'refunded', refundedAt: '2026-10-10T15:00:00Z' } })],
      })
    )
    const component = await mount(
      <Wrapper>
        <BareFiscalTab clientId={CLIENT_ID} />
      </Wrapper>
    )
    await expect(component.getByText('Reembolsado · Reembolsado em 10/10/2026')).toBeVisible()
    await expect(component.getByText('04/01/2027')).toHaveCount(0)
  })

  test('the free portal plan shows "No mapa · grátis" and no charge', async ({ mount, page }) => {
    await mockEndpoints(
      page,
      contractAnswer({
        origin: 'portal',
        portal: [record({ acceptance: { ...ACCEPTANCE, planChoice: 'map_only', billingPeriod: null, totalCents: 0 }, payment: null })],
      })
    )
    const component = await mount(
      <Wrapper>
        <BareFiscalTab clientId={CLIENT_ID} />
      </Wrapper>
    )
    await expect(component.getByText('No mapa · grátis')).toBeVisible()
    await expect(component.getByText('Sem cobrança')).toBeVisible()
    await expect(component.getByText('Assinatura no Asaas')).toHaveCount(0)
  })

  test('the old case: a client outside the portal has no portal subscription in "Plano e assinatura" (#910 §9)', async ({ mount, page }) => {
    await mockEndpoints(page, contractAnswer({ origin: 'direct', portal: [] }))
    const component = await mount(
      <Wrapper>
        <BareFiscalTab clientId={CLIENT_ID} />
      </Wrapper>
    )
    await expect(component.getByText('Comissão', { exact: false }).first()).toBeVisible()
    await expect(component.getByText('Assinatura no Asaas')).toHaveCount(0)
    await expect(component.getByText('Com história', { exact: false })).toHaveCount(0)
  })
})
