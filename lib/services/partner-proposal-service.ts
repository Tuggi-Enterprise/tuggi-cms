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

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { getSupabaseService } from '@/lib/core/supabase-client'
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
  invite_id: string
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
 * The token as it is stored. The raw token exists in the e-mail and in the URL and
 * nowhere else: what the table holds is this hash, so reading the table does not hand
 * anyone a working link.
 *
 * SHA-256 without a salt is deliberate and sufficient here: the token is 32 random bytes
 * from the CSPRNG, so there is no dictionary to run against it, and the lookup has to be
 * a single indexed equality.
 */
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** 32 bytes, base64url — 256 bits of entropy in a URL-safe segment. */
export function generateInviteToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Shape check before the database is touched. A token that cannot be one of ours is not
 * worth a round trip, and answering "invalid" without querying keeps a scan cheap for us
 * instead of cheap for the scanner.
 */
export function isWellFormedToken(token: string): boolean {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{40,64}$/.test(token)
}

/** Constant-time comparison, for the places that compare two hashes in JS. */
export function tokenHashEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

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
    .select('id, client_id, recipient_email, recipient_name, trade_name, locale, expires_at, used_at, revoked_at')
    .eq('token_hash', hashInviteToken(token))
    .maybeSingle()

  if (error || !invite) return { state: 'invalid' }

  if (invite.revoked_at) return { state: 'revoked', invite }
  if (invite.used_at) return { state: 'used', invite }
  if (new Date(invite.expires_at).getTime() <= Date.now()) return { state: 'expired', invite }

  const submission = await loadSubmission(invite.id)
  const documents = submission ? await listDocuments(submission.id) : []

  return { state: 'valid', invite, submission: submission ?? undefined, documents }
}

async function loadSubmission(inviteId: string): Promise<PartnerSubmission | null> {
  const { data, error } = await service()
    .from(SUBMISSIONS)
    .select('id, invite_id, status, answers, is_partial, submitted_at, updated_at')
    .eq('invite_id', inviteId)
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
 * Autosave. Upserts the draft of an invite that is still open; a submitted proposal is
 * never overwritten here — that is the same door the replay of a leaked link would use.
 */
export async function saveDraft(
  inviteId: string,
  answers: PartnerAnswers
): Promise<{ ok: boolean; submissionId?: string }> {
  const existing = await loadSubmission(inviteId)

  if (existing && existing.status !== 'draft') {
    return { ok: false }
  }

  if (existing) {
    const { error } = await service()
      .from(SUBMISSIONS)
      .update({ answers, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .eq('status', 'draft')
    return { ok: !error, submissionId: existing.id }
  }

  const { data, error } = await service()
    .from(SUBMISSIONS)
    .insert({ invite_id: inviteId, status: 'draft', answers })
    .select('id')
    .single()

  if (error || !data) return { ok: false }
  return { ok: true, submissionId: data.id }
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

  const existing = await loadSubmission(inviteId)

  if (existing) {
    const { error } = await service()
      .from(SUBMISSIONS)
      .update({
        answers,
        status: 'submitted',
        is_partial: options.isPartial,
        submitted_at: consumedAt,
        updated_at: consumedAt,
      })
      .eq('id', existing.id)
    if (error) return { ok: false, reason: 'write_failed' }
    return { ok: true, submissionId: existing.id, isPartial: options.isPartial }
  }

  const { data, error } = await service()
    .from(SUBMISSIONS)
    .insert({
      invite_id: inviteId,
      answers,
      status: 'submitted',
      is_partial: options.isPartial,
      submitted_at: consumedAt,
    })
    .select('id')
    .single()

  if (error || !data) return { ok: false, reason: 'write_failed' }
  return { ok: true, submissionId: data.id, isPartial: options.isPartial }
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

export interface CreateInviteInput {
  clientId?: string | null
  recipientEmail: string
  recipientName?: string | null
  tradeName?: string | null
  createdBy: string
  ttlDays?: number
}

/**
 * Creates an invite and returns the raw token exactly once — the caller sends it and
 * forgets it. Called only from the authenticated admin route.
 */
export async function createInvite(
  input: CreateInviteInput
): Promise<{ ok: boolean; token?: string; inviteId?: string; expiresAt?: string }> {
  const token = generateInviteToken()
  const expiresAt = new Date(
    Date.now() + (input.ttlDays ?? INVITE_TTL_DAYS) * 24 * 60 * 60 * 1000
  ).toISOString()

  const { data, error } = await service()
    .from(INVITES)
    .insert({
      client_id: input.clientId ?? null,
      token_hash: hashInviteToken(token),
      recipient_email: input.recipientEmail,
      recipient_name: input.recipientName ?? null,
      trade_name: input.tradeName ?? null,
      // The form surface exists in Portuguese only: CNPJ and alvará are Brazilian
      // documents (spec do `design`, §8.3). The column exists so the day that changes
      // it is a value and not a rewrite.
      locale: 'pt',
      expires_at: expiresAt,
      created_by: input.createdBy,
    })
    .select('id')
    .single()

  if (error || !data) return { ok: false }
  return { ok: true, token, inviteId: data.id, expiresAt }
}
