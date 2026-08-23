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

  // Zero is a DECLARED zero and reads as paid: somebody typed it.
  const zero = derivePartnerPlan(facts({ fee: { ...NO_FEE, monthlyFeeCents: 0 } }))
  assert.equal(zero.kind, 'paid')
  assert.equal(zero.feeCents, 0)
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
