/**
 * O CATÁLOGO DO FINANCEIRO — o produto, o rendimento, e o ponteiro para a esteira.
 *
 * POR QUE UM CATÁLOGO E NÃO UMA CONSTANTE. `MATERIAL_KINDS` é o vocabulário do que o parceiro
 * PEDE, e ele tem três palavras porque o formulário público faz três perguntas. O que o custo
 * precisa saber é maior: o QR code não é pedido por ninguém e mesmo assim custa dinheiro; uma
 * bobina rende N etiquetas; uma caixa rende N displays. Nada disso cabe numa lista de três
 * strings, e forçá-lo ali quebraria a proposta pública para responder a uma pergunta de custo.
 *
 * O VOCABULÁRIO DA ESTEIRA NÃO É REESCRITO AQUI. `materialKind` aponta para `MATERIAL_KINDS`, que
 * continua sendo o dono — `lib/partner-form/fields.ts`. Uma segunda cópia dos três nomes é
 * exatamente o defeito que o CHECK de `material_orders` e o `MATERIAL_COLUMNS` de
 * `order-queue.ts` evitam ao se lerem em vez de se repetirem (SSOT antes de DRY, CLAUDE.md §6).
 *
 * O RENDIMENTO NÃO ESTÁ AQUI, E A AUSÊNCIA É A CORREÇÃO. Ele foi propriedade do produto até
 * 2026-09-01, e foi assim que 300 adesivos digitados viraram 45.000 etiquetas: o número tinha
 * dois donos distantes um do outro. Hoje ele é fato da COMPRA (`purchases.units_yield`),
 * congelado no dia — o rolo de 150 de hoje não pode reinterpretar o rolo de 200 de amanhã — e o
 * formulário sugere o da última compra em vez de ler um cadastro que envelhece.
 *
 * Puro: sem fetch, sem Supabase, sem React. Provado por `tests/api/finance-unit-cost.test.ts`.
 */

import { MATERIAL_KINDS, type MaterialKind } from '@/lib/partner-form/fields'

/**
 * O que o produto É na conta.
 *
 * `deliverable` vai para o parceiro e aparece na esteira; `component` é consumido por um
 * deliverable através da receita e nunca é pedido. A separação é o que torna o QR code
 * custeável — sem ela, ele teria de virar um quarto `MaterialKind` e apareceria como opção no
 * formulário do parceiro, que é onde ele não deve estar.
 */
export const PRODUCT_ROLES = ['deliverable', 'component'] as const
export type ProductRole = (typeof PRODUCT_ROLES)[number]

/**
 * Por que a peça saiu. Separa custo de crescimento de custo de retrabalho.
 *
 * A esteira trata reposição como um pedido novo e indistinguível de uma primeira entrega
 * (`createMaterialOrder`, `source: 'cms'`), o que é correto para a operação e cego para o custo:
 * dez displays reimpressos porque chegaram quebrados não são dez parceiros novos.
 */
export const CONSUMPTION_REASONS = ['first_delivery', 'replacement', 'loss', 'gift'] as const
export type ConsumptionReason = (typeof CONSUMPTION_REASONS)[number]

export interface FinanceProduct {
  id: string
  name: string
  role: ProductRole
  /** `null` em todo `component` — ninguém pede um QR code na esteira. */
  materialKind: MaterialKind | null
  /** Rótulo de nota fiscal: `unidade`, `bobina`, `caixa`. Nenhuma regra depende do texto. */
  purchaseUnit: string
  isActive: boolean
}

/**
 * O produto que responde por um tipo da esteira.
 *
 * Devolve `null` quando ninguém cadastrou o produto daquele tipo, e o chamador é obrigado a
 * lidar com isso: um pedido de display de mesa sem produto correspondente não vira custo zero,
 * vira um pedido que a tela precisa apontar. `planConsumption` o devolve em `skipped` por
 * exatamente esse motivo.
 *
 * O índice único de `finance.products.material_kind` é o que garante que este `find` não esteja
 * escolhendo entre dois candidatos — a ambiguidade é refusada no banco, não desempatada aqui.
 */
export function productForMaterialKind(
  products: readonly FinanceProduct[],
  kind: MaterialKind
): FinanceProduct | null {
  return products.find((product) => product.materialKind === kind) ?? null
}

export function productById(
  products: readonly FinanceProduct[],
  id: string
): FinanceProduct | null {
  return products.find((product) => product.id === id) ?? null
}

/** Os tipos da esteira que ainda não têm produto no catálogo — a lista de cadastro pendente. */
export function unmappedMaterialKinds(products: readonly FinanceProduct[]): MaterialKind[] {
  return MATERIAL_KINDS.filter((kind) => productForMaterialKind(products, kind) === null)
}

/**
 * Quantas peças uma compra de `units` unidades entrega, com um rendimento de `unitsYield`.
 *
 * É AJUDANTE DE FORMULÁRIO, E NÃO PARTICIPA DE CUSTO NENHUM. O total de peças de uma compra é
 * `finance.purchases.pieces`, coluna GERADA pelo banco, e é ela que `unitCost` e o KPI de estoque
 * leem. Esta função existe para a tela mostrar "2 × 150 = 300 peças" enquanto a pessoa digita —
 * a prévia que faltava quando 300 adesivos viraram 45.000 em silêncio (2026-09-01).
 */
export function piecesFrom(units: number, unitsYield: number): number {
  return units * unitsYield
}
