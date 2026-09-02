/**
 * Módulo Financeiro — gate (espelha lib/modules/places.ts).
 *
 * Usar em navegação, layout de rota e API routes. A regra vive em lib/modules/index.ts (SSOT);
 * este arquivo é só o atalho nomeado.
 */
import { MODULES, isModuleEnabled, type Entitlements } from './index'

export function isFinanceEnabled(e?: Entitlements): boolean {
  return isModuleEnabled(MODULES.FINANCE, e)
}
