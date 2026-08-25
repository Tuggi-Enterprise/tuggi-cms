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
  | 'legal_status_declaration'
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
  | 'material_sticker_qty'
  | 'material_table_display_qty'
  | 'material_counter_display_qty'
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
  | 'plan_choice'

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

/**
 * The two tiers of BR-B2B-016 item 1, as the establishment picked between them on the form.
 *
 * MIRROR OF `tuggi-enterprise/src/lib/partner-proposal/fields.ts`, symbol `PLAN_CHOICES`, and
 * the contract that keeps the two honest is `docs/contracts/partner-proposal-answers.md`. What
 * arrives here is what the establishment ASKED FOR, in a conversation the commercial team had
 * already had. It decides nothing: the tier of the contract is the operator's choice at
 * generation, in `ContractManager`, and no public route writes it to `partner.clients`.
 */
export const PLAN_CHOICES = ['map_and_description', 'map_only'] as const
export type PlanChoice = (typeof PLAN_CHOICES)[number]

/**
 * The three kinds of promotional material the partner may ask for.
 *
 * SAME VOCABULARY IN THREE PLACES, and that is the point: `partner.material_order_items.kind`
 * carries these exact ids in its CHECK, the writing side declares them in
 * `tuggi-enterprise/src/lib/partner-proposal/fields.ts`, and the answer key of each one is
 * `material_<kind>_qty`, derived rather than typed out. A fourth kind is one edit here, one in
 * the writing side and one CHECK widened; there is no fourth place where the list could
 * disagree with itself.
 */
export const MATERIAL_KINDS = ['sticker', 'table_display', 'counter_display'] as const
export type MaterialKind = (typeof MATERIAL_KINDS)[number]

export function materialFieldId(kind: MaterialKind): PartnerFieldId {
  return `material_${kind}_qty` as PartnerFieldId
}

/**
 * The 26 keys `answers` can carry, and the group each one belongs to.
 *
 * It was 24 until 2026-08-21, when the operator added the two questions the team had been
 * asking by hand: whether the establishment declares itself legalized (`legal_status_declaration`,
 * BR-B2B-022 item 5, which BLOCKS the submission when unticked) and which of the two tiers of
 * BR-B2B-016 it is asking for (`plan_choice`). Neither decides anything here: the conference is
 * still an act of the team, and the contract tier is still chosen by the operator at generation.
 */
export const PARTNER_FORM_FIELDS: readonly PartnerAnswerField[] = [
  { id: 'trade_name', step: 1 },
  { id: 'legal_name', step: 1 },
  { id: 'tax_id', step: 1 },
  { id: 'legal_status_declaration', step: 1 },
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
  { id: 'plan_choice', step: 3 },

  // The promotional material moved from the end of step 1 to the end of step 3 on 2026-08-19:
  // step 1 carried 16 of the 24 fields and its own subtitle had stopped describing it. The step
  // is what the conference screen GROUPS BY, so the mirror has to move with the writer —
  // `docs/contracts/partner-proposal-answers.md` is the document that says so.
  ...MATERIAL_KINDS.map((kind) => ({ id: materialFieldId(kind), step: 3 as const })),
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
