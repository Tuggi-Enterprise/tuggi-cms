/**
 * A EMBALAGEM — o custo que é do ENVIO, e não da peça.
 *
 * *"sempre terá pelo menos 1 envelope, com limite de 50 itens. 51 itens, 2 envelopes."*
 * (operador, 2026-09-01)
 *
 * POR QUE NÃO É UMA RECEITA. `recipe.ts` diz quanto CADA PEÇA leva junto — 1 QR por display — e a
 * conta é por peça. O envelope embala o pedido inteiro e sobe em degrau. Cadastrá-lo como receita
 * significaria 1/50 = 0,02 envelope por display, e 10 displays consumiriam 0,2 envelope: um
 * número que não existe no mundo, num estoque que nunca fecharia com o que há na gaveta.
 *
 * O "PELO MENOS 1" NÃO É UMA REGRA À PARTE. `ceil` já entrega 1 para qualquer envio de 1 a 50
 * itens, e 0 só quando nada saiu — que é a resposta certa, porque pedido sem saída não gasta
 * envelope. Um `Math.max(1, ...)` aqui cobraria embalagem de um pedido que não foi enviado.
 *
 * SÓ PEÇAS ENTREGÁVEIS OCUPAM LUGAR. O QR code viaja colado no display; contá-lo encheria o
 * envelope com algo que não está solto dentro dele.
 *
 * Puro: sem fetch, sem Supabase, sem React. Provado por `tests/api/finance-packaging.test.ts`.
 */

export interface PackagingRule {
  /** O produto que É a embalagem — `component` no catálogo. */
  productId: string
  /** Quantas peças entregues cabem em UMA embalagem. */
  capacity: number
  /** `YYYY-MM-DD`. Comparado como string: ISO ordena lexicograficamente. */
  effectiveFrom: string
}

/**
 * As regras vigentes em `at` — uma por produto de embalagem, a de maior `effectiveFrom` que não
 * seja futura.
 *
 * DUAS REGRAS DE PRODUTOS DIFERENTES VALEM JUNTAS, e isso é intencional: um envio pode levar um
 * envelope E uma caixa. O que não pode é a mesma embalagem valer com duas capacidades no mesmo
 * dia, e o `unique (product_id, effective_from)` do banco cuida disso.
 *
 * A ordem é por id, e não a de chegada: uma lista cuja ordem muda entre duas leituras dos mesmos
 * dados é uma lista que alguém tem de reler.
 */
export function currentPackaging(
  rules: readonly PackagingRule[],
  at: string
): PackagingRule[] {
  const winners = new Map<string, PackagingRule>()
  for (const rule of rules) {
    if (rule.effectiveFrom > at) continue
    const current = winners.get(rule.productId)
    if (!current || rule.effectiveFrom > current.effectiveFrom) winners.set(rule.productId, rule)
  }
  return Array.from(winners.values()).sort((a, b) => a.productId.localeCompare(b.productId))
}

/**
 * Quantas embalagens um envio de `pieces` peças gasta.
 *
 * `ceil`, e nada mais: 50 peças cabem em 1 envelope, 51 pedem 2, e 0 peça não pede nenhum.
 * Capacidade inválida devolve 0 em vez de dividir por zero — o CHECK do banco torna isso
 * inalcançável por dado válido, mas uma divisão por zero viajaria como `Infinity` até um total.
 */
export function packagesFor(pieces: number, capacity: number): number {
  if (pieces <= 0 || capacity <= 0) return 0
  return Math.ceil(pieces / capacity)
}
