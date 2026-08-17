/**
 * The partner form (#341) — the single list of what it asks.
 *
 * One declaration per field drives all four things that used to drift apart in this
 * repo: what the browser renders, what `autocomplete` it announces, what the server
 * accepts, and which copy key carries the label. Copy is NOT here — it lives in
 * `messages/pt.json` under `PartnerForm`, and the key is derived from the id, so a
 * field without copy fails loudly instead of rendering an empty label.
 *
 * Two things this list is also the proof of, and both are tested:
 *
 * - `FORBIDDEN_FIELDS` — no banking column and no `billing_email` may ever appear
 *   here. Banking is out by the card's own decision (the R$ 100 flow runs partner →
 *   Tuggi, so the partner needs Tuggi's account and not the other way round), and
 *   `billing_email` is out because asking for a billing address on a public capture
 *   surface implies a charge, which BR-B2B-015 item 8 and BR-B2B-016 item 6 close.
 * - Nothing here is written to `core.clients` by a public route. The submission is a
 *   proposal; the promotion is an authenticated act. Four of these fields
 *   (`tax_id`, `legal_representative_name`, `legal_representative_role` and the
 *   representative's contact) sit in `CLIENT_ADMIN_ONLY_FIELDS`, and
 *   `pickEditableFields` drops them — so a public path that tried would write nothing
 *   and say it had.
 */

import { BRAZIL_STATE_CODES } from '@/lib/constants/brazil-states'

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

export type PartnerFieldType =
  | 'text'
  | 'email'
  | 'tel'
  | 'url'
  | 'cnpj'
  | 'postal_code'
  | 'select'
  | 'textarea'
  | 'date'

export interface PartnerField {
  id: PartnerFieldId
  step: 1 | 2 | 3
  type: PartnerFieldType
  required: boolean
  /** SC 1.3.5. Absent when no HTML autofill token describes the field. */
  autoComplete?: string
  maxLength: number
  /** Option ids for a select. The label of each one is a copy key. */
  options?: readonly string[]
}

/** Categories offered in step 1. Ids in English; labels in `messages/pt.json`. */
export const PARTNER_CATEGORIES = [
  'restaurant',
  'bar_cafe',
  'hotel',
  'inn',
  'shop',
  'attraction',
  'other',
] as const

export const PARTNER_FORM_FIELDS: readonly PartnerField[] = [
  { id: 'trade_name', step: 1, type: 'text', required: true, autoComplete: 'organization', maxLength: 160 },
  { id: 'legal_name', step: 1, type: 'text', required: true, maxLength: 200 },
  // `type="text"` and never `type="number"`; the input mode is decided in the
  // component and is `text`, because a numeric keypad makes an alphanumeric CNPJ
  // physically impossible to type.
  { id: 'tax_id', step: 1, type: 'cnpj', required: true, maxLength: 18 },
  { id: 'category', step: 1, type: 'select', required: true, maxLength: 32, options: PARTNER_CATEGORIES },
  { id: 'address', step: 1, type: 'text', required: true, autoComplete: 'street-address', maxLength: 200 },
  { id: 'address_complement', step: 1, type: 'text', required: false, maxLength: 120 },
  { id: 'district', step: 1, type: 'text', required: true, maxLength: 120 },
  { id: 'postal_code', step: 1, type: 'postal_code', required: true, autoComplete: 'postal-code', maxLength: 9 },
  { id: 'city', step: 1, type: 'text', required: true, autoComplete: 'address-level2', maxLength: 120 },
  { id: 'state', step: 1, type: 'select', required: true, autoComplete: 'address-level1', maxLength: 2, options: BRAZIL_STATE_CODES },
  { id: 'instagram', step: 1, type: 'text', required: false, maxLength: 60 },
  { id: 'opening_hours', step: 1, type: 'textarea', required: false, maxLength: 400 },
  { id: 'website', step: 1, type: 'url', required: false, maxLength: 300 },

  { id: 'representative_name', step: 2, type: 'text', required: true, autoComplete: 'name', maxLength: 160 },
  { id: 'representative_role', step: 2, type: 'text', required: true, autoComplete: 'organization-title', maxLength: 120 },
  { id: 'representative_email', step: 2, type: 'email', required: true, autoComplete: 'email', maxLength: 255 },
  { id: 'representative_phone', step: 2, type: 'tel', required: true, autoComplete: 'tel', maxLength: 32 },

  // Exactly one required question in step 3, and it is the one nobody can get wrong:
  // a name plus a year is already a dated, attributable anchor (DS-COPY-015). The other
  // three raise quality and must stay optional — not every place has them.
  { id: 'story_founder', step: 3, type: 'textarea', required: true, maxLength: 1200 },
  { id: 'story_before', step: 3, type: 'textarea', required: false, maxLength: 1200 },
  { id: 'story_unique', step: 3, type: 'textarea', required: false, maxLength: 1200 },
  { id: 'story_event', step: 3, type: 'textarea', required: false, maxLength: 1200 },
] as const

export const PARTNER_FIELD_IDS = PARTNER_FORM_FIELDS.map((field) => field.id)

export function fieldsOfStep(step: PartnerField['step']): readonly PartnerField[] {
  return PARTNER_FORM_FIELDS.filter((field) => field.step === step)
}

export function partnerField(id: PartnerFieldId): PartnerField {
  const field = PARTNER_FORM_FIELDS.find((candidate) => candidate.id === id)
  if (!field) throw new Error(`unknown partner form field: ${id}`)
  return field
}

/**
 * Columns of `core.clients` that this surface must never ask for. Kept as data, not as
 * prose in a comment, because `tests/api/partner-form.test.ts` asserts against it: a
 * field added by copy-paste from the admin editor fails the suite instead of shipping.
 */
export const FORBIDDEN_FIELDS = [
  'iban',
  'bic_swift',
  'bank_account_number',
  'bank_routing_number',
  'bank_name',
  'billing_email',
  'commission_rate',
  'status',
  'slug',
] as const

/**
 * The two documents of BR-B2B-022 item 3.
 *
 * THE FORM DOES NOT ASK FOR THEM, and that is a decision of the operator (2026-08-16): the
 * licence and the incorporation document are checked IN PERSON, before the link is sent, so
 * only an establishment whose papers were already seen ever receives the address. The two
 * names survive here because the rule survives whole — what changed is where the evidence
 * comes from. It is now what the team registers by hand on the conference screen
 * (`lib/partner-form/proposal-review.ts`, `ConferenceRecord`), and it still blocks the
 * CONTRACT and nothing else.
 */
export const PARTNER_DOCUMENT_KINDS = ['business_license', 'incorporation_document'] as const
export type PartnerDocumentKind = (typeof PARTNER_DOCUMENT_KINDS)[number]

/** Three subjects and the review; the person sees `Passo N de 4`. */
export const PARTNER_FORM_STEPS = [1, 2, 3, 4] as const
export const PARTNER_FORM_STEP_COUNT = PARTNER_FORM_STEPS.length
