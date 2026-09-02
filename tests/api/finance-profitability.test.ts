/**
 * O veredito — este parceiro se paga, e o que a tela tem o direito de afirmar.
 *
 * Mutations that turn this suite red:
 *  · responder `prejuízo` sobre um custo incompleto, em vez de dizer que o custo está incompleto;
 *  · contar meses de receita a partir de um parceiro sem data de aprovação;
 *  · fundir `não paga e não trouxe ninguém` com `não paga mas trouxe quem comprou`;
 *  · afirmar `só custo` quando a leitura de compras não respondeu — isso acusa por permissão;
 *  · contar mês parcial como mês faturado;
 *  · ler `monthly_fee_cents` nulo como zero, ou zero como mensalidade;
 *  · somar a taxa padrão dentro do custo direto;
 *  · devolver CAC infinito, ou CAC zero, quando ninguém foi adquirido;
 *  · somar duas moedas num total só;
 *  · converter minutos comprados em reais em qualquer lugar da Fase 1;
 *  · somar `null` minutos como zero num total de minutos.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  assessClient,
  suppressSmallCohortPurchases,
  wholeMonthsBetween,
  PURCHASE_MIN_COHORT,
  type ClientFinanceFacts,
  type ConsumptionRecord,
} from '@/lib/finance/profitability'
import { summarizeCohorts } from '@/lib/finance/cohort'
import { summarizeFinance, summarizeStock } from '@/lib/finance/summary'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const NOW = '2026-09-01'

/** 30 displays a R$ 5,00 com 2 QR de R$ 0,10 cada: R$ 156,00 de custo direto. */
function line(over: Partial<ConsumptionRecord> = {}): ConsumptionRecord {
  return {
    productId: over.productId ?? 'display_mesa',
    quantity: over.quantity ?? 30,
    unitCostCents: over.unitCostCents === undefined ? 500 : over.unitCostCents,
    componentCostCents: over.componentCostCents ?? 600,
    standardCostCents: over.standardCostCents ?? 0,
    currency: over.currency ?? 'BRL',
    components: over.components ?? [{ productId: 'qr_code', quantityPerUnit: 2 }],
  }
}

function facts(over: Partial<ClientFinanceFacts> = {}): ClientFinanceFacts {
  return {
    clientId: over.clientId ?? 'client-1',
    clientName: over.clientName ?? 'Baires Bistrô',
    approvedAt: over.approvedAt === undefined ? '2026-06-01' : over.approvedAt,
    stance: over.stance ?? 'paying',
    monthlyFeeCents: over.monthlyFeeCents === undefined ? 10_000 : over.monthlyFeeCents,
    consumption: over.consumption ?? [line()],
    costEntries: over.costEntries ?? [],
    ordersAwaitingShipment: over.ordersAwaitingShipment ?? 0,
    linkedByPartnerId: over.linkedByPartnerId ?? 12,
    linkedByClientId: over.linkedByClientId ?? 2,
    usersWithPurchase: over.usersWithPurchase === undefined ? 3 : over.usersWithPurchase,
    purchasedMinutes: over.purchasedMinutes === undefined ? 1_800 : over.purchasedMinutes,
  }
}

test('o piso de k esconde a compra de uma pessoa identificável, e só ela', () => {
  assert.equal(PURCHASE_MIN_COHORT, 5, 'o mesmo k de `core.coordinator_city_breakdown`')

  // 1 adquirido, 1 comprador: isto não é uma estatística, é a compra de UMA pessoa ao lado do
  // nome do bar onde ela esteve.
  const exposto = suppressSmallCohortPurchases(
    facts({ linkedByPartnerId: 1, usersWithPurchase: 1, purchasedMinutes: 600 })
  )
  assert.equal(exposto.purchaseSuppressed, true)
  assert.equal(exposto.usersWithPurchase, 1, 'colapsa em ≥1, e a tela escreve o ≥')
  assert.equal(exposto.purchasedMinutes, null, 'os minutos são a coluna que mais identifica')

  // Colapsa a MAGNITUDE, não a presença: 4 compradores em 4 adquiridos também vira ≥1.
  const quatro = suppressSmallCohortPurchases(
    facts({ linkedByPartnerId: 4, usersWithPurchase: 4, purchasedMinutes: 2_400 })
  )
  assert.equal(quatro.usersWithPurchase, 1)
  assert.equal(quatro.purchasedMinutes, null)

  // No piso, passa inteiro: k é 5, e 5 não é menos que 5.
  const noPiso = suppressSmallCohortPurchases(
    facts({ linkedByPartnerId: 5, usersWithPurchase: 2, purchasedMinutes: 900 })
  )
  assert.equal(noPiso.purchaseSuppressed, false)
  assert.equal(noPiso.usersWithPurchase, 2)
  assert.equal(noPiso.purchasedMinutes, 900)

  // Sem comprador não há pessoa exposta. Marcar esta linha como suprimida faria o total da tela
  // virar piso sem que nada tivesse sido escondido.
  const semCompra = suppressSmallCohortPurchases(
    facts({ linkedByPartnerId: 1, usersWithPurchase: 0, purchasedMinutes: 0 })
  )
  assert.equal(semCompra.purchaseSuppressed, false)
  assert.equal(semCompra.usersWithPurchase, 0)

  // `null` é ausência de leitura e continua sendo. Suprimir aqui transformaria "não sei" em
  // "omiti", que são coisas diferentes e mandam o operador para atos diferentes.
  const semLeitura = suppressSmallCohortPurchases(
    facts({ linkedByPartnerId: 1, usersWithPurchase: null, purchasedMinutes: null })
  )
  assert.equal(semLeitura.purchaseSuppressed, false)
  assert.equal(semLeitura.usersWithPurchase, null)
})

test('o piso de k não muda veredito nenhum — é essa a razão de ele poder existir', () => {
  const base = { stance: 'not_paying' as const, monthlyFeeCents: null, linkedByPartnerId: 1 }

  // `decide()` lê desta coluna apenas o booleano `> 0`. Com 3 ou com ≥1 colapsado, o veredito é
  // o mesmo — o piso destrói a magnitude e não toca no julgamento do parceiro.
  const cru = assessClient(facts({ ...base, usersWithPurchase: 3, purchasedMinutes: 1_800 }), NOW)
  const suprimido = assessClient(
    suppressSmallCohortPurchases(facts({ ...base, usersWithPurchase: 3, purchasedMinutes: 1_800 })),
    NOW
  )
  assert.equal(cru.verdict, 'non_monetary_return')
  assert.equal(suprimido.verdict, cru.verdict, 'o veredito sobrevive intacto ao piso')
  assert.equal(suprimido.purchaseSuppressed, true)
  assert.equal(cru.purchaseSuppressed, false, 'sem passar pelo piso, a linha não se diz suprimida')

  // E quem não comprou segue acusado de não ter rendido, não de ter sido omitido.
  const semRetorno = assessClient(
    suppressSmallCohortPurchases(facts({ ...base, usersWithPurchase: 0, purchasedMinutes: 0 })),
    NOW
  )
  assert.equal(semRetorno.verdict, 'no_return')
})

test('um parceiro suprimido torna o total do topo um piso, e a tela precisa saber', () => {
  const suprimido = assessClient(
    suppressSmallCohortPurchases(
      facts({ clientId: 'a', linkedByPartnerId: 1, usersWithPurchase: 1, purchasedMinutes: 600 })
    ),
    NOW
  )
  const inteiro = assessClient(
    facts({ clientId: 'b', linkedByPartnerId: 20, usersWithPurchase: 4, purchasedMinutes: 2_400 }),
    NOW
  )

  const misto = summarizeFinance([suprimido, inteiro])
  assert.equal(misto.purchaseIsFloor, true, 'um parceiro suprimido basta para o total virar piso')
  assert.equal(misto.usersWithPurchase, 5, '1 colapsado + 4 — e por isso é piso, não fato')
  assert.equal(misto.purchasedMinutes, 2_400, 'os 600 minutos suprimidos não entram na soma')

  const limpo = summarizeFinance([inteiro])
  assert.equal(limpo.purchaseIsFloor, false, 'sem supressão, o total é o total')
})

test('meses inteiros: o mês parcial não é faturado', () => {
  assert.equal(wholeMonthsBetween('2026-06-01', '2026-09-01'), 3)
  assert.equal(wholeMonthsBetween('2026-06-15', '2026-09-01'), 2, 'faltam 14 dias para o terceiro')
  assert.equal(wholeMonthsBetween('2026-08-31', '2026-09-01'), 0, 'um dia não é um mês')
  assert.equal(wholeMonthsBetween('2026-12-01', '2026-09-01'), 0, 'o futuro não fatura')
})

test('paga e o acumulado já cobriu o custo — `profitable`', () => {
  const result = assessClient(facts(), NOW)

  assert.equal(result.verdict, 'profitable')
  assert.equal(result.directCostCents, 15_600)
  assert.equal(result.monthsBilled, 3)
  assert.equal(result.revenueCents, 30_000)
  assert.equal(result.marginCents, 14_400)
  assert.equal(result.paybackMonths, 2, 'R$ 156 a R$ 100/mês se paga no segundo mês')
})

test('paga e ainda não cobriu — `payback_pending`, com os meses que faltam', () => {
  const result = assessClient(facts({ monthlyFeeCents: 2_000 }), NOW)

  assert.equal(result.verdict, 'payback_pending')
  assert.equal(result.revenueCents, 6_000)
  assert.equal(result.marginCents, -9_600)
  assert.equal(result.paybackMonths, 8)
})

test('não paga e a leitura de compras não respondeu — `unknown_return`, não uma acusação', () => {
  const result = assessClient(
    facts({
      stance: 'not_paying',
      monthlyFeeCents: null,
      usersWithPurchase: null,
      purchasedMinutes: null,
    }),
    NOW
  )

  assert.equal(result.verdict, 'unknown_return')
  assert.notEqual(result.verdict, 'no_return', '`null` compradores não é zero compradores')
  assert.equal(result.directCostCents, 15_600, 'e o custo, que é o motivo do módulo, continua inteiro')
})

test('não paga e não trouxe ninguém que comprasse — `no_return`, o só prejuízo', () => {
  const result = assessClient(
    facts({ stance: 'not_paying', monthlyFeeCents: null, usersWithPurchase: 0 }),
    NOW
  )

  assert.equal(result.verdict, 'no_return')
  assert.equal(result.revenueCents, 0)
  assert.equal(result.paybackMonths, null, 'não há mensalidade para dividir o custo')
})

test('não paga, mas trouxe quem comprou — `non_monetary_return`, e não é a mesma coisa', () => {
  const result = assessClient(
    facts({ stance: 'not_paying', monthlyFeeCents: null, usersWithPurchase: 4 }),
    NOW
  )

  assert.equal(result.verdict, 'non_monetary_return')
  assert.equal(result.usersWithPurchase, 4)
  assert.equal(result.purchasedMinutes, 1_800, 'o retorno existe, e o CMS só sabe medi-lo em minutos')
})

test('uma linha sem preço torna todo total um piso — `uncosted` responde primeiro', () => {
  const result = assessClient(
    facts({ consumption: [line(), line({ productId: 'adesivo', unitCostCents: null })] }),
    NOW
  )

  assert.equal(result.verdict, 'uncosted', 'antes de qualquer leitura de rentabilidade')
  assert.equal(result.unpricedLines, 1)
  assert.equal(result.directCostCents, 15_600, 'a linha sem preço não soma zero: ela não soma')
})

test('sem data de aprovação não há meses — `undated`, e não payback zero', () => {
  const result = assessClient(facts({ approvedAt: null }), NOW)

  assert.equal(result.verdict, 'undated')
  assert.equal(result.monthsBilled, 0)
  assert.equal(result.revenueCents, 0)
})

test('mensalidade nula não é zero, e zero não é mensalidade', () => {
  const noFee = assessClient(facts({ monthlyFeeCents: null, usersWithPurchase: 0 }), NOW)
  const zeroFee = assessClient(facts({ monthlyFeeCents: 0, usersWithPurchase: 0 }), NOW)

  assert.equal(noFee.verdict, 'no_return')
  assert.equal(zeroFee.verdict, 'no_return', 'um zero registrado também não fatura')
  assert.equal(noFee.revenueCents, 0)
})

test('a taxa padrão anda ao lado e nunca dentro do custo direto', () => {
  const result = assessClient(
    facts({ consumption: [line({ standardCostCents: 600 })] }),
    NOW
  )

  assert.equal(result.directCostCents, 15_600)
  assert.equal(result.standardCostCents, 600)
  assert.equal(result.marginCents, 30_000 - 15_600, 'a margem lê o custo direto, não o absorvido')
})

test('CAC é o custo por adquirido, e com zero adquiridos ele é `null`', () => {
  assert.equal(assessClient(facts({ linkedByPartnerId: 12 }), NOW).cacCents, 1_300)
  assert.equal(
    assessClient(facts({ linkedByPartnerId: 0 }), NOW).cacCents,
    null,
    'nem infinito, nem zero: um parceiro que não adquire não tem custo por aquisição'
  )
})

test('moedas não se somam, e a ignorada volta nomeada', () => {
  const result = assessClient(
    facts({
      consumption: [line(), line({ currency: 'EUR', unitCostCents: 900 })],
      costEntries: [{ amountCents: 5_000, currency: 'EUR' }],
    }),
    NOW
  )

  assert.equal(result.currency, 'EUR', 'a moeda mais frequente entre os lançamentos')
  assert.deepEqual(result.ignoredCurrencies, ['BRL'])
  assert.equal(result.directCostCents, 30 * 900 + 600 + 5_000)
})

test('a equipe do parceiro não é aquisição, e por isso é outra coluna', () => {
  const result = assessClient(facts({ linkedByPartnerId: 12, linkedByClientId: 2 }), NOW)

  assert.equal(result.linkedByPartnerId, 12)
  assert.equal(result.linkedByClientId, 2)
  assert.equal(result.cacCents, 1_300, 'o CAC divide só pelos adquiridos')
})

test('compradores ausentes não somam zero no total', () => {
  const unanswered = summarizeFinance([
    assessClient(facts({ clientId: 'a', usersWithPurchase: null }), NOW),
  ])
  assert.equal(unanswered.usersWithPurchase, null)

  const mixed = summarizeFinance([
    assessClient(facts({ clientId: 'a', usersWithPurchase: null }), NOW),
    assessClient(facts({ clientId: 'b', usersWithPurchase: 2 }), NOW),
  ])
  assert.equal(mixed.usersWithPurchase, 2)
})

test('o total do topo é a soma da mesma lista que a tabela desenha', () => {
  const clients = [
    assessClient(facts({ clientId: 'a' }), NOW),
    assessClient(facts({ clientId: 'b', monthlyFeeCents: 2_000 }), NOW),
  ]

  const summary = summarizeFinance(clients)

  assert.equal(summary.partners, 2)
  assert.equal(summary.directCostCents, 31_200)
  assert.equal(summary.revenueCents, 36_000)
  assert.equal(summary.marginCents, 4_800)
  assert.equal(summary.byVerdict.profitable, 1)
  assert.equal(summary.byVerdict.payback_pending, 1)
  assert.equal(summary.acquiredUsers, 24)
  assert.equal(summary.cacCents, 1_300)
})

test('minutos ausentes não somam zero no total', () => {
  const summary = summarizeFinance([
    assessClient(facts({ clientId: 'a', purchasedMinutes: null }), NOW),
  ])
  assert.equal(summary.purchasedMinutes, null)

  const mixed = summarizeFinance([
    assessClient(facts({ clientId: 'a', purchasedMinutes: null }), NOW),
    assessClient(facts({ clientId: 'b', purchasedMinutes: 600 }), NOW),
  ])
  assert.equal(mixed.purchasedMinutes, 600)
})

test('a coorte agrupa pelo mês de entrada, e quem não tem data fica de fora dela', () => {
  const report = summarizeCohorts([
    assessClient(facts({ clientId: 'a', approvedAt: '2026-06-10' }), NOW),
    assessClient(facts({ clientId: 'b', approvedAt: '2026-06-20', monthlyFeeCents: 2_000 }), NOW),
    assessClient(facts({ clientId: 'c', approvedAt: '2026-08-02' }), NOW),
    assessClient(facts({ clientId: 'd', approvedAt: null }), NOW),
  ])

  assert.deepEqual(
    report.lines.map((cohort) => cohort.month),
    ['2026-08', '2026-06'],
    'do mais recente para o mais antigo'
  )
  assert.equal(report.lines[1].clients, 2)
  assert.equal(report.lines[1].profitable, 1)
  assert.equal(report.lines[1].paybackPending, 1)
  assert.equal(report.undated, 1, 'contado à parte para não sumir')
})

test('comprado menos consumido: as etiquetas saem do snapshot, não de `quantity`', () => {
  const products = [
    {
      id: 'display_mesa',
      name: 'Display de mesa',
      role: 'deliverable' as const,
      materialKind: 'table_display' as const,
      purchaseUnit: 'unidade',
      isActive: true,
    },
    {
      id: 'qr_code',
      name: 'QR code',
      role: 'component' as const,
      materialKind: null,
      purchaseUnit: 'bobina',
      isActive: true,
    },
  ]

  const stock = summarizeStock(
    products,
    [
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
        // 1 bobina que rendeu 500 etiquetas — o rendimento é da COMPRA, não do cadastro.
        units: 1,
        unitsYield: 500,
        pieces: 500,
        totalCents: 5_000,
        freightCents: 0,
        currency: 'BRL',
        purchasedAt: '2026-08-01',
      },
    ],
    [line()]
  )

  const qr = stock.find((row) => row.productId === 'qr_code')
  const display = stock.find((row) => row.productId === 'display_mesa')

  assert.equal(display?.consumedPieces, 30)
  assert.equal(display?.remainingPieces, 70)
  assert.equal(qr?.consumedPieces, 60, '30 displays × 2 etiquetas — invisível em `quantity`')
  assert.equal(qr?.remainingPieces, 440)
})

test('nada na Fase 1 converte minutos em dinheiro', () => {
  for (const file of ['profitability.ts', 'summary.ts', 'cohort.ts', 'structure.ts']) {
    const source = code(`lib/finance/${file}`)
    assert.ok(
      !/minutes?\s*\*|\*\s*minutes?|minutesToCents|centsPerMinute/i.test(source),
      `${file} multiplica minutos por dinheiro — o valor da compra do app não existe no CMS`
    )
  }
})
