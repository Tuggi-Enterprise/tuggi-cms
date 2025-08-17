import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextRequest } from 'next/server'

export interface SecurityEvent {
  event_type: 'auth_failure' | 'rate_limit_exceeded' | 'suspicious_activity' | 'unauthorized_access' | 'api_error'
  ip_address?: string
  user_agent?: string
  endpoint?: string
  user_id?: string
  details?: Record<string, any>
  severity: 'low' | 'medium' | 'high' | 'critical'
}

export class SecurityLogger {
  private static instance: SecurityLogger
  
  private constructor() {}
  
  static getInstance(): SecurityLogger {
    if (!SecurityLogger.instance) {
      SecurityLogger.instance = new SecurityLogger()
    }
    return SecurityLogger.instance
  }
  
  async logSecurityEvent(event: SecurityEvent): Promise<void> {
    try {
      // Log to console in development
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[SECURITY] ${event.event_type}:`, event)
      }
      
      // In production, you would send this to a security monitoring service
      // For now, we'll store in a simple log format
      const timestamp = new Date().toISOString()
      const logEntry = {
        timestamp,
        ...event
      }
      
      // TODO: Implement proper security logging service integration
      // Examples: Datadog, Sentry, CloudWatch, etc.
      
    } catch (error) {
      console.error('Failed to log security event:', error)
    }
  }
  
  async logAuthFailure(req: NextRequest, reason: string): Promise<void> {
    await this.logSecurityEvent({
      event_type: 'auth_failure',
      ip_address: this.getClientIP(req),
      user_agent: req.headers.get('user-agent') || undefined,
      endpoint: req.nextUrl.pathname,
      details: { reason },
      severity: 'medium'
    })
  }
  
  async logRateLimitExceeded(req: NextRequest, limit: number): Promise<void> {
    await this.logSecurityEvent({
      event_type: 'rate_limit_exceeded',
      ip_address: this.getClientIP(req),
      user_agent: req.headers.get('user-agent') || undefined,
      endpoint: req.nextUrl.pathname,
      details: { limit },
      severity: 'high'
    })
  }
  
  async logUnauthorizedAccess(req: NextRequest, userId?: string): Promise<void> {
    await this.logSecurityEvent({
      event_type: 'unauthorized_access',
      ip_address: this.getClientIP(req),
      user_agent: req.headers.get('user-agent') || undefined,
      endpoint: req.nextUrl.pathname,
      user_id: userId,
      severity: 'high'
    })
  }
  
  async logSuspiciousActivity(req: NextRequest, activity: string, userId?: string): Promise<void> {
    await this.logSecurityEvent({
      event_type: 'suspicious_activity',
      ip_address: this.getClientIP(req),
      user_agent: req.headers.get('user-agent') || undefined,
      endpoint: req.nextUrl.pathname,
      user_id: userId,
      details: { activity },
      severity: 'critical'
    })
  }
  
  private getClientIP(req: NextRequest): string {
    // Try to get real IP from various headers
    const forwarded = req.headers.get('x-forwarded-for')
    const realIP = req.headers.get('x-real-ip')
    const cfConnectingIP = req.headers.get('cf-connecting-ip')
    
    if (forwarded) {
      return forwarded.split(',')[0].trim()
    }
    if (realIP) {
      return realIP
    }
    if (cfConnectingIP) {
      return cfConnectingIP
    }
    
    return 'unknown'
  }
}

export const securityLogger = SecurityLogger.getInstance()