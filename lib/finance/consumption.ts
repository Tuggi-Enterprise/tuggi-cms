/**
 * O CONSUMO — quando um pedido vira custo, e por quanto.
 *
 * QUANDO. `dispatched` e `fulfilled`, o que vier primeiro. A esteira tem cinco palavras e só
 * essas duas significam que a peça foi PRODUZIDA: `requested` é o que o parceiro pediu,
 * `in_preparation` é o que vamos imprimir, e `cancelled` nunca foi impresso — a mesma leitura
 * que `summarizeMaterialQueue` já faz ao dizer que cancelado não soma em nada
 * (`order-queue.ts`). `in_preparation` tem saída direta para `fulfilled` porque material
 * entregue no balcão não anda de transportadora, e é por isso que a regra é "o que vier
 * primeiro" e não "quando despachar".
 *
 * A REGRA VIVE AQUI E O BANCO NÃO A REPETE. `finance.record_material_consumption` recebe o
 * status pronto e não julga: repetir os dois nomes num trigger seria a segunda cópia da mesma
 * decisão, o defeito que `MATERIAL_TRANSITIONS` evita ao NÃO virar CHECK
 * (`20260826_04_material_order_pipeline.sql`). Quem garante que o custo entra uma vez só é o
 * `unique (order_id, product_id)`, que é fato do banco — e a segunda transição do mesmo pedido
 * escreve zero linhas em vez de falhar.
 *
 * A QUANTIDADE É A ENVIADA, NUNCA A PEDIDA. `material_order_items.quantity` é o que o parceiro
 * PEDIU, e custear por ela superestima todo parceiro que recebeu menos do que pediu — o operador
 * apontou isso em 2026-09-01: *"não é pq um parceiro pediu 40 displays, que enviamos os 40"*. O
 * que saiu vem de `finance.order_shipment`, e um item sem essa linha NÃO vira custo: ele volta em
 * `awaitingShipment` e a tela o cobra. Cair para a quantidade pedida seria repetir o erro em
 * silêncio, que é a única forma de ele voltar.
 *
 * A EMBALAGEM É DO ENVIO, NÃO DA PEÇA. `ceil(peças entregues / capacidade)` — 51 itens em
 * envelope de 50 dão 2 envelopes. Ela entra como uma linha própria, depois das peças, e só quando
 * nada está pendente de envio: com metade do pedido informado o número sairia de um envio parcial
 * e ficaria congelado errado. Componentes não ocupam lugar — o QR viaja colado no display.
 *
 * ARREDONDA UMA VEZ, NO FIM. `unitCost` devolve fração de centavo de propósito; a linha é onde
 * ela vira inteiro, depois de multiplicada pela quantidade. Arredondar antes faria 600 etiquetas
 * de 16,67 centavos custarem R$ 102 em vez de R$ 100.
 *
 * A TAXA PADRÃO NÃO ENTRA NO CUSTO UNITÁRIO. Ela viaja em `standardCostCents`, coluna própria,
 * até a tela — que mostra os dois lado a lado. É o que permite dar preço à impressora sem
 * rateá-la por cliente, e `finance-profitability.test.ts` trava isso.
 *
 * Puro: sem fetch, sem Supabase, sem React. Provado por `tests/api/finance-consumption.test.ts`.
 */

import type { MaterialColumnId } from '@/lib/materials/order-queue'
import type { MaterialOrderItem } from '@/lib/services/material-order-service'
import type { MaterialKind } from '@/lib/partner-form/fields'
import {
  productById,
  productForMaterialKind,
  type ConsumptionReason,
  type FinanceProduct,
} from './catalog'
import { resolveRecipe, type OrderRecipeOverride, type RecipeLine } from './recipe'
import { standardRateFor, unitCost, type FinancePurchase, type StandardRate } from './unit-cost'
import { currentPackaging, packagesFor, type PackagingRule } from './packaging'

/** Os dois estados em que a peça já foi produzida. `requested` e `in_preparation` não custaram. */
export const CONSUMING_STATUSES = ['dispatched', 'fulfilled'] as const
export type ConsumingStatus = (typeof CONSUMING_STATUSES)[number]

export function consumesCost(status: MaterialColumnId): status is ConsumingStatus {
  return (CONSUMING_STATUSES as readonly MaterialColumnId[]).includes(status)
}

/**
 * O componente como ele valeu no dia, congelado.
 *
 * `unitCostCents` aqui é EXATO (pode ter fração), porque este é o registro de auditoria e não a
 * coluna de dinheiro. É o que permite reconferir um total meses depois de a receita mudar.
 */
export interface ConsumptionComponentSnapshot {
  productId: string
  quantityPerUnit: number
  unitCostCents: number | null
  currency: string | null
  source: 'override' | 'recipe'
}

export interface ConsumptionLine {
  productId: string
  /** Peças entregues. */
  quantity: number
  /** POR PEÇA, arredondado. `null` quando não há compra — e `null` não é zero. */
  unitCostCents: number | null
  /** TOTAL da linha (todas as peças), arredondado. */
  componentCostCents: number
  /** TOTAL da linha, arredondado. Nunca somado dentro do custo direto. */
  standardCostCents: number
  components: ConsumptionComponentSnapshot[]
  currency: string
  reason: ConsumptionReason
  /** Moedas encontradas e não somadas. Vazio no caso normal; a tela avisa quando não é. */
  ignoredCurrencies: string[]
}

export interface ConsumptionPlan {
  lines: ConsumptionLine[]
  /** Tipos pedidos sem produto no catálogo. Não viram custo zero: viram cadastro pendente. */
  skipped: MaterialKind[]
  /** Produtos consumidos sem nenhuma compra registrada. A tela conta como pendência. */
  unpriced: string[]
  /**
   * Produtos deste pedido sem quantidade enviada informada. Nenhum custo é lançado sobre eles —
   * é a pendência que substitui a suposição de que o pedido saiu inteiro.
   */
  awaitingShipment: string[]
}

/** Uma linha de `finance.order_shipment` — o que saiu, por pedido e produto. */
export interface OrderShipment {
  orderId: string
  productId: string
  quantity: number
}

export interface ConsumptionInput {
  orderId: string
  items: readonly MaterialOrderItem[]
  products: readonly FinanceProduct[]
  purchases: readonly FinancePurchase[]
  recipes: readonly RecipeLine[]
  overrides: readonly OrderRecipeOverride[]
  rates: readonly StandardRate[]
  /** O que REALMENTE saiu, por produto. Item sem linha aqui não vira custo. */
  shipments: readonly OrderShipment[]
  /** A embalagem do envio — `ceil(peças / capacidade)`. Vazio quando não há regra vigente. */
  packaging?: readonly PackagingRule[]
  /** `YYYY-MM-DD` do dia do consumo. No backfill, o dia em que o pedido de fato saiu. */
  at: string
  reason?: ConsumptionReason
}

/**
 * As linhas de custo de UM pedido, com tudo já decidido e congelado.
 *
 * Nada aqui escreve nem lê banco: o serviço junta os dados, esta função decide, e a RPC grava o
 * que ela devolveu. É o que torna a regra inteira demonstrável sem subir Postgres.
 */
export function planConsumption(input: ConsumptionInput): ConsumptionPlan {
  const { orderId, products, purchases, recipes, overrides, rates, at } = input
  const reason = input.reason ?? 'first_delivery'

  const lines: ConsumptionLine[] = []
  const skipped: MaterialKind[] = []
  const unpriced: string[] = []
  const awaitingShipment: string[] = []

  for (const item of input.items) {
    if (item.quantity <= 0) continue

    const product = productForMaterialKind(products, item.kind)
    // Sem produto no catálogo não há como nomear o custo. Devolvido para a tela apontar o
    // cadastro que falta — o silêncio aqui viraria um parceiro barato por engano.
    if (!product) {
      skipped.push(item.kind)
      continue
    }

    // O QUE SAIU, e nada de cair para o que foi pedido. Sem a linha, o item fica pendente.
    const shipped = input.shipments.find(
      (entry) => entry.orderId === orderId && entry.productId === product.id
    )
    if (!shipped) {
      awaitingShipment.push(product.id)
      continue
    }
    // Zero enviado é uma resposta e não uma linha de custo: não há peça para custear.
    if (shipped.quantity <= 0) continue

    const own = unitCost(purchases, product, at)
    if (!own && !unpriced.includes(product.id)) unpriced.push(product.id)

    const components = resolveRecipe(recipes, overrides, orderId, product.id, at)
    const snapshots: ConsumptionComponentSnapshot[] = []
    const ignored = new Set<string>(own?.ignoredCurrencies ?? [])

    // A moeda da linha é a do entregável; sem compra dele, a do primeiro componente que tiver
    // uma. `BRL` é o último recurso e só alcança linha sem preço nenhum, onde não soma nada.
    let currency = own?.currency ?? null
    const componentCosts: { cents: number; currency: string; quantityPerUnit: number }[] = []

    for (const component of components) {
      const componentProduct = productById(products, component.componentProductId)
      const cost = componentProduct ? unitCost(purchases, componentProduct, at) : null
      if (componentProduct && !cost && !unpriced.includes(componentProduct.id)) {
        unpriced.push(componentProduct.id)
      }
      if (cost) {
        for (const other of cost.ignoredCurrencies) ignored.add(other)
        if (!currency) currency = cost.currency
        componentCosts.push({
          cents: cost.centsExact,
          currency: cost.currency,
          quantityPerUnit: component.quantity,
        })
      }
      snapshots.push({
        productId: component.componentProductId,
        quantityPerUnit: component.quantity,
        unitCostCents: cost ? cost.centsExact : null,
        currency: cost ? cost.currency : null,
        source: component.source,
      })
    }

    const lineCurrency = currency ?? 'BRL'

    let componentExact = 0
    for (const cost of componentCosts) {
      if (cost.currency !== lineCurrency) {
        ignored.add(cost.currency)
        continue
      }
      componentExact += cost.cents * cost.quantityPerUnit
    }

    // A taxa padrão do entregável vale por peça; a de cada componente, por componente por peça.
    let standardExact = 0
    const ownRate = standardRateFor(rates, product.id, at)
    if (ownRate) {
      if (ownRate.currency === lineCurrency) standardExact += ownRate.amountCents
      else ignored.add(ownRate.currency)
    }
    for (const component of components) {
      const rate = standardRateFor(rates, component.componentProductId, at)
      if (!rate) continue
      if (rate.currency === lineCurrency) standardExact += rate.amountCents * component.quantity
      else ignored.add(rate.currency)
    }

    lines.push({
      productId: product.id,
      quantity: shipped.quantity,
      unitCostCents: own ? Math.round(own.centsExact) : null,
      componentCostCents: Math.round(componentExact * shipped.quantity),
      standardCostCents: Math.round(standardExact * shipped.quantity),
      components: snapshots,
      currency: lineCurrency,
      reason,
      ignoredCurrencies: Array.from(ignored).sort(),
    })
  }

  // ── A EMBALAGEM, DEPOIS DAS PEÇAS ───────────────────────────────────────────────────────────
  //
  // Ela é do ENVIO e não da peça: `ceil(peças entregues / capacidade)`. Só entra quando NADA está
  // pendente de envio — com metade do pedido informado, o número de envelopes seria calculado
  // sobre um envio parcial e congelado errado, e o `unique (order_id, product_id)` impediria a
  // correção quando o resto chegasse.
  const shippedPieces = lines.reduce((sum, line) => sum + line.quantity, 0)

  if (awaitingShipment.length === 0 && shippedPieces > 0) {
    for (const rule of currentPackaging(input.packaging ?? [], at)) {
      const quantity = packagesFor(shippedPieces, rule.capacity)
      if (quantity <= 0) continue

      const packageProduct = productById(products, rule.productId)
      const cost = packageProduct ? unitCost(purchases, packageProduct, at) : null
      if (packageProduct && !cost && !unpriced.includes(packageProduct.id)) {
        unpriced.push(packageProduct.id)
      }

      lines.push({
        productId: rule.productId,
        quantity,
        unitCostCents: cost ? Math.round(cost.centsExact) : null,
        // A embalagem não leva componente nem taxa de impressão: ela é a caixa, não a peça.
        componentCostCents: 0,
        standardCostCents: 0,
        components: [],
        currency: cost?.currency ?? 'BRL',
        reason,
        ignoredCurrencies: cost?.ignoredCurrencies ?? [],
      })
    }
  }

  return { lines, skipped, unpriced, awaitingShipment }
}

/**
 * O custo direto de uma linha já gravada — peças × unitário, mais os componentes.
 *
 * UMA função, lida pelo total do cliente e pelo detalhe da linha, para que os dois não possam
 * discordar. A taxa padrão NÃO entra: ela é estrutura vestida de número por peça, e o custo
 * direto é o que decide sobre o parceiro.
 */
export function lineDirectCostCents(line: {
  quantity: number
  unitCostCents: number | null
  componentCostCents: number
}): number | null {
  if (line.unitCostCents === null) return null
  return line.quantity * line.unitCostCents + line.componentCostCents
}
