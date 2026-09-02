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
  monthlyAmountCents,
  summarizeStructure,
  type FixedCostRecord,
} from '@/lib/finance/structure'
import { assessClient, type ClientFinanceFacts } from '@/lib/finance/profitability'

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
}

const SUBSCRIPTION: FixedCostRecord = {
  id: 'sub',
  label: 'Assinatura da ferramenta',
  kind: 'recurring',
  amountCents: 30_000,
  currency: 'BRL',
  incurredAt: '2026-02-01',
  periodMonths: 1,
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
