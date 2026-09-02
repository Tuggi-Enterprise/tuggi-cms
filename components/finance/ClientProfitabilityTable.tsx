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
 * A TABELA ROLA DENTRO DO CARTÃO (`overflow-x-auto`), então a página nunca rola de lado. São
 * doze colunas, e a rolagem horizontal dentro de um cartão continua sendo custo de leitura — mas
 * cortar coluna é decisão de produto, e cada uma aqui responde uma pergunta que foi feita.
 */

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { formatDurationOrDash } from '@/lib/format/duration'
import { formatCount, formatMoney } from '@/lib/finance/money'
import { cohortMonth } from '@/lib/finance/cohort'
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

const HEAD =
  'sticky top-0 z-10 bg-white/90 px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-gray-500 backdrop-blur dark:bg-gray-900/90 dark:text-gray-400'
const CELL = 'px-3 py-2.5 text-sm text-gray-800 dark:text-gray-200 align-top'
const NUM = `${CELL} tabular-nums whitespace-nowrap`

export function ClientProfitabilityTable({ clients }: { clients: ClientProfitability[] }) {
  const t = useTranslations('Finance')
  const [verdict, setVerdict] = useState<FinanceVerdict | 'all'>('all')
  const [cohort, setCohort] = useState<string>('all')

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

  const rows = useMemo(
    () =>
      clients.filter((client) => {
        if (verdict !== 'all' && client.verdict !== verdict) return false
        if (cohort === 'all') return true
        const month = cohortMonth(client.approvedAt)
        return cohort === 'undated' ? month === null : month === cohort
      }),
    [clients, verdict, cohort]
  )

  return (
    <section className="rounded-3xl border border-gray-200 bg-white/70 shadow-2xl shadow-black/5 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-900/70">
      <header className="flex flex-wrap items-center gap-3 border-b border-gray-200 px-5 py-4 dark:border-gray-800">
        <h2 className="mr-auto text-sm font-semibold text-gray-900 dark:text-white">
          {t('table.title')}
        </h2>

        <label className="flex items-center gap-2 text-[11px] font-medium text-gray-600 dark:text-gray-400">
          {t('table.filterVerdict')}
          <select
            value={verdict}
            onChange={(event) => setVerdict(event.target.value as FinanceVerdict | 'all')}
            className="min-h-[24px] rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="all">{t('table.filterAll')}</option>
            {VERDICTS.map((option) => (
              <option key={option} value={option}>
                {t(`verdict.${option}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-[11px] font-medium text-gray-600 dark:text-gray-400">
          {t('table.filterCohort')}
          <select
            value={cohort}
            onChange={(event) => setCohort(event.target.value)}
            className="min-h-[24px] rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="all">{t('table.filterAll')}</option>
            {cohorts.map((option) => (
              <option key={option} value={option}>
                {option === 'undated' ? t('table.undatedCohort') : option}
              </option>
            ))}
          </select>
        </label>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] border-collapse">
          <thead>
            <tr>
              <th scope="col" className={HEAD}>{t('table.client')}</th>
              <th scope="col" className={HEAD}>{t('table.verdict')}</th>
              <th scope="col" className={HEAD}>{t('table.cohort')}</th>
              <th scope="col" className={HEAD}>{t('table.directCost')}</th>
              <th scope="col" className={HEAD}>{t('table.standard')}</th>
              <th scope="col" className={HEAD}>{t('table.revenue')}</th>
              <th scope="col" className={HEAD}>{t('table.margin')}</th>
              <th scope="col" className={HEAD}>{t('table.payback')}</th>
              <th scope="col" className={HEAD}>{t('table.cac')}</th>
              <th scope="col" className={HEAD}>{t('table.acquired')}</th>
              <th scope="col" className={HEAD}>{t('table.team')}</th>
              <th scope="col" className={HEAD}>{t('table.purchasers')}</th>
              <th scope="col" className={HEAD}>{t('table.minutes')}</th>
              <th scope="col" className={HEAD}>{t('table.awaitingShipment')}</th>
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
                <th scope="row" className={`${CELL} text-left font-medium text-gray-900 dark:text-white`}>
                  {client.clientName}
                  {/* Moeda ignorada é dito, nunca escondido: o total desta linha não a inclui. */}
                  {client.ignoredCurrencies.length > 0 && (
                    <span className="mt-0.5 block text-[11px] font-normal text-amber-700 dark:text-amber-300">
                      {client.ignoredCurrencies.join(', ')}
                    </span>
                  )}
                </th>
                <td className={CELL}>
                  <VerdictBadge verdict={client.verdict} />
                </td>
                <td className={NUM}>
                  {cohortMonth(client.approvedAt) ?? t('table.undatedCohort')}
                  <span className="mt-0.5 block text-[11px] text-gray-600 dark:text-gray-400">
                    {t('table.months', { count: client.monthsBilled })}
                  </span>
                </td>
                <td className={NUM}>{formatMoney(client.directCostCents, client.currency)}</td>
                <td className={`${NUM} text-gray-600 dark:text-gray-400`}>
                  {formatMoney(client.standardCostCents, client.currency)}
                </td>
                <td className={NUM}>{formatMoney(client.revenueCents, client.currency)}</td>
                <td className={`${NUM} font-semibold`}>
                  {formatMoney(client.marginCents, client.currency)}
                </td>
                <td className={NUM}>
                  {client.paybackMonths === null
                    ? '—'
                    : t('table.paybackMonths', { count: client.paybackMonths })}
                </td>
                <td className={NUM}>{formatMoney(client.cacCents, client.currency)}</td>
                <td className={NUM}>{formatCount(client.linkedByPartnerId)}</td>
                <td className={`${NUM} text-gray-600 dark:text-gray-400`}>
                  {formatCount(client.linkedByClientId)}
                </td>
                {/* `≥` E NÃO O NÚMERO: com menos de `PURCHASE_MIN_COHORT` adquiridos, a coluna
                    de compras identificaria uma pessoa ao lado do nome do bar onde ela esteve, e
                    o servidor colapsou o valor. O que chega aqui é um piso, e escrevê-lo como
                    `1` seco seria afirmar que é exatamente um. Os minutos somem inteiros — são a
                    coluna que mais identifica e a única que não decide veredito nenhum. */}
                <td className={NUM} title={client.purchaseSuppressed ? t('table.suppressed') : undefined}>
                  {client.purchaseSuppressed
                    ? `≥ ${formatCount(client.usersWithPurchase)}`
                    : formatCount(client.usersWithPurchase)}
                </td>
                <td className={NUM} title={client.purchaseSuppressed ? t('table.suppressed') : undefined}>
                  {formatDurationOrDash(client.purchasedMinutes)}
                </td>
                {/* A pendência fica na linha do parceiro porque é dela que o veredito
                    `Custo incompleto` vem — sem a coluna, o operador leria o veredito sem saber
                    qual das duas causas atacar. */}
                <td className={`${NUM} ${client.ordersAwaitingShipment > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-gray-600 dark:text-gray-400'}`}>
                  {client.ordersAwaitingShipment > 0 ? formatCount(client.ordersAwaitingShipment) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
