import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { securityLogger } from './security-logger'

export async function withAuth(handler: (req: NextRequest) => Promise<NextResponse>, allowedRoles: string[] = ['admin', 'client']) {
  return async (req: NextRequest) => {
    try {
      console.log('🔐 AUTH MIDDLEWARE: Starting authentication check...')
      
      const supabase = createRouteHandlerClient({ cookies })
      
      const { data: { session }, error } = await supabase.auth.getSession()
      
      console.log('🔐 AUTH MIDDLEWARE: Session check:', {
        hasSession: !!session,
        hasError: !!error,
        error: error?.message,
        userEmail: session?.user?.email
      })
      
      if (error || !session) {
        console.log('❌ AUTH MIDDLEWARE: No authenticated user')
        try {
          await securityLogger.logAuthFailure(req, 'No authenticated user')
        } catch (logError) {
          console.warn('⚠️ AUTH MIDDLEWARE: Failed to log auth failure:', logError)
        }
        return NextResponse.json(
          { error: 'Unauthorized - Authentication required' },
          { status: 401 }
        )
      }

      console.log('✅ AUTH MIDDLEWARE: User authenticated, checking CMS access...')

      // Check if user exists in cms_users table and is authorized
      const { data: cmsUser, error: cmsError } = await supabase
        .schema('core')
        .from('cms_users')
        .select('role, is_active')
        .eq('email', session.user.email)
        .eq('is_active', true)
        .single()

      console.log('🔐 AUTH MIDDLEWARE: CMS user check:', {
        hasCmsUser: !!cmsUser,
        hasError: !!cmsError,
        error: cmsError?.message,
        role: cmsUser?.role,
        isActive: cmsUser?.is_active
      })

      if (cmsError || !cmsUser) {
        console.log('❌ AUTH MIDDLEWARE: CMS access denied')
        try {
          await securityLogger.logAuthFailure(req, 'CMS access denied')
        } catch (logError) {
          console.warn('⚠️ AUTH MIDDLEWARE: Failed to log CMS access denied:', logError)
        }
        return NextResponse.json(
          { error: 'Unauthorized - CMS access denied' },
          { status: 403 }
        )
      }

      // Check if user has one of the allowed roles for this route
      if (!allowedRoles.includes(cmsUser.role)) {
        console.log('❌ AUTH MIDDLEWARE: Insufficient privileges:', cmsUser.role)
        try {
          await securityLogger.logAuthFailure(req, 'Insufficient privileges')
        } catch (logError) {
          console.warn('⚠️ AUTH MIDDLEWARE: Failed to log insufficient privileges:', logError)
        }
        return NextResponse.json(
          { error: 'Unauthorized - Insufficient privileges' },
          { status: 403 }
        )
      }

      console.log('✅ AUTH MIDDLEWARE: Authentication successful, calling handler...')

      // Add user info to request for use in handler
      ;(req as any).user = session.user
      ;(req as any).cmsUser = cmsUser

      const result = await handler(req)
      console.log('✅ AUTH MIDDLEWARE: Handler completed successfully')
      return result
      
    } catch (error) {
      console.error('❌ AUTH MIDDLEWARE: Error:', error)
      console.error('❌ AUTH MIDDLEWARE: Error stack:', error instanceof Error ? error.stack : 'No stack trace')
      try {
        await securityLogger.logAuthFailure(req, `Authentication error: ${error}`)
      } catch (logError) {
        console.warn('⚠️ AUTH MIDDLEWARE: Failed to log authentication error:', logError)
      }
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
      const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown'
      const now = Date.now()
      const windowStart = now - windowMs
      
      if (!rateLimitMap.has(ip)) {
        rateLimitMap.set(ip, [])
      }
      
      const requests = rateLimitMap.get(ip)
      const validRequests = requests.filter((time: number) => time > windowStart)
      
      if (validRequests.length >= maxRequests) {
        try {
          await securityLogger.logRateLimitExceeded(req, maxRequests)
        } catch (logError) {
          console.warn('⚠️ AUTH MIDDLEWARE: Failed to log rate limit exceeded:', logError)
        }
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