/**
 * O CUSTO POR PEÇA — derivado da compra, nunca digitado.
 *
 * A ÚNICA COISA QUE ALGUÉM TEM EM MÃOS É A NOTA. O operador sabe "comprei 2 bobinas por R$ 180"
 * e "comprei 250 displays por R$ X"; ele não sabe, e não deveria precisar calcular, quanto custa
 * uma etiqueta. Por isso não existe coluna de preço unitário em lugar nenhum do schema: o preço
 * unitário é uma CONTA, e uma conta guardada ao lado dos seus insumos é a promessa de que um dia
 * os dois vão discordar.
 *
 * AS PEÇAS VÊM DA COMPRA, NÃO DO PRODUTO. `purchase.pieces` é `units × unitsYield` calculado
 * pelo banco, e o rendimento cadastrado no produto não participa de conta nenhuma — ele apenas
 * sugere um valor no formulário. Era o contrário até 2026-09-01, e por isso "300 adesivos"
 * digitados viraram 45.000: o número tinha dois donos distantes um do outro.
 *
 * MÉDIA PONDERADA E NÃO FIFO POR LOTE, deliberadamente. FIFO exigiria saldo por lote e uma tabela
 * de movimento para responder a mesma pergunta com uma precisão que ninguém vai auditar. A única
 * propriedade do FIFO que importa aqui — uma compra nova não reescrever o custo do que já saiu —
 * é obtida de graça porque a linha de consumo CONGELA o custo do dia (`material_consumption`).
 *
 * NÃO ARREDONDA. `centsExact` sai fracionário de propósito: uma bobina de R$ 50 que rende 300
 * etiquetas dá 16,67 centavos por etiqueta, e arredondar aqui para 17 antes de multiplicar por
 * 600 etiquetas erra o total em R$ 2. Quem arredonda é a linha, uma vez, no fim
 * (`planConsumption`). A coluna do banco é inteira; a conta, não.
 *
 * MOEDA NUNCA SE CONVERTE. Há parceiros com NIF/NIPC/VAT no cadastro, então uma compra em EUR é
 * questão de tempo. A média é calculada sobre a moeda da compra MAIS RECENTE — que é a moeda em
 * que estamos comprando hoje — e as outras voltam nomeadas em `ignoredCurrencies`, para a tela
 * dizer que ignorou em vez de silenciar. Inventar uma taxa de câmbio seria fazer o custo
 * histórico depender de quando alguém atualizou a taxa.
 *
 * Puro: sem fetch, sem Supabase, sem React. Provado por `tests/api/finance-unit-cost.test.ts`.
 */

import type { FinanceProduct } from './catalog'

export interface FinancePurchase {
  id: string
  productId: string
  /** Unidades de compra: 2 rolos, 250 displays. */
  units: number
  /** Peças que CADA unidade rendeu, congelado no dia da compra. */
  unitsYield: number
  /**
   * `units × unitsYield`, calculado pelo banco (coluna gerada).
   *
   * Vem pronto e não é recalculado aqui de propósito: a conta tem uma resposta só, e uma segunda
   * cópia dela é a promessa de que um dia as duas discordam. Em 2026-09-01 a multiplicação morava
   * do lado errado — o rendimento vinha do PRODUTO — e uma compra de 300 adesivos virou 45.000.
   */
  pieces: number
  totalCents: number
  freightCents: number
  currency: string
  /** `YYYY-MM-DD`. Comparado como string: ISO ordena lexicograficamente. */
  purchasedAt: string
}

export interface UnitCost {
  /**
   * Custo exato por peça, em centavos, NÃO arredondado. Arredonde uma vez, no fim da linha.
   */
  centsExact: number
  currency: string
  /** Moedas encontradas e deliberadamente ignoradas. Vazio no caso normal. */
  ignoredCurrencies: string[]
  /** Quantas compras responderam. Uma média sobre uma compra só continua sendo a resposta. */
  purchases: number
  /** Peças que essas compras entregaram — o denominador, e o numerador do KPI de estoque. */
  pieces: number
}

/**
 * O custo por peça deste produto, considerando as compras até `at`.
 *
 * `null` QUANDO NÃO HÁ COMPRA, e `null` não é zero. Um pedido consumido antes de a compra ser
 * cadastrada não custou nada de graça — ele custou algo que ninguém registrou ainda, e a linha
 * entra com `unit_cost_cents` nulo para a tela contar como pendência. É a mesma leitura que
 * `pendingWithoutDestination` faz do pedido sem endereço em `summarizeMaterialQueue`, e a mesma
 * que BR-B2B-017, item 6, faz de `monthly_fee_cents`: ausente NÃO é zero.
 *
 * `at` é `YYYY-MM-DD` e a comparação é `<=`: uma compra feita HOJE custeia o que sai hoje.
 */
export function unitCost(
  purchases: readonly FinancePurchase[],
  product: FinanceProduct,
  at: string
): UnitCost | null {
  const eligible = purchases.filter(
    (purchase) => purchase.productId === product.id && purchase.purchasedAt <= at
  )
  if (eligible.length === 0) return null

  // A moeda em que estamos comprando é a da compra mais recente. Empate de data resolve pela
  // ordem em que vieram, que é estável porque o serviço lê `order by purchased_at`.
  const currency = eligible.reduce((latest, purchase) =>
    purchase.purchasedAt >= latest.purchasedAt ? purchase : latest
  ).currency

  const sameCurrency = eligible.filter((purchase) => purchase.currency === currency)
  const ignoredCurrencies = Array.from(
    new Set(eligible.filter((p) => p.currency !== currency).map((p) => p.currency))
  ).sort()

  let cents = 0
  let pieces = 0
  for (const purchase of sameCurrency) {
    cents += purchase.totalCents + purchase.freightCents
    pieces += purchase.pieces
  }

  // Os CHECK de `units > 0` e `units_yield > 0` tornam este zero inalcançável por dado válido.
  // Ele responde assim mesmo: uma divisão por zero aqui viraria `Infinity` e viajaria calada até
  // um total na tela.
  if (pieces <= 0) return null

  return {
    centsExact: cents / pieces,
    currency,
    ignoredCurrencies,
    purchases: sameCurrency.length,
    pieces,
  }
}

/**
 * A taxa padrão vigente para um produto — o valor simbólico de impressão.
 *
 * SEPARADA DO CUSTO UNITÁRIO E ASSIM PERMANECE. Ela é `standard costing`: um número que dá preço
 * à impressora sem rateá-la por cliente. Somá-la dentro de `unitCost` faria o custo direto do
 * parceiro carregar estrutura, que é precisamente a distorção que a camada MC I existe para
 * evitar. Ela viaja em coluna própria até a tela, e a tela mostra os dois lado a lado.
 */
export interface StandardRate {
  rateId: string
  /** `finance.products.id` ao qual a taxa se aplica. */
  appliesTo: string
  amountCents: number
  currency: string
  effectiveFrom: string
}

export function standardRateFor(
  rates: readonly StandardRate[],
  productId: string,
  at: string
): StandardRate | null {
  const eligible = rates
    .filter((rate) => rate.appliesTo === productId && rate.effectiveFrom <= at)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
  return eligible.length > 0 ? eligible[eligible.length - 1] : null
}
