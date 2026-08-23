/**
 * Publishing a partner's place, and the four things it can mean for money —
 * DS-COMPONENTE-021.
 *
 * Pure, and separate from `place-readiness.ts` on purpose: one module answers "what is missing
 * for this place to work", the other answers "what does pressing this button start". The
 * second one reads the first, never the other way round.
 *
 * WHAT THE ACT WRITES IS ONE COLUMN — `core.attractions.approved` — and the route is the proof
 * (criterion 18). Nothing here writes anything; it decides which confirmation the screen is
 * ALLOWED to write, which is the whole of DS-COMPONENTE-021, point 2: the surface refuses the
 * act when it cannot state the value truthfully, and it refuses the SENTENCE, never the place.
 * BR-B2B-011's preamble is explicit that no software turns down a partner's place.
 */

import type { PlaceReadiness } from './place-readiness'

/**
 * The four confirmations, each one whole (DS-COMPONENTE-021, 1st edge case — a confirmation
 * with a conditional clause inside makes the operator work out which half applies to them).
 *
 *  · `paid_starts`  — paid tier, description on air: this is the one that starts money;
 *  · `paid_pending` — paid tier, no description on air: publishes, and starts nothing;
 *  · `courtesy`     — recorded as courtesy with a reason: publishes, nothing is charged;
 *  · `undeclared`   — neither a fee nor a courtesy on the record: the act is NOT offered.
 */
export type PublishVariant = 'paid_starts' | 'paid_pending' | 'courtesy' | 'undeclared'

/** What the client's record says about money. Read from the record; never presumed. */
export interface PartnerFee {
  /** `partner.clients.monthly_fee_cents` — BR-B2B-017, item 4. Absent is NOT zero (item 6). */
  monthlyFeeCents: number | null
  isCourtesy: boolean
  courtesyReason: string | null
}

export interface PublishPlan {
  variant: PublishVariant
  /**
   * Whether the screen may offer the act at all.
   *
   * Two reasons it may not, and neither is software turning the place down:
   *  · `undeclared` — the confirmation would have to name a value the record does not have
   *    (DS-COMPONENTE-021, point 2). The way out is registering the fee or the courtesy with a
   *    reason, which BR-B2B-017, item 6, already provides for;
   *  · a BLOCKING pendency — the confirmation would have to say "o local entra no app", and
   *    with no coordinate, or hidden from the map, that sentence is false. The pendency block
   *    right above already names what is missing and links to where it is fixed, so nothing is
   *    disabled in silence.
   */
  offersAct: boolean
  /** True only for `paid_starts`. It is what the confirmation is allowed to claim. */
  startsBilling: boolean
  /** The value the button has to carry, in cents. Null in every variant but `paid_starts`. */
  feeCents: number | null
  courtesyReason: string | null
}

/**
 * A courtesy is a DECISION, and a decision without its reason is an unexplained discount —
 * BR-B2B-017, item 6. The same reading is already in `lib/contract/snapshot.ts`, which refuses
 * to produce a contract for a courtesy with no reason, and the two must not diverge.
 */
function isRecordedCourtesy(fee: PartnerFee): boolean {
  return fee.isCourtesy === true && (fee.courtesyReason ?? '').trim().length > 0
}

/**
 * WHAT THE REGISTRATION SAYS ABOUT MONEY, and the ONE place that decides it.
 *
 * BR-B2B-017, item 6, is quoted everywhere as `absent is NOT zero`. The converse was never
 * written down and three readers each guessed at it:
 *
 *   `lib/contract/snapshot.ts`  `fee <= 0` is an incomplete registration — "zero without the
 *                               courtesy decision is the same thing wearing a number";
 *   `buildPublishPlan`          `typeof fee === 'number'` — so zero was a DECLARED fee, and a
 *                               publication with a description on air announced that billing
 *                               starts at R$ 0,00;
 *   `derivePartnerPlan`         the same, and it produced a sentence that is simply false:
 *                               `Sabor e Arte Restaurante` (fee 0, courtesy without a reason,
 *                               free contract signed) got `O contrato não cobra e o cadastro
 *                               cobra` on the queue card. The registration charges nothing.
 *
 * `snapshot` is the one that is right, and it is the one that produces the instrument the
 * partner signs — so its reading wins and the other two come here. A zero nobody explained is
 * an incomplete registration, not a decision to charge nothing: the decision that charges
 * nothing is the courtesy, and it comes with a reason.
 *
 * Measured on 2026-08-23: 1 client of 24 carries `monthly_fee_cents = 0`, and it is the one in
 * the card above. 20 carry `null` and 3 carry a positive value.
 */
export function registrationMoneyKind(fee: PartnerFee): 'paid' | 'courtesy' | 'undeclared' {
  if (isRecordedCourtesy(fee)) return 'courtesy'
  const cents = fee.monthlyFeeCents
  if (typeof cents !== 'number' || !Number.isFinite(cents) || cents <= 0) return 'undeclared'
  return 'paid'
}

export function buildPublishPlan(fee: PartnerFee, readiness: PlaceReadiness): PublishPlan {
  const blocked = readiness.blocking.length > 0

  // Courtesy wins over a fee that is also on the record: `lib/contract/snapshot.ts` freezes the
  // contract the same way (`is_courtesy` true ⇒ no monthly value), and two answers to "is this
  // one charged?" is exactly the SSOT defect (CLAUDE.md §6).
  if (isRecordedCourtesy(fee)) {
    return {
      variant: 'courtesy',
      offersAct: !blocked,
      startsBilling: false,
      feeCents: null,
      courtesyReason: (fee.courtesyReason ?? '').trim(),
    }
  }

  // Zero is not a fee — see `registrationMoneyKind`. Reading it as one made the publication
  // announce that billing starts at R$ 0,00.
  const declaredFee =
    registrationMoneyKind(fee) === 'paid' ? (fee.monthlyFeeCents as number) : null

  // Nothing on the record about money. It only matters when publishing WOULD start something:
  // with no description on air nothing starts, so the act stays available and falls into
  // `paid_pending` — spec §5, the sentence that proves the boundary is in the right place.
  if (declaredFee === null && !readiness.hasDescriptionOnAir) {
    return {
      variant: 'paid_pending',
      offersAct: !blocked,
      startsBilling: false,
      feeCents: null,
      courtesyReason: null,
    }
  }

  if (declaredFee === null) {
    return {
      variant: 'undeclared',
      offersAct: false,
      startsBilling: false,
      feeCents: null,
      courtesyReason: null,
    }
  }

  if (!readiness.hasDescriptionOnAir) {
    return {
      variant: 'paid_pending',
      offersAct: !blocked,
      startsBilling: false,
      feeCents: null,
      courtesyReason: null,
    }
  }

  return {
    variant: 'paid_starts',
    offersAct: !blocked,
    startsBilling: true,
    feeCents: declaredFee,
    courtesyReason: null,
  }
}

/**
 * The fee as the button has to print it. The currency is the real and only the real —
 * BR-B2B-017, 1st edge case: nobody converts and nobody presumes parity.
 *
 * `pt-BR` and not the operator's locale: this whole surface is Portuguese-only (spec §2), and
 * a value formatted in another locale next to Portuguese copy is the mixed-up half of a
 * sentence the operator is about to commit money with.
 */
export function formatMonthlyFee(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  })
}
