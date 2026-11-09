/**
 * The three RPCs of the queue of requests of partners without a place (#1139, contract
 * `docs/contracts/parceiro-sem-local.md` §4). All three are `service_role` only, so they run on
 * the service client, behind the admin gate of the routes.
 *
 * `supabase-js` does not reject: every error comes back in `{ error }` and is read here.
 */

import { getSupabaseService } from '@/lib/core/supabase-client'
import {
  parsePartnerRequestRows,
  readApprovalOutcome,
  readRefusalOutcome,
  type ApprovalOutcome,
  type PartnerRequestRow,
  type RefusalOutcome,
} from '@/lib/partner-requests/queue'

export type DecisionFailure = 'not_found' | 'invalid_reason' | 'failed'

export type DecisionResult<T> = { ok: true; outcome: T } | { ok: false; error: DecisionFailure }

/** The requests in review, oldest acceptance first, or `null` when the read failed. */
export async function listPartnerRequests(): Promise<PartnerRequestRow[] | null> {
  const { data, error } = await getSupabaseService().schema('drive').rpc('list_partner_requests_as')
  if (error) {
    // The code only: the message of a failed read can carry a document.
    console.error('[partner-requests] list failed:', error.code)
    return null
  }
  return parsePartnerRequestRows(data)
}

function failureOf(error: { code?: string }): DecisionFailure {
  if (error.code === 'P0002') return 'not_found'
  if (error.code === '22023') return 'invalid_reason'
  return 'failed'
}

/** BR-B2B-066 item 2: approves; the database writes the record, the default rate and the mark. */
export async function approvePartnerRequest(
  requestId: number,
  actor: string
): Promise<DecisionResult<ApprovalOutcome>> {
  const { data, error } = await getSupabaseService()
    .schema('drive')
    .rpc('approve_partner_request_as', { p_request_id: requestId, p_actor: actor })
  if (error) {
    console.error('[partner-requests] approve failed:', error.code)
    return { ok: false, error: failureOf(error) }
  }
  const outcome = readApprovalOutcome(data)
  return outcome ? { ok: true, outcome } : { ok: false, error: 'failed' }
}

/** BR-USUARIO-052 item 4.d: refuses with the reason the person reads in the app. */
export async function refusePartnerRequest(
  requestId: number,
  reason: string,
  actor: string
): Promise<DecisionResult<RefusalOutcome>> {
  const { data, error } = await getSupabaseService()
    .schema('drive')
    .rpc('refuse_partner_request_as', { p_request_id: requestId, p_reason: reason, p_actor: actor })
  if (error) {
    console.error('[partner-requests] refuse failed:', error.code)
    return { ok: false, error: failureOf(error) }
  }
  const outcome = readRefusalOutcome(data)
  return outcome ? { ok: true, outcome } : { ok: false, error: 'failed' }
}
