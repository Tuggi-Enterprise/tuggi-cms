/**
 * As fixtures e os mocks de rede do módulo Financeiro, extraídos do spec para poderem ser
 * reusados pela passada de inspeção visual (`finance-review.spec.tsx`) sem duplicá-los. Duas
 * cópias das mesmas fixtures divergiriam, e aí as duas suítes passariam a falar de telas
 * diferentes.
 */

import type { Page } from '@playwright/test'

/** Um parceiro que se paga e outro que ainda não — dois vereditos diferentes na mesma tabela. */
export const CLIENTS = [
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

export const OVERVIEW = {
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
    monthlyFixedGrossCents: 30_000,
    monthlyFixedCreditCents: 0,
    monthlyFixedNetCents: 30_000,
    monthlyVariableCents: 0,
    payrollMonthlyCents: 0,
    oneOffCents: 300_000,
    variableCents: 0,
    windowCreditCents: 0,
    byCategory: [
      {
        category: 'tools',
        monthlyGrossCents: 30_000,
        monthlyCreditCents: 0,
        windowGrossCents: 0,
        windowCreditCents: 0,
      },
      {
        category: 'infrastructure',
        monthlyGrossCents: 0,
        monthlyCreditCents: 0,
        windowGrossCents: 300_000,
        windowCreditCents: 0,
      },
    ],
    contributionCents: 5_400,
    operatingMarginCents: -24_600,
    averageMonthlyFeeCents: 10_000,
    breakEvenPartners: 3,
    payingPartners: 1,
    ignoredCurrencies: [],
    appliedRates: [
      {
        currency: 'USD',
        rateToBrl: 5.2,
        effectiveFrom: '2026-01-01',
        source: 'Media entre realizado de 6 meses e projecoes Focus',
      },
    ],
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
      category: 'infrastructure',
      nature: 'fixed',
      entryType: 'cost',
      isPayroll: false,
      endsAt: null,
    },
  ],
  truncated: false,
}

export const CATALOG = {
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
  // `finance-service.ts` SEMPRE devolve esta chave (o `?? []` está lá, e a leitura que falha
  // vira 503 antes). O fixture a omitia, e com isso a suíte testava um payload que a rota real
  // não produz — foi assim que a linha aberta do catálogo passou a estourar `packaging is not
  // iterable` só no navegador.
  packaging: [{ productId: 'qr_code', capacity: 50, effectiveFrom: '2026-08-01' }],
  rates: [],
  unmappedMaterialKinds: ['sticker'],
}

export const PURCHASES = {
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

export async function mockAll(page: Page, overview: unknown = OVERVIEW, status = 200) {
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
