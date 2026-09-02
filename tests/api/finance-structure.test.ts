/**
 * A camada MC II — o custo de estrutura, e por que ele nunca desce para a linha do cliente.
 *
 * Mutations that turn this suite red:
 *  · dar um `client_id` ao custo fixo, ou rateá-lo por parceiro em qualquer lugar;
 *  · pôr um desembolso de uma vez só dentro do ponto de equilíbrio, que é uma conta mensal;
 *  · ler uma conta anual como se ela chegasse todo mês;
 *  · assumir período 1 quando ninguém informou o período;
 *  · somar custo fixo de outra moeda contra as margens sem dizer que somou;
 *  · devolver um ponto de equilíbrio quando não existe pagante para tirar a média.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  isActiveOn,
  monthlyAmountCents,
  summarizeStructure,
  type FixedCostRecord,
} from '@/lib/finance/structure'
import { COST_CATEGORIES, COST_ITEM_HINTS } from '@/lib/finance/cost-taxonomy'
import { assessClient, type ClientFinanceFacts } from '@/lib/finance/profitability'
import { summarizeFinance } from '@/lib/finance/summary'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const NOW = '2026-09-01'
const WINDOW = { from: '2026-01-01', to: '2026-09-01' }

function facts(over: Partial<ClientFinanceFacts> = {}): ClientFinanceFacts {
  return {
    clientId: over.clientId ?? 'client-1',
    clientName: over.clientName ?? 'Baires Bistrô',
    approvedAt: over.approvedAt === undefined ? '2026-06-01' : over.approvedAt,
    billingStart:
      over.billingStart === undefined
        ? ({ at: '2026-06-01', source: 'publication' } as const)
        : over.billingStart,
    horizonInvoices: over.horizonInvoices === undefined ? null : over.horizonInvoices,
    stance: over.stance ?? 'paying',
    monthlyFeeCents: over.monthlyFeeCents === undefined ? 10_000 : over.monthlyFeeCents,
    consumption: over.consumption ?? [
      {
        productId: 'display_mesa',
        quantity: 30,
        unitCostCents: 500,
        componentCostCents: 600,
        standardCostCents: 0,
        currency: 'BRL',
      },
    ],
    costEntries: over.costEntries ?? [],
    ordersAwaitingShipment: over.ordersAwaitingShipment ?? 0,
    linkedByPartnerId: over.linkedByPartnerId ?? 12,
    linkedByClientId: over.linkedByClientId ?? 2,
    usersWithPurchase: over.usersWithPurchase === undefined ? 3 : over.usersWithPurchase,
    purchasedMinutes: over.purchasedMinutes === undefined ? 1_800 : over.purchasedMinutes,
  }
}

const CLIENTS = [
  assessClient(facts({ clientId: 'a' }), NOW),
  assessClient(facts({ clientId: 'b', monthlyFeeCents: 2_000 }), NOW),
]

const PRINTER: FixedCostRecord = {
  id: 'printer',
  label: 'Impressora de etiquetas',
  kind: 'one_off',
  amountCents: 300_000,
  currency: 'BRL',
  incurredAt: '2026-03-15',
  periodMonths: null,
  category: 'tools',
  nature: 'fixed',
  entryType: 'cost',
  isPayroll: false,
  endsAt: null,
}

const SUBSCRIPTION: FixedCostRecord = {
  id: 'sub',
  label: 'Assinatura da ferramenta',
  kind: 'recurring',
  amountCents: 30_000,
  currency: 'BRL',
  incurredAt: '2026-02-01',
  periodMonths: 1,
  category: 'tools',
  nature: 'fixed',
  entryType: 'cost',
  isPayroll: false,
  endsAt: null,
}

test('o custo fixo não tem cliente, em lugar nenhum do módulo', () => {
  const structure = code('lib/finance/structure.ts')
  const record = structure.slice(
    structure.indexOf('export interface FixedCostRecord'),
    structure.indexOf('export interface StructureSummary')
  )

  assert.ok(record.length > 0, 'FixedCostRecord existe e é onde o custo fixo é descrito')
  assert.ok(
    !/client/i.test(record),
    'FixedCostRecord não pode carregar um cliente — o custo fixo cobre na camada acima'
  )
  assert.ok(
    !/clientId/.test(structure),
    'nada em structure.ts rateia custo fixo por cliente'
  )

  const migration = read('supabase/migrations/20260901_01_finance_schema.sql')
  const fixedCostsDdl = migration.slice(
    migration.indexOf('create table if not exists finance.fixed_costs'),
    migration.indexOf('comment on table finance.fixed_costs')
  )
  assert.ok(
    !/client_id/.test(fixedCostsDdl),
    'a tabela de custo fixo não pode ter client_id — ela cobre na camada acima'
  )
})

test('o valor mensal de um recorrente sai do período, e o one_off não tem valor mensal', () => {
  assert.equal(monthlyAmountCents(SUBSCRIPTION), 30_000)
  assert.equal(monthlyAmountCents({ ...SUBSCRIPTION, periodMonths: 12 }), 2_500, 'anual vira um doze avos')
  assert.equal(monthlyAmountCents(PRINTER), null, 'uma impressora não chega todo mês')
  assert.equal(
    monthlyAmountCents({ ...SUBSCRIPTION, periodMonths: null }),
    null,
    'período ausente não vira 1 — isso multiplicaria uma conta anual por doze'
  )
})

test('o ponto de equilíbrio usa só o que volta todo mês', () => {
  const summary = summarizeStructure([PRINTER, SUBSCRIPTION], CLIENTS, WINDOW)

  assert.equal(summary.monthlyFixedCents, 30_000, 'a impressora ficou de fora')
  assert.equal(summary.oneOffCents, 300_000, 'e aparece na tela como o desembolso datado que é')
  assert.equal(summary.averageMonthlyFeeCents, 6_000, 'média de R$ 100 e R$ 20')
  assert.equal(summary.breakEvenPartners, 5)
  assert.equal(summary.payingPartners, 2)
})

test('MC II é a soma das margens menos o fixo mensal', () => {
  const summary = summarizeStructure([SUBSCRIPTION], CLIENTS, WINDOW)

  assert.equal(summary.contributionCents, 4_800, '14.400 do primeiro, −9.600 do segundo')
  assert.equal(summary.operatingMarginCents, 4_800 - 30_000)
})

test('um one_off fora da janela não entra na leitura do período', () => {
  const summary = summarizeStructure([PRINTER], CLIENTS, { from: '2026-06-01', to: '2026-09-01' })

  assert.equal(summary.oneOffCents, 0, 'março não está na janela de junho a setembro')
})

test('um recorrente que ainda não começou não conta', () => {
  const summary = summarizeStructure(
    [{ ...SUBSCRIPTION, incurredAt: '2026-12-01' }],
    CLIENTS,
    WINDOW
  )

  assert.equal(summary.monthlyFixedCents, 0)
  assert.equal(summary.breakEvenPartners, null, 'sem fixo mensal não há equilíbrio a atingir')
})

test('sem pagante não há média, e sem média não há ponto de equilíbrio', () => {
  const unpaid = [
    assessClient(
      facts({ clientId: 'c', stance: 'not_paying', monthlyFeeCents: null, usersWithPurchase: 0 }),
      NOW
    ),
  ]
  const summary = summarizeStructure([SUBSCRIPTION], unpaid, WINDOW)

  assert.equal(summary.averageMonthlyFeeCents, null)
  assert.equal(summary.breakEvenPartners, null, 'nem zero, nem infinito')
  assert.equal(summary.payingPartners, 0)
})

test('custo fixo em outra moeda não se soma contra as margens: ele volta nomeado', () => {
  const summary = summarizeStructure(
    [SUBSCRIPTION, { ...PRINTER, id: 'eur', currency: 'EUR' }],
    CLIENTS,
    WINDOW
  )

  assert.equal(summary.currency, 'BRL', 'a moeda vem dos parceiros, que são o lado que decide')
  assert.equal(summary.oneOffCents, 0)
  assert.deepEqual(summary.ignoredCurrencies, ['EUR'])
})

// ── OS QUATRO EIXOS ───────────────────────────────────────────────────────────────────────────
//
// Categoria (para onde vai), natureza (fixo ou variável), cadência (uma vez ou toda vez) e sinal
// (custo ou crédito). Cada teste abaixo trava uma confusão entre dois deles.

const CREDIT: FixedCostRecord = {
  ...SUBSCRIPTION,
  id: 'credit',
  label: 'Desconto de plano anual',
  amountCents: 5_000,
  entryType: 'credit',
}

test('um crédito ABATE, e jamais soma como se fosse custo', () => {
  const summary = summarizeStructure([SUBSCRIPTION, CREDIT], CLIENTS, WINDOW)

  assert.equal(summary.monthlyFixedGrossCents, 30_000, 'o preço cheio não muda')
  assert.equal(summary.monthlyFixedCreditCents, 5_000)
  assert.equal(
    summary.monthlyFixedNetCents,
    25_000,
    'somar o crédito como custo daria 35.000 — o erro que `entryType` existe para impedir'
  )
})

test('o crédito TEMPORÁRIO sai do custo estrutural e fica no de caixa', () => {
  const temporary = { ...CREDIT, id: 'promo', amountCents: 12_000, endsAt: '2026-12-31' }
  const summary = summarizeStructure([SUBSCRIPTION, temporary], CLIENTS, WINDOW)

  assert.equal(
    summary.monthlyFixedCents,
    30_000,
    'o estrutural ignora o benefício que tem data para acabar'
  )
  assert.equal(summary.monthlyFixedNetCents, 18_000, 'mas o caixa deste mês paga menos')
  assert.equal(
    summary.breakEvenPartners,
    5,
    'o equilíbrio é medido contra o estrutural: contar com o crédito diria que a operação se ' +
      'paga para uma empresa que ficaria no vermelho quando ele acabasse'
  )
})

test('o crédito PERMANENTE abate os dois, porque ele não vai acabar', () => {
  const summary = summarizeStructure([SUBSCRIPTION, CREDIT], CLIENTS, WINDOW)

  assert.equal(summary.monthlyFixedCents, 25_000)
  assert.equal(summary.monthlyFixedNetCents, 25_000)
})

test('um crédito já vencido não abate nada', () => {
  const expired = { ...CREDIT, id: 'gone', amountCents: 12_000, endsAt: '2026-06-30' }
  const summary = summarizeStructure([SUBSCRIPTION, expired], CLIENTS, WINDOW)

  assert.equal(summary.monthlyFixedCreditCents, 0)
  assert.equal(summary.monthlyFixedNetCents, 30_000)
})

test('um crédito maior que o custo não produz um fixo NEGATIVO', () => {
  const oversized = { ...CREDIT, id: 'big', amountCents: 90_000 }
  const summary = summarizeStructure([SUBSCRIPTION, oversized], CLIENTS, WINDOW)

  // A planilha do operador produzia −R$ 164,67 de custo fixo em ago/2026 abatendo um crédito de
  // API de IA da linha de FIXO. Um custo fixo negativo não é um número que exista.
  assert.equal(summary.monthlyFixedCents, 0)
  assert.equal(summary.monthlyFixedNetCents, 0)
  assert.equal(summary.breakEvenPartners, null, 'sem fixo a cobrir não há equilíbrio a atingir')
})

test('a assinatura encerrada para de cobrar, e a que a substituiu não soma com ela', () => {
  // Medido na planilha: a Supabase custou US$ 32,49 em julho e US$ 40,99 de agosto em diante.
  // Sem `endsAt`, as duas linhas somariam para sempre.
  const before = { ...SUBSCRIPTION, id: 'old', amountCents: 20_000, endsAt: '2026-07-31' }
  const after = { ...SUBSCRIPTION, id: 'new', amountCents: 25_000, incurredAt: '2026-08-01' }
  const summary = summarizeStructure([before, after], CLIENTS, WINDOW)

  assert.equal(summary.monthlyFixedGrossCents, 25_000, 'só o preço vigente, nunca a soma dos dois')
})

test('`isActiveOn`: nulo é "ainda vale", e não "termina hoje"', () => {
  assert.equal(isActiveOn(SUBSCRIPTION, '2026-09-01'), true)
  assert.equal(isActiveOn(SUBSCRIPTION, '2026-01-01'), false, 'antes de começar não vale')
  assert.equal(isActiveOn({ ...SUBSCRIPTION, endsAt: '2026-08-31' }, '2026-09-01'), false)
  assert.equal(
    isActiveOn({ ...SUBSCRIPTION, endsAt: '2026-09-01' }, '2026-09-01'),
    true,
    'o último dia ainda é um dia em que a linha vale'
  )
})

test('o custo VARIÁVEL fica fora do fixo mensal e do ponto de equilíbrio', () => {
  const ai: FixedCostRecord = {
    ...PRINTER,
    id: 'ai',
    label: 'APIs de IA',
    category: 'infrastructure',
    nature: 'variable',
    amountCents: 141_158,
    incurredAt: '2026-07-01',
  }
  const summary = summarizeStructure([SUBSCRIPTION, ai], CLIENTS, WINDOW)

  assert.equal(summary.variableCents, 141_158, 'ele é lido')
  assert.equal(summary.oneOffCents, 0, 'e não se mistura com o desembolso fixo')
  assert.equal(summary.monthlyFixedCents, 30_000)
  assert.equal(
    summary.breakEvenPartners,
    5,
    'pedir parceiros para cobrir um custo que só existe porque os parceiros existem é circular'
  )
})

test('o variável RECORRENTE tem taxa mensal própria, e ela não é fixo', () => {
  const commission = { ...SUBSCRIPTION, id: 'rc', nature: 'variable' as const, amountCents: 8_000 }
  const summary = summarizeStructure([SUBSCRIPTION, commission], CLIENTS, WINDOW)

  assert.equal(summary.monthlyFixedCents, 30_000)
  assert.equal(summary.monthlyVariableCents, 8_000)
})

test('a folha lê o que está MARCADO, e não a categoria inteira', () => {
  const salary = {
    ...SUBSCRIPTION,
    id: 'clt',
    category: 'people' as const,
    isPayroll: true,
    amountCents: 500_000,
  }
  const benefit = {
    ...SUBSCRIPTION,
    id: 'vr',
    category: 'people' as const,
    isPayroll: false,
    amountCents: 40_000,
  }
  const summary = summarizeStructure([salary, benefit], CLIENTS, WINDOW)

  // Benefício é "Pessoas" e NÃO entra na base do fator R. Ler a categoria como folha inflaria o
  // índice e faria a empresa se planejar para o Anexo III sem ter alcançado os 28%.
  assert.equal(summary.payrollMonthlyCents, 500_000)
  assert.equal(summary.monthlyFixedCents, 540_000, 'mas os dois são custo fixo')
})

test('por categoria, a taxa mensal e o desembolso do período NUNCA viram um número só', () => {
  const ai: FixedCostRecord = {
    ...PRINTER,
    id: 'ai',
    category: 'infrastructure',
    nature: 'variable',
    amountCents: 141_158,
    incurredAt: '2026-07-01',
  }
  const summary = summarizeStructure([SUBSCRIPTION, PRINTER, ai], CLIENTS, WINDOW)

  const tools = summary.byCategory.find((line) => line.category === 'tools')
  const infra = summary.byCategory.find((line) => line.category === 'infrastructure')

  assert.equal(tools?.monthlyGrossCents, 30_000)
  assert.equal(tools?.windowGrossCents, 300_000, 'a impressora é do período, não do mês')
  assert.equal(infra?.monthlyGrossCents, 0)
  assert.equal(infra?.windowGrossCents, 141_158)

  assert.ok(
    summary.byCategory.every((line) => !('totalCents' in line)),
    'somar taxa mensal com desembolso daria um número que não é nenhum dos dois'
  )
})

test('categoria sem nada não aparece na lista', () => {
  const summary = summarizeStructure([SUBSCRIPTION], CLIENTS, WINDOW)

  assert.deepEqual(
    summary.byCategory.map((line) => line.category),
    ['tools'],
    'uma linha de R$ 0,00 por categoria vazia é ruído, não informação'
  )
})

// ── A TAXA DECLARADA ──────────────────────────────────────────────────────────────────────────

const USD_RATE = {
  currency: 'USD',
  rateToBrl: 5.2,
  effectiveFrom: '2026-01-01',
  source: 'Media do realizado com as projecoes Focus',
}

test('o custo em dólar entra na estrutura pela taxa declarada', () => {
  // US$ 40,99 de Supabase por mês, a R$ 5,20, somados ao fixo de R$ 300,00.
  const supabase = { ...SUBSCRIPTION, id: 'sb', currency: 'USD', amountCents: 4_099 }
  const summary = summarizeStructure([SUBSCRIPTION, supabase], CLIENTS, WINDOW, 'BRL', [USD_RATE])

  assert.equal(summary.monthlyFixedGrossCents, 30_000 + Math.round(4_099 * 5.2))
  assert.deepEqual(summary.ignoredCurrencies, [], 'com taxa, nada fica de fora')
  assert.deepEqual(
    summary.appliedRates.map((rate) => rate.currency),
    ['USD'],
    'e a tela recebe qual taxa foi usada, para poder dizer que converteu'
  )
})

test('sem taxa declarada, a moeda continua nomeada e fora de toda soma', () => {
  const pound = { ...SUBSCRIPTION, id: 'gbp', currency: 'GBP', amountCents: 4_099 }
  const summary = summarizeStructure([SUBSCRIPTION, pound], CLIENTS, WINDOW, 'BRL', [USD_RATE])

  assert.equal(summary.monthlyFixedGrossCents, 30_000, 'a libra não virou real por palpite')
  assert.deepEqual(summary.ignoredCurrencies, ['GBP'])
  assert.deepEqual(summary.appliedRates, [], 'nenhuma taxa foi usada')
})

test('a taxa declarada depois do desembolso não vale para ele', () => {
  const future = { ...USD_RATE, effectiveFrom: '2026-12-01' }
  const dated = {
    ...PRINTER,
    id: 'usd-printer',
    currency: 'USD',
    amountCents: 10_000,
    incurredAt: '2026-03-15',
  }
  const summary = summarizeStructure([dated], CLIENTS, WINDOW, 'BRL', [future])

  assert.equal(summary.oneOffCents, 0, 'a taxa de dezembro não reprecifica março')
  assert.deepEqual(summary.ignoredCurrencies, ['USD'])
})

test('sem taxa nenhuma, o comportamento é o de antes de `fx_rates` existir', () => {
  // A compatibilidade importa: a lista de taxas é opcional, e um chamador que não a passa não
  // pode começar a converter por conta própria.
  const summary = summarizeStructure(
    [SUBSCRIPTION, { ...PRINTER, id: 'eur', currency: 'EUR' }],
    CLIENTS,
    WINDOW
  )

  assert.equal(summary.oneOffCents, 0)
  assert.deepEqual(summary.ignoredCurrencies, ['EUR'])
})

test('a Estrutura e o total de Parceiros convertem pela MESMA taxa', () => {
  // Duas superfícies da mesma tela somando a mesma lista com números de câmbio diferentes é como
  // um total acima passa a discordar da linha abaixo. Se só uma delas convertesse, a "soma das
  // margens" da Estrutura e o total de Parceiros divergiriam no dia do primeiro contrato em euro.
  const usd = assessClient(
    facts({
      clientId: 'usd',
      consumption: [
        {
          productId: 'display_mesa',
          quantity: 10,
          unitCostCents: 100,
          componentCostCents: 0,
          standardCostCents: 0,
          currency: 'USD',
        },
      ],
    }),
    NOW
  )

  assert.equal(usd.currency, 'USD', 'a moeda do parceiro vem das linhas dele')

  const fx = { rates: [USD_RATE], on: WINDOW.to }
  const totals = summarizeFinance([usd], 'BRL', fx)
  const structure = summarizeStructure([], [usd], WINDOW, 'BRL', [USD_RATE])

  assert.equal(totals.marginCents, structure.contributionCents)
  assert.deepEqual(totals.ignoredCurrencies, [])
})

test('sem taxa, as duas continuam nomeando a moeda em vez de somá-la', () => {
  const usd = assessClient(
    facts({
      clientId: 'usd',
      consumption: [
        {
          productId: 'display_mesa',
          quantity: 10,
          unitCostCents: 100,
          componentCostCents: 0,
          standardCostCents: 0,
          currency: 'USD',
        },
      ],
    }),
    NOW
  )

  assert.equal(summarizeFinance([usd, ...CLIENTS]).marginCents, summarizeStructure([], [usd, ...CLIENTS], WINDOW).contributionCents)
  assert.deepEqual(summarizeFinance([usd, ...CLIENTS]).ignoredCurrencies, ['USD'])
})

// ── O VOCABULÁRIO ─────────────────────────────────────────────────────────────────────────────

test('o CHECK do banco e o vocabulário do TypeScript são a MESMA lista', () => {
  const migration = read('supabase/migrations/20260902_03_finance_cost_taxonomy.sql')
  const check = migration.slice(
    migration.indexOf('fixed_costs_category_ck check'),
    migration.indexOf('comment on column finance.fixed_costs.category')
  )

  for (const category of COST_CATEGORIES) {
    assert.ok(check.includes(`'${category}'`), `o banco precisa aceitar \`${category}\``)
  }
  // E o contrário: uma categoria que o banco aceita e o TypeScript não conhece entraria por
  // um script e sairia da tela sem nome nenhum.
  const inDatabase = check.match(/'([a-z_]+)'/g)?.map((quoted) => quoted.slice(1, -1)) ?? []
  assert.deepEqual(
    inDatabase.slice().sort(),
    COST_CATEGORIES.slice().sort(),
    'as duas cópias da lista têm de ser iguais'
  )
})

test('todo item previsto tem categoria do vocabulário e rótulo nos três idiomas', () => {
  const messages = ['pt', 'en', 'es'].map(
    (locale) => JSON.parse(read(`messages/${locale}.json`)) as Record<string, never>
  )

  for (const hint of COST_ITEM_HINTS) {
    assert.ok(
      (COST_CATEGORIES as readonly string[]).includes(hint.category),
      `${hint.id} está numa categoria que não existe`
    )
    for (const bundle of messages) {
      const items = (bundle as unknown as { Finance: { costItems: Record<string, string> } })
        .Finance.costItems
      assert.ok(items[hint.id], `falta o rótulo de ${hint.id} num dos idiomas`)
    }
  }
})

test('a folha só é marcada no que entra na base do fator R', () => {
  const payroll = COST_ITEM_HINTS.filter((hint) => hint.payroll).map((hint) => hint.id)

  assert.deepEqual(payroll.slice().sort(), ['clt_salaries', 'fgts', 'pro_labore', 'vacation_13th'])
  // Benefício e estagiário são "Pessoas" e ficam de fora por lei — marcá-los inflaria o índice
  // que decide o anexo do Simples, e o inflaria para cima.
  assert.ok(!payroll.includes('benefits'))
  assert.ok(!payroll.includes('intern'))
})
