'use client'

/**
 * The portal cancellations of one client (#913, BR-B2B-060 item 7), in the record's Fiscal &
 * Pagamentos tab right below `PortalSubscriptions`. Same source as `/admin/clients/cancellations`
 * (`GET /api/admin/clients/cancellations?clientId=`), so a mark made in one shows in the other on
 * reload. Nothing renders while there is no cancellation: the block exists only for a cancelled
 * subscription. One cancel, one block (cancelling again is a new record).
 */

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AlertCircle } from 'lucide-react'
import type { Cancellation } from '@/lib/clients/cancellations'
import { CancellationContact, useContactToggle } from '@/components/admin/clients/CancellationContact'

const TERM = 'text-[10px] font-bold uppercase tracking-widest text-gray-500'
const VALUE = 'text-sm font-semibold text-gray-900 dark:text-white break-words'

const dateTime = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso))

export function PortalCancellations({ clientId }: { clientId: string }) {
  const t = useTranslations('Clients.cancellations')
  const [rows, setRows] = useState<Cancellation[]>([])
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/clients/cancellations?clientId=${clientId}&limit=100`)
      if (!res.ok) return // no block: the list page is where a read failure is told
      const data = await res.json()
      setRows(data.cancellations || [])
    } catch {
      // same: the record stays as it was
    }
  }, [clientId])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  const { busy, toggle } = useContactToggle(setRows, setFailed, () => void load())

  if (rows.length === 0) return null
  return (
    <div className="space-y-4">
      {failed && (
        <p role="alert" className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle size={16} /> {t('saveFailed')}
        </p>
      )}
      {rows.map((r) => (
        <dl key={r.feedbackId} className="grid grid-cols-1 gap-y-4 gap-x-10 sm:grid-cols-2" data-testid="portal-cancellation">
          <div>
            <dt className={TERM}>{t('headers.canceledAt')}</dt>
            <dd className={VALUE}>{dateTime(r.canceledAt)}</dd>
          </div>
          <div>
            <dt className={TERM}>{t('headers.reason')}</dt>
            <dd className={VALUE}>{t(`reasons.${r.reason ?? 'none'}`)}</dd>
          </div>
          {r.comment ? (
            <div className="sm:col-span-2">
              <dt className={TERM}>{t('headers.comment')}</dt>
              <dd className={`${VALUE} whitespace-pre-line font-normal`}>{r.comment}</dd>
            </div>
          ) : null}
          <div className="sm:col-span-2">
            <dt className={TERM}>{t('headers.contact')}</dt>
            <dd className="text-sm">
              <CancellationContact row={r} busy={busy === r.feedbackId} onToggle={toggle} />
            </dd>
          </div>
        </dl>
      ))}
    </div>
  )
}

