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
  const allowedPaths = ['/login', '/client-signup', '/debug', '/unauthorized']
  
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
      // Prefer DB authoritative check, but FALLBACK to session user metadata (app_metadata or user_metadata)
      let cmsUser: any = null
      let cmsLookupError: any = null
      try {
        const ans = await supabase
          .schema('core')
          .from('cms_users')
          .select('id, role, is_active')
          .eq('email', session.user.email)
          .single()
        cmsUser = ans.data
        // If user exists but is not active, treat as no user for non-clients
        // Clients should still be able to access client-scoped pages even if is_active is false
        if (cmsUser && cmsUser.is_active === false && cmsUser.role !== 'client') cmsUser = null
      } catch (err) {
        cmsLookupError = err
        console.warn('MIDDLEWARE: cms_user lookup produced error (will attempt fallback):', err)
      }

      // Extract possible role from session metadata as a fallback
      const sessionUser = session.user
      const metaRole = (sessionUser?.app_metadata && sessionUser?.app_metadata.role) || (sessionUser?.user_metadata && sessionUser?.user_metadata.role) || null
      const metaIsActive = (sessionUser?.app_metadata && (sessionUser.app_metadata.is_active !== undefined ? sessionUser.app_metadata.is_active : true)) || true

      if (!cmsUser) {
        // If DB lookup errored with schema/cache issue -> allow through but mark header
        const errMsg = cmsLookupError?.message || ''
        if (cmsLookupError && (errMsg.includes('Could not find') || errMsg.toLowerCase().includes('address') || cmsLookupError.code === 'PGRST204')) {
          res.headers.set('x-cms-lookup-error', '1')
          // If session metadata indicates role, use it for routing decisions below
          if (metaRole) {
            // attach a lightweight cmsUser-like object for downstream checks
            cmsUser = { id: sessionUser?.id, role: metaRole, is_active: metaIsActive }
            res.headers.set('x-cms-lookup-fallback', 'metadata')
            // continue with cmsUser populated from metadata
          } else {
            // No metadata either: allow login but redirect to unauthorized so user can't access protected pages
            return NextResponse.redirect(new URL('/unauthorized', req.url))
          }
        } else {
          // No DB record found (not admin/client) -> try metadata
          if (metaRole) {
            cmsUser = { id: sessionUser?.id, role: metaRole, is_active: metaIsActive }
            res.headers.set('x-cms-lookup-fallback', 'metadata')
          } else {
            return NextResponse.redirect(new URL('/unauthorized', req.url))
          }
        }
      }

      // Admin users can access everything
      if (isAdmin(cmsUser.role)) {
        return res
      }

      // Client users can access a subset of pages (view POIs and create manual POI)
      if (isClient(cmsUser.role)) {
        const path = req.nextUrl.pathname
        // Allow if path starts with '/pois' or '/clients' or is explicitly in allowed client API list
        if (path.startsWith('/pois') || path.startsWith('/clients') || ALLOWED_CLIENT_PATHS.includes(path)) {
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
    '/((?!api|_next/static|_next/image|favicon.ico|unauthorized|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
} 