/**
 * O PORTÃO DA PÁGINA — a mesma decisão de `resolveAccess`, aplicada no servidor que renderiza.
 *
 * POR QUE EXISTE. `proxy.ts` já pergunta a `resolveAccess` quem entra onde, e é a primeira
 * barreira. Ele não pode ser a ÚNICA: a doc oficial do Next 16.3.4 é explícita — *"While Proxy
 * can be useful for initial checks, it should not be your only line of defense in protecting
 * your data. The majority of security checks should be performed as close as possible to your
 * data source"* (`nextjs.org/docs/app/guides/authentication`, seção "Optimistic checks with
 * Proxy", consultada em 2026-09-11). Este módulo é a segunda barreira, do lado do servidor de
 * renderização, e não substitui nem a do proxy nem a do banco.
 *
 * O QUE ELE NÃO É. Ele não é o gate dos DADOS. Quem escopa linha é o banco —
 * `core.resolve_dashboard_scope` (fail closed) e `core.assert_platform_admin()` dentro das RPCs.
 * Esta camada decide navegação: quem alcança a TELA. As duas são metades, nunca alternativas.
 *
 * SSOT: quem é admin, quem é `client` e o que cada um alcança está em `lib/navigation/access.ts`
 * e em `lib/roles.ts`, e NÃO se reescreve aqui. Este arquivo só sabe ler a identidade do
 * chamador e obedecer à decisão — foi a divergência entre duas leituras da mesma regra
 * (`app/[locale]/dashboard/my-clients/page.tsx` comparava `role` com literal) que criou a
 * chance de as duas discordarem.
 *
 * BR-CMS-002 (o parceiro só enxerga o que é do cliente dele) · BR-CMS-004 (a unidade de acesso
 * é módulo **e** papel).
 */

import { cache } from 'react'
import { cookies } from 'next/headers'
import { redirect } from '@/navigation'
import { getSupabaseServerComponent } from '@/lib/core/supabase-client'
import { resolveAccess } from './access'
import type { Role } from '@/lib/roles'

/** A linha de `core.cms_users` que autorizou esta renderização. */
export interface CmsIdentity {
  email: string
  role: Role
  enabledModules: string[]
}

/**
 * Quem está pedindo a página. Três respostas, e a diferença entre as duas primeiras é o que
 * separa "faça login" de "você não entra aqui" — juntá-las mandaria um operador logado para a
 * tela de login em loop.
 */
export type CallerIdentity =
  | { kind: 'anonymous' }
  | { kind: 'no-cms-access' }
  | { kind: 'cms'; user: CmsIdentity }

/**
 * Lê a identidade do chamador. Memoizado por `cache` do React: layout e página que guardam a
 * mesma renderização pagam uma ida ao Auth, não duas.
 *
 * `getUser()` e nunca `getSession()`: só o primeiro revalida o JWT contra o servidor de Auth e
 * pode embasar autorização — mesma razão escrita em `lib/auth-middleware.ts`.
 *
 * `is_active` entra na consulta, e não depois dela: conta desativada não renderiza tela de CMS
 * (BR-CMS-015). É a mesma condição que `withAuth` aplica nas rotas de API.
 */
export const resolveCallerIdentity = cache(async (): Promise<CallerIdentity> => {
  const supabase = getSupabaseServerComponent(await cookies())

  const { data, error } = await supabase.auth.getUser()
  const email = data?.user?.email
  if (error || !email) return { kind: 'anonymous' }

  const { data: cmsUser, error: lookupError } = await supabase
    .schema('core')
    .from('cms_users')
    .select('email, role, enabled_modules')
    .eq('email', email)
    .eq('is_active', true)
    .maybeSingle()

  // Consulta que falha não é usuário ausente — mas aqui as duas terminam no mesmo lugar de
  // propósito: uma tela de CMS que não consegue provar o papel não é renderizada. Fail closed.
  if (lookupError || !cmsUser) return { kind: 'no-cms-access' }

  return {
    kind: 'cms',
    user: {
      email: cmsUser.email as string,
      role: cmsUser.role as Role,
      enabledModules: (cmsUser.enabled_modules ?? []) as string[],
    },
  }
})

/**
 * Exige que o chamador alcance `path`, ou interrompe a renderização com um redirect.
 *
 * `path` vem SEM o prefixo de locale — `/dashboard`, nunca `/pt/dashboard` —, que é o formato
 * que `resolveAccess` recebe do proxy. `locale` é o do segmento, e existe para o redirect não
 * jogar um operador em `pt` de volta para `/en`.
 *
 * Devolve a identidade para quem já precisa dela, em vez de obrigar a uma segunda leitura.
 */
export async function requireAccess(path: string, locale: string): Promise<CmsIdentity> {
  const identity = await resolveCallerIdentity()

  if (identity.kind === 'anonymous') return redirect({ href: '/login', locale })
  if (identity.kind === 'no-cms-access') return redirect({ href: '/unauthorized', locale })

  const decision = resolveAccess(path, {
    role: identity.user.role,
    enabledModules: identity.user.enabledModules,
  })

  // `redirect` NÃO é negação: quem cai nele tem permissão e está no endereço errado — é o
  // `client` que pede a Overview global e vai para o painel dele (`access.ts`, CLIENT_HOME).
  if (decision.kind === 'redirect') return redirect({ href: decision.to, locale })
  if (decision.kind === 'unauthorized') return redirect({ href: '/unauthorized', locale })

  return identity.user
}
