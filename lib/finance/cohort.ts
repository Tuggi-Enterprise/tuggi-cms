/**
 * A COORTE — parceiros agrupados pelo mês em que entraram.
 *
 * POR QUE ELA EXISTE, E É UM DEFEITO DE LEITURA QUE ELA CONSERTA. Sem coorte, a tela compara um
 * parceiro de um mês com um de um ano na mesma coluna, e o de um mês SEMPRE parece péssimo: ele
 * pagou uma mensalidade e levou o mesmo display que o outro. `payback_pending` é o estado normal
 * de quem acabou de entrar, e lê-lo como problema faz o operador cortar exatamente as parcerias
 * novas — as únicas que ainda não tiveram tempo de dar certo.
 *
 * O MÊS VEM DE `approvedAt`, o mesmo relógio que `assessClient` usa para contar receita. Se os
 * dois divergissem, a coorte de agosto teria parceiros que a receita conta como de setembro.
 *
 * `undated` NÃO VIRA UMA COORTE CHAMADA `sem data`. Ele volta em `undated`, à parte, porque uma
 * coorte é uma janela de tempo e "não sei quando" não é uma. Somá-los numa linha faria a média
 * de custo daquela linha significar coisa nenhuma.
 *
 * Puro: sem fetch, sem Supabase, sem React. Provado por `tests/api/finance-profitability.test.ts`.
 */

import type { ClientProfitability } from './profitability'

export interface CohortLine {
  /** `YYYY-MM`. */
  month: string
  currency: string
  clients: number
  directCostCents: number
  revenueCents: number
  marginCents: number
  /** Quantos da coorte já se pagaram. Contra `clients`, é a taxa de sucesso do mês. */
  profitable: number
  /** Quantos ainda não. Não é o mesmo que fracasso: é o estado normal de quem é novo. */
  paybackPending: number
  acquiredUsers: number
}

export interface CohortReport {
  lines: CohortLine[]
  /** Parceiros sem `approvedAt`. Fora das coortes de propósito, e contados para não sumirem. */
  undated: number
}

/** `YYYY-MM` de uma data ISO. `null` quando não há data — nunca um mês inventado. */
export function cohortMonth(approvedAt: string | null): string | null {
  if (!approvedAt) return null
  const month = approvedAt.slice(0, 7)
  return /^\d{4}-\d{2}$/.test(month) ? month : null
}

/**
 * As coortes, do mês mais recente para o mais antigo.
 *
 * Ordem decrescente porque a pergunta que se faz numa tela de coorte é sobre quem entrou
 * recentemente; a coorte antiga é referência, não assunto.
 */
export function summarizeCohorts(clients: readonly ClientProfitability[]): CohortReport {
  const byMonth = new Map<string, CohortLine>()
  let undated = 0

  for (const client of clients) {
    const month = cohortMonth(client.approvedAt)
    if (!month) {
      undated += 1
      continue
    }

    const line = byMonth.get(month) ?? {
      month,
      currency: client.currency,
      clients: 0,
      directCostCents: 0,
      revenueCents: 0,
      marginCents: 0,
      profitable: 0,
      paybackPending: 0,
      acquiredUsers: 0,
    }

    line.clients += 1
    line.acquiredUsers += client.linkedByPartnerId
    // Só soma dinheiro da mesma moeda da linha. Uma coorte com parceiro em EUR conta a pessoa e
    // não o valor, que é melhor do que somar duas moedas ou esconder o parceiro.
    if (client.currency === line.currency) {
      line.directCostCents += client.directCostCents
      line.revenueCents += client.revenueCents
      line.marginCents += client.marginCents
    }
    if (client.verdict === 'profitable') line.profitable += 1
    if (client.verdict === 'payback_pending') line.paybackPending += 1

    byMonth.set(month, line)
  }

  return {
    lines: Array.from(byMonth.values()).sort((a, b) => b.month.localeCompare(a.month)),
    undated,
  }
}
