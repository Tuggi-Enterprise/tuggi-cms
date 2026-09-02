/**
 * O CONTRATO VIVO DE CADA PARCEIRO — uma leitura, três quadros.
 *
 * MORA NUM MÓDULO PRÓPRIO E NÃO DENTRO DE UM DOS LEITORES. A fila de material e o financeiro
 * precisam do mesmo fato, e deixá-lo dentro de `material-order-service.ts` fazia o financeiro
 * importar a fila enquanto a fila importava o financeiro — um ciclo em torno de uma função de
 * quinze linhas. Aqui todos leem o mesmo arquivo e nenhum depende do outro.
 *
 * `derivePartnerPlan` continua sendo quem DECIDE quem paga; isto só entrega uma das três fontes
 * que ele lê.
 *
 * O STATUS VIAJA JUNTO DESDE 2026-09-02, e é o que a Visão geral usa para duas coisas que o
 * `tier` sozinho não responde: quem SAIU (`terminated`, que não é pagante nem cortesia nem
 * gratuito — é quem não está mais lá) e qual parte do MRR está de fato ASSINADA. Um MRR único
 * somaria a mensalidade que alguém digitou na ficha com a que o parceiro assinou, e a projeção
 * passaria a prometer receita que ninguém contratou.
 */

import { getSupabaseService } from '@/lib/core/supabase-client'
import type { ContractTier } from '@/lib/contract/snapshot'
import { CONTRACT_STATUSES, type ContractStatus } from '@/lib/contract/status'

/** O contrato vivo de um parceiro, reduzido ao que os leitores precisam. */
export interface LiveContractState {
  tier: ContractTier | null
  status: ContractStatus | null
}

/**
 * Os ids em lotes, porque PostgREST recebe um `IN (...)` pela URL.
 *
 * A MESMA RAZÃO DE `chunk()` EM `finance-service.ts`, e o mesmo defeito que aquele comentário
 * descreve — este arquivo era o lugar onde ele ainda estava vivo (registrado em
 * `docs/dev/financeiro-proxima-rodada.md`, §2.4-4). Um `.in()` com 500 UUIDs monta uma query
 * string de uns 18 KB, e servidores derrubam a requisição bem antes disso. O sintoma seria um
 * 400 do PostgREST, que não se parece nem um pouco com "a lista ficou grande demais".
 */
const ID_BATCH = 100

function chunk(ids: string[]): string[][] {
  const batches: string[][] = []
  for (let index = 0; index < ids.length; index += ID_BATCH) {
    batches.push(ids.slice(index, index + ID_BATCH))
  }
  return batches
}

function toStatus(value: unknown): ContractStatus | null {
  return CONTRACT_STATUSES.includes(value as ContractStatus) ? (value as ContractStatus) : null
}

/**
 * O contrato vivo de cada parceiro — o que não foi substituído.
 *
 * Uma leitura por lote, do mais novo para o mais antigo: a primeira linha vista de um cliente é
 * a viva, a mesma regra que `loadLiveContracts` segue no funil de parcerias. Parceiro sem
 * contrato responde ausência, e é isso que manda `derivePartnerPlan` cair para o cadastro.
 */
export async function loadLiveContractStates(
  ids: string[]
): Promise<Map<string, LiveContractState>> {
  const states = new Map<string, LiveContractState>()
  if (ids.length === 0) return states

  for (const batch of chunk(ids)) {
    const { data } = await getSupabaseService()
      .schema('partner')
      .from('partner_contracts')
      .select('client_id, tier, status, created_at')
      .in('client_id', batch)
      .is('superseded_by', null)
      .order('created_at', { ascending: false })

    for (const row of (data ?? []) as { client_id: string; tier: string | null; status: string | null }[]) {
      if (!row.client_id || states.has(row.client_id)) continue
      states.set(row.client_id, {
        tier: row.tier === 'free' || row.tier === 'paid' ? row.tier : null,
        status: toStatus(row.status),
      })
    }
  }
  return states
}

/**
 * Só o tier, para quem só precisa dele.
 *
 * A fila de material pergunta uma coisa só — "este parceiro é da faixa gratuita?" — e passar-lhe
 * um objeto de dois campos a obrigaria a saber o que é `superseded_by` para ignorar o segundo.
 */
export async function loadLiveContractTiers(
  ids: string[]
): Promise<Map<string, ContractTier | null>> {
  const tiers = new Map<string, ContractTier | null>()
  for (const [clientId, state] of await loadLiveContractStates(ids)) {
    tiers.set(clientId, state.tier)
  }
  return tiers
}
