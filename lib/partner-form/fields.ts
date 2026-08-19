/**
 * The partnership proposal, as this repository READS it — the CMS half of a contract whose
 * other half is in another repository.
 *
 * THE FORM IS NOT HERE ANY MORE (#396). It is `tuggi-enterprise`, at
 * `src/app/[locale]/partners/proposal/page.tsx`, and the establishment fills it in there. What
 * stayed is the conference, the promotion and the contract, all authenticated (BR-B2B-026,
 * items 1 and 4) — and all of them read `partner.partner_form_submissions.answers`, a JSON object
 * whose keys are the ids below.
 *
 * SO THIS IS A MIRROR, AND IT SAYS SO. The owner of the field list is the surface that writes
 * it, `tuggi-enterprise/src/lib/partner-proposal/fields.ts`; two repositories cannot share a
 * module, so what binds them is `docs/contracts/partner-proposal-answers.md`. When the two
 * disagree, the contract is what says which one is wrong.
 *
 * WHAT IS DELIBERATELY NOT MIRRORED. Everything the writing side needs and the reading side
 * does not: the input type, the `autocomplete` token, the maximum length, whether the field is
 * required, the option lists, `FORBIDDEN_FIELDS`, and the step count of the wizard. A reader
 * that carried them would be a second declaration of a rule it never applies — and the day the
 * form widened a limit, this copy would quietly claim the old one. Only `id` and `step` are
 * here, because only those two decide what the conference screen shows and in which group.
 */

export type PartnerFieldId =
  // Step 1 — the establishment
  | 'trade_name'
  | 'legal_name'
  | 'tax_id'
  | 'category'
  | 'address'
  | 'address_complement'
  | 'district'
  | 'postal_code'
  | 'city'
  | 'state'
  | 'instagram'
  | 'opening_hours'
  | 'website'
  // Step 2 — who answers for the establishment
  | 'representative_name'
  | 'representative_role'
  | 'representative_email'
  | 'representative_phone'
  // Step 3 — the story of the place
  | 'story_founder'
  | 'story_before'
  | 'story_unique'
  | 'story_event'

export interface PartnerAnswerField {
  id: PartnerFieldId
  step: 1 | 2 | 3
}

/** Categories the proposal offers in step 1. Ids in English; labels in `messages/pt.json`. */
export const PARTNER_CATEGORIES = [
  'restaurant',
  'bar_cafe',
  'hotel',
  'inn',
  'shop',
  'attraction',
  'other',
] as const

/** The 21 keys `answers` can carry, and the group each one belongs to. */
export const PARTNER_FORM_FIELDS: readonly PartnerAnswerField[] = [
  { id: 'trade_name', step: 1 },
  { id: 'legal_name', step: 1 },
  { id: 'tax_id', step: 1 },
  { id: 'category', step: 1 },
  { id: 'address', step: 1 },
  { id: 'address_complement', step: 1 },
  { id: 'district', step: 1 },
  { id: 'postal_code', step: 1 },
  { id: 'city', step: 1 },
  { id: 'state', step: 1 },
  { id: 'instagram', step: 1 },
  { id: 'opening_hours', step: 1 },
  { id: 'website', step: 1 },

  { id: 'representative_name', step: 2 },
  { id: 'representative_role', step: 2 },
  { id: 'representative_email', step: 2 },
  { id: 'representative_phone', step: 2 },

  { id: 'story_founder', step: 3 },
  { id: 'story_before', step: 3 },
  { id: 'story_unique', step: 3 },
  { id: 'story_event', step: 3 },
] as const

export const PARTNER_FIELD_IDS = PARTNER_FORM_FIELDS.map((field) => field.id)

export function fieldsOfStep(step: PartnerAnswerField['step']): readonly PartnerAnswerField[] {
  return PARTNER_FORM_FIELDS.filter((field) => field.step === step)
}

/**
 * The two documents of BR-B2B-022 item 3.
 *
 * THE PROPOSAL DOES NOT ASK FOR THEM, and that is a decision of the operator (2026-08-16): the
 * licence and the incorporation document are checked IN PERSON, before an establishment is
 * invited, so the evidence is what the team registers by hand on the conference screen
 * (`lib/partner-form/proposal-review.ts`, `ConferenceRecord`). It still blocks the CONTRACT and
 * nothing else. This one belongs here and not to the writing side, because the surface that
 * records it is this one.
 */
export const PARTNER_DOCUMENT_KINDS = ['business_license', 'incorporation_document'] as const
export type PartnerDocumentKind = (typeof PARTNER_DOCUMENT_KINDS)[number]
