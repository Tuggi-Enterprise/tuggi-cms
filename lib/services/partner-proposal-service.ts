/**
 * The partner form's data access — and the only place in the #341 surface that holds a
 * `service_role` client.
 *
 * WHY THE SERVICE CLIENT IS HERE AND NOT IN THE ROUTE, stated out loud because
 * `scripts/check-route-policies.ts` refuses `withPublicRoute` in a file that reaches
 * `service_role` and this module is, by construction, on the other side of that check:
 *
 * The check closes the fast path — "public" stamped on a handler that queries the whole
 * database with the secret key. It says so in its own docstring: a route that reaches
 * `service_role` through `lib/services/*` is out of its scope. This module is not an
 * evasion of it, it is the shape the check leaves open on purpose, and it only holds
 * because of three things that are code and not intent:
 *
 *  1. The API here is closed and narrow. There is no "run this query" export. Every
 *     function names one operation on three tables that belong to this feature, and
 *     none of them can be pointed at `core.clients`.
 *  2. Every operation is keyed by the invite token, which the caller has to know, is
 *     single-use, expires, and is stored only as a SHA-256 hash — a database dump does
 *     not yield a usable link.
 *  3. The public routes that call it carry `withRateLimit` and validate the body before
 *     it gets here.
 *
 * `core.clients` is not reachable from this module, on purpose: the submission is a
 * proposal, and the promotion into the live record is an authenticated act of the team
 * (BR-B2B-026, item 4). A leaked or replayed link must not be able to overwrite another
 * partner's registration — least of all the admin-only columns.
 *
 * Tables and bucket are specified for the `data` in #341 and do not exist yet; until the
 * migration lands every function here answers with the Supabase error, which is what the
 * routes already translate into a typed response.
 */

import { getSupabaseService } from '@/lib/core/supabase-client'
import {
  generateSingleUseToken,
  hashSingleUseToken,
  isWellFormedSingleUseToken,
} from '@/lib/security/single-use-token'
import type { PartnerAnswers } from '@/lib/partner-form/schema'
import type { PartnerDocumentKind } from '@/lib/partner-form/fields'

const SCHEMA = 'core'
const INVITES = 'partner_form_invites'
const SUBMISSIONS = 'partner_form_submissions'
const DOCUMENTS = 'partner_form_documents'

/** Private bucket. Nothing here ever returns a public URL. */
export const PARTNER_DOCUMENTS_BUCKET = 'partner-documents'

/** Default life of an invite link, in days. */
export const INVITE_TTL_DAYS = 14

export type InviteState = 'valid' | 'invalid' | 'expired' | 'used' | 'revoked'

export interface PartnerInvite {
  id: string
  /**
   * The proposal this link opens. The invite points at the proposal and never the other
   * way round: the proposal belongs to the establishment and the invite is only the
   * credential that reaches it, which is what lets a second link continue the first one's
   * draft (`states.successPartialBody` promises exactly that).
   */
  submission_id: string
  client_id: string | null
  recipient_email: string
  recipient_name: string | null
  trade_name: string | null
  locale: string
  expires_at: string
  used_at: string | null
  revoked_at: string | null
}

export interface PartnerSubmission {
  id: string
  status: 'draft' | 'submitted' | 'promoted' | 'discarded'
  answers: PartnerAnswers
  is_partial: boolean
  submitted_at: string | null
  updated_at: string | null
}

export interface PartnerDocument {
  id: string
  submission_id: string
  kind: PartnerDocumentKind
  storage_path: string
  file_name: string
  byte_size: number
  mime_type: string
}

export interface ResolvedInvite {
  state: InviteState
  invite?: PartnerInvite
  submission?: PartnerSubmission
  documents?: PartnerDocument[]
}

/**
 * How a token is minted, stored and shape-checked is `lib/security/single-use-token.ts`,
 * shared with the contract signing link of #342: it is one decision — what a Tuggi link
 * token is — and having it twice would let the two features drift apart on the length, the
 * alphabet or the digest without anything failing. The three names below are the ones this
 * feature has always used and they stay, so that "invite token" reads as an invite token
 * at every call site here.
 */
export const hashInviteToken = hashSingleUseToken
export const generateInviteToken = generateSingleUseToken
export const isWellFormedToken = isWellFormedSingleUseToken

function service() {
  return getSupabaseService().schema(SCHEMA)
}

/**
 * Resolves a raw token into the invite, its draft and its documents.
 *
 * A used link answers `used` and NOTHING else about the submission: the link is
 * single-use precisely because it can leak, and handing back the CNPJ, the legal
 * representative and the documents to whoever has the URL would trade the first rule of
 * the Tuggi (data security) for convenience. The date the team shows the person comes
 * from the invite row, not from the answers.
 */
export async function resolveInvite(token: string): Promise<ResolvedInvite> {
  if (!isWellFormedToken(token)) return { state: 'invalid' }

  const { data: invite, error } = await service()
    .from(INVITES)
    .select(
      'id, submission_id, client_id, recipient_email, recipient_name, trade_name, locale, expires_at, used_at, revoked_at'
    )
    .eq('token_hash', hashInviteToken(token))
    .maybeSingle()

  if (error || !invite) return { state: 'invalid' }

  if (invite.revoked_at) return { state: 'revoked', invite }
  if (invite.used_at) return { state: 'used', invite }
  if (new Date(invite.expires_at).getTime() <= Date.now()) return { state: 'expired', invite }

  const submission = await loadSubmission(invite.submission_id)
  const documents = submission ? await listDocuments(submission.id) : []

  return { state: 'valid', invite, submission: submission ?? undefined, documents }
}

async function loadSubmission(submissionId: string): Promise<PartnerSubmission | null> {
  const { data, error } = await service()
    .from(SUBMISSIONS)
    .select('id, status, answers, is_partial, submitted_at, updated_at')
    .eq('id', submissionId)
    .maybeSingle()

  if (error || !data) return null
  return data as PartnerSubmission
}

export async function listDocuments(submissionId: string): Promise<PartnerDocument[]> {
  const { data, error } = await service()
    .from(DOCUMENTS)
    .select('id, submission_id, kind, storage_path, file_name, byte_size, mime_type')
    .eq('submission_id', submissionId)
    .order('created_at', { ascending: true })

  if (error || !data) return []
  return data as PartnerDocument[]
}

/**
 * Autosave. Never an insert: the proposal is minted together with the invite by
 * `core.tg_partner_form_invite_attach`, so by the time anyone can type there is a row.
 *
 * `status = 'draft'` is a predicate of the UPDATE and not an `if` over a previous SELECT.
 * A proposal the team already promoted or discarded matches no row and the answer is
 * `false` — a submitted proposal is never overwritten here, which is the same door the
 * replay of a leaked link would use.
 */
export async function saveDraft(submissionId: string, answers: PartnerAnswers): Promise<boolean> {
  const { data, error } = await service()
    .from(SUBMISSIONS)
    .update({ answers, updated_at: new Date().toISOString() })
    .eq('id', submissionId)
    .eq('status', 'draft')
    .select('id')

  return !error && Array.isArray(data) && data.length > 0
}

export type SubmitOutcome =
  | { ok: true; submissionId: string; isPartial: boolean }
  | { ok: false; reason: 'already_used' | 'write_failed' }

/**
 * Turns the draft into a submitted proposal, once.
 *
 * Single use is enforced by the database and not by a read-then-write: the invite is
 * consumed with `update ... where id = ? and used_at is null`, and PostgREST answers with
 * the affected rows, so two concurrent submissions of the same token produce exactly one
 * winner. Checking `used_at` in JavaScript first and updating after would leave the race
 * open — which is the whole point of the requirement.
 */
export async function submitProposal(
  inviteId: string,
  submissionId: string,
  answers: PartnerAnswers,
  options: { isPartial: boolean }
): Promise<SubmitOutcome> {
  const consumedAt = new Date().toISOString()

  const { data: consumed, error: consumeError } = await service()
    .from(INVITES)
    .update({ used_at: consumedAt })
    .eq('id', inviteId)
    .is('used_at', null)
    .select('id')

  if (consumeError) return { ok: false, reason: 'write_failed' }
  if (!consumed || consumed.length === 0) return { ok: false, reason: 'already_used' }

  const { error } = await service()
    .from(SUBMISSIONS)
    .update({
      answers,
      status: 'submitted',
      is_partial: options.isPartial,
      submitted_at: consumedAt,
      updated_at: consumedAt,
    })
    .eq('id', submissionId)

  if (error) return { ok: false, reason: 'write_failed' }
  return { ok: true, submissionId, isPartial: options.isPartial }
}

export interface StoredDocument {
  kind: PartnerDocumentKind
  fileName: string
  mimeType: string
  bytes: ArrayBuffer
}

/**
 * Uploads one file and records it. The storage path is built here from ids we control —
 * never from the name the browser sent, which is attacker-controlled text.
 */
export async function storeDocument(
  submissionId: string,
  document: StoredDocument
): Promise<{ ok: boolean; documentId?: string }> {
  const client = getSupabaseService()
  const safeName = sanitizeFileName(document.fileName)
  const path = `${submissionId}/${document.kind}/${Date.now()}-${safeName}`

  const { error: uploadError } = await client.storage
    .from(PARTNER_DOCUMENTS_BUCKET)
    .upload(path, document.bytes, { contentType: document.mimeType, upsert: false })

  if (uploadError) return { ok: false }

  const { data, error } = await service()
    .from(DOCUMENTS)
    .insert({
      submission_id: submissionId,
      kind: document.kind,
      storage_path: path,
      file_name: safeName,
      byte_size: document.bytes.byteLength,
      mime_type: document.mimeType,
    })
    .select('id')
    .single()

  if (error || !data) return { ok: false }
  return { ok: true, documentId: data.id }
}

/** Removes a file the person chose by mistake, while the proposal is still a draft. */
export async function removeDocument(submissionId: string, documentId: string): Promise<boolean> {
  const client = getSupabaseService()

  const { data, error } = await client
    .schema(SCHEMA)
    .from(DOCUMENTS)
    .delete()
    .eq('id', documentId)
    .eq('submission_id', submissionId)
    .select('storage_path')
    .maybeSingle()

  if (error || !data) return false

  await client.storage.from(PARTNER_DOCUMENTS_BUCKET).remove([data.storage_path])
  return true
}

/**
 * The file name is echoed back to the person and stored; it is not part of the path we
 * trust. Everything that is not a letter, digit, dot, dash or underscore goes, which also
 * removes the `../` that would climb out of the prefix.
 */
export function sanitizeFileName(name: string): string {
  const cleaned = (name ?? 'arquivo')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    // Keeps the tail, so a very long name loses its beginning and not its extension.
    .slice(-120)
  return cleaned.replace(/^[.-]+/, '') || 'arquivo'
}

/**
 * A first contact carries the address the operator typed; a resend carries none, on
 * purpose — see `createInvite`. The union is the enforcement: there is no shape of this
 * input in which a resend can name a destination.
 */
export type CreateInviteInput =
  | {
      submissionId?: null
      clientId?: string | null
      recipientEmail: string
      recipientName?: string | null
      tradeName?: string | null
      createdBy: string
      ttlDays?: number
    }
  | {
      /** The proposal this new credential opens. Everything else is read from the record. */
      submissionId: string
      createdBy: string
      ttlDays?: number
    }

export interface CreatedInvite {
  token: string
  inviteId: string
  submissionId: string
  expiresAt: string
  /** Where the link has to go. On a resend this is a fact of the record, never of the request. */
  recipientEmail: string
  recipientName: string | null
  tradeName: string | null
}

export type CreateInviteOutcome =
  | { ok: true; invite: CreatedInvite }
  | { ok: false; reason: 'unknown_submission' | 'write_failed' }

/**
 * Creates an invite and returns the raw token exactly once — the caller sends it and
 * forgets it. Called only from the authenticated admin route.
 *
 * WHY A RESEND DOES NOT ACCEPT A DESTINATION ADDRESS:
 *
 * A resent link now opens the proposal that already exists, which means it hands back the
 * CNPJ, the legal representative and the list of documents the establishment already
 * sent. An address typed again on the resend screen — one transposed letter is enough —
 * would deliver all of that to a stranger, and it would look like a successful send. So
 * the destination of a resend is read from the invite already on record for that
 * proposal, and the operator has no field that can change it.
 *
 * The address that went wrong is not a resend: it is a new invite, which mints a new,
 * empty proposal and carries nothing from the old one.
 *
 * Which proposal a first-contact invite opens is decided by the database, not here:
 * `core.tg_partner_form_invite_attach` mints the empty proposal and fills `submission_id`
 * when the insert leaves it null, and refuses (`TGB26`) to point a new link at a proposal
 * the team already promoted or discarded.
 */
export async function createInvite(input: CreateInviteInput): Promise<CreateInviteOutcome> {
  const resend = typeof input.submissionId === 'string' ? input.submissionId : null
  const recipient =
    typeof input.submissionId === 'string'
      ? await recipientOfProposal(input.submissionId)
      : recipientOf(input)

  if (!recipient) return { ok: false, reason: 'unknown_submission' }

  const token = generateInviteToken()
  const expiresAt = new Date(
    Date.now() + (input.ttlDays ?? INVITE_TTL_DAYS) * 24 * 60 * 60 * 1000
  ).toISOString()

  const { data, error } = await service()
    .from(INVITES)
    .insert({
      // Null is the first contact and is what the trigger reads as "mint the proposal".
      submission_id: resend,
      client_id: recipient.client_id,
      token_hash: hashInviteToken(token),
      recipient_email: recipient.recipient_email,
      recipient_name: recipient.recipient_name,
      trade_name: recipient.trade_name,
      // The form surface exists in Portuguese only: CNPJ and alvará are Brazilian
      // documents (spec do `design`, §8.3). The column exists so the day that changes
      // it is a value and not a rewrite.
      locale: 'pt',
      expires_at: expiresAt,
      created_by: input.createdBy,
    })
    .select('id, submission_id')
    .single()

  if (error || !data) return { ok: false, reason: 'write_failed' }

  return {
    ok: true,
    invite: {
      token,
      inviteId: data.id,
      submissionId: data.submission_id,
      expiresAt,
      recipientEmail: recipient.recipient_email,
      recipientName: recipient.recipient_name,
      tradeName: recipient.trade_name,
    },
  }
}

interface InviteRecipient {
  client_id: string | null
  recipient_email: string
  recipient_name: string | null
  trade_name: string | null
}

function recipientOf(input: Extract<CreateInviteInput, { recipientEmail: string }>): InviteRecipient {
  return {
    client_id: input.clientId ?? null,
    recipient_email: input.recipientEmail,
    recipient_name: input.recipientName ?? null,
    trade_name: input.tradeName ?? null,
  }
}

/**
 * The most recent invite of a proposal is who the establishment is, as far as this
 * feature knows: it was minted by an authenticated operator. `answers` is NOT a source
 * here — whoever holds a live link can type any address into `representative_email`, and
 * reading it would let them redirect the next link at themselves.
 */
async function recipientOfProposal(submissionId: string): Promise<InviteRecipient | null> {
  const { data, error } = await service()
    .from(INVITES)
    .select('client_id, recipient_email, recipient_name, trade_name')
    .eq('submission_id', submissionId)
    .order('created_at', { ascending: false })
    .limit(1)

  if (error || !data || data.length === 0) return null
  return data[0] as InviteRecipient
}
