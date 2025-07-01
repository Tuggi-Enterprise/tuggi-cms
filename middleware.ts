import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()
  const supabase = createMiddlewareClient({ req, res })

  const {
    data: { session },
  } = await supabase.auth.getSession()

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

      // Check if user has admin or editor role
      if (!['admin', 'editor'].includes(cmsUser.role)) {
        return NextResponse.redirect(new URL('/unauthorized', req.url))
      }
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