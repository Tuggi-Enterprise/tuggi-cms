/**
 * O consumo — quando um pedido vira custo, e por quanto.
 *
 * Mutations that turn this suite red:
 *  · fazer `requested` ou `in_preparation` custar dinheiro, ou `cancelled` custar qualquer coisa;
 *  · esquecer que `in_preparation` vai direto a `fulfilled` quando o material sai no balcão;
 *  · somar a taxa padrão dentro do custo unitário, em vez de mantê-la em coluna própria;
 *  · arredondar o custo do componente antes de multiplicá-lo pela quantidade;
 *  · transformar um pedido sem produto no catálogo em custo zero em vez de apontá-lo;
 *  · transformar um produto sem compra em custo zero em vez de deixá-lo sem preço;
 *  · somar o custo direto de uma linha sem preço, o que faria um piso parecer um fato;
 *  · uma segunda cópia da lista de status que consomem, fora de `consumption.ts`;
 *  · custear a quantidade PEDIDA em vez da enviada;
 *  · cair para a quantidade pedida quando o envio não foi informado;
 *  · confundir "enviei zero" com "ninguém informou quanto enviei".
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { MATERIAL_COLUMNS } from '@/lib/materials/order-queue'
import {
  CONSUMING_STATUSES,
  consumesCost,
  lineDirectCostCents,
  planConsumption,
  type ConsumptionInput,
} from '@/lib/finance/consumption'
import type { FinanceProduct } from '@/lib/finance/catalog'
import type { FinancePurchase } from '@/lib/finance/unit-cost'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const DISPLAY: FinanceProduct = {
  id: 'display_mesa',
  name: 'Display de mesa',
  role: 'deliverable',
  materialKind: 'table_display',
  purchaseUnit: 'unidade',
  isActive: true,
}

const QR: FinanceProduct = {
  id: 'qr_code',
  name: 'QR code',
  role: 'component',
  materialKind: null,
  purchaseUnit: 'bobina',
  isActive: true,
}

/** 100 displays por R$ 500 (5,00 cada) e uma bobina de R$ 50 que rendeu 500 (0,10 cada). */
const PURCHASES: FinancePurchase[] = [
  {
    id: 'buy-display',
    productId: 'display_mesa',
    units: 100,
    unitsYield: 1,
    pieces: 100,
    totalCents: 50_000,
    freightCents: 0,
    currency: 'BRL',
    purchasedAt: '2026-08-01',
  },
  {
    id: 'buy-roll',
    productId: 'qr_code',
    // 1 bobina que rendeu 500 etiquetas. O rendimento vive NA COMPRA desde 2026-09-01: o que
    // estiver cadastrado no produto não muda esta conta.
    units: 1,
    unitsYield: 500,
    pieces: 500,
    totalCents: 5_000,
    freightCents: 0,
    currency: 'BRL',
    purchasedAt: '2026-08-01',
  },
]

/** O produto que responde por cada tipo da esteira nas fixtures deste arquivo. */
const KIND_TO_PRODUCT: Record<string, string> = {
  table_display: 'display_mesa',
  counter_display: 'display_balcao',
  sticker: 'adesivo',
}

function input(over: Partial<ConsumptionInput> = {}): ConsumptionInput {
  return {
    orderId: over.orderId ?? 'order-1',
    items: over.items ?? [{ kind: 'table_display', quantity: 30 }],
    products: over.products ?? [DISPLAY, QR],
    purchases: over.purchases ?? PURCHASES,
    recipes: over.recipes ?? [
      {
        parentProductId: 'display_mesa',
        componentProductId: 'qr_code',
        quantity: 2,
        effectiveFrom: '2026-01-01',
      },
    ],
    overrides: over.overrides ?? [],
    // Sem embalagem por padrão: esta suíte prova o custo das PEÇAS. A embalagem tem a sua.
    packaging: over.packaging ?? [],
    // O padrão do fixture é "saiu tudo que foi pedido", para os casos que testam OUTRA coisa.
    // Os testes de envio passam o seu próprio.
    shipments:
      over.shipments ??
      (over.items ?? [{ kind: 'table_display' as const, quantity: 30 }]).map((item) => ({
        orderId: over.orderId ?? 'order-1',
        productId: KIND_TO_PRODUCT[item.kind],
        quantity: item.quantity,
      })),
    rates: over.rates ?? [],
    at: over.at ?? '2026-08-26',
    reason: over.reason,
  }
}

test('só `dispatched` e `fulfilled` consomem — a peça foi produzida nesses dois', () => {
  assert.deepEqual([...CONSUMING_STATUSES], ['dispatched', 'fulfilled'])

  const consuming = MATERIAL_COLUMNS.filter((status) => consumesCost(status))
  assert.deepEqual(consuming, ['dispatched', 'fulfilled'])

  assert.equal(consumesCost('requested'), false)
  assert.equal(consumesCost('in_preparation'), false, 'ainda vamos imprimir')
  assert.equal(consumesCost('cancelled'), false, 'cancelado nunca foi impresso')
})

test('a lista de status que consomem existe uma vez só', () => {
  const source = code('lib/finance/consumption.ts')
  const occurrences = source.match(/'dispatched'/g) ?? []

  assert.equal(
    occurrences.length,
    1,
    'a palavra aparece na constante e em nenhum outro lugar do módulo'
  )
})

test('o display carrega o QR: 30 peças, R$ 5,00 cada, mais 2 etiquetas de R$ 0,10', () => {
  const plan = planConsumption(input())

  assert.equal(plan.lines.length, 1)
  const [line] = plan.lines

  assert.equal(line.productId, 'display_mesa')
  assert.equal(line.quantity, 30)
  assert.equal(line.unitCostCents, 500)
  assert.equal(line.componentCostCents, 600, '2 × 10 centavos × 30 peças')
  assert.equal(line.currency, 'BRL')
  assert.equal(lineDirectCostCents(line), 15_600, 'R$ 156,00')

  assert.deepEqual(line.components, [
    {
      productId: 'qr_code',
      quantityPerUnit: 2,
      unitCostCents: 10,
      currency: 'BRL',
      source: 'recipe',
    },
  ])
})

test('arredonda uma vez, no fim: a fração de centavo do QR não se perde antes da multiplicação', () => {
  // Bobina de R$ 50 que rendeu 300 etiquetas: 16,666… centavos. Dois QR por display, 30 displays.
  // A conta exata dá R$ 10,00; arredondar a etiqueta para 17 daria R$ 10,20.
  //
  // O rendimento muda NA COMPRA, e não no produto: é ali que ele vive desde 2026-09-01.
  const plan = planConsumption(
    input({
      purchases: PURCHASES.map((buy) =>
        buy.productId === 'qr_code' ? { ...buy, unitsYield: 300, pieces: 300 } : buy
      ),
    })
  )

  assert.equal(plan.lines[0].componentCostCents, 1_000)
})

test('a taxa padrão viaja em coluna própria e nunca entra no custo unitário', () => {
  const plan = planConsumption(
    input({
      rates: [
        {
          rateId: 'qr_print',
          appliesTo: 'qr_code',
          amountCents: 10,
          currency: 'BRL',
          effectiveFrom: '2026-01-01',
        },
      ],
    })
  )

  const [line] = plan.lines
  assert.equal(line.unitCostCents, 500, 'o unitário é o da compra, sem a taxa')
  assert.equal(line.componentCostCents, 600, 'o componente é o da compra, sem a taxa')
  assert.equal(line.standardCostCents, 600, '10 centavos × 2 QR × 30 peças')
  assert.equal(lineDirectCostCents(line), 15_600, 'o custo direto ignora a taxa')
})

test('um tipo sem produto no catálogo é apontado, não vira custo zero', () => {
  const plan = planConsumption(
    input({ items: [{ kind: 'sticker', quantity: 10 }] })
  )

  assert.deepEqual(plan.lines, [])
  assert.deepEqual(plan.skipped, ['sticker'])
})

test('um produto sem compra fica sem preço, e a linha diz isso em vez de somar zero', () => {
  const plan = planConsumption(input({ purchases: [] }))

  const [line] = plan.lines
  assert.equal(line.unitCostCents, null)
  assert.equal(line.componentCostCents, 0)
  assert.equal(lineDirectCostCents(line), null, 'não há custo direto para somar')
  assert.deepEqual(plan.unpriced.slice().sort(), ['display_mesa', 'qr_code'])
})

test('o ajuste do pedido chega ao custo, e o snapshot registra que foi ajuste', () => {
  const plan = planConsumption(
    input({
      overrides: [
        {
          orderId: 'order-1',
          parentProductId: 'display_mesa',
          componentProductId: 'qr_code',
          quantity: 3,
        },
      ],
    })
  )

  const [line] = plan.lines
  assert.equal(line.componentCostCents, 900, '3 × 10 centavos × 30 peças')
  assert.equal(line.components[0].source, 'override')
})

test('o custo é o que SAIU, não o que foi pedido', () => {
  // O parceiro pediu 40 displays; saíram 25. R$ 4,00 cada, com 2 QR de R$ 0,10 por display.
  const plan = planConsumption(
    input({
      items: [{ kind: 'table_display', quantity: 40 }],
      shipments: [{ orderId: 'order-1', productId: 'display_mesa', quantity: 25 }],
    })
  )

  const [line] = plan.lines
  assert.equal(line.quantity, 25, 'nunca 40')
  assert.equal(line.componentCostCents, 500, '2 × 10 centavos × 25 peças — não × 40')
  assert.equal(lineDirectCostCents(line), 13_000, 'R$ 130,00, e não os R$ 208,00 do pedido')
  assert.deepEqual(plan.awaitingShipment, [])
})

test('sem envio informado não há custo nenhum, e o pedido vira pendência', () => {
  const plan = planConsumption(
    input({ items: [{ kind: 'table_display', quantity: 40 }], shipments: [] })
  )

  assert.deepEqual(plan.lines, [], 'nada é lançado sobre uma suposição')
  assert.deepEqual(plan.awaitingShipment, ['display_mesa'])
})

test('o envio de OUTRO pedido não custeia este', () => {
  const plan = planConsumption(
    input({
      items: [{ kind: 'table_display', quantity: 40 }],
      shipments: [{ orderId: 'order-2', productId: 'display_mesa', quantity: 25 }],
    })
  )

  assert.deepEqual(plan.lines, [])
  assert.deepEqual(plan.awaitingShipment, ['display_mesa'])
})

test('"enviei zero" não é "ninguém informou": um não custa nada, o outro fica pendente', () => {
  const informedZero = planConsumption(
    input({
      items: [{ kind: 'table_display', quantity: 40 }],
      shipments: [{ orderId: 'order-1', productId: 'display_mesa', quantity: 0 }],
    })
  )

  assert.deepEqual(informedZero.lines, [], 'não há peça para custear')
  assert.deepEqual(
    informedZero.awaitingShipment,
    [],
    'e não há pendência: a pergunta já foi respondida'
  )
})

test('enviar MAIS do que foi pedido é custeado como enviado', () => {
  // A esteira não impede uma reposição saindo no mesmo pedido, e o dinheiro saiu de verdade.
  const plan = planConsumption(
    input({
      items: [{ kind: 'table_display', quantity: 10 }],
      shipments: [{ orderId: 'order-1', productId: 'display_mesa', quantity: 12 }],
    })
  )

  assert.equal(plan.lines[0].quantity, 12)
})

test('quantidade zero ou negativa não vira linha', () => {
  const plan = planConsumption(
    input({ items: [{ kind: 'table_display', quantity: 0 }] })
  )

  assert.deepEqual(plan.lines, [])
})

test('o motivo do pedido sobrevive, e o padrão é a primeira entrega', () => {
  assert.equal(planConsumption(input()).lines[0].reason, 'first_delivery')
  assert.equal(
    planConsumption(input({ reason: 'replacement' })).lines[0].reason,
    'replacement',
    'reposição é custo de retrabalho e precisa continuar distinguível'
  )
})
