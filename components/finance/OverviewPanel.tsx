'use client'

/**
 * A VISÃO GERAL — quanto entra, quanto sai, e daqui a quantos meses isso vira.
 *
 * SEIS FAIXAS, E CADA UMA CARREGA A PRÓPRIA RESSALVA. Um número consolidado é o que mais convida
 * a ser lido como conta fechada, então a ressalva não pode viver numa aba: `contratado, por
 * competência` fica na faixa do mês, `estimativa` fica colado no número do app, e a última faixa
 * lista as pendências COM O EFEITO de cada uma, não só a contagem.
 *
 * O QUE ESTA TELA NÃO CALCULA. A cascata, a quebra por plano e a base da projeção chegam prontas
 * de `/api/finance/clients`, computadas sobre a MESMA lista que a tabela de Parceiros desenha.
 * Uma segunda soma aqui é como um total acima passa a discordar das linhas abaixo — a mesma
 * decisão que `FinanceFigures` já tinha tomado.
 *
 * A ÚNICA CONTA QUE ACONTECE AQUI É A PROJEÇÃO, e ela acontece aqui de propósito: as duas
 * premissas são do operador e mudam a cada clique. `projectRevenue` é puro, então a curva
 * redesenha sem uma volta ao servidor por tecla digitada — e o servidor manda só a base, que é a
 * parte que não depende de palpite.
 *
 * A FAIXA DO APP PODE NÃO EXISTIR, E ISSO É DESENHO E NÃO FALHA. As RPCs agregadas do app são de
 * `admin` e o módulo abre para `editor`; `/api/finance/app-credit` responde `available: false` e
 * a faixa diz o motivo em vez de deixar um buraco na página.
 *
 * `text-gray-500` E NÃO `text-gray-400` no rótulo micro-caps: #9CA3AF sobre o painel mede 2,51:1
 * e reprova SC 1.4.3 (divergência D-C, medida em 2026-08-17). #6B7280 mede 4,83:1.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  AlertTriangle,
  Coins,
  Handshake,
  Info,
  TrendingUp,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatCount, formatMoney, formatMoneyCompact } from '@/lib/finance/money'
import { formatDurationOrDash } from '@/lib/format/duration'
import {
  projectRevenue,
  type MonthlyCascade,
  type MonthlyPoint,
  type PassPrice,
  type PlanMix,
} from '@/lib/finance/overview'
import type { FinanceSummary } from '@/lib/finance/summary'
import type { CohortReport } from '@/lib/finance/cohort'
import type { StructureSummary } from '@/lib/finance/structure'

/** O que o servidor manda para a projeção — tudo que não depende de palpite. */
export interface ProjectionBase {
  /** O mês VIGENTE. A janela começa nele, e ele é exato: o dia 20 garante isso. */
  from: string
  months: number
  currency: string
  /** A fatura de cada mês, já somada sobre os parceiros que cobram. Não é um MRR repetido. */
  committedByMonth: Record<string, number>
  averageFeeCents: number | null
  fixedMonthlyCents: number
  kitCostCents: number
}

interface AppCreditPayload {
  available: boolean
  reason?: string
  prices: PassPrice[]
  overview?: {
    total_users: number
    purchased_users: number
    granted_users: number
    low_balance_users: number
    consumed_minutes_paid: number | null
    consumed_minutes_granted: number | null
  } | null
  /** A receita lida do evento do RevenueCat — realizada e recorrente, por moeda. */
  revenue?: {
    realized: { currency: string; grossCents: number; netCents: number; transactions: number }[]
    recurring: { currency: string; grossCents: number; netCents: number; transactions: number }[]
    activeSubscriptions: number
    paidTransactions: number
    sandboxIgnored: number
    trials: number
    grossUsdCents: number
    netUsdCents: number
  }
  excludedAppUsers?: number
  aggregateIncludesExcluded?: boolean
}

interface Props {
  month: MonthlyCascade
  /** Dois meses para trás, o vigente e seis para a frente — receita ao lado do custo. */
  series: MonthlyPoint[]
  /** O que o app faturou fora da moeda do gráfico. Nomeado, nunca convertido. */
  appOtherCurrencies: { currency: string; grossCents: number }[]
  mix: PlanMix
  projectionBase: ProjectionBase
  summary: FinanceSummary
  cohorts: CohortReport
  structure: StructureSummary
  excludedPartners: number
  truncated: boolean
  purchasesAnswered: boolean
}

/** As duas premissas, com o valor inicial que a tela mostra até alguém mexer. */
const DEFAULT_NEW_PER_MONTH = 4
const DEFAULT_CHURN_PERCENT = 2

/**
 * A CAIXA DO PLOT, em unidades do `viewBox` — 1000×300, escalado por CSS.
 *
 * `right` para em 880 e não em 1000 porque os rótulos de ponta moram nos 120 que sobram: é o que
 * dispensa a caixa de legenda. `bottom` para em 250 para o eixo dos meses caber DENTRO do
 * viewBox — um container de altura fixa que exclui a faixa do eixo é o defeito que o guia de
 * dataviz descreve como "o gráfico cabe, os rótulos não, e o cartão ganha uma rolagem minúscula".
 */
const PLOT = { left: 56, right: 880, top: 34, bottom: 250 } as const

export function OverviewPanel({
  month,
  series,
  appOtherCurrencies,
  mix,
  projectionBase,
  summary,
  cohorts,
  structure,
  excludedPartners,
  truncated,
  purchasesAnswered,
}: Props) {
  const t = useTranslations('Finance')
  const money = (cents: number | null) => formatMoney(cents, month.currency)

  const [newPerMonth, setNewPerMonth] = useState(DEFAULT_NEW_PER_MONTH)
  const [churnPercent, setChurnPercent] = useState(DEFAULT_CHURN_PERCENT)
  const [credit, setCredit] = useState<AppCreditPayload | null>(null)
  const [creditFailed, setCreditFailed] = useState(false)

  // A faixa do app é a única leitura própria desta seção, e ela só acontece quando a seção
  // aparece: quem nunca abre a Visão geral não paga por duas RPCs de agregado.
  const loadCredit = useCallback(async () => {
    try {
      const response = await fetch('/api/finance/app-credit')
      if (!response.ok) {
        setCreditFailed(true)
        return
      }
      setCredit((await response.json()) as AppCreditPayload)
    } catch {
      setCreditFailed(true)
    }
  }, [])

  useEffect(() => {
    void loadCredit()
  }, [loadCredit])

  const projection = useMemo(
    () =>
      projectRevenue({
        from: projectionBase.from,
        months: projectionBase.months,
        currency: projectionBase.currency,
        committedByMonth: projectionBase.committedByMonth,
        averageFeeCents: projectionBase.averageFeeCents,
        fixedMonthlyCents: projectionBase.fixedMonthlyCents,
        kitCostCents: projectionBase.kitCostCents,
        premise: { newPayingPerMonth: newPerMonth, churnRate: churnPercent / 100 },
      }),
    [projectionBase, newPerMonth, churnPercent]
  )

  // O teto do gráfico sai do maior valor DESENHADO, incluindo a linha de custo: escalar só pela
  // receita esconderia a linha de custo acima do quadro justamente quando ela é a notícia.
  const ceiling = useMemo(() => {
    const values = projection.months.flatMap((row) => [row.totalCents, row.costCents])
    return Math.max(1, ...values) * 1.12
  }, [projection])

  const recentCohorts = useMemo(() => cohorts.lines.slice(0, 6).reverse(), [cohorts])
  const cohortCeiling = useMemo(
    () => Math.max(1, ...recentCohorts.map((line) => line.clients)),
    [recentCohorts]
  )

  // O teto da série é o maior valor DESENHADO — receita ou custo. Escalar só pela receita
  // esconderia a linha de custo fora do quadro justamente quando ela é a notícia.
  const seriesCeiling = useMemo(() => {
    const values = series.flatMap((row) => [
      row.recurringRevenueCents + row.revenueBlockedCents + row.appRevenueCents,
      row.variableCostCents + row.operatingCostCents + row.fixedMonthlyCents,
    ])
    return Math.max(1, ...values)
  }, [series])

  /** Qual mês o mouse está lendo. `null` = nenhum, e aí o quadro mostra o mês corrente. */
  const [hovered, setHovered] = useState<number | null>(null)

  const chart = useMemo(() => {
    const months = Math.max(1, series.length)
    const stepX = months > 1 ? (PLOT.right - PLOT.left) / (months - 1) : 0
    const xOf = (index: number) => PLOT.left + index * stepX
    const yOf = (cents: number) =>
      PLOT.bottom - (Math.max(0, cents) / seriesCeiling) * (PLOT.bottom - PLOT.top)

    const revenueAt = (row: MonthlyPoint) => row.recurringRevenueCents + row.appRevenueCents
    const ceilingAt = (row: MonthlyPoint) => revenueAt(row) + row.revenueBlockedCents
    const costAt = (row: MonthlyPoint) =>
      row.variableCostCents + row.operatingCostCents + row.fixedMonthlyCents

    const path = (pick: (row: MonthlyPoint) => number) =>
      series.map((row, index) => `${xOf(index)},${yOf(pick(row))}`).join(' ')

    // A FAIXA FECHA ENTRE RECEITA E CUSTO: ida pela receita, volta pelo custo. É um polígono só,
    // e não uma área por mês — a cor precisa correr contínua para se ler como distância.
    const forward = series.map((row, index) => `${xOf(index)},${yOf(revenueAt(row))}`)
    const back = series
      .map((row, index) => `${xOf(index)},${yOf(costAt(row))}`)
      .reverse()
    const resultBand = `M${forward.join(' L')} L${back.join(' L')} Z`

    const last = series[series.length - 1]
    // Os dois rótulos de ponta não podem colidir: quando as linhas terminam perto, o de baixo
    // desce o suficiente para os dois caberem. Empilhá-los sem afastar os desligaria das linhas.
    const revenueEnd = yOf(revenueAt(last))
    const costEnd = yOf(costAt(last))
    const apart = Math.abs(revenueEnd - costEnd) < 16

    return {
      stepX,
      xOf,
      yOf,
      revenueAt,
      costAt,
      revenueLine: path(revenueAt),
      revenueCeilingLine: path(ceilingAt),
      costLine: path(costAt),
      resultBand,
      hasBlocked: series.some((row) => row.revenueBlockedCents > 0),
      endLabels: {
        cost: apart && costEnd > revenueEnd ? costEnd + 12 : costEnd + 4,
        revenue: apart && revenueEnd > costEnd ? revenueEnd + 12 : revenueEnd + 4,
      },
    }
  }, [series, seriesCeiling])

  const { stepX, xOf, yOf, revenueAt, costAt, revenueLine, revenueCeilingLine, costLine, resultBand, hasBlocked, endLabels } = chart

  /** O mês corrente na série. Ele é o marcado sem mouse, e o padrão do quadro. */
  const currentIndex = Math.max(
    0,
    series.findIndex((row) => row.month === projectionBase.from)
  )

  const pendings = [
    summary.ordersAwaitingShipment,
    summary.unpricedLines,
    mix.payingWithoutBillingStart,
    mix.approximateBillingStarts,
    truncated ? 1 : 0,
    purchasesAnswered ? 0 : 1,
  ].reduce((sum, value) => sum + value, 0)

  return (
    <div className="flex flex-col gap-5">

      {/* ── FAIXA 1 · O MÊS EM CASCATA ────────────────────────────────────────────────────── */}
      <Card>
        <CardHead
          title={t('overview.month.title', { month: monthLabel(month.month) })}
          aside={
            <div className="flex flex-wrap items-center gap-2">
              {/* A receita do mês corrente NÃO é parcial: a fatura vence no dia 20 e corresponde
                  ao mês em que vence, então ela é conhecida desde o dia 1º. O custo é que ainda
                  está correndo, e é só isso que o rótulo ressalva. */}
              {month.month === projectionBase.from && (
                <span className="rounded-full bg-tuggi-blue/10 px-2.5 py-1 text-[11px] font-semibold text-primary-800 dark:text-tuggi-blue">
                  {t('overview.month.inProgress')}
                </span>
              )}
              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                {t('overview.month.accrual')}
              </span>
            </div>
          }
        />

        <div className="flex flex-col gap-3 p-5 lg:flex-row lg:items-stretch">
          <Step label={t('overview.month.revenue')} value={money(month.recurringRevenueCents)} hint={t('overview.month.revenueHint', { count: mix.paying, fee: money(mix.averageFeeCents) })} />
          <Operator symbol="−" />
          <Step
            label={t('overview.month.variable')}
            value={money(month.variableCostCents)}
            hint={
              month.month === projectionBase.from
                ? t('overview.month.variableSoFar', { count: month.deliveries })
                : t('overview.month.variableHint', { count: month.deliveries })
            }
          />
          {/* O CUSTO VARIÁVEL DA OPERAÇÃO SÓ APARECE QUANDO EXISTE. Ele é outra linha que o
              variável acima, e a diferença é de quem é o custo: aquele é do PARCEIRO e desce até a
              linha dele; este é da operação, e ninguém consegue dizer de qual parceiro é o token
              gasto gerando um POI. Num mês sem custo desses, um degrau de R$ 0,00 no meio da
              cascata só faria o operador procurar o que ele significa. */}
          {month.operatingCostCents > 0 && (
            <>
              <Operator symbol="−" />
              <Step
                label={t('overview.month.operating')}
                value={money(month.operatingCostCents)}
                hint={t('overview.month.operatingHint')}
              />
            </>
          )}
          <Operator symbol="−" />
          <Step label={t('overview.month.fixed')} value={money(month.fixedMonthlyCents)} tone="amber" />
          <Operator symbol="=" />
          <Step
            label={t('overview.month.result')}
            value={money(month.resultCents)}
            tone="brand"
            emphasis
            negative={month.resultCents < 0}
          />
        </div>

        <div className="flex flex-col gap-2 border-t border-gray-100 px-5 py-3 text-[11px] text-gray-600 dark:border-gray-800 dark:text-gray-400 lg:flex-row lg:gap-8">
          <span>{t('overview.month.standard', { value: money(month.standardCostCents) })}</span>
          <span>{t('overview.month.oneOff', { value: money(month.oneOffCents) })}</span>
          {/* O QUE NÃO SAIU DO CAIXA fica ao lado do que saiu. Um crédito invisível faz a conta
              do mês parecer barata sem dizer até quando ela será. */}
          {month.creditCents > 0 && (
            <span className="text-emerald-700 dark:text-emerald-300">
              {t('overview.month.credit', { value: money(month.creditCents) })}
            </span>
          )}
          {/* O MÊS TAMBÉM DIZ QUE CONVERTEU. A cascata acima pode embutir conta em dólar e
              assinatura em euro a uma PREMISSA declarada; sem esta linha, ela passaria por um
              número nascido em reais. */}
          {month.appliedRates.length > 0 && (
            <span>
              {t('overview.month.fx', {
                pairs: month.appliedRates
                  .map((rate) => `${rate.currency} ${money(Math.round(rate.rateToBrl * 100))}`)
                  .join(' · '),
              })}
            </span>
          )}
          {month.unpricedLines > 0 && (
            <span className="text-amber-800 dark:text-amber-300">
              {t('overview.month.floor', { count: month.unpricedLines })}
            </span>
          )}
        </div>
      </Card>

      {/* ── FAIXA 1b · RECEITA E CUSTO, MÊS A MÊS ─────────────────────────────────────────── */}
      {/*
        DE BARRAS EMPILHADAS PARA LINHAS, em 2026-09-03, e o pedido do operador foi literal:
        "ficou uma salada para explicar e entender, preciso olhar 3 lugares — o gráfico, daí a
        legenda de cores, e depois os valores".

        Ele estava certo, e o guia de dataviz nomeia a causa: com CINCO séries na legenda a
        identidade passa a depender de parear cor, e uma faixa de valores solta embaixo do eixo
        não é leitura — é um terceiro lugar. A resposta não era rotular mais, era desenhar menos.

        A DISTÂNCIA ENTRE AS LINHAS É O ASSUNTO, e ela é pintada. A pergunta desta faixa é "em que
        mês eu ganho mais do que gasto?", e com a área tingida ninguém subtrai dois números com os
        olhos: a cor responde antes da leitura.

        TRÊS LINHAS, TRÊS RÓTULOS NAS PONTAS, NENHUMA CAIXA DE LEGENDA. O guia dispensa a legenda
        quando as séries são poucas e nomeadas onde terminam — e uma legenda que se lê uma vez, na
        ponta da linha que ela nomeia, não é um segundo lugar para olhar.

        A RECEITA CONTINUA SENDO DUAS COISAS, e é por isso que são duas linhas do MESMO azul e não
        uma soma. A regra é a que as barras já defendiam: fatura emitida e assinatura pendente são
        o mesmo dinheiro em dois estados, e somá-las num total único prometeria o contrato que
        ainda não veio. A sólida é o que a cobrança emite; a tracejada é o teto se todos assinarem,
        e o vão entre elas é exatamente o que está preso na assinatura.

        E A COMPOSIÇÃO NÃO SUMIU — ela mudou de lugar. As seis parcelas do mês vivem no quadro que
        abre ao passar o mouse, que é onde uma quebra de seis linhas cabe sem disputar espaço com
        as outras onze colunas.
      */}
      <Card>
        <CardHead title={t('overview.series.title')} />

        <div className="overflow-x-auto px-5 pb-2 pt-4">
          <div className="min-w-[680px]">
            <svg
              viewBox="0 0 1000 300"
              className="w-full"
              role="img"
              aria-label={t('overview.series.title')}
            >
              {/* A GRADE É RECESSIVA e carrega os valores que ninguém rotulou. Quatro passos:
                  menos que isso obriga a estimar, mais vira hachura. */}
              {[0, 0.25, 0.5, 0.75, 1].map((step) => (
                <g key={step}>
                  <line
                    x1={PLOT.left}
                    y1={yOf(step * seriesCeiling)}
                    x2={PLOT.right}
                    y2={yOf(step * seriesCeiling)}
                    className={step === 0 ? 'stroke-gray-300 dark:stroke-gray-700' : 'stroke-gray-100 dark:stroke-gray-800'}
                    strokeWidth={1}
                  />
                  <text
                    x={PLOT.left - 8}
                    y={yOf(step * seriesCeiling) + 3}
                    textAnchor="end"
                    className="fill-gray-400 text-[10px] tabular-nums dark:fill-gray-500"
                  >
                    {formatMoneyCompact(Math.round(step * seriesCeiling))}
                  </text>
                </g>
              ))}

              {/* A RÉGUA DO MÊS CORRENTE — pedida pelo operador em 2026-09-03, "para guiar".
                  Ela guia duas coisas: onde ele está, e ONDE A SÉRIE MUDA DE NATUREZA. À
                  esquerda é fatura que já venceu; à direita é o calendário de cobrança de quem
                  já assinou — `realized` na série, e até hoje o gráfico desenhava os dois lados
                  iguais.

                  ELA É SÓLIDA E FICA ATRÁS DOS DADOS, e a do mouse é tracejada e fica na frente:
                  duas réguas verticais com o mesmo traço seriam indistinguíveis, e a do mouse
                  passaria por cima desta a cada movimento sem ninguém notar a diferença. */}
              <line
                x1={xOf(currentIndex)}
                y1={PLOT.top}
                x2={xOf(currentIndex)}
                y2={PLOT.bottom}
                strokeWidth={1}
                className="stroke-gray-300 dark:stroke-gray-700"
              />
              {/* A palavra faz o trabalho que um tracejado no lado direito faria — e o tracejado
                  já tem dono nesta faixa: ele é o teto da receita amarrada. Uma segunda gramática
                  de traço obrigaria a decodificar qual é qual. */}
              {currentIndex < series.length - 1 && (
                <text
                  x={xOf(currentIndex) + 6}
                  y={PLOT.top - 8}
                  className="fill-gray-400 text-[10px] dark:fill-gray-500"
                >
                  {t('overview.series.projectedFrom')}
                </text>
              )}

              {/* A FAIXA DO RESULTADO. Ela fecha entre a receita que FATURA e o custo — nunca
                  entre o teto tracejado e o custo, que pintaria de lucro uma assinatura que
                  ninguém deu. */}
              <path d={resultBand} className="fill-red-600/[0.07] dark:fill-red-500/10" />

              {/* custo */}
              <polyline
                points={costLine}
                fill="none"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                className="stroke-amber-600"
              />
              {/* o teto da receita: o que entra SE todos assinarem. Tracejado porque é condição,
                  não fato — e no mesmo azul porque é o mesmo dinheiro. */}
              {hasBlocked && (
                <polyline
                  points={revenueCeilingLine}
                  fill="none"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  strokeLinejoin="round"
                  className="stroke-primary-800/60 dark:stroke-tuggi-blue/60"
                />
              )}
              {/* a receita que a cobrança emite */}
              <polyline
                points={revenueLine}
                fill="none"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                className="stroke-primary-800 dark:stroke-tuggi-blue"
              />

              {/* RÓTULOS DIRETOS NA PONTA — a legenda, onde a linha termina. */}
              <text x={PLOT.right + 10} y={endLabels.cost} className="fill-amber-700 text-[11px] font-semibold dark:fill-amber-400">
                {t('overview.series.costLine')}
              </text>
              <text x={PLOT.right + 10} y={endLabels.revenue} className="fill-primary-800 text-[11px] font-semibold dark:fill-tuggi-blue">
                {t('overview.series.revenueLine')}
              </text>

              {/* A COLUNA INTEIRA É O ALVO DO MOUSE, e não a linha de 2px. O guia pede alvo maior
                  que a marca; aqui ele é a fatia do mês inteira, de cima a baixo. */}
              {series.map((row, index) => (
                <rect
                  key={row.month}
                  x={xOf(index) - stepX / 2}
                  y={PLOT.top}
                  width={stepX}
                  height={PLOT.bottom - PLOT.top}
                  fill="transparent"
                  onMouseEnter={() => setHovered(index)}
                  onMouseLeave={() => setHovered(null)}
                />
              ))}

              {hovered !== null && (
                <line
                  x1={xOf(hovered)}
                  y1={PLOT.top}
                  x2={xOf(hovered)}
                  y2={PLOT.bottom}
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  className="stroke-gray-400 dark:stroke-gray-500"
                />
              )}

              {/* o mês corrente fica marcado mesmo sem mouse: é a coluna que decide */}
              <circle
                cx={xOf(currentIndex)}
                cy={yOf(revenueAt(series[currentIndex]))}
                r={4}
                className="fill-white stroke-primary-800 dark:fill-gray-900 dark:stroke-tuggi-blue"
                strokeWidth={2}
              />
              <circle
                cx={xOf(currentIndex)}
                cy={yOf(costAt(series[currentIndex]))}
                r={4}
                className="fill-white stroke-amber-600 dark:fill-gray-900"
                strokeWidth={2}
              />

              {series.map((row, index) => (
                <text
                  key={row.month}
                  x={xOf(index)}
                  y={PLOT.bottom + 20}
                  textAnchor="middle"
                  className={`text-[10px] ${
                    row.month === projectionBase.from
                      ? 'fill-gray-900 font-bold dark:fill-white'
                      : 'fill-gray-400 dark:fill-gray-500'
                  }`}
                >
                  {row.month.slice(5)}
                </text>
              ))}
            </svg>

            {/* O QUADRO DO MÊS. Ele fica FORA do svg, num bloco de altura fixa: dentro dele um
                `foreignObject` que aparece e some faria a faixa pular a cada movimento do mouse.
                Sem mouse ele mostra o mês corrente — a tela responde antes de alguém interagir. */}
            <MonthBreakdown row={series[hovered ?? currentIndex]} currency={mix.currency} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-gray-100 px-5 py-3 text-[11px] text-gray-600 dark:border-gray-800 dark:text-gray-400">
          <span>{t('overview.series.hint')}</span>
          {/* UM GRÁFICO TEM UM EIXO. O que o app faturou noutra moeda não vira real aqui — ele é
              nomeado ao lado, com o total, como o resto do módulo já faz. */}
          {appOtherCurrencies.length > 0 && (
            <span className="text-amber-800 dark:text-amber-300">
              {t('overview.series.otherCurrencies', {
                list: appOtherCurrencies
                  .map((line) => formatMoney(line.grossCents, line.currency))
                  .join(' · '),
              })}
            </span>
          )}
        </div>
      </Card>

      {/* ── FAIXA 2 · BASE DE CLIENTES ────────────────────────────────────────────────────── */}
      <Card>
        <CardHead title={t('overview.base.title')} />

        <div className="flex flex-col gap-6 p-5 lg:flex-row">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2.5">
              <span className="text-3xl font-extrabold tracking-tight text-gray-900 dark:text-white">
                {formatCount(mix.total)}
              </span>
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {t('overview.base.partners')}
              </span>
            </div>

            <div className="mt-3.5 flex h-3 gap-0.5 overflow-hidden rounded-full">
              <Segment value={mix.paying} total={mix.total} className="bg-primary-800" />
              <Segment value={mix.courtesy} total={mix.total} className="bg-primary-700" />
              <Segment value={mix.free} total={mix.total} className="bg-primary-100" />
              <Segment value={mix.undeclared} total={mix.total} className="bg-gray-200 dark:bg-gray-700" />
              <Segment value={mix.terminated} total={mix.total} className="bg-gray-400 dark:bg-gray-500" />
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Legend swatch="bg-primary-800" value={mix.paying} label={t('overview.base.paying')} />
              <Legend swatch="bg-primary-700" value={mix.courtesy} label={t('overview.base.courtesy')} />
              <Legend swatch="bg-primary-100" value={mix.free} label={t('overview.base.free')} />
              <Legend swatch="bg-gray-200 dark:bg-gray-700" value={mix.undeclared} label={t('overview.base.undeclared')} />
              <Legend swatch="bg-gray-400 dark:bg-gray-500" value={mix.terminated} label={t('overview.base.terminated')} />
            </dl>

            {/* O ponto de equilíbrio vira FRASE e não caixinha: ele é o número que decide algo, e
                uma caixinha o deixaria com o mesmo peso de uma contagem qualquer. */}
            {structure.breakEvenPartners !== null && (
              <div className="mt-4 flex items-center gap-4 rounded-2xl bg-gray-50 px-4 py-3 dark:bg-gray-800/50">
                <span className="flex-shrink-0 text-3xl font-extrabold leading-none tracking-tight text-secondary-700">
                  {formatCount(Math.max(0, structure.breakEvenPartners - mix.paying))}
                </span>
                <p className="text-xs leading-relaxed text-gray-700 dark:text-gray-300">
                  {t('overview.base.breakEven', {
                    fee: money(mix.averageFeeCents),
                    fixed: money(structure.monthlyFixedCents),
                  })}
                </p>
              </div>
            )}

            {mix.uncommittedMrrCents > 0 && (
              <p className="mt-3 text-[11px] leading-relaxed text-gray-600 dark:text-gray-400">
                {t('overview.base.uncommitted', {
                  value: money(mix.uncommittedMrrCents),
                  committed: money(mix.committedMrrCents),
                })}
              </p>
            )}
          </div>

          <div className="w-full flex-shrink-0 lg:w-[38%]">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
              {t('overview.base.joined')}
            </h3>

            {recentCohorts.length === 0 ? (
              <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">{t('overview.base.noCohorts')}</p>
            ) : (
              <>
                <div className="mt-4 flex h-24 items-end gap-3 border-b border-gray-200 dark:border-gray-700">
                  {recentCohorts.map((line) => (
                    <div key={line.month} className="flex flex-1 flex-col items-center gap-1.5">
                      <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-300">
                        {formatCount(line.clients)}
                      </span>
                      <div
                        className="w-full rounded-t bg-primary-700"
                        style={{ height: `${Math.round((line.clients / cohortCeiling) * 76)}px` }}
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-1.5 flex gap-3">
                  {recentCohorts.map((line) => (
                    <span key={line.month} className="flex-1 text-center text-[10px] text-gray-500 dark:text-gray-400">
                      {line.month.slice(5)}
                    </span>
                  ))}
                </div>
              </>
            )}

            {cohorts.undated > 0 && (
              <p className="mt-3 text-[11px] leading-relaxed text-gray-600 dark:text-gray-400">
                {t('overview.base.undated', { count: cohorts.undated })}
              </p>
            )}
          </div>
        </div>
      </Card>

      {/* ── FAIXA 3 + 4 · APP E AQUISIÇÃO ─────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-5 xl:flex-row">

        <Card className="min-w-0 flex-1">
          <CardHead title={t('overview.app.title')} />

          {creditFailed && (
            <p role="status" className="p-5 text-sm text-gray-600 dark:text-gray-400">
              {t('overview.app.failed')}
            </p>
          )}

          {!creditFailed && credit && !credit.available && (
            <p role="status" className="p-5 text-sm text-gray-600 dark:text-gray-400">
              {t('overview.app.requiresAdmin')}
            </p>
          )}

          {credit?.available && credit.revenue && (
            <div className="flex flex-col gap-4 p-5">
              <div className="flex flex-col gap-3 sm:flex-row">
                {/* JÁ ENTROU × VOLTA. O passe de 7 dias foi descontinuado: ele conta à esquerda
                    e nunca à direita, e isso sai da regra — compra de uma vez não tem vencimento. */}
                <div className="flex-1 rounded-2xl bg-tuggi-blue/[0.06] px-4 py-3.5 ring-1 ring-tuggi-blue/25">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-primary-800 dark:text-tuggi-blue">
                    {t('overview.app.realized')}
                  </div>
                  <div className="mt-1.5 flex flex-col gap-0.5">
                    {credit.revenue.realized.map((line) => (
                      <div key={line.currency} className="text-lg font-bold tracking-tight text-gray-900 dark:text-white">
                        {formatMoney(line.grossCents, line.currency)}
                      </div>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] text-gray-600 dark:text-gray-400">
                    {t('overview.app.transactions', { count: credit.revenue.paidTransactions })}
                  </p>
                </div>

                <div className="flex-1 rounded-2xl bg-gray-50 px-4 py-3.5 dark:bg-gray-800/50">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                    {t('overview.app.recurring')}
                  </div>
                  <div className="mt-1.5 flex flex-col gap-0.5">
                    {credit.revenue.recurring.length === 0 ? (
                      <span className="text-lg font-bold text-gray-400">—</span>
                    ) : (
                      credit.revenue.recurring.map((line) => (
                        <div key={line.currency} className="text-lg font-bold tracking-tight text-gray-900 dark:text-white">
                          {formatMoney(line.grossCents, line.currency)}
                        </div>
                      ))
                    )}
                  </div>
                  <p className="mt-1.5 text-[11px] text-gray-600 dark:text-gray-400">
                    {t('overview.app.subscriptions', { count: credit.revenue.activeSubscriptions })}
                  </p>
                </div>
              </div>

              {/* O DÓLAR É A ÚNICA PONTE ENTRE AS MOEDAS, e quem o calcula é o RevenueCat — este
                  módulo não converte nada. */}
              <div className="rounded-2xl bg-gray-50 px-4 py-3 dark:bg-gray-800/50">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                    {t('overview.app.usdBridge')}
                  </span>
                  <span className="text-base font-bold text-gray-900 dark:text-white">
                    {formatMoney(credit.revenue.netUsdCents, 'USD')}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-gray-600 dark:text-gray-400">
                  {t('overview.app.usdHint', {
                    gross: formatMoney(credit.revenue.grossUsdCents, 'USD'),
                  })}
                </p>
              </div>

              {credit.revenue.sandboxIgnored > 0 && (
                <p className="flex gap-2 text-[11px] leading-relaxed text-gray-600 dark:text-gray-400">
                  <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                  {t('overview.app.sandbox', { count: credit.revenue.sandboxIgnored })}
                </p>
              )}

              {credit.aggregateIncludesExcluded && (
                <p className="flex gap-2 text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                  {t('overview.app.excludedNotice', { count: credit.excludedAppUsers ?? 0 })}
                </p>
              )}
            </div>
          )}
        </Card>

        <Card className="min-w-0 flex-1">
          <CardHead title={t('overview.acquisition.title')} />

          <div className="flex flex-col gap-3 p-5">
            <div className="flex flex-col gap-3 sm:flex-row">
              <Tile icon={<Users className="h-4 w-4 text-primary-800 dark:text-tuggi-blue" aria-hidden="true" />} label={t('overview.acquisition.acquired')} value={formatCount(summary.acquiredUsers)} hint={t('overview.acquisition.teamHint', { count: summary.teamUsers })} />
              <Tile icon={<Coins className="h-4 w-4 text-primary-800 dark:text-tuggi-blue" aria-hidden="true" />} label={t('overview.acquisition.cac')} value={money(summary.cacCents)} hint={t('overview.acquisition.cacHint')} />
            </div>

            <div className="rounded-2xl bg-gray-50 px-4 py-3 dark:bg-gray-800/50">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                  {t('overview.acquisition.conversion')}
                </span>
                <span className="text-base font-bold text-gray-900 dark:text-white">
                  {summary.usersWithPurchase === null
                    ? '—'
                    : summary.purchaseIsFloor
                      ? `≥ ${formatCount(summary.usersWithPurchase)}`
                      : formatCount(summary.usersWithPurchase)}
                  <span className="ml-1.5 text-xs font-normal text-gray-600 dark:text-gray-400">
                    {t('overview.acquisition.of', { count: summary.acquiredUsers })}
                  </span>
                </span>
              </div>
              {(summary.usersWithPurchase === null || summary.purchaseIsFloor) && (
                <p className="mt-1 text-[11px] text-gray-600 dark:text-gray-400">
                  {summary.usersWithPurchase === null
                    ? t('overview.acquisition.conversionUnknown')
                    : t('overview.pendings.suppressed')}
                </p>
              )}
            </div>

            {excludedPartners > 0 && (
              <p className="flex gap-2 text-[11px] leading-relaxed text-gray-600 dark:text-gray-400">
                <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                {t('overview.acquisition.excluded', { count: excludedPartners })}
              </p>
            )}
          </div>
        </Card>
      </div>

      {/* ── FAIXA 5 · PROJEÇÃO ────────────────────────────────────────────────────────────── */}
      <Card>
        <CardHead
          title={t('overview.projection.title')}
          aside={
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 rounded-xl border border-input px-3 py-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t('overview.projection.newPerMonth')}
                </span>
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={newPerMonth}
                  onChange={(event) => setNewPerMonth(Math.max(0, Math.min(50, Number(event.target.value) || 0)))}
                  className="w-14 bg-transparent text-sm font-bold text-gray-900 outline-none dark:text-white"
                />
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-input px-3 py-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t('overview.projection.churn')}
                </span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={churnPercent}
                  onChange={(event) => setChurnPercent(Math.max(0, Math.min(100, Number(event.target.value) || 0)))}
                  className="w-12 bg-transparent text-sm font-bold text-gray-900 outline-none dark:text-white"
                />
                <span className="text-sm text-gray-600 dark:text-gray-400">%</span>
              </label>
            </div>
          }
        />

        <div className="flex flex-col gap-6 p-5 lg:flex-row">
          <div className="min-w-0 flex-1">
            <div className="relative flex h-52 items-end gap-4 border-b border-gray-300 dark:border-gray-600">
              {/* A linha de custo é tracejada e nomeada: sem o rótulo, uma linha horizontal num
                  gráfico de barras é lida como uma média. */}
              <div
                className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed border-amber-600"
                style={{ bottom: `${(projection.months[0].costCents / ceiling) * 100}%` }}
              />
              <span
                className="pointer-events-none absolute right-0 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-900 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-200"
                style={{ bottom: `calc(${(projection.months[0].costCents / ceiling) * 100}% + 4px)` }}
              >
                {t('overview.projection.cost', { value: money(projection.months[0].costCents) })}
              </span>

              {projection.months.map((row) => {
                const total = Math.round((row.totalCents / ceiling) * 100)
                const firm = Math.round((row.committedCents / ceiling) * 100)
                return (
                  <div key={row.month} className="flex min-w-0 flex-1 flex-col justify-end gap-1">
                    <span
                      className={`text-center text-[11px] font-semibold ${
                        row.month === projection.breakEvenMonth
                          ? 'text-secondary-700'
                          : 'text-gray-600 dark:text-gray-400'
                      }`}
                    >
                      {money(row.totalCents)}
                    </span>
                    {/* A camada de premissa é HACHURADA porque não é fato. Textura é o que
                        distingue previsão de contrato sem depender de cor sozinha. */}
                    <div
                      className="rounded-t bg-tuggi-blue/30 bg-[repeating-linear-gradient(45deg,rgba(0,168,232,0.85)_0_4px,rgba(0,168,232,0.2)_4px_8px)]"
                      style={{ height: `${Math.max(0, total - firm)}%` }}
                    />
                    <div className="bg-primary-800" style={{ height: `${firm}%` }} />
                  </div>
                )
              })}
            </div>

            <div className="mt-1.5 flex gap-4">
              {projection.months.map((row) => (
                <span
                  key={row.month}
                  className={`flex-1 text-center text-[11px] ${
                    row.month === projection.breakEvenMonth
                      ? 'font-bold text-secondary-700'
                      : 'text-gray-500 dark:text-gray-400'
                  }`}
                >
                  {row.month.slice(5)}
                </span>
              ))}
            </div>

            {projection.months[0]?.exact && (
              <p className="mt-3 text-[11px] leading-relaxed text-gray-600 dark:text-gray-400">
                {t('overview.projection.exact', {
                  month: monthLabel(projection.months[0].month),
                  value: money(projection.months[0].totalCents),
                })}
              </p>
            )}

            <div className="mt-4 flex flex-wrap gap-4">
              <LegendMark className="bg-primary-800" label={t('overview.projection.committed')} />
              <LegendMark className="bg-[repeating-linear-gradient(45deg,rgba(0,168,232,0.85)_0_3px,rgba(0,168,232,0.2)_3px_6px)]" label={t('overview.projection.premise')} />
              <LegendMark className="h-0 border-t-2 border-dashed border-amber-600" label={t('overview.projection.costLegend')} />
            </div>
          </div>

          <div className="w-full flex-shrink-0 space-y-3 lg:w-[300px]">
            <div className="rounded-2xl bg-gray-50 p-4 dark:bg-gray-800/50">
              <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                {t('overview.projection.crossing')}
              </div>
              <div className="mt-1.5 text-2xl font-extrabold tracking-tight text-secondary-700">
                {projection.breakEvenMonth ? monthLabel(projection.breakEvenMonth) : t('overview.projection.noCrossing')}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-gray-700 dark:text-gray-300">
                {projection.premiseInert
                  ? t('overview.projection.inert')
                  : t('overview.projection.crossingHint', { count: newPerMonth })}
              </p>
            </div>

            {/* A premissa fica ESCRITA ao lado do gráfico, e não embutida no número. Um gráfico que
                incorpora um palpite sem dizer qual é um gráfico que promete. */}
            <dl className="space-y-2 rounded-2xl p-4 text-xs text-gray-700 ring-1 ring-gray-200 dark:text-gray-300 dark:ring-gray-800">
              <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                {t('overview.projection.written')}
              </div>
              <Row label={t('overview.projection.newPerMonth')} value={formatCount(newPerMonth)} />
              <Row label={t('overview.projection.churn')} value={`${churnPercent}%`} />
              <Row label={t('overview.projection.averageFee')} value={money(projectionBase.averageFeeCents)} />
              <Row label={t('overview.projection.kit')} value={money(projectionBase.kitCostCents)} />
              <Row label={t('overview.projection.fixed')} value={money(projectionBase.fixedMonthlyCents)} />
            </dl>

            {/* O DINHEIRO QUE NÃO ESTÁ DESENHADO, ao lado de onde a pergunta nasce.
                Ele não é uma camada do gráfico porque não pertence a mês nenhum: um contrato
                enviado só produz primeira fatura no mês seguinte ao ACEITE, e ninguém sabe
                quando o aceite vem. Desenhá-lo em setembro prometeria uma emissão que o
                calendário não consegue fazer. */}
            {mix.uncommittedMrrCents > 0 && (
              <div className="rounded-2xl bg-gray-50 p-4 dark:bg-gray-800/50">
                <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                  {t('overview.projection.pendingTitle')}
                </div>
                <div className="mt-1.5 text-xl font-bold text-gray-900 dark:text-white">
                  {money(mix.uncommittedMrrCents)}
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-gray-600 dark:text-gray-400">
                  {t('overview.projection.pendingHint')}
                </p>
              </div>
            )}

            {/* O CRUZAMENTO É OTIMISTA ENQUANTO A ESTRUTURA NÃO ESTIVER LANÇADA. Com custo fixo
                zerado, a linha de custo é só o material dos novos — e ela é fácil de cruzar. */}
            {projectionBase.fixedMonthlyCents === 0 && (
              <p className="flex gap-2 rounded-2xl bg-amber-50 p-3.5 text-[11px] leading-relaxed text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                {t('overview.projection.noFixedCost')}
              </p>
            )}

            <p className="flex gap-2 rounded-2xl bg-amber-50 p-3.5 text-[11px] leading-relaxed text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
              {t('overview.projection.noB2c')}
            </p>
          </div>
        </div>
      </Card>

      {/* ── FAIXA 6 · PENDÊNCIAS ──────────────────────────────────────────────────────────── */}
      <Card>
        <CardHead
          title={t('overview.pendings.title')}
          hint={pendings === 0 ? t('overview.pendings.none') : undefined}
        />

        {pendings > 0 && (
          <div className="grid gap-px bg-gray-100 dark:bg-gray-800 sm:grid-cols-2 xl:grid-cols-3">
            {summary.ordersAwaitingShipment > 0 && (
              <Pending
                count={summary.ordersAwaitingShipment}
                title={t('summary.awaitingShipment')}
                effect={t('summary.awaitingShipmentHint')}
              />
            )}
            {summary.unpricedLines > 0 && (
              <Pending
                count={summary.unpricedLines}
                title={t('summary.unpriced')}
                effect={t('overview.pendings.unpricedEffect')}
              />
            )}
            {mix.payingWithoutBillingStart > 0 && (
              <Pending
                count={mix.payingWithoutBillingStart}
                title={t('overview.pendings.noBillingStart')}
                effect={t('overview.pendings.noBillingStartEffect')}
              />
            )}
            {mix.approximateBillingStarts > 0 && (
              <Pending
                count={mix.approximateBillingStarts}
                title={t('overview.pendings.approximate')}
                effect={t('overview.pendings.approximateEffect')}
              />
            )}
            {summary.purchaseIsFloor && (
              <Pending title={t('overview.pendings.suppressed')} effect={t('summary.suppressed')} />
            )}
            {!purchasesAnswered && (
              <Pending title={t('overview.pendings.purchases')} effect={t('purchasesUnavailable')} />
            )}
            {truncated && (
              <Pending title={t('overview.pendings.truncated')} effect={t('truncated')} />
            )}
          </div>
        )}
      </Card>
    </div>
  )
}

// ── As peças ──────────────────────────────────────────────────────────────────────────────────

/**
 * O QUADRO DO MÊS — de que lado cada parcela está, dito pela ESTRUTURA e não pela cor.
 *
 * ELE NASCEU COM SEIS BOLINHAS COLORIDAS E ESTAVA ERRADO. O operador perguntou: "o app é receita
 * do app ou custo do app?" — e a pergunta era justa, porque `App` vinha pintado de `#CC5200`, um
 * laranja queimado, ao lado de um custo em `#D97706`. A cor dizia custo; o dado era receita.
 *
 * E A MEDIÇÃO ERA PIOR QUE A CONFUSÃO. Rodado o validador de paleta do guia de dataviz sobre as
 * seis, em 2026-09-03:
 *
 *   FAIL  visão normal    `#9CA3AF` (custo mensal) ↔ `#7FB8CF` (amarrada)  ΔE 6,5 — o piso é 15
 *   FAIL  CVD             ΔE 4,7 em deuteranopia
 *   RELIEF contraste      três das seis abaixo de 3:1 sobre o fundo
 *
 * Duas parcelas de LADOS OPOSTOS da conta que o olho não separa, nem com visão de cores completa.
 *
 * A CAUSA É ANTERIOR À COR: o gráfico passou a ter TRÊS marcas — a linha que fatura, o teto
 * tracejado e o custo. Seis bolinhas apontavam para seis marcas que não existem mais; eram sobra
 * da era das barras empilhadas. Repintá-las seria escolher cores para nada.
 *
 * ENTÃO A FILIAÇÃO VIROU LAYOUT. Duas colunas com título — Receita e Custo — e a parcela pertence
 * ao lado em que ela está escrita. Sobram DUAS chaves, uma por coluna, e cada uma corresponde a
 * uma linha que existe no gráfico. Medidas: ΔE 30,6 em visão normal, 21,2 em protanopia,
 * contraste acima de 3:1 nas duas.
 *
 * A AMARRADA FICA FORA DO SUBTOTAL DA RECEITA, com o traço da linha tracejada. É a mesma regra
 * que o gráfico desenha: ela é o teto se todos assinarem, não o que a cobrança emite, e somá-la
 * ao subtotal prometeria o contrato que ainda não veio.
 *
 * `null` E ZERO CONTINUAM DIFERENTES: parcela em zero some da lista, em vez de imprimir R$ 0,00
 * seis vezes num mês que ainda não aconteceu.
 */
function MonthBreakdown({ row, currency }: { row: MonthlyPoint; currency: string }) {
  const t = useTranslations('Finance')
  const money = (cents: number) => formatMoney(cents, currency)

  const revenue = row.recurringRevenueCents + row.appRevenueCents
  const cost = row.variableCostCents + row.operatingCostCents + row.fixedMonthlyCents
  const result = revenue - cost

  const revenueLines = [
    { key: 'toInvoice', label: t('overview.series.toInvoice'), value: row.recurringRevenueCents },
    { key: 'app', label: t('overview.series.app'), value: row.appRevenueCents },
  ].filter((line) => line.value > 0)

  const costLines = [
    { key: 'clientCost', label: t('overview.series.clientCost'), value: row.variableCostCents },
    { key: 'operating', label: t('overview.month.operating'), value: row.operatingCostCents },
    { key: 'fixedCost', label: t('overview.series.fixedCost'), value: row.fixedMonthlyCents },
  ].filter((line) => line.value > 0)

  const empty = revenueLines.length === 0 && costLines.length === 0 && row.revenueBlockedCents === 0

  return (
    <div className="mt-3 min-h-[124px] rounded-2xl bg-gray-50 px-4 py-3 dark:bg-gray-950/40">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
          {row.month}
          {!row.realized && ` · ${t('overview.series.projected')}`}
        </span>
        <span
          className={`text-sm font-bold tabular-nums ${
            result < 0 ? 'text-red-700 dark:text-red-300' : 'text-emerald-800 dark:text-emerald-300'
          }`}
        >
          {t('overview.series.result')}: {money(result)}
        </span>
      </div>

      {empty ? (
        <p className="mt-2 text-[11px] text-gray-600 dark:text-gray-400">
          {t('overview.series.emptyMonth')}
        </p>
      ) : (
        <div className="mt-2 grid gap-x-8 gap-y-3 sm:grid-cols-2">
          <BreakdownGroup
            title={t('overview.series.revenueLine')}
            total={money(revenue)}
            swatch={
              <span
                className="h-0.5 w-4 flex-shrink-0 rounded-full bg-primary-800 dark:bg-tuggi-blue"
                aria-hidden="true"
              />
            }
            lines={revenueLines.map((line) => ({ ...line, value: money(line.value) }))}
            /* A AMARRADA ENTRA COMO NOTA, e não como linha do subtotal: no gráfico ela é o
               tracejado acima da receita, e aqui ela é a mesma coisa dita em palavras. */
            aside={
              row.revenueBlockedCents > 0 ? (
                <div className="mt-1.5 flex items-center justify-between gap-3 border-t border-dashed border-gray-300 pt-1.5 dark:border-gray-700">
                  <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-gray-600 dark:text-gray-400">
                    <span
                      className="h-0 w-4 flex-shrink-0 border-t border-dashed border-primary-800/70 dark:border-tuggi-blue/70"
                      aria-hidden="true"
                    />
                    <span className="truncate">{t('overview.series.blocked')}</span>
                  </span>
                  <span className="flex-shrink-0 text-[11px] tabular-nums text-gray-600 dark:text-gray-400">
                    {money(row.revenueBlockedCents)}
                  </span>
                </div>
              ) : null
            }
          />
          <BreakdownGroup
            title={t('overview.series.costLine')}
            total={money(cost)}
            swatch={
              <span className="h-0.5 w-4 flex-shrink-0 rounded-full bg-amber-600" aria-hidden="true" />
            }
            lines={costLines.map((line) => ({ ...line, value: money(line.value) }))}
          />
        </div>
      )}
    </div>
  )
}

/** Uma coluna do quadro: título com a chave da linha, o subtotal, e as parcelas embaixo. */
function BreakdownGroup({
  title,
  total,
  swatch,
  lines,
  aside,
}: {
  title: string
  total: string
  swatch: React.ReactNode
  lines: { key: string; label: string; value: string }[]
  aside?: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3 border-b border-gray-200 pb-1 dark:border-gray-800">
        <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-gray-600 dark:text-gray-300">
          {swatch}
          {title}
        </span>
        <span className="text-[11px] font-semibold tabular-nums text-gray-900 dark:text-white">
          {total}
        </span>
      </div>
      <div className="mt-1 space-y-0.5">
        {lines.map((line) => (
          <div key={line.key} className="flex items-center justify-between gap-3">
            {/* SEM BOLINHA. A parcela pertence ao lado em que está escrita, e uma cor a mais
                aqui seria uma cor para decodificar sem nada no gráfico do outro lado. */}
            <span className="min-w-0 truncate text-[11px] text-gray-700 dark:text-gray-300">
              {line.label}
            </span>
            <span className="flex-shrink-0 text-[11px] tabular-nums text-gray-900 dark:text-white">
              {line.value}
            </span>
          </div>
        ))}
      </div>
      {aside}
    </div>
  )
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <section
      className={`overflow-hidden rounded-3xl border border-gray-200 bg-white/80 shadow-2xl shadow-black/5 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-900/80 ${className}`}
    >
      {children}
    </section>
  )
}

function CardHead({
  title,
  hint,
  aside,
}: {
  title: string
  hint?: string
  aside?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-gray-200 p-4 px-5 dark:border-gray-800 lg:flex-row lg:items-center">
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h2>
        {hint && <p className="mt-1 text-[11px] text-gray-600 dark:text-gray-400">{hint}</p>}
      </div>
      {aside}
    </div>
  )
}

function Step({
  label,
  value,
  hint,
  tone = 'plain',
  emphasis = false,
  negative = false,
}: {
  label: string
  value: string
  hint?: string
  tone?: 'plain' | 'amber' | 'brand'
  emphasis?: boolean
  negative?: boolean
}) {
  const surface =
    tone === 'amber'
      ? 'bg-amber-50 dark:bg-amber-950/30'
      : tone === 'brand'
        ? 'bg-tuggi-blue/[0.06] ring-1 ring-tuggi-blue/25'
        : 'bg-gray-50 dark:bg-gray-800/50'
  const labelInk =
    tone === 'amber'
      ? 'text-amber-800 dark:text-amber-300'
      : tone === 'brand'
        ? 'text-primary-800 dark:text-tuggi-blue'
        : 'text-gray-500 dark:text-gray-400'
  const valueInk = negative
    ? 'text-red-700 dark:text-red-400'
    : tone === 'amber'
      ? 'text-amber-900 dark:text-amber-200'
      : 'text-gray-900 dark:text-white'

  return (
    <div className={`min-w-0 flex-1 rounded-2xl px-4 py-3.5 ${surface}`}>
      <div className={`text-[10px] font-bold uppercase tracking-widest ${labelInk}`}>{label}</div>
      <div
        className={`mt-1 tracking-tight ${emphasis ? 'text-2xl font-extrabold' : 'text-xl font-bold'} ${valueInk}`}
      >
        {value}
      </div>
      {hint && <p className="mt-1 text-[11px] leading-relaxed text-gray-600 dark:text-gray-400">{hint}</p>}
    </div>
  )
}

function Operator({ symbol }: { symbol: string }) {
  return (
    <div aria-hidden="true" className="flex items-center justify-center text-lg font-light text-gray-400">
      {symbol}
    </div>
  )
}

function Segment({ value, total, className }: { value: number; total: number; className: string }) {
  if (value <= 0 || total <= 0) return null
  return <div className={className} style={{ width: `${(value / total) * 100}%` }} />
}

function Legend({ swatch, value, label }: { swatch: string; value: number; label: string }) {
  return (
    <div>
      <dd className="flex items-center gap-1.5">
        <span className={`h-2 w-2 flex-shrink-0 rounded-sm ${swatch}`} aria-hidden="true" />
        <span className="text-lg font-bold text-gray-900 dark:text-white">{formatCount(value)}</span>
      </dd>
      <dt className="mt-0.5 text-[11px] text-gray-600 dark:text-gray-400">{label}</dt>
    </div>
  )
}

function LegendMark({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className={`h-3 w-3 flex-shrink-0 rounded-sm ${className}`} aria-hidden="true" />
      <span className="text-[11px] text-gray-700 dark:text-gray-300">{label}</span>
    </span>
  )
}

function Tile({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="min-w-0 flex-1 rounded-2xl bg-gray-50 px-4 py-3.5 dark:bg-gray-800/50">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
          {label}
        </span>
      </div>
      <div className="mt-1 text-2xl font-extrabold tracking-tight text-gray-900 dark:text-white">{value}</div>
      {hint && <p className="mt-1 text-[11px] text-gray-600 dark:text-gray-400">{hint}</p>}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt>{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  )
}

function Pending({ count, title, effect }: { count?: number; title: string; effect: string }) {
  return (
    <div className="bg-white px-5 py-3.5 dark:bg-gray-900">
      <div className="flex items-baseline gap-2">
        {count !== undefined && (
          <span className="text-lg font-bold text-amber-900 dark:text-amber-200">{formatCount(count)}</span>
        )}
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{title}</span>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-gray-600 dark:text-gray-400">{effect}</p>
    </div>
  )
}

/**
 * `YYYY-MM` legível.
 *
 * `Date.UTC` com dia 1 e não `new Date('2026-08')`: a string sem dia é interpretada como UTC em
 * alguns motores e como local em outros, e num fuso negativo isso imprime julho.
 */
function monthLabel(month: string): string {
  const year = Number(month.slice(0, 4))
  const index = Number(month.slice(5, 7))
  if (!Number.isFinite(year) || !Number.isFinite(index)) return month
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, index - 1, 1)))
}
