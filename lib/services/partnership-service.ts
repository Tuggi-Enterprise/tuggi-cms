/**
 * The partnership pipeline, assembled — one list and one detail, out of five tables that
 * nobody had ever read together.
 *
 * WHAT THIS MODULE IS FOR, in one sentence: until now the state of the pipeline lived in the
 * operator's head, because the proposal, the client, the contract and the place are four
 * screens and none of them carried context to the next. The measurement in #356 is what that
 * costs — of the 6 clients with a `welcome_poi_id`, 3 have zero trigger points: places that
 * are published, intact, and mute, with nobody in a position to notice.
 *
 * THE LIST IS ANCHORED ON BOTH, and that is the correction the unified directory made. Spec §3
 * is still true about the OBJECT — states 1 and 2 exist only as a submission, states 3 onwards
 * only through `promoted_client_id` — but anchoring the list on the submission alone left every
 * hand-registered client out of it, and there was a second screen listing exactly those. There
 * is one list now, `loadClientDirectory`, and its spine is the union.
 *
 * WHICH IDENTITY READS WHAT. The submissions, the clients and the contracts are read with the
 * service client, exactly as `partner-proposal-admin-service` already does, and every function
 * here is called only from `withAuth({ roles: ['admin'] })`. `core.attractions` and its
 * children are read with the OPERATOR's client, because an unapproved place is visible through
 * the `CMS admins can read attractions` policy and asking with `service_role` would answer for
 * an identity that is not the one on the screen — the same reasoning `provisionPartnerPlace`
 * wrote down for the write side.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseService } from '@/lib/core/supabase-client'
import { placeService, type PartnerPlaceRow } from '@/lib/core/place-service'
import { readReviewNote } from '@/lib/partner-form/proposal-review'
import { normalizedTaxId } from '@/lib/partner-form/tax-id-key'
import type { ConferenceRecord } from '@/lib/partner-form/regularity'
import {
  buildPlaceReadiness,
  readinessContextOf,
  summarizePlaces,
  type PlaceReadiness,
  type PlacesSummary,
} from '@/lib/partnerships/place-readiness'
import { buildPublishPlan, type PartnerFee, type PublishPlan } from '@/lib/partnerships/publish-plan'
import {
  currentRefusal,
  hasUncommunicatedRefusal,
  isRefusedAtTriage,
  isTriageGate,
  type PlaceTriageOutcome,
  type TriageFacts,
  type TriageRefusal,
} from '@/lib/partnerships/triage'
import { triageRefusalService, type TriageRefusalRow } from '@/lib/core/triage-refusal-service'
import { operatorLabel } from '@/lib/services/operator-label'
import {
  NO_CONFERENCE,
  getClientConference,
  getClientConferences,
} from '@/lib/services/client-conference-service'
import {
  derivePipelineState,
  detailPath,
  type PipelineState,
} from '@/lib/partnerships/pipeline'
import type { PartnerAnswers } from '@/lib/partner-form/schema'
import type { ContractState, ContractStatus } from '@/lib/contract/status'
import type { ContractTier } from '@/lib/contract/snapshot'
import { PLAN_CHOICES, type PlanChoice } from '@/lib/partner-form/fields'

/**
 * What a row with no client says about money: nothing, and `undeclared` is the honest reading of
 * nothing. Absent is NOT zero (BR-B2B-017, item 6) — a constant so the two row shapes below
 * cannot disagree about it.
 */
const NO_FEE: PartnerFee = { monthlyFeeCents: null, isCourtesy: false, courtesyReason: null }

function isPlanChoice(value: unknown): value is PlanChoice {
  return PLAN_CHOICES.indexOf(value as PlanChoice) >= 0
}

/**
 * This module reads from TWO schemas, which is why there are two clients and not one.
 *
 * The partner domain moved from `core` to `partner` on 2026-08-19 (`20260819150000`);
 * `audit_logs` did not, because an audit trail is not the partner's. A single `SCHEMA` constant
 * here would force one of the two reads to be wrong — and while the compatibility views still
 * exist in `core`, wrong WITHOUT BREAKING, which is the worst way to be wrong. The views come
 * down in phase 3 (`docs/dev/migracao-schema-partner.md`) and only then would it start to hurt.
 */
function service() {
  return getSupabaseService().schema('partner')
}

/** `audit_logs` only, which stays in `core`. */
function coreService() {
  return getSupabaseService().schema('core')
}

const SUBMISSION_COLUMNS =
  'id, status, answers, submitted_at, updated_at, created_at, promoted_at, promoted_by, ' +
  'promoted_client_id, review_note, reviewed_at, reviewed_by, discard_reason'

/**
 * The columns of `partner.clients` the pipeline decides with. An allowlist, and a short one: the
 * fiscal record, the banking record, the team and the coupons stay on the client's own page
 * (DS-LAYOUT-006, 1st edge case) — copying three of them here "for convenience" is how the
 * second source of the same fact gets born.
 */
const CLIENT_COLUMNS =
  'id, name, company_name, city, state, country, client_type, tax_id, status, approved_at, ' +
  'created_at, monthly_fee_cents, is_courtesy, courtesy_reason, welcome_poi_id'

interface SubmissionRow {
  id: string
  status: 'submitted' | 'promoted' | 'discarded'
  answers: PartnerAnswers | null
  submitted_at: string | null
  updated_at: string | null
  created_at: string
  promoted_at: string | null
  promoted_by: string | null
  promoted_client_id: string | null
  review_note: unknown
  reviewed_at: string | null
  reviewed_by: string | null
  discard_reason: string | null
}

export interface PipelineClient {
  id: string
  name: string | null
  companyName: string | null
  city: string | null
  region: string | null
  /** Added with the unified directory: `país`, `estado` and `cidade` are three of its filters. */
  country: string | null
  /** The relationship category — the directory filters by it, and the badge reads it. */
  clientType: string | null
  taxId: string | null
  status: string | null
  approvedAt: string | null
  createdAt: string | null
  fee: PartnerFee
  /**
   * The POI that plays on `/d/{slug}` — DERIVED from the link since 2026-08-23, not typed.
   *
   * It is here so the `Locais` tab can say WHICH of the client's places answers the welcome
   * page. It used to be a UUID pasted by hand into a second field, and of the 10 clients that
   * carried one, 10 pointed at a POI that was not the client's place.
   */
  welcomePoiId: string | null
}

export interface PipelineContract {
  status: ContractStatus
  /**
   * `partner_contracts.tier` — a COLUMN, deliberately, and not the tier inside `snapshot`.
   * The frozen snapshot carries legal names, addresses and the representative of every partner,
   * and a list endpoint has no business dragging that through for a label. The tier alone
   * answers `does this contract charge`, which is the question the directory asks.
   */
  tier: ContractTier | null
  signed: boolean
  signedAt: string | null
  signerName: string | null
}

/**
 * ONE LIST, and it is the answer to the question the two screens were asking separately.
 *
 * `/admin/clients` was anchored on `partner.clients` and `/admin/partnerships` on
 * `partner.partner_form_submissions`, so the same establishment was two rows in two screens with
 * two vocabularies — and neither list could answer `quais parceiros de Minas ainda não
 * assinaram o contrato?`, because half the answer was in the other screen.
 *
 * The spine here is the UNION: every client, plus every proposal that has not become one yet.
 * From `promoted_client_id` onwards the two are the same row, which is the rule
 * `lib/partnerships/pipeline` already wrote down — the identity of a partnership changes
 * halfway, and this is the list that stops pretending otherwise.
 *
 * A CLIENT WITH NO PROPOSAL IS STILL A ROW. That is the half `/admin/partnerships` could not
 * show: the 10 clients that predate the form, and every `influencer` or `hotel` somebody
 * registered by hand. Their pipeline derives from what exists — no submission means no
 * conference to read, which `derivePipelineState` already answers for.
 *
 * NOTHING IS FILTERED HERE. The rows come whole and `lib/clients/directory-filter` decides
 * what the operator sees, because the facet counts have to be computed over the same set the
 * table renders — a count that comes from a different query than the rows is the defect that
 * made `1 com a triagem vencida` open an empty table.
 */
export interface ClientDirectoryRow {
  /** The proposal behind the row, or `null` for a registration nobody proposed. */
  submissionId: string | null
  /** The record the row opens, or `null` while the proposal has not been promoted. */
  clientId: string | null
  state: PipelineState
  /** Where `Abrir` goes, without the locale prefix. */
  href: string
  name: string | null
  taxId: string | null
  city: string | null
  region: string | null
  country: string | null
  clientType: string | null
  /** `pending` | `approved` | `rejected` — the approval of the RELATIONSHIP, not of a place. */
  status: string | null
  /**
   * The live contract's state, or `none`. A filter of its own because `quem ainda não assinou`
   * is the question the two lists could not answer between them.
   */
  contract: ContractState
  /**
   * THE THREE ANSWERS TO `who pays`, carried separately because they belong to three different
   * people and `derivePartnerPlan` is what picks between them. Merging them into one field here
   * would be the merge that module exists to prevent.
   */
  fee: PartnerFee
  /** `partner_contracts.tier` of the live contract — what the partner signed. */
  contractTier: ContractTier | null
  /** `answers.plan_choice` — what the establishment ASKED FOR. It prices nothing. */
  planChoice: PlanChoice | null
  /** Other proposals waiting with the same CNPJ — the existing badge, kept. */
  duplicateCount: number
  /** The last thing that happened here. `Parado há` counts from it. */
  since: string | null
  places: PlacesSummary
  /**
   * The FACTS the triage clock is derived from, never the text: a screen left open must not go
   * on saying `até 18/08` after the 18th, so the clock is computed where it is rendered.
   */
  triage: TriageFacts
  discardReason: string | null
}

export interface ClientDirectory {
  rows: ClientDirectoryRow[]
  /** True when the caps below cut the set. The screen says so rather than lying by omission. */
  truncated: boolean
}

const DIRECTORY_CLIENT_CAP = 1000
const DIRECTORY_SUBMISSION_CAP = 1000

export async function loadClientDirectory(operator: SupabaseClient): Promise<ClientDirectory> {
  const [submissionsResult, clients] = await Promise.all([
    service()
      .from('partner_form_submissions')
      .select(SUBMISSION_COLUMNS)
      .order('submitted_at', { ascending: false })
      .limit(DIRECTORY_SUBMISSION_CAP),
    loadAllClients(DIRECTORY_CLIENT_CAP),
  ])

  const submissions = (submissionsResult.error ? [] : submissionsResult.data ?? []) as unknown as SubmissionRow[]
  const clientIds = Array.from(clients.keys())

  const [contracts, places, conferences] = await Promise.all([
    loadLiveContracts(clientIds),
    loadPartnerPlaces(clientIds, operator),
    // ONE read for the whole queue, and it reads the CLIENT. Deriving the state from the
    // proposal annotation — which is what happened until 2026-08-21 — made this list and the
    // detail answer differently about the same client, and pinned every client that was never
    // a proposal at `in_conference` for a step neither screen could complete.
    getClientConferences(clientIds),
  ])

  // One read for the whole queue, and it is the only extra round trip the `Triagem` column
  // costs. Per row it would be N+1 over a screen the operator reloads all day.
  const refusals = await loadRefusalStamps(
    Array.from(places.values()).flat().map((row) => row.attractionId)
  )

  const duplicates = countPendingDuplicates(submissions)

  /** Facts every row needs, whether it came from a proposal or straight from a registration. */
  function partnershipOf(client: PipelineClient | null) {
    const contract = client ? contracts.get(client.id) ?? null : null
    // The tier of the LIVE contract decides whether a description is owed at all — a free-tier
    // partner is a name, by design (BR-B2B-016, item 1).
    const context = readinessContextOf(contract?.tier ?? null)
    const readiness = (client ? places.get(client.id) ?? [] : []).map((row) =>
      buildPlaceReadiness(row, context)
    )
    const outcomes: PlaceTriageOutcome[] = readiness.map((item) => ({
      attractionId: item.place.attractionId,
      published: item.published,
      refusal: refusals.get(item.place.attractionId) ?? null,
    }))
    return { readiness, outcomes, contract }
  }

  const rows: ClientDirectoryRow[] = submissions.map((row) => {
    const clientId = row.promoted_client_id
    const client = clientId ? clients.get(clientId) ?? null : null
    const { readiness, outcomes, contract } = partnershipOf(client)
    // A proposal not yet promoted has no client to carry a conference, so the annotation is
    // still the only record there is — and it is the right one: at that point the proposal IS
    // the establishment. Once promoted, the client's row is the answer.
    const conference = client
      ? (conferences.get(client.id) ?? NO_CONFERENCE).conference
      : readReviewNote(row.review_note).conference

    const state = derivePipelineState({
      proposalStatus: row.status,
      conference,
      // A `promoted_client_id` pointing at a row that no longer answers is not a client: the
      // state has to fall back to the proposal, or the list would show a client-shaped row
      // whose detail route is a 404.
      clientId: client ? client.id : null,
      contract: contract?.status ?? 'none',
      placeCount: readiness.length,
      publishedPlaceCount: readiness.filter((item) => item.published).length,
      refusedPlaceCount: outcomes.filter(isRefusedAtTriage).length,
      uncommunicatedRefusal: hasUncommunicatedRefusal(outcomes),
    })

    const answers = row.answers ?? {}

    return {
      submissionId: row.id,
      clientId: client?.id ?? null,
      state,
      href: detailPath(state, { submissionId: row.id, clientId: client?.id ?? null }),
      // What the partner wrote wins over the registration while both exist: the proposal is
      // the name the operator is about to recognise in the queue.
      name: answers.trade_name ?? client?.name ?? null,
      taxId: answers.tax_id ?? client?.taxId ?? null,
      city: answers.city ?? client?.city ?? null,
      region: answers.state ?? client?.region ?? null,
      country: client?.country ?? null,
      clientType: client?.clientType ?? null,
      status: client?.status ?? null,
      contract: contract?.status ?? 'none',
      fee: client?.fee ?? NO_FEE,
      contractTier: contract?.tier ?? null,
      planChoice: isPlanChoice(answers.plan_choice) ? answers.plan_choice : null,
      duplicateCount: duplicates.get(row.id) ?? 0,
      since: lastEvent([
        row.submitted_at,
        row.reviewed_at,
        row.promoted_at,
        client?.approvedAt ?? null,
        contract?.signedAt ?? null,
      ]),
      places: summarizePlaces(readiness),
      triage: { approvedAt: client?.approvedAt ?? null, places: outcomes },
      discardReason: row.status === 'discarded' ? row.discard_reason : null,
    }
  })

  // The other half of the list: every client no proposal claims. The 10 that predate the form,
  // and every registration somebody typed by hand — invisible in the queue until now.
  const claimed = new Set(
    submissions
      .map((row) => row.promoted_client_id)
      .filter((id): id is string => typeof id === 'string')
  )

  for (const client of clients.values()) {
    if (claimed.has(client.id)) continue
    const { readiness, outcomes, contract } = partnershipOf(client)

    rows.push({
      submissionId: null,
      clientId: client.id,
      // A client that arrived without a proposal HAS a conference to read since 2026-08-21 —
      // its own. `promoted` is what the detail already assumes for it: the same call, the same
      // answer, and now the same evidence.
      state: derivePipelineState({
        proposalStatus: 'promoted',
        conference: (conferences.get(client.id) ?? NO_CONFERENCE).conference,
        clientId: client.id,
        contract: contract?.status ?? 'none',
        placeCount: readiness.length,
        publishedPlaceCount: readiness.filter((item) => item.published).length,
        refusedPlaceCount: outcomes.filter(isRefusedAtTriage).length,
        uncommunicatedRefusal: hasUncommunicatedRefusal(outcomes),
      }),
      href: `/admin/clients?clientId=${client.id}`,
      name: client.name ?? client.companyName ?? null,
      taxId: client.taxId,
      city: client.city,
      region: client.region,
      country: client.country,
      clientType: client.clientType,
      status: client.status,
      contract: contract?.status ?? 'none',
      fee: client.fee,
      contractTier: contract?.tier ?? null,
      // A registration nobody proposed asked for nothing: there is no form behind it.
      planChoice: null,
      duplicateCount: 0,
      since: lastEvent([client.createdAt, client.approvedAt, contract?.signedAt ?? null]),
      places: summarizePlaces(readiness),
      triage: { approvedAt: client.approvedAt, places: outcomes },
      discardReason: null,
    })
  }

  return {
    rows,
    truncated:
      submissions.length >= DIRECTORY_SUBMISSION_CAP || clients.size >= DIRECTORY_CLIENT_CAP,
  }
}

/** Who put this place in front of tourists, and when. Absent until somebody does. */
export interface PublicationTrail {
  at: string
  by: string | null
}

export interface PartnershipPlace {
  readiness: PlaceReadiness
  plan: PublishPlan
  /**
   * WHY THE SCREEN READS THE TRAIL AND NOT `attractions.approved_at` / `approved_by`.
   *
   * Publishing writes both — the stamp is the schema's home for the fact and
   * `placeService.setApproved` fills it (a column that exists is not the same as data that
   * exists: 136 filled rows in ~2.23 M, measured by the `data` on 2026-08-16). What the stamp
   * cannot answer is what this screen asks: `approved_by` is a `drive.profiles` id, so showing
   * a name from it costs a join, and the column holds only the LAST publication.
   *
   * `core.audit_logs` has to carry who, when, which client and which place anyway (criterion
   * 21), it already carries the operator's e-mail, and it keeps every publication rather than
   * the current one. That is what band 5 and the trail render.
   */
  publishedBy: PublicationTrail | null
  /**
   * The refusal in force for THIS place, if the triage refused it — BR-B2B-011. Per place and
   * never per client: a CNPJ has more than one address, and refusing one does not refuse the
   * others (`partner.partner_triage_refusals.attraction_id` is NOT NULL for that reason).
   */
  refusal: TriageRefusal | null
}

export interface PartnershipDetail {
  state: PipelineState
  client: PipelineClient
  contract: PipelineContract | null
  /**
   * The conference of BR-B2B-022, item 3, READ FROM THE CLIENT and no longer from the proposal
   * annotation.
   *
   * It sits beside `submission` and not inside it, and that is the whole correction. Band 2 of
   * this pipeline used to render `submission.conference`, so a client that was never a proposal
   * showed `conferenceNone` forever — and `derivePipelineState` was fed the same empty record,
   * which pinned the pipeline at `in_conference` for a step the screen offered no way to
   * complete. Ten of twelve clients were in that state on 2026-08-21.
   */
  conference: {
    record: ConferenceRecord
    reviewedAt: string | null
    reviewedByLabel: string | null
  }
  submission: {
    id: string
    submittedAt: string | null
    promotedAt: string | null
    promotedByLabel: string | null
    reviewedAt: string | null
    reviewedByLabel: string | null
    conference: ConferenceRecord
  } | null
  places: PartnershipPlace[]
  /**
   * THE POINTER THAT DISAGREES WITH THE LINK, when there is one.
   *
   * `partner.clients.welcome_poi_id` and `core.attractions.partner_client_id` were two
   * independent ways to say "this partner's POI", and measured on 2026-08-23 the two disagreed
   * for 10 of the 10 clients that carried a welcome POI. `Garota Beer` is the shape of it: the
   * welcome POI points at a real, published establishment, `partner_client_id` points nowhere,
   * and band 4 reads `este cliente ainda não tem local vinculado` over a partner that HAS one.
   *
   * `null` when the two agree — the ordinary case from now on, since linking adopts the welcome
   * POI. When it is filled, the screen shows the POI and offers the act that ends the
   * divergence, instead of an empty state that is not true.
   */
  welcomeDivergence: WelcomeDivergence | null
  /** The same facts the queue column reads, so the header and the row cannot disagree. */
  triage: TriageFacts
}

/** The welcome POI of a client that is not among that client's places. */
export interface WelcomeDivergence {
  attractionId: string
  name: string
  city: string | null
  country: string | null
  entityKind: string
  approved: boolean
  /** `partner_client_id` of the POI — another client's, when it is not null. */
  partnerClientId: string | null
}

export async function loadPartnershipDetail(
  clientId: string,
  operator: SupabaseClient
): Promise<PartnershipDetail | null> {
  const clients = await loadClients([clientId])
  const client = clients.get(clientId)
  if (!client) return null

  const [contracts, places, submission, clientConference] = await Promise.all([
    loadLiveContracts([clientId]),
    loadPartnerPlaces([clientId], operator),
    loadPromotedSubmission(clientId),
    getClientConference(clientId),
  ])

  const contract = contracts.get(clientId) ?? null
  const readiness = (places.get(clientId) ?? []).map((row) =>
    buildPlaceReadiness(row, readinessContextOf(contract?.tier ?? null))
  )
  const attractionIds = readiness.map((item) => item.place.attractionId)
  const [trail, refusals] = await Promise.all([
    loadPublicationTrail(attractionIds),
    loadCurrentRefusals(attractionIds),
  ])

  const conference = clientConference.conference

  const outcomes: PlaceTriageOutcome[] = readiness.map((item) => ({
    attractionId: item.place.attractionId,
    published: item.published,
    refusal: refusals.get(item.place.attractionId) ?? null,
  }))

  return {
    state: derivePipelineState({
      proposalStatus: submission?.status ?? 'promoted',
      conference,
      clientId,
      contract: contract?.status ?? 'none',
      placeCount: readiness.length,
      publishedPlaceCount: readiness.filter((item) => item.published).length,
      refusedPlaceCount: outcomes.filter(isRefusedAtTriage).length,
      uncommunicatedRefusal: hasUncommunicatedRefusal(outcomes),
    }),
    client,
    contract,
    conference: {
      record: conference,
      reviewedAt: clientConference.reviewedAt,
      reviewedByLabel: clientConference.reviewedBy
        ? await operatorLabel(clientConference.reviewedBy)
        : null,
    },
    submission: submission
      ? {
          id: submission.id,
          submittedAt: submission.submitted_at,
          promotedAt: submission.promoted_at,
          promotedByLabel: await operatorLabel(submission.promoted_by),
          reviewedAt: submission.reviewed_at,
          reviewedByLabel: await operatorLabel(submission.reviewed_by),
          conference,
        }
      : null,
    places: readiness.map((item) => ({
      readiness: item,
      plan: buildPublishPlan(client.fee, item),
      publishedBy: trail.get(item.place.attractionId) ?? null,
      refusal: refusals.get(item.place.attractionId) ?? null,
    })),
    welcomeDivergence: await loadWelcomeDivergence(
      client.welcomePoiId,
      attractionIds,
      operator
    ),
    triage: { approvedAt: client.approvedAt, places: outcomes },
  }
}

/**
 * The welcome POI, but only when it is NOT one of the client's places.
 *
 * Reading it costs one query and only when the two pointers disagree, which after 2026-08-23 is
 * a backlog and not a state anybody can create: linking adopts the welcome POI, and the welcome
 * POI can only be chosen among the places.
 *
 * Read with the OPERATOR's client, like the places beside it: an unapproved row is visible
 * through `CMS admins can read attractions`, and answering for another identity would show a
 * POI the operator cannot then act on.
 */
async function loadWelcomeDivergence(
  welcomePoiId: string | null,
  linkedAttractionIds: string[],
  operator: SupabaseClient
): Promise<WelcomeDivergence | null> {
  if (!welcomePoiId) return null
  if (linkedAttractionIds.indexOf(welcomePoiId) >= 0) return null

  const { data, error } = await operator
    .schema('core')
    .from('attractions')
    .select('id, name, city, country, entity_kind, approved, partner_client_id')
    .eq('id', welcomePoiId)
    .maybeSingle()

  // A pointer at a row nobody can read is not a divergence the screen can help with — it is a
  // dangling id, and inventing a name for it would be worse than saying nothing.
  if (error || !data) return null

  const row = data as {
    id: string
    name: string
    city: string | null
    country: string | null
    entity_kind: string
    approved: boolean | null
    partner_client_id: string | null
  }

  return {
    attractionId: row.id,
    name: row.name,
    city: row.city,
    country: row.country,
    entityKind: row.entity_kind,
    approved: row.approved === true,
    partnerClientId: row.partner_client_id,
  }
}

/**
 * One place, re-read after the act — what the publish route answers with, so the screen never
 * has to guess what it just produced (DS-LAYOUT-006, point 3, applied to the act itself).
 *
 * `null` when the place is not linked to that client: the route is about a PARTNER's place,
 * and a place with no partner behind it is not this screen's to approve.
 */
export async function loadPartnerPlace(
  clientId: string,
  attractionId: string,
  operator: SupabaseClient
): Promise<PartnershipPlace | null> {
  const clients = await loadClients([clientId])
  const client = clients.get(clientId)
  if (!client) return null

  const rows = await placeService.listByPartnerClient([clientId], operator)
  const row = rows.find((item) => item.attractionId === attractionId)
  if (!row) return null

  // The same tier the queue and the detail read. A single place that asked for a description the
  // other two screens did not ask for would be the disagreement the shared module exists to make
  // impossible (DS-COMPONENTE-020, point 4).
  const contracts = await loadLiveContracts([clientId])
  const readiness = buildPlaceReadiness(
    row,
    readinessContextOf(contracts.get(clientId)?.tier ?? null)
  )
  const [trail, refusals] = await Promise.all([
    loadPublicationTrail([attractionId]),
    loadCurrentRefusals([attractionId]),
  ])
  return {
    readiness,
    plan: buildPublishPlan(client.fee, readiness),
    publishedBy: trail.get(attractionId) ?? null,
    refusal: refusals.get(attractionId) ?? null,
  }
}

/**
 * The last publication of each place, out of `core.audit_logs`.
 *
 * Only `PUBLISH_PARTNER_PLACE` counts, and only the newest one: a place taken out of the app
 * and put back is in the app because of the LAST publication, and the previous one is history
 * the `/admin/audit-logs` screen already keeps. `UNPUBLISH_PARTNER_PLACE` is deliberately not
 * read here — band 5 only appears for a place that IS published, and the readiness report is
 * what decides that, never the trail.
 */
async function loadPublicationTrail(
  attractionIds: string[]
): Promise<Map<string, PublicationTrail>> {
  const map = new Map<string, PublicationTrail>()
  if (attractionIds.length === 0) return map

  const { data, error } = await coreService()
    .from('audit_logs')
    .select('entity_id, user_email, created_at')
    .eq('action', 'PUBLISH_PARTNER_PLACE')
    .in('entity_id', attractionIds)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error || !data) return map

  for (const row of data as {
    entity_id: string | null
    user_email: string | null
    created_at: string
  }[]) {
    // Newest first, so the first one seen for a place is the one that put it on air.
    if (row.entity_id && !map.has(row.entity_id)) {
      map.set(row.entity_id, { at: row.created_at, by: row.user_email })
    }
  }
  return map
}

/**
 * The two stamps of the refusal in force for each place — what the 72h clock reads
 * (BR-B2B-010, item 4).
 *
 * No operator name is resolved here: the queue asks for up to 500 rows and each name is an Auth
 * Admin round trip. The detail asks for the name through `loadCurrentRefusals`, where there is
 * one partnership on the screen.
 */
async function loadRefusalStamps(
  attractionIds: string[]
): Promise<Map<string, { decidedAt: string; communicatedAt: string | null }>> {
  const map = new Map<string, { decidedAt: string; communicatedAt: string | null }>()
  if (attractionIds.length === 0) return map

  let rows: Map<string, TriageRefusalRow[]>
  try {
    rows = await triageRefusalService.listByAttractions(attractionIds)
  } catch (error) {
    // A refusal lookup that did not answer is NOT "nobody was refused": the clock would then
    // read `venceu há 2 dias` for a partnership somebody closed properly. No refusal in the map
    // means the column falls back to the clock, which is the honest degradation, and the error
    // is in the log rather than on a badge.
    console.error('[partnerships] triage refusal lookup failed:', error)
    return map
  }

  for (const [attractionId, list] of rows) {
    const current = currentRefusal(list.map(toRefusal))
    if (current) {
      map.set(attractionId, {
        decidedAt: current.decidedAt,
        communicatedAt: current.communicatedAt,
      })
    }
  }
  return map
}

/** The refusal in force, whole, with the name of whoever decided it — one partnership's worth. */
async function loadCurrentRefusals(attractionIds: string[]): Promise<Map<string, TriageRefusal>> {
  const map = new Map<string, TriageRefusal>()
  if (attractionIds.length === 0) return map

  let rows: Map<string, TriageRefusalRow[]>
  try {
    rows = await triageRefusalService.listByAttractions(attractionIds)
  } catch (error) {
    console.error('[partnerships] triage refusal lookup failed:', error)
    return map
  }

  for (const [attractionId, list] of rows) {
    const current = currentRefusal(list.map(toRefusal))
    if (!current) continue
    map.set(attractionId, {
      ...current,
      decidedByLabel: await operatorLabel(
        list.find((row) => row.id === current.id)?.decided_by ?? null
      ),
    })
  }
  return map
}

/**
 * One row of `partner.partner_triage_refusals`, as the screens see it.
 *
 * `gate` OUTSIDE 1..3 READS AS `null`, and the screen then prints the reason alone.
 * `partner_triage_refusals_gate_check` makes such a row impossible to write, so this branch is
 * unreachable today — and picking gate 1 for it would be INVENTING which gate refused, which is
 * the one thing BR-B2B-011, item 4, is about.
 */
function toRefusal(row: TriageRefusalRow): TriageRefusal {
  return {
    id: row.id,
    attractionId: row.attraction_id,
    gate: isTriageGate(row.gate) ? row.gate : null,
    reason: row.reason,
    decidedAt: row.decided_at,
    decidedByLabel: null,
    communicatedAt: row.communicated_at,
  }
}

// ── The five reads ───────────────────────────────────────────────────────────────────────────

async function loadClients(ids: string[]): Promise<Map<string, PipelineClient>> {
  const map = new Map<string, PipelineClient>()
  if (ids.length === 0) return map

  const { data, error } = await service().from('clients').select(CLIENT_COLUMNS).in('id', ids)
  if (error || !data) return map
  return indexClients(data as unknown as Record<string, unknown>[], map)
}

/** Every client, for the directory — the queue asks by id, the directory asks for all of them. */
async function loadAllClients(limit: number): Promise<Map<string, PipelineClient>> {
  const map = new Map<string, PipelineClient>()
  const { data, error } = await service()
    .from('clients')
    .select(CLIENT_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error || !data) return map
  return indexClients(data as unknown as Record<string, unknown>[], map)
}

function indexClients(
  rows: Record<string, unknown>[],
  map: Map<string, PipelineClient>
): Map<string, PipelineClient> {
  for (const row of rows) {
    const id = row.id as string
    map.set(id, {
      id,
      name: (row.name as string) ?? null,
      companyName: (row.company_name as string) ?? null,
      city: (row.city as string) ?? null,
      region: (row.state as string) ?? null,
      country: (row.country as string) ?? null,
      clientType: (row.client_type as string) ?? null,
      taxId: (row.tax_id as string) ?? null,
      status: (row.status as string) ?? null,
      approvedAt: (row.approved_at as string) ?? null,
      createdAt: (row.created_at as string) ?? null,
      welcomePoiId: (row.welcome_poi_id as string) ?? null,
      fee: {
        // `monthly_fee_cents` absent is an incomplete registration and is NOT zero —
        // BR-B2B-017, item 6. `?? null` and never `?? 0`.
        monthlyFeeCents: typeof row.monthly_fee_cents === 'number' ? row.monthly_fee_cents : null,
        isCourtesy: row.is_courtesy === true,
        courtesyReason: (row.courtesy_reason as string) ?? null,
      },
    })
  }
  return map
}

/**
 * The live contract of each client — the newest one not superseded, the same definition
 * `getLiveContract` uses one client at a time. Batched here because the queue asks for all of
 * them at once, and the acceptance travels along because the signature's DATE is what band 3
 * shows and what `Parado há` counts from.
 */
async function loadLiveContracts(ids: string[]): Promise<Map<string, PipelineContract>> {
  const map = new Map<string, PipelineContract>()
  if (ids.length === 0) return map

  const { data, error } = await service()
    .from('partner_contracts')
    .select('id, client_id, status, tier, created_at')
    .in('client_id', ids)
    .is('superseded_by', null)
    .order('created_at', { ascending: false })
  if (error || !data) return map

  const rows = data as {
    id: string
    client_id: string
    status: ContractStatus
    tier: ContractTier | null
    created_at: string
  }[]
  const live = new Map<string, (typeof rows)[number]>()
  for (const row of rows) {
    // Ordered newest first, so the first one seen for a client is the live one.
    if (!live.has(row.client_id)) live.set(row.client_id, row)
  }

  const signedIds = Array.from(live.values())
    .filter((row) => row.status === 'signed')
    .map((row) => row.id)

  const acceptances = new Map<string, { accepted_at: string; signer_name: string }>()
  if (signedIds.length > 0) {
    const { data: accepted } = await service()
      .from('partner_contract_acceptances')
      .select('contract_id, accepted_at, signer_name')
      .in('contract_id', signedIds)
    for (const row of (accepted ?? []) as {
      contract_id: string
      accepted_at: string
      signer_name: string
    }[]) {
      acceptances.set(row.contract_id, { accepted_at: row.accepted_at, signer_name: row.signer_name })
    }
  }

  for (const [clientId, row] of live) {
    const acceptance = acceptances.get(row.id) ?? null
    map.set(clientId, {
      status: row.status,
      tier: row.tier ?? null,
      signed: row.status === 'signed',
      signedAt: acceptance?.accepted_at ?? null,
      signerName: acceptance?.signer_name ?? null,
    })
  }
  return map
}

async function loadPartnerPlaces(
  ids: string[],
  operator: SupabaseClient
): Promise<Map<string, PartnerPlaceRow[]>> {
  const map = new Map<string, PartnerPlaceRow[]>()
  if (ids.length === 0) return map

  let rows: PartnerPlaceRow[]
  try {
    rows = await placeService.listByPartnerClient(ids, operator)
  } catch (error) {
    // A failed place lookup is NOT "no places": deriving `Contrato assinado` from a read that
    // did not answer would tell the operator to create a place that already exists. The queue
    // degrades to the states before the place, and the error is in the log, not on a badge.
    console.error('[partnerships] partner place lookup failed:', error)
    return map
  }

  for (const row of rows) {
    map.set(row.partnerClientId, (map.get(row.partnerClientId) ?? []).concat(row))
  }
  return map
}

async function loadPromotedSubmission(clientId: string): Promise<SubmissionRow | null> {
  const { data, error } = await service()
    .from('partner_form_submissions')
    .select(SUBMISSION_COLUMNS)
    .eq('promoted_client_id', clientId)
    .order('promoted_at', { ascending: false })
    .limit(1)

  if (error || !data || data.length === 0) return null
  return data[0] as unknown as SubmissionRow
}


// ── Small derivations ────────────────────────────────────────────────────────────────────────

/**
 * How many OTHER proposals are still waiting with the same CNPJ — the `+{n} com o mesmo CNPJ`
 * badge that already exists on the queue, kept as it was. Grouped by the normalised key and
 * not by what was typed, for the reason `listProposals` writes down: the same company writes
 * the mask on Monday and does not on Tuesday.
 */
function countPendingDuplicates(submissions: SubmissionRow[]): Map<string, number> {
  const byKey = new Map<string, string[]>()
  for (const row of submissions) {
    if (row.status !== 'submitted') continue
    const key = normalizedTaxId(row.answers?.tax_id)
    if (!key) continue
    byKey.set(key, (byKey.get(key) ?? []).concat(row.id))
  }

  const counts = new Map<string, number>()
  for (const row of submissions) {
    const key = normalizedTaxId(row.answers?.tax_id)
    const group = key ? byKey.get(key) ?? [] : []
    counts.set(row.id, group.filter((id) => id !== row.id).length)
  }
  return counts
}

/** The newest timestamp among the ones that exist. `Parado há` counts from it. */
function lastEvent(candidates: (string | null)[]): string | null {
  let newest: string | null = null
  for (const value of candidates) {
    if (!value) continue
    if (newest === null || value > newest) newest = value
  }
  return newest
}
