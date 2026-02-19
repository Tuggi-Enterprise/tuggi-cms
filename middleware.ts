import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import createMiddleware from 'next-intl/middleware';
import { isAdmin, isClient, ALLOWED_CLIENT_PATHS } from './lib/roles'

import { routing } from './navigation';

const intlMiddleware = createMiddleware(routing);

export async function middleware(req: NextRequest) {
  // 1. Run next-intl middleware first to handle locale resolution and redirects
  // This will rewrite /dashboard to /en/dashboard (or similar)
  const intlResponse = intlMiddleware(req);

  // If next-intl returned a redirect (e.g. root to /en), we return it immediately
  if (intlResponse.status === 307 || intlResponse.status === 308) {
     return intlResponse;
  }

  // 2. Setup Supabase Auth
  // We need to pass the request and response to Supabase to manage cookies
  const res = intlResponse; // Use the response from intl middleware as base
  const supabase = createMiddlewareClient({ req, res })

  // 3. Auth Logic
  const {
    data: { session },
  } = await supabase.auth.getSession()

  // Extract locale from path to construct correct redirect URLs
  // Path is like /en/dashboard or /pt/login
  const pathname = req.nextUrl.pathname;
  const match = pathname.match(/^\/(en|pt|es)(\/.*)?$/);

  // If URL is missing locale prefix, redirect to default locale (/en)
  // - skip api/_next and file-like paths
  // - keep same pathname so direct links without locale continue to work
  if (!match && pathname !== '/' && !pathname.startsWith('/api') && !pathname.startsWith('/_next') && !pathname.includes('.')) {
    return NextResponse.redirect(new URL(`/en${pathname}`, req.url));
  }

  const locale = match ? match[1] : 'en'; // Default fallback
  const pathWithoutLocale = match ? (match[2] || '/') : pathname;

  // Define paths that don't need auth (but might need locale)
  // Note: These must match the locale-prefixed structure or be generic
  // Since we are inside the middleware, req.nextUrl.pathname already includes locale if resolved
  
  // Clean path for checking allowed lists
  const isPublicPath = 
    pathWithoutLocale === '/login' || 
    pathWithoutLocale === '/client-signup' || 
    pathWithoutLocale === '/debug' || 
    pathWithoutLocale === '/unauthorized';

  // Protect routes
  if (!session && !isPublicPath) {
    // Redirect to login preserving locale
    return NextResponse.redirect(new URL(`/${locale}/login`, req.url));
  }

  // Redirect to dashboard if logged in and trying to access login
  if (session && pathWithoutLocale === '/login') {
    return NextResponse.redirect(new URL(`/${locale}/dashboard`, req.url));
  }

  // 4. Role Authorization (if logged in and not on public path)
  if (session && !isPublicPath) {
    try {
      let cmsUser: any = null
      try {
        const ans = await supabase
          .schema('core')
          .from('cms_users')
          .select('id, role, is_active')
          .eq('email', session.user.email)
          .single()
        cmsUser = ans.data
        if (cmsUser && cmsUser.is_active === false && cmsUser.role !== 'client') cmsUser = null
      } catch (err) {
        console.warn('Middleware: CMS user lookup error', err)
      }

      // Fallback to metadata
      if (!cmsUser) {
        const sessionUser = session.user
        const metaRole = (sessionUser?.app_metadata?.role) || (sessionUser?.user_metadata?.role)
        if (metaRole) {
           cmsUser = { id: sessionUser.id, role: metaRole, is_active: true }
        } else {
           return NextResponse.redirect(new URL(`/${locale}/unauthorized`, req.url))
        }
      }

      // Admin check
      if (isAdmin(cmsUser.role)) {
        return res;
      }

      // Client check
      if (isClient(cmsUser.role)) {
        // Check allowed paths for client
        if (pathWithoutLocale.startsWith('/pois') || pathWithoutLocale.startsWith('/clients') || ALLOWED_CLIENT_PATHS.includes(pathWithoutLocale)) {
          return res;
        }
        return NextResponse.redirect(new URL(`/${locale}/unauthorized`, req.url));
      }

      return NextResponse.redirect(new URL(`/${locale}/unauthorized`, req.url));

    } catch (error) {
      console.error('Middleware authorization error:', error)
      return NextResponse.redirect(new URL(`/${locale}/unauthorized`, req.url));
    }
  }

  return res
}

export const config = {
  // Match only internationalized pathnames
  matcher: ['/', '/(en|pt|es)/:path*', '/((?!api|_next|_vercel|.*\\..*).*)']
};