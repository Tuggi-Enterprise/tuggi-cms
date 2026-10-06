/**
 * Issuing the acceptance link of a client (BR-B2B-056; contract `docs/contracts/aceite-por-link.md`).
 *
 * The Studio draws the token (`generateSingleUseToken`, 256 bits), sends the database only its
 * sha256 (`client_acceptance_link_issue`, service_role), and hands the raw token to two places
 * only: the operator's screen, in the answer of this request, and the e-mail, through
 * `send-transactional`, which composes the href from an origin of ours.
 */

import { getSupabaseService } from '@/lib/core/supabase-client'
import { generateSingleUseToken, hashSingleUseToken } from '@/lib/security/single-use-token'
import { sendTransactionalEmail } from '@/lib/services/transactional-email'
import { loadLiveContractTiers } from '@/lib/services/partner-contract-tier'
import { derivePartnerPlan } from '@/lib/clients/partner-plan'
import {
  acceptanceUrl,
  isRecordField,
  placesPortalOrigin,
  type AcceptanceLinkError,
  type AcceptancePlan,
  type IssuedLink,
  type LinkStatus,
  type RecordField,
} from '@/lib/partnerships/acceptance-link'

function partner() {
  return getSupabaseService().schema('partner')
}

export type IssueOutcome =
  | ({ ok: true } & IssuedLink)
  | { ok: false; httpStatus: number; error: AcceptanceLinkError; field?: RecordField }

interface ClientForLink {
  name: string | null
  legal_representative_name: string | null
  monthly_fee_cents: number | null
  is_courtesy: boolean | null
  courtesy_reason: string | null
}

/**
 * The plan of the terms, from what the operator registered (BR-B2B-056, item 3). The live contract
 * outranks the record, as everywhere else (`derivePartnerPlan`). A fee or a courtesy is the paid
 * plan; anything else — a free contract, or a record with no fee — is the free plan: a client
 * nobody priced is not charged by a link (BR-B2B-017, item 6, reads absent as "not decided", and
 * the free terms decide nothing about money).
 */
export function planOfLink(kind: ReturnType<typeof derivePartnerPlan>['kind']): AcceptancePlan {
  return kind === 'paid' || kind === 'courtesy' ? 'map_and_description' : 'map_only'
}

/** `client_acceptance_link_issue`'s SQLSTATEs (contract §5) → the route's answer. */
export function issueErrorOf(
  code: string | undefined,
  detail: string | undefined
): { httpStatus: number; error: AcceptanceLinkError; field?: RecordField } {
  switch (code) {
    case 'TGP22':
      return isRecordField(detail)
        ? { httpStatus: 422, error: 'record_incomplete', field: detail }
        : { httpStatus: 503, error: 'issue_failed' }
    case 'TGP30':
      return { httpStatus: 404, error: 'client_not_found' }
    case 'TGP31':
      return { httpStatus: 409, error: 'already_accepted' }
    case 'TGP32':
      return { httpStatus: 409, error: 'paid_plan_unavailable' }
    case 'TGP33':
      return { httpStatus: 409, error: 'no_terms' }
    default:
      return { httpStatus: 503, error: 'issue_failed' }
  }
}

export async function issueAcceptanceLink(
  clientId: string,
  issuedByCmsUserId: string,
  send: boolean
): Promise<IssueOutcome> {
  const { data, error } = await partner()
    .from('clients')
    .select('name, legal_representative_name, monthly_fee_cents, is_courtesy, courtesy_reason')
    .eq('id', clientId)
    .maybeSingle()
  if (error) {
    console.error('[acceptance-link] client read failed', error.code)
    return { ok: false, httpStatus: 503, error: 'issue_failed' }
  }
  const client = data as ClientForLink | null
  if (!client) return { ok: false, httpStatus: 404, error: 'client_not_found' }

  const tiers = await loadLiveContractTiers([clientId])
  const plan = planOfLink(
    derivePartnerPlan({
      clientId,
      fee: {
        monthlyFeeCents: typeof client.monthly_fee_cents === 'number' ? client.monthly_fee_cents : null,
        isCourtesy: client.is_courtesy === true,
        courtesyReason: client.courtesy_reason ?? null,
      },
      planChoice: null,
      contractTier: tiers.get(clientId) ?? null,
    }).kind
  )

  const token = generateSingleUseToken()
  const { data: issued, error: issueError } = await partner().rpc('client_acceptance_link_issue', {
    p_client_id: clientId,
    p_plan_choice: plan,
    p_token_sha256: hashSingleUseToken(token),
    p_issued_by: issuedByCmsUserId,
  })
  if (issueError) {
    const refusal = issueErrorOf(issueError.code, issueError.details ?? undefined)
    if (refusal.error === 'issue_failed') console.error('[acceptance-link] issue failed', issueError.code)
    return { ok: false, ...refusal }
  }
  const row = (Array.isArray(issued) ? issued[0] : issued) as
    | { expires_at: string; sent_to_email: string }
    | undefined
  if (!row) return { ok: false, httpStatus: 503, error: 'issue_failed' }

  const url = acceptanceUrl(placesPortalOrigin(process.env.PLACES_PORTAL_ORIGIN), token)

  let emailSent: boolean | null = null
  if (send) {
    emailSent = await sendTransactionalEmail({
      type: 'partner_acceptance_link',
      to: row.sent_to_email,
      data: {
        token,
        name: client.legal_representative_name ?? '',
        trade_name: client.name ?? '',
        expires_at: row.expires_at,
      },
      context: `acceptance link of client ${clientId}`,
    })
  }

  return { ok: true, url, expiresAt: row.expires_at, sentTo: row.sent_to_email, emailSent }
}

/** The newest link of a client, for the tab. `null` when the read failed. */
export async function loadLinkStatus(clientId: string, now: Date = new Date()): Promise<LinkStatus | 'none' | null> {
  const { data, error } = await partner()
    .from('client_acceptance_links')
    .select('created_at, expires_at, sent_to_email, revoked_at, used_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error('[acceptance-link] status read failed', error.code)
    return null
  }
  const row = data as {
    created_at: string
    expires_at: string
    sent_to_email: string
    revoked_at: string | null
    used_at: string | null
  } | null
  if (!row) return 'none'
  const state = row.used_at
    ? 'used'
    : row.revoked_at
      ? 'revoked'
      : new Date(row.expires_at).getTime() <= now.getTime()
        ? 'expired'
        : 'live'
  return { createdAt: row.created_at, expiresAt: row.expires_at, sentTo: row.sent_to_email, state }
}
