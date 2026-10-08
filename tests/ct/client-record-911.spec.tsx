/**
 * #911 — the other tabs of the client record, shorter (spec `docs/design/spec-cms-ficha-demais-abas-2026-10.md`,
 * §8 "Pronto quando"). Each test names the item of §8 it proves.
 *
 * Real Chromium and the real `ClientEditorModal`, with the providers `/admin/clients` gives it
 * (`client-record-911-helpers.tsx`); the network is `page.route`. The URL half of item 1
 * (`?tab=appusers` opens Pessoas), the copy table and the retired keys are in
 * `tests/api/client-record-911.test.ts`.
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { ClientRecordModal, ContractPage, GlobalCouponsList, type AppUserRow } from './client-record-911-helpers'
import { contractState, detailInCuration } from './fixtures/partnerships'

const CLIENT_ID = 'client-0005'

const CLIENT = {
  id: CLIENT_ID,
  name: 'Bar do Zé',
  company_name: 'Zé Bebidas LTDA',
  email: 'ze@bardoze.com.br',
  client_type: 'business',
  country: 'Brazil',
  city: 'Búzios',
  state: 'RJ',
  slug: 'bar-do-ze',
  status: 'approved',
  avatar_url: null,
  social_handle: null,
  bio_one_line: null,
}

const ACCEPTANCE = {
  termsVersion: '2026-10',
  termsHash: 'b'.repeat(64),
  acceptedAt: '2026-10-03T12:00:00Z',
  authMethod: 'otp',
  email: 'ze@bardoze.com.br',
  signerName: 'Zé da Silva',
  signerRole: 'Sócio',
  signerCpfMasked: '•••.•••.247-••',
  cpfDiffers: false,
  legalStatusDeclared: true,
  activationCommitment: { sticker: true },
  marketingConsent: false,
  planChoice: 'map_only',
  billingPeriod: null,
  voucherCode: null,
  voucherDiscountCents: null,
  totalCents: 0,
}

const directNoContract = () => ({ ...(contractState() as object), origin: 'direct', portal: [], contract: null, acceptance: null })
const directWithContract = () => ({ ...(contractState() as object), origin: 'direct', portal: [] })
const portalContract = () => ({
  ...(contractState() as object),
  origin: 'portal',
  contract: null,
  acceptance: null,
  portal: [{ submissionId: 'sub-911', status: 'approved', attractionId: 'attr-1', submittedAt: '2026-10-03T12:00:00Z', acceptance: ACCEPTANCE, payment: null }],
})

const CMS_LOGIN = { id: 'link-1', cms_user_id: 'cms-1', client_role: 'owner', cms_users: { id: 'cms-1', email: 'ze@bardoze.com.br', full_name: 'Zé' } }
const APP_USER: AppUserRow = { user_id: 'app-1', full_name: 'Maria Turista', nickname: 'maria', email: 'maria@exemplo.com' }

interface RecordMocks {
  client?: Record<string, unknown>
  contract?: unknown
  coupons?: unknown[]
}

async function mockRecord(page: Page, opts: RecordMocks = {}) {
  const client = { ...CLIENT, ...(opts.client ?? {}) }
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (path === `/api/admin/clients/${CLIENT_ID}`) return json({ client })
    if (path === `/api/admin/clients/${CLIENT_ID}/contract`) return json(opts.contract ?? directNoContract())
    if (path === `/api/admin/clients/${CLIENT_ID}/acceptance-link`) return json({ acceptedAt: null, acceptanceSource: null, link: null })
    if (path === `/api/admin/clients/${CLIENT_ID}/material-orders`) return json({ orders: [] })
    if (path === `/api/admin/partnerships/clients/${CLIENT_ID}`) return json({ detail: detailInCuration() })
    if (path === `/api/clients/${CLIENT_ID}/users`) return json({ users: [CMS_LOGIN] })
    if (path === '/api/coordinator/roots') return json({ roots: [] })
    if (path === '/api/admin/coupons') {
      const coupons = opts.coupons ?? []
      return json({ coupons, pagination: { page: 1, limit: 20, total: coupons.length, pages: 1 } })
    }
    return json({})
  })
}

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Configuração' })
const tab = (page: Page, name: string) => sidebar(page).getByRole('button', { name, exact: true })
const main = (page: Page) => page.locator('main')
/** The card titles of the open tab, in order (`SectionHeader` is an `h2`). */
const titles = (page: Page) => main(page).locator('h2')

async function expectNoAxeViolations(page: Page) {
  // The drawer slides in over a dimmed page: scanned mid-animation, axe measures the text against
  // the overlay showing through and reports contrast the operator never sees.
  // Infinite ones (the active tab's pulse, a spinner) never end and are not the drawer.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().endTime === Infinity)
  )
  const results = await new AxeBuilder({ page })
    .include('main')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
}

test.describe('#911 §8 — the frame of the record', () => {
  test('item 1: seven items, in the order of the spec', async ({ mount, page }) => {
    await mockRecord(page)
    await mount(<ClientRecordModal clientId={CLIENT_ID} />)
    await expect(sidebar(page).getByRole('button').filter({ hasNotText: 'Salvar' })).toHaveText([
      'Parceria',
      'Perfil',
      'Fiscal & Pagamentos',
      'Contrato',
      'Pessoas',
      'Locais',
      'Cupons',
    ])
  })

  test('item 2: no visible "Configuração" over the menu; the <aside> is named by it', async ({ mount, page }) => {
    await mockRecord(page)
    await mount(<ClientRecordModal clientId={CLIENT_ID} />)
    await expect(sidebar(page)).toBeVisible()
    await expect(sidebar(page).getByText('Configuração', { exact: true })).toHaveCount(0)
  })

  test('item 3: the subtitle of a `business` client is `{email} · Empresa`, with no country', async ({ mount, page }) => {
    await mockRecord(page)
    await mount(<ClientRecordModal clientId={CLIENT_ID} />)
    await expect(page.getByText('ze@bardoze.com.br · Empresa', { exact: true })).toBeVisible()
    await expect(page.getByText(/ · Brazil/)).toHaveCount(0)
    await expect(page.getByText(/ · business/)).toHaveCount(0)
  })

  test('item 4: no placeholder starting with "Enter " in any tab of the record', async ({ mount, page }) => {
    await mockRecord(page)
    await mount(<ClientRecordModal clientId={CLIENT_ID} />)
    for (const name of ['Perfil', 'Fiscal & Pagamentos', 'Contrato', 'Pessoas', 'Locais', 'Cupons']) {
      await tab(page, name).click()
      await expect(tab(page, name)).toHaveAttribute('aria-current', 'page')
      await expect(page.locator('[placeholder^="Enter "]')).toHaveCount(0)
    }
  })

  test('a new client: the disabled tab says it opens after saving', async ({ mount, page }) => {
    await mockRecord(page)
    await mount(<ClientRecordModal />)
    await expect(tab(page, 'Locais')).toBeDisabled()
    await expect(tab(page, 'Locais')).toHaveAttribute('title', 'Disponível depois de salvar')
  })
})

test.describe('#911 §8 — Perfil', () => {
  test('item 5: the cards in order; Slug in "Link público e QR", "Tipo de relação" in Identidade', async ({ mount, page }) => {
    await mockRecord(page, { client: { bio_one_line: 'O bar da praia.' } })
    await mount(<ClientRecordModal clientId={CLIENT_ID} />)
    await expect(titles(page)).toHaveText([
      'Identidade',
      'Endereço',
      'Link público e QR',
      'Material de divulgação',
      'Aparência no app',
    ])
    const card = (title: string) => main(page).locator('section, div.rounded-3xl', { has: page.locator('h2', { hasText: title }) }).first()
    await expect(card('Link público e QR').getByLabel('Slug (endereço /d/…)')).toHaveValue('bar-do-ze')
    await expect(card('Identidade').getByLabel('Tipo de relação')).toBeVisible()
    await expect(card('Link público e QR').getByText('Para imprimir em banner, voucher e cartão.')).toBeVisible()
  })

  test('item 6: with no avatar, @ nor bio, "Aparência no app" is a closed <details>', async ({ mount, page }) => {
    await mockRecord(page)
    await mount(<ClientRecordModal clientId={CLIENT_ID} />)
    const details = main(page).locator('details', { hasText: 'Aparência no app: avatar, @ e bio (vazio)' })
    await expect(details).toHaveCount(1)
    await expect(details).not.toHaveAttribute('open', '')
    await expect(titles(page).filter({ hasText: /^Aparência no app$/ })).toHaveCount(0)
  })

  test('item 6: with the bio filled, it is an open card with the three fields', async ({ mount, page }) => {
    await mockRecord(page, { client: { bio_one_line: 'O bar da praia.' } })
    await mount(<ClientRecordModal clientId={CLIENT_ID} />)
    await expect(main(page).locator('details')).toHaveCount(0)
    for (const label of ['Avatar URL', 'Handle social', 'Bio (1 linha)']) {
      await expect(main(page).getByLabel(label)).toBeVisible()
    }
    await expect(main(page).getByLabel('Bio (1 linha)')).toHaveValue('O bar da praia.')
  })

  test('a new client: the slug field alone in "Link público e QR", no QR', async ({ mount, page }) => {
    await mockRecord(page)
    await mount(<ClientRecordModal />)
    await expect(titles(page)).toHaveText(['Identidade', 'Endereço', 'Link público e QR'])
    await expect(main(page).getByLabel('Slug (endereço /d/…)')).toBeVisible()
    await expect(main(page).locator('canvas')).toHaveCount(0)
  })
})

test.describe('#911 §8 — Contrato', () => {
  test('item 7: a direct client with no generated contract sees one card, origin first and the link panel', async ({ mount, page }) => {
    await mockRecord(page, { contract: directNoContract() })
    await mount(<ClientRecordModal clientId={CLIENT_ID} initialTab="contract" />)
    await expect(titles(page)).toHaveText(['Aceite do termo'])
    const card = main(page).locator('div.rounded-3xl', { has: page.locator('h2', { hasText: 'Aceite do termo' }) })
    await expect(card.getByText('Origem do cadastro')).toBeVisible()
    await expect(card.getByRole('button', { name: 'Enviar por e-mail' })).toBeVisible()
    for (const text of ['Contrato de parceria', 'Sem contrato', 'Abrir a página do contrato']) {
      await expect(main(page).getByText(text)).toHaveCount(0)
    }
  })

  test('item 8: a portal client sees one card, and "Aceite eletrônico" once', async ({ mount, page }) => {
    await mockRecord(page, { contract: portalContract() })
    await mount(<ClientRecordModal clientId={CLIENT_ID} initialTab="contract" />)
    await expect(titles(page)).toHaveText(['Aceite eletrônico'])
    await expect(main(page).getByText('Aceite eletrônico')).toHaveCount(1)
    await expect(main(page).getByText('Origem do cadastro')).toBeVisible()
    await expect(main(page).getByText('Termo', { exact: true })).toBeVisible()
    await expect(main(page).getByText('Termo 2026-10 · aceito em 03/10/2026')).toBeVisible()
  })

  test('item 9: with a generated contract, "Contrato de parceria" stays, under the acceptance', async ({ mount, page }) => {
    await mockRecord(page, { contract: directWithContract() })
    await mount(<ClientRecordModal clientId={CLIENT_ID} initialTab="contract" />)
    await expect(titles(page)).toHaveText(['Aceite do termo', 'Contrato de parceria'])
    await expect(main(page).getByRole('link', { name: 'Abrir a página do contrato' })).toBeVisible()
  })

  test('a failed read is the only content of the tab', async ({ mount, page }) => {
    await mockRecord(page)
    await page.route(`**/api/admin/clients/${CLIENT_ID}/contract`, (route) => route.fulfill({ status: 500, body: '{}' }))
    await mount(<ClientRecordModal clientId={CLIENT_ID} initialTab="contract" />)
    await expect(main(page).getByText('Não foi possível carregar o estado do contrato.')).toBeVisible()
    await expect(titles(page)).toHaveCount(0)
  })
})

test.describe('#911 §8 — Locais', () => {
  test('item 10: no "trigger points"; "Ver na aba Parceria" switches tabs', async ({ mount, page }) => {
    await mockRecord(page)
    await mount(<ClientRecordModal clientId={CLIENT_ID} initialTab="places" />)
    const link = main(page).getByRole('button', { name: 'Ver na aba Parceria' })
    await expect(link).toBeVisible()
    await expect(main(page).getByText(/trigger points/)).toHaveCount(0)
    await link.click()
    await expect(tab(page, 'Parceria')).toHaveAttribute('aria-current', 'page')
  })
})

test.describe('#911 §8 — Pessoas', () => {
  test('item 11: blocks in order, "Dono", every trash can named, no "Só admin."', async ({ mount, page }) => {
    await mockRecord(page)
    await mount(<ClientRecordModal clientId={CLIENT_ID} initialTab="team" linkedAppUsers={[APP_USER]} />)
    await expect(tab(page, 'Pessoas')).toHaveAttribute('aria-current', 'page')
    await expect(titles(page)).toHaveText(['Logins no CMS', 'Usuários do app', 'Rede de afiliados'])
    await expect(main(page).getByText('Dono', { exact: true })).toBeVisible()
    await expect(main(page).getByRole('button', { name: 'Desvincular ze@bardoze.com.br' })).toBeVisible()
    await expect(main(page).getByRole('button', { name: 'Desvincular Maria Turista' })).toBeVisible()
    await expect(main(page).getByText(/Só admin\./)).toHaveCount(0)
  })

  test('item 12: a new client — Pessoas enabled, staging an app user works, no "Rede de afiliados"', async ({ mount, page }) => {
    await mockRecord(page)
    await mount(<ClientRecordModal initialTab="team" searchAppUsers={[APP_USER]} />)
    await expect(tab(page, 'Pessoas')).toBeEnabled()
    await expect(titles(page)).toHaveText(['Logins no CMS', 'Usuários do app'])
    await expect(main(page).getByText('Salve o cliente para criar logins.')).toBeVisible()
    await main(page).getByRole('button', { name: 'Vincular usuário' }).click()
    await main(page).getByRole('button', { name: /Maria Turista/ }).click()
    await expect(main(page).getByRole('button', { name: 'Desvincular Maria Turista' })).toBeVisible()
    await expect(main(page).getByText('Os usuários selecionados serão vinculados assim que o cliente for criado.')).toBeVisible()
  })
})

test.describe('#911 §8 — Cupons', () => {
  test('item 13: a client with no coupon — no heading, no search, no <th>; the sentence and "Novo cupom"', async ({ mount, page }) => {
    await mockRecord(page)
    await mount(<ClientRecordModal clientId={CLIENT_ID} initialTab="coupons" />)
    await expect(main(page).getByText('Nenhum cupom para este cliente.')).toBeVisible()
    await expect(main(page).getByRole('button', { name: 'Novo cupom' })).toBeVisible()
    await expect(main(page).getByRole('heading', { name: 'Cupons' })).toHaveCount(0)
    await expect(main(page).getByRole('searchbox')).toHaveCount(0)
    await expect(main(page).locator('th')).toHaveCount(0)
    await expect(main(page).getByText('Só os cupons deste cliente. Os outros estão em Cupons.')).toBeVisible()
  })

  test('the global coupons page is unchanged: heading, search and the table header with no coupon', async ({ mount, page }) => {
    await mockRecord(page)
    await mount(<GlobalCouponsList />)
    await expect(page.getByRole('heading', { name: 'Cupons' })).toBeVisible()
    await expect(page.getByRole('searchbox')).toBeVisible()
    await expect(page.locator('th').first()).toBeVisible()
    await expect(page.getByText('Nenhum cupom — crie o primeiro.')).toBeVisible()
    await expect(page.getByText('Nenhum cupom para este cliente.')).toHaveCount(0)
  })
})

test.describe('#911 §8 item 14 — axe', () => {
  const cases: Array<{ name: string; tab: 'profile' | 'contract' | 'team' | 'places' | 'coupons'; mocks?: RecordMocks; ready: string }> = [
    { name: 'Perfil', tab: 'profile', ready: 'Identidade' },
    { name: 'Contrato, direct', tab: 'contract', mocks: { contract: directNoContract() }, ready: 'Aceite do termo' },
    { name: 'Contrato, portal', tab: 'contract', mocks: { contract: portalContract() }, ready: 'Aceite eletrônico' },
    { name: 'Pessoas', tab: 'team', ready: 'Rede de afiliados' },
    { name: 'Locais', tab: 'places', ready: 'Ver na aba Parceria' },
    { name: 'Cupons', tab: 'coupons', ready: 'Nenhum cupom para este cliente.' },
  ]
  for (const c of cases) {
    test(c.name, async ({ mount, page }) => {
      await mockRecord(page, c.mocks)
      await mount(<ClientRecordModal clientId={CLIENT_ID} initialTab={c.tab} linkedAppUsers={[APP_USER]} />)
      await expect(main(page).getByText(c.ready, { exact: true }).first()).toBeVisible()
      await expectNoAxeViolations(page)
    })
  }
})

test.describe('#911 extra — the record opened from the contract page', () => {
  test('clicking Parceria in the record the checklist opens does not take the page down', async ({ mount, page }) => {
    await mockRecord(page, { contract: directWithContract() })
    await page.route(`**/api/admin/clients/${CLIENT_ID}/conference`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ conference: null }) })
    )
    await mount(<ContractPage clientId={CLIENT_ID} />)
    await page.getByRole('button', { name: 'aba Fiscal e Pagamentos' }).click()
    await expect(tab(page, 'Fiscal & Pagamentos')).toHaveAttribute('aria-current', 'page')
    await tab(page, 'Parceria').click()
    await expect(tab(page, 'Parceria')).toHaveAttribute('aria-current', 'page')
    await expect(main(page).locator('h2').first()).toBeVisible({ timeout: 10_000 })
  })
})
