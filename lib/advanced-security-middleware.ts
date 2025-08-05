import { NextRequest, NextResponse } from 'next/server'
import { securityMonitor } from './security-monitor'
import { securityLogger } from './security-logger'
import { InputValidator } from './input-validation'

export interface SecurityConfig {
  enableIPBlocking?: boolean
  enableSuspiciousActivityDetection?: boolean
  enableRequestAnalysis?: boolean
  maxRequestSize?: number // in bytes
  allowedMethods?: string[]
  requireHTTPS?: boolean
}

const defaultConfig: SecurityConfig = {
  enableIPBlocking: true,
  enableSuspiciousActivityDetection: true,
  enableRequestAnalysis: true,
  maxRequestSize: 10 * 1024 * 1024, // 10MB
  allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  requireHTTPS: process.env.NODE_ENV === 'production'
}

export function withAdvancedSecurity(config: SecurityConfig = {}) {
  const finalConfig = { ...defaultConfig, ...config }
  
  return function(handler: (req: NextRequest) => Promise<NextResponse>) {
    return async function(request: NextRequest): Promise<NextResponse> {
      try {
        // 1. HTTPS enforcement
        if (finalConfig.requireHTTPS && request.nextUrl.protocol !== 'https:') {
          await securityLogger.logSuspiciousActivity(
            request,
            'HTTP request to HTTPS-only endpoint'
          )
          return NextResponse.json(
            { error: 'HTTPS required' },
            { status: 400 }
          )
        }
        
        // 2. Method validation
        if (!finalConfig.allowedMethods?.includes(request.method)) {
          await securityLogger.logSuspiciousActivity(
            request,
            `Disallowed HTTP method: ${request.method}`
          )
          return NextResponse.json(
            { error: 'Method not allowed' },
            { status: 405 }
          )
        }
        
        // 3. Request size validation
        const contentLength = request.headers.get('content-length')
        if (contentLength && parseInt(contentLength) > finalConfig.maxRequestSize!) {
          await securityLogger.logSuspiciousActivity(
            request,
            `Request too large: ${contentLength} bytes`
          )
          return NextResponse.json(
            { error: 'Request too large' },
            { status: 413 }
          )
        }
        
        // 4. IP blocking check
        if (finalConfig.enableIPBlocking) {
          const clientIP = getClientIP(request)
          if (securityMonitor.isIPBlocked(clientIP)) {
            await securityLogger.logSuspiciousActivity(
              request,
              `Blocked IP attempted access: ${clientIP}`
            )
            return NextResponse.json(
              { error: 'Access denied' },
              { status: 403 }
            )
          }
        }
        
        // 5. Request analysis
        if (finalConfig.enableRequestAnalysis) {
          const analysis = await securityMonitor.analyzeRequest(request)
          
          if (analysis.shouldBlock) {
            return NextResponse.json(
              { error: 'Request blocked by security analysis' },
              { status: 403 }
            )
          }
          
          if (analysis.riskLevel === 'high' || analysis.riskLevel === 'critical') {
            await securityLogger.logSuspiciousActivity(
              request,
              `High-risk request detected: ${analysis.reasons.join(', ')}`
            )
          }
        }
        
        // 6. Content-Type validation for POST/PUT/PATCH
        if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
          const contentType = request.headers.get('content-type')
          if (!contentType) {
            await securityLogger.logSuspiciousActivity(
              request,
              'Missing Content-Type header for body request'
            )
            return NextResponse.json(
              { error: 'Content-Type header required' },
              { status: 400 }
            )
          }
          
          // Only allow specific content types
          const allowedContentTypes = [
            'application/json',
            'application/x-www-form-urlencoded',
            'multipart/form-data'
          ]
          
          if (!allowedContentTypes.some(type => contentType.includes(type))) {
            await securityLogger.logSuspiciousActivity(
              request,
              `Disallowed Content-Type: ${contentType}`
            )
            return NextResponse.json(
              { error: 'Unsupported Content-Type' },
              { status: 415 }
            )
          }
        }
        
        // 7. Header injection protection
        const suspiciousHeaders = detectSuspiciousHeaders(request.headers)
        if (suspiciousHeaders.length > 0) {
          await securityLogger.logSuspiciousActivity(
            request,
            `Suspicious headers detected: ${suspiciousHeaders.join(', ')}`
          )
        }
        
        // 8. SQL injection detection in URL parameters
        const sqlInjectionDetected = detectSQLInjection(request.nextUrl.searchParams)
        if (sqlInjectionDetected.length > 0) {
          await securityLogger.logSuspiciousActivity(
            request,
            `Potential SQL injection in parameters: ${sqlInjectionDetected.join(', ')}`
          )
          return NextResponse.json(
            { error: 'Invalid request parameters' },
            { status: 400 }
          )
        }
        
        // 9. XSS detection in URL parameters
        const xssDetected = detectXSS(request.nextUrl.searchParams)
        if (xssDetected.length > 0) {
          await securityLogger.logSuspiciousActivity(
            request,
            `Potential XSS in parameters: ${xssDetected.join(', ')}`
          )
          return NextResponse.json(
            { error: 'Invalid request parameters' },
            { status: 400 }
          )
        }
        
        // 10. Execute the handler with security headers
        const response = await handler(request)
        
        // Add security headers to response
        addSecurityHeaders(response)
        
        return response
        
      } catch (error) {
        await securityLogger.logSecurityEvent({
          event_type: 'api_error',
          ip_address: getClientIP(request),
          endpoint: request.nextUrl.pathname,
          details: { error: String(error) },
          severity: 'high'
        })
        
        return NextResponse.json(
          { error: 'Internal server error' },
          { status: 500 }
        )
      }
    }
  }
}

function getClientIP(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for')
  const realIP = request.headers.get('x-real-ip')
  const cfConnectingIP = request.headers.get('cf-connecting-ip')
  
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

function detectSuspiciousHeaders(headers: Headers): string[] {
  const suspicious: string[] = []
  
  // Check for header injection attempts
  for (const [name, value] of headers.entries()) {
    if (value.includes('\n') || value.includes('\r')) {
      suspicious.push(`${name}: header injection attempt`)
    }
    
    // Check for suspicious header names
    if (name.toLowerCase().includes('script') || name.toLowerCase().includes('eval')) {
      suspicious.push(`${name}: suspicious header name`)
    }
  }
  
  return suspicious
}

function detectSQLInjection(searchParams: URLSearchParams): string[] {
  const sqlPatterns = [
    /('|(\-\-)|(;)|(\||\|)|(\*|\*))/i,
    /(union|select|insert|delete|update|drop|create|alter|exec|execute)/i,
    /(script|javascript|vbscript|onload|onerror|onclick)/i,
    /(\<|\>|\"|\'|\%|\;|\(|\)|\&|\+)/
  ]
  
  const suspicious: string[] = []
  
  for (const [key, value] of searchParams.entries()) {
    for (const pattern of sqlPatterns) {
      if (pattern.test(value)) {
        suspicious.push(`${key}=${value}`)
        break
      }
    }
  }
  
  return suspicious
}

function detectXSS(searchParams: URLSearchParams): string[] {
  const xssPatterns = [
    /<script[^>]*>.*?<\/script>/gi,
    /<iframe[^>]*>.*?<\/iframe>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi,
    /<img[^>]+src[^>]*>/gi,
    /<object[^>]*>.*?<\/object>/gi
  ]
  
  const suspicious: string[] = []
  
  for (const [key, value] of searchParams.entries()) {
    for (const pattern of xssPatterns) {
      if (pattern.test(value)) {
        suspicious.push(`${key}=${value}`)
        break
      }
    }
  }
  
  return suspicious
}

function addSecurityHeaders(response: NextResponse): void {
  // Prevent clickjacking
  response.headers.set('X-Frame-Options', 'DENY')
  
  // Prevent MIME type sniffing
  response.headers.set('X-Content-Type-Options', 'nosniff')
  
  // Enable XSS protection
  response.headers.set('X-XSS-Protection', '1; mode=block')
  
  // Referrer policy
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  
  // Permissions policy
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  
  // Content Security Policy (basic)
  response.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:;"
  )
  
  // Remove server information
  response.headers.delete('Server')
  response.headers.delete('X-Powered-By')
}