/**
 * A VISÃO GERAL — quanto entra, quanto sai, e daqui a quantos meses isso vira.
 *
 * AS TRÊS SEÇÕES QUE JÁ EXISTIAM RESPONDEM POR UM PARCEIRO (`profitability.ts`), POR UM PRODUTO
 * (`catalog.ts`) E PELA OPERAÇÃO (`structure.ts`). Nenhuma responde a pergunta de dono, e ela é
 * a única que junta os dois lados do negócio: a mensalidade do parceiro e a compra do turista.
 * Juntar é justamente o que exige as regras deste arquivo, porque os dois lados NÃO têm a mesma
 * qualidade de fato — e um total que os fundisse pareceria apurado sem ser.
 *
 * QUATRO FUNÇÕES, QUATRO RECUSAS:
 *
 *  · `summarizeMonth`      — recusa somar a taxa de impressão dentro do custo, e recusa pôr o
 *                            desembolso de uma vez só dentro da cascata que fecha o mês;
 *  · `summarizePlanMix`    — recusa contar como pagante quem tem contrato encerrado, e separa o
 *                            MRR de contrato assinado do MRR que só existe no cadastro;
 *  · `projectRevenue`      — recusa projetar com um ticket que ninguém pagou, e imprime a
 *                            premissa junto do resultado em vez de embuti-la nele;
 *  · `monthlySeries`       — recusa chamar de "receita real" o que é só posição no tempo, porque
 *                            o CMS não confere pagamento.
 *
 * O MÊS É O ÚLTIMO FECHADO, e essa escolha é da tela, não daqui: um painel aberto no dia 2
 * mostraria um mês quase vazio e leria como queda. `summarizeMonth` recebe o mês e não o inventa.
 *
 * Puro: sem fetch, sem Supabase, sem React. Provado por `tests/api/finance-overview.test.ts`.
 */

import type { ContractStatus } from '@/lib/contract/status'
import type { PlanKind } from '@/lib/clients/partner-plan'
import type { BillingStartSource } from './billing'
import type { FixedCostRecord } from './structure'
import { monthlyAmountCents } from './structure'
import { convertCents, rateOn, type FxRate } from './fx'

// ── 1 · O MÊS EM CASCATA ──────────────────────────────────────────────────────────────────────

/** Uma linha de consumo com a data — o que `loadConsumption` já devolve. */
export interface DatedConsumption {
  quantity: number
  unitCostCents: number | null
  componentCostCents: number
  standardCostCents: number
  currency: string
  /** `first_delivery` é crescimento; `replacement`, `loss` e `gift` são retrabalho. */
  reason: string
  /** ISO. Só a parte `YYYY-MM` é lida. */
  consumedAt: string
}

/** Um custo avulso do parceiro, com a data em que foi incorrido. */
export interface DatedCostEntry {
  amountCents: number
  currency: string
  /** `YYYY-MM-DD`. */
  incurredAt: string
}

export interface MonthlyCascade {
  /** `YYYY-MM`. */
  month: string
  currency: string
  /** Mensalidade contratada de quem paga. É COMPETÊNCIA: ninguém conferiu recebimento. */
  recurringRevenueCents: number
  /** Material entregue no mês + avulsos do mês. Custo variável, o que decide o parceiro. */
  variableCostCents: number
  /** A taxa simbólica de impressão do mês. AO LADO do variável, nunca dentro. */
  standardCostCents: number
  /** O que volta todo mês, normalizado — uma conta trimestral entra como um terço dela. */
  fixedMonthlyCents: number
  /** Desembolsos FIXOS de uma vez só DENTRO do mês. Fora da cascata, dentro da leitura. */
  oneOffCents: number
  /**
   * Custo VARIÁVEL DA OPERAÇÃO no mês, líquido de créditos — as APIs de IA, a feira, a viagem.
   *
   * OUTRA LINHA QUE `variableCostCents`, E A DIFERENÇA É DE QUEM É O CUSTO. Aquele é do
   * PARCEIRO: material entregue e avulso, o que decide se um parceiro se paga, e que por isso
   * desce até a linha dele. Este é da OPERAÇÃO: ninguém consegue dizer de qual parceiro é o
   * token gasto gerando um POI. Fundir os dois faria o custo do parceiro parecer maior do que
   * ele é e a decisão de cortar um parceiro sair errada.
   *
   * ELE ENTRA NO RESULTADO DO MÊS, ao contrário do `one_off`: um custo variável é despesa do mês
   * em que aconteceu, não um bem comprado uma vez.
   */
  operatingCostCents: number
  /** O que NÃO saiu do caixa no mês: créditos e descontos abatidos, a preço cheio. */
  creditCents: number
  /** As taxas declaradas usadas para converter este mês. Vazia quando nada foi convertido. */
  appliedRates: FxRate[]
  /** Receita − variável do parceiro − variável da operação − fixo. `one_off` e taxa ficam fora. */
  resultCents: number
  /** Quantas linhas de consumo o mês teve. Contra o custo, diz se foi um mês de entrega. */
  deliveries: number
  /** Linhas do mês sem preço. Enquanto houver uma, o custo do mês é piso. */
  unpricedLines: number
  ignoredCurrencies: string[]
}

/** `YYYY-MM` de uma data ISO, ou `null` — nunca um mês inventado. */
export function monthOf(value: string | null | undefined): string | null {
  if (!value) return null
  const month = String(value).slice(0, 7)
  return /^\d{4}-\d{2}$/.test(month) ? month : null
}

/**
 * O mês, em cascata.
 *
 * O QUE FICA FORA DELA, E POR QUÊ. A taxa de impressão é um valor simbólico que existe para o
 * operador enxergar o custo da impressora sem perder o número marginal; somá-la ao variável
 * faria a margem de contribuição deixar de ser marginal. O desembolso de uma vez só é um fato
 * datado — uma impressora comprada em março não é uma conta que chega todo mês, e diluí-la por
 * uma vida útil estimada trocaria R$ 3.000,00 em março por um chute mensal.
 *
 * `recurringRevenueCents` CHEGA PRONTO de `summarizePlanMix`, e não é recalculado aqui. Duas
 * contas de MRR no mesmo arquivo é como um total acima passa a discordar da linha abaixo.
 */
export function summarizeMonth(input: {
  month: string
  currency: string
  recurringRevenueCents: number
  consumption: readonly DatedConsumption[]
  costEntries: readonly DatedCostEntry[]
  fixedCosts: readonly FixedCostRecord[]
  /** As taxas declaradas. Vazio = nada converte, e moeda diferente volta nomeada como antes. */
  rates?: readonly FxRate[]
}): MonthlyCascade {
  const { month, currency } = input
  const rates = input.rates ?? []
  const ignored = new Set<string>()
  const applied = new Map<string, FxRate>()

  // A CONVERSÃO DO MÊS ACONTECE NO MÊS. `${month}-01` é a data da pergunta: o custo de julho usa a
  // taxa que valia em julho, e uma vigência nova declarada em setembro não reescreve julho.
  const on = `${month}-01`
  const inReport = (cents: number, from: string): number | null => {
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

  let variableCostCents = 0
  let standardCostCents = 0
  let deliveries = 0
  let unpricedLines = 0

  for (const line of input.consumption) {
    if (monthOf(line.consumedAt) !== month) continue
    deliveries += 1
    // `null` não é zero: a linha entra como pendência e o custo do mês vira piso.
    if (line.unitCostCents === null) {
      unpricedLines += 1
      continue
    }
    const direct = inReport(
      line.quantity * line.unitCostCents + line.componentCostCents,
      line.currency
    )
    if (direct === null) continue
    variableCostCents += direct
    standardCostCents += inReport(line.standardCostCents, line.currency) ?? 0
  }

  for (const entry of input.costEntries) {
    if (monthOf(entry.incurredAt) !== month) continue
    const amount = inReport(entry.amountCents, entry.currency)
    if (amount === null) continue
    variableCostCents += amount
  }

  // O MÊS LÊ O CAIXA, E POR ISSO ABATE TODO CRÉDITO VIGENTE — inclusive o temporário. A pergunta
  // aqui é "quanto este mês custou"; a pergunta "quanto a estrutura custa quando o crédito
  // promocional acabar" é outra, e quem responde é `monthlyFixedCents` em `structure.ts`.
  let fixedMonthlyCents = 0
  let operatingCostCents = 0
  let creditCents = 0
  let oneOffCents = 0
  const monthStart = `${month}-01`
  // `${month}-31` funcionava por comparação de string e ficou aqui depois de `lastDayOfMonth`
  // nascer, no mesmo arquivo, com um comentário explicando por que aquilo é frágil. O QA notou a
  // incoerência em 2026-09-03: um helper que o próprio módulo não usa é um helper que ninguém vai
  // usar.
  const monthEnd = lastDayOfMonth(month)

  for (const cost of input.fixedCosts) {
    const amountCents = inReport(cost.amountCents, cost.currency)
    if (amountCents === null) continue
    // O crédito não é um custo negativo: ele tem coluna própria, e o sinal é aplicado aqui.
    const sign = cost.entryType === 'credit' ? -1 : 1

    if (cost.kind === 'recurring') {
      // Só conta o que JÁ COMEÇOU no mês lido. Uma assinatura contratada em outubro não pode
      // aparecer no custo de agosto só por ser recorrente. E só o que AINDA VALIA nele: uma
      // assinatura encerrada em julho não cobra em agosto, que é o que `endsAt` guarda.
      if (cost.incurredAt > monthEnd) continue
      if (cost.endsAt !== null && cost.endsAt < monthStart) continue
      const monthly = monthlyAmountCents({ ...cost, amountCents })
      if (monthly === null) continue
      if (sign < 0) creditCents += monthly
      if (cost.nature === 'fixed') fixedMonthlyCents += sign * monthly
      else operatingCostCents += sign * monthly
      continue
    }

    if (monthOf(cost.incurredAt) !== month) continue
    if (sign < 0) creditCents += amountCents
    // O DATADO VARIÁVEL É DESPESA DO MÊS; o datado FIXO é desembolso e fica fora da cascata. É a
    // mesma razão de sempre: a impressora comprada em março não é conta que chega todo mês, mas
    // os tokens gastos em março foram gastos em março.
    if (cost.nature === 'fixed') oneOffCents += sign * amountCents
    else operatingCostCents += sign * amountCents
  }

  // Piso em zero: crédito maior que o custo que ele abate é erro de cadastro, e um custo negativo
  // não é um número que exista. Foi o que a planilha do operador produzia em ago/2026 (−R$ 164,67)
  // ao abater um crédito de API de IA da linha de custo FIXO.
  const fixed = Math.max(0, Math.round(fixedMonthlyCents))
  const operating = Math.max(0, Math.round(operatingCostCents))

  return {
    month,
    currency,
    recurringRevenueCents: input.recurringRevenueCents,
    variableCostCents,
    standardCostCents,
    fixedMonthlyCents: fixed,
    oneOffCents: Math.max(0, oneOffCents),
    operatingCostCents: operating,
    creditCents: Math.round(creditCents),
    resultCents: input.recurringRevenueCents - variableCostCents - operating - fixed,
    deliveries,
    unpricedLines,
    ignoredCurrencies: Array.from(ignored).sort(),
    appliedRates: Array.from(applied.values()).sort((a, b) =>
      a.currency.localeCompare(b.currency)
    ),
  }
}

/**
 * A MESMA CASCATA, MÊS A MÊS — receita ao lado do custo, do passado ao previsto.
 *
 * `realized` É POSIÇÃO NO TEMPO, NÃO UMA SEGUNDA FONTE. O CMS não confere pagamento, então não
 * existe "receita real" contra "receita prevista": existe fatura JÁ VENCIDA e fatura que o
 * calendário ainda vai emitir. Duas séries com esses nomes prometeriam uma conciliação que este
 * repositório não faz — e é a mesma razão de a palavra `recebido` não aparecer em lugar nenhum
 * do módulo.
 *
 * O DESEMBOLSO DE UMA VEZ SÓ FICA FORA DA BARRA, pelo mesmo motivo de ficar fora da cascata: uma
 * impressora comprada em março viraria um pico que ninguém consegue ler como custo mensal. Ele
 * continua visível em `oneOffCents`, mês a mês, para quem quiser somá-lo com os olhos.
 */
export interface MonthlyPoint extends MonthlyCascade {
  /** O mês já passou (ou é o corrente): o que está aqui venceu, não foi previsto. */
  realized: boolean
  /**
   * A receita do APP naquele mês, na moeda da série — cobrança feita, ou renovação prevista.
   *
   * CAMADA PRÓPRIA, e nunca somada à do parceiro. São dois negócios com naturezas diferentes: a
   * mensalidade do comércio é contrato assinado com vencimento no dia 20; a assinatura do app é
   * cobrança de loja num ciclo próprio, que a loja pode interromper sem avisar ninguém aqui.
   * Fundi-las num total daria um número que nenhuma das duas operações consegue explicar.
   */
  appRevenueCents: number
  /**
   * A mensalidade que o calendário emitiria NESTE mês se o contrato estivesse aceito.
   *
   * NÃO É PREVISÃO DE QUANDO ALGUÉM VAI ASSINAR — é o valor em jogo naquele vencimento. O parceiro
   * está no ar desde a liberação e a mensalidade corre a partir dela; o que falta é o instrumento.
   * Se ele aceitar antes do dia 20, esta é a fatura que sai. Se não, ela não sai — e é por isso
   * que ela é uma camada separada e nunca soma com a de cima.
   */
  revenueBlockedCents: number
}

export function monthlySeries(input: {
  /** `YYYY-MM` do primeiro mês da janela. */
  from: string
  months: number
  currency: string
  /** O mês vigente — o que separa o vencido do previsto. */
  currentMonth: string
  /** A fatura de cada mês, já somada sobre os parceiros que cobram. */
  revenueByMonth: Readonly<Record<string, number>>
  /** O mesmo cálculo sobre quem tem contrato ENVIADO e não aceito. Camada à parte. */
  blockedByMonth?: Readonly<Record<string, number>>
  /** A receita do app por mês, na mesma moeda — de `appRevenueByMonth`. */
  appByMonth?: Readonly<Record<string, number>>
  consumption: readonly DatedConsumption[]
  costEntries: readonly DatedCostEntry[]
  fixedCosts: readonly FixedCostRecord[]
  /** As taxas declaradas, repassadas a cada mês da série. */
  rates?: readonly FxRate[]
}): MonthlyPoint[] {
  const span = Math.max(1, Math.min(36, Math.round(input.months)))
  const points: MonthlyPoint[] = []

  let month = input.from
  for (let index = 0; index < span; index += 1) {
    const cascade = summarizeMonth({
      month,
      currency: input.currency,
      recurringRevenueCents: input.revenueByMonth[month] ?? 0,
      consumption: input.consumption,
      costEntries: input.costEntries,
      fixedCosts: input.fixedCosts,
      rates: input.rates,
    })
    points.push({
      ...cascade,
      realized: month <= input.currentMonth,
      revenueBlockedCents: Math.max(0, Math.round(input.blockedByMonth?.[month] ?? 0)),
      appRevenueCents: Math.max(0, Math.round(input.appByMonth?.[month] ?? 0)),
    })
    month = addOneMonth(month)
  }

  return points
}

/**
 * O ÚLTIMO DIA DE UM MÊS — sem chutar 31.
 *
 * `${month}-31` como fim de janela funciona por acidente na comparação de string: `2026-02-15`
 * é menor que `2026-02-31`, então fevereiro inteiro entra. Ele para de funcionar no instante em
 * que a data é comparada com uma data de verdade, e 31 de fevereiro não existe em `Date` nenhuma.
 *
 * O dia ZERO do mês seguinte é o último do atual, e `Date.UTC` mantém o fuso fora da conta — no
 * horário de Brasília, `new Date(2026, 8, 0)` local devolveria o dia anterior ao esperado quando
 * convertido para ISO.
 */
export function lastDayOfMonth(month: string): string {
  const year = Number(month.slice(0, 4))
  const index = Number(month.slice(5, 7))
  return new Date(Date.UTC(year, index, 0)).toISOString().slice(0, 10)
}

/** O mês seguinte, sem passar por `Date` — dezembro vira janeiro do ano seguinte. */
function addOneMonth(month: string): string {
  const year = Number(month.slice(0, 4))
  const index = Number(month.slice(5, 7))
  return index >= 12 ? `${year + 1}-01` : `${year}-${String(index + 1).padStart(2, '0')}`
}

// ── 2 · A BASE DE CLIENTES ────────────────────────────────────────────────────────────────────

/** O mínimo que a quebra por plano precisa de um parceiro. */
export interface PartnerMixRow {
  currency: string
  /** Decidido por `derivePartnerPlan`, nunca por uma comparação local. */
  planKind: PlanKind
  monthlyFeeCents: number | null
  /** O status do contrato vivo. `null` quando não há contrato. */
  contractStatus: ContractStatus | null
  /** A data que inicia a cobrança — a publicação, ou a assinatura quando não há trilha. */
  billingStartsAt: string | null
  billingStartSource: BillingStartSource | null
}

export interface PlanMix {
  currency: string
  total: number
  paying: number
  courtesy: number
  /** Faixa gratuita — pediu só o mapa, e não há o que cobrar. */
  free: number
  /** BR-B2B-017, item 6: ninguém disse quanto custa. Não é zero. */
  undeclared: number
  /** Contrato `terminated`. Sai de tudo: não é pagante, não é cortesia, não é gratuito. */
  terminated: number
  /** MRR de quem paga E assinou. É a linha firme da projeção. */
  committedMrrCents: number
  /** MRR de quem paga e ainda NÃO assinou. Ao lado do firme, nunca dentro. */
  uncommittedMrrCents: number
  /** Mensalidade média de quem paga. `null` sem pagantes — nunca zero. */
  averageFeeCents: number | null
  /**
   * Pagantes cuja cobrança AINDA NÃO COMEÇOU — não há publicação nem assinatura para contar.
   *
   * Eles não são receita nenhuma hoje e nem entram na projeção: o contrato só cobra a partir da
   * publicação. Sobem contados para a tela dizer que existe mensalidade contratada esperando um
   * marco, em vez de o operador procurar por que o MRR não bate com a lista de pagantes.
   */
  payingWithoutBillingStart: number
  /**
   * Quantos marcos NÃO vieram de um carimbo de publicação — caíram para a liberação ou o aceite.
   *
   * Só `publication` é o marco que o contrato nomeia. As outras duas respondem uma data próxima,
   * e a receita delas é aproximada: um número aproximado com cara de exato é o que este módulo
   * não pode produzir.
   */
  approximateBillingStarts: number
  ignoredCurrencies: string[]
}

/**
 * A base, quebrada por quem paga o quê.
 *
 * A ORDEM DAS PERGUNTAS É A MENSAGEM, como em `decide()`. `terminated` responde ANTES de tudo:
 * um parceiro cujo contrato foi encerrado não é um pagante que parou de pagar nem uma cortesia —
 * ele saiu, e contá-lo em qualquer das outras faixas inflaria a base com quem não está mais lá.
 *
 * O MRR NASCE PARTIDO EM DOIS, e é a razão de esta função existir em vez de um `filter().sum()`.
 * `derivePartnerPlan` já sabe que três fontes respondem "este parceiro paga?" — o contrato, o
 * cadastro e a proposta. Um MRR único somaria a mensalidade que alguém digitou na ficha com a
 * que o parceiro assinou, e a projeção passaria a prometer receita que ninguém contratou.
 */
export function summarizePlanMix(
  rows: readonly PartnerMixRow[],
  fallbackCurrency = 'BRL'
): PlanMix {
  const tally = new Map<string, number>()
  for (const row of rows) tally.set(row.currency, (tally.get(row.currency) ?? 0) + 1)

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

  const mix: PlanMix = {
    currency,
    total: rows.length,
    paying: 0,
    courtesy: 0,
    free: 0,
    undeclared: 0,
    terminated: 0,
    committedMrrCents: 0,
    uncommittedMrrCents: 0,
    averageFeeCents: null,
    payingWithoutBillingStart: 0,
    approximateBillingStarts: 0,
    ignoredCurrencies: [],
  }

  const ignored = new Set<string>()
  const fees: number[] = []

  for (const row of rows) {
    if (row.contractStatus === 'terminated') {
      mix.terminated += 1
      continue
    }

    switch (row.planKind) {
      case 'paid':
        mix.paying += 1
        break
      case 'courtesy':
        mix.courtesy += 1
        break
      case 'free':
        mix.free += 1
        break
      // `requested` é uma proposta que ninguém precificou: ela não declara nada, e é isso que
      // `undeclared` significa. Duas faixas para "não sei quanto custa" seria a mesma faixa.
      case 'undeclared':
      case 'requested':
      default:
        mix.undeclared += 1
        break
    }

    if (row.planKind !== 'paid') continue
    const fee = row.monthlyFeeCents
    if (fee === null || fee <= 0) continue
    if (row.currency !== currency) {
      ignored.add(row.currency)
      continue
    }

    fees.push(fee)
    if (row.contractStatus === 'signed') mix.committedMrrCents += fee
    else mix.uncommittedMrrCents += fee

    if (!row.billingStartsAt) mix.payingWithoutBillingStart += 1
    else if (row.billingStartSource !== 'publication') mix.approximateBillingStarts += 1
  }

  mix.averageFeeCents =
    fees.length > 0 ? Math.round(fees.reduce((sum, fee) => sum + fee, 0) / fees.length) : null
  mix.ignoredCurrencies = Array.from(ignored).sort()

  return mix
}

// ── 3 · A PROJEÇÃO ────────────────────────────────────────────────────────────────────────────

/** As duas premissas do operador. Nenhuma delas tem default silencioso na tela. */
export interface ProjectionPremise {
  /** Quantos pagantes novos por mês. `0` devolve a projeção conservadora. */
  newPayingPerMonth: number
  /** Fração mensal, `0.02` = 2%. */
  churnRate: number
}

export interface ProjectionMonth {
  /** `YYYY-MM`. */
  month: string
  /**
   * O CALENDÁRIO DO QUE JÁ ESTÁ ASSINADO — a soma das faturas que vencem neste mês, parceiro a
   * parceiro. Não é uma reta: cada parceiro entra no mês seguinte ao da sua publicação, e a
   * primeira fatura dele carrega o proporcional junto.
   */
  committedCents: number
  /** O que a premissa acrescenta. Zero no mês vigente — quem chega hoje só fatura no mês que vem. */
  premiseCents: number
  totalCents: number
  costCents: number
  covered: boolean
  /**
   * Verdadeiro quando o mês é SÓ calendário assinado, sem uma linha de palpite dentro.
   *
   * É o que permite a tela dizer "o mês vigente é previsão exata" sem que a frase valha para o
   * resto da janela — e é sempre verdade no primeiro mês, porque a premissa entra com um mês de
   * atraso, como manda o dia 20.
   */
  exact: boolean
}

export interface Projection {
  currency: string
  months: ProjectionMonth[]
  /** O primeiro mês em que a receita cobre o custo. `null` quando não cruza na janela. */
  breakEvenMonth: string | null
  /** Repetida na saída para a tela imprimi-la ao lado do gráfico, e não dentro do número. */
  premise: ProjectionPremise
  /** Verdadeiro quando não há pagante para tirar média: a premissa não produz nada. */
  premiseInert: boolean
}

/** O mês seguinte a `YYYY-MM`, sem passar por `Date` — dezembro vira janeiro do ano seguinte. */
function nextMonth(month: string): string {
  const year = Number(month.slice(0, 4))
  const index = Number(month.slice(5, 7))
  return index >= 12 ? `${year + 1}-01` : `${year}-${String(index + 1).padStart(2, '0')}`
}

/**
 * Os próximos meses, e a premissa fica visível.
 *
 * A JANELA COMEÇA NO MÊS VIGENTE, E O PRIMEIRO MÊS É EXATO. Ele é a soma das faturas que vencem
 * agora, de contratos assinados e publicados — não há palpite nenhum dentro dele. Isso não é um
 * detalhe de conveniência: é consequência do dia 20. Quem fecha hoje só tem primeiro vencimento
 * no dia 20 do mês que vem, então nada que a premissa suponha pode alterar o mês corrente.
 *
 * A LINHA FIRME NÃO É UMA RETA, e essa foi a correção de 2026-09-02. Ela era `committedCents`
 * repetido em todos os meses, o que dizia que a receita de hoje é a receita de março — ignorando
 * que um parceiro publicado neste mês entra no calendário só no próximo, e que a premissa de doze
 * faturas tira do calendário quem chega ao fim do horizonte. Agora ela é a soma do calendário,
 * mês a mês, e sobe em degraus como as faturas de fato sobem.
 *
 * O CHURN COME SÓ A CAMADA DE PREMISSA, e é uma escolha. Aplicá-lo também à linha firme faria a
 * única parte factual do gráfico deixar de ser factual: aquele calendário é o que está assinado,
 * e um palpite por cima dele apagaria a diferença entre o que existe e o que se espera. O
 * horizonte de faturas já é onde a premissa toca a linha firme, e ele é aplicado ANTES, na
 * montagem do calendário.
 *
 * SEM PAGANTE NÃO HÁ TICKET, E ENTÃO NÃO HÁ PREMISSA. `averageFeeCents` nulo devolve
 * `premiseInert` e uma projeção que é só o calendário. A alternativa seria arbitrar uma
 * mensalidade — inventar o preço que a empresa ainda não provou cobrar.
 *
 * O CUSTO DA JANELA INCLUI O KIT DOS NOVOS. Trazer parceiro custa material, e uma projeção que
 * some receita de aquisição sem somar o custo dela cruza o equilíbrio cedo demais.
 */
export function projectRevenue(input: {
  /** O mês em que a janela começa, `YYYY-MM` — o VIGENTE. */
  from: string
  /** Quantos meses ao todo. O padrão é 7: o vigente mais seis. */
  months?: number
  currency: string
  /**
   * A fatura de cada mês, já somada sobre os parceiros que cobram. Chega pronta porque quem sabe
   * a data de publicação de cada parceiro é o servidor, e refazer essa conta no navegador seria
   * uma segunda opinião sobre a mesma receita.
   */
  committedByMonth: Readonly<Record<string, number>>
  averageFeeCents: number | null
  fixedMonthlyCents: number
  /** Custo médio de material de um parceiro novo. Zero é aceitável; negativo não. */
  kitCostCents: number
  premise: ProjectionPremise
}): Projection {
  const span = Math.max(1, Math.min(24, Math.round(input.months ?? 7)))
  const novos = Math.max(0, Math.round(input.premise.newPayingPerMonth))
  const churn = Math.min(1, Math.max(0, input.premise.churnRate))
  const kit = Math.max(0, input.kitCostCents)
  const premise: ProjectionPremise = { newPayingPerMonth: novos, churnRate: churn }

  const fee = input.averageFeeCents
  const premiseInert = fee === null || fee <= 0

  const costCents = input.fixedMonthlyCents + novos * kit
  const months: ProjectionMonth[] = []

  // `billing` são os parceiros da premissa que JÁ faturam; `pending` são os que chegaram neste
  // mês e só faturam no dia 20 do mês seguinte. Separá-los é o que faz o mês vigente ser exato.
  let billing = 0
  let pending = 0
  let month = input.from
  let breakEvenMonth: string | null = null

  for (let index = 0; index < span; index += 1) {
    billing = billing * (1 - churn) + pending
    pending = novos

    const committedCents = Math.max(0, Math.round(input.committedByMonth[month] ?? 0))
    const premiseCents = premiseInert ? 0 : Math.round(billing * (fee as number))
    const totalCents = committedCents + premiseCents
    const covered = totalCents >= costCents
    if (covered && breakEvenMonth === null) breakEvenMonth = month

    months.push({
      month,
      committedCents,
      premiseCents,
      totalCents,
      costCents,
      covered,
      exact: premiseCents === 0,
    })
    month = nextMonth(month)
  }

  return { currency: input.currency, months, breakEvenMonth, premise, premiseInert }
}

// ── 4 · O CATÁLOGO DE PREÇO DECLARADO ─────────────────────────────────────────────────────────
//
// O QUE SOBROU, E O QUE MORREU. Este arquivo tinha `estimatePassRevenue`, que estimava a receita
// do app multiplicando compradores por um preço que o operador declarava. Ela existia porque o
// valor parecia não estar no banco — e estava: `drive.subscription_history.metadata.full_event`
// carrega o payload do RevenueCat com o valor real, na moeda real (ver `lib/finance/app-revenue.ts`,
// conferido contra o painel do RevenueCat em 2026-09-02).
//
// A estimativa foi removida em vez de ficar por perto: um segundo jeito de calcular a mesma
// receita é como duas telas passam a discordar. O CADASTRO de preço continua, para produto que
// não passe pelas lojas.

/** Uma linha de `finance.pass_prices`. */
export interface PassPrice {
  productId: string
  label: string
  priceCents: number
  currency: string
  /** `YYYY-MM-DD`. O preço de hoje não reprecifica a compra do mês passado. */
  effectiveFrom: string
  minutes: number | null
  /** `pass` é compra de uma vez; `subscription` é o ciclo de 30 dias da loja. */
  kind: 'pass' | 'subscription'
}
