/**
 * GET /api/finance/clients — o quadro de rentabilidade: um parceiro por linha.
 *
 * SÓ LEITURA, E É O DESENHO. Custo entra por `finance.material_consumption`, e quem escreve ali
 * é a esteira (`setMaterialOrderStatus`), num ato só. Uma escrita de custo aqui seria um segundo
 * caminho para a mesma linha — e o `unique (order_id, product_id)` só protege contra duplicata,
 * não contra dois números diferentes de origens diferentes.
 *
 * OS DOIS PORTÕES, E POR QUE SÃO DOIS. `withAuth` prova quem é e `requireModule` prova que o módulo
 * está ligado para esta pessoa. O role aceito é `['admin','editor']` de propósito: com só
 * `admin`, o segundo portão nunca decidiria nada, porque admin ignora `enabled_modules` por
 * código — e a ativação viraria uma chave que não liga nada. Hoje nenhum editor tem `finance`
 * marcado, então o efeito é "só admin", que é o pedido; ampliar é uma checkbox em `/admin/users`.
 *
 * O QUE NÃO GARANTE ISSO: `npm run check:routes`. Ele REPORTA rotas sem `withAuth`, mas não
 * trava build nenhum — não está em `check-all`, nem em `pre-build`, nem no workflow de deploy, e
 * 118 dos 171 arquivos de rota do repositório ainda exportam função simples. Quem trava os dois
 * portões DESTE módulo é `tests/api/finance-surface.test.ts`, que conta um `withAuth` e um
 * `requireModule` por método exportado. Uma frase anterior aqui dizia que o script falhava o
 * build; não falhava, e a correção está registrada em `docs/dev/financeiro-proxima-rodada.md`.
 *
 * 503 E NÃO UM QUADRO PELA METADE. `loadFinanceOverview` devolve `null` quando o lado do usuário
 * do app não responde, e é ele quem separa `não paga e não trouxe ninguém` de `não paga mas
 * trouxe quem comprou`. Um quadro renderizado sem essa leitura acusaria de prejuízo todo parceiro
 * não pagante por causa de uma falha de rede.
 */

import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { MODULES } from '@/lib/modules'
import { requireModule } from '@/lib/modules/requireModule'
import { loadFinanceOverview } from '@/lib/services/finance-service'
import { summarizeCohorts } from '@/lib/finance/cohort'
import { summarizeFinance } from '@/lib/finance/summary'
import { loadFixedCosts, loadFxRates } from '@/lib/services/finance-service'
import { summarizeStructure } from '@/lib/finance/structure'
import { monthlySeries, summarizeMonth, summarizePlanMix } from '@/lib/finance/overview'
import { billingSchedule } from '@/lib/finance/billing'
import { appRevenueByMonth } from '@/lib/finance/app-revenue'
import { loadRcEvents } from '@/lib/services/finance-service'

/**
 * O teto, e a tela é AVISADA quando ele foi atingido. 12 parceiros existem hoje, então 500 está
 * longe — mas um total impresso sobre um conjunto cortado é um piso vestido de fato.
 */
const CAP = 500

/**
 * A CASCATA É DO MÊS CORRENTE, e a escolha mudou em 2026-09-02.
 *
 * Ela era do último mês FECHADO, pelo argumento de que um painel aberto no dia 2 mostraria
 * receita quase inteira contra dois dias de custo. O argumento não vale para este contrato: a
 * mensalidade vence no dia 20 e corresponde ao mês em que vence, então no dia 1º já se sabe o
 * mês inteiro — ou a fatura sai, ou não sai. Receita não é parcial aqui.
 *
 * O QUE É PARCIAL É O CUSTO, e é uma distorção menor do que a que o mês fechado produzia: em
 * 2026-09-02 agosto era uma linha de quatro zeros — nenhuma fatura tinha vencido ainda — ocupando
 * o lugar mais nobre da tela. Um zero que só descreve o calendário não descreve a operação.
 */

/**
 * A JANELA DA PROJEÇÃO COMEÇA NO MÊS VIGENTE, e ele é exato.
 *
 * O pedido do operador em 2026-09-02 foi *"prever a receita do mês vigente com precisão dos
 * próximos 6 meses"*, e o dia 20 é o que torna isso possível: quem fecha hoje só tem primeiro
 * vencimento no mês que vem, então nada que a premissa suponha pode mexer no mês corrente.
 */
const PROJECTION_MONTHS = 7

/**
 * O horizonte de faturas — DOZE, e é premissa do operador, não leitura do contrato.
 *
 * O instrumento em vigor diz `Este contrato vigora por prazo indeterminado`, com rescisão a
 * qualquer tempo mediante aviso de 30 dias e sem prazo mínimo (`lib/contract/template.ts`,
 * cláusula `term`). Não existe término em doze meses; o que existe no aniversário é o reajuste.
 *
 * Cortar a projeção em doze faturas foi decisão do operador em 2026-09-02, para que a curva não
 * prometa receita indefinida. Ela vive AQUI e não em `assessClient`: a receita já realizada não
 * tem horizonte — quem tem quatorze faturas vencidas faturou quatorze, e cortá-la em doze
 * esconderia dinheiro que de fato entrou.
 */
const HORIZON_INVOICES = 12

/**
 * DOIS meses para trás, o vigente, e seis para a frente.
 *
 * Não seis para trás: não há receita nenhuma antes do primeiro vencimento, e uma parede de
 * colunas vazias diria que a operação encolheu quando ela apenas não tinha começado. Dois bastam
 * para o custo de aquisição — que já foi gasto — aparecer ao lado da receita que ele produziu.
 */
const SERIES_BEFORE = 2
const SERIES_MONTHS = SERIES_BEFORE + PROJECTION_MONTHS

/** `YYYY-MM` deslocado em N meses, sem passar por `Date`. */
function shiftMonth(month: string, count: number): string {
  const year = Number(month.slice(0, 4))
  const index = Number(month.slice(5, 7)) - 1 + count
  return `${year + Math.floor(index / 12)}-${String((((index % 12) + 12) % 12) + 1).padStart(2, '0')}`
}

export const GET = withRateLimit(60, 60_000)(
  withAuth({ roles: ['admin', 'editor'] }, async () => {
    const gate = await requireModule(MODULES.FINANCE, await cookies())
    if (!gate.ok) return gate.response

    const today = new Date().toISOString().slice(0, 10)
    const result = await loadFinanceOverview(CAP, today)
    // O motivo sobe junto: `finance_unavailable` e `app_users_unavailable` mandam o operador para
    // dois lugares diferentes — o schema exposto no painel, ou a leitura de perfis.
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 503 })

    const overview = result.overview
    const fixedCosts = await loadFixedCosts()
    // A TAXA DECLARADA CHEGA UMA VEZ E ATRAVESSA TUDO. Se cada leitura buscasse a sua, duas
    // superfícies da mesma tela poderiam converter o mesmo custo por números diferentes — a
    // mesma razão de `summarizeFinance` calcular sobre a lista que a tabela desenha.
    const fxRates = await loadFxRates()
    // O ano corrente é a janela dos desembolsos de uma vez só. Os recorrentes não dependem dela:
    // eles entram por serem recorrentes, desde que já tenham começado.
    const window = { from: `${today.slice(0, 4)}-01-01`, to: today }

    // UMA LEITURA, VÁRIAS SUPERFÍCIES. A cascata do mês, a quebra por plano e a base da projeção
    // saem da MESMA lista que a tabela desenha — não existe uma segunda consulta com quem elas
    // possam discordar. É a decisão que `summarizeFinance` já tinha tomado, estendida.
    // A RECEITA DO APP ENTRA NA SÉRIE, EM CAMADA PRÓPRIA. Ela não passa pelo `withAuth` de
    // `admin` como o agregado de contas: o evento do RevenueCat não é dado sobre pessoa, é o
    // registro de uma venda — e sem ele metade do negócio some do gráfico.
    const rcEvents = await loadRcEvents()

    const mix = summarizePlanMix(overview.partnerMix)
    const currentMonth = today.slice(0, 7)
    const seriesFrom = shiftMonth(currentMonth, -SERIES_BEFORE)

    // A RECEITA DO MÊS É O QUE VENCE NELE, e não o MRR achatado. Um parceiro publicado em agosto
    // não tem fatura em agosto — a primeira dele vence dia 20 de setembro. Repetir o MRR aqui
    // contaria uma cobrança que o calendário do contrato não emitiu.
    //
    // SEM HORIZONTE: a premissa de doze faturas é da PROJEÇÃO. Fatura do mês não se corta.
    const monthInvoices = committedByMonth(overview.partnerMix, mix.currency, currentMonth, 1, null)

    const app = appRevenueByMonth(rcEvents, {
      from: seriesFrom,
      months: SERIES_MONTHS,
      currency: mix.currency,
      on: today,
      rates: fxRates,
    })

    const month = summarizeMonth({
      month: currentMonth,
      currency: mix.currency,
      recurringRevenueCents: monthInvoices[currentMonth] ?? 0,
      consumption: overview.consumption,
      costEntries: overview.costEntries,
      fixedCosts,
      rates: fxRates,
    })

    return NextResponse.json({
      clients: overview.clients,
      // As linhas de consumo, reduzidas ao que o KPI de estoque precisa. Elas sobem com o resto
      // para que `comprado − consumido` seja calculado sobre a MESMA lista que alimentou os
      // totais por parceiro — um segundo `count()` no servidor seria um segundo número.
      consumption: overview.consumption.map((row) => ({
        productId: row.productId,
        quantity: row.quantity,
        components: row.components ?? [],
      })),
      summary: summarizeFinance(overview.clients, 'BRL', { rates: fxRates, on: today }),
      cohorts: summarizeCohorts(overview.clients),
      structure: summarizeStructure(fixedCosts, overview.clients, window, 'BRL', fxRates),
      // A taxa sobe para a tela poder dizer que o total foi convertido, e por quanto.
      fxRates,
      fixedCosts,
      month,
      mix,
      // A projeção é PURA e roda no navegador, porque as duas premissas são do operador e mudam a
      // cada clique. O servidor manda a base — o que não depende de palpite — e `projectRevenue`
      // desenha a curva com o palpite atual sem uma volta ao servidor por tecla digitada.
      projectionBase: {
        from: currentMonth,
        months: PROJECTION_MONTHS,
        currency: mix.currency,
        // O CALENDÁRIO, E NÃO UM MRR REPETIDO. Cada parceiro entra no mês seguinte ao da sua
        // publicação e a primeira fatura dele carrega o proporcional — somar tudo aqui é o que
        // faz a linha firme subir em degraus, como as faturas de fato sobem.
        committedByMonth: committedByMonth(
          overview.partnerMix,
          mix.currency,
          currentMonth,
          PROJECTION_MONTHS,
          HORIZON_INVOICES
        ),
        averageFeeCents: mix.averageFeeCents,
        fixedMonthlyCents: month.fixedMonthlyCents,
        // Quanto custou, em média, o material de um parceiro que já recebeu material. Divisor é
        // quem RECEBEU, não a base inteira: incluir os 49 que nunca receberam nada faria o kit
        // parecer dez vezes mais barato do que ele é.
        kitCostCents: kitCostCents(overview.clients),
      },
      // A SÉRIE MÊS A MÊS — receita ao lado do custo, do passado ao previsto.
      //
      // O HORIZONTE SÓ VALE PARA O FUTURO, e por isso são duas leituras do mesmo calendário: o
      // que já venceu é fato e não se corta em doze faturas; o que ainda vai vencer carrega a
      // premissa do operador. Uma leitura só aplicaria a premissa sobre o passado.
      series: monthlySeries({
        from: seriesFrom,
        months: SERIES_MONTHS,
        currency: mix.currency,
        currentMonth,
        revenueByMonth: {
          ...committedByMonth(overview.partnerMix, mix.currency, seriesFrom, SERIES_BEFORE, null),
          ...committedByMonth(
            overview.partnerMix,
            mix.currency,
            currentMonth,
            PROJECTION_MONTHS,
            HORIZON_INVOICES
          ),
        },
        // A MESMA CONTA sobre quem só falta assinar. Camada à parte, nunca somada à de cima: o
        // parceiro está no ar desde a liberação e a mensalidade corre, mas sem o instrumento
        // aceito a fatura não sai.
        blockedByMonth: {
          ...committedByMonth(overview.partnerMix, mix.currency, seriesFrom, SERIES_BEFORE, null, 'pending'),
          ...committedByMonth(
            overview.partnerMix,
            mix.currency,
            currentMonth,
            PROJECTION_MONTHS,
            HORIZON_INVOICES,
            'pending'
          ),
        },
        appByMonth: app.byMonth,
        rates: fxRates,
        consumption: overview.consumption,
        costEntries: overview.costEntries,
        fixedCosts,
      }),
      // O que o app faturou fora da moeda do gráfico. Nomeado, nunca convertido.
      appOtherCurrencies: app.otherCurrencies,
      excludedPartners: overview.excludedPartners,
      truncated: overview.truncated,
      purchasesAnswered: overview.purchasesAnswered,
    })
  })
)

/**
 * O custo médio de material de um parceiro NOVO.
 *
 * A média é sobre quem de fato recebeu material, e não sobre a base inteira. Em 2026-09-01, 49
 * dos 52 parceiros tinham custo zero — dividir por 52 diria que trazer um parceiro custa uns
 * poucos reais, e a projeção cruzaria o equilíbrio cedo demais por causa de um denominador.
 *
 * Zero quando ninguém recebeu nada ainda: sem histórico não se arbitra um kit.
 */
function kitCostCents(clients: readonly { directCostCents: number }[]): number {
  const costed = clients.filter((client) => client.directCostCents > 0)
  if (costed.length === 0) return 0
  const total = costed.reduce((sum, client) => sum + client.directCostCents, 0)
  return Math.round(total / costed.length)
}

/**
 * A soma das faturas que vencem em cada mês da janela.
 *
 * SÓ CONTRATO ASSINADO, e é a MESMA condição de `committedMrrCents`. Sem isso o cartão da base
 * diria `R$ 100,00 de MRR firme` enquanto o gráfico ao lado desenhava `R$ 700,00` de linha
 * sólida, sobre os mesmos parceiros — dois números da mesma tela discordando porque um exigia
 * `signed` e o outro se contentava com `sent`. Medido em 2026-09-02: dos 7 pagantes, 1 assinou e
 * 6 estão com o contrato enviado. Enviar não é aceitar, e a linha sólida é a que promete.
 *
 * O que os 6 têm de mensalidade viaja em `mix.uncommittedMrrCents`, ao lado e nomeado.
 *
 * Pagante sem publicação nem assinatura não tem primeiro vencimento — ele sobe contado em
 * `mix.payingWithoutBillingStart`, para a tela dizer que existe mensalidade esperando um marco.
 *
 * Moeda diferente fica de fora pelo mesmo motivo de sempre: nada aqui inventa taxa de câmbio.
 */
function committedByMonth(
  rows: readonly import('@/lib/finance/overview').PartnerMixRow[],
  currency: string,
  from: string,
  months: number,
  horizonInvoices: number | null,
  /** `signed` é o que promete; `pending` é o que só falta o instrumento. */
  stage: 'signed' | 'pending' = 'signed'
): Record<string, number> {
  const byMonth: Record<string, number> = {}

  for (const row of rows) {
    if (row.planKind !== 'paid' || row.contractStatus === 'terminated') continue
    const signed = row.contractStatus === 'signed'
    if (stage === 'signed' ? !signed : signed) continue
    if (row.currency !== currency) continue

    const invoices = billingSchedule({
      start: row.billingStartsAt,
      feeCents: row.monthlyFeeCents,
      horizonInvoices,
      from,
      months,
    })

    for (const invoice of invoices) {
      byMonth[invoice.month] = (byMonth[invoice.month] ?? 0) + invoice.cents
    }
  }

  return byMonth
}
