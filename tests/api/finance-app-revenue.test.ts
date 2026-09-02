/**
 * A RECEITA DO APP — lida do evento do RevenueCat.
 *
 * OS FIXOS SÃO PAYLOADS REAIS, copiados de `drive.subscription_history` em 2026-09-02 e reduzidos
 * aos campos que decidem receita. Nada aqui foi inventado a partir da documentação do RevenueCat:
 * a forma veio de eventos que a EF `app-revenuecat-webhook` de fato gravou.
 *
 * Mutations that turn this suite red:
 *  · contar sandbox como receita (havia R$ 5.816,93 de renovação de teste na mesma tabela);
 *  · contar período de teste como cobrança;
 *  · somar moedas diferentes num total único;
 *  · contar duas vezes um webhook reentregue;
 *  · pôr compra de uma vez na receita recorrente;
 *  · contar quem renovou seis vezes como seis assinantes;
 *  · calcular a comissão do parceiro sobre o BRUTO, pagando a fatia da loja duas vezes;
 *  · tratar parceiro sem taxa cadastrada como taxa zero.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  appRevenueByMonth,
  commissionByPartner,
  parseRcEvent,
  spendByUser,
  summarizeAppRevenue,
  type RcEvent,
} from '@/lib/finance/app-revenue'

const root = resolve(import.meta.dirname, '../..')
const NOW = '2026-09-02'

/** O envelope como a EF grava: o payload do RevenueCat dentro de `metadata.full_event`. */
function metadata(over: Record<string, unknown> = {}) {
  return {
    productId: 'com.tuggi.premium.7day',
    full_event: {
      id: 'EV-1',
      type: 'NON_RENEWING_PURCHASE',
      price: 5.83,
      store: 'APP_STORE',
      currency: 'BRL',
      product_id: 'com.tuggi.premium.7day',
      app_user_id: 'user-1',
      environment: 'PRODUCTION',
      period_type: 'NORMAL',
      country_code: 'BR',
      takehome_percentage: 0.85,
      purchased_at_ms: 1785000000000,
      expiration_at_ms: null,
      subscriber_attributes: {},
      price_in_purchased_currency: 29.9,
      ...over,
    },
  }
}

function event(over: Record<string, unknown> = {}): RcEvent {
  const parsed = parseRcEvent(metadata(over))
  assert.ok(parsed, 'o fixo tem de ser parseável')
  return parsed
}

// ── A LEITURA DO PAYLOAD ──────────────────────────────────────────────────────────────────────

test('o evento sai de `metadata.full_event`, que é onde a EF de fato grava', () => {
  const parsed = parseRcEvent(
    metadata({
      id: 'EV-IT',
      type: 'INITIAL_PURCHASE',
      currency: 'EUR',
      price: 17.37,
      price_in_purchased_currency: 14.99,
      country_code: 'IT',
      store: 'PLAY_STORE',
      product_id: 'tuggi_unlimited_month:unlimitedmonth',
      expiration_at_ms: 1790917269337,
    })
  )

  assert.equal(parsed?.currency, 'EUR')
  assert.equal(parsed?.priceLocal, 14.99)
  assert.equal(parsed?.priceUsd, 17.37)
  assert.equal(parsed?.countryCode, 'IT')
  assert.equal(parsed?.takehome, 0.85)
  assert.ok(parsed?.expiresAt?.startsWith('2026-'))
})

test('linha sem `full_event` não vira um evento de R$ 0,00', () => {
  assert.equal(parseRcEvent({}), null, 'as linhas `expired` do sistema têm metadata vazio')
  assert.equal(parseRcEvent(null), null)
  assert.equal(parseRcEvent({ full_event: { id: 'x' } }), null, 'sem preço não é compra')
})

test('o parceiro chega dentro de `subscriber_attributes`', () => {
  const parsed = parseRcEvent(
    metadata({
      subscriber_attributes: {
        partner_id: { value: '718f13f1-99ab-4a7a-8221-1fd58896f14c', updated_at_ms: 1 },
        $attConsentStatus: { value: 'notDetermined', updated_at_ms: 1 },
      },
    })
  )
  assert.equal(parsed?.partnerId, '718f13f1-99ab-4a7a-8221-1fd58896f14c')
})

// ── O QUE É RECEITA ───────────────────────────────────────────────────────────────────────────

test('SANDBOX NÃO É RECEITA — e sobe contado, para o filtro ser visível', () => {
  const revenue = summarizeAppRevenue(
    [
      event({ id: 'a' }),
      event({ id: 'b', environment: 'SANDBOX', price_in_purchased_currency: 5816.93 }),
    ],
    NOW
  )

  assert.equal(revenue.paidTransactions, 1)
  assert.equal(revenue.sandboxIgnored, 1)
  assert.deepEqual(revenue.realized, [
    { currency: 'BRL', grossCents: 2990, netCents: 2542, transactions: 1 },
  ])
})

test('período de teste não cobra, e não some', () => {
  const revenue = summarizeAppRevenue([event({ id: 'a', period_type: 'TRIAL' })], NOW)
  assert.equal(revenue.trials, 1)
  assert.equal(revenue.paidTransactions, 0)
})

test('cancelamento e expiração mudam estado, não caixa', () => {
  const revenue = summarizeAppRevenue(
    [event({ id: 'a', type: 'CANCELLATION' }), event({ id: 'b', type: 'EXPIRATION' })],
    NOW
  )
  assert.equal(revenue.paidTransactions, 0)
})

test('webhook reentregue não conta duas vezes', () => {
  const revenue = summarizeAppRevenue([event({ id: 'mesmo' }), event({ id: 'mesmo' })], NOW)
  assert.equal(revenue.paidTransactions, 1)
})

test('MOEDAS NÃO SOMAM — é o caso real de 2026-09-02', () => {
  const revenue = summarizeAppRevenue(
    [
      event({ id: 'br', price_in_purchased_currency: 29.9, currency: 'BRL', price: 5.83 }),
      event({ id: 'eu', price_in_purchased_currency: 7.99, currency: 'EUR', price: 9.31 }),
      event({ id: 'ch', price_in_purchased_currency: 3.0, currency: 'CHF', price: 3.74 }),
      event({ id: 'us', price_in_purchased_currency: 9.99, currency: 'USD', price: 9.99 }),
    ],
    NOW
  )

  assert.deepEqual(
    revenue.realized.map((line) => line.currency),
    ['BRL', 'CHF', 'EUR', 'USD']
  )
  // O dólar do próprio RevenueCat é a única ponte entre elas, e ele vem do payload.
  assert.equal(revenue.grossUsdCents, 583 + 931 + 374 + 999)
  assert.equal(revenue.netUsdCents, Math.round(583 * 0.85) + Math.round(931 * 0.85) + Math.round(374 * 0.85) + Math.round(999 * 0.85))
})

test('o líquido desconta a loja, e sem `takehome` ele é o bruto', () => {
  const comTakehome = summarizeAppRevenue([event({ id: 'a' })], NOW)
  assert.equal(comTakehome.realized[0].netCents, Math.round(2990 * 0.85))

  const sem = summarizeAppRevenue([event({ id: 'b', takehome_percentage: null })], NOW)
  assert.equal(sem.realized[0].netCents, 2990, 'supor uma comissão erraria sempre para menos')
})

// ── REALIZADO × RECORRENTE ────────────────────────────────────────────────────────────────────

test('o passe descontinuado conta no que JÁ ENTROU e não no que VOLTA', () => {
  const revenue = summarizeAppRevenue(
    [
      // O passe de 7 dias: vendido, sem vencimento, produto que não existe mais.
      event({ id: 'passe', product_id: 'com.tuggi.premium.7day', expiration_at_ms: null }),
      // A assinatura italiana de hoje, viva até outubro.
      event({
        id: 'assinatura',
        type: 'INITIAL_PURCHASE',
        app_user_id: 'user-it',
        currency: 'EUR',
        price_in_purchased_currency: 14.99,
        product_id: 'tuggi_unlimited_month:unlimitedmonth',
        expiration_at_ms: new Date('2026-10-02').getTime(),
      }),
    ],
    NOW
  )

  assert.equal(revenue.realized.length, 2, 'as duas entraram')
  assert.deepEqual(
    revenue.recurring,
    [{ currency: 'EUR', grossCents: 1499, netCents: Math.round(1499 * 0.85), transactions: 1 }],
    'só a que tem vencimento futuro volta'
  )
  assert.equal(revenue.activeSubscriptions, 1)
})

test('assinatura vencida sai do recorrente sem sair do realizado', () => {
  const revenue = summarizeAppRevenue(
    [event({ id: 'a', expiration_at_ms: new Date('2026-08-21').getTime() })],
    NOW
  )
  assert.equal(revenue.realized.length, 1)
  assert.deepEqual(revenue.recurring, [])
})

test('quem renovou seis vezes é UM assinante, e a última renovação é a que vale', () => {
  const renewals = [1, 2, 3, 4, 5, 6].map((n) =>
    event({
      id: `r${n}`,
      type: 'RENEWAL',
      purchased_at_ms: 1785000000000 + n * 86_400_000,
      expiration_at_ms: new Date('2026-10-02').getTime(),
    })
  )

  const revenue = summarizeAppRevenue(renewals, NOW)
  assert.equal(revenue.paidTransactions, 6, 'seis cobranças aconteceram')
  assert.equal(revenue.activeSubscriptions, 1, 'e é uma assinatura só')
  assert.equal(revenue.recurring[0].transactions, 1)
})

// ── POR PESSOA E POR PARCEIRO ─────────────────────────────────────────────────────────────────

test('quanto cada pessoa já pagou, na moeda dela', () => {
  const spend = spendByUser([
    event({ id: 'a', app_user_id: 'ana' }),
    event({ id: 'b', app_user_id: 'ana' }),
    event({ id: 'c', app_user_id: 'bruno', price_in_purchased_currency: 9.99, currency: 'USD' }),
  ])

  assert.equal(spend[0].userId, 'ana')
  assert.equal(spend[0].transactions, 2)
  assert.equal(spend[0].grossCents, 5980)
  assert.equal(spend[1].currency, 'USD')
})

test('quem comprou em duas moedas tem duas linhas — somá-las exigiria câmbio', () => {
  const spend = spendByUser([
    event({ id: 'a', app_user_id: 'ana' }),
    event({ id: 'b', app_user_id: 'ana', currency: 'EUR', price_in_purchased_currency: 7.99 }),
  ])
  assert.equal(spend.length, 2)
})

test('a comissão do parceiro é sobre o LÍQUIDO, como o contrato promete', () => {
  const attributes = { partner_id: { value: 'parceiro-1', updated_at_ms: 1 } }
  const { lines } = commissionByPartner(
    [event({ id: 'a', subscriber_attributes: attributes })],
    new Map([['parceiro-1', 0.2]])
  )

  const liquido = Math.round(2990 * 0.85)
  assert.equal(lines[0].baseCents, liquido)
  assert.equal(
    lines[0].commissionCents,
    Math.round(liquido * 0.2),
    'sobre o bruto, o parceiro receberia uma fatia da comissão que a loja já levou'
  )
})

test('parceiro sem taxa cadastrada é NOMEADO, e não vira zero', () => {
  const attributes = { partner_id: { value: 'sem-taxa', updated_at_ms: 1 } }
  const { lines, withoutRate } = commissionByPartner(
    [event({ id: 'a', subscriber_attributes: attributes })],
    new Map()
  )

  assert.deepEqual(lines, [])
  assert.deepEqual(withoutRate, ['sem-taxa'], 'zero sobre receita real é uma dívida que some')
})

test('compra sem parceiro não gera comissão de ninguém', () => {
  const { lines } = commissionByPartner([event({ id: 'a' })], new Map([['x', 0.2]]))
  assert.deepEqual(lines, [])
})

// ── O CALENDÁRIO DO APP ───────────────────────────────────────────────────────────────────────

test('a cobrança feita cai no mês em que foi feita', () => {
  const app = appRevenueByMonth(
    [event({ id: 'a', purchased_at_ms: new Date('2026-08-13').getTime() })],
    { from: '2026-07', months: 3, currency: 'BRL', on: NOW }
  )
  assert.equal(app.byMonth['2026-08'], 2990)
  assert.equal(app.byMonth['2026-07'], 0)
})

test('a assinatura viva RENOVA no calendário; a compra de uma vez não', () => {
  const assinatura = event({
    id: 'sub',
    type: 'INITIAL_PURCHASE',
    price_in_purchased_currency: 49.9,
    purchased_at_ms: new Date('2026-08-13').getTime(),
    expiration_at_ms: new Date('2026-09-13').getTime(),
  })
  const passe = event({ id: 'passe', purchased_at_ms: new Date('2026-08-14').getTime() })

  const app = appRevenueByMonth([assinatura, passe], {
    from: '2026-08',
    months: 4,
    currency: 'BRL',
    on: NOW,
  })

  assert.equal(app.byMonth['2026-08'], 4990 + 2990, 'agosto teve as duas cobranças')
  assert.equal(app.byMonth['2026-09'], 4990, 'setembro tem a renovação, e não o passe')
  assert.equal(app.byMonth['2026-10'], 4990, 'e ela segue rolando pelo período de 31 dias')
  assert.equal(app.projectedSubscriptions, 1)
})

test('assinatura vencida não renova', () => {
  const app = appRevenueByMonth(
    [
      event({
        id: 'a',
        purchased_at_ms: new Date('2026-07-21').getTime(),
        expiration_at_ms: new Date('2026-08-21').getTime(),
      }),
    ],
    { from: '2026-08', months: 3, currency: 'BRL', on: NOW }
  )
  assert.equal(app.byMonth['2026-09'], 0)
  assert.equal(app.projectedSubscriptions, 0)
})

test('SEM TAXA DECLARADA, outra moeda é nomeada e nunca convertida', () => {
  const app = appRevenueByMonth(
    [
      event({ id: 'br', purchased_at_ms: new Date('2026-08-13').getTime() }),
      event({
        id: 'it',
        currency: 'EUR',
        price_in_purchased_currency: 14.99,
        purchased_at_ms: new Date('2026-08-13').getTime(),
      }),
    ],
    { from: '2026-08', months: 2, currency: 'BRL', on: NOW }
  )

  assert.equal(app.byMonth['2026-08'], 2990, 'só o real entra no eixo')
  assert.deepEqual(app.otherCurrencies, [
    { currency: 'EUR', grossCents: 1499, netCents: Math.round(1499 * 0.85), transactions: 1 },
  ])
})

test('sandbox não entra no calendário', () => {
  const app = appRevenueByMonth(
    [event({ id: 'a', environment: 'SANDBOX', purchased_at_ms: new Date('2026-08-13').getTime() })],
    { from: '2026-08', months: 2, currency: 'BRL', on: NOW }
  )
  assert.equal(app.byMonth['2026-08'], 0)
})

// ── AS INVARIANTES DE SUPERFÍCIE ──────────────────────────────────────────────────────────────

test('o módulo puro não conhece Supabase, fetch nem React', () => {
  const source = readFileSync(resolve(root, 'lib/finance/app-revenue.ts'), 'utf8')
  assert.ok(!/from '@supabase|getSupabase|createClient/.test(source))
  assert.ok(!/\bfetch\(/.test(source))
  assert.ok(!/from 'react'|useState|useEffect/.test(source))
})

test('a conversão passa pela taxa DECLARADA, e por nenhuma outra', () => {
  // A REGRA MUDOU EM 2026-09-02, e o teste mudou junto. Antes: "nada aqui converte moeda",
  // porque não havia taxa declarada e converter seria inventar. Hoje há `finance.fx_rates`, e o
  // operador pediu a conversão — dos 3 assinantes de loja, 2 estão em fuso europeu, então a
  // linha em reais desenhava um terço da receita do app e parecia a receita inteira.
  //
  // O QUE NÃO MUDOU, e é o que este teste passou a travar: a taxa vem de fora, declarada, com
  // procedência. Nada aqui busca cotação nem carrega número de câmbio no código.
  const source = readFileSync(resolve(root, 'lib/finance/app-revenue.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

  assert.ok(/from '\.\/fx'/.test(source), 'a taxa vem de lib/finance/fx.ts')
  assert.ok(!/fetch\(|https?:\/\//.test(source), 'nenhuma cotação é buscada')
  assert.ok(
    !/rateToBrl\s*[:=]\s*[\d.]/.test(source),
    'nenhuma taxa escrita no código — ela é uma linha do banco, com vigência e procedência'
  )
})

test('com taxa declarada, o euro entra no eixo em reais', () => {
  const app = appRevenueByMonth(
    [
      event({ id: 'br', purchased_at_ms: new Date('2026-08-13').getTime() }),
      event({
        id: 'it',
        currency: 'EUR',
        price_in_purchased_currency: 14.99,
        purchased_at_ms: new Date('2026-08-13').getTime(),
      }),
    ],
    {
      from: '2026-08',
      months: 2,
      currency: 'BRL',
      on: NOW,
      rates: [
        {
          currency: 'EUR',
          rateToBrl: 5.96,
          effectiveFrom: '2026-01-01',
          source: 'declarada pelo operador',
        },
      ],
    }
  )

  assert.equal(app.byMonth['2026-08'], 2990 + Math.round(1499 * 5.96))
  assert.deepEqual(app.otherCurrencies, [], 'com taxa, nada fica de fora')
  assert.equal(app.appliedRates.length, 1, 'e a tela recebe a taxa que foi usada')
  assert.equal(app.appliedRates[0].currency, 'EUR')
})

test('a taxa declarada DEPOIS da venda não vale para ela', () => {
  const app = appRevenueByMonth(
    [
      event({
        id: 'it',
        currency: 'EUR',
        price_in_purchased_currency: 14.99,
        purchased_at_ms: new Date('2026-08-13').getTime(),
      }),
    ],
    {
      from: '2026-08',
      months: 2,
      currency: 'BRL',
      on: NOW,
      rates: [
        {
          currency: 'EUR',
          rateToBrl: 5.96,
          effectiveFrom: '2026-09-01',
          source: 'declarada depois',
        },
      ],
    }
  )

  // A taxa de setembro não reprecifica agosto: a venda volta nomeada, como se não houvesse taxa.
  assert.equal(app.byMonth['2026-08'], 0)
  assert.equal(app.otherCurrencies.length, 1)
})

test('o serviço lê o jsonb, e não as colunas vazias ao lado dele', () => {
  const source = readFileSync(resolve(root, 'lib/services/finance-service.ts'), 'utf8')
  const start = source.indexOf('export async function loadRcEvents')
  const fn = source.slice(start, source.indexOf('export async function loadCommissionRates'))

  assert.ok(/\.select\('metadata'\)/.test(fn), 'o payload vive em metadata')
  assert.ok(
    !/price_local/.test(fn),
    'essas colunas estão nulas em 100% das linhas — quem ler delas lê vazio'
  )
})
