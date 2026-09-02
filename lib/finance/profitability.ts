/**
 * O VEREDITO — este parceiro se paga?
 *
 * A CONTA QUE DECIDE É A MARGEM DE CONTRIBUIÇÃO, E ELA É MARGINAL DE PROPÓSITO. A pergunta
 * "vale a pena manter este parceiro?" é uma decisão marginal, e decisão marginal se toma com
 * receita menos custo VARIÁVEL — nunca com custo total absorvido. A impressora de etiquetas não
 * fica mais barata se cortarmos um parceiro, então rateá-la por cliente produziria um número que
 * não serve para decidir sobre cliente nenhum. Por isso `finance.fixed_costs` não tem
 * `client_id` e por isso `standardCostCents` viaja AO LADO do custo direto, nunca dentro:
 *
 *   MC I  = receita do parceiro − custo direto do parceiro      ← decide o PARCEIRO (aqui)
 *   MC II = Σ MC I − custos fixos da operação                   ← decide a OPERAÇÃO (structure.ts)
 *
 * SEIS VEREDITOS, E A ORDEM DELES É A MENSAGEM. `uncosted` e `undated` respondem ANTES dos
 * demais pelo mesmo motivo que `planMaterialMove` ordena as recusas em `order-queue.ts`: "não
 * sei" e "não rendeu" mandam o operador para dois atos completamente diferentes, e um veredito
 * que os funde manda todo mundo para o errado.
 *
 * A RECEITA DAS COMPRAS DO APP NÃO ENTRA NO NÚMERO EM REAIS, e isso é declarado e não esquecido.
 * O ledger `drive.time_credit_grants` guarda MINUTOS; o catálogo de preços é
 * `drive.product_grant_map` e vive fora deste repositório (BR-MONETIZACAO-048). Então
 * `usersWithPurchase` e `purchasedMinutes` chegam como CONTAGEM e assim ficam. Somar zero ali
 * transformaria "não sei quanto ele rendeu" em "ele não rendeu nada" — a mentira mais cara que
 * este módulo poderia contar, e a razão de `non_monetary_return` existir como veredito próprio.
 *
 * Puro: sem fetch, sem Supabase, sem React. Provado por `tests/api/finance-profitability.test.ts`.
 */

import type { PaymentStance } from '@/lib/clients/partner-plan'

export type FinanceVerdict =
  /**
   * O custo deste parceiro está incompleto — e por dois motivos possíveis, ambos honestos:
   * há material consumido sem compra cadastrada, ou há pedido despachado sem ninguém ter
   * informado quanto realmente saiu. Nos dois casos todo total dele é um piso, não um fato.
   */
  | 'uncosted'
  /** Sem data de início: sabe-se o custo, não por quantos meses ele cobra. */
  | 'undated'
  /** Não paga E não trouxe usuário que comprou. O "só prejuízo". */
  | 'no_return'
  /**
   * Não paga, e NÃO SE SABE se trouxe quem comprasse.
   *
   * Existe porque a leitura que separa `no_return` de `non_monetary_return` pode não responder:
   * `drive.time_credit_grants` nega SELECT até ao `service_role` (medido em 2026-09-01), e o
   * único caminho até ela é uma RPC que ainda não existe com escopo por parceiro. Sem este
   * veredito, um parceiro não pagante seria acusado de prejuízo por causa de uma permissão —
   * e a acusação pareceria um fato apurado.
   */
  | 'unknown_return'
  /** Não paga, mas trouxe usuário que comprou. Retorno real que o CMS não sabe medir em reais. */
  | 'non_monetary_return'
  /** Paga, e o acumulado ainda não cobriu o custo. */
  | 'payback_pending'
  /** Paga, e o acumulado já cobriu o custo. */
  | 'profitable'

/** Uma linha de consumo já gravada, como o serviço a lê de volta. */
export interface ConsumptionRecord {
  productId: string
  quantity: number
  unitCostCents: number | null
  componentCostCents: number
  standardCostCents: number
  currency: string
  /**
   * O que cada peça levou de componente, congelado. Lido pelo KPI de estoque para saber quantas
   * etiquetas saíram — elas nunca aparecem em `quantity`, que conta só o entregável.
   */
  components?: readonly { productId: string; quantityPerUnit: number }[]
}

export interface CostEntryRecord {
  amountCents: number
  currency: string
}

/**
 * Tudo que o veredito precisa de UM parceiro. Um subconjunto, para o teste montar um à mão sem
 * banco — o mesmo formato que `PlanFacts` usa em `partner-plan.ts`.
 */
export interface ClientFinanceFacts {
  clientId: string
  clientName: string
  /** `partner.clients.approved_at`, `YYYY-MM-DD` ou ISO. `null` é o que produz `undated`. */
  approvedAt: string | null
  /** Decidido por `derivePartnerPlan`, nunca por uma comparação local. */
  stance: PaymentStance
  /** `partner.clients.monthly_fee_cents`. Ausente NÃO é zero — BR-B2B-017, item 6. */
  monthlyFeeCents: number | null
  consumption: readonly ConsumptionRecord[]
  costEntries: readonly CostEntryRecord[]
  /**
   * Pedidos já despachados sem quantidade enviada informada.
   *
   * Não viram custo: supor que saiu o que foi pedido é o erro que `finance.order_shipment`
   * existe para impedir. Enquanto houver um, o custo deste parceiro é um piso.
   */
  ordersAwaitingShipment: number
  /** Chegaram pelo QR do parceiro — `drive.profiles.partner_id`. Isto é aquisição. */
  linkedByPartnerId: number
  /** São da equipe do estabelecimento — `drive.profiles.client_id`. Isto NÃO é aquisição. */
  linkedByClientId: number
  /**
   * Quantos dos adquiridos já compraram. Contagem: não existe valor em reais disto.
   * `null` significa que a leitura não respondeu — e `null` NÃO é zero: é o que separa
   * `unknown_return` de `no_return`.
   */
  usersWithPurchase: number | null
  /** Minutos comprados pelos adquiridos. `null` quando a leitura não respondeu. */
  purchasedMinutes: number | null
  /**
   * As duas colunas acima passaram pelo piso de k e o que sobrou delas é PISO, não fato.
   *
   * Quem aplica é `suppressSmallCohortPurchases`, no servidor. Chega aqui só para a tela poder
   * escrever `≥ 1` em vez de `1` — um piso vestido de fato é a única coisa que este módulo não
   * pode dizer por engano.
   */
  purchaseSuppressed?: boolean
}

/** O k de `suppressSmallCohortPurchases`. O mesmo de `core.coordinator_city_breakdown`. */
export const PURCHASE_MIN_COHORT = 5

/**
 * O piso de k-anonimato das colunas de compra.
 *
 * "AGREGADO" NÃO É "ANÔNIMO" QUANDO N É PEQUENO. Um parceiro com 1 usuário adquirido e 1
 * comprador não publica uma estatística: publica a compra de UMA pessoa identificável, ao lado
 * do nome do bar onde ela esteve. `core.coordinator_city_breakdown` já enfrentou exatamente
 * isso e resolveu com k=5 — este é o mesmo piso, sobre o mesmo tipo de dado.
 *
 * O QUE SOBREVIVE E POR QUÊ. `usersWithPurchase` colapsa em `0` / `≥1` e os minutos somem. Não é
 * arbitrário: `decide()` lê desta coluna APENAS o booleano `> 0`, então o veredito sai idêntico
 * com o valor colapsado — nenhum parceiro muda de julgamento por causa do piso. Os minutos, ao
 * contrário, são a coluna que mais identifica e a única que não decide nada em lugar nenhum.
 *
 * SÓ SUPRIME O QUE HÁ PARA ESCONDER. Com `usersWithPurchase` em `0` não existe pessoa exposta, e
 * marcar essa linha como suprimida faria o total da tela virar piso sem que nada tivesse sido
 * escondido. Com `null`, a leitura não respondeu e não há o que suprimir — `null` continua sendo
 * ausência de leitura, nunca zero, nunca "omitido".
 */
export function suppressSmallCohortPurchases<T extends PurchaseCohort>(
  facts: T,
  k: number = PURCHASE_MIN_COHORT
): T & { purchaseSuppressed: boolean } {
  const hasSomethingToHide = facts.usersWithPurchase !== null && facts.usersWithPurchase > 0
  if (!hasSomethingToHide || facts.linkedByPartnerId >= k) {
    return { ...facts, purchaseSuppressed: false }
  }
  return {
    ...facts,
    usersWithPurchase: 1,
    purchasedMinutes: null,
    purchaseSuppressed: true,
  }
}

/** O mínimo que `suppressSmallCohortPurchases` precisa ler. */
export interface PurchaseCohort {
  linkedByPartnerId: number
  usersWithPurchase: number | null
  purchasedMinutes: number | null
}

export interface ClientProfitability {
  clientId: string
  clientName: string
  /** Repetido na saída para a coorte e o filtro de mês lerem a lista sem um segundo join. */
  approvedAt: string | null
  verdict: FinanceVerdict
  /** Moeda de tudo abaixo. Totais nunca cruzam moedas. */
  currency: string
  /** Custo variável do parceiro: material + componentes + avulsos. Decide o parceiro. */
  directCostCents: number
  /** A taxa simbólica de impressão, SEPARADA. Nunca somada em `directCostCents`. */
  standardCostCents: number
  /** Mensalidade × meses inteiros desde `approvedAt`. Zero quando não paga. */
  revenueCents: number
  /** MC I = receita − custo direto. Negativa é o normal no começo de uma parceria. */
  marginCents: number
  monthsBilled: number
  /** Meses de mensalidade para cobrir o custo. `null` quando não paga ou não custa. */
  paybackMonths: number | null
  /** Custo direto por usuário adquirido pelo QR. `null` com zero adquiridos — nunca infinito. */
  cacCents: number | null
  linkedByPartnerId: number
  linkedByClientId: number
  usersWithPurchase: number | null
  purchasedMinutes: number | null
  /**
   * As duas colunas acima são PISO, não fato — o parceiro tem menos de `PURCHASE_MIN_COHORT`
   * adquiridos e o valor foi colapsado. A tela escreve `≥ 1` quando isto é verdade.
   */
  purchaseSuppressed: boolean
  /** Linhas consumidas sem preço. Enquanto houver uma, o veredito é `uncosted`. */
  unpricedLines: number
  /** Pedidos despachados sem quantidade enviada. Mesma consequência, causa diferente. */
  ordersAwaitingShipment: number
  /** Moedas presentes nos lançamentos e não somadas. Vazio no caso normal. */
  ignoredCurrencies: string[]
}

/**
 * Meses INTEIROS decorridos entre duas datas.
 *
 * Inteiros, e não fração: a mensalidade é cobrada por mês, e contar 2,7 meses de receita seria
 * faturar um terço de mês que ninguém cobrou. Um parceiro aprovado ontem tem zero meses de
 * receita e é isso que deve aparecer — não uma fatia proporcional que faz o payback parecer
 * adiantado.
 */
export function wholeMonthsBetween(from: string, to: string): number {
  const start = new Date(from)
  const end = new Date(to)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0

  let months =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth())
  if (end.getUTCDate() < start.getUTCDate()) months -= 1
  return months > 0 ? months : 0
}

/**
 * O custo direto de um parceiro, na moeda dominante dos seus lançamentos.
 *
 * A MOEDA DOMINANTE É A MAIS FREQUENTE, e as outras voltam nomeadas em vez de somadas. Converter
 * exigiria uma taxa de câmbio, e uma taxa cadastrada faz o custo histórico depender de quando
 * alguém a atualizou pela última vez — o mesmo motivo pelo qual `unitCost` não converte.
 */
function directCost(facts: ClientFinanceFacts): {
  currency: string
  directCostCents: number
  standardCostCents: number
  unpricedLines: number
  ignoredCurrencies: string[]
} {
  const tally = new Map<string, number>()
  for (const line of facts.consumption) tally.set(line.currency, (tally.get(line.currency) ?? 0) + 1)
  for (const entry of facts.costEntries) tally.set(entry.currency, (tally.get(entry.currency) ?? 0) + 1)

  let currency = 'BRL'
  let best = -1
  // Empate resolve pelo nome, para que duas leituras dos mesmos dados escolham a mesma moeda.
  for (const [candidate, count] of Array.from(tally.entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    if (count > best) {
      best = count
      currency = candidate
    }
  }

  let directCostCents = 0
  let standardCostCents = 0
  let unpricedLines = 0
  const ignored = new Set<string>()

  for (const line of facts.consumption) {
    if (line.currency !== currency) {
      ignored.add(line.currency)
      continue
    }
    if (line.unitCostCents === null) {
      unpricedLines += 1
      continue
    }
    directCostCents += line.quantity * line.unitCostCents + line.componentCostCents
    standardCostCents += line.standardCostCents
  }

  for (const entry of facts.costEntries) {
    if (entry.currency !== currency) {
      ignored.add(entry.currency)
      continue
    }
    directCostCents += entry.amountCents
  }

  return {
    currency,
    directCostCents,
    standardCostCents,
    unpricedLines,
    ignoredCurrencies: Array.from(ignored).sort(),
  }
}

/**
 * O veredito de um parceiro.
 *
 * `now` é injetado e não lido do relógio: um veredito que muda sozinho entre duas execuções do
 * mesmo teste não é demonstrável.
 */
export function assessClient(facts: ClientFinanceFacts, now: string): ClientProfitability {
  const cost = directCost(facts)

  const fee = facts.stance === 'paying' ? facts.monthlyFeeCents : null
  const monthsBilled = facts.approvedAt ? wholeMonthsBetween(facts.approvedAt, now) : 0
  const revenueCents = fee !== null && fee > 0 ? fee * monthsBilled : 0

  const paybackMonths =
    fee !== null && fee > 0 && cost.directCostCents > 0
      ? Math.ceil(cost.directCostCents / fee)
      : null

  // Zero adquiridos devolve `null` e não uma divisão: `Infinity` viajaria calado até a tela, e
  // um CAC de zero diria que o parceiro adquire de graça exatamente quando ele não adquire.
  const cacCents =
    facts.linkedByPartnerId > 0
      ? Math.round(cost.directCostCents / facts.linkedByPartnerId)
      : null

  const base = {
    clientId: facts.clientId,
    clientName: facts.clientName,
    approvedAt: facts.approvedAt,
    currency: cost.currency,
    directCostCents: cost.directCostCents,
    standardCostCents: cost.standardCostCents,
    revenueCents,
    marginCents: revenueCents - cost.directCostCents,
    monthsBilled,
    paybackMonths,
    cacCents,
    linkedByPartnerId: facts.linkedByPartnerId,
    linkedByClientId: facts.linkedByClientId,
    usersWithPurchase: facts.usersWithPurchase,
    purchasedMinutes: facts.purchasedMinutes,
    purchaseSuppressed: facts.purchaseSuppressed ?? false,
    unpricedLines: cost.unpricedLines,
    ordersAwaitingShipment: facts.ordersAwaitingShipment,
    ignoredCurrencies: cost.ignoredCurrencies,
  }

  return { ...base, verdict: decide(facts, cost.unpricedLines, fee, base.marginCents) }
}

/**
 * A ORDEM DAS PERGUNTAS É A MENSAGEM, e ela vai da mais desqualificante para a mais informativa.
 *
 *  1. `uncosted` — uma linha sem preço torna TODO total desta parceria um piso, não um fato. Dizer
 *     `prejuízo` sobre um custo incompleto é afirmar mais do que se sabe.
 *  2. `undated` — sem data de início não existe "quantos meses ele já pagou", e um payback contado
 *     a partir do nada seria um número inventado com cara de conta.
 *  3. Não paga → `unknown_return` quando a leitura de compras não respondeu, e só então separa
 *     `no_return` de `non_monetary_return`. Os três são "custou e não pagou"; só o do meio é o
 *     que o operador chamou de prejuízo, e afirmá-lo sem a leitura seria acusar por permissão.
 *  4. Paga → a margem decide.
 */
function decide(
  facts: ClientFinanceFacts,
  unpricedLines: number,
  fee: number | null,
  marginCents: number
): FinanceVerdict {
  // As duas causas de custo incompleto respondem juntas: para o operador, "este número é um
  // piso" é a mesma informação, e o painel diz qual das duas está faltando.
  if (unpricedLines > 0 || facts.ordersAwaitingShipment > 0) return 'uncosted'
  if (!facts.approvedAt) return 'undated'

  if (fee === null || fee <= 0) {
    // A ordem aqui é a mesma do resto do arquivo: "não sei" responde antes de "não rendeu".
    if (facts.usersWithPurchase === null) return 'unknown_return'
    return facts.usersWithPurchase > 0 ? 'non_monetary_return' : 'no_return'
  }

  return marginCents >= 0 ? 'profitable' : 'payback_pending'
}
