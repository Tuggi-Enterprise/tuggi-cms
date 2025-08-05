import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { securityLogger } from './security-logger'

export async function withAuth(handler: (req: NextRequest) => Promise<NextResponse>) {
  return async (req: NextRequest) => {
    try {
      const supabase = createRouteHandlerClient({ cookies })
      
      const { data: { session }, error } = await supabase.auth.getSession()
      
      if (error || !session) {
        await securityLogger.logAuthFailure(req, 'No authenticated user')
        return NextResponse.json(
          { error: 'Unauthorized - Authentication required' },
          { status: 401 }
        )
      }

      // Check if user exists in cms_users table and is authorized
      const { data: cmsUser, error: cmsError } = await supabase
        .schema('core')
        .from('cms_users')
        .select('role, is_active')
        .eq('email', session.user.email)
        .eq('is_active', true)
        .single()

      if (cmsError || !cmsUser) {
        await securityLogger.logAuthFailure(req, 'CMS access denied')
        return NextResponse.json(
          { error: 'Unauthorized - CMS access denied' },
          { status: 403 }
        )
      }

      // Check if user has admin or editor role
      if (!['admin', 'editor'].includes(cmsUser.role)) {
        await securityLogger.logAuthFailure(req, 'Insufficient privileges')
        return NextResponse.json(
          { error: 'Unauthorized - Insufficient privileges' },
          { status: 403 }
        )
      }

      // Add user info to request for use in handler
      ;(req as any).user = session.user
      ;(req as any).cmsUser = cmsUser

      return handler(req)
    } catch (error) {
      console.error('Auth middleware error:', error)
      await securityLogger.logAuthFailure(req, `Authentication error: ${error}`)
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      )
    }
  }
}

// Rate limiting helper
const rateLimitMap = new Map()

export function withRateLimit(maxRequests: number = 100, windowMs: number = 60000) {
  return (handler: (req: NextRequest) => Promise<NextResponse>) => {
    return async (req: NextRequest) => {
      const ip = req.ip || req.headers.get('x-forwarded-for') || 'unknown'
      const now = Date.now()
      const windowStart = now - windowMs
      
      if (!rateLimitMap.has(ip)) {
        rateLimitMap.set(ip, [])
      }
      
      const requests = rateLimitMap.get(ip)
      const validRequests = requests.filter((time: number) => time > windowStart)
      
      if (validRequests.length >= maxRequests) {
        await securityLogger.logRateLimitExceeded(req, maxRequests)
        return NextResponse.json(
          { error: 'Too many requests' },
          { status: 429 }
        )
      }
      
      validRequests.push(now)
      rateLimitMap.set(ip, validRequests)
      
      return handler(req)
    }
  }
}