/**
 * O custo por peça — a compra que carrega o próprio rendimento, e o que acontece sem compra.
 *
 * Mutations that turn this suite red:
 *  · devolver o rendimento ao PRODUTO — foi assim que 300 adesivos digitados viraram 45.000
 *    etiquetas e a etiqueta ficou 150x barata (2026-09-01). Ele é fato da COMPRA;
 *  · devolver zero em vez de `null` quando não existe compra — ausente NÃO é zero;
 *  · arredondar o custo por peça antes de multiplicá-lo pela quantidade;
 *  · deixar o frete de fora do custo, ou contá-lo por peça em vez de por compra;
 *  · somar duas moedas num total só, ou ignorar uma sem dizer que ignorou;
 *  · custear com uma compra futura;
 *  · uma segunda cópia do vocabulário `MATERIAL_KINDS` dentro de `lib/finance`;
 *  · escolher a taxa padrão pela última cadastrada em vez da vigente na data.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { MATERIAL_KINDS } from '@/lib/partner-form/fields'
import {
  piecesFrom,
  productForMaterialKind,
  unmappedMaterialKinds,
  type FinanceProduct,
} from '@/lib/finance/catalog'
import { standardRateFor, unitCost, type FinancePurchase } from '@/lib/finance/unit-cost'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

/** The source without its comments — a ruler that reads prose measures the prose. */
function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

function product(over: Partial<FinanceProduct> = {}): FinanceProduct {
  return {
    id: over.id ?? 'display_mesa',
    name: over.name ?? 'Display de mesa',
    role: over.role ?? 'deliverable',
    materialKind: over.materialKind === undefined ? 'table_display' : over.materialKind,
    purchaseUnit: over.purchaseUnit ?? 'unidade',
    isActive: over.isActive ?? true,
  }
}

/**
 * `pieces` é coluna GERADA no banco (`units × units_yield`), então o fixture a calcula em vez de
 * aceitá-la solta: um teste que passasse peças incoerentes com as unidades estaria provando uma
 * combinação que o banco nunca produz.
 */
function purchase(over: Partial<FinancePurchase> = {}): FinancePurchase {
  const units = over.units ?? 100
  const unitsYield = over.unitsYield ?? 1
  return {
    id: over.id ?? 'p1',
    productId: over.productId ?? 'display_mesa',
    units,
    unitsYield,
    pieces: units * unitsYield,
    totalCents: over.totalCents ?? 50_000,
    freightCents: over.freightCents ?? 0,
    currency: over.currency ?? 'BRL',
    purchasedAt: over.purchasedAt ?? '2026-08-01',
  }
}

const qrCode = product({
  id: 'qr_code',
  name: 'QR code',
  role: 'component',
  materialKind: null,
  purchaseUnit: 'rolo',
})

test('o rolo rende etiquetas, e o rendimento vem da COMPRA', () => {
  // Um rolo de R$ 38,00 que traz 150 etiquetas: 25,33 centavos cada, e não R$ 38,00 cada.
  const cost = unitCost(
    [purchase({ productId: 'qr_code', units: 1, unitsYield: 150, totalCents: 3_800 })],
    qrCode,
    '2026-09-01'
  )

  assert.ok(cost)
  assert.equal(cost.pieces, 150)
  assert.ok(cost.centsExact > 25.33 && cost.centsExact < 25.34)
  assert.equal(cost.currency, 'BRL')
})

test('o produto não carrega rendimento nenhum — foi ele que quebrou em 2026-09-01', () => {
  // O rendimento morava no PRODUTO, e o formulário da compra pedia "unidades". Os dois números
  // eram o mesmo 150 em dois lugares distantes, e 300 adesivos digitados viraram 45.000.
  // Hoje o produto não tem onde guardar isso, e o tipo é quem garante.
  assert.deepEqual(
    Object.keys(product()).sort(),
    ['id', 'isActive', 'materialKind', 'name', 'purchaseUnit', 'role'],
    'um campo de rendimento de volta no produto é o defeito voltando'
  )

  const cost = unitCost(
    [purchase({ productId: 'qr_code', units: 2, unitsYield: 150, totalCents: 7_800 })],
    qrCode,
    '2026-09-01'
  )

  assert.ok(cost)
  assert.equal(cost.pieces, 300, '2 rolos × 150 = 300 etiquetas, e os dois números vêm da compra')
  assert.equal(cost.centsExact, 26)
})

test('duas compras do mesmo produto viram média ponderada, não média simples', () => {
  // 100 peças a R$ 1,00 e 300 peças a R$ 2,00. Média simples diria 150; a ponderada diz 175.
  const cost = unitCost(
    [
      purchase({ id: 'a', units: 100, totalCents: 10_000 }),
      purchase({ id: 'b', units: 300, totalCents: 60_000, purchasedAt: '2026-08-15' }),
    ],
    product(),
    '2026-09-01'
  )

  assert.ok(cost)
  assert.equal(cost.centsExact, 175)
  assert.equal(cost.purchases, 2)
})

test('o frete entra no custo da compra, e é diluído nas peças dela', () => {
  const cost = unitCost(
    [purchase({ units: 100, totalCents: 10_000, freightCents: 2_000 })],
    product(),
    '2026-09-01'
  )

  assert.ok(cost)
  assert.equal(cost.centsExact, 120)
})

test('sem compra o custo é `null`, e `null` nunca vira zero', () => {
  assert.equal(unitCost([], product(), '2026-09-01'), null)
  assert.equal(
    unitCost([purchase({ productId: 'outro' })], product(), '2026-09-01'),
    null,
    'compra de outro produto não custeia este'
  )
})

test('uma compra futura não custeia o que saiu antes dela', () => {
  const purchases = [purchase({ purchasedAt: '2026-09-10' })]

  assert.equal(unitCost(purchases, product(), '2026-09-01'), null)
  assert.ok(unitCost(purchases, product(), '2026-09-10'), 'a compra do próprio dia custeia')
})

test('a fração de centavo sobrevive: quem arredonda é a linha, não o custo unitário', () => {
  // R$ 50 por 300 etiquetas = 16,666... centavos. Arredondar aqui erraria o total em R$ 1.
  const cost = unitCost(
    [purchase({ productId: 'qr_code', units: 2, unitsYield: 150, totalCents: 5_000 })],
    qrCode,
    '2026-09-01'
  )

  assert.ok(cost)
  assert.ok(cost.centsExact > 16.66 && cost.centsExact < 16.67)
  assert.notEqual(cost.centsExact, 17)
})

test('moedas não se somam: a mais recente manda e as outras voltam nomeadas', () => {
  const cost = unitCost(
    [
      purchase({ id: 'brl', units: 100, totalCents: 10_000, currency: 'BRL', purchasedAt: '2026-07-01' }),
      purchase({ id: 'eur', units: 100, totalCents: 20_000, currency: 'EUR', purchasedAt: '2026-08-01' }),
    ],
    product(),
    '2026-09-01'
  )

  assert.ok(cost)
  assert.equal(cost.currency, 'EUR')
  assert.equal(cost.centsExact, 200, 'a compra em BRL não entrou na conta')
  assert.deepEqual(cost.ignoredCurrencies, ['BRL'], 'e ela é nomeada em vez de silenciada')
})

test('o produto responde pelo tipo da esteira, e o tipo sem produto é apontado', () => {
  const catalog = [product(), qrCode]

  assert.equal(productForMaterialKind(catalog, 'table_display')?.id, 'display_mesa')
  assert.equal(productForMaterialKind(catalog, 'sticker'), null)
  assert.deepEqual(unmappedMaterialKinds(catalog).sort(), ['counter_display', 'sticker'])
  assert.deepEqual(unmappedMaterialKinds([]).slice().sort(), [...MATERIAL_KINDS].sort())
})

test('`piecesFrom` é ajudante de formulário: dois números, uma multiplicação', () => {
  assert.equal(piecesFrom(2, 150), 300)
  assert.equal(piecesFrom(250, 1), 250)
})

test('a taxa padrão vigente é a da data, não a última cadastrada', () => {
  const rates = [
    { rateId: 'qr_print', appliesTo: 'qr_code', amountCents: 10, currency: 'BRL', effectiveFrom: '2026-01-01' },
    { rateId: 'qr_print', appliesTo: 'qr_code', amountCents: 15, currency: 'BRL', effectiveFrom: '2026-09-01' },
  ]

  assert.equal(standardRateFor(rates, 'qr_code', '2026-08-31')?.amountCents, 10)
  assert.equal(standardRateFor(rates, 'qr_code', '2026-09-01')?.amountCents, 15)
  assert.equal(standardRateFor(rates, 'display_mesa', '2026-09-01'), null)
})

test('`lib/finance` lê `MATERIAL_KINDS` em vez de reescrever os três nomes', () => {
  const catalog = code('lib/finance/catalog.ts')

  assert.ok(
    /import\s*\{[^}]*MATERIAL_KINDS[^}]*\}\s*from\s*'@\/lib\/partner-form\/fields'/.test(catalog),
    'o vocabulário da esteira tem um dono e ele é lib/partner-form/fields.ts'
  )

  for (const file of ['catalog.ts', 'unit-cost.ts', 'recipe.ts', 'consumption.ts']) {
    const source = code(`lib/finance/${file}`)
    assert.ok(
      !/\[\s*'sticker'\s*,\s*'table_display'/.test(source),
      `${file} não pode carregar uma segunda cópia da lista de materiais`
    )
  }
})

test('o custo unitário não lê o rendimento do catálogo em lugar nenhum', () => {
  const source = code('lib/finance/unit-cost.ts')

  assert.ok(
    !/unitsPerPurchaseUnit/.test(source),
    'o rendimento do cadastro apenas sugere no formulário; quem conta é purchase.pieces'
  )
  assert.ok(/purchase\.pieces/.test(source), 'as peças vêm prontas da compra')
})

test('o módulo puro não conhece Supabase, fetch nem React', () => {
  for (const file of [
    'catalog.ts',
    'unit-cost.ts',
    'recipe.ts',
    'consumption.ts',
    'profitability.ts',
    'structure.ts',
    'cohort.ts',
    'summary.ts',
    'money.ts',
    'input.ts',
  ]) {
    const source = code(`lib/finance/${file}`)
    assert.ok(!/getSupabase|createClient|fetch\(/.test(source), `${file} fala com o banco`)
    assert.ok(!/from 'react'/.test(source), `${file} conhece React`)
  }
})
