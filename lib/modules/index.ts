/**
 * Módulos do CMS — SSOT dos gates de entitlement.
 *
 * Um único ponto decide se um módulo está disponível para um usuário. Rotas,
 * navegação e API routes derivam desta função — nunca reimplementam a regra.
 *
 * Regra: admin é onipotente (vê tudo, ignora o array). Demais roles precisam do
 * módulo em `enabledModules` (coluna core.cms_users.enabled_modules).
 */
import { isAdmin, type Role } from '@/lib/roles'

export const MODULES = {
  EVENTS: 'events',
  PLACES: 'places',
  MARKETING: 'marketing',
  FINANCE: 'finance',
} as const

export type ModuleId = (typeof MODULES)[keyof typeof MODULES]

/**
 * Módulos que um admin pode ligar/desligar por usuário na tela de admin.
 *
 * `FINANCE` entra aqui e não numa lista à parte de propósito. As rotas dele aceitam
 * `['admin','editor']` e chamam `requireModule`, então quem decide de verdade é esta checkbox —
 * e como nenhum editor tem `finance` marcado, hoje o módulo é só do admin. Se as rotas
 * aceitassem apenas `admin`, a checkbox seria uma chave que não liga nada, porque admin ignora
 * o array por código.
 */
export const TOGGLEABLE_MODULES: ModuleId[] = [MODULES.EVENTS, MODULES.PLACES, MODULES.FINANCE]

/**
 * Piso de role por módulo — a entitlement diz QUAL módulo, isto diz QUEM pode usá-lo.
 *
 * Um módulo ausente daqui aceita qualquer role com a checkbox marcada, que é como `events` e
 * `places` sempre funcionaram. Quem entra aqui declara que a checkbox sozinha não basta.
 *
 * `FINANCE` exige `editor` porque as rotas de `app/api/finance` exigem
 * `withAuth({ roles: ['admin','editor'] })`. Sem este piso os dois portões discordavam: um
 * `client` — que é um PARCEIRO, o próprio sujeito dos números — com `finance` marcado passava
 * pelo middleware, carregava a tela e via a API responder 403 em cada painel. O dado nunca
 * vazou; o desenho é que tinha duas respostas para a mesma pergunta.
 *
 * O piso mora AQUI e não no middleware de propósito: navegação, `requireModule` e o proxy
 * derivam todos de `isModuleEnabled`, e um piso guardado em qualquer um deles seria o quinto
 * lugar a decidir sozinho — o defeito de novo, com outro nome.
 */
export const MODULE_MIN_ROLES: Partial<Record<ModuleId, readonly Role[]>> = {
  [MODULES.FINANCE]: ['editor'],
}

export interface Entitlements {
  role?: string | null
  enabledModules?: string[] | null
}

/**
 * Fonte única da verdade: o módulo `mod` está disponível para um usuário com
 * estes entitlements? Admin sempre `true` (nunca depende do array).
 */
export function isModuleEnabled(mod: ModuleId, e?: Entitlements): boolean {
  if (isAdmin(e?.role)) return true
  if (!(e?.enabledModules ?? []).includes(mod)) return false
  const minRoles = MODULE_MIN_ROLES[mod]
  return !minRoles || minRoles.includes((e?.role ?? '') as Role)
}
