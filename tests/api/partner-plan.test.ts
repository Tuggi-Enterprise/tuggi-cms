/**
 * WHO PAYS, AND WHO SAID SO — the three answers, kept apart. #409.
 *
 * THE DEFECT THIS SUITE FORBIDS is one field named `plan`. Three people answer `is this one
 * paid?`: the establishment on the form (`plan_choice`), the Tuggi on the registration
 * (`monthly_fee_cents` / `is_courtesy`), and the signed contract (`tier`). They can all three
 * disagree, and `lib/partner-form/fields.ts` says in as many words that the first decides
 * nothing. A card that showed one of them under a neutral label would say `pago` about a
 * partner recorded as a courtesy.
 *
 * Mutations that turn this suite red:
 *  · reading `monthly_fee_cents` absent as zero, which publishes a partner nobody agreed to
 *    publish for free (BR-B2B-017, item 6);
 *  · treating a courtesy with no reason as a courtesy, which is an unexplained discount and is
 *    exactly what `buildPublishPlan` and `buildSnapshot` already refuse;
 *  · letting the proposal's request outrank the registration, or the registration outrank the
 *    signed contract;
 *  · counting a proposal nobody priced in the rail's `undeclared`, which would fill the filter
 *    with rows that have no answer to give;
 *  · dropping the divergence between a signed contract and a registration edited after it.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

import {
  derivePartnerPlan,
  planFacetValue,
  type PlanFacts,
} from '@/lib/clients/partner-plan'

const NO_FEE = { monthlyFeeCents: null, isCourtesy: false, courtesyReason: null }

function facts(overrides: Partial<PlanFacts> = {}): PlanFacts {
  return {
    clientId: 'client-1',
    fee: { ...NO_FEE },
    planChoice: null,
    contractTier: null,
    ...overrides,
  }
}

// ── Only a proposal: nobody has priced anything ──────────────────────────────────────────────

test('#409 · BR-B2B-016 item 1: before a client exists, the honest answer is what was ASKED FOR', () => {
  const asked = derivePartnerPlan(facts({ clientId: null, planChoice: 'map_and_description' }))
  assert.equal(asked.source, 'proposal')
  assert.equal(asked.kind, 'requested')
  assert.equal(asked.requested, 'map_and_description')
  // A request carries no value: pricing it here is the merge this module exists to prevent.
  assert.equal(asked.feeCents, null)

  const silent = derivePartnerPlan(facts({ clientId: null }))
  assert.equal(silent.kind, 'requested')
  assert.equal(silent.requested, null)
})

test('#409 · a proposal has no answer for the rail, and is not counted as `undeclared`', () => {
  // Counting it would fill the filter an operator uses to find registrations they can fix with
  // rows where there is nothing to fix yet.
  assert.equal(planFacetValue(facts({ clientId: null })), null)
  assert.equal(planFacetValue(facts({ clientId: null, planChoice: 'map_only' })), null)
})

// ── The registration ─────────────────────────────────────────────────────────────────────────

test('#409 · BR-B2B-017 item 6: absent is NOT zero — a registration nobody filled in is undeclared', () => {
  const plan = derivePartnerPlan(facts())
  assert.equal(plan.source, 'registration')
  assert.equal(plan.kind, 'undeclared')
  assert.equal(plan.feeCents, null)
  assert.equal(planFacetValue(facts()), 'undeclared')

  // AND ZERO IS NOT A FEE EITHER, which is the other half of the same rule and the one that was
  // wrong here until 2026-08-23. `lib/contract/snapshot.ts` — the file that produces the
  // instrument the partner signs — has always read it this way: `zero without the courtesy
  // decision is the same thing wearing a number`. This file read `typeof cents === 'number'`
  // and called it `paid`, and the queue card then said `O contrato não cobra e o cadastro
  // cobra` about `Sabor e Arte Restaurante` — fee 0, courtesy without a reason, free contract
  // signed. The registration charges nothing; the sentence was simply false.
  const zero = derivePartnerPlan(facts({ fee: { ...NO_FEE, monthlyFeeCents: 0 } }))
  assert.equal(zero.kind, 'undeclared')
  assert.equal(zero.feeCents, null)
  assert.equal(planFacetValue(facts({ fee: { ...NO_FEE, monthlyFeeCents: 0 } })), 'undeclared')

  // A negative and a NaN are the same thing wearing a worse number.
  assert.equal(derivePartnerPlan(facts({ fee: { ...NO_FEE, monthlyFeeCents: -1 } })).kind, 'undeclared')
  assert.equal(derivePartnerPlan(facts({ fee: { ...NO_FEE, monthlyFeeCents: NaN } })).kind, 'undeclared')
})

test('#409 · o zero do cadastro não vira divergência contra um contrato que não cobra', () => {
  // O CASO REAL, medido em 2026-08-23: `Sabor e Arte Restaurante` (`f81f01b5…`) tem
  // `monthly_fee_cents = 0`, `is_courtesy = true` sem motivo, e contrato `free` assinado. O
  // cartão da fila dizia `O contrato não cobra e o cadastro cobra` — os dois não cobram.
  const zeroSobContratoFree = derivePartnerPlan(
    facts({
      contractTier: 'free',
      fee: { monthlyFeeCents: 0, isCourtesy: true, courtesyReason: null },
    })
  )
  assert.equal(zeroSobContratoFree.source, 'contract')
  assert.equal(zeroSobContratoFree.kind, 'free')
  assert.equal(zeroSobContratoFree.divergence, null, 'nenhum dos dois cobra — não há divergência')

  // A divergência que EXISTE continua sendo dita: contrato que não cobra e cadastro com valor.
  const contratoFreeCadastroPago = derivePartnerPlan(
    facts({ contractTier: 'free', fee: { ...NO_FEE, monthlyFeeCents: 14900 } })
  )
  assert.equal(contratoFreeCadastroPago.divergence, 'free_contract_paid_registration')

  // E o zero sob contrato QUE COBRA é o outro lado: não dá para publicar sem saber quanto.
  const contratoPagoCadastroZero = derivePartnerPlan(
    facts({ contractTier: 'paid', fee: { ...NO_FEE, monthlyFeeCents: 0 } })
  )
  assert.equal(contratoPagoCadastroZero.kind, 'undeclared')
  assert.equal(contratoPagoCadastroZero.divergence, 'paid_contract_undeclared_registration')
})

test('#409 · BR-B2B-017 item 6: a courtesy with no reason is not a courtesy', () => {
  // The same reading `buildPublishPlan` and `buildSnapshot` apply. Two answers to "is this one
  // charged?" is the SSOT defect (CLAUDE.md §6).
  const unexplained = derivePartnerPlan(
    facts({ fee: { monthlyFeeCents: 14900, isCourtesy: true, courtesyReason: '   ' } })
  )
  assert.equal(unexplained.kind, 'paid')
  assert.equal(unexplained.feeCents, 14900)

  const explained = derivePartnerPlan(
    facts({
      fee: { monthlyFeeCents: 14900, isCourtesy: true, courtesyReason: 'patrocínio do festival' },
    })
  )
  // Courtesy wins over a fee that is also on the record — `buildSnapshot` freezes it that way.
  assert.equal(explained.kind, 'courtesy')
  assert.equal(explained.feeCents, null)
  assert.equal(explained.courtesyReason, 'patrocínio do festival')

  // The rail agrees with the card: an unexplained discount is filed under `paid`, so the
  // operator looking for courtesies does not find a row whose reason nobody wrote.
  const unexplainedFacts = facts({
    fee: { monthlyFeeCents: 14900, isCourtesy: true, courtesyReason: '   ' },
  })
  assert.equal(planFacetValue(unexplainedFacts), 'paid')
})

test('#409 · a paid registration reads as paid, and the rail agrees with the card', () => {
  const paid = facts({ fee: { ...NO_FEE, monthlyFeeCents: 14900 } })
  assert.equal(derivePartnerPlan(paid).kind, 'paid')
  assert.equal(derivePartnerPlan(paid).feeCents, 14900)
  assert.equal(planFacetValue(paid), 'paid')

  const courtesy = facts({
    fee: { monthlyFeeCents: null, isCourtesy: true, courtesyReason: 'parceria institucional' },
  })
  assert.equal(planFacetValue(courtesy), 'courtesy')
})

// ── The signed contract outranks the registration ────────────────────────────────────────────

test('#409 · BR-B2B-026: once a contract exists, it is what the partner signed', () => {
  const free = derivePartnerPlan(facts({ contractTier: 'free' }))
  assert.equal(free.source, 'contract')
  assert.equal(free.kind, 'free')

  // A paid tier says THAT it charges; the registration says how much.
  const paid = derivePartnerPlan(
    facts({ contractTier: 'paid', fee: { ...NO_FEE, monthlyFeeCents: 14900 } })
  )
  assert.equal(paid.source, 'contract')
  assert.equal(paid.kind, 'paid')
  assert.equal(paid.feeCents, 14900)

  // And a courtesy inside a paid tier is the shape `buildSnapshot` freezes.
  const courtesy = derivePartnerPlan(
    facts({
      contractTier: 'paid',
      fee: { monthlyFeeCents: null, isCourtesy: true, courtesyReason: 'lançamento da cidade' },
    })
  )
  assert.equal(courtesy.kind, 'courtesy')
  assert.equal(courtesy.courtesyReason, 'lançamento da cidade')
})

test('#409 · the divergence is the reason to read the line at all', () => {
  // Somebody edited the fee on the fiscal tab after the contract was signed.
  const drifted = derivePartnerPlan(
    facts({ contractTier: 'free', fee: { ...NO_FEE, monthlyFeeCents: 14900 } })
  )
  assert.equal(drifted.divergence, 'free_contract_paid_registration')

  // A contract that charges, over a registration that does not say how much: the publication
  // would have to name a value nobody wrote down (DS-COMPONENTE-021, point 2).
  const unpriced = derivePartnerPlan(facts({ contractTier: 'paid' }))
  assert.equal(unpriced.divergence, 'paid_contract_undeclared_registration')

  // Agreement is silence: a note that appears on every card is a note nobody reads.
  assert.equal(
    derivePartnerPlan(facts({ contractTier: 'paid', fee: { ...NO_FEE, monthlyFeeCents: 9900 } }))
      .divergence,
    null
  )
  assert.equal(derivePartnerPlan(facts({ contractTier: 'free' })).divergence, null)
  assert.equal(derivePartnerPlan(facts()).divergence, null)
})

test('#409 · the request never survives a client: it prices nothing', () => {
  // `lib/partner-form/fields.ts` is explicit — the tier of the contract is the operator's choice
  // at generation, and no public route writes `plan_choice` to `partner.clients`.
  const both = derivePartnerPlan(facts({ planChoice: 'map_and_description' }))
  assert.equal(both.source, 'registration')
  assert.equal(both.requested, null)
})

// ── A escolha do parceiro é decisão, e não se digita de novo ─────────────────────────────────

test('#409 · BR-B2B-016 item 1: quem escolheu `map_only` já disse que não paga', () => {
  // MEDIDO em 2026-08-23: dos 9 clientes promovidos de uma proposta que escolheu `map_only`, os
  // 9 estão com `commission_rate = 0.000` e contrato `free`. O operador vinha redigitando a
  // resposta do estabelecimento em três lugares — percentual, mensalidade e tier do contrato.
  const escolheuGratis = derivePartnerPlan(facts({ planChoice: 'map_only' }))
  assert.equal(escolheuGratis.source, 'proposal')
  assert.equal(escolheuGratis.kind, 'free')
  assert.equal(escolheuGratis.feeCents, null)
  assert.equal(escolheuGratis.divergence, null, 'não há o que divergir: ninguém cobra')

  // E não vira pendência de plano na régua: `undeclared` é o cadastro que ninguém preencheu, e
  // este foi respondido pelo estabelecimento.
  assert.equal(planFacetValue(facts({ planChoice: 'map_only' })), null)

  // A faixa PAGA continua sendo do operador, cliente a cliente (BR-B2B-017, itens 2 e 4): pedir
  // descrição não diz quanto custa.
  const pediuDescricao = derivePartnerPlan(facts({ planChoice: 'map_and_description' }))
  assert.equal(pediuDescricao.source, 'registration')
  assert.equal(pediuDescricao.kind, 'undeclared')
})

test('#409 · o cadastro que cobra contradiz a escolha, e a tela diz isso', () => {
  // Um valor que alguém digitou é decisão tomada DEPOIS do formulário, então ele vence — mas a
  // contradição é dita, em vez de uma das duas ser escondida.
  const cobrandoQuemEscolheuGratis = derivePartnerPlan(
    facts({ planChoice: 'map_only', fee: { ...NO_FEE, monthlyFeeCents: 14900 } })
  )
  assert.equal(cobrandoQuemEscolheuGratis.source, 'registration')
  assert.equal(cobrandoQuemEscolheuGratis.kind, 'paid')
  assert.equal(cobrandoQuemEscolheuGratis.divergence, 'free_choice_paid_registration')

  // E o contrato assinado continua acima dos dois (BR-B2B-017, item 5).
  const contratoManda = derivePartnerPlan(
    facts({ planChoice: 'map_only', contractTier: 'paid', fee: { ...NO_FEE, monthlyFeeCents: 14900 } })
  )
  assert.equal(contratoManda.source, 'contract')
  assert.equal(contratoManda.kind, 'paid')
})

test('#409 · a promoção grava o percentual zero da faixa grátis, e não deixa para o default', () => {
  const source = read('lib/services/partner-proposal-admin-service.ts')

  // O default da COLUNA é `0.200` e `DEFAULT_COMMISSION_RATE` em `types/clients.ts` é `0.1`:
  // dois donos para o mesmo fato, e um cliente nascido da proposta não recebia o mesmo
  // percentual de um nascido do formulário do admin. Para a faixa grátis nenhum dos dois vale.
  assert.match(source, /function commercialTermsOfChoice/)
  assert.match(source, /answers\.plan_choice === 'map_only'/)
  assert.match(source, /commission_rate: 0/)
  assert.match(source, /commercialTermsOfChoice\(command\.answers\)/)

  // E AS DUAS PORTAS MANDAM O MESMO VALOR DE PARTIDA. A faixa paga recebe
  // `DEFAULT_COMMISSION_RATE` — decidido em 2026-08-18, num lugar só —, e é isso que permite à
  // coluna largar o `DEFAULT 0.200` que discordava dele: 9 dos 28 clientes carregam `0.200` que
  // ninguém escolheu, todos promovidos de proposta.
  assert.match(source, /commission_rate: DEFAULT_COMMISSION_RATE/)
  assert.match(source, /from '@\/types\/clients'/)

  // A MENSALIDADE continua sendo do operador, cliente a cliente (BR-B2B-017, itens 2 e 4): a
  // faixa paga não ganha valor aqui.
  const helper = source.slice(
    source.indexOf('function commercialTermsOfChoice'),
    source.indexOf('function commercialTermsOfChoice') + 400
  )
  assert.equal(helper.indexOf('monthly_fee_cents: 1'), -1)
})
