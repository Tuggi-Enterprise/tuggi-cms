/**
 * A receita — quantos QR cada display leva, quem manda quando o padrão e o ajuste discordam.
 *
 * Mutations that turn this suite red:
 *  · deixar o padrão ganhar do ajuste do pedido, o que torna o ajuste um campo decorativo;
 *  · escolher o padrão pelo último cadastrado em vez do vigente na data do consumo;
 *  · tratar um ajuste de zero como ausência de ajuste — são dois fatos diferentes;
 *  · perder um componente que só o ajuste nomeia;
 *  · devolver a lista numa ordem que muda entre duas leituras dos mesmos dados;
 *  · deixar um componente de quantidade zero entrar no snapshot como linha de custo.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  resolveRecipe,
  type OrderRecipeOverride,
  type RecipeLine,
} from '@/lib/finance/recipe'

const RECIPES: RecipeLine[] = [
  {
    parentProductId: 'display_mesa',
    componentProductId: 'qr_code',
    quantity: 2,
    effectiveFrom: '2026-01-01',
  },
  {
    parentProductId: 'display_mesa',
    componentProductId: 'qr_code',
    quantity: 3,
    effectiveFrom: '2026-09-01',
  },
]

test('sem ajuste, o padrão vigente responde', () => {
  const resolved = resolveRecipe(RECIPES, [], 'order-1', 'display_mesa', '2026-08-20')

  assert.deepEqual(resolved, [
    { componentProductId: 'qr_code', quantity: 2, source: 'recipe' },
  ])
})

test('a vigência escolhe pela data, e não pelo último cadastrado', () => {
  const before = resolveRecipe(RECIPES, [], 'order-1', 'display_mesa', '2026-08-31')
  const after = resolveRecipe(RECIPES, [], 'order-1', 'display_mesa', '2026-09-01')

  assert.equal(before[0].quantity, 2, 'o pedido de agosto continua valendo 2 — o backfill depende disto')
  assert.equal(after[0].quantity, 3)
})

test('o ajuste do pedido ganha do padrão, e diz que foi ajuste', () => {
  const overrides: OrderRecipeOverride[] = [
    {
      orderId: 'order-1',
      parentProductId: 'display_mesa',
      componentProductId: 'qr_code',
      quantity: 5,
    },
  ]

  const resolved = resolveRecipe(RECIPES, overrides, 'order-1', 'display_mesa', '2026-08-20')

  assert.deepEqual(resolved, [
    { componentProductId: 'qr_code', quantity: 5, source: 'override' },
  ])
})

test('o ajuste vale só para o pedido dele', () => {
  const overrides: OrderRecipeOverride[] = [
    { orderId: 'order-1', parentProductId: 'display_mesa', componentProductId: 'qr_code', quantity: 5 },
  ]

  const other = resolveRecipe(RECIPES, overrides, 'order-2', 'display_mesa', '2026-08-20')

  assert.equal(other[0].quantity, 2)
  assert.equal(other[0].source, 'recipe')
})

test('ajuste zero é resposta: este lote saiu sem componente', () => {
  const overrides: OrderRecipeOverride[] = [
    { orderId: 'order-1', parentProductId: 'display_mesa', componentProductId: 'qr_code', quantity: 0 },
  ]

  assert.deepEqual(
    resolveRecipe(RECIPES, overrides, 'order-1', 'display_mesa', '2026-08-20'),
    [],
    'zero remove o componente; ausência de ajuste teria devolvido 2'
  )
})

test('um componente que só o ajuste nomeia não se perde', () => {
  const overrides: OrderRecipeOverride[] = [
    { orderId: 'order-1', parentProductId: 'display_mesa', componentProductId: 'adesivo', quantity: 1 },
  ]

  const resolved = resolveRecipe(RECIPES, overrides, 'order-1', 'display_mesa', '2026-08-20')

  assert.deepEqual(resolved, [
    { componentProductId: 'adesivo', quantity: 1, source: 'override' },
    { componentProductId: 'qr_code', quantity: 2, source: 'recipe' },
  ])
})

test('a ordem é estável entre duas leituras dos mesmos dados', () => {
  const overrides: OrderRecipeOverride[] = [
    { orderId: 'order-1', parentProductId: 'display_mesa', componentProductId: 'zeta', quantity: 1 },
    { orderId: 'order-1', parentProductId: 'display_mesa', componentProductId: 'alfa', quantity: 1 },
  ]

  const first = resolveRecipe(RECIPES, overrides, 'order-1', 'display_mesa', '2026-08-20')
  const second = resolveRecipe(RECIPES, [...overrides].reverse(), 'order-1', 'display_mesa', '2026-08-20')

  assert.deepEqual(
    first.map((line) => line.componentProductId),
    ['alfa', 'qr_code', 'zeta']
  )
  assert.deepEqual(first, second)
})

test('uma receita que ainda não começou não vale', () => {
  const future: RecipeLine[] = [
    { parentProductId: 'display_balcao', componentProductId: 'qr_code', quantity: 4, effectiveFrom: '2026-12-01' },
  ]

  assert.deepEqual(resolveRecipe(future, [], 'order-1', 'display_balcao', '2026-09-01'), [])
})
