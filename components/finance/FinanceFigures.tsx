'use client'

/**
 * OS NÚMEROS DO TRILHO — as respostas de uma linha, lidas sem tirar o olho da tabela.
 *
 * SÃO COMPUTADOS SOBRE A MESMA LISTA que a tabela desenha (`summarizeFinance`), então o número
 * de cima e as linhas de baixo não podem discordar. Um `count()` por cartão é como um quadro
 * acaba dizendo `17 abertos` sobre dezesseis linhas — a mesma decisão que `MaterialFigures` já
 * tomou na fila de material.
 *
 * A TAXA DE IMPRESSÃO APARECE COMO LINHA PRÓPRIA, sob o custo direto e nunca somada nele. É o
 * que permite usar o valor simbólico da impressora sem perder o número marginal, que é o que
 * decide se um parceiro vale a pena.
 *
 * OS MINUTOS CARREGAM A RESSALVA JUNTO. `Minutos comprados` sem a linha que diz que o CMS não
 * sabe o valor em dinheiro daquilo convidaria alguém a tratá-lo como receita.
 *
 * `text-gray-500` E NÃO `text-gray-400` NO RÓTULO MICRO-CAPS: #9CA3AF sobre o painel mede
 * 2,51:1 e reprova SC 1.4.3 (divergência D-C, medida em 2026-08-17). #6B7280 mede 4,83:1.
 */

import { useTranslations } from 'next-intl'
import { AlertTriangle, Coins, Handshake, Printer, TrendingUp, Users } from 'lucide-react'
import { formatDurationOrDash } from '@/lib/format/duration'
import { formatCount, formatMoney } from '@/lib/finance/money'
import type { FinanceSummary } from '@/lib/finance/summary'

interface Props {
  summary: FinanceSummary
  /** Verdadeiro quando a leitura bateu no teto: todo número vira um piso, e a tela diz isso. */
  truncated: boolean
}

export function FinanceFigures({ summary, truncated }: Props) {
  const t = useTranslations('Finance')
  const floor = (value: number) => (truncated ? t('atLeast', { count: value }) : formatCount(value))
  const money = (cents: number) => formatMoney(cents, summary.currency)

  return (
    <section
      aria-labelledby="finance-summary"
      className="rounded-3xl border border-gray-200 bg-white/70 p-5 shadow-2xl shadow-black/5 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-900/70"
    >
      <h2
        id="finance-summary"
        className="mb-4 text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400"
      >
        {t('summary.title')}
      </h2>

      <div className="space-y-4">
        <Figure
          icon={<Handshake className="h-4 w-4 text-primary-800 dark:text-tuggi-blue" aria-hidden="true" />}
          label={t('summary.partners')}
          value={floor(summary.partners)}
        />

        <Figure
          icon={<Coins className="h-4 w-4 text-amber-600" aria-hidden="true" />}
          label={t('summary.directCost')}
          value={money(summary.directCostCents)}
          hint={`${t('summary.standardCost')}: ${money(summary.standardCostCents)} — ${t('summary.standardHint')}`}
        />

        <Figure
          icon={<TrendingUp className="h-4 w-4 text-emerald-600" aria-hidden="true" />}
          label={t('summary.margin')}
          value={money(summary.marginCents)}
          hint={`${t('summary.revenue')}: ${money(summary.revenueCents)}`}
        />

        <Figure
          icon={<Users className="h-4 w-4 text-primary-800 dark:text-tuggi-blue" aria-hidden="true" />}
          label={t('summary.acquired')}
          value={floor(summary.acquiredUsers)}
          hint={`${t('summary.team')}: ${floor(summary.teamUsers)}`}
        />

        <Figure
          icon={<Printer className="h-4 w-4 text-gray-500" aria-hidden="true" />}
          label={t('summary.cac')}
          value={formatMoney(summary.cacCents, summary.currency)}
        />

        <Figure
          icon={<Coins className="h-4 w-4 text-sky-600" aria-hidden="true" />}
          label={t('summary.purchasers')}
          value={summary.usersWithPurchase === null ? '—' : floor(summary.usersWithPurchase)}
          hint={`${t('summary.minutes')}: ${formatDurationOrDash(summary.purchasedMinutes)} — ${t('summary.minutesHint')}`}
        />

        {summary.ordersAwaitingShipment > 0 && (
          <Figure
            icon={<AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" />}
            label={t('summary.awaitingShipment')}
            value={formatCount(summary.ordersAwaitingShipment)}
            hint={t('summary.awaitingShipmentHint')}
          />
        )}

        {/* Só aparece quando existe. Uma linha `0 sem preço` seria ruído permanente; uma linha
            que aparece é a pendência que muda o que os totais acima significam. */}
        {summary.unpricedLines > 0 && (
          <Figure
            icon={<AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" />}
            label={t('summary.unpriced')}
            value={formatCount(summary.unpricedLines)}
            hint={t('verdictHint.uncosted')}
          />
        )}
      </div>
    </section>
  )
}

function Figure({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
  hint?: string
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5">{icon}</span>
      <div className="min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
          {label}
        </div>
        <div className="text-base font-semibold text-gray-900 dark:text-white">{value}</div>
        {hint && <div className="mt-0.5 text-[11px] text-gray-600 dark:text-gray-400">{hint}</div>}
      </div>
    </div>
  )
}
