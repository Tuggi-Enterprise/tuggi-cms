/**
 * A CAMADA MC II — o custo de estrutura, e quantos parceiros pagantes ele exige.
 *
 * ESTA É A ÚNICA CASA DO CUSTO FIXO, e ela não tem `client_id` em lugar nenhum de propósito. A
 * impressora de etiquetas não fica mais barata se cortarmos um parceiro; rateá-la por cliente
 * produziria um número que não serve para decidir sobre cliente nenhum, e faria um parceiro
 * pequeno parecer caro só porque a estrutura existe. O custo fixo cobre CONTRA A SOMA das
 * margens, uma camada acima:
 *
 *   MC I  = receita do parceiro − custo direto do parceiro     (profitability.ts)
 *   MC II = Σ MC I − custo fixo mensal da operação             (aqui)
 *
 * O PONTO DE EQUILÍBRIO USA SÓ O QUE É MENSAL, e é por isso que `one_off` fica de fora dele. Uma
 * impressora comprada uma vez não é uma conta que chega todo mês; dividi-la por uma vida útil
 * estimada seria trocar um fato (R$ 3.000 em março) por um chute (R$ 0,03 por impressão durante
 * quantos anos?). Ela aparece na tela como o que é — um desembolso datado — e o equilíbrio
 * responde pela conta que de fato volta.
 *
 * Puro: sem fetch, sem Supabase, sem React. Provado por `tests/api/finance-structure.test.ts`.
 */

import type { ClientProfitability } from './profitability'

export interface FixedCostRecord {
  id: string
  label: string
  /** `one_off` é a impressora; `recurring` é a conta que volta. */
  kind: 'one_off' | 'recurring'
  amountCents: number
  currency: string
  /** `YYYY-MM-DD`. */
  incurredAt: string
  /** A cada quantos meses o valor volta. Sempre `null` em `one_off`. */
  periodMonths: number | null
}

export interface StructureSummary {
  currency: string
  /** O que volta todo mês, normalizado: uma conta trimestral entra como um terço dela. */
  monthlyFixedCents: number
  /** Desembolsos de uma vez só na janela. Fora do ponto de equilíbrio, dentro da leitura. */
  oneOffCents: number
  /** Σ MC I dos parceiros na mesma moeda. É o que a estrutura tem para cobrir. */
  contributionCents: number
  /** MC II. Negativa significa que as margens ainda não pagam a operação. */
  operatingMarginCents: number
  /** Mensalidade média de quem paga — o denominador do equilíbrio. `null` sem pagantes. */
  averageMonthlyFeeCents: number | null
  /** Quantos parceiros pagantes, na mensalidade média, cobrem o fixo mensal. */
  breakEvenPartners: number | null
  /** Quantos pagam hoje. Ao lado do equilíbrio, é a leitura inteira num par de números. */
  payingPartners: number
  ignoredCurrencies: string[]
}

/**
 * O valor MENSAL de um custo recorrente.
 *
 * `periodMonths` ausente ou inválido responde `null` em vez de assumir 1: uma conta anual lida
 * como mensal multiplicaria o custo da estrutura por doze, e o ponto de equilíbrio pediria doze
 * vezes mais parceiros do que a realidade.
 */
export function monthlyAmountCents(cost: FixedCostRecord): number | null {
  if (cost.kind !== 'recurring') return null
  if (!cost.periodMonths || cost.periodMonths <= 0) return null
  return cost.amountCents / cost.periodMonths
}

/**
 * A operação, na moeda dos parceiros.
 *
 * A MOEDA VEM DOS PARCEIROS E NÃO DOS CUSTOS: a pergunta é se as margens cobrem a estrutura, e a
 * margem é o lado que manda. Custo fixo em outra moeda volta nomeado em `ignoredCurrencies` em
 * vez de somado — nada aqui inventa taxa de câmbio.
 *
 * `window` filtra os `one_off` por data; os recorrentes entram por serem recorrentes, desde que
 * já tenham começado (`incurredAt <= window.to`).
 */
export function summarizeStructure(
  fixedCosts: readonly FixedCostRecord[],
  clients: readonly ClientProfitability[],
  window: { from: string; to: string },
  fallbackCurrency = 'BRL'
): StructureSummary {
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

  const ignored = new Set<string>()
  let monthlyFixedCents = 0
  let oneOffCents = 0

  for (const cost of fixedCosts) {
    if (cost.currency !== currency) {
      ignored.add(cost.currency)
      continue
    }
    if (cost.incurredAt > window.to) continue

    if (cost.kind === 'recurring') {
      const monthly = monthlyAmountCents(cost)
      if (monthly !== null) monthlyFixedCents += monthly
      continue
    }
    if (cost.incurredAt >= window.from) oneOffCents += cost.amountCents
  }

  let contributionCents = 0
  const fees: number[] = []
  for (const client of clients) {
    if (client.currency !== currency) {
      ignored.add(client.currency)
      continue
    }
    contributionCents += client.marginCents
    // Quem paga é quem tem meses faturados e receita — a decisão de "paga ou não" já foi tomada
    // por `derivePartnerPlan` lá atrás, e não é refeita aqui com uma segunda comparação.
    if (client.revenueCents > 0 && client.monthsBilled > 0) {
      fees.push(client.revenueCents / client.monthsBilled)
    }
  }

  const averageMonthlyFeeCents =
    fees.length > 0 ? Math.round(fees.reduce((sum, fee) => sum + fee, 0) / fees.length) : null

  const monthlyFixed = Math.round(monthlyFixedCents)
  const breakEvenPartners =
    averageMonthlyFeeCents !== null && averageMonthlyFeeCents > 0 && monthlyFixed > 0
      ? Math.ceil(monthlyFixed / averageMonthlyFeeCents)
      : null

  return {
    currency,
    monthlyFixedCents: monthlyFixed,
    oneOffCents,
    contributionCents,
    operatingMarginCents: contributionCents - monthlyFixed,
    averageMonthlyFeeCents,
    breakEvenPartners,
    payingPartners: fees.length,
    ignoredCurrencies: Array.from(ignored).sort(),
  }
}
