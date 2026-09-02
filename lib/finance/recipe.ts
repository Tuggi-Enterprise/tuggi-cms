/**
 * A RECEITA — quantos componentes cada peça entregue leva, e quem manda quando os dois falam.
 *
 * DUAS FONTES, UMA ORDEM, E ELA NUNCA MUDA: o ajuste do pedido ganha do padrão vigente. O padrão
 * responde por todo pedido sem que ninguém digite nada; o ajuste existe para o envio que fugiu —
 * "este lote de displays saiu com 3 QR em vez de 2". Se a ordem fosse a inversa, o ajuste seria
 * um campo que o operador preenche e o sistema ignora, que é a pior forma de não ter o campo.
 *
 * A VIGÊNCIA É O QUE IMPEDE O DEFEITO CARO. Mudar a receita de 2 para 3 QR por display não pode
 * reescrever o custo do que já saiu pela porta. Duas coisas garantem isso e elas são
 * independentes: a linha de consumo CONGELA o que valeu no dia (`material_consumption`), e esta
 * função escolhe o padrão por `effectiveFrom <= at` em vez de ler o último cadastrado. A
 * primeira protege o passado já gravado; a segunda protege o backfill, que roda hoje sobre
 * pedidos de meses atrás.
 *
 * ZERO É RESPOSTA, AUSÊNCIA NÃO É. Um override com `quantity: 0` diz "este lote saiu sem QR" e é
 * um fato; a ausência de override diz "use o padrão" e é outro. Um default zero fundiria os dois
 * e faria todo pedido sem ajuste sair sem componente — o custo do QR sumiria da conta inteira
 * sem nenhuma tela ficar vermelha.
 *
 * Puro: sem fetch, sem Supabase, sem React. Provado por `tests/api/finance-recipe.test.ts`.
 */

export interface RecipeLine {
  parentProductId: string
  componentProductId: string
  quantity: number
  /** `YYYY-MM-DD`. Comparado como string: ISO ordena lexicograficamente. */
  effectiveFrom: string
}

export interface OrderRecipeOverride {
  orderId: string
  parentProductId: string
  componentProductId: string
  quantity: number
}

export interface ResolvedComponent {
  componentProductId: string
  /** Quantidade POR PEÇA entregue, não por pedido. */
  quantity: number
  /** Quem respondeu. A tela mostra o ajuste como ajuste, e não como se fosse o padrão. */
  source: 'override' | 'recipe'
}

/**
 * O padrão vigente de um par (entregável, componente) na data `at`.
 *
 * O de maior `effectiveFrom` que não seja futuro. Empate é impossível: o `unique` de
 * `finance.product_recipe` cobre exatamente (parent, component, effective_from).
 */
function currentRecipeQuantity(
  recipes: readonly RecipeLine[],
  parentProductId: string,
  componentProductId: string,
  at: string
): number | null {
  let winner: RecipeLine | null = null
  for (const line of recipes) {
    if (line.parentProductId !== parentProductId) continue
    if (line.componentProductId !== componentProductId) continue
    if (line.effectiveFrom > at) continue
    if (!winner || line.effectiveFrom > winner.effectiveFrom) winner = line
  }
  return winner ? winner.quantity : null
}

/**
 * O que uma peça deste entregável consome, neste pedido, nesta data.
 *
 * O UNIVERSO É A UNIÃO DAS DUAS FONTES, e isso é deliberado: um override pode nomear um
 * componente que o padrão não tem — "este lote levou um adesivo extra que normalmente não vai" —
 * e partir apenas do padrão perderia essa linha em silêncio.
 *
 * Componentes com quantidade final zero SAEM da lista. Eles já responderam: a resposta é que
 * esta peça não os leva, e uma linha de custo zero no snapshot seria ruído que alguém teria de
 * reinterpretar toda vez que lesse a auditoria.
 *
 * A ordem é alfabética por id, e não a ordem em que os dados vieram. Uma lista cuja ordem muda
 * entre duas leituras dos mesmos dados é uma lista que alguém tem de reler — a mesma razão pela
 * qual `sortedItems` reordena as linhas do pedido em `material-order-service.ts`.
 */
export function resolveRecipe(
  recipes: readonly RecipeLine[],
  overrides: readonly OrderRecipeOverride[],
  orderId: string,
  parentProductId: string,
  at: string
): ResolvedComponent[] {
  const applicable = overrides.filter(
    (override) => override.orderId === orderId && override.parentProductId === parentProductId
  )

  const componentIds = new Set<string>()
  for (const line of recipes) {
    if (line.parentProductId === parentProductId && line.effectiveFrom <= at) {
      componentIds.add(line.componentProductId)
    }
  }
  for (const override of applicable) componentIds.add(override.componentProductId)

  const resolved: ResolvedComponent[] = []
  for (const componentProductId of componentIds) {
    const override = applicable.find((line) => line.componentProductId === componentProductId)
    if (override) {
      if (override.quantity > 0) {
        resolved.push({ componentProductId, quantity: override.quantity, source: 'override' })
      }
      continue
    }
    const quantity = currentRecipeQuantity(recipes, parentProductId, componentProductId, at)
    if (quantity !== null && quantity > 0) {
      resolved.push({ componentProductId, quantity, source: 'recipe' })
    }
  }

  return resolved.sort((a, b) => a.componentProductId.localeCompare(b.componentProductId))
}
