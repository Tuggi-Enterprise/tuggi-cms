import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { isAdmin, isClient, ALLOWED_CLIENT_PATHS } from './lib/roles'

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()
  const supabase = createMiddlewareClient({ req, res })

  console.log('🔍 MIDDLEWARE: Processing request for:', req.nextUrl.pathname)

  const {
    data: { session },
  } = await supabase.auth.getSession()

  console.log('🔍 MIDDLEWARE: Session check:', {
    hasSession: !!session,
    userEmail: session?.user?.email,
    path: req.nextUrl.pathname
  })

  // Allow access to debug page, login, and unauthorized pages
  const allowedPaths = ['/login', '/debug', '/unauthorized']
  
  // Protect all routes except allowed paths
  if (!session && !allowedPaths.includes(req.nextUrl.pathname)) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  // Redirect to dashboard if logged in and trying to access login
  if (session && req.nextUrl.pathname === '/login') {
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }

  // Check CMS user authorization for protected routes
  if (session && !allowedPaths.includes(req.nextUrl.pathname)) {
    try {
      // Check if user exists in cms_users table and is authorized
      const { data: cmsUser, error } = await supabase
        .schema('core')
        .from('cms_users')
        .select('role, is_active')
        .eq('email', session.user.email)
        .eq('is_active', true)
        .single()

      if (error || !cmsUser) {
        return NextResponse.redirect(new URL('/unauthorized', req.url))
      }

      // Admin users can access everything
      if (isAdmin(cmsUser.role)) {
        return res
      }

      // Client users can access a subset of pages (view POIs and create manual POI)
      if (isClient(cmsUser.role)) {
        const path = req.nextUrl.pathname
        // Allow if path starts with '/pois' or is in allowed client API list
        if (path.startsWith('/pois') || ALLOWED_CLIENT_PATHS.includes(path)) {
          return res
        }
        return NextResponse.redirect(new URL('/unauthorized', req.url))
      }

      // Other/unknown roles => unauthorized
      return NextResponse.redirect(new URL('/unauthorized', req.url))
    } catch (error) {
      console.error('Middleware authorization error:', error)
      return NextResponse.redirect(new URL('/unauthorized', req.url))
    }
  }

  return res
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|unauthorized).*)',
  ],
} 