/**
 * Módulo Eventos — gate (espelha lib/modules/marketing.ts, mas real).
 *
 * Usar em navegação, layout de rota e API routes. A regra vive em
 * lib/modules/index.ts (SSOT); este arquivo é só o atalho nomeado.
 */
import { MODULES, isModuleEnabled, type Entitlements } from './index'

export function isEventsEnabled(e?: Entitlements): boolean {
  return isModuleEnabled(MODULES.EVENTS, e)
}
