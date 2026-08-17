import type { NextRequest } from 'next/server'
import { getSupabase } from '@/lib/core/supabase-client'

export type AuditAction =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILURE'
  | 'PASSWORD_RESET_REQUEST'
  | 'PASSWORD_CHANGE'
  | 'UPDATE_PROFILE'
  | 'CREATE_POI'
  | 'UPDATE_POI'
  | 'DELETE_POI'
  // Hour-credit ledger (epic #283). `core.audit_logs.action` is free text — the only
  // CHECK on the table is on `status` — so a value added here reaches the row as written.
  | 'GRANT_TIME_CREDIT'
  // A period grant is two transactions: the access period committed and the ledger row did
  // not. The right exists with no grant row behind it, so this row is the only record of
  // who applied it — and of the fact that it must not be applied again.
  | 'GRANT_TIME_CREDIT_UNRECORDED'
  | 'REVOKE_TIME_CREDIT'
  // Partnership (#341). Promoting and discarding are irreversible acts of the team over a
  // live record, so each one leaves a row saying who, when and over which proposal.
  | 'PROMOTE_PARTNER_PROPOSAL'
  | 'DISCARD_PARTNER_PROPOSAL'
  | 'RESTORE_PARTNER_PROPOSAL'
  // The conference annotation. It writes no `status` and reaches no client record, and it is
  // audited anyway: it is the write that decides whether a CONTRACT can be produced
  // (BR-B2B-022 through BR-B2B-030), it is an UPDATE that OVERWRITES the previous operator's
  // assertion, and `reviewed_by` on the row only ever names the last one. Without this row
  // the single write that opens the contract door is the one act on the screen with no
  // history — which is what the security review of 2026-08-16 found (M-2).
  | 'REVIEW_PARTNER_PROPOSAL'
  // The place the approval creates (#360). It is a write into a catalogue of 2.2 million rows
  // made by a side-effect and not by the Places screen, so the row that says which approval
  // produced which POI is the only way back from one to the other.
  | 'CREATE_PARTNER_PLACE'
  // The 4 → 5 act of the pipeline (#359), and its reverse. Publishing is what starts the
  // monthly fee of the paid tier (BR-B2B-018, item 1), so "who put this place in front of
  // tourists, and when" is the only record of when money began — the fee itself is frozen on
  // the contract, and nothing on the client record moves when the place goes live.
  | 'PUBLISH_PARTNER_PLACE'
  | 'UNPUBLISH_PARTNER_PLACE'
  // The other outcome of the triage (#377), and the two acts are deliberately two rows.
  // `core.partner_triage_refusals` is append-only and already carries who decided and when, so
  // these rows are not the record of the refusal — they are the record of the DECISION HAVING
  // BEEN TAKEN IN THE CMS, next to the publication it is the alternative to, on the one screen
  // that shows the whole trail. The communication is separate because it is a separate act:
  // BR-B2B-010, item 4, stops the 72h clock at the communication and not at the decision.
  | 'REFUSE_PARTNER_PLACE_AT_TRIAGE'
  | 'COMMUNICATE_PARTNER_PLACE_TRIAGE_REFUSAL'

/**
 * `CLIENT` is the record the promotion writes; `PARTNER_PROPOSAL` is the thing outside the
 * client that the act happened to. Two entities and not one,
 * because "who changed this client" and "what happened to this proposal" are two questions
 * the audit page is asked separately.
 */
export type AuditEntity = 'USER' | 'POI' | 'AUTH' | 'CLIENT' | 'PARTNER_PROPOSAL'

interface AuditLogInput {
  request: NextRequest
  action: AuditAction
  entity: AuditEntity
  description: string
  userId?: string | null
  userEmail?: string | null
  entityId?: string | null
}

const SENSITIVE_PATTERNS = [/password/i, /token/i, /secret/i]

function sanitizeDescription(description: string): string {
  if (!description) return ''
  const hasSensitive = SENSITIVE_PATTERNS.some((pattern) => pattern.test(description))
  return hasSensitive ? 'Sensitive details omitted' : description
}

export function getRequestIp(request: NextRequest): string {
  const cfConnectingIp = request.headers.get('cf-connecting-ip')
  if (cfConnectingIp) return cfConnectingIp

  const forwardedFor = request.headers.get('x-forwarded-for')
  if (forwardedFor) return forwardedFor.split(',')[0].trim()

  const realIp = request.headers.get('x-real-ip')
  if (realIp) return realIp

  return 'unknown'
}

export function getUserAgent(request: NextRequest): string | null {
  return request.headers.get('user-agent') || null
}

/**
 * Centralized audit logger.
 * Errors are swallowed to avoid breaking the main flow.
 */
export async function logAuditEvent(input: AuditLogInput): Promise<void> {
  try {
    const supabase = getSupabase('service')
    await supabase
      .schema('core')
      .from('audit_logs')
      .insert({
        user_id: input.userId ?? null,
        user_email: input.userEmail ?? null,
        action: input.action,
        entity: input.entity,
        entity_id: input.entityId ?? null,
        description: sanitizeDescription(input.description),
        ip_address: getRequestIp(input.request),
        user_agent: getUserAgent(input.request),
        request_ip: getRequestIp(input.request),
        resource_type: input.entity,
        resource_id: input.entityId ?? null
      })
  } catch (error) {
    console.error('Audit log insert failed:', error)
  }
}
