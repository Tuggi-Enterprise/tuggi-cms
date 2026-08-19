/**
 * Which state of the partnership pipeline one row is in, and what the next step is —
 * DS-COPY-020.
 *
 * Pure and derived TOP DOWN, from the most advanced state to the least: a client whose place
 * is already in the app is `Publicado` whatever else is true about the proposal behind it. The
 * queue, the detail header and the filters all call this, so they cannot label the same row
 * differently.
 *
 * WITH ONE STATE ABOVE `Publicado`, and it is not an exception to the ordering — it is the
 * ordering read properly. `Recusa não comunicada` is an act this company still owes somebody
 * OUTSIDE it, and DS-COPY-020, point 5, puts that above anything the pipeline knows about
 * itself: a state is terminal only when nothing more is due.
 *
 * THE IDENTITY OF THE ROW CHANGES HALFWAY, and that is why there are two detail routes. In
 * states 1 and 2 the object is the submission (`/admin/partnerships/proposals/{id}`); from the
 * client onwards it is the client (`/admin/partnerships/clients/{id}`). Deriving that here
 * keeps the queue from having to know the rule twice.
 */

import type { ConferenceRecord } from '@/lib/partner-form/regularity'

/**
 * THE NINE LABELS — the spec's eight plus one this pipeline needs.
 *
 * `refused_at_triage` is the spec's seventh, and it arrived with the card that gave the outcome
 * of the triage a place to live (#377, `partner.partner_triage_refusals`): while nothing recorded
 * it, a refused partnership would have sat in the queue looking overdue forever, which is why
 * spec §9, question 3, held both it and the `Triagem` column back.
 *
 * `refusal_not_communicated` is the spec's eighth and the reason there are two: the refusal was
 * DECIDED and the partner has not been told. One label for both facts hid the second, and the row
 * left the default filter still owing the communication — with the 72-hour clock running and
 * counted in `{n} com a triagem vencida`, which then opened an empty table. That is DS-COPY-020,
 * point 5, and its edge case names this defect.
 *
 * `client_created` is the extra one, and it is not an invention of convenience: promoting a
 * proposal writes `partner.clients` and NOTHING about a contract (`promoteProposal`), so every
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
  | 'refusal_not_communicated'
  | 'published'
  | 'discarded'
  | 'refused_at_triage'

/** The states that are still work. The queue's default filter (criterion 4). */
export const IN_PROGRESS_STATES: PipelineState[] = [
  'proposal_received',
  'in_conference',
  'client_created',
  'contract_signed',
  'place_in_curation',
  'refusal_not_communicated',
]

/**
 * Neither of these is work, and neither may show up under the default filter (criterion 4).
 *
 * `refused_at_triage` is terminal WITHOUT ending the partnership: BR-B2B-010, 6th edge case, and
 * BR-B2B-027, item 3 — the QR, the first-touch attribution and the revenue share stay whole, and
 * no POI leaves the catalogue. Terminal here means "the triage of this place is decided AND the
 * partner was told", never "the relationship is over" — before the communication the state is
 * `refusal_not_communicated`, which is work.
 */
export const TERMINAL_STATES: PipelineState[] = ['discarded', 'refused_at_triage']

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
  /** `partner.partner_form_submissions.status`. */
  proposalStatus: 'submitted' | 'promoted' | 'discarded'
  conference: ConferenceRecord
  /** The client the proposal was promoted into, if any. */
  clientId: string | null
  /** `partner.partner_contracts.status === 'signed'` for the live contract of that client. */
  contractSigned: boolean
  /** How many places carry `core.attractions.partner_client_id = clientId`. */
  placeCount: number
  /** How many of them satisfy the read model's visibility predicate. */
  publishedPlaceCount: number
  /**
   * How many of them are refused at triage — a row in `partner.partner_triage_refusals` and the
   * place not in the app (`isRefusedAtTriage`). Optional and defaulting to zero because a
   * partnership whose places nobody refused is the ordinary case, and every call site that has
   * the refusals passes them.
   */
  refusedPlaceCount?: number
  /**
   * Whether any refusal in force is still owed to the partner — `hasUncommunicatedRefusal`, which
   * is the ONE reading of "was the partner told" in the CMS. Never recomputed here from a count:
   * this is an `any`, not an arithmetic, and the clock closes on the same predicate.
   */
  uncommunicatedRefusal?: boolean
}

export function derivePipelineState(input: PipelineInput): PipelineState {
  if (input.proposalStatus === 'discarded') return 'discarded'

  if (input.clientId) {
    // DS-COPY-020, point 5 — ABOVE everything else this branch can say, including `published`.
    // A refusal decided and not communicated is an act owed to somebody outside the company, so
    // the row is work whatever the rest of the partnership looks like: it keeps its next step
    // (`Comunicar a recusa ao parceiro`) and stays in the default filter until the stamp exists.
    // It is also what keeps `{n} com a triagem vencida` and that filter from disagreeing — the
    // clock cannot be overdue on a place whose refusal was communicated.
    if (input.uncommunicatedRefusal === true) return 'refusal_not_communicated'

    const refused = input.refusedPlaceCount ?? 0
    // DECIDED, not "finished": a place is resolved when it is in the app or its triage refused
    // it. Below that line there is still work, and the row belongs in the work queue.
    const resolved = input.publishedPlaceCount + refused

    if (input.placeCount > 0 && resolved >= input.placeCount) {
      // Every place in the app: the partnership is delivered. One of three still in curation is
      // NOT `Publicado` — the queue shows the least advanced place (DS-COMPONENTE-020). And a
      // partnership whose every place was refused AND communicated is terminal, with the
      // partnership intact (BR-B2B-010, 6th edge case); the communication is already guaranteed
      // by the check above.
      return input.publishedPlaceCount > 0 ? 'published' : 'refused_at_triage'
    }
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
 *
 * FROM THE CLIENT ONWARDS IT IS THE CLIENT RECORD, and no longer a screen of its own. The five
 * bands are a TAB of `/admin/clients` now, carrying the same header — state, next step and the
 * triage clock — so nothing the standalone page offered is lost on the way, and the operator
 * lands one click from the fiscal data, the contract and the places instead of three page
 * changes away from them. `/admin/partnerships/clients/{id}` still answers, for the links
 * already out there.
 */
export function detailPath(
  state: PipelineState,
  ids: { submissionId: string; clientId: string | null }
): string {
  if (ids.clientId && state !== 'discarded') {
    return `/admin/clients?clientId=${ids.clientId}&tab=partnership`
  }
  return `/admin/partnerships/proposals/${ids.submissionId}`
}
