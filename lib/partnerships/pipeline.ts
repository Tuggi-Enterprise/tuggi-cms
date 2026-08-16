/**
 * Which state of the partnership pipeline one row is in, and what the next step is —
 * DS-COPY-020.
 *
 * Pure and derived TOP DOWN, from the most advanced state to the least: a client whose place
 * is already in the app is `Publicado` whatever else is true about the proposal behind it. The
 * queue, the detail header and the filters all call this, so they cannot label the same row
 * differently.
 *
 * THE IDENTITY OF THE ROW CHANGES HALFWAY, and that is why there are two detail routes. In
 * states 1 and 2 the object is the submission (`/admin/partnerships/proposals/{id}`); from the
 * client onwards it is the client (`/admin/partnerships/clients/{id}`). Deriving that here
 * keeps the queue from having to know the rule twice.
 */

import type { ConferenceRecord } from '@/lib/partner-form/regularity'

/**
 * THE SEVEN LABELS, and one of them is not the one the spec listed.
 *
 * The spec's seventh is `Recusado na triagem`, and it is NOT here: BR-B2B-010's Nota de
 * operação declares that no column records the outcome of triage, and spec §9, question 3, is
 * explicit that until it exists neither the terminal state nor the `Triagem` column may be
 * published — a refused partnership would sit in the queue looking overdue forever. That is a
 * card of its own, with the `data` migration in front of it.
 *
 * `client_created` takes its place, and it is not an invention of convenience: promoting a
 * proposal writes `core.clients` and NOTHING about a contract (`promoteProposal`), so every
 * partnership passes through "the client exists, the contract is not signed yet". Without this
 * id those rows derive to no state at all and vanish from the queue — which is the one failure
 * mode a work queue may not have. Its copy is built out of the spec's own vocabulary for band
 * 3 (`Cliente criado em 14/08 · … · Contrato assinado em 15/08`) and is flagged to `design`.
 */
export type PipelineState =
  | 'proposal_received'
  | 'in_conference'
  | 'client_created'
  | 'contract_signed'
  | 'place_in_curation'
  | 'published'
  | 'discarded'

/** The states that are still work. The queue's default filter (criterion 4). */
export const IN_PROGRESS_STATES: PipelineState[] = [
  'proposal_received',
  'in_conference',
  'client_created',
  'contract_signed',
  'place_in_curation',
]

export const TERMINAL_STATES: PipelineState[] = ['discarded']

/** Every state, in pipeline order — the order the queue's counters are shown in. */
export const PIPELINE_STATES: PipelineState[] = IN_PROGRESS_STATES.concat(
  'published',
  ...TERMINAL_STATES
)

/**
 * State 2 has no column behind it, and the screen says so rather than pretending.
 * DS-COMPONENTE-020, 1st edge case: a derived pendency shows the criterion it was derived
 * from, because derivation without a visible criterion is guesswork wearing the clothes of
 * data.
 */
export function conferenceStarted(conference: ConferenceRecord): boolean {
  return (
    conference.documentsSeen.length > 0 ||
    conference.licenseNumber !== null ||
    conference.licenseIssuer !== null ||
    conference.licenseValidUntil !== null
  )
}

export interface PipelineInput {
  /** `core.partner_form_submissions.status`. */
  proposalStatus: 'submitted' | 'promoted' | 'discarded'
  conference: ConferenceRecord
  /** The client the proposal was promoted into, if any. */
  clientId: string | null
  /** `core.partner_contracts.status === 'signed'` for the live contract of that client. */
  contractSigned: boolean
  /** How many places carry `core.attractions.partner_client_id = clientId`. */
  placeCount: number
  /** How many of them satisfy the read model's visibility predicate. */
  publishedPlaceCount: number
}

export function derivePipelineState(input: PipelineInput): PipelineState {
  if (input.proposalStatus === 'discarded') return 'discarded'

  if (input.clientId) {
    // Every place in the app: the partnership is delivered. One of three still in curation is
    // NOT `Publicado` — the queue shows the least advanced place (DS-COMPONENTE-020).
    if (input.placeCount > 0 && input.publishedPlaceCount === input.placeCount) return 'published'
    if (input.placeCount > 0) return 'place_in_curation'
    if (input.contractSigned) return 'contract_signed'
    return 'client_created'
  }

  return conferenceStarted(input.conference) ? 'in_conference' : 'proposal_received'
}

/**
 * Where `Abrir` goes, without the locale prefix. States 1 and 2 are about the submission;
 * everything from the client onwards is about the client. A discarded proposal keeps pointing
 * at the submission, which is where its reason and the restore control live.
 */
export function detailPath(
  state: PipelineState,
  ids: { submissionId: string; clientId: string | null }
): string {
  if (ids.clientId && state !== 'discarded') {
    return `/admin/partnerships/clients/${ids.clientId}`
  }
  return `/admin/partnerships/proposals/${ids.submissionId}`
}
