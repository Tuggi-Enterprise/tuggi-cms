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
  // `CREATE_PARTNER_INVITE` is the act that mints a credential for somebody outside; the
  // description never carries the token, and `sanitizeDescription` would drop it anyway.
  | 'CREATE_PARTNER_INVITE'
  | 'REVOKE_PARTNER_INVITE'
  | 'PROMOTE_PARTNER_PROPOSAL'
  | 'DISCARD_PARTNER_PROPOSAL'
  | 'RESTORE_PARTNER_PROPOSAL'

/**
 * `CLIENT` is the record the promotion writes; `PARTNER_PROPOSAL` is the thing outside the
 * client that the act happened to (the proposal, the invite). Two entities and not one,
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
