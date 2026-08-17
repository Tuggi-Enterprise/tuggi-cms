/**
 * The partnership pipeline, assembled — one queue and one detail, out of five tables that
 * nobody had ever read together.
 *
 * WHAT THIS MODULE IS FOR, in one sentence: until now the state of the pipeline lived in the
 * operator's head, because the proposal, the client, the contract and the place are four
 * screens and none of them carried context to the next. The measurement in #356 is what that
 * costs — of the 6 clients with a `welcome_poi_id`, 3 have zero trigger points: places that
 * are published, intact, and mute, with nobody in a position to notice.
 *
 * THE QUEUE IS ANCHORED ON THE SUBMISSION, and that is the rule of spec §3, not a shortcut:
 * states 1 and 2 exist only as a submission, and states 3 onwards exist only through
 * `promoted_client_id`. A client somebody registered by hand has no proposal behind it and is
 * not in this pipeline; it is reachable, as it always was, from `/admin/clients`.
 *
 * WHICH IDENTITY READS WHAT. The submissions, the clients and the contracts are read with the
 * service client, exactly as `partner-proposal-admin-service` already does, and every function
 * here is called only from `withAuth({ roles: ['admin'] })`. `core.attractions` and its
 * children are read with the OPERATOR's client, because an unapproved place is visible through
 * the `CMS admins can read attractions` policy and asking with `service_role` would answer for
 * an identity that is not the one on the screen — the same reasoning `applyPartnerApprovalEffects`
 * wrote down for the write side.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseService } from '@/lib/core/supabase-client'
import { placeService, type PartnerPlaceRow } from '@/lib/core/place-service'
import { readReviewNote } from '@/lib/partner-form/proposal-review'
import { normalizedTaxId } from '@/lib/partner-form/tax-id-key'
import { EMPTY_CONFERENCE, type ConferenceRecord } from '@/lib/partner-form/regularity'
import {
  buildPlaceReadiness,
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
  derivePipelineState,
  detailPath,
  type PipelineState,
} from '@/lib/partnerships/pipeline'
import type { PartnerAnswers } from '@/lib/partner-form/schema'

const SCHEMA = 'core'

function service() {
  return getSupabaseService().schema(SCHEMA)
}

const SUBMISSION_COLUMNS =
  'id, status, answers, submitted_at, updated_at, created_at, promoted_at, promoted_by, ' +
  'promoted_client_id, review_note, reviewed_at, reviewed_by, discard_reason'

/**
 * The columns of `core.clients` the pipeline decides with. An allowlist, and a short one: the
 * fiscal record, the banking record, the team and the coupons stay on the client's own page
 * (DS-LAYOUT-006, 1st edge case) — copying three of them here "for convenience" is how the
 * second source of the same fact gets born.
 */
const CLIENT_COLUMNS =
  'id, name, company_name, city, state, tax_id, status, approved_at, created_at, ' +
  'monthly_fee_cents, is_courtesy, courtesy_reason'

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
  taxId: string | null
  status: string | null
  approvedAt: string | null
  createdAt: string | null
  fee: PartnerFee
}

export interface PipelineContract {
  status: string
  signed: boolean
  signedAt: string | null
  signerName: string | null
}

export interface PartnershipQueueRow {
  submissionId: string
  clientId: string | null
  state: PipelineState
  /** Where `Abrir` goes, without the locale prefix. */
  href: string
  tradeName: string | null
  taxId: string | null
  city: string | null
  region: string | null
  /** Other proposals waiting with the same CNPJ — the existing badge, kept. */
  duplicateCount: number
  /** The last thing that happened in this pipeline. `Parado há` counts from here. */
  since: string | null
  places: PlacesSummary
  /**
   * What the `Triagem` column derives from — BR-B2B-010, item 4. The FACTS and not the text: the
   * clock is computed where it is rendered, so a screen left open does not keep saying `até
   * 18/08` after the 18th.
   */
  triage: TriageFacts
  /** Only on the terminal state, and it is the closed list the discard already writes. */
  discardReason: string | null
}

/**
 * The whole queue.
 *
 * Five round trips and not one per row: submissions, then clients, contracts, acceptances and
 * places for the whole set at once. A per-row lookup here would be N+1 over a screen the
 * operator reloads all day.
 */
export async function loadPartnershipQueue(
  operator: SupabaseClient
): Promise<PartnershipQueueRow[]> {
  const { data, error } = await service()
    .from('partner_form_submissions')
    .select(SUBMISSION_COLUMNS)
    .order('submitted_at', { ascending: false })
    .limit(500)

  if (error || !data) return []
  const submissions = data as unknown as SubmissionRow[]

  const clientIds = submissions
    .map((row) => row.promoted_client_id)
    .filter((id): id is string => typeof id === 'string')

  const [clients, contracts, places] = await Promise.all([
    loadClients(clientIds),
    loadLiveContracts(clientIds),
    loadPartnerPlaces(clientIds, operator),
  ])

  // One read for the whole queue, and it is the only extra round trip the `Triagem` column
  // costs. Per row it would be N+1 over a screen the operator reloads all day.
  const refusals = await loadRefusalStamps(
    Array.from(places.values()).flat().map((row) => row.attractionId)
  )

  const duplicates = countPendingDuplicates(submissions)

  return submissions.map((row) => {
    const clientId = row.promoted_client_id
    const client = clientId ? clients.get(clientId) ?? null : null
    const contract = clientId ? contracts.get(clientId) ?? null : null
    const readiness = (clientId ? places.get(clientId) ?? [] : []).map(buildPlaceReadiness)
    const conference = readReviewNote(row.review_note).conference

    const outcomes: PlaceTriageOutcome[] = readiness.map((item) => ({
      published: item.published,
      refusal: refusals.get(item.place.attractionId) ?? null,
    }))

    const state = derivePipelineState({
      proposalStatus: row.status,
      conference,
      // A `promoted_client_id` pointing at a row that no longer answers is not a client: the
      // state has to fall back to the proposal, or the queue would show a client-shaped row
      // whose detail route is a 404.
      clientId: client ? client.id : null,
      contractSigned: contract?.signed === true,
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
      tradeName: answers.trade_name ?? client?.name ?? null,
      taxId: answers.tax_id ?? client?.taxId ?? null,
      city: answers.city ?? client?.city ?? null,
      region: answers.state ?? client?.region ?? null,
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
   * others (`core.partner_triage_refusals.attraction_id` is NOT NULL for that reason).
   */
  refusal: TriageRefusal | null
}

export interface PartnershipDetail {
  state: PipelineState
  client: PipelineClient
  contract: PipelineContract | null
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
  /** The same facts the queue column reads, so the header and the row cannot disagree. */
  triage: TriageFacts
}

export async function loadPartnershipDetail(
  clientId: string,
  operator: SupabaseClient
): Promise<PartnershipDetail | null> {
  const clients = await loadClients([clientId])
  const client = clients.get(clientId)
  if (!client) return null

  const [contracts, places, submission] = await Promise.all([
    loadLiveContracts([clientId]),
    loadPartnerPlaces([clientId], operator),
    loadPromotedSubmission(clientId),
  ])

  const contract = contracts.get(clientId) ?? null
  const readiness = (places.get(clientId) ?? []).map(buildPlaceReadiness)
  const attractionIds = readiness.map((item) => item.place.attractionId)
  const [trail, refusals] = await Promise.all([
    loadPublicationTrail(attractionIds),
    loadCurrentRefusals(attractionIds),
  ])

  const conference = submission ? readReviewNote(submission.review_note).conference : EMPTY_CONFERENCE

  const outcomes: PlaceTriageOutcome[] = readiness.map((item) => ({
    published: item.published,
    refusal: refusals.get(item.place.attractionId) ?? null,
  }))

  return {
    state: derivePipelineState({
      proposalStatus: submission?.status ?? 'promoted',
      conference,
      clientId,
      contractSigned: contract?.signed === true,
      placeCount: readiness.length,
      publishedPlaceCount: readiness.filter((item) => item.published).length,
      refusedPlaceCount: outcomes.filter(isRefusedAtTriage).length,
      uncommunicatedRefusal: hasUncommunicatedRefusal(outcomes),
    }),
    client,
    contract,
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
    triage: { approvedAt: client.approvedAt, places: outcomes },
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

  const readiness = buildPlaceReadiness(row)
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

  const { data, error } = await service()
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
 * One row of `core.partner_triage_refusals`, as the screens see it.
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

  for (const row of data as unknown as Record<string, unknown>[]) {
    const id = row.id as string
    map.set(id, {
      id,
      name: (row.name as string) ?? null,
      companyName: (row.company_name as string) ?? null,
      city: (row.city as string) ?? null,
      region: (row.state as string) ?? null,
      taxId: (row.tax_id as string) ?? null,
      status: (row.status as string) ?? null,
      approvedAt: (row.approved_at as string) ?? null,
      createdAt: (row.created_at as string) ?? null,
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
    .select('id, client_id, status, created_at')
    .in('client_id', ids)
    .is('superseded_by', null)
    .order('created_at', { ascending: false })
  if (error || !data) return map

  const rows = data as { id: string; client_id: string; status: string; created_at: string }[]
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
