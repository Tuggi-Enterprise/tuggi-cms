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
 * Rows this module reads and writes are the same three tables of #341 plus `core.clients`.
 * The migration is not applied yet; until it is, every function answers with the Supabase
 * error, which is what the routes already turn into a typed response.
 */

import { getSupabaseService } from '@/lib/core/supabase-client'
import { PARTNER_DOCUMENTS_BUCKET } from '@/lib/services/partner-proposal-service'
import type { PartnerAnswers } from '@/lib/partner-form/schema'
import type { PartnerDocumentKind } from '@/lib/partner-form/fields'
import type { PromotableColumn } from '@/lib/partner-form/promotion'
import type { DiscardReasonId, ReviewNote } from '@/lib/partner-form/proposal-review'

const SCHEMA = 'core'
const INVITES = 'partner_form_invites'
const SUBMISSIONS = 'partner_form_submissions'
const DOCUMENTS = 'partner_form_documents'
const CLIENTS = 'clients'

/**
 * How long the link to a stored document lives. The bucket is private and the screen does not
 * undo that: the URL is asked for on the click, is never written anywhere, and is not offered
 * for copying.
 */
export const DOCUMENT_SIGNED_URL_SECONDS = 60

function service() {
  return getSupabaseService().schema(SCHEMA)
}

export type ProposalStatus = 'draft' | 'submitted' | 'promoted' | 'discarded'

export interface AdminInviteRow {
  id: string
  submission_id: string
  client_id: string | null
  recipient_email: string
  recipient_name: string | null
  trade_name: string | null
  expires_at: string
  used_at: string | null
  revoked_at: string | null
  created_at: string
}

export interface AdminSubmissionRow {
  id: string
  status: ProposalStatus
  answers: PartnerAnswers
  is_partial: boolean
  submitted_at: string | null
  updated_at: string | null
  created_at: string
  promoted_at: string | null
  promoted_by: string | null
  promoted_client_id: string | null
}

export interface AdminDocumentRow {
  id: string
  submission_id: string
  kind: PartnerDocumentKind
  storage_path: string
  file_name: string
  byte_size: number
  mime_type: string
  created_at: string
}

/**
 * The seven situations of §3.4 of the spec, derived and never stored.
 *
 * There is no `link opened`, and this does not pretend otherwise: nothing records an opening —
 * `resolveInvite` reads and does not write. What a draft with answers proves is TYPING, so the
 * label is `Começou a preencher`. Telling "opened and did nothing" from "never opened" needs an
 * `opened_at` column, which is a card of its own; this list works without it.
 */
export type InviteSituation =
  | 'sent'
  | 'started'
  | 'received'
  | 'promoted'
  | 'discarded'
  | 'expired'
  | 'revoked'

export function inviteSituation(
  invite: Pick<AdminInviteRow, 'expires_at' | 'used_at' | 'revoked_at'>,
  submission: Pick<AdminSubmissionRow, 'status' | 'answers'> | undefined,
  now: Date = new Date()
): InviteSituation {
  if (submission?.status === 'promoted') return 'promoted'
  if (submission?.status === 'discarded') return 'discarded'
  if (submission?.status === 'submitted') return 'received'
  if (invite.revoked_at) return 'revoked'
  if (invite.used_at) return 'received'
  if (new Date(invite.expires_at).getTime() <= now.getTime()) return 'expired'
  if (submission && Object.keys(submission.answers ?? {}).length > 0) return 'started'
  return 'sent'
}

/** A consumed or resolved invite has no live link to switch off. */
export function inviteIsRevocable(situation: InviteSituation): boolean {
  return situation === 'sent' || situation === 'started' || situation === 'expired'
}

export interface InviteListItem extends AdminInviteRow {
  situation: InviteSituation
  is_partial: boolean
  submission_status: ProposalStatus | null
}

/**
 * The invite queue. Two queries and no embedded select: the situation needs the proposal's
 * status, and joining it in PostgREST would make every caller depend on a foreign key name.
 */
export async function listInvites(options: { limit?: number } = {}): Promise<InviteListItem[]> {
  const { data: invites, error } = await service()
    .from(INVITES)
    .select(
      'id, submission_id, client_id, recipient_email, recipient_name, trade_name, expires_at, used_at, revoked_at, created_at'
    )
    .order('created_at', { ascending: false })
    .limit(options.limit ?? 200)

  if (error || !invites) return []

  const submissions = await loadSubmissionsByIds(
    (invites as AdminInviteRow[]).map((invite) => invite.submission_id)
  )

  return (invites as AdminInviteRow[]).map((invite) => {
    const submission = submissions.get(invite.submission_id)
    return {
      ...invite,
      situation: inviteSituation(invite, submission),
      is_partial: submission?.is_partial ?? false,
      submission_status: submission?.status ?? null,
    }
  })
}

async function loadSubmissionsByIds(ids: string[]): Promise<Map<string, AdminSubmissionRow>> {
  const found = new Map<string, AdminSubmissionRow>()
  const unique = ids.filter((id, index) => id && ids.indexOf(id) === index)
  if (unique.length === 0) return found

  const { data, error } = await service()
    .from(SUBMISSIONS)
    .select(
      'id, status, answers, is_partial, submitted_at, updated_at, created_at, promoted_at, promoted_by, promoted_client_id'
    )
    .in('id', unique)

  if (error || !data) return found
  for (const row of data as AdminSubmissionRow[]) found.set(row.id, row)
  return found
}

/**
 * Switches a live link off. Revoking exists because the e-mail can have gone to the wrong
 * address; what was already filled in stays where it is, which is why nothing but the invite
 * is touched.
 *
 * `revoked_at is null` is a predicate of the UPDATE, so a second click is not a second event.
 */
export async function revokeInvite(inviteId: string): Promise<boolean> {
  const { data, error } = await service()
    .from(INVITES)
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', inviteId)
    .is('revoked_at', null)
    .is('used_at', null)
    .select('id')

  return !error && Array.isArray(data) && data.length > 0
}

export interface ProposalListItem extends AdminSubmissionRow {
  invite: AdminInviteRow | null
  /**
   * One entry per stored file. Kinds and not a count, because the list badge answers "can
   * this one already produce a contract?" and that question is `buildRegularityReport`, which
   * needs to know WHICH document is there.
   */
  document_kinds: PartnerDocumentKind[]
}

/** The proposal queue: everything a human has actually sent, newest first. */
export async function listProposals(
  options: { statuses?: ProposalStatus[]; limit?: number } = {}
): Promise<ProposalListItem[]> {
  const statuses = options.statuses ?? ['submitted', 'promoted', 'discarded']

  const { data, error } = await service()
    .from(SUBMISSIONS)
    .select(
      'id, status, answers, is_partial, submitted_at, updated_at, created_at, promoted_at, promoted_by, promoted_client_id'
    )
    .in('status', statuses)
    .order('submitted_at', { ascending: false })
    .limit(options.limit ?? 200)

  if (error || !data) return []

  const rows = data as AdminSubmissionRow[]
  const invites = await loadInvitesOfSubmissions(rows.map((row) => row.id))
  const documents = await loadDocumentsOfSubmissions(rows.map((row) => row.id))

  return rows.map((row) => ({
    ...row,
    invite: invites.get(row.id) ?? null,
    document_kinds: documents.get(row.id) ?? [],
  }))
}

async function loadInvitesOfSubmissions(ids: string[]): Promise<Map<string, AdminInviteRow>> {
  const latest = new Map<string, AdminInviteRow>()
  const unique = ids.filter((id, index) => id && ids.indexOf(id) === index)
  if (unique.length === 0) return latest

  const { data, error } = await service()
    .from(INVITES)
    .select(
      'id, submission_id, client_id, recipient_email, recipient_name, trade_name, expires_at, used_at, revoked_at, created_at'
    )
    .in('submission_id', unique)
    .order('created_at', { ascending: false })

  if (error || !data) return latest
  // Newest first, so the first one seen for a proposal is the one in force.
  for (const row of data as AdminInviteRow[]) {
    if (!latest.has(row.submission_id)) latest.set(row.submission_id, row)
  }
  return latest
}

async function loadDocumentsOfSubmissions(
  ids: string[]
): Promise<Map<string, PartnerDocumentKind[]>> {
  const kinds = new Map<string, PartnerDocumentKind[]>()
  const unique = ids.filter((id, index) => id && ids.indexOf(id) === index)
  if (unique.length === 0) return kinds

  const { data, error } = await service()
    .from(DOCUMENTS)
    .select('id, submission_id, kind')
    .in('submission_id', unique)

  if (error || !data) return kinds
  for (const row of data as { submission_id: string; kind: PartnerDocumentKind }[]) {
    const list = kinds.get(row.submission_id) ?? []
    list.push(row.kind)
    kinds.set(row.submission_id, list)
  }
  return kinds
}

export interface ClientRecord {
  id: string
  name: string | null
  email: string | null
  [column: string]: unknown
}

export interface ProposalDetail {
  submission: AdminSubmissionRow
  /** Every invite ever minted for this proposal, newest first — the trail of §4.9. */
  invites: AdminInviteRow[]
  documents: AdminDocumentRow[]
  /** The client this proposal is already tied to, when the invite named one. */
  client: ClientRecord | null
}

/** The columns the promotion panel compares against. An allowlist, like the write. */
const CLIENT_COMPARE_COLUMNS =
  'id, name, email, phone, company_name, address, city, state, country, postal_code, industry, website, social_handle, tax_id, tax_id_type, legal_representative_name, legal_representative_role, status, created_at'

export async function loadProposalDetail(submissionId: string): Promise<ProposalDetail | null> {
  const { data: submission, error } = await service()
    .from(SUBMISSIONS)
    .select(
      'id, status, answers, is_partial, submitted_at, updated_at, created_at, promoted_at, promoted_by, promoted_client_id'
    )
    .eq('id', submissionId)
    .maybeSingle()

  if (error || !submission) return null

  const { data: inviteRows } = await service()
    .from(INVITES)
    .select(
      'id, submission_id, client_id, recipient_email, recipient_name, trade_name, expires_at, used_at, revoked_at, created_at'
    )
    .eq('submission_id', submissionId)
    .order('created_at', { ascending: false })

  const { data: documentRows } = await service()
    .from(DOCUMENTS)
    .select('id, submission_id, kind, storage_path, file_name, byte_size, mime_type, created_at')
    .eq('submission_id', submissionId)
    .order('created_at', { ascending: true })

  const invites = (inviteRows ?? []) as AdminInviteRow[]
  const row = submission as AdminSubmissionRow
  const clientId = row.promoted_client_id ?? invites[0]?.client_id ?? null

  return {
    submission: row,
    invites,
    documents: (documentRows ?? []) as AdminDocumentRow[],
    client: clientId ? await loadClient(clientId) : null,
  }
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
 * `core.clients.email` is unique. The panel resolves the collision BEFORE the write button
 * appears (§4.6), so a `23505` never reaches the operator as an error — it reaches them as a
 * choice, with both options spelled out.
 */
export async function findClientByEmail(email: string): Promise<ClientRecord | null> {
  const normalized = email.trim().toLowerCase()
  if (!normalized) return null

  const { data, error } = await service()
    .from(CLIENTS)
    .select(CLIENT_COMPARE_COLUMNS)
    .eq('email', normalized)
    .maybeSingle()

  if (error || !data) return null
  return data as ClientRecord
}

export type PromotionOutcome =
  | { ok: true; clientId: string; created: boolean; written: PromotableColumn[] }
  | { ok: false; reason: 'not_promotable' | 'email_taken' | 'write_failed' }

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
 * ORDER, AND WHY IT IS THIS ONE. PostgREST has no transaction across statements, so the claim
 * is taken first: `status = 'submitted'` is a predicate of the UPDATE, so two operators
 * clicking at the same time produce exactly one winner, and a proposal already promoted or
 * discarded matches no row. Only then is `core.clients` written. If that write fails the claim
 * is handed back — the proposal returns to `submitted` — so the operator's screen and the
 * database agree that nothing happened.
 *
 * The residue this leaves is one case, and it is the honest one: the client row is written and
 * the trail column is not. That is why the failure copy for a network error does not offer
 * "try again" and tells the operator to open the client record first.
 */
export async function promoteProposal(command: PromotionCommand): Promise<PromotionOutcome> {
  const promotedAt = new Date().toISOString()

  const { data: claimed, error: claimError } = await service()
    .from(SUBMISSIONS)
    .update({ status: 'promoted', promoted_at: promotedAt, promoted_by: command.promotedBy })
    .eq('id', command.submissionId)
    .eq('status', 'submitted')
    .select('id')

  if (claimError) return { ok: false, reason: 'write_failed' }
  if (!claimed || claimed.length === 0) return { ok: false, reason: 'not_promotable' }

  const written = await writeClient(command)
  if (!written.ok) {
    await releaseClaim(command.submissionId)
    return { ok: false, reason: written.reason }
  }

  await service()
    .from(SUBMISSIONS)
    .update({ promoted_client_id: written.clientId, updated_at: promotedAt })
    .eq('id', command.submissionId)

  return {
    ok: true,
    clientId: written.clientId,
    created: written.created,
    written: command.written,
  }
}

async function releaseClaim(submissionId: string): Promise<void> {
  await service()
    .from(SUBMISSIONS)
    .update({ status: 'submitted', promoted_at: null, promoted_by: null })
    .eq('id', submissionId)
}

type ClientWriteOutcome =
  | { ok: true; clientId: string; created: boolean }
  | { ok: false; reason: 'email_taken' | 'write_failed' }

async function writeClient(command: PromotionCommand): Promise<ClientWriteOutcome> {
  if (command.clientId) {
    const { data, error } = await service()
      .from(CLIENTS)
      .update({ ...command.updates, updated_at: new Date().toISOString() })
      .eq('id', command.clientId)
      .select('id')

    if (error) return { ok: false, reason: isUniqueViolation(error) ? 'email_taken' : 'write_failed' }
    if (!data || data.length === 0) return { ok: false, reason: 'write_failed' }
    return { ok: true, clientId: command.clientId, created: false }
  }

  const { data, error } = await service()
    .from(CLIENTS)
    // `status` is NOT part of the promotion (it is on the never-written list): a new record is
    // born pending because that is what `core.clients` does with a new record, and approving
    // the partnership is another decision on the client's own page (BR-B2B-010, item 1).
    .insert({ ...command.updates, client_type: 'partner' })
    .select('id')
    .single()

  if (error || !data) {
    return { ok: false, reason: isUniqueViolation(error) ? 'email_taken' : 'write_failed' }
  }
  return { ok: true, clientId: (data as { id: string }).id, created: true }
}

function isUniqueViolation(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { code?: string }).code === '23505'
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

/**
 * A link to one stored file, valid for a minute, asked for on the click.
 *
 * `submissionId` is a predicate and not decoration: it is what stops a document id from one
 * proposal being read through the page of another. `storage_path` is resolved here and never
 * leaves the server.
 */
export async function signDocument(
  submissionId: string,
  documentId: string
): Promise<{ url: string; fileName: string } | null> {
  const { data: document, error } = await service()
    .from(DOCUMENTS)
    .select('id, storage_path, file_name')
    .eq('id', documentId)
    .eq('submission_id', submissionId)
    .maybeSingle()

  if (error || !document) return null

  const row = document as { storage_path: string; file_name: string }
  const { data: signed, error: signError } = await getSupabaseService()
    .storage.from(PARTNER_DOCUMENTS_BUCKET)
    .createSignedUrl(row.storage_path, DOCUMENT_SIGNED_URL_SECONDS)

  if (signError || !signed?.signedUrl) return null
  return { url: signed.signedUrl, fileName: row.file_name }
}
