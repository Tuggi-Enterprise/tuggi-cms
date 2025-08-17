import { securityLogger } from './security-logger'
import { NextRequest } from 'next/server'

interface SecurityMetrics {
  failedLogins: Map<string, { count: number; lastAttempt: Date }>
  rateLimitViolations: Map<string, { count: number; lastViolation: Date }>
  suspiciousIPs: Set<string>
  blockedIPs: Set<string>
}

export class SecurityMonitor {
  private static instance: SecurityMonitor
  private metrics: SecurityMetrics
  private readonly MAX_FAILED_LOGINS = 5
  private readonly MAX_RATE_LIMIT_VIOLATIONS = 3
  private readonly BLOCK_DURATION = 15 * 60 * 1000 // 15 minutes
  private readonly CLEANUP_INTERVAL = 60 * 60 * 1000 // 1 hour
  
  private constructor() {
    this.metrics = {
      failedLogins: new Map(),
      rateLimitViolations: new Map(),
      suspiciousIPs: new Set(),
      blockedIPs: new Set()
    }
    
    // Start cleanup interval
    setInterval(() => this.cleanupOldEntries(), this.CLEANUP_INTERVAL)
  }
  
  static getInstance(): SecurityMonitor {
    if (!SecurityMonitor.instance) {
      SecurityMonitor.instance = new SecurityMonitor()
    }
    return SecurityMonitor.instance
  }
  
  async recordFailedLogin(ip: string, req: NextRequest): Promise<boolean> {
    const current = this.metrics.failedLogins.get(ip) || { count: 0, lastAttempt: new Date() }
    current.count++
    current.lastAttempt = new Date()
    this.metrics.failedLogins.set(ip, current)
    
    if (current.count >= this.MAX_FAILED_LOGINS) {
      this.metrics.suspiciousIPs.add(ip)
      await securityLogger.logSuspiciousActivity(
        req,
        `Multiple failed login attempts from IP: ${ip} (${current.count} attempts)`
      )
      
      if (current.count >= this.MAX_FAILED_LOGINS * 2) {
        this.metrics.blockedIPs.add(ip)
        await securityLogger.logSuspiciousActivity(
          req,
          `IP blocked due to excessive failed logins: ${ip}`,
          undefined
        )
        return true // IP should be blocked
      }
    }
    
    return false
  }
  
  async recordRateLimitViolation(ip: string, req: NextRequest): Promise<boolean> {
    const current = this.metrics.rateLimitViolations.get(ip) || { count: 0, lastViolation: new Date() }
    current.count++
    current.lastViolation = new Date()
    this.metrics.rateLimitViolations.set(ip, current)
    
    if (current.count >= this.MAX_RATE_LIMIT_VIOLATIONS) {
      this.metrics.suspiciousIPs.add(ip)
      await securityLogger.logSuspiciousActivity(
        req,
        `Multiple rate limit violations from IP: ${ip} (${current.count} violations)`
      )
      
      if (current.count >= this.MAX_RATE_LIMIT_VIOLATIONS * 2) {
        this.metrics.blockedIPs.add(ip)
        await securityLogger.logSuspiciousActivity(
          req,
          `IP blocked due to excessive rate limit violations: ${ip}`,
          undefined
        )
        return true // IP should be blocked
      }
    }
    
    return false
  }
  
  isIPBlocked(ip: string): boolean {
    return this.metrics.blockedIPs.has(ip)
  }
  
  isIPSuspicious(ip: string): boolean {
    return this.metrics.suspiciousIPs.has(ip)
  }
  
  async analyzeRequest(req: NextRequest): Promise<{ 
    shouldBlock: boolean
    riskLevel: 'low' | 'medium' | 'high' | 'critical'
    reasons: string[]
  }> {
    const ip = this.getClientIP(req)
    const userAgent = req.headers.get('user-agent') || ''
    const reasons: string[] = []
    let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low'
    
    // Check if IP is already blocked
    if (this.isIPBlocked(ip)) {
      return {
        shouldBlock: true,
        riskLevel: 'critical',
        reasons: ['IP is blocked due to previous violations']
      }
    }
    
    // Check for suspicious patterns
    if (this.isIPSuspicious(ip)) {
      riskLevel = 'high'
      reasons.push('IP has been flagged as suspicious')
    }
    
    // Analyze user agent
    if (!userAgent || userAgent.length < 10) {
      riskLevel = 'medium'
      reasons.push('Missing or suspicious user agent')
    }
    
    // Check for bot-like user agents
    const botPatterns = [
      /bot/i, /crawler/i, /spider/i, /scraper/i,
      /curl/i, /wget/i, /python/i, /java/i
    ]
    
    if (botPatterns.some(pattern => pattern.test(userAgent))) {
      riskLevel = 'medium'
      reasons.push('Bot-like user agent detected')
    }
    
    // Check for suspicious headers
    const suspiciousHeaders = [
      'x-forwarded-for',
      'x-real-ip',
      'x-originating-ip'
    ]
    
    let forwardedCount = 0
    suspiciousHeaders.forEach(header => {
      if (req.headers.get(header)) {
        forwardedCount++
      }
    })
    
    if (forwardedCount > 2) {
      riskLevel = 'medium'
      reasons.push('Multiple forwarding headers detected')
    }
    
    // Check request frequency
    const failedLogins = this.metrics.failedLogins.get(ip)
    const rateLimitViolations = this.metrics.rateLimitViolations.get(ip)
    
    if (failedLogins && failedLogins.count > 2) {
      riskLevel = 'high'
      reasons.push(`${failedLogins.count} failed login attempts`)
    }
    
    if (rateLimitViolations && rateLimitViolations.count > 1) {
      riskLevel = 'high'
      reasons.push(`${rateLimitViolations.count} rate limit violations`)
    }
    
    return {
      shouldBlock: false,
      riskLevel,
      reasons
    }
  }
  
  private getClientIP(req: NextRequest): string {
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
  
  private cleanupOldEntries(): void {
    const now = new Date()
    const cutoff = new Date(now.getTime() - this.BLOCK_DURATION)
    
    // Clean up old failed login attempts
    for (const [ip, data] of this.metrics.failedLogins.entries()) {
      if (data.lastAttempt < cutoff) {
        this.metrics.failedLogins.delete(ip)
        this.metrics.suspiciousIPs.delete(ip)
      }
    }
    
    // Clean up old rate limit violations
    for (const [ip, data] of this.metrics.rateLimitViolations.entries()) {
      if (data.lastViolation < cutoff) {
        this.metrics.rateLimitViolations.delete(ip)
      }
    }
    
    // Unblock IPs after block duration
    // Note: In a production environment, you might want to persist blocked IPs
    // and have a more sophisticated unblocking mechanism
  }
  
  getSecurityMetrics(): {
    failedLoginAttempts: number
    rateLimitViolations: number
    suspiciousIPs: number
    blockedIPs: number
  } {
    return {
      failedLoginAttempts: this.metrics.failedLogins.size,
      rateLimitViolations: this.metrics.rateLimitViolations.size,
      suspiciousIPs: this.metrics.suspiciousIPs.size,
      blockedIPs: this.metrics.blockedIPs.size
    }
  }
}

export const securityMonitor = SecurityMonitor.getInstance()