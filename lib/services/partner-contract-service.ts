/**
 * The partnership contract's data access — and the only place in the #342 surface that
 * holds a `service_role` client. Same shape, and for the same reasons, as
 * `lib/services/partner-proposal-service.ts` (#341), which passed the security gate:
 *
 *  1. The API is closed and narrow. There is no "run this query" export. Every function
 *     names one operation on the two contract tables, and none of them can be pointed at
 *     `core.clients` for writing — the registration is read here and never written.
 *  2. Every public operation is keyed by the signing token, which the caller has to know,
 *     is single use in effect, expires, and is stored only as a SHA-256 hash.
 *  3. The public routes that call it carry `withRateLimit` and validate the body first.
 *
 * THREE THINGS THIS MODULE IS RESPONSIBLE FOR NOT GETTING WRONG:
 *
 * FROZEN VALUE (BR-B2B-017, item 5). The contract row carries a `snapshot` taken when the
 * document was generated. Nothing here re-reads `core.clients` to render, to re-hash or to
 * answer the trail. Editing the registration afterwards changes the next contract and
 * nothing else.
 *
 * IDEMPOTENT ACCEPTANCE. The deduplication key is the contract, and it is enforced by the
 * database: `core.partner_contract_acceptances.contract_id` is UNIQUE, the insert is an
 * `on conflict do nothing` whose affected rows decide the winner, and a second request
 * with the same token gets the FIRST acceptance back — same timestamp, same hash. A
 * network failure after the commit therefore cannot produce a second version of the fact,
 * which is what lets the retry button on the signing page exist at all (spec do `design`,
 * §4.3).
 *
 * THE SIGNED FILE IS FINISHED ON RETRY, NOT DUPLICATED. Acceptance is written before the
 * signed PDF is rendered, so a crash in between leaves a real acceptance with no archive.
 * The "already accepted" path completes it instead of failing, and the upload is an
 * overwrite of one deterministic path — never a second file with a second hash.
 */

import { getSupabaseService } from '@/lib/core/supabase-client'
import {
  generateSingleUseToken,
  hashSingleUseToken,
  isWellFormedSingleUseToken,
} from '@/lib/security/single-use-token'
import { sha256Hex, shortHash } from '@/lib/contract/hash'
import { renderContractPdf, type AcceptanceStamp } from '@/lib/contract/pdf'
import { activeTemplate, templateByVersion } from '@/lib/contract/template'
import type { ContractSnapshot, ContractTier } from '@/lib/contract/snapshot'

const SCHEMA = 'core'
const CONTRACTS = 'partner_contracts'
const ACCEPTANCES = 'partner_contract_acceptances'

/** Private bucket. Nothing here ever returns a public or signed URL. */
export const PARTNER_CONTRACTS_BUCKET = 'partner-contracts'

/** How long a signing link stays open, in days. */
export const SIGNING_TTL_DAYS = 14

export type ContractStatus = 'draft' | 'sent' | 'signed' | 'superseded' | 'terminated'

export interface ContractRow {
  id: string
  client_id: string
  template_version: string
  tier: ContractTier
  snapshot: ContractSnapshot
  status: ContractStatus
  token_expires_at: string | null
  sent_at: string | null
  sent_to_email: string | null
  opened_at: string | null
  document_path: string
  document_hash: string
  signed_document_path: string | null
  signed_document_hash: string | null
  superseded_by: string | null
  terminated_at: string | null
  created_at: string
  created_by: string
}

export interface AcceptanceRow {
  id: string
  contract_id: string
  signer_name: string
  signer_role: string
  accepted_at: string
  ip_address: string
  user_agent: string
  recipient_email: string
  template_version: string
  document_hash: string
  signed_document_hash: string | null
  signed_document_path: string | null
}

const CONTRACT_COLUMNS =
  'id, client_id, template_version, tier, snapshot, status, token_expires_at, sent_at, ' +
  'sent_to_email, opened_at, document_path, document_hash, signed_document_path, ' +
  'signed_document_hash, superseded_by, terminated_at, created_at, created_by'

const ACCEPTANCE_COLUMNS =
  'id, contract_id, signer_name, signer_role, accepted_at, ip_address, user_agent, ' +
  'recipient_email, template_version, document_hash, signed_document_hash, signed_document_path'

function service() {
  return getSupabaseService().schema(SCHEMA)
}

// ── Internal surface (authenticated CMS operator) ──────────────────────────────────────

export interface CreateContractInput {
  clientId: string
  snapshot: ContractSnapshot
  createdBy: string
}

/**
 * Generates the document: renders the PDF from the frozen snapshot, stores it in the
 * private bucket, and records the contract with the hash of what was stored.
 *
 * The hash is taken from the bytes that went into storage, not from a second render —
 * the PDF carries a creation timestamp, so two renders of one snapshot are two different
 * files, and hashing anything but the archived artefact would produce a number that never
 * checks out again.
 */
export async function createContract(
  input: CreateContractInput
): Promise<{ ok: boolean; contractId?: string; documentHash?: string; reason?: string }> {
  const client = getSupabaseService()

  let pdf: Uint8Array
  try {
    pdf = await renderContractPdf(input.snapshot)
  } catch (error) {
    console.error('[contract] render failed for client', input.clientId, errorMessage(error))
    return { ok: false, reason: 'render_failed' }
  }

  const documentHash = sha256Hex(pdf)
  const path = `${input.clientId}/${documentHash.slice(0, 16)}-contrato-${input.snapshot.templateVersion}.pdf`

  const { error: uploadError } = await client.storage
    .from(PARTNER_CONTRACTS_BUCKET)
    .upload(path, pdf, { contentType: 'application/pdf', upsert: true })

  if (uploadError) {
    console.error('[contract] upload failed for client', input.clientId)
    return { ok: false, reason: 'upload_failed' }
  }

  const { data, error } = await service()
    .from(CONTRACTS)
    .insert({
      client_id: input.clientId,
      template_version: input.snapshot.templateVersion,
      tier: input.snapshot.tier,
      snapshot: input.snapshot,
      status: 'draft',
      document_path: path,
      document_hash: documentHash,
      created_by: input.createdBy,
    })
    .select('id')
    .single()

  if (error || !data) {
    console.error('[contract] insert failed for client', input.clientId)
    return { ok: false, reason: 'write_failed' }
  }

  return { ok: true, contractId: data.id, documentHash }
}

/**
 * The contract that is alive for a client — the newest one that has not been superseded.
 * A superseded contract is history and is reachable by id, never by this function.
 */
export async function getLiveContract(
  clientId: string
): Promise<{ contract: ContractRow | null; acceptance: AcceptanceRow | null }> {
  const { data, error } = await service()
    .from(CONTRACTS)
    .select(CONTRACT_COLUMNS)
    .eq('client_id', clientId)
    .is('superseded_by', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return { contract: null, acceptance: null }

  const contract = data as unknown as ContractRow
  const acceptance = await getAcceptance(contract.id)
  return { contract, acceptance }
}

export async function getContract(contractId: string): Promise<ContractRow | null> {
  const { data, error } = await service()
    .from(CONTRACTS)
    .select(CONTRACT_COLUMNS)
    .eq('id', contractId)
    .maybeSingle()

  if (error || !data) return null
  return data as unknown as ContractRow
}

export async function getAcceptance(contractId: string): Promise<AcceptanceRow | null> {
  const { data, error } = await service()
    .from(ACCEPTANCES)
    .select(ACCEPTANCE_COLUMNS)
    .eq('contract_id', contractId)
    .maybeSingle()

  if (error || !data) return null
  return data as unknown as AcceptanceRow
}

/**
 * Retires the previous contract in favour of the new one.
 *
 * A signed contract is never edited and never deleted: changing the value of a live
 * contract is an amendment with a new acceptance (BR-B2B-017, item 5), so the old row
 * keeps its snapshot, its hashes and its acceptance, and gains a pointer to what replaced
 * it. That pointer is also what the external page reads to tell the partner their old link
 * now shows a superseded document.
 */
export async function supersedeContract(previousId: string, replacementId: string): Promise<boolean> {
  const { error } = await service()
    .from(CONTRACTS)
    .update({ status: 'superseded', superseded_by: replacementId })
    .eq('id', previousId)

  if (error) {
    console.error('[contract] supersede failed for contract', previousId)
    return false
  }
  return true
}

export type SendOutcome =
  | { ok: true; token: string; expiresAt: string }
  | { ok: false; reason: 'not_found' | 'legal_review_pending' | 'already_signed' | 'write_failed' }

/**
 * Opens the signing link.
 *
 * It refuses while the template version of THIS contract is pending legal review. That is
 * not ceremony: BR-B2B-023, item 2 says the adjustment index is chosen by the lawyer and
 * the operator and that no document names it before that, so the generated draft still
 * carries a bracketed hole. Generating and reading it is how the lawyer gets the draft;
 * sending it for signature would put that hole in front of a partner.
 */
export async function sendForSignature(
  contractId: string,
  input: { recipientEmail: string; sentBy: string; ttlDays?: number }
): Promise<SendOutcome> {
  const contract = await getContract(contractId)
  if (!contract) return { ok: false, reason: 'not_found' }
  if (contract.status === 'signed') return { ok: false, reason: 'already_signed' }

  const template = templateByVersion(contract.template_version)
  if (!template || template.legalReview.status !== 'approved') {
    return { ok: false, reason: 'legal_review_pending' }
  }

  const token = generateSingleUseToken()
  const expiresAt = new Date(
    Date.now() + (input.ttlDays ?? SIGNING_TTL_DAYS) * 24 * 60 * 60 * 1000
  ).toISOString()

  const { error } = await service()
    .from(CONTRACTS)
    .update({
      token_hash: hashSingleUseToken(token),
      token_expires_at: expiresAt,
      status: 'sent',
      sent_at: new Date().toISOString(),
      sent_to_email: input.recipientEmail,
      sent_by: input.sentBy,
    })
    .eq('id', contractId)
    // A signed contract never gets a fresh link: re-sending would mint a second way to
    // accept a document that already has one acceptance.
    .neq('status', 'signed')

  if (error) {
    console.error('[contract] send failed for contract', contractId)
    return { ok: false, reason: 'write_failed' }
  }

  return { ok: true, token, expiresAt }
}

/** Reads the archived bytes. The only way any PDF of this feature leaves the bucket. */
export async function downloadDocument(path: string): Promise<Uint8Array | null> {
  const { data, error } = await getSupabaseService().storage.from(PARTNER_CONTRACTS_BUCKET).download(path)
  if (error || !data) return null
  return new Uint8Array(await data.arrayBuffer())
}

export type IntegrityResult =
  | { state: 'match'; hash: string }
  | { state: 'mismatch'; expected: string; found: string }
  | { state: 'unavailable' }

/**
 * `Conferir integridade` (spec do `design`, §4.1): re-hashes the STORED file and compares
 * it with the hash recorded at acceptance. It does not re-render — see the note in
 * `lib/contract/pdf.tsx` about why a re-render can never reproduce the bytes.
 */
export async function verifyStoredDocument(
  path: string | null,
  expectedHash: string | null
): Promise<IntegrityResult> {
  if (!path || !expectedHash) return { state: 'unavailable' }
  const bytes = await downloadDocument(path)
  if (!bytes) return { state: 'unavailable' }

  const found = sha256Hex(bytes)
  return found === expectedHash ? { state: 'match', hash: found } : { state: 'mismatch', expected: expectedHash, found }
}

// ── External surface (the partner, holding the link) ───────────────────────────────────

export type SigningState = 'invalid' | 'expired' | 'signed' | 'superseded' | 'terminated' | 'open'

export interface ResolvedContract {
  state: SigningState
  contract?: ContractRow
  acceptance?: AcceptanceRow
}

/**
 * Resolves a raw token into the contract and its acceptance.
 *
 * A signed link keeps working and answers `signed` WITH the acceptance: the receipt is
 * what the signer is entitled to see, and it is the same information already sent to their
 * mailbox. What a closed link never gets is the ability to change anything.
 */
export async function resolveSigningToken(token: string): Promise<ResolvedContract> {
  if (!isWellFormedSingleUseToken(token)) return { state: 'invalid' }

  const { data, error } = await service()
    .from(CONTRACTS)
    .select(CONTRACT_COLUMNS)
    .eq('token_hash', hashSingleUseToken(token))
    .maybeSingle()

  if (error || !data) return { state: 'invalid' }
  const contract = data as unknown as ContractRow

  if (contract.status === 'signed') {
    const acceptance = await getAcceptance(contract.id)
    return { state: 'signed', contract, acceptance: acceptance ?? undefined }
  }
  if (contract.status === 'superseded' || contract.superseded_by) return { state: 'superseded', contract }
  if (contract.status === 'terminated') return { state: 'terminated', contract }
  if (contract.status !== 'sent') return { state: 'invalid' }
  if (contract.token_expires_at && new Date(contract.token_expires_at).getTime() <= Date.now()) {
    return { state: 'expired', contract }
  }

  return { state: 'open', contract }
}

/** First open by the partner, for the trail. Never overwritten, never a gate. */
export async function markOpened(contractId: string): Promise<void> {
  await service().from(CONTRACTS).update({ opened_at: new Date().toISOString() }).eq('id', contractId).is('opened_at', null)
}

export interface AcceptInput {
  contract: ContractRow
  /** Only to compose the link inside the signed copy e-mail; never stored. */
  signingToken: string
  signerName: string
  signerRole: string
  ipAddress: string
  userAgent: string
}

export type AcceptOutcome =
  | { ok: true; acceptance: AcceptanceRow; alreadyAccepted: boolean }
  | { ok: false; reason: 'unknown_template' | 'write_failed' }

/**
 * Records the acceptance, once per contract, and produces the signed archive.
 *
 * The order is the whole design. The acceptance row goes in FIRST, with `on conflict do
 * nothing` on the unique `contract_id`; the number of rows the insert returns is what
 * decides who won, and the loser reads the winner's row. Rendering first and inserting
 * after would leave a window where two requests each produce a signed PDF with a different
 * timestamp and a different hash — two versions of a fact whose entire job is to have one.
 *
 * `accepted_at` comes from the database default, so the stamp is the server's clock and
 * not the caller's (CPC arts. 411 and 434).
 */
export async function acceptContract(input: AcceptInput): Promise<AcceptOutcome> {
  // The legal-review gate belongs to `sendForSignature` and NOT here. It is the sending
  // that puts a document in front of a person, and a contract that was legitimately sent
  // must stay signable: publishing a new template version, or pulling one back for review,
  // cannot reach into a link somebody is already holding. The version this contract was
  // generated with is the version it renders and is signed under, and if that version has
  // disappeared from the code there is nothing to render and the refusal is honest.
  if (!templateByVersion(input.contract.template_version)) {
    console.error('[contract] unknown template version on contract', input.contract.id)
    return { ok: false, reason: 'unknown_template' }
  }

  const { data: inserted, error: insertError } = await service()
    .from(ACCEPTANCES)
    .upsert(
      {
        contract_id: input.contract.id,
        signer_name: input.signerName,
        signer_role: input.signerRole,
        ip_address: input.ipAddress,
        user_agent: input.userAgent,
        recipient_email: input.contract.sent_to_email,
        template_version: input.contract.template_version,
        document_hash: input.contract.document_hash,
      },
      { onConflict: 'contract_id', ignoreDuplicates: true }
    )
    .select(ACCEPTANCE_COLUMNS)

  if (insertError) {
    console.error('[contract] acceptance insert failed for contract', input.contract.id)
    return { ok: false, reason: 'write_failed' }
  }

  const won = Array.isArray(inserted) && inserted.length > 0
  const acceptance = won ? (inserted[0] as unknown as AcceptanceRow) : await getAcceptance(input.contract.id)

  if (!acceptance) {
    console.error('[contract] acceptance vanished for contract', input.contract.id)
    return { ok: false, reason: 'write_failed' }
  }

  // Self-healing, not a duplicate: the loser of the race — and the retry after a crash
  // between the insert and the upload — finishes the archive of the acceptance that
  // already exists, writing the same path with the same content.
  const completed = acceptance.signed_document_hash
    ? acceptance
    : await archiveSignedDocument(input.contract, acceptance)

  if (!completed) return { ok: false, reason: 'write_failed' }

  // Only the request that actually created the acceptance sends the copy. The retry path
  // is the same fact seen twice, and a second e-mail would tell the signer they signed
  // twice — which is exactly what the deduplication exists to prevent.
  if (won) {
    await sendSignedCopy({
      to: completed.recipient_email,
      token: input.signingToken,
      signerName: completed.signer_name,
      signerRole: completed.signer_role,
      legalName: input.contract.snapshot.partner.legalName,
      acceptedAt: completed.accepted_at,
      verificationCode: completed.signed_document_hash ? shortHash(completed.signed_document_hash) : '',
    })
  }

  return { ok: true, acceptance: completed, alreadyAccepted: !won }
}

/**
 * The signed copy, by e-mail.
 *
 * The function gets the TOKEN and composes the address itself, from our own origin — no
 * href in this feature is ever assembled from a value that travelled in a request body
 * (the correction the #341 gate made to `send-transactional`).
 *
 * It carries a LINK and not an attachment, which narrows the copy the `design` wrote ("O
 * PDF está anexado"): `send-transactional` has no authorization until #346, so an
 * attachment parameter on it would let anyone send an arbitrary file with our DKIM on it.
 * Registered for the `design` in the card.
 *
 * A failed e-mail never fails the acceptance: the signature is committed and the receipt
 * with the verification code is already on the signer's screen.
 */
async function sendSignedCopy(input: {
  to: string
  token: string
  signerName: string
  signerRole: string
  legalName: string
  acceptedAt: string
  verificationCode: string
}): Promise<void> {
  try {
    // `functions.invoke` resolves for any HTTP answer and only fills `error` on a non-2xx,
    // so the envelope has to be read too — a 200 with `{ error }` looks like success.
    const { data, error } = await getSupabaseService().functions.invoke('send-transactional', {
      body: {
        type: 'partner_contract_signed',
        to: input.to,
        lang: 'pt',
        data: {
          name: input.signerName,
          role: input.signerRole,
          legal_name: input.legalName,
          accepted_at: input.acceptedAt,
          verification_code: input.verificationCode,
          token: input.token,
        },
      },
    })
    if (error || (data && typeof data === 'object' && 'error' in data)) {
      console.error('[contract] signed copy refused by send-transactional')
    }
  } catch (err) {
    console.error('[contract] signed copy failed:', err instanceof Error ? err.message : err)
  }
}

/**
 * Renders the archive copy — the contract plus the acceptance appendix — stores it, and
 * closes the contract.
 *
 * Two hashes exist and they answer two questions. `document_hash` is the PDF that was
 * DISPLAYED and accepted: it is the legally load-bearing one and it is printed inside the
 * appendix. `signed_document_hash` is the archive copy, which is the file the partner
 * downloads and the one `Conferir integridade` checks. A document cannot contain its own
 * hash, so conflating the two would leave the trail proving nothing.
 */
async function archiveSignedDocument(
  contract: ContractRow,
  acceptance: AcceptanceRow
): Promise<AcceptanceRow | null> {
  const stamp: AcceptanceStamp = {
    signerName: acceptance.signer_name,
    signerRole: acceptance.signer_role,
    acceptedAt: acceptance.accepted_at,
    ipAddress: acceptance.ip_address,
    userAgent: acceptance.user_agent,
    recipientEmail: acceptance.recipient_email,
    documentHash: contract.document_hash,
  }

  let pdf: Uint8Array
  try {
    pdf = await renderContractPdf(contract.snapshot, stamp)
  } catch (error) {
    console.error('[contract] signed render failed for contract', contract.id, errorMessage(error))
    return null
  }

  const signedHash = sha256Hex(pdf)
  const path = `${contract.client_id}/${contract.id}-assinado.pdf`

  const { error: uploadError } = await getSupabaseService()
    .storage.from(PARTNER_CONTRACTS_BUCKET)
    .upload(path, pdf, { contentType: 'application/pdf', upsert: true })

  if (uploadError) {
    console.error('[contract] signed upload failed for contract', contract.id)
    return null
  }

  const { data, error } = await service()
    .from(ACCEPTANCES)
    .update({ signed_document_hash: signedHash, signed_document_path: path })
    .eq('id', acceptance.id)
    .select(ACCEPTANCE_COLUMNS)
    .single()

  if (error || !data) {
    console.error('[contract] acceptance update failed for contract', contract.id)
    return null
  }

  const { error: statusError } = await service()
    .from(CONTRACTS)
    .update({ status: 'signed', signed_document_path: path, signed_document_hash: signedHash })
    .eq('id', contract.id)

  if (statusError) {
    console.error('[contract] status update failed for contract', contract.id)
  }

  return data as unknown as AcceptanceRow
}

/** The version a new contract is generated with, exported so routes do not import two modules. */
export function activeTemplateVersion(): string {
  return activeTemplate().version
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown'
}
