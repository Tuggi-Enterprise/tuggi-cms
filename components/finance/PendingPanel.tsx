'use client'

/**
 * PENDÊNCIAS — o que o operador precisa resolver no financeiro, uma linha por pendência (#902).
 *
 * A lista vem pronta e ordenada de `/api/finance/pending` (urgente primeiro, a mais antiga
 * primeiro — `sortPendingItems`). Gravidade é decisão da view do #900; a tela só exibe, sempre em
 * texto (DS-A11Y-003).
 *
 * ERRO NUNCA VIRA "NADA PENDENTE". O estado vazio só renderiza com leitura `ready` e lista vazia;
 * a falha tem estado próprio. É o critério 2 da spec, e o pior erro possível desta tela.
 *
 * AÇÃO SEM ENDPOINT NÃO VIRA BOTÃO. Reemitir nota, cancelar nota (#901) e liberar/reenviar repasse
 * (#903) ainda não existem: a linha de nota leva a "Ver cobrança" e a de repasse a "Ver
 * repasses". Para o editor, a linha de repasse diz "Só admin" (§3.5, B1).
 */

import { useLocale, useTranslations } from 'next-intl'
import { CELL, DIM, DenseTableScroller, HEAD, HEAD_NUM, NUM } from '@/components/ui/dense-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatMoney } from '@/lib/finance/money'
import {
  daysBetween,
  isPayoutPending,
  saoPauloDate,
  type PendingItem,
} from '@/lib/finance/place-billing'
import { placeToolHref } from '@/lib/partnerships/place-tool'
import { TINT } from './VerdictBadge'

export type PendingState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; items: PendingItem[]; checkedAt: string; viewerIsAdmin: boolean }

const CARD =
  'rounded-3xl border border-gray-200 bg-white/80 shadow-sm dark:border-gray-800 dark:bg-gray-900/80'
const BADGE = 'whitespace-nowrap border-transparent ring-1'
const LINK =
  'text-sm font-semibold text-primary-800 underline-offset-2 hover:underline dark:text-tuggi-blue'

/** `YYYY-MM-DD` → `dd/mm`. */
const dayMonth = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`
/** `YYYY-MM-01` → `mm/aaaa`. */
const monthYear = (date: string | null) => (date ? `${date.slice(5, 7)}/${date.slice(0, 4)}` : '—')

export function PendingPanel({
  state,
  onReload,
  onOpenSubscription,
  onOpenPayouts,
}: {
  state: PendingState
  onReload: () => void
  onOpenSubscription: (subscriptionId: string) => void
  onOpenPayouts: () => void
}) {
  const t = useTranslations('Finance.pending')
  const locale = useLocale()

  if (state.status === 'error') {
    return (
      <section className={`${CARD} px-5 py-6`} role="alert">
        <p className="text-sm text-red-800 dark:text-red-200">
          {t('error')}{' '}
          <Button variant="outline" size="sm" className="ml-2" onClick={onReload}>
            {t('reload')}
          </Button>
        </p>
      </section>
    )
  }

  if (state.status === 'ready' && state.items.length === 0) {
    const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(
      new Date(state.checkedAt)
    )
    return (
      <section className={`${CARD} px-5 py-4`}>
        <p role="status" className="text-sm text-gray-700 dark:text-gray-300">
          {t('empty', { time })}
        </p>
      </section>
    )
  }

  const today = saoPauloDate(new Date().toISOString()) as string

  const what = (item: PendingItem): string => {
    const reason = item.detail ?? t('noReason')
    switch (item.kind) {
      case 'invoice_error':
        return item.invoiceStatus === 'CANCELLATION_DENIED'
          ? t('kind.invoice_cancellation_denied', { reason })
          : t('kind.invoice_error', { reason })
      case 'payout_failed':
        return t('kind.payout_failed', { reason })
      case 'payout_period_not_calculated':
        return t('kind.payout_period_not_calculated', { month: monthYear(item.periodMonth) })
      case 'payout_not_released':
        return t('kind.payout_not_released', {
          month: monthYear(item.periodMonth),
          deadline: item.referenceDate ? dayMonth(item.referenceDate) : '—',
        })
      default:
        return t(`kind.${item.kind}`)
    }
  }

  const action = (item: PendingItem, viewerIsAdmin: boolean) => {
    if (item.kind === 'payout_without_pix_key') {
      return item.attractionId ? (
        <a
          className={LINK}
          href={placeToolHref({ locale, attractionId: item.attractionId, entityKind: item.attractionEntityKind })}
        >
          {t('action.viewPlace')}
        </a>
      ) : null
    }
    if (item.kind === 'payout_not_released' || item.kind === 'payout_failed') {
      if (!viewerIsAdmin) return <span className={`text-sm ${DIM}`}>{t('action.adminOnly')}</span>
      return (
        <button type="button" className={LINK} onClick={onOpenPayouts}>
          {t('action.viewPayouts')}
        </button>
      )
    }
    if (isPayoutPending(item.kind)) {
      return (
        <button type="button" className={LINK} onClick={onOpenPayouts}>
          {t('action.viewPayouts')}
        </button>
      )
    }
    return item.subscriptionId ? (
      <button type="button" className={LINK} onClick={() => onOpenSubscription(item.subscriptionId as string)}>
        {t('action.viewCharge')}
      </button>
    ) : null
  }

  return (
    <section className={CARD}>
      <DenseTableScroller maxHeightClassName="max-h-[calc(100vh-14rem)]">
        <table className="w-full min-w-[900px] border-collapse">
          <thead>
            <tr>
              <th scope="col" className={HEAD}>{t('columns.severity')}</th>
              <th scope="col" className={HEAD}>{t('columns.what')}</th>
              <th scope="col" className={HEAD}>{t('columns.place')}</th>
              <th scope="col" className={HEAD_NUM}>{t('columns.amount')}</th>
              <th scope="col" className={HEAD}>{t('columns.since')}</th>
              <th scope="col" className={HEAD}>{t('columns.action')}</th>
            </tr>
          </thead>
          <tbody>
            {state.status === 'loading' &&
              [0, 1, 2].map((row) => (
                <tr key={row} aria-hidden="true" className="border-t border-gray-100 dark:border-gray-800">
                  {[0, 1, 2, 3, 4, 5].map((cell) => (
                    <td key={cell} className={CELL}>
                      <div className="h-4 w-full animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                    </td>
                  ))}
                </tr>
              ))}

            {state.status === 'ready' &&
              state.items.map((item) => (
                <tr
                  key={`${item.kind}:${item.objectId}`}
                  className="border-t border-gray-100 align-top dark:border-gray-800"
                >
                  <td className={CELL}>
                    <Badge className={`${BADGE} ${item.severity === 'critical' ? TINT.urgent : TINT.attention}`}>
                      {t(`severity.${item.severity}`)}
                    </Badge>
                  </td>
                  {/* O motivo do Asaas fica NA LINHA, nunca só em tooltip: é ele que diz o que fazer. */}
                  <td className={`${CELL} max-w-[28rem]`}>{what(item)}</td>
                  <td className={CELL}>
                    {item.placeName ?? '—'}
                    {item.contactEmail && (
                      <span className={`mt-0.5 block text-[11px] ${DIM}`}>{item.contactEmail}</span>
                    )}
                  </td>
                  <td className={NUM}>{formatMoney(item.amountCents, 'BRL')}</td>
                  <td className={`${CELL} whitespace-nowrap tabular-nums`}>
                    {item.referenceDate ? (
                      <>
                        {dayMonth(item.referenceDate)}
                        {item.referenceDate <= today && (
                          <span className={`ml-1 text-[11px] ${DIM}`}>
                            {t('daysAgo', { count: daysBetween(item.referenceDate, today) })}
                          </span>
                        )}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className={`${CELL} whitespace-nowrap`}>{action(item, state.viewerIsAdmin)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </DenseTableScroller>
    </section>
  )
}
