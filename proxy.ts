import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import createMiddleware from 'next-intl/middleware';
import { isAdmin, isClient, isPublicPath, ALLOWED_CLIENT_PATHS } from './lib/roles'
import { MODULES, isModuleEnabled, type ModuleId } from './lib/modules'

import { routing } from './navigation';

const intlMiddleware = createMiddleware(routing);

export async function proxy(req: NextRequest) {
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
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '',
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (cookiesToSet: { name: string; value: string; options?: any }[]) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            req.cookies.set(name, value)
            res.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  // 3. Auth Logic — getUser() revalidates the JWT with the Auth server; getSession() only
  // decodes the cookie locally and must not be trusted in server code (middleware).
  const {
    data: { user },
  } = await supabase.auth.getUser()

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

  // Which pages need no session is decided in `lib/roles.ts` and nowhere else — this file
  // used to carry its own list, and the two token pages of #341/#342 that exist for people
  // WITHOUT a CMS account were missing from it.
  const isPublic = isPublicPath(pathWithoutLocale);

  // Protect routes
  if (!user && !isPublic) {
    // Redirect to login preserving locale
    return NextResponse.redirect(new URL(`/${locale}/login`, req.url));
  }

  // Redirect to dashboard if logged in and trying to access login
  if (user && pathWithoutLocale === '/login') {
    return NextResponse.redirect(new URL(`/${locale}/dashboard`, req.url));
  }

  // 4. Role Authorization (if logged in and not on public path)
  if (user && !isPublic) {
    try {
      let cmsUser: any = null
      try {
        const ans = await supabase
          .schema('core')
          .from('cms_users')
          .select('id, role, is_active, enabled_modules')
          .eq('email', user.email)
          .single()
        cmsUser = ans.data
        if (cmsUser && cmsUser.is_active === false && cmsUser.role !== 'client') cmsUser = null
      } catch (err) {
        console.warn('Middleware: CMS user lookup error', err)
      }

      // DB is the sole source of authorization. No user_metadata/app_metadata fallback:
      // user_metadata is client-writable (auth.updateUser), so trusting it for the role was a
      // privilege-escalation hole — any signed-in user could self-grant admin.
      if (!cmsUser) {
        return NextResponse.redirect(new URL(`/${locale}/unauthorized`, req.url))
      }

      // Admin check
      if (isAdmin(cmsUser.role)) {
        return res;
      }

      // Rotas com portão de módulo. Este bloco só MAPEIA prefixo para módulo — quem decide é
      // `isModuleEnabled`, o mesmo SSOT que a navegação e o `requireModule` das API routes
      // consultam. Entitlement (`core.cms_users.enabled_modules`) e piso de role vivem lá.
      //
      // POR QUE A REGRA NÃO MORA AQUI: a divergência que isto corrigiu era exatamente essa. O
      // bloco decidia por conta própria, só por entitlement, e um `client` — que é um PARCEIRO,
      // o próprio sujeito dos números — com `finance` marcado entrava e via a API responder 403
      // em cada painel. Dois portões, duas respostas. Agora é um.
      const MODULE_PREFIXES: Record<string, ModuleId> = {
        '/events': MODULES.EVENTS,
        '/places': MODULES.PLACES,
        // `/finance` mora na raiz e NÃO sob a área de admin: este bloco é a única porta que
        // deixa um não-admin entrar por entitlement, e a área de admin bounça quem não é admin.
        '/finance': MODULES.FINANCE,
      }
      const gatedPrefix = Object.keys(MODULE_PREFIXES).find(p => pathWithoutLocale.startsWith(p))
      if (gatedPrefix) {
        const entitlements = {
          role: cmsUser.role,
          enabledModules: (cmsUser.enabled_modules ?? []) as string[],
        }
        if (isModuleEnabled(MODULE_PREFIXES[gatedPrefix], entitlements)) {
          return res;
        }
        return NextResponse.redirect(new URL(`/${locale}/unauthorized`, req.url));
      }

      // Client check
      if (isClient(cmsUser.role)) {
        // A Overview (/dashboard e as páginas sob /dashboard/reports) é GLOBAL por construção: das 14
        // chamadas que dispara, 10 não têm parâmetro de dono (inventory_funnel,
        // recent_app_users, top_visited_pois...). Client não entra — vai para o painel dele.
        // Redirect em vez de /unauthorized porque isto não é falta de permissão, é lugar errado.
        if (pathWithoutLocale === '/dashboard' || pathWithoutLocale.startsWith('/dashboard/')) {
          return NextResponse.redirect(new URL(`/${locale}/clients/dashboard`, req.url));
        }
        // Check allowed paths for client
        if (pathWithoutLocale.startsWith('/pois') || pathWithoutLocale.startsWith('/clients') || pathWithoutLocale.startsWith('/routes') || ALLOWED_CLIENT_PATHS.includes(pathWithoutLocale)) {
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