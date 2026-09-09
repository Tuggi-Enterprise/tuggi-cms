/**
 * As fixtures e os mocks de rede do módulo Financeiro, extraídos do spec para poderem ser
 * reusados pela passada de inspeção visual (`finance-review.spec.tsx`) sem duplicá-los. Duas
 * cópias das mesmas fixtures divergiriam, e aí as duas suítes passariam a falar de telas
 * diferentes.
 */

import type { Page } from '@playwright/test'
import type {
  ClientsPayload,
  CatalogPayload,
  PurchasesPayload,
} from '@/components/finance/FinancePageContent'

/** Um parceiro que se paga e outro que ainda não — dois vereditos diferentes na mesma tabela. */
export const CLIENTS: ClientsPayload['clients'] = [
  {
    clientId: '11111111-1111-4111-8111-111111111111',
    clientName: 'Baires Bistrô',
    approvedAt: '2026-06-01',
    // A cobrança começa na PUBLICAÇÃO — o caminho normal do contrato (BR-B2B-018).
    billingStartsAt: '2026-06-15',
    billingStartSource: 'publication',
    verdict: 'profitable',
    currency: 'BRL',
    directCostCents: 15_600,
    standardCostCents: 600,
    revenueCents: 30_000,
    marginCents: 14_400,
    monthsBilled: 3,
    monthlyFeeCents: 10_000,
    paybackMonths: 2,
    cacCents: 1_300,
    linkedByPartnerId: 12,
    linkedByClientId: 2,
    usersWithPurchase: 3,
    purchasedMinutes: 1_800,
    purchaseSuppressed: false,
    unpricedLines: 0,
    ordersAwaitingShipment: 0,
    ignoredCurrencies: [],
  },
  {
    clientId: '22222222-2222-4222-8222-222222222222',
    clientName: 'Pousada do Alto',
    approvedAt: '2026-08-02',
    // Aprovado e ainda sem publicação: não há cobrança começada, e por isso não há retorno.
    billingStartsAt: null,
    billingStartSource: null,
    verdict: 'no_return',
    currency: 'BRL',
    directCostCents: 9_000,
    standardCostCents: 0,
    revenueCents: 0,
    marginCents: -9_000,
    monthsBilled: 0,
    monthlyFeeCents: null,
    paybackMonths: null,
    cacCents: null,
    linkedByPartnerId: 0,
    linkedByClientId: 1,
    usersWithPurchase: 0,
    purchasedMinutes: null,
    purchaseSuppressed: false,
    unpricedLines: 0,
    ordersAwaitingShipment: 0,
    ignoredCurrencies: [],
  },
]

/**
 * O mês fechado, reusado pela série. Uma cópia só: dois literais divergiriam e a tela passaria a
 * mostrar um mês na cascata e outro no gráfico, que é exatamente o defeito que `MonthlyPoint
 * extends MonthlyCascade` existe para impedir.
 */
const MONTH_CLOSED: ClientsPayload['month'] = {
  month: '2026-08',
  currency: 'BRL',
  recurringRevenueCents: 10_000,
  variableCostCents: 6_000,
  standardCostCents: 600,
  fixedMonthlyCents: 30_000,
  oneOffCents: 0,
  operatingCostCents: 4_000,
  creditCents: 0,
  appliedRates: [],
  resultCents: -30_600,
  deliveries: 1,
  unpricedLines: 0,
  ignoredCurrencies: [],
}

export const OVERVIEW: ClientsPayload = {
  clients: CLIENTS,
  consumption: [
    {
      productId: 'display_mesa',
      quantity: 30,
      unitCostCents: 520,
      componentCostCents: 60,
      standardCostCents: 20,
      currency: 'BRL',
      components: [{ productId: 'qr_code', quantityPerUnit: 2 }],
    },
  ],
  summary: {
    currency: 'BRL',
    partners: 2,
    byVerdict: {
      uncosted: 0,
      undated: 0,
      no_return: 1,
      unknown_return: 0,
      non_monetary_return: 0,
      payback_pending: 0,
      profitable: 1,
    },
    directCostCents: 24_600,
    standardCostCents: 600,
    revenueCents: 30_000,
    marginCents: 5_400,
    unpricedLines: 0,
    // Nada esperando despacho e nenhuma compra faltando: os totais acima são fato, não piso.
    ordersAwaitingShipment: 0,
    purchaseIsFloor: false,
    acquiredUsers: 12,
    teamUsers: 3,
    usersWithPurchase: 3,
    purchasedMinutes: 1_800,
    cacCents: 2_050,
    ignoredCurrencies: [],
  },
  cohorts: { lines: [], undated: 0 },
  /**
   * A JANELA QUE O SERVIDOR DE FATO USOU, e não uma frase genérica: a tela nomeia o período em
   * vez de dizer "no período", que é o que deixava o operador sem saber o que estava lendo.
   */
  structureWindow: { from: '2026-08-01', to: '2026-08-31' },
  /** A cascata do mês FECHADO, computada sobre a mesma lista que a tabela desenha. */
  month: MONTH_CLOSED,
  /**
   * Dois meses para trás, o vigente e seis para a frente. Três pontos bastam para a série ter
   * uma virada de `realized` no meio — que é a única coisa que a fixture precisa provar aqui.
   */
  series: [
    { ...MONTH_CLOSED, month: '2026-07', realized: true, appRevenueCents: 4_000, revenueBlockedCents: 0 },
    { ...MONTH_CLOSED, realized: true, appRevenueCents: 5_000, revenueBlockedCents: 0 },
    // O mês à frente é onde a camada bloqueada tem sentido: o parceiro está no ar e a
    // mensalidade corre, mas sem o instrumento assinado a fatura não sai. Nunca soma com a de
    // cima — é o que faz esta linha existir separada.
    { ...MONTH_CLOSED, month: '2026-09', realized: false, appRevenueCents: 5_000, revenueBlockedCents: 10_000 },
  ],
  /** Receita do app em outra moeda: contada à parte, nunca somada ao total em BRL. */
  appOtherCurrencies: [],
  mix: {
    currency: 'BRL',
    total: 2,
    paying: 1,
    courtesy: 0,
    free: 0,
    // BR-B2B-017, item 6: ninguém disse quanto custa, e isso NÃO é zero.
    undeclared: 1,
    terminated: 0,
    committedMrrCents: 10_000,
    uncommittedMrrCents: 0,
    averageFeeCents: 10_000,
    // Pagantes cuja cobrança ainda não começou: contados, e fora da projeção.
    payingWithoutBillingStart: 0,
    approximateBillingStarts: 0,
    ignoredCurrencies: [],
  },
  projectionBase: {
    from: '2026-08',
    months: 6,
    currency: 'BRL',
    committedByMonth: { '2026-08': 10_000, '2026-09': 10_000 },
    averageFeeCents: 10_000,
    fixedMonthlyCents: 30_000,
    kitCostCents: 6_000,
  },
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
  /** Parceiros marcados como teste: contados, nunca sumidos das contas em silêncio. */
  excludedPartners: 0,
  purchasesAnswered: true,
  fxUnavailable: false,
}

export const CATALOG: CatalogPayload = {
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

export const PURCHASES: PurchasesPayload = {
  purchases: [
    {
      id: 'buy-1',
      productId: 'qr_code',
      // `pieces` = `units × unitsYield`, e vem PRONTO do banco (coluna gerada). Uma segunda cópia
      // da conta é a promessa de que um dia as duas discordam: em 2026-09-01 a multiplicação
      // morava do lado errado e uma compra de 300 adesivos virou 45.000.
      units: 1,
      unitsYield: 500,
      pieces: 500,
      // 500 peças por R$ 50,00 dão os 10 centavos que `unitCosts` declara para o `qr_code`.
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
