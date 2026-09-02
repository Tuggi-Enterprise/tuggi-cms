/**
 * OS NÚMEROS DO TOPO — calculados sobre a MESMA lista que a tabela desenha.
 *
 * UMA LEITURA, DUAS SUPERFÍCIES. O total acima e as linhas abaixo não podem discordar porque não
 * existe uma segunda consulta com quem discordar. A alternativa — um `count()` por cartão — é
 * como um quadro acaba dizendo `17 abertos` sobre dezesseis cards, e é a mesma decisão que
 * `summarizeMaterialQueue` já tomou em `order-queue.ts`.
 *
 * O QUE ESTÁ EM MINUTOS FICA EM MINUTOS. `purchasedMinutes` não vira reais em lugar nenhum desta
 * Fase: o valor da compra do usuário do app não existe no CMS (BR-MONETIZACAO-048), e
 * `finance-surface.test.ts` trava a ausência de qualquer conversão.
 *
 * Puro: sem fetch, sem Supabase, sem React.
 */

import type { FinanceProduct } from './catalog'
import type { FinancePurchase } from './unit-cost'
import type { ClientProfitability, ConsumptionRecord, FinanceVerdict } from './profitability'

const VERDICTS: readonly FinanceVerdict[] = [
  'uncosted',
  'undated',
  'no_return',
  'unknown_return',
  'non_monetary_return',
  'payback_pending',
  'profitable',
]

export interface FinanceSummary {
  currency: string
  partners: number
  byVerdict: Record<FinanceVerdict, number>
  directCostCents: number
  standardCostCents: number
  revenueCents: number
  /** MC I somada. É o que a camada de estrutura tem para cobrir. */
  marginCents: number
  /** Linhas consumidas sem preço, no conjunto. Enquanto houver uma, todo total é um piso. */
  unpricedLines: number
  /** Pedidos despachados sem quantidade enviada informada. A outra causa de total-piso. */
  ordersAwaitingShipment: number
  /** Chegaram pelo QR dos parceiros. Aquisição. */
  acquiredUsers: number
  /** São da equipe dos estabelecimentos. NÃO é aquisição, e por isso é outra coluna. */
  teamUsers: number
  /** `null` quando a leitura de compras não respondeu em parceiro nenhum. Nunca zero por ausência. */
  usersWithPurchase: number | null
  /** `null` quando nenhuma leitura respondeu — nunca zero por ausência. */
  purchasedMinutes: number | null
  /**
   * Ao menos um parceiro teve as colunas de compra colapsadas pelo piso de k, então os dois
   * totais acima são PISO e não fato: há compradores contados como `1` que podem ser vários, e
   * há minutos que não entraram na soma.
   *
   * Existe porque a alternativa era pior. Somar valores suprimidos e imprimir o resultado com
   * cara de total exato é o "piso vestido de fato" que este módulo inteiro existe para impedir —
   * o mesmo motivo de `uncosted` responder antes de `no_return`.
   */
  purchaseIsFloor: boolean
  /** Custo direto total ÷ adquiridos. `null` com zero adquiridos — nunca infinito. */
  cacCents: number | null
  ignoredCurrencies: string[]
}

function emptyVerdicts(): Record<FinanceVerdict, number> {
  return VERDICTS.reduce(
    (counts, verdict) => {
      counts[verdict] = 0
      return counts
    },
    {} as Record<FinanceVerdict, number>
  )
}

export function summarizeFinance(
  clients: readonly ClientProfitability[],
  fallbackCurrency = 'BRL'
): FinanceSummary {
  const tally = new Map<string, number>()
  for (const client of clients) tally.set(client.currency, (tally.get(client.currency) ?? 0) + 1)

  let currency = fallbackCurrency
  let best = -1
  for (const [candidate, count] of Array.from(tally.entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    if (count > best) {
      best = count
      currency = candidate
    }
  }

  const summary: FinanceSummary = {
    currency,
    partners: clients.length,
    byVerdict: emptyVerdicts(),
    directCostCents: 0,
    standardCostCents: 0,
    revenueCents: 0,
    marginCents: 0,
    unpricedLines: 0,
    ordersAwaitingShipment: 0,
    acquiredUsers: 0,
    teamUsers: 0,
    usersWithPurchase: null,
    purchasedMinutes: null,
    purchaseIsFloor: false,
    cacCents: null,
    ignoredCurrencies: [],
  }

  const ignored = new Set<string>()

  for (const client of clients) {
    summary.byVerdict[client.verdict] += 1
    summary.unpricedLines += client.unpricedLines
    summary.ordersAwaitingShipment += client.ordersAwaitingShipment
    summary.acquiredUsers += client.linkedByPartnerId
    summary.teamUsers += client.linkedByClientId
    // Mesma regra dos minutos: quem não respondeu não soma zero, e o total continua `null`
    // enquanto ninguém tiver respondido.
    if (client.usersWithPurchase !== null) {
      summary.usersWithPurchase = (summary.usersWithPurchase ?? 0) + client.usersWithPurchase
    }
    // `null` é ausência de leitura, não zero minutos: só entra na soma quem respondeu, e a soma
    // continua `null` enquanto ninguém tiver respondido.
    if (client.purchasedMinutes !== null) {
      summary.purchasedMinutes = (summary.purchasedMinutes ?? 0) + client.purchasedMinutes
    }
    // Um parceiro suprimido basta: a partir dele os dois totais são piso, e a tela precisa
    // dizer `≥` em vez de imprimir a soma como se fosse a conta fechada.
    if (client.purchaseSuppressed) summary.purchaseIsFloor = true
    for (const other of client.ignoredCurrencies) ignored.add(other)

    if (client.currency !== currency) {
      ignored.add(client.currency)
      continue
    }
    summary.directCostCents += client.directCostCents
    summary.standardCostCents += client.standardCostCents
    summary.revenueCents += client.revenueCents
    summary.marginCents += client.marginCents
  }

  summary.cacCents =
    summary.acquiredUsers > 0 ? Math.round(summary.directCostCents / summary.acquiredUsers) : null
  summary.ignoredCurrencies = Array.from(ignored).sort()

  return summary
}

/**
 * COMPRADO MENOS CONSUMIDO — o capital parado em estoque.
 *
 * Responde à pergunta que hoje não tem resposta: comprei demais? E ela é diferente da fila de
 * material, que conta o que falta IMPRIMIR — aqui se conta o que já foi pago e ainda não saiu.
 *
 * OS COMPONENTES SAEM DO SNAPSHOT, e é por isso que `ConsumptionRecord.components` existe. Uma
 * etiqueta de QR nunca aparece em `quantity`, que conta apenas o entregável: 30 displays com 2 QR
 * cada consumiram 60 etiquetas, e ler só `quantity` faria a bobina parecer eterna.
 */
export interface StockLine {
  productId: string
  name: string
  purchasedPieces: number
  consumedPieces: number
  /** Pode ser negativo, e negativo é informação: saiu mais do que se registrou ter comprado. */
  remainingPieces: number
  purchasedCents: number
  currency: string
}

export function summarizeStock(
  products: readonly FinanceProduct[],
  purchases: readonly FinancePurchase[],
  consumption: readonly ConsumptionRecord[]
): StockLine[] {
  const lines = new Map<string, StockLine>()

  for (const product of products) {
    lines.set(product.id, {
      productId: product.id,
      name: product.name,
      purchasedPieces: 0,
      consumedPieces: 0,
      remainingPieces: 0,
      purchasedCents: 0,
      currency: 'BRL',
    })
  }

  for (const purchase of purchases) {
    const line = lines.get(purchase.productId)
    if (!line) continue
    line.purchasedPieces += purchase.pieces
    line.purchasedCents += purchase.totalCents + purchase.freightCents
    line.currency = purchase.currency
  }

  for (const record of consumption) {
    const line = lines.get(record.productId)
    if (line) line.consumedPieces += record.quantity
    for (const component of record.components ?? []) {
      const componentLine = lines.get(component.productId)
      if (componentLine) {
        componentLine.consumedPieces += component.quantityPerUnit * record.quantity
      }
    }
  }

  for (const line of lines.values()) {
    line.remainingPieces = line.purchasedPieces - line.consumedPieces
  }

  // Ordem estável e útil: o que mais sobrou primeiro, e o nome desempata. Uma lista cuja ordem
  // muda entre duas leituras dos mesmos dados é uma lista que alguém tem de reler.
  return Array.from(lines.values()).sort(
    (a, b) => b.remainingPieces - a.remainingPieces || a.name.localeCompare(b.name)
  )
}
