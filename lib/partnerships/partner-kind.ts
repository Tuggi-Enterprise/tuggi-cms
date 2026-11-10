/**
 * Which kind of partner a submission or a client is — the ONE place in the CMS that reads the
 * category to decide the path (#936, BR-B2B-054 items 4 and 5, BR-B2B-064, BR-B2B-065). The queue,
 * the conference, the approval, the record tabs and the directory ask this; nobody else tests the
 * category.
 *
 * Mirror of `partner.place_answers_have_address(answers)` in the database (contract
 * `partner-proposal-answers.md` §8.6): no address for `tour_guide`, and for `transfer` with
 * `has_service_address = 'false'`.
 *
 *  · `place`         — the place path: a POI, a plan, the triage of BR-B2B-011;
 *  · `guide`         — the tour guide: no POI, a public profile in "Parceiros";
 *  · `referral_only` — the transfer without a base: no POI, no listing, only the QR and the code.
 *
 * Pure: the screen and the server read it alike.
 */

import type { PartnerAnswers } from '@/lib/partner-form/schema'
import type { ClientType } from '@/types/clients'

export type PartnerKind = 'place' | 'guide' | 'referral_only'

/**
 * `clientType` is the client's `client_type`, when the caller has the client. BR-B2B-066 items 1 and
 * 10, BR-B2B-064 item 1 (#1184): the guide of the app request is born `tour_guide` with an empty
 * profile and NO portal submission, so there are no answers to read; both paths lead to the same
 * guide record, and this is the one derivation that says so.
 */
export function partnerKindOf(
  answers: PartnerAnswers | null | undefined,
  clientType: string | null | undefined = null
): PartnerKind {
  const category = answers?.category
  if (category === 'tour_guide' || clientType === 'tour_guide') return 'guide'
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

/**
 * BR-B2B-066 item 1: the four partners without a place that ask in the app (creator, influencer,
 * driver and, since #1184, tour guide), each with a CPF or a CNPJ (item 4). Contract
 * `parceiro-sem-local.md` §2.1 `p_partner_type`. The guide also enters by the portal (BR-B2B-064
 * item 1), and its portal record carries the same document rule.
 */
export const APP_PARTNER_TYPES = ['creator', 'influencer', 'driver', 'tour_guide'] as const satisfies readonly ClientType[]

export type AppPartnerType = (typeof APP_PARTNER_TYPES)[number]

export function isAppPartnerType(value: unknown): value is AppPartnerType {
  return typeof value === 'string' && (APP_PARTNER_TYPES as readonly string[]).includes(value)
}

/**
 * #1139, BR-B2B-066 item 2: a creator, influencer or driver approved BY THE APP REQUEST, with no
 * place, is a partner without a place. Not the guide (#1184): it has a profile to complete and a
 * curator's tick, so it is not the QR-and-code-only row this answers for. Its acceptance arrived with the request, the creator has no
 * slug apart from its @, and nothing of the place pipeline (create the place, publish it, the gate
 * of BR-B2B-057) is owed: the board shows it as the transfer without a base, QR and code only.
 *
 * "By the request" is `commission_starts_at`, which only `drive.approve_partner_request_as` writes
 * (contract `parceiro-sem-local.md` §4.2 and §4.4, BR-B2B-066 item 6). A record approved by hand
 * or by the old app signup has no mark and no acceptance, so it keeps the gate and its warning
 * (BR-B2B-057 item 3). A pending record keeps the ordinary path, where the approval is work.
 */
export function isApprovedAppPartnerWithoutPlace(
  client: { clientType: string | null; status: string | null; commissionStartsAt: string | null },
  placeCount: number
): boolean {
  return (
    isAppPartnerType(client.clientType) &&
    client.clientType !== 'tour_guide' &&
    client.status === 'approved' &&
    client.commissionStartsAt !== null &&
    placeCount === 0
  )
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
