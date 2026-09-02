/**
 * O TIER DO CONTRATO VIVO DE CADA PARCEIRO — uma leitura, dois quadros.
 *
 * MORA NUM MÓDULO PRÓPRIO E NÃO DENTRO DE UM DOS DOIS LEITORES. A fila de material e o
 * financeiro precisam do mesmo fato, e deixá-lo dentro de `material-order-service.ts` fazia o
 * financeiro importar a fila enquanto a fila importava o financeiro — um ciclo em torno de uma
 * função de quinze linhas. Aqui os dois leem o mesmo arquivo e nenhum depende do outro.
 *
 * `derivePartnerPlan` continua sendo quem DECIDE quem paga; isto só entrega uma das três fontes
 * que ele lê.
 */

import { getSupabaseService } from '@/lib/core/supabase-client'
import type { ContractTier } from '@/lib/contract/snapshot'

/**
 * The tier of each partner's LIVE contract — the one that was not superseded.
 *
 * One read for the whole board, newest first: the first row seen for a client is the live one,
 * the same rule `loadLiveContracts` follows in the partnership pipeline. A partner with no
 * contract answers `null`, which is what tells `derivePartnerPlan` to fall back to the record.
 */
export async function loadLiveContractTiers(ids: string[]): Promise<Map<string, ContractTier | null>> {
  const tiers = new Map<string, ContractTier | null>()
  const { data } = await getSupabaseService().schema('partner')
    .from('partner_contracts')
    .select('client_id, tier, created_at')
    .in('client_id', ids)
    .is('superseded_by', null)
    .order('created_at', { ascending: false })

  for (const row of (data ?? []) as { client_id: string; tier: string | null }[]) {
    if (!row.client_id || tiers.has(row.client_id)) continue
    tiers.set(row.client_id, row.tier === 'free' || row.tier === 'paid' ? row.tier : null)
  }
  return tiers
}
