import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()
  const supabase = createMiddlewareClient({ req, res })

  const {
    data: { session },
  } = await supabase.auth.getSession()

  // Allow access to debug page when logged in
  const allowedPaths = ['/login', '/debug', '/unauthorized']
  
  // Protect all routes except allowed paths
  if (!session && !allowedPaths.includes(req.nextUrl.pathname)) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  // Redirect to dashboard if logged in and trying to access login
  if (session && req.nextUrl.pathname === '/login') {
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }

  // Check admin role for protected routes (except debug and unauthorized)
  if (session && !allowedPaths.includes(req.nextUrl.pathname)) {
    // Get user role from session metadata
    const userRole = session.user.user_metadata?.role || session.user.app_metadata?.role

    if (userRole !== 'admin') {
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