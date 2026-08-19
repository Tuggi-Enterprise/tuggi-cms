/**
 * The two money questions the contract used to leave open — and the literal it used to answer
 * on its own.
 *
 * WHEN THE MONTHLY FEE IS DUE. `payment_default` counts tolerance, dunning and suspension "from
 * the due date" (BR-B2B-019, item 2), and no clause ever said which day that was: the whole
 * 10/1/7/11 ladder hung off a marker the document did not fix. The operator set it on
 * 2026-08-18 — day 20, invoice at the start of the month — to give finance one date.
 *
 * WHICH PERCENTAGE IS OWED. The contract prints the commission from the snapshot, and
 * BR-MONETIZACAO-039's edge case says the apuração uses the percentage registered on the day it
 * runs. Two rulers for the same number, with legal effect: the operator lowers
 * `partner.clients.commission_rate` and the signed instrument still says the old figure. The
 * contract now freezes it under the same doctrine BR-B2B-017 already applies to the fee — an
 * aditivo with a new acceptance — and `produto` has to align the rule's edge case.
 *
 * AND NO CODE DECLARES EITHER NUMBER. BR-MONETIZACAO-039, item 2, and BR-B2B-017, item 3, say it
 * for the percentage and for the price. Three files applied 20% silently to every client created.
 *
 * Mutations that turn this suite red:
 *  · dropping the due day, or the business-day rule that follows it;
 *  · letting the first invoice cover a period before publication (BR-B2B-018, item 2);
 *  · removing the aditivo protection from the commission;
 *  · putting a percentage literal back into the CMS.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  DUE_DAY_OF_MONTH,
  FACTUAL_CORRECTION_BUSINESS_DAYS,
  LATE_FINE_PERCENT,
  LIABILITY_CAP_MONTHS,
  OUTAGE_CREDIT_DAYS,
  TERMINATION_FOR_DEFAULT_DAYS,
  activeTemplate,
  renderClauses,
} from '@/lib/contract/template'
import { DEFAULT_COMMISSION_RATE } from '@/types/clients'
import type { ContractSnapshot } from '@/lib/contract/snapshot'

const read = (path: string) => readFileSync(resolve(import.meta.dirname, '../..', path), 'utf8')

/**
 * The source WITHOUT its comments. A ruler that reads prose measures the prose, and the note
 * above this very field explains at length the `max="1"` it replaced.
 */
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

function snapshot(overrides: Partial<ContractSnapshot> = {}): ContractSnapshot {
  return {
    templateVersion: activeTemplate().version,
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
    monthlyFeeCents: 10000,
    isCourtesy: false,
    courtesyReason: null,
    paymentMethod: 'pix',
    commissionRate: 0.1,
    qrDeliveryDays: 30,
    generatedAt: '2026-08-18T12:00:00.000Z',
    ...overrides,
  }
}

const textOf = (s: ContractSnapshot, id: string) =>
  renderClauses(s).find((clause) => clause.id === id)?.paragraphs.join(' ') ?? ''

test('the monthly fee has a due day, and the ladder of BR-B2B-019 finally hangs off something', () => {
  assert.equal(DUE_DAY_OF_MONTH, 20)

  const price = textOf(snapshot(), 'price_and_payment')
  assert.match(price, /vence no dia 20 de cada mês/)
  assert.match(price, /corresponde ao mês\s+em que vence|corresponde ao mês em que vence/)
  // A due date that lands on a Sunday is not a default: the partner may pay on the next
  // business day, and nothing is charged for it.
  assert.match(price, /sábado, domingo ou feriado bancário/)
  assert.match(price, /sem qualquer encargo/)

  // The suspension clause counts from this date and says so in the same document.
  assert.match(textOf(snapshot(), 'payment_default'), /contados do vencimento/)
})

test('the first invoice never reaches back before the publication — BR-B2B-018, item 2', () => {
  const price = textOf(snapshot(), 'price_and_payment')
  assert.match(price, /O primeiro vencimento é o dia 20 do mês seguinte ao da publicação/)
  assert.match(price, /período\s+proporcional entre a data da publicação|proporcional entre a data da publicação/)

  // And the clause that promises it stays intact: nothing is charged before the place is on air.
  assert.match(
    textOf(snapshot(), 'term'),
    /Não há cobrança pela adesão, pelo envio de informações nem pelo período que anteceder a publicação/
  )
})

test('the commission is frozen by the same doctrine as the fee, and says when it is paid', () => {
  const commission = textOf(snapshot(), 'commission')

  // A2: without this, `partner.clients.commission_rate` and the signed instrument are two rulers
  // for one number.
  assert.match(commission, /depende de\s+termo aditivo com novo aceite|termo aditivo com novo aceite/)
  assert.match(commission, /nenhuma alteração de cadastro interno/)

  // "Na forma acordada entre as partes" pointed at an agreement that did not exist. The
  // apuração now has a period, a statement, a deadline and a means of payment.
  assert.match(commission, /apuração é mensal/)
  assert.match(commission, /demonstrativo/)
  assert.match(commission, /até o dia 10/)
  assert.match(commission, /último dia útil/)
})

test('the commission clause reaches BOTH tiers — the free partner is promised it too', () => {
  for (const tier of ['free', 'paid'] as const) {
    const ids = renderClauses(snapshot({ tier })).map((clause) => clause.id)
    assert.ok(ids.indexOf('commission') >= 0, `${tier} must carry the commission clause`)
  }
  // And the fee clauses are the only ones the free tier does not get.
  const free = renderClauses(snapshot({ tier: 'free' })).map((clause) => clause.id)
  assert.equal(free.indexOf('price_and_payment'), -1)
  assert.equal(free.indexOf('payment_default'), -1)
})

test('the default percentage is declared once, and no surface writes its own', () => {
  // A starting value the operator set on 2026-08-18, editable per partner, living in the CMS
  // so the contract can be produced fast. What may not come back is `0.200` in three files at
  // once — the shape BR-MONETIZACAO-039, item 2, exists to prevent, and the `kRetryDelayMs`
  // defect of §6.
  assert.equal(DEFAULT_COMMISSION_RATE, 0.1)

  const offenders: string[] = []
  for (const file of [
    'app/api/admin/clients/route.ts',
    'components/admin/clients/ClientEditorModal.tsx',
    'components/admin/clients/tabs/FiscalPaymentsTab.tsx',
  ]) {
    if (/commission_rate['"]?\s*[:,]?\s*(\?\?\s*)?0\.\d/.test(read(file))) offenders.push(file)
  }
  assert.deepEqual(offenders, [], 'these write a percentage of their own')

  // And the two that seed a registration read the constant rather than a number.
  for (const file of ['app/api/admin/clients/route.ts', 'components/admin/clients/ClientEditorModal.tsx']) {
    assert.match(read(file), /DEFAULT_COMMISSION_RATE/, file)
  }
})

test('the operator types a percentage, and the column keeps the rate', () => {
  const form = code('components/admin/clients/tabs/FiscalPaymentsTab.tsx')

  // `max="1"` under a label that reads `Taxa de comissão` invited a factor-of-ten mistake.
  assert.match(form, /max="100"/)
  assert.equal(form.indexOf('max="1"'), -1)
  // Typed 10 → stored 0.1; stored 0.1 → shown 10. Rounded, because 0.07 * 100 is not 7 in
  // binary floating point.
  assert.match(form, /Math\.round\(parseFloat\(typed\) \* 10\) \/ 1000/)
  assert.match(form, /Math\.round\(commissionRate \* 1000\) \/ 10/)

  // And the help text stops asking for a fraction.
  for (const locale of ['pt', 'en', 'es']) {
    const help = JSON.parse(read(`messages/${locale}.json`)).Clients.fiscal.fields.commissionRateHelp
    assert.equal(/0[.,]20/.test(help), false, `${locale} still asks for a fraction`)
    assert.match(help, /10/)
  }
})

// ── As cláusulas que o parecer de 2026-08-18 apontou como ausentes ────────────────────────────
//
// MINUTA, e a redação final é do advogado — como o resto do template diz de si. O que estas
// asserções seguram não é a redação: é que cada número da minuta saia de uma constante nomeada,
// para que a revisão jurídica seja uma linha e não uma caçada dentro de parágrafo.

test('a inadimplência tem uma saída, e o encargo só aparece no fim', () => {
  const text = textOf(snapshot(), 'payment_default')

  // O remédio real é a suspensão, e a escada parava nela: no 60º dia o contrato seguia vigente,
  // com o ponto no ar e a comissão correndo, e a TUGGI sem remédio além de esperar.
  assert.match(text, new RegExp(`${TERMINATION_FOR_DEFAULT_DAYS} dias corridos`))
  assert.match(text, /poderá rescindir/)
  // E a ambiguidade que o parecer nomeou: a suspensão interrompe a cobrança?
  assert.match(text, /A suspensão da descrição não interrompe a contraprestação/)

  // A MULTA NÃO CORRE MÊS A MÊS. Decisão do operador em 2026-08-18: cobrar centavos de mora
  // custa mais do que arrecada, e cláusula que nunca se aplica é pior que cláusula ausente —
  // a tolerância repetida vira expectativa legítima. Ela é escopada ao débito da rescisão.
  assert.match(text, new RegExp(`Rescindido este contrato por inadimplência[\\s\\S]*multa de ${LATE_FINE_PERCENT}%`))
  assert.equal(/pro rata die a partir do vencimento/.test(text), false)

  // Juros não viram número no contrato: com vencimento certo a mora é automática (CC 397/406).
  assert.match(text, /juros legais de mora/)
  assert.equal(/% ao mês/.test(text), false)

  // E a defesa contra a supressio, que é o que permite não cobrar sem perder o direito.
  assert.match(text, /não[\s\S]*importe novação, renúncia/)
})

test('a responsabilidade tem teto, a disponibilidade tem verdade, e o teto tem exceções', () => {
  const paid = textOf(snapshot(), 'liability')

  assert.match(paid, /não promete disponibilidade ininterrupta/)
  assert.match(paid, new RegExp(`superior a ${OUTAGE_CREDIT_DAYS} dias corridos`))
  assert.match(paid, /lucros cessantes/)
  assert.match(paid, new RegExp(`nos\\s+${LIABILITY_CAP_MONTHS} meses anteriores`))
  // Um teto sem estas ressalvas é o que o art. 424 fulmina — e a LGPD não se limita por contrato.
  assert.match(paid, /dolo, a culpa grave/)
  assert.match(paid, /13\.709\/2018/)
  assert.match(paid, /art\. 393 do Código Civil/)

  // Na faixa gratuita não há mensalidade, então um teto de 12 mensalidades seria teto zero —
  // renúncia antecipada disfarçada de número.
  const free = textOf(snapshot({ tier: 'free', monthlyFeeCents: null }), 'liability')
  assert.equal(new RegExp(`${LIABILITY_CAP_MONTHS} meses`).test(free), false)
  assert.match(free, /respondem nos termos da lei/)
})

test('o aviso tem canal, endereço e prazo de recebimento', () => {
  const text = textOf(snapshot(), 'notices')

  // `mediante aviso à outra parte`, sem canal e sem endereço, era o ponto de disputa mais
  // provável do contrato inteiro.
  assert.match(text, /por escrito e por\s+correio eletrônico/)
  assert.match(text, /Ana/, 'o aviso nomeia o representante para quem o contrato foi enviado')
  assert.match(text, /primeiro dia\s+útil seguinte ao do envio/)
  assert.match(text, /mensagem por aplicativo de conversa/)
})

test('a curadoria ganhou o contraponto que faltava, e o preço diz bruto e nota fiscal', () => {
  assert.match(
    textOf(snapshot(), 'curation'),
    new RegExp(`erro factual[\\s\\S]*${FACTUAL_CORRECTION_BUSINESS_DAYS} dias úteis`)
  )
  const price = textOf(snapshot(), 'price_and_payment')
  assert.match(price, /valor acima é bruto/)
  assert.match(price, /documento fiscal/)
})
