/**
 * O CALENDÁRIO DA COBRANÇA — o relógio que o contrato de fato usa.
 *
 * Mutations that turn this suite red:
 *  · contar receita a partir da aprovação do parceiro, ou da assinatura, em vez da publicação;
 *  · fazer o primeiro vencimento cair no mês da publicação em vez do seguinte;
 *  · esquecer o proporcional da primeira fatura, ou cobrá-lo como uma segunda fatura;
 *  · contar o mês corrente como faturado antes de o dia 20 chegar;
 *  · cortar a receita JÁ REALIZADA no horizonte de doze, que é premissa da projeção;
 *  · redeclarar o dia 20 aqui em vez de lê-lo do contrato.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  DUE_DAY_OF_MONTH,
  billingSchedule,
  firstDueMonth,
  invoicedThrough,
  proRataFraction,
} from '@/lib/finance/billing'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

const FEE = 10_000

test('o caso que o operador descreveu: publicou depois do dia 20, primeiro vencimento é no mês seguinte', () => {
  assert.equal(firstDueMonth('2026-08-25'), '2026-09')
  assert.equal(firstDueMonth('2026-08-21'), '2026-09')
  // E publicar ANTES do dia 20 dá o mesmo mês: o que muda entre os dois é o proporcional, não a
  // data. É o que evita "publiquei dia 19, pago dia 20?" ter duas respostas.
  assert.equal(firstDueMonth('2026-08-02'), '2026-09')
})

test('a virada do ano: publicação em dezembro vence em janeiro', () => {
  assert.equal(firstDueMonth('2026-12-15'), '2027-01')
})

test('o proporcional é da publicação ao fim do mês, e nunca zero no dia da publicação', () => {
  assert.equal(proRataFraction('2026-08-01'), 1, 'publicar no dia 1º dá o mês inteiro')
  assert.equal(proRataFraction('2026-08-25'), 7 / 31, 'de 25 a 31 são sete dias')
  assert.equal(proRataFraction('2026-08-31'), 1 / 31, 'o dia da publicação é dia de serviço')
  assert.equal(proRataFraction('2026-02-01'), 1, 'fevereiro também é um mês inteiro')
})

test('a primeira fatura é UMA cobrança, e ela carrega o proporcional junto do mês cheio', () => {
  const [primeira, segunda] = billingSchedule({
    start: '2026-08-25',
    feeCents: FEE,
    horizonInvoices: null,
    from: '2026-09',
    months: 2,
  })

  assert.equal(primeira.month, '2026-09')
  assert.equal(primeira.dueOn, '2026-09-20')
  assert.equal(primeira.proRata, true)
  assert.equal(primeira.cents, FEE + Math.round(FEE * (7 / 31)), 'setembro inteiro + 7 dias de agosto')

  assert.equal(segunda.month, '2026-10')
  assert.equal(segunda.proRata, false)
  assert.equal(segunda.cents, FEE, 'da segunda em diante é a mensalidade limpa')
})

test('sem marco não há calendário — e nenhuma fatura é inventada', () => {
  assert.deepEqual(
    billingSchedule({ start: null, feeCents: FEE, horizonInvoices: null, from: '2026-09', months: 6 }),
    []
  )
  assert.deepEqual(
    billingSchedule({ start: '2026-08-25', feeCents: null, horizonInvoices: null, from: '2026-09', months: 6 }),
    [],
    'sem mensalidade também não há o que faturar'
  )
})

test('o horizonte corta o calendário, e ele é premissa — `null` é o contrato como ele é', () => {
  const comHorizonte = billingSchedule({
    start: '2026-01-05',
    feeCents: FEE,
    horizonInvoices: 12,
    from: '2027-01',
    months: 6,
  })

  // A primeira fatura foi em fevereiro de 2026; a décima segunda em janeiro de 2027. Depois dela
  // o horizonte fecha, e a premissa de doze é o que fecha — não o contrato.
  assert.equal(comHorizonte.length, 1)
  assert.equal(comHorizonte[0].month, '2027-01')

  const semHorizonte = billingSchedule({
    start: '2026-01-05',
    feeCents: FEE,
    horizonInvoices: null,
    from: '2027-01',
    months: 6,
  })
  assert.equal(semHorizonte.length, 6, 'o instrumento é por prazo indeterminado')
})

test('a janela nunca começa antes da primeira fatura', () => {
  const invoices = billingSchedule({
    start: '2026-11-10',
    feeCents: FEE,
    horizonInvoices: null,
    from: '2026-09',
    months: 6,
  })

  assert.equal(invoices[0].month, '2026-12', 'setembro, outubro e novembro não têm fatura dele')
})

test('O DIA 20 DECIDE: no dia 19 ainda não venceu', () => {
  const vespera = invoicedThrough({
    start: '2026-08-25',
    feeCents: FEE,
    horizonInvoices: null,
    asOf: '2026-09-19',
  })
  assert.deepEqual(vespera, { invoices: 0, cents: 0 }, 'contar o mês porque ele começou é faturar adiantado')

  const noDia = invoicedThrough({
    start: '2026-08-25',
    feeCents: FEE,
    horizonInvoices: null,
    asOf: '2026-09-20',
  })
  assert.equal(noDia.invoices, 1)
  assert.equal(noDia.cents, FEE + Math.round(FEE * (7 / 31)))
})

test('a receita realizada acumula uma fatura por mês, e o proporcional entra uma vez só', () => {
  const tres = invoicedThrough({
    start: '2026-08-25',
    feeCents: FEE,
    horizonInvoices: null,
    asOf: '2026-11-20',
  })

  assert.equal(tres.invoices, 3, 'setembro, outubro e novembro')
  assert.equal(tres.cents, 3 * FEE + Math.round(FEE * (7 / 31)), 'o proporcional não se repete')
})

test('receita realizada não tem horizonte quando ninguém pede um', () => {
  const catorze = invoicedThrough({
    start: '2026-01-05',
    feeCents: FEE,
    horizonInvoices: null,
    asOf: '2027-03-20',
  })

  assert.equal(catorze.invoices, 14, 'quem tem quatorze faturas vencidas faturou quatorze')

  const cortado = invoicedThrough({
    start: '2026-01-05',
    feeCents: FEE,
    horizonInvoices: 12,
    asOf: '2027-03-20',
  })
  assert.equal(cortado.invoices, 12, 'e o corte é premissa de quem chamou, nunca do contrato')
})

test('o futuro não fatura', () => {
  const futuro = invoicedThrough({
    start: '2027-01-10',
    feeCents: FEE,
    horizonInvoices: null,
    asOf: '2026-09-30',
  })
  assert.deepEqual(futuro, { invoices: 0, cents: 0 })
})

test('o dia 20 vem do CONTRATO, e não é redeclarado aqui', () => {
  assert.equal(DUE_DAY_OF_MONTH, 20)

  const source = read('lib/finance/billing.ts')
  assert.ok(
    /import \{ DUE_DAY_OF_MONTH \} from '@\/lib\/contract\/template'/.test(source),
    'quem define o vencimento é o instrumento; um segundo 20 aqui divergiria no dia em que ele mudasse'
  )
  assert.ok(
    !/=\s*20\b/.test(source.replace(/DUE_DAY_OF_MONTH/g, '')),
    'nenhum 20 literal escondido'
  )
})

test('a ASSINATURA é o último recurso — o aceite vem depois da liberação', () => {
  const service = readFileSync(resolve(root, 'lib/services/finance-service.ts'), 'utf8')
  const fn = service.slice(service.indexOf('export async function loadBillingStarts'))

  const publication = fn.indexOf("source: 'publication'")
  const liberation = fn.indexOf("source: 'liberation'")
  const signature = fn.indexOf("source: 'signature'")

  assert.ok(publication >= 0 && liberation >= 0 && signature >= 0, 'as três fontes existem')
  assert.ok(
    publication < liberation && liberation < signature,
    'com o aceite à frente, um parceiro liberado em agosto que assine em outubro só faturaria ' +
      'em novembro — apagando dois meses que a Tuggi já entregou'
  )
})

test('o módulo puro não conhece Supabase, fetch nem React', () => {
  const source = read('lib/finance/billing.ts')
  assert.ok(!/from '@supabase|getSupabase|createClient/.test(source))
  assert.ok(!/\bfetch\(/.test(source))
  assert.ok(!/from 'react'|useState|useEffect/.test(source))
})
