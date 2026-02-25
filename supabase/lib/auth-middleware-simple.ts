import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export async function withAuth(handler: (req: NextRequest) => Promise<NextResponse>, allowedRoles: string[] = ['admin', 'client', 'editor']) {
  return async (req: NextRequest) => {
    try {
      console.log('🔐 SIMPLE AUTH: Starting authentication check...')
      
      const supabase = createRouteHandlerClient({ cookies })
      
      const { data: { session }, error } = await supabase.auth.getSession()
      
      console.log('🔐 SIMPLE AUTH: Session check:', {
        hasSession: !!session,
        hasError: !!error,
        error: error?.message,
        userEmail: session?.user?.email
      })
      
      if (error || !session) {
        console.log('❌ SIMPLE AUTH: No authenticated user')
        return NextResponse.json(
          { error: 'Unauthorized - Authentication required' },
          { status: 401 }
        )
      }

      console.log('✅ SIMPLE AUTH: User authenticated, checking CMS access...')

      // Check if user exists in cms_users table and is authorized
      const { data: cmsUser, error: cmsError } = await supabase
        .schema('core')
        .from('cms_users')
        .select('role, is_active')
        .eq('email', session.user.email)
        .eq('is_active', true)
        .single()

      console.log('🔐 SIMPLE AUTH: CMS user check:', {
        hasCmsUser: !!cmsUser,
        hasError: !!cmsError,
        error: cmsError?.message,
        role: cmsUser?.role,
        isActive: cmsUser?.is_active
      })

      if (cmsError || !cmsUser) {
        console.log('❌ SIMPLE AUTH: CMS access denied')
        return NextResponse.json(
          { error: 'Unauthorized - CMS access denied' },
          { status: 403 }
        )
      }

      // Check if user has one of the allowed roles for this route
      if (!allowedRoles.includes(cmsUser.role)) {
        console.log('❌ SIMPLE AUTH: Insufficient privileges:', cmsUser.role)
        return NextResponse.json(
          { error: 'Unauthorized - Insufficient privileges' },
          { status: 403 }
        )
      }

      console.log('✅ SIMPLE AUTH: Authentication successful, calling handler...')

      // Add user info to request for use in handler
      ;(req as any).user = session.user
      ;(req as any).cmsUser = cmsUser

      return handler(req)
    } catch (error) {
      console.error('❌ SIMPLE AUTH: Error:', error)
      console.error('❌ SIMPLE AUTH: Error stack:', error instanceof Error ? error.stack : 'No stack trace')
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
        console.log('❌ SIMPLE AUTH: Rate limit exceeded for IP:', ip)
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
