/**
 * #910 — one working tab in the client record: Parceria (spec `docs/design/spec-cms-ficha-aba-parceria-2026-10.md`,
 * §11 "Pronto quando"). Each test names the item of §11 it proves.
 *
 * Real Chromium, the real `ClientEditorModal` / `PartnershipDetail` / `FiscalPaymentsTab`; the
 * network is `page.route`. The URL half of item 2 (`?validation=` and `tab=validation` land on
 * Parceria) is in `tests/api/partnership-tab-910.test.ts`, because the page that reads the URL needs
 * the Supabase session and the router, which a component mount does not have.
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { NextIntlClientProvider } from 'next-intl'
import ptMessages from '@/messages/pt.json'
import { ClientEditorModal } from '@/components/admin/clients/ClientEditorModal'
import { PartnershipDetail } from '@/components/admin/partnerships/PartnershipDetail'
import { PtOverlayProvider } from '@/lib/i18n/pt-overlay'
import { QueryProvider } from '@/components/providers/QueryProvider'
import { Wrapper } from './helpers'
import { BareFiscalTab } from './client-record-helpers'
import { contractState, detailInCuration, detailReadyToPublish } from './fixtures/partnerships'

const NOOP = () => {}
const SUB = '7c1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f'
const CLIENT_ID = 'client-0005'

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

const APPROVED_AT = '2026-10-02T15:00:00Z'

function review(over: Record<string, unknown> = {}) {
  return {
    id: SUB,
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

const approvedReview = () =>
  review({
    status: 'approved',
    clientId: CLIENT_ID,
    recordClientId: CLIENT_ID,
    statusChangedAt: APPROVED_AT,
    history: [
      { kind: 'transition', at: APPROVED_AT, from: 'in_review', to: 'approved', actorKind: 'operator', actorName: 'Ana', note: null },
    ],
  })

const CLIENT = {
  id: CLIENT_ID,
  name: 'Padaria Santa Clara',
  company_name: 'Santa Clara Alimentos LTDA',
  tax_id: '11222333000181',
  city: 'Gramado',
  state: 'RS',
  status: 'approved',
  email: 'dono@padaria.com.br',
}

/** A portal client's pipeline: no proposal from the old form, approved by the submission. */
function portalDetail() {
  const detail = detailInCuration()
  return {
    ...detail,
    client: { ...detail.client, id: CLIENT_ID, approvedAt: APPROVED_AT, createdAt: APPROVED_AT },
    submission: null,
    conference: { ...detail.conference, reviewedAt: null, reviewedByLabel: null },
    contract: null,
  }
}

const portalContract = () => ({
  ...(contractState() as Record<string, unknown>),
  contract: null,
  acceptance: null,
  origin: 'portal',
  portal: [
    {
      submissionId: SUB,
      status: 'approved',
      attractionId: 'attr-1',
      submittedAt: '2026-10-01T12:00:00Z',
      acceptance: ACCEPTANCE,
      payment: null,
    },
  ],
})

async function mockRecord(page: Page, opts: { review: unknown; detail?: unknown; contract?: unknown }) {
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (path === `/api/admin/partnerships/validation/${SUB}`) return json(opts.review)
    if (path === `/api/admin/partnerships/clients/${CLIENT_ID}`) return json({ detail: opts.detail ?? portalDetail() })
    if (path === `/api/admin/clients/${CLIENT_ID}/contract`) return json(opts.contract ?? portalContract())
    if (path === `/api/admin/clients/${CLIENT_ID}`) return json({ client: CLIENT })
    return json({})
  })
}

async function mockDetail(page: Page, detail: unknown, contract: unknown = { ...(contractState() as object), origin: 'direct', portal: [] }) {
  const id = (detail as { client: { id: string } }).client.id
  await page.route(`**/api/admin/partnerships/clients/${id}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ detail }) })
  )
  await page.route(`**/api/admin/clients/${id}/contract`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(contract) })
  )
}

const mountModal = (mount: Parameters<Parameters<typeof test>[2]>[0]['mount']) =>
  mount(
    <NextIntlClientProvider locale="pt" messages={ptMessages}>
      <PtOverlayProvider
        value={{ Partnerships: ptMessages.Partnerships, Clients: { directory: ptMessages.Clients.directory, board: ptMessages.Clients.board } }}
      >
        <QueryProvider>
          {/* What `AdminClientsPageContent` passes for `?validation=<id>`. */}
          <ClientEditorModal isOpen mode="edit" validationId={SUB} initialTab="partnership" onClose={NOOP} />
        </QueryProvider>
      </PtOverlayProvider>
    </NextIntlClientProvider>
  )

const mountDetail = (mount: Parameters<Parameters<typeof test>[2]>[0]['mount'], clientId: string) =>
  mount(
    <Wrapper>
      <PartnershipDetail locale="pt" clientId={clientId} onOpenTab={NOOP} />
    </Wrapper>
  )

const sidebar = (page: Page) => page.getByRole('complementary')
const tab = (page: Page, name: string) => sidebar(page).getByRole('button', { name, exact: true })
const blockTitles = (page: Page) => page.locator('section > div > h2')

/**
 * The tab's own content: `main` in the record, `#root` when the tab is mounted alone. The record's
 * chrome (the sidebar and its save button) is not this card's surface; the harness page has no
 * <title>/<html lang> of its own.
 */
async function expectNoAxeViolations(page: Page, scope: 'main' | '#root') {
  // The drawer slides in over a dimmed page: mid-animation, axe measured the overlay showing through
  // and failed contrast under load (#911). Infinite animations (pulse, spinner) are not the drawer.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().endTime === Infinity)
  )
  const results = await new AxeBuilder({ page })
    .include(scope)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
}

test.describe('#910 §11 — the record menu', () => {
  test('item 1: no "Validação"; "Parceria" is the first item, with the dot while the submission is in review', async ({ mount, page }) => {
    await mockRecord(page, { review: review({ recordClientId: CLIENT_ID }) })
    await mountModal(mount)
    await expect(page.getByText('Diferenças para o cadastro')).toBeVisible()

    const items = sidebar(page).getByRole('button')
    await expect(items.first()).toHaveText('Parceria')
    await expect(tab(page, 'Validação')).toHaveCount(0)
    await expect(tab(page, 'Parceria').locator('span.rounded-full')).toHaveCount(1)
  })

  test('item 1: no dot once the submission is decided', async ({ mount, page }) => {
    await mockRecord(page, { review: approvedReview() })
    await mountModal(mount)
    await expect(page.getByText('Ver o cadastro enviado em 01/10/2026')).toBeVisible()
    await expect(tab(page, 'Parceria').locator('span.rounded-full')).toHaveCount(0)
  })

  test('item 2: `?validation=<id>` opens Parceria with the submission blocks and the decision in the sidebar', async ({ mount, page }) => {
    await mockRecord(page, { review: review({ recordClientId: CLIENT_ID }) })
    await mountModal(mount)
    await expect(tab(page, 'Parceria')).toHaveAttribute('aria-current', 'page')
    for (const title of ['Diferenças para o cadastro', 'Empresa', 'Local', 'História', 'Fotos (0)']) {
      await expect(blockTitles(page).filter({ hasText: new RegExp(`^${title.replace(/[()]/g, '\\$&')}$`) })).toHaveCount(1)
    }
    await expect(sidebar(page).getByText(/itens? conferidos?/).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Aprovar', exact: true })).toHaveCount(1)
  })

  test('item 3: pre-registration — only Parceria is enabled, and no O local, Publicação or Contrato', async ({ mount, page }) => {
    await mockRecord(page, { review: review() })
    await mountModal(mount)
    await expect(blockTitles(page).filter({ hasText: /^Empresa$/ })).toHaveCount(1)
    await expect(tab(page, 'Parceria')).toBeEnabled()
    for (const name of ['Perfil', 'Fiscal & Pagamentos', 'Contrato', 'Pessoas', 'Locais', 'Cupons']) {
      await expect(tab(page, name)).toBeDisabled()
    }
    for (const title of ['O local', 'Publicação', 'Contrato']) {
      await expect(blockTitles(page).filter({ hasText: new RegExp(`^${title}$`) })).toHaveCount(0)
    }
  })
})

test.describe('#910 §11 — the blocks', () => {
  test('item 4: an old client with no proposal and no conference says nothing about either absence', async ({ mount, page }) => {
    const detail = { ...detailInCuration(), submission: null, conference: { ...detailInCuration().conference, reviewedAt: null, reviewedByLabel: null } }
    await mockDetail(page, detail)
    await mountDetail(mount, detail.client.id)
    await expect(blockTitles(page).first()).toBeVisible()
    await expect(page.getByText(/não veio do formulário/)).toHaveCount(0)
    await expect(page.getByText('Nenhuma conferência registrada ainda', { exact: false })).toHaveCount(0)
  })

  test('item 5: without a conference the Contrato block has no regularity line; with one, it does', async ({ mount, page }) => {
    const without = { ...detailInCuration(), conference: { ...detailInCuration().conference, reviewedAt: null, reviewedByLabel: null } }
    await mockDetail(page, without)
    const first = await mountDetail(mount, without.client.id)
    const contract = page.locator('section', { has: page.locator('h2', { hasText: /^Contrato$/ }) })
    await expect(contract).toBeVisible()
    await expect(contract.getByText(/Regularidade conferida/)).toHaveCount(0)
    await first.unmount()

    await page.unrouteAll()
    const withConference = detailInCuration()
    await mockDetail(page, withConference)
    await mountDetail(mount, withConference.client.id)
    await expect(contract.getByText('Regularidade conferida por ana@tuggi.app em 11/08/2026.')).toBeVisible()
    // The generated contract of an old client, and the way to its tab.
    await expect(contract.getByText(/Contrato assinado em 13\/08\/2026/)).toBeVisible()
    await expect(contract.getByRole('button', { name: 'Abrir o contrato' })).toBeVisible()
  })

  test('item 6: with a published place, Despublicar is in Publicação; without one, there is no Publicação heading', async ({ mount, page }) => {
    const unpublished = detailReadyToPublish()
    await mockDetail(page, unpublished)
    const first = await mountDetail(mount, unpublished.client.id)
    await expect(blockTitles(page).filter({ hasText: /^O local$/ })).toHaveCount(1)
    await expect(blockTitles(page).filter({ hasText: /^Publicação$/ })).toHaveCount(0)
    await first.unmount()

    await page.unrouteAll()
    const base = detailReadyToPublish()
    const published = {
      ...base,
      state: 'published',
      places: base.places.map((place) => ({
        ...place,
        readiness: { ...place.readiness, published: true },
        publishedBy: { at: '2026-08-20T10:00:00.000Z', by: 'ana@tuggi.app' },
      })),
    }
    await mockDetail(page, published)
    await mountDetail(mount, published.client.id)
    const publication = page.locator('section', { has: page.locator('h2', { hasText: /^Publicação$/ }) })
    await expect(publication.getByRole('button', { name: 'Tirar do app' })).toBeVisible()
    // Every place on air: there is no O local block left to work in.
    await expect(blockTitles(page).filter({ hasText: /^O local$/ })).toHaveCount(0)
  })

  test('item 7: no "Trilha"; the history carries the proposal with "Ver a proposta"', async ({ mount, page }) => {
    const detail = detailInCuration()
    await mockDetail(page, detail)
    await mountDetail(mount, detail.client.id)
    await expect(blockTitles(page).filter({ hasText: /^Histórico$/ })).toHaveCount(1)
    await expect(page.getByRole('heading', { name: 'Trilha' })).toHaveCount(0)
    const history = page.locator('section', { has: page.locator('h2', { hasText: /^Histórico$/ }) })
    const proposal = history.getByRole('listitem').filter({ hasText: 'Recebida em 10/08/2026.' })
    await expect(proposal.getByRole('link', { name: 'Ver a proposta' })).toHaveAttribute('href', '/pt/admin/partnerships/proposals/sub-0005')
    // Oldest first: the proposal (10/08) before the approval (14/08).
    await expect(history.getByRole('listitem').first()).toContainText('Recebida em 10/08/2026.')
  })

  test('item 7: a portal client approved by the submission does not repeat "Parceria aprovada em" nor "Cliente criado em"', async ({ mount, page }) => {
    await mockRecord(page, { review: approvedReview() })
    await mountModal(mount)
    const history = page.locator('section', { has: page.locator('h2', { hasText: /^Histórico$/ }) })
    await expect(history.getByText(/Em validação → Aprovado/)).toBeVisible()
    await expect(history.getByText(/Parceria aprovada em/)).toHaveCount(0)
    await expect(history.getByText(/Cliente criado em/)).toHaveCount(0)
    // The portal term, from the read the Contrato tab makes.
    await expect(page.getByText('Termo 2026-10 aceito em 01/10/2026.')).toBeVisible()
  })

  test('item 8: an approved submission keeps Empresa to Fotos inside a closed <details>', async ({ mount, page }) => {
    await mockRecord(page, { review: approvedReview() })
    await mountModal(mount)
    const details = page.locator('details', { has: page.getByText('Ver o cadastro enviado em 01/10/2026') })
    await expect(details).toHaveCount(1)
    await expect(details).not.toHaveAttribute('open', '')
    for (const title of [/^Empresa$/, /^Local$/, /^História$/, /^Fotos \(0\)$/]) {
      await expect(details.locator('section > div > h2').filter({ hasText: title })).toHaveCount(1)
      await expect(blockTitles(page).filter({ hasText: title }).first()).toBeHidden()
    }
    // No approved band repeated over the record: the fact is in the history.
    await expect(page.getByText(/^Aprovado por /)).toHaveCount(0)
  })

  test('item 9: no place linked — "Vincular em Locais" switches tabs, and the link panel is not here', async ({ mount, page }) => {
    const detail = { ...detailInCuration(), places: [] }
    await mockDetail(page, detail)
    await mountDetail(mount, detail.client.id)
    const place = page.locator('section', { has: page.locator('h2', { hasText: /^O local$/ }) })
    await expect(place.getByText('Nenhum local vinculado.')).toBeVisible()
    await expect(place.getByRole('button', { name: 'Vincular em Locais' })).toBeVisible()
    // `PlaceLinkPanel` is a search; its title and field are not in this tab.
    await expect(page.getByText(ptMessages.Partnerships.placeLink.title)).toHaveCount(0)
    await expect(page.getByLabel(ptMessages.Partnerships.placeLink.searchLabel)).toHaveCount(0)
    // There is a proposal to create from.
    await expect(place.getByRole('button', { name: ptMessages.Partnerships.pendencies.emptyCreate })).toBeVisible()
  })
})

test.describe('#910 §11 item 10 — Fiscal & Pagamentos', () => {
  test('the card order, the fee in the first card, no "Tipo de tax ID" nor "Platform owner?"', async ({ mount, page }) => {
    await page.route(`**/api/admin/clients/${CLIENT_ID}/contract`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...(contractState() as object), origin: 'direct', portal: [] }) })
    )
    const component = await mount(
      <Wrapper>
        <BareFiscalTab clientId={CLIENT_ID} />
      </Wrapper>
    )
    await expect(component.locator('h2')).toHaveText(['Plano e assinatura', 'Comissão', 'Legal & Fiscal', 'Banco & Pagamentos'])
    const plan = component.locator('div.rounded-3xl', { has: page.locator('h2', { hasText: 'Plano e assinatura' }) })
    await expect(plan.getByText('Valor mensal do contrato')).toBeVisible()
    await expect(component.getByText('Tipo de tax ID')).toHaveCount(0)
    await expect(component.getByText('Platform owner?')).toHaveCount(0)
    // The owner flag stays, under its own sentence, in Comissão.
    const commission = component.locator('div.rounded-3xl', { has: page.locator('h2', { hasText: 'Comissão' }) })
    await expect(commission.getByText('Marque se o cliente é a própria Tuggi (split contábil)')).toBeVisible()
    // No country chosen: the document field says what to do.
    await expect(component.getByText('Selecione o país primeiro')).toBeVisible()
  })
})

test.describe('#910 §11 item 11 — axe on the Parceria tab', () => {
  test('portal, in review', async ({ mount, page }) => {
    await mockRecord(page, { review: review({ recordClientId: CLIENT_ID }) })
    await mountModal(mount)
    await expect(blockTitles(page).filter({ hasText: /^Contrato$/ })).toHaveCount(1)
    await expectNoAxeViolations(page, 'main')
  })

  test('portal, approved', async ({ mount, page }) => {
    await mockRecord(page, { review: approvedReview() })
    await mountModal(mount)
    await expect(page.getByText('Ver o cadastro enviado em 01/10/2026')).toBeVisible()
    await expectNoAxeViolations(page, 'main')
  })

  test('old client', async ({ mount, page }) => {
    const detail = { ...detailInCuration(), submission: null }
    await mockDetail(page, detail)
    await mountDetail(mount, detail.client.id)
    await expect(blockTitles(page).filter({ hasText: /^Histórico$/ })).toHaveCount(1)
    await expectNoAxeViolations(page, '#root')
  })
})
