'use client'

/**
 * UM PARCEIRO POR LINHA — o que custou, o que paga, e se a conta fecha.
 *
 * A COORTE ESTÁ NA TABELA E NO FILTRO PORQUE SEM ELA A LEITURA MENTE. Sem agrupar por mês de
 * entrada, a tela compara um parceiro de um mês com um de um ano na mesma coluna, e o de um mês
 * SEMPRE parece péssimo: ele pagou uma mensalidade e levou o mesmo display que o outro.
 * `Ainda não se pagou` é o estado normal de quem acabou de entrar.
 *
 * `QR` E `EQUIPE` SÃO DUAS COLUNAS E NÃO UMA SOMA. `drive.profiles.partner_id` é quem chegou
 * pelo link do parceiro — aquisição, e o denominador do CAC. `client_id` é quem É do
 * estabelecimento: dono, gerente, garçom. Somá-los inflaria a aquisição com os próprios
 * funcionários do parceiro e derrubaria o CAC exatamente de quem não adquiriu ninguém.
 *
 * CATORZE COLUNAS EM QUATRO GRUPOS. Nenhuma coluna foi cortada — cada uma responde uma pergunta
 * que foi feita — mas com peso igual elas competiam entre si, e o operador lia `R$ 0,00` na sexta
 * sem saber se era receita ou margem. `Custo`, `Retorno`, `Aquisição` e `Pendência` são os quatro
 * assuntos que o próprio módulo já separa: custo direto ao lado da taxa e nunca dentro dela,
 * aquisição longe da equipe, e a pendência que explica o veredito `Custo incompleto`.
 *
 * O ZERO RECUA, E ISSO NÃO É ESCONDER. De 52 parceiros, 49 são `R$ 0,00` — com todos na mesma
 * tinta, os três que custaram dinheiro desapareciam no meio dos zeros. `text-gray-500` no zero
 * contra `text-gray-800` no valor é o que faz `R$ 222,05` saltar de uma coluna, e a escolha da
 * tinta tem medição junto de `DIM`, mais abaixo. O número continua escrito.
 *
 * MAS O TRAVESSÃO NÃO RECUA JUNTO, e essa é a linha fina que quase se perdeu: a primeira versão
 * pintava `—` do mesmo cinza do zero, e com isso ausência e zero passavam a ter a MESMA cara —
 * exatamente a fusão que `formatMoney(null)` e este módulo inteiro existem para impedir. Recuar
 * é dizer "isto é zero, siga em frente"; `—` diz "não sei", e não sei nunca é uma notícia calma.
 *
 * O RODAPÉ CHAMA `summarizeFinance` SOBRE AS LINHAS FILTRADAS, e não soma à mão. Somar aqui
 * significaria uma segunda regra de moeda, de piso e de `null` — e é assim que um total passa a
 * discordar das linhas. A função já resolve as três: escolhe a moeda majoritária, deixa as outras
 * FORA da soma (e as nomeia), e mantém `null` quando ninguém respondeu. Os números do trilho
 * continuam sendo a lista inteira: quem filtra vê o recorte somado aqui embaixo, e o total
 * estável lá do lado.
 *
 * A TABELA ROLA DENTRO DO CARTÃO, NOS DOIS EIXOS, então a página nunca rola de lado. A coluna de
 * conteúdo que nos contém precisa de `min-w-0` (está em `FinancePageContent`): item de flex não
 * encolhe abaixo do próprio conteúdo, e sem aquilo quem cede é a página.
 */

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  CELL,
  DIM,
  DenseTableScroller,
  EDGE,
  FilterChip,
  GROUP,
  HEAD,
  HEAD_NUM,
  NUM,
  SortHead,
} from '@/components/ui/dense-table'
import { formatDurationOrDash } from '@/lib/format/duration'
import { formatCount, formatMoney } from '@/lib/finance/money'
import { cohortMonth } from '@/lib/finance/cohort'
import { summarizeFinance } from '@/lib/finance/summary'
import type { ClientProfitability, FinanceVerdict } from '@/lib/finance/profitability'
import { VerdictBadge } from './VerdictBadge'

const VERDICTS: readonly FinanceVerdict[] = [
  'uncosted',
  'undated',
  'no_return',
  'non_monetary_return',
  'payback_pending',
  'profitable',
]

/**
 * As classes das duas faixas grudadas, do recuo e da régua de grupo vêm de
 * `components/ui/dense-table.tsx` desde `DS-COMPONENTE-081` (#741): `top-7` do `HEAD` só está
 * certo porque `GROUP` tem `h-7`, e dois números que só valem juntos têm um dono só.
 */

type SortKey =
  | 'clientName'
  | 'approvedAt'
  | 'directCostCents'
  | 'standardCostCents'
  | 'revenueCents'
  | 'marginCents'
  | 'paybackMonths'
  | 'cacCents'
  | 'linkedByPartnerId'
  | 'linkedByClientId'
  | 'usersWithPurchase'
  | 'purchasedMinutes'
  | 'ordersAwaitingShipment'

/**
 * AUSÊNCIA VAI PARA O FIM NAS DUAS DIREÇÕES, e é deliberado. `null` é "não sei", não "menos que
 * tudo": deixá-lo ordenar como zero encheria o topo de `Payback: —` quando o operador pediu os
 * paybacks mais curtos, que é a resposta errada para a pergunta que ele fez.
 */
function compare(a: ClientProfitability, b: ClientProfitability, key: SortKey, dir: 1 | -1) {
  if (key === 'clientName') return a.clientName.localeCompare(b.clientName) * dir
  if (key === 'approvedAt') {
    const left = cohortMonth(a.approvedAt)
    const right = cohortMonth(b.approvedAt)
    if (left === null && right === null) return 0
    if (left === null) return 1
    if (right === null) return -1
    return left.localeCompare(right) * dir
  }
  const left = a[key]
  const right = b[key]
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return (left - right) * dir
}

export function ClientProfitabilityTable({ clients }: { clients: ClientProfitability[] }) {
  const t = useTranslations('Finance')
  const [verdict, setVerdict] = useState<FinanceVerdict | 'all'>('all')
  const [cohort, setCohort] = useState<string>('all')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null)

  /**
   * As contagens dos chips saem da MESMA função que os números do trilho, sobre a lista inteira.
   * Um `filter().length` por chip é a segunda contagem que acaba discordando da primeira.
   */
  const all = useMemo(() => summarizeFinance(clients), [clients])

  const cohorts = useMemo(() => {
    const months = new Set<string>()
    let undated = false
    for (const client of clients) {
      const month = cohortMonth(client.approvedAt)
      if (month) months.add(month)
      else undated = true
    }
    const sorted = Array.from(months).sort((a, b) => b.localeCompare(a))
    return undated ? [...sorted, 'undated'] : sorted
  }, [clients])

  const rows = useMemo(() => {
    const kept = clients.filter((client) => {
      if (verdict !== 'all' && client.verdict !== verdict) return false
      if (cohort === 'all') return true
      const month = cohortMonth(client.approvedAt)
      return cohort === 'undated' ? month === null : month === cohort
    })
    if (!sort) return kept
    return [...kept].sort((a, b) => compare(a, b, sort.key, sort.dir))
  }, [clients, verdict, cohort, sort])

  /** O recorte, pelas mesmas regras de moeda, piso e ausência que o trilho usa. */
  const totals = useMemo(() => summarizeFinance(rows), [rows])

  function toggle(key: SortKey) {
    setSort((current) =>
      current?.key === key ? { key, dir: current.dir === 1 ? -1 : 1 } : { key, dir: -1 }
    )
  }

  /** Fecha `sort`/`toggle`/`t` sobre o `SortHead` compartilhado (`DS-COMPONENTE-081`). */
  const head = (column: SortKey, label: string, className: string) => (
    <SortHead
      column={column}
      label={label}
      className={className}
      sort={sort}
      onToggle={toggle}
      title={t('table.sortBy', { column: label })}
    />
  )

  /**
   * Zero recua, ausência não. `—` já vem de `formatMoney`/`formatCount` e não é zero.
   *
   * SÓ EMBRULHA QUANDO HÁ O QUE RECUAR. A primeira versão devolvia `<span>` sempre, inclusive
   * para `—`, e isso punha um elemento a mais dentro de cada `td` sem pintar nada — DOM extra
   * que fazia toda contagem por texto encontrar a célula duas vezes (o `td` e o `span`). Texto
   * puro quando não há classe é a mesma tela com metade dos nós.
   */
  function money(cents: number | null, currency: string) {
    const text = formatMoney(cents, currency)
    return cents === 0 ? <span className={DIM}>{text}</span> : text
  }

  function count(value: number | null) {
    const text = formatCount(value)
    return value === 0 ? <span className={DIM}>{text}</span> : text
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-gray-200 bg-white/70 shadow-2xl shadow-black/5 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-900/70">
      <header className="flex flex-col gap-3 border-b border-gray-200 px-5 py-4 dark:border-gray-800">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            {t('table.title')}
          </h2>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            {t('table.showing', { shown: rows.length, total: clients.length })}
          </p>
        </div>

        {/* OS CHIPS TRAZEM A CONTAGEM JUNTO, e é o que os torna melhores que o select que
            substituíram: o operador vê quantos são ANTES de clicar, em vez de filtrar para
            descobrir que são zero e voltar. */}
        <div className="flex flex-wrap items-center gap-2">
          <FilterChip active={verdict === 'all'} onClick={() => setVerdict('all')} count={clients.length}>
            {t('table.filterAll')}
          </FilterChip>
          {VERDICTS.filter((option) => all.byVerdict[option] > 0).map((option) => (
            <FilterChip
              key={option}
              active={verdict === option}
              onClick={() => setVerdict(option)}
              count={all.byVerdict[option]}
            >
              {t(`verdict.${option}`)}
            </FilterChip>
          ))}

          <div className="ml-auto flex items-center gap-2">
            <label className="flex items-center gap-2 text-[11px] font-medium text-gray-600 dark:text-gray-400">
              {t('table.filterCohort')}
              <select
                value={cohort}
                onChange={(event) => setCohort(event.target.value)}
                className="min-h-[28px] rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="all">{t('table.filterAll')}</option>
                {cohorts.map((option) => (
                  <option key={option} value={option}>
                    {option === 'undated' ? t('table.undatedCohort') : option}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </header>

      {/* A BORDA DIREITA PRECISA DIZER QUE HÁ MAIS. Em 1180px de janela sobram ~870px para a
          tabela, e catorze colunas não cabem em 870px — seis sumiam do lado direito, incluindo os
          grupos `Aquisição` e `Pendência` INTEIROS, e a tabela simplesmente terminava no meio de
          uma coluna como se aquilo fosse o fim. O degradê é a única pista de que ainda há tabela
          ali, e desde `DS-COMPONENTE-081` ele é do `DenseTableScroller`. */}
      <DenseTableScroller>
        <table className="w-full min-w-[1120px] border-collapse">
          <thead>
            <tr>
              <th className={`${GROUP} text-gray-500 dark:text-gray-400`} colSpan={3} />
              <th className={`${GROUP} ${EDGE} text-amber-700 dark:text-amber-400`} colSpan={2} scope="colgroup">
                {t('table.groupCost')}
              </th>
              <th className={`${GROUP} ${EDGE} text-emerald-700 dark:text-emerald-400`} colSpan={3} scope="colgroup">
                {t('table.groupReturn')}
              </th>
              <th className={`${GROUP} ${EDGE} text-primary-800 dark:text-tuggi-blue`} colSpan={5} scope="colgroup">
                {t('table.groupAcquisition')}
              </th>
              <th className={`${GROUP} ${EDGE} text-gray-500 dark:text-gray-400`} colSpan={1} scope="colgroup">
                {t('table.groupPending')}
              </th>
            </tr>
            <tr>
              {head('clientName', t('table.client'), HEAD)}
              <th scope="col" className={HEAD}>{t('table.verdict')}</th>
              {head('approvedAt', t('table.cohort'), HEAD)}
              {head('directCostCents', t('table.directCost'), `${HEAD_NUM} ${EDGE}`)}
              {head('standardCostCents', t('table.standard'), HEAD_NUM)}
              {head('revenueCents', t('table.revenue'), `${HEAD_NUM} ${EDGE}`)}
              {head('marginCents', t('table.margin'), HEAD_NUM)}
              {head('paybackMonths', t('table.payback'), HEAD_NUM)}
              {head('cacCents', t('table.cac'), `${HEAD_NUM} ${EDGE}`)}
              {head('linkedByPartnerId', t('table.acquired'), HEAD_NUM)}
              {head('linkedByClientId', t('table.team'), HEAD_NUM)}
              {head('usersWithPurchase', t('table.purchasers'), HEAD_NUM)}
              {head('purchasedMinutes', t('table.minutes'), HEAD_NUM)}
              {head('ordersAwaitingShipment', t('table.awaitingShipment'), `${HEAD_NUM} ${EDGE}`)}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={14} className="px-5 py-8 text-center text-sm text-gray-600 dark:text-gray-400">
                  {t('table.empty')}
                </td>
              </tr>
            )}

            {rows.map((client) => (
              <tr
                key={client.clientId}
                className="border-t border-gray-100 hover:bg-gray-50/70 dark:border-gray-800 dark:hover:bg-gray-800/40"
              >
                <th scope="row" className={`${CELL} min-w-[12rem] text-left align-top font-medium text-gray-900 dark:text-white`}>
                  {client.clientName}
                  {/* Moeda ignorada é dito, nunca escondido: o total desta linha não a inclui. */}
                  {client.ignoredCurrencies.length > 0 && (
                    <span className="mt-0.5 block text-[11px] font-normal text-amber-700 dark:text-amber-300">
                      {client.ignoredCurrencies.join(', ')}
                    </span>
                  )}
                </th>
                <td className={`${CELL} align-top`}>
                  <VerdictBadge verdict={client.verdict} />
                </td>
                {/* A coorte fica à ESQUERDA, ao contrário das colunas de dinheiro: é rótulo
                    (`2026-08`), não grandeza — não há vírgula para alinhar embaixo de vírgula. */}
                <td className={`${CELL} whitespace-nowrap align-top tabular-nums`}>
                  {cohortMonth(client.approvedAt) ?? t('table.undatedCohort')}
                  <span className="mt-0.5 block text-[11px] text-gray-600 dark:text-gray-400">
                    {t('table.months', { count: client.monthsBilled })}
                  </span>
                </td>
                <td className={`${NUM} ${EDGE}`}>{money(client.directCostCents, client.currency)}</td>
                <td className={NUM}>{money(client.standardCostCents, client.currency)}</td>
                <td className={`${NUM} ${EDGE}`}>{money(client.revenueCents, client.currency)}</td>
                <td className={`${NUM} font-semibold`}>
                  {money(client.marginCents, client.currency)}
                </td>
                {/* O TRAVESSÃO NÃO RECUA. Só o ZERO recua — `—` é ausência, e ausência e zero
                    são fatos diferentes em todo este módulo. Pintar os dois do mesmo cinza
                    desfaria exatamente a distinção que `formatMoney(null)` existe para manter. */}
                <td className={NUM}>
                  {client.paybackMonths === null
                    ? '—'
                    : t('table.paybackMonths', { count: client.paybackMonths })}
                </td>
                <td className={`${NUM} ${EDGE}`}>{money(client.cacCents, client.currency)}</td>
                <td className={NUM}>{count(client.linkedByPartnerId)}</td>
                <td className={NUM}>{count(client.linkedByClientId)}</td>
                {/* `≥` E NÃO O NÚMERO: com menos de `PURCHASE_MIN_COHORT` adquiridos, a coluna
                    de compras identificaria uma pessoa ao lado do nome do bar onde ela esteve, e
                    o servidor colapsou o valor. O que chega aqui é um piso, e escrevê-lo como
                    `1` seco seria afirmar que é exatamente um. Os minutos somem inteiros — são a
                    coluna que mais identifica e a única que não decide veredito nenhum. */}
                <td className={NUM} title={client.purchaseSuppressed ? t('table.suppressed') : undefined}>
                  {client.purchaseSuppressed
                    ? `≥ ${formatCount(client.usersWithPurchase)}`
                    : count(client.usersWithPurchase)}
                </td>
                <td className={NUM} title={client.purchaseSuppressed ? t('table.suppressed') : undefined}>
                  {formatDurationOrDash(client.purchasedMinutes)}
                </td>
                {/* A pendência fica na linha do parceiro porque é dela que o veredito
                    `Custo incompleto` vem — sem a coluna, o operador leria o veredito sem saber
                    qual das duas causas atacar. */}
                <td
                  className={`${NUM} ${EDGE} ${
                    client.ordersAwaitingShipment > 0
                      ? 'font-semibold text-amber-700 dark:text-amber-300'
                      : 'text-gray-600 dark:text-gray-400'
                  }`}
                >
                  {client.ordersAwaitingShipment > 0 ? formatCount(client.ordersAwaitingShipment) : '—'}
                </td>
              </tr>
            ))}
          </tbody>

          {rows.length > 0 && (
            <tfoot className="sticky bottom-0 z-10">
              <tr className="border-t-2 border-gray-200 bg-gray-50/95 backdrop-blur dark:border-gray-700 dark:bg-gray-950/95">
                <th scope="row" className={`${CELL} text-left font-bold text-gray-900 dark:text-white`}>
                  {t('table.totals', { count: rows.length })}
                  {totals.ignoredCurrencies.length > 0 && (
                    <span className="mt-0.5 block text-[11px] font-normal text-amber-700 dark:text-amber-300">
                      {t('table.totalsIgnored', { currencies: totals.ignoredCurrencies.join(', ') })}
                    </span>
                  )}
                </th>
                <td className={CELL} />
                <td className={CELL} />
                <td className={`${NUM} ${EDGE} font-bold`}>
                  {formatMoney(totals.directCostCents, totals.currency)}
                </td>
                <td className={`${NUM} font-bold`}>
                  {formatMoney(totals.standardCostCents, totals.currency)}
                </td>
                <td className={`${NUM} ${EDGE} font-bold`}>
                  {formatMoney(totals.revenueCents, totals.currency)}
                </td>
                <td className={`${NUM} font-bold`}>
                  {formatMoney(totals.marginCents, totals.currency)}
                </td>
                <td className={NUM} />
                <td className={`${NUM} ${EDGE} font-bold`}>
                  {formatMoney(totals.cacCents, totals.currency)}
                </td>
                <td className={`${NUM} font-bold`}>{formatCount(totals.acquiredUsers)}</td>
                <td className={`${NUM} font-bold`}>{formatCount(totals.teamUsers)}</td>
                {/* Um parceiro suprimido basta para o total virar piso — e ele é escrito como
                    piso, nunca como a conta fechada. */}
                <td className={`${NUM} font-bold`}>
                  {totals.purchaseIsFloor
                    ? `≥ ${formatCount(totals.usersWithPurchase)}`
                    : formatCount(totals.usersWithPurchase)}
                </td>
                <td className={`${NUM} font-bold`}>{formatDurationOrDash(totals.purchasedMinutes)}</td>
                <td
                  className={`${NUM} ${EDGE} font-bold ${
                    totals.ordersAwaitingShipment > 0 ? 'text-amber-700 dark:text-amber-300' : ''
                  }`}
                >
                  {formatCount(totals.ordersAwaitingShipment)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </DenseTableScroller>
    </section>
  )
}
