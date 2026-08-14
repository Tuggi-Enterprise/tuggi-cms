/**
 * The regularity gate of BR-B2B-022, and the three classes of "missing" — pure, because the
 * band at the top of the review screen, the label on an empty field and the e-mail that asks
 * for the document all have to say the same thing.
 *
 * WHAT THIS GATE BLOCKS, and it is the sentence the whole screen is built around: an absent
 * document blocks THE CONTRACT, not the proposal. The form lets a partner submit without the
 * two files on purpose (#341, approved by the Tech Lead), because the data that already came
 * — CNPJ, who signs, and the story of the place — is the expensive part. So `isReady()` is
 * never consulted to decide whether a proposal may be promoted.
 *
 * AN EXPIRED LICENCE IS AN ABSENT LICENCE — BR-B2B-022, item 4. Nobody should have to work
 * that out from a date on screen, so the arithmetic is here and the copy gets the number.
 */

import type { PartnerAnswers } from '@/lib/partner-form/schema'
import type { PartnerDocumentKind, PartnerFieldId } from '@/lib/partner-form/fields'

/** Days before expiry at which the band warns instead of confirming. */
export const LICENSE_EXPIRY_WARNING_DAYS = 30

export type RegularityItemId =
  | 'tax_id'
  | 'business_license'
  | 'incorporation_document'
  | 'representative'

/**
 * `valid` — there and in date; `expiring` — there, in date, and about to stop being;
 * `expired` — there and worthless to the contract; `missing` — no file;
 * `undated` — a file with no `business_license_valid_until`, which BR-B2B-022 item 4 cannot
 * be applied to, so it counts as missing for the gate and says why.
 */
export type LicenseStatus = 'valid' | 'expiring' | 'expired' | 'missing' | 'undated'

export interface RegularityItem {
  id: RegularityItemId
  /** Satisfied for the purposes of signing a contract. */
  ok: boolean
  /** Files of this kind on the proposal. Zero for `tax_id` and `representative`. */
  fileCount: number
}

export interface RegularityReport {
  items: RegularityItem[]
  license: {
    status: LicenseStatus
    /** ISO date as the partner typed it, or null. */
    validUntil: string | null
    /** Negative when already expired. Null when there is no date to count from. */
    daysRemaining: number | null
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
  answers: PartnerAnswers,
  hasFile: boolean,
  now: Date = new Date()
): RegularityReport['license'] {
  const raw = (answers.business_license_valid_until ?? '').trim()

  if (!hasFile) return { status: 'missing', validUntil: raw || null, daysRemaining: null }
  if (!raw) return { status: 'undated', validUntil: null, daysRemaining: null }

  const daysRemaining = daysUntil(raw, now)
  if (daysRemaining === null) return { status: 'undated', validUntil: null, daysRemaining: null }

  if (daysRemaining < 0) return { status: 'expired', validUntil: raw, daysRemaining }
  if (daysRemaining <= LICENSE_EXPIRY_WARNING_DAYS)
    return { status: 'expiring', validUntil: raw, daysRemaining }
  return { status: 'valid', validUntil: raw, daysRemaining }
}

/**
 * Reads the proposal against BR-B2B-022 and says what a contract still lacks.
 *
 * `documentKinds` is the list of files actually stored, one entry per file, so the band can
 * say `Anexado · 3 arquivo(s)` without a second query.
 */
export function buildRegularityReport(
  answers: PartnerAnswers,
  documentKinds: readonly PartnerDocumentKind[],
  now: Date = new Date()
): RegularityReport {
  const licenseFiles = documentKinds.filter((kind) => kind === 'business_license').length
  const incorporationFiles = documentKinds.filter(
    (kind) => kind === 'incorporation_document'
  ).length

  const license = licenseStatus(answers, licenseFiles > 0, now)

  const items: RegularityItem[] = [
    { id: 'tax_id', ok: has(answers, 'tax_id'), fileCount: 0 },
    {
      id: 'business_license',
      ok: license.status === 'valid' || license.status === 'expiring',
      fileCount: licenseFiles,
    },
    { id: 'incorporation_document', ok: incorporationFiles > 0, fileCount: incorporationFiles },
    {
      id: 'representative',
      ok: has(answers, 'representative_name') && has(answers, 'representative_role'),
      fileCount: 0,
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
  'business_license_valid_until',
  'representative_name',
  'representative_role',
]

const TRIAGE_FIELDS: readonly PartnerFieldId[] = ['story_before', 'story_unique', 'story_event']

export function absenceClassOf(field: PartnerFieldId): AbsenceClass {
  if (CONTRACT_FIELDS.indexOf(field) >= 0) return 'contract'
  if (TRIAGE_FIELDS.indexOf(field) >= 0) return 'triage'
  return 'optional'
}
