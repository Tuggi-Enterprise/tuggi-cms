'use client'

/**
 * MENSALIDADES — o Com história como o Asaas cobrou, sem abrir o Asaas (#902).
 *
 * Uma linha por assinatura; o botão do primeiro campo expande as cobranças dela, cada uma com a
 * nota (número, status, PDF, XML). Os quatro totais do mês vêm prontos do servidor
 * (`summarizePlaceMonth`), sobre a mesma leitura que a tabela desenha.
 *
 * O painel busca a própria leitura: ela é independente do quadro de lucratividade, e uma falha de
 * uma não pode esconder a outra. Erro tem estado próprio — nunca a frase de vazio.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronDown, ChevronRight, Banknote, Repeat, ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { CELL, DIM, DenseTableScroller, FilterChip, HEAD, HEAD_NUM, NUM } from '@/components/ui/dense-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { StatCard, StatCardRow } from '@/components/ui/StatCard'
import { formatMoney } from '@/lib/finance/money'
import {
  contractReviewDue,
  isCanceled,
  isPaidWithoutInvoice,
  matchesFilter,
  saoPauloDate,
  type PlaceCharge,
  type PlaceInvoice,
  type PlaceMonthTotals,
  type PlaceSubscription,
  type SubscriptionFilter,
} from '@/lib/finance/place-billing'
import { INPUT } from './StructurePanel'
import { TINT, type Tint } from './VerdictBadge'

export interface SubscriptionsPayload {
  month: string
  currency: string
  totals: PlaceMonthTotals
  subscriptions: PlaceSubscription[]
}

const FILTERS: readonly SubscriptionFilter[] = ['all', 'overdue', 'without_invoice', 'canceled']
const CARD =
  'rounded-3xl border border-gray-200 bg-white/80 shadow-sm dark:border-gray-800 dark:bg-gray-900/80'
const BADGE = 'whitespace-nowrap border-transparent ring-1'
const LINK = 'font-semibold text-primary-800 underline-offset-2 hover:underline dark:text-tuggi-blue'

/** `YYYY-MM-DD` → `dd/mm/aaaa`. */
const date = (value: string | null) =>
  value ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : '—'

/** Os doze últimos meses, do corrente para trás. */
function lastMonths(current: string): string[] {
  const out: string[] = []
  let year = Number(current.slice(0, 4))
  let month = Number(current.slice(5, 7))
  for (let index = 0; index < 12; index += 1) {
    out.push(`${year}-${String(month).padStart(2, '0')}`)
    month -= 1
    if (month === 0) {
      month = 12
      year -= 1
    }
  }
  return out
}

type ChargeLabel = 'upcoming' | 'paid' | 'overdue' | 'refund_pending' | 'refunded'

function chargeLabel(charge: PlaceCharge, today: string): ChargeLabel {
  if (charge.status === 'overdue') return charge.dueDate !== null && charge.dueDate >= today ? 'upcoming' : 'overdue'
  return charge.status
}

const CHARGE_TINT: Record<ChargeLabel, Tint> = {
  upcoming: 'neutral',
  paid: 'ok',
  overdue: 'urgent',
  refund_pending: 'attention',
  refunded: 'neutral',
}

function invoiceTint(invoice: PlaceInvoice | null): Tint {
  if (invoice === null) return 'attention'
  if (invoice.status === 'AUTHORIZED') return 'ok'
  if (invoice.status === 'ERROR' || invoice.status === 'CANCELLATION_DENIED') return 'urgent'
  return 'neutral'
}

export function SubscriptionsPanel({ focusSubscriptionId }: { focusSubscriptionId: string | null }) {
  const t = useTranslations('Finance.subscriptions')
  const tPending = useTranslations('Finance.pending')
  const today = saoPauloDate(new Date().toISOString()) as string
  const [month, setMonth] = useState(today.slice(0, 7))
  const [payload, setPayload] = useState<SubscriptionsPayload | null>(null)
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [filter, setFilter] = useState<SubscriptionFilter>('all')
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const focusRef = useRef<HTMLTableRowElement | null>(null)

  const load = useCallback(async () => {
    setState('loading')
    try {
      const response = await fetch(`/api/finance/subscriptions?month=${month}`)
      if (!response.ok) {
        setState('error')
        return
      }
      setPayload(await response.json())
      setState('ready')
    } catch {
      setState('error')
    }
  }, [month])

  useEffect(() => {
    void load()
  }, [load])

  // "Ver cobrança" em Pendências chega aqui: a assinatura abre e vem para a vista.
  useEffect(() => {
    if (!focusSubscriptionId) return
    setFilter('all')
    setExpanded((current) => new Set(current).add(focusSubscriptionId))
  }, [focusSubscriptionId])
  useEffect(() => {
    if (state === 'ready') focusRef.current?.scrollIntoView({ block: 'center' })
  }, [state, focusSubscriptionId])

  const subscriptions = useMemo(() => payload?.subscriptions ?? [], [payload])
  const counts = useMemo(() => {
    const out = {} as Record<SubscriptionFilter, number>
    for (const option of FILTERS) out[option] = subscriptions.filter((sub) => matchesFilter(sub, option)).length
    return out
  }, [subscriptions])
  const rows = subscriptions.filter((sub) => matchesFilter(sub, filter))
  const monthLabel = `${month.slice(5, 7)}/${month.slice(0, 4)}`
  const money = (cents: number | null) => formatMoney(cents, payload?.currency ?? 'BRL')

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  /** O filtro também recorta as cobranças expandidas: "Sem nota" mostra só as pagas sem nota. */
  const visibleCharges = (sub: PlaceSubscription) =>
    filter === 'without_invoice'
      ? sub.charges.filter(isPaidWithoutInvoice)
      : filter === 'overdue'
        ? sub.charges.filter((charge) => charge.status === 'overdue')
        : sub.charges

  const invoiceCell = (invoice: PlaceInvoice | null, withFiles: boolean) => (
    <span className="inline-flex flex-wrap items-center gap-2">
      {invoice?.number && <span className="tabular-nums">{invoice.number}</span>}
      <Badge className={`${BADGE} ${TINT[invoiceTint(invoice)]}`}>
        {t(`invoiceStatus.${invoice?.status ?? 'none'}`)}
      </Badge>
      {invoice?.pdfUrl && (
        <a className={LINK} href={invoice.pdfUrl} target="_blank" rel="noopener noreferrer">
          {t('pdf')}
        </a>
      )}
      {withFiles && invoice?.xmlUrl && (
        <a className={LINK} href={invoice.xmlUrl} target="_blank" rel="noopener noreferrer">
          {t('xml')}
        </a>
      )}
      {invoice?.statusDescription && (invoice.status === 'ERROR' || invoice.status === 'CANCELLATION_DENIED') && (
        <span className="block w-full text-[11px] text-red-800 dark:text-red-200">{invoice.statusDescription}</span>
      )}
    </span>
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((option) => (
            <FilterChip
              key={option}
              active={filter === option}
              count={state === 'ready' ? counts[option] : undefined}
              onClick={() => setFilter(option)}
            >
              {t(`filter.${option}`)}
            </FilterChip>
          ))}
        </div>
        <label className="flex items-center gap-2 text-[11px] font-medium text-gray-700 dark:text-gray-300">
          {t('month')}
          <select value={month} onChange={(e) => setMonth(e.target.value)} className={`${INPUT} max-w-[10rem]`}>
            {lastMonths(today.slice(0, 7)).map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
      </div>

      {state === 'error' && (
        <section className={`${CARD} px-5 py-6`} role="alert">
          <p className="text-sm text-red-800 dark:text-red-200">
            {t('error')}{' '}
            <Button variant="outline" size="sm" className="ml-2" onClick={() => void load()}>
              {tPending('reload')}
            </Button>
          </p>
        </section>
      )}

      {state !== 'error' && (
        <StatCardRow columns={4}>
          <StatCard icon={Banknote} label={t('stats.received')} value={money(payload?.totals.receivedCents ?? null)} subtitle={monthLabel} isLoading={state === 'loading'} size="compact" glow={false} />
          <StatCard icon={Repeat} label={t('stats.recurring')} value={money(payload?.totals.recurringCents ?? null)} subtitle={monthLabel} isLoading={state === 'loading'} size="compact" glow={false} />
          <StatCard icon={ArrowDownLeft} label={t('stats.inflow')} value={money(payload?.totals.inflowCents ?? null)} subtitle={monthLabel} isLoading={state === 'loading'} size="compact" glow={false} />
          <StatCard icon={ArrowUpRight} label={t('stats.outflow')} value={money(payload?.totals.outflowCents ?? null)} subtitle={monthLabel} isLoading={state === 'loading'} size="compact" glow={false} />
        </StatCardRow>
      )}

      {state === 'ready' && subscriptions.length === 0 && (
        <section className={`${CARD} px-5 py-4`}>
          <p role="status" className="text-sm text-gray-700 dark:text-gray-300">
            {t('empty', { month: monthLabel })}
          </p>
        </section>
      )}

      {state === 'ready' && subscriptions.length > 0 && (
        <section className={CARD}>
          <DenseTableScroller>
            <table className="w-full min-w-[1100px] border-collapse">
              <thead>
                <tr>
                  <th scope="col" className={HEAD}>{t('columns.place')}</th>
                  <th scope="col" className={HEAD}>{t('columns.plan')}</th>
                  <th scope="col" className={HEAD}>{t('columns.method')}</th>
                  <th scope="col" className={HEAD}>{t('columns.subscription')}</th>
                  <th scope="col" className={HEAD}>{t('columns.lastCharge')}</th>
                  <th scope="col" className={HEAD}>{t('columns.lastInvoice')}</th>
                  <th scope="col" className={HEAD}>{t('columns.nextCharge')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className={`${CELL} py-6 text-center ${DIM}`}>{t('emptyFilter')}</td>
                  </tr>
                )}
                {rows.map((sub) => {
                  const open = expanded.has(sub.id)
                  const last = sub.charges[0] ?? null
                  const status = isCanceled(sub) && sub.canceledAt !== null ? 'canceled' : sub.status
                  const charges = visibleCharges(sub)
                  return (
                    <Fragment key={sub.id}>
                      <tr
                        ref={sub.id === focusSubscriptionId ? focusRef : undefined}
                        className="border-t border-gray-100 align-top hover:bg-gray-50/70 dark:border-gray-800 dark:hover:bg-gray-800/40"
                      >
                        <th scope="row" className={`${CELL} text-left font-medium text-gray-900 dark:text-white`}>
                          <button
                            type="button"
                            aria-expanded={open}
                            aria-label={t('expand', { place: sub.placeName })}
                            onClick={() => toggle(sub.id)}
                            className="inline-flex items-center gap-1 text-left"
                          >
                            {open ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
                            {sub.placeName}
                          </button>
                          {sub.clientName && sub.clientName !== sub.placeName && (
                            <span className={`block pl-5 text-xs font-normal ${DIM}`}>{sub.clientName}</span>
                          )}
                        </th>
                        <td className={`${CELL} whitespace-nowrap`}>
                          {sub.origin === 'cms_contract'
                            ? t('planCmsContract')
                            : sub.billingPeriod
                              ? t('plan', { count: sub.billingPeriod })
                              : t('planNoPeriod')}
                          {sub.origin === 'cms_contract' && sub.contractEndsOn && (
                            <span className="block text-xs tabular-nums">
                              {contractReviewDue(sub, today) ? (
                                <Badge className={`${BADGE} ${TINT.attention}`}>{t('contractReview', { date: date(sub.contractEndsOn) })}</Badge>
                              ) : (
                                <span className={DIM}>{t('contractReview', { date: date(sub.contractEndsOn) })}</span>
                              )}
                            </span>
                          )}
                        </td>
                        <td className={CELL}>{sub.paymentMethod ? t(`method.${sub.paymentMethod}`) : '—'}</td>
                        <td className={CELL}>
                          <Badge className={`${BADGE} ${TINT[status === 'paid' ? 'ok' : status === 'past_due' ? 'urgent' : 'neutral']}`}>
                            {t(`subscriptionStatus.${status}`)}
                          </Badge>
                        </td>
                        <td className={`${CELL} whitespace-nowrap tabular-nums`}>
                          {last ? (
                            <>
                              {money(last.amountCents)} <span className={DIM}>· {date(last.dueDate)}</span>{' '}
                              <Badge className={`${BADGE} ${TINT[CHARGE_TINT[chargeLabel(last, today)]]}`}>
                                {t(`chargeStatus.${chargeLabel(last, today)}`)}
                              </Badge>
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className={CELL}>{last ? invoiceCell(last.invoice, false) : '—'}</td>
                        <td className={`${CELL} whitespace-nowrap tabular-nums`}>
                          {sub.renews && !isCanceled(sub) ? date(sub.paidThrough) : t('noNext')}
                        </td>
                      </tr>
                      {open && (
                        <tr className="bg-gray-50/70 dark:bg-gray-800/30">
                          <td colSpan={7} className="px-6 py-3">
                            {charges.length === 0 ? (
                              <p className={`text-sm ${DIM}`}>{t('noCharges')}</p>
                            ) : (
                              <table className="w-full border-collapse">
                                <thead>
                                  <tr>
                                    <th scope="col" className={HEAD}>{t('chargeColumns.due')}</th>
                                    <th scope="col" className={HEAD_NUM}>{t('chargeColumns.amount')}</th>
                                    <th scope="col" className={HEAD}>{t('chargeColumns.paidOn')}</th>
                                    <th scope="col" className={HEAD}>{t('chargeColumns.status')}</th>
                                    <th scope="col" className={HEAD}>{t('chargeColumns.invoice')}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {charges.map((charge) => (
                                    <tr key={charge.providerPaymentId} className="border-t border-gray-100 align-top dark:border-gray-800">
                                      <td className={`${CELL} tabular-nums`}>{date(charge.dueDate)}</td>
                                      <td className={NUM}>{money(charge.amountCents)}</td>
                                      <td className={`${CELL} tabular-nums`}>{date(charge.paidOn)}</td>
                                      <td className={CELL}>
                                        <Badge className={`${BADGE} ${TINT[CHARGE_TINT[chargeLabel(charge, today)]]}`}>
                                          {t(`chargeStatus.${chargeLabel(charge, today)}`)}
                                        </Badge>
                                      </td>
                                      <td className={CELL}>{invoiceCell(charge.invoice, true)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </DenseTableScroller>
        </section>
      )}
    </div>
  )
}
