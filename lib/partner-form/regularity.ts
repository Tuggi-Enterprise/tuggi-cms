/**
 * The regularity gate of BR-B2B-022, and the three classes of "missing" — pure, because the
 * band at the top of the review screen, the label on an empty field and the message that asks
 * the partner for the document all have to say the same thing.
 *
 * WHAT THIS GATE BLOCKS, and it is the sentence the whole screen is built around: an absent
 * document blocks THE CONTRACT, not the proposal. So `ready` is never consulted to decide
 * whether a proposal may be promoted.
 *
 * WHERE THE EVIDENCE COMES FROM CHANGED, AND THE RULE DID NOT (operator, 2026-08-16). The form
 * no longer asks for either file: the papers are checked IN PERSON before the link is sent, so
 * the evidence is now what the team registers by hand on the conference screen —
 * `ConferenceRecord`, stored inside the review annotation. The gate reads a record instead of
 * a bucket; it still refuses to produce a contract without both documents, and it still says
 * so in the same words.
 *
 * AN EXPIRED LICENCE IS AN ABSENT LICENCE — BR-B2B-022, item 4. Nobody should have to work
 * that out from a date on screen, so the arithmetic is here and the copy gets the number.
 */

import type { PartnerAnswers } from '@/lib/partner-form/schema'
import type { PartnerDocumentKind, PartnerFieldId } from '@/lib/partner-form/fields'

/** Days before expiry at which the band warns instead of confirming. */
export const LICENSE_EXPIRY_WARNING_DAYS = 30

/**
 * What one operator saw with the papers in their hands. It is an assertion by a named person
 * (the annotation carries `reviewed_by`), never a file this system holds — and the band says
 * exactly that, so nobody reads a tick here as "the Tuggi verified the document".
 */
export interface ConferenceRecord {
  /** The documents of BR-B2B-022 item 3 the team confirmed in person. */
  documentsSeen: PartnerDocumentKind[]
  /** The number printed on the licence they saw, as printed, or null. */
  licenseNumber: string | null
  /** The municipality that issued it — often not the one in the address — or null. */
  licenseIssuer: string | null
  /** The date printed on the licence they saw, ISO `YYYY-MM-DD`, or null. */
  licenseValidUntil: string | null
}

export const EMPTY_CONFERENCE: ConferenceRecord = {
  documentsSeen: [],
  licenseNumber: null,
  licenseIssuer: null,
  licenseValidUntil: null,
}

export type RegularityItemId =
  | 'tax_id'
  | 'business_license'
  | 'incorporation_document'
  | 'representative'

/**
 * `valid` — seen and in date; `expiring` — seen, in date, and about to stop being;
 * `expired` — seen and worthless to the contract; `missing` — nobody has seen it;
 * `undated` — seen, with no date registered, which BR-B2B-022 item 4 cannot be applied to, so
 * it counts as missing for the gate and says why.
 */
export type LicenseStatus = 'valid' | 'expiring' | 'expired' | 'missing' | 'undated'

export interface RegularityItem {
  id: RegularityItemId
  /** Satisfied for the purposes of signing a contract. */
  ok: boolean
}

export interface RegularityReport {
  items: RegularityItem[]
  license: {
    status: LicenseStatus
    /** ISO date as the team registered it, or null. */
    validUntil: string | null
    /** Negative when already expired. Null when there is no date to count from. */
    daysRemaining: number | null
    /**
     * The two identity fields of BR-B2B-030 item 2, carried so the band can show the trail
     * without a second input. THEY DO NOT DECIDE `status`, and that is the operator's
     * decision of 2026-08-16: what determines regularity is the VALIDITY (1st edge case of
     * BR-B2B-030 — only an absent date counts as absence). Number and municipality make the
     * trail traceable; blank, they leave it incomplete and refuse no contract.
     */
    number: string | null
    issuer: string | null
    /** True only when BOTH are registered — half a trail is not a trail. */
    identityComplete: boolean
  }
  /** Everything still needed before a contract can be signed, in band order. */
  missing: RegularityItemId[]
  /** True when nothing is missing — the `Documentação em ordem` line. */
  ready: boolean
}

function has(answers: PartnerAnswers, field: PartnerFieldId): boolean {
  const value = answers[field]
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Whole days from `now` to the date, counted on the calendar day and not on the instant: a
 * licence valid until today is valid today, and an hour of the afternoon must not turn it
 * into `-1`.
 */
export function daysUntil(isoDate: string, now: Date = new Date()): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate.trim())
  if (!match) return null

  const target = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.round((target - today) / 86_400_000)
}

export function licenseStatus(
  conference: ConferenceRecord,
  now: Date = new Date()
): RegularityReport['license'] {
  const raw = (conference.licenseValidUntil ?? '').trim()
  const seen = conference.documentsSeen.indexOf('business_license') >= 0
  const number = (conference.licenseNumber ?? '').trim() || null
  const issuer = (conference.licenseIssuer ?? '').trim() || null
  // Identity is only shown for a licence somebody says they saw: a number with no tick behind
  // it is a line about a document nobody has looked at.
  const identity = seen
    ? { number, issuer, identityComplete: number !== null && issuer !== null }
    : { number: null, issuer: null, identityComplete: false }

  if (!seen) return { status: 'missing', validUntil: raw || null, daysRemaining: null, ...identity }
  if (!raw) return { status: 'undated', validUntil: null, daysRemaining: null, ...identity }

  const daysRemaining = daysUntil(raw, now)
  if (daysRemaining === null)
    return { status: 'undated', validUntil: null, daysRemaining: null, ...identity }

  if (daysRemaining < 0) return { status: 'expired', validUntil: raw, daysRemaining, ...identity }
  if (daysRemaining <= LICENSE_EXPIRY_WARNING_DAYS)
    return { status: 'expiring', validUntil: raw, daysRemaining, ...identity }
  return { status: 'valid', validUntil: raw, daysRemaining, ...identity }
}

/**
 * Reads the proposal against BR-B2B-022 and says what a contract still lacks.
 *
 * Two of the four items come from what the partner typed and two from what the team saw; the
 * report does not distinguish them, because the contract does not either.
 *
 * THE LICENCE NUMBER AND THE ISSUING MUNICIPALITY ARE NOT IN THIS GATE, deliberately. They
 * are two of the five fields of BR-B2B-030 item 2, and its first edge case puts only the
 * ABSENT DATE on the side of absence: a conference that is correct except for a blank number
 * would be refused a contract, and refusing it is the defect. If that is ever to change it is
 * the `produto`'s decision, and it changes here — in `items`, not in the screen.
 */
export function buildRegularityReport(
  answers: PartnerAnswers,
  conference: ConferenceRecord = EMPTY_CONFERENCE,
  now: Date = new Date()
): RegularityReport {
  const license = licenseStatus(conference, now)

  const items: RegularityItem[] = [
    { id: 'tax_id', ok: has(answers, 'tax_id') },
    {
      id: 'business_license',
      ok: license.status === 'valid' || license.status === 'expiring',
    },
    {
      id: 'incorporation_document',
      ok: conference.documentsSeen.indexOf('incorporation_document') >= 0,
    },
    {
      id: 'representative',
      ok: has(answers, 'representative_name') && has(answers, 'representative_role'),
    },
  ]

  const missing = items.filter((item) => !item.ok).map((item) => item.id)
  return { items, license, missing, ready: missing.length === 0 }
}

/**
 * Which kind of absence an unanswered field is — §4.3 of the spec. An empty field is never
 * shown merely greyed out: it carries which of the three it is, and that is what lets the
 * operator tell "blocks the contract" from "nobody had to answer this" without knowing the
 * rule by heart.
 *
 *  · `contract` — BR-B2B-022 needs it before anyone signs;
 *  · `triage`   — the optional story questions; input for gate 2 of BR-B2B-011, blocks nothing;
 *  · `optional` — everything else.
 */
export type AbsenceClass = 'contract' | 'triage' | 'optional'

const CONTRACT_FIELDS: readonly PartnerFieldId[] = [
  'tax_id',
  'representative_name',
  'representative_role',
]

const TRIAGE_FIELDS: readonly PartnerFieldId[] = ['story_before', 'story_unique', 'story_event']

export function absenceClassOf(field: PartnerFieldId): AbsenceClass {
  if (CONTRACT_FIELDS.indexOf(field) >= 0) return 'contract'
  if (TRIAGE_FIELDS.indexOf(field) >= 0) return 'triage'
  return 'optional'
}
