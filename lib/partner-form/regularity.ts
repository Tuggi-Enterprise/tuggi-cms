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
 * THE EXPIRY ARITHMETIC LEFT THIS FILE ON 2026-08-21. It read a date the conference no longer
 * records, by the operator's decision — see the note on `ConferenceRecord` for what that costs
 * BR-B2B-022 item 4. `daysUntil` stays because `ClientDirectory` counts a different clock with
 * it; nothing here calls it any more.
 */

import type { PartnerAnswers } from '@/lib/partner-form/schema'
import type { PartnerDocumentKind, PartnerFieldId } from '@/lib/partner-form/fields'

/**
 * What one operator saw with the papers in their hands. It is an assertion by a named person
 * (the record carries `reviewed_by`), never a file this system holds — and the band says
 * exactly that, so nobody reads a tick here as "the Tuggi verified the document".
 *
 * IT IS A TICK AND NOTHING ELSE SINCE 2026-08-21, by the operator's decision: *"nao iremos pedir
 * o numero do alvará, só dar um check no cms"*. Number, issuing municipality and validity date
 * left together. What they cost was three transcriptions off a piece of paper, on every
 * conference, for a trail nobody was reading back.
 *
 * WHAT LEFT WITH THE DATE, and it has to be said out loud rather than discovered: the system no
 * longer knows when a licence expires, so it cannot enforce the second half of BR-B2B-022 item
 * 4 (*"documento vencido é ausência"*, and regularity as a continuing obligation). The gate that
 * remains is "somebody says they saw it". Registered for `produto` — the rule text still
 * describes an expiry check that no code performs.
 */
export interface ConferenceRecord {
  /** The documents of BR-B2B-022 item 3 the team confirmed in person. */
  documentsSeen: PartnerDocumentKind[]
}

export const EMPTY_CONFERENCE: ConferenceRecord = {
  documentsSeen: [],
}

export type RegularityItemId =
  | 'tax_id'
  | 'business_license'
  | 'incorporation_document'
  | 'representative'

/**
 * `seen` — somebody registered having had it in their hands; `missing` — nobody has.
 *
 * IT USED TO HAVE FIVE VALUES, three of them about the expiry date. The date left on
 * 2026-08-21 with the rest of the transcription, so `expiring`, `expired` and `undated` became
 * states nothing could produce — and a state nothing produces is a lie the screen keeps telling
 * about what it checks. See the note on `ConferenceRecord`.
 */
export type LicenseStatus = 'seen' | 'missing'

export interface RegularityItem {
  id: RegularityItemId
  /** Satisfied for the purposes of signing a contract. */
  ok: boolean
}

export interface RegularityReport {
  items: RegularityItem[]
  license: { status: LicenseStatus }
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

export function licenseStatus(conference: ConferenceRecord): RegularityReport['license'] {
  return {
    status: conference.documentsSeen.indexOf('business_license') >= 0 ? 'seen' : 'missing',
  }
}

/**
 * Reads the proposal against BR-B2B-022 and says what a contract still lacks.
 *
 * Two of the four items come from what the partner typed and two from what the team saw; the
 * report does not distinguish them, because the contract does not either.
 *
 * SINCE 2026-08-21 THE LICENCE HALF IS A TICK. What the gate asks of the alvará is that somebody
 * registered having seen it; what it can no longer ask is that the document was in date, because
 * nothing records the date any more. The note on `ConferenceRecord` carries the decision and
 * what it costs.
 */
export function buildRegularityReport(
  answers: PartnerAnswers,
  conference: ConferenceRecord = EMPTY_CONFERENCE
): RegularityReport {
  const license = licenseStatus(conference)

  const items: RegularityItem[] = [
    { id: 'tax_id', ok: has(answers, 'tax_id') },
    { id: 'business_license', ok: license.status === 'seen' },
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
