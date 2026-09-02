/**
 * BACKFILL DO CUSTO — os pedidos que já saíram antes de o financeiro existir.
 *
 * POR QUE PRECISA EXISTIR. `recordConsumption` é disparado por `setMaterialOrderStatus`, então
 * ele só alcança pedidos que se movem DEPOIS de este módulo entrar no ar. Todo pedido que já
 * está em `dispatched` ou `fulfilled` custou dinheiro e não tem linha nenhuma — e sem elas a
 * primeira leitura da tela mostraria parceiros de graça.
 *
 * A DATA É A DO PEDIDO, NÃO A DE HOJE. `material_orders.updated_at` é quando ele de fato saiu, e
 * é ela que decide qual RECEITA e qual PREÇO estavam vigentes — `resolveRecipe` e `unitCost`
 * ambos filtram por `<= at`. Rodar com a data de hoje congelaria o custo de agosto com a receita
 * de setembro, que é exatamente o erro que a vigência existe para impedir.
 *
 * ELE NÃO INVENTA QUANTIDADE. Desde 2026-09-01 o custo sai de `finance.order_shipment` — quanto
 * REALMENTE saiu — e não de `material_order_items.quantity`, que é o que o parceiro pediu. Um
 * pedido sem envio informado não vira custo aqui: o script o conta e segue. Informe o envio (na
 * fila de material, ou pela rota `/api/finance/shipments`) e rode de novo.
 *
 * SEGURO DE REPETIR, E É ASSIM QUE SE CORRIGE UM CUSTO QUE FALTAVA. O `unique (order_id,
 * product_id)` faz a segunda execução não duplicar nada; e as linhas que entraram SEM preço
 * ganham o preço quando a compra é cadastrada — `recordConsumption` as atualiza com
 * `is('unit_cost_cents', null)` no `WHERE`. Uma linha que já tem custo é intocável.
 *
 * Então o fluxo correto é: cadastre as compras, rode; achou uma compra que faltava, cadastre e
 * rode de novo. Nada se perde e nada se duplica.
 *
 * ── `--recompute`, O ATO EXPLÍCITO DE CORREÇÃO ─────────────────────────────────────────────
 *
 * Sem `--recompute`, o script só PREENCHE o que falta: grava o pedido que não tinha linha e dá
 * preço à linha que estava nula. Nunca reescreve custo apurado, porque reescrever história em
 * silêncio é o defeito que a tabela de lançamento existe para impedir.
 *
 * Com `--recompute`, ele REFAZ as linhas com as regras de hoje. É para quando a regra estava
 * errada: em 2026-09-01 uma receita invertida cobrou R$ 1.500,00 de envelope num pedido de
 * R$ 207,50, e um preço semeado ficou congelado depois de a compra que o originou ser apagada.
 * Ele nunca troca um custo conhecido por `null` — se hoje não dá para precificar, o que está lá
 * permanece e o script conta em `mantidos`. E apaga a linha de um produto que o plano de hoje
 * não produz mais: envio corrigido para zero não é custo errado, é consumo que não houve.
 *
 * Uso:
 *   npx tsx --env-file=.env scripts/finance-backfill-consumption.ts [--dry-run]
 *   npx tsx --env-file=.env scripts/finance-backfill-consumption.ts --recompute [<orderId>]
 */

import { getSupabaseService } from '../lib/core/supabase-client'
import { recomputeConsumption, recordConsumption } from '../lib/services/finance-service'
import { CONSUMING_STATUSES } from '../lib/finance/consumption'

interface OrderRow {
  id: string
  status: string
  updated_at: string | null
  created_at: string
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const recompute = process.argv.includes('--recompute')
  // Um id solto na linha de comando limita o recálculo a um pedido — é o caso comum: consertar
  // aquele parceiro cujo número ficou estranho, sem tocar em mais nada.
  const onlyOrder = process.argv.find((arg) => /^[0-9a-f-]{36}$/i.test(arg)) ?? null

  if (recompute) {
    await runRecompute(onlyOrder, dryRun)
    return
  }

  const { data, error } = await getSupabaseService()
    .schema('partner')
    .from('material_orders')
    .select('id, status, updated_at, created_at')
    .in('status', [...CONSUMING_STATUSES])
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[backfill] leitura falhou:', error.message)
    process.exitCode = 1
    return
  }

  const orders = (data ?? []) as OrderRow[]
  console.log(`[backfill] ${orders.length} pedido(s) em ${CONSUMING_STATUSES.join(' ou ')}`)

  let inserted = 0
  let repriced = 0
  let alreadyThere = 0
  let awaiting = 0
  let failed = 0

  for (const order of orders) {
    // `updated_at` é quando o pedido chegou ao status atual; sem ela, a data de criação é o
    // melhor sinal que existe — e é sempre anterior, nunca inventada para frente.
    const at = (order.updated_at ?? order.created_at).slice(0, 10)

    if (dryRun) {
      console.log(`[backfill] (dry-run) ${order.id} — ${order.status} em ${at}`)
      continue
    }

    const result = await recordConsumption(order.id, order.status as 'dispatched' | 'fulfilled', {
      at,
    })

    if (!result) {
      failed += 1
      console.error(`[backfill] FALHOU ${order.id}`)
      continue
    }
    repriced += result.repriced
    if (result.awaitingShipment > 0) awaiting += 1
    else if (result.inserted === 0) alreadyThere += 1
    if (result.inserted > 0) inserted += result.inserted
  }

  if (dryRun) return

  console.log(
    `[backfill] ${inserted} linha(s) gravada(s), ${repriced} linha(s) que estavam sem preço ` +
      `receberam um, ${alreadyThere} pedido(s) já tinham custo, ` +
      `${awaiting} pedido(s) SEM ENVIO INFORMADO (nenhum custo lançado sobre eles), ` +
      `${failed} falha(s)`
  )

  // As linhas sem preço são pedidos que saíram antes de a compra ser cadastrada. A tela as conta
  // como pendência (`uncosted`) em vez de somar zero — e cadastrar a compra e rodar o script de
  // novo é exatamente o que as corrige.
  const { count } = await getSupabaseService()
    .schema('finance')
    .from('material_consumption')
    .select('id', { count: 'exact', head: true })
    .is('unit_cost_cents', null)

  if (count && count > 0) {
    console.warn(
      `[backfill] ${count} linha(s) estão SEM PREÇO — cadastre a compra do produto e RODE ESTE ` +
        `SCRIPT DE NOVO para elas receberem o custo. Enquanto houver uma, o veredito daquele ` +
        `parceiro é "Custo incompleto".`
    )
  }
}

void main()

/**
 * Refaz as linhas de custo com as regras de hoje.
 *
 * Separado de `main` porque é outro ato: aquele PREENCHE o que falta, este CORRIGE o que está
 * errado. Misturá-los faria toda execução de rotina reescrever custo apurado, que é exatamente
 * o que não pode acontecer sem alguém pedir.
 */
async function runRecompute(onlyOrder: string | null, dryRun: boolean) {
  const { data, error } = await getSupabaseService()
    .schema('partner')
    .from('material_orders')
    .select('id, status')
    .in('status', [...CONSUMING_STATUSES])

  if (error) {
    console.error('[recompute] leitura falhou:', error.message)
    process.exitCode = 1
    return
  }

  const orders = ((data ?? []) as { id: string }[]).filter(
    (order) => !onlyOrder || order.id === onlyOrder
  )

  if (onlyOrder && orders.length === 0) {
    console.error(`[recompute] pedido ${onlyOrder} não está em ${CONSUMING_STATUSES.join(' nem ')}`)
    process.exitCode = 1
    return
  }

  console.log(`[recompute] ${orders.length} pedido(s)${dryRun ? ' (dry-run: nada será escrito)' : ''}`)
  if (dryRun) {
    for (const order of orders) console.log(`[recompute] (dry-run) ${order.id}`)
    return
  }

  let updated = 0
  let inserted = 0
  let kept = 0
  const orphans: string[] = []
  let failed = 0

  for (const order of orders) {
    const result = await recomputeConsumption(order.id)
    if (!result) {
      failed += 1
      console.error(`[recompute] FALHOU ${order.id}`)
      continue
    }
    updated += result.updated
    inserted += result.inserted
    kept += result.kept
    for (const orphan of result.orphans) orphans.push(`${order.id}:${orphan}`)
  }

  console.log(
    `[recompute] ${updated} linha(s) atualizada(s), ${inserted} nova(s), ` +
      `${kept} mantida(s) por não haver preço hoje, ${failed} falha(s)`
  )

  if (orphans.length > 0) {
    // Apagadas: um produto que o plano de hoje não produz não foi consumido — o envio dele foi
    // corrigido para zero — e mantê-lo infla o parceiro para sempre. É a única porta de `delete`
    // em `material_consumption`, e ela só se abre aqui.
    console.log(`[recompute] ${orphans.length} linha(s) apagada(s) por não haver consumo:`)
    for (const orphan of orphans) console.log(`  ${orphan}`)
  }
}
