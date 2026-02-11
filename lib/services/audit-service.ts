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

export type AuditEntity = 'USER' | 'POI' | 'AUTH'

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
