/**
 * Which kind of partner a submission is — the ONE place in the CMS that reads the category to
 * decide the path (#936, BR-B2B-054 items 4 and 5, BR-B2B-064, BR-B2B-065). The queue, the
 * conference, the approval, the record tabs and the directory ask this; nobody else tests the
 * category.
 *
 * Mirror of `partner.place_answers_have_address(answers)` in the database (contract
 * `partner-proposal-answers.md` §8.6): no address for `tour_guide`, and for `transfer` with
 * `has_service_address = 'false'`.
 *
 *  · `place`         — the place path: a POI, a plan, the triage of BR-B2B-011;
 *  · `guide`         — the tour guide: no POI, a public profile in "Guias nesta cidade";
 *  · `referral_only` — the transfer without a base: no POI, no listing, only the QR and the code.
 *
 * Pure: the screen and the server read it alike.
 */

import type { PartnerAnswers } from '@/lib/partner-form/schema'
import type { ClientType } from '@/types/clients'

export type PartnerKind = 'place' | 'guide' | 'referral_only'

export function partnerKindOf(answers: PartnerAnswers | null | undefined): PartnerKind {
  const category = answers?.category
  if (category === 'tour_guide') return 'guide'
  if (category === 'transfer' && answers?.has_service_address === 'false') return 'referral_only'
  return 'place'
}

/** A partner without an address: neither POI nor plan (BR-B2B-064 item 3, BR-B2B-065 item 3). */
export function hasNoPlace(kind: PartnerKind): boolean {
  return kind !== 'place'
}

/**
 * BR-B2B-064 item 5: the guide's explicit consent to show name, photo and WhatsApp in the app.
 * Unticked by default, and without it the proposal does not approve. Only `'true'` counts.
 */
export function hasPublicContactConsent(answers: PartnerAnswers | null | undefined): boolean {
  return answers?.public_contact_consent === 'true'
}

/**
 * The `client_type` a NEW client of this kind is born with (BR-B2B-020 item 8): the guide is
 * `tour_guide` (BR-B2B-064 item 1), the transfer without a base is `driver` (BR-B2B-065 item 2),
 * everything with an address is `venue` (`PROMOTED_CLIENT_TYPE`).
 */
export function clientTypeOfKind(kind: PartnerKind): ClientType {
  if (kind === 'guide') return 'tour_guide'
  if (kind === 'referral_only') return 'driver'
  return 'venue'
}

/**
 * What the record's `Locais` tab becomes (spec #936 §5): the guide gets "Perfil no app" in its
 * place, the transfer without a base gets nothing — neither has a place to list.
 */
export function placesTabOf(kind: PartnerKind): 'places' | 'guide' | null {
  if (kind === 'guide') return 'guide'
  if (kind === 'referral_only') return null
  return 'places'
}

/** Why the approval of this submission cannot happen yet, before any write. `null` = it can. */
export function noPlaceApprovalBlock(answers: PartnerAnswers | null | undefined): 'no_contact_consent' | null {
  if (partnerKindOf(answers) === 'guide' && !hasPublicContactConsent(answers)) return 'no_contact_consent'
  return null
}

/**
 * The directory badge of the three categories of BR-B2B-054 item 4 (spec #936 §6). Read from the
 * category, not from `client_type`: an agency is a `venue` like any other place.
 */
export type PartnerBadge = 'agency' | 'transfer' | 'guide'

export function partnerBadgeOf(answers: PartnerAnswers | null | undefined): PartnerBadge | null {
  const category = answers?.category
  if (category === 'travel_agency') return 'agency'
  if (category === 'transfer') return 'transfer'
  if (category === 'tour_guide') return 'guide'
  return null
}
