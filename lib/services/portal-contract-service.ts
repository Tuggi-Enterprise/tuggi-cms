/**
 * #919 — the Contract section of the partner portal (`tuggi-places`, `/status/contrato`): read the
 * CMS contract to accept, accept it, and open the signed PDF. Contract:
 * `docs/contracts/portal-contrato.md` §4 (workspace). Rules: BR-B2B-047 (evidence), BR-B2B-056
 * item 6 (the client from before the portal accepts the CMS contract in the portal).
 *
 * WHO IS ON THE OTHER SIDE, AND WHY THIS MODULE HOLDS `service_role` BEHIND A PUBLIC ROUTE.
 * The caller is the portal's Worker, never a browser and never a CMS operator. It proves itself
 * with `PLACES_CMS_SECRET` (the same secret it already holds for the `places-*` Edge Functions)
 * and forwards the portal user's JWT. Ownership is proved by the DATABASE, with that JWT and the
 * publishable key: `core.portal_get_contract` / `core.portal_accept_contract` raise `42501`
 * without a portal session and `TGP01` for anyone who is not the owner. Only after the RPC
 * answered does `service_role` touch anything, and only the contract id THE RPC returned — a
 * `contract_id`, path or client id in the request is never read. Same shape as the #341 service:
 * a closed API, one operation per export, nothing that writes `partner.clients`.
 *
 * Logs carry the contract id and nothing else: no name, no CPF, no e-mail, no IP.
 */

import { timingSafeEqual } from 'node:crypto'
import { getSupabaseService } from '@/lib/core/supabase-client'
import { userRpc, type RpcError, type UserRpc } from '@/lib/core/supabase-user-rpc'
import { shortHash } from '@/lib/contract/hash'
import { SUMMARY_DISCLAIMER, SUMMARY_TITLE, buildContractSummary } from '@/lib/contract/summary'
import { renderClauses, templateByVersion } from '@/lib/contract/template'
import {
  PARTNER_CONTRACTS_BUCKET,
  archiveSignedDocument,
  getAcceptance,
  getContract,
  sendSignedCopy,
  type AcceptanceRow,
  type ContractRow,
} from '@/lib/services/partner-contract-service'

/** The header the Worker sends the secret in — the twin of `_shared/places-secret.ts`. */
export const PLACES_SECRET_HEADER = 'x-places-secret'

/** The signed PDF URL lives this long and is never stored (contract §4, item 3). */
export const SIGNED_URL_SECONDS = 60

export type PortalFailure = {
  status: number
  body: { error: 'relogin' | 'support' | 'not_found' | 'status' | 'terms_changed' | 'invalid' | 'bad_request' | 'unavailable'; field?: string; detail?: string }
}
export type Outcome<T> = { ok: true; data: T } | { ok: false; failure: PortalFailure }

const fail = (status: number, body: PortalFailure['body']): { ok: false; failure: PortalFailure } => ({
  ok: false,
  failure: { status, body },
})

const sameText = (a: string, b: string): boolean => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * The portal user's JWT, when the request comes from the portal's Worker. `null` = refuse: no
 * secret configured (an unset secret never reads as "no secret needed"), wrong secret, or no bearer.
 */
export function placesCaller(headers: Headers): { jwt: string } | null {
  const expected = (process.env.PLACES_CMS_SECRET ?? '').trim()
  const given = (headers.get(PLACES_SECRET_HEADER) ?? '').trim()
  if (!expected || !given || !sameText(given, expected)) return null
  const bearer = /^Bearer\s+(\S+)$/i.exec(headers.get('authorization') ?? '')
  return bearer ? { jwt: bearer[1] } : null
}

// ── The database, as the portal user ────────────────────────────────────────────────────

/** PostgREST error → the portal's error vocabulary (`tuggi-places/src/lib/portal-http.ts`, `portalFailure`). */
export function rpcFailure(e: RpcError): PortalFailure {
  const detail = (e.details ?? '').trim() || (e.message ?? '').trim() || undefined
  switch (e.code) {
    case '42501':
    case 'PGRST301':
    case 'PGRST303':
      return detail === 'email' ? { status: 403, body: { error: 'support' } } : { status: 401, body: { error: 'relogin' } }
    case 'TGP01':
      return { status: 404, body: { error: 'not_found' } }
    case 'TGP09':
      return { status: 409, body: { error: 'terms_changed' } }
    case 'TGP10':
      return { status: 409, body: { error: 'status', ...(detail ? { detail } : {}) } }
    case 'TGP22':
      return { status: 422, body: { error: 'invalid', ...(detail ? { field: detail } : {}) } }
    default:
      return { status: 502, body: { error: 'unavailable' } }
  }
}

export type PortalContractRow = {
  contract_kind: 'portal_terms' | 'cms_contract' | null
  state: 'accepted' | 'pending' | 'preparing' | 'none'
  accepted_at: string | null
  version: string | null
  contract_id: string | null
  document_ready: boolean
}

const firstRow = (data: unknown): Record<string, unknown> | null => {
  const row = Array.isArray(data) ? data[0] : data
  return row && typeof row === 'object' ? (row as Record<string, unknown>) : null
}

async function readContract(rpc: UserRpc, submissionId: string): Promise<Outcome<PortalContractRow>> {
  const { data, error } = await rpc('portal_get_contract', { p_submission_id: submissionId })
  if (error) return { ok: false, failure: rpcFailure(error) }
  const row = firstRow(data)
  if (!row) return fail(502, { error: 'unavailable' })
  return { ok: true, data: row as unknown as PortalContractRow }
}

/** The CMS contract the RPC named, and its acceptance. Service role, by that id only. */
async function finishArchive(contract: ContractRow, acceptance: AcceptanceRow | null): Promise<AcceptanceRow | null> {
  if (!acceptance) return null
  if (acceptance.signed_document_path) return acceptance
  // Contract §4, 2.d: if this fails the acceptance stands, and the next GET/POST completes it.
  return archiveSignedDocument(contract, acceptance)
}

// ── 1. The text to accept (state C) ─────────────────────────────────────────────────────

export type ContractToAccept = {
  contract_id: string
  document_hash: string
  template_version: string
  title: string
  legal_name: string
  summary_title: string
  summary: { id: string; label: string; points: string[] }[]
  summary_disclaimer: string
  clauses: { number: number; title: string; paragraphs: string[] }[]
}

export async function contractToAccept(jwt: string, submissionId: string): Promise<Outcome<ContractToAccept>> {
  const read = await readContract(userRpc(jwt), submissionId)
  if (!read.ok) return read
  const row = read.data
  if (row.contract_kind !== 'cms_contract' || row.state !== 'pending' || !row.contract_id) {
    return fail(409, { error: 'status', detail: row.state })
  }
  const contract = await getContract(row.contract_id)
  const template = contract ? templateByVersion(contract.template_version) : null
  if (!contract || !template) {
    console.error('[portal-contract] contract to accept unreadable', row.contract_id)
    return fail(502, { error: 'unavailable' })
  }
  return {
    ok: true,
    data: {
      contract_id: contract.id,
      document_hash: contract.document_hash,
      template_version: contract.template_version,
      title: template.title,
      legal_name: contract.snapshot.partner.legalName,
      summary_title: SUMMARY_TITLE,
      summary: buildContractSummary(contract.snapshot).map(({ id, label, points }) => ({ id, label, points })),
      summary_disclaimer: SUMMARY_DISCLAIMER,
      clauses: renderClauses(contract.snapshot).map(({ number, title, paragraphs }) => ({ number, title, paragraphs: [...paragraphs] })),
    },
  }
}

// ── 2. Accept (state C) ─────────────────────────────────────────────────────────────────

export type AcceptBody = {
  submissionId: string
  documentHash: string
  signerName: string
  signerRole: string
  signerCpf: string
  clientIp: string | null
  userAgent: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length <= max ? v : null)

/**
 * Shape only; the rules (name 3–200, role 2–200, valid CPF, IP, user agent) are the database's,
 * and its `TGP22` comes back with the field. A `contract_id` in the body is not read at all.
 */
export function parseAcceptBody(raw: unknown): AcceptBody | null {
  const b = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
  if (!b) return null
  const submissionId = str(b.submission_id, 36)
  const documentHash = str(b.document_hash, 64)
  const signerName = str(b.signer_name, 200)
  const signerRole = str(b.signer_role, 200)
  const signerCpf = str(b.signer_cpf, 14)
  if (!submissionId || !UUID.test(submissionId) || !documentHash || signerName === null || signerRole === null || signerCpf === null) return null
  return {
    submissionId,
    documentHash,
    signerName: signerName.trim(),
    signerRole: signerRole.trim(),
    signerCpf,
    clientIp: str(b.client_ip, 45),
    userAgent: str(b.user_agent, 1000),
  }
}

export type Accepted = { accepted_at: string; created: boolean; document_ready: boolean }

export async function acceptFromPortal(jwt: string, body: AcceptBody): Promise<Outcome<Accepted>> {
  const rpc = userRpc(jwt)
  const read = await readContract(rpc, body.submissionId)
  if (!read.ok) return read
  const row = read.data
  // `accepted` too: a retry after the commit goes to the RPC, which answers `created = false`.
  if (row.contract_kind !== 'cms_contract' || !row.contract_id || (row.state !== 'pending' && row.state !== 'accepted')) {
    return fail(409, { error: 'status', detail: row.state })
  }

  const { data, error } = await rpc('portal_accept_contract', {
    p_submission_id: body.submissionId,
    p_contract_id: row.contract_id,
    p_document_hash: body.documentHash,
    p_signer_name: body.signerName,
    p_signer_role: body.signerRole,
    p_signer_cpf: body.signerCpf,
    p_ip: body.clientIp,
    p_user_agent: body.userAgent,
  })
  if (error) return { ok: false, failure: rpcFailure(error) }
  const accepted = firstRow(data)
  if (!accepted || typeof accepted.accepted_at !== 'string') return fail(502, { error: 'unavailable' })
  const created = accepted.created === true

  // From here on the acceptance is committed: nothing below can fail it (contract §4, 2.d).
  const contract = await getContract(row.contract_id)
  const archived = contract ? await finishArchive(contract, await getAcceptance(row.contract_id)) : null
  if (!archived?.signed_document_path) console.error('[portal-contract] archive pending for contract', row.contract_id)

  // Only the request that created the acceptance sends the copy; a retry is the same fact twice.
  if (created && contract) {
    const acceptance = archived ?? (await getAcceptance(row.contract_id))
    if (acceptance) {
      await sendSignedCopy({
        to: acceptance.recipient_email,
        link: { portal: true },
        signerName: acceptance.signer_name,
        signerRole: acceptance.signer_role,
        legalName: contract.snapshot.partner.legalName,
        acceptedAt: acceptance.accepted_at,
        verificationCode: acceptance.signed_document_hash ? shortHash(acceptance.signed_document_hash) : '',
      })
    }
  }

  return { ok: true, data: { accepted_at: accepted.accepted_at, created, document_ready: !!archived?.signed_document_path } }
}

// ── 3. The signed PDF (state B) ─────────────────────────────────────────────────────────

export async function signedDocumentUrl(jwt: string, submissionId: string): Promise<Outcome<{ url: string }>> {
  const read = await readContract(userRpc(jwt), submissionId)
  if (!read.ok) return read
  const row = read.data
  if (row.contract_kind !== 'cms_contract' || row.state !== 'accepted' || !row.contract_id) {
    return fail(409, { error: 'status', detail: row.state })
  }
  let acceptance = await getAcceptance(row.contract_id)
  if (acceptance && !acceptance.signed_document_path) {
    const contract = await getContract(row.contract_id)
    acceptance = contract ? await finishArchive(contract, acceptance) : null
  }
  const path = acceptance?.signed_document_path
  if (!path) {
    console.error('[portal-contract] signed document unavailable for contract', row.contract_id)
    return fail(503, { error: 'unavailable' })
  }
  const { data, error } = await getSupabaseService().storage.from(PARTNER_CONTRACTS_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS)
  if (error || !data?.signedUrl) {
    console.error('[portal-contract] signed url failed for contract', row.contract_id)
    return fail(503, { error: 'unavailable' })
  }
  return { ok: true, data: { url: data.signedUrl } }
}
