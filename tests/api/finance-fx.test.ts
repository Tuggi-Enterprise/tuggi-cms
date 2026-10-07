/**
 * A TAXA DECLARADA — uma premissa de planejamento, e nunca uma cotação buscada.
 *
 * Mutations that turn this suite red:
 *  · aplicar a taxa de hoje ao custo do mês passado (reescrever o histórico);
 *  · usar a última taxa da lista em vez da última que JÁ COMEÇOU;
 *  · converter sem taxa declarada, por qualquer palpite;
 *  · devolver zero quando falta taxa, em vez de `null`;
 *  · deixar a tabela aceitar `UPDATE`, que é o mesmo que reescrever o passado;
 *  · buscar cotação em rede de dentro do módulo puro.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { BASE_CURRENCY, convertCents, rateOn, type FxRate } from '@/lib/finance/fx'
import { APP_SCHEMA_SKIP, grantsOn, tableDdl } from './setup/app-schema'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

const USD: FxRate = {
  currency: 'USD',
  rateToBrl: 5.2,
  effectiveFrom: '2026-01-01',
  source: 'Media do realizado com as projecoes Focus',
}
const EUR: FxRate = {
  currency: 'EUR',
  rateToBrl: 5.96,
  effectiveFrom: '2026-01-01',
  source: 'Media do realizado com a projecao implicita',
}
const RATES = [USD, EUR]

// ── A VIGÊNCIA ────────────────────────────────────────────────────────────────────────────────

test('vale a MAIOR vigência que já começou, e não a última da lista', () => {
  const revised: FxRate = { ...USD, rateToBrl: 5.4, effectiveFrom: '2027-01-01' }

  assert.equal(rateOn([USD, revised], 'USD', '2026-08-01')?.rateToBrl, 5.2)
  assert.equal(rateOn([USD, revised], 'USD', '2027-03-01')?.rateToBrl, 5.4)
  // A ordem da lista não pode decidir nada: ela chega do banco e pode vir em qualquer ordem.
  assert.equal(rateOn([revised, USD], 'USD', '2026-08-01')?.rateToBrl, 5.2)
})

test('a taxa declarada DEPOIS não reprecifica o mês anterior', () => {
  // É a mesma regra de `pass_prices` e de `standard_rates`. Sem ela, revisar a premissa em
  // janeiro reescreveria o custo de julho, e o relatório de julho passaria a discordar do que
  // já foi lido em julho.
  assert.equal(rateOn([{ ...USD, effectiveFrom: '2026-09-01' }], 'USD', '2026-07-15'), null)
})

test('moeda sem taxa nenhuma responde `null`, nunca um palpite', () => {
  assert.equal(rateOn(RATES, 'GBP', '2026-08-01'), null)
})

// ── A CONVERSÃO ───────────────────────────────────────────────────────────────────────────────

test('a mesma moeda não passa por conversão nenhuma', () => {
  assert.equal(convertCents(12_345, 'BRL', 'BRL', [], '2026-08-01'), 12_345)
  assert.equal(convertCents(12_345, 'USD', 'USD', [], '2026-08-01'), 12_345)
})

test('para reais, multiplica; de reais, divide', () => {
  assert.equal(convertCents(4_099, 'USD', 'BRL', RATES, '2026-08-01'), Math.round(4_099 * 5.2))
  assert.equal(convertCents(52_000, 'BRL', 'USD', RATES, '2026-08-01'), 10_000)
})

test('de uma moeda para outra, a travessia passa pelo real', () => {
  // 100 USD → 520 BRL → 87,25 EUR. As duas pontas precisam de taxa declarada.
  assert.equal(convertCents(10_000, 'USD', 'EUR', RATES, '2026-08-01'), Math.round(52_000 / 5.96))
  assert.equal(
    convertCents(10_000, 'USD', 'GBP', RATES, '2026-08-01'),
    null,
    'meia conversão não é uma conversão'
  )
})

test('sem taxa, `null` — e `null` nunca é zero', () => {
  const missing = convertCents(4_099, 'USD', 'BRL', [], '2026-08-01')

  assert.equal(missing, null)
  assert.notEqual(missing, 0, 'zero diria que a conta em dólar não custou nada')
})

test('o real é a base, e ele não tem taxa própria', () => {
  assert.equal(BASE_CURRENCY, 'BRL')
})

test('o banco recusa taxa de real para real', { skip: APP_SCHEMA_SKIP }, () => {
  assert.ok(
    /currency <> 'BRL'/.test(tableDdl('finance.fx_rates')),
    'uma taxa de real para real seria uma linha que alguém acabaria editando para 1,05'
  )
})

// ── AS INVARIANTES DE SUPERFÍCIE ──────────────────────────────────────────────────────────────

test('o módulo puro não busca cotação em lugar nenhum', () => {
  const source = read('lib/finance/fx.ts')

  assert.ok(!/\bfetch\(|https?:\/\//.test(source), 'uma taxa que muda sozinha faz dois relatórios do mesmo mês discordarem')
  assert.ok(!/from '@supabase|createClient/.test(source))
  assert.ok(!/from 'react'|useState/.test(source))
})

test('corrigir a taxa é inserir linha nova: a tabela não aceita UPDATE nem DELETE', { skip: APP_SCHEMA_SKIP }, () => {
  const grants = grantsOn('finance.fx_rates')

  assert.ok(grants.some((line) => /^GRANT SELECT,INSERT ON/.test(line)))
  assert.ok(!grants.some((line) => /\b(UPDATE|DELETE|ALL)\b/.test(line)), 'a taxa de hoje não reprecifica julho')
})

test('toda taxa declarada carrega procedência', { skip: APP_SCHEMA_SKIP }, () => {
  const ddl = tableDdl('finance.fx_rates')

  assert.ok(/\bsource text NOT NULL/.test(ddl))
  assert.ok(
    /CONSTRAINT fx_rates_source_ck CHECK \(\(length\(btrim\(source\)\) > 0\)\)/.test(ddl),
    'uma taxa sem procedência é um chute com cara de fato'
  )
})
