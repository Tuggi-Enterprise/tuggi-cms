/**
 * QUEM ENTRA EM QUAL PÁGINA — uma decisão, um lugar.
 *
 * Este módulo responde a uma pergunta só: dado um caminho (sem o prefixo de locale) e os
 * entitlements de quem pede, o CMS deixa entrar, manda embora, ou manda para outro lugar?
 *
 * POR QUE ELE EXISTE. Até 2026-09-01 essa decisão morava em `proxy.ts`, e o MENU a reimplementava
 * em `components/ui/Header.tsx` com condições próprias (`isAdmin`, `!isCoordinator`, ...). Dois
 * lugares decidindo a mesma coisa divergiram, e a divergência era visível:
 *
 *   · um `editor` via "Dashboard" no menu apontando para `/clients/dashboard`, mas o proxy só
 *     consulta `ALLOWED_CLIENT_PATHS` DENTRO do bloco `isClient` — editor não é client, então
 *     todo clique caía em `/unauthorized`;
 *   · o mesmo `editor` via o dropdown de Pontos inteiro, e `/pois` respondia `/unauthorized`
 *     pelo mesmo motivo;
 *   · um `client` com o módulo `finance` marcado entrava na casca de `/finance` e via a API
 *     responder 403 em cada painel (corrigido no commit 2b7c58b, que criou `MODULE_MIN_ROLES`).
 *
 * A correção estrutural não é ajustar o menu para copiar melhor o portão — é o menu PERGUNTAR ao
 * portão. Um item de menu que aponta para onde o usuário não entra é um defeito que nenhuma
 * revisão de layout pega, porque ele só aparece depois do clique.
 *
 * PURO DE PROPÓSITO: sem Supabase, sem React, sem `next/*`. Recebe o caminho e os entitlements,
 * devolve a decisão. É o que deixa `tests/api/navigation.test.ts` provar a tabela inteira sem
 * banco e sem mock de módulo — que nesta máquina é justamente o que não funciona (Node 20).
 */

import { isAdmin, isClient, ALLOWED_CLIENT_PATHS } from '@/lib/roles'
import { MODULES, isModuleEnabled, type ModuleId } from '@/lib/modules'

/** Quem está pedindo. É o mesmo formato de `Entitlements` de `lib/modules`. */
export interface AccessContext {
  role?: string | null
  enabledModules?: string[] | null
}

/**
 * O que o CMS faz com o pedido.
 *
 * `redirect` NÃO é uma negação, e a diferença é do operador, não do código: quem cai nele tem
 * permissão, está no endereço errado. É por isso que um `client` em `/dashboard` vai para o
 * painel dele em vez de ver "não autorizado" — a decisão está documentada em `lib/roles.ts`,
 * onde `/dashboard` foi removido de `ALLOWED_CLIENT_PATHS` em 2026-07-17.
 */
export type AccessDecision =
  | { kind: 'allow' }
  | { kind: 'unauthorized' }
  | { kind: 'redirect'; to: string }

/**
 * Prefixos gateados por MÓDULO, e não por role.
 *
 * Quem decide é `isModuleEnabled` — o mesmo SSOT que `requireModule` aplica nas rotas de API e
 * que carrega o piso de role de `MODULE_MIN_ROLES`. Este mapa só diz qual prefixo pertence a
 * qual módulo; nenhuma regra de acesso mora aqui.
 */
export const MODULE_PREFIXES: Record<string, ModuleId> = {
  '/events': MODULES.EVENTS,
  '/places': MODULES.PLACES,
  // `/finance` mora na raiz e NÃO sob a área de admin: este é o único caminho que deixa um
  // não-admin entrar por entitlement, e a área de admin bounça quem não é admin antes disso.
  '/finance': MODULES.FINANCE,
}

/** Para onde um `client` vai quando pede a Overview global, que é global por construção. */
export const CLIENT_HOME = '/clients/dashboard'

/** `path` já vem SEM o prefixo de locale — `/finance`, nunca `/pt/finance`. */
function matchesClientPath(path: string): boolean {
  if ((ALLOWED_CLIENT_PATHS as readonly string[]).includes(path)) return true
  return ['/pois', '/clients', '/routes'].some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  )
}

/**
 * A decisão. A ORDEM DAS PERGUNTAS É A REGRA, e ela é a mesma que `proxy.ts` sempre teve.
 *
 * 1. Admin é onipotente e responde antes de tudo — inclusive antes dos módulos, porque
 *    `isModuleEnabled` já o trata como onipotente e perguntar duas vezes só criaria a chance
 *    de as duas respostas discordarem.
 * 2. Prefixo de módulo: quem tem o módulo entra, seja qual for o role (respeitado o piso de
 *    `MODULE_MIN_ROLES`). É a única porta de entrada de um não-admin por entitlement.
 * 3. `client`: a Overview global vira redirect para o painel dele; o resto é a lista de
 *    `ALLOWED_CLIENT_PATHS` mais os três prefixos históricos.
 * 4. Qualquer outro — `editor`, `viewer`, role desconhecido — não entra.
 *
 * O passo 4 é o que hoje deixa `editor` e `viewer` sem CMS fora dos módulos. Isso é o
 * comportamento vigente, descrito e não inventado aqui: ver `tests/api/navigation.test.ts`, que
 * o trava para que deixar de ser verdade seja uma decisão e não um efeito colateral.
 */
export function resolveAccess(path: string, ctx: AccessContext): AccessDecision {
  if (isAdmin(ctx.role)) return { kind: 'allow' }

  const gatedPrefix = Object.keys(MODULE_PREFIXES).find(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  )
  if (gatedPrefix) {
    const entitlements = { role: ctx.role, enabledModules: ctx.enabledModules ?? [] }
    return isModuleEnabled(MODULE_PREFIXES[gatedPrefix], entitlements)
      ? { kind: 'allow' }
      : { kind: 'unauthorized' }
  }

  if (isClient(ctx.role)) {
    if (path === '/dashboard' || path.startsWith('/dashboard/')) {
      return { kind: 'redirect', to: CLIENT_HOME }
    }
    return matchesClientPath(path) ? { kind: 'allow' } : { kind: 'unauthorized' }
  }

  return { kind: 'unauthorized' }
}

/**
 * Atalho para o MENU: este destino vale a pena ser oferecido?
 *
 * `redirect` conta como NÃO, e é a única sutileza aqui. Oferecer `/dashboard` a um `client`
 * "funcionaria" — ele chega em algum lugar — mas o menu estaria prometendo a Overview global e
 * entregando o painel dele. O item certo para ele é `/clients/dashboard`, escrito como tal.
 */
export function canReach(path: string, ctx: AccessContext): boolean {
  return resolveAccess(path, ctx).kind === 'allow'
}
