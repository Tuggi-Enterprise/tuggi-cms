/**
 * The internal side of the partner proposal — the queue the Tuggi team works, and the
 * promotion into `core.clients`.
 *
 * WHY THIS IS A SECOND MODULE AND NOT MORE FUNCTIONS IN `partner-proposal-service.ts`:
 *
 * That one is reached by the PUBLIC routes of the form, and the reason it is allowed to hold
 * a `service_role` client at all is that `core.clients` is unreachable from inside it —
 * asserted, not claimed, by the `touchedTables` array in `tests/api/partner-form.test.ts`.
 * This module writes `core.clients` by definition, so putting the promotion there would
 * delete that guarantee in one commit and nothing would go red. Two modules, two reachable
 * sets, and every function here is called only from `withAuth({ roles: ['admin'] })`.
 *
 * Rows this module reads and writes are `core.partner_form_submissions` and `core.clients`.
 * The migration `20260814140000` IS applied — its CHECKs are live, and a statement that violates
 * one comes back as a Supabase error, which is what the routes already turn into a typed
 * response. `partner_form_submissions_promotion_ck` is the one that dictates the write order of
 * `promoteProposal`; the reasoning is on that function.
 */

import { getSupabaseService } from '@/lib/core/supabase-client'
import { operatorLabel } from '@/lib/services/operator-label'
import type { PartnerAnswers } from '@/lib/partner-form/schema'
import type { PromotableColumn } from '@/lib/partner-form/promotion'
import {
  readReviewNote,
  type DiscardReasonId,
  type ReviewNote,
} from '@/lib/partner-form/proposal-review'
import type { ConferenceRecord } from '@/lib/partner-form/regularity'
import { normalizedTaxId } from '@/lib/partner-form/tax-id-key'
import { cnpjLookupValues } from '@/lib/validation/cnpj'
import type { ClientType } from '@/types/clients'

const SCHEMA = 'core'
const SUBMISSIONS = 'partner_form_submissions'
const CLIENTS = 'clients'

function service() {
  return getSupabaseService().schema(SCHEMA)
}

/**
 * THERE IS NO `draft`. A proposal exists when somebody presses send: with no credential there
 * is no session to resume, and the CHECK of `20260814140000` accepts these three and nothing
 * else. The value used to be in this union and produced a queue filter, a banner and a
 * disabled button for a state the database refuses.
 */
export type ProposalStatus = 'submitted' | 'promoted' | 'discarded'

export interface AdminSubmissionRow {
  id: string
  status: ProposalStatus
  answers: PartnerAnswers
  submitted_at: string | null
  updated_at: string | null
  created_at: string
  promoted_at: string | null
  promoted_by: string | null
  promoted_client_id: string | null
  /** The conference annotation, in the shape `normalizeReviewNote` writes. */
  review_note: unknown
  /** When the annotation above was last written, and by which auth user. */
  reviewed_at: string | null
  reviewed_by: string | null
}

const SUBMISSION_COLUMNS =
  'id, status, answers, submitted_at, updated_at, created_at, promoted_at, promoted_by, promoted_client_id, review_note, reviewed_at, reviewed_by'

export interface ProposalListItem extends AdminSubmissionRow {
  /** What the team registered having seen — the list badge answers "can this one already
   *  produce a contract?", and that question is `buildRegularityReport`. */
  conference: ConferenceRecord
  /**
   * Other proposals waiting with the SAME CNPJ. The form accepts a second proposal for a CNPJ
   * that already has one pending (refusing it would turn a public number into a lookup for who
   * is talking to the Tuggi), so the duplicate is resolved here, by a person.
   */
  duplicate_of: string[]
}

/** The proposal queue: everything a human has actually sent, newest first. */
export async function listProposals(
  options: { statuses?: ProposalStatus[]; limit?: number } = {}
): Promise<ProposalListItem[]> {
  const statuses = options.statuses ?? ['submitted', 'promoted', 'discarded']

  const { data, error } = await service()
    .from(SUBMISSIONS)
    .select(SUBMISSION_COLUMNS)
    .in('status', statuses)
    .order('submitted_at', { ascending: false })
    .limit(options.limit ?? 200)

  if (error || !data) return []

  const rows = data as AdminSubmissionRow[]
  // Grouped by the key of `tax_id_normalized` and not by what was typed: the same company
  // filling the form twice writes `12.ABC.345/01DE-35` once and `12abc34501de35` the next
  // time, and a duplicate the screen does not show is a duplicate nobody resolves.
  const pendingByTaxId = new Map<string, string[]>()
  for (const row of rows) {
    if (row.status !== 'submitted') continue
    const key = normalizedTaxId(row.answers.tax_id)
    if (!key) continue
    pendingByTaxId.set(key, (pendingByTaxId.get(key) ?? []).concat(row.id))
  }

  return rows.map((row) => ({
    ...row,
    conference: readReviewNote(row.review_note).conference,
    duplicate_of: (pendingByTaxId.get(normalizedTaxId(row.answers.tax_id)) ?? []).filter(
      (id) => id !== row.id
    ),
  }))
}

export interface ClientRecord {
  id: string
  name: string | null
  email: string | null
  [column: string]: unknown
}

export interface ProposalDetail {
  submission: AdminSubmissionRow
  /** What the team registered having seen of the two documents of BR-B2B-022. */
  conference: ConferenceRecord
  /** The reading of gate 2 already stored, so the screen opens on what was written. */
  note: ReviewNote
  /** The client this proposal was promoted into. Null until somebody promotes it. */
  client: ClientRecord | null
  /** Other proposals still waiting with the same CNPJ — resolved by a person, never merged. */
  duplicates: { id: string; submittedAt: string | null }[]
  /**
   * The two acts of the screen in words instead of uuids — BR-B2B-030 item 2 asks the trail
   * to say WHO conferred, and a uuid on screen says it to nobody. Null when the lookup does
   * not answer, and the copy then leaves the line out rather than printing a placeholder.
   */
  reviewedByLabel: string | null
  promotedByLabel: string | null
}

/** The columns the promotion panel compares against. An allowlist, like the write. */
const CLIENT_COMPARE_COLUMNS =
  'id, name, email, phone, company_name, address, city, state, country, postal_code, industry, website, social_handle, tax_id, tax_id_type, legal_representative_name, legal_representative_role, status, created_at'

export async function loadProposalDetail(submissionId: string): Promise<ProposalDetail | null> {
  const { data: submission, error } = await service()
    .from(SUBMISSIONS)
    .select(SUBMISSION_COLUMNS)
    .eq('id', submissionId)
    .maybeSingle()

  if (error || !submission) return null

  const row = submission as AdminSubmissionRow
  const note = readReviewNote(row.review_note)

  return {
    submission: row,
    conference: note.conference,
    note,
    client: row.promoted_client_id
      ? await loadClient(row.promoted_client_id)
      : await findClientByTaxId(row.answers.tax_id ?? ''),
    duplicates: await findPendingDuplicates(submissionId, row.answers.tax_id ?? ''),
    reviewedByLabel: await operatorLabel(row.reviewed_by),
    promotedByLabel: await operatorLabel(row.promoted_by),
  }
}


/**
 * The client this proposal is ABOUT, found by CNPJ.
 *
 * The public form refuses a CNPJ that is already a client, so in the ordinary case this is
 * null and the promotion creates a record. It is not the only case: a proposal can be sitting
 * in the queue while somebody registers that company by hand, and promoting it then would
 * produce two records for one company — the exact thing the CNPJ is the key against.
 *
 * When it does find one, the promotion becomes an UPDATE and DS-COMPONENTE-018 applies in
 * full: a divergent column is born unticked and stays that way until somebody says otherwise.
 * The same shapes count as the same CNPJ on both surfaces (`cnpjLookupValues`), and this is the
 * one lookup that still asks by SHAPE rather than by key: `core.clients.tax_id` is a plain
 * column with no normalised twin, so there is nothing to compare `normalizedTaxId` against and
 * the expression index of `20260814170000` is the database's own, not PostgREST's.
 */
export async function findClientByTaxId(taxId: string): Promise<ClientRecord | null> {
  const candidates = cnpjLookupValues(taxId)
  if (candidates.length === 0) return null

  const { data, error } = await service()
    .from(CLIENTS)
    .select(CLIENT_COMPARE_COLUMNS)
    .in('tax_id', candidates)
    .limit(1)

  if (error || !data || data.length === 0) return null
  return data[0] as ClientRecord
}

/**
 * Proposals still waiting with the same CNPJ as this one.
 *
 * The public form lets a CNPJ that already has a pending proposal send another (the alternative
 * — telling the sender "this CNPJ already applied" — turns a public number into a lookup for
 * who is negotiating with the Tuggi). Nothing merges them: the screen shows the duplicate and a
 * person decides which one to promote and which one to discard, with `duplicate` on the closed
 * list of discard reasons.
 *
 * ONE SHAPE, AND THE DATABASE DECIDES IT. The filter is `tax_id_normalized=eq.<key>` against the
 * generated column of `20260814140000`, which is also the index behind it. What this used to do
 * — read the 50 newest proposals and compare the typed strings in JavaScript — missed the same
 * company that typed the mask on Monday and did not on Tuesday, and stopped looking at the 51st
 * row. `normalizedTaxId` is the mirror of that column's expression, and nothing else here
 * decides what "the same CNPJ" means.
 */
async function findPendingDuplicates(
  submissionId: string,
  taxId: string
): Promise<{ id: string; submittedAt: string | null }[]> {
  const key = normalizedTaxId(taxId)
  if (!key) return []

  const { data, error } = await service()
    .from(SUBMISSIONS)
    .select('id, submitted_at')
    .eq('status', 'submitted')
    .eq('tax_id_normalized', key)
    .order('submitted_at', { ascending: false })
    .limit(50)

  if (error || !data) return []

  return (data as { id: string; submitted_at: string | null }[])
    .filter((row) => row.id !== submissionId)
    .map((row) => ({ id: row.id, submittedAt: row.submitted_at }))
}

/**
 * The proposal a client was promoted FROM — the insumo the place prefill is built out of.
 *
 * The link is `promoted_client_id`, written by `promoteProposal` and by nothing else, so this
 * answers "what did this partner write about the place?" without the caller knowing anything
 * about the queue. It answers `null` for a client registered by hand, which is the ordinary
 * case for the 10 records that existed before the form.
 *
 * `limit(1)` and not `maybeSingle()`: `promoted_client_id` has no unique index, and one client
 * with two promoted proposals is a duplicate a person resolved by promoting both — a lookup
 * that errors there would break the approval over a row it does not even need to choose
 * between. Newest first, because the last thing the partner sent is the current one.
 */
export async function findPromotedSubmission(clientId: string): Promise<AdminSubmissionRow | null> {
  const { data, error } = await service()
    .from(SUBMISSIONS)
    .select(SUBMISSION_COLUMNS)
    .eq('promoted_client_id', clientId)
    .eq('status', 'promoted')
    .order('promoted_at', { ascending: false })
    .limit(1)

  if (error || !data || data.length === 0) return null
  return data[0] as AdminSubmissionRow
}

export async function loadClient(clientId: string): Promise<ClientRecord | null> {
  const { data, error } = await service()
    .from(CLIENTS)
    .select(CLIENT_COMPARE_COLUMNS)
    .eq('id', clientId)
    .maybeSingle()

  if (error || !data) return null
  return data as ClientRecord
}

/**
 * `core.clients.email` IS NOT UNIQUE (operator, 2026-08-16): one owner has several places, and
 * each place is its own record with the same address on it. There used to be a panel here that
 * made the operator resolve an e-mail collision before the write button appeared — it existed
 * only because of the constraint, and it went with it. What keeps a company from being
 * registered twice is the CNPJ, refused at the form (`lookupTaxId`).
 *
 * Anything reintroduced here that reads a client BY E-MAIL has to expect several rows.
 * `maybeSingle()` is the trap: it errors when more than one row matches, and the error is not
 * "duplicate", it is a lookup that silently answers "nobody".
 */
export type PromotionOutcome =
  | { ok: true; clientId: string; created: boolean; written: PromotableColumn[] }
  | { ok: false; reason: 'not_promotable' | 'write_failed' }

export interface PromotionCommand {
  submissionId: string
  /** Update this client, or create one when null. */
  clientId: string | null
  updates: Partial<Record<PromotableColumn, string>>
  written: PromotableColumn[]
  promotedBy: string
}

/**
 * Writes the promotion. One statement against `core.clients`, which is what makes "either
 * everything you ticked, or nothing" literally true for the record the copy is about.
 *
 * ORDER, AND WHY IT IS THIS ONE — THE CLIENT FIRST, AND IT IS THE DATABASE THAT DECIDES IT.
 * `partner_form_submissions_promotion_ck` (decision 6 of `20260814140000`, BR-B2B-026: promotion
 * is an act WITH a destination) is `status <> 'promoted' OR (promoted_at IS NOT NULL AND
 * promoted_client_id IS NOT NULL)`. There is no state in which the row is `promoted` and the
 * destination is not yet known, so `promoted_client_id` has to be in the SAME statement that
 * writes `status` — and the client id only exists after `core.clients` is written. Taking the
 * claim first, in the hope of filling the destination in a second statement, is not a slower
 * promotion: it is a promotion the database refuses with 23514, and it refused every one of
 * them in production.
 *
 * The single winner survives the inversion, because it never depended on the order: the claim is
 * still ONE UPDATE on ONE row with `status = 'submitted'` as a predicate, so two operators
 * clicking together produce exactly one match, and a proposal already promoted or discarded
 * matches none.
 *
 * THE RESIDUE, NAMED: PostgREST has no transaction across statements, so a claim that fails
 * after the client write leaves the client row written and the proposal still `submitted`. That
 * is the honest failure — the operator's record exists, the queue still offers the act — and it
 * is why the failure copy does not offer "try again" and tells the operator to open the client
 * record first. Nothing here deletes the client it just wrote.
 */
export async function promoteProposal(command: PromotionCommand): Promise<PromotionOutcome> {
  const written = await writeClient(command)
  if (!written.ok) return { ok: false, reason: written.reason }

  const promotedAt = new Date().toISOString()

  const { data: claimed, error: claimError } = await service()
    .from(SUBMISSIONS)
    .update({
      status: 'promoted',
      promoted_at: promotedAt,
      promoted_by: command.promotedBy,
      promoted_client_id: written.clientId,
      updated_at: promotedAt,
    })
    .eq('id', command.submissionId)
    .eq('status', 'submitted')
    .select('id')

  if (claimError) return { ok: false, reason: 'write_failed' }
  if (!claimed || claimed.length === 0) return { ok: false, reason: 'not_promotable' }

  return {
    ok: true,
    clientId: written.clientId,
    created: written.created,
    written: command.written,
  }
}

/**
 * What a promoted proposal becomes: `venue`, the merchant with an address.
 *
 * BR-B2B-020, item 5 — declared by the operator on 2026-08-14 (*"será tipo locais"*), which
 * fixes that the establishment enters as a type OF ITS OWN and not as `business`, `partner` or
 * `hotel`. It used to write `partner`, a generic that names no public and that made the seven
 * values of `clients_client_type_check` indistinguishable from one another for the whole
 * merchant funnel — this form is the merchant's channel (BR-B2B-026, items 1 to 3), so every
 * record it creates is one.
 *
 * The value is only ever written on CREATE. A promotion that lands on a record that already
 * exists does not touch `client_type`: the type of a client the team already registered is the
 * team's, and an external form does not re-classify it (the same reasoning as
 * DS-COMPONENTE-018, and the reason this is not in `PROMOTION_MAP`).
 */
export const PROMOTED_CLIENT_TYPE: ClientType = 'venue'

type ClientWriteOutcome =
  | { ok: true; clientId: string; created: boolean }
  | { ok: false; reason: 'write_failed' }

async function writeClient(command: PromotionCommand): Promise<ClientWriteOutcome> {
  if (command.clientId) {
    const { data, error } = await service()
      .from(CLIENTS)
      .update({ ...command.updates, updated_at: new Date().toISOString() })
      .eq('id', command.clientId)
      .select('id')

    if (error) return { ok: false, reason: 'write_failed' }
    if (!data || data.length === 0) return { ok: false, reason: 'write_failed' }
    return { ok: true, clientId: command.clientId, created: false }
  }

  const { data, error } = await service()
    .from(CLIENTS)
    // `status` is NOT part of the promotion (it is on the never-written list): a new record is
    // born pending because that is what `core.clients` does with a new record, and approving
    // the partnership is another decision on the client's own page (BR-B2B-010, item 1).
    .insert({ ...command.updates, client_type: PROMOTED_CLIENT_TYPE })
    .select('id')
    .single()

  if (error || !data) return { ok: false, reason: 'write_failed' }
  return { ok: true, clientId: (data as { id: string }).id, created: true }
}

export type DiscardOutcome = { ok: true } | { ok: false; reason: 'not_discardable' | 'write_failed' }

/**
 * Discarding is reversible while nobody has promoted, and the screen says so before the click:
 * an irreversible discard makes the operator hesitate to use the right reason.
 *
 * It is NOT a triage rejection. A place turned down at triage is still a partner
 * (BR-B2B-011), and no reason on the closed list is a gate.
 */
export async function discardProposal(
  submissionId: string,
  reason: DiscardReasonId,
  discardedBy: string
): Promise<DiscardOutcome> {
  const { data, error } = await service()
    .from(SUBMISSIONS)
    .update({
      status: 'discarded',
      discarded_at: new Date().toISOString(),
      discarded_by: discardedBy,
      discard_reason: reason,
    })
    .eq('id', submissionId)
    .eq('status', 'submitted')
    .select('id')

  if (error) return { ok: false, reason: 'write_failed' }
  if (!data || data.length === 0) return { ok: false, reason: 'not_discardable' }
  return { ok: true }
}

export async function restoreProposal(submissionId: string): Promise<DiscardOutcome> {
  const { data, error } = await service()
    .from(SUBMISSIONS)
    .update({ status: 'submitted', discarded_at: null, discarded_by: null, discard_reason: null })
    .eq('id', submissionId)
    .eq('status', 'discarded')
    .select('id')

  if (error) return { ok: false, reason: 'write_failed' }
  if (!data || data.length === 0) return { ok: false, reason: 'not_discardable' }
  return { ok: true }
}

/**
 * Stores the reviewer's reading of gate 2 as an ANNOTATION — never a verdict. It writes no
 * `status`, touches no column of `core.clients`, and the proposal is exactly as promotable
 * after it as before.
 */
export async function saveReviewNote(
  submissionId: string,
  note: ReviewNote,
  reviewedBy: string
): Promise<boolean> {
  const { data, error } = await service()
    .from(SUBMISSIONS)
    .update({
      review_note: note,
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewedBy,
    })
    .eq('id', submissionId)
    .select('id')

  return !error && Array.isArray(data) && data.length > 0
}
