/**
 * O valor que o operador digita, virando centavos.
 *
 * Mutations that turn this suite red:
 *  · ler `1.000` como um real — o defeito de 2026-09-01, que aceitava R$ 0,01 em silêncio;
 *  · devolver NaN (que vira `null` no JSON e 400 na rota) para um valor brasileiro válido;
 *  · arredondar mais de duas casas em vez de recusar;
 *  · aceitar texto que não é número.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseMoneyToCents } from '@/lib/finance/money'

test('o teclado brasileiro', () => {
  assert.equal(parseMoneyToCents('1.000,00'), 100_000, 'o que quebrava com 400')
  assert.equal(parseMoneyToCents('1.000'), 100_000, 'o que virava R$ 0,01 em silêncio')
  assert.equal(parseMoneyToCents('1000,00'), 100_000)
  assert.equal(parseMoneyToCents('38,00'), 3_800)
  assert.equal(parseMoneyToCents('0,10'), 10)
  assert.equal(parseMoneyToCents('1.234.567,89'), 123_456_789)
})

test('o teclado americano, que também aparece em copiar e colar', () => {
  assert.equal(parseMoneyToCents('1000.00'), 100_000)
  assert.equal(parseMoneyToCents('1,000.00'), 100_000)
  assert.equal(parseMoneyToCents('0.10'), 10)
  assert.equal(parseMoneyToCents('1.5'), 150, 'uma casa é decimal, não milhar')
})

test('inteiro sem separador nenhum', () => {
  assert.equal(parseMoneyToCents('1000'), 100_000)
  assert.equal(parseMoneyToCents('38'), 3_800)
  assert.equal(parseMoneyToCents('0'), 0)
})

test('símbolo e espaço de copiar e colar não atrapalham', () => {
  assert.equal(parseMoneyToCents('R$ 1.000,00'), 100_000)
  assert.equal(parseMoneyToCents(' 38,00 '), 3_800)
  assert.equal(parseMoneyToCents('R$\u00a01.000,00'), 100_000, 'espaço não separável')
})

test('o que não é valor devolve `null`, e nunca um número inventado', () => {
  for (const bad of ['', '   ', 'abc', '1,2,3.4.5x', 'R$', '--10', '1,005']) {
    assert.equal(parseMoneyToCents(bad), null, `"${bad}" tem de ser recusado`)
  }
})

test('mais de duas casas é recusado, não arredondado', () => {
  assert.equal(parseMoneyToCents('1,005'), null)
  assert.equal(parseMoneyToCents('1,00'), 100)
})
