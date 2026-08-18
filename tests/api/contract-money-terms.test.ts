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
 * `core.clients.commission_rate` and the signed instrument still says the old figure. The
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

import { DUE_DAY_OF_MONTH, activeTemplate, renderClauses } from '@/lib/contract/template'
import type { ContractSnapshot } from '@/lib/contract/snapshot'

const read = (path: string) => readFileSync(resolve(import.meta.dirname, '../..', path), 'utf8')

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

  // A2: without this, `core.clients.commission_rate` and the signed instrument are two rulers
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

test('no code in the CMS declares a commission percentage — BR-MONETIZACAO-039, item 2', () => {
  const offenders: string[] = []
  for (const file of [
    'app/api/admin/clients/route.ts',
    'components/admin/clients/ClientEditorModal.tsx',
    'components/admin/clients/tabs/FiscalPaymentsTab.tsx',
  ]) {
    // `commission_rate` next to a number literal is the defect the rule names — a default
    // nobody decided, applied in silence.
    if (/commission_rate['"]?\s*[:,]?\s*(\?\?\s*)?0\.\d/.test(read(file))) offenders.push(file)
  }
  assert.deepEqual(offenders, [], 'these apply a percentage nobody decided')
})
