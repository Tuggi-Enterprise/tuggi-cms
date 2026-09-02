/**
 * A VISÃO GERAL — a faixa que junta os dois lados do negócio, e as recusas que a tornam honesta.
 *
 * Mutations that turn this suite red:
 *  · somar a taxa de impressão dentro do custo variável do mês;
 *  · pôr o desembolso de uma vez só dentro do resultado que fecha o mês;
 *  · contar uma assinatura que ainda não começou no custo de um mês anterior;
 *  · deixar uma linha sem preço somar zero em vez de virar pendência;
 *  · contar como pagante quem tem contrato encerrado;
 *  · fundir num MRR só a mensalidade assinada e a que só existe no cadastro;
 *  · arbitrar um ticket médio quando não existe pagante, e projetar receita em cima dele;
 *  · projetar receita de novos parceiros sem projetar o custo de material deles;
 *  · precificar uma compra pelo preço de hoje em vez do que vigia na data;
 *  · somar a receita ESTIMADA do app dentro da cascata do mês.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  monthOf,
  monthlySeries,
  projectRevenue,
  summarizeMonth,
  summarizePlanMix,
  type DatedConsumption,
  type PartnerMixRow,
} from '@/lib/finance/overview'
import type { FixedCostRecord } from '@/lib/finance/structure'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const MONTH = '2026-08'

function line(over: Partial<DatedConsumption> = {}): DatedConsumption {
  return {
    quantity: over.quantity ?? 10,
    unitCostCents: over.unitCostCents === undefined ? 415 : over.unitCostCents,
    componentCostCents: over.componentCostCents ?? 0,
    standardCostCents: over.standardCostCents ?? 0,
    currency: over.currency ?? 'BRL',
    reason: over.reason ?? 'first_delivery',
    consumedAt: over.consumedAt ?? '2026-08-14T10:00:00Z',
  }
}

function fixed(over: Partial<FixedCostRecord> = {}): FixedCostRecord {
  return {
    id: over.id ?? 'fc-1',
    label: over.label ?? 'Supabase Pro',
    kind: over.kind ?? 'recurring',
    amountCents: over.amountCents ?? 135_000,
    currency: over.currency ?? 'BRL',
    incurredAt: over.incurredAt ?? '2026-01-08',
    periodMonths: over.periodMonths === undefined ? 1 : over.periodMonths,
  }
}

function cascade(over: Partial<Parameters<typeof summarizeMonth>[0]> = {}) {
  return summarizeMonth({
    month: over.month ?? MONTH,
    currency: over.currency ?? 'BRL',
    recurringRevenueCents: over.recurringRevenueCents ?? 44_400,
    consumption: over.consumption ?? [line()],
    costEntries: over.costEntries ?? [],
    fixedCosts: over.fixedCosts ?? [fixed()],
  })
}

// ── O MÊS ─────────────────────────────────────────────────────────────────────────────────────

test('a cascata recorta pelo mês, e o que saiu em outro mês não entra', () => {
  const month = cascade({
    consumption: [
      line({ quantity: 10, unitCostCents: 415 }),
      line({ quantity: 99, unitCostCents: 415, consumedAt: '2026-07-30T10:00:00Z' }),
    ],
  })

  assert.equal(month.variableCostCents, 4_150)
  assert.equal(month.deliveries, 1, 'a entrega de julho não é uma entrega de agosto')
})

test('a taxa de impressão fica AO LADO do custo variável, nunca dentro dele', () => {
  const month = cascade({
    consumption: [line({ quantity: 10, unitCostCents: 415, standardCostCents: 6_200 })],
  })

  assert.equal(month.variableCostCents, 4_150, 'a taxa não entra no variável')
  assert.equal(month.standardCostCents, 6_200)
  // O resultado é receita − variável − fixo. Se a taxa entrasse, seria 6.200 mais pobre.
  assert.equal(month.resultCents, 44_400 - 4_150 - 135_000)
})

test('o desembolso de uma vez só entra na leitura e NÃO no resultado do mês', () => {
  const month = cascade({
    fixedCosts: [fixed(), fixed({ id: 'fc-2', kind: 'one_off', amountCents: 300_000, periodMonths: null, incurredAt: '2026-08-14' })],
  })

  assert.equal(month.oneOffCents, 300_000, 'ele é lido')
  assert.equal(month.fixedMonthlyCents, 135_000, 'e não vira conta mensal')
  assert.equal(
    month.resultCents,
    44_400 - 4_150 - 135_000,
    'uma impressora comprada uma vez não fecha o mês'
  )
})

test('a assinatura que ainda não começou não custa nada no mês anterior a ela', () => {
  const month = cascade({ fixedCosts: [fixed({ incurredAt: '2026-10-01' })] })
  assert.equal(month.fixedMonthlyCents, 0)
})

test('a conta trimestral entra como um terço dela', () => {
  const month = cascade({ fixedCosts: [fixed({ amountCents: 90_000, periodMonths: 3 })] })
  assert.equal(month.fixedMonthlyCents, 30_000)
})

test('a linha sem preço vira pendência, e nunca soma zero', () => {
  const month = cascade({
    consumption: [line({ unitCostCents: null }), line({ quantity: 10, unitCostCents: 415 })],
  })

  assert.equal(month.unpricedLines, 1)
  assert.equal(month.variableCostCents, 4_150, 'a linha sem preço não vira custo zero')
  assert.equal(month.deliveries, 2, 'mas ela aconteceu, e é contada como entrega')
})

test('o avulso do mês entra no variável, e o de outro mês não', () => {
  const month = cascade({
    consumption: [],
    costEntries: [
      { amountCents: 12_000, currency: 'BRL', incurredAt: '2026-08-03' },
      { amountCents: 99_000, currency: 'BRL', incurredAt: '2026-03-03' },
    ],
  })

  assert.equal(month.variableCostCents, 12_000)
})

test('moeda diferente volta nomeada em vez de somada', () => {
  const month = cascade({
    consumption: [line(), line({ currency: 'EUR', quantity: 1_000, unitCostCents: 1_000 })],
    fixedCosts: [fixed(), fixed({ id: 'fc-eur', currency: 'EUR', amountCents: 999_999 })],
  })

  assert.equal(month.variableCostCents, 4_150)
  assert.equal(month.fixedMonthlyCents, 135_000)
  assert.deepEqual(month.ignoredCurrencies, ['EUR'])
})

test('`monthOf` devolve `null` em vez de inventar um mês', () => {
  assert.equal(monthOf('2026-08-14T10:00:00Z'), '2026-08')
  assert.equal(monthOf(null), null)
  assert.equal(monthOf(''), null)
  assert.equal(monthOf('ontem'), null)
})

// ── A BASE ────────────────────────────────────────────────────────────────────────────────────

function mixRow(over: Partial<PartnerMixRow> = {}): PartnerMixRow {
  return {
    currency: over.currency ?? 'BRL',
    planKind: over.planKind ?? 'paid',
    monthlyFeeCents: over.monthlyFeeCents === undefined ? 14_800 : over.monthlyFeeCents,
    contractStatus: over.contractStatus === undefined ? 'signed' : over.contractStatus,
    billingStartsAt:
      over.billingStartsAt === undefined ? '2026-06-01' : over.billingStartsAt,
    billingStartSource:
      over.billingStartSource === undefined ? 'publication' : over.billingStartSource,
  }
}

test('o contrato encerrado sai de TODAS as faixas — quem saiu não é pagante que parou', () => {
  const mix = summarizePlanMix([
    mixRow(),
    mixRow({ contractStatus: 'terminated' }),
    mixRow({ planKind: 'courtesy', contractStatus: 'terminated' }),
  ])

  assert.equal(mix.terminated, 2)
  assert.equal(mix.paying, 1)
  assert.equal(mix.courtesy, 0)
  assert.equal(mix.committedMrrCents, 14_800, 'a mensalidade do encerrado não conta')
})

test('o MRR nasce partido: o que foi assinado e o que só existe no cadastro', () => {
  const mix = summarizePlanMix([
    mixRow({ monthlyFeeCents: 14_800, contractStatus: 'signed' }),
    mixRow({ monthlyFeeCents: 10_000, contractStatus: 'sent' }),
    mixRow({ monthlyFeeCents: 20_000, contractStatus: null }),
  ])

  assert.equal(mix.committedMrrCents, 14_800)
  assert.equal(mix.uncommittedMrrCents, 30_000)
  assert.equal(mix.paying, 3, 'os três pagam; só um assinou')
})

test('sem pagante não há mensalidade média — `null`, e nunca zero', () => {
  const mix = summarizePlanMix([mixRow({ planKind: 'free', monthlyFeeCents: null })])
  assert.equal(mix.averageFeeCents, null)
  assert.equal(mix.paying, 0)
  assert.equal(mix.free, 1)
})

test('a proposta que ninguém precificou cai em "sem plano declarado"', () => {
  const mix = summarizePlanMix([
    mixRow({ planKind: 'requested', monthlyFeeCents: null, contractStatus: null }),
    mixRow({ planKind: 'undeclared', monthlyFeeCents: null, contractStatus: null }),
  ])

  assert.equal(mix.undeclared, 2, 'duas faixas para "não sei quanto custa" seriam a mesma faixa')
})

test('mensalidade em outra moeda não entra no MRR nem na média', () => {
  const mix = summarizePlanMix([
    mixRow({ monthlyFeeCents: 14_800 }),
    mixRow({ monthlyFeeCents: 14_800 }),
    mixRow({ currency: 'EUR', monthlyFeeCents: 900_000 }),
  ])

  assert.equal(mix.currency, 'BRL')
  assert.equal(mix.committedMrrCents, 29_600)
  assert.equal(mix.averageFeeCents, 14_800)
  assert.deepEqual(mix.ignoredCurrencies, ['EUR'])
})

// ── A PROJEÇÃO ────────────────────────────────────────────────────────────────────────────────

/** Sete meses de mensalidade contratada: o vigente e os seis seguintes. */
const CALENDARIO = {
  '2026-09': 44_400,
  '2026-10': 44_400,
  '2026-11': 44_400,
  '2026-12': 44_400,
  '2027-01': 44_400,
  '2027-02': 44_400,
  '2027-03': 44_400,
}

function project(over: Partial<Parameters<typeof projectRevenue>[0]> = {}) {
  return projectRevenue({
    from: over.from ?? '2026-09',
    months: over.months,
    currency: over.currency ?? 'BRL',
    committedByMonth: over.committedByMonth ?? CALENDARIO,
    averageFeeCents: over.averageFeeCents === undefined ? 14_800 : over.averageFeeCents,
    fixedMonthlyCents: over.fixedMonthlyCents ?? 251_600,
    kitCostCents: over.kitCostCents ?? 3_700,
    premise: over.premise ?? { newPayingPerMonth: 4, churnRate: 0.02 },
  })
}

test('o MÊS VIGENTE é exato: nenhuma premissa consegue mexer nele', () => {
  const projection = project({ premise: { newPayingPerMonth: 40, churnRate: 0 } })

  assert.equal(projection.months[0].premiseCents, 0, 'quem fecha hoje só vence no dia 20 do mês que vem')
  assert.equal(projection.months[0].exact, true)
  assert.equal(projection.months[0].totalCents, 44_400, 'é o calendário assinado, e nada mais')
  assert.equal(projection.months[1].exact, false, 'do segundo em diante a premissa entra')
})

test('a janela é o vigente mais seis', () => {
  assert.equal(project().months.length, 7)
})

test('a linha firme é o CALENDÁRIO e sobe em degraus — não é um MRR repetido', () => {
  const projection = project({
    committedByMonth: { '2026-09': 0, '2026-10': 14_800, '2026-11': 29_600 },
    months: 3,
    premise: { newPayingPerMonth: 0, churnRate: 0 },
  })

  assert.deepEqual(
    projection.months.map((row) => row.committedCents),
    [0, 14_800, 29_600],
    'um parceiro publicado este mês entra no calendário só no próximo'
  )
})

test('sem pagante não há ticket, e a premissa não produz nada', () => {
  const projection = project({ averageFeeCents: null })

  assert.equal(projection.premiseInert, true)
  for (const row of projection.months) {
    assert.equal(row.premiseCents, 0, 'arbitrar um ticket seria projetar sobre um preço não pago')
    assert.equal(row.totalCents, row.committedCents, 'sobra o calendário, que é fato')
  }
})

test('o churn come SÓ a camada de premissa — a linha firme é o que está assinado', () => {
  const semChurn = project({ premise: { newPayingPerMonth: 4, churnRate: 0 } })
  const comChurn = project({ premise: { newPayingPerMonth: 4, churnRate: 0.5 } })

  for (let index = 0; index < semChurn.months.length; index += 1) {
    assert.equal(
      comChurn.months[index].committedCents,
      semChurn.months[index].committedCents,
      'um palpite por cima do calendário apagaria a diferença entre o que existe e o que se espera'
    )
  }
  assert.ok(
    comChurn.months[6].premiseCents < semChurn.months[6].premiseCents,
    'e come a camada de palpite, essa sim'
  )
})

test('o custo da janela inclui o kit dos parceiros novos', () => {
  const semNovos = project({ premise: { newPayingPerMonth: 0, churnRate: 0 } })
  const comNovos = project({ premise: { newPayingPerMonth: 4, churnRate: 0 } })

  assert.equal(semNovos.months[0].costCents, 251_600)
  assert.equal(
    comNovos.months[0].costCents,
    251_600 + 4 * 3_700,
    'trazer parceiro custa material, e a projeção não pode somar só a receita disso'
  )
})

test('o cruzamento é o PRIMEIRO mês coberto, e `null` quando não cruza na janela', () => {
  const cruza = project({ premise: { newPayingPerMonth: 6, churnRate: 0 } })
  assert.ok(cruza.breakEvenMonth !== null)
  assert.equal(cruza.breakEvenMonth, cruza.months.find((row) => row.covered)?.month)

  const naoCruza = project({ premise: { newPayingPerMonth: 0, churnRate: 0 } })
  assert.equal(naoCruza.breakEvenMonth, null, 'o calendário sozinho não cobre a estrutura')
})

test('a janela vira o ano sem passar por dezembro duas vezes', () => {
  const projection = project({ from: '2026-11', months: 3 })
  assert.deepEqual(
    projection.months.map((row) => row.month),
    ['2026-11', '2026-12', '2027-01']
  )
})

test('a premissa volta na saída, normalizada, para a tela imprimi-la ao lado do número', () => {
  const projection = project({ premise: { newPayingPerMonth: 4.6, churnRate: 2 } })
  assert.equal(projection.premise.newPayingPerMonth, 5, 'meio parceiro não entra')
  assert.equal(projection.premise.churnRate, 1, 'churn é fração, e 200% não existe')
})

// ── AS INVARIANTES DE SUPERFÍCIE ──────────────────────────────────────────────────────────────

test('a receita do APP não entra na cascata do mês, e é camada própria na série', () => {
  // A CASCATA É SÓ DO PARCEIRO. A rota conhece o app — a série precisa dele — mas o que alimenta
  // `summarizeMonth` é o calendário de faturas, e nada mais. Mensalidade assinada com vencimento
  // no dia 20 e cobrança de loja num ciclo dela são fatos de naturezas diferentes; um total que
  // os fundisse não seria explicável por nenhuma das duas operações.
  const route = code('app/api/finance/clients/route.ts')
  const cascade = route.slice(route.indexOf('const month = summarizeMonth('))
  const call = cascade.slice(0, cascade.indexOf('})'))

  assert.ok(/monthInvoices\[currentMonth\]/.test(call), 'a receita do mês é a fatura do mês')
  assert.ok(!/app/.test(call), 'e o app não entra nela')

  const overview = code('lib/finance/overview.ts')
  // O recorte para em `MonthlyPoint`: dali em diante começa `monthlySeries`, que POR DESENHO
  // carrega a camada do app. Quem não pode conhecê-la é a cascata.
  const summarize = overview.slice(
    overview.indexOf('export function summarizeMonth'),
    overview.indexOf('export interface MonthlyPoint')
  )
  assert.ok(!/appRevenue|revenuecat/i.test(summarize), 'a cascata pura também não o conhece')
})

test('a cascata do mês não conhece `client_id` de custo fixo — ele não se rateia', () => {
  const overview = code('lib/finance/overview.ts')
  assert.ok(!/client_?[Ii]d/.test(overview), 'custo fixo cobre contra a soma das margens, não por cliente')
})

test('o módulo puro não conhece Supabase, fetch nem React', () => {
  const source = read('lib/finance/overview.ts')
  assert.ok(!/from '@supabase|getSupabase|createClient/.test(source))
  assert.ok(!/\bfetch\(/.test(source))
  assert.ok(!/from 'react'|useState|useEffect/.test(source))
})

test('as duas tabelas novas nascem sem `delete`, e a exclusão se desfaz por escrita', () => {
  const migration = read('supabase/migrations/20260902_01_finance_overview.sql')

  // AS INSTRUÇÕES, NÃO A PROSA. Os comentários desta migration explicam por que `delete` está
  // fora dela, e um regex sobre o arquivo inteiro casa com a própria explicação — foi o que
  // aconteceu na primeira versão deste teste, que passou a acusar o texto que a defende.
  const grants = migration
    .split('\n')
    .filter((row) => /^\s*grant\s/i.test(row))
    .map((row) => row.toLowerCase())

  assert.ok(grants.length >= 2, 'a migration concede acesso às duas tabelas')
  for (const grant of grants) {
    assert.ok(
      !/\bdelete\b/.test(grant),
      `preço é histórico e exclusão se desfaz por escrita — nenhum delete: ${grant.trim()}`
    )
  }
  assert.ok(/removed_at/.test(migration), 'e é `removed_at` que desfaz a marca')
})
