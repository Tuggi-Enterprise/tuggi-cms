import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import createMiddleware from 'next-intl/middleware';
import { isPublicPath } from './lib/roles'
import { resolveAccess } from './lib/navigation/access'

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

      // QUEM ENTRA ONDE é decidido por `resolveAccess`, em `lib/navigation/access.ts`, e
      // não aqui. Este arquivo cuida de locale, sessão e identidade; a regra de acesso é a
      // mesma que `buildNavTree` consulta para decidir o que aparece no menu.
      //
      // POR QUE FOI EXTRAÍDA: enquanto a regra morava neste bloco, o menu a reimplementava com
      // condições próprias, e as duas discordavam. Um `editor` via "Dashboard", "Pontos de
      // Interesse" e "Rotas Customizadas" no menu, e os três respondiam `/unauthorized` daqui
      // — porque `ALLOWED_CLIENT_PATHS` só é consultada dentro do ramo `client`, e editor não
      // é client. Um item de menu que aponta para onde o usuário não entra é um defeito que
      // nenhuma revisão de layout pega, porque ele só aparece depois do clique.
      //
      // O COMPORTAMENTO É O MESMO, linha por linha: admin passa; prefixo de módulo pergunta a
      // `isModuleEnabled`; `client` vai da Overview global para o painel dele e só alcança a
      // lista permitida; qualquer outro role não entra. `tests/api/navigation.test.ts` prova a
      // tabela inteira sem banco e sem mock de módulo.
      const decision = resolveAccess(pathWithoutLocale, {
        role: cmsUser.role,
        enabledModules: (cmsUser.enabled_modules ?? []) as string[],
      })

      if (decision.kind === 'allow') {
        return res;
      }

      if (decision.kind === 'redirect') {
        // Não é falta de permissão, é lugar errado — por isso redirect e não `/unauthorized`.
        return NextResponse.redirect(new URL(`/${locale}${decision.to}`, req.url));
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