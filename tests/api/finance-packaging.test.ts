/**
 * A embalagem — o custo do ENVIO, que sobe em degrau.
 *
 * *"sempre terá pelo menos 1 envelope, com limite de 50 itens. 51 itens, 2 envelopes."*
 * (operador, 2026-09-01)
 *
 * Mutations that turn this suite red:
 *  · tratar a embalagem como receita, cobrando 1/50 de envelope por display — um número que não
 *    existe no mundo, num estoque que nunca fecharia com o que há na gaveta;
 *  · arredondar para baixo, e mandar 51 itens em 1 envelope;
 *  · cobrar embalagem de um pedido que não enviou nada;
 *  · contar componentes na lotação — o QR viaja colado no display, não solto no envelope;
 *  · calcular a embalagem com o pedido pela metade informado, congelando um número que a chegada
 *    do resto não conseguiria mais corrigir;
 *  · escolher a capacidade pela última cadastrada em vez da vigente na data.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { currentPackaging, packagesFor, type PackagingRule } from '@/lib/finance/packaging'
import { planConsumption, type ConsumptionInput } from '@/lib/finance/consumption'
import type { FinanceProduct } from '@/lib/finance/catalog'
import type { FinancePurchase } from '@/lib/finance/unit-cost'

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
  purchaseUnit: 'rolo',
  isActive: true,
}

const ENVELOPE: FinanceProduct = {
  id: 'envelope',
  name: 'Envelope',
  role: 'component',
  materialKind: null,
  purchaseUnit: 'unidade',
  isActive: true,
}

/** Display a R$ 4,00; etiqueta a R$ 0,10; envelope a R$ 0,50. */
const PURCHASES: FinancePurchase[] = [
  {
    id: 'b1', productId: 'display_mesa', units: 100, unitsYield: 1, pieces: 100,
    totalCents: 40_000, freightCents: 0, currency: 'BRL', purchasedAt: '2026-08-01',
  },
  {
    id: 'b2', productId: 'qr_code', units: 1, unitsYield: 500, pieces: 500,
    totalCents: 5_000, freightCents: 0, currency: 'BRL', purchasedAt: '2026-08-01',
  },
  {
    id: 'b3', productId: 'envelope', units: 100, unitsYield: 1, pieces: 100,
    totalCents: 5_000, freightCents: 0, currency: 'BRL', purchasedAt: '2026-08-01',
  },
]

const ENVELOPE_RULE: PackagingRule[] = [
  { productId: 'envelope', capacity: 50, effectiveFrom: '2026-01-01' },
]

function input(over: Partial<ConsumptionInput> = {}): ConsumptionInput {
  const items = over.items ?? [{ kind: 'table_display' as const, quantity: 10 }]
  return {
    orderId: over.orderId ?? 'order-1',
    items,
    products: over.products ?? [DISPLAY, QR, ENVELOPE],
    purchases: over.purchases ?? PURCHASES,
    recipes: over.recipes ?? [
      {
        parentProductId: 'display_mesa',
        componentProductId: 'qr_code',
        quantity: 1,
        effectiveFrom: '2026-01-01',
      },
    ],
    overrides: over.overrides ?? [],
    rates: over.rates ?? [],
    shipments:
      over.shipments ??
      items.map((item) => ({
        orderId: over.orderId ?? 'order-1',
        productId: 'display_mesa',
        quantity: item.quantity,
      })),
    packaging: over.packaging ?? ENVELOPE_RULE,
    at: over.at ?? '2026-09-01',
    reason: over.reason,
  }
}

function envelopeLine(plan: ReturnType<typeof planConsumption>) {
  return plan.lines.find((line) => line.productId === 'envelope') ?? null
}

test('`packagesFor` é o teto, e o "pelo menos 1" sai dele', () => {
  assert.equal(packagesFor(1, 50), 1, 'um item já pede um envelope')
  assert.equal(packagesFor(50, 50), 1, 'cinquenta cabem em um')
  assert.equal(packagesFor(51, 50), 2, 'cinquenta e um pedem dois — a frase do operador')
  assert.equal(packagesFor(100, 50), 2)
  assert.equal(packagesFor(101, 50), 3)
})

test('envio vazio não gasta embalagem, e capacidade inválida não vira infinito', () => {
  assert.equal(packagesFor(0, 50), 0, 'pedido sem saída não gasta envelope')
  assert.equal(packagesFor(-3, 50), 0)
  assert.equal(packagesFor(10, 0), 0, 'nem Infinity, nem NaN')
})

test('10 displays enviados levam 1 envelope, cobrado por inteiro', () => {
  const plan = planConsumption(input())
  const envelope = envelopeLine(plan)

  assert.ok(envelope)
  assert.equal(envelope.quantity, 1, 'um envelope inteiro, e não 10/50 = 0,2')
  assert.equal(envelope.unitCostCents, 50)
  assert.equal(envelope.componentCostCents, 0, 'a caixa não leva componente')
  assert.equal(envelope.standardCostCents, 0, 'nem taxa de impressão')
})

test('51 itens pedem 2 envelopes — a frase do operador, ponta a ponta', () => {
  const plan = planConsumption(
    input({
      items: [{ kind: 'table_display', quantity: 51 }],
      purchases: [
        { ...PURCHASES[0], units: 200, pieces: 200, totalCents: 80_000 },
        PURCHASES[1],
        PURCHASES[2],
      ],
    })
  )

  assert.equal(envelopeLine(plan)?.quantity, 2)
})

test('os componentes não ocupam lugar: o QR viaja colado no display', () => {
  // 50 displays levam 50 QR. Se o QR contasse na lotação seriam 100 itens e 2 envelopes.
  const plan = planConsumption(
    input({
      items: [{ kind: 'table_display', quantity: 50 }],
      purchases: [
        { ...PURCHASES[0], units: 200, pieces: 200, totalCents: 80_000 },
        PURCHASES[1],
        PURCHASES[2],
      ],
    })
  )

  assert.equal(envelopeLine(plan)?.quantity, 1)
})

test('sem regra vigente não existe linha de embalagem', () => {
  assert.equal(envelopeLine(planConsumption(input({ packaging: [] }))), null)

  const future: PackagingRule[] = [
    { productId: 'envelope', capacity: 50, effectiveFrom: '2026-12-01' },
  ]
  assert.equal(envelopeLine(planConsumption(input({ packaging: future }))), null)
})

test('a capacidade é a vigente na data, não a última cadastrada', () => {
  const rules: PackagingRule[] = [
    { productId: 'envelope', capacity: 30, effectiveFrom: '2026-01-01' },
    { productId: 'envelope', capacity: 50, effectiveFrom: '2026-09-01' },
  ]

  assert.equal(currentPackaging(rules, '2026-08-31')[0].capacity, 30)
  assert.equal(currentPackaging(rules, '2026-09-01')[0].capacity, 50)

  // 40 itens: 2 envelopes na capacidade antiga, 1 na nova. O envio de agosto mantém a dele.
  const august = planConsumption(
    input({
      items: [{ kind: 'table_display', quantity: 40 }],
      packaging: rules,
      at: '2026-08-31',
    })
  )
  assert.equal(envelopeLine(august)?.quantity, 2)
})

test('pedido com envio pendente NÃO ganha embalagem — o número sairia de um envio parcial', () => {
  const plan = planConsumption(
    input({
      items: [
        { kind: 'table_display', quantity: 10 },
        { kind: 'counter_display', quantity: 5 },
      ],
      products: [
        DISPLAY,
        { ...DISPLAY, id: 'display_balcao', name: 'Display de balcão', materialKind: 'counter_display' },
        QR,
        ENVELOPE,
      ],
      // só o de mesa foi informado
      shipments: [{ orderId: 'order-1', productId: 'display_mesa', quantity: 10 }],
    })
  )

  assert.deepEqual(plan.awaitingShipment, ['display_balcao'])
  assert.equal(
    envelopeLine(plan),
    null,
    'com metade do pedido informado o envelope ficaria congelado errado, e o unique impediria a correção'
  )
})

test('embalagem sem compra entra sem preço, e a tela conta como pendência', () => {
  const plan = planConsumption(input({ purchases: [PURCHASES[0], PURCHASES[1]] }))
  const envelope = envelopeLine(plan)

  assert.ok(envelope)
  assert.equal(envelope.quantity, 1)
  assert.equal(envelope.unitCostCents, null, 'sem compra não há custo, e zero seria mentira')
  assert.ok(plan.unpriced.includes('envelope'))
})

test('duas embalagens diferentes valem juntas — um envio pode levar envelope e caixa', () => {
  const rules: PackagingRule[] = [
    { productId: 'envelope', capacity: 50, effectiveFrom: '2026-01-01' },
    { productId: 'caixa', capacity: 200, effectiveFrom: '2026-01-01' },
  ]

  assert.deepEqual(
    currentPackaging(rules, '2026-09-01').map((rule) => rule.productId),
    ['caixa', 'envelope'],
    'ordem estável por id, para duas leituras dos mesmos dados darem a mesma lista'
  )
})
