/**
 * O dinheiro real do Com história (#902): a ordem das pendências, a nota que vale, quem estava
 * ativo no mês, os quatro totais e o recebido por cliente — tudo puro, montado à mão.
 *
 * Regras: BR-B2B-044 (repasse e saídas), BR-B2B-045 (diferença do desconto entra no mês em que é
 * paga), BR-B2B-046 (a nota fiscal é do Com história e a pendência "sem nota" é paga sem nota
 * AUTORIZADA).
 *
 * Mutations that turn this suite red:
 *  · ordenar a mais nova antes da mais antiga, ou atenção antes de urgente;
 *  · deixar a pendência sem data no começo do nível, e não no fim;
 *  · `pickInvoice` devolver a `ERROR` quando existe uma reemitida e autorizada ao lado;
 *  · tratar `CANCELED` como nota viva;
 *  · contar "paga sem nota" quando a nota está só `SYNCHRONIZED` (ainda não autorizada);
 *  · decidir o mês de um pagamento em UTC e não em São Paulo;
 *  · contar assinatura em `pending_payment`/nunca paga como ativa no mês;
 *  · somar cobrança vencida (`overdue`) em Receita do mês;
 *  · esquecer a diferença do desconto em Entradas, ou o repasse pago em Saídas;
 *  · contar cobrança estornada como recebida na lucratividade.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  activeInMonth,
  daysBetween,
  isPaidWithoutInvoice,
  matchesFilter,
  pickInvoice,
  receivedByClient,
  saoPauloDate,
  sortPendingItems,
  summarizePlaceMonth,
  type PlaceCharge,
  type PlaceInvoice,
  type PlaceSubscription,
} from '@/lib/finance/place-billing'

function invoice(over: Partial<PlaceInvoice> = {}): PlaceInvoice {
  return {
    providerInvoiceId: over.providerInvoiceId ?? 'inv_1',
    providerPaymentId: over.providerPaymentId ?? 'pay_1',
    status: over.status ?? 'AUTHORIZED',
    number: over.number ?? '123',
    pdfUrl: null,
    xmlUrl: null,
    statusDescription: null,
    updatedAt: over.updatedAt ?? '2026-08-10T12:00:00Z',
  }
}

function charge(over: Partial<PlaceCharge> = {}): PlaceCharge {
  return {
    providerPaymentId: over.providerPaymentId ?? 'pay_1',
    kind: over.kind ?? 'first',
    status: over.status ?? 'paid',
    amountCents: over.amountCents ?? 10_000,
    dueDate: over.dueDate ?? '2026-08-10',
    paidOn: over.paidOn === undefined ? '2026-08-10' : over.paidOn,
    refundedOn: over.refundedOn ?? null,
    invoice: over.invoice === undefined ? null : over.invoice,
  }
}

function sub(over: Partial<PlaceSubscription> = {}): PlaceSubscription {
  return {
    id: over.id ?? 'sub-1',
    origin: over.origin ?? 'portal',
    acceptanceId: over.origin === 'cms_contract' ? null : 'acc-1',
    clientId: over.clientId === undefined ? 'client-1' : over.clientId,
    clientName: over.clientName ?? null,
    attractionId: null,
    attractionEntityKind: null,
    placeName: over.placeName ?? 'Baires Bistrô',
    contactEmail: 'a@b.c',
    billingPeriod: 1,
    paymentMethod: 'credit_card',
    status: over.status ?? 'paid',
    createdAt: over.createdAt ?? null,
    paidAt: over.paidAt === undefined ? '2026-08-10T15:00:00Z' : over.paidAt,
    paidThrough: '2026-09-10',
    renews: true,
    renewalAmountCents: over.renewalAmountCents === undefined ? 10_000 : over.renewalAmountCents,
    canceledAt: over.canceledAt ?? null,
    expiredAt: over.expiredAt ?? null,
    earlyTerminationFeeCents: over.earlyTerminationFeeCents ?? null,
    earlyTerminationPaidOn: over.earlyTerminationPaidOn ?? null,
    charges: over.charges ?? [charge()],
  }
}

// ── sortPendingItems ───────────────────────────────────────────────────────────────────────────

const item = (objectId: string, severity: 'critical' | 'warning', referenceDate: string | null) => ({
  objectId,
  severity,
  referenceDate,
})

test('BR-B2B-044 #902: pendências saem urgente primeiro e, no mesmo nível, a mais antiga primeiro', () => {
  const sorted = sortPendingItems([
    item('a', 'warning', '2026-08-01'),
    item('b', 'critical', '2026-09-20'),
    item('c', 'critical', '2026-09-01'),
    item('d', 'warning', '2026-07-01'),
  ])
  assert.deepEqual(sorted.map((i) => i.objectId), ['c', 'b', 'd', 'a'])
})

test('BR-B2B-044 #902: pendência sem data vai para o fim do próprio nível, e o id desempata', () => {
  const sorted = sortPendingItems([
    item('z', 'critical', null),
    item('y', 'critical', '2026-09-01'),
    item('b', 'critical', '2026-09-01'),
    item('w', 'warning', null),
  ])
  assert.deepEqual(sorted.map((i) => i.objectId), ['b', 'y', 'z', 'w'])
})

test('#902: sortPendingItems não muda o array de entrada e aceita lista vazia', () => {
  const input = [item('a', 'warning', '2026-08-01'), item('b', 'critical', '2026-08-02')]
  const copy = [...input]
  sortPendingItems(input)
  assert.deepEqual(input, copy)
  assert.deepEqual(sortPendingItems([]), [])
})

// ── pickInvoice ────────────────────────────────────────────────────────────────────────────────

test('BR-B2B-046 #902: pickInvoice sem nota devolve null', () => {
  assert.equal(pickInvoice([]), null)
})

test('BR-B2B-046 #902: a nota reemitida e autorizada vale mais que a ERROR ao lado dela', () => {
  const picked = pickInvoice([
    invoice({ providerInvoiceId: 'err', status: 'ERROR', updatedAt: '2026-08-20T00:00:00Z' }),
    invoice({ providerInvoiceId: 'ok', status: 'AUTHORIZED', updatedAt: '2026-08-11T00:00:00Z' }),
  ])
  assert.equal(picked?.providerInvoiceId, 'ok')
})

test('BR-B2B-046 #902: viva (em andamento) vence morta; CANCELED é a última escolha', () => {
  assert.equal(
    pickInvoice([
      invoice({ providerInvoiceId: 'c', status: 'CANCELED' }),
      invoice({ providerInvoiceId: 's', status: 'SYNCHRONIZED' }),
    ])?.providerInvoiceId,
    's'
  )
  assert.equal(
    pickInvoice([
      invoice({ providerInvoiceId: 'c', status: 'CANCELED' }),
      invoice({ providerInvoiceId: 'e', status: 'ERROR' }),
    ])?.providerInvoiceId,
    'e',
    'ERROR ainda pede ação; CANCELED não'
  )
})

test('BR-B2B-046 #902: sem nota viva, e no mesmo status, vale a mais recente', () => {
  const picked = pickInvoice([
    invoice({ providerInvoiceId: 'old', status: 'ERROR', updatedAt: '2026-08-01T00:00:00Z' }),
    invoice({ providerInvoiceId: 'new', status: 'ERROR', updatedAt: '2026-08-09T00:00:00Z' }),
  ])
  assert.equal(picked?.providerInvoiceId, 'new')
})

// ── "Sem nota" ─────────────────────────────────────────────────────────────────────────────────

test('BR-B2B-046 #902: "Sem nota" é paga sem nota AUTORIZADA — enviada à prefeitura ainda conta', () => {
  assert.equal(isPaidWithoutInvoice(charge({ invoice: null })), true)
  assert.equal(isPaidWithoutInvoice(charge({ invoice: invoice({ status: 'SYNCHRONIZED' }) })), true)
  assert.equal(isPaidWithoutInvoice(charge({ invoice: invoice({ status: 'AUTHORIZED' }) })), false)
  assert.equal(isPaidWithoutInvoice(charge({ status: 'overdue', paidOn: null })), false, 'não paga não é "sem nota"')
})

test('#902: o filtro "Sem nota" mostra só quem tem cobrança paga sem nota autorizada', () => {
  const sem = sub({ charges: [charge({ invoice: null })] })
  const com = sub({ id: 'sub-2', charges: [charge({ invoice: invoice() })] })
  assert.equal(matchesFilter(sem, 'without_invoice'), true)
  assert.equal(matchesFilter(com, 'without_invoice'), false)
  assert.equal(matchesFilter(com, 'all'), true)
  assert.equal(matchesFilter(sub({ charges: [charge({ status: 'overdue', paidOn: null })] }), 'overdue'), true)
  assert.equal(matchesFilter(sub({ status: 'refunded' }), 'canceled'), true)
  assert.equal(matchesFilter(sub(), 'canceled'), false)
})

// ── datas ──────────────────────────────────────────────────────────────────────────────────────

test('BR-B2B-044 #902: o dia é o de São Paulo, não o de UTC', () => {
  assert.equal(saoPauloDate('2026-09-01T02:00:00Z'), '2026-08-31')
  assert.equal(saoPauloDate('2026-09-01T03:00:00Z'), '2026-09-01')
  assert.equal(saoPauloDate(null), null)
  assert.equal(saoPauloDate('lixo'), null)
  assert.equal(daysBetween('2026-09-01', '2026-09-11'), 10)
})

// ── activeInMonth ──────────────────────────────────────────────────────────────────────────────

test('#902: activeInMonth — só quem pagou até o fim do mês e não saiu antes dele', () => {
  const s = sub({ paidAt: '2026-08-15T12:00:00Z' })
  assert.equal(activeInMonth(s, '2026-08'), true)
  assert.equal(activeInMonth(s, '2026-09'), true)
  assert.equal(activeInMonth(s, '2026-07'), false, 'ainda não tinha pago')
  assert.equal(activeInMonth(sub({ paidAt: null }), '2026-08'), false, 'nunca pagou = rascunho de checkout')
})

test('#902: activeInMonth — o mês do cancelamento ainda conta, o seguinte não', () => {
  const s = sub({ paidAt: '2026-06-01T12:00:00Z', canceledAt: '2026-07-20T12:00:00Z' })
  assert.equal(activeInMonth(s, '2026-07'), true)
  assert.equal(activeInMonth(s, '2026-08'), false)
  const expired = sub({ paidAt: '2026-06-01T12:00:00Z', expiredAt: '2026-07-05T12:00:00Z' })
  assert.equal(activeInMonth(expired, '2026-08'), false)
})

test('BR-B2B-044 #902: activeInMonth decide a fronteira do mês em São Paulo', () => {
  // 02:00Z de 1º/09 é 23:00 de 31/08 em São Paulo: pagou em agosto.
  const s = sub({ paidAt: '2026-09-01T02:00:00Z' })
  assert.equal(activeInMonth(s, '2026-08'), true)
})

// ── summarizePlaceMonth ────────────────────────────────────────────────────────────────────────

test('BR-B2B-044/045 #902: os quatro totais do mês', () => {
  const totals = summarizePlaceMonth({
    month: '2026-08',
    subscriptions: [
      // Pagou em agosto e foi estornada em agosto: entra em receita e em saída.
      sub({
        id: 's1',
        status: 'refunded',
        charges: [charge({ amountCents: 10_000, paidOn: '2026-08-05', status: 'refunded', refundedOn: '2026-08-20' })],
      }),
      // Em dia, recorrente 20.000; pagou em agosto.
      sub({ id: 's2', renewalAmountCents: 20_000, charges: [charge({ amountCents: 20_000, paidOn: '2026-08-12' })] }),
      // Atrasada: conta no recorrente, a cobrança vencida NÃO conta como recebida.
      sub({
        id: 's3',
        status: 'past_due',
        renewalAmountCents: 5_000,
        charges: [charge({ amountCents: 5_000, status: 'overdue', paidOn: null })],
      }),
      // Pagou em julho: fora da receita de agosto. Diferença do desconto paga em agosto.
      sub({
        id: 's4',
        status: 'expired',
        renewalAmountCents: 7_000,
        charges: [charge({ amountCents: 7_000, paidOn: '2026-07-10' })],
        earlyTerminationFeeCents: 3_000,
        earlyTerminationPaidOn: '2026-08-25',
      }),
    ],
    payoutsPaid: [
      { paidOn: '2026-08-07', amountCents: 4_000 },
      { paidOn: '2026-09-07', amountCents: 9_999 },
    ],
  })
  assert.equal(totals.receivedCents, 30_000, 'a estornada conta como recebida no mês em que entrou')
  assert.equal(totals.recurringCents, 25_000, 'só `paid` e `past_due`: 20.000 + 5.000')
  assert.equal(totals.inflowCents, 33_000, 'receita + diferença do desconto (BR-B2B-045)')
  assert.equal(totals.outflowCents, 14_000, 'estorno 10.000 + repasse pago 4.000')
})

test('#902: summarizePlaceMonth sem nada devolve zeros, não NaN', () => {
  assert.deepEqual(summarizePlaceMonth({ month: '2026-08', subscriptions: [], payoutsPaid: [] }), {
    month: '2026-08',
    receivedCents: 0,
    recurringCents: 0,
    inflowCents: 0,
    outflowCents: 0,
  })
})

test('#902: recorrente cai para a última cobrança quando a assinatura não guarda a renovação', () => {
  const totals = summarizePlaceMonth({
    month: '2026-08',
    subscriptions: [sub({ renewalAmountCents: null, charges: [charge({ amountCents: 8_000 })] })],
    payoutsPaid: [],
  })
  assert.equal(totals.recurringCents, 8_000)
})

// ── receivedByClient ───────────────────────────────────────────────────────────────────────────

test('#902: receivedByClient soma só cobrança paga (não estornada) e a diferença do desconto', () => {
  const map = receivedByClient([
    sub({
      clientId: 'c1',
      charges: [
        charge({ amountCents: 10_000, status: 'paid' }),
        charge({ providerPaymentId: 'p2', amountCents: 10_000, status: 'paid' }),
        charge({ providerPaymentId: 'p3', amountCents: 10_000, status: 'refunded' }),
        charge({ providerPaymentId: 'p4', amountCents: 10_000, status: 'overdue', paidOn: null }),
      ],
      earlyTerminationFeeCents: 2_500,
      earlyTerminationPaidOn: '2026-08-25',
    }),
  ])
  assert.equal(map.get('c1'), 22_500)
})

test('#902: receivedByClient — sem cobrança espelhada o cliente fica FORA do mapa (continua "declarado")', () => {
  const map = receivedByClient([
    sub({ clientId: 'sem-cobranca', charges: [] }),
    sub({ clientId: null, charges: [charge()] }),
  ])
  assert.equal(map.has('sem-cobranca'), false)
  assert.equal(map.size, 0)
})

test('#902: receivedByClient — cliente com cobrança só vencida entra com 0, não some', () => {
  const map = receivedByClient([sub({ clientId: 'c1', charges: [charge({ status: 'overdue', paidOn: null })] })])
  assert.equal(map.get('c1'), 0, 'recebido real é zero; "declarado" seria mentira de outro tipo')
})

test('#902: receivedByClient soma duas assinaturas do mesmo cliente', () => {
  const map = receivedByClient([
    sub({ id: 'a', clientId: 'c1', charges: [charge({ amountCents: 1_000 })] }),
    sub({ id: 'b', clientId: 'c1', charges: [charge({ amountCents: 2_000 })] }),
  ])
  assert.equal(map.get('c1'), 3_000)
})

// ── #918: the CMS contract subscription (origin cms_contract, contract §3.8) ──────────────────

test('#918 §3.8: a CMS contract runs before its first paid charge: in the month table from its creation, and in the recurring total', () => {
  const contract = sub({ id: 'k', origin: 'cms_contract', status: 'pending_payment', paidAt: null, createdAt: '2026-10-08T22:00:00Z', charges: [] })
  assert.equal(activeInMonth(contract, '2026-10'), true)
  assert.equal(activeInMonth(contract, '2026-09'), false, 'not before the row exists')
  const totals = summarizePlaceMonth({ month: '2026-10', subscriptions: [contract], payoutsPaid: [] })
  assert.equal(totals.recurringCents, 10_000)
  assert.equal(totals.receivedCents, 0)
  // a portal pending_payment is a checkout draft: out of both
  const draft = sub({ id: 'd', status: 'pending_payment', paidAt: null, createdAt: '2026-10-08T22:00:00Z', charges: [] })
  assert.equal(activeInMonth(draft, '2026-10'), false)
  assert.equal(summarizePlaceMonth({ month: '2026-10', subscriptions: [draft], payoutsPaid: [] }).recurringCents, 0)
})

test('#918 §3.8: a paid CMS contract charge counts in received and inflow, and in the filters, like any charge', () => {
  const contract = sub({
    id: 'k',
    origin: 'cms_contract',
    paidAt: '2026-10-19T15:00:00Z',
    charges: [charge({ providerPaymentId: 'pay_oct', paidOn: '2026-10-19', dueDate: '2026-10-20' }), charge({ providerPaymentId: 'pay_sep', status: 'overdue', paidOn: null, dueDate: '2026-09-20' })],
  })
  const totals = summarizePlaceMonth({ month: '2026-10', subscriptions: [contract], payoutsPaid: [] })
  assert.equal(totals.receivedCents, 10_000)
  assert.equal(totals.inflowCents, 10_000)
  assert.equal(totals.recurringCents, 10_000)
  assert.equal(matchesFilter(contract, 'overdue'), true)
  assert.equal(matchesFilter(contract, 'without_invoice'), true)
  assert.equal(matchesFilter(sub({ origin: 'cms_contract', canceledAt: '2026-11-01T00:00:00Z' }), 'canceled'), true)
  // and in the client's real revenue (profitability)
  assert.equal(receivedByClient([contract]).get('client-1'), 10_000)
})
