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

import { useCallback, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
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
 * O `sticky` DESTE CABEÇALHO NÃO FUNCIONAVA, e a causa é uma regra do CSS que não se vê lendo a
 * classe. A tabela vivia dentro de `overflow-x-auto`, e declarar overflow num eixo faz o OUTRO
 * computar de `visible` para `auto`: o wrapper virava container de rolagem TAMBÉM na vertical,
 * e `top-0` passou a se medir contra algo que não rola. Dar altura ao container é o que faz o
 * cabeçalho grudar de verdade — por isso `top-0` e não `top-14`: o vizinho de cima agora é o
 * topo do cartão, não o `Header` de `h-14` do CMS.
 *
 * São DUAS faixas grudadas, e por isso a de grupos tem altura fixa (`h-7` = 28px) e a de baixo
 * gruda em `top-7`. Uma altura implícita aqui viraria uma sobreposição de 2px que ninguém
 * consegue explicar depois.
 */
const GROUP =
  'sticky top-0 z-20 h-7 bg-white/95 px-3 text-left text-[10px] font-bold uppercase tracking-widest backdrop-blur dark:bg-gray-900/95'
const HEAD =
  'sticky top-7 z-10 bg-white/95 px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-gray-500 backdrop-blur dark:bg-gray-900/95 dark:text-gray-400'
/** Dinheiro e contagem alinham à direita — é o que deixa a vírgula embaixo da vírgula. */
const HEAD_NUM = `${HEAD} text-right`
const CELL = 'px-3 py-2.5 text-sm text-gray-800 dark:text-gray-200 align-middle'
const NUM = `${CELL} text-right tabular-nums whitespace-nowrap`
/**
 * A TINTA DO ZERO — `text-gray-500`, e a primeira tentativa foi `text-gray-400`.
 *
 * #9CA3AF sobre o painel mede 2,51:1 e reprova SC 1.4.3; #6B7280 mede 4,83:1. É a MESMA
 * divergência (D-C) que `FinanceFigures` já carrega escrita no topo, e que um teste deste módulo
 * varre em todo rótulo de 10px — eu recuei o zero usando exatamente a cor que o módulo já tinha
 * medido e recusado. O `axe` pegou em dois nós na primeira passada com navegador.
 *
 * Recuar não é apagar: entre `text-gray-800` do valor e `text-gray-500` do zero ainda há degrau
 * suficiente para os três números que importam saltarem de uma coluna de 49 zeros. No escuro o
 * par inverte para `dark:text-gray-400`, que sobre gray-900 passa com folga.
 */
const DIM = 'text-gray-500 dark:text-gray-400'
/** Onde um grupo começa, e o único lugar onde a régua vertical aparece. */
const EDGE = 'border-l border-gray-200 dark:border-gray-800'

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

  /**
   * Existe tabela à direita do que se vê? O degradê da borda responde isso, e responder errado é
   * pior que não responder: prometer coluna onde não há treina o operador a ignorar a pista.
   *
   * `useCallback` como ref MEDE NA MONTAGEM. Sem isso o degradê só apareceria depois do primeiro
   * scroll — exatamente o gesto que ele existe para provocar. A folga de 2px é do arredondamento
   * de zoom do navegador, que faz `scrollLeft + clientWidth` parar meio pixel antes do fim.
   */
  const [more, setMore] = useState(false)
  const update = useCallback((el: HTMLDivElement) => {
    setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
  }, [])
  const measure = useCallback(
    (el: HTMLDivElement | null) => {
      if (el) update(el)
    },
    [update]
  )

  /** Fecha `sort`/`toggle`/`t` sobre o `SortHead` de módulo, que é onde ele precisa morar. */
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
          ali: `pointer-events-none` para não roubar o clique, e some quando a rolagem chega ao
          fim porque aí não há mais nada para prometer.

          NÃO DÁ PARA RESOLVER ENCOLHENDO. Catorze colunas em 870px dariam 62px por coluna, e
          `R$ 1.934,59` não cabe em 62px. Rolagem horizontal aqui é a decisão certa; o que estava
          errado era ela ser invisível. */}
      <div className="relative">
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0 right-0 z-30 w-12 bg-gradient-to-l from-white/95 to-transparent transition-opacity dark:from-gray-900/95 ${
            more ? 'opacity-100' : 'opacity-0'
          }`}
        />
        <div
          ref={measure}
          onScroll={(event) => update(event.currentTarget)}
          className="custom-scrollbar max-h-[calc(100vh-19rem)] overflow-auto"
        >
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
        </div>
      </div>
    </section>
  )
}

/**
 * UM CABEÇALHO QUE ORDENA. Mora NO MÓDULO e não dentro de `ClientProfitabilityTable`: um
 * componente declarado no corpo de outro é um tipo novo a cada render, e o React desmonta e
 * remonta a subárvore inteira em vez de atualizá-la — aqui isso significaria catorze botões
 * recriados a cada clique de ordenação, perdendo o foco do teclado no caminho.
 *
 * O ÍCONE DIZ O ESTADO E `aria-sort` DIZ O MESMO. Três estados, três desenhos: sem ordem, e as
 * duas direções. Cor sozinha não distinguiria as duas últimas.
 */
function SortHead({
  column,
  label,
  className,
  sort,
  onToggle,
  title,
}: {
  column: SortKey
  label: string
  className: string
  sort: { key: SortKey; dir: 1 | -1 } | null
  onToggle: (key: SortKey) => void
  title: string
}) {
  const active = sort !== null && sort.key === column
  const descending = active && sort.dir === -1
  const Icon = !active ? ChevronsUpDown : descending ? ArrowDown : ArrowUp

  return (
    <th
      scope="col"
      className={className}
      aria-sort={!active ? 'none' : descending ? 'descending' : 'ascending'}
    >
      {/* O ÍCONE INATIVO NÃO OCUPA LARGURA. Treze setas `ChevronsUpDown` sempre visíveis custavam
          ~20px de coluna cada — perto de 220px numa tabela que já não cabe em tela de notebook —
          e ainda enchiam o cabeçalho de ruído onde o operador procura o nome da coluna. Fora do
          hover e sem ordem ativa ele é `w-0 opacity-0`: some do fluxo em vez de só ficar
          transparente, que é a diferença entre recuperar a largura e não recuperar nada. */}
      <button
        type="button"
        onClick={() => onToggle(column)}
        title={title}
        className={`group inline-flex min-h-[24px] items-center gap-1 uppercase tracking-widest transition-colors hover:text-gray-900 dark:hover:text-white ${
          active ? 'text-gray-900 dark:text-white' : ''
        } ${className.includes('text-right') ? 'flex-row-reverse' : ''}`}
      >
        {label}
        <Icon
          className={`h-3 shrink-0 transition-all ${
            active
              ? 'w-3 text-primary-800 opacity-100 dark:text-tuggi-blue'
              : 'w-0 opacity-0 group-hover:w-3 group-hover:opacity-100 group-focus-visible:w-3 group-focus-visible:opacity-100'
          }`}
          aria-hidden="true"
        />
      </button>
    </th>
  )
}

function FilterChip({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean
  count: number
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex min-h-[28px] items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
        active
          ? 'border-tuggi-blue/35 bg-tuggi-blue/10 text-primary-800 dark:text-tuggi-blue'
          : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'
      }`}
    >
      {children}
      <span className={active ? 'opacity-70' : 'text-gray-500 dark:text-gray-400'}>{count}</span>
    </button>
  )
}
