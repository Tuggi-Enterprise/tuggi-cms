'use client'

/**
 * REPASSES — the 10 % payout of the Com história places, one row per place and month (#903,
 * spec of the `design` in the first comment of the card; BR-B2B-044 item 6, term 5.4).
 *
 * Admin only releases (B1): the server says who the viewer is (`viewerIsAdmin`) and the release
 * route checks it again. The confirmation shows the amount and the key the SERVER sent, and the
 * route refuses if the amount changed since the load (decision 3). The statement opened under a row
 * is internal audit — the partner never sees it (B2).
 */

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Banknote, ChevronDown, ChevronRight, Send, CheckCircle2, AlertTriangle } from 'lucide-react'
import { CELL, DIM, DenseTableScroller, HEAD, HEAD_NUM, NUM } from '@/components/ui/dense-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { StatCard, StatCardRow } from '@/components/ui/StatCard'
import { formatMoney } from '@/lib/finance/money'
import { saoPauloDate } from '@/lib/finance/place-billing'
import {
  businessDaysUntil,
  isUnpaidAfter,
  payoutAction,
  previousPeriod,
  type PayoutRow,
  type PayoutStatus,
} from '@/lib/finance/payouts'
import { INPUT } from './StructurePanel'
import { TINT, type Tint } from './VerdictBadge'

interface PayoutsPayload {
  periodMonth: string
  calculatedAt: string | null
  payDeadline: string | null
  rows: PayoutRow[]
  today: string
  viewerIsAdmin: boolean
}

const CARD =
  'rounded-3xl border border-gray-200 bg-white/80 shadow-sm dark:border-gray-800 dark:bg-gray-900/80'
const BADGE = 'whitespace-nowrap border-transparent ring-1'
const LINK = 'text-sm font-semibold text-primary-800 underline-offset-2 hover:underline dark:text-tuggi-blue'

const STATUS_TINT: Record<PayoutStatus, Tint> = {
  calculated: 'attention',
  released: 'neutral',
  sent: 'neutral',
  paid: 'ok',
  failed: 'urgent',
  cancelled: 'neutral',
}

const nextPeriod = (p: string) =>
  p.slice(5, 7) === '12' ? `${Number(p.slice(0, 4)) + 1}-01-01` : `${p.slice(0, 4)}-${String(Number(p.slice(5, 7)) + 1).padStart(2, '0')}-01`
/** `YYYY-MM-DD…` → `dd/mm`. */
const dayMonth = (value: string | null) => (value ? `${value.slice(8, 10)}/${value.slice(5, 7)}` : '—')
const brl = (cents: number) => formatMoney(cents, 'BRL')
/** `12ABC345000135` → `12.ABC.345/0001-35`. */
const cnpj = (key: string | null) =>
  key && key.length === 14 ? `${key.slice(0, 2)}.${key.slice(2, 5)}.${key.slice(5, 8)}/${key.slice(8, 12)}-${key.slice(12)}` : key ?? '—'

/** The twelve closed months before the current one. */
function closedMonths(today: string): string[] {
  const out: string[] = []
  let period = previousPeriod(today)
  for (let i = 0; i < 12; i += 1) {
    out.push(period)
    period = previousPeriod(period)
  }
  return out
}

type RowMessage = { id: string; text: string }

export function PayoutsPanel() {
  const t = useTranslations('Finance.payouts')
  const locale = useLocale()
  const monthName = (period: string) =>
    new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(new Date(`${period}T12:00:00Z`))
  const today = saoPauloDate(new Date().toISOString()) as string
  const [month, setMonth] = useState(previousPeriod(today))
  const [payload, setPayload] = useState<PayoutsPayload | null>(null)
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [confirming, setConfirming] = useState<string | null>(null)
  const [sending, setSending] = useState<string | null>(null)
  const [message, setMessage] = useState<RowMessage | null>(null)
  const [closing, setClosing] = useState(false)
  const [closeMessage, setCloseMessage] = useState<string | null>(null)
  const [invoiceEditing, setInvoiceEditing] = useState<string | null>(null)
  const [invoiceDraft, setInvoiceDraft] = useState('')
  const confirmRef = useRef<HTMLButtonElement | null>(null)
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>())

  const load = useCallback(async () => {
    setState('loading')
    try {
      const response = await fetch(`/api/finance/payouts?month=${month}`)
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

  useEffect(() => {
    if (confirming) confirmRef.current?.focus()
  }, [confirming])

  const closeConfirm = (id: string) => {
    setConfirming(null)
    rowRefs.current.get(id)?.focus()
  }

  const release = async (row: PayoutRow) => {
    if (sending) return
    setSending(row.id)
    setMessage(null)
    try {
      const response = await fetch(`/api/finance/payouts/${row.id}/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedAmountCents: row.amountCents }),
      })
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
      if (response.status === 409 && body.error === 'amount_changed') {
        setMessage({ id: row.id, text: t('amountChanged', { amount: brl(Number(body.amountCents)) }) })
      } else if (!response.ok) {
        setMessage({ id: row.id, text: t('releaseError', { code: String(body.error ?? response.status) }) })
      }
      setConfirming(null)
      await load()
    } finally {
      setSending(null)
    }
  }

  const close = async () => {
    setClosing(true)
    setCloseMessage(null)
    try {
      const response = await fetch('/api/finance/payouts/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodMonth: month }),
      })
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
      if (response.status === 422 && body.error === 'missing_fx_rate') {
        setCloseMessage(t('close.missingRate', { currencies: (body.currencies as string[]).join(', ') }))
      } else if (!response.ok) {
        setCloseMessage(t('close.error', { code: String(body.error ?? response.status) }))
      }
      await load()
    } finally {
      setClosing(false)
    }
  }

  const saveInvoice = async (row: PayoutRow) => {
    const number = invoiceDraft.trim()
    if (!number) return
    const response = await fetch(`/api/finance/payouts/${row.id}/invoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number }),
    })
    if (!response.ok) setMessage({ id: row.id, text: t('invoiceError') })
    setInvoiceEditing(null)
    await load()
  }

  const rows = payload?.rows ?? []
  const viewerIsAdmin = payload?.viewerIsAdmin ?? false
  const deadline = payload?.payDeadline ?? null
  const late = deadline !== null && today > deadline && isUnpaidAfter(rows)
  const band = t('band', {
    month: monthName(nextPeriod(month)),
    previous: monthName(month),
    deadline: dayMonth(deadline),
    days: deadline ? Math.max(0, businessDaysUntil(today, deadline)) : 0,
  })

  const sum = (statuses: PayoutStatus[]) => {
    const own = rows.filter((row) => statuses.includes(row.status) && row.amountCents > 0)
    return { cents: own.reduce((total, row) => total + row.amountCents, 0), count: own.length }
  }
  const totals = {
    toRelease: sum(['calculated']),
    sent: sum(['released', 'sent']),
    paid: sum(['paid']),
    failed: sum(['failed']),
  }

  const statusLabel = (row: PayoutRow) =>
    row.status === 'paid'
      ? t('status.paid', { date: dayMonth(row.paidAt ? saoPauloDate(row.paidAt) : null) })
      : row.status === 'failed'
        ? t('status.failed', { reason: row.failReason ?? '—' })
        : t(`status.${row.status}`)

  const actionCell = (row: PayoutRow) => {
    if (confirming === row.id) {
      return (
        <div
          className="flex flex-col gap-2"
          onKeyDown={(event) => {
            if (event.key === 'Escape' && sending !== row.id) closeConfirm(row.id)
          }}
        >
          <p className="whitespace-normal text-sm">
            {t.rich('confirm.question', {
              amount: brl(row.amountCents),
              key: cnpj(row.pixKey),
              b: (chunks) => <strong>{chunks}</strong>,
            })}
          </p>
          <div className="flex gap-2">
            <Button ref={confirmRef} size="sm" disabled={sending === row.id} onClick={() => void release(row)}>
              {sending === row.id ? t('confirm.sending') : t('confirm.confirm')}
            </Button>
            <Button size="sm" variant="outline" disabled={sending === row.id} onClick={() => closeConfirm(row.id)}>
              {t('confirm.back')}
            </Button>
          </div>
        </div>
      )
    }
    const action = payoutAction(row, viewerIsAdmin)
    switch (action.kind) {
      case 'release':
      case 'resend':
        return (
          <Button size="sm" onClick={() => setConfirming(row.id)}>
            {t(action.kind === 'release' ? 'action.release' : 'action.resend')}
          </Button>
        )
      case 'no_pix_key':
        return <span className={`text-sm ${DIM}`}>{t('action.noPixKey')}</span>
      case 'no_value':
        return (
          <span className={`text-sm ${DIM}`}>
            {action.amountCents < 0 ? t('action.negative', { amount: brl(action.amountCents) }) : t('action.zero')}
          </span>
        )
      case 'admin_only':
        return <span className={`text-sm ${DIM}`}>{t('action.adminOnly')}</span>
      default:
        return null
    }
  }

  const invoiceCell = (row: PayoutRow) => {
    if (row.partnerInvoiceNumber) return row.partnerInvoiceNumber
    if (!viewerIsAdmin) return '—'
    if (invoiceEditing === row.id) {
      return (
        <form
          className="flex gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            void saveInvoice(row)
          }}
        >
          <input
            autoFocus
            aria-label={t('columns.invoice')}
            value={invoiceDraft}
            maxLength={40}
            onChange={(event) => setInvoiceDraft(event.target.value)}
            onKeyDown={(event) => event.key === 'Escape' && setInvoiceEditing(null)}
            className={`${INPUT} max-w-[8rem]`}
          />
          <Button size="sm" type="submit">{t('invoiceSave')}</Button>
        </form>
      )
    }
    return (
      <button
        type="button"
        className={LINK}
        onClick={() => {
          setInvoiceDraft('')
          setInvoiceEditing(row.id)
        }}
      >
        {t('invoiceAttach')}
      </button>
    )
  }

  const itemLabel = (item: PayoutRow['items'][number]) =>
    item.kind === 'purchase'
      ? item.productId ?? t('statement.purchase')
      : item.kind === 'refund_offset'
        ? t('statement.refund', { date: dayMonth(item.occurredAt ? saoPauloDate(item.occurredAt) : null) })
        : t('statement.carry')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="status" className={`text-sm font-medium ${late ? 'text-red-800 dark:text-red-200' : 'text-gray-800 dark:text-gray-200'}`}>
          {late ? `${t('late')} ${band}` : band}
        </p>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-[11px] font-medium text-gray-700 dark:text-gray-300">
            {t('month')}
            <select value={month} onChange={(event) => setMonth(event.target.value)} className={`${INPUT} max-w-[10rem]`}>
              {closedMonths(today).map((option) => (
                <option key={option} value={option}>{`${option.slice(5, 7)}/${option.slice(0, 4)}`}</option>
              ))}
            </select>
          </label>
          {viewerIsAdmin && (
            <Button size="sm" variant="outline" disabled={closing} onClick={() => void close()}>
              {closing ? t('close.running') : t('close.button', { month: monthName(month) })}
            </Button>
          )}
        </div>
      </div>
      {closeMessage && (
        <p role="alert" className="text-sm text-red-800 dark:text-red-200">{closeMessage}</p>
      )}

      {state === 'error' && (
        <section className={`${CARD} px-5 py-6`} role="alert">
          <p className="text-sm text-red-800 dark:text-red-200">
            {t('error')}{' '}
            <Button variant="outline" size="sm" className="ml-2" onClick={() => void load()}>
              {t('reload')}
            </Button>
          </p>
        </section>
      )}

      {state !== 'error' && (
        <StatCardRow columns={4}>
          <StatCard icon={Banknote} label={t('stats.toRelease')} value={brl(totals.toRelease.cents)} subtitle={t('stats.places', { count: totals.toRelease.count })} isLoading={state === 'loading'} size="compact" glow={false} />
          <StatCard icon={Send} label={t('stats.sent')} value={brl(totals.sent.cents)} subtitle={t('stats.places', { count: totals.sent.count })} isLoading={state === 'loading'} size="compact" glow={false} />
          <StatCard icon={CheckCircle2} label={t('stats.paid')} value={brl(totals.paid.cents)} subtitle={t('stats.places', { count: totals.paid.count })} isLoading={state === 'loading'} size="compact" glow={false} />
          <StatCard icon={AlertTriangle} label={t('stats.failed')} value={brl(totals.failed.cents)} subtitle={t('stats.places', { count: totals.failed.count })} isLoading={state === 'loading'} size="compact" glow={false} />
        </StatCardRow>
      )}

      {state === 'ready' && payload && !payload.calculatedAt && (
        <section className={`${CARD} px-5 py-4`}>
          <p role="status" className="text-sm text-gray-700 dark:text-gray-300">{t('notCalculated', { month: monthName(month) })}</p>
        </section>
      )}
      {state === 'ready' && payload?.calculatedAt && rows.length === 0 && (
        <section className={`${CARD} px-5 py-4`}>
          <p role="status" className="text-sm text-gray-700 dark:text-gray-300">{t('empty', { month: monthName(month) })}</p>
        </section>
      )}

      {state !== 'error' && (state === 'loading' || rows.length > 0) && (
        <section className={CARD}>
          <DenseTableScroller maxHeightClassName="max-h-[calc(100vh-18rem)]">
            <table className="w-full min-w-[1100px] border-collapse">
              <thead>
                <tr>
                  <th scope="col" className={HEAD}>{t('columns.place')}</th>
                  <th scope="col" className={HEAD}>{t('columns.taxId')}</th>
                  <th scope="col" className={HEAD_NUM}>{t('columns.purchases')}</th>
                  <th scope="col" className={HEAD_NUM}>{t('columns.discounts')}</th>
                  <th scope="col" className={HEAD_NUM}>{t('columns.amount')}</th>
                  <th scope="col" className={HEAD}>{t('columns.pixKey')}</th>
                  <th scope="col" className={HEAD}>{t('columns.invoice')}</th>
                  <th scope="col" className={HEAD}>{t('columns.status')}</th>
                  <th scope="col" className={HEAD}>{t('columns.action')}</th>
                </tr>
              </thead>
              <tbody>
                {state === 'loading' &&
                  [0, 1, 2].map((row) => (
                    <tr key={row} aria-hidden="true" className="border-t border-gray-100 dark:border-gray-800">
                      {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((cell) => (
                        <td key={cell} className={CELL}>
                          <div className="h-4 w-full animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                        </td>
                      ))}
                    </tr>
                  ))}
                {state === 'ready' &&
                  rows.map((row) => {
                    const open = expanded.has(row.id)
                    return (
                      <Fragment key={row.id}>
                        <tr
                          ref={(el) => {
                            if (el) rowRefs.current.set(row.id, el)
                          }}
                          tabIndex={-1}
                          className="border-t border-gray-100 align-top dark:border-gray-800"
                        >
                          <td className={CELL}>
                            <button
                              type="button"
                              aria-expanded={open}
                              className="flex items-center gap-1 text-left font-medium"
                              onClick={() =>
                                setExpanded((current) => {
                                  const next = new Set(current)
                                  if (next.has(row.id)) next.delete(row.id)
                                  else next.add(row.id)
                                  return next
                                })
                              }
                            >
                              {open ? <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
                              {row.placeName}
                            </button>
                          </td>
                          <td className={`${CELL} whitespace-nowrap tabular-nums`}>{cnpj(row.taxId)}</td>
                          <td className={NUM}>{row.purchases}</td>
                          <td className={NUM}>{row.discountsCents ? brl(row.discountsCents) : '—'}</td>
                          <td className={`${NUM} font-semibold`}>{brl(row.amountCents)}</td>
                          <td className={`${CELL} whitespace-nowrap tabular-nums`}>{row.pixKey ? cnpj(row.pixKey) : '—'}</td>
                          <td className={CELL}>{invoiceCell(row)}</td>
                          <td className={CELL}>
                            <Badge className={`${BADGE} ${TINT[STATUS_TINT[row.status]]}`}>{statusLabel(row)}</Badge>
                          </td>
                          <td className={`${CELL} min-w-[16rem]`}>{actionCell(row)}</td>
                        </tr>
                        {message?.id === row.id && (
                          <tr>
                            <td colSpan={9} className={`${CELL} text-red-800 dark:text-red-200`} role="alert">{message.text}</td>
                          </tr>
                        )}
                        {open && (
                          <tr className="bg-gray-50/60 dark:bg-gray-900/40">
                            <td colSpan={9} className="px-8 py-3">
                              <table className="w-full max-w-3xl border-collapse">
                                <thead>
                                  <tr>
                                    <th scope="col" className={HEAD}>{t('statement.date')}</th>
                                    <th scope="col" className={HEAD}>{t('statement.product')}</th>
                                    <th scope="col" className={HEAD_NUM}>{t('statement.received')}</th>
                                    <th scope="col" className={HEAD_NUM}>{t('statement.commission')}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {row.items.map((item, index) => (
                                    <tr key={index} className="border-t border-gray-100 dark:border-gray-800">
                                      <td className={`${CELL} tabular-nums`}>{dayMonth(item.occurredAt ? saoPauloDate(item.occurredAt) : null)}</td>
                                      <td className={CELL}>{itemLabel(item)}</td>
                                      <td className={NUM}>{item.kind === 'carry_over' ? '—' : brl(item.baseCents)}</td>
                                      <td className={NUM}>{brl(item.commissionCents)}</td>
                                    </tr>
                                  ))}
                                  <tr className="border-t border-gray-200 dark:border-gray-700">
                                    <td className={`${CELL} font-semibold`} colSpan={3}>{t('statement.total')}</td>
                                    <td className={`${NUM} font-semibold`}>{brl(row.items.reduce((total, item) => total + item.commissionCents, 0))}</td>
                                  </tr>
                                </tbody>
                              </table>
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
