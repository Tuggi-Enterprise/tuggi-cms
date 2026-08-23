/**
 * WHO PAYS, AND WHO SAID SO — the one line of money a card is allowed to show.
 *
 * THERE ARE THREE ANSWERS TO "IS THIS ONE PAID?", they belong to three different people, and
 * `lib/partner-form/fields.ts` warns in as many words that the first decides nothing:
 *
 *  · `answers.plan_choice` — what the establishment ASKED FOR on the form (BR-B2B-016, item 1).
 *    It exists from the moment the proposal lands, and it is a request, not a price.
 *  · `partner.clients.monthly_fee_cents` / `is_courtesy` — what the Tuggi RECORDED. This is the
 *    one that decides whether publishing may be offered at all (BR-B2B-017, item 6) and the one
 *    that starts the money (BR-B2B-018).
 *  · `partner_contracts.tier` — what was FROZEN when the contract was generated, and what the
 *    partner signed.
 *
 * Showing one of them under a neutral label would be a card that says `pago` about a partner
 * the Tuggi registered as a courtesy — three facts wearing one name is the SSOT defect this
 * repository has paid for before (CLAUDE.md §6). So the line always carries its SOURCE, and the
 * source is decided by how far along the partnership is: the firmest fact that exists yet.
 *
 * THE DIVERGENCE IS THE POINT OF READING IT AT ALL. Once a contract exists, the registration
 * can drift away from it — somebody edits the fee on the fiscal tab and the signed instrument
 * still says something else. `lib/contract/snapshot.ts:feeDivergence` answers that in full, from
 * the frozen snapshot, on the contract page. Here the comparison is deliberately coarser: only
 * `tier`, which is a column of its own, so the directory never has to carry a snapshot full of
 * legal names and addresses through a list endpoint.
 *
 * Pure, and proven without a database by `tests/api/client-board-transitions.test.ts`.
 */

import type { ContractTier } from '@/lib/contract/snapshot'
import type { PlanChoice } from '@/lib/partner-form/fields'
import { registrationMoneyKind, type PartnerFee } from '@/lib/partnerships/publish-plan'

/** Whose answer the line is showing. Never omitted: it is what keeps the three apart. */
export type PlanSource = 'contract' | 'registration' | 'proposal'

/**
 * What the line says.
 *
 * `undeclared` is not a missing value to be tidied away — it is the state BR-B2B-017, item 6,
 * names, and the one that refuses the publication (`buildPublishPlan`). A card that hid it
 * would make an operator wonder why the act is not on offer.
 */
export type PlanKind = 'paid' | 'courtesy' | 'undeclared' | 'free' | 'requested'

/** How the registration and the contract disagree, when they do. */
export type PlanDivergence =
  /** The contract charges nothing and the registration carries a fee. */
  | 'free_contract_paid_registration'
  /** The contract charges and the registration does not say how much. */
  | 'paid_contract_undeclared_registration'
  /** The establishment asked for the free tier and the registration carries a fee. */
  | 'free_choice_paid_registration'

export interface PartnerPlan {
  source: PlanSource
  kind: PlanKind
  /** Only for `paid`. The registration's value, in cents. */
  feeCents: number | null
  /** Only for `courtesy`, and only when somebody wrote one (BR-B2B-017, item 6). */
  courtesyReason: string | null
  /** Only for `requested` — what the establishment asked for, before anybody priced it. */
  requested: PlanChoice | null
  divergence: PlanDivergence | null
}

/** The facts of one row this decision needs. A subset, so the test can build one by hand. */
export interface PlanFacts {
  clientId: string | null
  fee: PartnerFee
  planChoice: PlanChoice | null
  /** The live contract's tier, or `null` when there is no contract. */
  contractTier: ContractTier | null
}

/**
 * What the REGISTRATION says, on its own. It is `registrationMoneyKind` and nothing else: this
 * file used to carry its own copy, which read `typeof cents === 'number'` and therefore called a
 * zero a fee — the card then said `O contrato não cobra e o cadastro cobra` about a registration
 * that charges nothing.
 */
const registrationKind = registrationMoneyKind

export function derivePartnerPlan(facts: PlanFacts): PartnerPlan {
  const registration = registrationKind(facts.fee)
  const feeCents = registration === 'paid' ? facts.fee.monthlyFeeCents : null
  const courtesyReason =
    registration === 'courtesy' ? (facts.fee.courtesyReason ?? '').trim() : null

  // 1 · A CONTRACT EXISTS: it is what the partner signed, and it outranks the registration.
  if (facts.contractTier) {
    if (facts.contractTier === 'free') {
      return {
        source: 'contract',
        kind: 'free',
        feeCents: null,
        courtesyReason: null,
        requested: null,
        divergence: registration === 'paid' ? 'free_contract_paid_registration' : null,
      }
    }
    return {
      source: 'contract',
      // A paid contract still gets its value from the registration — the tier says THAT it
      // charges, the record says how much, and a courtesy inside a paid tier is the shape
      // `buildSnapshot` freezes.
      kind: registration,
      feeCents,
      courtesyReason,
      requested: null,
      divergence:
        registration === 'undeclared' ? 'paid_contract_undeclared_registration' : null,
    }
  }

  /**
   * 2 · NO CONTRACT YET, AND THE ESTABLISHMENT ASKED FOR THE FREE TIER.
   *
   * `map_only` is the tier where BR-B2B-016, item 1, charges nothing — "a gente coloca como um
   * ponto dentro do Tuggi… vai simplesmente falar, olha, aqui do lado direito, estabelecimento
   * X". There is nothing left for anybody to price, and asking the operator to type a zero the
   * establishment already chose is asking the same question twice.
   *
   * MEASURED on 2026-08-23, and this is the reason it is a derivation and not a new field: of
   * the 9 clients promoted from a proposal that chose `map_only`, ALL 9 carry commission `0.000`
   * and a `free` contract, and 8 of them also carry `monthly_fee_cents` empty. The operator has
   * been re-typing the establishment's answer in three places, by hand, every time.
   *
   * The registration still outranks it when it CONTRADICTS the choice: a fee somebody typed is
   * a decision that was made after the form, and the screen says so instead of hiding one of
   * the two.
   */
  if (facts.clientId && facts.planChoice === 'map_only' && registration !== 'paid') {
    return {
      source: 'proposal',
      kind: 'free',
      feeCents: null,
      courtesyReason: null,
      requested: 'map_only',
      divergence: null,
    }
  }

  // 3 · A CLIENT EXISTS but no contract: what the Tuggi recorded is the firmest fact there is.
  if (facts.clientId) {
    return {
      source: 'registration',
      kind: registration,
      feeCents,
      courtesyReason,
      requested: null,
      divergence:
        facts.planChoice === 'map_only' && registration === 'paid'
          ? 'free_choice_paid_registration'
          : null,
    }
  }

  // 4 · ONLY A PROPOSAL: nobody has priced anything, and the honest answer is the request.
  return {
    source: 'proposal',
    kind: 'requested',
    feeCents: null,
    courtesyReason: null,
    requested: facts.planChoice,
    divergence: null,
  }
}

/**
 * What the rail filters by, and it is NOT `PlanKind`.
 *
 * The rail answers one question — `quem ainda não tem plano declarado?`, the set that cannot be
 * published — so it offers the three states of the REGISTRATION and nothing else. A proposal
 * nobody priced has no answer to give and is not counted, the same way a row with no country is
 * not an empty-string country in the rail beside it.
 */
export type PlanFacet = 'paid' | 'courtesy' | 'undeclared'

export function planFacetValue(facts: PlanFacts): PlanFacet | null {
  if (!facts.clientId) return null
  // The free tier the establishment chose has no answer to give either, and for the same
  // reason: the rail exists to find registrations somebody still has to fill in, and this one
  // was answered on the form. A `map_only` client filed under `undeclared` is a row the
  // operator opens to discover there is nothing to do.
  const plan = derivePartnerPlan(facts)
  if (plan.kind === 'free' && plan.source === 'proposal') return null
  return registrationKind(facts.fee)
}
