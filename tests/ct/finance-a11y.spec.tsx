/**
 * O módulo Financeiro num Chromium real — o que `tests/api/finance-*.test.ts` não consegue afirmar.
 *
 * As seis suítes de `tests/api` provam as CONTAS sem banco e sem navegador: média ponderada com
 * rendimento, vigência de receita, os seis vereditos, a camada MC II. O que elas não alcançam é
 * o que só existe depois de o CSS resolver: `axe-core` limpo, contraste medido, alvo de 24×24 px,
 * e a garantia de que um veredito continua legível para quem não enxerga a cor (DS-A11Y-003).
 *
 * MONTAGEM DE COMPONENTE E NÃO NAVEGAÇÃO, pelo mesmo motivo de `partnerships-a11y.spec.tsx`: a
 * checagem de sessão de `proxy.ts` roda no servidor e não é alcançável por um hook de rota do
 * navegador, e esta suíte não tem credencial de CMS para logar de verdade. Toda chamada de rede
 * é interceptada por `page.route`.
 *
 * PROVIDER PRÓPRIO E NÃO O `Wrapper` DE PARCERIAS. Aquele arquivo declara os namespaces das
 * telas de parceria e monta `QueryProvider` porque `PlaceFormModal` o exige; esta tela não usa
 * react-query e precisa do namespace `Finance`. Emprestar o wrapper de lá acoplaria duas suítes
 * que não compartilham nada além da moldura.
 *
 * O `Header` NÃO ENTRA, como lá: ele exige `SessionContextProvider` e o roteador tipado do
 * next-intl, que não resolvem fora de um request real do app router.
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { NextIntlClientProvider } from 'next-intl'
import ptMessages from '@/messages/pt.json'
import { FinancePageContent } from '@/components/finance/FinancePageContent'

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="pt" messages={{ Finance: ptMessages.Finance }}>
      {children}
    </NextIntlClientProvider>
  )
}

/** Um parceiro que se paga e outro que ainda não — dois vereditos diferentes na mesma tabela. */
const CLIENTS = [
  {
    clientId: '11111111-1111-4111-8111-111111111111',
    clientName: 'Baires Bistrô',
    approvedAt: '2026-06-01',
    verdict: 'profitable',
    currency: 'BRL',
    directCostCents: 15_600,
    standardCostCents: 600,
    revenueCents: 30_000,
    marginCents: 14_400,
    monthsBilled: 3,
    paybackMonths: 2,
    cacCents: 1_300,
    linkedByPartnerId: 12,
    linkedByClientId: 2,
    usersWithPurchase: 3,
    purchasedMinutes: 1_800,
    unpricedLines: 0,
    ignoredCurrencies: [],
  },
  {
    clientId: '22222222-2222-4222-8222-222222222222',
    clientName: 'Pousada do Alto',
    approvedAt: '2026-08-02',
    verdict: 'no_return',
    currency: 'BRL',
    directCostCents: 9_000,
    standardCostCents: 0,
    revenueCents: 0,
    marginCents: -9_000,
    monthsBilled: 0,
    paybackMonths: null,
    cacCents: null,
    linkedByPartnerId: 0,
    linkedByClientId: 1,
    usersWithPurchase: 0,
    purchasedMinutes: null,
    unpricedLines: 0,
    ignoredCurrencies: [],
  },
]

const OVERVIEW = {
  clients: CLIENTS,
  consumption: [{ productId: 'display_mesa', quantity: 30, components: [{ productId: 'qr_code', quantityPerUnit: 2 }] }],
  summary: {
    currency: 'BRL',
    partners: 2,
    byVerdict: {
      uncosted: 0,
      undated: 0,
      no_return: 1,
      non_monetary_return: 0,
      payback_pending: 0,
      profitable: 1,
    },
    directCostCents: 24_600,
    standardCostCents: 600,
    revenueCents: 30_000,
    marginCents: 5_400,
    unpricedLines: 0,
    acquiredUsers: 12,
    teamUsers: 3,
    usersWithPurchase: 3,
    purchasedMinutes: 1_800,
    cacCents: 2_050,
    ignoredCurrencies: [],
  },
  cohorts: { lines: [], undated: 0 },
  structure: {
    currency: 'BRL',
    monthlyFixedCents: 30_000,
    oneOffCents: 300_000,
    contributionCents: 5_400,
    operatingMarginCents: -24_600,
    averageMonthlyFeeCents: 10_000,
    breakEvenPartners: 3,
    payingPartners: 1,
    ignoredCurrencies: [],
  },
  fixedCosts: [
    {
      id: 'printer',
      label: 'Impressora de etiquetas',
      kind: 'one_off',
      amountCents: 300_000,
      currency: 'BRL',
      incurredAt: '2026-03-15',
      periodMonths: null,
    },
  ],
  truncated: false,
}

const CATALOG = {
  products: [
    {
      id: 'display_mesa',
      name: 'Display de mesa',
      role: 'deliverable',
      materialKind: 'table_display',
      purchaseUnit: 'unidade',
      isActive: true,
    },
    {
      id: 'qr_code',
      name: 'QR code',
      role: 'component',
      materialKind: null,
      purchaseUnit: 'bobina',
      isActive: true,
    },
  ],
  recipes: [
    {
      parentProductId: 'display_mesa',
      componentProductId: 'qr_code',
      quantity: 2,
      effectiveFrom: '2026-01-01',
    },
  ],
  rates: [],
  unmappedMaterialKinds: ['sticker'],
}

const PURCHASES = {
  purchases: [
    {
      id: 'buy-1',
      productId: 'qr_code',
      purchaseUnits: 1,
      totalCents: 5_000,
      freightCents: 0,
      currency: 'BRL',
      purchasedAt: '2026-08-01',
      supplier: 'Gráfica Central',
      invoiceRef: null,
      notes: null,
    },
  ],
  unitCosts: [
    { productId: 'display_mesa', centsExact: 500, currency: 'BRL', pieces: 100 },
    { productId: 'qr_code', centsExact: 10, currency: 'BRL', pieces: 500 },
  ],
}

async function mockAll(page: Page, overview: unknown = OVERVIEW, status = 200) {
  await page.route('**/api/finance/clients', (route) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(overview) })
  )
  await page.route('**/api/finance/catalog', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CATALOG) })
  )
  await page.route('**/api/finance/purchases', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PURCHASES) })
  )
}

/** Nenhuma violação de `axe` nas regras de A e AA. */
async function expectAxeClean(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  expect(results.violations).toEqual([])
}

test.describe('as três seções passam no axe', () => {
  test('Parceiros', async ({ mount, page }) => {
    await mockAll(page)
    const component = await mount(
      <Wrapper>
        <FinancePageContent />
      </Wrapper>
    )
    await expect(component.getByText('Baires Bistrô')).toBeVisible()
    await expectAxeClean(page)
  })

  test('Catálogo e compras', async ({ mount, page }) => {
    await mockAll(page)
    const component = await mount(
      <Wrapper>
        <FinancePageContent />
      </Wrapper>
    )
    await component.getByRole('button', { name: 'Catálogo e compras' }).click()
    await expect(component.getByText('Display de mesa').first()).toBeVisible()
    await expectAxeClean(page)
  })

  test('Estrutura', async ({ mount, page }) => {
    await mockAll(page)
    const component = await mount(
      <Wrapper>
        <FinancePageContent />
      </Wrapper>
    )
    await component.getByRole('button', { name: 'Estrutura' }).click()
    await expect(component.getByText('Impressora de etiquetas')).toBeVisible()
    await expectAxeClean(page)
  })
})

test('DS-A11Y-003: o veredito é texto, e a diferença entre dois vereditos chega a quem não vê a cor', async ({
  mount,
  page,
}) => {
  await mockAll(page)
  const component = await mount(
    <Wrapper>
      <FinancePageContent />
    </Wrapper>
  )

  // Os dois vereditos da fixture aparecem escritos, não como cor.
  await expect(component.getByText('Se paga')).toBeVisible()
  await expect(component.getByText('Só custo')).toBeVisible()

  // E a explicação — que é o que separa "só custo" de "retorno não medido em R$" — está no DOM
  // para o leitor de tela, não só no `title`.
  await expect(
    component.getByText('Não paga mensalidade e nenhum usuário vindo dele comprou.', { exact: false })
  ).toHaveCount(1)
})

test('ausência imprime travessão, nunca R$ 0,00 nem zero', async ({ mount, page }) => {
  await mockAll(page)
  const component = await mount(
    <Wrapper>
      <FinancePageContent />
    </Wrapper>
  )

  // `Pousada do Alto` tem payback, CAC e minutos nulos: três ausências na mesma linha.
  const row = component.locator('tr', { hasText: 'Pousada do Alto' })
  await expect(row.getByText('—')).toHaveCount(3)
})

test('alvos de 24×24 CSS px no trilho de seções', async ({ mount, page }) => {
  await mockAll(page)
  const component = await mount(
    <Wrapper>
      <FinancePageContent />
    </Wrapper>
  )

  for (const name of ['Parceiros', 'Catálogo e compras', 'Estrutura']) {
    const box = await component.getByRole('button', { name }).boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(24)
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(24)
  }
})

test('o 503 do lado do app diz o que aconteceu, e não desenha veredito nenhum', async ({
  mount,
  page,
}) => {
  await mockAll(page, { error: 'app_users_unavailable' }, 503)
  const component = await mount(
    <Wrapper>
      <FinancePageContent />
    </Wrapper>
  )

  await expect(component.getByRole('alert')).toContainText('usuários do app')
  // Nenhum veredito é afirmado sobre parceiro nenhum enquanto a leitura não responde.
  await expect(component.getByText('Só custo')).toHaveCount(0)
  await expect(component.getByRole('button', { name: 'Tentar de novo' })).toBeVisible()
})

test('o tipo da esteira sem produto aparece como pendência de cadastro', async ({ mount, page }) => {
  await mockAll(page)
  const component = await mount(
    <Wrapper>
      <FinancePageContent />
    </Wrapper>
  )
  await component.getByRole('button', { name: 'Catálogo e compras' }).click()

  // `sticker` não tem produto na fixture: a tela diz isso em vez de deixar o pedido sair de graça.
  await expect(component.getByRole('status')).toContainText('sticker')
})
