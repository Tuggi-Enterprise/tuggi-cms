/**
 * Audit Logging Module
 * 
 * Centralized audit trail for all sensitive operations
 * Logs user actions, timestamps, and operation details for compliance and security monitoring
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ============================================
// TYPES
// ============================================

export type AuditAction = 
  | 'create_poi'
  | 'update_poi'
  | 'delete_poi'
  | 'generate_description'
  | 'generate_audio'
  | 'generate_trigger_points'
  | 'correct_city'
  | 'store_image'
  | 'store_audio'
  | 'verify_batch'
  | 'extract_images'
  | 'process_images'
  | 'api_call'
  | 'api_error';

export type AuditStatus = 'success' | 'failure' | 'partial';

export interface AuditLogEntry {
  user_id: string;
  action: AuditAction;
  resource_type: string; // 'poi', 'image', 'audio', 'batch', etc.
  resource_id: string; // ID of affected resource
  status: AuditStatus;
  details: Record<string, any>;
  error_message?: string;
  request_ip: string;
  user_agent?: string;
  created_at?: string;
}

export interface AuditLogResult {
  success: boolean;
  log_id?: string;
  error?: string;
}

// ============================================
// AUDIT LOGGER CLASS
// ============================================

export class AuditLogger {
  private supabase: any;
  private functionName: string;

  constructor(functionName: string) {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || 
                          Deno.env.get('SERVICE_ROLE_KEY') || '';

    this.supabase = createClient(supabaseUrl, serviceRoleKey);
    this.functionName = functionName;
  }

  /**
   * Extract client IP from request headers
   * Supports multiple proxy formats
   */
  private extractClientIp(req: Request): string {
    const cfConnectingIp = req.headers.get('CF-Connecting-IP');
    if (cfConnectingIp) return cfConnectingIp;

    const xForwardedFor = req.headers.get('X-Forwarded-For');
    if (xForwardedFor) return xForwardedFor.split(',')[0].trim();

    const xRealIp = req.headers.get('X-Real-IP');
    if (xRealIp) return xRealIp;

    return 'unknown';
  }

  /**
   * Extract user ID from JWT token in Authorization header
   */
  private extractUserId(req: Request): string {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return 'anonymous';
    }

    try {
      const token = authHeader.substring(7);
      // Decode JWT payload (without verification - we already validated auth)
      const parts = token.split('.');
      if (parts.length !== 3) return 'unknown';

      const payload = JSON.parse(
        new TextDecoder().decode(
          Uint8Array.from(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
        )
      );

      return payload.sub || payload.user_id || 'unknown';
    } catch (error) {
      console.warn('[AuditLogger] Failed to extract user ID from token:', error);
      return 'unknown';
    }
  }

  /**
   * Log an operation
   */
  async log(
    req: Request,
    entry: Omit<AuditLogEntry, 'user_id' | 'request_ip' | 'timestamp'>
  ): Promise<AuditLogResult> {
    try {
      const userId = this.extractUserId(req);
      const clientIp = this.extractClientIp(req);
      const userAgent = req.headers.get('User-Agent') || undefined;

      const logEntry = {
        ...entry,
        user_id: userId,
        request_ip: clientIp,
        user_agent: userAgent,
        created_at: new Date().toISOString(),
      };

      // Log to console for real-time debugging
      console.log(`[${this.functionName}] 📋 Audit: ${entry.action} on ${entry.resource_type}/${entry.resource_id} - ${entry.status}`);

      // Insert into audit_logs table
      const { data, error } = await this.supabase
        .schema('core')
        .from('audit_logs')
        .insert([logEntry])
        .select('id');

      if (error) {
        console.error(`[${this.functionName}] ❌ Failed to log audit entry:`, error);
        // Don't fail the request if audit logging fails
        return { success: false, error: error.message };
      }

      return {
        success: true,
        log_id: data?.[0]?.id,
      };
    } catch (error) {
      console.error(`[${this.functionName}] ❌ Audit logging error:`, error);
      // Don't fail the request if audit logging fails
      return { success: false, error: String(error) };
    }
  }

  /**
   * Log a successful operation
   */
  async logSuccess(
    req: Request,
    action: AuditAction,
    resourceType: string,
    resourceId: string,
    details: Record<string, any> = {}
  ): Promise<AuditLogResult> {
    return this.log(req, {
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      status: 'success',
      details: {
        function: this.functionName,
        ...details,
      },
    });
  }

  /**
   * Log a failed operation
   */
  async logFailure(
    req: Request,
    action: AuditAction,
    resourceType: string,
    resourceId: string,
    error: string,
    details: Record<string, any> = {}
  ): Promise<AuditLogResult> {
    return this.log(req, {
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      status: 'failure',
      error_message: error,
      details: {
        function: this.functionName,
        ...details,
      },
    });
  }

  /**
   * Log a partial operation (some items succeeded, some failed)
   */
  async logPartial(
    req: Request,
    action: AuditAction,
    resourceType: string,
    resourceId: string,
    successCount: number,
    failureCount: number,
    details: Record<string, any> = {}
  ): Promise<AuditLogResult> {
    return this.log(req, {
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      status: 'partial',
      details: {
        function: this.functionName,
        success_count: successCount,
        failure_count: failureCount,
        ...details,
      },
    });
  }

  /**
   * Log API call metrics
   */
  async logApiCall(
    req: Request,
    endpoint: string,
    statusCode: number,
    duration_ms: number,
    details: Record<string, any> = {}
  ): Promise<AuditLogResult> {
    return this.log(req, {
      action: statusCode >= 400 ? 'api_error' : 'api_call',
      resource_type: 'api',
      resource_id: endpoint,
      status: statusCode >= 400 ? 'failure' : 'success',
      error_message: statusCode >= 400 ? `HTTP ${statusCode}` : undefined,
      details: {
        function: this.functionName,
        status_code: statusCode,
        duration_ms,
        ...details,
      },
    });
  }
}

// ============================================
// HELPER FUNCTION
// ============================================

/**
 * Create audit logger instance
 */
export function createAuditLogger(functionName: string): AuditLogger {
  return new AuditLogger(functionName);
}
