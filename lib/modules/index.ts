/**
 * Módulos do CMS — SSOT dos gates de entitlement.
 *
 * Um único ponto decide se um módulo está disponível para um usuário. Rotas,
 * navegação e API routes derivam desta função — nunca reimplementam a regra.
 *
 * Regra: admin é onipotente (vê tudo, ignora o array). Demais roles precisam do
 * módulo em `enabledModules` (coluna core.cms_users.enabled_modules).
 */
import { isAdmin } from '@/lib/roles'

export const MODULES = {
  EVENTS: 'events',
  PLACES: 'places',
  MARKETING: 'marketing',
} as const

export type ModuleId = (typeof MODULES)[keyof typeof MODULES]

/** Módulos que um admin pode ligar/desligar por usuário na tela de admin. */
export const TOGGLEABLE_MODULES: ModuleId[] = [MODULES.EVENTS, MODULES.PLACES]

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
  return (e?.enabledModules ?? []).includes(mod)
}
