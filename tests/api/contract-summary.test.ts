/**
 * O quadro `O que você está aceitando` — e a razão de ele ser derivado, nunca escrito.
 *
 * O QUE ELE RESOLVE. O contrato tem 17 cláusulas e ~1.600 palavras. Para saber quanto paga,
 * quando vence e como sai, o dono do restaurante lia três cláusulas inteiras no celular. A
 * leitura já estava garantida pela spec do `design` (§4.2); o que faltava era a resposta antes
 * dela.
 *
 * O QUE ESTE TESTE PROTEGE, e é uma coisa só: **o resumo não pode divergir da cláusula**. Num
 * contrato de adesão, o que diverge é lido contra quem redigiu (art. 423 do Código Civil), então
 * um resumo escrito à mão seria munição em vez de defesa. Derivado do mesmo `snapshot`, ele
 * repete os mesmos números — e é isso que as asserções abaixo medem: valor, percentual, dia do
 * vencimento e prazo de saída, comparados contra as constantes e contra o texto das cláusulas.
 *
 * Mutações que deixam esta suíte vermelha:
 *  · cravar o valor, o percentual ou o dia no resumo em vez de derivá-los;
 *  · prometer descrição na faixa gratuita, ou cobrança onde não há;
 *  · apontar uma linha para uma cláusula que aquela faixa não recebe;
 *  · perder a ressalva, que é o que impede o resumo de ser lido como o contrato;
 *  · deixar de destacar uma cláusula que restringe o parceiro.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  SUMMARY_DISCLAIMER,
  buildContractSummary,
  type SummaryRow,
} from '@/lib/contract/summary'
import {
  ACTIVE_TEMPLATE_VERSION,
  DUE_DAY_OF_MONTH,
  RESTRICTIVE_CLAUSE_IDS,
  TERMINATION_NOTICE_DAYS,
  renderClauses,
} from '@/lib/contract/template'
import { formatCommissionRate, formatFee, type ContractSnapshot } from '@/lib/contract/snapshot'

function snapshot(overrides: Partial<ContractSnapshot> = {}): ContractSnapshot {
  return {
    templateVersion: ACTIVE_TEMPLATE_VERSION,
    tier: 'paid',
    provider: {
      legalName: 'Tuggi Tecnologia Ltda',
      taxId: '11222333000144',
      addressLine: 'Rua X, 10',
      representativeName: 'Marta',
      representativeRole: 'Sócia',
    },
    partner: {
      clientId: 'c1',
      legalName: 'Restaurante do Porto Ltda',
      tradeName: 'Restaurante do Porto',
      taxId: '12345678000190',
      addressLine: 'Av. Y, 200',
      representativeName: 'Ana',
      representativeRole: 'Sócia',
    },
    monthlyFeeCents: 24900,
    isCourtesy: false,
    courtesyReason: null,
    paymentMethod: 'pix',
    commissionRate: 0.1,
    qrDeliveryDays: 30,
    generatedAt: '2026-08-18T12:00:00.000Z',
    ...overrides,
  }
}

const rowOf = (rows: SummaryRow[], id: string) => {
  const row = rows.find((candidate) => candidate.id === id)
  assert.ok(row, `o resumo deveria ter a linha \`${id}\``)
  return row!
}

test('o resumo repete os números da cláusula, porque sai da mesma fonte', () => {
  const s = snapshot({ monthlyFeeCents: 24900, commissionRate: 0.1 })
  const rows = buildContractSummary(s)
  const clauses = renderClauses(s)
  const price = clauses.find((clause) => clause.id === 'price_and_payment')!.paragraphs.join(' ')
  const commission = clauses.find((clause) => clause.id === 'commission')!.paragraphs.join(' ')

  // O valor do resumo é o valor da cláusula, formatado pela MESMA função — comparar contra a
  // função e não contra um literal é o que impede o teste de aceitar duas grafias do mesmo número.
  const fee = formatFee(24900)
  assert.ok(rowOf(rows, 'price').value.includes(fee), `resumo deveria conter ${fee}`)
  assert.ok(price.includes(fee), `cláusula deveria conter ${fee}`)

  const rate = formatCommissionRate(0.1)
  assert.ok(rowOf(rows, 'commission').value.includes(rate), `resumo deveria conter ${rate}`)
  assert.ok(commission.includes(rate), `cláusula deveria conter ${rate}`)

  // O dia e o prazo vêm das constantes, não de um literal digitado duas vezes.
  assert.match(rowOf(rows, 'due').value, new RegExp(`dia ${DUE_DAY_OF_MONTH}`))
  assert.match(rowOf(rows, 'exit').value, new RegExp(`${TERMINATION_NOTICE_DAYS} dias`))
})

test('a faixa gratuita não é resumida como se pagasse, nem como se recebesse descrição', () => {
  const rows = buildContractSummary(snapshot({ tier: 'free', monthlyFeeCents: null }))

  assert.match(rowOf(rows, 'price').value, /Nada/)
  assert.match(rowOf(rows, 'due').value, /Não há cobrança/)
  // BR-B2B-016: na gratuita o turista ouve nome e direção, e nada além disso.
  assert.equal(/descrição/.test(rowOf(rows, 'what').value), false)
  // E a comissão continua sendo prometida às duas faixas, como a cláusula promete.
  assert.ok(rowOf(rows, 'commission').value.includes(formatCommissionRate(0.1)))
})

test('a cortesia diz o motivo, e não vira mensalidade zero', () => {
  const rows = buildContractSummary(
    snapshot({ isCourtesy: true, monthlyFeeCents: null, courtesyReason: 'lançamento em Santos' })
  )
  assert.match(rowOf(rows, 'price').value, /cortesia/i)
  assert.match(rowOf(rows, 'price').value, /lançamento em Santos/)
  // Ausente não é zero — BR-B2B-017, item 6.
  assert.equal(/R\$\s?0,00/.test(rowOf(rows, 'price').value), false)
})

test('toda linha aponta para uma cláusula que aquela faixa realmente recebe', () => {
  for (const tier of ['free', 'paid'] as const) {
    const s = snapshot({ tier, monthlyFeeCents: tier === 'paid' ? 24900 : null })
    const ids = new Set(renderClauses(s).map((clause) => clause.id))
    for (const row of buildContractSummary(s)) {
      assert.ok(
        ids.has(row.clauseId),
        `na faixa ${tier}, a linha \`${row.id}\` aponta para \`${row.clauseId}\`, que não é renderizada`
      )
    }
  }
})

test('a ressalva existe e diz que o contrato vence o resumo', () => {
  assert.match(SUMMARY_DISCLAIMER, /não substitui o contrato/)
  assert.match(SUMMARY_DISCLAIMER, /valem as cláusulas/)
})

test('as cláusulas que restringem o parceiro chegam marcadas às duas superfícies', () => {
  const clauses = renderClauses(snapshot())
  const marked = clauses.filter((clause) => clause.restrictive).map((clause) => clause.id)
  assert.deepEqual(marked.slice().sort(), RESTRICTIVE_CLAUSE_IDS.slice().sort())

  // Texto, nunca só a cor (DS-A11Y-003) — e no PDF também, porque o destaque é medida do
  // art. 424 do Código Civil e vale sobre o instrumento, não sobre a tela.
  const read = (path: string) =>
    require('node:fs').readFileSync(require('node:path').resolve(import.meta.dirname, '../..', path), 'utf8')
  for (const file of ['components/contract/ContractText.tsx', 'lib/contract/pdf.tsx']) {
    assert.match(read(file), /clause\.restrictive/, file)
    assert.match(read(file), /LIMITA OS SEUS DIREITOS|limita os seus direitos/i, file)
  }
})

test('a faixa gratuita não destaca a cláusula de dinheiro que ela nem recebe', () => {
  const free = renderClauses(snapshot({ tier: 'free', monthlyFeeCents: null }))
  assert.equal(free.some((clause) => clause.id === 'payment_default'), false)
  // As outras quatro continuam destacadas.
  const marked = free.filter((clause) => clause.restrictive).map((clause) => clause.id)
  assert.deepEqual(marked.slice().sort(), ['brand_license', 'curation', 'non_exclusivity', 'penalties'])
})
