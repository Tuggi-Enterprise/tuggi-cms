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
 * Since #1297 the request of the new builds brings the country and the content block (channels with
 * the follower band, languages, topics; BR-USUARIO-052 item 4.a.i, contract §2.1.1 and §4.1). The
 * request of the build in the field (v1) keeps "onde publica" and the region, and the queue shows it
 * as it came (item 4.a.ii): every v2 field is `null` there.
 *
 * Pure: the routes, the screen and the tests read it alike.
 */

import { isAppPartnerType, type AppPartnerType } from '@/lib/partnerships/partner-kind'

export type PartnerDocumentType = 'cpf' | 'cnpj'

/** The six channels of the content block, in the order the database stores them (contract §2.1.1). */
export const CONTENT_NETWORKS = ['instagram', 'tiktok', 'youtube', 'facebook', 'site', 'other'] as const
export type ContentNetwork = (typeof CONTENT_NETWORKS)[number]

/** The four networks whose `value` is a username and that carry a follower band. */
export const SOCIAL_NETWORKS = ['instagram', 'tiktok', 'youtube', 'facebook'] as const
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number]

/** The follower band the person declares; nobody checks it and only the curator sees it (4.a.i). */
export const FOLLOWER_BANDS = ['up_to_1k', '1k_10k', '10k_100k', '100k_1m', 'over_1m'] as const
export type FollowerBand = (typeof FOLLOWER_BANDS)[number]

/** The closed list of topics (`drive.partner_content_topics()`). */
export const CONTENT_TOPICS = [
  'travel',
  'food',
  'adventure_nature',
  'culture_history',
  'family',
  'luxury',
  'budget_travel',
  'lifestyle',
  'other',
] as const
export type ContentTopic = (typeof CONTENT_TOPICS)[number]

export interface ContentChannel {
  network: ContentNetwork
  /** The username (4 networks, no @), the http(s) link (`site`) or free text (`other`). */
  value: string
  /** Only on the 4 networks; `null` on `site` and `other`. */
  audience: FollowerBand | null
}

const isIn =
  <T extends string>(list: readonly T[]) =>
  (value: unknown): value is T =>
    typeof value === 'string' && (list as readonly string[]).includes(value)

export const isContentNetwork = isIn(CONTENT_NETWORKS)
export const isSocialNetwork = isIn(SOCIAL_NETWORKS)
export const isFollowerBand = isIn(FOLLOWER_BANDS)
export const isContentTopic = isIn(CONTENT_TOPICS)

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
  /** ISO 3166-1 alpha-2. `null` = request of the old build (v1), shown as it came (4.a.ii). */
  country: string | null
  /** `null` on v1; `false` = driver or guide without the content block. */
  createsContent: boolean | null
  /** `null` on v1, `[]` without the block. */
  channels: ContentChannel[] | null
  /** ISO 639-1. `null` on v1, `[]` without the block. */
  contentLanguages: string[] | null
  /** Keys of `CONTENT_TOPICS`; a key the list does not know yet is kept as it came. */
  contentTopics: string[] | null
}

/** The request of the new builds (v2): it has the country, and never "onde publica". */
export function isContentRequest(row: Pick<PartnerRequestRow, 'country'>): boolean {
  return row.country !== null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function textList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
}

/**
 * The channels as the curator can trust them: an item without a known network or a text value is
 * dropped, and a band only stays on the 4 networks (on `site` and `other` the database refuses it).
 */
function channelsOf(value: unknown): ContentChannel[] | null {
  if (!Array.isArray(value)) return null
  const channels: ContentChannel[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const c = raw as Record<string, unknown>
    const channelValue = text(c.value)
    if (!isContentNetwork(c.network) || !channelValue) continue
    channels.push({
      network: c.network,
      value: channelValue,
      audience: isSocialNetwork(c.network) && isFollowerBand(c.audience) ? c.audience : null,
    })
  }
  return channels
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
      country: text(r.country)?.toUpperCase() ?? null,
      createsContent: typeof r.creates_content === 'boolean' ? r.creates_content : null,
      channels: channelsOf(r.channels),
      contentLanguages: textList(r.content_languages),
      contentTopics: textList(r.content_topics),
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

/** The value as a link only when it is http(s); anything else (an @, `javascript:`) is not a link. */
function httpHref(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

/** The link the person wrote in "onde publica", only when it is http(s); an @ is shown as text. */
export function publishesHref(publishesAt: string | null): string | null {
  return httpHref(publishesAt)
}

/**
 * The profile link of a username, the same shapes as the app (`tuggi-drive-v2`
 * `src/features/social/socialHandles.ts`, `SPEC.<network>.url`). Two repos, one contract
 * (§2.1.1): change one, change the other.
 */
const PROFILE_URL: Record<SocialNetwork, (handle: string) => string> = {
  instagram: (h) => `https://www.instagram.com/${h}`,
  tiktok: (h) => `https://www.tiktok.com/@${h}`,
  youtube: (h) => `https://www.youtube.com/@${h}`,
  facebook: (h) => (/^[0-9]+$/.test(h) ? `https://www.facebook.com/profile.php?id=${h}` : `https://www.facebook.com/${h}`),
}

/** The database stores the username lowercased, without @ (`core.social_handle_of`). */
const HANDLE = /^[a-z0-9._-]{1,50}$/

/**
 * Where the channel takes the curator: the profile on the 4 networks, the link on `site`, and
 * nothing on `other`, which is free text and never becomes a link.
 */
export function channelHref(channel: ContentChannel): string | null {
  if (isSocialNetwork(channel.network)) {
    return HANDLE.test(channel.value) ? PROFILE_URL[channel.network](channel.value) : null
  }
  if (channel.network === 'site') return httpHref(channel.value)
  return null
}

function displayName(type: 'region' | 'language', code: string): string {
  try {
    return new Intl.DisplayNames(['pt-BR'], { type, fallback: 'code' }).of(code) ?? code
  } catch {
    return code
  }
}

/** `BR` → `Brasil`. A code `Intl` does not know comes back as it came. */
export function countryName(code: string): string {
  return displayName('region', code.toUpperCase())
}

/** `en` → `inglês`. A code `Intl` does not know comes back as it came. */
export function languageName(code: string): string {
  return displayName('language', code.toLowerCase())
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
