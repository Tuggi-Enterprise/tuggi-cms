/**
 * A CAMADA MC II — o custo de estrutura, e quantos parceiros pagantes ele exige.
 *
 * ESTA É A ÚNICA CASA DO CUSTO DA OPERAÇÃO, e ela não tem `client_id` em lugar nenhum de
 * propósito. A impressora de etiquetas não fica mais barata se cortarmos um parceiro; rateá-la
 * por cliente produziria um número que não serve para decidir sobre cliente nenhum, e faria um
 * parceiro pequeno parecer caro só porque a estrutura existe. O custo fixo cobre CONTRA A SOMA
 * das margens, uma camada acima:
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
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * E O PONTO DE EQUILÍBRIO USA SÓ O QUE É FIXO — a segunda regra, de 2026-09-02
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Um custo VARIÁVEL não é uma conta que um número de parceiros "cobre": ele cresce junto com o
 * que os parceiros trazem, e por isso já está do outro lado, dentro da margem. Pôr as APIs de IA
 * no denominador do equilíbrio pediria parceiros para pagar um custo que só existe porque os
 * parceiros existem — a definição de circular. `nature` é o eixo que separa os dois, e
 * `category` (para onde o dinheiro vai) é outro: ver `lib/finance/cost-taxonomy.ts`.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * O EQUILÍBRIO É MEDIDO CONTRA O CUSTO ESTRUTURAL, NÃO CONTRA O QUE SAI DO CAIXA HOJE
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * São duas leituras do mesmo mês, e a diferença entre elas é a data em que um crédito acaba:
 *
 *   `monthlyFixedNetCents`  = preço cheio − TODOS os créditos vigentes   → o que sai do caixa
 *   `monthlyFixedCents`     = preço cheio − créditos PERMANENTES         → o que a estrutura custa
 *
 * `breakEvenPartners` usa o ESTRUTURAL. Um crédito promocional que expira em três meses não é
 * estrutura, e contar com ele diria "a operação já se paga" para uma empresa que ficaria no
 * vermelho no dia em que o crédito acabar. A leitura de caixa continua publicada ao lado, porque
 * ela é a que responde "quanto vou pagar este mês" — as duas perguntas são diferentes e as duas
 * têm resposta aqui.
 *
 * Um crédito é PERMANENTE quando não tem `endsAt` (desconto de plano anual) e TEMPORÁRIO quando
 * tem (crédito promocional). É a coluna "Temporário ou Permanente" da planilha do operador.
 *
 * Puro: sem fetch, sem Supabase, sem React. Provado por `tests/api/finance-structure.test.ts`.
 */

import type { CostCategory, CostEntryType, CostNature } from './cost-taxonomy'
import { COST_CATEGORIES } from './cost-taxonomy'
import { convertCents, rateOn, type FxRate } from './fx'
import type { ClientProfitability } from './profitability'

export interface FixedCostRecord {
  id: string
  label: string
  /** `one_off` é a impressora; `recurring` é a conta que volta. CADÊNCIA, não natureza. */
  kind: 'one_off' | 'recurring'
  amountCents: number
  currency: string
  /** `YYYY-MM-DD`. */
  incurredAt: string
  /** A cada quantos meses o valor volta. Sempre `null` em `one_off`. */
  periodMonths: number | null
  /** Para onde o dinheiro vai. Vocabulário fechado em `cost-taxonomy.ts`. */
  category: CostCategory
  /** Como o custo se comporta quando a operação cresce. Só `fixed` entra no equilíbrio. */
  nature: CostNature
  /** `credit` abate; `cost` paga. O valor é sempre positivo — o sinal é esta coluna. */
  entryType: CostEntryType
  /** Entra na base do fator R. É do ITEM, nunca da categoria. */
  isPayroll: boolean
  /** Última data em que a linha vale. `null` = ainda vigente, e isso não é zero. */
  endsAt: string | null
}

/**
 * PARA ONDE VAI O DINHEIRO, por categoria.
 *
 * SÃO QUATRO NÚMEROS E NÃO UM, porque somar o que volta todo mês com o que aconteceu uma vez na
 * janela produziria um total que não é nem taxa mensal nem desembolso do período — e ninguém
 * conseguiria dizer qual dos dois leu. A tela mostra as duas colunas lado a lado; nenhuma função
 * daqui as funde.
 */
export interface CategoryLine {
  category: CostCategory
  /** O que volta todo mês nesta categoria, a preço cheio. */
  monthlyGrossCents: number
  /** Créditos recorrentes vigentes que abatem esta categoria, por mês. */
  monthlyCreditCents: number
  /** Desembolsos e custo variável DATADOS dentro da janela, a preço cheio. */
  windowGrossCents: number
  /** Créditos datados dentro da janela. */
  windowCreditCents: number
}

export interface StructureSummary {
  currency: string

  // ── O que volta todo mês ───────────────────────────────────────────────────────────────
  /**
   * O CUSTO FIXO ESTRUTURAL — preço cheio menos os créditos PERMANENTES. É o denominador do
   * ponto de equilíbrio, e é ele que continua existindo quando o crédito promocional acabar.
   */
  monthlyFixedCents: number
  /** Preço cheio do fixo mensal, sem abater nada. */
  monthlyFixedGrossCents: number
  /** Todos os créditos recorrentes vigentes que abatem o fixo — permanentes e temporários. */
  monthlyFixedCreditCents: number
  /** O que de fato sai do caixa todo mês: preço cheio menos TODOS os créditos vigentes. */
  monthlyFixedNetCents: number
  /** Custo VARIÁVEL recorrente, líquido. Fora do equilíbrio: ele cresce com a operação. */
  monthlyVariableCents: number
  /** A base do fator R: folha mensal. Fora dela ficam benefício e estagiário, por lei. */
  payrollMonthlyCents: number

  // ── O que aconteceu dentro da janela ───────────────────────────────────────────────────
  /** Desembolsos FIXOS de uma vez só na janela. Fora do equilíbrio, dentro da leitura. */
  oneOffCents: number
  /** Custo VARIÁVEL datado na janela — as APIs de IA do mês, a feira, a viagem. */
  variableCents: number
  /** Créditos datados na janela. O que não saiu do caixa. */
  windowCreditCents: number

  /** Para onde o dinheiro vai. Só categorias com algum valor, da maior para a menor. */
  byCategory: CategoryLine[]

  // ── O encontro com as margens ──────────────────────────────────────────────────────────
  /** Σ MC I dos parceiros na mesma moeda. É o que a estrutura tem para cobrir. */
  contributionCents: number
  /** MC II. Negativa significa que as margens ainda não pagam a operação. */
  operatingMarginCents: number
  /** Mensalidade média de quem paga — o denominador do equilíbrio. `null` sem pagantes. */
  averageMonthlyFeeCents: number | null
  /** Quantos parceiros pagantes, na mensalidade média, cobrem o fixo ESTRUTURAL mensal. */
  breakEvenPartners: number | null
  /** Quantos pagam hoje. Ao lado do equilíbrio, é a leitura inteira num par de números. */
  payingPartners: number
  /**
   * As moedas que ficaram DE FORA por não terem taxa declarada. Nunca somadas, sempre nomeadas.
   *
   * O nome é histórico: antes de `fx_rates` existir, TODA moeda diferente caía aqui. Hoje cai
   * só o que ninguém declarou — e isso continua sendo ausência de taxa, nunca zero.
   */
  ignoredCurrencies: string[]
  /**
   * As taxas que de fato foram usadas nesta leitura, com procedência.
   *
   * ELA VIAJA NA SAÍDA PORQUE UM NÚMERO CONVERTIDO PRECISA DIZER QUE FOI CONVERTIDO. Um total em
   * reais que embute US$ 52,48 a uma premissa de R$ 5,20 não é o mesmo fato que um total nascido
   * em reais, e a tela não tem como avisar disso se a lista não subir junto.
   */
  appliedRates: FxRate[]
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
 * A linha vale nesta data?
 *
 * `endsAt` NULO É "AINDA VIGENTE", E NÃO "TERMINA HOJE". Sem esta função, a assinatura da
 * Supabase a US$ 32,49 (encerrada em julho de 2026) continuaria somando com a de US$ 40,99 que a
 * substituiu — US$ 73,48 por mês, todo mês, para sempre, sem nenhum erro visível.
 */
export function isActiveOn(cost: FixedCostRecord, date: string): boolean {
  if (cost.incurredAt > date) return false
  return cost.endsAt === null || cost.endsAt >= date
}

function emptyLine(category: CostCategory): CategoryLine {
  return {
    category,
    monthlyGrossCents: 0,
    monthlyCreditCents: 0,
    windowGrossCents: 0,
    windowCreditCents: 0,
  }
}

/**
 * A operação, na moeda dos parceiros.
 *
 * A MOEDA VEM DOS PARCEIROS E NÃO DOS CUSTOS: a pergunta é se as margens cobrem a estrutura, e a
 * margem é o lado que manda.
 *
 * O QUE ESTÁ EM OUTRA MOEDA É CONVERTIDO PELA TAXA DECLARADA (`lib/finance/fx.ts`), e nunca por
 * uma cotação buscada em algum lugar — a decisão é de 2026-09-02 e a razão está escrita lá: um
 * custo fixo que oscila com o câmbio faz o ponto de equilíbrio oscilar junto. Moeda SEM taxa
 * declarada continua voltando nomeada em `ignoredCurrencies`, fora de toda soma: nada aqui
 * inventa câmbio, e `null` de taxa nunca vira zero de custo.
 *
 * `appliedRates` SOBE JUNTO para a tela poder dizer que o total foi convertido, e por quanto.
 *
 * A TAXA MENSAL É LIDA EM `window.to`, e não "em algum ponto da janela". Perguntar "quanto custa
 * por mês" é perguntar pelo mês corrente: uma assinatura cancelada em junho não é custo de hoje
 * só por ter existido dentro da janela, e uma contratada ontem já é.
 *
 * O DATADO É FILTRADO PELA JANELA INTEIRA, porque ali a pergunta é outra: o que aconteceu no
 * período. São dois filtros diferentes porque são duas perguntas diferentes.
 */
export function summarizeStructure(
  fixedCosts: readonly FixedCostRecord[],
  clients: readonly ClientProfitability[],
  window: { from: string; to: string },
  fallbackCurrency = 'BRL',
  rates: readonly FxRate[] = []
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
  const applied = new Map<string, FxRate>()
  const lines = new Map<CostCategory, CategoryLine>()

  /**
   * O valor da linha na moeda do relatório, ou `null` quando falta taxa.
   *
   * A DATA DA CONVERSÃO É A DA PERGUNTA. O recorrente é convertido em `window.to`, porque
   * "quanto custa por mês" é pergunta sobre o mês corrente; o datado é convertido no dia dele,
   * porque a conta de julho foi paga em julho. Com uma taxa fixa os dois dão o mesmo número —
   * a diferença só aparece no dia em que existir uma segunda vigência, e nesse dia ela importa.
   */
  const inReport = (cents: number, from: string, on: string): number | null => {
    if (from === currency) return cents
    const converted = convertCents(cents, from, currency, rates, on)
    if (converted === null) {
      ignored.add(from)
      return null
    }
    const used = rateOn(rates, from, on)
    if (used) applied.set(from, used)
    return converted
  }
  const lineOf = (category: CostCategory): CategoryLine => {
    const existing = lines.get(category)
    if (existing) return existing
    const created = emptyLine(category)
    lines.set(category, created)
    return created
  }

  let monthlyFixedGross = 0
  let monthlyFixedCredit = 0
  let monthlyFixedTemporaryCredit = 0
  let monthlyVariableGross = 0
  let monthlyVariableCredit = 0
  let payrollMonthly = 0
  let oneOffCents = 0
  let variableCents = 0
  let windowCreditCents = 0

  for (const cost of fixedCosts) {
    const amountCents = inReport(
      cost.amountCents,
      cost.currency,
      cost.kind === 'recurring' ? window.to : cost.incurredAt
    )
    if (amountCents === null) continue

    const isCredit = cost.entryType === 'credit'
    const line = lineOf(cost.category)

    if (cost.kind === 'recurring') {
      if (!isActiveOn(cost, window.to)) continue
      // O período é lido da regra única (`monthlyAmountCents`) sobre o valor JÁ convertido:
      // repetir a divisão aqui seria a segunda cópia da decisão de como uma conta anual vira mês.
      const monthly = monthlyAmountCents({ ...cost, amountCents })
      if (monthly === null) continue

      if (isCredit) {
        line.monthlyCreditCents += monthly
        if (cost.nature === 'fixed') {
          monthlyFixedCredit += monthly
          // Temporário é o que TEM data de fim. É a coluna "Temporário ou Permanente" da
          // planilha, e é o que sai do custo estrutural sem sair do custo de caixa.
          if (cost.endsAt !== null) monthlyFixedTemporaryCredit += monthly
        } else {
          monthlyVariableCredit += monthly
        }
        continue
      }

      line.monthlyGrossCents += monthly
      if (cost.nature === 'fixed') monthlyFixedGross += monthly
      else monthlyVariableGross += monthly
      // A folha é lida no preço cheio: um crédito não reduz a base do fator R.
      if (cost.isPayroll) payrollMonthly += monthly
      continue
    }

    // Datado: só conta o que caiu DENTRO da janela.
    if (cost.incurredAt < window.from || cost.incurredAt > window.to) continue

    if (isCredit) {
      line.windowCreditCents += amountCents
      windowCreditCents += amountCents
      continue
    }

    line.windowGrossCents += amountCents
    if (cost.nature === 'fixed') oneOffCents += amountCents
    else variableCents += amountCents
  }

  let contributionCents = 0
  const fees: number[] = []
  for (const client of clients) {
    // A MARGEM TAMBÉM SE CONVERTE. A moeda do relatório é a da MAIORIA dos parceiros, então um
    // contrato em euro seria o lado minúrio — e deixá-lo fora da soma faria a estrutura parecer
    // descoberta por uma margem que existe.
    const marginCents = inReport(client.marginCents, client.currency, window.to)
    if (marginCents === null) continue
    contributionCents += marginCents
    // A MENSALIDADE É LIDA, NÃO DEDUZIDA. Isto dividia `revenueCents` por `monthsBilled`, e a
    // divisão parou de devolver a mensalidade quando a primeira fatura passou a carregar o
    // proporcional da publicação junto (`lib/finance/billing.ts`): duas faturas de R$ 100 com um
    // mês proporcional somam R$ 300, e a "média" saía R$ 150. O ponto de equilíbrio inteiro
    // pendia disso.
    //
    // E quem paga continua sendo decidido por `derivePartnerPlan` lá atrás: `monthlyFeeCents` só
    // existe em quem ele já julgou pagante. Um pagante cuja cobrança ainda não começou entra na
    // média — ele tem mensalidade contratada, e é dela que o equilíbrio precisa.
    if (client.monthlyFeeCents !== null && client.monthlyFeeCents > 0) {
      const fee = inReport(client.monthlyFeeCents, client.currency, window.to)
      if (fee !== null) fees.push(fee)
    }
  }

  const averageMonthlyFeeCents =
    fees.length > 0 ? Math.round(fees.reduce((sum, fee) => sum + fee, 0) / fees.length) : null

  // ESTRUTURAL: o permanente abate, o temporário não. Piso em zero porque um crédito maior que o
  // custo que ele abate é erro de cadastro, e um fixo negativo não é um número que exista — foi
  // exatamente o que a planilha produzia em agosto de 2026 (−R$ 164,67) ao abater um crédito de
  // API de IA da linha de custo fixo.
  const permanentCredit = monthlyFixedCredit - monthlyFixedTemporaryCredit
  const monthlyFixedGrossCents = Math.round(monthlyFixedGross)
  const monthlyFixedCreditCents = Math.round(monthlyFixedCredit)
  const monthlyFixed = Math.max(0, Math.round(monthlyFixedGross - permanentCredit))
  const monthlyFixedNetCents = Math.max(0, monthlyFixedGrossCents - monthlyFixedCreditCents)

  const breakEvenPartners =
    averageMonthlyFeeCents !== null && averageMonthlyFeeCents > 0 && monthlyFixed > 0
      ? Math.ceil(monthlyFixed / averageMonthlyFeeCents)
      : null

  // Ordem estável e útil: quem consome mais dinheiro primeiro, e a ordem do vocabulário desempata.
  // Uma lista cuja ordem muda entre duas leituras dos mesmos dados é uma lista que alguém relê.
  const byCategory = Array.from(lines.values())
    .filter(
      (line) =>
        line.monthlyGrossCents > 0 ||
        line.monthlyCreditCents > 0 ||
        line.windowGrossCents > 0 ||
        line.windowCreditCents > 0
    )
    .map((line) => ({
      ...line,
      monthlyGrossCents: Math.round(line.monthlyGrossCents),
      monthlyCreditCents: Math.round(line.monthlyCreditCents),
    }))
    .sort(
      (a, b) =>
        b.monthlyGrossCents + b.windowGrossCents - (a.monthlyGrossCents + a.windowGrossCents) ||
        COST_CATEGORIES.indexOf(a.category) - COST_CATEGORIES.indexOf(b.category)
    )

  return {
    currency,
    monthlyFixedCents: monthlyFixed,
    monthlyFixedGrossCents,
    monthlyFixedCreditCents,
    monthlyFixedNetCents,
    monthlyVariableCents: Math.max(0, Math.round(monthlyVariableGross - monthlyVariableCredit)),
    payrollMonthlyCents: Math.round(payrollMonthly),
    oneOffCents,
    variableCents,
    windowCreditCents,
    byCategory,
    contributionCents,
    operatingMarginCents: contributionCents - monthlyFixed,
    averageMonthlyFeeCents,
    breakEvenPartners,
    payingPartners: fees.length,
    ignoredCurrencies: Array.from(ignored).sort(),
    appliedRates: Array.from(applied.values()).sort((a, b) =>
      a.currency.localeCompare(b.currency)
    ),
  }
}
