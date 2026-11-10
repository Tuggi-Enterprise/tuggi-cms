/**
 * The queue of requests of partners without a place (creator, influencer, driver and, since #1184,
 * tour guide) that came from the app — #1139, BR-B2B-066 items 1, 2 and 5, BR-USUARIO-052 item 4.d.
 * Contract
 * `docs/contracts/parceiro-sem-local.md` §4.
 *
 * The database decides everything: who is in the queue (only with the acceptance), whether the
 * document is already another partner's (`document_in_use`, 5.a), whether the record the approval
 * would complete has another account linked to it (`record_shared`, contract §4.2), the default
 * rate of the record (BR-MONETIZACAO-039 item 6, declared only in `drive.approve_partner_request_as`)
 * and the mark of the commission. This module only reads the three answers and formats what the
 * curator sees. No rate is declared here.
 *
 * Pure: the routes, the screen and the tests read it alike.
 */

import { isAppPartnerType, type AppPartnerType } from '@/lib/partnerships/partner-kind'

export type PartnerDocumentType = 'cpf' | 'cnpj'

/** One row of `drive.list_partner_requests_as()`. Personal data: admin screens only (5.b). */
export interface PartnerRequestRow {
  requestId: number
  userId: string
  nickname: string | null
  displayName: string | null
  partnerType: AppPartnerType
  documentType: PartnerDocumentType
  /** The CPF or the CNPJ, digits (and letters, for the alphanumeric CNPJ) only. */
  document: string
  fullName: string
  /** Company name, CNPJ only. */
  legalName: string | null
  /** CPF of who accepted for the company, CNPJ only. */
  representativeCpf: string | null
  whatsapp: string
  contactEmail: string
  /** The Instagram @ or a link; `null` for the driver. */
  publishesAt: string | null
  region: string
  acceptedAt: string
  termsVersion: string | null
  /** BR-B2B-066 item 5.a: the document is already in another partner record. A person decides. */
  documentInUse: boolean
  /** The record the approval completes (migrated creator, old app driver), or `null` = creates one. */
  existingClientId: string | null
  /**
   * Contract §4.1: another account also points at `existingClientId`. The approval answers
   * `record_shared` and changes nothing until a person sorts out who owns the record (§4.2).
   */
  recordShared: boolean
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/**
 * The rows of the RPC, or `null` when the answer is not a list. A malformed row is dropped:
 * a row without id, type or document cannot be decided, and inventing the missing field would
 * show the curator a request that does not exist.
 */
export function parsePartnerRequestRows(data: unknown): PartnerRequestRow[] | null {
  if (!Array.isArray(data)) return null
  const rows: PartnerRequestRow[] = []
  for (const raw of data) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const requestId = Number(r.request_id)
    const documentType = r.document_type
    const document = text(r.document)
    const userId = text(r.user_id)
    const acceptedAt = text(r.accepted_at)
    if (!Number.isSafeInteger(requestId) || requestId <= 0) continue
    if (!isAppPartnerType(r.partner_type)) continue
    if (documentType !== 'cpf' && documentType !== 'cnpj') continue
    if (!document || !userId || !acceptedAt) continue
    rows.push({
      requestId,
      userId,
      nickname: text(r.nickname),
      displayName: text(r.display_name),
      partnerType: r.partner_type,
      documentType,
      document,
      fullName: text(r.full_name) ?? '',
      legalName: text(r.legal_name),
      representativeCpf: text(r.representative_cpf),
      whatsapp: text(r.whatsapp) ?? '',
      contactEmail: text(r.contact_email) ?? '',
      publishesAt: text(r.publishes_at),
      region: text(r.region) ?? '',
      acceptedAt,
      termsVersion: text(r.terms_version),
      documentInUse: r.document_in_use === true,
      existingClientId: text(r.existing_client_id),
      recordShared: r.record_shared === true,
    })
  }
  return rows
}

/** `12345678909` → `123.456.789-09`; `12ABC34501DE35` → `12.ABC.345/01DE-35`. Anything else as it came. */
export function formatDocument(type: PartnerDocumentType, document: string): string {
  const value = document.replace(/[^0-9A-Za-z]/g, '').toUpperCase()
  if (type === 'cpf' && /^\d{11}$/.test(value)) {
    return `${value.slice(0, 3)}.${value.slice(3, 6)}.${value.slice(6, 9)}-${value.slice(9)}`
  }
  if (type === 'cnpj' && /^[0-9A-Z]{12}\d{2}$/.test(value)) {
    return `${value.slice(0, 2)}.${value.slice(2, 5)}.${value.slice(5, 8)}/${value.slice(8, 12)}-${value.slice(12)}`
  }
  return document
}

/** The `wa.me` link of the stored number (the database keeps the country code), or `null`. */
export function whatsappHref(whatsapp: string): string | null {
  const digits = whatsapp.replace(/\D/g, '')
  return digits.length >= 10 && digits.length <= 15 ? `https://wa.me/${digits}` : null
}

/** The link the person wrote in "onde publica", only when it is http(s); an @ is shown as text. */
export function publishesHref(publishesAt: string | null): string | null {
  if (!publishesAt) return null
  try {
    const url = new URL(publishesAt)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

/** What an approval answered (`drive.approve_partner_request_as`, contract §4.2). */
export type ApprovalOutcome =
  | { kind: 'approved'; clientId: string; partnerCode: string | null; commissionRate: number | null }
  | { kind: 'document_in_use' }
  | { kind: 'record_shared' }
  | { kind: 'not_in_review' }

export function readApprovalOutcome(data: unknown): ApprovalOutcome | null {
  if (!data || typeof data !== 'object') return null
  const r = data as Record<string, unknown>
  if (r.changed === true && r.status === 'approved' && typeof r.client_id === 'string') {
    const rate = r.commission_rate === null || r.commission_rate === undefined ? null : Number(r.commission_rate)
    return {
      kind: 'approved',
      clientId: r.client_id,
      partnerCode: text(r.partner_code),
      commissionRate: rate !== null && Number.isFinite(rate) ? rate : null,
    }
  }
  if (r.reason === 'document_in_use') return { kind: 'document_in_use' }
  if (r.reason === 'record_shared') return { kind: 'record_shared' }
  if (r.reason === 'not_in_review') return { kind: 'not_in_review' }
  return null
}

/**
 * The answers that leave the request in the queue: a person has to act on the other record (or
 * the other accounts) first, or refuse with a reason.
 */
export function approvalKeepsRequest(outcome: ApprovalOutcome): boolean {
  return outcome.kind === 'document_in_use' || outcome.kind === 'record_shared'
}

/** What a refusal answered (`drive.refuse_partner_request_as`, contract §4.3). */
export type RefusalOutcome = { kind: 'refused' } | { kind: 'not_in_review' }

export function readRefusalOutcome(data: unknown): RefusalOutcome | null {
  if (!data || typeof data !== 'object') return null
  const r = data as Record<string, unknown>
  if (r.changed === true && r.status === 'refused') return { kind: 'refused' }
  if (r.changed === false) return { kind: 'not_in_review' }
  return null
}

/** The bounds the database enforces on the refusal reason (`22023` outside them). */
export const REFUSAL_REASON_MAX = 500

/** The reason as the database will store it, or `null` when it would be refused. */
export function refusalReasonOf(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const reason = value.trim()
  return reason.length >= 1 && reason.length <= REFUSAL_REASON_MAX ? reason : null
}

/** The id of a request in a route path: a positive bigint, nothing else reaches the RPC. */
export function requestIdOf(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{1,15}$/.test(value)) return null
  const id = Number(value)
  return id > 0 ? id : null
}
