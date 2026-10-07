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
import type { GateItem } from '@/lib/partnerships/acceptance-gate'

/**
 * The labels of the pipeline. Since #872 (BR-B2B-057) the board has four stages, and the three
 * contract states (`client_created`, `contract_sent`, `contract_signed`) are gone: the contract
 * of a new partner is an electronic acceptance (BR-B2B-056), and what sits between the client
 * and the curation is `awaiting_acceptance` — the client exists and the gate is not open yet
 * (the acceptance, the partner code or the slug), or the place does not exist yet.
 *
 * `refused_at_triage` arrived with `partner.partner_triage_refusals` (#377). `refusal_not_communicated`
 * is DS-COPY-020, point 5: a refusal decided and not yet told to the partner is still work.
 */
export type PipelineState =
  | 'proposal_received'
  | 'in_conference'
  | 'awaiting_acceptance'
  | 'place_in_curation'
  | 'refusal_not_communicated'
  | 'published'
  | 'discarded'
  | 'refused_at_triage'
  // The Portal Locais (#812, BR-B2B-049). Its own states because its acts are its own: the
  // validation replaces the conference, the acceptance replaces the contract, and refusing
  // refunds and ends — unlike `refused_at_triage`, which keeps the partnership (BR-B2B-010).
  | 'in_validation'
  | 'changes_requested'
  | 'approved_awaiting_narration'
  | 'portal_refused'

/**
 * `partner.place_submissions.status` (BR-B2B-049). `draft` and `awaiting_payment` are not the
 * operator's work — the client or the gateway acts — so they never reach the board, and the
 * type of `PipelineInput.portalStatus` says so.
 */
export type PortalStatus =
  | 'draft'
  | 'awaiting_payment'
  | 'in_review'
  | 'changes_requested'
  | 'approved'
  | 'live'
  | 'rejected'

export type PortalBoardStatus = Exclude<PortalStatus, 'draft' | 'awaiting_payment'>

export const PORTAL_BOARD_STATUSES: readonly PortalBoardStatus[] = [
  'in_review',
  'changes_requested',
  'approved',
  'live',
  'rejected',
]

export function isPortalBoardStatus(value: unknown): value is PortalBoardStatus {
  return (PORTAL_BOARD_STATUSES as readonly unknown[]).includes(value)
}

const PORTAL_STATE: Readonly<Record<PortalBoardStatus, PipelineState>> = {
  in_review: 'in_validation',
  changes_requested: 'changes_requested',
  approved: 'approved_awaiting_narration',
  live: 'published',
  rejected: 'portal_refused',
}

/** The states that are still work. The queue's default filter (criterion 4). */
export const IN_PROGRESS_STATES: PipelineState[] = [
  'proposal_received',
  'in_conference',
  'in_validation',
  'changes_requested',
  'awaiting_acceptance',
  'place_in_curation',
  'approved_awaiting_narration',
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
export const TERMINAL_STATES: PipelineState[] = ['discarded', 'refused_at_triage', 'portal_refused']

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
  // One condition since 2026-08-21, and it is the whole record: the conference is a tick. The
  // three licence transcriptions it used to also look at no longer exist.
  return conference.documentsSeen.length > 0
}

export interface PipelineInput {
  /** `partner.partner_form_submissions.status`. */
  proposalStatus: 'submitted' | 'promoted' | 'discarded'
  conference: ConferenceRecord
  /** The client the proposal was promoted into, if any. */
  clientId: string | null
  /**
   * What the BR-B2B-057 gate still lacks for this client (`missingGateItems` over
   * `partner.client_acceptance_gate`). Empty = slug, partner code and acceptance are there.
   */
  gateMissing: readonly GateItem[]
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
  /**
   * Where the row came from. `portal` reads `portalStatus` and nothing else: the portal has no
   * conference, no promotion and no contract (BR-B2B-047, item 1). Its approved row passes
   * through `awaiting_acceptance` without stopping when the gate is open (BR-B2B-057, item 2).
   */
  origin?: 'form' | 'portal'
  portalStatus?: PortalBoardStatus
}

export function derivePipelineState(input: PipelineInput): PipelineState {
  // BEFORE the client branch, on purpose — see `origin`.
  if (input.origin === 'portal' && input.portalStatus) {
    const state = PORTAL_STATE[input.portalStatus]
    // BR-B2B-057, item 2: the portal row already carries its acceptance and passes through
    // `Aguardando aceite` without stopping — unless the gate is not open (a code still missing).
    if (state === 'approved_awaiting_narration' && input.gateMissing.length > 0) return 'awaiting_acceptance'
    return state
  }

  if (input.proposalStatus === 'discarded') return 'discarded'

  if (input.clientId) {
    // DS-COPY-020, point 5 — ABOVE everything else this branch can say, including `published`.
    // A refusal decided and not communicated is an act owed to somebody outside the company, so
    // the row is work whatever the rest of the partnership looks like.
    if (input.uncommunicatedRefusal === true) return 'refusal_not_communicated'

    const refused = input.refusedPlaceCount ?? 0
    // DECIDED, not "finished": a place is resolved when it is in the app or its triage refused it.
    const resolved = input.publishedPlaceCount + refused

    if (input.placeCount > 0 && resolved >= input.placeCount) {
      // Every place in the app: the partnership is delivered (legacy published places included —
      // the gate stops a transition, it does not take a place out of the app).
      return input.publishedPlaceCount > 0 ? 'published' : 'refused_at_triage'
    }
    // BR-B2B-057, item 3: the curation needs slug, partner code AND acceptance, and a place to
    // curate. Missing any of the four, the row waits in `Aguardando aceite`.
    if (input.gateMissing.length > 0 || input.placeCount === 0) return 'awaiting_acceptance'
    return 'place_in_curation'
  }

  return conferenceStarted(input.conference) ? 'in_conference' : 'proposal_received'
}

/**
 * WHAT `Abrir` OPENS — the object, and never the address.
 *
 * This used to return a finished path, `/admin/clients?clientId=X&tab=partnership`, and that
 * string was a query built from nothing: it carried the record and dropped everything else the
 * operator had on screen. `view=table` went, and so did the search, the country, the pipeline
 * state — so opening a card from a filtered board and coming back landed on an unfiltered
 * board in the other view. The list has one set of filters and they live in the URL; a module
 * with no access to that URL cannot be the one writing it.
 *
 * So the decision that IS this module's — which of the two objects a row is about — comes back
 * as the object, and the caller composes the address around the parameters it already holds.
 * `lib/clients/record-href` is the one composer, shared by the link and by `openRecord`.
 *
 * States 1 and 2 are about the submission; everything from the client onwards is about the
 * client. A discarded proposal keeps pointing at the submission, which is where its reason and
 * the restore control live.
 *
 * FROM THE CLIENT ONWARDS IT IS THE CLIENT RECORD, and no longer a screen of its own. The five
 * bands are a TAB of `/admin/clients` now, carrying the same header — state, next step and the
 * triage clock — so nothing the standalone page offered is lost on the way, and the operator
 * lands one click from the fiscal data, the contract and the places instead of three page
 * changes away from them. `/admin/partnerships/clients/{id}` still answers, for the links
 * already out there.
 */
export type DetailTarget =
  // `places` is where the validation sends the operator after approving (#870): the next act is
  // the boundary, and the POI card in `PlacesTab` is what leads to the place editor.
  | { kind: 'client'; clientId: string; tab: 'partnership' | 'places' }
  | { kind: 'proposal'; submissionId: string }
  // A portal row is the submission until it is live (#812): the validation screen decides it.
  | { kind: 'validation'; submissionId: string }

export function portalDetailTarget(
  state: PipelineState,
  ids: { submissionId: string; clientId: string | null }
): DetailTarget {
  if (state === 'published' && ids.clientId) {
    return { kind: 'client', clientId: ids.clientId, tab: 'partnership' }
  }
  return { kind: 'validation', submissionId: ids.submissionId }
}

export function detailTarget(
  state: PipelineState,
  ids: { submissionId: string; clientId: string | null }
): DetailTarget {
  if (ids.clientId && state !== 'discarded') {
    return { kind: 'client', clientId: ids.clientId, tab: 'partnership' }
  }
  return { kind: 'proposal', submissionId: ids.submissionId }
}
